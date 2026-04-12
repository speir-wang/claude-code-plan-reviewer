# Claude Code Plan Reviewer

A browser-based annotation experience for reviewing Claude Code plans. When Claude Code presents a plan, instead of providing feedback through awkward copy-paste in the terminal, this tool opens a local web UI where you can highlight text, leave inline comments, and approve or request changes — all flowing back to Claude as structured XML.

## How It Works

The system is a single Node.js process that acts as both an MCP server and an HTTP server:

```
┌─────────────────────┐         ┌──────────────────────────┐
│ Claude Code          │  stdio  │ MCP Server               │
│                      │◄───────►│ (+ embedded HTTP server)  │
└─────────────────────┘         │ - submit_plan (immediate)  │
                                │ - get_review (poll)        │
                                │ - Session management       │
                                │ - Browser UI on :3456      │  ◄── Your browser
                                └──────────────────────────┘
```

1. Claude Code spawns the **MCP server** (`mcp-server.js`) via stdio.
2. When Claude calls `submit_plan`, the tool **returns immediately** with a session ID and opens a browser tab.
3. You review, annotate, and approve in the browser.
4. Feedback is delivered back to Claude via an **asyncRewake hook** (automatic) or the `get_review` tool (manual fallback).
5. Claude reads the feedback, revises the plan, and calls `submit_plan` again.

**No separate daemon, no Docker required.** The MCP server process embeds everything. Multiple Claude Code sessions can share the same HTTP server (port collision is handled automatically).

## Features

- **Non-blocking** — `submit_plan` returns immediately; Claude Code is not locked during review
- **Inline annotations** — select text in the plan and leave comments, Google Docs-style
- **Word-level diff view** — when Claude revises a plan, see exactly what changed with inline additions/removals
- **Comment resolution** — comments on text that was modified are automatically marked as resolved
- **Approve / Approve with Notes / Send Feedback** — three response modes
- **Session sidebar** — live-updating list of all review sessions with status badges
- **Conversation history** — timeline of plan versions, feedback rounds, and approvals
- **Session persistence** — sessions survive process restarts (stored in `~/.plan-reviewer/sessions/`)
- **Multi-session** — if port 3456 is already in use, additional MCP servers operate in client mode

## Installation

### Quick Setup

**Prerequisites:** Node.js >= 20, npm

**1. Build:**

```bash
git clone https://github.com/speir-wang/claude-code-plan-reviewer.git
cd claude-code-plan-reviewer
npm install
npm run build
```

**2. Add the MCP server to Claude Code.** Add this to `~/.claude/settings.json`, replacing the path with the absolute path to your clone:

```json
{
  "mcpServers": {
    "plan-reviewer": {
      "command": "node",
      "args": ["/absolute/path/to/claude-code-plan-reviewer/dist/mcp-server.js"]
    }
  }
}
```

Or use the Claude CLI:

```bash
claude mcp add plan-reviewer -- node /absolute/path/to/claude-code-plan-reviewer/dist/mcp-server.js
```

**3. (Optional) Set up the asyncRewake hook** for automatic feedback delivery. Add this to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "submit_plan",
      "command": "/absolute/path/to/claude-code-plan-reviewer/scripts/plan-review-poll.sh",
      "asyncRewake": true
    }]
  }
}
```

Without the hook, you can still retrieve feedback manually by asking Claude to call `get_review`.

### Automated Install

The included install script handles build, copy, MCP registration, and hook setup:

```bash
bash install.sh          # full install
bash install.sh --dry-run  # preview without changes
```

## Usage

Once installed, the plan reviewer works automatically when Claude Code enters plan mode:

1. **Claude generates a plan** and calls the `submit_plan` MCP tool.
2. **A browser tab opens** at `http://localhost:3456?session=<id>` showing the plan rendered as Markdown. Claude is **not blocked** — you can continue interacting.
3. **Review the plan:**
   - **Add comments** — select any text in the plan, click "Add comment", and type your note. Comments appear in the sidebar panel.
   - **Delete comments** — click the delete button on any comment to remove it.
4. **Submit your response** using one of three options:
   - **Send Feedback** — sends your inline comments back to Claude. Claude will revise the plan based on your annotations.
   - **Approve** — approves the plan as-is. Claude proceeds with implementation.
   - **Approve with Notes** — approves the plan with additional notes attached.
5. **Feedback reaches Claude** via the asyncRewake hook (automatic) or when you ask Claude to call `get_review`.
6. **Claude revises and resubmits.** When a revised plan arrives, the browser switches to a **diff view** showing word-level changes. Comments from the previous round that overlap modified text are automatically marked as resolved.
7. **Repeat** until you approve.

### MCP Tools

| Tool | Description |
|---|---|
| `submit_plan(plan, sessionId?)` | Submit a plan for review. Returns immediately with session ID and URL. Omit `sessionId` for new sessions; include it for follow-up revisions. |
| `get_review(sessionId)` | Check if the user has provided feedback or approved. Returns the feedback XML or a "still pending" message. |

### Browser UI Layout

- **Left sidebar** — list of all sessions with status badges (active / approved). Click to navigate.
- **Center** — the plan content (Markdown view or diff view), with the conversation history above it.
- **Right panel** — your draft comments (annotation mode) or prior-round comments (diff mode).
- **Bottom bar** — Send Feedback / Approve / Approve with Notes buttons.

### What Claude Receives

Your feedback is returned to Claude as structured XML:

```xml
<!-- Feedback with comments -->
<plan_review type="feedback">
  <comment>
    <anchor>the selected text</anchor>
    <note>your comment here</note>
  </comment>
</plan_review>

<!-- Approval -->
<plan_review type="approved" />

<!-- Approval with notes -->
<plan_review type="approved_with_notes">
  <note>your notes here</note>
</plan_review>
```

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `PLAN_REVIEWER_PORT` | `3456` | Port the HTTP server listens on |
| `PLAN_REVIEWER_POLL_TIMEOUT` | `3600` | Max seconds the poll script waits for feedback |

## Development

```bash
npm install               # install dependencies
npm run dev               # start with tsx (auto-reloads)
npm test                  # run all vitest tests
npm run test:browser      # run Playwright browser tests
npm run typecheck         # TypeScript type checking
npm run build             # full production build
```

### Project Structure

```
src/
  mcp-server.ts        # Entry point — MCP tools + embedded HTTP server
  http-server.ts       # Express HTTP server (REST API + browser UI)
  session-manager.ts   # Session lifecycle and disk persistence
  xml.ts               # XML builders for feedback/approval responses
  diff.ts              # Word-level inline diff algorithm
  types.ts             # Shared TypeScript types
  conversation-preview.ts  # XML preview formatting
  browser/             # Browser app (vanilla TypeScript, bundled by esbuild)
    index.html
    app.ts             # Entry point — routing, session loading
    plan-display.ts    # Markdown rendering with offset-tracked blocks
    annotation.ts      # Inline comment creation and management
    diff-view.ts       # Word-level diff rendering + comment resolution
    conversation.ts    # Conversation history timeline
    sidebar.ts         # Session list with polling updates
    feedback.ts        # Feedback/approve submission controls
    styles.css
scripts/
  plan-review-poll.sh  # asyncRewake hook — polls for feedback
  bundle-browser.js    # esbuild bundler for browser code
```

### Testing

The project uses an integration-heavy test pyramid:

- **Unit tests** (vitest) — diff algorithm, XML escaping, session persistence
- **Integration tests** (vitest + supertest) — HTTP endpoints, non-blocking submit, MCP stdio process
- **Browser tests** (Playwright) — full UI flows with real DOM events and a real server

```bash
npm run test:unit         # unit tests only
npm run test:integration  # integration tests only
npm run test:browser      # Playwright browser tests (requires build)
```

## Troubleshooting

**Claude Code doesn't show the `submit_plan` tool:**
- Verify `~/.claude/settings.json` has the `plan-reviewer` MCP entry.
- Restart Claude Code after editing settings.

**Browser tab doesn't open automatically:**
- Auto-open uses `open` (macOS), `xdg-open` (Linux), or `start` (Windows). If none works, manually navigate to the URL shown in the tool response.

**Port conflict:**
- Set a different port via `PLAN_REVIEWER_PORT` environment variable in your MCP server config.
- If another MCP server instance already holds the port, additional instances automatically operate in client mode.

**Feedback not reaching Claude automatically:**
- Ensure the asyncRewake hook is configured in `~/.claude/settings.json` (see Installation step 3).
- As a fallback, ask Claude to call `get_review` to manually check for feedback.

## License

MIT
