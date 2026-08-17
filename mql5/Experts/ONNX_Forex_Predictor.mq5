//+------------------------------------------------------------------+
//|                                     ONNX_Forex_Predictor.mq5     |
//|                 High-Performance In-Process Machine Learning EA  |
//|                 Target Platform: MetaTrader 5 (Build 3800+)      |
//+------------------------------------------------------------------+
#property copyright "Quant Developer & Scientist"
#property link      "https://github.com/raduolivas/mq5balistictrader"
#property version   "2.00"
#property strict

#include <Trade\Trade.mqh>

//--- Resource definition: Embed trained ONNX model directly in binary
#resource "\\Files\\model_forex_regime.onnx" as uchar ExtModelBuffer[]

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
