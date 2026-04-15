# E2E Scenario: Approve

## What this tests

The basic plan submission and approval roundtrip. Verifies that `submit_plan`
creates a session, the browser reviewer can approve it, and `get_review` returns
the correct approval XML.

## Steps for Claude Code

1. Call `submit_plan` with the following plan text:

   ```
   ## Plan: Add user authentication

   ### Step 1: Create auth middleware
   Add JWT validation middleware to the Express app.

   ### Step 2: Protect routes
   Apply the middleware to all `/api/user` endpoints.

   ### Step 3: Update tests
   Add integration tests for the new authentication flow.
   ```

2. Record the `sessionId` from the `<session_id>` tag in the response.

3. Start the Playwright reviewer in the background:
   ```
   npx tsx test/e2e/reviewer.ts --scenario approve
   ```

4. Call `get_review` with that `sessionId`. The reviewer will click Approve.

## Expected outcome

`get_review` returns XML containing `type="approved"`:

```xml
<plan_review type="approved" />
```

## Pass / Fail

- **PASS** — `get_review` response contains `type="approved"`
- **FAIL** — `get_review` returns anything else, never returns feedback, or errors
