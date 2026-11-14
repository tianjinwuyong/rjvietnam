@echo off
chcp 65001 >nul 2>&1
setlocal
set "NODE=%~dp0runtime\node\node.exe"
if not exist "%NODE%" set "NODE=node"

start "WMS Guardian" /min "%NODE%" "%~dp0installer\service\wms-guardian.cjs"

echo.
echo  WMS guardian has been started in background.
echo  PostgreSQL 5433 and WMS app 3000/3443 are now supervised.
echo.
echo  Check status:  service-status.cmd
echo.
timeout /t 3 >nul
