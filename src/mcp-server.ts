#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * The MCP server process is a thin stdio adapter. It owns no state: every
 * `submit_plan` call is forwarded to the Plan Broker daemon over HTTP, which
 * holds the request open until the user responds in the browser.
 *
 * stdout is reserved for JSON-RPC frames, so any logging MUST go to stderr.
 */

const DEFAULT_BROKER_URL = 'http://127.0.0.1:3456';
const ONE_HOUR_MS = 60 * 60 * 1000;
const BROKER_UNAVAILABLE_MESSAGE =
  'Plan Reviewer broker is not running. Start the daemon (port 3456) or provide feedback in the terminal.';

interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
  [x: string]: unknown;
}

function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

async function forwardSubmitPlan(
  plan: string,
  sessionId: string | undefined,
): Promise<ToolResult> {
  const brokerUrl = process.env['PLAN_REVIEWER_BROKER_URL'] ?? DEFAULT_BROKER_URL;

  try {
    const response = await fetch(`${brokerUrl}/internal/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan, sessionId }),
      signal: AbortSignal.timeout(ONE_HOUR_MS),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return errorResult(
        `Plan Reviewer broker returned HTTP ${response.status}: ${detail || response.statusText}`,
      );
    }
    const body = (await response.json()) as { xml?: unknown };
    if (typeof body.xml !== 'string') {
      return errorResult('Plan Reviewer broker returned a response with no xml field.');
    }
    return { content: [{ type: 'text', text: body.xml }] };
  } catch {
    return errorResult(BROKER_UNAVAILABLE_MESSAGE);
  }
}

function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'plan-reviewer', version: '1.0.0' },
    {
      instructions:
        'Use submit_plan to send plans for interactive browser review when Claude Code is in plan mode. The tool blocks until the user provides feedback or approves.',
    },
  );

  server.registerTool(
    'submit_plan',
    {
      title: 'Submit Plan for Review',
      description:
        'Submit a plan for interactive browser review. Blocks until the user provides feedback, approves, or answers a clarification. Returns XML-formatted feedback.',
      inputSchema: {
        plan: z.string().describe('The full plan text to review.'),
        sessionId: z
          .string()
          .optional()
          .describe('Session ID for follow-up submissions. Omit for new sessions.'),
      },
    },
    async ({ plan, sessionId }) => forwardSubmitPlan(plan, sessionId),
  );

  return server;
}

async function main(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Start the stdio loop only when this module is the process entry point
// (so importing it from tests doesn't spawn a hanging transport).
const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const selfPath = fileURLToPath(import.meta.url);
if (entryPath === selfPath) {
  main().catch((err) => {
    process.stderr.write(`[plan-reviewer-mcp] fatal: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
