#!/usr/bin/env node
/**
 * Plan Broker daemon entry point.
 *
 * Starts an Express HTTP server on port 3456 (configurable via
 * PLAN_REVIEWER_PORT) with session management, SSE channels, and the
 * blocking bridge that connects MCP tool calls to browser responses.
 *
 * Usage:
 *   node dist/main.js           # start daemon (foreground)
 *   node dist/main.js --daemon  # same; flag exists for launchd parity
 */

import { createApp } from './http-server.js';
import { SessionManager } from './session-manager.js';
import { exec } from 'node:child_process';

const DEFAULT_PORT = 3456;

function openInBrowser(url: string): void {
  // Best-effort: try macOS `open`, fall back to logging.
  exec(`open "${url}"`, (err) => {
    if (err) {
      process.stderr.write(`[plan-reviewer] Open ${url} in your browser.\n`);
    }
  });
}

async function main(): Promise<void> {
  const port = Number(process.env['PLAN_REVIEWER_PORT']) || DEFAULT_PORT;
  const sm = new SessionManager();
  await sm.init();

  const app = createApp({
    sessionManager: sm,
    openBrowser: openInBrowser,
  });

  const server = app.listen(port, () => {
    process.stderr.write(`[plan-reviewer] Broker listening on http://127.0.0.1:${port}\n`);
  });

  const shutdown = () => {
    process.stderr.write('[plan-reviewer] Shutting down…\n');
    app.locals.sse.close();
    server.closeAllConnections();
    server.close(() => {
      sm.flush()
        .catch(() => undefined)
        .finally(() => process.exit(0));
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  process.stderr.write(`[plan-reviewer] fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
