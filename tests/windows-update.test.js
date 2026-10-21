'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createReplacementScript, scheduleWindowsReplacement } = require('../src/engine/windows-update');

test('Windows replacement helper waits for the running process and verifies before deleting backup', () => {
  const script = createReplacementScript();
  assert.match(script, /Get-Process -Id \$ParentPid/);
  assert.match(script, /Move-Item -LiteralPath \$CurrentPath -Destination \$BackupPath/);
  assert.match(script, /--version/);
  assert.match(script, /Move-Item -LiteralPath \$BackupPath -Destination \$CurrentPath/);
  assert.match(script, /Recovery backup already exists/);
});

test('schedules the PowerShell helper with literal paths containing spaces', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit updater test '));
  const calls = [];
  const fakeSpawn = Object.assign((command, args, options) => {
    calls.push({ command, args, options });
    return { unref() { calls.push({ unref: true }); } };
  }, { __allowNonWindowsTest: true });
  try {
    const result = scheduleWindowsReplacement({
      newPath: 'C:\Program Files\ORBIT\orbit.exe.download',
      currentPath: 'C:\Program Files\ORBIT\orbit.exe',
      expectedVersion: '0.8.0',
      parentPid: 1234,
      spawnFn: fakeSpawn,
      tempDir
    });
    assert.equal(result.scheduled, true);
    assert.equal(calls[0].command, 'powershell.exe');
    assert.ok(calls[0].args.includes('C:\\Program Files\\ORBIT\\orbit.exe'));
    assert.ok(calls[0].args.includes('C:\\Program Files\\ORBIT\\orbit.exe.download'));
    assert.ok(calls[0].args.includes('0.8.0'));
    assert.equal(calls[0].options.detached, true);
    assert.equal(calls[1].unref, true);
    assert.match(fs.readFileSync(result.scriptPath, 'utf8'), /Wait-Process|Get-Process/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('does not overwrite an existing Windows recovery backup', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit updater backup test '));
  const currentPath = path.join(tempDir, 'orbit.exe');
  fs.writeFileSync(currentPath + '.old', 'recovery');
  const fakeSpawn = Object.assign(() => { throw new Error('must not spawn'); }, { __allowNonWindowsTest: true });
  try {
    assert.throws(() => scheduleWindowsReplacement({
      newPath: path.join(tempDir, 'new.exe'),
      currentPath,
      expectedVersion: '0.8.0',
      spawnFn: fakeSpawn,
      tempDir
    }), /Recovery backup already exists/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
