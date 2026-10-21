const { spawn, spawnSync } = require('node:child_process');

const CAP = 200000; // keep only the tail of very chatty agents
const live = new Set(); // children still running, so Ctrl+C / shutdown can stop them

function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') { try { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch {} }
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} } }
}

// Runs a process to completion. Never rejects on a non-zero exit: callers get
// { code, stdout, stderr, timedOut, stalled, durationMs } and decide what it means.
//  - timeoutMs: hard wall-clock limit (0 = none)
//  - stallMs: kill if there is no output at all for this long (0 = off). This is the
//    safety net for an agent that is silently waiting on input nobody can give.
function runProcess({ exe, args = [], cwd, env = {}, timeoutMs = 0, stallMs = 0, onOutput, onStructuredEvent, structuredOutput = false, shellCommand }) {
  return new Promise(resolve => {
    const started = Date.now();
    const fullEnv = { ...process.env, CI: '1', NO_COLOR: '1', ...env };
    let command = exe, commandArgs = args, shell = false;
    if (shellCommand) { command = shellCommand; commandArgs = []; shell = true; }
    else if (/\.(cmd|bat)$/i.test(exe || '')) {
      // .cmd/.bat shims cannot be spawned directly without a shell. Pass args through
      // PowerShell as base64 JSON so prompt text can never be interpreted as shell syntax.
      fullEnv.ORBIT_EXE = exe;
      fullEnv.ORBIT_ARGS_B64 = Buffer.from(JSON.stringify(args), 'utf8').toString('base64');
      command = 'powershell.exe';
      commandArgs = ['-NoProfile', '-NonInteractive', '-Command', '$a = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ORBIT_ARGS_B64))); & $env:ORBIT_EXE @a'];
    }
    let child;
    try { child = spawn(command, commandArgs, { cwd, env: fullEnv, shell, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (err) { resolve({ code: null, stdout: '', stderr: err.message, timedOut: false, stalled: false, durationMs: 0, spawnError: err.message }); return; }
    live.add(child);
    let stdout = '', stderr = '', timedOut = false, stalled = false, done = false, stallTimer = null, structuredRateLimited = false;
    const parser = structuredOutput ? new (require('./structured-output').JsonlEventParser)(event => {
      if (event.rateLimited) structuredRateLimited = true;
      try { onStructuredEvent?.(event); } catch {}
    }) : null;
    const finish = (code, extra = {}) => { if (done) return; done = true; live.delete(child); clearTimeout(hardTimer); clearTimeout(stallTimer); parser?.end(); resolve({ code, stdout, stderr, timedOut, stalled, structuredRateLimited, durationMs: Date.now() - started, ...extra }); };
    const hardTimer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs) : null;
    const armStall = () => { if (!(stallMs > 0)) return; clearTimeout(stallTimer); stallTimer = setTimeout(() => { stalled = true; killTree(child); }, stallMs); };
    armStall();
    const take = (stream, buf) => chunk => { const s = chunk.toString(); armStall(); onOutput?.({ stream, text: s }); return s; };
    child.stdout.on('data', c => { parser?.push(c); const s = take('stdout')(c); stdout = (stdout + s).slice(-CAP); });
    child.stderr.on('data', c => { const s = take('stderr')(c); stderr = (stderr + s).slice(-CAP); });
    child.on('error', err => finish(null, { spawnError: err.message }));
    child.on('close', code => finish(code));
  });
}

function killAll() { for (const c of live) killTree(c); live.clear(); }

module.exports = { runProcess, killTree, killAll };
