@echo off
chcp 65001 >nul
echo Starting sync from 155 to 122...
echo.

set SOURCE_DIR="C:\Users\tianj\Desktop\越南工厂瑞晶\smt-factory-system"
set DEST=wy@192.168.6.122:/home/wy/smt-factory-system

echo Syncing apps directory...
scp -o StrictHostKeyChecking=no -r %SOURCE_DIR%\apps\* %DEST%/apps/

echo Syncing services directory...
scp -o StrictHostKeyChecking=no -r %SOURCE_DIR%\services\* %DEST%/services/

echo Syncing packages directory...
scp -o StrictHostKeyChecking=no -r %SOURCE_DIR%\packages\* %DEST%/packages/

echo Syncing scripts directory...
scp -o StrictHostKeyChecking=no -r %SOURCE_DIR%\scripts\* %DEST%/scripts/

echo Syncing database directory...
scp -o StrictHostKeyChecking=no -r %SOURCE_DIR%\database\* %DEST%/database/

echo Syncing app_rules directory...
scp -o StrictHostKeyChecking=no -r %SOURCE_DIR%\app_rules\* %DEST%/app_rules/

echo Syncing tests directory...
scp -o StrictHostKeyChecking=no -r %SOURCE_DIR%\tests\* %DEST%/tests/

echo Syncing config files...
scp -o StrictHostKeyChecking=no %SOURCE_DIR%\package.json %DEST%/
scp -o StrictHostKeyChecking=no %SOURCE_DIR%\vite.config.ts %DEST%/
scp -o StrictHostKeyChecking=no %SOURCE_DIR%\tsconfig.base.json %DEST%/
scp -o StrictHostKeyChecking=no %SOURCE_DIR%\AGENTS.md %DEST%/

echo.
echo Sync completed at %date% %time%
