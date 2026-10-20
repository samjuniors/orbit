# Changelog
All notable changes to ORBIT Worker are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versioning is [SemVer](https://semver.org/) (MAJOR.MINOR.PATCH) once this leaves preview.

## [Unreleased]
- Nothing yet.

## [0.4.0] - adapters you can trust, and a calmer terminal
### Added
- `orbit adapter test <agent>`: a real end-to-end canary (one tiny task, verified by a script) with plain-language failure hints; `orbit adapters` lists agents and what is installed.
- Adaptive terminal UI: a compact live checklist that collapses long plans, turns into a single "needs you" card with the next action, and takes approvals inline (`y`/`n`/details). Plain log lines for CI and pipes (`--plain`).
- `orbit` with no arguments: inspects the folder and prints the one thing to do next.
- Structured engine events (snapshot, phase, task-done, task-blocked, run-end) and an `io.ask` hook, so other front ends (tray, MCP) can drive the same engine.
- `docs/RELEASING.md`; `npm run release:patch|minor`.
### Known gaps
- Still never run against the real agent CLIs; `orbit adapter test` is how you find out on your machine.

## [0.3.0] - headless engine
### Added
- `orbit` CLI and zero-dependency engine (`bin/`, `src/engine/`): runs a markdown `PLAN.md` task by task through any coding-agent CLI, one fresh session per task, in an isolated git worktree.
- Verification gate (`verify` command), retry-with-feedback loop, per-task timeout, stall detection, rate-limit wait/retry, attempt/task/runtime caps.
- Crash-safe state (`.orbit/state.json`, atomic writes) and automatic resume; one-run-per-project lock; append-only plan (new tasks are picked up).
- Policy file (`orbit.policy.json`) with allow/block rules, optional per-task approval (`orbit approve|reject`), and a cross-platform git/gh command guard (parses global options such as `-C`, refuses alias overrides).
- Adapters: Claude Code, Codex, Antigravity, OpenCode, Grok Build, and a generic command adapter (flags unverified on real installs).
- Morning report (`.orbit/report.md`), `orbit doctor`, `orbit run --dry-run`.
- CI matrix (Linux/Windows/macOS, Node 20/22). 20 new engine tests with real git and a scriptable fake agent.
### Changed
- The Electron tray app moved to `apps/tray` (unchanged, still Linear-driven). Its installer workflow now runs on `tray-v*` tags only.
- README, docs rewritten around the engine. `docs/ROADMAP-PATTERN.md` removed; `docs/TASK-TEMPLATE.md` became `docs/WRITING-TASKS.md`.
### Known gaps
- Never run against the real agent CLIs; Windows/macOS untested beyond CI configuration.

## [0.2.0] - versioning + process baseline
### Added
- This changelog, `ROADMAP.md`, and `docs/TASK-TEMPLATE.md` (see below) — no code behavior changes.
### Notes
- This tag is the first point the project is tracked in git with real history instead of being passed around as a zip.

## [0.1.0] - initial preview
### Added
- Electron tray app; machine discovery (Node, npm, Git, Git Bash, GitHub CLI, Antigravity CLI, OpenCode CLI).
- Linear integration: OAuth (PKCE + loopback) and legacy API key, team/state configuration, polling.
- Per-task isolated Git worktree + branch; agent execution via Antigravity/OpenCode CLI.
- Autonomy tiers (Supervised/Delegated/Autonomous) and a 6-toggle permission model (claim, agent-run, comment, review-transition, push, PR, merge), daily cap, active-hours window.
- Process-level git/gh guard (PATH-interception wrapper) enforcing push/merge/PR permissions; deploy and force-push always blocked.
- Implement → Verify → fix-retry gate loop against an operator-supplied verification command, with a single "ready to finalize" approval gate.
- Resume for blocked tasks (reuses the existing worktree/branch).
- Start/stop schedule window (graceful — finishes an in-flight task before stopping).
- Notion, Obsidian and GitHub connector scaffolding (auth + resource listing) -- **scope under review, see ROADMAP.md**.
