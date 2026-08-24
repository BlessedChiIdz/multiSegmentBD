from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from threading import RLock
from typing import Any

from multisectorbd.credential_vault import CredentialVault
from multisectorbd.transport_crypto import TransportCrypto


@dataclass
class AppState:
    config_path: Path
    credentials_path: Path
    connect_timeout_secs: int
    max_concurrent_segments: int
    vault: CredentialVault = field(repr=False)
    transport_crypto: TransportCrypto = field(default_factory=TransportCrypto, repr=False)
    schema: dict[str, Any] = field(default_factory=lambda: {"tables": []})
    schema_source: str = ""
    lock: RLock = field(default_factory=RLock, repr=False)

    @property
    def connect_timeout(self) -> float:
        return float(max(1, self.connect_timeout_secs))
