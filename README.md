# ORBIT

**A local control plane for coding agents.**

Turn a project plan into a sequence of small, isolated, verifiable coding tasks. ORBIT coordinates the agent you already use, runs your verification command, manages retries and resumable progress, and keeps consequential Git actions behind explicit policy.

Instead of handing an agent a huge request and hoping for the best, give ORBIT a Markdown plan. It runs one task at a time in a dedicated Git worktree, checks the result against your command, records what happened, and tells you when it needs a human decision.

[![CI](https://github.com/samjuniors/orbit/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/samjuniors/orbit/actions/workflows/ci.yml)
[![Windows certification](https://github.com/samjuniors/orbit/actions/workflows/windows-certification.yml/badge.svg?branch=main)](https://github.com/samjuniors/orbit/actions/workflows/windows-certification.yml)
[![Latest release](https://img.shields.io/github/v/release/samjuniors/orbit)](https://github.com/samjuniors/orbit/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **Project status:** early preview. ORBIT is actively evolving. Review the [known limitations](#boundaries-and-limitations) and verify your chosen agent locally before unattended use.

## The problem ORBIT solves

Coding agents are capable, but long-running work is difficult to supervise reliably. A large task can lose context, stall on an interactive prompt, repeat a failed approach, hit usage limits, or claim completion without passing the project's tests.

ORBIT adds an execution loop around the agent:

| Concern | ORBIT's approach |
|---|---|
| Oversized requests | Break work into explicit Markdown tasks with checkable acceptance criteria. |
| Risk to the current checkout | Run work in an isolated Git worktree and task branch. |
| Unverified completion | Run the project's configured verification command; a task does not pass just because the agent says it is done. |
| Stalls and repeated failures | Apply per-task timeouts, output-stall detection, bounded retries, and failure feedback. |
| Usage limits | Recognize supported rate-limit signals and wait/retry within configured limits. |
| Lost progress | Persist run state and resume the same worktree after interruption. |
| Unreviewed changes | Keep push, merge, and PR creation blocked by default; optionally pause for human approval after each task. |
| Long sessions and context drift | Start a fresh agent session for each task and carry forward concise project/task context. |
| Unclear outcomes | Write a report with task status, attempts, verification results, and blockers. |

## How it works

1. **Describe the work.** Write a `PLAN.md` with small tasks and concrete definitions of done.
2. **Configure the agent and policy.** Choose an installed agent CLI, its arguments, a verification command, approval behavior, and execution limits.
3. **Preview the next task.** `orbit run --dry-run` shows the prompt without launching the agent.
4. **Execute in isolation.** ORBIT creates or resumes a dedicated worktree and starts a fresh agent process for the next unfinished task.
5. **Verify the result.** ORBIT checks for changes and runs your verification command. Failures are returned to the agent within the retry limit.
6. **Review and continue.** Depending on policy, ORBIT commits a verified task or waits for your approval. It repeats until the plan is complete, blocked, or a limit is reached.
7. **Inspect the evidence.** Use `orbit status` and `orbit report`; the detailed report is saved under `.orbit/`.

```text
PLAN.md
   |
   v
ORBIT policy + limits
   |
   v
Isolated Git worktree
   |
   v
Fresh coding-agent session
   |
   v
Project verification command
   |
   +---- failed ----> bounded retry with failure context
   |
   +---- passed ----> commit / human approval checkpoint
   |
   v
Next task or final report
```

## Quick start

### Requirements

- Node.js 20 or newer for source/Node installation.
- Git.
- At least one supported coding-agent CLI installed and authenticated.
- A project verification command (for example, `npm test`, `pytest`, or a project-specific script). Verification is required unless you explicitly enable unverified completion.

### Install

**Windows:** run `scripts/install-windows.cmd` from a checkout.

**Node.js installation:** from the repository root:

```bash
npm link
```

Or run the CLI directly with `node /path/to/orbit/bin/orbit.js`.

**Standalone Windows downloads:** choose the CLI installer, standalone executable, or desktop package from [GitHub Releases](https://github.com/samjuniors/orbit/releases/latest). These are separate products; see [Windows certification](docs/WINDOWS-CERTIFICATION.md) for exactly what is tested.

### Set up a project

Open a terminal in the project you want ORBIT to coordinate:

```bash
orbit setup
```

The guided setup helps select an agent, configure verification and review behavior, and create a starter `PLAN.md` and `orbit.policy.json`. Then:

```bash
orbit doctor
orbit run --dry-run
orbit run
```

Use a throwaway project for your first run. ORBIT does not modify your original checkout during task execution; work happens in its managed worktree.

If the computer sleeps, the terminal closes, or a run is interrupted, invoke `orbit run` again to resume. Inspect progress with:

```bash
orbit status
orbit report
```

## Write a good plan

A plan is ordinary Markdown. Each checkbox should describe one independently verifiable task.

```markdown
# Example: small web application

Stack: TypeScript, Vite, and Vitest.

- [ ] Create the application skeleton
  Set up Vite and TypeScript. Add one passing smoke test.

- [ ] Implement the data model
  Add the item type and create, update, and delete functions.
  Cover each function with unit tests.

- [ ] Build the list interface
  Render items and add a form. Verify the main interaction.
```

Keep tasks small enough to complete and verify in one focused agent session. Include constraints, relevant files, acceptance criteria, and the exact command that proves the work. See [Writing tasks that finish](docs/WRITING-TASKS.md).

Tasks can be appended while a run is in progress. ORBIT preserves completed plan entries; it does not silently remove tasks.

## Agents and integrations

ORBIT launches command-line agents through adapters. The built-in adapter list currently includes:

| Adapter | CLI |
|---|---|
| Claude Code | `claude` |
| OpenAI Codex | `codex` |
| Antigravity | `agy` / `antigravity` |
| OpenCode | `opencode` |
| Grok Build | `grok` |
| Generic | Your configured command |

**Adapter availability is not a blanket compatibility guarantee.** CLI flags and unattended permissions change between vendor versions. Run `orbit doctor`, inspect the agent's current help, and use:

```bash
orbit adapters
orbit adapter test <agent>
```

The adapter test runs a small real task on your machine. It uses your agent's quota. See [Adapters](docs/ADAPTERS.md).

ORBIT can also be operated from an AI assistant:

- **Claude Code skill:** `orbit install-skill`
- **AGENTS.md integration:** `orbit install-skill --agents-md`
- **MCP server:** `orbit mcp` exposes tools for next step, status, report, adding tasks, and human approval/rejection.

See [Integrations](docs/INTEGRATIONS.md).

## Policy and human control

The project-level `orbit.policy.json` controls the agent, verification, approval mode, limits, and guarded Git actions.

Example:

```json
{
  "agent": "claude-code",
  "agentArgs": ["--allowedTools", "Edit,Bash(npm test)"],
  "verify": "npm test",
  "approval": "each-task",
  "limits": {
    "maxAttempts": 3,
    "taskTimeoutMin": 30,
    "stallMin": 10,
    "maxTasks": 0,
    "maxRuntimeMin": 480
  },
  "rules": {
    "git.push": "block",
    "git.merge": "block",
    "pr.create": "block"
  }
}
```

With `approval: "each-task"`, ORBIT pauses after a task is verified and committed. A person can then run `orbit approve T1` or `orbit reject T1 "reason"`.

Push, merge, and PR creation are blocked by default. Force-push and deploy permissions are locked. See the complete [Policy reference](docs/POLICY.md).

## Commands

| Command | Purpose |
|---|---|
| `orbit` | Show the single next action for this project. |
| `orbit setup` | Guided project setup. |
| `orbit init` | Create starter plan and policy files without prompts. |
| `orbit doctor` | Check Git, agent CLI, policy, plan, and verification setup. |
| `orbit adapters` | List supported adapters and detected CLIs. |
| `orbit adapter test <agent>` | Run a small real-world adapter check. |
| `orbit run --dry-run` | Preview the next agent prompt without execution. |
| `orbit run` | Execute or resume the plan. |
| `orbit status` | Show task and run status. |
| `orbit report` | Print the latest run report. |
| `orbit add "title"` | Append a task to the plan. |
| `orbit approve <id>` / `orbit reject <id> "why"` | Record a human review decision. |
| `orbit mcp` | Start the stdio MCP server. |
| `orbit install-skill` | Install the Claude Code skill. |
| `orbit update` | Check for and install an ORBIT update. |

Global options include `--dir`, `--plan`, `--policy`, `--plain`, `--verbose`, and `--yes`. Run `orbit --help` for the current CLI reference.

Exit codes: `0` completed, `2` a task needs you or an update is available, `3` stopped by a configured limit, `1` error.

## Windows packages

The repository currently provides three distinct Windows deliverables:

- **CLI installer:** Inno Setup package for the ORBIT command-line engine, including PATH integration and an uninstaller.
- **Standalone CLI executable:** a Node Single Executable Application with the Node runtime bundled; Git and a coding agent are still required.
- **Legacy desktop/tray application:** a separate Electron/NSIS application with its own package and lifecycle. It is not the same application as the current CLI engine.

Build instructions: [Building the executable and installer](docs/BUILDING-EXE.md). Test boundaries and evidence: [Windows certification](docs/WINDOWS-CERTIFICATION.md).

## Architecture and repository map

```text
bin/                 CLI entry point
src/engine/          orchestration, policy, adapters, process runner, state, reports, MCP
scripts/             test discovery, bundling, installers, release validation
tests/               CLI/engine tests
integrations/        assistant skill and integration assets
docs/                user and maintainer documentation
apps/tray/           separate legacy Electron desktop/tray application
.github/workflows/   cross-platform CI, Windows certification, release automation
```

The core engine is JavaScript and uses Node built-ins for its orchestration path. The CLI runs locally; ORBIT does not require an ORBIT-hosted account or orchestration service. Agent CLIs and optional update checks may use their own network connections.

## Boundaries and limitations

ORBIT is an orchestration layer, **not a security sandbox**.

- The command guard blocks supported Git/GitHub command paths, but cannot prevent an agent from invoking an executable by absolute path, using credentials directly, or calling an external API. For stronger isolation, use a container or VM and do not expose credentials the agent should not have.
- Verification proves that your configured command passed. It does not prove that the feature is correct if the tests are incomplete.
- Adapter flags and unattended permission modes vary by vendor and version. Test the adapter on the machine where you intend to run it.
- Each task starts a fresh agent session. ORBIT carries context forward through the plan, Git history, and task notes; it is not persistent model memory.
- Limits cover attempts, elapsed time, stalls, and task count. ORBIT does not meter provider spend or guarantee a dollar budget.
- Execution is sequential: one task at a time per project.

Read [Policy](docs/POLICY.md) before running unattended work.

## Development

```bash
npm test
npm run check
npm run test:tray
```

Windows-specific build and certification details are in [docs/WINDOWS-CERTIFICATION.md](docs/WINDOWS-CERTIFICATION.md). For contribution-sized changes, include focused tests and keep each pull request scoped to one independently reviewable improvement.

## Project documents

- [Changelog](CHANGELOG.md)
- [Roadmap](ROADMAP.md)
- [Writing effective plans](docs/WRITING-TASKS.md)
- [Agent adapters](docs/ADAPTERS.md)
- [Policy reference](docs/POLICY.md)
- [Assistant integrations](docs/INTEGRATIONS.md)
- [Windows certification](docs/WINDOWS-CERTIFICATION.md)
- [Executable and installer build](docs/BUILDING-EXE.md)

## License

ORBIT is released under the [MIT License](LICENSE).
