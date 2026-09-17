# MetaTrader 5 Forex AI Algorithmic Trading Suite 🚀

Reference algorithmic-trading architecture for **MetaTrader 5 (MT5)** combining
native in-process ONNX inference with an experimental ZeroMQ/Python signal
worker. Latency and strategy quality must be measured on the target broker and
VPS; the repository does not treat illustrative UI metrics as production
benchmarks.

---

## 🧠 Part 1: What is the ONNX File and Why is it Used?

### What is ONNX?
**ONNX (Open Neural Network Exchange)** is an open format built to represent machine learning models. It acts as a bridge between high-level AI frameworks in Python (**PyTorch**, **TensorFlow**, **Scikit-Learn**, **LightGBM**) and low-level runtime environments (like **C++** and **MQL5**).

### Why was it used after you exported it?
In classical algorithmic trading, running a Python machine learning model during live trading required sending ticks to Python through sockets or web APIs, which introduces latency and connection drops.

With MetaTrader 5's native ONNX engine:
1. **Runtime loading with safe hot reload:** `ONNX_Forex_Predictor.mq5`
   loads `model_forex_regime.onnx` from `MQL5/Files/`, validates its fixed
   `[1,5] -> [1,3]` tensor contract, and swaps handles only after the new model
   passes shape checks. A changed model is picked up by the timer without
   recompiling the EA.
2. **In-process inference:** When attached to a chart, MT5 executes `OnnxRun()`
   inside the terminal without a Python round trip. Measure inference and
   order-path latency on the target terminal rather than assuming a fixed
   sub-millisecond value.

---

## 🔬 Part 2: How the Machine Learning Model is Set Up & How to Train It

### Current Architecture (5-Feature Multi-Class Regime Classifier)
The model takes **5 normalized microstructural inputs** on every tick and outputs **3 Softmax probability classes**:

```
[ Input: 5 Live Market Features ]
  1. Tick Bias / OFI       [-1.0 to +1.0] (Order flow aggression)
  2. Spread Normalization   [0.0 to 2.0]   (Broker friction filter)
  3. ATR Volatility Ratio   [0.5 to 3.0]   (Breakout expansion vs quiet chop)
  4. Mid-Price Deviation    [-2.0 to +2.0] (Deviation from tick midpoint)
  5. Session Phase          [0.0 to 1.0]   (Intraday cyclical time)
             │
             ▼
[ ONNX Computation Graph / Neural Layer ]
             │
             ▼
[ Output: 3 Softmax Probabilities ]
  • P(Short)   -> Probability market is entering downward momentum
  • P(Neutral) -> Probability market is in noise / chop
  • P(Long)    -> Probability market is entering upward momentum
```

### How to Retrain the Model with Custom Data
You can train the neural network on your own historical CSV tick data or customize the architecture:

1. **Activate your Python environment:**
   ```bash
   cd mq5balistictrader
   source venv/bin/activate
   ```
2. **Install dependencies:**
   ```bash
   pip install -r python/requirements-train.txt
   ```
3. **Train & Export:**
   ```bash
   python python/train_onnx_model.py
   ```
4. **Deploy new weights to MT5:**
   Copy the newly generated `model_forex_regime.onnx` to `<MT5 Data
   Folder>/MQL5/Files/`. The attached EA polls the file and hot-reloads a model
   that satisfies the tensor contract; recompilation is not required.

---

## 🛠️ Part 3: Complete End-to-End Setup & Operational Manual

### Step 1: Directory Layout & File Placement

1. In MetaTrader 5, click **File** ➔ **Open Data Folder**.
2. Place the project files in the designated folders:
   * 📂 `MQL5/Files/` ➔ Place `model_forex_regime.onnx`
   * 📂 `MQL5/Experts/` ➔ Place `ONNX_Forex_Predictor.mq5` and `ZeroMQ_Forex_Gateway.mq5`

---

### Step 2: MetaEditor Compilation

1. Press **F4** in MT5 to open **MetaEditor**.
2. In the left Navigator, expand `Experts` and double-click `ONNX_Forex_Predictor.mq5`.
3. Press **F7** (Compile). Ensure the output at the bottom says:
   ```text
   0 errors, 0 warnings
   ```

---

### Step 3: Terminal Configuration

1. In MT5, open **Tools** ➔ **Options** (`Ctrl + O`) ➔ **Expert Advisors** tab:
   * ✅ Check **Allow Algo Trading**
   * For the Docker gateway, add `127.0.0.1` to the allowed socket addresses.
     DLL imports are not required.
2. On the main MT5 toolbar, ensure the **Algo Trading** button is **Green** (Play icon ▶️).

---

### Step 4: Multi-Market Simultaneous Deployment

To run the EA on multiple pairs (EURUSD, GBPUSD, USDJPY, AUDUSD, USDCHF, etc.):

1. Open separate chart windows for each symbol on the **M5** or **M1** timeframe.
2. Drag `ONNX_Forex_Predictor` onto each chart.
3. In the **Inputs** tab, assign a **unique Magic Number** to each chart:

| Symbol | Timeframe | EA Magic Number | Max Risk (% Balance) | Max Lot Cap |
| :--- | :--- | :--- | :--- | :--- |
| **EURUSD** | M5 | `778891` | `0.5%` - `1.0%` | `1.0` |
| **GBPUSD** | M5 | `778892` | `0.5%` - `1.0%` | `1.0` |
| **USDJPY** | M5 | `778893` | `0.5%` - `1.0%` | `1.0` |
| **USDCHF** | M5 | `778894` | `0.5%` - `1.0%` | `1.0` |
| **AUDUSD** | M5 | `778895` | `0.5%` - `1.0%` | `1.0` |

---

### Step 5: Parameters & Risk Customization

| Parameter | Recommended Default | Description |
| :--- | :--- | :--- |
| `InpRiskPercent` | `0.5` - `1.0` | Maximum account balance risked per trade. |
| `InpProbThreshold` | `0.55` - `0.65` | AI confidence required to open a position (e.g. 60%+). |
| `InpAtrStopMultiplier` | `1.5` | Stop Loss distance relative to ATR volatility. |
| `InpAtrTakeMultiplier` | `2.5` | Take Profit distance relative to ATR volatility. |
| `InpMaxSpreadPips` | `1.5` - `2.5` | Filters out trades during news spikes or rollover spread widening. |
| `InpMaxLotCap` | `1.0` | Hard safety ceiling preventing margin exhaustion across pairs. |

---

### Step 6: Manual Take Profit & Position Management

* **Adjusting Live Orders:** You can manually drag the TP/SL lines on desktop or long-press the position in your phone's MT5 app and tap **Modify Position** or **Close Position** at any time.
* **Pausing the Robot:** Click the **Algo Trading** button (turns Red ⏹️) to pause entries. Open positions will remain protected with their existing Stop Loss and Take Profit.

---

## ⚡ Part 4: Docker + ZeroMQ runtime

The Docker path is implemented as a safe hybrid. MQL5 uses its native TCP API,
so no ZeroMQ DLL is loaded into the Wine process. The local bridge validates and
translates frames; ZeroMQ remains inside the Compose network:

```text
MT5 / Wine
  ZeroMQ_Forex_Gateway.mq5
  risk sizing + SL/TP + execution
          │ TCP 127.0.0.1:5555 (newline protocol)
          ▼
Docker: mt5-bridge
          │ ZMQ PUB ticks :5557
          ▼
Docker: ai-strategy-engine
          │ ZMQ PUSH signals :5556
          └──────────────► mt5-bridge ─────► MT5
```

Only `127.0.0.1:5555` is published on the host. Ports `5556` and `5557` are
internal to the Compose network. Both containers run as UID 10001 with a
read-only root, dropped capabilities, `no-new-privileges`, bounded logs, and
healthchecks.

### Start and verify

Install Docker Engine and the Compose plugin, then run:

```bash
cd mq5balistictrader
docker compose -f deploy/docker-compose.yml config --quiet
docker compose -f deploy/docker-compose.yml build
docker compose -f deploy/docker-compose.yml up -d --wait
docker compose -f deploy/docker-compose.yml ps
python3 python/bridge_smoke_test.py
```

The smoke test opens a synthetic TCP client and validates the complete
TCP -> ZeroMQ -> engine -> ZeroMQ -> TCP round trip. It cannot place a trade.

Useful operational commands:

```bash
docker compose -f deploy/docker-compose.yml logs --tail=100
docker compose -f deploy/docker-compose.yml restart
docker compose -f deploy/docker-compose.yml down
```

### Configure MT5

1. Copy `mql5/Experts/ZeroMQ_Forex_Gateway.mq5` and its compiled `.ex5` into
   the terminal data folder under `MQL5/Experts/`.
2. In **Tools -> Options -> Expert Advisors**, add `127.0.0.1` to the allowed
   socket addresses. This terminal setting cannot be changed by the EA.
3. Attach the gateway to a chart matching `InpSymbol`.
4. Keep `InpExecutionEnabled=false` and `InpAllowRealAccount=false` while
   validating connectivity and during the initial demo soak test.
5. Confirm the Experts log contains `Handshake ready` and the bridge log shows
   the registered symbol.

The gateway rejects malformed, stale, future, duplicate, wrong-symbol, and
low-confidence signals. Python never controls lots or stops: MQL5 applies the
spread, ATR, broker stop-distance, account type, daily drawdown, exposure, and
risk-size guards before any opt-in order submission.

The current Python strategy is deliberately a **heuristic signal engine**, not
trained ML inference or evidence of profitability. It uses directional tick
counters from the gateway, isolates state per symbol, and emits only side and
confidence. Use the separate native ONNX EA for ONNX inference, and do not
promote either path to live trading without broker-data validation and a demo
soak period.

### Troubleshooting

- `SocketConnect` errors: start Compose and allowlist `127.0.0.1` in MT5.
- Bridge healthy, engine unhealthy: inspect the engine heartbeat and container
  logs; verify the internal endpoints use service names from the Compose file.
- No signal during smoke test: wait for both services to report `healthy` and
  ensure no old process owns ports 5555-5557.
- Docker rootless blocked on Ubuntu AppArmor: apply Docker's documented
  RootlessKit AppArmor profile or use the system Docker service, then rerun the
  Compose commands above.

On this machine, Docker CLI `29.8.1`, Buildx `0.37.1`, and Compose `5.5.1` are
already installed in the user account. Ubuntu's restricted unprivileged user
namespaces require this one-time administrative activation:

```bash
cd mq5balistictrader
sudo install -m 0644 deploy/rootlesskit.apparmor \
  /etc/apparmor.d/home.cybersecrad.bin.rootlesskit
sudo systemctl restart apparmor.service
dockerd-rootless-setuptool.sh install --skip-iptables
systemctl --user start docker
docker context use rootless
docker info
```

The profile grants `userns` only to the installed RootlessKit executable. It
does not disable AppArmor globally. After `docker info` shows a server, run the
start-and-verify commands above.

---

## Dashboard simulation and offline validation

The dashboard's performance tool is a **deterministic Monte Carlo simulator**,
not a historical backtest. A seed makes comparisons reproducible, and the
server owns pip size, spread, and USD pip-value metadata so client input cannot
mix pips with raw price units.

```bash
npm install --ignore-scripts --no-audit --no-fund --no-package-lock
npm test
npm run lint
npm run build
python3 -m unittest discover -s python/tests -v
```

These commands do not attach to MT5 or submit orders. Compile the `.mq5` files
in MetaEditor and run Strategy Tester/demo soak tests before deployment.
