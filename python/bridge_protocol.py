#!/usr/bin/env python3
"""Strict wire protocol shared by the MT5 TCP bridge and its tests."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Collection


PROTOCOL_VERSION = 1
MAX_FRAME_BYTES = 512
_SYMBOL_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9._#-]{0,31}$")
_STATUS_PATTERN = re.compile(r"^[A-Z][A-Z0-9_-]{0,31}$")


class ProtocolError(ValueError):
    """Raised when a wire frame is malformed or outside the trust boundary."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code


def _frame(value: str | bytes) -> str:
    if isinstance(value, bytes):
        try:
            raw = value.decode("utf-8", errors="strict")
        except UnicodeDecodeError as exc:
            raise ProtocolError("INVALID_ENCODING", "frame must be valid UTF-8") from exc
    elif isinstance(value, str):
        raw = value
    else:
        raise ProtocolError("INVALID_TYPE", "frame must be text or bytes")

    encoded = raw.encode("utf-8")
    if len(encoded) > MAX_FRAME_BYTES:
        raise ProtocolError("FRAME_TOO_LARGE", "frame exceeds 512 bytes")
    if "\x00" in raw:
        raise ProtocolError("INVALID_CHARACTER", "frame contains a NUL byte")
    raw = raw.removesuffix("\n").removesuffix("\r")
    if "\n" in raw or "\r" in raw:
        raise ProtocolError("MULTIPLE_FRAMES", "one parser call must contain one frame")
    if not raw:
        raise ProtocolError("EMPTY_FRAME", "frame must not be empty")
    return raw


def _symbol(value: str, allowed_symbols: Collection[str]) -> str:
    if not _SYMBOL_PATTERN.fullmatch(value):
        raise ProtocolError("INVALID_SYMBOL", "symbol syntax is invalid")
    if value not in allowed_symbols:
        raise ProtocolError("SYMBOL_NOT_ALLOWED", "symbol is not allowlisted")
    return value


def _positive_int(value: str, field: str) -> int:
    try:
        result = int(value)
    except ValueError as exc:
        raise ProtocolError("INVALID_INTEGER", f"{field} must be an integer") from exc
    if result <= 0:
        raise ProtocolError("INVALID_INTEGER", f"{field} must be positive")
    return result


def _finite_float(value: str, field: str) -> float:
    try:
        result = float(value)
    except ValueError as exc:
        raise ProtocolError("INVALID_NUMBER", f"{field} must be numeric") from exc
    if not math.isfinite(result):
        raise ProtocolError("INVALID_NUMBER", f"{field} must be finite")
    return result


@dataclass(frozen=True, slots=True)
class Hello:
    symbol: str
    magic: int
    version: int = PROTOCOL_VERSION

    def to_wire(self) -> str:
        return f"HELLO|{self.version}|{self.symbol}|{self.magic}"


@dataclass(frozen=True, slots=True)
class TickFrame:
    symbol: str
    time_msc: int
    bid: float
    ask: float
    last: float
    bid_vol: float
    ask_vol: float

    def __post_init__(self) -> None:
        if self.ask < self.bid or self.bid <= 0 or self.last < 0:
            raise ProtocolError("INVALID_MARKET", "tick prices are inconsistent")
        if self.bid_vol < 0 or self.ask_vol < 0:
            raise ProtocolError("INVALID_MARKET", "tick volumes must not be negative")

    def to_wire(self) -> str:
        return (
            f"TICK|{self.symbol}|{self.time_msc}|{self.bid:.10g}|{self.ask:.10g}|"
            f"{self.last:.10g}|{self.bid_vol:.10g}|{self.ask_vol:.10g}"
        )


@dataclass(frozen=True, slots=True)
class SignalFrame:
    side: str
    symbol: str
    probability: float
    time_msc: int

    def to_wire(self) -> str:
        return f"SIGNAL|{self.side}|{self.symbol}|{self.probability:.6f}|{self.time_msc}"


@dataclass(frozen=True, slots=True)
class Ack:
    symbol: str
    time_msc: int
    status: str

    def to_wire(self) -> str:
        return f"ACK|{self.symbol}|{self.time_msc}|{self.status}"


def parse_hello(value: str | bytes, allowed_symbols: Collection[str]) -> Hello:
    parts = _frame(value).split("|")
    if len(parts) != 4 or parts[0] != "HELLO":
        raise ProtocolError("EXPECTED_HELLO", "expected HELLO|version|symbol|magic")
    version = _positive_int(parts[1], "version")
    if version != PROTOCOL_VERSION:
        raise ProtocolError("UNSUPPORTED_VERSION", "protocol version is unsupported")
    symbol = _symbol(parts[2], allowed_symbols)
    magic = _positive_int(parts[3], "magic")
    if magic > 2_147_483_647:
        raise ProtocolError("INVALID_INTEGER", "magic exceeds signed 32-bit range")
    return Hello(symbol=symbol, magic=magic, version=version)


def parse_tick(value: str | bytes, allowed_symbols: Collection[str]) -> TickFrame:
    parts = _frame(value).split("|")
    if len(parts) != 8 or parts[0] != "TICK":
        raise ProtocolError("EXPECTED_TICK", "expected an eight-field TICK frame")
    tick = TickFrame(
        symbol=_symbol(parts[1], allowed_symbols),
        time_msc=_positive_int(parts[2], "time_msc"),
        bid=_finite_float(parts[3], "bid"),
        ask=_finite_float(parts[4], "ask"),
        last=_finite_float(parts[5], "last"),
        bid_vol=_finite_float(parts[6], "bid_vol"),
        ask_vol=_finite_float(parts[7], "ask_vol"),
    )
    return tick


def parse_signal(value: str | bytes, allowed_symbols: Collection[str]) -> SignalFrame:
    parts = _frame(value).split("|")
    if len(parts) != 5 or parts[0] != "SIGNAL":
        raise ProtocolError("EXPECTED_SIGNAL", "expected a five-field SIGNAL frame")
    side = parts[1]
    if side not in {"BUY", "SELL"}:
        raise ProtocolError("INVALID_SIDE", "signal side must be BUY or SELL")
    probability = _finite_float(parts[3], "probability")
    if not 0.0 <= probability <= 1.0:
        raise ProtocolError("INVALID_PROBABILITY", "probability must be in [0, 1]")
    return SignalFrame(
        side=side,
        symbol=_symbol(parts[2], allowed_symbols),
        probability=probability,
        time_msc=_positive_int(parts[4], "time_msc"),
    )


def parse_ack(value: str | bytes, allowed_symbols: Collection[str]) -> Ack:
    parts = _frame(value).split("|")
    if len(parts) != 4 or parts[0] != "ACK":
        raise ProtocolError("EXPECTED_ACK", "expected ACK|symbol|time_msc|status")
    status = parts[3]
    if not _STATUS_PATTERN.fullmatch(status):
        raise ProtocolError("INVALID_STATUS", "acknowledgement status is invalid")
    return Ack(
        symbol=_symbol(parts[1], allowed_symbols),
        time_msc=_positive_int(parts[2], "time_msc"),
        status=status,
    )


def ready_frame(symbol: str, allowed_symbols: Collection[str]) -> str:
    return f"READY|{PROTOCOL_VERSION}|{_symbol(symbol, allowed_symbols)}"


def error_frame(code: str) -> str:
    if not _STATUS_PATTERN.fullmatch(code):
        code = "PROTOCOL_ERROR"
    return f"ERROR|{code}"


def is_health_frame(value: str | bytes) -> bool:
    return _frame(value) == "HEALTH"

