@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0enable-mes-api.ps1" %*

if errorlevel 1 (
    echo.
    echo   [FAILED] see the error above and send it to support.
    pause
)
