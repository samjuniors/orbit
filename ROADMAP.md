# ORBIT Worker roadmap
Append-only. Finished phases are not deleted or rewritten -- new asks become new substeps or a later phase. Each phase is a gate: it gets reviewed before the next one starts.

## Phase 0 -- Core loop (done, 0.1.0)
- Discovery, Linear OAuth/API key, worktree execution, autonomy tiers + permissions, git/gh guard, implement->verify->fix-retry gate loop, resume, schedule.

## Phase 1 -- Process baseline (done, 0.2.0)
- Git history + semantic versioning (this change). `ROADMAP.md`, `docs/ROADMAP-PATTERN.md`, `docs/TASK-TEMPLATE.md`.

## Phase 2 -- Scope decision on connectors (OPEN -- needs a decision, not yet built on)
- `src/core/github.js`, `notion.js`, `obsidian.js` and their IPC wiring exist in the codebase but their product scope hasn't been confirmed against the "small tray bridge" goal.
- Decide: (a) keep as alternate task sources alongside Linear, (b) trim to the minimum needed for one real use case, or (c) remove for now and revisit later.
- Until decided, treat these as present-but-unconfirmed, not part of the supported surface.

## Phase 3 -- Reliability gaps (OPEN, not yet built)
- Stall detection (no-output timeout shorter than the full run timeout).
- Structured progress from the agent CLI's stream-json output instead of a raw log.
- Visible retry/attempt counter per task.
- Fix: schedule currently overrides a manual stop within its own window.

## Phase 4 -- Real Windows validation (OPEN, blocks a real release)
- First real run against a disposable repo + Linear team, per the earlier "first run" checklist.
- Signed installer / SmartScreen.

<!-- New asks: append a new phase or a substep under an open phase above. Don't edit closed phases. -->
