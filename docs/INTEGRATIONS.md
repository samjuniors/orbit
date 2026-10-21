# Using ORBIT from inside your agent

You never need these: the CLI works on its own. They let you say "run this overnight" or "approve T2" to the assistant you already talk to.

## Claude Code skill
```bash
orbit install-skill              # this project  -> .claude/skills/orbit/SKILL.md
orbit install-skill --global     # every project -> ~/.claude/skills/orbit/SKILL.md
```
Restart the session so it is picked up. The skill tells the agent to start with `orbit` (no arguments), preview with `--dry-run`, never approve work it did itself, and to stay out of the way when `ORBIT_TASK_ID` is set (meaning ORBIT launched it).

## Other agents (Codex and similar)
`orbit install-skill --agents-md` appends a short ORBIT section to `AGENTS.md`, which those agents read.

## MCP server
`orbit mcp` serves these tools over stdio: `orbit_next`, `orbit_status`, `orbit_report`, `orbit_add_task`, `orbit_approve`, `orbit_reject`. Point your client at it, for example:

```bash
claude mcp add orbit -- orbit mcp --dir /path/to/your/project
```
or in a JSON config:
```json
{ "mcpServers": { "orbit": { "command": "orbit", "args": ["mcp", "--dir", "/path/to/your/project"] } } }
```
(Check your client's docs for the exact command; the server speaks plain JSON-RPC 2.0, one message per line.)

## Safety: who can approve
Approving work is the human checkpoint, so:
- Every agent ORBIT launches gets `ORBIT_AGENT_RUN=1`. `orbit approve`, `orbit reject`, `orbit add` and the matching MCP tools refuse to run when it is set, so an agent cannot approve its own task or rewrite its own plan through ORBIT.
- That is a guard rail, not a sandbox: an agent with raw filesystem access could still write files under `.orbit/`. Don't run agents with more access than you'd give a contractor, and keep approval on a person (`"approval": "each-task"`).
- When you use the MCP tools through a chat assistant, the assistant acts on your instruction. The skill tells it to confirm with you first.
