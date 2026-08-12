from __future__ import annotations

import base64
import json
import os
from hashlib import pbkdf2_hmac
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

_ITERATIONS = 480_000
_SALT_LEN = 16


class CredentialsCryptoError(Exception):
    pass


def _derive_fernet_key(master_password: str, salt: bytes) -> bytes:
    raw = pbkdf2_hmac(
        "sha256",
        master_password.encode("utf-8"),
        salt,
        _ITERATIONS,
        dklen=32,
    )
    return base64.urlsafe_b64encode(raw)


def encrypt_passwords(passwords: dict[str, str], master_password: str) -> dict[str, Any]:
    salt = os.urandom(_SALT_LEN)
    fernet = Fernet(_derive_fernet_key(master_password, salt))
    payload = json.dumps({"passwords": passwords}, ensure_ascii=False).encode("utf-8")
    token = fernet.encrypt(payload)
    return {
        "version": 1,
        "salt": base64.b64encode(salt).decode("ascii"),
        "payload": token.decode("ascii"),
    }


def decrypt_passwords(data: dict[str, Any], master_password: str) -> dict[str, str]:
    try:
        version = int(data.get("version", 0))
        if version != 1:
            raise CredentialsCryptoError("неподдерживаемая версия хранилища паролей")

        salt = base64.b64decode(str(data["salt"]))
        token = str(data["payload"]).encode("ascii")
        fernet = Fernet(_derive_fernet_key(master_password, salt))
        raw = fernet.decrypt(token)
    except (KeyError, ValueError, InvalidToken) as exc:
        raise CredentialsCryptoError("неверный мастер-пароль или повреждённый файл") from exc

    try:
        parsed = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise CredentialsCryptoError("повреждённое содержимое хранилища") from exc

    passwords = parsed.get("passwords")
    if not isinstance(passwords, dict):
        raise CredentialsCryptoError("некорректный формат хранилища")

    return {str(key): str(value) for key, value in passwords.items()}
