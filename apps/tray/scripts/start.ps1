$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try { if (-not (Test-Path 'node_modules/electron')) { throw 'Dependencies are missing. Run scripts\install.ps1 first.' }; npm start } finally { Pop-Location }