// Minimal MCP server over stdio (JSON-RPC 2.0, one message per line). Lets a chat/coding agent
// that YOU are talking to check progress, read the report, add tasks and approve work.
// Written against the public MCP spec and tested with a simulated client; not yet verified
// against every real client.
const fs = require('node:fs');
const readline = require('node:readline');
const { nextStep } = require('./next');
const { statusText, decide, addTask } = require('./ops');
const { paths } = require('./state');
const pkg = require('../../package.json');

const TOOLS = [
  { name: 'orbit_next', description: 'What is the single next thing to do in this ORBIT project?', inputSchema: { type: 'object', properties: {} } },
  { name: 'orbit_status', description: 'List every task in the plan with its current status.', inputSchema: { type: 'object', properties: {} } },
  { name: 'orbit_report', description: 'Read the latest run report (what passed, what needs the user).', inputSchema: { type: 'object', properties: {} } },
  { name: 'orbit_add_task', description: 'Append a new task to the end of PLAN.md. Never edits or removes existing tasks.', inputSchema: { type: 'object', properties: { title: { type: 'string' }, details: { type: 'string', description: 'Optional spec lines for the task' } }, required: ['title'] } },
  { name: 'orbit_approve', description: 'Approve a task that is waiting for review (only when the USER asked you to).', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'orbit_reject', description: 'Send a reviewed task back to the agent with feedback (only when the USER asked you to).', inputSchema: { type: 'object', properties: { id: { type: 'string' }, reason: { type: 'string' } }, required: ['id', 'reason'] } }
];

function createHandler({ root, planFile = 'PLAN.md', policyFile = 'orbit.policy.json', env = process.env }) {
  const run = {
    orbit_next: () => nextStep({ root, planFile, policyFile }).join('\n'),
    orbit_status: () => statusText({ root, planFile }),
    orbit_report: () => { const f = paths(root).report; return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : 'No report yet. Nothing has run.'; },
    orbit_add_task: a => `Added ${addTask({ root, planFile, title: a.title, details: a.details, env })}: ${a.title}`,
    orbit_approve: a => decide({ root, planFile, id: a.id, kind: 'approve', env }),
    orbit_reject: a => decide({ root, planFile, id: a.id, kind: 'reject', reason: a.reason, env })
  };
  return function handle(msg) {
    const reply = result => ({ jsonrpc: '2.0', id: msg.id, result });
    const fail = (code, message) => ({ jsonrpc: '2.0', id: msg.id, error: { code, message } });
    if (msg.id === undefined) return null; // notifications need no reply
    switch (msg.method) {
      case 'initialize': return reply({ protocolVersion: (msg.params && msg.params.protocolVersion) || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'orbit', version: pkg.version } });
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: TOOLS });
      case 'tools/call': {
        const name = msg.params && msg.params.name;
        if (!run[name]) return fail(-32602, `Unknown tool: ${name}`);
        try { return reply({ content: [{ type: 'text', text: String(run[name](msg.params.arguments || {})) }] }); }
        catch (e) { return reply({ content: [{ type: 'text', text: e.message }], isError: true }); }
      }
      default: return fail(-32601, `Method not found: ${msg.method}`);
    }
  };
}

function serve(opts, input = process.stdin, output = process.stdout) {
  const handle = createHandler(opts);
  const rl = readline.createInterface({ input });
  rl.on('line', line => {
    if (!line.trim()) return;
    let msg; try { msg = JSON.parse(line); } catch { output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); return; }
    const res = handle(msg); if (res) output.write(JSON.stringify(res) + '\n');
  });
  return new Promise(resolve => rl.on('close', resolve));
}

module.exports = { createHandler, serve, TOOLS };
