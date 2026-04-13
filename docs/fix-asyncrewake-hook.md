# Fix: asyncRewake hook not firing after `submit_plan`

## Symptoms

- Feedback submitted in the browser dashboard is not automatically delivered back to Claude.
- Manual polling via `get_review` works fine.
- The `asyncRewake` hook in `~/.claude/settings.json` appears correctly configured, but the script never runs.

## Root Causes

### 1. Wrong `PostToolUse` matcher — hook never triggered

The hook was registered with:

```json
{ "matcher": "submit_plan", ... }
```

Claude Code identifies MCP tools by their **fully-qualified name** (`mcp__<server>__<tool>`), not the bare tool name. Because no tool named exactly `submit_plan` fires a PostToolUse event, the hook was silently skipped every time.

**Fix:** change the matcher to the full MCP tool name:

```json
{ "matcher": "mcp__plan-reviewer__submit_plan", ... }
```

Affected files:
- `~/.claude/settings.json`
- `install.sh` (the installer that writes the hook entry)

### 2. Script read `TOOL_RESULT` env var — variable is always empty

The poll script opened with:

```bash
SESSION_ID="$(echo "${TOOL_RESULT:-}" | grep -oP ...)"
```

Claude Code does **not** inject tool output via environment variables. For `PostToolUse` hooks, the runtime passes a JSON payload on **stdin**:

```json
{
  "tool_name": "mcp__plan-reviewer__submit_plan",
  "tool_input": { "plan": "..." },
  "tool_response": {
    "type": "tool_result",
    "content": [{ "type": "text", "text": "Plan submitted...\n<session_id>…</session_id>" }]
  }
}
```

Because `TOOL_RESULT` was always empty, `SESSION_ID` was always empty, and the script exited immediately with code 0 (no rewake).

**Fix:** read stdin and parse the JSON to extract the session ID:

```bash
SESSION_ID="$(cat | node -e "
  let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
    try {
      const input = JSON.parse(d);
      const content = input.tool_response;
      const text = Array.isArray(content)
        ? content.map(c => c.text || '').join('')
        : String(content || '');
      const m = text.match(/<session_id>([^<]+)<\/session_id>/);
      console.log(m ? m[1] : '');
    } catch { console.log(''); }
  });" || true)"
```

Affected files:
- `scripts/plan-review-poll.sh`

### 3. Wrong `tool_response` shape — session ID never matched

Even after fixing the stdin reading, the script assumed `tool_response` was an object with a `content` field:

```json
{ "tool_response": { "content": [{ "type": "text", "text": "..." }] } }
```

The actual shape Claude Code sends is a **flat array**:

```json
{ "tool_response": [{ "type": "text", "text": "Plan submitted...\n<session_id>…</session_id>" }] }
```

So `input.tool_response?.content` was always `undefined`, causing the regex to never match.

**Fix:** access `input.tool_response` directly (it is already the array).

Affected files:
- `scripts/plan-review-poll.sh`

## Files Changed

| File | Change |
|---|---|
| `~/.claude/settings.json` | Matcher: `"submit_plan"` → `"mcp__plan-reviewer__submit_plan"` |
| `scripts/plan-review-poll.sh` | Read session ID from stdin JSON; use `tool_response` directly (flat array, no `.content` wrapper) |
| `install.sh` | Matcher written by installer updated to match |

## Verification

After applying the fix:

1. Ask Claude to submit a dummy plan.
2. Leave feedback in the browser dashboard.
3. Claude should receive the feedback automatically without needing a manual `get_review` call.

If it still doesn't fire, check that the MCP server name in `~/.claude/settings.json` under `mcpServers` is exactly `plan-reviewer` — the matcher prefix must match it.
