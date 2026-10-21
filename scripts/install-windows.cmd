@echo off
rem Installs the `orbit` command on this PC (double-click, or run from any terminal).
setlocal
where node >nul 2>nul || (echo Node.js 20 or newer is required: https://nodejs.org & pause & exit /b 1)
where git >nul 2>nul || (echo Git is required: https://git-scm.com & pause & exit /b 1)
cd /d "%~dp0.."
call npm link
if errorlevel 1 (
  echo.
  echo "npm link" failed. You can still run ORBIT with:  node "%CD%\bin\orbit.js"
  pause & exit /b 1
)
echo.
echo Done. Open any project folder in a terminal (PowerShell, cmd or Git Bash) and type:  orbit setup
pause
