# E2E Scenario: Polling (Delayed Approval)

## What this tests

That Claude Code correctly handles a "pending" response from `get_review` and
retries rather than giving up. This is the **known failure mode** where Claude
Code calls `get_review` before the reviewer has acted and incorrectly treats the
pending state as a final answer.

The reviewer deliberately waits 5 seconds before approving, ensuring that the
first `get_review` call returns a pending message.

## Steps for Claude Code

1. Call `submit_plan` with this plan:

   ```
   ## Plan: Optimize image processing pipeline

   ### Step 1: Profile current performance
   Run benchmarks to identify the bottleneck.

   ### Step 2: Implement parallel processing
   Use worker threads to process images concurrently.

   ### Step 3: Add caching layer
   Cache processed images to avoid redundant work.
   ```

2. Record the `sessionId`.

3. Start the Playwright reviewer in the background:
   ```
   npx tsx test/e2e/reviewer.ts --scenario polling
   ```

4. **Immediately** call `get_review` — do not wait. The response will say the
   review is still pending (the reviewer hasn't acted yet).

5. **Do not stop here.** Wait a few seconds and call `get_review` again.
   Continue polling until the review is received (up to 30 seconds total).

6. The reviewer approves after a 5-second delay.

## Expected outcome

`get_review` will initially return a message containing "pending".
After polling, it eventually returns:
```xml
<plan_review type="approved" />
```

## Pass / Fail

- **PASS** — `get_review` eventually returns `type="approved"` after one or more
  "still pending" responses
- **FAIL** — Claude Code treats the first "pending" response as a final answer
  and stops, or never calls `get_review` more than once
