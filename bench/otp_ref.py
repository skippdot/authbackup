"""Reference HOTP/TOTP implementation and Google Authenticator export encoder.

Deliberately written separately from the extension's JS code (stdlib only) so the bench is
an independent "server": if the extension and the bench agree on codes, both are right.
"""

import base64
import hashlib
import hmac
import struct
import time
import urllib.parse

HASHES = {"SHA1": hashlib.sha1, "SHA256": hashlib.sha256, "SHA512": hashlib.sha512}


def b32decode(secret: str) -> bytes:
    s = secret.upper().replace(" ", "").replace("-", "").rstrip("=")
    return base64.b32decode(s + "=" * (-len(s) % 8))


def b32encode(raw: bytes) -> str:
    return base64.b32encode(raw).decode().rstrip("=")


def hotp(secret: str, counter: int, digits: int = 6, algorithm: str = "SHA1") -> str:
    mac = hmac.new(b32decode(secret), struct.pack(">Q", counter), HASHES[algorithm]).digest()
    offset = mac[-1] & 0x0F
    code = struct.unpack(">I", mac[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(code % 10**digits).zfill(digits)


def totp(secret: str, at: float | None = None, digits: int = 6, algorithm: str = "SHA1", period: int = 30) -> str:
    t = time.time() if at is None else at
    return hotp(secret, int(t // period), digits, algorithm)


def verify_totp(
    secret: str, code: str, digits: int, algorithm: str, period: int, window: int = 1, at: float | None = None
):
    """As real services do: accept the current step and +-window neighbours (clock skew).
    Returns the step offset (0, -1, +1) or None."""
    t = time.time() if at is None else at
    step = int(t // period)
    for off in sorted(range(-window, window + 1), key=abs):
        if hmac.compare_digest(hotp(secret, step + off, digits, algorithm), code):
            return off
    return None


# ---------- protobuf MigrationPayload (by hand) ----------

def _varint(n: int) -> bytes:
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def _field_varint(field: int, value: int) -> bytes:
    return _varint(field << 3) + _varint(value)


def _field_bytes(field: int, data: bytes) -> bytes:
    return _varint((field << 3) | 2) + _varint(len(data)) + data


ALGO_CODE = {"SHA1": 1, "SHA256": 2, "SHA512": 3}


def migration_uri(accounts: list[dict], batch_id: int = 1) -> str:
    body = b""
    for a in accounts:
        name = f"{a['issuer']}:{a['account']}" if a.get("issuer") else a["account"]
        params = (
            _field_bytes(1, b32decode(a["secret"]))
            + _field_bytes(2, name.encode())
            + _field_bytes(3, a.get("issuer", "").encode())
            + _field_varint(4, ALGO_CODE[a["algorithm"]])
            + _field_varint(5, 2 if a["digits"] == 8 else 1)
            + _field_varint(6, 2)  # TOTP
        )
        body += _field_bytes(1, params)
    body += _field_varint(2, 1) + _field_varint(3, 1) + _field_varint(4, 0) + _field_varint(5, batch_id)
    return "otpauth-migration://offline?data=" + urllib.parse.quote(base64.b64encode(body).decode(), safe="")


def otpauth_uri(a: dict) -> str:
    label = urllib.parse.quote(f"{a['issuer']}:{a['account']}" if a.get("issuer") else a["account"])
    q = urllib.parse.urlencode({
        "secret": a["secret"], "issuer": a["issuer"], "algorithm": a["algorithm"],
        "digits": a["digits"], "period": a["period"],
    })
    return f"otpauth://totp/{label}?{q}"


# ---------- RFC 6238 Appendix B: reference self-check ----------

RFC_SEEDS = {
    "SHA1": b"12345678901234567890",
    "SHA256": b"12345678901234567890123456789012",
    "SHA512": b"1234567890123456789012345678901234567890123456789012345678901234",
}
RFC_TABLE = [
    (59, "94287082", "46119246", "90693936"),
    (1111111109, "07081804", "68084774", "25091201"),
    (1111111111, "14050471", "67062674", "99943326"),
    (1234567890, "89005924", "91819424", "93441116"),
    (2000000000, "69279037", "90698825", "38618901"),
    (20000000000, "65353130", "77737706", "47863826"),
]


def rfc_selftest() -> list[dict]:
    rows = []
    for t, *expected in RFC_TABLE:
        for algo, want in zip(("SHA1", "SHA256", "SHA512"), expected, strict=False):
            got = totp(b32encode(RFC_SEEDS[algo]), at=t, digits=8, algorithm=algo)
            rows.append({"time": t, "algorithm": algo, "expected": want, "got": got, "ok": got == want})
    return rows
