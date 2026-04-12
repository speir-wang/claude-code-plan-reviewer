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
  app: ReturnType<typeof createApp>;
}

async function startDaemon(): Promise<Harness> {
  const storageDir = await mkdtemp(
    path.join(tmpdir(), 'plan-reviewer-sidebar-'),
  );
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
  return { server, sm, storageDir, baseUrl: `http://127.0.0.1:${port}`, app };
}

async function stopDaemon(h: Harness): Promise<void> {
  h.app.locals.sse.close();
  await new Promise<void>((r) => h.server.close(() => r()));
  await h.sm.flush();
  await rm(h.storageDir, { recursive: true, force: true });
}

test.describe('sidebar + conversation', () => {
  let harness: Harness;

  test.beforeEach(async () => {
    harness = await startDaemon();
  });

  test.afterEach(async () => {
    await stopDaemon(harness);
  });

  test('sidebar lists existing sessions with status badges', async ({
    page,
  }) => {
    const s1 = harness.sm.createSession('plan alpha');
    harness.sm.markApproved(s1.id);
    harness.sm.createSession('plan beta');

    await page.goto(`${harness.baseUrl}/`);

    const sidebar = page.locator('[data-sidebar]');
    await expect(sidebar).toBeVisible();

    const items = sidebar.locator('[data-session-item]');
    await expect(items).toHaveCount(2);

    // Both sessions appear with their respective status badges.
    await expect(
      sidebar.locator('[data-session-status][data-status="active"]'),
    ).toHaveCount(1);
    await expect(
      sidebar.locator('[data-session-status][data-status="approved"]'),
    ).toHaveCount(1);
  });

  test('sidebar updates live when a new session is created via SSE', async ({
    page,
  }) => {
    await page.goto(`${harness.baseUrl}/`);

    const sidebar = page.locator('[data-sidebar]');
    await expect(sidebar).toBeVisible();

    // Initially no sessions.
    await expect(sidebar.locator('[data-session-item]')).toHaveCount(0);

    // Create a session on the server → triggers SSE global event.
    const session = harness.sm.createSession('new plan');
    harness.app.locals.sse.pushGlobal('session_updated', {
      sessionId: session.id,
    });

    // The sidebar should pick up the SSE event and re-render.
    await expect(sidebar.locator('[data-session-item]')).toHaveCount(1, {
      timeout: 3000,
    });
  });

  test('clicking a sidebar session navigates to it', async ({ page }) => {
    const session = harness.sm.createSession('click me plan');

    await page.goto(`${harness.baseUrl}/`);

    const sidebar = page.locator('[data-sidebar]');
    const item = sidebar.locator('[data-session-item]').first();
    await expect(item).toBeVisible();
    await item.locator('a').click();

    await expect(page).toHaveURL(
      new RegExp(`[?&]session=${session.id}`),
    );
    // Plan should render after navigation.
    await expect(page.locator('[data-plan-block]')).toHaveCount(1);
  });

  test('conversation history shows plan and feedback entries', async ({
    page,
  }) => {
    const session = harness.sm.createSession('Plan version one.');
    harness.sm.addConversationEntry(session.id, {
      role: 'user',
      type: 'feedback',
      content: '<plan_review type="feedback">...</plan_review>',
    });

    await page.goto(`${harness.baseUrl}/?session=${session.id}`);

    const conv = page.locator('[data-conversation]');
    await expect(conv).toBeVisible();

    const entries = conv.locator('[data-conversation-entry]');
    await expect(entries).toHaveCount(2);

    // First entry is the plan submission (role: claude).
    const planEntry = entries.first();
    await expect(planEntry).toHaveAttribute('data-role', 'claude');
    await expect(planEntry).toHaveAttribute('data-type', 'plan');

    // Second entry is the feedback (role: user).
    const feedbackEntry = entries.nth(1);
    await expect(feedbackEntry).toHaveAttribute('data-role', 'user');
    await expect(feedbackEntry).toHaveAttribute('data-type', 'feedback');
  });

  test('no session selected shows sidebar and a "select a session" hint', async ({
    page,
  }) => {
    harness.sm.createSession('background session');

    await page.goto(`${harness.baseUrl}/`);

    // Sidebar still visible even with no session selected.
    await expect(page.locator('[data-sidebar]')).toBeVisible();
    await expect(page.locator('[data-sidebar] [data-session-item]')).toHaveCount(1);

    // Plan area shows the "no session selected" hint.
    await expect(page.locator('body')).toContainText(/no session selected/i);
  });
});
