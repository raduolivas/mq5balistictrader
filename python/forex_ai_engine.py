#!/usr/bin/env python3
"""Validated, signal-only ZeroMQ worker for MetaTrader 5 ticks.

The decisions in this module are deliberately heuristic. It does not load an
ML model and must not be presented as model inference or historical validation.
It publishes direction/confidence ``SIGNAL`` messages only; position sizing,
risk checks, and order execution must remain inside the MT5 boundary.
"""

from __future__ import annotations

import logging
import math
import os
import re
import signal as operating_system_signal
import threading
import time
from collections import deque
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Mapping, Sequence

try:
    import zmq
except ImportError:  # Pure parsing/state tests do not require the I/O dependency.
    zmq = None


logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s: %(message)s")
logger = logging.getLogger("ForexHeuristicSignalEngine")

DEFAULT_ALLOWED_SYMBOLS = frozenset(
    {
        "AUDUSD",
        "EURGBP",
        "EURJPY",
        "EURUSD",
        "GBPJPY",
        "GBPUSD",
        "NZDUSD",
        "USDCAD",
        "USDCHF",
        "USDJPY",
        "XAUUSD",
    }
)
_SYMBOL_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9._#-]{0,31}$")


def _endpoint(value: str, name: str) -> str:
    if not value.startswith("tcp://") or any(character.isspace() for character in value):
        raise ValueError(f"{name} must be a tcp:// endpoint without whitespace")
    if len(value) > 200:
        raise ValueError(f"{name} is too long")
    return value


class TickValidationError(ValueError):
    """Raised when an inbound market-data message cannot be trusted."""


def _finite_number(value: object, name: str) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a finite number")
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a finite number") from exc
    if not math.isfinite(result):
        raise ValueError(f"{name} must be a finite number")
    return result


def _environment_int(
    environment: Mapping[str, str],
    name: str,
    default: int,
    *,
    minimum: int,
    maximum: int,
) -> int:
    raw_value = environment.get(name, str(default))
    try:
        value = int(raw_value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def _environment_float(
    environment: Mapping[str, str],
    name: str,
    default: float,
    *,
    minimum: float,
    maximum: float,
) -> float:
    value = _finite_number(environment.get(name, str(default)), name)
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


@dataclass(frozen=True, slots=True)
class EngineConfig:
    """Finite, bounded runtime configuration using ``FOREX_*`` variables."""

    allowed_symbols: frozenset[str] = DEFAULT_ALLOWED_SYMBOLS
    signal_endpoint: str = "tcp://127.0.0.1:5556"
    sub_endpoint: str = "tcp://127.0.0.1:5557"
    pub_port: int = 5556
    sub_port: int = 5557
    buffer_size: int = 200
    minimum_ticks: int = 50
    confidence_threshold: float = 0.68
    cooldown_seconds: float = 60.0
    poll_timeout_ms: int = 100
    max_tick_age_ms: int = 5_000
    max_future_skew_ms: int = 1_000
    receive_hwm: int = 1_000
    send_hwm: int = 100
    error_log_interval_seconds: float = 5.0
    heartbeat_path: str = "/tmp/engine-heartbeat"
    heartbeat_interval_seconds: float = 1.0

    def __post_init__(self) -> None:
        if isinstance(self.allowed_symbols, str):
            raise ValueError("allowed_symbols must be a collection of symbols")
        symbols = frozenset(self.allowed_symbols)
        if not symbols:
            raise ValueError("allowed_symbols must not be empty")
        if any(not _SYMBOL_PATTERN.fullmatch(symbol) for symbol in symbols):
            raise ValueError("allowed_symbols contains an invalid symbol")
        object.__setattr__(self, "allowed_symbols", symbols)

        _endpoint(self.signal_endpoint, "signal_endpoint")
        _endpoint(self.sub_endpoint, "sub_endpoint")
        if not self.heartbeat_path or "\x00" in self.heartbeat_path:
            raise ValueError("heartbeat_path must be a valid non-empty path")

        for name, value in (("pub_port", self.pub_port), ("sub_port", self.sub_port)):
            if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 65_535:
                raise ValueError(f"{name} must be between 1 and 65535")
        if self.pub_port == self.sub_port:
            raise ValueError("pub_port and sub_port must be different")

        integer_bounds = {
            "buffer_size": (10, 100_000),
            "minimum_ticks": (10, 100_000),
            "poll_timeout_ms": (1, 60_000),
            "max_tick_age_ms": (1, 3_600_000),
            "max_future_skew_ms": (0, 60_000),
            "receive_hwm": (1, 1_000_000),
            "send_hwm": (1, 1_000_000),
        }
        for name, (minimum, maximum) in integer_bounds.items():
            value = getattr(self, name)
            if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
                raise ValueError(f"{name} must be between {minimum} and {maximum}")
        if self.minimum_ticks > self.buffer_size:
            raise ValueError("minimum_ticks must not exceed buffer_size")

        finite_bounds = {
            "confidence_threshold": (0.0, 1.0),
            "cooldown_seconds": (0.0, 86_400.0),
            "error_log_interval_seconds": (0.1, 3_600.0),
            "heartbeat_interval_seconds": (0.1, 60.0),
        }
        for name, (minimum, maximum) in finite_bounds.items():
            value = _finite_number(getattr(self, name), name)
            if not minimum <= value <= maximum:
                raise ValueError(f"{name} must be between {minimum} and {maximum}")
            object.__setattr__(self, name, value)

    @classmethod
    def from_env(cls, environment: Mapping[str, str] | None = None) -> "EngineConfig":
        environment = os.environ if environment is None else environment
        raw_symbols = environment.get("FOREX_ALLOWED_SYMBOLS", ",".join(sorted(DEFAULT_ALLOWED_SYMBOLS)))
        symbols = frozenset(part.strip() for part in raw_symbols.split(",") if part.strip())
        pub_port = _environment_int(environment, "FOREX_PUB_PORT", 5556, minimum=1, maximum=65_535)
        sub_port = _environment_int(environment, "FOREX_SUB_PORT", 5557, minimum=1, maximum=65_535)

        return cls(
            allowed_symbols=symbols,
            signal_endpoint=_endpoint(
                environment.get("FOREX_SIGNAL_ENDPOINT", f"tcp://127.0.0.1:{pub_port}"),
                "FOREX_SIGNAL_ENDPOINT",
            ),
            sub_endpoint=_endpoint(
                environment.get("FOREX_SUB_ENDPOINT", f"tcp://127.0.0.1:{sub_port}"),
                "FOREX_SUB_ENDPOINT",
            ),
            pub_port=pub_port,
            sub_port=sub_port,
            buffer_size=_environment_int(
                environment, "FOREX_BUFFER_SIZE", 200, minimum=10, maximum=100_000
            ),
            minimum_ticks=_environment_int(
                environment, "FOREX_MINIMUM_TICKS", 50, minimum=10, maximum=100_000
            ),
            confidence_threshold=_environment_float(
                environment,
                "FOREX_CONFIDENCE_THRESHOLD",
                0.68,
                minimum=0.0,
                maximum=1.0,
            ),
            cooldown_seconds=_environment_float(
                environment, "FOREX_COOLDOWN_SECONDS", 60.0, minimum=0.0, maximum=86_400.0
            ),
            poll_timeout_ms=_environment_int(
                environment, "FOREX_POLL_TIMEOUT_MS", 100, minimum=1, maximum=60_000
            ),
            max_tick_age_ms=_environment_int(
                environment, "FOREX_MAX_TICK_AGE_MS", 5_000, minimum=1, maximum=3_600_000
            ),
            max_future_skew_ms=_environment_int(
                environment, "FOREX_MAX_FUTURE_SKEW_MS", 1_000, minimum=0, maximum=60_000
            ),
            receive_hwm=_environment_int(
                environment, "FOREX_RCVHWM", 1_000, minimum=1, maximum=1_000_000
            ),
            send_hwm=_environment_int(
                environment, "FOREX_SNDHWM", 100, minimum=1, maximum=1_000_000
            ),
            error_log_interval_seconds=_environment_float(
                environment,
                "FOREX_ERROR_LOG_INTERVAL_SECONDS",
                5.0,
                minimum=0.1,
                maximum=3_600.0,
            ),
            heartbeat_path=environment.get("FOREX_HEARTBEAT_PATH", "/tmp/engine-heartbeat"),
            heartbeat_interval_seconds=_environment_float(
                environment,
                "FOREX_HEARTBEAT_INTERVAL_SECONDS",
                1.0,
                minimum=0.1,
                maximum=60.0,
            ),
        )


@dataclass(frozen=True, slots=True)
class Tick:
    symbol: str
    time_msc: int
    bid: float
    ask: float
    last: float
    bid_vol: float
    ask_vol: float

    def __post_init__(self) -> None:
        if not isinstance(self.symbol, str) or not _SYMBOL_PATTERN.fullmatch(self.symbol):
            raise TickValidationError("tick symbol is invalid")
        if isinstance(self.time_msc, bool) or not isinstance(self.time_msc, int) or self.time_msc <= 0:
            raise TickValidationError("tick timestamp must be a positive integer")
        for name in ("bid", "ask", "last", "bid_vol", "ask_vol"):
            try:
                value = _finite_number(getattr(self, name), name)
            except ValueError as exc:
                raise TickValidationError(str(exc)) from exc
            object.__setattr__(self, name, value)
        if self.bid <= 0 or self.ask < self.bid:
            raise TickValidationError("tick must satisfy ask >= bid > 0")
        if self.last < 0:
            raise TickValidationError("last price must not be negative")
        if self.bid_vol < 0 or self.ask_vol < 0:
            raise TickValidationError("tick volumes must not be negative")


@dataclass(frozen=True, slots=True)
class Signal:
    """A heuristic direction signal, not an order-execution result."""

    side: str
    symbol: str
    probability: float
    time_msc: int

    def __post_init__(self) -> None:
        if self.side not in {"BUY", "SELL"}:
            raise ValueError("signal side must be BUY or SELL")
        if not _SYMBOL_PATTERN.fullmatch(self.symbol):
            raise ValueError("signal symbol is invalid")
        probability = _finite_number(self.probability, "probability")
        if not 0.0 <= probability <= 1.0:
            raise ValueError("probability must be between zero and one")
        object.__setattr__(self, "probability", probability)
        if isinstance(self.time_msc, bool) or not isinstance(self.time_msc, int) or self.time_msc <= 0:
            raise ValueError("signal timestamp must be a positive integer")

    def to_message(self) -> str:
        """Serialize intent without volume, stop, target, or execution authority."""

        return f"SIGNAL|{self.side}|{self.symbol}|{self.probability:.6f}|{self.time_msc}"


@dataclass(frozen=True, slots=True)
class Features:
    order_flow_imbalance: float
    spread_zscore: float
    volatility: float


def parse_tick(
    message: str,
    now_ms: int,
    *,
    allowed_symbols: frozenset[str] | set[str] | None = None,
    max_tick_age_ms: int = 5_000,
    max_future_skew_ms: int = 1_000,
) -> Tick:
    """Parse and validate one exact gateway ``TICK`` message."""

    if not isinstance(message, str):
        raise TickValidationError("tick message must be text")
    parts = message.split("|")
    if len(parts) != 8:
        raise TickValidationError("tick message must contain exactly 8 fields")
    if any(part != part.strip() for part in parts):
        raise TickValidationError("tick fields must not contain surrounding whitespace")
    kind, symbol, time_text, bid_text, ask_text, last_text, bid_vol_text, ask_vol_text = parts
    if kind != "TICK":
        raise TickValidationError("unsupported message type")

    symbols = DEFAULT_ALLOWED_SYMBOLS if allowed_symbols is None else frozenset(allowed_symbols)
    if symbol not in symbols:
        raise TickValidationError("tick symbol is not allowlisted")
    if not time_text.isascii() or not time_text.isdecimal():
        raise TickValidationError("tick timestamp must be an unsigned integer")

    if isinstance(now_ms, bool) or not isinstance(now_ms, int) or now_ms <= 0:
        raise TickValidationError("current timestamp must be a positive integer")
    if (
        isinstance(max_tick_age_ms, bool)
        or not isinstance(max_tick_age_ms, int)
        or max_tick_age_ms <= 0
    ):
        raise TickValidationError("maximum tick age must be a positive integer")
    if (
        isinstance(max_future_skew_ms, bool)
        or not isinstance(max_future_skew_ms, int)
        or max_future_skew_ms < 0
    ):
        raise TickValidationError("future skew must be a non-negative integer")

    try:
        tick = Tick(
            symbol=symbol,
            time_msc=int(time_text),
            bid=float(bid_text),
            ask=float(ask_text),
            last=float(last_text),
            bid_vol=float(bid_vol_text),
            ask_vol=float(ask_vol_text),
        )
    except (TypeError, ValueError) as exc:
        if isinstance(exc, TickValidationError):
            raise
        raise TickValidationError("tick contains an invalid numeric field") from exc

    age_ms = now_ms - tick.time_msc
    if age_ms > max_tick_age_ms:
        raise TickValidationError("tick is stale")
    if age_ms < -max_future_skew_ms:
        raise TickValidationError("tick timestamp is too far in the future")
    return tick


class SymbolState:
    """Bounded tick history and signal cooldown for exactly one symbol."""

    def __init__(
        self,
        *,
        buffer_size: int = 200,
        minimum_ticks: int = 50,
        confidence_threshold: float = 0.68,
        cooldown_seconds: float = 60.0,
    ) -> None:
        if isinstance(buffer_size, bool) or not isinstance(buffer_size, int) or buffer_size < 2:
            raise ValueError("buffer_size must be an integer of at least 2")
        if (
            isinstance(minimum_ticks, bool)
            or not isinstance(minimum_ticks, int)
            or not 2 <= minimum_ticks <= buffer_size
        ):
            raise ValueError("minimum_ticks must be between 2 and buffer_size")
        confidence_threshold = _finite_number(confidence_threshold, "confidence_threshold")
        cooldown_seconds = _finite_number(cooldown_seconds, "cooldown_seconds")
        if not 0.0 <= confidence_threshold <= 1.0:
            raise ValueError("confidence_threshold must be between zero and one")
        if cooldown_seconds < 0:
            raise ValueError("cooldown_seconds must not be negative")

        self.tick_buffer: deque[Tick] = deque(maxlen=buffer_size)
        self.minimum_ticks = minimum_ticks
        self.confidence_threshold = confidence_threshold
        self.cooldown_seconds = cooldown_seconds
        self.last_exchange_timestamp: int | None = None
        self.last_signal_monotonic: float | None = None
        self._last_monotonic: float | None = None
        self._symbol: str | None = None

    @staticmethod
    def compute_features(ticks: Sequence[Tick]) -> Features:
        if len(ticks) < 2:
            raise ValueError("at least two ticks are required")

        previous, current = ticks[-2], ticks[-1]
        delta_bid_vol = current.bid_vol - previous.bid_vol
        delta_ask_vol = current.ask_vol - previous.ask_vol
        denominator = abs(delta_bid_vol) + abs(delta_ask_vol) + 1e-6
        order_flow_imbalance = (delta_bid_vol - delta_ask_vol) / denominator

        spreads = [(tick.ask - tick.bid) * 10_000.0 for tick in ticks]
        spread_mean = sum(spreads) / len(spreads)
        spread_variance = sum((spread - spread_mean) ** 2 for spread in spreads) / len(spreads)
        spread_zscore = (spreads[-1] - spread_mean) / (math.sqrt(spread_variance) + 1e-6)

        midpoints = [(tick.bid + tick.ask) * 0.5 for tick in ticks]
        returns = [math.log(current_mid / prior_mid) for prior_mid, current_mid in zip(midpoints, midpoints[1:])]
        if len(returns) > 5:
            return_mean = sum(returns) / len(returns)
            return_variance = sum((value - return_mean) ** 2 for value in returns) / len(returns)
            volatility = math.sqrt(return_variance)
        else:
            volatility = 0.0001

        return Features(order_flow_imbalance, spread_zscore, volatility)

    def on_tick(self, tick: Tick, monotonic_now: float) -> Signal | None:
        monotonic_now = _finite_number(monotonic_now, "monotonic_now")
        if monotonic_now < 0:
            raise TickValidationError("monotonic time must not be negative")
        if self._last_monotonic is not None and monotonic_now < self._last_monotonic:
            raise TickValidationError("monotonic time moved backwards")
        if self._symbol is not None and tick.symbol != self._symbol:
            raise TickValidationError("symbol state cannot mix symbols")
        if self.last_exchange_timestamp is not None and tick.time_msc <= self.last_exchange_timestamp:
            raise TickValidationError("tick timestamp is out of order")

        self._symbol = tick.symbol
        self._last_monotonic = monotonic_now
        self.last_exchange_timestamp = tick.time_msc
        self.tick_buffer.append(tick)
        if len(self.tick_buffer) < self.minimum_ticks:
            return None

        features = self.compute_features(self.tick_buffer)
        if (
            self.last_signal_monotonic is not None
            and monotonic_now - self.last_signal_monotonic <= self.cooldown_seconds
        ):
            return None

        if features.order_flow_imbalance > 0.6:
            probability = 0.72
            side = "BUY"
        elif features.order_flow_imbalance < -0.6:
            probability = 0.70
            side = "SELL"
        else:
            return None

        if probability <= self.confidence_threshold:
            return None
        self.last_signal_monotonic = monotonic_now
        return Signal(side, tick.symbol, probability, tick.time_msc)


class ForexStrategyEngine:
    """Poll-based ZeroMQ transport around isolated heuristic symbol states."""

    def __init__(
        self,
        pub_port: int | None = None,
        sub_port: int | None = None,
        *,
        config: EngineConfig | None = None,
        context: object | None = None,
        poller: object | None = None,
        zmq_module: object | None = None,
    ) -> None:
        config = EngineConfig.from_env() if config is None else config
        if pub_port is not None:
            config = replace(
                config,
                pub_port=pub_port,
                signal_endpoint=f"tcp://127.0.0.1:{pub_port}",
            )
        if sub_port is not None:
            config = replace(
                config,
                sub_port=sub_port,
                sub_endpoint=f"tcp://127.0.0.1:{sub_port}",
            )
        self.config = config

        self._zmq = zmq if zmq_module is None else zmq_module
        if self._zmq is None:
            raise RuntimeError("pyzmq is required to run the ZeroMQ signal engine")

        self._owns_context = context is None
        self.context = self._zmq.Context() if context is None else context
        self.sub_socket = self.context.socket(self._zmq.SUB)
        self.sub_socket.setsockopt(self._zmq.RCVHWM, config.receive_hwm)
        self.sub_socket.setsockopt(self._zmq.LINGER, 0)
        self.sub_socket.setsockopt_string(self._zmq.SUBSCRIBE, "TICK|")
        self.sub_socket.connect(config.sub_endpoint)

        self.signal_socket = self.context.socket(self._zmq.PUSH)
        self.signal_socket.setsockopt(self._zmq.SNDHWM, config.send_hwm)
        self.signal_socket.setsockopt(self._zmq.LINGER, 0)
        self.signal_socket.connect(config.signal_endpoint)

        self.poller = self._zmq.Poller() if poller is None else poller
        self.poller.register(self.sub_socket, self._zmq.POLLIN)
        self.states = {symbol: self._new_state() for symbol in config.allowed_symbols}
        self.stop_event = threading.Event()
        self._closed = False
        self._last_log_times: dict[str, float] = {}
        self._suppressed_logs: dict[str, int] = {}
        self._last_heartbeat_monotonic = 0.0
        self._write_heartbeat(force=True)

        logger.info(
            "Heuristic signal engine connected SUB %s and PUSH %s",
            config.sub_endpoint,
            config.signal_endpoint,
        )

    def _new_state(self) -> SymbolState:
        return SymbolState(
            buffer_size=self.config.buffer_size,
            minimum_ticks=self.config.minimum_ticks,
            confidence_threshold=self.config.confidence_threshold,
            cooldown_seconds=self.config.cooldown_seconds,
        )

    def state_for(self, symbol: str) -> SymbolState:
        if symbol not in self.config.allowed_symbols:
            raise TickValidationError("tick symbol is not allowlisted")
        return self.states[symbol]

    def handle_message(
        self,
        message: str,
        *,
        now_ms: int | None = None,
        monotonic_now: float | None = None,
    ) -> Signal | None:
        now_ms = time.time_ns() // 1_000_000 if now_ms is None else now_ms
        monotonic_now = time.monotonic() if monotonic_now is None else monotonic_now
        tick = parse_tick(
            message,
            now_ms,
            allowed_symbols=self.config.allowed_symbols,
            max_tick_age_ms=self.config.max_tick_age_ms,
            max_future_skew_ms=self.config.max_future_skew_ms,
        )
        return self.state_for(tick.symbol).on_tick(tick, monotonic_now)

    def _log_bounded(self, key: str, level: int, message: str, *args: object) -> None:
        current = time.monotonic()
        previous = self._last_log_times.get(key)
        if previous is not None and current - previous < self.config.error_log_interval_seconds:
            self._suppressed_logs[key] = self._suppressed_logs.get(key, 0) + 1
            return
        suppressed = self._suppressed_logs.pop(key, 0)
        self._last_log_times[key] = current
        if suppressed:
            message = f"{message} (suppressed {suppressed} similar messages)"
        logger.log(level, message, *args)

    def _write_heartbeat(self, *, force: bool = False) -> None:
        current = time.monotonic()
        if (
            not force
            and current - self._last_heartbeat_monotonic
            < self.config.heartbeat_interval_seconds
        ):
            return
        destination = Path(self.config.heartbeat_path)
        temporary = destination.with_name(f".{destination.name}.{os.getpid()}.tmp")
        temporary.write_text(f"{time.time_ns()}\n", encoding="ascii")
        os.replace(temporary, destination)
        self._last_heartbeat_monotonic = current

    def run(self) -> None:
        logger.info("Starting poll-based heuristic tick consumption loop")
        try:
            while not self.stop_event.is_set():
                events = dict(self.poller.poll(self.config.poll_timeout_ms))
                self._write_heartbeat()
                if not events.get(self.sub_socket, 0) & self._zmq.POLLIN:
                    continue
                try:
                    message = self.sub_socket.recv_string()
                    heuristic_signal = self.handle_message(message)
                    if heuristic_signal is not None:
                        try:
                            self.signal_socket.send_string(
                                heuristic_signal.to_message(), flags=self._zmq.NOBLOCK
                            )
                        except self._zmq.Again:
                            self._log_bounded(
                                "dropped-signal",
                                logging.WARNING,
                                "Dropped signal because the bridge is unavailable",
                            )
                            continue
                        logger.info(
                            "Heuristic signal transmitted: %s %s Confidence: %.2f",
                            heuristic_signal.side,
                            heuristic_signal.symbol,
                            heuristic_signal.probability,
                        )
                except TickValidationError as exc:
                    self._log_bounded("rejected-tick", logging.WARNING, "Rejected tick: %s", exc)
                except Exception as exc:
                    self._log_bounded("runtime-error", logging.ERROR, "Signal loop error: %s", exc)
        except KeyboardInterrupt:
            logger.info("Keyboard interrupt received; stopping heuristic signal engine")
        finally:
            self.close()

    def request_stop(self) -> None:
        self.stop_event.set()

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self.stop_event.set()
        try:
            self.poller.unregister(self.sub_socket)
        except (KeyError, ValueError):
            pass
        self.sub_socket.close(linger=0)
        self.signal_socket.close(linger=0)
        if self._owns_context:
            self.context.term()
        logger.info("Heuristic signal engine shut down cleanly")


def main() -> None:
    engine = ForexStrategyEngine()

    def stop_engine(_signum: int, _frame: object) -> None:
        engine.request_stop()

    operating_system_signal.signal(operating_system_signal.SIGINT, stop_engine)
    operating_system_signal.signal(operating_system_signal.SIGTERM, stop_engine)
    engine.run()


if __name__ == "__main__":
    main()
