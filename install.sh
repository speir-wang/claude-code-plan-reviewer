#!/usr/bin/env bash
# install.sh — Idempotent installer for the Claude Code Plan Reviewer.
#
# Usage:
#   bash install.sh            # full install
#   bash install.sh --dry-run  # print what would happen, change nothing
#
# Steps:
#   1. Build the project (npm run build).
#   2. Copy dist/ to /usr/local/lib/plan-reviewer/.
#   3. Merge the plan-reviewer MCP entry into ~/.claude/settings.json.
#   4. Copy the asyncRewake poll script.
#   5. Add the PostToolUse hook configuration to settings.json.

set -euo pipefail

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="/usr/local/lib/plan-reviewer"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
POLL_SCRIPT="$INSTALL_DIR/scripts/plan-review-poll.sh"

run() {
  if $DRY_RUN; then
    echo "[dry-run] $*"
  else
    "$@"
  fi
}

log() {
  echo "==> $*"
}

# --- Step 1: Build -----------------------------------------------------------
log "Building project (npm run build)…"
run npm run build --prefix "$PROJECT_DIR"

# --- Step 2: Install dist ----------------------------------------------------
log "Copying dist/ to $INSTALL_DIR…"
run mkdir -p "$INSTALL_DIR"
if ! $DRY_RUN; then
  cp -R "$PROJECT_DIR/dist" "$INSTALL_DIR/"
  cp "$PROJECT_DIR/package.json" "$INSTALL_DIR/"
  cp -R "$PROJECT_DIR/node_modules" "$INSTALL_DIR/"
  mkdir -p "$INSTALL_DIR/scripts"
  cp "$PROJECT_DIR/scripts/plan-review-poll.sh" "$INSTALL_DIR/scripts/"
  chmod +x "$INSTALL_DIR/scripts/plan-review-poll.sh"
else
  echo "[dry-run] cp -R dist/, package.json, node_modules/, scripts/ to $INSTALL_DIR/"
fi

# --- Step 3: Merge Claude Code settings.json ---------------------------------
log "Merging plan-reviewer MCP entry into $CLAUDE_SETTINGS…"
if ! $DRY_RUN; then
  mkdir -p "$(dirname "$CLAUDE_SETTINGS")"
  node -e "
    const fs = require('fs');
    const p = '$CLAUDE_SETTINGS';
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
    if (!cfg.mcpServers) cfg.mcpServers = {};
    cfg.mcpServers['plan-reviewer'] = {
      command: 'node',
      args: ['$INSTALL_DIR/dist/mcp-server.js'],
    };
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  "
else
  echo "[dry-run] Merge mcpServers.plan-reviewer into $CLAUDE_SETTINGS"
  echo "[dry-run]   command: node"
  echo "[dry-run]   args: [$INSTALL_DIR/dist/mcp-server.js]"
fi

# --- Step 4: Add asyncRewake hook --------------------------------------------
log "Adding PostToolUse asyncRewake hook to $CLAUDE_SETTINGS…"
if ! $DRY_RUN; then
  node -e "
    const fs = require('fs');
    const p = '$CLAUDE_SETTINGS';
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
    if (!cfg.hooks) cfg.hooks = {};
    if (!cfg.hooks.PostToolUse) cfg.hooks.PostToolUse = [];
    const exists = cfg.hooks.PostToolUse.some(h => h.matcher === 'mcp__plan-reviewer__submit_plan');
    if (!exists) {
      cfg.hooks.PostToolUse.push({
        matcher: 'mcp__plan-reviewer__submit_plan',
        command: '$POLL_SCRIPT',
        asyncRewake: true,
      });
    }
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  "
else
  echo "[dry-run] Add PostToolUse asyncRewake hook for submit_plan"
  echo "[dry-run]   command: $POLL_SCRIPT"
fi

log "Done. The Plan Reviewer is installed."
echo "  MCP:    ~/.claude/settings.json"
echo "  Hook:   $POLL_SCRIPT"
echo "  Usage:  claude mcp add plan-reviewer -- node $INSTALL_DIR/dist/mcp-server.js"
