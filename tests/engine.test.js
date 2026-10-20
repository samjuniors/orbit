const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parsePlan, markDone } = require('../src/engine/plan');
const { normalizePolicy } = require('../src/engine/policy');
const { decide, buildGuard, BLOCK_EXIT } = require('../src/engine/guard');
const { runPlan, previewNext, RATE_LIMIT_RE } = require('../src/engine/engine');
const { paths, loadState, saveState, acquireLock } = require('../src/engine/state');

const FAKE = path.join(__dirname, 'fixtures', 'fake-agent.js');
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });

function makeRepo(planText, fake = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-test-'));
  sh(root, 'init', '-q', '-b', 'main'); sh(root, 'config', 'user.name', 't'); sh(root, 'config', 'user.email', 't@t');
  fs.writeFileSync(path.join(root, 'PLAN.md'), planText);
  fs.writeFileSync(path.join(root, 'fake.json'), JSON.stringify(fake));
  fs.writeFileSync(path.join(root, '.gitignore'), '.orbit/\n');
  fs.writeFileSync(path.join(root, 'verify.js'), "const fs=require('fs');const f=fs.readdirSync('.').filter(x=>x.startsWith('out-'));process.exit(f.every(x=>fs.readFileSync(x,'utf8')==='good')?0:1)");
  sh(root, 'add', '-A'); sh(root, 'commit', '-q', '-m', 'init');
  const calls = path.join(root, '..', `calls-${path.basename(root)}.log`);
  process.env.FAKE_CALLS = calls;
  return { root, calls: () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n') : []) };
}
const policy = (extra = {}) => normalizePolicy({ agent: 'generic', agentCommand: [process.execPath, FAKE], verify: 'node verify.js', ...extra, limits: { rateLimitWaitMin: 30, ...(extra.limits || {}) } });
const sleeps = [];
const io = { log() {}, onOutput: null, sleep: ms => { sleeps.push(ms); return Promise.resolve(); }, now: () => Date.now() };
const PLAN2 = '# App\nContext line.\n\n- [ ] First thing\n  detail one\n- [ ] Second thing\n';

test('parsePlan reads ids, bodies, done flags and shared context', () => {
  const p = parsePlan('# Title\nshared\n\n- [x] A done one\n- [ ] DB: Make the schema\n  indented spec\n  more spec\n- [ ] Third\n');
  assert.equal(p.title, 'Title'); assert.match(p.preamble, /shared/);
  assert.deepEqual(p.tasks.map(t => [t.id, t.done]), [['T1', true], ['DB', false], ['T3', false]]);
  assert.match(p.tasks[1].body, /indented spec\n\s*more spec/);
});
test('parsePlan rejects duplicate ids; markDone keeps CRLF line endings', () => {
  assert.throws(() => parsePlan('- [ ] X: a\n- [ ] X: b\n'), /Duplicate task id/);
  const out = markDone('# T\r\n- [ ] one\r\n- [ ] two\r\n', 'T2');
  assert.equal(out, '# T\r\n- [ ] one\r\n- [x] two\r\n');
});
test('policy: defaults are safe, locked rules and "approve" are refused', () => {
  const p = normalizePolicy({});
  assert.equal(p.rules['git.push'], 'block'); assert.equal(p.limits.maxAttempts, 3);
  assert.throws(() => normalizePolicy({ rules: { deploy: 'allow' } }), /locked/);
  assert.throws(() => normalizePolicy({ rules: { 'git.push': 'approve' } }), /not supported mid-run/);
  assert.throws(() => normalizePolicy({ rules: { nonsense: 'allow' } }), /Unknown policy rule/);
  assert.throws(() => normalizePolicy({ agent: 'generic' }), /agentCommand/);
});
test('guard.decide blocks push/merge/PR by default and always blocks force-push', () => {
  const none = { push: false, merge: false, pr: false }, all = { push: true, merge: true, pr: true };
  assert.equal(decide('git', ['push'], none).ok, false);
  assert.equal(decide('git', ['-C', 'x', 'push', 'origin'], none).ok, false); // global option must not hide the subcommand
  assert.equal(decide('git', ['--git-dir=.git', 'PUSH'], none).ok, false);
  assert.equal(decide('git', ['-c', 'alias.p=push', 'p'], all).ok, false);
  assert.equal(decide('git', ['push', 'origin', 'main'], all).ok, true);
  for (const bad of [['push', '--force'], ['push', '-f'], ['push', '--force-with-lease'], ['push', 'origin', '+main'], ['push', 'origin', ':old'], ['push', '--delete', 'origin', 'x']]) assert.equal(decide('git', bad, all).ok, false, bad.join(' '));
  assert.equal(decide('git', ['merge', 'x'], none).ok, false); assert.equal(decide('git', ['pull'], none).ok, false); assert.equal(decide('git', ['merge', 'x'], all).ok, true);
  assert.equal(decide('git', ['status'], none).ok, true); assert.equal(decide('git', ['commit', '-m', 'push'], none).ok, true);
  assert.equal(decide('gh', ['pr', 'create'], none).ok, false); assert.equal(decide('gh', ['pr', 'create'], all).ok, true);
  for (const bad of [['pr', 'merge', '1'], ['release', 'create'], ['api', 'repos/x'], ['repo', 'delete', 'x'], ['workflow', 'run', 'w']]) assert.equal(decide('gh', bad, all).ok, false, bad.join(' '));
  assert.equal(decide('gh', ['-R', 'a/b', 'pr', 'create'], none).ok, false);
});
test('guard shims block and forward for real (posix)', { skip: process.platform === 'win32' }, () => {
  const realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-real-'));
  const realGit = path.join(realDir, 'git'); fs.writeFileSync(realGit, '#!/bin/sh\necho FORWARDED "$@"\n'); fs.chmodSync(realGit, 0o755);
  const g = buildGuard({ realGit, realGh: null, allow: { push: false, merge: true, pr: false } });
  const run = (...a) => spawnSync(path.join(g.dir, 'git'), a, { env: { ...process.env, ...g.env }, encoding: 'utf8' });
  const blocked = run('-C', '.', 'push'); assert.equal(blocked.status, BLOCK_EXIT); assert.match(blocked.stderr, /ORBIT guard/);
  const ok = run('merge', 'x'); assert.equal(ok.status, 0); assert.match(ok.stdout, /FORWARDED merge x/);
  g.cleanup(); assert.equal(fs.existsSync(g.dir), false);
});
test('rate-limit detector matches common messages but not ordinary failures', () => {
  for (const m of ['Error: usage limit reached', '429 Too Many Requests', 'rate_limit_exceeded', 'You have hit your limit. Try again later']) assert.match(m, RATE_LIMIT_RE, m);
  for (const m of ['TypeError: x is not a function', 'tests failed: 3']) assert.doesNotMatch(m, RATE_LIMIT_RE, m);
});

test('engine: runs every task in order, verifies, commits, checks off the plan, writes a report', async () => {
  const r = makeRepo(PLAN2);
  const res = await runPlan({ root: r.root, policy: policy(), io });
  assert.equal(res.status, 'done'); assert.equal(res.exitCode, 0);
  const s = loadState(r.root); assert.equal(s.tasks.T1.status, 'done'); assert.equal(s.tasks.T2.status, 'done');
  assert.equal(sh(s.worktree, 'rev-list', '--count', `${s.baseSha}..HEAD`).stdout.trim(), '2');
  assert.match(fs.readFileSync(path.join(s.worktree, 'PLAN.md'), 'utf8'), /- \[x\] First thing[\s\S]*- \[x\] Second thing/);
  assert.match(fs.readFileSync(paths(r.root).report, 'utf8'), /\*\*2 done\*\*/);
  assert.equal(sh(r.root, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.trim(), 'main'); // your checkout is untouched
});
test('engine: failed verification feeds the failure back and retries in the same worktree', async () => {
  const r = makeRepo(PLAN2, { T1: { 1: 'bad' } });
  const res = await runPlan({ root: r.root, policy: policy(), io });
  assert.equal(res.status, 'done');
  assert.equal(loadState(r.root).tasks.T1.attempts, 2);
  assert.match(r.calls().join('\n'), /T1 call2 good VERIFYFAIL/);
});
test('engine: a task that never passes is blocked, the run stops, later tasks do not run', async () => {
  const r = makeRepo(PLAN2, { T1: { 1: 'bad', 2: 'bad', 3: 'bad' } });
  const res = await runPlan({ root: r.root, policy: policy(), io });
  assert.equal(res.status, 'blocked'); assert.equal(res.exitCode, 2);
  const s = loadState(r.root); assert.equal(s.tasks.T1.status, 'blocked'); assert.equal(s.tasks.T1.attempts, 3); assert.equal(s.tasks.T2, undefined);
  assert.match(fs.readFileSync(paths(r.root).report, 'utf8'), /Needs you[\s\S]*T1/);
  assert.equal(r.calls().filter(l => l.startsWith('T2')).length, 0);
});
test('engine: onBlocked "skip" moves past a blocked task', async () => {
  const r = makeRepo(PLAN2, { T1: { 1: 'fail', 2: 'fail', 3: 'fail' } });
  const res = await runPlan({ root: r.root, policy: policy({ onBlocked: 'skip' }), io });
  const s = loadState(r.root); assert.equal(s.tasks.T1.status, 'blocked'); assert.equal(s.tasks.T2.status, 'done'); assert.equal(res.exitCode, 2);
});
test('engine: a limit stops the run, and the next run resumes without redoing finished work', async () => {
  const r = makeRepo(PLAN2);
  const first = await runPlan({ root: r.root, policy: policy({ limits: { maxTasks: 1 } }), io });
  assert.equal(first.status, 'stopped'); assert.equal(first.exitCode, 3);
  const second = await runPlan({ root: r.root, policy: policy(), io });
  assert.equal(second.status, 'done');
  assert.equal(r.calls().filter(l => l.startsWith('T1')).length, 1);
  assert.equal(loadState(r.root).runId, first.state.runId); // same run, same worktree
});
test('engine: after a crash mid-task, the task resumes in place and the agent is told it was interrupted', async () => {
  const r = makeRepo(PLAN2);
  await runPlan({ root: r.root, policy: policy({ limits: { maxTasks: 1 } }), io });
  const s = loadState(r.root); s.tasks.T2 = { status: 'running', attempts: 1, rateLimitWaits: 0 }; saveState(r.root, s); // simulate power loss
  const res = await runPlan({ root: r.root, policy: policy(), io });
  assert.equal(res.status, 'done'); assert.equal(loadState(r.root).tasks.T2.attempts, 2);
  assert.match(r.calls().join('\n'), /T2 call1 good INTERRUPTED/);
});
test('engine: tasks appended to the plan after a finished run are picked up (append-only roadmap)', async () => {
  const r = makeRepo(PLAN2);
  await runPlan({ root: r.root, policy: policy(), io });
  fs.appendFileSync(path.join(r.root, 'PLAN.md'), '- [ ] Third thing\n');
  const res = await runPlan({ root: r.root, policy: policy(), io });
  const s = loadState(r.root); assert.equal(res.status, 'done'); assert.equal(s.tasks.T3.status, 'done');
  assert.equal(r.calls().filter(l => l.startsWith('T1') || l.startsWith('T2')).length, 2);
  assert.match(fs.readFileSync(path.join(s.worktree, 'PLAN.md'), 'utf8'), /- \[x\] Third thing/);
});
test('engine: an agent that goes silent is stopped by stall detection and retried', async () => {
  const r = makeRepo(PLAN2, { T1: { 1: 'stall' } });
  const res = await runPlan({ root: r.root, policy: policy({ limits: { stallMin: 0.03 } }), io });
  assert.equal(res.status, 'done'); assert.equal(loadState(r.root).tasks.T1.attempts, 2);
});
test('engine: a rate limit waits and retries without using up an attempt', async () => {
  const r = makeRepo(PLAN2, { T1: { 1: 'rate' } });
  sleeps.length = 0;
  const res = await runPlan({ root: r.root, policy: policy(), io });
  assert.equal(res.status, 'done'); assert.equal(loadState(r.root).tasks.T1.attempts, 1); assert.deepEqual(sleeps, [30 * 60000]);
});
test('engine: an agent that changes nothing is retried', async () => {
  const r = makeRepo(PLAN2, { T1: { 1: 'noop' } });
  const res = await runPlan({ root: r.root, policy: policy(), io });
  assert.equal(res.status, 'done'); assert.equal(loadState(r.root).tasks.T1.attempts, 2);
});
test('engine: approval gate waits for you; approve continues, reject sends feedback back', async () => {
  const r = makeRepo(PLAN2);
  const dir = paths(r.root).approvals; fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'T1.approve'), ''); fs.writeFileSync(path.join(dir, 'T2.reject'), 'wrong colour');
  const res = await runPlan({ root: r.root, policy: policy({ approval: 'each-task' }), io });
  const s = loadState(r.root); assert.equal(s.tasks.T1.status, 'done'); assert.equal(s.tasks.T2.status, 'blocked'); assert.match(s.tasks.T2.lastError, /wrong colour/); assert.equal(res.exitCode, 2);
  fs.writeFileSync(path.join(dir, 'T2.approve'), '');
  const again = await runPlan({ root: r.root, policy: policy({ approval: 'each-task' }), io });
  assert.equal(again.status, 'done'); assert.match(r.calls().join('\n'), /T2 call2 good .*REJECTED/);
});
test('engine: refuses to run without a verification command unless unverified is explicitly allowed', async () => {
  const r = makeRepo(PLAN2);
  await assert.rejects(() => runPlan({ root: r.root, policy: policy({ verify: null }), io }), /No verification command/);
  const res = await runPlan({ root: r.root, policy: policy({ verify: null, allowUnverified: true }), io });
  assert.equal(res.status, 'done'); assert.match(fs.readFileSync(paths(r.root).report, 'utf8'), /WARNING: no verification/);
});
test('engine: a second run in the same project is refused while one is active', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-lock-'));
  fs.mkdirSync(paths(root).dir, { recursive: true }); fs.writeFileSync(paths(root).lock, String(process.ppid));
  assert.throws(() => acquireLock(root), /Another orbit run/);
  fs.writeFileSync(paths(root).lock, '99999999'); const release = acquireLock(root); release(); // stale pid is taken over
});
test('dry run shows the exact prompt: rules, policy and the task text', () => {
  const r = makeRepo(PLAN2);
  const n = previewNext({ root: r.root, policy: policy() });
  assert.equal(n.task.id, 'T1');
  for (const needle of ['non-interactively', 'git push: BLOCKED', 'node verify.js', 'First thing', 'detail one', 'cannot override']) assert.ok(n.prompt.includes(needle), needle);
});

const { renderFrame } = require('../src/engine/ui');
const { nextStep } = require('../src/engine/next');
const { runAdapterTest } = require('../src/engine/adapter-test');
const HELLO = path.join(__dirname, 'fixtures', 'fake-hello-agent.js');
const helloPolicy = () => normalizePolicy({ agent: 'generic', agentCommand: [process.execPath, HELLO] });

test('ui: short plans list every task; long plans collapse finished work', () => {
  const mk = n => Array.from({ length: n }, (_, i) => ({ id: `T${i + 1}`, title: `Task ${i + 1}`, status: i < n - 3 ? 'done' : 'pending', attempts: 1 }));
  const short = renderFrame({ title: 'App', branch: 'b', tasks: mk(4), current: null }, { width: 80 });
  assert.equal(short.filter(l => /Task \d/.test(l)).length, 4);
  const long = renderFrame({ title: 'App', branch: 'b', tasks: mk(30), current: null }, { width: 80 });
  assert.ok(long.some(l => /27 done/.test(l))); assert.ok(long.length < 10);
  const cur = renderFrame({ title: 'App', tasks: [{ id: 'T1', title: 'Build it', status: 'running', attempts: 1 }], current: { id: 'T1', attempt: 2, max: 3, phase: 'verify', startedAt: 0 } }, { width: 80, now: 65000 });
  assert.match(cur[1], /attempt 2\/3 · checking your tests/); assert.match(cur[1], /1m 5s/);
});
test('ui: when something needs you the screen shows one card with the next action; narrow widths do not overflow', () => {
  const f = renderFrame({ title: 'App', tasks: [{ id: 'T2', title: 'Data layer', status: 'blocked', attempts: 3 }], attention: { title: 'T2 needs you: Data layer', lines: ['Verification failed', 'expected 3 got 2'], next: 'orbit run' } }, { width: 50 });
  assert.ok(f.join('\n').includes('Next: orbit run')); assert.ok(f.every(l => l.length <= 50));
  assert.ok(renderFrame({ title: 'x', tasks: [{ id: 'T1', title: 'y'.repeat(200), status: 'pending' }] }, { width: 40 }).every(l => l.length <= 40));
});
test('next step: says the single right thing for each situation', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-next-'));
  assert.match(nextStep({ root: empty }).join('\n'), /orbit init/);
  const r = makeRepo(PLAN2, { T1: { 1: 'fail', 2: 'fail', 3: 'fail' } });
  fs.writeFileSync(path.join(r.root, 'orbit.policy.json'), JSON.stringify({ agent: 'generic', agentCommand: [process.execPath, FAKE], verify: 'node verify.js' }));
  assert.match(nextStep({ root: r.root }).join('\n'), /2 tasks to do[\s\S]*orbit run/);
  await runPlan({ root: r.root, policy: policy(), io });
  assert.match(nextStep({ root: r.root }).join('\n'), /T1 needs you[\s\S]*boom|T1 needs you[\s\S]*exited/);
  const r2 = makeRepo(PLAN2);
  fs.writeFileSync(path.join(r2.root, 'orbit.policy.json'), JSON.stringify({ agent: 'generic', agentCommand: [process.execPath, FAKE], verify: 'node verify.js' }));
  await runPlan({ root: r2.root, policy: policy(), io });
  assert.match(nextStep({ root: r2.root }).join('\n'), /Everything in the plan is done/);
});
test('engine emits structured events a UI can follow', async () => {
  const r = makeRepo(PLAN2); const seen = [];
  await runPlan({ root: r.root, policy: policy(), io: { ...io, event: e => seen.push(e) } });
  const types = seen.map(e => e.type);
  assert.ok(types.includes('snapshot') && types.includes('phase') && types.includes('task-done') && types.at(-1) === 'run-end');
  assert.deepEqual(seen.filter(e => e.type === 'phase').map(e => e.phase).slice(0, 2), ['agent', 'verify']);
});
test('adapter test: passes for a working agent and explains each way it can fail', async () => {
  process.env.ORBIT_FAKE_MODE = 'good';
  const good = await runAdapterTest({ policy: helloPolicy() });
  assert.equal(good.ok, true); assert.equal(good.checks.length, 4);
  process.env.ORBIT_FAKE_MODE = 'wrong';
  const wrong = await runAdapterTest({ policy: helloPolicy() });
  assert.equal(wrong.ok, false); assert.equal(wrong.checks.find(c => /follows/.test(c.name)).ok, false);
  process.env.ORBIT_FAKE_MODE = 'fail';
  const fail = await runAdapterTest({ policy: helloPolicy() });
  assert.equal(fail.checks.find(c => /exits cleanly/.test(c.name)).ok, false); assert.match(fail.errorTail, /permission denied/);
  process.env.ORBIT_FAKE_MODE = 'stall';
  const stall = await runAdapterTest({ policy: helloPolicy(), limits: { stallMin: 0.03 } });
  assert.equal(stall.checks.find(c => /without waiting/.test(c.name)).ok, false);
  const missing = await runAdapterTest({ policy: normalizePolicy({ agent: 'grok', agentPath: null }) });
  if (!missing.checks[0].ok) assert.equal(missing.ok, false);
  delete process.env.ORBIT_FAKE_MODE;
});
