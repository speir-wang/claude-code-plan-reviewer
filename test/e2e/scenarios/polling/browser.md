# Browser Actions: Polling Scenario

## What the Playwright reviewer does

When a new session appears:

1. Navigate to the session URL in the headed browser
2. Wait for the plan to render and the **Approve** button to become visible
3. **Wait 5 seconds** — this is intentional, not a bug. The delay ensures that
   Claude Code's first `get_review` call returns "pending".
4. Click the **Approve** button
5. Wait for the "Plan approved." confirmation
6. Log `✓ Approved session <id> after 5s delay`

## Why the delay matters

The 5-second wait is the mechanism that triggers the failure mode being tested.
Without the delay, `get_review` might return approval on the first call and
Claude Code would never encounter the "pending" state. The delay forces Claude
Code to demonstrate correct polling behavior.
