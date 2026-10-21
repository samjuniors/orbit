---
name: orbit
description: Hand a multi-step build to ORBIT to run unattended with verification, check on a run, review and approve finished work, or add a task to PLAN.md. Use when the user wants to leave work running, asks "where are we", or asks to approve/reject a task.
---

# ORBIT

ORBIT (`orbit` CLI) runs the checkboxes in `PLAN.md` through the user's coding agent, one task per fresh session, in a git worktree, verified by the project's own test command. Use it instead of doing a long multi-task job yourself in one session.

**If the environment variable `ORBIT_TASK_ID` is set, ORBIT launched you. Do not use this skill; just do your task.**

## What to do
1. Run `orbit` with no arguments first. It prints the one next step for this folder.
2. No plan yet: `orbit init`, then help the user write small, verifiable tasks in `PLAN.md` (one checkbox each, with acceptance criteria) and set `"verify"` in `orbit.policy.json`.
3. Before the first run on a machine: `orbit adapter test <agent>` (uses a little quota; ask first).
4. Preview with `orbit run --dry-run`. Start with `orbit run` only when the user says to; it can take a long time, so tell the user it will run in that terminal.
5. Check progress with `orbit status`; results with `orbit report`.
6. Add a task with `orbit add "title" "optional details"` (appends only; never rewrite finished tasks).

## Rules
- **Never run `orbit approve` or `orbit reject` on your own initiative, and never for work you did.** Show the user the task's commit and summary and let them decide; run it only when they say so.
- Never edit `.orbit/` files by hand or push, merge or deploy for the user; ORBIT blocks those by design.
- A blocked task needs the user's judgment: show the error from `orbit` and ask what to change.
