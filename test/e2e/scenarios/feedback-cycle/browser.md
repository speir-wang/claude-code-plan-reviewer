# Browser Actions: Feedback Cycle Scenario

## What the Playwright reviewer does

### Round 1 — Send Feedback

When a new session appears:

1. Navigate to the session URL in the headed browser
2. Wait for the plan to render and the **Approve** button to become visible
3. POST feedback via the HTTP API (direct, not through annotation UI):
   - Endpoint: `POST /api/sessions/:id/feedback`
   - Payload: one comment with anchor `"Step 2: Add connection pooling"` and
     note `"Please add a step for migration scripts."`
4. Log `✓ Sent feedback for session <id>`

### Round 2 — Approve Revision

5. Poll `GET /api/sessions/:id` every second until `planVersions.length >= 2`
   (Claude Code has submitted the revised plan)
6. Navigate back to the session URL (picks up the new version)
7. Wait for the diff view to render and the **Approve** button to be visible
8. Click **Approve**
9. Wait for "Plan approved." confirmation
10. Log `✓ Approved revised session <id>`

## Notes

Feedback is sent via direct HTTP POST rather than through the browser annotation
UI because programmatic text selection is fragile. The live browser still shows
both the original plan and the diff view of the revision — the user can see the
full cycle unfold in the browser window.
