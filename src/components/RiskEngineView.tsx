import React, { useState } from 'react';
import { DEFAULT_RISK_PARAMS } from '../data/forexData';
import { ShieldCheck, ShieldAlert, DollarSign, Activity, Lock, AlertTriangle } from 'lucide-react';

export const RiskEngineView: React.FC = () => {
  const [params, setParams] = useState(DEFAULT_RISK_PARAMS);
  const [accountEquity, setAccountEquity] = useState<number>(10000);
  const [atrPips, setAtrPips] = useState<number>(12.0);

  // Formula for standard contract lot size:
  // Risk Amount ($) = Account Equity * (Risk % / 100)
  // Lot Size = Risk Amount / (SL Pips * Pip Value per Standard Lot)
  const riskAmount = accountEquity * (params.maxAccountRiskPerTradePct / 100);
  const slPipsTotal = atrPips * params.stopLossAtrMultiplier;
  const calculatedLots = Math.min(2.0, Math.max(0.01, riskAmount / (slPipsTotal * 10)));

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-400" />
          Production Risk Management & Circuit Breakers
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Hard-coded risk rules enforced independently of AI model signals. Protects capital against spread spikes, market gapping, and consecutive loss streaks.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Risk Calculator Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-400" /> Dynamic Lot Sizing Calculator
          </h3>

          <div className="space-y-4">
            <div>
              <label className="text-xs text-slate-400 font-medium mb-1 block">Account Equity ($)</label>
              <input
                type="number"
                value={accountEquity}
                onChange={(e) => setAccountEquity(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 font-medium mb-1 block">Short-Term ATR (Pips)</label>
              <input
                type="number"
                value={atrPips}
                onChange={(e) => setAtrPips(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 font-medium mb-1 block">Risk Per Trade (%)</label>
              <input
                type="number"
                step="0.1"
                value={params.maxAccountRiskPerTradePct}
                onChange={(e) => setParams({ ...params, maxAccountRiskPerTradePct: Number(e.target.value) })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono focus:border-emerald-500"
              />
            </div>

            {/* Calculated Output Box */}
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Total Risk ($):</span>
                <span className="font-mono text-emerald-400 font-bold">${riskAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Stop Loss Distance:</span>
                <span className="font-mono text-cyan-400 font-bold">{slPipsTotal.toFixed(1)} Pips</span>
              </div>
              <div className="pt-2 border-t border-slate-800 flex justify-between items-center">
                <span className="text-xs font-bold text-white">Calculated Lot Size:</span>
                <span className="text-base font-extrabold text-emerald-400 font-mono">{calculatedLots.toFixed(2)} Lots</span>
              </div>
            </div>
          </div>
        </div>

        {/* Hard Circuit Breakers (2 columns) */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-400" /> Hard Circuit Breakers & Safety Thresholds
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">Max Daily Drawdown Limit</span>
                <span className="text-xs font-mono text-rose-400 font-bold">{params.maxDailyDrawdownPct}%</span>
              </div>
              <p className="text-[11px] text-slate-400">
                If daily account equity drops by more than {params.maxDailyDrawdownPct}%, all open trades are closed immediately and trading is halted for 24 hours.
              </p>
            </div>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">Max Allowable Spread</span>
                <span className="text-xs font-mono text-amber-400 font-bold">{params.maxSpreadPips} Pips</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Orders are skipped if broker spread exceeds {params.maxSpreadPips} pips (e.g. during market open/close rollover).
              </p>
            </div>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">Economic News Pause Filter</span>
                <span className="text-xs font-mono text-cyan-400 font-bold">±{params.newsFilterMinutesBefore} Mins</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Trading is automatically paused {params.newsFilterMinutesBefore} minutes before and after high-impact news events (FOMC, NFP, CPI).
              </p>
            </div>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">Hard Equity Capital Lock</span>
                <span className="text-xs font-mono text-emerald-400 font-bold">${params.hardEquityStopLevel}</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Absolute minimum balance protection. No further orders are placed if equity hits this level under any circumstances.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
