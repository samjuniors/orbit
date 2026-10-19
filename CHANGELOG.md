# Changelog
All notable changes to ORBIT Worker are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versioning is [SemVer](https://semver.org/) (MAJOR.MINOR.PATCH) once this leaves preview.

## [Unreleased]
- Nothing yet.

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
