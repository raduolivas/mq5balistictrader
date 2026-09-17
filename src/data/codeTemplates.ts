import dockerCompose from '../../deploy/docker-compose.yml?raw';
import onnxExpert from '../../mql5/Experts/ONNX_Forex_Predictor.mq5?raw';
import zeroMqGateway from '../../mql5/Experts/ZeroMQ_Forex_Gateway.mq5?raw';
import forexEngine from '../../python/forex_ai_engine.py?raw';
import modelTrainer from '../../python/train_onnx_model.py?raw';

export interface CodeFileTemplate {
  filename: string;
  sourcePath: string;
  category: string;
  language: 'mql5' | 'python' | 'yaml';
  description: string;
  code: string;
  status: 'validated-source' | 'experimental';
}

/**
 * The explorer imports authoritative repository files as raw text at build time.
 * A downloadable snippet can therefore never drift away from the implementation.
 */
export const CODE_TEMPLATES: CodeFileTemplate[] = [
  {
    filename: 'ONNX_Forex_Predictor.mq5',
    sourcePath: 'mql5/Experts/ONNX_Forex_Predictor.mq5',
    category: 'Approach A: Native MQL5 + ONNX',
    language: 'mql5',
    description: 'Risk-guarded EA with runtime ONNX and strategy-parameter reload support.',
    code: onnxExpert,
    status: 'validated-source',
  },
  {
    filename: 'ZeroMQ_Forex_Gateway.mq5',
    sourcePath: 'mql5/Experts/ZeroMQ_Forex_Gateway.mq5',
    category: 'Approach B: ZeroMQ transport skeleton',
    language: 'mql5',
    description: 'Experimental gateway skeleton; socket send/receive integration is not implemented yet.',
    code: zeroMqGateway,
    status: 'experimental',
  },
  {
    filename: 'forex_ai_engine.py',
    sourcePath: 'python/forex_ai_engine.py',
    category: 'Signal-only Python worker',
    language: 'python',
    description: 'Validated, bounded per-symbol heuristic signal worker. It never sizes or submits orders.',
    code: forexEngine,
    status: 'validated-source',
  },
  {
    filename: 'train_onnx_model.py',
    sourcePath: 'python/train_onnx_model.py',
    category: 'Training and ONNX export',
    language: 'python',
    description: 'Training pipeline used to produce the repository ONNX artifact.',
    code: modelTrainer,
    status: 'validated-source',
  },
  {
    filename: 'docker-compose.yml',
    sourcePath: 'deploy/docker-compose.yml',
    category: 'Containerized Python worker',
    language: 'yaml',
    description: 'Hardened runtime definition for the Python signal worker.',
    code: dockerCompose,
    status: 'validated-source',
  },
];
