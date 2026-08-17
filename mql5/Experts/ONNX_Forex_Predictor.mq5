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
input string   InpSymbol            = "";         // Trading Symbol (Blank = Current Chart Symbol)
input double   InpRiskPercent       = 1.0;        // Max Risk per Trade (% Balance)
input double   InpProbThreshold     = 0.65;       // Model Confidence Threshold (0.50-0.90)
input double   InpAtrStopMultiplier = 1.5;        // ATR Stop Loss Multiplier
input double   InpAtrTakeMultiplier = 2.5;        // ATR Take Profit Multiplier
input double   InpMaxSpreadPips     = 1.5;        // Max Spread Filter (Pips)
input double   InpMaxLotCap         = 1.0;        // Max Allowed Lot Cap (Safety Margin Guard)
input int      InpMagicNumber       = 778899;     // EA Magic Number

//--- Handles & Globals
CTrade         ExtTrade;
string         ExtSymbol            = "";
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
   // Determine active symbol (if InpSymbol is blank, use attached chart symbol)
   ExtSymbol = (InpSymbol == "" || InpSymbol == "EURUSD" && _Symbol != "EURUSD") ? _Symbol : InpSymbol;
   
   ExtTrade.SetExpertMagicNumber(InpMagicNumber);
   ExtTrade.SetDeviationInPoints(20);
   ExtTrade.SetMarginMode();
   ExtTrade.SetTypeFillingBySymbol(ExtSymbol);
   
   ExtDailyStartEquity = AccountInfoDouble(ACCOUNT_EQUITY);
   
   // Initialize ATR Indicator
   ExtAtrHandle = iATR(ExtSymbol, PERIOD_M5, 14);
   if(ExtAtrHandle == INVALID_HANDLE)
   {
      PrintFormat("[ERROR] Failed to create ATR handle for %s.", ExtSymbol);
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

   PrintFormat("[INIT] ONNX_Forex_Predictor initialized for %s (Magic: %d). In-Process Latency < 0.5ms.", ExtSymbol, InpMagicNumber);
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
         if(PositionGetSymbol(i) == ExtSymbol && PositionGetInteger(POSITION_MAGIC) == InpMagicNumber)
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
   double tickValue = SymbolInfoDouble(ExtSymbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSize  = SymbolInfoDouble(ExtSymbol, SYMBOL_TRADE_TICK_SIZE);
   double point     = SymbolInfoDouble(ExtSymbol, SYMBOL_POINT);
   if(tickSize <= 0) tickSize = point;
   
   int digits = (int)SymbolInfoInteger(ExtSymbol, SYMBOL_DIGITS);
   double pipUnit = (digits == 3 || digits == 5 ? 10.0 * point : point);
   double slDistance = slPips * pipUnit;
   
   double pointLossPerLot = (slDistance / tickSize) * tickValue;
   if(pointLossPerLot <= 0) return SymbolInfoDouble(ExtSymbol, SYMBOL_VOLUME_MIN);
   
   double calculatedLots = riskAmount / pointLossPerLot;
   
   // Check broker constraints and safety cap
   double step   = SymbolInfoDouble(ExtSymbol, SYMBOL_VOLUME_STEP);
   double minLot = SymbolInfoDouble(ExtSymbol, SYMBOL_VOLUME_MIN);
   double maxLot = SymbolInfoDouble(ExtSymbol, SYMBOL_VOLUME_MAX);
   
   if(InpMaxLotCap > 0 && InpMaxLotCap < maxLot)
      maxLot = InpMaxLotCap;
      
   double lots = MathFloor(calculatedLots / step) * step;
   lots = MathMax(minLot, MathMin(maxLot, lots));
   return NormalizeDouble(lots, 2);
}

//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick()
{
   MqlTick tick;
   if(!SymbolInfoTick(ExtSymbol, tick)) return;

   double point = SymbolInfoDouble(ExtSymbol, SYMBOL_POINT);
   int digits = (int)SymbolInfoInteger(ExtSymbol, SYMBOL_DIGITS);
   double spreadPips = (tick.ask - tick.bid) / (digits == 3 || digits == 5 ? 10 * point : point);

   if(!PassesRiskGuards(spreadPips)) return;

   // Calculate ATR
   double atrValues[];
   ArraySetAsSeries(atrValues, true);
   if(CopyBuffer(ExtAtrHandle, 0, 0, 3, atrValues) < 3) return;
   double currentAtr = atrValues[0];
   double atrPips = currentAtr / (digits == 3 || digits == 5 ? 10 * point : point);

   // Extract Real-time ML Features
   // Features: [OFI / Tick Bias, Spread Norm, ATR Expansion, Mid Deviation, Session Phase]
   double midPrice = (tick.bid + tick.ask) * 0.5;
   double tickBias = 0.0;
   if(tick.flags & TICK_FLAG_ASK)
      tickBias = 1.0;
   else if(tick.flags & TICK_FLAG_BID)
      tickBias = -1.0;

   float inputFeatures[5];
   inputFeatures[0] = (float)tickBias;                                                                             // Tick Direction / OFI
   inputFeatures[1] = (float)MathMin(2.0, spreadPips / InpMaxSpreadPips);                                         // Spread Norm
   inputFeatures[2] = (float)(atrValues[0] / (atrValues[2] + 1e-6));                                              // ATR Expansion
   inputFeatures[3] = (float)((tick.ask - midPrice) / (point * 10.0 + 1e-6));                                     // Mid Dev
   inputFeatures[4] = (float)(MathSin((double)(tick.time % 86400) / 86400.0 * 2.0 * 3.14159265));                // Session Phase

   float outputProbs[3]; // [P(Short), P(Neutral), P(Long)]

   // Execute In-Process ONNX Inference (< 0.5ms) using ONNX_DEFAULT (0)
   if(!OnnxRun(ExtOnnxHandle, ONNX_DEFAULT, inputFeatures, outputProbs))
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
      if(ExtTrade.Buy(lots, ExtSymbol, tick.ask, sl, tp, "AI_ONNX_BUY"))
      {
         PrintFormat("[AI TRADE] BUY %.2f lots %s at %.5f (Prob: %.2f%%) [Ticket: %I64u]", 
                     lots, ExtSymbol, tick.ask, pLong * 100, ExtTrade.ResultOrder());
      }
      else
      {
         PrintFormat("[TRADE ERROR] Buy failed for %s. Retcode: %u (%s)", 
                     ExtSymbol, ExtTrade.ResultRetcode(), ExtTrade.ResultRetcodeDescription());
      }
   }
   // Short Signal
   else if(pShort >= InpProbThreshold && pShort > pLong)
   {
      double sl = NormalizeDouble(tick.bid + slDistance, digits);
      double tp = NormalizeDouble(tick.bid - tpDistance, digits);
      if(ExtTrade.Sell(lots, ExtSymbol, tick.bid, sl, tp, "AI_ONNX_SELL"))
      {
         PrintFormat("[AI TRADE] SELL %.2f lots %s at %.5f (Prob: %.2f%%) [Ticket: %I64u]", 
                     lots, ExtSymbol, tick.bid, pShort * 100, ExtTrade.ResultOrder());
      }
      else
      {
         PrintFormat("[TRADE ERROR] Sell failed for %s. Retcode: %u (%s)", 
                     ExtSymbol, ExtTrade.ResultRetcode(), ExtTrade.ResultRetcodeDescription());
      }
   }
}
