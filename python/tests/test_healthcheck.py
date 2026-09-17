from __future__ import annotations

import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch


PYTHON_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PYTHON_DIR))

from healthcheck import bridge_healthy, engine_healthy  # noqa: E402


class _Connection:
    def __init__(self, response: bytes) -> None:
        self.response = response
        self.sent = b""

    def __enter__(self) -> "_Connection":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def settimeout(self, _timeout: float) -> None:
        return None

    def sendall(self, value: bytes) -> None:
        self.sent += value

    def recv(self, _size: int) -> bytes:
        response, self.response = self.response, b""
        return response


class HealthcheckTests(unittest.TestCase):
    def test_engine_heartbeat_must_exist_and_be_fresh(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "heartbeat"
            self.assertFalse(engine_healthy(str(path), 5))
            path.write_text("ready\n", encoding="ascii")
            now = time.time()
            os.utime(path, (now - 10, now - 10))
            self.assertFalse(engine_healthy(str(path), 5, now=now))
            os.utime(path, (now, now))
            self.assertTrue(engine_healthy(str(path), 5, now=now))

    def test_bridge_probe_requires_exact_response(self) -> None:
        valid = _Connection(b"HEALTH|OK\n")
        with patch("healthcheck.socket.create_connection", return_value=valid):
            self.assertTrue(bridge_healthy("127.0.0.1", 5555))
        self.assertEqual(valid.sent, b"HEALTH\n")

        invalid = _Connection(b"READY|1|EURUSD\n")
        with patch("healthcheck.socket.create_connection", return_value=invalid):
            self.assertFalse(bridge_healthy("127.0.0.1", 5555))


if __name__ == "__main__":
    unittest.main()

