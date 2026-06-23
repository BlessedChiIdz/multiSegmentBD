from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class ConfigError(Exception):
    pass


@dataclass
class Segment:
    name: str
    host: str
    port: int
    database: str
    user: str
    password: str | None = None
    password_env: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Segment:
        return cls(
            name=data["name"],
            host=data["host"],
            port=int(data.get("port", 5432)),
            database=data["database"],
            user=data["user"],
            password=data.get("password"),
            password_env=data.get("password_env"),
        )

    def resolve_password(self) -> str:
        if self.password is not None:
            return self.password
        if self.password_env is not None:
            value = os.environ.get(self.password_env)
            if value is None:
                raise ConfigError(
                    f"сегмент {self.name}: переменная окружения {self.password_env} не задана"
                )
            return value
        raise ConfigError(
            f"сегмент {self.name}: укажите password или password_env"
        )


@dataclass
class ConfigFile:
    segments: list[Segment]

    def validate(self) -> None:
        if not self.segments:
            raise ConfigError("в конфиге должен быть хотя бы один сегмент")

        names: set[str] = set()
        for seg in self.segments:
            name = seg.name.strip()
            if not name:
                raise ConfigError("у сегмента задано пустое имя (name)")
            if name in names:
                raise ConfigError(f"дублирующееся имя сегмента: {name}")
            names.add(name)

            if not seg.host.strip():
                raise ConfigError(f"сегмент {name}: пустой host")
            if not seg.database.strip():
                raise ConfigError(f"сегмент {name}: пустой database")
            if not seg.user.strip():
                raise ConfigError(f"сегмент {name}: пустой user")
            if seg.port == 0:
                raise ConfigError(f"сегмент {name}: port не может быть 0")

            has_password = seg.password is not None
            has_password_env = seg.password_env is not None
            if not has_password and not has_password_env:
                raise ConfigError(f"сегмент {name}: укажите password или password_env")
            if has_password and has_password_env:
                raise ConfigError(
                    f"сегмент {name}: заданы и password, и password_env — оставьте один вариант"
                )
            if has_password_env:
                seg.resolve_password()


def load_config(path: Path) -> ConfigFile:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ConfigError(f"чтение {path}: {exc}") from exc

    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ConfigError("разбор JSON конфигурации") from exc

    segments = [Segment.from_dict(item) for item in data.get("segments", [])]
    return ConfigFile(segments=segments)


def validate_config_path(path: Path) -> ConfigFile:
    if not path.exists():
        raise ConfigError(f"файл конфигурации не найден: {path}")
    if not path.is_file():
        raise ConfigError(f"путь конфигурации не является файлом: {path}")

    config = load_config(path)
    try:
        config.validate()
    except ConfigError as exc:
        raise ConfigError(f"конфигурация невалидна: {exc}") from exc
    return config
