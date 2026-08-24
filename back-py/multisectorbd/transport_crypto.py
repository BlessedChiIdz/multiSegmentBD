from __future__ import annotations

import base64

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa


class TransportCryptoError(Exception):
    pass


class TransportCrypto:
    """RSA-OAEP для секретов в теле HTTP-запроса (защита от перехвата без TLS)."""

    def __init__(self) -> None:
        self._private_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048,
        )

    def public_key_pem(self) -> str:
        return (
            self._private_key.public_key()
            .public_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PublicFormat.SubjectPublicKeyInfo,
            )
            .decode("ascii")
        )

    def payload(self) -> dict[str, str]:
        return {
            "algorithm": "RSA-OAEP-SHA256",
            "public_key": self.public_key_pem(),
        }

    def decrypt(self, ciphertext_b64: str) -> str:
        try:
            ciphertext = base64.b64decode(str(ciphertext_b64).strip(), validate=True)
            plaintext = self._private_key.decrypt(
                ciphertext,
                padding.OAEP(
                    mgf=padding.MGF1(algorithm=hashes.SHA256()),
                    algorithm=hashes.SHA256(),
                    label=None,
                ),
            )
            return plaintext.decode("utf-8")
        except Exception as exc:
            raise TransportCryptoError("не удалось расшифровать переданный пароль") from exc
