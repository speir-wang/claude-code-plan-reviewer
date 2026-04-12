import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { SessionManager } from '../../src/session-manager.js';
import { createApp } from '../../src/http-server.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BROWSER_DIST = path.resolve(HERE, '..', '..', 'dist', 'browser');

interface Harness {
  server: Server;
  sm: SessionManager;
  storageDir: string;
  baseUrl: string;
}

async function startDaemon(): Promise<Harness> {
  const storageDir = await mkdtemp(path.join(tmpdir(), 'plan-reviewer-browser-'));
  const sm = new SessionManager({ storageDir });
  await sm.init();
  const app = createApp({
    sessionManager: sm,
    openBrowser: () => {},
    browserDistDir: BROWSER_DIST,
  });
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as { port: number };
  return { server, sm, storageDir, baseUrl: `http://127.0.0.1:${port}` };
}

async function stopDaemon(h: Harness): Promise<void> {
  h.server.closeAllConnections();
  await new Promise<void>((r) => h.server.close(() => r()));
  await h.sm.flush();
  await rm(h.storageDir, { recursive: true, force: true });
}

const SAMPLE_PLAN = `# Add Dark Mode

This plan introduces a dark mode toggle.

## Goals

- Respect the user's system preference by default.
- Persist the override in localStorage.

## Non-goals

- Theming arbitrary accent colors.`;

test.describe('plan display', () => {
  let harness: Harness;

  test.beforeEach(async () => {
    harness = await startDaemon();
  });

  test.afterEach(async () => {
    await stopDaemon(harness);
  });

  test('renders markdown plan with per-block offset attributes', async ({ page }) => {
    const session = harness.sm.createSession(SAMPLE_PLAN);

    await page.goto(`${harness.baseUrl}/?session=${session.id}`);

    // Heading from the plan's markdown should be visible.
    await expect(page.getByRole('heading', { name: 'Add Dark Mode' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Goals', exact: true }),
    ).toBeVisible();

    // Every top-level block must carry a numeric data-offset attribute so
    // annotations can anchor by character range in the original plan text.
    const blocks = page.locator('[data-plan-block][data-offset]');
    const count = await blocks.count();
    expect(count).toBeGreaterThanOrEqual(4);

    // Offsets must be strictly increasing and within the plan length.
    const offsets: number[] = [];
    for (let i = 0; i < count; i++) {
      const raw = await blocks.nth(i).getAttribute('data-offset');
      expect(raw).not.toBeNull();
      const n = Number(raw);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(SAMPLE_PLAN.length);
      offsets.push(n);
    }
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]!).toBeGreaterThan(offsets[i - 1]!);
    }

    // Each block's data-length must match the referenced substring.
    for (let i = 0; i < count; i++) {
      const offset = Number(await blocks.nth(i).getAttribute('data-offset'));
      const length = Number(await blocks.nth(i).getAttribute('data-length'));
      expect(length).toBeGreaterThan(0);
      expect(offset + length).toBeLessThanOrEqual(SAMPLE_PLAN.length);
    }
  });

  test('renders unordered lists as real <li> elements', async ({ page }) => {
    const session = harness.sm.createSession(SAMPLE_PLAN);
    await page.goto(`${harness.baseUrl}/?session=${session.id}`);

    const items = page.locator('#plan-container li');
    await expect(items).toHaveCount(3);
    await expect(items.first()).toContainText('system preference');
  });

  test('shows a helpful message when the session does not exist', async ({ page }) => {
    await page.goto(`${harness.baseUrl}/?session=missing-id`);
    await expect(page.locator('body')).toContainText(/session not found/i);
  });

  test('shows a helpful message when no session id is in the URL', async ({ page }) => {
    await page.goto(`${harness.baseUrl}/`);
    await expect(page.locator('body')).toContainText(/no session selected/i);
  });
});
