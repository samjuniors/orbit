const { spawn } = require('node:child_process');
const path = require('node:path');

function quotePrompt(text) { return String(text).replace(/\u0000/g, ''); }
function runProcess(executable, args, cwd, onOutput, { timeoutMs = 60 * 60 * 1000, extraEnv = {} } = {}) {
  return new Promise((resolve, reject) => {
    const isBatch = /\.(cmd|bat)$/i.test(executable);
    const env = { ...process.env, CI: '1', NO_COLOR: '1', ...extraEnv };
    let command = executable, commandArgs = args;
    if (isBatch) {
      env.ORBIT_AGENT_EXE = executable;
      env.ORBIT_AGENT_ARGS_B64 = Buffer.from(JSON.stringify(args), 'utf8').toString('base64');
      command = 'powershell.exe';
      commandArgs = ['-NoProfile', '-NonInteractive', '-Command', '$a = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ORBIT_AGENT_ARGS_B64))); & $env:ORBIT_AGENT_EXE @a'];
    }
    const child = spawn(command, commandArgs, { cwd, windowsHide: true, shell: false, env });
    let stdout = '', stderr = '', settled = false;
    const timer = setTimeout(() => { child.kill(); finish(new Error('Agent task exceeded the 60-minute execution limit.')); }, timeoutMs);
    const finish = (err, result) => { if (settled) return; settled = true; clearTimeout(timer); err ? reject(err) : resolve(result); };
    child.stdout.on('data', chunk => { const s = chunk.toString(); stdout += s; onOutput?.({ stream: 'stdout', text: s }); });
    child.stderr.on('data', chunk => { const s = chunk.toString(); stderr += s; onOutput?.({ stream: 'stderr', text: s }); });
    child.on('error', err => finish(err));
    child.on('close', code => code === 0 ? finish(null, { code, stdout, stderr }) : finish(new Error(`Agent exited with code ${code}. ${stderr.slice(-3000)}`)));
  });
}
function buildAgentInvocation(agent, cwd, prompt) {
  const cleanPrompt = quotePrompt(prompt);
  if (!agent.executable) throw new Error(`No executable configured for ${agent.id}.`);
  if (agent.id === 'antigravity') return { executable: agent.executable, args: ['-p', cleanPrompt, '--output-format', 'stream-json', '--print-timeout', '60m'] };
  if (agent.id === 'opencode') return { executable: agent.executable, args: ['run', '--dir', path.resolve(cwd), '--format', 'json', cleanPrompt] };
  throw new Error(`Unsupported agent adapter: ${agent.id}`);
}
async function executeAgent({ agent, prompt, cwd, onOutput, extraEnv }) {
  const invocation = buildAgentInvocation(agent, cwd, prompt);
  return runProcess(invocation.executable, invocation.args, cwd, onOutput, { extraEnv });
}
module.exports = { executeAgent, buildAgentInvocation };