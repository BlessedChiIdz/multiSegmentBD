from __future__ import annotations

import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Any, Callable

from multisectorbd.config import Segment
from multisectorbd.db_runner import run_on_segment

CancelRegister = Callable[[str, Callable[[], None] | None], None]


class QueryJobError(Exception):
    pass


CancelCheck = Callable[[], bool]


@dataclass
class QueryOptions:
    stop_on_first_match: bool = False
    autocommit: bool = True


def _segment_has_rows(value: dict[str, Any]) -> bool:
    if value.get("ok") is not True:
        return False
    row_count = value.get("row_count")
    if isinstance(row_count, int) and row_count > 0:
        return True
    rows = value.get("rows")
    return isinstance(rows, list) and len(rows) > 0


@dataclass
class QueryJob:
    query_id: str
    segment_names: list[str]
    status: str = "running"
    segment_status: dict[str, str] = field(default_factory=dict)
    results: list[dict[str, Any]] = field(default_factory=list)
    cancel_event: threading.Event = field(default_factory=threading.Event)
    segment_cancel: dict[str, threading.Event] = field(default_factory=dict)
    _cancel_handlers: dict[str, Callable[[], None]] = field(default_factory=dict)
    _handlers_lock: threading.Lock = field(default_factory=threading.Lock)
    _state_lock: threading.Lock = field(default_factory=threading.Lock)
    _done: threading.Event = field(default_factory=threading.Event)

    def register_cancel_handler(self, segment: str, handler: Callable[[], None]) -> None:
        with self._handlers_lock:
            self._cancel_handlers[segment] = handler

    def unregister_cancel_handler(self, segment: str) -> None:
        with self._handlers_lock:
            self._cancel_handlers.pop(segment, None)

    def cancel_segment(self, segment: str) -> None:
        with self._state_lock:
            if self.segment_status.get(segment) in ("pending", "running"):
                self.segment_status[segment] = "cancelled"
        if segment in self.segment_cancel:
            self.segment_cancel[segment].set()
        handler = None
        with self._handlers_lock:
            handler = self._cancel_handlers.get(segment)
        if handler:
            try:
                handler()
            except Exception:
                pass
            return
        def retry_cancel(attempt: int = 0) -> None:
            if attempt >= 20:
                return
            h = None
            with self._handlers_lock:
                h = self._cancel_handlers.get(segment)
            if h:
                try:
                    h()
                except Exception:
                    pass
                return
            if not self.is_segment_cancelled(segment):
                return
            threading.Timer(0.05, retry_cancel, args=(attempt + 1,)).start()

        retry_cancel()

    def cancel_all(self) -> None:
        self.cancel_event.set()
        for name in list(self.segment_names):
            self.cancel_segment(name)

    def is_segment_cancelled(self, segment: str) -> bool:
        if self.cancel_event.is_set():
            return True
        return self.segment_cancel.get(segment, threading.Event()).is_set()

    def to_dict(self) -> dict[str, Any]:
        with self._state_lock:
            return {
                "query_id": self.query_id,
                "status": self.status,
                "segments": dict(self.segment_status),
                "results": list(self.results),
            }


class QueryJobManager:
    def __init__(self, max_jobs: int = 50) -> None:
        self._jobs: dict[str, QueryJob] = {}
        self._lock = threading.Lock()
        self._max_jobs = max_jobs

    def get(self, query_id: str) -> QueryJob | None:
        with self._lock:
            return self._jobs.get(query_id)

    def start(
        self,
        segments: list[Segment],
        sql: str,
        connect_timeout_secs: float,
        max_concurrent: int,
        options: QueryOptions,
    ) -> str:
        query_id = str(uuid.uuid4())
        job = QueryJob(
            query_id=query_id,
            segment_names=[seg.name for seg in segments],
            segment_status={seg.name: "pending" for seg in segments},
            segment_cancel={seg.name: threading.Event() for seg in segments},
        )

        with self._lock:
            if len(self._jobs) >= self._max_jobs:
                oldest = min(self._jobs.values(), key=lambda j: j.query_id)
                self._jobs.pop(oldest.query_id, None)
            self._jobs[query_id] = job

        thread = threading.Thread(
            target=self._run_job,
            args=(job, segments, sql, connect_timeout_secs, max_concurrent, options),
            daemon=True,
        )
        thread.start()
        return query_id

    def cancel(self, query_id: str, segments: list[str] | None = None) -> None:
        job = self.get(query_id)
        if not job:
            raise QueryJobError("запрос не найден")
        if segments:
            for name in segments:
                job.cancel_segment(name)
        else:
            job.cancel_all()

    def _run_job(
        self,
        job: QueryJob,
        segments: list[Segment],
        sql: str,
        connect_timeout_secs: float,
        max_concurrent: int,
        options: QueryOptions,
    ) -> None:
        semaphore = threading.Semaphore(max(1, max_concurrent))
        found = threading.Event()
        results: list[dict[str, Any]] = []

        def cancelled_check(seg_name: str) -> CancelCheck:
            return lambda: job.is_segment_cancelled(seg_name)

        def make_cancel_register(seg_name: str) -> CancelRegister:
            def register(_segment: str, handler: Callable[[], None] | None) -> None:
                if handler is None:
                    job.unregister_cancel_handler(seg_name)
                else:
                    job.register_cancel_handler(seg_name, handler)

            return register

        def task(seg: Segment) -> dict[str, Any] | None:
            if options.stop_on_first_match and found.is_set():
                return None
            if job.is_segment_cancelled(seg.name):
                with job._state_lock:
                    job.segment_status[seg.name] = "cancelled"
                return {
                    "segment": seg.name,
                    "ok": False,
                    "error": "отменено",
                }

            with semaphore:
                if options.stop_on_first_match and found.is_set():
                    return None
                if job.is_segment_cancelled(seg.name):
                    with job._state_lock:
                        job.segment_status[seg.name] = "cancelled"
                    return {
                        "segment": seg.name,
                        "ok": False,
                        "error": "отменено",
                    }

                with job._state_lock:
                    job.segment_status[seg.name] = "running"
                value = run_on_segment(
                    seg,
                    sql,
                    autocommit=options.autocommit,
                    cancelled_check=cancelled_check(seg.name),
                    on_cancel_register=make_cancel_register(seg.name),
                )
                with job._state_lock:
                    if job.is_segment_cancelled(seg.name) and not value.get("ok"):
                        job.segment_status[seg.name] = "cancelled"
                    elif value.get("ok"):
                        job.segment_status[seg.name] = "completed"
                    else:
                        err = str(value.get("error", ""))
                        job.segment_status[seg.name] = (
                            "cancelled"
                            if "отмен" in err.lower() or "cancel" in err.lower()
                            else "error"
                        )
                return value

        try:
            with ThreadPoolExecutor(max_workers=max(1, len(segments))) as pool:
                futures = {pool.submit(task, seg): seg for seg in segments}
                for future in as_completed(futures):
                    value = future.result()
                    if value is None:
                        continue
                    results.append(value)
                    with job._state_lock:
                        job.results = sorted(results, key=lambda item: item.get("segment", ""))
                    if options.stop_on_first_match and _segment_has_rows(value):
                        found.set()
                        job.cancel_all()
                        break
        finally:
            with job._state_lock:
                for name in job.segment_names:
                    status = job.segment_status.get(name)
                    if status == "pending":
                        job.segment_status[name] = "cancelled"
                    elif status == "running" and job.is_segment_cancelled(name):
                        job.segment_status[name] = "cancelled"

                if job.cancel_event.is_set():
                    job.status = "cancelled"
                elif any(
                    job.segment_status.get(n) == "cancelled"
                    for n in job.segment_names
                ) and not any(
                    job.segment_status.get(n) in ("pending", "running")
                    for n in job.segment_names
                ):
                    job.status = "cancelled"
                else:
                    job.status = "completed"
                job.results = sorted(results, key=lambda item: item.get("segment", ""))
            job._done.set()

            def cleanup() -> None:
                time.sleep(300)
                with self._lock:
                    self._jobs.pop(job.query_id, None)

            threading.Thread(target=cleanup, daemon=True).start()


query_job_manager = QueryJobManager()
