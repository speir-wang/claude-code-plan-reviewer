#!/usr/bin/env bash
# install.sh — Idempotent installer for the Claude Code Plan Reviewer.
#
# Usage:
#   bash install.sh            # full install
#   bash install.sh --dry-run  # print what would happen, change nothing
#   bash install.sh --help     # show this help text
#
# Steps:
#   1. Check prerequisites (node, npm, curl).
#   2. Install dependencies (npm install).
#   3. Build the project (npm run build).
#   4. Copy dist/ to /usr/local/lib/plan-reviewer/.
#   5. Merge the plan-reviewer MCP entry into ~/.claude/settings.json.
#   6. Add the PostToolUse asyncRewake hook to settings.json.

set -euo pipefail

usage() {
  grep '^#' "$0" | grep -v '^#!/' | sed 's/^# \{0,1\}//'
  exit 0
}

DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --help|-h) usage ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

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

# --- Prerequisite checks -----------------------------------------------------
log "Checking prerequisites..."
missing=()
for cmd in node npm curl; do
  if ! command -v "$cmd" &>/dev/null; then
    missing+=("$cmd")
  fi
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Error: the following required commands are not installed: ${missing[*]}" >&2
  exit 1
fi

NODE_VERSION="$(node --version)"
NPM_VERSION="$(npm --version)"
log "  node $NODE_VERSION, npm $NPM_VERSION"

# Warn if INSTALL_DIR requires elevated privileges and we are not root.
if [[ "$INSTALL_DIR" == /usr/* ]] && [[ "$(id -u)" -ne 0 ]]; then
  echo "Warning: installing to $INSTALL_DIR — you may need to run this with sudo." >&2
fi

# --- Step 1: Install dependencies --------------------------------------------
log "Installing dependencies (npm install)..."
run npm install --prefix "$PROJECT_DIR"

# --- Step 2: Build -----------------------------------------------------------
log "Building project (npm run build)..."
run npm run build --prefix "$PROJECT_DIR"

# --- Step 3: Install dist ----------------------------------------------------
log "Copying dist/ to $INSTALL_DIR..."
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

# --- Step 4: Merge Claude Code settings.json ---------------------------------
log "Merging plan-reviewer MCP entry into $CLAUDE_SETTINGS..."
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

# --- Step 5: Add asyncRewake hook --------------------------------------------
log "Adding PostToolUse asyncRewake hook to $CLAUDE_SETTINGS..."
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
  echo "[dry-run] Add PostToolUse asyncRewake hook for mcp__plan-reviewer__submit_plan"
  echo "[dry-run]   command: $POLL_SCRIPT"
fi

VERSION="$(node -e "try{console.log(require('$PROJECT_DIR/package.json').version)}catch{console.log('unknown')}")"

log "Done. Plan Reviewer v${VERSION} is installed."
echo "  Install dir: $INSTALL_DIR"
echo "  Settings:    $CLAUDE_SETTINGS"
echo "  Hook:        $POLL_SCRIPT"
