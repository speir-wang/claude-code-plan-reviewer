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
  const storageDir = await mkdtemp(path.join(tmpdir(), 'plan-reviewer-feedback-'));
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

test.describe('feedback / approval submission', () => {
  let harness: Harness;

  test.beforeEach(async () => {
    harness = await startDaemon();
  });

  test.afterEach(async () => {
    await stopDaemon(harness);
  });

  test('Send Feedback POSTs comments and resolves waiter with feedback XML', async ({
    page,
  }) => {
    const session = harness.sm.createSession(SAMPLE_PLAN);
    const waiter = harness.sm.waitForUserResponse(session.id);

    await page.goto(`${harness.baseUrl}/?session=${session.id}`);

    // Add a draft comment anchored on "Dark".
    await selectInHeading(page, 'Dark');
    await page.getByRole('button', { name: /add comment/i }).click();
    await page
      .locator('textarea[data-comment-editor]')
      .fill('Please clarify "dark".');
    await page.getByRole('button', { name: /^save$/i }).click();
    await expect(page.locator('[data-comment]')).toHaveCount(1);

    // Click Send Feedback.
    const sendBtn = page.locator('[data-action="send-feedback"]');
    await expect(sendBtn).toBeVisible();
    await expect(sendBtn).toBeEnabled();
    await sendBtn.click();

    const xml = await waiter;
    expect(xml).toContain('<plan_review type="feedback">');
    expect(xml).toContain('<anchor>Dark</anchor>');
    expect(xml).toContain('<note>Please clarify &quot;dark&quot;.</note>');

    // After submission the controls hide themselves and show a status line.
    await expect(page.locator('[data-submission-status]')).toBeVisible();
    await expect(page.locator('[data-action="send-feedback"]')).toHaveCount(0);
  });

  test('Send Feedback is disabled until at least one comment is saved', async ({
    page,
  }) => {
    const session = harness.sm.createSession(SAMPLE_PLAN);
    harness.sm.waitForUserResponse(session.id).catch(() => {
      /* aborted when the test tears the server down */
    });

    await page.goto(`${harness.baseUrl}/?session=${session.id}`);

    const sendBtn = page.locator('[data-action="send-feedback"]');
    await expect(sendBtn).toBeVisible();
    await expect(sendBtn).toBeDisabled();

    // Add a comment — button becomes enabled.
    await selectInHeading(page, 'Dark');
    await page.getByRole('button', { name: /add comment/i }).click();
    await page.locator('textarea[data-comment-editor]').fill('hm');
    await page.getByRole('button', { name: /^save$/i }).click();

    await expect(sendBtn).toBeEnabled();

    // Delete the comment — button goes back to disabled.
    await page.locator('[data-comment] [data-delete]').click();
    await expect(sendBtn).toBeDisabled();
  });

  test('Approve resolves the waiter with <plan_review type="approved" />', async ({
    page,
  }) => {
    const session = harness.sm.createSession(SAMPLE_PLAN);
    const waiter = harness.sm.waitForUserResponse(session.id);

    await page.goto(`${harness.baseUrl}/?session=${session.id}`);

    await page.locator('[data-action="approve"]').click();

    const xml = await waiter;
    expect(xml).toBe('<plan_review type="approved" />');

    // Session status on the server flips to 'approved'.
    expect(harness.sm.getSession(session.id)!.status).toBe('approved');

    // UI confirms submission.
    await expect(page.locator('[data-submission-status]')).toBeVisible();
    await expect(page.locator('[data-action="approve"]')).toHaveCount(0);
  });

  test('Approve with notes submits approved_with_notes XML', async ({ page }) => {
    const session = harness.sm.createSession(SAMPLE_PLAN);
    const waiter = harness.sm.waitForUserResponse(session.id);

    await page.goto(`${harness.baseUrl}/?session=${session.id}`);

    await page.locator('[data-action="approve-with-notes"]').click();
    const notes = page.locator('textarea[data-notes-editor]');
    await expect(notes).toBeVisible();
    await notes.fill('watch perf under heavy load');
    await page.locator('[data-action="submit-notes"]').click();

    const xml = await waiter;
    expect(xml).toContain('<plan_review type="approved_with_notes">');
    expect(xml).toContain('<note>watch perf under heavy load</note>');
  });

  test('Approve-with-Notes can be cancelled before submitting', async ({ page }) => {
    const session = harness.sm.createSession(SAMPLE_PLAN);
    harness.sm.waitForUserResponse(session.id).catch(() => {
      /* aborted on teardown */
    });

    await page.goto(`${harness.baseUrl}/?session=${session.id}`);

    await page.locator('[data-action="approve-with-notes"]').click();
    await expect(page.locator('textarea[data-notes-editor]')).toBeVisible();
    await page.locator('[data-action="cancel-notes"]').click();

    await expect(page.locator('textarea[data-notes-editor]')).toHaveCount(0);
    await expect(page.locator('[data-action="approve"]')).toBeVisible();
    await expect(page.locator('[data-action="send-feedback"]')).toBeVisible();
    await expect(page.locator('[data-action="approve-with-notes"]')).toBeVisible();
  });
});
