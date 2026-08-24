from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError, as_completed
from typing import Any

from multisectorbd.config import Segment
from multisectorbd.db_runner import ping_segment


def _ping_with_timeout(seg: Segment, timeout_secs: float) -> dict[str, Any]:
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(ping_segment, seg)
        try:
            return future.result(timeout=timeout_secs)
        except FuturesTimeoutError:
            return {
                "id": seg.name,
                "ok": False,
                "error": f"таймаут {int(timeout_secs)} с",
            }


def check_all_segments(
    segments: list[Segment],
    connect_timeout_secs: float,
    max_concurrent: int,
) -> dict[str, dict[str, Any]]:
    if not segments:
        return {}

    timeout = max(1.0, float(connect_timeout_secs))
    semaphore = threading.Semaphore(max(1, max_concurrent))
    results: dict[str, dict[str, Any]] = {}

    def task(seg: Segment) -> dict[str, Any]:
        with semaphore:
            return _ping_with_timeout(seg, timeout)

    with ThreadPoolExecutor(max_workers=max(1, len(segments))) as pool:
        futures = [pool.submit(task, seg) for seg in segments]
        for future in as_completed(futures):
            item = future.result()
            results[item["id"]] = item

    return results
