param([Parameter(Mandatory=$true)][string]$InstallerPath)
$ErrorActionPreference = 'Stop'
$installDir = Join-Path $env:RUNNER_TEMP 'ORBIT Desktop Certification Path With Spaces'
Write-Host "Windows runner: $((Get-CimInstance Win32_OperatingSystem).Caption) build $((Get-CimInstance Win32_OperatingSystem).BuildNumber)"
Write-Host 'Installing legacy desktop/tray app silently...'
& $InstallerPath /S "/D=$installDir"
if ($LASTEXITCODE -ne 0) { throw "NSIS installer returned exit code $LASTEXITCODE." }
$exe = Join-Path $installDir 'ORBIT Desktop.exe'
if (-not (Test-Path -LiteralPath $exe)) {
  $candidate = Get-ChildItem -LiteralPath $installDir -Filter '*.exe' -File | Where-Object { $_.Name -notmatch 'uninstall' } | Select-Object -First 1
  if (-not $candidate) { throw "Desktop executable missing under $installDir." }
  $exe = $candidate.FullName
}
Write-Host "Launching: $exe"
$p = Start-Process -FilePath $exe -ArgumentList '--disable-gpu','--no-sandbox' -PassThru
Start-Sleep -Seconds 10
$stillRunning = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
if (-not $stillRunning) { throw 'Desktop app exited before launch smoke test completed.' }
Write-Host 'PASS: desktop application process launched and remained active for 10 seconds.'
Stop-Process -Id $p.Id -Force
$uninstaller = Get-ChildItem -LiteralPath $installDir -Filter 'Uninstall*.exe' -File | Select-Object -First 1
if ($uninstaller) {
  & $uninstaller.FullName /S
  if ($LASTEXITCODE -ne 0) { throw "Desktop uninstaller returned exit code $LASTEXITCODE." }
  Write-Host 'PASS: desktop uninstaller completed.'
} else {
  Write-Host 'WARNING: NSIS uninstaller not found; install artifact check passed but uninstall was not certified.'
}
