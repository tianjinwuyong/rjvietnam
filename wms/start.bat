@echo off
chcp 936 >nul
setlocal enabledelayedexpansion
title WMS 仓库管理系统 - 免安装版启动器

echo ========================================
echo   WMS 仓库管理系统 - 免安装版
echo   绿色部署 · 无需联网 · 无需安装依赖
echo ========================================
echo.

cd /d "%~dp0"

REM ==========================================
REM  1. 检查 Node.js
REM ==========================================
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js
    echo.
    echo 本免安装版已包含全部程序依赖，但仍需要目标机器安装 Node.js 运行时。
    echo 请先安装 Node.js 22 或更高版本：https://nodejs.org/
    echo 安装后重新双击本脚本即可。
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODEV=%%v
echo [1/6] Node.js 版本: %NODEV%

set NODEMAJOR=%NODEV:v=%
for /f "tokens=1 delims=." %%a in ("%NODEMAJOR%") do set NODEMAJOR=%%a
if %NODEMAJOR% LSS 22 (
    echo [错误] Node.js 版本过低，需要 22 或更高，当前: %NODEV%
    echo 请升级 Node.js 后重试：https://nodejs.org/
    pause
    exit /b 1
)

REM ==========================================
REM  2. 检查依赖
REM ==========================================
if not exist "node_modules" (
    echo [2/6] [错误] 未找到 node_modules 目录
    echo.
    echo 本应随包附带完整依赖。若该目录缺失，说明拷贝不完整。
    echo 请重新完整拷贝本目录后再试。
    echo.
    pause
    exit /b 1
)
echo [2/6] 依赖已就绪

REM ==========================================
REM  3. 检查构建产物
REM ==========================================
set NEED_BUILD=0
if not exist "dist\main.js" set NEED_BUILD=1
if not exist "dist\client\index.html" set NEED_BUILD=1

if %NEED_BUILD% equ 1 (
    echo [3/6] 未检测到构建产物，正在构建（首次较慢，请耐心等待）...
    echo.
    call npx nest build
    if !errorlevel! neq 0 (
        echo [错误] 后端构建失败
        pause
        exit /b 1
    )
    call npx vite build --config vite.config.ts
    if !errorlevel! neq 0 (
        echo [错误] 前端构建失败
        pause
        exit /b 1
    )
    echo.
    echo     构建完成。
) else (
    echo [3/6] 构建产物已就绪
)

REM ==========================================
REM  4. 配置向导（首次运行）
REM ==========================================
set NEED_CONFIG=0
if not exist ".env" set NEED_CONFIG=1
if exist ".env" (
    findstr /C:"请填写数据库密码" ".env" >nul 2>nul
    findstr /C:"CHANGE_ME" ".env" >nul 2>nul
    if !errorlevel! equ 0 set NEED_CONFIG=1
)

if %NEED_CONFIG% equ 1 (
    echo.
    echo ========================================
    echo   首次运行 - 数据库配置
    echo ========================================
    echo.
    echo   请选择配置方式：
    echo.
    echo     [1] 交互式输入（推荐，逐项询问）
    echo     [2] 打开记事本手动编辑配置文件
    echo.
    echo   直接回车 = 使用方式 1
    echo.
    set CFGMODE=
    set /p CFGMODE="  请选择 [1/2]: "
    if "!CFGMODE!"=="" set CFGMODE=1

    if "!CFGMODE!"=="2" (
        call :WriteTemplate
        echo.
        echo   已生成配置文件模板，正在打开记事本...
        echo   请修改 DB_PASSWORD（数据库密码）后保存关闭。
        echo.
        pause
        start /wait notepad .env
        echo.
        echo   编辑完成，按任意键继续启动...
        pause >nul
    ) else (
        call :InteractiveWizard
    )
) else (
    echo [4/6] 配置文件已就绪: .env
)

REM ==========================================
REM  5. 数据库连通性检查 + 初始化
REM ==========================================
echo [5/6] 检查数据库连接与结构...

node -e "require('dotenv').config();const postgres=require('postgres');const s=postgres({host:process.env.DB_HOST,port:+process.env.DB_PORT,username:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,max:1,connect_timeout:8});s`select count(*)::int as n from information_schema.tables where table_schema='public'`.then(r=>{console.log('     数据库连接正常，当前已有 '+r[0].n+' 张表');return s.end();}).then(()=>process.exit(0)).catch(e=>{console.log('     '+e.message);process.exit(1);});" 2>nul

if !errorlevel! neq 0 (
    echo.
    echo ========================================
    echo   [错误] 数据库连接失败
    echo ========================================
    echo   请依次排查：
    echo     1. PostgreSQL 服务是否已启动
    echo     2. .env 中的数据库地址/端口/用户名/密码是否正确
    echo     3. 数据库是否已创建
    echo        可在 PostgreSQL 中执行: CREATE DATABASE factory;
    echo     4. 目标机器防火墙是否放行 5432 端口
    echo.
    echo   修改 .env 后重新双击本脚本即可。
    echo ========================================
    echo.
    pause
    exit /b 1
)

REM 说明：此步骤【每次启动都执行】（幂等自愈）：
REM   init-db 内部仅当库为空时才执行 drizzle-kit push 建表（重步骤，避免对已建库做破坏性 diff）；
REM   每次都会执行幂等的补充 SQL（序列/表/索引/部署配置如不良品仓），使任何结构漂移都能自愈。
REM   历史上用 node_modules\.db-initialized 跳过【整个】初始化，会导致：存量库漂移无法自愈、
REM   整包（含该标记）拷到新机器时跳过建表直接不可用；现改为每次都跑。
echo     正在检查并自愈数据库结构（幂等）...
call npx ts-node server/scripts/init-db.ts
if !errorlevel! neq 0 (
    echo.
    echo [警告] 数据库初始化/自检未完全成功，将继续尝试启动（请检查上方输出与 .env 配置）。
) else (
    echo initialized > "node_modules\.db-initialized"
    echo     数据库结构检查/初始化完成。
)

REM ==========================================
REM  6. 启动服务
REM ==========================================
echo [6/6] 启动服务...
echo.
echo ========================================
echo   WMS 系统已启动
echo.
echo   PC 端:   http://localhost:3000
echo   PDA 端:  http://localhost:3000/pda/login
echo   账号:    admin / admin
echo ========================================
echo.
echo   [提示] 本窗口不能关闭，关闭即停止服务。
echo   [提示] 局域网访问请用本机 IP 代替 localhost。
echo   [提示] 首次登录后请立即修改管理员密码。
echo ========================================
echo.

node dist/main.js

echo.
echo 服务已停止。
pause
exit /b 0

REM ==========================================
REM  子过程：交互式向导
REM ==========================================
:InteractiveWizard
echo.
echo --------------------------------------------------
echo   请按提示输入数据库信息，直接回车使用方括号内默认值
echo --------------------------------------------------
echo.

set DBH=localhost
set /p DBH="  1/6 数据库地址 [localhost]: "
if "!DBH!"=="" set DBH=localhost

set DBP=5432
set /p DBP="  2/6 数据库端口 [5432]: "
if "!DBP!"=="" set DBP=5432

set DBU=postgres
set /p DBU="  3/6 数据库用户名 [postgres]: "
if "!DBU!"=="" set DBU=postgres

set DBN=factory
set /p DBN="  4/6 数据库名 [factory]: "
if "!DBN!"=="" set DBN=factory

set SRVPORT=3000
set /p SRVPORT="  5/6 服务端口 [3000]: "
if "!SRVPORT!"=="" set SRVPORT=3000

echo.
echo   [必填] 请你输入数据库密码（输入时不显示）
set DBPW=
set /p DBPW="  6/6 数据库密码: "

if "!DBPW!"=="" (
    echo.
    echo   [错误] 数据库密码不能为空。
    echo   将改用记事本方式让你手动填写。
    echo.
    call :WriteTemplate
    pause
    start /wait notepad .env
    call :ReloadEnv
    if "!DBPW!"=="" (
        echo   [错误] 密码仍为空，无法继续。请重新运行本脚本。
        pause
        exit /b 1
    )
) else (
    call :WriteEnvFile
)

echo.
echo ========================================
echo   配置完成
echo ========================================
echo     数据库: !DBU!@!DBH!:!DBP!/!DBN!
echo     服务端口: !SRVPORT!
echo     密码: 已设置
echo ========================================
echo.
call :ReloadEnv
echo   按任意键继续启动...
pause >nul
exit /b 0

REM ==========================================
REM  子过程：生成 .env
REM ==========================================
:WriteEnvFile
node -e "const c=require('crypto'),f=require('fs');const k=c.randomBytes(48).toString('hex');const L=['# WMS 免安装版配置','# 由启动向导自动生成','','NODE_ENV=production','SERVER_HOST=0.0.0.0','SERVER_PORT=%SRVPORT%','','DB_HOST=%DBH%','DB_PORT=%DBP%','DB_USER=%DBU%','DB_PASSWORD=%DBPW%','DB_NAME=%DBN%','','JWT_SECRET='+k,'','VITE_API_BASE_URL=/','','LOG_DIR=./logs','LOG_REQUEST_BODY=false','LOG_RESPONSE_BODY=false',''];f.writeFileSync('.env','\uFEFF'+L.join('\n'),'utf8');console.log('    .env 已生成（含随机 JWT 密钥）');"
exit /b 0

REM ==========================================
REM  子过程：生成模板（供记事本编辑）
REM ==========================================
:WriteTemplate
node -e "const c=require('crypto'),f=require('fs');const k=c.randomBytes(48).toString('hex');const L=['# WMS 免安装版配置','# 请修改 DB_PASSWORD 后保存','','NODE_ENV=production','SERVER_HOST=0.0.0.0','SERVER_PORT=3000','','DB_HOST=localhost','DB_PORT=5432','DB_USER=postgres','DB_PASSWORD=请填写数据库密码','DB_NAME=factory','','JWT_SECRET='+k,'','VITE_API_BASE_URL=/','','LOG_DIR=./logs','LOG_REQUEST_BODY=false','LOG_RESPONSE_BODY=false',''];f.writeFileSync('.env','\uFEFF'+L.join('\n'),'utf8');console.log('    模板已生成');"
exit /b 0

REM ==========================================
REM  子过程：从 .env 重新读取关键变量
REM ==========================================
:ReloadEnv
if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
        if /i "%%a"=="DB_HOST" set DBH=%%b
        if /i "%%a"=="DB_PORT" set DBP=%%b
        if /i "%%a"=="DB_USER" set DBU=%%b
        if /i "%%a"=="DB_PASSWORD" set DBPW=%%b
        if /i "%%a"=="DB_NAME" set DBN=%%b
        if /i "%%a"=="SERVER_PORT" set SRVPORT=%%b
    )
)
exit /b 0
