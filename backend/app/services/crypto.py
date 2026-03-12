from __future__ import annotations

from dataclasses import dataclass
import base64
import os
from typing import Iterable

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


@dataclass(frozen=True)
class EncryptedPayload:
    nonce: str
    ciphertext: str


class CryptoService:
    def __init__(self, secret_keys: Iterable[bytes]) -> None:
        keys = [key for key in secret_keys if key]
        if not keys:
            raise ValueError("At least one SECRET_KEY is required")
        self._keys = keys

    def encrypt(self, plaintext: str) -> EncryptedPayload:
        nonce = os.urandom(12)
        aesgcm = AESGCM(self._keys[0])
        ciphertext = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
        return EncryptedPayload(
            nonce=base64.b64encode(nonce).decode("utf-8"),
            ciphertext=base64.b64encode(ciphertext).decode("utf-8"),
        )

    def decrypt(self, payload: EncryptedPayload) -> str:
        nonce = base64.b64decode(payload.nonce)
        ciphertext = base64.b64decode(payload.ciphertext)
        for key in self._keys:
            try:
                aesgcm = AESGCM(key)
                plaintext = aesgcm.decrypt(nonce, ciphertext, None)
                return plaintext.decode("utf-8")
            except Exception:
                continue
        raise ValueError("Unable to decrypt payload")
