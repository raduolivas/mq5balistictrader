import type {
  ForexPair,
  SimulationInput,
  SimulationResult,
  StrategyType,
  TradeRecord,
} from '../types';

interface PairMetadata {
  basePrice: number;
  pipSize: number;
  pipValueUsd: number;
  spreadPips: number;
  atrPips: number;
  priceDecimals: number;
}

interface StrategyMetadata {
  winProbability: number;
  atrScale: number;
  rewardScale: number;
}

interface TimeframeMetadata {
  intervalMs: number;
  volatilityScale: number;
}

const PAIRS: Record<ForexPair, PairMetadata> = {
  'EUR/USD': { basePrice: 1.085, pipSize: 0.0001, pipValueUsd: 10, spreadPips: 0.8, atrPips: 32, priceDecimals: 5 },
  'GBP/USD': { basePrice: 1.285, pipSize: 0.0001, pipValueUsd: 10, spreadPips: 1.1, atrPips: 38, priceDecimals: 5 },
  'USD/JPY': { basePrice: 152.5, pipSize: 0.01, pipValueUsd: 6.56, spreadPips: 0.9, atrPips: 35, priceDecimals: 3 },
  'AUD/USD': { basePrice: 0.665, pipSize: 0.0001, pipValueUsd: 10, spreadPips: 1, atrPips: 28, priceDecimals: 5 },
  'USD/CAD': { basePrice: 1.355, pipSize: 0.0001, pipValueUsd: 7.38, spreadPips: 1.2, atrPips: 30, priceDecimals: 5 },
};

const STRATEGIES: readonly StrategyType[] = [
  'XGBoost Regime Classifier',
  'ONNX Deep Neural Net',
  'LightGBM OFI Scalper',
];
const STRATEGY_PARAMETERS: Record<StrategyType, StrategyMetadata> = {
  'XGBoost Regime Classifier': { winProbability: 0.58, atrScale: 1, rewardScale: 1 },
  'ONNX Deep Neural Net': { winProbability: 0.55, atrScale: 1.08, rewardScale: 1.04 },
  'LightGBM OFI Scalper': { winProbability: 0.61, atrScale: 0.72, rewardScale: 0.82 },
};
const TIMEFRAMES: readonly SimulationInput['timeframe'][] = ['M1', 'M5', 'M15', 'H1'];
const TIMEFRAME_PARAMETERS: Record<SimulationInput['timeframe'], TimeframeMetadata> = {
  M1: { intervalMs: 60_000, volatilityScale: Math.sqrt(1 / 5) },
  M5: { intervalMs: 5 * 60_000, volatilityScale: 1 },
  M15: { intervalMs: 15 * 60_000, volatilityScale: Math.sqrt(3) },
  H1: { intervalMs: 60 * 60_000, volatilityScale: Math.sqrt(12) },
};
const DEFAULT_INPUT: SimulationInput = {
  pair: 'EUR/USD',
  timeframe: 'M5',
  strategyType: 'XGBoost Regime Classifier',
  initialBalance: 10_000,
  stopLossATR: 1.5,
  takeProfitATR: 2.2,
  riskPercent: 1,
  tradeCount: 120,
  seed: 42,
  maxLots: 2,
};
const START_TIME_MS = Date.UTC(2024, 0, 1);

function invalidInput(): never {
  throw new TypeError('Invalid simulation input');
}

function finiteNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const candidate = value === undefined ? fallback : value;
  if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < minimum || candidate > maximum) {
    return invalidInput();
  }
  return candidate;
}

function integer(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const candidate = finiteNumber(value, fallback, minimum, maximum);
  if (!Number.isInteger(candidate)) return invalidInput();
  return candidate;
}

function enumValue<T extends string>(value: unknown, fallback: T, allowed: readonly T[]): T {
  const candidate = value === undefined ? fallback : value;
  if (typeof candidate !== 'string' || !allowed.includes(candidate as T)) return invalidInput();
  return candidate as T;
}

export function parseSimulationInput(value: unknown): SimulationInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalidInput();
  const input = value as Record<string, unknown>;

  return {
    pair: enumValue(input.pair, DEFAULT_INPUT.pair, Object.keys(PAIRS) as ForexPair[]),
    timeframe: enumValue(input.timeframe, DEFAULT_INPUT.timeframe, TIMEFRAMES),
    strategyType: enumValue(input.strategyType ?? input.strategy, DEFAULT_INPUT.strategyType, STRATEGIES),
    initialBalance: finiteNumber(input.initialBalance ?? input.capital, DEFAULT_INPUT.initialBalance, 100, 10_000_000),
    stopLossATR: finiteNumber(input.stopLossATR, DEFAULT_INPUT.stopLossATR, 0.1, 10),
    takeProfitATR: finiteNumber(input.takeProfitATR, DEFAULT_INPUT.takeProfitATR, 0.1, 10),
    riskPercent: finiteNumber(input.riskPercent, DEFAULT_INPUT.riskPercent, 0.01, 5),
    tradeCount: integer(input.tradeCount, DEFAULT_INPUT.tradeCount, 1, 1_000),
    seed: integer(input.seed, DEFAULT_INPUT.seed, 0, 0xffff_ffff),
    maxLots: finiteNumber(input.maxLots, DEFAULT_INPUT.maxLots, 0.001, 100),
  };
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function floorLots(value: number): number {
  return Math.floor(value * 1_000_000) / 1_000_000;
}

function calculateSharpe(returns: number[]): number {
  if (returns.length === 0) return 0;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  const standardDeviation = Math.sqrt(variance);
  if (standardDeviation === 0) return 0;
  return (mean / standardDeviation) * Math.sqrt(returns.length);
}

export function runSimulation(input: SimulationInput): SimulationResult {
  const pair = PAIRS[input.pair];
  const strategy = STRATEGY_PARAMETERS[input.strategyType];
  const timeframe = TIMEFRAME_PARAMETERS[input.timeframe];
  const random = mulberry32(input.seed);
  const equityCurve: SimulationResult['equityCurve'] = [];
  const allTrades: TradeRecord[] = [];
  const returns: number[] = [];
  let currentBalance = input.initialBalance;
  let peakBalance = input.initialBalance;
  let maximumDrawdown = 0;
  let simulatedPrice = pair.basePrice;
  let grossWins = 0;
  let grossLosses = 0;
  let wins = 0;

  for (let index = 0; index < input.tradeCount; index += 1) {
    const balanceBeforeTrade = currentBalance;
    const type: TradeRecord['type'] = random() < 0.5 ? 'BUY' : 'SELL';
    const atrPips = pair.atrPips * strategy.atrScale * timeframe.volatilityScale * (0.8 + random() * 0.4);
    const isWin = random() < strategy.winProbability;
    const stopPips = atrPips * input.stopLossATR;
    const targetPips = atrPips * input.takeProfitATR * strategy.rewardScale;
    const riskAmount = currentBalance * (input.riskPercent / 100);
    const rawLots = Math.min(input.maxLots, riskAmount / (stopPips * pair.pipValueUsd));
    const lots = floorLots(rawLots);
    const outcomePips = round(isWin ? targetPips - pair.spreadPips : -stopPips - pair.spreadPips, 2);
    const profit = round(outcomePips * pair.pipValueUsd * lots, 2);

    currentBalance = round(currentBalance + profit, 2);
    peakBalance = Math.max(peakBalance, currentBalance);
    const drawdown = peakBalance === 0 ? 0 : ((peakBalance - currentBalance) / peakBalance) * 100;
    maximumDrawdown = Math.max(maximumDrawdown, drawdown);
    simulatedPrice += (random() - 0.5) * atrPips * pair.pipSize;

    if (isWin) wins += 1;
    if (profit > 0) grossWins += profit;
    if (profit < 0) grossLosses += Math.abs(profit);
    returns.push(balanceBeforeTrade === 0 ? 0 : profit / balanceBeforeTrade);

    const timestamp = new Date(START_TIME_MS + index * timeframe.intervalMs);
    allTrades.push({
      id: index + 1,
      time: timestamp.toISOString().replace('T', ' ').slice(0, 16),
      type,
      pair: input.pair,
      price: round(simulatedPrice, pair.priceDecimals),
      lots,
      pips: outcomePips,
      profit,
      outcome: isWin ? 'WIN' : 'LOSS',
    });
    equityCurve.push({
      step: index + 1,
      time: timestamp.toISOString(),
      equity: currentBalance,
      balance: currentBalance,
      drawdown: round(drawdown, 2),
      price: round(simulatedPrice, pair.priceDecimals),
    });
  }

  const totalReturnPct = ((currentBalance - input.initialBalance) / input.initialBalance) * 100;
  const profitFactor = grossLosses === 0 ? (grossWins === 0 ? 0 : 999.99) : grossWins / grossLosses;

  return {
    summary: {
      pair: input.pair,
      timeframe: input.timeframe,
      strategyType: input.strategyType,
      initialBalance: input.initialBalance,
      finalBalance: currentBalance,
      totalReturnPct: round(totalReturnPct, 2),
      winRatePct: round((wins / input.tradeCount) * 100, 1),
      profitFactor: round(profitFactor, 2),
      maxDrawdownPct: round(maximumDrawdown, 2),
      totalTrades: input.tradeCount,
      sharpeRatio: round(calculateSharpe(returns), 2),
    },
    equityCurve,
    recentTrades: allTrades.slice(-15).reverse(),
    allTrades,
  };
}
