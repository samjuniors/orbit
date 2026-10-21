// Command guard: shims for `git` and `gh` placed first on the agent's PATH.
// Each shim calls this file, which decides allow/block and otherwise forwards
// to the real binary. It is best-effort hardening, NOT a sandbox: an agent can
// still call a binary by absolute path or talk to a web API directly. Pair it
// with the agent's own permission settings and credential-less environments.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BLOCK_EXIT = 17;
// git global options that consume the next token as their value
const GIT_VALUE_OPTS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env']);

function gitSubcommand(argv) {
  const aliasOverride = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('-')) return { sub: a.toLowerCase(), rest: argv.slice(i + 1), aliasOverride };
    if (a === '-c' && argv[i + 1] != null) { if (/^alias\./i.test(argv[i + 1])) aliasOverride.push(argv[i + 1]); i++; continue; }
    if (GIT_VALUE_OPTS.has(a)) { i++; continue; }
    if (/^--(git-dir|work-tree|namespace|exec-path|config-env)=/.test(a)) continue;
  }
  return { sub: '', rest: [], aliasOverride };
}

function decide(tool, argv, allow) {
  if (tool === 'git') {
    const { sub, rest, aliasOverride } = gitSubcommand(argv);
    if (aliasOverride.length) return { ok: false, reason: 'overriding git aliases (-c alias.*) is not permitted; it could disguise a blocked command' };
    if (sub === 'push') {
      const force = rest.some(a => a === '-f' || a === '--force' || a.startsWith('--force-') || a === '--mirror' || a === '--delete' || a === '-d' || a.startsWith('+') || /^:[^:]/.test(a));
      if (force) return { ok: false, reason: 'force-push, branch deletion and mirror pushes are never permitted' };
      if (!allow.push) return { ok: false, reason: 'git push is blocked by the policy (rules["git.push"])' };
    }
    if ((sub === 'merge' || sub === 'pull') && !allow.merge) return { ok: false, reason: `git ${sub} is blocked by the policy (rules["git.merge"])` };
    return { ok: true };
  }
  if (tool === 'gh') {
    const args = [];
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === '-R' || a === '--repo') { i++; continue; }
      if (a.startsWith('--repo=')) continue;
      if (!a.startsWith('-')) args.push(a.toLowerCase());
    }
    const [a, b] = args;
    if (a === 'release') return { ok: false, reason: 'gh release is never permitted' };
    if (a === 'api') return { ok: false, reason: 'gh api could bypass the policy and is never permitted' };
    if (a === 'repo' && b === 'delete') return { ok: false, reason: 'deleting a repository is never permitted' };
    if (a === 'workflow' && b === 'run') return { ok: false, reason: 'triggering workflow runs is never permitted (deploy)' };
    if (a === 'pr' && b === 'merge') return { ok: false, reason: 'gh pr merge is never permitted' };
    if (a === 'pr' && b === 'create' && !allow.pr) return { ok: false, reason: 'opening pull requests is blocked by the policy (rules["pr.create"])' };
    return { ok: true };
  }
  return { ok: true };
}

// How a shim re-launches ORBIT's own guard: `<exe> [bin/orbit.js] __guard <tool> args...`.
// From a packaged single-file exe there is no script path, so the exe itself is the entry point.
function launchPrefix() {
  let sea = false;
  try { sea = require('node:sea').isSea(); } catch {}
  return sea ? [process.execPath, '__guard'] : [process.execPath, path.join(__dirname, '..', '..', 'bin', 'orbit.js'), '__guard'];
}
const winQuote = s => `"${s.replace(/"/g, '""')}"`;
const shQuote = s => `'${s.replace(/'/g, `'\\''`)}'`;

// Writes shims into a fresh temp dir and returns env additions for the agent.
function buildGuard({ realGit, realGh, allow, root = os.tmpdir() }) {
  const dir = fs.mkdtempSync(path.join(root, 'orbit-guard-'));
  const win = process.platform === 'win32';
  const prefix = launchPrefix();
  const make = (name) => {
    if (win) fs.writeFileSync(path.join(dir, `${name}.cmd`), `@echo off\r\n${prefix.map(winQuote).join(' ')} ${name} %*\r\nexit /b %ERRORLEVEL%\r\n`);
    else { const f = path.join(dir, name); fs.writeFileSync(f, `#!/bin/sh\nexec ${prefix.map(shQuote).join(' ')} ${name} "$@"\n`); fs.chmodSync(f, 0o755); }
  };
  make('git');
  if (realGh) make('gh');
  const env = {
    PATH: `${dir}${path.delimiter}${process.env.PATH || ''}`,
    ORBIT_REAL_GIT: realGit,
    ORBIT_REAL_GH: realGh || '',
    ORBIT_ALLOW: JSON.stringify(allow)
  };
  return { dir, env, cleanup() { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} } };
}

function main(args = process.argv.slice(2)) {
  const [tool, ...argv] = args;
  const real = tool === 'gh' ? process.env.ORBIT_REAL_GH : process.env.ORBIT_REAL_GIT;
  let allow = { push: false, merge: false, pr: false };
  try { allow = { ...allow, ...JSON.parse(process.env.ORBIT_ALLOW || '{}') }; } catch {}
  const verdict = decide(tool, argv, allow);
  if (!verdict.ok) { process.stderr.write(`ORBIT guard: ${verdict.reason}. Do not retry; report it in your summary instead.\n`); process.exit(BLOCK_EXIT); }
  if (!real) { process.stderr.write(`ORBIT guard: no real ${tool} binary configured.\n`); process.exit(127); }
  const r = spawnSync(real, argv, { stdio: 'inherit', shell: false });
  process.exit(r.status == null ? 1 : r.status);
}

if (require.main === module) main();
module.exports = { decide, gitSubcommand, buildGuard, main, BLOCK_EXIT };
