// `orbit setup`: a short guided wizard (replaces hand-editing JSON). All input/output goes
// through ask()/say() so it can be driven by a terminal, by --yes defaults, or by tests.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const NPM_PLACEHOLDER = /no test specified/i;

// Best guess at the project's test command, or null.
function suggestVerify(root) {
  const has = f => fs.existsSync(path.join(root, f));
  if (has('package.json')) {
    try { const t = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts?.test; if (t && !NPM_PLACEHOLDER.test(t)) return 'npm test'; } catch {}
  }
  if (has('go.mod')) return 'go test ./...';
  if (has('Cargo.toml')) return 'cargo test';
  if (has('pytest.ini') || has('pyproject.toml') || has('tox.ini') || has('conftest.py')) return 'pytest';
  return null;
}

const git = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8' }); return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() }; };

async function runSetup({ root, planFile = 'PLAN.md', policyFile = 'orbit.policy.json', ask, say, agents, testAdapter, interactive = true }) {
  const yes = (a, def) => (a === '' ? def : /^y/i.test(a));
  const policyPath = path.join(root, policyFile), planPath = path.join(root, planFile);
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(policyPath, 'utf8')); } catch {}

  say('ORBIT setup. Press Enter to accept the [default]. Nothing runs until you say so.\n');

  // 1. git
  say(`1/5  Project folder: ${root}`);
  if (!git(root, 'rev-parse', '--show-toplevel').ok) {
    say('     This is not a git repository. ORBIT uses git to keep the agent\'s work on a separate branch.');
    if (!yes(await ask('git-init', '     Create one here? [Y/n] ', ''), true)) { say('\nSetup stopped: ORBIT needs git. Run `git init` yourself and try again.'); return { ok: false }; }
    const r = git(root, 'init', '-q', '-b', 'main');
    if (!r.ok) { say(`     git init failed: ${r.err}`); return { ok: false }; }
  }
  if (!git(root, 'rev-parse', 'HEAD').ok) {
    git(root, '-c', 'user.name=ORBIT', '-c', 'user.email=orbit@localhost', 'commit', '-q', '--allow-empty', '-m', 'Initial commit (created by orbit setup)');
    say('     Made an empty first commit. Files already in this folder are NOT in it: review them (no secrets!) and commit them yourself before running, or the agent will not see them.');
  } else if (git(root, 'status', '--porcelain').out) {
    say('     Note: you have uncommitted changes. The agent works from your last commit, so commit what you want it to see.');
  }

  // 2. agent
  say('\n2/5  Which coding agent should do the work?');
  const choices = agents.filter(a => a.id !== 'generic');
  choices.forEach((a, i) => say(`     ${i + 1}. ${a.label}${a.path ? '  (installed)' : '  (not found on this machine)'}`));
  const firstInstalled = choices.findIndex(a => a.path);
  const prev = choices.findIndex(a => a.id === existing.agent);
  const defIdx = prev >= 0 ? prev : (firstInstalled >= 0 ? firstInstalled : 0);
  let pick;
  for (;;) { const a = await ask('agent', `     Number [${defIdx + 1}]: `, ''); const n = a === '' ? defIdx + 1 : parseInt(a, 10); if (n >= 1 && n <= choices.length) { pick = choices[n - 1]; break; } say('     Please enter one of the numbers above.'); }
  if (!pick.path) say(`     ${pick.label} was not found on PATH. Install it and sign in before running (orbit doctor checks this).`);

  // 3. verification
  say('\n3/5  How can ORBIT prove a task worked? A command that passes when the work is good.');
  const guess = existing.verify || suggestVerify(root);
  let verify = null, allowUnverified = false;
  for (;;) {
    const a = await ask('verify', `     Test command${guess ? ` [${guess}]` : ' (e.g. npm test)'}: `, '');
    verify = a === '' ? guess : a;
    if (verify) break;
    if (!interactive && existing.allowUnverified) { allowUnverified = true; break; }
    if (!interactive) { say('     No test command could be detected. Run `orbit setup` without --yes and enter one.'); return { ok: false }; }
    say('     Without a test command ORBIT can only say "the agent finished", not "it works".');
    if (yes(await ask('no-verify-ok', '     Continue without proof anyway? [y/N] ', ''), false)) { allowUnverified = true; break; }
  }

  // 4. review mode
  say('\n4/5  When should you review the work?');
  say('     1. After every task (safest: ORBIT waits for your OK)');
  say('     2. At the end (it runs through; you review the whole branch)');
  const rv = await ask('review', `     Number [${existing.approval === 'none' ? 2 : 1}]: `, '');
  const approval = (rv === '' ? (existing.approval === 'none' ? 'none' : 'each-task') : rv === '2' ? 'none' : 'each-task');

  // write the policy, keeping anything the user already customised
  const policy = { ...existing, agent: pick.id, verify: verify || null, approval, limits: { maxAttempts: 3, taskTimeoutMin: 30, stallMin: 10, maxTasks: 0, maxRuntimeMin: 0, ...(existing.limits || {}) }, rules: { 'git.push': 'block', 'git.merge': 'block', 'pr.create': 'block', ...(existing.rules || {}) } };
  if (allowUnverified) policy.allowUnverified = true; else delete policy.allowUnverified;
  if (pick.id !== existing.agent) policy.agentArgs = existing.agent === pick.id ? existing.agentArgs || [] : [];
  fs.writeFileSync(policyPath, JSON.stringify(policy, null, 2) + '\n');
  say(`\n     Saved ${policyFile}.`);

  // 5. first task
  say('\n5/5  The plan');
  if (fs.existsSync(planPath)) say(`     ${planFile} already exists; leaving it alone.`);
  else {
    const first = await ask('first-task', '     What should the agent build first? One sentence (Enter to write the plan yourself): ', '');
    const title = path.basename(root);
    const body = first
      ? `# ${title}\n\nDescribe the project here: stack, conventions, what "good" looks like. Every task sees this.\n\n- [ ] ${first.replace(/[\r\n]+/g, ' ')}\n  Add acceptance criteria here so "done" is checkable.\n`
      : `# ${title}\n\nDescribe the project here: stack, conventions, what "good" looks like. Every task sees this.\n\n- [ ] First task\n  Describe it concretely, with acceptance criteria. Keep each task small enough to verify.\n`;
    fs.writeFileSync(planPath, body);
    say(`     Created ${planFile}${first ? ' with your first task. Open it and add acceptance criteria.' : '. Open it and write your first task.'}`);
  }
  const gi = path.join(root, '.gitignore'); const cur = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  if (!/^\.orbit\/?$/m.test(cur)) fs.appendFileSync(gi, `${cur && !cur.endsWith('\n') ? '\n' : ''}.orbit/\n`);

  // optional proof that the agent works unattended here
  let tested = false, testOk = null;
  if (pick.path || pick.id === 'generic') {
    say('');
    if (yes(await ask('test-now', `Test ${pick.label} now? It runs one tiny task in a throwaway folder and uses a little quota. [y/N] `, ''), false)) {
      tested = true; say('Running (up to a few minutes)...');
      const r = await testAdapter(require('./policy').normalizePolicy(policy));
      testOk = r.ok;
      for (const c of r.checks) say(`  ${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}${c.detail ? ' - ' + c.detail : ''}`);
      if (!r.ok) { if (r.hint) say(`\n${r.hint}`); if (r.errorTail) say(`\nWhat it said:\n${r.errorTail}`); }
    }
  }
  say(`\nAll set. Next:\n  1. Open ${planFile} and make the tasks concrete.\n  2. orbit run --dry-run     (see the exact prompt, runs nothing)\n  3. orbit run\n${tested ? '' : '  (Before the first run, you can prove your agent works with: orbit adapter test ' + pick.id + ')\n'}Type "orbit" any time to see the next step.`);
  return { ok: true, policy, tested, testOk };
}

module.exports = { runSetup, suggestVerify };
