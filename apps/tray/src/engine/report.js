const path = require('node:path');

function dur(ms) { if (!ms) return '-'; const s = Math.round(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; }
const ICON = { done: 'DONE', blocked: 'NEEDS YOU', pending: 'pending', running: 'interrupted', verifying: 'interrupted', 'awaiting-approval': 'AWAITING APPROVAL' };

// Markdown "morning report": what passed (with proof), what needs you, how to review.
function renderReport({ state, plan, policy }) {
  const tasks = plan.tasks.map(t => ({ ...t, s: state.tasks[t.id] || { status: t.done ? 'done' : 'pending', attempts: 0 } }));
  const count = k => tasks.filter(t => t.s.status === k).length;
  const out = [];
  out.push(`# ORBIT run report: ${plan.title}`);
  out.push('');
  out.push(`Run \`${state.runId}\` on branch \`${state.branch}\` - status **${state.status}**${state.stopReason ? ` (${state.stopReason})` : ''}`);
  out.push(`Started ${state.startedAt}, last update ${state.updatedAt}.`);
  out.push('');
  out.push(`**${count('done')} done**, ${count('blocked')} need you, ${count('awaiting-approval')} awaiting approval, ${tasks.length - count('done') - count('blocked') - count('awaiting-approval')} not finished.`);
  out.push(policy.verify ? `Verification command: \`${policy.verify}\` (a task is only DONE if it passed).` : 'WARNING: no verification command was configured, so DONE only means "the agent exited without error".');
  out.push('');
  out.push('| Task | Status | Attempts | Time | Verified | Commit |');
  out.push('|---|---|---|---|---|---|');
  for (const t of tasks) {
    const s = t.s;
    const time = s.startedAt && s.finishedAt ? dur(Date.parse(s.finishedAt) - Date.parse(s.startedAt)) : '-';
    const ver = s.verify ? (s.verify.ok ? 'passed' : 'FAILED') : (policy.verify ? '-' : 'n/a');
    out.push(`| ${t.id}: ${t.title.replace(/\|/g, '/')} | ${ICON[s.status] || s.status} | ${s.attempts} | ${time} | ${ver} | ${s.commit ? s.commit.slice(0, 8) : '-'} |`);
  }
  const needs = tasks.filter(t => t.s.status === 'blocked' || t.s.status === 'awaiting-approval');
  if (needs.length) {
    out.push('', '## Needs you');
    for (const t of needs) {
      out.push('', `### ${t.id}: ${t.title}`);
      if (t.s.status === 'awaiting-approval') out.push(`Waiting for your review. \`orbit approve ${t.id}\` or \`orbit reject ${t.id} "why"\`.`);
      else out.push(`Blocked after ${t.s.attempts} attempt(s). Fix the cause (or edit the task in the plan), then run \`orbit run\` again; it resumes in the same worktree.`);
      if (t.s.lastError) out.push('', '```', String(t.s.lastError).slice(-1500), '```');
    }
  }
  const done = tasks.filter(t => t.s.status === 'done');
  if (done.length) {
    out.push('', '## What was done');
    for (const t of done) { out.push('', `### ${t.id}: ${t.title}`); if (t.s.stat) out.push('```', t.s.stat.trim().slice(0, 800), '```'); if (t.s.summary) out.push('', `Agent summary: ${t.s.summary.trim().slice(-600).replace(/\n/g, ' ')}`); }
  }
  out.push('', '## Review it', '', '```', `git -C "${state.worktree}" log --stat ${state.baseSha ? state.baseSha.slice(0, 8) + '..' : ''}HEAD`, `git diff ${state.baseSha ? state.baseSha.slice(0, 8) : 'main'}..${state.branch}`, '```', '', `Nothing was pushed or merged unless your policy allowed it. Merge \`${state.branch}\` yourself when satisfied.`);
  return out.join('\n') + '\n';
}

module.exports = { renderReport, dur };
