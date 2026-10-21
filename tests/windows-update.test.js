'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createReplacementScript, createLauncherCommand, scheduleWindowsReplacement } = require('../src/engine/windows-update');

test('Windows replacement helper waits for the running process and verifies before deleting backup', () => {
  const script = createReplacementScript();
  assert.match(script, /Get-Process -Id \$ParentPid/);
  assert.match(script, /Move-Item -LiteralPath \$CurrentPath -Destination \$BackupPath/);
  assert.match(script, /--version/);
  assert.match(script, /Move-Item -LiteralPath \$BackupPath -Destination \$CurrentPath/);
  assert.match(script, /Recovery backup already exists/);
});

test('schedules a PowerShell bootstrap with safely encoded paths containing spaces', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit updater test '));
  const calls = [];
  const fakeSpawnSync = Object.assign((command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0, stdout: '', stderr: '' };
  }, { __allowNonWindowsTest: true });
  try {
    const result = scheduleWindowsReplacement({
      newPath: String.raw`C:\Program Files\ORBIT\orbit.exe.download`,
      currentPath: String.raw`C:\Program Files\ORBIT\orbit.exe`,
      expectedVersion: '0.8.0',
      parentPid: 1234,
      spawnSyncFn: fakeSpawnSync,
      tempDir
    });
    assert.equal(result.scheduled, true);
    assert.equal(calls[0].command, 'powershell.exe');
    assert.ok(calls[0].args.includes('-EncodedCommand'));
    assert.equal(calls[0].options.timeout, 10000);
    const command = Buffer.from(calls[0].args.at(-1), 'base64').toString('utf16le');
    assert.match(command, /Start-Process/);
    assert.match(command, /ConvertFrom-Json/);
    assert.match(fs.readFileSync(result.scriptPath, 'utf8'), /--version/);
    const configMatch = command.match(/FromBase64String\('([^']+)'\)/);
    assert.ok(configMatch);
    const config = JSON.parse(Buffer.from(configMatch[1], 'base64').toString('utf8'));
    assert.equal(config.currentPath, String.raw`C:\Program Files\ORBIT\orbit.exe`);
    assert.equal(config.newPath, String.raw`C:\Program Files\ORBIT\orbit.exe.download`);
    assert.equal(config.expectedVersion, '0.8.0');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('does not overwrite an existing Windows recovery backup', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit updater backup test '));
  const currentPath = path.join(tempDir, 'orbit.exe');
  fs.writeFileSync(currentPath + '.old', 'recovery');
  const fakeSpawnSync = Object.assign(() => { throw new Error('must not spawn'); }, { __allowNonWindowsTest: true });
  try {
    assert.throws(() => scheduleWindowsReplacement({
      newPath: path.join(tempDir, 'new.exe'),
      currentPath,
      expectedVersion: '0.8.0',
      spawnSyncFn: fakeSpawnSync,
      tempDir
    }), /Recovery backup already exists/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
