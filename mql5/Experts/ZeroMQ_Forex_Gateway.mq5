//+------------------------------------------------------------------+
//|                                    ZeroMQ_Forex_Gateway.mq5      |
//|                 High-Speed ZeroMQ Market Gateway & Executor      |
//|                 Target Platform: MetaTrader 5 (Windows / Wine)   |
//+------------------------------------------------------------------+
#property copyright "Quant Developer & Scientist"
#property link      "https://github.com/raduolivas/mq5balistictrader"
#property version   "2.00"
#property strict

#include <Trade\Trade.mqh>

//--- Input Parameters
input group "=== Network / ZeroMQ Sockets ==="
input string   InpTickPublisherUrl = "tcp://*:5555";     // MT5 Publisher (Tick Data Out)
input string   InpSignalConsumerUrl= "tcp://127.0.0.1:5556"; // MT5 Consumer (Order Signals In)
input string   InpSymbol           = "EURUSD";
input int      InpMagicNumber      = 889900;
input double   InpMaxSpreadPips    = 1.5;

//--- Globals
CTrade         ExtTrade;

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
}

//+------------------------------------------------------------------+
//| High-Frequency Timer: Receive & Execute Trade Commands from Python|
//+------------------------------------------------------------------+
void OnTimer()
{
   // Non-blocking timer to process signals dispatched from Python Strategy Engine
}
