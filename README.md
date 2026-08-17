# MetaTrader 5 Forex AI Algorithmic Trading Suite 🚀

Production-grade algorithmic trading architecture for **MetaTrader 5 (MT5)** combining **Pure Native In-Process ONNX** (< 0.5ms latency) and **Hybrid ZeroMQ IPC + Python AI Engine** (1-2ms latency).

---

## 🧠 Part 1: What is the ONNX File and Why is it Used?

### What is ONNX?
**ONNX (Open Neural Network Exchange)** is an open format built to represent machine learning models. It acts as a bridge between high-level AI frameworks in Python (**PyTorch**, **TensorFlow**, **Scikit-Learn**, **LightGBM**) and low-level runtime environments (like **C++** and **MQL5**).

### Why was it used after you exported it?
In classical algorithmic trading, running a Python machine learning model during live trading required sending ticks to Python through sockets or web APIs, which introduces latency and connection drops.

With MetaTrader 5's native ONNX engine:
1. **Compilation into MT5 Binary**: In `ONNX_Forex_Predictor.mq5`, line 14:
   ```cpp
   #resource "\\Files\\model_forex_regime.onnx" as uchar ExtModelBuffer[]
   ```
   When you hit **Compile (F7)** in MetaEditor, MetaEditor **reads `model_forex_regime.onnx` from `MQL5/Files/` and permanently embeds the entire trained neural network directly inside your `.ex5` executable!**
2. **In-Process Inference**: When attached to your chart, MT5's native C++ engine executes `OnnxRun()` directly in the terminal's CPU memory without needing Python running in the background. Latency is `< 0.5 milliseconds` per tick.

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
   pip install numpy pandas scikit-learn onnx torch --index-url https://download.pytorch.org/whl/cpu
   ```
3. **Train & Export:**
   ```bash
   python python/train_onnx_model.py
   ```
4. **Deploy new weights to MT5:**
   Copy the newly generated `model_forex_regime.onnx` to `<MT5 Data Folder>/MQL5/Files/`, open MetaEditor, and press **F7** on `ONNX_Forex_Predictor.mq5` to recompile with the updated weights.

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
   * ✅ Check **Allow DLL imports**
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

## ⚡ Part 4: Alternative Approach (ZeroMQ + Python Microservice)

For advanced traders who wish to run complex Python packages (such as Reinforcement Learning, XGBoost, or live web sentiment scrapers):

1. Launch Python engine:
   ```bash
   python python/forex_ai_engine.py
   ```
2. Attach `mql5/Experts/ZeroMQ_Forex_Gateway.mq5` to the MT5 chart.
3. The gateway streams ticks to Python over port `5555` and receives trade orders asynchronously over port `5556`.
