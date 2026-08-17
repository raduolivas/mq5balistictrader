import React from 'react';
import { ForexPair } from '../types';
import { FOREX_PAIRS } from '../data/forexData';
import { Activity, Terminal, ShieldCheck, Layers, Cpu, Zap, Server, Sliders, Globe } from 'lucide-react';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  selectedPair: ForexPair;
  setSelectedPair: (pair: ForexPair) => void;
  isSimulating: boolean;
  setIsSimulating: (sim: boolean) => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  selectedPair,
  setSelectedPair,
  isSimulating,
  setIsSimulating,
}) => {
  const navTabs = [
    { id: 'architecture', label: 'Architecture & IPC', icon: Layers },
    { id: 'code', label: 'MQL5 & Python Scripts', icon: Terminal },
    { id: 'backtest', label: 'Quant Backtester', icon: Activity },
    { id: 'ml-studio', label: 'ML Feature Studio', icon: Zap },
    { id: 'risk', label: 'Risk & Circuit Breakers', icon: ShieldCheck },
    { id: 'ubuntu', label: 'Ubuntu Linux VPS Guide', icon: Server },
    { id: 'ai-review', label: 'AI Systems Advisor', icon: Cpu },
  ];

  return (
    <header className="border-b border-slate-800 bg-slate-950/90 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Top Branding & Pair Selector */}
        <div className="flex flex-wrap items-center justify-between gap-4 py-3 border-b border-slate-800/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-cyan-500 flex items-center justify-center text-slate-950 font-black shadow-lg shadow-emerald-500/20">
              <Zap className="w-5 h-5 text-slate-950" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-extrabold text-white tracking-tight">
                  MetaTrader 5 <span className="text-emerald-400">Forex AI Studio</span>
                </h1>
                <span className="px-2 py-0.5 text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-bold">
                  MQL5 & PyZMQ
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Low-Latency In-Process ONNX + Hybrid ZeroMQ IPC Trading Architecture
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Pair Selector */}
            <div className="flex items-center gap-2 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800">
              <Globe className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={selectedPair}
                onChange={(e) => setSelectedPair(e.target.value as ForexPair)}
                className="bg-transparent text-xs font-mono font-bold text-emerald-400 focus:outline-none cursor-pointer"
              >
                {FOREX_PAIRS.map((p) => (
                  <option key={p.symbol} value={p.symbol} className="bg-slate-900 text-white">
                    {p.symbol}
                  </option>
                ))}
              </select>
            </div>

            {/* Live Indicator */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] text-slate-300 font-mono">Wine 9.0+ & ZeroMQ Ready</span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex space-x-1 overflow-x-auto py-2 scrollbar-none">
          {navTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-xl whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-slate-800 text-emerald-400 border border-slate-700 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-400' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
};
