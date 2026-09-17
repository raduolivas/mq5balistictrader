#!/usr/bin/env python3
"""No-trade end-to-end smoke test for TCP -> ZeroMQ -> TCP routing."""

from __future__ import annotations

import argparse
import socket
import time


def read_line(connection: socket.socket, buffer: bytes = b"") -> tuple[str, bytes]:
    while b"\n" not in buffer:
        chunk = connection.recv(512)
        if not chunk:
            raise RuntimeError("bridge closed the smoke-test connection")
        buffer += chunk
        if len(buffer) > 1024:
            raise RuntimeError("bridge response exceeded smoke-test limit")
    line, remaining = buffer.split(b"\n", 1)
    return line.decode("utf-8", errors="strict").removesuffix("\r"), remaining


def run(host: str, port: int, symbol: str, magic: int, timeout: float) -> str:
    with socket.create_connection((host, port), timeout=timeout) as connection:
        connection.settimeout(timeout)
        connection.sendall(f"HELLO|1|{symbol}|{magic}\n".encode())
        line, buffer = read_line(connection)
        expected = f"READY|1|{symbol}"
        if line != expected:
            raise RuntimeError(f"expected {expected!r}, received {line!r}")

        up_counter = 0
        down_counter = 0
        last_timestamp = 0
        for index in range(90):
            timestamp = max(time.time_ns() // 1_000_000, last_timestamp + 1)
            last_timestamp = timestamp
            up_counter += 1
            down_counter += 1
            bid = 1.10000 + index * 0.000001
            ask = bid + 0.00010
            frame = (
                f"TICK|{symbol}|{timestamp}|{bid:.6f}|{ask:.6f}|{bid:.6f}|"
                f"{up_counter}|{down_counter}\n"
            )
            connection.sendall(frame.encode())
            time.sleep(0.02)

        timestamp = max(time.time_ns() // 1_000_000, last_timestamp + 1)
        up_counter += 20
        down_counter += 1
        connection.sendall(
            (
                f"TICK|{symbol}|{timestamp}|1.101000|1.101100|1.101050|"
                f"{up_counter}|{down_counter}\n"
            ).encode()
        )

        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            line, buffer = read_line(connection, buffer)
            if not line.startswith("SIGNAL|"):
                continue
            fields = line.split("|")
            if len(fields) != 5 or fields[1] != "BUY" or fields[2] != symbol:
                raise RuntimeError(f"unexpected signal frame: {line!r}")
            if int(fields[4]) != timestamp:
                raise RuntimeError("signal timestamp does not match trigger tick")
            connection.sendall(f"ACK|{symbol}|{timestamp}|SMOKE_OK\n".encode())
            return line
        raise TimeoutError("no routed signal arrived before timeout")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5555)
    parser.add_argument("--symbol", default="EURUSD")
    parser.add_argument("--magic", type=int, default=990001)
    parser.add_argument("--timeout", type=float, default=10.0)
    args = parser.parse_args()
    routed_signal = run(args.host, args.port, args.symbol, args.magic, args.timeout)
    print(f"PASS: {routed_signal}")


if __name__ == "__main__":
    main()

