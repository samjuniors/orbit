// A scriptable stand-in for a coding agent, used by engine tests.
// Behavior comes from fake.json in the worktree: { "T1": { "1": "bad", "2": "good" } }
// keyed by task id, then by the Nth time this task has been invoked.
// Actions: good (default) | bad | fail | stall | rate | noop
const fs = require('node:fs');
const path = require('node:path');
const id = process.env.ORBIT_TASK_ID;
const calls = process.env.FAKE_CALLS;
let n = 1;
if (calls && fs.existsSync(calls)) n = fs.readFileSync(calls, 'utf8').split('\n').filter(l => l.startsWith(id + ' ')).length + 1;
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'fake.json'), 'utf8')); } catch {}
const action = (cfg[id] || {})[String(n)] || 'good';
const prompt = process.env.ORBIT_PROMPT_FILE ? fs.readFileSync(process.env.ORBIT_PROMPT_FILE, 'utf8') : '';
if (calls) fs.appendFileSync(calls, `${id} call${n} ${action} ${prompt.includes('interrupted') ? 'INTERRUPTED ' : ''}${prompt.includes('Rejected by you') ? 'REJECTED ' : ''}${prompt.includes('Verification command') ? 'VERIFYFAIL ' : ''}\n`);
if (action === 'stall') { setTimeout(() => {}, 120000); return; }
if (action === 'rate') { console.error('Error: usage limit reached, try again later'); process.exit(1); }
if (action === 'fail') { console.error('boom'); process.exit(1); }
if (action !== 'noop') { fs.writeFileSync(path.join(process.cwd(), `out-${id}.txt`), action === 'bad' ? 'bad' : 'good'); fs.writeFileSync(path.join(process.cwd(), `note-${id}.txt`), `call ${n}`); }
console.log(`finished ${id} (${action})`);
