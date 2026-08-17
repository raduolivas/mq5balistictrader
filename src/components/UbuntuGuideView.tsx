import React, { useState } from 'react';
import { LINUX_DEPLOYMENT_STEPS } from '../data/forexData';
import { Server, Terminal, Copy, Check, ExternalLink, ShieldCheck, Zap } from 'lucide-react';

export const UbuntuGuideView: React.FC = () => {
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const handleCopyCommand = (id: number, command: string) => {
    navigator.clipboard.writeText(command);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-semibold mb-2">
              <Server className="w-3.5 h-3.5" /> Ubuntu Linux Production Hosting Guide
            </div>
            <h2 className="text-xl font-bold text-white">
              MetaTrader 5 & Python AI Colocation Deployment on Ubuntu Linux
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Step-by-step shell commands to run MT5 headlessly under Wine 9 with XVFB and systemd auto-recovery on an Equinix LD4 (London) / NY4 VPS.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="px-3 py-1.5 bg-slate-800 text-slate-300 text-xs font-mono rounded-lg border border-slate-700">
              Ping to LD4: &lt; 0.8 ms
            </span>
          </div>
        </div>
      </div>

      {/* Deployment Steps Accordion / Card List */}
      <div className="space-y-6">
        {LINUX_DEPLOYMENT_STEPS.map((step) => (
          <div key={step.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
              <div className="flex items-center gap-3">
                <span className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 font-bold font-mono text-xs flex items-center justify-center border border-emerald-500/20">
                  {step.id}
                </span>
                <h3 className="text-base font-bold text-white">{step.title}</h3>
              </div>

              <span className="px-2.5 py-1 text-xs font-mono bg-slate-800 text-cyan-300 rounded-md border border-slate-700">
                {step.category}
              </span>
            </div>

            <p className="text-xs text-slate-300 mb-4">{step.description}</p>

            {/* Terminal Shell Window */}
            <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden font-mono text-xs text-slate-200">
              <div className="bg-slate-900/80 px-4 py-2 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-400 text-[11px]">
                  <Terminal className="w-3.5 h-3.5 text-emerald-400" /> bash ~ ubuntu@vps-ld4
                </div>

                <button
                  onClick={() => handleCopyCommand(step.id, step.command)}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium rounded border border-slate-700 flex items-center gap-1 transition-all"
                >
                  {copiedId === step.id ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" /> Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3 text-slate-400" /> Copy Shell Script
                    </>
                  )}
                </button>
              </div>

              <div className="p-4 overflow-x-auto">
                <pre className="whitespace-pre"><code>{step.command}</code></pre>
              </div>
            </div>

            {step.notes && (
              <div className="mt-3 text-[11px] text-slate-400 flex items-center gap-2 italic">
                <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>Note: {step.notes}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
