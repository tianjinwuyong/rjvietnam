@echo off
REM WMS start services (run as Administrator)
setlocal
net start WMS-PostgreSQL >nul 2>&1
net start WMS-App >nul 2>&1
echo.
echo ---- service status ----
sc query WMS-PostgreSQL | findstr /C:"STATE"
sc query WMS-App | findstr /C:"STATE"
echo.
echo WMS: http://127.0.0.1:3000
pause
