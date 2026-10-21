// PLAN.md format (plain markdown, no account needed):
//   # My app
//   Any text before the first task is shared context for every task.
//   - [ ] Scaffold the project                 (id auto-assigned: T1, T2, ...)
//   - [ ] DB: Create the data model            (optional explicit id "DB:")
//     Indented lines under a task are that task's spec.
//   - [x] Already finished task
const TASK_RE = /^- \[( |x|X)\]\s+(?:([A-Za-z][A-Za-z0-9_.-]*):\s+)?(.+?)\s*$/;

function parsePlan(text) {
  const lines = String(text).split(/\r?\n/);
  const tasks = [];
  const preamble = [];
  let title = '';
  let current = null;
  const seen = new Set();
  lines.forEach((line, i) => {
    const m = TASK_RE.exec(line);
    if (m) {
      const id = m[2] || `T${tasks.length + 1}`;
      if (seen.has(id)) throw new Error(`Duplicate task id "${id}" (line ${i + 1}). Task ids must be unique.`);
      seen.add(id);
      current = { id, title: m[3], done: m[1] !== ' ', body: [], line: i };
      tasks.push(current);
      return;
    }
    if (/^#{1,6}\s/.test(line)) { current = null; if (!title && /^#\s/.test(line)) title = line.replace(/^#\s+/, '').trim(); if (!tasks.length) preamble.push(line); return; }
    if (current) current.body.push(line);
    else if (!tasks.length) preamble.push(line);
  });
  for (const t of tasks) t.body = t.body.join('\n').trim();
  return { title: title || 'Plan', preamble: preamble.join('\n').trim(), tasks };
}

function markDone(text, id) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const plan = parsePlan(text);
  const task = plan.tasks.find(t => t.id === id);
  if (!task) return text;
  lines[task.line] = lines[task.line].replace('- [ ]', '- [x]');
  return lines.join(eol);
}

module.exports = { parsePlan, markDone };
