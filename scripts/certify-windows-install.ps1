param(
  [Parameter(Mandatory=$true)][string]$InstallerPath,
  [Parameter(Mandatory=$true)][string]$ExpectedVersion
)
$ErrorActionPreference = 'Stop'
$installDir = Join-Path $env:RUNNER_TEMP 'ORBIT Certification Path With Spaces'
$userData = Join-Path $env:USERPROFILE '.orbit'
$sentinel = Join-Path $userData 'certification-sentinel.txt'
New-Item -ItemType Directory -Path $userData -Force | Out-Null
Set-Content -LiteralPath $sentinel -Value 'preserve-user-data'

function Install-Orbit {
  $process = Start-Process -FilePath $InstallerPath -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',"/DIR=`"$installDir`"","/TASKS=envPath") -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Inno Setup returned exit code $($process.ExitCode)." }
}
function Assert-Version {
  $exe = Join-Path $installDir 'orbit.exe'
  if (-not (Test-Path -LiteralPath $exe)) { throw "CLI executable missing: $exe" }
  $version = (& $exe --version | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $version -ne $ExpectedVersion) {
    throw "CLI first-launch version check failed. Expected $ExpectedVersion; got $version."
  }
  & $exe --help | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'CLI --help launch failed.' }
}
Write-Host "Windows runner: $((Get-CimInstance Win32_OperatingSystem).Caption) build $((Get-CimInstance Win32_OperatingSystem).BuildNumber)"
Write-Host 'Installing CLI into a path containing spaces...'
Install-Orbit
Assert-Version
$shortcut = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\ORBIT\ORBIT CLI.lnk'
if (-not (Test-Path -LiteralPath $shortcut)) { throw "Start Menu shortcut missing: $shortcut" }
Write-Host 'PASS: clean install, CLI first launch, help command, and Start Menu shortcut.'

Write-Host 'Re-running the same installer to certify same-version repair/reinstall...'
Install-Orbit
Assert-Version
if ((Get-Content -LiteralPath $sentinel -Raw).Trim() -ne 'preserve-user-data') {
  throw 'User data sentinel changed during reinstall.'
}
Write-Host 'PASS: same-version reinstall and user-data preservation.'

$uninstaller = Join-Path $installDir 'unins000.exe'
if (-not (Test-Path -LiteralPath $uninstaller)) { throw 'Inno Setup uninstaller missing.' }
$uninstallProcess = Start-Process -FilePath $uninstaller -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART') -Wait -PassThru
if ($uninstallProcess.ExitCode -ne 0) { throw "Uninstaller returned exit code $($uninstallProcess.ExitCode)." }
if (Test-Path -LiteralPath (Join-Path $installDir 'orbit.exe')) { throw 'CLI executable remains after uninstall.' }
if (-not (Test-Path -LiteralPath $sentinel)) { throw 'Uninstall removed user data outside the installation directory.' }
Write-Host 'PASS: uninstall removes installed CLI while preserving user data.'
