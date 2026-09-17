#!/usr/bin/env python3
"""Container health probes for the bridge and heuristic engine."""

from __future__ import annotations

import argparse
import os
import socket
import time
from pathlib import Path


def engine_healthy(path: str, max_age_seconds: float, *, now: float | None = None) -> bool:
    if max_age_seconds <= 0:
        return False
    heartbeat = Path(path)
    try:
        modified = heartbeat.stat().st_mtime
    except OSError:
        return False
    current = time.time() if now is None else now
    age = current - modified
    return -1.0 <= age <= max_age_seconds


def bridge_healthy(host: str, port: int, timeout_seconds: float = 2.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout_seconds) as connection:
            connection.settimeout(timeout_seconds)
            connection.sendall(b"HEALTH\n")
            response = b""
            while not response.endswith(b"\n") and len(response) <= 64:
                chunk = connection.recv(64)
                if not chunk:
                    break
                response += chunk
            return response == b"HEALTH|OK\n"
    except (OSError, TimeoutError):
        return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("engine", "bridge"))
    arguments = parser.parse_args()
    if arguments.mode == "engine":
        healthy = engine_healthy(
            os.environ.get("FOREX_HEARTBEAT_PATH", "/tmp/engine-heartbeat"),
            float(os.environ.get("FOREX_HEALTH_MAX_AGE_SECONDS", "5")),
        )
    else:
        healthy = bridge_healthy(
            os.environ.get("BRIDGE_HEALTH_HOST", "127.0.0.1"),
            int(os.environ.get("BRIDGE_TCP_PORT", "5555")),
        )
    raise SystemExit(0 if healthy else 1)


if __name__ == "__main__":
    main()
