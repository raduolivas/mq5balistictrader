import assert from 'node:assert/strict';
import test from 'node:test';

import { parseSimulationInput, runSimulation } from '../src/server/simulation';

test('same seed and validated input produce the same result', () => {
  const input = parseSimulationInput({ pair: 'EUR/USD', seed: 42 });

  assert.deepEqual(runSimulation(input), runSimulation(input));
});

test('different seeds produce different trade series', () => {
  const first = runSimulation(parseSimulationInput({ seed: 1 }));
  const second = runSimulation(parseSimulationInput({ seed: 2 }));

  assert.notDeepEqual(first.allTrades, second.allTrades);
});

test('strategy profile changes results while preserving seeded determinism', () => {
  const shared = { pair: 'EUR/USD', seed: 73, tradeCount: 60 } as const;
  const xgboost = runSimulation(parseSimulationInput({
    ...shared,
    strategyType: 'XGBoost Regime Classifier',
  }));
  const onnx = runSimulation(parseSimulationInput({
    ...shared,
    strategyType: 'ONNX Deep Neural Net',
  }));

  assert.notDeepEqual(xgboost.allTrades, onnx.allTrades);
  assert.deepEqual(
    onnx,
    runSimulation(parseSimulationInput({ ...shared, strategyType: 'ONNX Deep Neural Net' })),
  );
});

test('timeframe changes candle cadence and volatility-scaled outcomes', () => {
  const shared = { pair: 'EUR/USD', seed: 73, tradeCount: 20 } as const;
  const m1 = runSimulation(parseSimulationInput({ ...shared, timeframe: 'M1' }));
  const h1 = runSimulation(parseSimulationInput({ ...shared, timeframe: 'H1' }));

  assert.notDeepEqual(m1.allTrades, h1.allTrades);
  assert.equal(
    Date.parse(m1.equityCurve[1].time) - Date.parse(m1.equityCurve[0].time),
    60_000,
  );
  assert.equal(
    Date.parse(h1.equityCurve[1].time) - Date.parse(h1.equityCurve[0].time),
    60 * 60_000,
  );
});

test('validation applies defaults and rejects invalid or unsupported values', () => {
  const input = parseSimulationInput({});

  assert.equal(input.pair, 'EUR/USD');
  assert.equal(input.initialBalance, 10_000);
  assert.equal(input.riskPercent, 1);
  assert.equal(input.tradeCount, 120);
  assert.equal(input.seed, 42);

  for (const invalid of [
    null,
    [],
    { pair: 'BTC/USD' },
    { initialBalance: -1 },
    { initialBalance: Number.POSITIVE_INFINITY },
    { stopLossATR: 0 },
    { takeProfitATR: 11 },
    { riskPercent: 0 },
    { tradeCount: 1.5 },
    { tradeCount: 10_000 },
    { seed: -1 },
    { maxLots: 0 },
  ]) {
    assert.throws(() => parseSimulationInput(invalid), /Invalid simulation input/);
  }
});

test('position sizing risks at most the configured balance percentage plus server spread', () => {
  const input = parseSimulationInput({
    pair: 'EUR/USD',
    seed: 7,
    riskPercent: 1,
    tradeCount: 120,
  });
  const result = runSimulation(input);
  let balanceBeforeTrade = input.initialBalance;
  let losses = 0;

  for (const trade of result.allTrades) {
    if (trade.outcome === 'LOSS') {
      losses += 1;
      const configuredRisk = balanceBeforeTrade * (input.riskPercent / 100);
      const spreadCost = 0.8 * 10 * trade.lots;
      assert.ok(
        Math.abs(trade.profit) <= configuredRisk + spreadCost + 0.02,
        `trade ${trade.id} exceeded its risk budget`,
      );
    }
    balanceBeforeTrade += trade.profit;
  }

  assert.ok(losses > 0);
});

test('pips, pip value, lots, and dollar PnL use consistent units', () => {
  const result = runSimulation(parseSimulationInput({
    pair: 'USD/JPY',
    seed: 91,
    tradeCount: 40,
  }));

  for (const trade of result.allTrades) {
    const expectedProfit = trade.pips * 6.56 * trade.lots;
    assert.ok(Math.abs(trade.profit - expectedProfit) < 0.08);
  }
});

test('drawdown, profit factor, Sharpe, and recent trades are derived from generated trades', () => {
  const input = parseSimulationInput({ seed: 1234, tradeCount: 80 });
  const result = runSimulation(input);
  let peak = input.initialBalance;
  let expectedMaxDrawdown = 0;
  let grossWins = 0;
  let grossLosses = 0;

  for (const [index, trade] of result.allTrades.entries()) {
    const point = result.equityCurve[index];
    peak = Math.max(peak, point.equity);
    expectedMaxDrawdown = Math.max(expectedMaxDrawdown, ((peak - point.equity) / peak) * 100);
    if (trade.profit > 0) grossWins += trade.profit;
    if (trade.profit < 0) grossLosses += Math.abs(trade.profit);
  }

  assert.equal(result.summary.maxDrawdownPct, Number(expectedMaxDrawdown.toFixed(2)));
  assert.ok(Math.abs(result.summary.profitFactor - Number((grossWins / grossLosses).toFixed(2))) <= 0.01);
  assert.ok(Number.isFinite(result.summary.sharpeRatio));
  assert.notEqual(result.summary.sharpeRatio, 1.84);
  assert.deepEqual(
    result.recentTrades.map(({ id }) => id),
    result.allTrades.slice(-15).reverse().map(({ id }) => id),
  );
});
