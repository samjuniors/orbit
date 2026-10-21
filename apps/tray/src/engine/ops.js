// Small operations shared by the CLI and the MCP server.
const fs = require('node:fs');
const path = require('node:path');
const { parsePlan } = require('./plan');
const { loadState, paths } = require('./state');

// An agent launched BY orbit gets ORBIT_AGENT_RUN=1 in its environment (and so do any MCP servers
// or CLIs it starts). Anything that changes what orbit will do next refuses to run there, so an
// agent cannot approve its own work or rewrite its own plan. (Not a sandbox: see docs/POLICY.md.)
function refuseInsideAgentRun(env = process.env) {
  if (env.ORBIT_AGENT_RUN) throw new Error('This action is disabled inside an ORBIT-run agent: only you can approve, reject or add tasks.');
}

function statusText({ root, planFile = 'PLAN.md' }) {
  const plan = parsePlan(fs.readFileSync(path.join(root, planFile), 'utf8'));
  const s = loadState(root);
  const head = s ? `Run ${s.runId} on branch ${s.branch}: ${s.status}${s.stopReason ? ' (' + s.stopReason + ')' : ''}` : 'No run yet.';
  const rows = plan.tasks.map(t => { const x = s?.tasks[t.id]; return `${(x?.status || (t.done ? 'done' : 'pending')).padEnd(18)} ${t.id}: ${t.title}${x?.attempts ? ` (${x.attempts} attempt${x.attempts > 1 ? 's' : ''})` : ''}`; });
  return [head, ...rows].join('\n');
}

function decide({ root, planFile = 'PLAN.md', id, kind, reason = '', env = process.env }) {
  refuseInsideAgentRun(env);
  const plan = parsePlan(fs.readFileSync(path.join(root, planFile), 'utf8'));
  if (!plan.tasks.some(t => t.id === id)) throw new Error(`No task "${id}" in ${planFile}. Known ids: ${plan.tasks.map(t => t.id).join(', ')}`);
  const st = loadState(root)?.tasks[id]?.status;
  fs.mkdirSync(paths(root).approvals, { recursive: true });
  fs.writeFileSync(path.join(paths(root).approvals, `${id}.${kind}`), reason);
  return st === 'awaiting-approval' ? `${kind === 'approve' ? 'Approved' : 'Sent back'} ${id}.` : `Recorded ${kind} for ${id}, but it is not waiting for approval right now (status: ${st || 'not started'}). It applies when the task reaches review.`;
}

function addTask({ root, planFile = 'PLAN.md', title, details = '', env = process.env }) {
  refuseInsideAgentRun(env);
  const clean = String(title || '').replace(/[\r\n]+/g, ' ').trim();
  if (!clean) throw new Error('A task needs a title.');
  const file = path.join(root, planFile);
  let text = fs.readFileSync(file, 'utf8');
  if (!text.endsWith('\n')) text += '\n';
  const body = String(details || '').split(/\r?\n/).filter(l => l.trim()).map(l => '  ' + l.trim()).join('\n');
  fs.writeFileSync(file, `${text}- [ ] ${clean}\n${body ? body + '\n' : ''}`);
  const plan = parsePlan(fs.readFileSync(file, 'utf8'));
  return plan.tasks[plan.tasks.length - 1].id;
}

module.exports = { refuseInsideAgentRun, statusText, decide, addTask };
