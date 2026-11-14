@echo off
chcp 65001 >nul 2>&1
setlocal
set "HERE=%~dp0"

set "NODE=%HERE%..\..\runtime\node\node.exe"
if not exist "%NODE%" set "NODE=node"

"%NODE%" "%HERE%service-control.cjs" %*
echo.
if "%~1"=="" pause
