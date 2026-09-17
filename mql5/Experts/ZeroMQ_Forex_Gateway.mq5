//+------------------------------------------------------------------+
//|                                    ZeroMQ_Forex_Gateway.mq5      |
//| Native TCP client for the local Docker/ZeroMQ bridge             |
//+------------------------------------------------------------------+
#property copyright "Quant Developer & Scientist"
#property link      "https://github.com/raduolivas/mq5balistictrader"
#property version   "3.00"
#property strict

#include <Trade\Trade.mqh>

input group "=== Local Docker Bridge ==="
input string InpBridgeHost             = "127.0.0.1";
input uint   InpBridgePort             = 5555;
input string InpSymbol                 = "EURUSD";
input int    InpMagicNumber            = 889900;
input uint   InpTimerMilliseconds      = 50;
input uint   InpReconnectSeconds       = 3;
input uint   InpSignalTtlMilliseconds  = 5000;
input uint   InpMaxFutureSkewMs        = 1000;

input group "=== Execution Safety (opt-in) ==="
input bool   InpExecutionEnabled       = false;
input bool   InpAllowRealAccount       = false;
input double InpMinimumProbability     = 0.70;
input double InpRiskPercent            = 0.50;
input double InpMaxLotCap              = 1.00;
input double InpMaxSpreadPips          = 1.50;
input double InpMaxDailyDrawdownPct    = 3.00;
input double InpAtrStopMultiplier      = 2.00;
input double InpAtrTakeMultiplier      = 2.50;
input int    InpAtrPeriod              = 14;
input int    InpMaxDeviationPoints     = 10;

CTrade ExtTrade;
int ExtSocket = INVALID_HANDLE;
int ExtAtrHandle = INVALID_HANDLE;
bool ExtBridgeReady = false;
string ExtReceiveBuffer = "";
datetime ExtNextReconnectAt = 0;
long ExtLastSignalTimeMsc = 0;
long ExtLastSentTickTimeMsc = 0;
MqlTick ExtLatestTick;
double ExtDailyStartEquity = 0.0;
int ExtDailyEquityDay = -1;
double ExtUpTickCounter = 0.0;
double ExtDownTickCounter = 0.0;
double ExtPreviousMid = 0.0;

int ServerDayKey()
{
   MqlDateTime parts;
   TimeToStruct(TimeCurrent(), parts);
   return parts.year * 1000 + parts.day_of_year;
}

void ResetDailyEquityIfNeeded()
{
   int dayKey = ServerDayKey();
   if(dayKey != ExtDailyEquityDay)
   {
      ExtDailyEquityDay = dayKey;
      ExtDailyStartEquity = AccountInfoDouble(ACCOUNT_EQUITY);
   }
}

bool InputsAreValid()
{
   if(InpBridgeHost == "" || InpBridgePort == 0 || InpSymbol == "") return false;
   if(InpMagicNumber <= 0 || InpTimerMilliseconds < 10) return false;
   if(InpSignalTtlMilliseconds < 100 || InpReconnectSeconds < 1) return false;
   if(!MathIsValidNumber(InpMinimumProbability) || InpMinimumProbability <= 0.0 || InpMinimumProbability > 1.0) return false;
   if(!MathIsValidNumber(InpRiskPercent) || InpRiskPercent <= 0.0 || InpRiskPercent > 5.0) return false;
   if(!MathIsValidNumber(InpMaxLotCap) || InpMaxLotCap <= 0.0) return false;
   if(!MathIsValidNumber(InpMaxSpreadPips) || InpMaxSpreadPips <= 0.0) return false;
   if(!MathIsValidNumber(InpMaxDailyDrawdownPct) || InpMaxDailyDrawdownPct <= 0.0 || InpMaxDailyDrawdownPct > 20.0) return false;
   if(!MathIsValidNumber(InpAtrStopMultiplier) || InpAtrStopMultiplier <= 0.0) return false;
   if(!MathIsValidNumber(InpAtrTakeMultiplier) || InpAtrTakeMultiplier <= 0.0) return false;
   if(InpAtrPeriod < 2 || InpMaxDeviationPoints < 0) return false;
   return true;
}

int OnInit()
{
   if(!InputsAreValid())
   {
      Print("[BRIDGE] Invalid input configuration.");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(!SymbolSelect(InpSymbol, true))
   {
      Print("[BRIDGE] Cannot select symbol: ", InpSymbol);
      return INIT_FAILED;
   }
   ExtAtrHandle = iATR(InpSymbol, PERIOD_M5, InpAtrPeriod);
   if(ExtAtrHandle == INVALID_HANDLE)
   {
      Print("[BRIDGE] Cannot create ATR handle. Error: ", GetLastError());
      return INIT_FAILED;
   }
   ExtTrade.SetExpertMagicNumber(InpMagicNumber);
   ExtTrade.SetMarginMode();
   ExtTrade.SetTypeFillingBySymbol(InpSymbol);
   ExtTrade.SetDeviationInPoints(InpMaxDeviationPoints);
   ResetDailyEquityIfNeeded();
   EventSetMillisecondTimer((int)InpTimerMilliseconds);
   Print("[BRIDGE] Initialized safely. ExecutionEnabled=", InpExecutionEnabled,
         ", AllowRealAccount=", InpAllowRealAccount,
         ". Add 127.0.0.1 to MT5 allowed addresses.");
   return INIT_SUCCEEDED;
}

void CloseBridge()
{
   if(ExtSocket != INVALID_HANDLE)
   {
      SocketClose(ExtSocket);
      ExtSocket = INVALID_HANDLE;
   }
   ExtBridgeReady = false;
   ExtReceiveBuffer = "";
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   CloseBridge();
   if(ExtAtrHandle != INVALID_HANDLE) IndicatorRelease(ExtAtrHandle);
   Print("[BRIDGE] Shut down cleanly. Reason: ", reason);
}

bool SendLine(const string line)
{
   if(ExtSocket == INVALID_HANDLE || !SocketIsConnected(ExtSocket)) return false;
   uchar payload[];
   int size = StringToCharArray(line + "\n", payload, 0, WHOLE_ARRAY, CP_UTF8);
   if(size <= 1) return false;
   int payloadSize = size - 1;
   int sent = SocketSend(ExtSocket, payload, (uint)payloadSize);
   if(sent != payloadSize)
   {
      Print("[BRIDGE] Socket send failed. Error: ", GetLastError());
      CloseBridge();
      return false;
   }
   return true;
}

void TryConnectBridge()
{
   if(ExtSocket != INVALID_HANDLE && SocketIsConnected(ExtSocket)) return;
   if(TimeLocal() < ExtNextReconnectAt) return;
   CloseBridge();
   ExtNextReconnectAt = TimeLocal() + (datetime)InpReconnectSeconds;
   ExtSocket = SocketCreate();
   if(ExtSocket == INVALID_HANDLE)
   {
      Print("[BRIDGE] SocketCreate failed. Error: ", GetLastError());
      return;
   }
   if(!SocketConnect(ExtSocket, InpBridgeHost, InpBridgePort, 1000))
   {
      Print("[BRIDGE] Connect failed. Is Docker healthy and 127.0.0.1 allowlisted? Error: ", GetLastError());
      CloseBridge();
      return;
   }
   string hello = StringFormat("HELLO|1|%s|%d", InpSymbol, InpMagicNumber);
   if(!SendLine(hello)) return;
   Print("[BRIDGE] TCP connected; waiting for READY handshake.");
}

double PipSize()
{
   int digits = (int)SymbolInfoInteger(InpSymbol, SYMBOL_DIGITS);
   double point = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   return (digits == 3 || digits == 5) ? point * 10.0 : point;
}

bool HasManagedPosition()
{
   for(int index = PositionsTotal() - 1; index >= 0; --index)
   {
      ulong ticket = PositionGetTicket(index);
      if(ticket == 0 || !PositionSelectByTicket(ticket)) continue;
      if(PositionGetString(POSITION_SYMBOL) == InpSymbol &&
         PositionGetInteger(POSITION_MAGIC) == InpMagicNumber)
         return true;
   }
   return false;
}

bool PassesRiskGuards(const double spreadPips, string &reason)
{
   ResetDailyEquityIfNeeded();
   if(!InpExecutionEnabled)
   {
      reason = "EXECUTION_DISABLED";
      return false;
   }
   ENUM_ACCOUNT_TRADE_MODE mode = (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE);
   if(mode == ACCOUNT_TRADE_MODE_REAL && !InpAllowRealAccount)
   {
      reason = "REAL_ACCOUNT_BLOCKED";
      return false;
   }
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED))
   {
      reason = "ALGO_TRADING_DISABLED";
      return false;
   }
   if(!MathIsValidNumber(spreadPips) || spreadPips > InpMaxSpreadPips)
   {
      reason = "SPREAD_REJECTED";
      return false;
   }
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   if(ExtDailyStartEquity <= 0.0 || equity <= 0.0 ||
      equity <= ExtDailyStartEquity * (1.0 - InpMaxDailyDrawdownPct / 100.0))
   {
      reason = "DAILY_DRAWDOWN";
      return false;
   }
   if(HasManagedPosition())
   {
      reason = "POSITION_EXISTS";
      return false;
   }
   return true;
}

double CalculateLotSize(const ENUM_ORDER_TYPE orderType,
                        const double entryPrice,
                        const double stopPrice)
{
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double riskMoney = balance * InpRiskPercent / 100.0;
   if(!MathIsValidNumber(riskMoney) || riskMoney <= 0.0) return 0.0;

   double lossForOneLot = 0.0;
   if(!OrderCalcProfit(orderType, InpSymbol, 1.0, entryPrice, stopPrice, lossForOneLot))
   {
      double tickSize = SymbolInfoDouble(InpSymbol, SYMBOL_TRADE_TICK_SIZE);
      double tickValue = SymbolInfoDouble(InpSymbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
      if(tickValue <= 0.0) tickValue = SymbolInfoDouble(InpSymbol, SYMBOL_TRADE_TICK_VALUE);
      if(tickSize <= 0.0 || tickValue <= 0.0) return 0.0;
      lossForOneLot = -MathAbs(entryPrice - stopPrice) / tickSize * tickValue;
   }
   lossForOneLot = MathAbs(lossForOneLot);
   if(!MathIsValidNumber(lossForOneLot) || lossForOneLot <= 0.0) return 0.0;

   double minLot = SymbolInfoDouble(InpSymbol, SYMBOL_VOLUME_MIN);
   double maxLot = MathMin(SymbolInfoDouble(InpSymbol, SYMBOL_VOLUME_MAX), InpMaxLotCap);
   double lotStep = SymbolInfoDouble(InpSymbol, SYMBOL_VOLUME_STEP);
   if(minLot <= 0.0 || maxLot < minLot || lotStep <= 0.0) return 0.0;
   double calculatedLots = MathFloor((riskMoney / lossForOneLot) / lotStep) * lotStep;
   if(calculatedLots < minLot) return 0.0;
   calculatedLots = MathMin(calculatedLots, maxLot);
   int volumeDigits = (int)MathMax(0.0, MathRound(-MathLog10(lotStep)));
   return NormalizeDouble(calculatedLots, volumeDigits);
}

void Acknowledge(const long signalTimeMsc, const string status)
{
   SendLine(StringFormat("ACK|%s|%I64d|%s", InpSymbol, signalTimeMsc, status));
}

void HandleSignal(const string line)
{
   string fields[];
   ushort separator = StringGetCharacter("|", 0);
   int count = StringSplit(line, separator, fields);
   if(count != 5 || fields[0] != "SIGNAL") return;

   string side = fields[1];
   string symbol = fields[2];
   double probability = StringToDouble(fields[3]);
   long signalTimeMsc = StringToInteger(fields[4]);
   if((side != "BUY" && side != "SELL") || symbol != InpSymbol ||
      !MathIsValidNumber(probability) || probability < 0.0 || probability > 1.0 ||
      signalTimeMsc <= 0)
   {
      Print("[BRIDGE] Malformed or wrong-symbol signal rejected.");
      return;
   }
   if(signalTimeMsc <= ExtLastSignalTimeMsc)
   {
      Acknowledge(signalTimeMsc, "REPLAY_REJECTED");
      return;
   }
   long nowMsc = ExtLatestTick.time_msc;
   if(nowMsc <= 0) nowMsc = (long)TimeCurrent() * 1000;
   long signalAge = nowMsc - signalTimeMsc;
   if(signalAge > (long)InpSignalTtlMilliseconds || signalAge < -(long)InpMaxFutureSkewMs)
   {
      ExtLastSignalTimeMsc = signalTimeMsc;
      Acknowledge(signalTimeMsc, "STALE_REJECTED");
      return;
   }
   ExtLastSignalTimeMsc = signalTimeMsc;
   if(probability < InpMinimumProbability)
   {
      Acknowledge(signalTimeMsc, "CONFIDENCE_REJECTED");
      return;
   }

   MqlTick tick;
   if(!SymbolInfoTick(InpSymbol, tick) || tick.ask <= tick.bid || tick.bid <= 0.0)
   {
      Acknowledge(signalTimeMsc, "NO_MARKET_DATA");
      return;
   }
   double spreadPips = (tick.ask - tick.bid) / PipSize();
   string reason = "";
   if(!PassesRiskGuards(spreadPips, reason))
   {
      Acknowledge(signalTimeMsc, reason);
      return;
   }

   double atrValues[1];
   if(CopyBuffer(ExtAtrHandle, 0, 1, 1, atrValues) != 1 ||
      !MathIsValidNumber(atrValues[0]) || atrValues[0] <= 0.0)
   {
      Acknowledge(signalTimeMsc, "ATR_UNAVAILABLE");
      return;
   }
   bool isBuy = (side == "BUY");
   double entry = isBuy ? tick.ask : tick.bid;
   double stopDistance = atrValues[0] * InpAtrStopMultiplier;
   double takeDistance = atrValues[0] * InpAtrTakeMultiplier;
   double minimumStopDistance = (double)SymbolInfoInteger(InpSymbol, SYMBOL_TRADE_STOPS_LEVEL) *
                                SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   if(stopDistance < minimumStopDistance || takeDistance < minimumStopDistance)
   {
      Acknowledge(signalTimeMsc, "BROKER_STOP_LIMIT");
      return;
   }
   double stop = isBuy ? entry - stopDistance : entry + stopDistance;
   double take = isBuy ? entry + takeDistance : entry - takeDistance;
   ENUM_ORDER_TYPE orderType = isBuy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   double lots = CalculateLotSize(orderType, entry, stop);
   if(lots <= 0.0)
   {
      Acknowledge(signalTimeMsc, "RISK_SIZE_REJECTED");
      return;
   }
   int digits = (int)SymbolInfoInteger(InpSymbol, SYMBOL_DIGITS);
   stop = NormalizeDouble(stop, digits);
   take = NormalizeDouble(take, digits);
   bool submitted = isBuy
                    ? ExtTrade.Buy(lots, InpSymbol, 0.0, stop, take, "ZMQ signal")
                    : ExtTrade.Sell(lots, InpSymbol, 0.0, stop, take, "ZMQ signal");
   if(!submitted)
   {
      Print("[BRIDGE] Order rejected: ", ExtTrade.ResultRetcode(), " ", ExtTrade.ResultRetcodeDescription());
      Acknowledge(signalTimeMsc, "ORDER_REJECTED");
      return;
   }
   Acknowledge(signalTimeMsc, "ORDER_SUBMITTED");
}

void HandleBridgeLine(string line)
{
   StringReplace(line, "\r", "");
   if(StringFind(line, "READY|1|") == 0)
   {
      string expected = "READY|1|" + InpSymbol;
      if(line == expected)
      {
         ExtBridgeReady = true;
         Print("[BRIDGE] Handshake ready for ", InpSymbol);
      }
      return;
   }
   if(StringFind(line, "SIGNAL|") == 0)
   {
      HandleSignal(line);
      return;
   }
   if(StringFind(line, "ERROR|") == 0)
      Print("[BRIDGE] Protocol error from bridge: ", line);
}

void ReadBridgeFrames()
{
   if(ExtSocket == INVALID_HANDLE || !SocketIsConnected(ExtSocket))
   {
      CloseBridge();
      return;
   }
   for(int readCount = 0; readCount < 8; ++readCount)
   {
      uint available = SocketIsReadable(ExtSocket);
      if(available == 0) break;
      uint requested = MathMin(available, (uint)2048);
      uchar chunk[];
      int received = SocketRead(ExtSocket, chunk, requested, 1);
      if(received <= 0) break;
      ExtReceiveBuffer += CharArrayToString(chunk, 0, received, CP_UTF8);
      if(StringLen(ExtReceiveBuffer) > 4096)
      {
         Print("[BRIDGE] Receive buffer limit exceeded.");
         CloseBridge();
         return;
      }
      int newline = StringFind(ExtReceiveBuffer, "\n");
      while(newline >= 0)
      {
         string completeLine = StringSubstr(ExtReceiveBuffer, 0, newline);
         ExtReceiveBuffer = StringSubstr(ExtReceiveBuffer, newline + 1);
         HandleBridgeLine(completeLine);
         newline = StringFind(ExtReceiveBuffer, "\n");
      }
   }
}

void OnTick()
{
   MqlTick tick;
   if(!SymbolInfoTick(InpSymbol, tick)) return;
   ExtLatestTick = tick;
   double mid = (tick.bid + tick.ask) * 0.5;
   if(ExtPreviousMid > 0.0)
   {
      if(mid > ExtPreviousMid) ExtUpTickCounter += 1.0;
      else if(mid < ExtPreviousMid) ExtDownTickCounter += 1.0;
   }
   ExtPreviousMid = mid;
   if(!ExtBridgeReady || tick.time_msc <= ExtLastSentTickTimeMsc) return;
   int digits = (int)SymbolInfoInteger(InpSymbol, SYMBOL_DIGITS);
   string tickMessage = StringFormat(
      "TICK|%s|%I64d|%.*f|%.*f|%.*f|%.0f|%.0f",
      InpSymbol, tick.time_msc,
      digits, tick.bid, digits, tick.ask, digits, tick.last,
      ExtUpTickCounter, ExtDownTickCounter);
   if(SendLine(tickMessage)) ExtLastSentTickTimeMsc = tick.time_msc;
}

void OnTimer()
{
   ResetDailyEquityIfNeeded();
   TryConnectBridge();
   ReadBridgeFrames();
}
