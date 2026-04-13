#!/usr/bin/env bash
# uninstall.sh — Remove the Claude Code Plan Reviewer installation.
#
# Usage:
#   bash uninstall.sh            # full uninstall
#   bash uninstall.sh --dry-run  # print what would happen, change nothing
#
# Reverses install.sh:
#   1. Remove /usr/local/lib/plan-reviewer/.
#   2. Remove the plan-reviewer MCP entry from ~/.claude/settings.json.
#   3. Remove the PostToolUse asyncRewake hook from ~/.claude/settings.json.

set -euo pipefail

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

INSTALL_DIR="/usr/local/lib/plan-reviewer"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"

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

# --- Step 1: Remove installed files ------------------------------------------
log "Removing $INSTALL_DIR..."
if [[ -d "$INSTALL_DIR" ]]; then
  run rm -rf "$INSTALL_DIR"
else
  echo "  (not found, skipping)"
fi

# --- Step 2: Remove MCP server entry -----------------------------------------
log "Removing plan-reviewer MCP entry from $CLAUDE_SETTINGS..."
if [[ -f "$CLAUDE_SETTINGS" ]]; then
  if ! $DRY_RUN; then
    node -e "
      const fs = require('fs');
      const p = '$CLAUDE_SETTINGS';
      let cfg = {};
      try { cfg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { process.exit(0); }
      if (cfg.mcpServers && cfg.mcpServers['plan-reviewer']) {
        delete cfg.mcpServers['plan-reviewer'];
        if (Object.keys(cfg.mcpServers).length === 0) delete cfg.mcpServers;
      }
      fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    "
  else
    echo "[dry-run] Remove mcpServers.plan-reviewer from $CLAUDE_SETTINGS"
  fi
else
  echo "  ($CLAUDE_SETTINGS not found, skipping)"
fi

# --- Step 3: Remove asyncRewake hook -----------------------------------------
log "Removing PostToolUse asyncRewake hook from $CLAUDE_SETTINGS..."
if [[ -f "$CLAUDE_SETTINGS" ]]; then
  if ! $DRY_RUN; then
    node -e "
      const fs = require('fs');
      const p = '$CLAUDE_SETTINGS';
      let cfg = {};
      try { cfg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { process.exit(0); }
      if (cfg.hooks && cfg.hooks.PostToolUse) {
        cfg.hooks.PostToolUse = cfg.hooks.PostToolUse.filter(
          h => h.matcher !== 'mcp__plan-reviewer__submit_plan' && h.matcher !== 'submit_plan'
        );
        if (cfg.hooks.PostToolUse.length === 0) delete cfg.hooks.PostToolUse;
        if (Object.keys(cfg.hooks).length === 0) delete cfg.hooks;
      }
      fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    "
  else
    echo "[dry-run] Remove PostToolUse hook for mcp__plan-reviewer__submit_plan from $CLAUDE_SETTINGS"
  fi
else
  echo "  ($CLAUDE_SETTINGS not found, skipping)"
fi

log "Done. The Plan Reviewer has been uninstalled."
echo "  Note: this does not remove the project source directory."
echo "  To reinstall, run: bash install.sh"
