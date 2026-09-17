import 'dotenv/config';

import path from 'node:path';

import type { Server } from 'node:http';
import { createServer as createViteServer, type ViteDevServer } from 'vite';

import { createApp } from './src/server/app';

function configuredPort(value: string | undefined): number {
  if (value === undefined) return 3_000;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}

async function closeHttpServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

export async function startServer(): Promise<Server> {
  const app = createApp();
  const port = configuredPort(process.env.PORT);
  const host = process.env.HOST?.trim() || '0.0.0.0';
  let vite: ViteDevServer | undefined;

  if (process.env.NODE_ENV !== 'production') {
    vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const entryDirectory = path.dirname(path.resolve(process.argv[1] ?? '.'));
    const distPath = path.basename(entryDirectory) === 'dist'
      ? entryDirectory
      : path.join(entryDirectory, 'dist');
    app.use((await import('express')).default.static(distPath));
    app.get('*', (_request, response) => {
      response.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = await new Promise<Server>((resolve, reject) => {
    const listeningServer = app.listen(port, host, () => resolve(listeningServer));
    listeningServer.once('error', reject);
  });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[MT5 Forex AI Platform] ${signal} received, shutting down`);
    const forceExit = setTimeout(() => {
      console.error('[MT5 Forex AI Platform] Graceful shutdown timed out');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    try {
      await Promise.all([
        closeHttpServer(server),
        vite?.close() ?? Promise.resolve(),
      ]);
      clearTimeout(forceExit);
      process.exitCode = 0;
    } catch (error) {
      clearTimeout(forceExit);
      console.error('[MT5 Forex AI Platform] Shutdown failed', error);
      process.exitCode = 1;
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  console.log(`[MT5 Forex AI Platform] Server running on http://${host}:${port}`);
  return server;
}

void startServer().catch((error: unknown) => {
  console.error('[MT5 Forex AI Platform] Failed to start server', error);
  process.exitCode = 1;
});
