# MetaTrader 5 Forex AI Algorithmic Trading Suite

Production-grade algorithmic trading architecture for **MetaTrader 5 (MT5)** combining **Pure Native In-Process ONNX** (< 0.5ms latency) and **Hybrid ZeroMQ IPC + Python AI Engine** (1-2ms latency).

---

## 📁 Repository Structure

```
├── mql5/
│   └── Experts/
│       ├── ONNX_Forex_Predictor.mq5    # Approach A: Native MQL5 Expert Advisor with embedded ONNX runtime
│       └── ZeroMQ_Forex_Gateway.mq5    # Approach B: MQL5 ZeroMQ Tick Publisher & Trade Executor
├── python/
│   ├── forex_ai_engine.py             # Headless ZeroMQ Strategy Engine (LightGBM/OFI/Risk)
│   ├── train_onnx_model.py            # Neural Network Training & ONNX Exporter Pipeline
│   └── requirements.txt               # Python quant dependencies
├── deploy/
│   ├── setup_ubuntu_mt5.sh            # Headless Wine 9.0 + XVFB + MT5 installation script
│   ├── mt5-ai-engine.service          # Linux systemd auto-restart service configuration
│   └── docker-compose.yml             # Dockerized quant worker orchestration
└── src/                               # Interactive Web UI Studio & Backtester
```

---

## 🚀 Approach A: Pure Native MQL5 + ONNX Runtime (< 0.5 ms Latency)

### How It Works
- Trains PyTorch/XGBoost/LightGBM model and exports to `model_forex_regime.onnx`.
- Embeds the `.onnx` model as a compiled binary resource inside the MT5 EA executable via `#resource "\\Files\\model_forex_regime.onnx" as uchar ExtModelBuffer[]`.
- Executes inference in-process directly inside MT5 via `OnnxRun()` on every incoming tick.

### Installation
1. Train/export the model:
   ```bash
   python python/train_onnx_model.py
   ```
2. Copy `model_forex_regime.onnx` to your MT5 directory: `MQL5/Files/`
3. Copy `mql5/Experts/ONNX_Forex_Predictor.mq5` to `MQL5/Experts/`
4. Open **MetaEditor**, click **Compile (F7)**, and attach `ONNX_Forex_Predictor` to your desired Forex chart (`EURUSD`, `GBPUSD`, `USDJPY`).

---

## ⚡ Approach B: Hybrid MQL5 ZeroMQ + Python AI Engine (1.0 - 2.5 ms Latency)

### How It Works
- `ZeroMQ_Forex_Gateway.mq5` runs inside MT5 and streams live tick & book events via ZeroMQ PUB socket (`:5555`).
- `forex_ai_engine.py` consumes the tick stream, computes Order Flow Imbalance (OFI), Spread Z-scores, and volatility features, evaluates ML models, and sends trade orders via ZeroMQ SUB socket (`:5556`).
- MQL5 EA executes orders asynchronously using `OrderSendAsync()` without thread blocking.

### Installation
1. Install Python dependencies:
   ```bash
   pip install -r python/requirements.txt
   ```
2. Run the strategy engine:
   ```bash
   python python/forex_ai_engine.py
   ```
3. Attach `ZeroMQ_Forex_Gateway.mq5` to the MT5 chart.

---

## 🐧 Headless Ubuntu Linux Colocation Setup (Equinix LD4 / NY4)

Run MT5 24/7 on an unmanaged Linux VPS using Wine 9 and virtual framebuffers:

```bash
chmod +x deploy/setup_ubuntu_mt5.sh
./deploy/setup_ubuntu_mt5.sh
```

---

## 🛡️ Risk Management & Circuit Breakers
- **Dynamic Lot Sizing:** Automatically sized based on ATR stop-loss distance and fractional risk percentage.
- **Max Daily Loss Lock:** 2.0% daily equity drawdown tripwire kills all positions and halts trading for 24h.
- **Max Spread Guard:** Orders are filtered out if spread exceeds threshold (prevents slippage during rollover).
