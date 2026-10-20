$ErrorActionPreference = 'Stop'
Write-Host 'ORBIT Worker source setup' -ForegroundColor Cyan
if ($env:OS -ne 'Windows_NT') { throw 'ORBIT Worker currently supports Windows only.' }
$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $node -or -not $npm) { throw 'Install Node.js 22 LTS or newer first. npm is included with Node.js.' }
if (-not $git) { throw 'Install Git for Windows first. Git Bash is included with Git for Windows.' }
Write-Host "Node: $((& node --version).Trim())"
Write-Host "npm: $((& npm --version).Trim())"
Write-Host "Git: $((& git --version).Trim())"
Push-Location (Join-Path $PSScriptRoot '..')
try { npm install; npm run check; npm test } finally { Pop-Location }
Write-Host 'Dependencies installed. Run scripts\start.ps1 to launch ORBIT Worker.' -ForegroundColor Green