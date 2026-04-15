# E2E Scenario: Feedback Cycle

## What this tests

That Claude Code correctly handles feedback XML, revises the plan, and
re-submits using the same `sessionId`. The reviewer then approves the revision.

This verifies:
- Parsing `<plan_review type="feedback">` and reading comment anchors/notes
- Threading the `sessionId` across multiple `submit_plan` calls
- Receiving and parsing approval on the revised plan

## Steps for Claude Code

1. Call `submit_plan` with this initial plan:

   ```
   ## Plan: Refactor database layer

   ### Step 1: Extract DB class
   Move all raw SQL into a DatabaseClient class.

   ### Step 2: Add connection pooling
   Use pg-pool for connection management.
   ```

2. Record the `sessionId` from the response.

3. Start the Playwright reviewer in the background:
   ```
   npx tsx test/e2e/reviewer.ts --scenario feedback-cycle
   ```

4. Call `get_review` with that `sessionId`.
   The reviewer will send feedback requesting a missing step.

5. Parse the feedback XML. It will look like:
   ```xml
   <plan_review type="feedback">
     <comment>
       <anchor>Step 2: Add connection pooling</anchor>
       <note>Please add a step for migration scripts.</note>
     </comment>
   </plan_review>
   ```

6. Revise the plan to address the feedback. Call `submit_plan` again
   with the **same `sessionId`** and this updated plan:

   ```
   ## Plan: Refactor database layer

   ### Step 1: Extract DB class
   Move all raw SQL into a DatabaseClient class.

   ### Step 2: Add connection pooling
   Use pg-pool for connection management.

   ### Step 3: Add migration scripts
   Create migration scripts to handle schema changes during deployment.
   ```

7. Call `get_review` with the same `sessionId`.
   The reviewer will **Approve** the revised plan.

## Expected outcome

The second `get_review` returns:
```xml
<plan_review type="approved" />
```

## Pass / Fail

- **PASS** — Second `get_review` returns `type="approved"`
- **FAIL** — Feedback XML not parsed, `sessionId` not threaded to v2 `submit_plan`,
  approval never received, or any tool call errors
