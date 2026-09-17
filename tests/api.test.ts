import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import type { Express } from 'express';

import { createApp, type AppDependencies } from '../src/server/app';

async function withServer(
  run: (baseUrl: string) => Promise<void>,
  dependencies: AppDependencies = {},
): Promise<void> {
  const app: Express = createApp(dependencies);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const { port } = server.address() as AddressInfo;

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test('health endpoint exposes a stable status contract', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.system, 'Linux Ubuntu MT5 Architecture Engine');
    assert.match(body.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  });
});

test('rejects invalid capital with an opaque public message', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/run-simulation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initialBalance: -1 }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid simulation request' });
  });
});

test('new simulation endpoint and legacy backtest alias return the same deterministic response', async () => {
  await withServer(async (baseUrl) => {
    const request = { pair: 'GBP/USD', seed: 93, tradeCount: 24 };
    const responses = await Promise.all(['/api/run-simulation', '/api/run-backtest'].map((route) =>
      fetch(`${baseUrl}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      }),
    ));

    assert.deepEqual(await responses[0].json(), await responses[1].json());
  });
});

test('oversized JSON payloads receive a controlled API error', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/run-simulation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(33 * 1024) }),
    });

    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: 'Request body too large' });
  });
});

test('AI review validates field lengths before calling a provider', async () => {
  let providerCalls = 0;
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/ai-strategy-review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'x'.repeat(4_001) }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid AI review request' });
    assert.equal(providerCalls, 0);
  }, {
    getAiClient: () => {
      providerCalls += 1;
      return null;
    },
  });
});

test('AI review uses a deterministic fallback when no API client is configured', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/ai-strategy-review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ strategyName: 'Safe strategy', pair: 'EUR/USD', question: 'Review this.' }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.isFallback, true);
    assert.match(body.advice, /Safe strategy/);
    assert.match(body.advice, /gateway is experimental/);
    assert.doesNotMatch(body.advice, /provides a strong edge/);
  }, { getAiClient: () => null });
});

test('provider failures never expose upstream exception details', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/ai-strategy-review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Review this strategy.' }),
    });
    const text = await response.text();

    assert.equal(response.status, 500);
    assert.deepEqual(JSON.parse(text), { error: 'Failed to generate AI advice' });
    assert.doesNotMatch(text, /secret upstream failure/);
  }, {
    getAiClient: () => ({
      models: {
        generateContent: async () => { throw new Error('secret upstream failure'); },
      },
    }),
    logger: { error: () => undefined },
  });
});

test('AI provider calls time out and abort without exposing timeout details', async () => {
  let providerSignal: AbortSignal | undefined;
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/ai-strategy-review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Review this strategy.' }),
    });

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Failed to generate AI advice' });
    assert.equal(providerSignal?.aborted, true);
  }, {
    getAiClient: () => ({
      models: {
        generateContent: ({ config }) => {
          providerSignal = config?.abortSignal;
          return new Promise(() => undefined);
        },
      },
    }),
    aiTimeoutMs: 5,
    logger: { error: () => undefined },
  });
});

test('AI endpoint applies an in-memory per-IP rate window', async () => {
  await withServer(async (baseUrl) => {
    const makeRequest = () => fetch(`${baseUrl}/api/ai-strategy-review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Review this.' }),
    });

    assert.equal((await makeRequest()).status, 200);
    assert.equal((await makeRequest()).status, 200);
    const blocked = await makeRequest();
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), { error: 'Too many AI review requests' });
  }, {
    getAiClient: () => null,
    aiRateLimit: { maxRequests: 2, windowMs: 60_000 },
    now: () => 100,
  });
});
