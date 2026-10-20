# Policy reference (`orbit.policy.json`)

Every field is optional except what your agent needs. Unknown rule names and invalid values are errors, not silently ignored.

| Field | Default | Meaning |
|---|---|---|
| `agent` | `claude-code` | `claude-code`, `codex`, `antigravity`, `opencode`, `grok`, or `generic` |
| `agentArgs` | `[]` | Extra flags for the agent (permission modes, tool allow-lists). Passed before the prompt. |
| `agentCommand` | - | For `generic`: array like `["mycli","--prompt","{prompt}"]`. `{prompt}` is replaced; the prompt is also in `$ORBIT_PROMPT_FILE`. |
| `agentPath` | - | Full path to the agent binary if it is not on `PATH`. |
| `verify` | `null` | Command run in the worktree after each attempt (`npm test`). Required unless `allowUnverified`. |
| `allowUnverified` | `false` | Accept "agent exited cleanly" as done. The report will warn. |
| `allowNoChanges` | `false` | If false, an attempt that changes nothing counts as a failure. |
| `baseBranch` | `HEAD` | What the run branch starts from. |
| `approval` | `none` | `each-task`: commit, then wait for `orbit approve`/`reject`. |
| `onBlocked` | `stop` | `skip` continues with later tasks after one is blocked (use only for independent tasks). |
| `limits.maxAttempts` | 3 | Attempts per task before it is blocked. |
| `limits.taskTimeoutMin` | 30 | Hard limit for one agent run. |
| `limits.stallMin` | 10 | Kill an agent with no output for this long. |
| `limits.verifyTimeoutMin` | 10 | Hard limit for the verify command. |
| `limits.maxTasks` | 0 | Stop after N finished tasks this invocation (0 = no limit). |
| `limits.maxRuntimeMin` | 0 | Stop starting new tasks after this long (0 = no limit). |
| `limits.rateLimitWaitMin` / `maxRateLimitWaits` | 30 / 6 | Wait and retry (not counted as an attempt) when the agent output looks like a rate/usage limit. |

## Rules

`rules` maps an action to `allow` or `block`:

| Action | Default | Notes |
|---|---|---|
| `git.push` | block | Force-push, `--delete`, `+ref`, `:ref` and `--mirror` are blocked even when push is allowed. |
| `git.merge` | block | Also covers `git pull`. |
| `pr.create` | block | `gh pr create`. `gh pr merge`, `gh release`, `gh api`, `gh workflow run`, `gh repo delete` are always blocked. |
| `git.force-push`, `deploy` | block | **Locked**: setting them to `allow` is an error. |

`approve` is rejected as a rule value on purpose: an unattended agent cannot wait for you mid-command. Use `approval: "each-task"` for a human checkpoint between tasks.

## How the guard works, and where it stops

Each agent run gets a temp directory first on `PATH` containing `git` (and `gh` if found) shims. The shim parses the command (skipping global options such as `-C dir`, refusing `-c alias.*`) and either exits `17` with a message or forwards to the real binary. It is hardening, not isolation. It cannot stop an absolute-path call, a web API call, or a deploy tool it doesn't know about. For real isolation run the agent in a container/VM or an account with no push or deploy credentials.
