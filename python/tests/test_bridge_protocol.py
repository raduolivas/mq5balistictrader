from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path


PYTHON_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PYTHON_DIR))

from bridge_protocol import (  # noqa: E402
    MAX_FRAME_BYTES,
    ProtocolError,
    error_frame,
    is_health_frame,
    parse_ack,
    parse_hello,
    parse_signal,
    parse_tick,
    ready_frame,
)


ALLOWED = frozenset({"EURUSD", "GBPUSD"})


class BridgeProtocolTests(unittest.TestCase):
    def test_parses_and_serializes_all_routed_frames(self) -> None:
        hello = parse_hello("HELLO|1|EURUSD|889900\n", ALLOWED)
        tick = parse_tick("TICK|EURUSD|10000|1.1|1.1002|1.1001|12|9", ALLOWED)
        signal = parse_signal("SIGNAL|BUY|EURUSD|0.72|10000", ALLOWED)
        ack = parse_ack("ACK|EURUSD|10000|ACCEPTED", ALLOWED)

        self.assertEqual(hello.to_wire(), "HELLO|1|EURUSD|889900")
        self.assertEqual(tick.to_wire(), "TICK|EURUSD|10000|1.1|1.1002|1.1001|12|9")
        self.assertEqual(signal.to_wire(), "SIGNAL|BUY|EURUSD|0.720000|10000")
        self.assertEqual(ack.to_wire(), "ACK|EURUSD|10000|ACCEPTED")
        self.assertEqual(ready_frame("EURUSD", ALLOWED), "READY|1|EURUSD")

    def test_health_and_safe_error_frames(self) -> None:
        self.assertTrue(is_health_frame(b"HEALTH\n"))
        self.assertEqual(error_frame("INVALID_FRAME"), "ERROR|INVALID_FRAME")
        self.assertEqual(error_frame("bad value"), "ERROR|PROTOCOL_ERROR")

    def test_rejects_wrong_shapes_versions_symbols_and_ranges(self) -> None:
        invalid_calls = (
            (parse_hello, "HELLO|2|EURUSD|1"),
            (parse_hello, "HELLO|1|XAUUSD|1"),
            (parse_hello, "HELLO|1|EURUSD|0"),
            (parse_tick, "TICK|EURUSD|1|1.2|1.1|1.1|1|1"),
            (parse_tick, "TICK|EURUSD|1|nan|1.1|1.1|1|1"),
            (parse_tick, "TICK|EURUSD|1|1|1.1|1|-1|1"),
            (parse_signal, "SIGNAL|HOLD|EURUSD|0.7|1"),
            (parse_signal, "SIGNAL|BUY|EURUSD|1.1|1"),
            (parse_signal, "SIGNAL|BUY|EURUSD|nan|1"),
            (parse_ack, "ACK|EURUSD|1|bad status"),
        )
        for parser, value in invalid_calls:
            with self.subTest(value=value), self.assertRaises(ProtocolError):
                parser(value, ALLOWED)

    def test_rejects_oversize_multiframe_nul_and_invalid_utf8(self) -> None:
        invalid = (
            "X" * (MAX_FRAME_BYTES + 1),
            "HEALTH\nHEALTH",
            "HEALTH\x00",
            b"\xff",
        )
        for value in invalid:
            with self.subTest(value=repr(value)), self.assertRaises(ProtocolError):
                is_health_frame(value)

    def test_non_finite_values_are_never_accepted(self) -> None:
        for value in ("nan", "inf", "-inf"):
            with self.subTest(value=value), self.assertRaises(ProtocolError):
                parse_signal(f"SIGNAL|SELL|EURUSD|{value}|100", ALLOWED)
        self.assertTrue(math.isfinite(parse_signal("SIGNAL|SELL|EURUSD|0|100", ALLOWED).probability))


if __name__ == "__main__":
    unittest.main()

