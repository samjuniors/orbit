const fs = require('node:fs');
const path = require('node:path');
const { parsePlan } = require('./plan');
const { loadPolicy } = require('./policy');
const { loadState } = require('./state');

// `orbit` with no arguments: look at the situation and say the ONE thing to do next.
function nextStep({ root, planFile = 'PLAN.md', policyFile = 'orbit.policy.json' }) {
  const planPath = path.join(root, planFile);
  if (!fs.existsSync(planPath)) return ['No plan in this folder yet.', '', 'Start with:  orbit setup     (guided, about a minute)', 'or:          orbit init      (just create the template files)'];
  let policy;
  try { policy = loadPolicy(path.join(root, policyFile)); } catch (e) { return ['Your policy file has a problem:', `  ${e.message}`, '', 'Fix it, then run:  orbit doctor']; }
  let plan;
  try { plan = parsePlan(fs.readFileSync(planPath, 'utf8')); } catch (e) { return ['Your plan has a problem:', `  ${e.message}`]; }
  const state = loadState(root);
  const st = id => state?.tasks[id]?.status;
  const waiting = plan.tasks.find(t => st(t.id) === 'awaiting-approval');
  if (waiting) return [`${waiting.id} is waiting for your review: ${waiting.title}`, '', `If a run is open, answer there. Otherwise:  orbit approve ${waiting.id}   (or: orbit reject ${waiting.id} "what to change")`];
  const blocked = plan.tasks.find(t => st(t.id) === 'blocked');
  if (blocked) return [`${blocked.id} needs you: ${blocked.title}`, ...String(state.tasks[blocked.id].lastError || '').split('\n').filter(Boolean).slice(0, 3).map(l => '  ' + l), '', 'Fix the cause or edit the task in PLAN.md, then:  orbit run'];
  const todo = plan.tasks.filter(t => !t.done && st(t.id) !== 'done');
  if (todo.length) {
    const out = [`${todo.length} task${todo.length > 1 ? 's' : ''} to do${state && ['running', 'stopped'].includes(state.status) ? ' (an earlier run will resume where it stopped)' : ''}.`];
    if (!policy.verify && !policy.allowUnverified) out.push('', 'First set "verify" in orbit.policy.json (for example "npm test"). ORBIT will not call work done without proof.');
    out.push('', 'Preview the first prompt:  orbit run --dry-run', 'Start:                     orbit run');
    return out;
  }
  return ['Everything in the plan is done.', state ? `Work is on branch ${state.branch}.` : '', '', 'See what happened:  orbit report'].filter((l, i, a) => l !== '' || a[i - 1] !== '');
}

module.exports = { nextStep };
