#!/usr/bin/env tsx
/**
 * E2E Playwright reviewer script.
 *
 * Opens a headed browser and acts as the human reviewer for a given scenario.
 * Claude Code orchestrates the overall test by reading agent.md, starting this
 * script via Bash, making MCP tool calls, and reporting PASS/FAIL.
 *
 * Usage:
 *   npx tsx test/e2e/reviewer.ts --scenario <name> [--port 3456]
 *
 * Scenarios:
 *   approve        — detects new session, clicks Approve immediately
 *   feedback-cycle — sends feedback on v1, waits for v2, then approves
 *   polling        — waits 5s then approves (tests Claude Code's retry behavior)
 *
 * Prerequisites:
 *   npm install --save-dev playwright
 *   npx playwright install chromium
 *
 * Environment:
 *   PLAYWRIGHT_CHROMIUM_PATH — optional path to a system Chromium/Chrome binary
 */

import { chromium, type Page } from 'playwright';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

const scenario = getArg('--scenario');
const port = Number(getArg('--port') ?? '') || 3456;
const baseUrl = `http://127.0.0.1:${port}`;

if (!scenario) {
  process.stderr.write(
    'Usage: npx tsx test/e2e/reviewer.ts --scenario <name> [--port 3456]\n' +
    'Scenarios: approve | feedback-cycle | polling\n',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// HTTP helpers (Node.js side — not browser context)
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ApiSession {
  id: string;
  status: string;
  planVersions: Array<{ version: number; text: string }>;
}

async function fetchSessions(): Promise<string[]> {
  const res = await fetch(`${baseUrl}/api/sessions`);
  if (!res.ok) throw new Error(`GET /api/sessions returned HTTP ${res.status}`);
  const body = (await res.json()) as { sessions: ApiSession[] };
  return body.sessions.map((s) => s.id);
}

async function fetchSession(sessionId: string): Promise<ApiSession> {
  const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`);
  if (!res.ok) throw new Error(`GET /api/sessions/${sessionId} returned HTTP ${res.status}`);
  const body = (await res.json()) as { session: ApiSession };
  return body.session;
}

async function waitForNewSession(
  baselineSessions: ReadonlySet<string>,
  timeoutMs = 60_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await fetchSessions();
    const newId = current.find((id) => !baselineSessions.has(id));
    if (newId) return newId;
    await sleep(500);
  }
  throw new Error('Timed out waiting for a new session (60s). Has submit_plan been called?');
}

async function waitForPlanVersion(
  sessionId: string,
  minVersions: number,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const session = await fetchSession(sessionId);
    if (session.planVersions.length >= minVersions) return;
    await sleep(1_000);
  }
  throw new Error(
    `Timed out waiting for plan version ${minVersions} on session ${sessionId} (60s).`,
  );
}

// ---------------------------------------------------------------------------
// Scenario: approve
// ---------------------------------------------------------------------------

async function runApprove(page: Page, sessionId: string): Promise<void> {
  console.log(`[reviewer] Navigating to session ${sessionId}`);
  await page.goto(`${baseUrl}/?session=${encodeURIComponent(sessionId)}`);

  const approveBtn = page.locator('[data-action="approve"]');
  await approveBtn.waitFor({ state: 'visible', timeout: 15_000 });

  console.log(`[reviewer] Clicking Approve for session ${sessionId}`);
  await approveBtn.click();

  await page.locator('[data-submission-status]').waitFor({ state: 'visible', timeout: 10_000 });
  console.log(`[reviewer] ✓ Approved session ${sessionId}`);
}

// ---------------------------------------------------------------------------
// Scenario: feedback-cycle
// ---------------------------------------------------------------------------

async function runFeedbackCycle(page: Page, sessionId: string): Promise<void> {
  console.log(`[reviewer] Navigating to session ${sessionId}`);
  await page.goto(`${baseUrl}/?session=${encodeURIComponent(sessionId)}`);

  await page.locator('[data-action="approve"]').waitFor({ state: 'visible', timeout: 15_000 });

  // Send feedback via HTTP POST (annotation UI requires complex text selection
  // which is fragile in automation; direct API call is equivalent).
  console.log(`[reviewer] Sending feedback for session ${sessionId}`);
  const feedbackRes = await fetch(
    `${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/feedback`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        comments: [
          {
            anchor: 'Step 2: Add connection pooling',
            note: 'Please add a step for migration scripts.',
          },
        ],
      }),
    },
  );
  if (!feedbackRes.ok) {
    throw new Error(`POST /feedback returned HTTP ${feedbackRes.status}`);
  }
  console.log(`[reviewer] ✓ Sent feedback for session ${sessionId}`);

  // Wait for Claude Code to submit the revised plan (v2).
  console.log(`[reviewer] Waiting for plan version 2…`);
  await waitForPlanVersion(sessionId, 2);

  // Re-navigate to load the diff view for the new version.
  console.log(`[reviewer] Navigating to revised plan`);
  await page.goto(`${baseUrl}/?session=${encodeURIComponent(sessionId)}`);

  const approveBtn = page.locator('[data-action="approve"]');
  await approveBtn.waitFor({ state: 'visible', timeout: 15_000 });

  console.log(`[reviewer] Clicking Approve for revised session ${sessionId}`);
  await approveBtn.click();

  await page.locator('[data-submission-status]').waitFor({ state: 'visible', timeout: 10_000 });
  console.log(`[reviewer] ✓ Approved revised session ${sessionId}`);
}

// ---------------------------------------------------------------------------
// Scenario: polling
// ---------------------------------------------------------------------------

async function runPolling(page: Page, sessionId: string): Promise<void> {
  console.log(`[reviewer] Navigating to session ${sessionId}`);
  await page.goto(`${baseUrl}/?session=${encodeURIComponent(sessionId)}`);

  await page.locator('[data-action="approve"]').waitFor({ state: 'visible', timeout: 15_000 });

  // Intentional 5-second delay — this forces Claude Code's first get_review
  // call to return "pending", testing that it polls rather than giving up.
  console.log(`[reviewer] Waiting 5s before approving (testing polling behavior)…`);
  await sleep(5_000);

  const approveBtn = page.locator('[data-action="approve"]');
  console.log(`[reviewer] Clicking Approve for session ${sessionId}`);
  await approveBtn.click();

  await page.locator('[data-submission-status]').waitFor({ state: 'visible', timeout: 10_000 });
  console.log(`[reviewer] ✓ Approved session ${sessionId} after 5s delay`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Verify the server is reachable before opening the browser.
  try {
    await fetchSessions();
  } catch {
    process.stderr.write(
      `[reviewer] ERROR: Cannot reach plan reviewer at ${baseUrl}\n` +
      '[reviewer] Make sure the plan reviewer HTTP server is running (start a\n' +
      '[reviewer] Claude Code session with the plan-reviewer MCP configured).\n',
    );
    process.exit(1);
  }

  // Record baseline sessions so we detect only the new one.
  const baselineIds = new Set(await fetchSessions());
  console.log(
    `[reviewer] Ready. Watching for new sessions on ${baseUrl} (scenario: ${scenario})`,
  );
  console.log(`[reviewer] Baseline: ${baselineIds.size} existing session(s)`);

  // Open a headed (visible) browser.
  const executablePath = process.env['PLAYWRIGHT_CHROMIUM_PATH'];
  const browser = await chromium.launch({
    headless: false,
    ...(executablePath ? { executablePath } : {}),
  });
  const page = await browser.newPage();

  // Show the home page while waiting for the submit_plan call.
  await page.goto(baseUrl);

  try {
    const sessionId = await waitForNewSession(baselineIds);
    console.log(`[reviewer] New session detected: ${sessionId}`);

    switch (scenario) {
      case 'approve':
        await runApprove(page, sessionId);
        break;
      case 'feedback-cycle':
        await runFeedbackCycle(page, sessionId);
        break;
      case 'polling':
        await runPolling(page, sessionId);
        break;
      default:
        process.stderr.write(
          `[reviewer] Unknown scenario: "${scenario}"\n` +
          '[reviewer] Known scenarios: approve | feedback-cycle | polling\n',
        );
        await browser.close();
        process.exit(1);
    }
  } catch (err) {
    process.stderr.write(`[reviewer] ERROR: ${(err as Error).message}\n`);
    await browser.close();
    process.exit(1);
  }

  await browser.close();
  console.log('[reviewer] Done.');
}

main().catch((err: Error) => {
  process.stderr.write(`[reviewer] Fatal: ${err.message}\n`);
  process.exit(1);
});
