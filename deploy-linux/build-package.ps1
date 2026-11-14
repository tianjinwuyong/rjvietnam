# ================================================================
#  打包 Linux 部署包（在 Windows 构建机上执行）
#
#    powershell -ExecutionPolicy Bypass -File build-package.ps1 -Version 2.0.0
#
#  产物：deploy-linux\out\WMS-Docker-2.0.0.tar.gz
#  传到 Linux 后： tar -xzf ... && cd wms-docker && sudo bash install.sh
# ================================================================
[CmdletBinding()]
param(
  [string]$Version = '2.0.0'
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root      = Split-Path -Parent $ScriptDir
$BuildDir  = Join-Path $ScriptDir '.build'
$PkgName   = 'wms-docker'
$PkgDir    = Join-Path $BuildDir $PkgName
$OutDir    = Join-Path $ScriptDir 'out'

function Step($m) { Write-Host "  > $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  [OK] $m" -ForegroundColor Green }
function Die($m)  { Write-Host "  [XX] $m" -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host "  WMS Linux 部署包  v$Version" -ForegroundColor White
Write-Host ''

# ---------------------------------------------------------------- 前置检查
if (-not (Test-Path (Join-Path $Root 'dist\main.js'))) { Die '未找到 dist\main.js，请先在项目根执行 npm run build' }
if (-not (Test-Path (Join-Path $Root 'package-lock.json'))) { Die '未找到 package-lock.json（容器内 npm ci 需要它）' }
if (-not (Test-Path (Join-Path $ScriptDir 'assets\schema.sql'))) {
  if (Test-Path (Join-Path $Root 'installer\assets\schema.sql')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $ScriptDir 'assets') | Out-Null
    Copy-Item (Join-Path $Root 'installer\assets\schema.sql') (Join-Path $ScriptDir 'assets') -Force
    Copy-Item (Join-Path $Root 'installer\assets\sql-order.json') (Join-Path $ScriptDir 'assets') -Force
    Ok '已从 installer/assets 取用建库基线'
  } else {
    Die '缺少 assets/schema.sql（建库基线）'
  }
}

# ---------------------------------------------------------------- 清理
if (Test-Path $BuildDir) { Remove-Item $BuildDir -Recurse -Force }
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }
New-Item -ItemType Directory -Force -Path $PkgDir | Out-Null

# ---------------------------------------------------------------- 静态文件
Step '复制编排文件'
foreach ($f in @('docker-compose.yml', 'Dockerfile', 'install.sh', 'uninstall.sh', 'backup.sh', 'restore.sh', 'README.md')) {
  Copy-Item (Join-Path $ScriptDir $f) $PkgDir -Force
}
Copy-Item (Join-Path $ScriptDir '.env.example') (Join-Path $PkgDir '.env.example') -Force

# ---------------------------------------------------------------- 程序
Step '复制程序（dist）'
& robocopy (Join-Path $Root 'dist') (Join-Path $PkgDir 'app\dist') /E /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
if ($LASTEXITCODE -ge 8) { Die "复制 dist 失败（robocopy $LASTEXITCODE）" }

Step '复制依赖清单与建库脚本'
New-Item -ItemType Directory -Force -Path (Join-Path $PkgDir 'app\tools'), (Join-Path $PkgDir 'app\assets') | Out-Null
Copy-Item (Join-Path $Root 'package.json') (Join-Path $PkgDir 'app') -Force
Copy-Item (Join-Path $Root 'package-lock.json') (Join-Path $PkgDir 'app') -Force
Copy-Item (Join-Path $Root 'installer\tools\db.js') (Join-Path $PkgDir 'app\tools') -Force
Copy-Item (Join-Path $ScriptDir 'assets\schema.sql') (Join-Path $PkgDir 'app\assets') -Force
Copy-Item (Join-Path $ScriptDir 'assets\sql-order.json') (Join-Path $PkgDir 'app\assets') -Force

# ---------------------------------------------------------------- 换行符
# Windows 上写的 .sh / Dockerfile 如果是 CRLF，Linux 上会报
#   /usr/bin/env: ‘bash\r’: No such file or directory
Step '统一换行符为 LF（脚本/Dockerfile/yml）'
$lfFiles = @('install.sh', 'uninstall.sh', 'backup.sh', 'restore.sh', 'Dockerfile',
             'docker-compose.yml', '.env.example', 'app\tools\db.js')
foreach ($rel in $lfFiles) {
  $p = Join-Path $PkgDir $rel
  if (Test-Path $p) {
    $text = [System.IO.File]::ReadAllText($p)
    $text = $text -replace "`r`n", "`n"
    [System.IO.File]::WriteAllText($p, $text, (New-Object System.Text.UTF8Encoding($false)))
  }
}
Ok "已处理 $($lfFiles.Count) 个文本文件"

# ---------------------------------------------------------------- 打包
Step '生成 tar.gz'
$tarName = "WMS-Docker-$Version.tar.gz"
$tarPath = Join-Path $OutDir $tarName
if (Test-Path $tarPath) { Remove-Item $tarPath -Force }

# 用系统自带 GNU tar（Git Bash / Windows 10+ 均有）
& tar.exe -czf $tarPath -C $BuildDir $PkgName
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tarPath)) { Die 'tar 打包失败' }

$size = (Get-Item $tarPath).Length / 1MB
$appFiles = (Get-ChildItem (Join-Path $PkgDir 'app') -Recurse -File | Measure-Object)
Ok ("程序文件 {0} 个" -f $appFiles.Count)
Ok ("已生成 {0}（{1:N1} MB）" -f $tarName, $size)

Write-Host ''
Write-Host '  ============================================================'
Write-Host "   构建完成：$tarPath" -ForegroundColor Green
Write-Host '  ============================================================'
Write-Host '   目标机执行：tar -xzf ' -NoNewline
Write-Host $tarName -NoNewline
Write-Host ' && cd wms-docker && sudo bash install.sh'
Write-Host ''
