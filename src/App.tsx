import { lazy, Suspense, useState } from 'react';
import { Header } from './components/Header';
import type { ForexPair } from './types';

const ArchitectureView = lazy(() =>
  import('./components/ArchitectureView').then((module) => ({ default: module.ArchitectureView })),
);
const CodeGeneratorView = lazy(() =>
  import('./components/CodeGeneratorView').then((module) => ({ default: module.CodeGeneratorView })),
);
const BacktestView = lazy(() =>
  import('./components/BacktestView').then((module) => ({ default: module.BacktestView })),
);
const MlStudioView = lazy(() =>
  import('./components/MlStudioView').then((module) => ({ default: module.MlStudioView })),
);
const RiskEngineView = lazy(() =>
  import('./components/RiskEngineView').then((module) => ({ default: module.RiskEngineView })),
);
const UbuntuGuideView = lazy(() =>
  import('./components/UbuntuGuideView').then((module) => ({ default: module.UbuntuGuideView })),
);
const AiReviewView = lazy(() =>
  import('./components/AiReviewView').then((module) => ({ default: module.AiReviewView })),
);

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('architecture');
  const [selectedPair, setSelectedPair] = useState<ForexPair>('EUR/USD');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased selection:bg-emerald-500 selection:text-slate-950">
      {/* Header Bar */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedPair={selectedPair}
        setSelectedPair={setSelectedPair}
      />

      {/* Main Content Stage */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Suspense
          fallback={(
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-xs text-slate-400" role="status">
              Loading workspace…
            </div>
          )}
        >
          {activeTab === 'architecture' && (
            <ArchitectureView onSelectTab={(tab) => setActiveTab(tab)} />
          )}

          {activeTab === 'code' && <CodeGeneratorView />}

          {activeTab === 'backtest' && (
            <BacktestView selectedPair={selectedPair} setSelectedPair={setSelectedPair} />
          )}

          {activeTab === 'ml-studio' && <MlStudioView />}

          {activeTab === 'risk' && <RiskEngineView />}

          {activeTab === 'ubuntu' && <UbuntuGuideView />}

          {activeTab === 'ai-review' && <AiReviewView selectedPair={selectedPair} />}
        </Suspense>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 mt-12 text-center text-xs text-slate-500 font-mono">
        <div className="max-w-7xl mx-auto px-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            MetaTrader 5 Forex AI Studio &bull; Simulation and Reference Architecture
          </div>
          <div className="flex items-center gap-4 text-slate-400">
            <span>Deterministic Monte Carlo</span>
            <span>Demo-safe</span>
            <span>Validate on target VPS</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
