# Changelog
All notable changes to ORBIT are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/). The CLI/engine release version follows the pre-1.0 policy in [docs/RELEASING.md](docs/RELEASING.md); the root package.json is canonical.

## [Unreleased]
- Add a CI-gated Windows release workflow with required-asset validation, SHA-256 checksums, and source-commit provenance.
- Verify standalone updater downloads against the HTTPS GitHub Release manifest (asset identity, size, and SHA-256) before installation; health-check replacements and preserve rollback backups.
- Document updater trust assumptions and recovery limitations in `docs/UPDATER-SECURITY.md`.

## [0.7.0] - single-file exe, agent upgrade prompts
### Added
- `npm run build:exe`: builds `dist/orbit.exe` (Node single-executable app) with a dependency-free bundler (`scripts/bundle.js`); smoke-tests the version and the git guard.
- `docs/UPGRADE-PROMPT.md`: a prompt for your coding agent to apply the newest patch(es) from a patch folder in version order, test, push a branch and open a PR (or merge and tag).
- `docs/BUILD-EXE-PROMPT.md` and `docs/BUILDING-EXE.md`.
### Changed
- The git/gh guard shims re-launch ORBIT through a hidden `__guard` command instead of a script path, so they work from the packaged exe. The skill text is embedded as an exe asset.
### Known gaps
- The exe inject step (`postject`) and the final exe are untested on Windows by the author; unsigned exes may trigger SmartScreen.

## [0.6.0] - guided setup
### Added
- `orbit setup`: a five-step guided wizard (git, agent, test command, review style, first task) that writes `orbit.policy.json` and `PLAN.md`, keeps settings you already customised, never overwrites an existing plan, and can run the adapter test at the end. `--yes` accepts defaults (and refuses if no test command can be detected).
- Test-command detection from project files (npm, Go, Cargo, pytest).
- `scripts/install-windows.cmd`: checks Node and git, then installs the `orbit` command.
- `orbit` with no plan now points to `orbit setup`.
### Known gaps
- Still no single-file executable or tray; the real agent CLIs are still unrun.

## [0.5.0] - use it from your agent
### Added
- `orbit mcp`: a zero-dependency MCP server over stdio with tools to read next step, status and report, append tasks, and approve/reject.
- `orbit install-skill` (project or `--global`) installs a Claude Code skill; `--agents-md` adds a short ORBIT section to AGENTS.md. Skill source in `integrations/`.
- `orbit add "title" [details]`: append a task from the command line.
- Self-approval protection: agents launched by ORBIT run with `ORBIT_AGENT_RUN=1`; approve, reject and add-task refuse to run in that environment (CLI and MCP).
- `docs/INTEGRATIONS.md`.
### Known gaps
- MCP server and skill are tested against a simulated client and the documented file format, not yet against every real client.

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
