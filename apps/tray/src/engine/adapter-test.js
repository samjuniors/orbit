// `orbit adapter test <agent>`: runs ONE tiny real task through the agent in a throwaway
// repo, using the normal engine, to prove on THIS machine that headless mode, permissions
// and the invocation flags work. It uses a little of the agent's quota.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { normalizePolicy } = require('./policy');
const { runPlan } = require('./engine');
const { detect, ADAPTERS } = require('./adapters');
const { loadState } = require('./state');

async function runAdapterTest({ policy, limits = {}, keep = false }) {
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok, detail });
  const exe = detect(policy.agent, policy);
  add('agent CLI found', Boolean(exe), exe || 'not on PATH; install it, sign in, or set policy.agentPath');
  if (!exe) return { ok: false, checks, hint: ADAPTERS[policy.agent]?.hint };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-adapter-test-'));
  const g = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  g('init', '-q', '-b', 'main'); g('config', 'user.name', 'orbit'); g('config', 'user.email', 'orbit@localhost');
  fs.writeFileSync(path.join(dir, 'PLAN.md'), '# Adapter check\n\n- [ ] Create hello.txt\n  Create a file named hello.txt in the current directory containing exactly this text: orbit-ok\n');
  fs.writeFileSync(path.join(dir, 'check.js'), "const fs=require('fs');process.exit(fs.existsSync('hello.txt')&&fs.readFileSync('hello.txt','utf8').trim()==='orbit-ok'?0:1)");
  fs.writeFileSync(path.join(dir, '.gitignore'), '.orbit/\n');
  g('add', '-A'); g('commit', '-q', '-m', 'init');
  const testPolicy = normalizePolicy({ ...policy, verify: 'node check.js', allowUnverified: false, approval: 'none', onBlocked: 'stop', limits: { ...policy.limits, maxAttempts: 1, taskTimeoutMin: 5, stallMin: 2, maxTasks: 1, maxRateLimitWaits: 0, ...limits } });
  const quiet = { log() {}, onOutput: null, sleep: ms => new Promise(r => setTimeout(r, ms)), now: () => Date.now() };
  let state = null, error = null;
  try { await runPlan({ root: dir, policy: testPolicy, io: quiet }); state = loadState(dir); } catch (e) { error = e.message; }
  const t = state && state.tasks.T1;
  const err = (t && t.lastError) || error || '';
  add('runs without waiting for input', Boolean(t) && !/no output for/.test(err) && !/ran longer/.test(err), /no output for|ran longer/.test(err) ? 'it stalled: probably a permission prompt nobody can answer' : '');
  add('exits cleanly', Boolean(t) && !/exited with code/.test(err) && !/Could not find/.test(err), /exited with code/.test(err) ? err.split('\n').slice(0, 2).join(' ') : '');
  add('follows the task and passes verification', Boolean(t) && t.status === 'done', t && t.status !== 'done' ? 'the file was not created as asked' : '');
  const ok = checks.every(c => c.ok);
  if (!keep) fs.rmSync(dir, { recursive: true, force: true });
  return { ok, checks, hint: ok ? null : ADAPTERS[policy.agent]?.hint, errorTail: ok ? '' : String(err).slice(-800), dir: keep ? dir : null };
}

module.exports = { runAdapterTest };
