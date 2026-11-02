@echo off
setlocal
cd /d "%~dp0"
if not defined PORT set PORT=8787
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js 18+ or use the bundled runtime.
  echo Download: https://nodejs.org/
  pause
  exit /b 1
)
echo ============================================================
echo  Proof Coach - Full-stack Demo (frontend + backend)
echo ------------------------------------------------------------
echo  Frontend : http://127.0.0.1:%PORT%/
echo  API      : http://127.0.0.1:%PORT%/api/health
echo  Docs     : README.md / docs/API.md
echo  Stop     : Ctrl + C
echo ============================================================
start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:%PORT%/"
node server\server.mjs
pause
