# ORBIT Windows Worker

Windows tray runtime for ORBIT — Workspace Orchestrator. It discovers local tools and repositories, connects to a Linear team queue, and delegates explicitly queued tasks to Antigravity CLI (`agy`) or OpenCode CLI in isolated Git worktrees.

> **Preview 0.1.0:** Source release only. The Windows installer must be built and pass the GitHub Actions workflow before it is considered installable. This release has not been validated on the user's Windows machine.

## Features
- Electron system-tray application; closing the dashboard hides it.
- First-run discovery of Node.js, npm, Git, Git Bash, GitHub CLI (optional), Antigravity CLI and OpenCode CLI.
- Checks agent CLI versions and headless-mode capabilities before offering selection.
- Searches common project folders for Git repositories and supports folder selection.
- Connects to Linear via OAuth (recommended) or a legacy personal API key.
- Polls a configured Linear team for issues in an exact ready-state name.
- Three autonomy tiers and a fine-grained permission model (below), enforced both in the prompt and, for push/merge/PR, by a process-level wrapper.
- Creates a separate Git worktree and branch per task.
- Runs Antigravity with `agy -p` or OpenCode with `opencode run`.
- Posts a result comment and moves successful tasks to a configured Review state (each independently toggleable).
- Shows Windows notifications and continues polling for the next eligible task.
- Encrypts all Linear credentials (API key, OAuth client secret, access/refresh tokens) using Electron safeStorage on the local machine.

## Connecting Linear
**OAuth (recommended).** In Linear, go to Settings → API → OAuth applications and create an application with redirect URI `http://127.0.0.1:53791/orbit/oauth/callback` (ORBIT shows this exact value in the Linear connection panel — it's a fixed local port and path, not random, because OAuth redirect URIs must match exactly what's registered). Paste the application's Client ID and Client Secret into ORBIT and click **Connect with Linear**; your system browser opens Linear's consent screen, and ORBIT receives the authorization code on that local port only — no credentials pass through the app's own UI. OAuth 2.0 PKCE (RFC 7636) is enforced using SHA-256 (`S256`): a high-entropy cryptographically random `code_verifier` is generated in memory for each authorization attempt, and its SHA-256 Base64URL-encoded `code_challenge` (`code_challenge_method=S256`) is sent in the authorization request. When Linear redirects back to the loopback callback, the OAuth `state` parameter is validated before processing either an authorization code or error to prevent CSRF and state injection. The `code_verifier` is held in memory and supplied in the token exchange request (`code_verifier`) alongside the client secret as defense in depth. ORBIT stores the resulting access and refresh tokens encrypted using Electron safeStorage and refreshes the access token automatically before it expires.

**Legacy API key.** Still supported for compatibility or headless setups where running an OAuth app isn't practical. A personal API key never expires and isn't scoped the way an OAuth token is, so OAuth is the better default where you can use it.

## Autonomy and permissions
ORBIT ships in **Supervised** mode by default: it claims an eligible issue (moves it to In Progress, so nothing else double-picks it) and then waits in the **Pending approval** panel for you to **Approve & run** or **Reject** before the coding agent actually executes. Rejecting leaves the issue claimed with an explanatory comment, for manual follow-up, rather than silently reverting or abandoning it.

**Delegated** and **Autonomous** both claim and run automatically, without a per-task approval step. Delegated still respects the daily task cap and active-hours window below; Autonomous ignores both.

Independent of autonomy tier, six toggles scope exactly what the worker may do:
- **Allow claim** — move an eligible issue to In Progress at all.
- **Allow agent run** — master switch for actually invoking the agent CLI (claim without run is useful as a "reserve it, I'll do it myself" mode).
- **Allow comment** — post the result/summary (or block/failure reason) back to Linear.
- **Allow review transition** — move a successfully finished task to the Review state.
- **Allow push / Allow pull request / Allow merge** — see "Push, merge and PR enforcement" below.

A daily task cap and an optional active-hours window further restrict *when* Delegated mode is allowed to pick up new work. None of this is just UI decoration — `src/core/worker.js` and `src/core/permissions.js` enforce it: with "Allow agent run" off, the worker will claim and leave a note, but never touch the worktree or invoke the CLI.

## Push, merge and PR enforcement
Deployment and force-push are **always** blocked — there is no setting that enables either. Push, merge, and PR creation are off by default and, when toggled on, are enforced two ways:
1. **Prompt-level.** The agent's instructions state the current permission settings explicitly and tell it that any attempt outside them will fail.
2. **Process-level.** Each task run gets a temporary directory, prepended to the agent subprocess's `PATH`, containing a `git.cmd` (and `gh.cmd`, if GitHub CLI was detected) wrapper that intercepts `push`/`merge`/`gh pr create`/`gh pr merge`/`gh release`/`gh workflow run`/`gh repo delete` and refuses the ones your settings don't allow, forwarding everything else to the real executable.

**This is a meaningful raise of the bar, not a hard sandbox.** An agent that calls git via an absolute path instead of the inherited `PATH`, or that talks to GitHub's REST API directly instead of shelling out to `gh`, can still bypass the wrapper. Real isolation would mean running the agent with no push-capable credentials available to it at all (e.g. a worktree with no cached Git credential helper and a token-less environment) — worth considering before relying on this for anything you can't afford to have pushed. Treat the agent CLI's own permission/approval settings as your primary control and this guard as a second, independent layer.

## Safety boundaries
- No automatic installation of tools or project dependencies.
- No agent permission-bypass flags.
- No automatic deployment, force-push, destructive migration, or branch deletion — not configurable, always off.
- Queue items (issue title/description) are passed to the agent as clearly fenced, labeled *task data*, placed after the execution constraints in the prompt, with explicit instructions to treat that content as data, not as instructions that can override the constraints above it — since anyone who can create an issue in the configured team can get that text read by the agent.
- Only place tasks you intend to authorize in the configured ready state; Supervised mode's approval step is a second checkpoint, not a substitute for controlling who can create issues in that queue.
- Use one worker instance per Linear team/queue; this preview has no distributed atomic lease.
- Agent CLI tools can execute code and commands according to their own permission settings. Review those settings before enabling unattended work.
- The 0o600 mode set on the local state file is best-effort only — NTFS does not enforce POSIX mode bits the way Linux does. The real protection for stored credentials is Electron `safeStorage` (Windows DPAPI, tied to the signed-in user), not the file's mode.

## Requirements
- Windows 10/11 x64.
- Git for Windows (includes Git Bash).
- One supported CLI installed and authenticated interactively: Antigravity CLI (`agy`) or OpenCode (`opencode`).
- Optional: GitHub CLI (`gh`), authenticated, if you want ORBIT to also guard `gh pr create`/`gh release`/etc.
- A Linear team with configured workflow states, and either an OAuth2 Application or a personal API key.
- Node.js 22 LTS or newer and npm only when running from source/building. The packaged installer includes Electron's runtime and does not require Node/npm on the target PC.

## Build from source
```powershell
npm install
npm run check
npm test
npm run dist:win
```
Installer output: `release/ORBIT-Worker-Setup-0.1.0.exe`.

## First run
1. Launch ORBIT Worker. It scans the machine on startup; use **Scan machine** to repeat.
2. Select the detected agent. If both are available, choose one. If neither is validated, install/authenticate one and rescan.
3. Select the local Git repository and configure its project name/base ref.
4. Connect Linear — OAuth (create the OAuth2 Application first, see above) or a legacy API key. Both are encrypted with Electron safeStorage.
5. Enter the Linear team key and test the connection.
6. Select the exact Ready, In Progress and Review workflow states.
7. Choose an autonomy tier and the permission toggles that fit your comfort level. Leave push/merge/PR off until you've watched a few runs.
8. Start the worker. Test with a disposable task before using real project work, and watch the Pending approval panel if you're in Supervised mode.

## Current limitations
- No signed installer; Windows SmartScreen may warn.
- No auto-update channel.
- The push/merge/PR guard is process-level PATH interception, not a sandbox — see "Push, merge and PR enforcement" above.
- One project mapping per installed worker.
- No distributed lease; don't run two workers against the same team queue.
- Windows tray behavior, safeStorage, real Linear schema compatibility, the OAuth loopback flow, and live CLI execution still require Windows validation.

## Verification
The source package has passed JavaScript syntax checks and a `node --test` suite covering the agent adapters, the permission/autonomy logic (including the active-hours and daily-cap math and the git/gh guard script generation), and the Linear auth-header/OAuth-URL helpers, in the build environment. A successful Windows CI build and user-machine smoke test are still required.
