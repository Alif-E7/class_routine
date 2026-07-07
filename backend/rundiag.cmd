@echo off
setlocal
cd /d "C:\Class_Routine\backend"
set SCHEDULER_BUDGET=20000000
set SEED=42
node diag11.js > diag11.out 2>&1
echo EXIT=%ERRORLEVEL% >> diag11.out
endlocal