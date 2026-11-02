@echo off
chcp 936 >nul
setlocal enabledelayedexpansion
title WMS 版本升级工具

echo ==========================================================
echo    WMS 仓库管理系统 - 版本升级工具
echo ==========================================================
echo.
echo    升级内容：2026-10-14 至 2026-10-16 累计修复
echo              账号批量导入、修改密码
echo              扫码提示统一为 OK/NG 并自动回到扫码框
echo    升级方式：只替换 dist 文件夹
echo              不改数据库、不装依赖、不动 .env
echo.
echo    ★ 升级后每个账号首次登录时会先被要求修改密码（含 admin），
echo      这是本次新增的安全机制，不是故障。
echo      请提前通知现场人员，详见 升级说明.txt 第十一节。
echo.
echo    开始前请先关闭正在运行的 WMS 服务
echo    即关闭服务命令窗口，或在任务管理器结束 node.exe
echo.
pause
echo.

echo 请输入 WMS 安装目录的完整路径，然后回车
echo    例如：D:\WMS免安装版本
echo.
set /p WMSDIR=WMS 安装目录：

if "!WMSDIR!"=="" (
  echo.
  echo [错误] 未输入路径
  pause
  exit /b 1
)

if not exist "!WMSDIR!\.env" (
  echo.
  echo [错误] 该目录下找不到 .env 文件
  echo        请确认这就是 WMS 安装目录
  pause
  exit /b 1
)

if not exist "!WMSDIR!\dist" (
  echo.
  echo [错误] 该目录下找不到 dist 文件夹
  pause
  exit /b 1
)

if not exist "%~dp0dist\main.js" (
  echo.
  echo [错误] 补丁包不完整：找不到 dist\main.js
  echo        请把本脚本与 dist 文件夹放在同一目录下运行
  pause
  exit /b 1
)

set STAMP=20261016
set BAK=!WMSDIR!\dist.bak-!STAMP!
if exist "!BAK!" set BAK=!WMSDIR!\dist.bak-!STAMP!-b
if exist "!BAK!" set BAK=!WMSDIR!\dist.bak-!STAMP!-c

echo.
echo [1/3] 备份旧版本到
echo        !BAK!
move "!WMSDIR!\dist" "!BAK!" >nul
if errorlevel 1 (
  echo.
  echo [错误] 备份失败 —— WMS 服务可能仍在运行，文件被占用
  echo        请关闭服务后重新运行本工具
  pause
  exit /b 1
)
echo       完成

echo.
echo [2/3] 复制新版本...
xcopy "%~dp0dist" "!WMSDIR!\dist" /E /I /H /Y >nul
if errorlevel 1 (
  echo.
  echo [错误] 复制失败，正在回滚...
  move "!WMSDIR!\dist" "!WMSDIR!\dist.failed-!STAMP!" >nul
  move "!BAK!" "!WMSDIR!\dist" >nul
  echo        已回滚到升级前状态
  pause
  exit /b 1
)
echo       完成

echo.
echo [3/3] 校验新版本...
if not exist "!WMSDIR!\dist\main.js" (
  echo.
  echo [错误] 后端主文件缺失，正在回滚...
  move "!WMSDIR!\dist" "!WMSDIR!\dist.failed-!STAMP!" >nul
  move "!BAK!" "!WMSDIR!\dist" >nul
  pause
  exit /b 1
)
if not exist "!WMSDIR!\dist\client\index.html" (
  echo.
  echo [错误] 前端文件缺失，正在回滚...
  move "!WMSDIR!\dist" "!WMSDIR!\dist.failed-!STAMP!" >nul
  move "!BAK!" "!WMSDIR!\dist" >nul
  pause
  exit /b 1
)
if not exist "!WMSDIR!\dist\modules\system\system.controller.js" (
  echo.
  echo [错误] 系统模块文件缺失，正在回滚...
  move "!WMSDIR!\dist" "!WMSDIR!\dist.failed-!STAMP!" >nul
  move "!BAK!" "!WMSDIR!\dist" >nul
  pause
  exit /b 1
)
echo       完成

echo.
echo ==========================================================
echo    升级完成
echo ==========================================================
echo.
echo    旧版本备份：!BAK!
echo.
echo    回滚方法：
echo      1. 关闭 WMS 服务
echo      2. 删掉当前的 dist 文件夹
echo      3. 把上面那个备份文件夹改名为 dist
echo      4. 重新启动服务
echo.
echo    接下来：
echo      1. 双击 WMS 目录下的 启动.bat 重新启动
echo      2. 浏览器按 Ctrl+Shift+R 强制刷新
echo      3. 按 升级说明.txt 第六节逐项验证
echo.
pause
exit /b 0
