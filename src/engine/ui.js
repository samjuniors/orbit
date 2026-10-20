// Terminal UI. Principle: show only what matters right now.
//  - While work is going fine: a compact checklist that redraws in place.
//  - Long plans collapse (finished tasks fold into "N done").
//  - The moment something needs a human, the screen becomes one clear card with the next action
//    (and approvals can be answered inline, no second terminal).
//  - Non-interactive terminals (CI, pipes, --plain) get ordinary log lines.
const readline = require('node:readline');
const { dur } = require('./report');

const SYM = { unicode: { done: '✔', run: '▶', wait: '○', bad: '✖', ask: '●' }, ascii: { done: 'x', run: '>', wait: '.', bad: '!', ask: '?' } };
const SPIN = ['|', '/', '-', '\\'];
const PHASE = { agent: 'working', verify: 'checking your tests', approval: 'waiting for you', 'rate-wait': 'waiting out a usage limit' };
const trunc = (s, n) => (s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s);

function renderFrame(m, o = {}) {
  const width = Math.max(40, o.width || 80), sym = SYM[o.ascii ? 'ascii' : 'unicode'], now = o.now || Date.now();
  const c = o.color ? (code, s) => `\x1b[${code}m${s}\x1b[0m` : (_, s) => s;
  const lines = [c('1', trunc(`ORBIT  ${m.title || ''}${m.branch ? '  ·  ' + m.branch : ''}`, width - 2))];
  const tasks = m.tasks || [];
  let shown = tasks;
  if (tasks.length > 8) {
    const done = tasks.filter(t => t.status === 'done'), active = tasks.filter(t => t.status !== 'done');
    if (done.length) lines.push(c('32', `  ${sym.done} ${done.length} done`));
    shown = active.slice(0, 4);
    if (active.length > 4) shown = [...shown, { more: active.length - 4 }];
  }
  for (const t of shown) {
    if (t.more) { lines.push(c('2', `  ${sym.wait} +${t.more} more`)); continue; }
    const cur = m.current && m.current.id === t.id && !['done', 'blocked'].includes(t.status);
    let icon = sym.wait, detail = '', paint = s => s;
    if (t.status === 'done') { icon = sym.done; paint = s => c('32', s); detail = t.attempts > 1 ? `attempt ${t.attempts}` : ''; }
    else if (t.status === 'blocked') { icon = sym.bad; paint = s => c('31', s); detail = 'needs you'; }
    else if (t.status === 'awaiting-approval') { icon = sym.ask; paint = s => c('33', s); detail = 'waiting for you'; }
    else if (cur) { icon = sym.run; paint = s => c('36', s); const el = m.current.startedAt != null ? ' · ' + dur(now - m.current.startedAt) : ''; detail = `attempt ${m.current.attempt}/${m.current.max} · ${PHASE[m.current.phase] || 'working'} ${SPIN[Math.floor(now / 250) % 4]}${el}`; }
    else paint = s => c('2', s);
    const left = `  ${icon} ${t.id.padEnd(3)} ${t.title}`;
    const room = width - 2 - detail.length - 2;
    lines.push(paint(detail ? `${trunc(left, room).padEnd(room)}  ${detail}` : trunc(left, width - 2)));
  }
  if (m.attention) {
    lines.push('', c('33', `  ${sym.bad} ${m.attention.title}`));
    for (const l of m.attention.lines.slice(0, 6)) lines.push('    ' + trunc(l, width - 6));
    if (m.attention.next) lines.push(c('1', `    Next: ${m.attention.next}`));
  } else if (m.note) lines.push('', c('2', '  ' + trunc(m.note, width - 4)));
  return lines;
}

function createUi({ out = process.stdout, input = process.stdin, plain = false, now = Date.now } = {}) {
  const live = !plain && Boolean(out.isTTY) && !process.env.CI && process.env.TERM !== 'dumb';
  const ascii = process.platform === 'win32' && !process.env.WT_SESSION && !process.env.TERM_PROGRAM;
  const color = live && !process.env.NO_COLOR;
  const model = { title: '', branch: '', worktree: '', tasks: [], current: null, note: '', attention: null };
  let drawn = 0, timer = null;
  const clear = () => { if (drawn) out.write(`\x1b[${drawn}A\x1b[0J`); drawn = 0; };
  const draw = () => { if (!live) return; clear(); const f = renderFrame(model, { width: out.columns || 80, ascii, color, now: now() }); out.write(f.join('\n') + '\n'); drawn = f.length; };
  const start = () => { if (live && !timer) { timer = setInterval(draw, 250); timer.unref?.(); } };
  const stop = () => { if (timer) clearInterval(timer); timer = null; };
  const blockedCard = e => ({ title: `${e.id} needs you: ${e.title || ''}`, lines: String(e.error || '').split('\n').filter(Boolean).slice(0, 4), next: 'fix the cause or edit the task in PLAN.md, then run: orbit run' });

  return {
    live,
    log(msg) { if (live) { model.note = msg; draw(); } else out.write(`[orbit] ${msg}\n`); },
    event(e) {
      if (e.type === 'snapshot') { Object.assign(model, { title: e.title, branch: e.branch, worktree: e.worktree, tasks: e.tasks }); start(); }
      else if (e.type === 'phase') { if (!model.current || model.current.id !== e.id || model.current.attempt !== e.attempt) model.current = { id: e.id, attempt: e.attempt, max: e.max, startedAt: now() }; model.current.phase = e.phase; model.attention = null; }
      else if (e.type === 'task-blocked') model.attention = blockedCard(e);
      if (live) draw();
    },
    // Inline approval. Only offered on a real terminal; otherwise the engine falls back to `orbit approve`.
    ask: (live && input.isTTY) ? async ({ task, stat, commit }) => {
      stop(); clear();
      const statLines = String(stat || '').split('\n').filter(Boolean);
      out.write(`\n${task.id} is ready for your review: ${task.title}\n  commit ${String(commit || '').slice(0, 8)}\n${statLines.slice(0, 8).map(l => '  ' + l).join('\n')}\n`);
      const rl = readline.createInterface({ input, output: out });
      const q = p => new Promise(r => rl.question(p, r));
      try {
        for (;;) {
          const a = (await q('Approve?  [y] yes   [n] send back with feedback   [d] details > ')).trim().toLowerCase();
          if (a === 'y' || a === 'yes') return { approved: true };
          if (a === 'n' || a === 'no') return { approved: false, reason: (await q('What should change? ')).trim() };
          if (a === 'd') out.write(`${statLines.join('\n')}\n  full diff: git -C "${model.worktree}" show ${String(commit || '').slice(0, 8)}\n`);
        }
      } finally { rl.close(); start(); draw(); }
    } : undefined,
    finish(result) {
      stop(); clear();
      if (live) { model.note = ''; if (result.status !== 'blocked') model.attention = null; const f = renderFrame(model, { width: out.columns || 80, ascii, color, now: now() }); out.write(f.join('\n') + '\n'); }
      const done = model.tasks.filter(t => t.status === 'done').length;
      if (result.status === 'done') out.write(`\n${done} of ${model.tasks.length} tasks done. Nothing was pushed or merged.\nReview it: orbit report     (work is on branch ${model.branch})\n`);
      else if (result.status === 'stopped') out.write(`\nStopped: ${result.stopReason}. ${done} of ${model.tasks.length} done.\nContinue any time with: orbit run\n`);
      else if (!live) out.write(`\nA task needs you. See: orbit   (full details: orbit report)\n`);
      else out.write(`\nFull details: orbit report\n`);
    }
  };
}

module.exports = { renderFrame, createUi };
