"""Test bench: a fake "2FA service" that issues enrollment QRs and verifies codes.

Usage:  python3 bench/server.py [port]     (default 8793, localhost only)
All state is in process memory, stdlib only. Codes are verified by the reference bench/otp_ref.py,
which is independent of the extension's JS code.
"""

import json
import secrets
import sys
import time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path

import otp_ref

ROOT = Path(__file__).resolve().parent
VENDOR = ROOT.parent / "extension" / "vendor"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8793

ENROLLMENTS: dict[str, dict] = {}  # id -> {issuer, account, secret, algorithm, digits, period, verified_at}

DEMO_EXPORT = [  # a 3-key "Google Authenticator export" with different parameters to catch bugs
    {"issuer": "Bench Mail", "account": "alice@bench.test", "algorithm": "SHA1", "digits": 6},
    {"issuer": "Bench Bank", "account": "alice", "algorithm": "SHA256", "digits": 8},
    {"issuer": "Bench Git", "account": "alice-dev", "algorithm": "SHA512", "digits": 6},
]


def new_enrollment(issuer, account, algorithm="SHA1", digits=6, period=30, secret_bytes=20):
    eid = secrets.token_hex(4)
    e = {
        "id": eid, "issuer": issuer, "account": account,
        "secret": otp_ref.b32encode(secrets.token_bytes(secret_bytes)),
        "algorithm": algorithm, "digits": int(digits), "period": int(period),
        "created_at": time.time(), "verified_at": None,
    }
    ENROLLMENTS[eid] = e
    return e


def public(e):
    return {**e, "uri": otp_ref.otpauth_uri(e)}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quieter console
        sys.stderr.write("  " + fmt % args + "\n")

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _json(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def _static(self, path: Path, ctype: str):
        if not path.is_file():
            return self._send(404, {"error": "not found"})
        self._send(200, path.read_bytes(), ctype)

    def do_GET(self):
        p = self.path.split("?")[0]
        if p in ("/", "/index.html"):
            return self._static(ROOT / "index.html", "text/html; charset=utf-8")
        if p == "/bench.js":
            return self._static(ROOT / "bench.js", "text/javascript; charset=utf-8")
        if p.startswith("/vendor/") and "/.." not in p:
            return self._static(VENDOR / p.removeprefix("/vendor/"), "text/javascript; charset=utf-8")
        if p == "/api/codes":
            # Current "server" codes, to compare by eye with the extension popup.
            now = time.time()
            return self._send(200, {"now": now, "items": [
                {"id": e["id"], "issuer": e["issuer"], "account": e["account"],
                 "code": otp_ref.totp(e["secret"], now, e["digits"], e["algorithm"], e["period"]),
                 "left": e["period"] - int(now) % e["period"], "verified": bool(e["verified_at"])}
                for e in ENROLLMENTS.values()]})
        if p == "/api/selftest":
            return self._send(200, otp_ref.rfc_selftest())
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        p = self.path.split("?")[0]
        try:
            body = self._json()
        except json.JSONDecodeError:
            return self._send(400, {"error": "bad json"})

        if p == "/api/enroll":
            algo = body.get("algorithm", "SHA1")
            if algo not in otp_ref.HASHES:
                return self._send(400, {"error": "algorithm"})
            e = new_enrollment(body.get("issuer") or "TOTP Bench", body.get("account") or "user@bench.test",
                               algo, body.get("digits", 6), body.get("period", 30))
            return self._send(200, public(e))

        if p == "/api/migration":
            batch = [new_enrollment(d["issuer"], d["account"], d["algorithm"], d["digits"]) for d in DEMO_EXPORT]
            return self._send(200, {"uri": otp_ref.migration_uri(batch), "accounts": [public(e) for e in batch]})

        if p == "/api/verify":
            e = ENROLLMENTS.get(body.get("id", ""))
            if not e:
                return self._send(404, {"ok": False, "error": "no such enrollment"})
            code = "".join(ch for ch in str(body.get("code", "")) if ch.isdigit())
            if len(code) != e["digits"]:
                return self._send(200, {"ok": False, "error": f"expected {e['digits']} digits, got {len(code)}"})
            off = otp_ref.verify_totp(e["secret"], code, e["digits"], e["algorithm"], e["period"])
            if off is None:
                return self._send(200, {"ok": False, "error": "code rejected (steps -1, 0, +1 checked)"})
            e["verified_at"] = time.time()
            return self._send(200, {"ok": True, "step_offset": off})

        if p == "/api/reset":
            ENROLLMENTS.clear()
            return self._send(200, {"ok": True})

        return self._send(404, {"error": "not found"})


if __name__ == "__main__":
    bad = [r for r in otp_ref.rfc_selftest() if not r["ok"]]
    if bad:
        sys.exit(f"Reference failed RFC 6238: {bad}")
    print(f"TOTP bench: http://localhost:{PORT}  (RFC 6238 self-test OK)", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
