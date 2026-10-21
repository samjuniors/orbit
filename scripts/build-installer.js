#!/usr/bin/env node
// Compiles the ORBIT traditional Windows setup wizard (dist/Orbit-Setup-<version>.exe)
// using Inno Setup (via innosetup-compiler or local Inno Setup installation).
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const pkg = require('../package.json');
const win = process.platform === 'win32';

if (!win) {
  console.log('Building a Windows .exe installer is only supported on Windows or under Wine.');
  process.exit(0);
}

function findIscc() {
  const cands = [
    path.join(root, 'node_modules', 'innosetup-compiler', 'bin', 'ISCC.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Inno Setup 6', 'ISCC.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Inno Setup 6', 'ISCC.exe')
  ];
  for (const c of cands) {
    if (fs.existsSync(c)) return { cmd: c, isDirect: true };
  }
  return { cmd: 'npx.cmd', args: ['-y', 'innosetup-compiler'], isDirect: false };
}

try {
  const exePath = path.join(dist, 'orbit.exe');
  if (!fs.existsSync(exePath)) {
    console.log('[1/2] dist/orbit.exe not found, building single-file executable first...');
    const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-exe.js')], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('build:exe failed');
  } else {
    console.log(`[1/2] Using existing executable ${exePath} (${(fs.statSync(exePath).size / 1048576).toFixed(0)} MB)`);
  }

  console.log(`\n[2/2] Compiling Windows Setup Wizard (Inno Setup)...`);
  const iscc = findIscc();
  const issFile = path.join(root, 'scripts', 'orbit.iss');
  const args = iscc.isDirect
    ? [`/DAppVersion=${pkg.version}`, issFile]
    : [...iscc.args, `/DAppVersion=${pkg.version}`, issFile];

  const res = spawnSync(iscc.cmd, args, { cwd: root, stdio: 'inherit', shell: !iscc.isDirect });
  if (res.status !== 0) throw new Error(`Inno Setup compiler failed (exit ${res.status})`);

  const versionedSetup = path.join(dist, `Orbit-Setup-${pkg.version}.exe`);
  const genericSetup = path.join(dist, 'Orbit-Setup.exe');

  if (fs.existsSync(versionedSetup)) {
    fs.copyFileSync(versionedSetup, genericSetup);
    const szMb = (fs.statSync(versionedSetup).size / 1048576).toFixed(1);
    console.log(`\nSUCCESS! Traditional Windows Setup Wizard created:`);
    console.log(`  - ${versionedSetup} (${szMb} MB)`);
    console.log(`  - ${genericSetup} (${szMb} MB)`);
    console.log(`\nDouble-clicking Orbit-Setup.exe launches the full Windows setup wizard:`);
    console.log(`  * Installs orbit to %LOCALAPPDATA%\\Programs\\Orbit (no admin UAC prompt needed)`);
    console.log(`  * Automatically registers 'orbit' in the user's Windows PATH`);
    console.log(`  * Adds Start Menu shortcuts & uninstaller in Windows Apps & Features`);
  } else {
    throw new Error(`Expected output ${versionedSetup} was not found.`);
  }
} catch (e) {
  console.error(`\nInstaller build failed: ${e.message}`);
  process.exit(1);
}
