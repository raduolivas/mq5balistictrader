import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


PYTHON_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PYTHON_DIR))

from forex_ai_engine import (  # noqa: E402
    EngineConfig,
    ForexStrategyEngine,
    Signal,
    SymbolState,
    Tick,
    TickValidationError,
    parse_tick,
)


def make_tick(
    *,
    symbol="EURUSD",
    time_msc=10_000,
    bid=1.1000,
    ask=1.1002,
    last=1.1001,
    bid_vol=1.0,
    ask_vol=1.0,
):
    return Tick(symbol, time_msc, bid, ask, last, bid_vol, ask_vol)


class ParseTickTests(unittest.TestCase):
    def test_parse_tick_preserves_protocol_fields(self):
        tick = parse_tick(
            "TICK|EURUSD|10000|1.1000|1.1002|1.1001|12|9",
            now_ms=10_250,
        )

        self.assertEqual(tick.symbol, "EURUSD")
        self.assertEqual(tick.time_msc, 10_000)
        self.assertAlmostEqual(tick.bid, 1.1)
        self.assertAlmostEqual(tick.ask, 1.1002)
        self.assertEqual(tick.bid_vol, 12.0)
        self.assertEqual(tick.ask_vol, 9.0)

    def test_parse_tick_rejects_non_finite_and_stale_values(self):
        invalid_messages = (
            "TICK|EURUSD|10000|nan|1.1|1.0|1|1",
            "TICK|EURUSD|10000|1.0|inf|1.0|1|1",
            "TICK|EURUSD|10000|1.0|1.1|-inf|1|1",
            "TICK|EURUSD|10000|1.0|1.1|1.0|nan|1",
            "TICK|EURUSD|10000|1.0|1.1|1.0|1|inf",
            "TICK|EURUSD|1000|1.0|1.1|1.0|1|1",
        )

        for message in invalid_messages:
            with self.subTest(message=message), self.assertRaises(TickValidationError):
                parse_tick(message, now_ms=10_000)

    def test_parse_tick_rejects_bad_shape_market_values_and_symbol(self):
        invalid_messages = (
            "QUOTE|EURUSD|10000|1.0|1.1|1.0|1|1",
            "TICK|EURUSD|10000|1.0|1.1|1.0|1",
            "TICK|EURUSD|10000|1.0|1.1|1.0|1|1|extra",
            "TICK|NOT_ALLOWED|10000|1.0|1.1|1.0|1|1",
            "TICK|EURUSD|10000|0|1.1|1.0|1|1",
            "TICK|EURUSD|10000|1.2|1.1|1.0|1|1",
            "TICK|EURUSD|10000|1.0|1.1|1.0|-1|1",
        )

        for message in invalid_messages:
            with self.subTest(message=message), self.assertRaises(TickValidationError):
                parse_tick(message, now_ms=10_000)

    def test_parse_tick_accepts_an_explicit_symbol_allowlist(self):
        tick = parse_tick(
            "TICK|XAUUSD|10000|2000|2000.1|2000.05|1|1",
            now_ms=10_000,
            allowed_symbols=frozenset({"XAUUSD"}),
        )
        self.assertEqual(tick.symbol, "XAUUSD")


class SymbolStateTests(unittest.TestCase):
    def _primed_state(self, symbol="EURUSD"):
        state = SymbolState(buffer_size=4, minimum_ticks=3, cooldown_seconds=60.0)
        self.assertIsNone(state.on_tick(make_tick(symbol=symbol, time_msc=1, bid_vol=1), 1.0))
        self.assertIsNone(state.on_tick(make_tick(symbol=symbol, time_msc=2, bid_vol=1), 2.0))
        return state

    def test_emits_protocol_compatible_heuristic_signal(self):
        state = self._primed_state()

        signal = state.on_tick(make_tick(time_msc=3, bid_vol=10), 3.0)

        self.assertEqual(signal, Signal("BUY", "EURUSD", 0.72, 3))
        self.assertEqual(signal.to_message(), "SIGNAL|BUY|EURUSD|0.720000|3")
        self.assertNotIn("0.10", signal.to_message())

    def test_rejects_out_of_order_exchange_timestamps(self):
        state = SymbolState(buffer_size=4, minimum_ticks=2)
        state.on_tick(make_tick(time_msc=10), 1.0)

        with self.assertRaises(TickValidationError):
            state.on_tick(make_tick(time_msc=10), 2.0)
        with self.assertRaises(TickValidationError):
            state.on_tick(make_tick(time_msc=9), 3.0)

    def test_symbol_cooldowns_and_buffers_are_isolated(self):
        eurusd = self._primed_state("EURUSD")
        gbpusd = self._primed_state("GBPUSD")

        first = eurusd.on_tick(make_tick(symbol="EURUSD", time_msc=3, bid_vol=10), 3.0)
        other = gbpusd.on_tick(make_tick(symbol="GBPUSD", time_msc=3, bid_vol=10), 3.0)
        cooled_down = eurusd.on_tick(make_tick(symbol="EURUSD", time_msc=4, bid_vol=20), 10.0)

        self.assertIsNotNone(first)
        self.assertIsNotNone(other)
        self.assertIsNone(cooled_down)
        self.assertIsNot(eurusd.tick_buffer, gbpusd.tick_buffer)

    def test_buffer_is_bounded(self):
        state = SymbolState(buffer_size=3, minimum_ticks=3, confidence_threshold=1.0)
        for timestamp in range(1, 11):
            state.on_tick(make_tick(time_msc=timestamp), float(timestamp))
        self.assertEqual(len(state.tick_buffer), 3)


class ConfigurationTests(unittest.TestCase):
    def test_environment_configuration_is_validated(self):
        clean_env = {key: value for key, value in os.environ.items() if not key.startswith("FOREX_")}
        clean_env.update(
            {
                "FOREX_ALLOWED_SYMBOLS": "EURUSD, GBPUSD",
                "FOREX_BUFFER_SIZE": "75",
                "FOREX_MINIMUM_TICKS": "50",
                "FOREX_POLL_TIMEOUT_MS": "25",
                "FOREX_MAX_TICK_AGE_MS": "2500",
                "FOREX_SUB_ENDPOINT": "tcp://127.0.0.1:5557",
                "FOREX_SIGNAL_ENDPOINT": "tcp://127.0.0.1:5556",
            }
        )

        with patch.dict(os.environ, clean_env, clear=True):
            config = EngineConfig.from_env()

        self.assertEqual(config.allowed_symbols, frozenset({"EURUSD", "GBPUSD"}))
        self.assertEqual(config.buffer_size, 75)
        self.assertEqual(config.minimum_ticks, 50)
        self.assertEqual(config.poll_timeout_ms, 25)
        self.assertEqual(config.max_tick_age_ms, 2500)
        self.assertEqual(config.sub_endpoint, "tcp://127.0.0.1:5557")
        self.assertEqual(config.signal_endpoint, "tcp://127.0.0.1:5556")

    def test_invalid_environment_configuration_fails_fast(self):
        invalid_values = {
            "FOREX_ALLOWED_SYMBOLS": " , ",
            "FOREX_CONFIDENCE_THRESHOLD": "nan",
            "FOREX_COOLDOWN_SECONDS": "-1",
            "FOREX_BUFFER_SIZE": "2",
            "FOREX_MINIMUM_TICKS": "3",
            "FOREX_SUB_PORT": "70000",
            "FOREX_RCVHWM": "0",
            "FOREX_SUB_ENDPOINT": "http://127.0.0.1:5557",
        }

        for key, value in invalid_values.items():
            with self.subTest(key=key), patch.dict(os.environ, {key: value}, clear=True):
                with self.assertRaises(ValueError):
                    EngineConfig.from_env()


class _FakeSocket:
    def __init__(self):
        self.options = []
        self.closed_with = None

    def setsockopt(self, option, value):
        self.options.append((option, value))

    def setsockopt_string(self, option, value):
        self.options.append((option, value))

    def connect(self, endpoint):
        self.endpoint = endpoint

    def bind(self, endpoint):
        self.endpoint = endpoint

    def close(self, linger=None):
        self.closed_with = linger


class _FakeContext:
    def __init__(self):
        self.sockets = []
        self.terminated = False

    def socket(self, _socket_type):
        socket = _FakeSocket()
        self.sockets.append(socket)
        return socket

    def term(self):
        self.terminated = True


class _FakePoller:
    def __init__(self):
        self.registered = {}

    def register(self, socket, event):
        self.registered[socket] = event

    def unregister(self, socket):
        del self.registered[socket]


class _FakeZmq:
    SUB = 1
    PUSH = 2
    RCVHWM = 3
    SNDHWM = 4
    LINGER = 5
    SUBSCRIBE = 6
    POLLIN = 7
    NOBLOCK = 8
    Again = BlockingIOError


class EngineLifecycleTests(unittest.TestCase):
    def test_engine_uses_per_symbol_state_and_clean_socket_shutdown(self):
        context = _FakeContext()
        poller = _FakePoller()
        engine = ForexStrategyEngine(
            context=context,
            config=EngineConfig(),
            poller=poller,
            zmq_module=_FakeZmq,
        )
        try:
            eurusd = engine.state_for("EURUSD")
            gbpusd = engine.state_for("GBPUSD")
            self.assertIsNot(eurusd, gbpusd)
            self.assertIs(eurusd, engine.states["EURUSD"])

            sub_socket, pub_socket = context.sockets
            self.assertIn((_FakeZmq.RCVHWM, 1_000), sub_socket.options)
            self.assertIn((_FakeZmq.SNDHWM, 100), pub_socket.options)
            self.assertIn((_FakeZmq.LINGER, 0), sub_socket.options)
            self.assertIn((_FakeZmq.LINGER, 0), pub_socket.options)
            self.assertEqual(poller.registered[sub_socket], _FakeZmq.POLLIN)
        finally:
            engine.close()
            engine.close()

        self.assertTrue(all(socket.closed_with == 0 for socket in context.sockets))
        self.assertFalse(poller.registered)
        self.assertFalse(context.terminated, "an injected context remains owned by its caller")


if __name__ == "__main__":
    unittest.main()
