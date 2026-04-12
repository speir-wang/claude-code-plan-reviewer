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
#   3. Install the launchd plist to ~/Library/LaunchAgents/.
#   4. Load (or reload) the launchd agent.
#   5. Merge the plan-reviewer MCP entry into ~/.claude/settings.json.

set -euo pipefail

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="/usr/local/lib/plan-reviewer"
PLIST_SRC="$PROJECT_DIR/com.plan-reviewer.broker.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/com.plan-reviewer.broker.plist"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
LABEL="com.plan-reviewer.broker"

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
else
  echo "[dry-run] cp -R dist/, package.json, node_modules/ to $INSTALL_DIR/"
fi

# --- Step 3: Install plist ---------------------------------------------------
log "Installing launchd plist to ~/Library/LaunchAgents/…"
run mkdir -p "$HOME/Library/LaunchAgents"
if ! $DRY_RUN; then
  cp "$PLIST_SRC" "$PLIST_DEST"
else
  echo "[dry-run] cp $PLIST_SRC $PLIST_DEST"
fi

# --- Step 4: Load launchd agent ----------------------------------------------
log "Loading launchd agent ($LABEL)…"
if ! $DRY_RUN; then
  launchctl bootout "gui/$(id -u)" "$PLIST_DEST" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST"
else
  echo "[dry-run] launchctl bootout + bootstrap $LABEL"
fi

# --- Step 5: Merge Claude Code settings.json ---------------------------------
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

log "Done. The Plan Reviewer broker is running on http://127.0.0.1:3456."
echo "  Logs:  tail -f /tmp/plan-reviewer.log"
echo "  Plist: $PLIST_DEST"
echo "  MCP:   ~/.claude/settings.json"
