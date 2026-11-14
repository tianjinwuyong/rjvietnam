@echo off
REM WMS service status
setlocal
echo ---- WMS-PostgreSQL ----
sc query WMS-PostgreSQL | findstr /C:"STATE" /C:"SERVICE_NAME"
echo ---- WMS-App ----
sc query WMS-App | findstr /C:"STATE" /C:"SERVICE_NAME"
echo.
echo ---- listening ports ----
netstat -ano | findstr /C:":3000 " /C:":3443 " /C:":5433 "
pause
