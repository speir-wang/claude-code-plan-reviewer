import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const MCP_SERVER_SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/mcp-server.ts',
);

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function findFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

function makeMcpClient(port: number): {
  client: Client;
  transport: StdioClientTransport;
} {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', MCP_SERVER_SCRIPT],
    env: {
      ...process.env,
      PLAN_REVIEWER_PORT: String(port),
    },
    stderr: 'pipe',
  });
  const client = new Client(
    { name: 'test-client', version: '0.0.0' },
    { capabilities: {} },
  );
  return { client, transport };
}

function extractSessionId(result: unknown): string {
  const r = result as { content: { type: string; text: string }[] };
  const text = r.content[0]!.text;
  const match = text.match(/<session_id>([^<]+)<\/session_id>/);
  return match?.[1] ?? '';
}

/**
 * Poll GET /api/sessions until at least one session appears, then return its
 * id.  Throws if none appear within the timeout.
 */
async function waitForSession(
  baseUrl: string,
  timeoutMs = 5000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${baseUrl}/api/sessions`);
    const body = (await res.json()) as { sessions: { id: string }[] };
    if (body.sessions.length > 0) return body.sessions[0]!.id;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Timed out waiting for a session to appear');
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('MCP end-to-end: single-process non-blocking architecture', () => {
  let port: number;
  let baseUrl: string;
  let client: Client | undefined;
  let transport: StdioClientTransport | undefined;

  beforeEach(async () => {
    port = await findFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    if (client) {
      await client.close().catch(() => undefined);
      client = undefined;
    }
    if (transport) {
      await transport.close().catch(() => undefined);
      transport = undefined;
    }
  });

  // -------------------------------------------------------------------------

  it(
    'registers submit_plan and get_review tools over stdio',
    async () => {
      const pair = makeMcpClient(port);
      client = pair.client;
      transport = pair.transport;
      await client.connect(transport);

      const tools = await client.listTools();
      const names = tools.tools.map((t) => t.name);
      expect(names).toContain('submit_plan');
      expect(names).toContain('get_review');
    },
    20000,
  );

  // -------------------------------------------------------------------------

  it(
    'submit_plan returns immediately with sessionId (under 2 seconds)',
    async () => {
      const pair = makeMcpClient(port);
      client = pair.client;
      transport = pair.transport;
      await client.connect(transport);

      const start = Date.now();
      const result = (await client.callTool({
        name: 'submit_plan',
        arguments: { plan: '# Fast Plan\n\nShould return immediately.' },
      })) as { content: { type: string; text: string }[]; isError?: boolean };
      const elapsed = Date.now() - start;

      expect(result.isError).not.toBe(true);
      expect(result.content[0]!.type).toBe('text');

      const sessionId = extractSessionId(result);
      expect(sessionId).toBeTruthy();
      expect(sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );

      // The tool must not block; allow generous headroom for process startup
      // but verify the actual tool call itself returned quickly.
      expect(elapsed).toBeLessThan(2000);
    },
    20000,
  );

  // -------------------------------------------------------------------------

  it(
    'get_review returns pending when no feedback exists',
    async () => {
      const pair = makeMcpClient(port);
      client = pair.client;
      transport = pair.transport;
      await client.connect(transport);

      // Submit a plan to get a sessionId.
      const submitResult = (await client.callTool({
        name: 'submit_plan',
        arguments: { plan: '# Pending Plan\n\nNo one will review this yet.' },
      })) as { content: { type: string; text: string }[] };

      const sessionId = extractSessionId(submitResult);
      expect(sessionId).toBeTruthy();

      // Immediately ask for a review — nobody has submitted feedback.
      const reviewResult = (await client.callTool({
        name: 'get_review',
        arguments: { sessionId },
      })) as { content: { type: string; text: string }[]; isError?: boolean };

      expect(reviewResult.isError).not.toBe(true);
      const text = reviewResult.content[0]!.text;
      expect(text.toLowerCase()).toContain('pending');
    },
    20000,
  );

  // -------------------------------------------------------------------------

  it(
    'get_review returns feedback after user submits via HTTP',
    async () => {
      const pair = makeMcpClient(port);
      client = pair.client;
      transport = pair.transport;
      await client.connect(transport);

      // Submit plan.
      const submitResult = (await client.callTool({
        name: 'submit_plan',
        arguments: { plan: '# Plan with Feedback\n\nReview this please.' },
      })) as { content: { type: string; text: string }[] };

      const sessionId = extractSessionId(submitResult);
      expect(sessionId).toBeTruthy();

      // Wait until the session is visible in the HTTP API.
      await waitForSession(baseUrl);

      // POST feedback via the HTTP API (simulating the browser user).
      const feedbackRes = await fetch(
        `${baseUrl}/api/sessions/${sessionId}/feedback`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            comments: [
              { anchor: 'Plan with Feedback', note: 'needs more detail' },
            ],
          }),
        },
      );
      expect(feedbackRes.status).toBe(200);

      // get_review should now return the feedback XML.
      const reviewResult = (await client.callTool({
        name: 'get_review',
        arguments: { sessionId },
      })) as { content: { type: string; text: string }[]; isError?: boolean };

      expect(reviewResult.isError).not.toBe(true);
      const text = reviewResult.content[0]!.text;
      expect(text).toContain('<plan_review');
      expect(text).toContain('needs more detail');
      expect(text).toContain(`<session_id>${sessionId}</session_id>`);
    },
    20000,
  );

  // -------------------------------------------------------------------------

  it(
    'get_review returns approval after user approves via HTTP',
    async () => {
      const pair = makeMcpClient(port);
      client = pair.client;
      transport = pair.transport;
      await client.connect(transport);

      // Submit plan.
      const submitResult = (await client.callTool({
        name: 'submit_plan',
        arguments: { plan: '# Approvable Plan\n\nLooks great.' },
      })) as { content: { type: string; text: string }[] };

      const sessionId = extractSessionId(submitResult);
      expect(sessionId).toBeTruthy();

      // Wait until the session is visible in the HTTP API.
      await waitForSession(baseUrl);

      // POST approve via the HTTP API.
      const approveRes = await fetch(
        `${baseUrl}/api/sessions/${sessionId}/approve`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      expect(approveRes.status).toBe(200);

      // get_review should now return the approval XML.
      const reviewResult = (await client.callTool({
        name: 'get_review',
        arguments: { sessionId },
      })) as { content: { type: string; text: string }[]; isError?: boolean };

      expect(reviewResult.isError).not.toBe(true);
      const text = reviewResult.content[0]!.text;
      expect(text).toContain('approved');
      expect(text).toContain(`<session_id>${sessionId}</session_id>`);
    },
    20000,
  );

  // -------------------------------------------------------------------------

  it(
    'follow-up submit_plan with sessionId appends v2',
    async () => {
      const pair = makeMcpClient(port);
      client = pair.client;
      transport = pair.transport;
      await client.connect(transport);

      // First submission — no sessionId.
      const v1Result = (await client.callTool({
        name: 'submit_plan',
        arguments: { plan: '# Plan v1\n\nInitial version.' },
      })) as { content: { type: string; text: string }[] };

      const sessionId = extractSessionId(v1Result);
      expect(sessionId).toBeTruthy();

      const v1Text = v1Result.content[0]!.text;
      expect(v1Text).toContain('<plan_version>1</plan_version>');

      // Second submission — pass the sessionId back.
      const v2Result = (await client.callTool({
        name: 'submit_plan',
        arguments: {
          plan: '# Plan v2\n\nRevised after feedback.',
          sessionId,
        },
      })) as { content: { type: string; text: string }[]; isError?: boolean };

      expect(v2Result.isError).not.toBe(true);
      const v2Text = v2Result.content[0]!.text;
      expect(v2Text).toContain('<plan_version>2</plan_version>');
      // The same session id should be echoed back.
      expect(v2Text).toContain(`<session_id>${sessionId}</session_id>`);
    },
    20000,
  );

  // -------------------------------------------------------------------------

  it(
    'submit_plan response includes sessionId for follow-up calls',
    async () => {
      const pair = makeMcpClient(port);
      client = pair.client;
      transport = pair.transport;
      await client.connect(transport);

      const result = (await client.callTool({
        name: 'submit_plan',
        arguments: { plan: '# Session ID Test\n\nMust echo the id.' },
      })) as { content: { type: string; text: string }[]; isError?: boolean };

      expect(result.isError).not.toBe(true);
      const text = result.content[0]!.text;

      // Must contain the XML tag so callers can parse it programmatically.
      expect(text).toMatch(/<session_id>[^<]+<\/session_id>/);

      // The extracted id must look like a UUID.
      const sessionId = extractSessionId(result);
      expect(sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );

      // Also verify the review_url is present.
      expect(text).toContain('<review_url>');
      expect(text).toContain(sessionId);
    },
    20000,
  );
});
