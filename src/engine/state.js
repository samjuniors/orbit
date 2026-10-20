const fs = require('node:fs');
const path = require('node:path');

function paths(root) {
  const dir = path.join(root, '.orbit');
  return { dir, state: path.join(dir, 'state.json'), log: path.join(dir, 'run.log'), report: path.join(dir, 'report.md'), approvals: path.join(dir, 'approvals'), worktrees: path.join(dir, 'worktrees'), lock: path.join(dir, 'lock') };
}

function loadState(root) {
  try { return JSON.parse(fs.readFileSync(paths(root).state, 'utf8')); } catch { return null; }
}

// Atomic write: a crash or power loss mid-save can never leave a half-written state file.
function saveState(root, state) {
  const p = paths(root);
  fs.mkdirSync(p.dir, { recursive: true });
  state.updatedAt = new Date().toISOString();
  const tmp = `${p.state}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, p.state);
}

function appendLog(root, line) {
  const p = paths(root);
  fs.mkdirSync(p.dir, { recursive: true });
  fs.appendFileSync(p.log, `${new Date().toISOString()}  ${line}\n`);
}

// One run per project at a time. A stale lock (dead pid) is taken over.
function acquireLock(root) {
  const p = paths(root);
  fs.mkdirSync(p.dir, { recursive: true });
  let other = 0;
  try { other = parseInt(fs.readFileSync(p.lock, 'utf8'), 10) || 0; } catch {}
  if (other && other !== process.pid) {
    let alive = true;
    try { process.kill(other, 0); } catch (e) { alive = e.code === 'EPERM'; }
    if (alive) throw new Error(`Another orbit run (pid ${other}) is already using this project. Stop it first, or delete ${p.lock} if that process is gone.`);
  }
  fs.writeFileSync(p.lock, String(process.pid));
  return () => { try { if (fs.readFileSync(p.lock, 'utf8') === String(process.pid)) fs.rmSync(p.lock); } catch {} };
}

module.exports = { paths, loadState, saveState, appendLog, acquireLock };
