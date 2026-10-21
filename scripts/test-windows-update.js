'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { scheduleWindowsReplacement } = require('../src/engine/windows-update');

if (process.platform !== 'win32') {
  console.log('Windows updater integration test skipped: requires a Windows runner.');
  process.exit(0);
}

const sourceExe = path.resolve(__dirname, '..', 'dist', 'orbit.exe');
if (!fs.existsSync(sourceExe)) throw new Error('Build dist/orbit.exe before running this test.');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ORBIT updater certification with spaces '));
const currentPath = path.join(root, 'orbit current.exe');
const newPath = path.join(root, 'orbit new.exe');
const backupPath = currentPath + '.old';

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function waitFor(predicate, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(250);
  }
  throw new Error(`Timed out waiting for Windows updater: ${label}`);
}

function startParent() {
  return spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 1500)'], {
    windowsHide: true,
    stdio: 'ignore'
  });
}

async function main() {
  fs.copyFileSync(sourceExe, currentPath);
  fs.copyFileSync(sourceExe, newPath);
  const expectedVersion = spawnSync(currentPath, ['--version'], { encoding: 'utf8' }).stdout.trim();
  if (!expectedVersion) throw new Error('Built CLI did not return a version.');

  const parent = startParent();
  scheduleWindowsReplacement({ newPath, currentPath, expectedVersion, parentPid: parent.pid });
  await waitFor(() => !fs.existsSync(newPath) && !fs.existsSync(backupPath), 'successful replacement and backup cleanup');
  const installedVersion = spawnSync(currentPath, ['--version'], { encoding: 'utf8' });
  if (installedVersion.status !== 0 || installedVersion.stdout.trim() !== expectedVersion) {
    throw new Error('Windows updater did not install the verified executable.');
  }
  console.log('PASS: Windows replacement waits for the parent process, handles paths with spaces, health-checks the new executable, and removes the backup after success.');

  fs.copyFileSync(currentPath, newPath);
  fs.writeFileSync(newPath, 'not a Windows executable');
  const rollbackParent = startParent();
  scheduleWindowsReplacement({ newPath, currentPath, expectedVersion, parentPid: rollbackParent.pid });
  await waitFor(() => !fs.existsSync(backupPath) && !fs.existsSync(newPath), 'rollback after failed health check');
  const restoredVersion = spawnSync(currentPath, ['--version'], { encoding: 'utf8' });
  if (restoredVersion.status !== 0 || restoredVersion.stdout.trim() !== expectedVersion) {
    throw new Error('Windows updater did not restore the previous executable after a failed health check.');
  }
  if (fs.existsSync(newPath)) throw new Error('Failed replacement file was not removed.');
  console.log('PASS: Windows updater restores the previous executable after a failed health check.');
  fs.rmSync(root, { recursive: true, force: true });
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
