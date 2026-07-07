@echo off
setlocal
cd /d "C:\Class_Routine\backend"
set SCHEDULER_BUDGET=2000000
node .\node_modules\jest\bin\jest.js tests/scheduler.test.js --testTimeout=60000 --silent > sched.log 2>&1
echo EXIT=%ERRORLEVEL% >> sched.log
endlocal