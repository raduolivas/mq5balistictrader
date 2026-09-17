#!/usr/bin/env python3
"""
Forex Regime Classifier Training & ONNX Exporter
Trains a real LightGBM multiclass model on historical EURUSD bars and exports it
to model_forex_regime.onnx for native MT5 OnnxRun() in-process execution.

Replaces the previous placeholder that exported an untrained (randomly-initialized
or hand-typed) model without ever fitting on data.
"""
import os
import sys

import numpy as np
import pandas as pd
import yfinance as yf
from lightgbm import LGBMClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix

# ============================================================================
# Config — kept explicit and adjustable rather than buried in code.
# ============================================================================
SYMBOL = "EURUSD=X"          # yfinance ticker (change for other pairs)
INTERVAL = "5m"              # matches the EA's ATR timeframe (PERIOD_M5)
PERIOD = "60d"                # max intraday history yfinance serves at 5m
ATR_WINDOW = 14               # matches InpAtrStopMultiplier's ATR(14) in the EA
ATR_LAG_BARS = 2              # EA compares atrValues[0] vs atrValues[2]
MID_DEV_WINDOW = 20            # short rolling window standing in for tick mid-price
ASSUMED_MAX_SPREAD_PIPS = 2.0  # yfinance has no bid/ask; used only to normalize
PIP_SIZE = 0.0001              # EURUSD pip size (5-digit broker: 10 * point)
LABEL_HORIZON_BARS = 12        # ~1 hour ahead on 5m bars
LABEL_QUANTILE = 0.30          # bottom/top 30% of forward returns -> Short/Long, middle 40% -> Neutral
HOLDOUT_FRACTION = 0.2         # chronological holdout, no shuffling
CLASS_NAMES = ["Short", "Neutral", "Long"]  # index 0,1,2 — matches EA's outputProbs[0]=pShort, [2]=pLong

MODEL_OUT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "model_forex_regime.onnx")


def fetch_bars() -> pd.DataFrame:
    print(f"[INFO] Downloading {SYMBOL} {INTERVAL} bars, period={PERIOD}...")
    df = yf.download(SYMBOL, period=PERIOD, interval=INTERVAL, progress=False, auto_adjust=True)
    if df.empty:
        raise RuntimeError(f"No data returned for {SYMBOL} — check ticker/interval/period.")
    df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
    df = df.rename(columns=str.lower)
    df.index = pd.to_datetime(df.index)
    print(f"[INFO] Got {len(df)} bars from {df.index[0]} to {df.index[-1]}")
    return df


def compute_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Approximates the 5 live features ONNX_Forex_Predictor.mq5 computes on every tick
    (OnTick(), lines 190-202), using what's derivable from OHLC bars instead of raw
    ticks. Two features (OFI/tick-bias, spread norm) are necessarily approximations
    since yfinance forex data has no bid/ask or per-tick volume; ATR expansion and
    session phase use the *same* formulas as the EA.
    """
    out = pd.DataFrame(index=df.index)

    # Feature 0: OFI / tick bias proxy — EA uses per-tick +1/-1 direction flags;
    # closest bar-level analogue is the sign of the bar-over-bar close move.
    close_diff = df["close"].diff()
    out["ofi"] = np.sign(close_diff).fillna(0.0)

    # Feature 1: Spread norm — EA uses live bid/ask spread; approximated here from
    # intrabar range (high-low) as a friction/volatility proxy, normalized the same
    # way (min(2.0, x / assumed_max_spread_pips)).
    spread_pips_proxy = (df["high"] - df["low"]) / PIP_SIZE
    out["spread_norm"] = (spread_pips_proxy / ASSUMED_MAX_SPREAD_PIPS).clip(upper=2.0)

    # Feature 2: ATR expansion — real ATR(14), same ratio the EA computes
    # (current ATR / ATR from ATR_LAG_BARS ago).
    high, low, prev_close = df["high"], df["low"], df["close"].shift(1)
    true_range = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)
    atr = true_range.rolling(ATR_WINDOW).mean()
    out["atr_expansion"] = atr / (atr.shift(ATR_LAG_BARS) + 1e-6)

    # Feature 3: Mid-price deviation — EA measures ask vs instantaneous tick
    # midpoint; approximated here as close vs. a short rolling mean, normalized
    # by pip size the same way (point * 10).
    rolling_mid = df["close"].rolling(MID_DEV_WINDOW).mean()
    out["mid_dev"] = (df["close"] - rolling_mid) / (PIP_SIZE + 1e-6)

    # Feature 4: Session phase — identical formula to the EA
    # (sin of time-of-day fraction, 2*pi period).
    seconds_of_day = (out.index.hour * 3600 + out.index.minute * 60 + out.index.second)
    out["session_phase"] = np.sin(seconds_of_day / 86400.0 * 2.0 * np.pi)

    return out


def compute_forward_returns(df: pd.DataFrame) -> pd.Series:
    """Forward return over LABEL_HORIZON_BARS — the raw signal labels are derived
    from. Not yet binned into classes (see label_from_returns)."""
    return df["close"].shift(-LABEL_HORIZON_BARS) / df["close"] - 1.0


def label_from_returns(fwd_return: pd.Series, low_thresh: float, high_thresh: float) -> pd.Series:
    """Bins forward returns into Short(0)/Neutral(1)/Long(2) using fixed thresholds.
    Thresholds are computed from TRAINING data only (see build_dataset) and then
    applied uniformly, so the holdout split never leaks its own return distribution
    into how classes are defined."""
    labels = pd.Series(1, index=fwd_return.index)  # default Neutral
    labels[fwd_return >= high_thresh] = 2   # Long
    labels[fwd_return <= low_thresh] = 0    # Short
    labels[fwd_return.isna()] = np.nan
    return labels


def build_dataset():
    df = fetch_bars()
    features = compute_features(df)
    fwd_return = compute_forward_returns(df)

    data = features.copy()
    data["fwd_return"] = fwd_return
    data = data.dropna()
    print(f"[INFO] {len(data)} usable rows after feature/label warmup + horizon trim")

    feature_cols = ["ofi", "spread_norm", "atr_expansion", "mid_dev", "session_phase"]

    # Chronological split FIRST (on raw returns), then derive quantile thresholds
    # from the training slice only — avoids leaking holdout-period return
    # distribution into how classes get defined.
    split_idx = int(len(data) * (1 - HOLDOUT_FRACTION))
    train_returns = data["fwd_return"].iloc[:split_idx]
    low_thresh = train_returns.quantile(LABEL_QUANTILE)
    high_thresh = train_returns.quantile(1 - LABEL_QUANTILE)
    print(f"[INFO] Label thresholds from training data: Short <= {low_thresh:.5f}, "
          f"Long >= {high_thresh:.5f} (quantile={LABEL_QUANTILE})")

    data["label"] = label_from_returns(data["fwd_return"], low_thresh, high_thresh)
    print(f"[INFO] Label distribution:\n{data['label'].value_counts().sort_index()}")

    X = data[feature_cols].astype(np.float32).values
    y = data["label"].astype(int).values
    return X, y, feature_cols, split_idx


def chronological_split(X, y, split_idx):
    return X[:split_idx], X[split_idx:], y[:split_idx], y[split_idx:]


def train_model(X_train, y_train):
    print("[INFO] Training LightGBM multiclass classifier...")
    model = LGBMClassifier(
        objective="multiclass",
        num_class=3,
        n_estimators=200,
        max_depth=5,
        learning_rate=0.05,
        min_child_samples=30,
        class_weight="balanced",
        verbosity=-1,
    )
    model.fit(X_train, y_train)
    return model


def evaluate(model, X_val, y_val):
    preds = model.predict(X_val)
    acc = accuracy_score(y_val, preds)
    print(f"\n[RESULTS] Holdout accuracy: {acc:.4f}  (chance baseline: {1/3:.4f})")
    print("\n[RESULTS] Classification report:")
    print(classification_report(y_val, preds, target_names=CLASS_NAMES, zero_division=0))
    print("[RESULTS] Confusion matrix (rows=true, cols=pred):")
    print(pd.DataFrame(confusion_matrix(y_val, preds), index=CLASS_NAMES, columns=CLASS_NAMES))
    return acc


def export_onnx(model, feature_cols):
    import onnx
    from onnxmltools import convert_lightgbm
    from onnxmltools.convert.common.data_types import FloatTensorType

    print("\n[INFO] Converting to ONNX...")
    initial_type = [("input_features", FloatTensorType([1, len(feature_cols)]))]
    onnx_model = convert_lightgbm(
        model,
        initial_types=initial_type,
        zipmap=False,  # plain float tensor output, not a ZipMap — MQL5 OnnxRun needs a flat [1,3] tensor
    )

    graph = onnx_model.graph
    # onnxmltools emits [label, probabilities] outputs for a classifier; MQL5's EA
    # only wants the [1,3] probability tensor at output index 0 (ExtShapeOut).
    prob_output = None
    for o in graph.output:
        shape_dims = [d.dim_value for d in o.type.tensor_type.shape.dim]
        if len(shape_dims) == 2 and shape_dims[1] == 3:
            prob_output = o
            break
    if prob_output is None:
        raise RuntimeError("Could not locate the [1,3] probability output in the converted graph.")

    original_prob_name = prob_output.name
    del graph.output[:]
    graph.output.append(prob_output)
    graph.output[0].name = "probabilities"
    # Rewrite the producing node's output name to match.
    for node in graph.node:
        for i, out_name in enumerate(node.output):
            if out_name == original_prob_name:
                node.output[i] = "probabilities"

    # Pin the batch dimension to 1 on both input and output — onnxmltools leaves it
    # dynamic by default, but MQL5's OnnxRun always calls with a single sample, and
    # OnnxSetInputShape/OnnxSetOutputShape on the EA side expect fixed {1,5}/{1,3}.
    graph.input[0].type.tensor_type.shape.dim[0].dim_value = 1
    graph.input[0].type.tensor_type.shape.dim[0].ClearField("dim_param")
    graph.output[0].type.tensor_type.shape.dim[0].dim_value = 1
    graph.output[0].type.tensor_type.shape.dim[0].ClearField("dim_param")

    onnx.checker.check_model(onnx_model)

    in_shape = [d.dim_value for d in graph.input[0].type.tensor_type.shape.dim]
    out_shape = [d.dim_value for d in graph.output[0].type.tensor_type.shape.dim]
    assert in_shape == [1, 5], f"Unexpected input shape {in_shape}, EA expects [1,5]"
    assert out_shape == [1, 3], f"Unexpected output shape {out_shape}, EA expects [1,3]"

    onnx.save(onnx_model, MODEL_OUT_PATH)
    print(f"[SUCCESS] Exported real trained model to: {MODEL_OUT_PATH}")
    print(f"[SUCCESS] Verified tensor contract: input_features{in_shape} -> probabilities{out_shape}")


def main():
    print("==================================================================")
    print("      MetaTrader 5 ONNX Quantitative Model Generator & Exporter    ")
    print("      (real training run — historical data, real fit, real eval)  ")
    print("==================================================================")

    X, y, feature_cols, split_idx = build_dataset()
    X_train, X_val, y_train, y_val = chronological_split(X, y, split_idx)
    print(f"[INFO] Train: {len(X_train)} rows, Holdout: {len(X_val)} rows (chronological split)")

    model = train_model(X_train, y_train)
    acc = evaluate(model, X_val, y_val)

    if acc <= 1 / 3:
        print("\n[WARN] Holdout accuracy is at or below chance level — the model isn't "
              "learning anything useful yet. Exporting anyway, but treat this run as a "
              "baseline to iterate on (more data, different horizon/threshold, more features).")

    export_onnx(model, feature_cols)


if __name__ == "__main__":
    main()
