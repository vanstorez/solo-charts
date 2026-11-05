@echo off
setlocal
pushd "%~dp0"

if not exist "runtime\node.exe" (
  echo Portable Node runtime not found at runtime\node.exe
  echo Install Node.js, or ask OpenCode to restore the portable runtime.
  pause
  exit /b 1
)

runtime\node.exe engine.mjs --out nse-report.html %*
if errorlevel 1 (
  echo.
  echo Backtest failed. See the message above.
  pause
  exit /b 1
)

echo.
echo Report: %CD%\nse-report.html
start "" "%CD%\nse-report.html"
popd
