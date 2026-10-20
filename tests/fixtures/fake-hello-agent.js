// Stand-in agent for `orbit adapter test`. Mode from ORBIT_FAKE_MODE: good | wrong | stall | fail
const fs = require('node:fs');
const mode = process.env.ORBIT_FAKE_MODE || 'good';
if (mode === 'stall') { setTimeout(() => {}, 120000); return; }
if (mode === 'fail') { console.error('permission denied'); process.exit(1); }
fs.writeFileSync('hello.txt', mode === 'wrong' ? 'nope' : 'orbit-ok');
console.log('done');
