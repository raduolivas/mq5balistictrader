#!/usr/bin/env python3
"""Loopback TCP adapter between native MQL5 sockets and ZeroMQ services."""

from __future__ import annotations

import asyncio
import logging
import os
import signal
from dataclasses import dataclass
from typing import Mapping

from bridge_protocol import (
    MAX_FRAME_BYTES,
    Ack,
    ProtocolError,
    error_frame,
    is_health_frame,
    parse_ack,
    parse_hello,
    parse_signal,
    parse_tick,
    ready_frame,
)

try:
    import zmq
    import zmq.asyncio
except ImportError:  # Unit tests inject an in-memory transport.
    zmq = None


logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s: %(message)s")
logger = logging.getLogger("Mt5TcpZeroMqBridge")

DEFAULT_SYMBOLS = frozenset({"EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD"})


def _bounded_int(
    environment: Mapping[str, str], name: str, default: int, minimum: int, maximum: int
) -> int:
    try:
        value = int(environment.get(name, str(default)))
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def _endpoint(value: str, name: str) -> str:
    if not value.startswith("tcp://") or any(character.isspace() for character in value):
        raise ValueError(f"{name} must be a tcp:// endpoint without whitespace")
    if len(value) > 200:
        raise ValueError(f"{name} is too long")
    return value


@dataclass(frozen=True, slots=True)
class BridgeConfig:
    host: str = "127.0.0.1"
    port: int = 5555
    allowed_symbols: frozenset[str] = DEFAULT_SYMBOLS
    tick_pub_endpoint: str = "tcp://127.0.0.1:5557"
    signal_pull_endpoint: str = "tcp://127.0.0.1:5556"
    receive_hwm: int = 100
    send_hwm: int = 1_000
    handshake_timeout_seconds: int = 5
    drain_timeout_seconds: int = 2

    def __post_init__(self) -> None:
        if not self.host or any(character.isspace() for character in self.host):
            raise ValueError("host must not be empty or contain whitespace")
        if not 0 <= self.port <= 65_535:
            raise ValueError("port must be between 0 and 65535")
        if not self.allowed_symbols:
            raise ValueError("allowed_symbols must not be empty")
        _endpoint(self.tick_pub_endpoint, "tick_pub_endpoint")
        _endpoint(self.signal_pull_endpoint, "signal_pull_endpoint")
        if not 1 <= self.receive_hwm <= 1_000_000:
            raise ValueError("receive_hwm must be between 1 and 1000000")
        if not 1 <= self.send_hwm <= 1_000_000:
            raise ValueError("send_hwm must be between 1 and 1000000")
        if not 1 <= self.handshake_timeout_seconds <= 60:
            raise ValueError("handshake_timeout_seconds must be between 1 and 60")
        if not 1 <= self.drain_timeout_seconds <= 30:
            raise ValueError("drain_timeout_seconds must be between 1 and 30")

    @classmethod
    def from_env(cls, environment: Mapping[str, str] | None = None) -> "BridgeConfig":
        environment = os.environ if environment is None else environment
        raw_symbols = environment.get("BRIDGE_ALLOWED_SYMBOLS", ",".join(sorted(DEFAULT_SYMBOLS)))
        symbols = frozenset(part.strip() for part in raw_symbols.split(",") if part.strip())
        return cls(
            host=environment.get("BRIDGE_TCP_HOST", "127.0.0.1"),
            port=_bounded_int(environment, "BRIDGE_TCP_PORT", 5555, 1, 65_535),
            allowed_symbols=symbols,
            tick_pub_endpoint=_endpoint(
                environment.get("BRIDGE_TICK_PUB_ENDPOINT", "tcp://127.0.0.1:5557"),
                "BRIDGE_TICK_PUB_ENDPOINT",
            ),
            signal_pull_endpoint=_endpoint(
                environment.get("BRIDGE_SIGNAL_PULL_ENDPOINT", "tcp://127.0.0.1:5556"),
                "BRIDGE_SIGNAL_PULL_ENDPOINT",
            ),
            receive_hwm=_bounded_int(environment, "BRIDGE_RCVHWM", 100, 1, 1_000_000),
            send_hwm=_bounded_int(environment, "BRIDGE_SNDHWM", 1_000, 1, 1_000_000),
            handshake_timeout_seconds=_bounded_int(
                environment, "BRIDGE_HANDSHAKE_TIMEOUT_SECONDS", 5, 1, 60
            ),
            drain_timeout_seconds=_bounded_int(
                environment, "BRIDGE_DRAIN_TIMEOUT_SECONDS", 2, 1, 30
            ),
        )


@dataclass(slots=True)
class ClientSession:
    symbol: str
    magic: int
    writer: asyncio.StreamWriter


class Mt5TcpBridge:
    """Owns TCP client sessions and routes validated frames through ZeroMQ."""

    def __init__(
        self,
        config: BridgeConfig | None = None,
        *,
        context: object | None = None,
        zmq_module: object | None = None,
    ) -> None:
        self.config = BridgeConfig.from_env() if config is None else config
        self._zmq = zmq if zmq_module is None else zmq_module
        if self._zmq is None:
            raise RuntimeError("pyzmq is required to run the MT5 bridge")
        self._owns_context = context is None
        self.context = self._zmq.asyncio.Context() if context is None else context

        self.tick_pub = self.context.socket(self._zmq.PUB)
        self.tick_pub.setsockopt(self._zmq.SNDHWM, self.config.send_hwm)
        self.tick_pub.setsockopt(self._zmq.LINGER, 0)
        self.tick_pub.bind(self.config.tick_pub_endpoint)

        self.signal_pull = self.context.socket(self._zmq.PULL)
        self.signal_pull.setsockopt(self._zmq.RCVHWM, self.config.receive_hwm)
        self.signal_pull.setsockopt(self._zmq.LINGER, 0)
        self.signal_pull.bind(self.config.signal_pull_endpoint)

        self.server: asyncio.AbstractServer | None = None
        self.signal_task: asyncio.Task[None] | None = None
        self.clients: dict[str, ClientSession] = {}
        self._closed = False

    async def start(self) -> None:
        if self.server is not None:
            return
        self.server = await asyncio.start_server(
            self._handle_client,
            self.config.host,
            self.config.port,
            limit=MAX_FRAME_BYTES + 2,
        )
        self.signal_task = asyncio.create_task(self._route_signals(), name="route-zmq-signals")
        sockets = self.server.sockets or []
        addresses = ", ".join(str(sock.getsockname()) for sock in sockets)
        logger.info("MT5 bridge listening at %s", addresses)

    @property
    def bound_port(self) -> int:
        if self.server is None or not self.server.sockets:
            raise RuntimeError("bridge is not listening")
        return int(self.server.sockets[0].getsockname()[1])

    async def _send_line(self, writer: asyncio.StreamWriter, line: str) -> None:
        writer.write((line + "\n").encode("utf-8"))
        await asyncio.wait_for(writer.drain(), timeout=self.config.drain_timeout_seconds)

    async def _read_first_line(self, reader: asyncio.StreamReader) -> bytes:
        return await asyncio.wait_for(
            reader.readline(), timeout=self.config.handshake_timeout_seconds
        )

    async def _handle_client(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        peer = writer.get_extra_info("peername")
        session: ClientSession | None = None
        try:
            first_line = await self._read_first_line(reader)
            if not first_line:
                return
            try:
                if is_health_frame(first_line):
                    await self._send_line(writer, "HEALTH|OK")
                    return
            except ProtocolError:
                pass

            hello = parse_hello(first_line, self.config.allowed_symbols)
            session = ClientSession(hello.symbol, hello.magic, writer)
            previous = self.clients.get(hello.symbol)
            self.clients[hello.symbol] = session
            if previous is not None and previous.writer is not writer:
                previous.writer.close()
            await self._send_line(writer, ready_frame(hello.symbol, self.config.allowed_symbols))
            logger.info("MT5 client ready for %s from %s", hello.symbol, peer)

            while True:
                line = await reader.readline()
                if not line:
                    break
                if line.startswith(b"TICK|"):
                    tick = parse_tick(line, self.config.allowed_symbols)
                    if tick.symbol != session.symbol:
                        raise ProtocolError("SYMBOL_MISMATCH", "tick does not match handshake")
                    await self.tick_pub.send_string(tick.to_wire())
                elif line.startswith(b"ACK|"):
                    acknowledgement: Ack = parse_ack(line, self.config.allowed_symbols)
                    if acknowledgement.symbol != session.symbol:
                        raise ProtocolError("SYMBOL_MISMATCH", "ack does not match handshake")
                    logger.info(
                        "MT5 acknowledgement %s %d: %s",
                        acknowledgement.symbol,
                        acknowledgement.time_msc,
                        acknowledgement.status,
                    )
                else:
                    raise ProtocolError("UNEXPECTED_FRAME", "client frame is not TICK or ACK")
        except (ProtocolError, asyncio.LimitOverrunError, ValueError) as exc:
            code = exc.code if isinstance(exc, ProtocolError) else "FRAME_TOO_LARGE"
            logger.warning("Rejected MT5 client frame from %s: %s", peer, exc)
            try:
                await self._send_line(writer, error_frame(code))
            except (ConnectionError, asyncio.TimeoutError):
                pass
        except (ConnectionError, asyncio.TimeoutError) as exc:
            logger.info("MT5 client %s disconnected: %s", peer, exc)
        finally:
            if session is not None and self.clients.get(session.symbol) is session:
                del self.clients[session.symbol]
            writer.close()
            try:
                await writer.wait_closed()
            except ConnectionError:
                pass

    async def _route_signals(self) -> None:
        try:
            while True:
                message = await self.signal_pull.recv_string()
                try:
                    routed_signal = parse_signal(message, self.config.allowed_symbols)
                except ProtocolError as exc:
                    logger.warning("Rejected internal signal: %s", exc)
                    continue
                session = self.clients.get(routed_signal.symbol)
                if session is None:
                    logger.info("Dropping signal without MT5 client: %s", routed_signal.symbol)
                    continue
                try:
                    await self._send_line(session.writer, routed_signal.to_wire())
                except (ConnectionError, asyncio.TimeoutError):
                    if self.clients.get(routed_signal.symbol) is session:
                        del self.clients[routed_signal.symbol]
                    session.writer.close()
        except asyncio.CancelledError:
            raise

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self.server is not None:
            self.server.close()
            await self.server.wait_closed()
        for session in list(self.clients.values()):
            session.writer.close()
        self.clients.clear()
        if self.signal_task is not None:
            self.signal_task.cancel()
            await asyncio.gather(self.signal_task, return_exceptions=True)
        self.signal_pull.close(linger=0)
        self.tick_pub.close(linger=0)
        if self._owns_context:
            self.context.term()
        logger.info("MT5 bridge shut down cleanly")


async def run_bridge() -> None:
    bridge = Mt5TcpBridge()
    await bridge.start()
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signum in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(signum, stop.set)
    await stop.wait()
    await bridge.close()


def main() -> None:
    asyncio.run(run_bridge())


if __name__ == "__main__":
    main()
