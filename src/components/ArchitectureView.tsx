import React from 'react';
import { Cpu, Zap, ArrowRight, ShieldCheck, Terminal, Layers, RefreshCw, CheckCircle2 } from 'lucide-react';

interface ArchitectureViewProps {
  onSelectTab: (tab: string) => void;
}

export const ArchitectureView: React.FC<ArchitectureViewProps> = ({ onSelectTab }) => {
  return (
    <div className="space-y-8">
      {/* Overview Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border border-slate-800 rounded-2xl p-6 md:p-8 relative overflow-hidden shadow-2xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-3xl relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold mb-4">
            <Zap className="w-3.5 h-3.5" /> Both Approaches Included & Ready to Deploy
          </div>
          <h2 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight mb-3">
            MetaTrader 5 Algorithmic Trading Architecture Blueprint
          </h2>
          <p className="text-slate-300 text-sm md:text-base leading-relaxed mb-6">
            Designed for software developers requiring high-performance, low-latency automated trading on MT5.
            Choose between **In-Process ONNX execution** for sub-millisecond execution or **ZeroMQ IPC** for Python AI feature engineering, or combine both into a unified dual-execution strategy.
          </p>

          <div className="flex flex-wrap items-center gap-4">
            <button
              onClick={() => onSelectTab('code')}
              className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/20 flex items-center gap-2 transition-all"
            >
              <Terminal className="w-4 h-4" /> Download / View All Scripts
            </button>
            <button
              onClick={() => onSelectTab('ubuntu')}
              className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs rounded-xl border border-slate-700 flex items-center gap-2 transition-all"
            >
              <Layers className="w-4 h-4" /> View Ubuntu Linux Colocation Setup
            </button>
          </div>
        </div>
      </div>

      {/* Side-by-Side Comparison Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Approach A: Native MQL5 ONNX */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between hover:border-slate-700 transition-all shadow-xl">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="px-3 py-1 bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-xs font-bold rounded-lg flex items-center gap-2">
                <Cpu className="w-3.5 h-3.5" /> Approach A: Pure In-Process ONNX
              </div>
              <span className="text-xs text-slate-400 font-mono">Latency: &lt; 0.5 ms</span>
            </div>

            <h3 className="text-xl font-bold text-slate-100 mb-2">Native MQL5 Expert Advisor + ONNX Model</h3>
            <p className="text-xs text-slate-300 mb-4 leading-relaxed">
              Trained Machine Learning models (XGBoost, Scikit-learn, PyTorch) are exported to `.onnx` and loaded directly inside the MQL5 process using MT5's native <code className="text-cyan-300 font-mono">OnnxRun()</code> C++ runtime API.
            </p>

            <div className="space-y-2 mb-6">
              <div className="flex items-start gap-2 text-xs text-slate-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span><strong>Zero IPC Overhead:</strong> Direct memory invocation inside the MT5 terminal process.</span>
              </div>
              <div className="flex items-start gap-2 text-xs text-slate-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span><strong>Single Script Deployment:</strong> Embed `.onnx` as a compiled resource into the `.ex5` binary.</span>
              </div>
              <div className="flex items-start gap-2 text-xs text-slate-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span><strong>Tick-Level Precision:</strong> Evaluates model inference on every incoming market tick in real-time.</span>
              </div>
            </div>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-xs text-slate-300 space-y-1 mb-6">
              <div className="text-slate-500">// MQL5 OnnxRun In-Process Execution</div>
              <div>long handle = OnnxCreateFromBuffer(ExtModel, ONNX_DEFAULT);</div>
              <div>OnnxSetInputShape(handle, 0, shapeIn);</div>
              <div>OnnxRun(handle, ONNX_NO_TRANSFORM, inputs, outputs);</div>
            </div>
          </div>

          <button
            onClick={() => onSelectTab('code')}
            className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-cyan-400 text-xs font-semibold rounded-xl border border-slate-700 flex items-center justify-center gap-2 transition-all"
          >
            Inspect ONNX_Forex_Predictor.mq5 <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Approach B: Hybrid MQL5 + Python ZeroMQ */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between hover:border-slate-700 transition-all shadow-xl">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="px-3 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-bold rounded-lg flex items-center gap-2">
                <Zap className="w-3.5 h-3.5" /> Approach B: Hybrid ZeroMQ Engine
              </div>
              <span className="text-xs text-slate-400 font-mono">Latency: 1.0 - 2.5 ms</span>
            </div>

            <h3 className="text-xl font-bold text-slate-100 mb-2">MQL5 Gateway + Headless Python IPC Worker</h3>
            <p className="text-xs text-slate-300 mb-4 leading-relaxed">
              MQL5 EA acts as a lightweight Market Gateway streaming tick feeds over <strong>ZeroMQ sockets</strong>. A headless Python strategy process handles complex AI models (LightGBM, DRL, Transformers), feature extraction, and risk checks.
            </p>

            <div className="space-y-2 mb-6">
              <div className="flex items-start gap-2 text-xs text-slate-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span><strong>Unconstrained Python Stack:</strong> Full ecosystem support (PyTorch, SciPy, LightGBM, Pandas, Asyncio).</span>
              </div>
              <div className="flex items-start gap-2 text-xs text-slate-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span><strong>Non-Blocking Execution:</strong> <code className="text-emerald-300 font-mono">OrderSendAsync()</code> in MQL5 prevents thread locks during volatility spikes.</span>
              </div>
              <div className="flex items-start gap-2 text-xs text-slate-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span><strong>Dynamic Model Retraining:</strong> Update ML weights in background without stopping MT5 chart.</span>
              </div>
            </div>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-xs text-slate-300 space-y-1 mb-6">
              <div className="text-slate-500"># Python PyZMQ High-Speed IPC Loop</div>
              <div>sub_socket.connect("tcp://127.0.0.1:5555")</div>
              <div>prob_long = lgb_model.predict(features)</div>
              <div>pub_socket.send_string(f"ORDER|BUY|EURUSD|0.10|12.0|24.0")</div>
            </div>
          </div>

          <button
            onClick={() => onSelectTab('code')}
            className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 text-xs font-semibold rounded-xl border border-slate-700 flex items-center justify-center gap-2 transition-all"
          >
            Inspect ZeroMQ EA & forex_ai_engine.py <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Structural Workflow Diagram */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
          <Layers className="w-4 h-4 text-emerald-400" /> High-Performance End-to-End System Pipeline
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-center">
            <div className="text-xs font-mono text-emerald-400 mb-1">1. Market Feed</div>
            <div className="text-sm font-bold text-slate-200">MT5 OnTick Event</div>
            <div className="text-[11px] text-slate-400 mt-2">Pulls Bid/Ask prices, tick volume, and Order Book depth.</div>
          </div>

          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-center">
            <div className="text-xs font-mono text-cyan-400 mb-1">2. IPC Transport</div>
            <div className="text-sm font-bold text-slate-200">ZeroMQ Socket / ONNX</div>
            <div className="text-[11px] text-slate-400 mt-2">Streams tick payload in &lt; 1ms to AI Strategy Engine.</div>
          </div>

          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-center">
            <div className="text-xs font-mono text-purple-400 mb-1">3. AI Inference</div>
            <div className="text-sm font-bold text-slate-200">Feature Engineering & ML</div>
            <div className="text-[11px] text-slate-400 mt-2">Calculates Order Flow Imbalance (OFI), Spread Z-score, & Model Signal.</div>
          </div>

          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-center">
            <div className="text-xs font-mono text-amber-400 mb-1">4. Order Execution</div>
            <div className="text-sm font-bold text-slate-200">Async Risk & Execution</div>
            <div className="text-[11px] text-slate-400 mt-2">Enforces ATR lot sizing, daily drawdown limit, & submits OrderSendAsync.</div>
          </div>
        </div>
      </div>
    </div>
  );
};
