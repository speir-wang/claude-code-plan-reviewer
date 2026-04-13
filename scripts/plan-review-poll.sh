#!/usr/bin/env bash
# plan-review-poll.sh — PostToolUse asyncRewake hook for Claude Code.
#
# After submit_plan returns, Claude Code invokes this script in the background.
# It polls the plan-reviewer HTTP API until the user submits feedback or
# approval, then exits with code 2 so Claude Code rewakes with the feedback
# content injected as a system message.
#
# Input:
#   stdin — JSON payload from Claude Code PostToolUse hook:
#     {
#       "tool_name": "mcp__plan-reviewer__submit_plan",
#       "tool_input": { "plan": "..." },
#       "tool_response": [{ "type": "text", "text": "...<session_id>...</session_id>..." }]
#     }
#
# Environment:
#   PLAN_REVIEWER_PORT — HTTP port (default: 3456)
#   PLAN_REVIEWER_POLL_TIMEOUT — max seconds to poll (default: 3600)
#
# Exit codes:
#   0 — no action needed (session not found, timeout, etc.)
#   2 — feedback detected; stdout contains the feedback content

set -euo pipefail

PORT="${PLAN_REVIEWER_PORT:-3456}"
BASE_URL="http://127.0.0.1:${PORT}"
MAX_POLL_SECONDS="${PLAN_REVIEWER_POLL_TIMEOUT:-3600}"

# Extract sessionId from the JSON payload passed on stdin by Claude Code.
# tool_response is a flat array: [{ "type": "text", "text": "...<session_id>...</session_id>..." }]
SESSION_ID="$(cat | node -e "
  let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
    try {
      const input = JSON.parse(d);
      const arr = Array.isArray(input.tool_response) ? input.tool_response : [];
      const text = arr.map(c => c.text || '').join('');
      const m = text.match(/<session_id>([^<]+)<\/session_id>/);
      console.log(m ? m[1] : '');
    } catch { console.log(''); }
  });
" || true)"

if [[ -z "$SESSION_ID" ]]; then
  exit 0
fi

# Record the current conversation length as baseline.
BASELINE_RESPONSE="$(curl -sf "${BASE_URL}/api/sessions/${SESSION_ID}" || true)"
if [[ -z "$BASELINE_RESPONSE" ]]; then
  exit 0
fi

BASELINE_LENGTH="$(echo "$BASELINE_RESPONSE" | node -e "
  let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
    try { console.log(JSON.parse(d).session.conversation.length); }
    catch { console.log(0); }
  });
")"

ELAPSED=0

while [[ $ELAPSED -lt $MAX_POLL_SECONDS ]]; do
  sleep 3
  ELAPSED=$((ELAPSED + 3))

  RESPONSE="$(curl -sf "${BASE_URL}/api/sessions/${SESSION_ID}" 2>/dev/null || true)"
  if [[ -z "$RESPONSE" ]]; then
    continue
  fi

  # Check for new conversation entries from the user.
  RESULT="$(echo "$RESPONSE" | node -e "
    let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
      try {
        const s = JSON.parse(d).session;
        const len = s.conversation.length;
        const baseline = ${BASELINE_LENGTH};
        if (len > baseline) {
          const latest = s.conversation[len - 1];
          if (latest.role === 'user') {
            // Output: LENGTH\nCONTENT
            console.log(len);
            console.log(latest.content);
          } else {
            console.log(len);
          }
        } else {
          console.log(baseline);
        }
      } catch {
        console.log(${BASELINE_LENGTH});
      }
    });
  ")"

  # Parse the node output: first line is length, rest is content (if user entry).
  CURRENT_LENGTH="$(echo "$RESULT" | head -n1)"
  if [[ "$CURRENT_LENGTH" -gt "$BASELINE_LENGTH" ]]; then
    # Check if there's content (user feedback) after the length line.
    CONTENT="$(echo "$RESULT" | tail -n +2)"
    if [[ -n "$CONTENT" ]]; then
      echo "$CONTENT"
      echo ""
      echo "<session_id>${SESSION_ID}</session_id>"
      exit 2
    fi
    # New entry but not from user (e.g. claude submitted a new plan) —
    # update baseline and keep polling.
    BASELINE_LENGTH="$CURRENT_LENGTH"
  fi
done

# Timeout — exit without rewake.
exit 0
