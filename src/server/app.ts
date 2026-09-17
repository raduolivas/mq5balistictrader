import { GoogleGenAI } from '@google/genai';
import express from 'express';
import type { ErrorRequestHandler, Express, Request } from 'express';

import type { ForexPair } from '../types';
import {
  parseSimulationInput as defaultParseSimulationInput,
  runSimulation as defaultRunSimulation,
} from './simulation';

export interface AiClient {
  models: {
    generateContent(request: {
      model: string;
      contents: string;
      config?: { abortSignal?: AbortSignal };
    }): Promise<{ text?: string }>;
  };
}

export interface AppDependencies {
  parseSimulationInput?: typeof defaultParseSimulationInput;
  runSimulation?: typeof defaultRunSimulation;
  getAiClient?: () => AiClient | null;
  now?: () => number;
  aiRateLimit?: {
    maxRequests: number;
    windowMs: number;
    maxTrackedIps?: number;
  };
  aiTimeoutMs?: number;
  logger?: Pick<Console, 'error'>;
}

interface AiReviewInput {
  strategyName: string;
  pair: ForexPair;
  features: string[];
  riskParams: {
    maxDailyDrawdown: number;
    stopLossATR: number;
    maxLotSize: number;
  };
  question: string;
}

interface RateWindow {
  startedAt: number;
  count: number;
}

const FOREX_PAIRS: readonly ForexPair[] = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD'];
const DEFAULT_AI_RATE_LIMIT = { maxRequests: 10, windowMs: 60_000 };
const DEFAULT_MAX_TRACKED_IPS = 10_000;
const DEFAULT_AI_TIMEOUT_MS = 15_000;

function defaultAiClientFactory(): AiClient | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey }) as unknown as AiClient;
}

function invalidAiInput(): never {
  throw new TypeError('Invalid AI review input');
}

function stringField(value: unknown, fallback: string, maximumLength: number): string {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string' || value.length > maximumLength) return invalidAiInput();
  return value;
}

function finiteField(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    return invalidAiInput();
  }
  return value;
}

function parseAiReviewInput(value: unknown): AiReviewInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalidAiInput();
  const body = value as Record<string, unknown>;
  const pair = body.pair ?? 'EUR/USD';
  if (typeof pair !== 'string' || !FOREX_PAIRS.includes(pair as ForexPair)) return invalidAiInput();

  const rawFeatures = body.features ?? ['OFI', 'ATR_Ratio', 'Spread_ZScore', 'RSI_Divergence'];
  if (!Array.isArray(rawFeatures) || rawFeatures.length > 20) return invalidAiInput();
  const features = rawFeatures.map((feature) => {
    if (typeof feature !== 'string' || feature.length === 0 || feature.length > 100) return invalidAiInput();
    return feature;
  });

  const rawRiskParams = body.riskParams ?? {};
  if (typeof rawRiskParams !== 'object' || rawRiskParams === null || Array.isArray(rawRiskParams)) {
    return invalidAiInput();
  }
  const riskParams = rawRiskParams as Record<string, unknown>;

  return {
    strategyName: stringField(body.strategyName, 'XGBoost Forex ML Strategy', 120),
    pair: pair as ForexPair,
    features,
    riskParams: {
      maxDailyDrawdown: finiteField(riskParams.maxDailyDrawdown, 2, 0.1, 25),
      stopLossATR: finiteField(riskParams.stopLossATR, 1.5, 0.1, 10),
      maxLotSize: finiteField(riskParams.maxLotSize, 1, 0.001, 100),
    },
    question: stringField(
      body.question,
      'How can I optimize this strategy for European session liquidity on Ubuntu with minimal latency?',
      4_000,
    ),
  };
}

function fallbackAdvice(input: AiReviewInput): string {
  return `[AI Advisor Note: GEMINI_API_KEY is missing in secrets, using algorithmic fallback rules]\n\n` +
    `Strategy Review for ${input.strategyName} on ${input.pair}:\n` +
    `1. Feature Engineering: Treat Order Flow Imbalance (OFI) plus ATR volatility ratio as a candidate feature set; validate it out-of-sample and include spread and slippage costs before deployment.\n` +
    `2. Risk Management: Independently validate the ${input.riskParams.maxDailyDrawdown}% daily limit, and pause on abnormal spread or stale market data.\n` +
    `3. Integration Status: The repository ZeroMQ MQL5 gateway is experimental and does not yet transport messages. Implement and test that adapter before deployment, then measure end-to-end latency percentiles on the target VPS.`;
}

function aiPrompt(input: AiReviewInput): string {
  return `You are a Quantitative Forex Trading Systems Architect specializing in MetaTrader 5 (MT5), MQL5, ZeroMQ IPC, and Linux (Ubuntu) execution environments.
Review the following Forex strategy setup and provide expert, highly technical suggestions on feature engineering, low-latency execution, spread protection, and ML model guardrails:

- Strategy Name: ${input.strategyName}
- Target Currency Pair: ${input.pair}
- Features Selected: ${JSON.stringify(input.features)}
- Risk Constraints: ${JSON.stringify(input.riskParams)}
- Developer Query: ${input.question}`;
}

function clientIp(request: Request): string {
  return request.ip || request.socket.remoteAddress || 'unknown';
}

async function generateAiContent(
  client: AiClient,
  prompt: string,
  timeoutMs: number,
): Promise<{ text?: string }> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('AI provider request timed out'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: { abortSignal: controller.signal },
      }),
      timeoutPromise,
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function createApp(dependencies: AppDependencies = {}): Express {
  const app = express();
  const parseSimulationInput = dependencies.parseSimulationInput ?? defaultParseSimulationInput;
  const runSimulation = dependencies.runSimulation ?? defaultRunSimulation;
  const createAiClient = dependencies.getAiClient ?? defaultAiClientFactory;
  const now = dependencies.now ?? Date.now;
  const aiRateLimit: NonNullable<AppDependencies['aiRateLimit']> =
    dependencies.aiRateLimit ?? DEFAULT_AI_RATE_LIMIT;
  const maxTrackedIps = aiRateLimit.maxTrackedIps ?? DEFAULT_MAX_TRACKED_IPS;
  const aiTimeoutMs = dependencies.aiTimeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
  const logger = dependencies.logger ?? console;
  const rateWindows = new Map<string, RateWindow>();
  let lastRateWindowSweep = Number.NEGATIVE_INFINITY;
  let cachedAiClient: AiClient | null | undefined;

  if (!Number.isInteger(aiRateLimit.maxRequests) || aiRateLimit.maxRequests < 1 ||
      !Number.isFinite(aiRateLimit.windowMs) || aiRateLimit.windowMs <= 0) {
    throw new TypeError('Invalid AI rate-limit configuration');
  }
  if (!Number.isInteger(maxTrackedIps) || maxTrackedIps < 1 || maxTrackedIps > 1_000_000) {
    throw new TypeError('Invalid AI rate-limit cache size');
  }
  if (!Number.isFinite(aiTimeoutMs) || aiTimeoutMs <= 0 || aiTimeoutMs > 120_000) {
    throw new TypeError('Invalid AI provider timeout configuration');
  }

  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb', strict: true }));

  app.get('/api/health', (_request, response) => {
    response.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      system: 'Linux Ubuntu MT5 Architecture Engine',
    });
  });

  app.post(['/api/run-simulation', '/api/run-backtest'], (request, response) => {
    try {
      response.json(runSimulation(parseSimulationInput(request.body)));
    } catch {
      response.status(400).json({ error: 'Invalid simulation request' });
    }
  });

  app.post('/api/ai-strategy-review', async (request, response) => {
    let input: AiReviewInput;
    try {
      input = parseAiReviewInput(request.body);
    } catch {
      response.status(400).json({ error: 'Invalid AI review request' });
      return;
    }

    const timestamp = now();
    const ip = clientIp(request);
    if (timestamp - lastRateWindowSweep >= aiRateLimit.windowMs) {
      for (const [trackedIp, trackedWindow] of rateWindows) {
        if (timestamp - trackedWindow.startedAt >= aiRateLimit.windowMs) {
          rateWindows.delete(trackedIp);
        }
      }
      lastRateWindowSweep = timestamp;
    }
    if (!rateWindows.has(ip) && rateWindows.size >= maxTrackedIps) {
      const oldestTrackedIp = rateWindows.keys().next().value as string | undefined;
      if (oldestTrackedIp !== undefined) rateWindows.delete(oldestTrackedIp);
    }
    const previousWindow = rateWindows.get(ip);
    const window = previousWindow && timestamp - previousWindow.startedAt < aiRateLimit.windowMs
      ? previousWindow
      : { startedAt: timestamp, count: 0 };
    window.count += 1;
    rateWindows.set(ip, window);
    if (window.count > aiRateLimit.maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((window.startedAt + aiRateLimit.windowMs - timestamp) / 1_000));
      response.setHeader('retry-after', String(retryAfterSeconds));
      response.status(429).json({ error: 'Too many AI review requests' });
      return;
    }

    try {
      if (cachedAiClient === undefined) cachedAiClient = createAiClient();
      if (!cachedAiClient) {
        response.json({ advice: fallbackAdvice(input), isFallback: true });
        return;
      }

      const result = await generateAiContent(cachedAiClient, aiPrompt(input), aiTimeoutMs);
      response.json({ advice: result.text || 'No AI feedback generated.', isFallback: false });
    } catch (error) {
      logger.error('AI strategy review failed', error);
      response.status(500).json({ error: 'Failed to generate AI advice' });
    }
  });

  const jsonErrorHandler: ErrorRequestHandler = (error, _request, response, next) => {
    const parserError = error as { status?: number; type?: string };
    if (parserError.status === 413 || parserError.type === 'entity.too.large') {
      response.status(413).json({ error: 'Request body too large' });
      return;
    }
    if (parserError.status === 400) {
      response.status(400).json({ error: 'Invalid JSON request' });
      return;
    }
    next(error);
  };
  app.use(jsonErrorHandler);

  return app;
}
