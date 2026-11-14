@echo off
REM WMS stop services (run as Administrator)
setlocal
net stop WMS-App >nul 2>&1
net stop WMS-PostgreSQL >nul 2>&1
echo.
echo ---- service status ----
sc query WMS-App | findstr /C:"STATE"
sc query WMS-PostgreSQL | findstr /C:"STATE"
echo.
echo WMS services stopped.
pause
