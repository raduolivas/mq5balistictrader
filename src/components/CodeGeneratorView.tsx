import React, { useState } from 'react';
import { CODE_TEMPLATES, CodeFileTemplate } from '../data/codeTemplates';
import { Copy, Check, Download, FileCode, Terminal, Layers, RefreshCw } from 'lucide-react';

export const CodeGeneratorView: React.FC = () => {
  const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0);
  const [copied, setCopied] = useState<boolean>(false);

  const currentTemplate: CodeFileTemplate = CODE_TEMPLATES[selectedFileIndex] || CODE_TEMPLATES[0];

  const handleCopy = () => {
    navigator.clipboard.writeText(currentTemplate.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([currentTemplate.code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = currentTemplate.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadAllZip = () => {
    // Generate individual downloads for key scripts
    CODE_TEMPLATES.forEach((tmpl, idx) => {
      setTimeout(() => {
        const blob = new Blob([tmpl.code], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = tmpl.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, idx * 300);
    });
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Terminal className="w-5 h-5 text-emerald-400" />
            MetaTrader 5 & Python AI Source Code Explorer
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Production-ready scripts for both Approach A (Pure Native MQL5 + ONNX) and Approach B (Hybrid MQL5 EA + Python ZeroMQ IPC Engine).
          </p>
        </div>

        <button
          onClick={handleDownloadAllZip}
          className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/20 flex items-center gap-2 transition-all"
        >
          <Download className="w-4 h-4" /> Download All Scripts ({CODE_TEMPLATES.length} Files)
        </button>
      </div>

      {/* Main Code View Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* File Sidebar */}
        <div className="lg:col-span-1 space-y-2">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-2 mb-2">
            Repository Files
          </div>

          {CODE_TEMPLATES.map((tmpl, idx) => {
            const isSelected = selectedFileIndex === idx;
            return (
              <button
                key={tmpl.filename}
                onClick={() => setSelectedFileIndex(idx)}
                className={`w-full text-left p-3 rounded-xl border transition-all flex flex-col gap-1 ${
                  isSelected
                    ? 'bg-slate-800 border-emerald-500/50 text-white shadow-md'
                    : 'bg-slate-900/60 border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold truncate">{tmpl.filename}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                    tmpl.language === 'mql5' ? 'bg-cyan-500/20 text-cyan-300' :
                    tmpl.language === 'python' ? 'bg-amber-500/20 text-amber-300' :
                    'bg-slate-700 text-slate-300'
                  }`}>
                    {tmpl.language.toUpperCase()}
                  </span>
                </div>
                <span className="text-[11px] text-slate-400 line-clamp-1">{tmpl.category}</span>
              </button>
            );
          })}
        </div>

        {/* Code Editor Preview Window */}
        <div className="lg:col-span-3 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col shadow-2xl">
          {/* File Header Toolbar */}
          <div className="bg-slate-950 px-6 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <FileCode className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-bold text-white font-mono">{currentTemplate.filename}</h3>
                <span className="px-2 py-0.5 text-xs bg-slate-800 text-slate-300 rounded border border-slate-700">
                  {currentTemplate.category}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">{currentTemplate.description}</p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 flex items-center gap-1.5 transition-all"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" /> Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-400" /> Copy Code
                  </>
                )}
              </button>

              <button
                onClick={handleDownload}
                className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 transition-all"
              >
                <Download className="w-3.5 h-3.5" /> Download Script
              </button>
            </div>
          </div>

          {/* Code Viewer Box */}
          <div className="p-6 bg-slate-950 overflow-x-auto max-h-[600px] overflow-y-auto font-mono text-xs text-slate-200 leading-relaxed">
            <pre className="whitespace-pre">
              <code>{currentTemplate.code}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
