from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path


PYTHON_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PYTHON_DIR))

from mt5_tcp_bridge import BridgeConfig, Mt5TcpBridge  # noqa: E402


class _FakeSocket:
    def __init__(self, mode: int) -> None:
        self.mode = mode
        self.options: list[tuple[int, int]] = []
        self.sent: asyncio.Queue[str] = asyncio.Queue()
        self.incoming: asyncio.Queue[str] = asyncio.Queue()
        self.closed_with: int | None = None
        self.endpoint = ""

    def setsockopt(self, option: int, value: int) -> None:
        self.options.append((option, value))

    def bind(self, endpoint: str) -> None:
        self.endpoint = endpoint

    def connect(self, endpoint: str) -> None:
        self.endpoint = endpoint

    async def send_string(self, value: str) -> None:
        await self.sent.put(value)

    async def recv_string(self) -> str:
        return await self.incoming.get()

    def close(self, linger: int = 0) -> None:
        self.closed_with = linger


class _FakeContext:
    def __init__(self) -> None:
        self.sockets: list[_FakeSocket] = []
        self.terminated = False

    def socket(self, mode: int) -> _FakeSocket:
        created = _FakeSocket(mode)
        self.sockets.append(created)
        return created

    def term(self) -> None:
        self.terminated = True


class _FakeZmq:
    PUB = 1
    PULL = 2
    SNDHWM = 3
    RCVHWM = 4
    LINGER = 5


class _FakeReader:
    def __init__(self, *lines: bytes) -> None:
        self.lines: asyncio.Queue[bytes] = asyncio.Queue()
        for line in lines:
            self.lines.put_nowait(line)

    async def readline(self) -> bytes:
        return await self.lines.get()


class _FakeWriter:
    def __init__(self) -> None:
        self.output: asyncio.Queue[bytes] = asyncio.Queue()
        self.pending = b""
        self.closed = False

    def write(self, value: bytes) -> None:
        self.pending += value

    async def drain(self) -> None:
        if self.pending:
            await self.output.put(self.pending)
            self.pending = b""

    def close(self) -> None:
        self.closed = True

    async def wait_closed(self) -> None:
        return None

    def get_extra_info(self, name: str) -> object:
        return ("127.0.0.1", 54321) if name == "peername" else None


class Mt5TcpBridgeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.context = _FakeContext()
        self.bridge = Mt5TcpBridge(
            BridgeConfig(port=0, allowed_symbols=frozenset({"EURUSD", "GBPUSD"})),
            context=self.context,
            zmq_module=_FakeZmq,
        )
        self.pub, self.pull = self.context.sockets
        self.bridge.signal_task = asyncio.create_task(self.bridge._route_signals())

    async def asyncTearDown(self) -> None:
        await self.bridge.close()

    async def _ready(
        self, symbol: str = "EURUSD", *more_lines: bytes
    ) -> tuple[_FakeReader, _FakeWriter, asyncio.Task[None]]:
        reader = _FakeReader(f"HELLO|1|{symbol}|889900\n".encode(), *more_lines)
        writer = _FakeWriter()
        task = asyncio.create_task(self.bridge._handle_client(reader, writer))
        self.assertEqual(
            await asyncio.wait_for(writer.output.get(), timeout=1),
            f"READY|1|{symbol}\n".encode(),
        )
        return reader, writer, task

    async def test_health_probe_does_not_register_a_trading_client(self) -> None:
        reader = _FakeReader(b"HEALTH\n")
        writer = _FakeWriter()
        await self.bridge._handle_client(reader, writer)
        self.assertEqual(await writer.output.get(), b"HEALTH|OK\n")
        self.assertEqual(self.bridge.clients, {})
        self.assertTrue(writer.closed)

    async def test_tick_to_zmq_and_signal_back_to_same_symbol(self) -> None:
        reader, writer, task = await self._ready(
            "EURUSD", b"TICK|EURUSD|10000|1.1|1.1002|1.1001|12|9\n"
        )
        self.assertEqual(
            await asyncio.wait_for(self.pub.sent.get(), timeout=1),
            "TICK|EURUSD|10000|1.1|1.1002|1.1001|12|9",
        )

        await self.pull.incoming.put("SIGNAL|BUY|EURUSD|0.72|10000")
        self.assertEqual(
            await asyncio.wait_for(writer.output.get(), timeout=1),
            b"SIGNAL|BUY|EURUSD|0.720000|10000\n",
        )
        await reader.lines.put(b"ACK|EURUSD|10000|EXECUTION_DISABLED\n")
        await reader.lines.put(b"")
        await task

    async def test_symbol_mismatch_is_rejected_and_connection_closed(self) -> None:
        _reader, writer, task = await self._ready(
            "EURUSD", b"TICK|GBPUSD|10000|1.1|1.1002|1.1001|12|9\n"
        )
        self.assertEqual(await writer.output.get(), b"ERROR|SYMBOL_MISMATCH\n")
        await task
        self.assertTrue(writer.closed)
        self.assertTrue(self.pub.sent.empty())

    async def test_new_handshake_replaces_old_client_for_symbol(self) -> None:
        old_reader, old_writer, old_task = await self._ready()
        new_reader, new_writer, new_task = await self._ready()
        self.assertTrue(old_writer.closed)
        self.assertIs(self.bridge.clients["EURUSD"].writer, new_writer)
        await old_reader.lines.put(b"")
        await new_reader.lines.put(b"")
        await old_task
        await new_task

    async def test_invalid_internal_signal_is_not_forwarded(self) -> None:
        reader, writer, task = await self._ready()
        await self.pull.incoming.put("SIGNAL|BUY|EURUSD|nan|10000")
        with self.assertRaises(asyncio.TimeoutError):
            await asyncio.wait_for(writer.output.get(), timeout=0.05)
        await reader.lines.put(b"")
        await task


if __name__ == "__main__":
    unittest.main()
