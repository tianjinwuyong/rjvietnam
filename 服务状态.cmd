@echo off
chcp 65001 >nul 2>&1
setlocal
set "NODE=%~dp0runtime\node\node.exe"
if not exist "%NODE%" set "NODE=node"

"%NODE%" "%~dp0installer\service\service-control.cjs" status
echo.
pause
