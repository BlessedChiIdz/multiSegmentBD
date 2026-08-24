from __future__ import annotations

import datetime
import decimal
import uuid
from typing import Any


def row_to_values(row: tuple[Any, ...]) -> list[Any]:
    return [cell_as_json(value) for value in row]


def cell_as_json(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return value
    if isinstance(value, str):
        return value
    if isinstance(value, bytes):
        return f"<bytea {len(value)} bytes>"
    if isinstance(value, datetime.datetime):
        if value.tzinfo is not None:
            return value.isoformat()
        return value.isoformat(sep=" ", timespec="seconds")
    if isinstance(value, datetime.date):
        return value.isoformat()
    if isinstance(value, datetime.time):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return str(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, (dict, list)):
        return value
    return f"<unsupported type: {type(value).__name__}>"
