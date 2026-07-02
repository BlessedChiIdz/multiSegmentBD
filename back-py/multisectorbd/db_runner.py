from __future__ import annotations

import time
from typing import Any, Callable

import psycopg2
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, Engine
from sqlalchemy.pool import NullPool

from multisectorbd.config import Segment
from multisectorbd.row_json import row_to_values
from multisectorbd.sql_policy import validate_select_only

CancelCheck = Callable[[], bool]
CancelRegister = Callable[[str, Callable[[], None] | None], None]


def _is_read_query(sql: str) -> bool:
    s = str(sql).lstrip()
    if len(s) >= 6 and s[:6].upper() == "SELECT":
        return True
    if len(s) >= 4 and s[:4].upper() == "WITH":
        return True
    return False


def _execute(conn, sql: str, is_query: bool) -> dict:
    result = conn.execute(text(sql))

    if is_query:
        columns = list(result.keys())
        rows = result.fetchall()
        data = [row_to_values(tuple(row)) for row in rows]
        return {
            "columns": columns,
            "row_count": len(rows),
            "rows_affected": None,
            "rows": data,
        }

    affected = result.rowcount
    if affected < 0:
        affected = 0
    return {
        "columns": ["rows_affected"],
        "row_count": 0,
        "rows_affected": affected,
        "rows": [[affected]],
    }


def _psycopg2_connect(seg: Segment):
    return psycopg2.connect(
        host=seg.host,
        port=seg.port,
        dbname=seg.database,
        user=seg.user,
        password=seg.resolve_password(),
    )


def _get_raw_psycopg2(sa_conn) -> Any | None:
    try:
        fairy = sa_conn.connection
    except AttributeError:
        return None

    for attr in ("dbapi_connection", "connection", "driver_connection"):
        try:
            raw = getattr(fairy, attr, None)
        except Exception:
            raw = None
        if raw is not None:
            return raw
    return None


def _read_backend_pid(sa_conn, raw) -> int | None:
    if raw is not None:
        try:
            return int(raw.get_backend_pid())
        except Exception:
            pass
    try:
        value = sa_conn.execute(text("SELECT pg_backend_pid()")).scalar()
        return int(value) if value is not None else None
    except Exception:
        return None


def _run_admin_cancel(seg: Segment, pid: int, terminate: bool = False) -> None:
    admin = None
    try:
        admin = _psycopg2_connect(seg)
        admin.autocommit = True
        with admin.cursor() as cur:
            cur.execute("SELECT pg_cancel_backend(%s)", (pid,))
            cancelled = bool(cur.fetchone()[0])
            if terminate or not cancelled:
                cur.execute("SELECT pg_terminate_backend(%s)", (pid,))
    except Exception:
        pass
    finally:
        if admin is not None:
            try:
                admin.close()
            except Exception:
                pass


def _cancel_running_query(seg: Segment, pid: int | None, raw) -> None:
    if raw is not None:
        try:
            raw.cancel()
        except Exception:
            pass

    if pid is not None and pid > 0:
        _run_admin_cancel(seg, pid, terminate=False)
        _run_admin_cancel(seg, pid, terminate=True)

    if raw is not None:
        try:
            if getattr(raw, "closed", 0) == 0:
                raw.close()
        except Exception:
            pass


def _register_cancel(
    seg: Segment,
    sa_conn,
    segment: str,
    on_cancel_register: CancelRegister | None,
) -> None:
    if not on_cancel_register:
        return

    raw = _get_raw_psycopg2(sa_conn)
    pid = _read_backend_pid(sa_conn, raw)
    live = {"raw": raw, "pid": pid}

    def cancel() -> None:
        _cancel_running_query(seg, live["pid"], live["raw"])

    on_cancel_register(segment, cancel)


def _unregister_cancel(segment: str, on_cancel_register: CancelRegister | None) -> None:
    if on_cancel_register:
        on_cancel_register(segment, None)


def _segment_url(seg: Segment) -> URL:
    return URL.create(
        drivername="postgresql+psycopg2",
        username=seg.user,
        password=seg.resolve_password(),
        host=seg.host,
        port=seg.port,
        database=seg.database,
    )


def _make_engine(seg: Segment) -> Engine:
    return create_engine(
        _segment_url(seg),
        poolclass=NullPool,
        pool_pre_ping=True,
    )


def ping_segment(seg: Segment) -> dict:
    started = time.perf_counter()
    engine = _make_engine(seg)
    try:
        with engine.connect() as conn:
            conn = conn.execution_options(isolation_level="AUTOCOMMIT")
            conn.execute(text("SELECT 1"))
        latency_ms = int((time.perf_counter() - started) * 1000)
        return {
            "id": seg.name,
            "ok": True,
            "latency_ms": latency_ms,
        }
    except Exception as exc:
        return {
            "id": seg.name,
            "ok": False,
            "error": str(exc),
        }
    finally:
        engine.dispose()


def run_on_segment(
    seg: Segment,
    sql: str,
    *,
    autocommit: bool = True,
    cancelled_check: CancelCheck | None = None,
    on_cancel_register: CancelRegister | None = None,
) -> dict:
    seg_label = seg.name
    sql = str(sql)

    if cancelled_check and cancelled_check():
        return {
            "segment": seg_label,
            "ok": False,
            "error": "отменено",
        }

    try:
        validate_select_only(sql)
    except Exception as exc:
        return {
            "segment": seg_label,
            "ok": False,
            "error": str(exc),
        }

    engine = _make_engine(seg)
    try:
        is_query = _is_read_query(sql)

        if autocommit:
            with engine.connect() as conn:
                conn = conn.execution_options(isolation_level="AUTOCOMMIT")
                _register_cancel(seg, conn, seg.name, on_cancel_register)
                try:
                    if cancelled_check and cancelled_check():
                        return {
                            "segment": seg_label,
                            "ok": False,
                            "error": "отменено",
                        }
                    payload = _execute(conn, sql, is_query)
                finally:
                    _unregister_cancel(seg.name, on_cancel_register)
        else:
            with engine.begin() as conn:
                _register_cancel(seg, conn, seg.name, on_cancel_register)
                try:
                    if cancelled_check and cancelled_check():
                        return {
                            "segment": seg_label,
                            "ok": False,
                            "error": "отменено",
                        }
                    payload = _execute(conn, sql, is_query)
                finally:
                    _unregister_cancel(seg.name, on_cancel_register)

        return {
            "segment": seg.name,
            "ok": True,
            **payload,
        }
    except Exception as exc:
        err = str(exc)
        if cancelled_check and cancelled_check():
            err = "отменено"
        elif "cancel" in err.lower() or "отмен" in err.lower():
            err = "отменено"
        return {
            "segment": seg_label,
            "ok": False,
            "error": err,
        }
    finally:
        engine.dispose()
