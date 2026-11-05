@echo off
setlocal
cd /d "%~dp0"

set "NODE=..\tradingview\runtime\node.exe"
if not exist "%NODE%" set "NODE=node"
if not exist "%NODE%" (
  echo Node.js was not found.
  echo Install Node 20+ or keep the portable runtime at tradingview\runtime\node.exe.
  pause
  exit /b 1
)

if not defined PORT set "PORT=8787"

echo Starting Solo Trading Charts on http://localhost:%PORT%
start "Solo Trading Charts server" /min "%NODE%" server.mjs
timeout /t 2 /nobreak >nul
start "" "http://localhost:%PORT%"
endlocal
