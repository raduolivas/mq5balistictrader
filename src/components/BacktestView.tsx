import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ForexPair, StrategyType, BacktestSummary, EquityPoint, TradeRecord } from '../types';
import { FOREX_PAIRS } from '../data/forexData';
import { Activity, Play, TrendingDown, TrendingUp } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

const SIMULATION_SEED = 42;
const AUTO_RUN_DELAY_MS = 250;

interface SimulationRequest {
  pair: ForexPair;
  timeframe: 'M5';
  strategyType: StrategyType;
  initialBalance: number;
  stopLossATR: number;
  takeProfitATR: number;
  riskPercent: number;
  seed: number;
}

interface SimulationResponse {
  summary: BacktestSummary;
  equityCurve: EquityPoint[];
  recentTrades: TradeRecord[];
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSimulationResponse = (value: unknown): value is SimulationResponse => {
  if (!isRecord(value) || !isRecord(value.summary)) return false;
  const summary = value.summary;
  const numericSummaryFields = [
    'initialBalance',
    'finalBalance',
    'totalReturnPct',
    'winRatePct',
    'profitFactor',
    'maxDrawdownPct',
    'totalTrades',
    'sharpeRatio',
  ];
  if (!numericSummaryFields.every((field) => isFiniteNumber(summary[field]))) return false;
  if (typeof summary.pair !== 'string' || typeof summary.timeframe !== 'string' ||
      typeof summary.strategyType !== 'string') return false;
  if (!Array.isArray(value.equityCurve) || !Array.isArray(value.recentTrades)) return false;

  const validPoint = (point: unknown) => isRecord(point) &&
    isFiniteNumber(point.step) && typeof point.time === 'string' &&
    isFiniteNumber(point.equity) && isFiniteNumber(point.balance) &&
    isFiniteNumber(point.drawdown) && isFiniteNumber(point.price);
  const validTrade = (trade: unknown) => isRecord(trade) &&
    isFiniteNumber(trade.id) && typeof trade.time === 'string' &&
    (trade.type === 'BUY' || trade.type === 'SELL') && typeof trade.pair === 'string' &&
    isFiniteNumber(trade.price) && isFiniteNumber(trade.lots) &&
    isFiniteNumber(trade.pips) && isFiniteNumber(trade.profit) &&
    (trade.outcome === 'WIN' || trade.outcome === 'LOSS');

  return value.equityCurve.every(validPoint) && value.recentTrades.every(validTrade);
};

const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === 'AbortError';

interface BacktestViewProps {
  selectedPair: ForexPair;
  setSelectedPair: (pair: ForexPair) => void;
}

export const BacktestView: React.FC<BacktestViewProps> = ({ selectedPair, setSelectedPair }) => {
  const [strategyType, setStrategyType] = useState<StrategyType>('XGBoost Regime Classifier');
  const [initialBalance, setInitialBalance] = useState<number>(10000);
  const [stopLossATR, setStopLossATR] = useState<number>(1.5);
  const [takeProfitATR, setTakeProfitATR] = useState<number>(2.2);
  const [loading, setLoading] = useState<boolean>(false);

  const [summary, setSummary] = useState<BacktestSummary | null>(null);
  const [equityCurve, setEquityCurve] = useState<EquityPoint[]>([]);
  const [recentTrades, setRecentTrades] = useState<TradeRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const activeRequestRef = useRef<AbortController | null>(null);
  const scheduledRequestRef = useRef<number | null>(null);

  const simulationInput = useMemo<SimulationRequest>(() => ({
    pair: selectedPair,
    timeframe: 'M5',
    strategyType,
    initialBalance,
    stopLossATR,
    takeProfitATR,
    riskPercent: 1,
    seed: SIMULATION_SEED,
  }), [initialBalance, selectedPair, stopLossATR, strategyType, takeProfitATR]);

  const requestSimulation = useCallback(async (input: SimulationRequest) => {
    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/run-simulation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error('Simulation request failed');
      }

      const data: unknown = await response.json();
      if (!isSimulationResponse(data)) {
        throw new Error('Simulation response was invalid');
      }
      if (activeRequestRef.current !== controller) return;

      setSummary(data.summary);
      setEquityCurve(data.equityCurve);
      setRecentTrades(data.recentTrades);
    } catch (requestError) {
      if (!isAbortError(requestError) && activeRequestRef.current === controller) {
        setError('The simulation could not be completed. Check the inputs and try again.');
      }
    } finally {
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    scheduledRequestRef.current = window.setTimeout(() => {
      scheduledRequestRef.current = null;
      void requestSimulation(simulationInput);
    }, AUTO_RUN_DELAY_MS);

    return () => {
      if (scheduledRequestRef.current !== null) {
        window.clearTimeout(scheduledRequestRef.current);
        scheduledRequestRef.current = null;
      }
      const activeRequest = activeRequestRef.current;
      activeRequestRef.current = null;
      activeRequest?.abort();
    };
  }, [requestSimulation, simulationInput]);

  const runSimulationNow = () => {
    if (scheduledRequestRef.current !== null) {
      window.clearTimeout(scheduledRequestRef.current);
      scheduledRequestRef.current = null;
    }
    void requestSimulation(simulationInput);
  };

  return (
    <div className="space-y-6" aria-busy={loading}>
      {/* Controls Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-400" />
              Deterministic Monte Carlo Simulation
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Explore reproducible, seeded strategy scenarios. This is not a historical market-data backtest or live execution.
            </p>
          </div>

          <button
            type="button"
            onClick={runSimulationNow}
            disabled={loading}
            className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/20 flex items-center gap-2 transition-all disabled:opacity-50"
          >
            <Play className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Running Simulation...' : 'Run Simulation Again'}
          </button>
        </div>

        {/* Configuration Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-slate-800">
          <div>
            <label className="text-xs text-slate-400 font-medium mb-1 block">Currency Pair</label>
            <select
              value={selectedPair}
              onChange={(e) => setSelectedPair(e.target.value as ForexPair)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white focus:border-emerald-500 font-mono"
            >
              {FOREX_PAIRS.map(p => (
                <option key={p.symbol} value={p.symbol}>{p.symbol} (Spread ~{p.typicalSpreadPips} pips)</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-slate-400 font-medium mb-1 block">Strategy Engine Architecture</label>
            <select
              value={strategyType}
              onChange={(e) => setStrategyType(e.target.value as StrategyType)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white focus:border-emerald-500 font-mono"
            >
              <option value="XGBoost Regime Classifier">Approach B: XGBoost + ZeroMQ Python Worker</option>
              <option value="ONNX Deep Neural Net">Approach A: Pure Native MQL5 ONNX Model</option>
              <option value="LightGBM OFI Scalper">Approach B: LightGBM Order Flow Imbalance</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-slate-400 font-medium mb-1 block">Initial Capital ($)</label>
            <input
              type="number"
              value={initialBalance}
              onChange={(e) => setInitialBalance(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white focus:border-emerald-500 font-mono"
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 font-medium mb-1 block">Risk Ratios (SL / TP ATR)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                value={stopLossATR}
                onChange={(e) => setStopLossATR(Number(e.target.value))}
                className="w-1/2 bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white focus:border-emerald-500 font-mono"
                placeholder="SL"
              />
              <span className="text-xs text-slate-500">:</span>
              <input
                type="number"
                step="0.1"
                value={takeProfitATR}
                onChange={(e) => setTakeProfitATR(Number(e.target.value))}
                className="w-1/2 bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white focus:border-emerald-500 font-mono"
                placeholder="TP"
              />
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
        >
          {error} The last successful result remains available below.
        </div>
      )}

      {/* Performance Summary Metrics */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <div className="text-xs text-slate-400 mb-1">Final Equity</div>
            <div className="text-lg font-bold text-emerald-400 font-mono">${summary.finalBalance.toLocaleString()}</div>
            <div className={`text-[11px] flex items-center gap-1 mt-1 font-semibold ${
              summary.totalReturnPct >= 0 ? 'text-emerald-500' : 'text-rose-400'
            }`}>
              {summary.totalReturnPct >= 0
                ? <TrendingUp className="w-3 h-3" />
                : <TrendingDown className="w-3 h-3" />}
              {summary.totalReturnPct >= 0 ? '+' : ''}{summary.totalReturnPct}% Net
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <div className="text-xs text-slate-400 mb-1">Win Rate</div>
            <div className="text-lg font-bold text-cyan-400 font-mono">{summary.winRatePct}%</div>
            <div className="text-[11px] text-slate-400 mt-1">{summary.totalTrades} Total Trades</div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <div className="text-xs text-slate-400 mb-1">Profit Factor</div>
            <div className="text-lg font-bold text-white font-mono">{summary.profitFactor}</div>
            <div className={`text-[11px] mt-1 ${
              summary.profitFactor >= 1.5 ? 'text-emerald-400' : 'text-amber-400'
            }`}>
              {summary.profitFactor >= 1.5 ? '1.5 target met' : 'Below 1.5 target'}
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <div className="text-xs text-slate-400 mb-1">Max Drawdown</div>
            <div className="text-lg font-bold text-rose-400 font-mono">{summary.maxDrawdownPct}%</div>
            <div className={`text-[11px] mt-1 ${
              summary.maxDrawdownPct <= 2 ? 'text-emerald-400' : 'text-amber-400'
            }`}>
              {summary.maxDrawdownPct <= 2 ? 'Within 2.0% limit' : 'Above 2.0% limit'}
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <div className="text-xs text-slate-400 mb-1">Sharpe Ratio</div>
            <div className="text-lg font-bold text-purple-400 font-mono">{summary.sharpeRatio}</div>
            <div className="text-[11px] text-slate-400 mt-1">Risk Adjusted</div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <div className="text-xs text-slate-400 mb-1">Simulation Seed</div>
            <div className="text-lg font-bold text-amber-400 font-mono">{SIMULATION_SEED}</div>
            <div className="text-[11px] text-slate-400 mt-1">Reproducible scenario</div>
          </div>
        </div>
      )}

      {/* Equity Curve Chart */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <h3 className="text-sm font-bold text-white mb-4 flex items-center justify-between">
          <span>Monte Carlo Equity & Drawdown Curve</span>
          <span className="text-xs font-mono text-slate-400">
            {summary?.totalTrades ?? 120} Seeded Trades · Seed {SIMULATION_SEED}
          </span>
        </h3>

        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={equityCurve} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="step" stroke="#64748b" tick={{ fontSize: 10 }} />
              <YAxis stroke="#64748b" tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
              <Tooltip
                contentStyle={{ backgroundColor: '#020617', borderColor: '#334155', borderRadius: '12px', fontSize: '12px' }}
                formatter={(val: any) => [`$${val}`, 'Equity']}
              />
              <Area type="monotone" dataKey="equity" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#equityGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Trades Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 overflow-hidden">
        <h3 className="text-sm font-bold text-white mb-4">Seeded Simulation Trade Log</h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs text-slate-300">
            <thead className="bg-slate-950 text-slate-400 text-[11px] uppercase border-b border-slate-800">
              <tr>
                <th className="p-3">Trade ID</th>
                <th className="p-3">Time</th>
                <th className="p-3">Type</th>
                <th className="p-3">Price</th>
                <th className="p-3">Lots</th>
                <th className="p-3">Pips</th>
                <th className="p-3">Profit ($)</th>
                <th className="p-3">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {recentTrades.map((t) => (
                <tr key={t.id} className="hover:bg-slate-800/40">
                  <td className="p-3 text-slate-400">#{t.id}</td>
                  <td className="p-3 text-slate-400">{t.time}</td>
                  <td className="p-3 font-bold">
                    <span className={`px-2 py-0.5 rounded text-[10px] ${
                      t.type === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                    }`}>
                      {t.type}
                    </span>
                  </td>
                  <td className="p-3">{t.price}</td>
                  <td className="p-3">{t.lots}</td>
                  <td className={`p-3 font-semibold ${t.pips >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {t.pips > 0 ? `+${t.pips}` : t.pips}
                  </td>
                  <td className={`p-3 font-bold ${t.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {t.profit > 0 ? `+$${t.profit}` : `-$${Math.abs(t.profit)}`}
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      t.outcome === 'WIN' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                    }`}>
                      {t.outcome}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
