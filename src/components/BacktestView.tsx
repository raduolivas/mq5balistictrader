import React, { useState, useEffect } from 'react';
import { ForexPair, StrategyType, BacktestSummary, EquityPoint, TradeRecord } from '../types';
import { FOREX_PAIRS } from '../data/forexData';
import { Activity, Play, RefreshCw, TrendingUp, TrendingDown, DollarSign, ShieldAlert, Zap, Clock } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

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

  const runBacktest = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/run-backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pair: selectedPair,
          timeframe: 'M5',
          strategyType,
          initialBalance,
          stopLossATR,
          takeProfitATR,
          spreadPips: FOREX_PAIRS.find(p => p.symbol === selectedPair)?.typicalSpreadPips || 0.8
        })
      });

      const data = await response.json();
      setSummary(data.summary);
      setEquityCurve(data.equityCurve);
      setRecentTrades(data.recentTrades);
    } catch (err) {
      console.error('Backtest error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runBacktest();
  }, [selectedPair, strategyType]);

  return (
    <div className="space-y-6">
      {/* Controls Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-400" />
              Algorithmic Backtesting & Performance Simulator
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Simulate tick-level trading performance for both Approach A (In-Process ONNX) and Approach B (ZeroMQ Python Engine).
            </p>
          </div>

          <button
            onClick={runBacktest}
            disabled={loading}
            className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/20 flex items-center gap-2 transition-all disabled:opacity-50"
          >
            <Play className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Running Simulation...' : 'Re-Run Backtest'}
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

      {/* Performance Summary Metrics */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <div className="text-xs text-slate-400 mb-1">Final Equity</div>
            <div className="text-lg font-bold text-emerald-400 font-mono">${summary.finalBalance.toLocaleString()}</div>
            <div className="text-[11px] text-emerald-500 flex items-center gap-1 mt-1 font-semibold">
              <TrendingUp className="w-3 h-3" /> +{summary.totalReturnPct}% Net
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
            <div className="text-[11px] text-emerald-400 mt-1">&gt; 1.5 Target Met</div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <div className="text-xs text-slate-400 mb-1">Max Drawdown</div>
            <div className="text-lg font-bold text-rose-400 font-mono">{summary.maxDrawdownPct}%</div>
            <div className="text-[11px] text-slate-400 mt-1">Cap: 2.0% Safe</div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <div className="text-xs text-slate-400 mb-1">Sharpe Ratio</div>
            <div className="text-lg font-bold text-purple-400 font-mono">{summary.sharpeRatio}</div>
            <div className="text-[11px] text-slate-400 mt-1">Risk Adjusted</div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <div className="text-xs text-slate-400 mb-1">Avg Execution Latency</div>
            <div className="text-lg font-bold text-amber-400 font-mono">{summary.avgLatencyMs} ms</div>
            <div className="text-[11px] text-amber-500 flex items-center gap-1 mt-1 font-semibold">
              <Zap className="w-3 h-3" /> Sub-15ms Target
            </div>
          </div>
        </div>
      )}

      {/* Equity Curve Chart */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <h3 className="text-sm font-bold text-white mb-4 flex items-center justify-between">
          <span>Simulated Equity & Drawdown Growth Curve</span>
          <span className="text-xs font-mono text-slate-400">120 Historical Trades</span>
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
        <h3 className="text-sm font-bold text-white mb-4">Live Simulated Execution Log</h3>

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
