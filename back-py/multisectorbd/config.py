from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from multisectorbd.credential_vault import CredentialVault

_active_vault: CredentialVault | None = None


def set_password_vault(vault: CredentialVault | None) -> None:
    global _active_vault
    _active_vault = vault


def get_password_vault() -> CredentialVault | None:
    return _active_vault


class ConfigError(Exception):
    pass


def connection_id(group: str, label: str) -> str:
    if group:
        return f"{group}/{label}"
    return label


@dataclass
class Segment:
    name: str
    group: str
    label: str
    host: str
    port: int
    database: str
    user: str
    password: str | None = None
    password_env: str | None = None

    @classmethod
    def from_connection(
        cls,
        group: str,
        data: dict[str, Any],
    ) -> Segment:
        label = str(data["name"]).strip()
        group_name = group.strip()
        return cls(
            name=connection_id(group_name, label),
            group=group_name,
            label=label,
            host=data["host"],
            port=int(data.get("port", 5432)),
            database=data["database"],
            user=data["user"],
            password=data.get("password"),
            password_env=data.get("password_env"),
        )

    def uses_vault(self) -> bool:
        return self.password is None and self.password_env is None

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

        vault = get_password_vault()
        if vault is not None and vault.is_unlocked:
            stored = vault.get_password(self.name)
            if stored is not None:
                return stored

        raise ConfigError(
            f"сегмент {self.name}: пароль не задан — разблокируйте хранилище в интерфейсе"
        )


@dataclass
class ConnectionGroup:
    name: str
    connections: list[Segment] = field(default_factory=list)
    alert: bool = False


@dataclass
class ConfigFile:
    segments: list[Segment]
    groups: list[ConnectionGroup]

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
            if has_password and has_password_env:
                raise ConfigError(
                    f"сегмент {name}: заданы и password, и password_env — оставьте один вариант"
                )
            if has_password_env:
                seg.resolve_password()

            vault = get_password_vault()
            if seg.uses_vault() and vault is not None and vault.is_unlocked:
                if vault.get_password(name) is None:
                    raise ConfigError(
                        f"сегмент {name}: пароль не найден в хранилище"
                    )


def _parse_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("true", "1", "yes")
    return bool(value)


def _load_groups(data: dict[str, Any]) -> ConfigFile:
    segments: list[Segment] = []
    groups: list[ConnectionGroup] = []

    for group_data in data.get("groups", []):
        group_name = str(group_data.get("name", "")).strip()
        if not group_name:
            raise ConfigError("у группы задано пустое имя (name)")

        raw_connections = (
            group_data.get("connections")
            or group_data.get("databases")
            or []
        )
        if not raw_connections:
            raise ConfigError(f"группа {group_name}: нет подключений")

        group_segments: list[Segment] = []
        labels: set[str] = set()
        for conn_data in raw_connections:
            label = str(conn_data.get("name", "")).strip()
            if not label:
                raise ConfigError(f"группа {group_name}: пустое имя подключения")
            if label in labels:
                raise ConfigError(
                    f"группа {group_name}: дублирующееся имя подключения {label}"
                )
            labels.add(label)
            seg = Segment.from_connection(group_name, conn_data)
            group_segments.append(seg)
            segments.append(seg)

        groups.append(
            ConnectionGroup(
                name=group_name,
                connections=group_segments,
                alert=_parse_bool(group_data.get("alert", False)),
            )
        )

    return ConfigFile(segments=segments, groups=groups)


def _load_legacy_segments(data: dict[str, Any]) -> ConfigFile:
    segments = [
        Segment.from_connection("", item) for item in data.get("segments", [])
    ]
    groups = [ConnectionGroup(name="Connections", connections=segments)]
    return ConfigFile(segments=segments, groups=groups)


def load_config(path: Path) -> ConfigFile:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ConfigError(f"чтение {path}: {exc}") from exc

    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ConfigError("разбор JSON конфигурации") from exc

    if "groups" in data:
        return _load_groups(data)
    return _load_legacy_segments(data)


def find_segment(config: ConfigFile, segment_id: str) -> Segment:
    for seg in config.segments:
        if seg.name == segment_id:
            return seg
    raise ConfigError(f"подключение не найдено: {segment_id}")


def segment_password_info(seg: Segment) -> dict[str, Any]:
    if seg.password is not None:
        return {
            "source": "inline",
            "configured": True,
            "can_edit": False,
            "hint": "пароль задан в segments.json",
        }

    if seg.password_env is not None:
        configured = os.environ.get(seg.password_env) is not None
        return {
            "source": "env",
            "configured": configured,
            "can_edit": False,
            "env_var": seg.password_env,
            "hint": f"пароль из переменной окружения {seg.password_env}",
        }

    vault = get_password_vault()
    unlocked = vault is not None and vault.is_unlocked
    stored = unlocked and vault.get_password(seg.name) is not None
    return {
        "source": "vault",
        "configured": stored,
        "can_edit": unlocked,
        "hint": (
            "пароль хранится в зашифрованном файле credentials.enc"
            if unlocked
            else "разблокируйте хранилище паролей"
        ),
    }


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
