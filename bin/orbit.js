#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { parsePlan } = require('../src/engine/plan');
const { loadPolicy, DEFAULTS, ADAPTER_IDS } = require('../src/engine/policy');
const { runPlan, previewNext } = require('../src/engine/engine');
const { detect, ADAPTERS } = require('../src/engine/adapters');
const { paths, loadState } = require('../src/engine/state');
const { killAll } = require('../src/engine/process');
const { spawnSync } = require('node:child_process');
const pkg = require('../package.json');

const HELP = `orbit ${pkg.version} - run a plan through your coding agent, unattended, with proof.

Usage: orbit <command> [options]
  init                 create PLAN.md and orbit.policy.json in this folder
  doctor               check git, the agent CLI, your policy and your plan
  run [--dry-run]      work through the plan task by task (resumes automatically)
  status               show where the current run is
  report               print the latest report (also saved to .orbit/report.md)
  approve <id>         approve a task that is waiting for you (policy.approval: each-task)
  reject <id> [why]    send a task back to the agent with your feedback

Options: --dir <folder>  --plan <file> (default PLAN.md)  --policy <file> (default orbit.policy.json)  --verbose (stream agent output)
Exit codes: 0 all done, 2 a task needs you, 3 stopped by a limit, 1 error.`;

function parseArgs(argv) {
  const o = { _: [], dir: process.cwd(), plan: 'PLAN.md', policy: 'orbit.policy.json', verbose: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') o.dir = path.resolve(argv[++i]);
    else if (a === '--plan') o.plan = argv[++i];
    else if (a === '--policy') o.policy = argv[++i];
    else if (a === '--verbose') o.verbose = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else o._.push(a);
  }
  return o;
}

const PLAN_TEMPLATE = `# My project

Describe the project here: stack, conventions, what "good" looks like. Every task sees this.

- [ ] Scaffold the project
  Set up the project structure and a passing test command.
- [ ] Add the first feature
  Describe it concretely, with acceptance criteria. Keep each task small enough to verify.
`;

function init(o) {
  const planPath = path.join(o.dir, o.plan), polPath = path.join(o.dir, o.policy);
  if (!fs.existsSync(planPath)) { fs.writeFileSync(planPath, PLAN_TEMPLATE); console.log(`Created ${o.plan}`); } else console.log(`${o.plan} already exists, left alone.`);
  if (!fs.existsSync(polPath)) {
    fs.writeFileSync(polPath, JSON.stringify({ agent: 'claude-code', agentArgs: [], verify: 'npm test', approval: 'none', limits: { maxAttempts: 3, taskTimeoutMin: 30, stallMin: 10, maxTasks: 0, maxRuntimeMin: 0 }, rules: { 'git.push': 'block', 'git.merge': 'block', 'pr.create': 'block' } }, null, 2) + '\n');
    console.log(`Created ${o.policy} (edit "agent" and "verify" before your first run)`);
  } else console.log(`${o.policy} already exists, left alone.`);
  const gi = path.join(o.dir, '.gitignore');
  const cur = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  if (!/^\.orbit\/?$/m.test(cur)) { fs.appendFileSync(gi, `${cur && !cur.endsWith('\n') ? '\n' : ''}.orbit/\n`); console.log('Added .orbit/ to .gitignore'); }
  console.log('\nNext: orbit doctor, then orbit run');
}

function doctor(o) {
  let bad = 0;
  const row = (ok, label, detail) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ' - ' + detail : ''}`); };
  row(Number(process.versions.node.split('.')[0]) >= 20, 'Node.js >= 20', process.version);
  const g = spawnSync('git', ['--version'], { encoding: 'utf8' });
  row(g.status === 0, 'git', (g.stdout || 'not found').trim());
  row(spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: o.dir }).status === 0, 'this folder is a git repository');
  let policy = null;
  try { policy = loadPolicy(path.join(o.dir, o.policy)); row(true, `policy ${o.policy}`, `agent=${policy.agent}`); } catch (e) { row(false, `policy ${o.policy}`, e.message); }
  try { const plan = parsePlan(fs.readFileSync(path.join(o.dir, o.plan), 'utf8')); row(plan.tasks.length > 0, `plan ${o.plan}`, `${plan.tasks.length} task(s), ${plan.tasks.filter(t => !t.done).length} to do`); } catch (e) { row(false, `plan ${o.plan}`, e.message); }
  if (policy) {
    row(Boolean(policy.verify) || policy.allowUnverified, 'verification command', policy.verify || (policy.allowUnverified ? 'none (allowUnverified)' : 'NOT SET - orbit will refuse to run'));
    const exe = detect(policy.agent, policy);
    row(Boolean(exe), `agent CLI "${policy.agent}"`, exe || 'not found on PATH (install + sign in, or set agentPath)');
  }
  console.log('\nOther agents found on this machine:');
  for (const id of ADAPTER_IDS.filter(x => x !== 'generic')) { const e = detect(id); console.log(`  ${e ? 'yes' : ' no'}  ${id}${e ? '  ' + e : ''}`); }
  console.log(bad ? `\n${bad} problem(s) to fix.` : '\nAll good. Try: orbit run --dry-run');
  return bad ? 1 : 0;
}

function status(o) {
  const s = loadState(o.dir);
  if (!s) { console.log('No run yet. Start one with: orbit run'); return 0; }
  console.log(`Run ${s.runId}  branch ${s.branch}  status ${s.status}${s.stopReason ? ' (' + s.stopReason + ')' : ''}`);
  const plan = parsePlan(fs.readFileSync(path.join(o.dir, o.plan), 'utf8'));
  for (const t of plan.tasks) { const x = s.tasks[t.id]; console.log(`  ${(x?.status || (t.done ? 'done' : 'pending')).padEnd(18)} ${t.id}: ${t.title}${x?.attempts ? `  (${x.attempts} attempt${x.attempts > 1 ? 's' : ''})` : ''}`); }
  return 0;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const cmd = o._[0];
  if (o.version) { console.log(pkg.version); return 0; }
  if (o.help || !cmd || cmd === 'help') { console.log(HELP); return 0; }
  if (cmd === 'init') { init(o); return 0; }
  if (cmd === 'doctor') return doctor(o);
  if (cmd === 'status') return status(o);
  if (cmd === 'report') { const f = paths(o.dir).report; if (!fs.existsSync(f)) { console.log('No report yet. Run: orbit run'); return 0; } process.stdout.write(fs.readFileSync(f, 'utf8')); return 0; }
  if (cmd === 'approve' || cmd === 'reject') {
    const id = o._[1]; if (!id) { console.error(`Usage: orbit ${cmd} <task-id>${cmd === 'reject' ? ' [reason]' : ''}`); return 1; }
    const s = loadState(o.dir);
    if (s && s.tasks[id] && s.tasks[id].status !== 'awaiting-approval') console.log(`Note: ${id} is not currently awaiting approval (status: ${s.tasks[id].status}).`);
    fs.mkdirSync(paths(o.dir).approvals, { recursive: true });
    fs.writeFileSync(path.join(paths(o.dir).approvals, `${id}.${cmd}`), o._.slice(2).join(' '));
    console.log(`${cmd === 'approve' ? 'Approved' : 'Rejected'} ${id}.`);
    return 0;
  }
  if (cmd === 'run') {
    const policy = loadPolicy(path.join(o.dir, o.policy));
    if (o.dryRun) {
      const next = previewNext({ root: o.dir, planFile: o.plan, policy });
      if (!next) { console.log('Nothing to do: every task is done.'); return 0; }
      console.log(`Next task: ${next.task.id}: ${next.task.title}\nAgent: ${policy.agent}   Verify: ${policy.verify || '(none)'}\n\n--- prompt the agent would receive ---\n${next.prompt}`);
      return 0;
    }
    const stop = () => { killAll(); console.error('\nInterrupted. Progress is saved; run `orbit run` again to resume.'); process.exit(130); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    const io = { log: m => console.log(`[orbit] ${m}`), onOutput: o.verbose ? e => process.stdout.write(e.text) : null, sleep: ms => new Promise(r => setTimeout(r, ms)), now: () => Date.now() };
    const r = await runPlan({ root: o.dir, planFile: o.plan, policy, io });
    return r.exitCode;
  }
  console.error(`Unknown command "${cmd}".\n\n${HELP}`);
  return 1;
}

main().then(code => process.exit(code), err => { console.error(`orbit: ${err.message}`); process.exit(1); });
