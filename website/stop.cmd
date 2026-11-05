@echo off
setlocal
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":8787 .*LISTENING"') do (
  echo Stopping Solo Trading Charts process %%p
  taskkill /PID %%p /F >nul 2>&1
)
echo Done.
endlocal
