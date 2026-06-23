from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError, as_completed
from dataclasses import dataclass
from typing import Any

from multisectorbd.config import ConfigFile, Segment, load_config, validate_config_path
from multisectorbd.db_runner import run_on_segment
from multisectorbd.schema_fetch import load_schema
from multisectorbd.state import AppState


class QueryError(Exception):
    pass


@dataclass
class QueryOptions:
    stop_on_first_match: bool = False


def check_config(state: AppState) -> ConfigFile:
    return validate_config_path(state.config_path)


def filter_segments(segments: list[Segment], names: list[str]) -> list[Segment]:
    if not names:
        return segments

    wanted = set(names)
    filtered = [seg for seg in segments if seg.name in wanted]
    if not filtered:
        raise QueryError("После фильтрации не осталось ни одного сегмента")
    return filtered


def execute_query(
    state: AppState,
    sql: str,
    segment_filter: list[str],
    options: QueryOptions,
) -> list[dict[str, Any]]:
    sql = sql.strip()
    if not sql:
        raise QueryError("Пустой SQL")

    config = load_config(state.config_path)
    segments = filter_segments(config.segments, segment_filter)
    return run_on_all_segments(
        segments,
        sql,
        state.connect_timeout,
        state.max_concurrent_segments,
        options,
    )


def _segment_has_rows(value: dict[str, Any]) -> bool:
    if value.get("ok") is not True:
        return False
    row_count = value.get("row_count")
    if isinstance(row_count, int) and row_count > 0:
        return True
    rows = value.get("rows")
    return isinstance(rows, list) and len(rows) > 0


def _run_segment_with_timeout(
    seg: Segment,
    sql: str,
    timeout_secs: float,
) -> dict[str, Any]:
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(run_on_segment, seg, sql)
        try:
            return future.result(timeout=timeout_secs)
        except FuturesTimeoutError:
            return {
                "segment": seg.name,
                "ok": False,
                "error": f"таймаут {int(timeout_secs)} с (подключение или запрос)",
            }


def run_on_all_segments(
    segments: list[Segment],
    sql: str,
    connect_timeout_secs: float,
    max_concurrent: int,
    options: QueryOptions,
) -> list[dict[str, Any]]:
    semaphore = threading.Semaphore(max(1, max_concurrent))
    found = threading.Event()
    results: list[dict[str, Any]] = []

    def task(seg: Segment) -> dict[str, Any] | None:
        if options.stop_on_first_match and found.is_set():
            return None

        with semaphore:
            if options.stop_on_first_match and found.is_set():
                return None

            value = _run_segment_with_timeout(seg, sql, connect_timeout_secs)
            if options.stop_on_first_match and _segment_has_rows(value):
                found.set()
            return value

    with ThreadPoolExecutor(max_workers=max(1, len(segments))) as pool:
        futures = [pool.submit(task, seg) for seg in segments]
        for future in as_completed(futures):
            value = future.result()
            if value is None:
                continue
            results.append(value)
            if options.stop_on_first_match and _segment_has_rows(value):
                found.set()
                break

    results.sort(key=lambda item: item.get("segment", ""))
    return results
