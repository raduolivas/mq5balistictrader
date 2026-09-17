import React, { useEffect, useRef, useState } from 'react';
import type { ForexPair } from '../types';
import { Cpu, Bot, Sparkles, RefreshCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface AiReviewResponse {
  advice: string;
}

const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === 'AbortError';

interface AiReviewViewProps {
  selectedPair: ForexPair;
}

export const AiReviewView: React.FC<AiReviewViewProps> = ({ selectedPair }) => {
  const [strategyName, setStrategyName] = useState<string>('XGBoost Forex Regime Strategy');
  const [question, setQuestion] = useState<string>(
    `How can I optimize MQL5 OrderSendAsync() execution on Ubuntu Linux with ZeroMQ to maintain sub-15ms latency during European session volatility?`
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [aiAdvice, setAiAdvice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeRequestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setLoading(false);

    return () => {
      const activeRequest = activeRequestRef.current;
      activeRequestRef.current = null;
      activeRequest?.abort();
    };
  }, [selectedPair]);

  const handleConsultAi = async () => {
    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/ai-strategy-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyName,
          pair: selectedPair,
          features: ['Order Flow Imbalance (OFI)', 'Spread Z-Score', 'ATR Ratio', 'VWAP Deviation'],
          riskParams: { maxDailyDrawdown: 2.0, stopLossATR: 1.5, maxLotSize: 1.0 },
          question
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error('AI review request failed');
      }

      const data = await response.json() as AiReviewResponse;
      if (typeof data.advice !== 'string') {
        throw new Error('AI review response was invalid');
      }
      if (activeRequestRef.current !== controller) return;

      setAiAdvice(data.advice);
    } catch (requestError) {
      if (!isAbortError(requestError) && activeRequestRef.current === controller) {
        setError('The AI systems review is temporarily unavailable. Please try again.');
      }
    } finally {
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null;
        setLoading(false);
      }
    }
  };

  return (
    <div className="space-y-6" aria-busy={loading}>
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Cpu className="w-5 h-5 text-emerald-400" />
          Quant Systems AI Architecture Advisor
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Ask high-level developer questions regarding MQL5 concurrency, ZeroMQ IPC protocol design, ONNX model quantization, or Linux socket buffer tuning.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Input Form Column */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <h3 className="text-base font-bold text-white mb-2">Strategy Context</h3>

          <div>
            <label className="text-xs text-slate-400 font-medium mb-1 block">Strategy Name</label>
            <input
              type="text"
              value={strategyName}
              onChange={(e) => setStrategyName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:border-emerald-500 font-mono"
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 font-medium mb-1 block">Selected Pair</label>
            <div className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-emerald-400 font-mono font-bold">
              {selectedPair}
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 font-medium mb-1 block">Developer Technical Query</label>
            <textarea
              rows={5}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-white focus:border-emerald-500 font-sans leading-relaxed"
              placeholder="Ask about MQL5 memory management, ZeroMQ sockets, or ONNX..."
            />
          </div>

          <button
            type="button"
            onClick={handleConsultAi}
            disabled={loading}
            className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
          >
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" /> Analyzing Quant Architecture...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" /> Request AI Systems Review
              </>
            )}
          </button>
        </div>

        {/* AI Output Column */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col shadow-2xl">
          <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
            <Bot className="w-5 h-5 text-emerald-400" /> AI Systems Engineer Recommendation
          </h3>

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
            >
              {error} Any previous recommendation remains available below.
            </div>
          )}

          <div className="flex-1 bg-slate-950 rounded-xl border border-slate-800 p-6 overflow-y-auto max-h-[500px] text-xs text-slate-200 leading-relaxed font-sans">
            {aiAdvice ? (
              <div className="markdown-body space-y-3">
                <ReactMarkdown>{aiAdvice}</ReactMarkdown>
              </div>
            ) : (
              <div className="h-64 flex flex-col items-center justify-center text-center text-slate-500">
                <Bot className="w-10 h-10 text-slate-700 mb-2" />
                <p>Click "Request AI Systems Review" to generate technical recommendations for your setup.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
