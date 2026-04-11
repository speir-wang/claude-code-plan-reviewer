# Claude Code Plan Reviewer — Technical Implementation Plan

> **This file tracks the implementation plan and progress.** When working on a
> step, update the checkbox below in the same PR that lands the step.

## Progress

**Development methodology:** Every step is a TDD cycle (red → green →
refactor) followed by a Quality Gate (tests pass, typecheck clean, build
clean, no dead code, no `console.log`, no obvious perf traps). See
[§10 Development Methodology](#10-development-methodology--tdd--quality-gates)
for the full checklist.

- [x] **Step 1 — Scaffold**: package.json, tsconfig (×3), vitest, Playwright,
      esbuild bundler script, directory layout, shared `Session` /
      `Comment` / `PlanVersion` types. *29/29 tests green after merge.*
- [x] **Step 2 — Session manager + blocking bridge**: `SessionManager` with
      per-session serialized write queue, `waitForUserResponse` /
      `resolveSession` / `cancelWaiter`, superseded-waiter handling,
      interrupted-session recovery on reload, `flush()` for tests.
- [x] **Step 3 — HTTP server + SSE**: `xml.ts` XML builders, `sse-manager.ts`
      with per-session + global channels and unref'd heartbeat, Express app
      with `/api/sessions`, `/:id/events`, `/:id/feedback`, `/:id/approve`
      and the `/internal/submit` long-poll endpoint. Uses `res.on('close')`
      (not `req`) for real disconnect detection.
- [x] **Step 4 — Diff engine**: `computeInlineDiff` over `diffWords` with
      comment overlap/resolution math (`resolveCommentsAgainstDiff`).
      Pure function, no mutation. 13 unit tests.
- [x] **Step 5 — MCP server process**: `submit_plan` tool registered via
      `McpServer.registerTool` + `StdioServerTransport`; delegates to
      `fetch('/internal/submit')` with a 1h `AbortSignal.timeout`; returns an
      `isError` fallback result when the broker is unreachable. 4 integration
      tests spawn a real stdio MCP process against a real daemon on an
      ephemeral port: tool listing, feedback round-trip, approval
      round-trip, dead-broker fallback. `PLAN_REVIEWER_BROKER_URL` env var
      makes the broker endpoint test-configurable. stdin/stdout reserved
      for JSON-RPC; fatal errors logged to stderr only.
- [x] **Step 6 — Browser app: plan display**: vanilla-TS browser bundle
      (esbuild) with `index.html`, `app.ts`, `plan-display.ts`, `styles.css`.
      `parsePlanBlocks` splits plan on blank-line boundaries, preserves
      character offsets, and renders each block via `marked.parse` into a
      `<div data-plan-block data-offset data-length>` wrapper so future
      annotations can anchor by range. `app.ts` resolves `?session=<id>`,
      fetches the latest plan version, and shows helpful status text on
      error / missing session. 4 Playwright tests (headless chromium):
      markdown + offsets, list rendering, missing session, no session.
      Playwright global-setup builds the bundle once. Pinned
      `@playwright/test` + `playwright` to `1.56.0` to match the
      pre-installed chromium-1194.
- [ ] **Step 7 — Browser app: annotation**: text selection → floating "Add
      comment" button → inline comment editor → margin annotations with
      connector lines. Playwright test first.
- [ ] **Step 8 — Browser app: feedback / approval**: submission controls,
      XML arriving at daemon for both feedback and approval. Playwright
      test first.
- [ ] **Step 9 — Browser app: diff view**: two-version session renders
      inline diff, resolved comments visually distinct. Playwright test
      first.
- [ ] **Step 10 — Browser app: conversation + sidebar**: history list,
      session navigation, SSE-driven badges. Playwright tests first.
- [ ] **Step 11 — Daemon setup**: launchd plist, idempotent install script,
      Claude Code `mcpServers` config. Gate: install script dry-run
      testable.
- [ ] **Step 12 — End-to-end polish**: error handling, 1h timeout
      handling, graceful shutdown, interrupted-session recovery polish.
      Tests first for each polish item. Final gate.

---

## Context

When Claude Code presents a plan in the terminal, providing detailed feedback
requires awkward copy-paste workflows. This project creates a browser-based
annotation experience: Claude Code calls an MCP tool (`submit_plan`) that
blocks until the user reviews, annotates, and approves the plan in a local
web UI. The tool result carries structured XML feedback back to Claude.

The system has three parts: an MCP server process (spawned per Claude Code
instance via stdio), a Plan Broker daemon (HTTP server on port 3456, runs as a
macOS launchd service), and a browser app. The MCP process delegates to the
daemon via internal HTTP; the daemon holds the request open until the user
responds in the browser.

---

## 1. Project Structure

```
claude-code-plan-reviewer/
├── package.json
├── tsconfig.json                  # typecheck (src + tests + scripts)
├── tsconfig.build.json            # emit dist from src only
├── tsconfig.browser.json          # browser type-check
├── vitest.config.ts
├── playwright.config.ts
├── scripts/
│   └── bundle-browser.js          # esbuild bundler for src/browser
├── src/
│   ├── main.ts                    # Entry point: starts the daemon
│   ├── mcp-server.ts              # MCP tool registration (submit_plan)
│   ├── http-server.ts             # Express HTTP + SSE server
│   ├── session-manager.ts         # Session lifecycle, persistence, bridge
│   ├── sse-manager.ts             # Per-session + global SSE channels
│   ├── xml.ts                     # XML builders + escapeXml
│   ├── diff.ts                    # Inline diff algorithm for revisions
│   ├── types.ts                   # Shared TypeScript types
│   └── browser/                   # Browser app source (vanilla TS)
│       ├── index.html
│       ├── app.ts
│       ├── plan-display.ts
│       ├── annotation.ts
│       ├── diff-view.ts
│       ├── conversation.ts
│       ├── sidebar.ts
│       ├── feedback.ts
│       └── styles.css
├── install.sh                     # Installation script
├── com.plan-reviewer.broker.plist # macOS launchd plist
└── test/
    ├── unit/                      # Pure-function tests
    ├── integration/               # vitest + supertest + fetch
    └── browser/                   # Playwright specs
```

## 2. Dependencies

Key runtime dependencies:

- **`@modelcontextprotocol/sdk`** — MCP SDK for tool registration + stdio
  transport.
- **`express`** — HTTP server.
- **`marked`** — Markdown-to-HTML rendering for plan text.
- **`diff`** — Diffing library for plan revision comparison (`diffWords` /
  `diffLines`).
- **`zod`** — Tool input schema validation.

Key dev dependencies:

- **`vitest` + `supertest`** — Unit and HTTP integration tests.
- **`@playwright/test`** — Headless Chromium driver for browser integration
  tests.
- **`esbuild`** — Bundle browser TypeScript into a single JS file.
- **`tsx`** — Fast TypeScript runner for dev mode.

See `package.json` for exact pinned versions.

## 3. Core Architecture: The Blocking Bridge

When Claude Code calls `submit_plan`, the MCP tool handler creates a session
and returns a Promise that only resolves when the user submits feedback via
the browser. This bridge lives in `SessionManager`:

```typescript
// Pseudocode — see src/session-manager.ts for the real implementation.
waitForUserResponse(sessionId: string): Promise<string>
resolveSession(sessionId: string, xml: string): boolean
cancelWaiter(sessionId: string, reason: string): boolean
```

Subtleties captured by the implementation:

- A second waiter on the same session rejects the earlier one with
  `waiter superseded by a newer submission` so no Promise leaks.
- Sessions are persisted to `~/.plan-reviewer/sessions/<id>.json` via a
  per-session serialized write queue (snapshot-on-enqueue) so in-flight
  writes never interleave.
- On startup, any session found on disk with `status: 'active'` is marked
  `interrupted` (no live waiter can possibly still exist).

## 4. HTTP Server + SSE

| Method | Path                           | Purpose                                        |
|--------|--------------------------------|------------------------------------------------|
| GET    | `/`                            | Serve browser app (`index.html`)               |
| GET    | `/app.js`                      | Serve bundled browser JS                       |
| GET    | `/styles.css`                  | Serve styles                                   |
| GET    | `/api/sessions`                | List all sessions (active + history)           |
| GET    | `/api/sessions/:id`            | Get full session data                          |
| GET    | `/api/sessions/:id/events`     | Per-session SSE stream                         |
| GET    | `/api/events`                  | Global SSE stream (sidebar updates)            |
| POST   | `/api/sessions/:id/feedback`   | Resolve blocking bridge with feedback XML      |
| POST   | `/api/sessions/:id/approve`    | Resolve blocking bridge with approval XML      |
| POST   | `/internal/submit`             | MCP long-poll entry point                      |

SSE channel design:

- `Map<sessionId, Set<Response>>` for per-session subscribers.
- One shared `Set<Response>` for the sidebar's global stream.
- Events: `plan_submitted`, `session_updated`, `session_closed`.
- 30 s `setInterval.unref()` heartbeat keeps connections alive without
  pinning the event loop.

**Critical disconnect detection:** `/internal/submit` listens to
`res.on('close')` (not `req.on('close')`, which also fires on normal body
parsing) and calls `cancelWaiter` only when `!res.writableEnded`.

## 5. Browser App

**Technology choice: Vanilla TypeScript + esbuild bundle.** No framework.
Reasons: local-only tool (no SEO/SSR), fast startup, small bundle, modern
browser APIs cover the UX needs, esbuild bundles in <50 ms.

**Component breakdown:**

- **`plan-display.ts`** — renders plan markdown, wraps paragraphs in
  `<div data-offset="N">` for anchor tracking, watches `mouseup` for
  selections, shows floating "Add comment" button near the selection.
- **`annotation.ts`** — inline Google-Docs-style comments with edit/delete
  pre-submission, `open`/`resolved` visual state.
- **`diff-view.ts`** — word-level inline diff via the `diff` library,
  `<ins class="diff-add">` / `<del class="diff-remove">`, auto-marks
  overlapping comments as `resolved`.
- **`conversation.ts`** — full history with role icons, timestamps,
  expandable plan versions.
- **`sidebar.ts`** — session list with badges, SSE-driven live updates.
- **`feedback.ts`** — Send Feedback / Approve / Approve-with-Notes
  submission flow; clarification answer mode for back-and-forth questions.

## 6. Diff Algorithm

```typescript
// src/diff.ts
import { diffWords } from 'diff';

export interface DiffSegment {
  text: string;
  type: 'added' | 'removed' | 'unchanged';
}

export function computeInlineDiff(oldText: string, newText: string): DiffSegment[] {
  return diffWords(oldText, newText).map((change) => ({
    text: change.value,
    type: change.added ? 'added' : change.removed ? 'removed' : 'unchanged',
  }));
}
```

**Comment resolution logic:** For each comment anchored to `[start, end)`
in the old plan, walk the diff segments while tracking position in both old
and new text. If any overlapping segment is `added` or `removed`, mark the
comment `resolved`; otherwise it stays `open`.

## 7. macOS Daemon

`com.plan-reviewer.broker.plist` (installed to `~/Library/LaunchAgents`)
runs `node /usr/local/lib/plan-reviewer/dist/main.js --daemon` on load and
keeps it alive. The daemon serves only HTTP/SSE — the MCP server process is
spawned separately by each Claude Code instance via the `mcpServers` config.

`install.sh` builds, installs the daemon, loads the launchd agent, and
merges a `plan-reviewer` entry into `~/.claude/settings.json` using a small
inline Node script (avoids fragile `jq` dependency).

## 8. Process Architecture

```
┌─────────────────────┐         ┌──────────────────────┐
│ Claude Code          │  stdio  │ MCP Server Process   │
│ (plan mode)          │◄───────►│ (spawned per instance)│
│                      │         │                      │
└─────────────────────┘         └──────────┬───────────┘
                                           │ HTTP (internal)
                                           ▼
                                ┌──────────────────────┐
                                │ Plan Broker Daemon    │
                                │ (port 3456)           │
                                │ - HTTP server         │
                                │ - SSE connections     │  ◄──── Browser tabs
                                │ - Session storage     │
                                │ - Blocking bridge     │
                                └──────────────────────┘
```

**Flow:**

1. Claude Code spawns `mcp-server.js` via stdio.
2. `mcp-server.js` receives a `submit_plan` call.
3. `mcp-server.js` POSTs to `http://localhost:3456/internal/submit`.
4. The daemon creates the session, opens the browser, holds the response
   open (long-poll).
5. User reviews in the browser, submits feedback via
   `/api/sessions/:id/feedback`.
6. The daemon resolves the long-poll response to `mcp-server.js` with the
   XML.
7. `mcp-server.js` returns the XML as the MCP tool result.

**Benefits:**

- **No stdout contamination** — MCP process only does stdio, daemon only
  does HTTP.
- **Multiple Claude Code instances** work naturally — each spawns its own
  MCP process, all talk to the same daemon.
- **Daemon crash recovery** — MCP process detects failed HTTP and returns
  `isError`, falling back to terminal input.

## 9. Build System

- `tsconfig.json` — typecheck (`noEmit: true`) over `src + test + scripts`.
- `tsconfig.build.json` — emit `dist/` from `src/` only (no tests).
- `tsconfig.browser.json` — DOM lib, ESNext module, type-check only (esbuild
  handles emission).
- `scripts/bundle-browser.js` — single-file esbuild bundle for the browser
  app plus copy of static assets (`index.html`, `styles.css`).

## 10. Development Methodology — TDD + Quality Gates

**Test-Driven Development is mandatory.** For every step in the
Implementation Order, follow the red-green-refactor loop:

1. **Red** — Write a failing test first. Prefer an integration test that
   exercises the full workflow; add unit tests only when integration
   coverage is impractical.
2. **Green** — Write the minimum implementation needed to make the test
   pass.
3. **Refactor** — Clean up while tests stay green.

**Integration-first bias.** Whenever a behavior can be validated by driving
the real HTTP endpoints, the real session manager, the real MCP stdio
transport, or the real browser, do so. Reserve isolated unit tests for pure
functions (diff algorithm, XML escaping, offset math) or for error paths
that are hard to trigger from an integration harness.

**Quality Gate (after every major step).** Before moving to the next step,
stop and run the following checklist. Do not proceed until all items pass:

- [ ] All new tests pass, all existing tests still pass (`npm test`)
- [ ] TypeScript compiles cleanly with `strict: true` (`npm run build`)
- [ ] **Code quality:** Dead code removed, no commented-out blocks, names
      are clear, no duplicated logic (extract only when the second instance
      appears — not before)
- [ ] **Best practices:** No `console.log` anywhere (stdio contamination
      risk); errors are surfaced (not swallowed); all `any` types justified
      or removed; no synchronous filesystem calls on hot paths
- [ ] **Performance:** No obvious O(n²) walks over plan text, no
      re-reading the same session file in one request, SSE connections
      cleaned up on disconnect
- [ ] **Simplification:** Re-read the diff and ask "what can I delete?" —
      remove premature abstractions, speculative options, or configuration
      that has no caller

If any checklist item fails, fix it before starting the next step. Record
the gate completion as a commit boundary so progress is auditable.

## 11. Testing Strategy

### 11.1 Test Pyramid (integration-heavy)

| Layer                        | Tool                           | Scope                                                                                                                                   |
|------------------------------|--------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------|
| **Unit**                     | vitest                         | Diff algorithm, XML escaping, offset/overlap math, session persistence serialization.                                                   |
| **Integration (server)**     | vitest + supertest + fetch     | Real Express + real SessionManager: feedback resolves pending `/internal/submit`, SSE push on `plan_submitted`, long-poll timeout, etc. |
| **Integration (MCP e2e)**    | vitest + `StdioClientTransport`| Spawn real MCP process against real daemon on ephemeral port; drive `submit_plan` through the MCP client; assert tool result XML.       |
| **Integration (browser)**    | Playwright                     | Launch daemon on ephemeral port, open browser, select text, add comment, click Send Feedback, assert the POST reached the daemon.       |
| **Manual smoke**             | Real Claude Code               | Final verification in §13.                                                                                                              |

### 11.2 Critical Integration Tests (write these first)

1. **`submit_plan blocks and resolves on feedback`** — core blocking bridge.
2. **`submit_plan resolves on approval`** — `<plan_review type="approved" />`.
3. **`follow-up submission uses same session`** — appends plan version,
   browser receives SSE update.
4. **`diff auto-resolves comments on modified anchors`** — version 1 comment
   on "foo bar", version 2 changes it, comment marked resolved.
5. **`daemon unavailable → MCP returns isError`** — kill daemon, call
   `submit_plan`, assert fallback.
6. **`concurrent sessions don't cross-resolve`** — isolation between
   parallel sessions.
7. **`interrupted sessions recover`** — kill daemon mid-session, restart,
   active-on-disk becomes `interrupted`.

### 11.3 Browser Testing

Use **Playwright** (headless Chromium) — real DOM events, Selection API
support, integrates cleanly. Browser tests must cover:

- Text selection → "Add comment" button appears at correct position
- Comment creation → comment persisted in submission payload
- Diff rendering → added/removed spans visible; comments on modified
  anchors appear resolved
- SSE reconnection → simulated disconnect, new `plan_submitted` still
  rendered
- Multi-session sidebar navigation

## 12. Implementation Order

Each step below is a TDD cycle: **tests first**, then implementation, then
**Quality Gate**. Progress is tracked in the [Progress](#progress) section
at the top of this file.

1. **Scaffold** — package.json, tsconfig, directory structure, vitest +
   Playwright configured, CI-ready `npm test` script.
2. **Session manager + blocking bridge** — unit tests for persistence,
   integration tests for `waitForUserResponse` / `resolveSession` races.
3. **HTTP server + SSE** — supertest + fetch tests for every endpoint
   including `/internal/submit` long-poll, SSE event delivery, feedback →
   resolver bridge.
4. **Diff engine** — unit tests for `computeInlineDiff` edge cases, comment
   overlap/resolution math. *(Moved earlier so server-side auto-resolution
   can be integration-tested before browser work.)*
5. **MCP server process** — integration test spawning real MCP stdio
   process against real daemon on ephemeral port.
6. **Browser app — plan display** — Playwright test first: page loads,
   markdown renders, paragraphs have offset attributes.
7. **Browser app — annotation** — Playwright test first: select text, click
   button, comment persisted in submission payload.
8. **Browser app — feedback / approval** — Playwright test first: full
   flow from selection to XML arriving at daemon.
9. **Browser app — diff view** — Playwright test first: two-version session
   renders inline diff.
10. **Browser app — conversation + sidebar** — Playwright tests first:
    history list, navigation, badges.
11. **Daemon setup** — launchd plist, install script, Claude Code config.
12. **End-to-end polish** — error handling, 1 h timeout handling, graceful
    shutdown, interrupted-session recovery. *Tests first for each polish
    item.* Final gate.

## 13. Verification

To test end-to-end:

1. `npm run build` — should compile without errors.
2. `npm run dev` — starts the daemon on port 3456.
3. Open `http://localhost:3456` — should show the history/session view.
4. Configure Claude Code: add MCP server to `~/.claude/settings.json`.
5. Start Claude Code in plan mode — Claude calls `submit_plan`.
6. Browser tab auto-opens with the plan.
7. Select text, add comments, click "Send Feedback".
8. Claude receives XML feedback, revises plan, calls `submit_plan` again.
9. Browser shows revised plan with inline diff, previous comments
   resolved/open.
10. Click "Approve" — Claude Code unblocks and proceeds.
