from __future__ import annotations

import json
from pathlib import Path
from threading import RLock
from typing import Any

from multisectorbd.config import Segment
from multisectorbd.credentials_crypto import (
    CredentialsCryptoError,
    decrypt_passwords,
    encrypt_passwords,
)


class CredentialVaultError(Exception):
    pass


class CredentialVault:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._passwords: dict[str, str] = {}
        self._master_password: str | None = None
        self._unlocked = False
        self._lock = RLock()

    @property
    def store_exists(self) -> bool:
        return self.path.is_file()

    @property
    def is_unlocked(self) -> bool:
        with self._lock:
            return self._unlocked

    def lock(self) -> None:
        with self._lock:
            self._passwords.clear()
            self._master_password = None
            self._unlocked = False

    def get_password(self, segment_id: str) -> str | None:
        with self._lock:
            if not self._unlocked:
                return None
            return self._passwords.get(segment_id)

    def uses_vault(self, seg: Segment) -> bool:
        return seg.password is None and seg.password_env is None

    def missing_for_segments(self, segments: list[Segment]) -> list[str]:
        missing: list[str] = []
        with self._lock:
            for seg in segments:
                if not self.uses_vault(seg):
                    continue
                if not self._unlocked or not self._passwords.get(seg.name):
                    missing.append(seg.name)
        return missing

    def vault_segment_ids(self, segments: list[Segment]) -> list[str]:
        return [seg.name for seg in segments if self.uses_vault(seg)]

    def unlock(self, master_password: str) -> None:
        if not self.store_exists:
            raise CredentialVaultError("хранилище паролей ещё не создано")

        try:
            text = self.path.read_text(encoding="utf-8")
            data = json.loads(text)
        except OSError as exc:
            raise CredentialVaultError(f"чтение {self.path}: {exc}") from exc
        except json.JSONDecodeError as exc:
            raise CredentialVaultError("файл хранилища паролей повреждён") from exc

        try:
            passwords = decrypt_passwords(data, master_password)
        except CredentialsCryptoError as exc:
            raise CredentialVaultError(str(exc)) from exc

        with self._lock:
            self._passwords = passwords
            self._master_password = master_password
            self._unlocked = True

    def setup(self, master_password: str, passwords: dict[str, str]) -> None:
        if not master_password:
            raise CredentialVaultError("мастер-пароль не может быть пустым")

        cleaned = {str(key): str(value) for key, value in passwords.items() if value}
        self._write_store(master_password, cleaned)

        with self._lock:
            self._passwords = cleaned
            self._master_password = master_password
            self._unlocked = True

    def save_passwords(
        self,
        passwords: dict[str, str],
        master_password: str | None = None,
    ) -> None:
        with self._lock:
            merged = dict(self._passwords)
            for key, value in passwords.items():
                if value:
                    merged[str(key)] = str(value)
            session_password = master_password or self._master_password

        if not session_password:
            raise CredentialVaultError("требуется мастер-пароль")

        self._write_store(session_password, merged)

        with self._lock:
            self._passwords = merged
            self._master_password = session_password
            self._unlocked = True

    def status_payload(self, segments: list[Segment]) -> dict[str, Any]:
        vault_segments = self.vault_segment_ids(segments)
        missing = self.missing_for_segments(segments)
        return {
            "store_exists": self.store_exists,
            "unlocked": self.is_unlocked,
            "needs_setup": bool(vault_segments) and not self.store_exists,
            "vault_segments": vault_segments,
            "missing": missing,
            "credentials_path": str(self.path),
        }

    def _write_store(self, master_password: str, passwords: dict[str, str]) -> None:
        data = encrypt_passwords(passwords, master_password)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            self.path.write_text(
                json.dumps(data, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except OSError as exc:
            raise CredentialVaultError(f"запись {self.path}: {exc}") from exc
