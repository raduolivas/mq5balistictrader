from __future__ import annotations

import re
import unittest
from pathlib import Path


EA_PATH = (
    Path(__file__).resolve().parents[2]
    / "mql5"
    / "Experts"
    / "ONNX_Forex_Predictor.mq5"
)


class Mql5RiskContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = EA_PATH.read_text(encoding="utf-8")

    def test_daily_equity_baseline_has_a_server_day_rollover(self) -> None:
        self.assertIn("ExtDailyEquityDay", self.source)
        self.assertIn("void ResetDailyEquityIfNeeded()", self.source)
        guards = re.search(
            r"bool PassesRiskGuards\(double spreadPips\)\s*\{(?P<body>.*?)\n\}",
            self.source,
            re.DOTALL,
        )
        self.assertIsNotNone(guards)
        self.assertIn("ResetDailyEquityIfNeeded();", guards.group("body"))

    def test_minimum_lot_is_never_forced_above_risk_size(self) -> None:
        self.assertRegex(
            self.source,
            r"if\(calculatedLots < minLot\)\s*\{[^}]*return 0\.0;\s*\}",
        )

    def test_zero_lot_skips_order_submission(self) -> None:
        self.assertIn("if(lots <= 0.0) return;", self.source)

    def test_hot_reload_rejects_invalid_values_as_one_parameter_set(self) -> None:
        self.assertIn("bool invalidValue = false;", self.source)
        self.assertIn("!MathIsValidNumber(v) || v <= 0.0", self.source)
        self.assertIn("keeping the complete previous parameter set", self.source)
        self.assertIn(
            "EffRiskPercent = MathMax(SAFETY_MIN_RISK_PERCENT",
            self.source,
        )

    def test_model_probabilities_are_validated_before_trade_branches(self) -> None:
        guard_index = self.source.index("[MODEL GUARD]")
        buy_index = self.source.index("// Long Signal")
        self.assertLess(guard_index, buy_index)
        self.assertIn("MathAbs(probabilitySum - 1.0) > 0.05", self.source)
        self.assertIn("!MathIsValidNumber(outputProbs[0])", self.source)

    def test_trade_log_uses_net_account_return_not_price_return(self) -> None:
        self.assertIn("double netProfit", self.source)
        self.assertIn("double entryCosts = 0.0;", self.source)
        self.assertIn("double entryCostShare = entryCosts *", self.source)
        self.assertIn(
            "grossProfit + commission + swap + fee + entryCostShare",
            self.source,
        )
        self.assertIn("double pnlPct = netProfit / balanceBefore;", self.source)
        self.assertIn(r'\"price_return_pct\"', self.source)


if __name__ == "__main__":
    unittest.main()
