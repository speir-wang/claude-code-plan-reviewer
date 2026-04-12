# Claude Code Plan Reviewer

A browser-based annotation experience for reviewing Claude Code plans. When Claude Code presents a plan, instead of providing feedback through awkward copy-paste in the terminal, this tool opens a local web UI where you can highlight text, leave inline comments, and approve or request changes — all flowing back to Claude as structured XML.

## How It Works

The system has three parts:

```
┌─────────────────────┐         ┌──────────────────────┐
│ Claude Code          │  stdio  │ MCP Server Process   │
│ (plan mode)          │◄───────►│ (spawned per session) │
└─────────────────────┘         └──────────┬───────────┘
                                           │ HTTP
                                           ▼
                                ┌──────────────────────┐
                                │ Plan Broker Daemon    │
                                │ (port 3456)           │
                                │ - Session management  │
                                │ - Browser UI          │  ◄── Your browser
                                │ - Blocking bridge     │
                                └──────────────────────┘
```

1. Claude Code spawns the **MCP server** (`mcp-server.js`) via stdio.
2. When Claude calls `submit_plan`, the MCP server POSTs to the **broker daemon** and blocks.
3. The broker opens a browser tab with the plan.
4. You review, annotate, and approve in the browser.
5. Your feedback flows back through the broker to the MCP server, which returns it to Claude as structured XML.

The broker daemon is a long-running HTTP server. The MCP server is a lightweight stdio adapter spawned per Claude Code instance. Multiple Claude Code sessions can share the same broker.

## Features

- **Inline annotations** — select text in the plan and leave comments, Google Docs-style
- **Word-level diff view** — when Claude revises a plan, see exactly what changed with inline additions/removals
- **Comment resolution** — comments on text that was modified are automatically marked as resolved
- **Approve / Approve with Notes / Send Feedback** — three response modes
- **Session sidebar** — live-updating list of all review sessions with status badges
- **Conversation history** — timeline of plan versions, feedback rounds, and approvals
- **SSE live updates** — the browser UI updates in real time when new plans arrive
- **Session persistence** — sessions survive daemon restarts (stored in `~/.plan-reviewer/sessions/`)

## Installation

### Option A: Docker (recommended)

The simplest setup. The broker daemon runs as a persistent Docker container that auto-restarts.

**Prerequisites:** Docker Desktop or Docker Engine

**1. Build and start the container:**

```bash
git clone https://github.com/speir-wang/claude-code-plan-reviewer.git
cd claude-code-plan-reviewer
docker compose up -d --build
```

**2. Add the MCP server to Claude Code.** Add this to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "plan-reviewer": {
      "command": "docker",
      "args": ["exec", "-i", "plan-reviewer", "node", "dist/mcp-server.js"]
    }
  }
}
```

**3. Verify it's running:**

```bash
# Check the container is up
docker compose ps

# Open the UI
open http://localhost:3456
```

**Managing the container:**

```bash
docker compose up -d          # start
docker compose down           # stop (session data is preserved)
docker compose down -v        # stop AND delete session data
docker compose logs -f        # stream logs
docker compose up -d --build  # rebuild after pulling updates
```

Session data is stored in a Docker volume (`plan-reviewer-data`) and persists across container restarts, Docker Desktop quits, and rebuilds. Only `docker compose down -v` or `docker volume rm plan-reviewer-data` deletes it.

---

### Option B: macOS with launchd (automated)

The included install script builds the project, installs it system-wide, sets up a launchd service so the broker auto-starts on login, and configures Claude Code.

**Prerequisites:** Node.js >= 20, npm

```bash
git clone https://github.com/speir-wang/claude-code-plan-reviewer.git
cd claude-code-plan-reviewer
npm install
bash install.sh
```

This will:
1. Build the project (`npm run build`)
2. Copy `dist/`, `package.json`, and `node_modules/` to `/usr/local/lib/plan-reviewer/`
3. Install a launchd plist to `~/Library/LaunchAgents/`
4. Load the launchd agent (broker starts immediately)
5. Merge the `plan-reviewer` MCP entry into `~/.claude/settings.json`

Preview what the script will do without making changes:

```bash
bash install.sh --dry-run
```

**Logs:** `tail -f /tmp/plan-reviewer.log`

---

### Option C: Manual setup (any platform)

**Prerequisites:** Node.js >= 20, npm

**1. Build:**

```bash
git clone https://github.com/speir-wang/claude-code-plan-reviewer.git
cd claude-code-plan-reviewer
npm install
npm run build
```

**2. Start the broker daemon** (must be running whenever you use Claude Code):

```bash
node dist/main.js
```

**3. Add the MCP server to Claude Code.** Add this to `~/.claude/settings.json`, replacing the path with the absolute path to your clone:

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

## Usage

Once installed, the plan reviewer works automatically when Claude Code enters plan mode:

1. **Claude generates a plan** and calls the `submit_plan` MCP tool.
2. **A browser tab opens** at `http://localhost:3456?session=<id>` showing the plan rendered as Markdown.
3. **Review the plan:**
   - **Add comments** — select any text in the plan, click "Add comment", and type your note. Comments appear in the sidebar panel.
   - **Delete comments** — click the delete button on any comment to remove it.
4. **Submit your response** using one of three options:
   - **Send Feedback** — sends your inline comments back to Claude. Claude will revise the plan based on your annotations.
   - **Approve** — approves the plan as-is. Claude proceeds with implementation.
   - **Approve with Notes** — approves the plan with additional notes attached.
5. **Claude revises and resubmits.** When a revised plan arrives, the browser switches to a **diff view** showing word-level changes. Comments from the previous round that overlap modified text are automatically marked as resolved.
6. **Repeat** until you approve.

### Browser UI Layout

- **Left sidebar** — list of all sessions with status badges (active / approved / interrupted). Click to navigate.
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
| `PLAN_REVIEWER_PORT` | `3456` | Port the broker daemon listens on |
| `PLAN_REVIEWER_BROKER_URL` | `http://127.0.0.1:3456` | URL the MCP server uses to reach the broker |

To use a custom port with Docker, set it in `docker-compose.yml`:

```yaml
services:
  plan-reviewer:
    environment:
      - PLAN_REVIEWER_PORT=4000
    ports:
      - "4000:4000"
```

## Development

```bash
npm install               # install dependencies
npm run dev               # start broker with tsx (auto-reloads)
npm test                  # run all vitest tests
npm run test:browser      # run Playwright browser tests
npm run typecheck         # TypeScript type checking
npm run build             # full production build
```

### Project Structure

```
src/
  main.ts              # Broker daemon entry point
  mcp-server.ts        # MCP tool registration (submit_plan) — stdio adapter
  http-server.ts       # Express HTTP + SSE server
  session-manager.ts   # Session lifecycle, persistence, blocking bridge
  sse-manager.ts       # Per-session + global SSE channels
  xml.ts               # XML builders for feedback/approval responses
  diff.ts              # Word-level inline diff algorithm
  types.ts             # Shared TypeScript types
  browser/             # Browser app (vanilla TypeScript, bundled by esbuild)
    index.html
    app.ts             # Entry point — routing, session loading
    plan-display.ts    # Markdown rendering with offset-tracked blocks
    annotation.ts      # Inline comment creation and management
    diff-view.ts       # Word-level diff rendering + comment resolution
    conversation.ts    # Conversation history timeline
    sidebar.ts         # Live session list with SSE updates
    feedback.ts        # Feedback/approve submission controls
    styles.css
```

### Testing

The project uses an integration-heavy test pyramid:

- **Unit tests** (vitest) — diff algorithm, XML escaping, session persistence
- **Integration tests** (vitest + supertest) — HTTP endpoints, SSE, long-poll, MCP stdio process
- **Browser tests** (Playwright) — full UI flows with real DOM events and a real broker

```bash
npm run test:unit         # unit tests only
npm run test:integration  # integration tests only
npm run test:browser      # Playwright browser tests (requires build)
```

## Troubleshooting

**Claude Code doesn't show the `submit_plan` tool:**
- Verify `~/.claude/settings.json` has the `plan-reviewer` MCP entry.
- Restart Claude Code after editing settings.

**"Plan Reviewer broker is not running" error:**
- The broker daemon isn't reachable. Start it (`docker compose up -d` or `node dist/main.js`).
- Check the port: `curl http://localhost:3456/api/sessions` should return JSON.

**Browser tab doesn't open automatically:**
- Auto-open uses macOS `open` command. On other platforms, manually navigate to the URL shown in the broker logs.

**Docker: "container not found" when Claude Code starts:**
- The `plan-reviewer` container must be running before Claude Code tries to use it. Run `docker compose up -d`.

**Port conflict:**
- Set a different port via `PLAN_REVIEWER_PORT` and update `PLAN_REVIEWER_BROKER_URL` in the MCP config to match.

## License

MIT
