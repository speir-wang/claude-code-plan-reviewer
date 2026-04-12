#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { exec } from 'node:child_process';
import type { Server } from 'node:http';
import { createApp } from './http-server.js';
import { SessionManager } from './session-manager.js';
import type { ConversationEntry } from './types.js';

/**
 * Single-process MCP server: owns the SessionManager, embeds the Express HTTP
 * server for browser UI, and exposes `submit_plan` / `get_review` tools over
 * stdio JSON-RPC.
 *
 * If another MCP server instance already holds the HTTP port, this process
 * operates in "client mode" — forwarding session operations over HTTP to the
 * existing instance.
 *
 * stdout is reserved for JSON-RPC frames, so any logging MUST go to stderr.
 */

const DEFAULT_PORT = 3456;

interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
  [x: string]: unknown;
}

function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

// ---------------------------------------------------------------------------
// Browser opener — best-effort, platform-aware
// ---------------------------------------------------------------------------

function openInBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin'
      ? `open "${url}"`
      : process.platform === 'win32'
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) {
      process.stderr.write(`[plan-reviewer] Open ${url} in your browser.\n`);
    }
  });
}

// ---------------------------------------------------------------------------
// HTTP server startup with port-collision detection
// ---------------------------------------------------------------------------

interface OwnerMode {
  isOwner: true;
  server: Server;
  sessionManager: SessionManager;
  baseUrl: string;
  port: number;
}

interface ClientMode {
  isOwner: false;
  baseUrl: string;
}

type ServerMode = OwnerMode | ClientMode;

async function tryStartServer(port: number): Promise<ServerMode> {
  const sm = new SessionManager();
  await sm.init();

  const baseUrl = `http://127.0.0.1:${port}`;
  const app = createApp({
    sessionManager: sm,
    openBrowser: openInBrowser,
    baseUrl,
  });

  return new Promise<ServerMode>((resolve) => {
    const server = app.listen(port, () => {
      process.stderr.write(
        `[plan-reviewer] HTTP server listening on ${baseUrl}\n`,
      );
      resolve({ isOwner: true, server, sessionManager: sm, baseUrl, port });
    });
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        process.stderr.write(
          `[plan-reviewer] Port ${port} in use — operating in client mode.\n`,
        );
        resolve({ isOwner: false, baseUrl });
      } else {
        throw err;
      }
    });
  });
}

// ---------------------------------------------------------------------------
// submit_plan — non-blocking, returns immediately
// ---------------------------------------------------------------------------

async function handleSubmitPlan(
  mode: ServerMode,
  plan: string,
  sessionId: string | undefined,
): Promise<ToolResult> {
  if (mode.isOwner) {
    // Owner mode: operate on the in-process SessionManager directly.
    const { sessionManager, baseUrl } = mode;
    let session;
    if (sessionId) {
      const existing = sessionManager.getSession(sessionId);
      if (!existing) return errorResult('Session not found.');
      session = sessionManager.addPlanVersion(sessionId, plan);
    } else {
      session = sessionManager.createSession(plan);
      openInBrowser(`${baseUrl}?session=${session.id}`);
    }
    const url = `${baseUrl}?session=${session.id}`;
    return {
      content: [
        {
          type: 'text',
          text: `Plan submitted for review.\n\n<session_id>${session.id}</session_id>\n<review_url>${url}</review_url>\n<plan_version>${session.planVersions.length}</plan_version>\n\nThe plan is now open in your browser for review. Use get_review to check for feedback, or wait for the asyncRewake hook to deliver it automatically.`,
        },
      ],
    };
  }

  // Client mode: forward to the existing HTTP server.
  try {
    const response = await fetch(`${mode.baseUrl}/internal/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan, sessionId }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return errorResult(
        `Plan Reviewer returned HTTP ${response.status}: ${detail || response.statusText}`,
      );
    }
    const body = (await response.json()) as {
      sessionId?: string;
      url?: string;
      version?: number;
    };
    const sid = body.sessionId ?? '';
    const url = body.url ?? `${mode.baseUrl}?session=${sid}`;
    return {
      content: [
        {
          type: 'text',
          text: `Plan submitted for review.\n\n<session_id>${sid}</session_id>\n<review_url>${url}</review_url>\n<plan_version>${body.version ?? 1}</plan_version>\n\nThe plan is now open in your browser for review. Use get_review to check for feedback, or wait for the asyncRewake hook to deliver it automatically.`,
        },
      ],
    };
  } catch {
    return errorResult(
      'Plan Reviewer HTTP server is not reachable. Ensure at least one MCP server instance is running.',
    );
  }
}

// ---------------------------------------------------------------------------
// get_review — manual fallback to retrieve pending feedback
// ---------------------------------------------------------------------------

async function handleGetReview(
  mode: ServerMode,
  sessionId: string,
): Promise<ToolResult> {
  let feedback: ConversationEntry | null = null;

  if (mode.isOwner) {
    const { sessionManager } = mode;
    const session = sessionManager.getSession(sessionId);
    if (!session) return errorResult('Session not found.');
    feedback = sessionManager.getLatestFeedback(sessionId);
  } else {
    // Client mode: fetch session via HTTP.
    try {
      const res = await fetch(
        `${mode.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`,
      );
      if (!res.ok) return errorResult('Session not found.');
      const body = (await res.json()) as {
        session: {
          status: string;
          conversation: ConversationEntry[];
        };
      };
      // Replicate getLatestFeedback logic client-side.
      const convo = body.session.conversation;
      const lastPlanIdx = [...convo]
        .reverse()
        .findIndex((e) => e.role === 'claude' && e.type === 'plan');
      if (lastPlanIdx !== -1) {
        const lastPlanPos = convo.length - 1 - lastPlanIdx;
        const userEntry = convo
          .slice(lastPlanPos + 1)
          .find((e) => e.role === 'user');
        feedback = userEntry ?? null;
      }
    } catch {
      return errorResult(
        'Plan Reviewer HTTP server is not reachable.',
      );
    }
  }

  if (!feedback) {
    return {
      content: [
        {
          type: 'text',
          text: `Review is still pending for session ${sessionId}. The user has not yet provided feedback.\n\n<session_id>${sessionId}</session_id>`,
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: `${feedback.content}\n\n<session_id>${sessionId}</session_id>`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// MCP server creation
// ---------------------------------------------------------------------------

export function createMcpServer(mode: ServerMode): McpServer {
  const server = new McpServer(
    { name: 'plan-reviewer', version: '1.0.0' },
    {
      instructions:
        'Use submit_plan to send plans for interactive browser review. The tool returns immediately — feedback is delivered via an asyncRewake hook or can be polled with get_review.',
    },
  );

  server.registerTool(
    'submit_plan',
    {
      title: 'Submit Plan for Review',
      description:
        'Submit a plan for interactive browser review. Returns immediately with a session ID and review URL. Feedback is delivered asynchronously via the asyncRewake hook, or can be checked manually with get_review.',
      inputSchema: {
        plan: z.string().describe('The full plan text to review.'),
        sessionId: z
          .string()
          .optional()
          .describe(
            'Session ID for follow-up submissions. Omit for new sessions.',
          ),
      },
    },
    async ({ plan, sessionId }) => handleSubmitPlan(mode, plan, sessionId),
  );

  server.registerTool(
    'get_review',
    {
      title: 'Get Plan Review Status',
      description:
        'Check if the user has provided feedback or approved the plan. Returns the latest feedback/approval XML if available, or a status indicating the review is still pending.',
      inputSchema: {
        sessionId: z
          .string()
          .describe('The session ID from a previous submit_plan call.'),
      },
    },
    async ({ sessionId }) => handleGetReview(mode, sessionId),
  );

  return server;
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const port = Number(process.env['PLAN_REVIEWER_PORT']) || DEFAULT_PORT;
  const mode = await tryStartServer(port);

  const server = createMcpServer(mode);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown.
  const shutdown = () => {
    process.stderr.write('[plan-reviewer] Shutting down…\n');
    if (mode.isOwner) {
      mode.server.closeAllConnections();
      mode.server.close(() => {
        mode.sessionManager
          .flush()
          .catch(() => undefined)
          .finally(() => process.exit(0));
      });
    } else {
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Start the stdio loop only when this module is the process entry point
// (so importing it from tests doesn't spawn a hanging transport).
const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const selfPath = fileURLToPath(import.meta.url);
if (entryPath === selfPath) {
  main().catch((err) => {
    process.stderr.write(
      `[plan-reviewer-mcp] fatal: ${(err as Error).message}\n`,
    );
    process.exit(1);
  });
}
