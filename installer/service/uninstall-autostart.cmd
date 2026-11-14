@echo off
chcp 65001 >nul 2>&1
setlocal
set "HERE=%~dp0"

net session >nul 2>&1
if not "%errorlevel%"=="0" (
    echo.
    echo  Requesting administrator privileges...
    echo.
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -WorkingDirectory '%~dp0' -Verb RunAs"
    if errorlevel 1 (
        echo  [!] Elevation was cancelled. Right-click this file and choose "Run as administrator".
        pause
    )
    exit /b
)

set "NODE=%HERE%..\..\runtime\node\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" "%HERE%service-uninstall.cjs" %*
echo.
pause
