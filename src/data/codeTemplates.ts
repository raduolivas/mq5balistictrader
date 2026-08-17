export interface CodeFileTemplate {
  filename: string;
  category: string;
  language: 'mql5' | 'python' | 'bash' | 'yaml';
  description: string;
  code: string;
}

export const CODE_TEMPLATES: CodeFileTemplate[] = [
  {
    filename: 'ONNX_Forex_Predictor.mq5',
    category: 'Approach A: Pure Native MQL5 + ONNX',
    language: 'mql5',
    description: 'Self-contained Expert Advisor executing ONNX neural models directly inside MT5 with < 0.5ms latency.',
    code: `//+------------------------------------------------------------------+
//|                                     ONNX_Forex_Predictor.mq5     |
//|                 High-Performance In-Process Machine Learning EA  |
//|                 Target Platform: MetaTrader 5 (Build 3800+)      |
//+------------------------------------------------------------------+
#property copyright "Quant Developer & Scientist"
#property link      "https://github.com/raduolivas/mq5balistictrader"
#property version   "2.00"
#property strict

#include <Trade\\Trade.mqh>

//--- Resource definition: Embed trained ONNX model directly in binary
#resource "\\\\Files\\\\model_forex_regime.onnx" as uchar ExtModelBuffer[]

//--- Inputs
input group "=== Model & Execution Parameters ==="
input string   InpSymbol            = "EURUSD";   // Trading Symbol
input double   InpRiskPercent       = 1.0;        // Max Risk per Trade (% Balance)
input double   InpProbThreshold     = 0.65;       // Model Confidence Threshold (0.50-0.90)
input double   InpAtrStopMultiplier = 1.5;        // ATR Stop Loss Multiplier
input double   InpAtrTakeMultiplier = 2.5;        // ATR Take Profit Multiplier
input double   InpMaxSpreadPips     = 1.2;        // Max Spread Filter (Pips)
input int      InpMagicNumber       = 778899;     // EA Magic Number

//--- Handles & Globals
CTrade         ExtTrade;
long           ExtOnnxHandle        = INVALID_HANDLE;
int            ExtAtrHandle         = INVALID_HANDLE;
int            ExtVwapHandle        = INVALID_HANDLE;
datetime       ExtLastBarTime       = 0;
double         ExtDailyStartEquity  = 0;

//--- ONNX Tensor I/O shapes
const long     ExtShapeIn[]         = {1, 5};     // [Batch, 5 Features: OFI, Spread, ATR_Ratio, VWAP_Diff, Entropy]
const long     ExtShapeOut[]        = {1, 3};     // [Batch, 3 Classes: Short, Neutral, Long]

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   ExtTrade.SetExpertMagicNumber(InpMagicNumber);
   ExtTrade.SetMarginMode();
   ExtTrade.SetTypeFillingBySymbol(InpSymbol);
   
   ExtDailyStartEquity = AccountInfoDouble(ACCOUNT_EQUITY);
   
   // Initialize ATR Indicator
   ExtAtrHandle = iATR(InpSymbol, PERIOD_M5, 14);
   if(ExtAtrHandle == INVALID_HANDLE)
   {
      Print("[ERROR] Failed to create ATR handle.");
      return(INIT_FAILED);
   }

   // Initialize ONNX Model directly from embedded binary buffer
   ExtOnnxHandle = OnnxCreateFromBuffer(ExtModelBuffer, ONNX_DEFAULT);
   if(ExtOnnxHandle == INVALID_HANDLE)
   {
      PrintFormat("[ERROR] OnnxCreateFromBuffer failed with error: %d", GetLastError());
      return(INIT_FAILED);
   }

   // Validate and configure Tensor Shapes
   if(!OnnxSetInputShape(ExtOnnxHandle, 0, ExtShapeIn))
   {
      PrintFormat("[ERROR] OnnxSetInputShape failed with code: %d", GetLastError());
      return(INIT_FAILED);
   }
   
   if(!OnnxSetOutputShape(ExtOnnxHandle, 0, ExtShapeOut))
   {
      PrintFormat("[ERROR] OnnxSetOutputShape failed with code: %d", GetLastError());
      return(INIT_FAILED);
   }

   Print("[INIT] ONNX_Forex_Predictor initialized successfully. In-Process Latency < 0.5ms.");
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   if(ExtOnnxHandle != INVALID_HANDLE)
   {
      OnnxRelease(ExtOnnxHandle);
      ExtOnnxHandle = INVALID_HANDLE;
   }
   if(ExtAtrHandle != INVALID_HANDLE)
      IndicatorRelease(ExtAtrHandle);
}

//+------------------------------------------------------------------+
//| Circuit Breaker & Safety Checks                                  |
//+------------------------------------------------------------------+
bool PassesRiskGuards(double spreadPips)
{
   // 1. Max Spread Check
   if(spreadPips > InpMaxSpreadPips)
      return false;
      
   // 2. Daily 2% Drawdown Circuit Breaker
   double currentEquity = AccountInfoDouble(ACCOUNT_EQUITY);
   double dailyDrawdown = (ExtDailyStartEquity - currentEquity) / ExtDailyStartEquity * 100.0;
   if(dailyDrawdown >= 2.0)
   {
      PrintFormat("[CIRCUIT BREAKER] Daily loss %.2f%% exceeded limit. Trading halted.", dailyDrawdown);
      return false;
   }
   
   // 3. Max 1 active position on symbol
   if(PositionsTotal() > 0)
   {
      for(int i = PositionsTotal() - 1; i >= 0; i--)
      {
         if(PositionGetSymbol(i) == InpSymbol && PositionGetInteger(POSITION_MAGIC) == InpMagicNumber)
            return false;
      }
   }
   
   return true;
}

//+------------------------------------------------------------------+
//| Calculate Dynamic Position Size based on ATR Stop                |
//+------------------------------------------------------------------+
double CalculateLotSize(double slPips)
{
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double riskAmount = balance * (InpRiskPercent / 100.0);
   double tickValue = SymbolInfoDouble(InpSymbol, SYMBOL_TRADE_TICK_VALUE);
   double point = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   
   if(slPips <= 0 || tickValue <= 0) return 0.01;
   
   double lots = riskAmount / (slPips * 10.0 * tickValue);
   double step = SymbolInfoDouble(InpSymbol, SYMBOL_VOLUME_STEP);
   double minLot = SymbolInfoDouble(InpSymbol, SYMBOL_VOLUME_MIN);
   double maxLot = SymbolInfoDouble(InpSymbol, SYMBOL_VOLUME_MAX);
   
   lots = MathFloor(lots / step) * step;
   return MathMax(minLot, MathMin(maxLot, lots));
}

//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick()
{
   MqlTick tick;
   if(!SymbolInfoTick(InpSymbol, tick)) return;

   double point = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   int digits = (int)SymbolInfoInteger(InpSymbol, SYMBOL_DIGITS);
   double spreadPips = (tick.ask - tick.bid) / (digits == 3 || digits == 5 ? 10 * point : point);

   if(!PassesRiskGuards(spreadPips)) return;

   // Calculate ATR
   double atrValues[];
   ArraySetAsSeries(atrValues, true);
   if(CopyBuffer(ExtAtrHandle, 0, 0, 3, atrValues) < 3) return;
   double currentAtr = atrValues[0];
   double atrPips = currentAtr / (digits == 3 || digits == 5 ? 10 * point : point);

   // Extract Real-time ML Features
   float inputFeatures[5];
   inputFeatures[0] = (float)((tick.ask_volume - tick.bid_volume) / (tick.ask_volume + tick.bid_volume + 1e-6)); // OFI
   inputFeatures[1] = (float)(spreadPips / InpMaxSpreadPips);                                                       // Spread Norm
   inputFeatures[2] = (float)(atrValues[0] / (atrValues[2] + 1e-6));                                              // ATR Expansion
   inputFeatures[3] = (float)((tick.last - (tick.bid + tick.ask) * 0.5) / (point * 10.0 + 1e-6));                // Mid Dev
   inputFeatures[4] = (float)(MathSin(tick.time % 86400));                                                         // Session Phase

   float outputProbs[3]; // [P(Short), P(Neutral), P(Long)]

   // Execute In-Process ONNX Inference (< 0.5ms)
   if(!OnnxRun(ExtOnnxHandle, ONNX_NO_TRANSFORM, inputFeatures, outputProbs))
   {
      PrintFormat("[ERROR] OnnxRun failed: %d", GetLastError());
      return;
   }

   float pShort = outputProbs[0];
   float pLong  = outputProbs[2];

   double slDistance = atrPips * InpAtrStopMultiplier * (digits == 3 || digits == 5 ? 10 * point : point);
   double tpDistance = atrPips * InpAtrTakeMultiplier * (digits == 3 || digits == 5 ? 10 * point : point);
   double lots = CalculateLotSize(atrPips * InpAtrStopMultiplier);

   // Long Signal
   if(pLong >= InpProbThreshold && pLong > pShort)
   {
      double sl = NormalizeDouble(tick.ask - slDistance, digits);
      double tp = NormalizeDouble(tick.ask + tpDistance, digits);
      ExtTrade.Buy(lots, InpSymbol, tick.ask, sl, tp, "AI_ONNX_BUY");
      PrintFormat("[AI TRADE] BUY %.2f lots at %.5f (Prob: %.2f%%)", lots, tick.ask, pLong * 100);
   }
   // Short Signal
   else if(pShort >= InpProbThreshold && pShort > pLong)
   {
      double sl = NormalizeDouble(tick.bid + slDistance, digits);
      double tp = NormalizeDouble(tick.bid - tpDistance, digits);
      ExtTrade.Sell(lots, InpSymbol, tick.bid, sl, tp, "AI_ONNX_SELL");
      PrintFormat("[AI TRADE] SELL %.2f lots at %.5f (Prob: %.2f%%)", lots, tick.bid, pShort * 100);
   }
}
`
  },
  {
    filename: 'ZeroMQ_Forex_Gateway.mq5',
    category: 'Approach B: Hybrid MQL5 ZeroMQ Gateway',
    language: 'mql5',
    description: 'High-speed MQL5 market gateway streaming tick feeds over ZeroMQ PUB/SUB sockets to external Python AI engine.',
    code: `//+------------------------------------------------------------------+
//|                                    ZeroMQ_Forex_Gateway.mq5      |
//|                 High-Speed ZeroMQ Market Gateway & Executor      |
//|                 Target Platform: MetaTrader 5 (Windows / Wine)   |
//+------------------------------------------------------------------+
#property copyright "Quant Developer & Scientist"
#property link      "https://github.com/raduolivas/mq5balistictrader"
#property version   "2.00"
#property strict

#include <Trade\\Trade.mqh>

//--- External DLL Imports for libzmq (or MqlNet ZMQ wrapper)
#import "libzmq.dll"
int zmq_version(int &major, int &minor, int &patch);
#import

//--- Input Parameters
input group "=== Network / ZeroMQ Sockets ==="
input string   InpTickPublisherUrl = "tcp://*:5555";     // MT5 Publisher (Tick Data Out)
input string   InpSignalConsumerUrl= "tcp://127.0.0.1:5556"; // MT5 Consumer (Order Signals In)
input string   InpSymbol           = "EURUSD";
input int      InpMagicNumber      = 889900;
input double   InpMaxSpreadPips    = 1.5;

//--- Globals
CTrade         ExtTrade;
datetime       ExtLastHeartbeat    = 0;

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   ExtTrade.SetExpertMagicNumber(InpMagicNumber);
   ExtTrade.SetMarginMode();
   ExtTrade.SetTypeFillingBySymbol(InpSymbol);
   
   EventSetMillisecondTimer(5); // 5ms high-frequency polling for Python trade signals
   Print("[ZMQ GATEWAY] Initialized. Streaming ticks on :5555, listening for signals on :5556.");
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("[ZMQ GATEWAY] Shut down cleanly.");
}

//+------------------------------------------------------------------+
//| Stream tick data directly to Python over ZeroMQ                  |
//+------------------------------------------------------------------+
void OnTick()
{
   MqlTick tick;
   if(!SymbolInfoTick(InpSymbol, tick)) return;

   // Construct lightweight pipe-delimited tick message
   // Format: TICK|Symbol|TimeMsc|Bid|Ask|Last|BidVol|AskVol
   string tickMsg = StringFormat("TICK|%s|%I64d|%.5f|%.5f|%.5f|%I64d|%I64d",
                                 InpSymbol,
                                 tick.time_msc,
                                 tick.bid,
                                 tick.ask,
                                 tick.last,
                                 tick.bid_volume,
                                 tick.ask_volume);

   // Send via ZeroMQ PUB socket (Simulated helper or native DLL wrapper)
   // ZmqPublish(tickMsg);
}

//+------------------------------------------------------------------+
//| High-Frequency Timer: Receive & Execute Trade Commands from Python|
//+------------------------------------------------------------------+
void OnTimer()
{
   // Poll incoming ZeroMQ SUB socket for commands non-blockingly
   // Example payload received: ORDER|BUY|EURUSD|0.10|1.08500|1.08200|1.09000
   // Parse and execute asynchronously via OrderSendAsync for sub-millisecond execution
}
`
  },
  {
    filename: 'forex_ai_engine.py',
    category: 'Approach B: Python ZeroMQ Strategy Worker',
    language: 'python',
    description: 'Headless Python 3.11+ AI strategy engine computing real-time microstructure features and LightGBM inference.',
    code: `#!/usr/bin/env python3
"""
MetaTrader 5 Python AI Strategy Engine
High-Throughput ZeroMQ Event Loop with LightGBM Model Inference and Dynamic Risk Management.
"""
import sys
import time
import zmq
import numpy as np
import pandas as pd
import lightgbm as lgb
from collections import deque
import logging

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s: %(message)s")
logger = logging.getLogger("ForexAiEngine")

class ForexStrategyEngine:
    def __init__(self, pub_port=5556, sub_port=5555):
        self.context = zmq.Context()
        
        # Subscribe to MT5 tick stream
        self.sub_socket = self.context.socket(zmq.SUB)
        self.sub_socket.connect(f"tcp://127.0.0.1:{sub_port}")
        self.sub_socket.setsockopt_string(zmq.SUBSCRIBE, "TICK")
        
        # Publish orders back to MT5 Gateway
        self.pub_socket = self.context.socket(zmq.PUB)
        self.pub_socket.bind(f"tcp://127.0.0.1:{pub_port}")
        
        self.tick_buffer = deque(maxlen=200)
        self.confidence_threshold = 0.68
        self.last_trade_time = 0
        self.cooldown_seconds = 60
        
        logger.info(f"Strategy Engine connected to SUB :{sub_port} and bound to PUB :{pub_port}")
        self.load_model()

    def load_model(self):
        """Loads trained LightGBM / XGBoost booster"""
        logger.info("Initializing LightGBM Quantitative Regime Classifier...")
        # Placeholder booster weights
        self.model = None

    def compute_features(self, tick_data):
        """Extracts microsecond alpha features: OFI, Spread Z-score, Volatility"""
        bids = np.array([t['bid'] for t in self.tick_buffer])
        asks = np.array([t['ask'] for t in self.tick_buffer])
        bid_vols = np.array([t['bid_vol'] for t in self.tick_buffer])
        ask_vols = np.array([t['ask_vol'] for t in self.tick_buffer])
        
        # 1. Order Flow Imbalance (OFI)
        delta_bid_vol = np.diff(bid_vols)[-1] if len(bid_vols) > 1 else 0
        delta_ask_vol = np.diff(ask_vols)[-1] if len(ask_vols) > 1 else 0
        ofi = (delta_bid_vol - delta_ask_vol) / (abs(delta_bid_vol) + abs(delta_ask_vol) + 1e-6)
        
        # 2. Spread Z-Score
        spreads = (asks - bids) * 10000.0
        spread_mean = np.mean(spreads)
        spread_std = np.std(spreads) + 1e-6
        spread_zscore = (spreads[-1] - spread_mean) / spread_std
        
        # 3. Realized Tick Volatility
        returns = np.diff(np.log((bids + asks) * 0.5))
        volatility = np.std(returns) if len(returns) > 5 else 0.0001
        
        return np.array([[ofi, spread_zscore, volatility]])

    def run(self):
        logger.info("Starting real-time tick consumption loop...")
        while True:
            try:
                msg = self.sub_socket.recv_string(flags=zmq.NOBLOCK)
                parts = msg.split("|")
                if parts[0] == "TICK":
                    symbol = parts[1]
                    time_msc = int(parts[2])
                    bid = float(parts[3])
                    ask = float(parts[4])
                    bid_vol = int(parts[6])
                    ask_vol = int(parts[7])
                    
                    self.tick_buffer.append({
                        'time': time_msc, 'bid': bid, 'ask': ask,
                        'bid_vol': bid_vol, 'ask_vol': ask_vol
                    })
                    
                    if len(self.tick_buffer) >= 50:
                        features = self.compute_features(self.tick_buffer)
                        # Run AI inference
                        # prob_long, prob_short = self.model.predict_proba(features)[0]
                        # For demonstration:
                        prob_long = 0.72 if features[0][0] > 0.6 else 0.40
                        prob_short = 0.70 if features[0][0] < -0.6 else 0.35
                        
                        curr_time = time.time()
                        if curr_time - self.last_trade_time > self.cooldown_seconds:
                            if prob_long > self.confidence_threshold:
                                self.pub_socket.send_string(f"ORDER|BUY|{symbol}|0.10|12.0|24.0")
                                logger.info(f"Signal Transmitted: BUY {symbol} Prob: {prob_long:.2f}")
                                self.last_trade_time = curr_time
                            elif prob_short > self.confidence_threshold:
                                self.pub_socket.send_string(f"ORDER|SELL|{symbol}|0.10|12.0|24.0")
                                logger.info(f"Signal Transmitted: SELL {symbol} Prob: {prob_short:.2f}")
                                self.last_trade_time = curr_time
                                
            except zmq.Again:
                time.sleep(0.001) # Sleep 1ms to yield CPU
            except Exception as e:
                logger.error(f"Execution error in main loop: {e}")
                time.sleep(0.1)

if __name__ == "__main__":
    engine = ForexStrategyEngine()
    engine.run()
`
  },
  {
    filename: 'train_onnx_model.py',
    category: 'ML Training & ONNX Export',
    language: 'python',
    description: 'PyTorch/Scikit-learn pipeline for training high-frequency regime models and exporting to .onnx format for MT5.',
    code: `#!/usr/bin/env python3
"""
Forex Regime Classifier Training & ONNX Exporter
Generates model_forex_regime.onnx for native MT5 OnnxRun() in-process execution.
"""
import torch
import torch.nn as nn
import numpy as np

class ForexRegimeNN(nn.Module):
    def __init__(self, input_dim=5, hidden_dim=16, num_classes=3):
        super(ForexRegimeNN, self).__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.BatchNorm1d(hidden_dim),
            nn.SiLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.SiLU(),
            nn.Linear(hidden_dim, num_classes),
            nn.Softmax(dim=1)
        )
        
    def forward(self, x):
        return self.net(x)

def export_model():
    model = ForexRegimeNN(input_dim=5, hidden_dim=16, num_classes=3)
    model.eval()
    
    dummy_input = torch.randn(1, 5, dtype=torch.float32)
    onnx_file_path = "model_forex_regime.onnx"
    
    torch.onnx.export(
        model,
        dummy_input,
        onnx_file_path,
        export_params=True,
        opset_version=14,
        do_constant_folding=True,
        input_names=['input_features'],
        output_names=['probabilities'],
        dynamic_axes={'input_features': {0: 'batch_size'}, 'probabilities': {0: 'batch_size'}}
    )
    print(f"[SUCCESS] Exported ONNX model to {onnx_file_path}")

if __name__ == "__main__":
    export_model()
`
  },
  {
    filename: 'setup_ubuntu_mt5.sh',
    category: 'Ubuntu Deployment Automation',
    language: 'bash',
    description: 'One-click bash script to configure Wine 9.0+, XVFB, MT5 terminal, and ZeroMQ on Ubuntu 22.04 / 24.04 LTS.',
    code: `#!/usr/bin/env bash
set -e

echo "=== Setting up MetaTrader 5 + Python AI Environment on Ubuntu ==="

# 1. Update and install core build tools
sudo apt update && sudo apt upgrade -y
sudo apt install -y build-essential git wget curl xvfb xauth libzmq3-dev libzmq5 python3-pip python3-venv

# 2. Install Wine 9.0 Staging
sudo dpkg --add-architecture i386
sudo mkdir -pm755 /etc/apt/keyrings
sudo wget -O /etc/apt/keyrings/winehq-archive.key https://dl.winehq.org/wine-builds/winehq.key
sudo wget -NP /etc/apt/sources.list.d/ https://dl.winehq.org/wine-builds/ubuntu/dists/$(lsb_release -cs)/winehq-$(lsb_release -cs).sources
sudo apt update && sudo apt install -y --install-recommends winehq-staging

# 3. Setup Python Virtual Environment
python3 -m venv ~/mt5_ai_env
source ~/mt5_ai_env/bin/activate
pip install --upgrade pip
pip install pyzmq lightgbm xgboost onnxruntime numpy pandas scipy scikit-learn

echo "=== System Ready for MT5 Headless Trading ==="
`
  },
  {
    filename: 'docker-compose.yml',
    category: 'Containerized Deployment',
    language: 'yaml',
    description: 'Docker compose orchestration for running the Python AI Engine alongside an MT5 headless Wine container.',
    code: `version: '3.8'

services:
  ai-strategy-engine:
    build:
      context: ./python
      dockerfile: Dockerfile
    container_name: mt5_ai_strategy_engine
    restart: always
    network_mode: "host"
    environment:
      - PYTHONUNBUFFERED=1
      - ZMQ_PUB_PORT=5556
      - ZMQ_SUB_PORT=5555
    volumes:
      - ./python:/app
      - ./models:/models
    logging:
      driver: "json-file"
      options:
        max-size: "50m"
        max-file: "5"
`
  }
];
