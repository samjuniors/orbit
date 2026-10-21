@echo off
setlocal enabledelayedexpansion

echo ===============================================================
echo   ORBIT CLI Installer for Windows
echo ===============================================================
echo.

set "SCRIPT_DIR=%~dp0"
set "EXE_SRC=%SCRIPT_DIR%..\dist\orbit.exe"

if not exist "%EXE_SRC%" (
  set "EXE_SRC=%SCRIPT_DIR%orbit.exe"
)

if not exist "%EXE_SRC%" (
  echo [ERROR] Could not find orbit.exe!
  echo Please run "npm run build:exe" first to generate dist\orbit.exe.
  echo.
  pause
  exit /b 1
)

set "TARGET_DIR=%LOCALAPPDATA%\Programs\Orbit"

echo [*] Installing to: %TARGET_DIR%
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

copy /Y "%EXE_SRC%" "%TARGET_DIR%\orbit.exe" >nul
if errorlevel 1 (
  echo [ERROR] Failed to copy orbit.exe to %TARGET_DIR%
  pause
  exit /b 1
)

echo [*] Registering in Windows User PATH...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$dir = [System.IO.Path]::GetFullPath('%TARGET_DIR%'); " ^
  "$path = [Environment]::GetEnvironmentVariable('Path', 'User'); " ^
  "if (-not $path) { $path = '' }; " ^
  "$paths = $path -split ';' | Where-Object { $_ -ne '' }; " ^
  "if ($paths -notcontains $dir) { " ^
  "  $newPath = ($paths + $dir) -join ';'; " ^
  "  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User'); " ^
  "  Write-Host '    -> PATH updated successfully.'; " ^
  "} else { " ^
  "  Write-Host '    -> Already present in PATH.'; " ^
  "}"

echo.
echo ===============================================================
echo   SUCCESS! ORBIT has been installed.
echo ===============================================================
echo   Installed: %TARGET_DIR%\orbit.exe
"%TARGET_DIR%\orbit.exe" --version >nul 2>&1
echo.
echo   Next steps:
echo     1. Open a new terminal (PowerShell, CMD, or Git Bash).
echo     2. Go to any project folder and type:
echo.
echo          orbit setup
echo.
echo ===============================================================
echo.
pause
