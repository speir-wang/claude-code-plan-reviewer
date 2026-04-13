# Issue: Poll script stops after first feedback, missing subsequent rounds

## Summary

The asyncRewake poll script exits after delivering the first feedback, leaving no watcher
running for the session. If the user submits additional feedback before Claude calls
`submit_plan` again (e.g. because Claude forgot to, or is still mid-response), that
feedback is silently dropped and only recoverable via manual `get_review`.

## Steps to Reproduce

1. Claude calls `submit_plan` — poll script spawns and starts watching the session.
2. User submits feedback in the browser — script delivers it via exit code 2 and **exits**.
3. Claude receives the feedback but fails to call `submit_plan` again (bug on Claude's part,
   but a realistic scenario).
4. User submits a second round of feedback on the same session.
5. Nothing happens — no poll script is watching anymore. Feedback is lost until manually
   retrieved via `get_review`.

## Root Cause

`scripts/plan-review-poll.sh` exits with code 2 as soon as it detects new user feedback.
This is correct for the rewake mechanism, but it means the script is no longer running
to catch any subsequent submissions on the same session.

## Recommended Fix

After delivering feedback (exit 2), loop back and resume polling instead of terminating.
The session ID is already known, so the script can keep watching without any additional
setup.

Concretely, wrap the polling loop in an outer loop that resets `BASELINE_LENGTH` after
each delivery and continues:

```bash
while true; do
  # ... existing inner poll loop ...
  # When feedback is detected:
  echo "$CONTENT"
  echo ""
  echo "<session_id>${SESSION_ID}</session_id>"
  exit 2   # rewake Claude

  # After rewake, Claude Code re-invokes the script for the next submit_plan call,
  # OR if we want to keep watching the same session, loop here instead of exit.
done
```

A cleaner approach: instead of `exit 2`, output the feedback and then **continue the
outer loop** with an updated baseline. Claude Code will deliver the rewake, and the
script keeps running in the background watching for the next submission.

## Why This Is Safe

- The poll script is a child process of Claude Code — it dies automatically when Claude
  Code exits. There is no risk of it running indefinitely after the session ends.
- Sessions are isolated by session ID. A poll script watching session A will never be
  triggered by feedback submitted on session B.
- Multiple Claude Code sessions each spawn their own poll script for their own session ID,
  so there is no cross-session interference.

## Severity

Low — `get_review` is a reliable manual fallback. But it degrades the "automatic" UX
that asyncRewake is meant to provide, especially when Claude forgets to resubmit a plan.
