@echo off
cd /d "%~dp0smt-factory-system"
echo ========================================
echo   SMT Factory Watchdog
echo   API : http://localhost:8080
echo   Web : http://localhost:5178
echo ========================================
echo.
echo [1] Start Watchdog (background)
echo [2] Stop Watchdog
echo [3] View Log
echo [4] Restart both servers
echo.
choice /C 1234 /N /M "Choice: "

if errorlevel 4 goto restart
if errorlevel 3 goto log
if errorlevel 2 goto stop
if errorlevel 1 goto start

:start
echo Starting watchdog...
start /MIN "" powershell -ExecutionPolicy Bypass -File "%~dp0smt-factory-system\watchdog.ps1"
echo Watchdog started.
pause
exit

:stop
echo Stopping all Node.js servers on ports 8080 and 5178...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080.*LISTENING"') do taskkill /F /PID %%a
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5178.*LISTENING"') do taskkill /F /PID %%a
echo Done.
pause
exit

:log
if exist "%~dp0smt-factory-system\watchdog.log" (
    type "%~dp0smt-factory-system\watchdog.log"
) else (
    echo No log file yet.
)
pause
exit

:restart
echo Killing all servers...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080.*LISTENING"') do taskkill /F /PID %%a
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5178.*LISTENING"') do taskkill /F /PID %%a
timeout /t 3 >nul
echo Restarting watchdog...
start /MIN "" powershell -ExecutionPolicy Bypass -File "%~dp0smt-factory-system\watchdog.ps1"
echo Done.
pause
