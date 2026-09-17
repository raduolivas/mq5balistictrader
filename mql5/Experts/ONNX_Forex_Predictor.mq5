//+------------------------------------------------------------------+
//|                                     ONNX_Forex_Predictor.mq5     |
//|                 High-Performance In-Process Machine Learning EA  |
//|                 Target Platform: MetaTrader 5 (Build 3800+)      |
//+------------------------------------------------------------------+
#property copyright "Quant Developer & Scientist"
#property link      "https://github.com/raduolivas/mq5balistictrader"
#property version   "2.12"
#property strict

#include <Trade\Trade.mqh>

//--- Inputs
input group "=== Model & Execution Parameters ==="
input string   InpSymbol            = "";         // Trading Symbol (Blank = Current Chart Symbol)
input double   InpRiskPercent       = 1.0;        // Max Risk per Trade (% Balance) [initial value, hot-reloadable]
input double   InpProbThreshold     = 0.65;       // Model Confidence Threshold (0.50-0.90) [initial value, hot-reloadable]
input double   InpAtrStopMultiplier = 1.5;        // ATR Stop Loss Multiplier [initial value, hot-reloadable]
input double   InpAtrTakeMultiplier = 2.5;        // ATR Take Profit Multiplier [initial value, hot-reloadable]
input double   InpMaxSpreadPips     = 1.5;        // Max Spread Filter (Pips) [initial value, hot-reloadable]
input double   InpMaxLotCap         = 1.0;        // Max Allowed Lot Cap (Safety Margin Guard) [fixed, not hot-reloadable]
input int      InpMagicNumber       = 778899;     // EA Magic Number [fixed]

input group "=== Hot-Reload (Hermes writes these files) ==="
input string   InpModelFile         = "model_forex_regime.onnx"; // Runtime-swappable ONNX model (MQL5/Files/)
input string   InpParamsFile        = "strategy_forex.txt";      // Runtime-editable risk params (MQL5/Files/)
input string   InpTradesLogFile     = "trades_forex.jsonl";      // Closed-trade log (MQL5/Files/)
input int      InpReloadSeconds     = 60;                        // How often to check for model/param changes

//--- Hard safety ceilings: enforced no matter what InpParamsFile says, so a bad
//    edit (by Hermes or by hand) can never push live risk past these.
#define SAFETY_MIN_RISK_PERCENT     0.1
#define SAFETY_MAX_RISK_PERCENT     2.0
#define SAFETY_MIN_PROB_THRESHOLD   0.50
#define SAFETY_MAX_PROB_THRESHOLD   0.95
#define SAFETY_MIN_ATR_MULT         0.5
#define SAFETY_MAX_ATR_STOP_MULT    5.0
#define SAFETY_MAX_ATR_TAKE_MULT    10.0
#define SAFETY_MIN_MAX_SPREAD_PIPS  0.5
#define SAFETY_MAX_MAX_SPREAD_PIPS  5.0

//--- Handles & Globals
CTrade         ExtTrade;
string         ExtSymbol            = "";
long           ExtOnnxHandle        = INVALID_HANDLE;
int            ExtAtrHandle         = INVALID_HANDLE;
int            ExtVwapHandle        = INVALID_HANDLE;
datetime       ExtLastBarTime       = 0;
double         ExtDailyStartEquity  = 0;
int            ExtDailyEquityDay    = -1;
datetime       ExtModelFileTime     = 0;

//--- Diagnostics: last-evaluated state, printed once per OnTimer cycle so
//    it's visible whether the EA is actually ticking and how close it is
//    to firing, without spamming a log line on every single tick.
bool           ExtDiagHasData       = false;
datetime       ExtDiagEvalTime      = 0;
double         ExtDiagSpreadPips    = 0;
bool           ExtDiagPassedGuards  = false;
float          ExtDiagPShort        = 0;
float          ExtDiagPNeutral      = 0;
float          ExtDiagPLong         = 0;

//--- Effective (hot-reloadable) risk parameters. Start at the compiled Inp*
//    defaults; may be overridden by InpParamsFile on every reload tick.
//    OnTick/CalculateLotSize/PassesRiskGuards read these, never the raw Inp*
//    values, so a live parameter change takes effect without recompiling.
double         EffRiskPercent, EffProbThreshold, EffAtrStopMultiplier, EffAtrTakeMultiplier, EffMaxSpreadPips;

//--- ONNX Tensor I/O shapes
const long     ExtShapeIn[]         = {1, 5};     // [Batch, 5 Features: OFI, Spread, ATR_Ratio, Mid_Dev, Session_Phase]
const long     ExtShapeOut[]        = {1, 3};     // [Batch, 3 Classes: Short, Neutral, Long]

//+------------------------------------------------------------------+
//| Load (or reload, if the file's mtime changed) the ONNX model     |
//| from MQL5/Files/ at runtime -- no recompile needed to pick up a  |
//| newly retrained model.                                           |
//+------------------------------------------------------------------+
void ReloadModelIfChanged()
{
   if(!FileIsExist(InpModelFile))
   {
      if(ExtOnnxHandle == INVALID_HANDLE)
         PrintFormat("[HOT-RELOAD] %s not found in MQL5/Files/ -- no model loaded yet.", InpModelFile);
      return;
   }

   datetime mtime = (datetime)FileGetInteger(InpModelFile, FILE_MODIFY_DATE);
   if(mtime == ExtModelFileTime && ExtOnnxHandle != INVALID_HANDLE)
      return; // unchanged, nothing to do

   long newHandle = OnnxCreate(InpModelFile, ONNX_DEFAULT);
   if(newHandle == INVALID_HANDLE)
   {
      PrintFormat("[HOT-RELOAD] OnnxCreate(%s) failed: %d -- keeping current model.", InpModelFile, GetLastError());
      return;
   }

   if(!OnnxSetInputShape(newHandle, 0, ExtShapeIn) || !OnnxSetOutputShape(newHandle, 0, ExtShapeOut))
   {
      PrintFormat("[HOT-RELOAD] New model at %s failed shape validation: %d -- keeping current model.", InpModelFile, GetLastError());
      OnnxRelease(newHandle);
      return;
   }

   if(ExtOnnxHandle != INVALID_HANDLE)
      OnnxRelease(ExtOnnxHandle);
   ExtOnnxHandle = newHandle;
   ExtModelFileTime = mtime;
   PrintFormat("[HOT-RELOAD] Model (re)loaded from %s.", InpModelFile);
}

//+------------------------------------------------------------------+
//| Re-read risk parameters from InpParamsFile (plain key=value       |
//| lines). Missing/unreadable file => keep current in-memory values  |
//| (fail-safe, not fail-open to different values). Every value is    |
//| clamped to the SAFETY_* ceilings above regardless of file content.|
//+------------------------------------------------------------------+
void ReloadParams()
{
   int fh = FileOpen(InpParamsFile, FILE_READ | FILE_TXT | FILE_ANSI);
   if(fh == INVALID_HANDLE)
      return;

   double newRisk = EffRiskPercent, newProb = EffProbThreshold;
   double newAtrStop = EffAtrStopMultiplier, newAtrTake = EffAtrTakeMultiplier, newSpread = EffMaxSpreadPips;
   bool invalidValue = false;

   while(!FileIsEnding(fh))
   {
      string line = FileReadString(fh);
      int eq = StringFind(line, "=");
      if(eq <= 0)
         continue;

      string key = StringSubstr(line, 0, eq);
      string val = StringSubstr(line, eq + 1);
      StringTrimLeft(key);  StringTrimRight(key);
      StringTrimLeft(val);  StringTrimRight(val);
      double v = StringToDouble(val);
      bool knownKey = (key == "risk_percent" || key == "prob_threshold" ||
                       key == "atr_stop_multiplier" || key == "atr_take_multiplier" ||
                       key == "max_spread_pips");
      if(!knownKey)
         continue;
      if(!MathIsValidNumber(v) || v <= 0.0)
      {
         invalidValue = true;
         continue;
      }

      if(key == "risk_percent")             newRisk = v;
      else if(key == "prob_threshold")      newProb = v;
      else if(key == "atr_stop_multiplier") newAtrStop = v;
      else if(key == "atr_take_multiplier") newAtrTake = v;
      else if(key == "max_spread_pips")     newSpread = v;
   }
   FileClose(fh);

   if(invalidValue)
   {
      PrintFormat("[HOT-RELOAD] Invalid numeric value in %s; keeping the complete previous parameter set.", InpParamsFile);
      return;
   }

   // Hard safety clamp -- independent of what the file says.
   newRisk    = MathMax(SAFETY_MIN_RISK_PERCENT, MathMin(SAFETY_MAX_RISK_PERCENT, newRisk));
   newProb    = MathMax(SAFETY_MIN_PROB_THRESHOLD, MathMin(SAFETY_MAX_PROB_THRESHOLD, newProb));
   newAtrStop = MathMax(SAFETY_MIN_ATR_MULT, MathMin(SAFETY_MAX_ATR_STOP_MULT, newAtrStop));
   newAtrTake = MathMax(SAFETY_MIN_ATR_MULT, MathMin(SAFETY_MAX_ATR_TAKE_MULT, newAtrTake));
   newSpread  = MathMax(SAFETY_MIN_MAX_SPREAD_PIPS, MathMin(SAFETY_MAX_MAX_SPREAD_PIPS, newSpread));

   if(newRisk != EffRiskPercent || newProb != EffProbThreshold || newAtrStop != EffAtrStopMultiplier ||
      newAtrTake != EffAtrTakeMultiplier || newSpread != EffMaxSpreadPips)
   {
      PrintFormat("[HOT-RELOAD] Params updated: risk=%.2f%% prob=%.2f atrStop=%.2f atrTake=%.2f spread=%.2fpips",
                  newRisk, newProb, newAtrStop, newAtrTake, newSpread);
   }

   EffRiskPercent = newRisk;
   EffProbThreshold = newProb;
   EffAtrStopMultiplier = newAtrStop;
   EffAtrTakeMultiplier = newAtrTake;
   EffMaxSpreadPips = newSpread;
}

//+------------------------------------------------------------------+
//| Reset the drawdown baseline at the first quote of each broker day|
//+------------------------------------------------------------------+
void ResetDailyEquityIfNeeded()
{
   MqlDateTime serverTime;
   TimeToStruct(TimeCurrent(), serverTime);
   int dayKey = serverTime.year * 1000 + serverTime.day_of_year;
   if(dayKey == ExtDailyEquityDay)
      return;

   ExtDailyEquityDay = dayKey;
   ExtDailyStartEquity = AccountInfoDouble(ACCOUNT_EQUITY);
   PrintFormat("[RISK] New broker day: equity baseline reset to %.2f.", ExtDailyStartEquity);
}

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

   ResetDailyEquityIfNeeded();

   // Effective params start at the compiled defaults; ReloadParams() below
   // may immediately override them from InpParamsFile if present.
   EffRiskPercent = InpRiskPercent;
   EffProbThreshold = InpProbThreshold;
   EffAtrStopMultiplier = InpAtrStopMultiplier;
   EffAtrTakeMultiplier = InpAtrTakeMultiplier;
   EffMaxSpreadPips = InpMaxSpreadPips;
   if(!MathIsValidNumber(EffRiskPercent) || !MathIsValidNumber(EffProbThreshold) ||
      !MathIsValidNumber(EffAtrStopMultiplier) || !MathIsValidNumber(EffAtrTakeMultiplier) ||
      !MathIsValidNumber(EffMaxSpreadPips) || InpReloadSeconds <= 0)
   {
      Print("[ERROR] Invalid initial risk parameter or reload interval.");
      return(INIT_PARAMETERS_INCORRECT);
   }
   EffRiskPercent = MathMax(SAFETY_MIN_RISK_PERCENT, MathMin(SAFETY_MAX_RISK_PERCENT, EffRiskPercent));
   EffProbThreshold = MathMax(SAFETY_MIN_PROB_THRESHOLD, MathMin(SAFETY_MAX_PROB_THRESHOLD, EffProbThreshold));
   EffAtrStopMultiplier = MathMax(SAFETY_MIN_ATR_MULT, MathMin(SAFETY_MAX_ATR_STOP_MULT, EffAtrStopMultiplier));
   EffAtrTakeMultiplier = MathMax(SAFETY_MIN_ATR_MULT, MathMin(SAFETY_MAX_ATR_TAKE_MULT, EffAtrTakeMultiplier));
   EffMaxSpreadPips = MathMax(SAFETY_MIN_MAX_SPREAD_PIPS, MathMin(SAFETY_MAX_MAX_SPREAD_PIPS, EffMaxSpreadPips));

   // Initialize ATR Indicator
   ExtAtrHandle = iATR(ExtSymbol, PERIOD_M5, 14);
   if(ExtAtrHandle == INVALID_HANDLE)
   {
      PrintFormat("[ERROR] Failed to create ATR handle for %s.", ExtSymbol);
      return(INIT_FAILED);
   }

   // Load ONNX model from MQL5/Files/ (hot-reloadable -- see ReloadModelIfChanged)
   ReloadModelIfChanged();
   if(ExtOnnxHandle == INVALID_HANDLE)
   {
      PrintFormat("[ERROR] No ONNX model loaded. Place %s in MQL5/Files/ and reattach.", InpModelFile);
      return(INIT_FAILED);
   }

   ReloadParams();

   EventSetTimer(InpReloadSeconds);

   PrintFormat("[INIT] ONNX_Forex_Predictor initialized for %s (Magic: %d). Measure latency on the target VPS. Hot-reload every %ds.",
               ExtSymbol, InpMagicNumber, InpReloadSeconds);
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   if(ExtOnnxHandle != INVALID_HANDLE)
   {
      OnnxRelease(ExtOnnxHandle);
      ExtOnnxHandle = INVALID_HANDLE;
   }
   if(ExtAtrHandle != INVALID_HANDLE)
      IndicatorRelease(ExtAtrHandle);
}

//+------------------------------------------------------------------+
//| Timer: check for a new model file / updated risk params every    |
//| InpReloadSeconds. This is how Hermes' reflection cycle takes     |
//| effect on the live EA without any recompile or reattach.         |
//+------------------------------------------------------------------+
void OnTimer()
{
   ReloadModelIfChanged();
   ReloadParams();

   if(!ExtDiagHasData)
   {
      PrintFormat("[STATUS] No tick evaluated yet since init (waiting for a tick, or Algo Trading was just enabled).");
      return;
   }

   if(!ExtDiagPassedGuards)
   {
      PrintFormat("[STATUS] Last eval @ %s: BLOCKED by risk guards (spread=%.2fpips, limit=%.2fpips, or daily circuit breaker / position already open).",
                  TimeToString(ExtDiagEvalTime, TIME_SECONDS), ExtDiagSpreadPips, EffMaxSpreadPips);
   }
   else
   {
      PrintFormat("[STATUS] Last eval @ %s: spread=%.2fpips P(short)=%.2f P(neutral)=%.2f P(long)=%.2f threshold=%.2f -- %s",
                  TimeToString(ExtDiagEvalTime, TIME_SECONDS), ExtDiagSpreadPips,
                  ExtDiagPShort, ExtDiagPNeutral, ExtDiagPLong, EffProbThreshold,
                  (ExtDiagPLong >= EffProbThreshold || ExtDiagPShort >= EffProbThreshold) ? "THRESHOLD MET" : "below threshold, waiting");
   }
}

//+------------------------------------------------------------------+
//| Log every closed trade for this EA's magic number to a JSONL     |
//| file Hermes reflects on -- same shape score.py already expects.  |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &request, const MqlTradeResult &result)
{
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD)
      return;
   if(!HistoryDealSelect(trans.deal))
      return;
   if(HistoryDealGetInteger(trans.deal, DEAL_MAGIC) != InpMagicNumber)
      return;
   if(HistoryDealGetInteger(trans.deal, DEAL_ENTRY) != DEAL_ENTRY_OUT)
      return; // only log closing deals, not the opening deal of a position

   long   positionId = HistoryDealGetInteger(trans.deal, DEAL_POSITION_ID);
   double closePrice = HistoryDealGetDouble(trans.deal, DEAL_PRICE);
   double grossProfit = HistoryDealGetDouble(trans.deal, DEAL_PROFIT);
   double commission  = HistoryDealGetDouble(trans.deal, DEAL_COMMISSION);
   double swap         = HistoryDealGetDouble(trans.deal, DEAL_SWAP);
   double fee          = HistoryDealGetDouble(trans.deal, DEAL_FEE);
   double volume       = HistoryDealGetDouble(trans.deal, DEAL_VOLUME);
   string symbol       = HistoryDealGetString(trans.deal, DEAL_SYMBOL);
   long   closeDealType = HistoryDealGetInteger(trans.deal, DEAL_TYPE);

   // Resolve the position's volume-weighted entry and its opening costs. Many
   // brokers charge commission on entry, so close-deal costs alone overstate P&L.
   double openPrice = 0.0;
   double entryVolume = 0.0;
   double entryCosts = 0.0;
   if(HistorySelectByPosition(positionId))
   {
      int total = HistoryDealsTotal();
      for(int i = 0; i < total; i++)
      {
         ulong dealTicket = HistoryDealGetTicket(i);
         if(HistoryDealGetInteger(dealTicket, DEAL_ENTRY) == DEAL_ENTRY_IN)
         {
            double dealVolume = HistoryDealGetDouble(dealTicket, DEAL_VOLUME);
            openPrice += HistoryDealGetDouble(dealTicket, DEAL_PRICE) * dealVolume;
            entryVolume += dealVolume;
            entryCosts += HistoryDealGetDouble(dealTicket, DEAL_COMMISSION)
                        + HistoryDealGetDouble(dealTicket, DEAL_SWAP)
                        + HistoryDealGetDouble(dealTicket, DEAL_FEE);
         }
      }
   }
   if(entryVolume <= 0.0)
      return; // couldn't resolve entry price -- skip rather than log a bad row
   openPrice /= entryVolume;

   // Allocate entry costs by the fraction closed, which also avoids counting the
   // full opening commission more than once if a position is partially closed.
   double entryCostShare = entryCosts * MathMin(volume / entryVolume, 1.0);
   double netProfit = grossProfit + commission + swap + fee + entryCostShare;

   // A closing SELL deal means the position was long; a closing BUY means it was short.
   double priceReturnPct;
   if(closeDealType == DEAL_TYPE_SELL)
      priceReturnPct = (closePrice - openPrice) / openPrice;
   else
      priceReturnPct = (openPrice - closePrice) / openPrice;

   // Hermes compounds pnl_pct as an account-equity return. Reconstruct the
   // pre-deal balance because ACCOUNT_BALANCE already includes this closing deal.
   double balanceAfter = AccountInfoDouble(ACCOUNT_BALANCE);
   double balanceBefore = balanceAfter - netProfit;
   if(balanceBefore <= 0.0 || !MathIsValidNumber(netProfit))
      return;
   double pnlPct = netProfit / balanceBefore;

   string json = StringFormat(
      "{\"ts\":%I64d,\"deal_ticket\":%I64u,\"position_id\":%I64d,\"symbol\":\"%s\",\"entry_price\":%.5f,\"exit_price\":%.5f,\"lots\":%.2f,\"price_return_pct\":%.6f,\"pnl_pct\":%.6f,\"profit\":%.2f}",
      (long)TimeCurrent(), trans.deal, positionId, symbol, openPrice, closePrice,
      volume, priceReturnPct, pnlPct, netProfit);

   int fh = FileOpen(InpTradesLogFile, FILE_READ | FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(fh != INVALID_HANDLE)
   {
      FileSeek(fh, 0, SEEK_END);
      FileWriteString(fh, json + "\n");
      FileClose(fh);
      PrintFormat("[TRADE LOG] Closed %s account_return=%.4f%% net_profit=%.2f -> %s", symbol, pnlPct * 100, netProfit, InpTradesLogFile);
   }
   else
   {
      PrintFormat("[TRADE LOG] Failed to open %s for append: %d", InpTradesLogFile, GetLastError());
   }
}

//+------------------------------------------------------------------+
//| Circuit Breaker & Safety Checks                                  |
//+------------------------------------------------------------------+
bool PassesRiskGuards(double spreadPips)
{
   ResetDailyEquityIfNeeded();

   // 1. Max Spread Check
   if(spreadPips > EffMaxSpreadPips)
      return false;

   // 2. Daily 2% Drawdown Circuit Breaker
   double currentEquity = AccountInfoDouble(ACCOUNT_EQUITY);
   if(ExtDailyStartEquity <= 0.0 || currentEquity <= 0.0)
      return false;
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
   double riskAmount = balance * (EffRiskPercent / 100.0);
   double tickValue = SymbolInfoDouble(ExtSymbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSize  = SymbolInfoDouble(ExtSymbol, SYMBOL_TRADE_TICK_SIZE);
   double point     = SymbolInfoDouble(ExtSymbol, SYMBOL_POINT);
   if(balance <= 0.0 || riskAmount <= 0.0 || tickValue <= 0.0 || point <= 0.0 || slPips <= 0.0)
      return 0.0;
   if(tickSize <= 0) tickSize = point;

   int digits = (int)SymbolInfoInteger(ExtSymbol, SYMBOL_DIGITS);
   double pipUnit = (digits == 3 || digits == 5 ? 10.0 * point : point);
   double slDistance = slPips * pipUnit;

   double pointLossPerLot = (slDistance / tickSize) * tickValue;
   if(pointLossPerLot <= 0.0) return 0.0;

   double calculatedLots = riskAmount / pointLossPerLot;

   // Check broker constraints and safety cap
   double step   = SymbolInfoDouble(ExtSymbol, SYMBOL_VOLUME_STEP);
   double minLot = SymbolInfoDouble(ExtSymbol, SYMBOL_VOLUME_MIN);
   double maxLot = SymbolInfoDouble(ExtSymbol, SYMBOL_VOLUME_MAX);
   if(step <= 0.0 || minLot <= 0.0 || maxLot < minLot)
      return 0.0;

   if(InpMaxLotCap > 0 && InpMaxLotCap < maxLot)
      maxLot = InpMaxLotCap;
   if(maxLot < minLot)
      return 0.0;
   if(calculatedLots < minLot)
   {
      PrintFormat("[RISK] Calculated volume %.8f is below safe broker minimum %.8f; order skipped.", calculatedLots, minLot);
      return 0.0;
   }

   double lots = MathFloor(calculatedLots / step) * step;
   lots = MathMin(maxLot, lots);
   if(lots < minLot)
      return 0.0;
   return NormalizeDouble(lots, 8);
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

   ExtDiagHasData = true;
   ExtDiagEvalTime = tick.time;
   ExtDiagSpreadPips = spreadPips;
   ExtDiagPassedGuards = PassesRiskGuards(spreadPips);
   if(!ExtDiagPassedGuards) return;

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
   inputFeatures[1] = (float)MathMin(2.0, spreadPips / EffMaxSpreadPips);                                          // Spread Norm
   inputFeatures[2] = (float)(atrValues[0] / (atrValues[2] + 1e-6));                                               // ATR Expansion
   inputFeatures[3] = (float)((tick.ask - midPrice) / (point * 10.0 + 1e-6));                                      // Mid Dev
   inputFeatures[4] = (float)(MathSin((double)(tick.time % 86400) / 86400.0 * 2.0 * 3.14159265));                  // Session Phase

   float outputProbs[3]; // [P(Short), P(Neutral), P(Long)]

   // Execute in-process ONNX inference; latency is environment-dependent.
   if(!OnnxRun(ExtOnnxHandle, ONNX_DEFAULT, inputFeatures, outputProbs))
   {
      PrintFormat("[ERROR] OnnxRun failed: %d", GetLastError());
      return;
   }

   float pShort = outputProbs[0];
   float pLong  = outputProbs[2];
   double probabilitySum = outputProbs[0] + outputProbs[1] + outputProbs[2];
   if(!MathIsValidNumber(outputProbs[0]) || !MathIsValidNumber(outputProbs[1]) ||
      !MathIsValidNumber(outputProbs[2]) || outputProbs[0] < 0.0 || outputProbs[0] > 1.0 ||
      outputProbs[1] < 0.0 || outputProbs[1] > 1.0 || outputProbs[2] < 0.0 ||
      outputProbs[2] > 1.0 || MathAbs(probabilitySum - 1.0) > 0.05)
   {
      PrintFormat("[MODEL GUARD] Invalid probability vector [%.6f, %.6f, %.6f]; signal rejected.",
                  outputProbs[0], outputProbs[1], outputProbs[2]);
      return;
   }

   ExtDiagPShort = outputProbs[0];
   ExtDiagPNeutral = outputProbs[1];
   ExtDiagPLong = outputProbs[2];

   double slDistance = atrPips * EffAtrStopMultiplier * (digits == 3 || digits == 5 ? 10 * point : point);
   double tpDistance = atrPips * EffAtrTakeMultiplier * (digits == 3 || digits == 5 ? 10 * point : point);
   double lots = CalculateLotSize(atrPips * EffAtrStopMultiplier);
   if(lots <= 0.0) return;

   // Long Signal
   if(pLong >= EffProbThreshold && pLong > pShort)
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
   else if(pShort >= EffProbThreshold && pShort > pLong)
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
