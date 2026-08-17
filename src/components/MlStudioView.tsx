import React, { useState } from 'react';
import { DEFAULT_ML_FEATURES } from '../data/forexData';
import { MlFeature } from '../types';
import { Zap, Sliders, CheckSquare, Square, Layers, Cpu, Shield, ArrowRight } from 'lucide-react';

export const MlStudioView: React.FC = () => {
  const [features, setFeatures] = useState<MlFeature[]>(DEFAULT_ML_FEATURES);
  const [modelType, setModelType] = useState<'LightGBM' | 'XGBoost' | 'ONNX_PyTorch'>('LightGBM');
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(0.68);

  const toggleFeature = (id: string) => {
    setFeatures(features.map(f => f.id === id ? { ...f, enabled: !f.enabled } : f));
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Zap className="w-5 h-5 text-emerald-400" />
          AI & Machine Learning Feature Engineering Studio
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Configure microsecond-level order flow imbalance (OFI), spread metrics, volatility expansion triggers, and probability decision thresholds.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Feature List (2 columns) */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6">
          <h3 className="text-base font-bold text-white mb-4 flex items-center justify-between">
            <span>High-Frequency Alpha Features</span>
            <span className="text-xs text-slate-400 font-mono">{features.filter(f => f.enabled).length} / {features.length} Enabled</span>
          </h3>

          <div className="space-y-3">
            {features.map((f) => (
              <div
                key={f.id}
                onClick={() => toggleFeature(f.id)}
                className={`p-4 rounded-xl border transition-all cursor-pointer flex items-start gap-4 ${
                  f.enabled
                    ? 'bg-slate-950 border-emerald-500/40 shadow-lg'
                    : 'bg-slate-950/40 border-slate-800/80 opacity-60 hover:opacity-80'
                }`}
              >
                <button className="mt-1 text-emerald-400">
                  {f.enabled ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-slate-600" />}
                </button>

                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-white">{f.name}</h4>
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-cyan-300">
                      Importance: {(f.importance * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{f.description}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[10px] font-mono px-2 py-0.5 bg-slate-900 border border-slate-800 text-slate-300 rounded">
                      Category: {f.category}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Model Hyperparameters (1 column) */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Sliders className="w-4 h-4 text-emerald-400" /> Model Hyperparameters
          </h3>

          <div className="space-y-4">
            <div>
              <label className="text-xs text-slate-300 font-medium mb-1 block">Model Framework</label>
              <select
                value={modelType}
                onChange={(e: any) => setModelType(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono focus:border-emerald-500"
              >
                <option value="LightGBM">LightGBM (Approach B - Fast GBDT)</option>
                <option value="XGBoost">XGBoost (Approach B - Depth Trees)</option>
                <option value="ONNX_PyTorch">PyTorch ONNX (Approach A - Native MQL5)</option>
              </select>
            </div>

            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>Signal Confidence Threshold</span>
                <span className="font-mono text-emerald-400">{(confidenceThreshold * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0.55"
                max="0.85"
                step="0.01"
                value={confidenceThreshold}
                onChange={(e) => setConfidenceThreshold(Number(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Trades are only triggered when $P(\text&#123;BUY&#125;) &gt; {(confidenceThreshold * 100).toFixed(0)}\%$ or $P(\text&#123;SELL&#125;) &gt; {(confidenceThreshold * 100).toFixed(0)}\%$. Higher values increase win rate but decrease trade frequency.
              </p>
            </div>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
              <div className="text-xs font-bold text-slate-200">Export Strategy Config</div>
              <p className="text-[11px] text-slate-400">
                Configurations are automatically converted to JSON payloads for <code className="text-emerald-400 font-mono">forex_ai_engine.py</code> or compiled into ONNX tensors.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
