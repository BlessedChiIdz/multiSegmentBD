from __future__ import annotations

from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL

from multisectorbd.config import Segment
from multisectorbd.row_json import row_to_values


def _is_read_query(sql: str) -> bool:
    s = str(sql).lstrip()
    if len(s) >= 6 and s[:6].upper() == "SELECT":
        return True
    if len(s) >= 4 and s[:4].upper() == "WITH":
        return True
    return False


def _segment_url(seg: Segment) -> URL:
    return URL.create(
        drivername="postgresql+psycopg2",
        username=seg.user,
        password=seg.resolve_password(),
        host=seg.host,
        port=seg.port,
        database=seg.database,
    )


def run_on_segment(seg: Segment, sql: str) -> dict:
    seg_label = seg.name
    sql = str(sql)
    engine = create_engine(_segment_url(seg), pool_pre_ping=True)
    try:
        is_query = _is_read_query(sql)

        with engine.begin() as conn:
            result = conn.execute(text(sql))

            if is_query:
                columns = list(result.keys())
                rows = result.fetchall()
                data = [row_to_values(tuple(row)) for row in rows]
                return {
                    "segment": seg.name,
                    "ok": True,
                    "columns": columns,
                    "row_count": len(rows),
                    "rows_affected": None,
                    "rows": data,
                }

            affected = result.rowcount
            if affected < 0:
                affected = 0
            return {
                "segment": seg.name,
                "ok": True,
                "columns": ["rows_affected"],
                "row_count": 0,
                "rows_affected": affected,
                "rows": [[affected]],
            }
    except Exception as exc:
        return {
            "segment": seg_label,
            "ok": False,
            "error": str(exc),
        }
    finally:
        engine.dispose()
