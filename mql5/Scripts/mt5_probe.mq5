//+------------------------------------------------------------------+
//|                                                    mt5_probe.mq5 |
//| Read-only broker/account capability probe for MetaTrader 5.     |
//+------------------------------------------------------------------+
#property copyright "mq5balistictrader"
#property version   "1.00"
#property strict
#property script_show_inputs

input string InpBrokerNameFragment = "FotMarkets";
input string InpSymbolNameFragment = "BTC";
input string InpReportFile         = "mt5_probe.json";
input bool   InpCloseAutomatedRun  = true;

string JsonEscape(string value)
{
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   StringReplace(value, "\r", "\\r");
   StringReplace(value, "\n", "\\n");
   StringReplace(value, "\t", "\\t");
   return value;
}

string JsonBool(const bool value)
{
   return value ? "true" : "false";
}

string AccountTradeModeName(const long mode)
{
   switch((ENUM_ACCOUNT_TRADE_MODE)mode)
   {
      case ACCOUNT_TRADE_MODE_DEMO:    return "demo";
      case ACCOUNT_TRADE_MODE_CONTEST: return "contest";
      case ACCOUNT_TRADE_MODE_REAL:    return "real";
   }
   return "unknown";
}

string SymbolTradeModeName(const long mode)
{
   switch((ENUM_SYMBOL_TRADE_MODE)mode)
   {
      case SYMBOL_TRADE_MODE_DISABLED:  return "disabled";
      case SYMBOL_TRADE_MODE_LONGONLY:  return "long_only";
      case SYMBOL_TRADE_MODE_SHORTONLY: return "short_only";
      case SYMBOL_TRADE_MODE_CLOSEONLY: return "close_only";
      case SYMBOL_TRADE_MODE_FULL:      return "full";
   }
   return "unknown";
}

bool ContainsIgnoreCase(const string value, const string fragment)
{
   string haystack = value;
   string needle = fragment;
   StringToUpper(haystack);
   StringToUpper(needle);
   return StringFind(haystack, needle) >= 0;
}

string ProbeSymbol(const string symbol, bool &usable)
{
   const bool was_selected = (bool)SymbolInfoInteger(symbol, SYMBOL_SELECT);
   bool selected_for_probe = was_selected;
   if(!was_selected)
      selected_for_probe = SymbolSelect(symbol, true);

   // CopyTicks initiates symbol synchronization and, for scripts, waits for
   // the broker response. This avoids mistaking a newly selected symbol for
   // an unavailable one just because its first quote has not arrived yet.
   ResetLastError();
   MqlTick tick = {};
   MqlTick ticks[];
   const int received = selected_for_probe ? CopyTicks(symbol, ticks, COPY_TICKS_INFO, 0, 1) : -1;
   const int copy_error = GetLastError();
   bool has_tick = received == 1;
   if(has_tick)
      tick = ticks[0];
   else
   {
      ResetLastError();
      has_tick = selected_for_probe && SymbolInfoTick(symbol, tick);
   }
   const int tick_error = has_tick ? 0 : (copy_error != 0 ? copy_error : GetLastError());
   const bool symbol_synchronized = selected_for_probe && SymbolIsSynchronized(symbol);
   long quote_age_seconds = has_tick ? (long)TimeTradeServer() - (long)tick.time : -1;
   if(quote_age_seconds < 0 && has_tick)
      quote_age_seconds = 0;

   const long trade_mode = SymbolInfoInteger(symbol, SYMBOL_TRADE_MODE);
   const int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   const double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   const double volume_min = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   const double volume_step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   const double volume_max = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   const double contract_size = SymbolInfoDouble(symbol, SYMBOL_TRADE_CONTRACT_SIZE);
   const double spread_price = has_tick ? tick.ask - tick.bid : 0.0;
   const double spread_points = (has_tick && point > 0.0) ? spread_price / point : 0.0;

   usable = (selected_for_probe &&
             trade_mode != SYMBOL_TRADE_MODE_DISABLED &&
             trade_mode != SYMBOL_TRADE_MODE_CLOSEONLY &&
             volume_min > 0.0 && volume_step > 0.0 && contract_size > 0.0 &&
             has_tick && quote_age_seconds <= 300 &&
             tick.ask >= tick.bid && tick.bid > 0.0);

   string json = "{";
   json += "\"name\":\"" + JsonEscape(symbol) + "\",";
   json += "\"selected_before_probe\":" + JsonBool(was_selected) + ",";
   json += "\"selected_for_probe\":" + JsonBool(selected_for_probe) + ",";
   json += "\"selection_restored\":" + JsonBool(was_selected) + ",";
   json += "\"trade_mode\":\"" + SymbolTradeModeName(trade_mode) + "\",";
   json += "\"digits\":" + IntegerToString(digits) + ",";
   json += "\"point\":" + DoubleToString(point, digits) + ",";
   json += "\"minimum_lot\":" + DoubleToString(volume_min, 8) + ",";
   json += "\"volume_step\":" + DoubleToString(volume_step, 8) + ",";
   json += "\"maximum_lot\":" + DoubleToString(volume_max, 8) + ",";
   json += "\"contract_size\":" + DoubleToString(contract_size, 8) + ",";
   json += "\"symbol_synchronized\":" + JsonBool(symbol_synchronized) + ",";
   json += "\"tick_available\":" + JsonBool(has_tick) + ",";
   json += "\"tick_error\":" + IntegerToString(tick_error) + ",";
   json += "\"tick_time_msc\":" + IntegerToString((long)tick.time_msc) + ",";
   json += "\"quote_age_seconds\":" + IntegerToString(quote_age_seconds) + ",";
   json += "\"bid\":" + DoubleToString(tick.bid, digits) + ",";
   json += "\"ask\":" + DoubleToString(tick.ask, digits) + ",";
   json += "\"spread_price\":" + DoubleToString(spread_price, digits) + ",";
   json += "\"spread_points\":" + DoubleToString(spread_points, 2) + ",";
   json += "\"usable_for_execution\":" + JsonBool(usable);
   json += "}";

   if(!was_selected && selected_for_probe)
   {
      const bool restored = SymbolSelect(symbol, false);
      StringReplace(json, "\"selection_restored\":false", "\"selection_restored\":" + JsonBool(restored));
   }

   return json;
}

void OnStart()
{
   const bool connected = (bool)TerminalInfoInteger(TERMINAL_CONNECTED);
   const bool terminal_trade_allowed = (bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED);
   const bool account_trade_allowed = (bool)AccountInfoInteger(ACCOUNT_TRADE_ALLOWED);
   const bool expert_trade_allowed = (bool)AccountInfoInteger(ACCOUNT_TRADE_EXPERT);
   const bool program_trade_allowed = (bool)MQLInfoInteger(MQL_TRADE_ALLOWED);
   const long login = AccountInfoInteger(ACCOUNT_LOGIN);
   const long account_mode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   const string server = AccountInfoString(ACCOUNT_SERVER);
   const string company = AccountInfoString(ACCOUNT_COMPANY);

   const bool login_ok = connected && login > 0 && ContainsIgnoreCase(server, InpBrokerNameFragment);
   const bool demo_ok = account_mode == ACCOUNT_TRADE_MODE_DEMO;
   const bool automation_ok = terminal_trade_allowed && account_trade_allowed && expert_trade_allowed;

   string symbols_json = "[";
   int candidate_count = 0;
   int usable_count = 0;
   const int symbol_total = SymbolsTotal(false);
   for(int i = 0; i < symbol_total; i++)
   {
      const string symbol = SymbolName(i, false);
      if(symbol == "" || !ContainsIgnoreCase(symbol, InpSymbolNameFragment))
         continue;

      bool usable = false;
      const string symbol_json = ProbeSymbol(symbol, usable);
      if(candidate_count > 0)
         symbols_json += ",";
      symbols_json += symbol_json;
      candidate_count++;
      if(usable)
         usable_count++;
   }
   symbols_json += "]";

   const bool passed = login_ok && demo_ok && automation_ok && usable_count > 0;
   string report = "{";
   report += "\"probe\":\"mt5_probe\",";
   report += "\"version\":\"1.0\",";
   report += "\"read_only\":true,";
   report += "\"trade_functions_called\":false,";
   report += "\"timestamp\":" + IntegerToString((long)TimeLocal()) + ",";
   report += "\"passed\":" + JsonBool(passed) + ",";
   report += "\"terminal\":{";
   report += "\"connected\":" + JsonBool(connected) + ",";
   report += "\"build\":" + IntegerToString(TerminalInfoInteger(TERMINAL_BUILD)) + ",";
   report += "\"trade_allowed\":" + JsonBool(terminal_trade_allowed) + ",";
   report += "\"program_trade_allowed\":" + JsonBool(program_trade_allowed);
   report += "},";
   report += "\"account\":{";
   report += "\"login\":" + IntegerToString(login) + ",";
   report += "\"server\":\"" + JsonEscape(server) + "\",";
   report += "\"company\":\"" + JsonEscape(company) + "\",";
   report += "\"trade_mode\":\"" + AccountTradeModeName(account_mode) + "\",";
   report += "\"trade_allowed\":" + JsonBool(account_trade_allowed) + ",";
   report += "\"expert_trade_allowed\":" + JsonBool(expert_trade_allowed);
   report += "},";
   report += "\"checks\":{";
   report += "\"fotmarkets_login\":" + JsonBool(login_ok) + ",";
   report += "\"demo_account\":" + JsonBool(demo_ok) + ",";
   report += "\"automated_trading\":" + JsonBool(automation_ok) + ",";
   report += "\"btc_symbol_available\":" + JsonBool(usable_count > 0);
   report += "},";
   report += "\"btc_candidate_count\":" + IntegerToString(candidate_count) + ",";
   report += "\"btc_usable_count\":" + IntegerToString(usable_count) + ",";
   report += "\"btc_symbols\":" + symbols_json;
   report += "}";

   int handle = FileOpen(InpReportFile, FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(handle == INVALID_HANDLE)
   {
      PrintFormat("[MT5_PROBE] failed to open %s (error=%d)", InpReportFile, GetLastError());
   }
   else
   {
      FileWriteString(handle, report + "\n");
      FileClose(handle);
      Print("[MT5_PROBE] " + report);
   }

   if(InpCloseAutomatedRun && MQLInfoInteger(MQL_STARTED_FROM_CONFIG))
      TerminalClose(passed ? 0 : 2);
}
