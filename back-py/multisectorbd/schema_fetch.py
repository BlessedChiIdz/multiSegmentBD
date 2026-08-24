from __future__ import annotations

from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from pathlib import Path
from typing import Any

from multisectorbd.config import ConfigFile, Segment
from multisectorbd.db_runner import run_on_segment
from multisectorbd.state import AppState

_SCHEMA_QUERY_PATH = Path(__file__).resolve().parent.parent / "schema_query.sql"
SCHEMA_QUERY = _SCHEMA_QUERY_PATH.read_text(encoding="utf-8")


class SchemaError(Exception):
    pass


def _run_with_timeout(seg: Segment, sql: str, timeout_secs: float) -> dict:
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(run_on_segment, seg, sql)
        try:
            return future.result(timeout=timeout_secs)
        except FuturesTimeoutError as exc:
            raise TimeoutError("таймаут загрузки схемы") from exc


def fetch_schema(segment: Segment, connect_timeout_secs: float) -> dict[str, Any]:
    result = _run_with_timeout(segment, SCHEMA_QUERY, connect_timeout_secs)
    if not result.get("ok"):
        error = result.get("error", "неизвестная ошибка")
        raise SchemaError(str(error))

    columns = result.get("columns") or []
    rows = result.get("rows") or []
    return parse_schema_rows(columns, rows)


def parse_schema_rows(columns: list[str], rows: list[list[Any]]) -> dict[str, Any]:
    def idx(name: str) -> int:
        try:
            return columns.index(name)
        except ValueError as exc:
            raise SchemaError(f"в ответе нет колонки {name}") from exc

    i_table = idx("table_name")
    i_col = idx("column_name")
    i_type = idx("data_type")
    i_len = idx("character_maximum_length")
    i_null = idx("is_nullable")
    i_pk = idx("is_primary_key")

    table_map: OrderedDict[str, list[dict[str, Any]]] = OrderedDict()

    for row in rows:
        table_name = _cell_str(row, i_table)
        column = {
            "name": _cell_str(row, i_col),
            "data_type": _cell_str(row, i_type),
            "char_max_len": _cell_opt_int(row, i_len),
            "is_nullable": _cell_str(row, i_null) == "YES",
            "is_primary_key": _cell_str(row, i_pk) == "YES",
        }
        table_map.setdefault(table_name, []).append(column)

    tables = [{"name": name, "columns": cols} for name, cols in table_map.items()]
    if not tables:
        raise SchemaError("схема public не содержит таблиц")

    return {"tables": tables}


def _cell_str(row: list[Any], index: int) -> str:
    if index >= len(row):
        raise SchemaError("короткая строка в ответе схемы")
    value = row[index]
    if value is None:
        raise SchemaError("неожиданный NULL в схеме")
    if isinstance(value, str):
        return value
    return str(value)


def _cell_opt_int(row: list[Any], index: int) -> int | None:
    if index >= len(row):
        return None
    value = row[index]
    if value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return None
    return None


def load_schema(state: AppState, config: ConfigFile) -> tuple[dict[str, Any], str]:
    if not config.segments:
        raise SchemaError("в конфиге нет сегментов для загрузки схемы")
    seg = config.segments[0]
    schema = fetch_schema(seg, state.connect_timeout)
    return schema, seg.name
