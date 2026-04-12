import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SessionManager } from '../../src/session-manager.js';
import { createApp } from '../../src/http-server.js';

const MCP_SERVER_SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/mcp-server.ts',
);

interface Harness {
  storageDir: string;
  sessionManager: SessionManager;
  server: Server;
  baseUrl: string;
  port: number;
}

async function startDaemon(): Promise<Harness> {
  const storageDir = await mkdtemp(path.join(tmpdir(), 'plan-reviewer-mcp-'));
  const sessionManager = new SessionManager({ storageDir });
  await sessionManager.init();
  const app = createApp({ sessionManager, openBrowser: () => {} });
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as { port: number };
  return {
    storageDir,
    sessionManager,
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    port,
  };
}

async function stopDaemon(h: Harness): Promise<void> {
  await new Promise<void>((r) => h.server.close(() => r()));
  await h.sessionManager.flush();
  await rm(h.storageDir, { recursive: true, force: true });
}

function makeMcpClient(brokerUrl: string): {
  client: Client;
  transport: StdioClientTransport;
} {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', MCP_SERVER_SCRIPT],
    env: {
      ...process.env,
      PLAN_REVIEWER_BROKER_URL: brokerUrl,
    },
    stderr: 'pipe',
  });
  const client = new Client(
    { name: 'test-client', version: '0.0.0' },
    { capabilities: {} },
  );
  return { client, transport };
}

describe('MCP end-to-end: submit_plan ↔ daemon bridge', () => {
  let harness: Harness | undefined;
  let client: Client | undefined;
  let transport: StdioClientTransport | undefined;

  beforeEach(async () => {
    harness = await startDaemon();
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
    if (harness) {
      await stopDaemon(harness);
      harness = undefined;
    }
  });

  it('registers submit_plan tool over stdio', async () => {
    const pair = makeMcpClient(harness!.baseUrl);
    client = pair.client;
    transport = pair.transport;
    await client.connect(transport);
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain('submit_plan');
  });

  it('full round-trip: submit_plan blocks and resolves on feedback', async () => {
    const pair = makeMcpClient(harness!.baseUrl);
    client = pair.client;
    transport = pair.transport;
    await client.connect(transport);

    const callPromise = client.callTool({
      name: 'submit_plan',
      arguments: { plan: '# Hello\n\nA test plan.' },
    });

    // Wait for the session to be registered by polling /api/sessions.
    let sessionId: string | undefined;
    for (let i = 0; i < 100 && !sessionId; i++) {
      const res = await fetch(`${harness!.baseUrl}/api/sessions`);
      const body = (await res.json()) as { sessions: { id: string }[] };
      if (body.sessions.length > 0) sessionId = body.sessions[0]!.id;
      else await new Promise((r) => setTimeout(r, 10));
    }
    expect(sessionId).toBeDefined();

    // Post feedback — this resolves the blocking bridge.
    const feedbackRes = await fetch(
      `${harness!.baseUrl}/api/sessions/${sessionId}/feedback`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          comments: [{ anchor: 'Hello', note: 'consider greeting more warmly' }],
        }),
      },
    );
    expect(feedbackRes.status).toBe(200);

    const result = (await callPromise) as {
      content: { type: string; text: string }[];
      isError?: boolean;
    };
    expect(result.isError).not.toBe(true);
    expect(result.content[0]!.type).toBe('text');
    const xml = result.content[0]!.text;
    expect(xml).toContain('<plan_review type="feedback">');
    expect(xml).toContain('<anchor>Hello</anchor>');
    expect(xml).toContain('<note>consider greeting more warmly</note>');
  }, 20000);

  it('submit_plan response includes sessionId so follow-up calls can reference it', async () => {
    const pair = makeMcpClient(harness!.baseUrl);
    client = pair.client;
    transport = pair.transport;
    await client.connect(transport);

    // First call: new plan, no sessionId.
    const callPromise = client.callTool({
      name: 'submit_plan',
      arguments: { plan: '# Plan v1' },
    });

    let sessionId: string | undefined;
    for (let i = 0; i < 100 && !sessionId; i++) {
      const res = await fetch(`${harness!.baseUrl}/api/sessions`);
      const body = (await res.json()) as { sessions: { id: string }[] };
      if (body.sessions.length > 0) sessionId = body.sessions[0]!.id;
      else await new Promise((r) => setTimeout(r, 10));
    }
    expect(sessionId).toBeDefined();

    await fetch(
      `${harness!.baseUrl}/api/sessions/${sessionId}/feedback`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          comments: [{ anchor: 'Plan', note: 'revise' }],
        }),
      },
    );

    const result = (await callPromise) as {
      content: { type: string; text: string }[];
    };

    // The response text must contain the sessionId so Claude can pass it
    // back in the next submit_plan call — without this, a new session is
    // created and versioning is lost.
    const text = result.content[0]!.text;
    expect(text).toContain(sessionId);
  }, 20000);

  it('follow-up submit_plan with sessionId appends v2 instead of creating new session', async () => {
    const pair = makeMcpClient(harness!.baseUrl);
    client = pair.client;
    transport = pair.transport;
    await client.connect(transport);

    // First call: new plan.
    const call1 = client.callTool({
      name: 'submit_plan',
      arguments: { plan: '# Plan v1' },
    });

    let sessionId: string | undefined;
    for (let i = 0; i < 100 && !sessionId; i++) {
      const res = await fetch(`${harness!.baseUrl}/api/sessions`);
      const body = (await res.json()) as { sessions: { id: string }[] };
      if (body.sessions.length > 0) sessionId = body.sessions[0]!.id;
      else await new Promise((r) => setTimeout(r, 10));
    }
    expect(sessionId).toBeDefined();

    // Resolve with feedback.
    await fetch(
      `${harness!.baseUrl}/api/sessions/${sessionId}/feedback`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          comments: [{ anchor: 'Plan', note: 'revise' }],
        }),
      },
    );
    await call1;

    // Second call: follow-up with same sessionId — should add v2.
    const call2 = client.callTool({
      name: 'submit_plan',
      arguments: { plan: '# Plan v2 (revised)', sessionId },
    });

    // Wait for waiter to register for v2.
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 10));
      if (harness!.sessionManager.hasPendingWaiter(sessionId!)) break;
    }
    expect(harness!.sessionManager.hasPendingWaiter(sessionId!)).toBe(true);

    // Approve v2.
    await fetch(
      `${harness!.baseUrl}/api/sessions/${sessionId}/approve`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    await call2;

    // Verify: only 1 session exists with 2 plan versions.
    const sessions = harness!.sessionManager.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.planVersions).toHaveLength(2);
    expect(sessions[0]!.planVersions[0]!.text).toBe('# Plan v1');
    expect(sessions[0]!.planVersions[1]!.text).toBe('# Plan v2 (revised)');
  }, 30000);

  it('full round-trip: submit_plan resolves on approval', async () => {
    const pair = makeMcpClient(harness!.baseUrl);
    client = pair.client;
    transport = pair.transport;
    await client.connect(transport);

    const callPromise = client.callTool({
      name: 'submit_plan',
      arguments: { plan: 'approve me' },
    });

    let sessionId: string | undefined;
    for (let i = 0; i < 100 && !sessionId; i++) {
      const res = await fetch(`${harness!.baseUrl}/api/sessions`);
      const body = (await res.json()) as { sessions: { id: string }[] };
      if (body.sessions.length > 0) sessionId = body.sessions[0]!.id;
      else await new Promise((r) => setTimeout(r, 10));
    }
    expect(sessionId).toBeDefined();

    const approveRes = await fetch(
      `${harness!.baseUrl}/api/sessions/${sessionId}/approve`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(approveRes.status).toBe(200);

    const result = (await callPromise) as {
      content: { type: string; text: string }[];
      isError?: boolean;
    };
    expect(result.isError).not.toBe(true);
    const text = result.content[0]!.text;
    expect(text).toContain('<plan_review type="approved" />');
    // Session ID is included so follow-up calls can reference it.
    expect(text).toContain('<session_id>');
    expect(text).toContain(sessionId!);
  }, 20000);

  it('returns isError when the broker is unreachable', async () => {
    // Point the MCP process at a port that nothing is listening on.
    const deadUrl = `http://127.0.0.1:${harness!.port + 1}`;
    // Make sure the dead port really is closed: stop the daemon and
    // reuse just the script spawn pointed at the stale url.
    const pair = makeMcpClient(deadUrl);
    client = pair.client;
    transport = pair.transport;
    await client.connect(transport);

    const result = (await client.callTool({
      name: 'submit_plan',
      arguments: { plan: 'anything' },
    })) as {
      content: { type: string; text: string }[];
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text.toLowerCase()).toContain('broker');
  }, 20000);
});
