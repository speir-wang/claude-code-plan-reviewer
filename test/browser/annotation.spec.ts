import { test, expect, type Page } from '@playwright/test';
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
  const storageDir = await mkdtemp(path.join(tmpdir(), 'plan-reviewer-annot-'));
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
- Persist the override in localStorage.`;

async function selectInHeading(page: Page, needle: string): Promise<void> {
  await page.evaluate((text) => {
    const h1 = document.querySelector('h1');
    if (!h1 || !h1.firstChild) throw new Error('no h1 text node');
    const textNode = h1.firstChild as Text;
    const idx = (textNode.textContent ?? '').indexOf(text);
    if (idx < 0) throw new Error(`needle not in heading: ${text}`);
    const range = document.createRange();
    range.setStart(textNode, idx);
    range.setEnd(textNode, idx + text.length);
    const sel = window.getSelection();
    if (!sel) throw new Error('no selection api');
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, needle);
}

test.describe('annotation', () => {
  let harness: Harness;

  test.beforeEach(async () => {
    harness = await startDaemon();
  });

  test.afterEach(async () => {
    await stopDaemon(harness);
  });

  test('select text → add comment → comment persists + anchor highlighted', async ({
    page,
  }) => {
    const session = harness.sm.createSession(SAMPLE_PLAN);
    await page.goto(`${harness.baseUrl}/?session=${session.id}`);

    // No comments yet; the placeholder is showing.
    await expect(page.locator('[data-comment]')).toHaveCount(0);
    await expect(page.locator('[data-new-comment-placeholder]')).toBeVisible();

    await selectInHeading(page, 'Dark');

    // Selection picked up → "Add comment" button and selection preview visible.
    const addButton = page.getByRole('button', { name: /add comment/i });
    await expect(addButton).toBeVisible();
    await expect(page.locator('[data-selection-preview]')).toHaveText('Dark');

    await addButton.click();

    // Editor shows up.
    const textarea = page.locator('textarea[data-comment-editor]');
    await expect(textarea).toBeVisible();
    await textarea.fill('Please clarify what "dark" means.');
    await page.getByRole('button', { name: /^save$/i }).click();

    // Comment card rendered.
    const card = page.locator('[data-comment]');
    await expect(card).toHaveCount(1);
    await expect(card.first()).toContainText('Please clarify what "dark" means.');
    await expect(card.first().locator('[data-anchor]')).toHaveText('Dark');

    // Anchor text is highlighted in the plan with a comment-id attribute.
    const mark = page.locator('main mark[data-comment-id]');
    await expect(mark).toHaveCount(1);
    await expect(mark).toHaveText('Dark');

    // After saving, the editor and preview are cleared, placeholder returns.
    await expect(textarea).toHaveCount(0);
    await expect(page.locator('[data-new-comment-placeholder]')).toBeVisible();
  });

  test('cancel before saving clears the editor without adding a comment', async ({
    page,
  }) => {
    const session = harness.sm.createSession(SAMPLE_PLAN);
    await page.goto(`${harness.baseUrl}/?session=${session.id}`);
    await page.locator('h1').waitFor();

    await selectInHeading(page, 'Mode');
    await page.getByRole('button', { name: /add comment/i }).click();
    await page.locator('textarea[data-comment-editor]').fill('never mind');
    await page.getByRole('button', { name: /cancel/i }).click();

    await expect(page.locator('[data-comment]')).toHaveCount(0);
    await expect(page.locator('textarea[data-comment-editor]')).toHaveCount(0);
    await expect(page.locator('main mark[data-comment-id]')).toHaveCount(0);
  });

  test('delete a saved (unsubmitted) comment removes it and its highlight', async ({
    page,
  }) => {
    const session = harness.sm.createSession(SAMPLE_PLAN);
    await page.goto(`${harness.baseUrl}/?session=${session.id}`);
    await page.locator('h1').waitFor();

    await selectInHeading(page, 'Dark');
    await page.getByRole('button', { name: /add comment/i }).click();
    await page.locator('textarea[data-comment-editor]').fill('tbd');
    await page.getByRole('button', { name: /^save$/i }).click();

    await expect(page.locator('[data-comment]')).toHaveCount(1);
    await expect(page.locator('main mark[data-comment-id]')).toHaveCount(1);

    await page.locator('[data-comment] [data-delete]').click();

    await expect(page.locator('[data-comment]')).toHaveCount(0);
    await expect(page.locator('main mark[data-comment-id]')).toHaveCount(0);
  });

  test('two comments on different anchors both appear and both highlight', async ({
    page,
  }) => {
    const session = harness.sm.createSession(SAMPLE_PLAN);
    await page.goto(`${harness.baseUrl}/?session=${session.id}`);
    await page.locator('h1').waitFor();

    // First comment on "Dark"
    await selectInHeading(page, 'Dark');
    await page.getByRole('button', { name: /add comment/i }).click();
    await page.locator('textarea[data-comment-editor]').fill('one');
    await page.getByRole('button', { name: /^save$/i }).click();

    // Second comment on "Add"
    await selectInHeading(page, 'Add');
    await page.getByRole('button', { name: /add comment/i }).click();
    await page.locator('textarea[data-comment-editor]').fill('two');
    await page.getByRole('button', { name: /^save$/i }).click();

    await expect(page.locator('[data-comment]')).toHaveCount(2);
    await expect(page.locator('main mark[data-comment-id]')).toHaveCount(2);
  });

  test('selection outside any [data-plan-block] leaves placeholder visible', async ({
    page,
  }) => {
    const session = harness.sm.createSession(SAMPLE_PLAN);
    await page.goto(`${harness.baseUrl}/?session=${session.id}`);
    await page.locator('h1').waitFor();

    // Select text that is NOT inside a [data-plan-block] (e.g. the sidebar heading).
    await page.evaluate(() => {
      const sidebar = document.querySelector('[data-sidebar] h2');
      if (!sidebar || !sidebar.firstChild) return;
      const textNode = sidebar.firstChild as Text;
      if (!textNode.textContent) return;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, textNode.textContent.length);
      const sel = window.getSelection();
      if (!sel) return;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    // Placeholder should still be showing; no "Add comment" button.
    await expect(page.locator('[data-new-comment-placeholder]')).toBeVisible();
    await expect(page.getByRole('button', { name: /add comment/i })).toHaveCount(0);
  });
});
