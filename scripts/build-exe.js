#!/usr/bin/env node
// Builds a single-file executable (dist/orbit.exe on Windows, dist/orbit elsewhere) using Node's
// "single executable application" support: bundle -> SEA blob -> inject into a copy of node.
// Needs Node 20.12+ (22 LTS recommended) and, for the inject step, internet access once (npx postject).
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { bundle } = require('./bundle');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const win = process.platform === 'win32';
const out = path.join(dist, win ? 'orbit.exe' : 'orbit');
const step = n => console.log(`\n[${n}]`);
const run = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: win && /npx|signtool/.test(cmd), ...opts }); if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (exit ${r.status})`); };

try {
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 20 || (maj === 20 && min < 12)) throw new Error(`Node ${process.version} is too old. Install Node 22 LTS from https://nodejs.org and try again.`);
  const pkg = require('../package.json');
  fs.rmSync(dist, { recursive: true, force: true }); fs.mkdirSync(dist, { recursive: true });

  step('1/5 bundle sources into one file');
  fs.writeFileSync(path.join(dist, 'orbit.cjs'), bundle(path.join(root, 'bin', 'orbit.js'), root));

  step('2/5 create the SEA blob');
  fs.writeFileSync(path.join(dist, 'sea-config.json'), JSON.stringify({ main: path.join(dist, 'orbit.cjs'), output: path.join(dist, 'orbit.blob'), disableExperimentalSEAWarning: true, assets: { 'SKILL.md': path.join(root, 'integrations', 'claude-code', 'orbit', 'SKILL.md') } }, null, 2));
  run(process.execPath, ['--experimental-sea-config', path.join(dist, 'sea-config.json')]);

  step('3/5 copy the node runtime');
  fs.copyFileSync(process.execPath, out);
  if (win) spawnSync('signtool', ['remove', '/s', out], { stdio: 'ignore', shell: true }); // optional: strips node.exe's signature before injection

  step('4/5 inject ORBIT into the copy (downloads postject once)');
  const inject = ['--yes', 'postject@1.0.0-alpha.6', out, 'NODE_SEA_BLOB', path.join(dist, 'orbit.blob'), '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'];
  if (process.platform === 'darwin') inject.push('--macho-segment-name', 'NODE_SEA');
  run(win ? 'npx.cmd' : 'npx', inject);
  if (!win) fs.chmodSync(out, 0o755);

  step('5/5 smoke test');
  const v = spawnSync(out, ['--version'], { encoding: 'utf8' });
  if (v.status !== 0 || v.stdout.trim() !== pkg.version) throw new Error(`The built exe did not report version ${pkg.version} (got "${(v.stdout || v.stderr || '').trim()}").`);
  const g = spawnSync(out, ['__guard', 'git', 'push'], { encoding: 'utf8', env: { ...process.env, ORBIT_ALLOW: '{}', ORBIT_REAL_GIT: 'git' } });
  if (g.status !== 17) throw new Error('The built exe did not enforce the git guard (expected exit 17).');
  console.log(`\nBuilt ${out}  (${(fs.statSync(out).size / 1048576).toFixed(0)} MB, reports version ${v.stdout.trim()}, guard OK)`);
  console.log('Copy it anywhere on your PATH, or run it directly. Windows SmartScreen/antivirus may warn about an unsigned exe; see docs/BUILDING-EXE.md.');
} catch (e) {
  console.error(`\nBuild failed: ${e.message}`);
  process.exit(1);
}
