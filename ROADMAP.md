# ORBIT roadmap
Append-only: finished phases are never rewritten; new asks become new phases or substeps.

## Done
- 0.1 tray worker (Linear) - now `apps/tray`
- 0.2 git history, versioning, process docs
- 0.3 headless engine + CLI (see CHANGELOG)

## 0.4 "Adapters you can trust" (next)
- Adapter capability model (headless, json events, permission modes, session resume, sandbox).
- `orbit adapter test <agent>`: a conformance suite of tiny canary tasks (write a file, fail verify then pass, stall, rate-limit text) so any adapter can be checked on the user's own machine.
- Public compatibility matrix in the README, filled by users' test reports.
- Parse structured agent output (stream-json) for live progress and rate-limit detection.
- First real runs against Claude Code, Codex, Antigravity, OpenCode, Grok Build; fix flags.

## 0.5 "Where people already are"
- Skill/plugin wrappers (Claude Code plugin, Codex skill, `AGENTS.md` snippet) that let you say "run orbit on this plan" from inside the agent, and install in one line.
- Small stdio MCP server: `orbit_status`, `orbit_report`, `orbit_add_task`, `orbit_approve`, `orbit_reject`.
- Notifications (ntfy/Telegram/webhook command) for "needs you" and "done".
- Task sources as import adapters: Linear and GitHub Issues -> PLAN.md.

## 0.6 "No Node required"
- Single-file executables (Node SEA) for Windows/macOS/Linux attached to releases.
- Schedule windows (`--between 09:00-18:00`), spend/time budgets.
- Tray rebuilt as a thin shell over the engine.

## Not planned
- A built-in planner/"decision engine". Plans stay human-written (or written by any planning tool).
