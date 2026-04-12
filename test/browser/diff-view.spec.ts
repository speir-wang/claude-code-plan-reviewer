import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { SessionManager } from '../../src/session-manager.js';
import { createApp } from '../../src/http-server.js';
import type { Comment } from '../../src/types.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BROWSER_DIST = path.resolve(HERE, '..', '..', 'dist', 'browser');

interface Harness {
  server: Server;
  sm: SessionManager;
  storageDir: string;
  baseUrl: string;
}

async function startDaemon(): Promise<Harness> {
  const storageDir = await mkdtemp(path.join(tmpdir(), 'plan-reviewer-diff-'));
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

const V1 = 'The quick brown fox jumps over the lazy dog.';
const V2 = 'The quick brown fox leaps over the lazy cat.';

function mkComment(
  id: string,
  anchor: string,
  source: string,
  note: string,
): Comment {
  const start = source.indexOf(anchor);
  if (start < 0) throw new Error(`anchor not in source: ${anchor}`);
  return {
    id,
    anchor,
    anchorStart: start,
    anchorEnd: start + anchor.length,
    note,
    resolved: false,
  };
}

test.describe('diff view', () => {
  let harness: Harness;

  test.beforeEach(async () => {
    harness = await startDaemon();
  });

  test.afterEach(async () => {
    await stopDaemon(harness);
  });

  test('two-version session renders inline diff with add/remove spans', async ({
    page,
  }) => {
    const session = harness.sm.createSession(V1);
    harness.sm.addPlanVersion(session.id, V2);

    await page.goto(`${harness.baseUrl}/?session=${session.id}`);

    const diffView = page.locator('[data-diff-view]');
    await expect(diffView).toBeVisible();

    // Added and removed segments are rendered as <ins>/<del>.
    const added = page.locator('[data-diff-view] ins.diff-add');
    const removed = page.locator('[data-diff-view] del.diff-remove');
    await expect(added).toHaveCount(2);
    await expect(removed).toHaveCount(2);
    await expect(diffView.locator('ins.diff-add').first()).toContainText('leaps');
    await expect(diffView.locator('del.diff-remove').first()).toContainText(
      'jumps',
    );
    await expect(diffView.locator('ins.diff-add').nth(1)).toContainText('cat');
    await expect(diffView.locator('del.diff-remove').nth(1)).toContainText('dog');

    // Unchanged text is still present verbatim.
    await expect(page.locator('[data-diff-view]')).toContainText(
      'The quick brown fox',
    );
    await expect(page.locator('[data-diff-view]')).toContainText('over the lazy');
  });

  test('prior comments auto-resolve when their anchor overlaps a change', async ({
    page,
  }) => {
    const session = harness.sm.createSession(V1);
    const v1 = session.planVersions[0]!;
    v1.comments = [
      mkComment('c-quick', 'quick', V1, 'still quick?'),
      mkComment('c-jumps', 'jumps', V1, 'verb choice'),
      mkComment('c-dog', 'lazy dog', V1, 'rename the subject'),
    ];
    harness.sm.addPlanVersion(session.id, V2);

    await page.goto(`${harness.baseUrl}/?session=${session.id}`);

    const priorList = page.locator('[data-prior-comment]');
    await expect(priorList).toHaveCount(3);

    // "quick" is unchanged → still open.
    const cQuick = page.locator('[data-prior-comment][data-comment-id="c-quick"]');
    await expect(cQuick).toHaveAttribute('data-resolved', 'false');
    await expect(cQuick).toContainText('still quick?');

    // "jumps" was replaced by "leaps" → auto-resolved.
    const cJumps = page.locator('[data-prior-comment][data-comment-id="c-jumps"]');
    await expect(cJumps).toHaveAttribute('data-resolved', 'true');
    await expect(cJumps).toContainText('verb choice');

    // "lazy dog" range contains the "dog"→"cat" change → auto-resolved.
    const cDog = page.locator('[data-prior-comment][data-comment-id="c-dog"]');
    await expect(cDog).toHaveAttribute('data-resolved', 'true');
    await expect(cDog).toContainText('rename the subject');
  });

  test('prior comments list is empty-friendly when v1 had no comments', async ({
    page,
  }) => {
    const session = harness.sm.createSession(V1);
    harness.sm.addPlanVersion(session.id, V2);

    await page.goto(`${harness.baseUrl}/?session=${session.id}`);

    await expect(page.locator('[data-diff-view]')).toBeVisible();
    await expect(page.locator('[data-prior-comment]')).toHaveCount(0);
    await expect(
      page.locator('[data-prior-comments-empty]'),
    ).toBeVisible();
  });

  test('single-version session still renders the plain plan (no diff view)', async ({
    page,
  }) => {
    const session = harness.sm.createSession(V1);

    await page.goto(`${harness.baseUrl}/?session=${session.id}`);

    await expect(page.locator('[data-diff-view]')).toHaveCount(0);
    await expect(page.locator('[data-plan-block]')).toHaveCount(1);
    await expect(page.locator('[data-plan-block]')).toContainText(
      'The quick brown fox',
    );
  });

  test('feedback controls still work in diff view mode', async ({ page }) => {
    const session = harness.sm.createSession(V1);
    harness.sm.addPlanVersion(session.id, V2);
    const waiter = harness.sm.waitForUserResponse(session.id);

    await page.goto(`${harness.baseUrl}/?session=${session.id}`);

    await expect(page.locator('[data-diff-view]')).toBeVisible();
    await page.locator('[data-action="approve"]').click();

    const xml = await waiter;
    expect(xml).toBe('<plan_review type="approved" />');
  });
});
