# ORBIT roadmap
Append-only: finished phases are never rewritten; new asks become new phases or substeps.

## Done
- 0.1 tray worker (Linear) - now `apps/tray`
- 0.2 git history, versioning, process docs
- 0.3 headless engine + CLI (see CHANGELOG)

## 0.4 "Adapters you can trust" (done: canary test, listing, terminal UI; remaining items moved to 0.4.x)
- (0.4.x) Adapter capability model (json events, session resume, sandbox).
- `orbit adapter test <agent>`: a conformance suite of tiny canary tasks (write a file, fail verify then pass, stall, rate-limit text) so any adapter can be checked on the user's own machine.
- (0.4.x) Public compatibility matrix in the README, filled by users' `adapter test` reports.
- (0.4.x) Parse structured agent output (stream-json) for live progress and rate-limit detection.
- First real runs against Claude Code, Codex, Antigravity, OpenCode, Grok Build; fix flags.

## 0.5 "Where people already are" (skill, MCP, add: done in 0.5.0; plugin marketplace packaging, notifications and Linear/GitHub import remain)
- Skill/plugin wrappers (Claude Code plugin, Codex skill, `AGENTS.md` snippet) that let you say "run orbit on this plan" from inside the agent, and install in one line.
- Small stdio MCP server: `orbit_status`, `orbit_report`, `orbit_add_task`, `orbit_approve`, `orbit_reject`.
- Notifications (ntfy/Telegram/webhook command) for "needs you" and "done".
- Task sources as import adapters: Linear and GitHub Issues -> PLAN.md.

## 0.6/0.7 "No Node required" (0.7.0: `build:exe` shipped, untested on Windows; code signing, installer, schedule windows, budgets, tray remain) (guided `orbit setup` and the Windows install script shipped in 0.6.0; executables, schedule windows, budgets, tray remain)
- Single-file executables (Node SEA) for Windows/macOS/Linux attached to releases.
- Schedule windows (`--between 09:00-18:00`), spend/time budgets.
- Tray rebuilt as a thin shell over the engine.

## Not planned
- A built-in planner/"decision engine". Plans stay human-written (or written by any planning tool).

## Delivery status correction — 2026-10-21

This section is an append-only status update. The phase notes above are retained as historical planning context; where their parenthetical status text conflicts with this section, this newer delivery record is authoritative.

### Delivered
- **Structured agent output:** implemented and merged. ORBIT normalizes supported Antigravity JSONL events into initialization, progress, and terminal-result events; structured failure and rate-limit signals are integrated with the engine. See the implementation in `src/engine/structured-output.js` and `tests/structured-output.test.js`.
- **Windows executable and installer certification:** completed for the published `v0.7.0` baseline. Hosted Windows certification covers CLI/Inno Setup installation, launch, same-version reinstall, uninstall, deferred executable replacement and rollback, plus the legacy desktop/tray installer lifecycle.
- **Cross-platform engine CI:** Ubuntu, Windows, and macOS checks pass on Node 20 and 22.
- **README product positioning:** updated to describe ORBIT as a local control plane for coding agents, with its workflow, architecture, supported integrations, and explicit limitations.

### Still open or deliberately deferred
- **Adapter compatibility matrix:** the README documents adapter options, but a user-reported, evidence-backed compatibility matrix is still pending. Adapter availability must not be read as a guarantee that every vendor CLI version or unattended mode is compatible.
- **Additional adapter canaries and vendor flag maintenance:** continue validating adapters against their current CLI versions and update behavior as vendors change.
- **Notifications and task-source imports:** ntfy/Telegram/webhook notifications and Linear/GitHub issue import remain unimplemented roadmap items unless separately delivered and verified.
- **Marketplace packaging:** distribution through agent/plugin marketplaces remains pending.
- **Cross-version upgrade certification:** deferred until a subsequent release exists. Since `v0.7.0` is the first published release, there is no earlier supported release to upgrade from. On the next release, certify `v0.7.0` → next version and verify executable version, user-data preservation, and rollback/recovery. Same-version reinstall is not an upgrade test.
- **Cross-platform standalone executables:** Windows executable/installer certification does not establish macOS or Linux standalone packaging. Those targets remain pending unless separately built and certified.
- **Schedule windows and provider spend/time budgets:** remain roadmap items; ORBIT does not currently promise provider-spend metering or a guaranteed dollar budget.

### Scope and product boundaries
- ORBIT executes one task at a time and expects plans to be decomposed into bounded, verifiable tasks.
- Worktree isolation is a workflow boundary, not a security sandbox. It does not prevent an agent from accessing credentials, absolute paths, or external services available to its process.
- A successful configured verification command is evidence that the command passed; it does not prove the command provides sufficient test coverage.
