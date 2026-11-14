# MES 开放接口 - 一键开启
# ------------------------------------------------------------------
# 做的事：把 MES 模块补进程序 → 在 .env 里生成 API Key → 重启服务 → 验证
# 只注入 MES 模块，不改动其它任何代码。
#
# 用法：
#   双击 enable-mes-api.bat            （推荐，自动提权）
#   或 powershell -ExecutionPolicy Bypass -File enable-mes-api.ps1
#
# 参数：
#   -InstallDir D:\WMS     指定安装目录（不传则从服务配置里读）
#   -ServiceName WMS       服务名（默认 WMS）
#   -ApiKey xxx            指定 Key（不传则自动生成；已存在则沿用）
#   -NoRestart             只打补丁不重启（下次重启生效）
# ------------------------------------------------------------------
[CmdletBinding()]
param(
  [string]$InstallDir = '',
  [string]$ServiceName = 'WMS',
  [string]$ApiKey = '',
  [switch]$NoRestart,
  [switch]$Elevated
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

function Step($m) { Write-Host "  > $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  [OK] $m" -ForegroundColor Green }
function Warn2($m){ Write-Host "  [!!] $m" -ForegroundColor Yellow }
function Err2($m) { Write-Host "  [XX] $m" -ForegroundColor Red }

function Fail($msg) {
  Write-Host ''
  Err2 $msg
  Write-Host ''
  if (-not $Elevated) { Read-Host '按回车键退出' | Out-Null }
  exit 1
}

# ---------------------------------------------------------------- 提权
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host '  需要管理员权限，正在请求提升...' -ForegroundColor Yellow
  $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
  foreach ($kv in $PSBoundParameters.GetEnumerator()) {
    if ($kv.Value -is [switch]) { if ($kv.Value.IsPresent) { $argList += "-$($kv.Key)" } }
    else { $argList += "-$($kv.Key)"; $argList += "`"$($kv.Value)`"" }
  }
  $argList += '-Elevated'
  $proc = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argList -PassThru
  $proc.WaitForExit()
  exit $proc.ExitCode
}

Write-Host ''
Write-Host '  ============================================================' -ForegroundColor DarkCyan
Write-Host '    WMS  · 开启 MES 开放接口' -ForegroundColor White
Write-Host '  ============================================================' -ForegroundColor DarkCyan
Write-Host ''

# ---------------------------------------------------------------- 定位安装目录
if (-not $InstallDir) {
  $regPath = "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName\Parameters"
  if (Test-Path $regPath) {
    $InstallDir = (Get-ItemProperty -Path $regPath -Name AppDirectory -ErrorAction SilentlyContinue).AppDirectory
  }
}
if (-not $InstallDir) {
  # 补丁放在 <安装目录>\patch\ 下时，取上一级
  $guess = Split-Path -Parent $PSScriptRoot
  if (Test-Path (Join-Path $guess 'dist\main.js')) { $InstallDir = $guess }
}
if (-not $InstallDir) {
  Fail '找不到安装目录。请用 -InstallDir 指定，例如：enable-mes-api.bat -InstallDir D:\WMS'
}

$InstallDir = $InstallDir.Trim().Trim('"').Replace('/', '\').TrimEnd('\')
if (-not (Test-Path (Join-Path $InstallDir 'dist\main.js'))) {
  Fail "该目录下没有 dist\main.js，不是有效的 WMS 安装目录：$InstallDir"
}
Ok "安装目录：$InstallDir"

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

# ---------------------------------------------------------------- 1. 补模块文件
Step '第 1 步 / 共 4 步：补入 MES 模块'
$payload = Join-Path $PSScriptRoot 'dist\modules\mes-api'
if (-not (Test-Path $payload)) { Fail "补丁不完整：缺少 $payload" }

$targetDir = Join-Path $InstallDir 'dist\modules\mes-api'
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
Copy-Item (Join-Path $payload '*.js') $targetDir -Force
Ok '模块文件已就位（4 个）'

# ---------------------------------------------------------------- 2. 注册模块
Step '第 2 步 / 共 4 步：注册到应用'
$appModule = Join-Path $InstallDir 'dist\app.module.js'
if (-not (Test-Path $appModule)) { Fail "找不到 $appModule" }

$text = Get-Content -Path $appModule -Raw -Encoding UTF8
if ($text -match 'mes-api') {
  Ok '已注册过，跳过'
} else {
  $anchor1 = 'const _noticemodule = require("./modules/notice/notice.module");'
  if (-not $text.Contains($anchor1)) {
    Fail '程序结构与预期不一致（找不到模块注册锚点），请改用重新安装/重新部署的方式'
  }
  Copy-Item $appModule "$appModule.bak-$stamp" -Force

  $inject1 = $anchor1 + "`r`nconst _mesapimodule = require(`"./modules/mes-api/mes-api.module`");"
  $text = $text.Replace($anchor1, $inject1)

  $anchor2 = '_noticemodule.NoticeModule,'
  $inject2 = $anchor2 + "`r`n            _mesapimodule.MesApiModule,"
  $text = $text.Replace($anchor2, $inject2)

  [System.IO.File]::WriteAllText($appModule, $text, (New-Object System.Text.UTF8Encoding($false)))
  Ok "已注册（原文件备份为 app.module.js.bak-$stamp）"
}

# ---------------------------------------------------------------- 3. 配置 Key
Step '第 3 步 / 共 4 步：配置 API Key'
$envPath = Join-Path $InstallDir '.env'
if (-not (Test-Path $envPath)) { Fail "找不到配置文件：$envPath" }

$envText = Get-Content -Path $envPath -Raw -Encoding UTF8
$existing = [regex]::Match($envText, '(?m)^\s*MES_API_KEYS\s*=\s*(.+?)\s*$')

if ($existing.Success -and $existing.Groups[1].Value.Trim()) {
  # 沿用第一条 Key 的 Key 部分（配置可能形如 key:名称,key2:名称2）
  $ApiKey = $existing.Groups[1].Value.Split(',')[0].Split(':')[0].Trim()
  Ok "已有配置，沿用 Key：$ApiKey"
} else {
  if (-not $ApiKey) {
    $bytes = New-Object byte[] 16
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $ApiKey = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
  }
  Copy-Item $envPath "$envPath.bak-$stamp" -Force
  $block = "`r`n# MES 开放接口（改动后需重启服务生效；文档：docs/MES对接WMS接口文档-v1.md）`r`nMES_API_KEYS=$ApiKey`:mes`r`n"
  Add-Content -Path $envPath -Value $block -Encoding UTF8 -NoNewline
  Ok "已写入新 Key：$ApiKey"
}

# ---------------------------------------------------------------- 4. 重启并验证
$port = 3000
$pm = [regex]::Match($envText, '(?m)^\s*SERVER_PORT\s*=\s*(\d+)')
if ($pm.Success) { $port = [int]$pm.Groups[1].Value }

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue

if ($NoRestart) {
  Write-Host ''
  Warn2 '已跳过重启（-NoRestart），下次服务重启后生效'
} elseif (-not $svc) {
  Write-Host ''
  Warn2 "未找到服务 $ServiceName，请手动启动程序后验证"
} else {
  Step '第 4 步 / 共 4 步：重启服务'
  Restart-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
  $running = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    $s = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($s -and $s.Status -eq 'Running') { $running = $true; break }
  }
  if ($running) { Ok '服务已重启' } else { Warn2 '服务未能在 30 秒内进入 Running，请检查日志' }

  Step '正在验证接口...'
  $okFlag = $false
  for ($i = 0; $i -lt 30; $i++) {
    try {
      $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/mes/v1/ping" `
        -Headers @{ 'X-Api-Key' = $ApiKey } -TimeoutSec 3 -ErrorAction Stop
      if ($resp.code -eq 0) { $okFlag = $true; break }
    } catch { }
    Start-Sleep -Seconds 2
  }
  if ($okFlag) {
    Ok '接口验证通过（code=0）'
  } else {
    Warn2 '接口未通过验证。请查看日志：' + (Join-Path $InstallDir 'logs\service-out.log')
  }
}

# ---------------------------------------------------------------- 汇总
Write-Host ''
Write-Host '  ============================================================' -ForegroundColor DarkGreen
Write-Host '    完成' -ForegroundColor Green
Write-Host '  ============================================================' -ForegroundColor DarkGreen
Write-Host ''
Write-Host "    API Key      $ApiKey" -ForegroundColor Yellow
Write-Host "    接口地址     http://<服务器IP>:$port/api/mes/v1" -ForegroundColor White
Write-Host "    自检命令     curl -H `"X-Api-Key: $ApiKey`" http://127.0.0.1:$port/api/mes/v1/ping"
Write-Host '    接口文档     docs\MES对接WMS接口文档-v1.md'
Write-Host ''
Write-Host '    把这个 Key 和接口文档发给 MES 厂商即可。' -ForegroundColor Gray
Write-Host ''

if (-not $Elevated) { Read-Host '按回车键关闭' | Out-Null }
exit 0
