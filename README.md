# ORBIT

**Give your coding agent a plan, go away, come back to verified work.**

ORBIT runs a plain-markdown plan through the coding agent you already use (Claude Code, Codex, Antigravity, OpenCode, Grok Build, or any CLI). One small task per fresh agent session, in an isolated git worktree, checked by *your* tests before it counts as done. It stays inside limits you set, survives crashes and reboots, and leaves a report instead of a mystery.

```
$ orbit run
[orbit] New run: working on branch orbit/todo-app-mvge9sd8.
[orbit] T1 attempt 1/3: running claude-code
[orbit] T1: verification passed.
[orbit] T1 done (78789882).
[orbit] T2 attempt 1/3: running claude-code
[orbit] T2: verification failed.            <- the failure is fed back to the agent
[orbit] T2 attempt 2/3: running claude-code
[orbit] T2: verification passed.
[orbit] Run done. Report: .orbit/report.md
```

> **Status: v0.5.0, early.** The engine is tested (29 engine tests on Linux, including real git, a pseudo-terminal check of the live display, and a scriptable fake agent), but it has **not yet been run against the real agent CLIs or on Windows/macOS**. Adapter flags come from vendor docs; prove yours with `orbit adapter test <agent>`. See [Honest limits](#honest-limits).

## Why

Unattended agents fail in boring, expensive ways: they stall on a prompt nobody answers, loop on a failing step, hit a rate limit at 2am and sit there, report "done" when it isn't, or push something you never approved. The vendor apps solve some of this for their own agent. ORBIT is the small, local, open-source layer that works the same for *any* agent CLI:

| Problem | What ORBIT does |
|---|---|
| "Done" that isn't | A task only counts when **your** `verify` command passes. No verify command = it refuses to run (unless you opt out, and the report says so). |
| Agent stalls on a question | Told it is non-interactive; if it goes silent for `stallMin` it is killed and retried with context. |
| Failing loops | Retry cap per task, task timeout, run-time cap, task cap. Failures are fed back, not repeated blindly. |
| Rate / usage limits | Detects them, waits, retries **without** burning an attempt. |
| Crash, reboot, closed lid | State is saved atomically after every step. `orbit run` again resumes in the same worktree. |
| Pushes, merges, PRs you didn't want | Blocked by default via a command guard on the agent's `PATH`. Force-push and deploys can never be enabled. |
| Reviewing a pile of changes | One commit per task on its own branch, a report with proof, optional approval after every task. |
| Context rot over many days | Each task starts a fresh session; continuity comes from the plan, the git history and short notes. |

## Quick start (first run, safe)

Needs Node 20+, git, and one coding-agent CLI that is installed and signed in. Not on npm yet:

1. **Install:** `git clone <this repo> && cd orbit && npm link` (gives you the `orbit` command).
2. **Go to a project:** `cd your-project` (any git repo with at least one commit; try a throwaway one first).
3. **Not sure what to do?** Type `orbit`. It looks at the folder and tells you the one next step, every time.
4. **Set up:** `orbit init`, then open `orbit.policy.json` and set `"agent"` and `"verify"` (the command that proves work is good, e.g. `npm test`).
5. **Prove your agent works unattended:** `orbit adapter test claude-code` (use your agent's name; `orbit adapters` lists them). It runs one tiny real task in a throwaway folder and tells you what to fix if it stalls on a permission prompt.
6. **Write the plan:** edit `PLAN.md`. One checkbox per task, small enough to verify.
7. **Preview:** `orbit run --dry-run` prints the exact prompt the agent would get. Nothing runs.
8. **Run:** `orbit run`. A short live checklist shows progress. If something needs you, it becomes one card telling you what to do (approvals can be answered right there with `y`/`n`).
9. **Come back later:** `orbit` shows where things stand, `orbit report` shows what passed with proof. Your own checkout was never touched; merge the `orbit/...` branch when you're happy.

If your computer sleeps or crashes mid-run, run `orbit run` again: it resumes in the same worktree. Use `--plain` for ordinary log lines (CI, logs).

`PLAN.md` is just markdown ([format](docs/WRITING-TASKS.md)):

```markdown
# Todo app
Stack: TypeScript + Vite, vitest for tests. Keep components small.

- [ ] Scaffold the project
  Vite + TS, one passing smoke test, `npm test` works.
- [ ] Data model and storage
  Todo type, add/toggle/delete functions in src/todos.ts, unit tested.
- [ ] List UI
  Render todos, add form, toggle checkbox. No styling yet.
```

Append tasks any time, even mid-run; they are picked up. Nothing is ever deleted from your plan.

## Commands

`orbit` (what next?) · `init` · `doctor` · `adapters` · `adapter test <agent>` · `run [--dry-run] [--plain] [--verbose]` · `status` · `report` · `add "title"` · `approve <id>` · `reject <id> "why"` · `mcp` · `install-skill`. Exit codes: `0` all done, `2` a task needs you, `3` stopped by a limit, `1` error.

## Policy (`orbit.policy.json`)

```json
{
  "agent": "claude-code",
  "agentArgs": ["--allowedTools", "Edit,Bash(npm test)"],
  "verify": "npm test",
  "approval": "none",
  "limits": { "maxAttempts": 3, "taskTimeoutMin": 30, "stallMin": 10, "maxTasks": 0, "maxRuntimeMin": 480 },
  "rules": { "git.push": "block", "git.merge": "block", "pr.create": "block" }
}
```

Set `"approval": "each-task"` and ORBIT commits each task, then waits for `orbit approve T1` or `orbit reject T1 "why"` (the agent gets your feedback). Full reference: [docs/POLICY.md](docs/POLICY.md). Supported agents and how to add one: [docs/ADAPTERS.md](docs/ADAPTERS.md).

## Use it from inside your agent

`orbit install-skill` adds an ORBIT skill for Claude Code (`--global` for every project, `--agents-md` for Codex-style agents), and `orbit mcp` is an MCP server so an assistant can check progress, add tasks and relay your approvals. An agent that ORBIT itself launched can never approve its own work. Setup and safety notes: [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).

## How it works

1. Parse `PLAN.md`; create a worktree + branch under `.orbit/` (your checkout is never touched).
2. For the next task: build a prompt (plan context, finished tasks, short notes, the task, the rules), run the agent with a guard on `PATH`, in a fresh session.
3. Check the agent changed something, run `verify`. Fail → retry with the failure in the prompt. Pass → commit, tick the plan in the worktree.
4. Repeat until done, blocked (needs you), or a limit is hit. Write `.orbit/report.md`.

All state lives in `.orbit/state.json` (git-ignored). No daemon, no account, no network calls of its own.

## Honest limits

- **Not a sandbox.** The command guard blocks `git push/merge/pull`, `gh pr/release/api/...` and aliases that disguise them, but an agent can still call a binary by absolute path or use a web API with credentials it can find. Use the agent's own permission settings, and don't leave deploy/push credentials where it can reach them. "Deploy blocked" is enforced by the prompt and the git/gh guard only.
- **Verification is only as good as your tests.** ORBIT proves "your command passed", not "the feature is right". Weak tests, weak proof.
- **Agent flags are unverified on real machines** (see status above). `orbit adapter test` checks them on yours; use `agentArgs` or the `generic` adapter to adjust.
- **No true session memory.** A resumed task starts a new session and is told what happened; it reads the files. Keep tasks small.
- **Cost is not metered.** You get attempt, time and task caps, not dollar caps.
- Sequential only: one task at a time per project.

## Repo layout

`bin/orbit.js` CLI · `src/engine/` the engine (zero dependencies) · `tests/` · `docs/` · `apps/tray/` the older Windows tray app (Linear-driven, v0.2 behavior, to be rebuilt on this engine; see [ROADMAP](ROADMAP.md)).

MIT licensed. Contributions welcome, especially agent adapters and Windows/macOS test reports.
