'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function createReplacementScript() {
  return String.raw`param(
  [int]$ParentPid,
  [string]$NewPath,
  [string]$CurrentPath,
  [string]$BackupPath,
  [string]$ExpectedVersion,
  [string]$ScriptPath
)
$ErrorActionPreference = 'Stop'
$logRoot = Join-Path $env:LOCALAPPDATA 'ORBIT'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$logPath = Join-Path $logRoot 'update-status.log'
Add-Content -LiteralPath $logPath -Value ("{0:u} Helper started; waiting for PID {1}; current={2}; new={3}" -f (Get-Date), $ParentPid, $CurrentPath, $NewPath)
try {
  while (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) {
    Start-Sleep -Milliseconds 250
  }
  Add-Content -LiteralPath $logPath -Value ("{0:u} Parent process exited." -f (Get-Date))
  if (Test-Path -LiteralPath $BackupPath) {
    throw "Recovery backup already exists: $BackupPath"
  }
  Move-Item -LiteralPath $CurrentPath -Destination $BackupPath
  Add-Content -LiteralPath $logPath -Value ("{0:u} Previous executable backed up." -f (Get-Date))
  try {
    Move-Item -LiteralPath $NewPath -Destination $CurrentPath
    $actualVersion = (& $CurrentPath --version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $actualVersion -ne $ExpectedVersion) {
      throw "Replacement health check failed. Expected $ExpectedVersion; got $actualVersion."
    }
    Remove-Item -LiteralPath $BackupPath -Force
    Add-Content -LiteralPath $logPath -Value ("{0:u} Replacement succeeded: {1}" -f (Get-Date), $ExpectedVersion)
    exit 0
  } catch {
    $replacementError = $_
    if (Test-Path -LiteralPath $CurrentPath) {
      Remove-Item -LiteralPath $CurrentPath -Force
    }
    if (Test-Path -LiteralPath $BackupPath) {
      Move-Item -LiteralPath $BackupPath -Destination $CurrentPath
    }
    throw $replacementError
  }
} catch {
  Add-Content -LiteralPath $logPath -Value ("{0:u} Update failed: {1}" -f (Get-Date), $_)
  exit 1
} finally {
  if ($ScriptPath -and (Test-Path -LiteralPath $ScriptPath)) {
    Remove-Item -LiteralPath $ScriptPath -Force -ErrorAction SilentlyContinue
  }
}`;
}

function createLauncherCommand(config) {
  const encodedConfig = Buffer.from(JSON.stringify(config), 'utf8').toString('base64');
  return String.raw`$config = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedConfig}')) | ConvertFrom-Json
function Quote-Arg([string]$value) { '"' + $value.Replace('"', '""') + '"' }
$childArgs = @(
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
  (Quote-Arg $config.ScriptPath),
  '-ParentPid', (Quote-Arg ([string]$config.ParentPid)),
  '-NewPath', (Quote-Arg $config.NewPath),
  '-CurrentPath', (Quote-Arg $config.CurrentPath),
  '-BackupPath', (Quote-Arg $config.BackupPath),
  '-ExpectedVersion', (Quote-Arg $config.ExpectedVersion),
  '-ScriptPath', (Quote-Arg $config.ScriptPath)
)
Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList ($childArgs -join ' ') -WindowStyle Hidden
`;
}

function scheduleWindowsReplacement({
  newPath,
  currentPath,
  expectedVersion,
  parentPid = process.pid,
  spawnSyncFn = spawnSync,
  tempDir = os.tmpdir()
}) {
  if (process.platform !== 'win32' && !spawnSyncFn.__allowNonWindowsTest) {
    throw new Error('Deferred executable replacement is only supported on Windows.');
  }
  const backupPath = currentPath + '.old';
  if (fs.existsSync(backupPath)) {
    throw new Error(`Recovery backup already exists at ${backupPath}; refusing to overwrite it.`);
  }
  const scriptPath = path.join(tempDir, `orbit-update-${process.pid}-${Date.now()}.ps1`);
  fs.writeFileSync(scriptPath, createReplacementScript(), { flag: 'wx' });
  const config = { scriptPath, parentPid, newPath, currentPath, backupPath, expectedVersion };
  const encodedCommand = Buffer.from(createLauncherCommand(config), 'utf16le').toString('base64');
  try {
    const result = spawnSyncFn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand
    ], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Could not start deferred Windows updater (exit ${result.status}): ${result.stderr || result.stdout || 'no details'}`);
    }
  } catch (error) {
    try { fs.unlinkSync(scriptPath); } catch {}
    throw error;
  }
  return { scheduled: true, scriptPath, backupPath };
}

module.exports = { createReplacementScript, createLauncherCommand, scheduleWindowsReplacement };
