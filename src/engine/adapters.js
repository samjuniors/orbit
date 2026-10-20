const fs = require('node:fs');
const path = require('node:path');

// Flags below come from each vendor's headless/non-interactive mode. They are
// starting points: run `orbit doctor` and check `<agent> --help` on your machine,
// and put permission flags in policy.agentArgs (e.g. a tool allow-list).
// Anything unusual: use agent "generic" with policy.agentCommand.
const ADAPTERS = {
  'claude-code': { label: 'Claude Code', hint: "Unattended runs need a non-prompting permission setup (an allowed-tools list or permission mode). Check `claude --help` and put the flags in policy.agentArgs.", exes: ['claude'], args: (prompt, o) => [...o.extra, '-p', prompt] },
  codex: { label: 'OpenAI Codex CLI', hint: "Unattended runs need a sandbox/approval setting that does not prompt. Check `codex exec --help` and put the flags in policy.agentArgs.", exes: ['codex'], args: (prompt, o) => ['exec', ...o.extra, prompt] },
  antigravity: { label: 'Antigravity CLI', hint: "Make sure the CLI is signed in and headless mode works (`agy -p \"hi\"`). Permission flags go in policy.agentArgs.", exes: ['agy', 'antigravity'], args: (prompt, o) => [...o.extra, '-p', prompt, '--output-format', 'stream-json'] },
  opencode: { label: 'OpenCode', hint: "Make sure a provider is configured and `opencode run \"hi\"` works. Permission settings live in opencode's own config.", exes: ['opencode'], args: (prompt, o) => ['run', ...o.extra, '--dir', path.resolve(o.cwd), '--format', 'json', prompt] },
  grok: { label: 'Grok Build', hint: "Needs XAI_API_KEY or a signed-in session; use a non-prompting permission mode (e.g. dontAsk with allow rules). Check `grok --help`.", exes: ['grok'], args: (prompt, o) => [...o.extra, '-p', prompt] },
  generic: { label: 'Custom command', exes: [], args: null, hint: 'Any CLI that takes a prompt and exits when finished. See docs/ADAPTERS.md.' }
};

function resolveExe(names, pathEnv = process.env.PATH || '') {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean) : [''];
  for (const dir of pathEnv.split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      for (const ext of exts) {
        const candidate = path.join(dir, name + (name.includes('.') && ext && name.toLowerCase().endsWith(ext.toLowerCase()) ? '' : ext));
        try { if (fs.statSync(candidate).isFile()) return candidate; } catch {}
      }
    }
  }
  return null;
}

function detect(agentId, policy = {}) {
  const a = ADAPTERS[agentId];
  if (!a) return null;
  if (agentId === 'generic') { const exe = policy.agentCommand?.[0]; return exe ? (path.isAbsolute(exe) ? exe : resolveExe([exe]) || exe) : null; }
  return policy.agentPath || resolveExe(a.exes);
}

// Returns { exe, args }. {prompt} inside policy.agentCommand is replaced by the
// prompt; the prompt is also always available as $ORBIT_PROMPT_FILE.
function buildInvocation(policy, { prompt, cwd }) {
  const exe = detect(policy.agent, policy);
  if (!exe) throw new Error(`Could not find the "${policy.agent}" CLI on PATH. Install it and sign in, set policy.agentPath, or run \`orbit doctor\`.`);
  if (policy.agent === 'generic') {
    const [, ...rest] = policy.agentCommand;
    return { exe, args: rest.map(x => x.split('{prompt}').join(prompt)) };
  }
  return { exe, args: ADAPTERS[policy.agent].args(prompt, { cwd, extra: policy.agentArgs || [] }) };
}

function listAdapters(policy = {}) { return Object.entries(ADAPTERS).map(([id, a]) => ({ id, label: a.label, hint: a.hint, path: id === 'generic' ? null : detect(id, id === policy.agent ? policy : {}) })); }

module.exports = { ADAPTERS, resolveExe, detect, buildInvocation, listAdapters };
