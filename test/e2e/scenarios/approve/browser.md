# Browser Actions: Approve Scenario

## What the Playwright reviewer does

When a new session appears on the plan reviewer server:

1. Navigate to the session URL in the headed browser
2. Wait for the plan to render and the **Approve** button to become visible
3. Click the **Approve** button (`[data-action="approve"]`)
4. Wait for the "Plan approved." confirmation text to appear

No comments are added. The plan is approved unconditionally and immediately.

## Timing

- The reviewer detects the session within ~500ms of `submit_plan` being called.
- Approval click happens as soon as the page loads (~1–2s after navigation).
- Total reviewer time: under 5 seconds from session detection to approval.
