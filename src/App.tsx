import React, { useState } from 'react';
import { Header } from './components/Header';
import { ArchitectureView } from './components/ArchitectureView';
import { CodeGeneratorView } from './components/CodeGeneratorView';
import { BacktestView } from './components/BacktestView';
import { MlStudioView } from './components/MlStudioView';
import { RiskEngineView } from './components/RiskEngineView';
import { UbuntuGuideView } from './components/UbuntuGuideView';
import { AiReviewView } from './components/AiReviewView';
import { ForexPair } from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('architecture');
  const [selectedPair, setSelectedPair] = useState<ForexPair>('EUR/USD');
  const [isSimulating, setIsSimulating] = useState<boolean>(true);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased selection:bg-emerald-500 selection:text-slate-950">
      {/* Header Bar */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedPair={selectedPair}
        setSelectedPair={setSelectedPair}
        isSimulating={isSimulating}
        setIsSimulating={setIsSimulating}
      />

      {/* Main Content Stage */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'architecture' && (
          <ArchitectureView onSelectTab={(tab) => setActiveTab(tab)} />
        )}

        {activeTab === 'code' && (
          <CodeGeneratorView />
        )}

        {activeTab === 'backtest' && (
          <BacktestView selectedPair={selectedPair} setSelectedPair={setSelectedPair} />
        )}

        {activeTab === 'ml-studio' && (
          <MlStudioView />
        )}

        {activeTab === 'risk' && (
          <RiskEngineView />
        )}

        {activeTab === 'ubuntu' && (
          <UbuntuGuideView />
        )}

        {activeTab === 'ai-review' && (
          <AiReviewView selectedPair={selectedPair} />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 mt-12 text-center text-xs text-slate-500 font-mono">
        <div className="max-w-7xl mx-auto px-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            MetaTrader 5 Forex AI Trading Studio &bull; MQL5 & PyZMQ Hybrid Architecture
          </div>
          <div className="flex items-center gap-4 text-slate-400">
            <span>Wine 9.0+ Headless</span>
            <span>ZeroMQ IPC :5555/:5556</span>
            <span>Equinix LD4 / NY4</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
