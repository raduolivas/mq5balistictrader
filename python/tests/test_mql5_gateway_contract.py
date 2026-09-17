from __future__ import annotations

import re
import unittest
from pathlib import Path


EA_PATH = Path(__file__).resolve().parents[2] / "mql5" / "Experts" / "ZeroMQ_Forex_Gateway.mq5"


class Mql5GatewayContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = EA_PATH.read_text(encoding="utf-8")

    def test_uses_native_tcp_with_handshake_and_partial_frame_buffer(self) -> None:
        for token in ("SocketCreate()", "SocketConnect(", "SocketSend(", "SocketRead("):
            self.assertIn(token, self.source)
        self.assertIn('"HELLO|1|%s|%d"', self.source)
        self.assertIn('"READY|1|" + InpSymbol', self.source)
        self.assertIn("ExtReceiveBuffer +=", self.source)
        self.assertIn('StringFind(ExtReceiveBuffer, "\\n")', self.source)

    def test_execution_and_real_account_are_both_opt_in(self) -> None:
        self.assertRegex(self.source, r"input bool\s+InpExecutionEnabled\s*= false;")
        self.assertRegex(self.source, r"input bool\s+InpAllowRealAccount\s*= false;")
        self.assertIn("if(!InpExecutionEnabled)", self.source)
        self.assertIn("mode == ACCOUNT_TRADE_MODE_REAL && !InpAllowRealAccount", self.source)

    def test_rejects_replay_stale_future_and_low_confidence_signals(self) -> None:
        self.assertIn("signalTimeMsc <= ExtLastSignalTimeMsc", self.source)
        self.assertIn("signalAge > (long)InpSignalTtlMilliseconds", self.source)
        self.assertIn("signalAge < -(long)InpMaxFutureSkewMs", self.source)
        self.assertIn("probability < InpMinimumProbability", self.source)
        for status in ("REPLAY_REJECTED", "STALE_REJECTED", "CONFIDENCE_REJECTED"):
            self.assertIn(status, self.source)

    def test_python_signal_cannot_control_lots_or_stops(self) -> None:
        signal_parser = re.search(
            r"void HandleSignal\(const string line\)\s*\{(?P<body>.*?)\n\}",
            self.source,
            re.DOTALL,
        )
        self.assertIsNotNone(signal_parser)
        body = signal_parser.group("body")
        self.assertIn("count != 5", body)
        self.assertIn("CalculateLotSize(orderType, entry, stop)", body)
        self.assertIn("atrValues[0] * InpAtrStopMultiplier", body)

    def test_risk_size_rounds_down_and_never_forces_broker_minimum(self) -> None:
        self.assertIn("OrderCalcProfit(", self.source)
        self.assertIn("MathFloor((riskMoney / lossForOneLot) / lotStep) * lotStep", self.source)
        self.assertIn("if(calculatedLots < minLot) return 0.0;", self.source)
        self.assertIn("if(lots <= 0.0)", self.source)

    def test_spread_drawdown_exposure_atr_and_broker_stops_are_guarded(self) -> None:
        for token in (
            "spreadPips > InpMaxSpreadPips",
            "InpMaxDailyDrawdownPct",
            "HasManagedPosition()",
            "CopyBuffer(ExtAtrHandle",
            "SYMBOL_TRADE_STOPS_LEVEL",
        ):
            self.assertIn(token, self.source)


if __name__ == "__main__":
    unittest.main()

