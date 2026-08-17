export type ForexPair = 'EUR/USD' | 'GBP/USD' | 'USD/JPY' | 'AUD/USD' | 'USD/CAD';

export type StrategyType = 
  | 'XGBoost Regime Classifier' 
  | 'ONNX Deep Neural Net' 
  | 'LightGBM OFI Scalper';

export interface ForexPairInfo {
  symbol: ForexPair;
  description: string;
  typicalSpreadPips: number;
  pipValueUSD: number;
  volatilityRating: 'Low' | 'Medium' | 'High';
  activeSessions: string[];
}

export interface MlFeature {
  id: string;
  name: string;
  category: 'OrderFlow' | 'Microstructure' | 'Volatility' | 'Momentum';
  description: string;
  importance: number;
  enabled: boolean;
}

export interface RiskParameters {
  maxAccountRiskPerTradePct: number;
  maxDailyDrawdownPct: number;
  stopLossAtrMultiplier: number;
  takeProfitAtrMultiplier: number;
  maxSpreadPips: number;
  newsFilterMinutesBefore: number;
  hardEquityStopLevel: number;
  maxSimultaneousTrades: number;
}

export interface BacktestSummary {
  finalBalance: number;
  totalReturnPct: number;
  winRatePct: number;
  totalTrades: number;
  profitFactor: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  avgLatencyMs: number;
}

export interface EquityPoint {
  step: number;
  equity: number;
  drawdown: number;
}

export interface TradeRecord {
  id: number;
  time: string;
  type: 'BUY' | 'SELL';
  price: number;
  lots: number;
  pips: number;
  profit: number;
  outcome: 'WIN' | 'LOSS';
}

export interface LinuxDeploymentStep {
  id: number;
  title: string;
  category: 'WINE/XVFB' | 'ZeroMQ' | 'Python Engine' | 'Systemd' | 'Latency Tuning';
  command: string;
  description: string;
  notes?: string;
}
