# Agents and adapters

| `agent` | Binary | Invocation used |
|---|---|---|
| `claude-code` | `claude` | `claude <agentArgs> -p <prompt>` |
| `codex` | `codex` | `codex exec <agentArgs> <prompt>` |
| `antigravity` | `agy` / `antigravity` | `agy <agentArgs> -p <prompt> --output-format stream-json` |
| `opencode` | `opencode` | `opencode run <agentArgs> --dir <worktree> --format json <prompt>` |
| `grok` | `grok` | `grok <agentArgs> -p <prompt>` |
| `generic` | your command | `policy.agentCommand`, with `{prompt}` substituted |

**Verify before trusting.** These come from vendor docs and earlier tool discovery, not from runs on a real install. Run `orbit doctor`, check `<agent> --help`, try `orbit run --dry-run`, then a one-task plan. Unattended mode usually needs permission flags (a tool allow-list or a non-prompting permission mode) or the agent will wait for approval and be killed by stall detection. Put those in `agentArgs`.

Every agent run also gets these environment variables: `ORBIT_TASK_ID`, `ORBIT_ATTEMPT`, `ORBIT_PROMPT_FILE`, `ORBIT_WORKTREE`.

## Adding an adapter

Use `generic` first:

```json
{ "agent": "generic", "agentCommand": ["mycli", "--yes", "--task-file", "$ORBIT_PROMPT_FILE"] }
```

(`$VARS` are not expanded by ORBIT, so for file input have a tiny wrapper script read `ORBIT_PROMPT_FILE`, or use `{prompt}`.) To add a built-in agent, add an entry to `ADAPTERS` in `src/engine/adapters.js` (label, binary names, argument builder), a row above, and a test. Pull requests welcome.
