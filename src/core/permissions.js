// Autonomy settings (what getPermissions() resolves from stored settings) and
// the local "guard" that intercepts git/gh commands run by the coding agent
// inside a task worktree. The guard is best-effort hardening, not a hard
// sandbox: an agent that really wants to bypass PATH (an absolute path to
// git.exe, or hitting GitHub's REST API directly) still could. Treat it as
// raising the bar, and keep the agent CLI's own permission settings as your
// primary control.
const fs = require('node:fs');
const path = require('node:path');

const AUTONOMY_LEVELS = ['supervised', 'delegated', 'autonomous'];

const DEFAULT_PERMISSIONS = {
  autonomyLevel: 'supervised', // supervised: claim, but wait for approval to run.
                                 // delegated: claim + run automatically, within the caps below.
                                 // autonomous: claim + run automatically, no caps.
  allowClaim: true,     // move the Linear issue to "in progress" when ORBIT picks it up.
  allowAgentRun: true,  // master switch for actually invoking the agent CLI.
  allowComment: true,   // post the result/summary back to Linear as a comment.
  allowReviewTransition: true, // move a successfully finished task to the Review state.
  requireApprovalBeforeReview: true, // the one "important" checkpoint: pause once implementation
                                       // passes verification, before touching Linear's Review state.
                                       // Applies in every autonomy tier, including autonomous.
  allowPush: false,
  allowPullRequest: false,
  allowMerge: false,
  maxTasksPerDay: 10,   // 0 = unlimited. Ignored in 'autonomous' mode.
  activeHours: { enabled: false, start: '09:00', end: '18:00' } // ignored in 'autonomous' mode.
  // There is deliberately no toggle for deploy or force-push: those stay
  // blocked by the guard regardless of settings.
};

function getPermissions(settings) {
  const overrides = (settings && settings.permissions) || {};
  const p = { ...DEFAULT_PERMISSIONS, ...overrides };
  if (!AUTONOMY_LEVELS.includes(p.autonomyLevel)) p.autonomyLevel = 'supervised';
  p.activeHours = { ...DEFAULT_PERMISSIONS.activeHours, ...(overrides.activeHours || {}) };
  p.allowClaim = Boolean(p.allowClaim);
  p.allowAgentRun = Boolean(p.allowAgentRun);
  p.allowComment = Boolean(p.allowComment);
  p.allowReviewTransition = Boolean(p.allowReviewTransition);
  p.requireApprovalBeforeReview = Boolean(p.requireApprovalBeforeReview);
  p.allowPush = Boolean(p.allowPush);
  p.allowPullRequest = Boolean(p.allowPullRequest);
  p.allowMerge = Boolean(p.allowMerge);
  p.maxTasksPerDay = Number.isFinite(p.maxTasksPerDay) && p.maxTasksPerDay >= 0 ? Math.floor(p.maxTasksPerDay) : DEFAULT_PERMISSIONS.maxTasksPerDay;
  p.requireApprovalToRun = p.autonomyLevel === 'supervised';
  return p;
}

function withinActiveHours(permissions, now = new Date()) {
  if (permissions.autonomyLevel === 'autonomous') return true;
  const ah = permissions.activeHours;
  if (!ah || !ah.enabled) return true;
  const [sh, sm] = ah.start.split(':').map(Number);
  const [eh, em] = ah.end.split(':').map(Number);
  const mins = now.getHours() * 60 + now.getMinutes();
  const s = sh * 60 + sm, e = eh * 60 + em;
  return s <= e ? (mins >= s && mins < e) : (mins >= s || mins < e);
}

function withinDailyLimit(permissions, history, now = new Date()) {
  if (permissions.autonomyLevel === 'autonomous' || !permissions.maxTasksPerDay) return true;
  const since = now.getTime() - 24 * 60 * 60 * 1000;
  const count = history.filter(h => ['completed', 'failed'].includes(h.outcome) && new Date(h.at).getTime() >= since).length;
  return count < permissions.maxTasksPerDay;
}

function describeAutonomyLevel(level) {
  if (level === 'delegated') return 'Claims and runs eligible tasks automatically, limited by the daily cap and active hours below.';
  if (level === 'autonomous') return 'Claims and runs eligible tasks automatically, with no daily cap or active-hours limit.';
  return 'Claims eligible tasks, but waits for your approval before the agent actually runs.';
}

const GIT_GUARD_SCRIPT = `@echo off\r
setlocal enabledelayedexpansion\r
set "SUBCMD=%~1"\r
set "FORCE=0"\r
for %%A in (%*) do (\r
  if /I "%%~A"=="--force" set "FORCE=1"\r
  if /I "%%~A"=="-f" set "FORCE=1"\r
  if /I "%%~A"=="--force-with-lease" set "FORCE=1"\r
)\r
if /I "%SUBCMD%"=="push" (\r
  if "!FORCE!"=="1" (\r
    echo ORBIT guard: force-push is never permitted by this worker. 1>&2\r
    exit /b 17\r
  )\r
  if not "%ORBIT_ALLOW_PUSH%"=="1" (\r
    echo ORBIT guard: push is disabled by current ORBIT permission settings. 1>&2\r
    exit /b 17\r
  )\r
)\r
if /I "%SUBCMD%"=="merge" (\r
  if not "%ORBIT_ALLOW_MERGE%"=="1" (\r
    echo ORBIT guard: merge is disabled by current ORBIT permission settings. 1>&2\r
    exit /b 17\r
  )\r
)\r
"%ORBIT_REAL_GIT%" %*\r
exit /b %ERRORLEVEL%\r
`;

const GH_GUARD_SCRIPT = `@echo off\r
setlocal enabledelayedexpansion\r
set "SUBCMD=%~1"\r
set "SUBSUB=%~2"\r
if /I "%SUBCMD%"=="release" (\r
  echo ORBIT guard: gh release is never permitted by this worker. 1>&2\r
  exit /b 17\r
)\r
if /I "%SUBCMD%"=="repo" if /I "%SUBSUB%"=="delete" (\r
  echo ORBIT guard: deleting a repository is never permitted. 1>&2\r
  exit /b 17\r
)\r
if /I "%SUBCMD%"=="workflow" if /I "%SUBSUB%"=="run" (\r
  echo ORBIT guard: triggering a workflow run is never permitted by this worker. 1>&2\r
  exit /b 17\r
)\r
if /I "%SUBCMD%"=="pr" if /I "%SUBSUB%"=="merge" (\r
  echo ORBIT guard: gh pr merge is never permitted by this worker. 1>&2\r
  exit /b 17\r
)\r
if /I "%SUBCMD%"=="pr" if /I "%SUBSUB%"=="create" (\r
  if not "%ORBIT_ALLOW_PR%"=="1" (\r
    echo ORBIT guard: opening pull requests is disabled by current ORBIT permission settings. 1>&2\r
    exit /b 17\r
  )\r
)\r
"%ORBIT_REAL_GH%" %*\r
exit /b %ERRORLEVEL%\r
`;

function buildGuardEnv({ guardRoot, realGitPath, realGhPath, permissions }) {
  fs.mkdirSync(guardRoot, { recursive: true });
  const guardDir = fs.mkdtempSync(path.join(guardRoot, 'guard-'));
  fs.writeFileSync(path.join(guardDir, 'git.cmd'), GIT_GUARD_SCRIPT, 'utf8');
  if (realGhPath) fs.writeFileSync(path.join(guardDir, 'gh.cmd'), GH_GUARD_SCRIPT, 'utf8');
  const extraEnv = {
    PATH: `${guardDir}${path.delimiter}${process.env.PATH || ''}`,
    ORBIT_REAL_GIT: realGitPath,
    ORBIT_REAL_GH: realGhPath || '',
    ORBIT_ALLOW_PUSH: permissions.allowPush ? '1' : '0',
    ORBIT_ALLOW_MERGE: permissions.allowMerge ? '1' : '0',
    ORBIT_ALLOW_PR: permissions.allowPullRequest ? '1' : '0'
  };
  return { guardDir, extraEnv };
}

function cleanupGuard(guardDir) {
  try { fs.rmSync(guardDir, { recursive: true, force: true }); } catch {}
}

module.exports = {
  AUTONOMY_LEVELS, DEFAULT_PERMISSIONS, getPermissions, withinActiveHours, withinDailyLimit,
  describeAutonomyLevel, buildGuardEnv, cleanupGuard, GIT_GUARD_SCRIPT, GH_GUARD_SCRIPT
};
