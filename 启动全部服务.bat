@echo off
cd /d "%~dp0"
echo Starting SMT Factory services...
start "SMT-Watchdog" node watchdog.js
echo Watchdog started. Services will auto-launch.
echo Frontend: http://127.0.0.1:5178/
echo API:      http://127.0.0.1:8080/
pause
