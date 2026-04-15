Create a plan for the following task using the Plan agent, then submit it to the plan reviewer for human review before proceeding.

**Task:** $ARGUMENTS

Follow these steps exactly:

## Step 1 — Research and plan with the Plan agent

Use the Agent tool with `subagent_type: "Plan"` to research the codebase and produce a detailed implementation plan. Give it a thorough prompt that includes:
- The task description above
- A request for a step-by-step implementation plan covering: which files to change, what each change does, order of operations, and any risks or edge cases to watch for

Do not write the plan yourself. Delegate entirely to the Plan agent and use its output verbatim.

## Step 2 — Submit for review

Call `mcp__plan-reviewer__submit_plan` with the full plan text returned by the Plan agent. Do not summarize or modify it first.

## Step 3 — Handle review feedback

The asyncRewake hook will re-wake this session with feedback when the reviewer responds. When that happens:

- **`type="approved"`** or **`type="approved_with_notes"`**: Plan is approved. Acknowledge the approval and offer to begin implementation.
- **`type="feedback"`**: Address every comment from the reviewer. Use the Plan agent again if re-research is needed, then call `mcp__plan-reviewer__submit_plan` again with the **same `sessionId`** to submit the revision.

Repeat step 3 until the plan is approved. Do not begin any implementation until you receive an approval.
