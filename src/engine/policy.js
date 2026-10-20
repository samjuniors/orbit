const fs = require('node:fs');

const ADAPTER_IDS = ['claude-code', 'codex', 'antigravity', 'opencode', 'grok', 'generic'];
// Actions a policy can allow or block. deploy and git.force-push are locked:
// they can never be allowed. (deploy can only be enforced at the prompt level
// and via the git/gh guard -- see docs/POLICY.md for the honest limits.)
const RULE_DEFAULTS = { 'git.push': 'block', 'git.merge': 'block', 'pr.create': 'block', 'git.force-push': 'block', deploy: 'block' };
const LOCKED = ['git.force-push', 'deploy'];

const DEFAULTS = {
  agent: 'claude-code',
  agentArgs: [],
  agentCommand: null,
  agentPath: null,
  verify: null,
  allowUnverified: false,
  allowNoChanges: false,
  baseBranch: 'HEAD',
  approval: 'none',          // none | each-task
  onBlocked: 'stop',         // stop | skip
  limits: { maxAttempts: 3, taskTimeoutMin: 30, stallMin: 10, verifyTimeoutMin: 10, maxTasks: 0, maxRuntimeMin: 0, rateLimitWaitMin: 30, maxRateLimitWaits: 6 },
  rules: { ...RULE_DEFAULTS }
};

function num(v, name, min = 0) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min) throw new Error(`policy.limits.${name} must be a number >= ${min}.`);
  return v;
}

function normalizePolicy(raw = {}) {
  const p = { ...DEFAULTS, ...raw, limits: { ...DEFAULTS.limits, ...(raw.limits || {}) }, rules: { ...RULE_DEFAULTS, ...(raw.rules || {}) } };
  if (!ADAPTER_IDS.includes(p.agent)) throw new Error(`policy.agent must be one of: ${ADAPTER_IDS.join(', ')}.`);
  if (p.agent === 'generic' && !(Array.isArray(p.agentCommand) && p.agentCommand.length)) throw new Error('policy.agentCommand (array, e.g. ["mycli","--prompt","{prompt}"]) is required for the generic agent.');
  if (!Array.isArray(p.agentArgs) || p.agentArgs.some(a => typeof a !== 'string')) throw new Error('policy.agentArgs must be an array of strings.');
  if (!['none', 'each-task'].includes(p.approval)) throw new Error('policy.approval must be "none" or "each-task".');
  if (!['stop', 'skip'].includes(p.onBlocked)) throw new Error('policy.onBlocked must be "stop" or "skip".');
  if (p.verify != null && typeof p.verify !== 'string') throw new Error('policy.verify must be a command string or null.');
  for (const [k, min] of [['maxAttempts', 1], ['taskTimeoutMin', 0], ['stallMin', 0], ['verifyTimeoutMin', 0], ['maxTasks', 0], ['maxRuntimeMin', 0], ['rateLimitWaitMin', 0], ['maxRateLimitWaits', 0]]) num(p.limits[k], k, min);
  for (const [action, effect] of Object.entries(p.rules)) {
    if (!(action in RULE_DEFAULTS)) throw new Error(`Unknown policy rule "${action}". Known: ${Object.keys(RULE_DEFAULTS).join(', ')}.`);
    if (effect === 'approve') throw new Error(`policy.rules["${action}"]: "approve" is not supported mid-run (an unattended agent cannot wait on you). Use "allow" or "block", and set policy.approval to "each-task" for a human checkpoint after every task.`);
    if (!['allow', 'block'].includes(effect)) throw new Error(`policy.rules["${action}"] must be "allow" or "block".`);
    if (LOCKED.includes(action) && effect !== 'block') throw new Error(`policy.rules["${action}"] is locked to "block" and cannot be allowed.`);
  }
  return p;
}

function loadPolicy(file) {
  let raw = {};
  if (fs.existsSync(file)) {
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`Could not parse ${file}: ${e.message}`); }
  }
  return normalizePolicy(raw);
}

function guardAllow(policy) {
  return { push: policy.rules['git.push'] === 'allow', merge: policy.rules['git.merge'] === 'allow', pr: policy.rules['pr.create'] === 'allow' };
}

module.exports = { ADAPTER_IDS, DEFAULTS, normalizePolicy, loadPolicy, guardAllow, LOCKED };
