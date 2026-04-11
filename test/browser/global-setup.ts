import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Playwright global setup: build the browser bundle once before any test
 * runs, so every spec can serve `dist/browser/` via the real HTTP server.
 */
export default async function globalSetup(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(here, '..', '..');
  const result = spawnSync(
    process.execPath,
    [path.join(projectRoot, 'scripts', 'bundle-browser.js')],
    { cwd: projectRoot, stdio: 'inherit' },
  );
  if (result.status !== 0) {
    throw new Error(`bundle-browser.js failed with exit code ${result.status}`);
  }
}
