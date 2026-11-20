<#
  生成/更新 WMS 的 HTTPS 自签名证书（带 Subject Alternative Name）。

  为什么必须带 SAN：
    自 Chrome 58 / iOS Safari 12 起，浏览器已完全忽略证书的 CN 字段，
    只认 SAN（Subject Alternative Name）。证书没有 SAN 时，即使把证书
    安装到手机并设为"完全信任"，浏览器依然判定为不匹配 —— 页面停留在
    非安全上下文，navigator.mediaDevices 为 undefined，摄像头永远拉不起来。

  本脚本自动探测本机全部 IPv4 地址，连同 localhost / 127.0.0.1 / 主机名
  一起写进 SAN，因此换 WiFi、IP 变化后重跑一次即可（服务启动时也会自动调用）。

  产物：
    ssl/wms-cert.pfx  —— 服务端使用（https.createServer），密码见 -Passphrase
    ssl/wms-cert.crt  —— 手机端下载安装用（DER 编码，iOS/Android 均识别）

  用法：
    powershell -ExecutionPolicy Bypass -File scripts/gen-ssl-cert.ps1
    powershell -ExecutionPolicy Bypass -File scripts/gen-ssl-cert.ps1 -Passphrase wms2024 -Years 5
#>
[CmdletBinding()]
param(
  # PFX 导出密码，需与 server/main.ts 中读取的 passphrase 保持一致
  [string]$Passphrase = 'wms2024',
  # 证书有效期（年）
  [int]$Years = 5,
  # 输出目录（默认项目根下的 ssl）
  [string]$OutDir = '',
  # 是否输出机器可读的 JSON 结果（供 node 调用时解析）
  [switch]$Json
)

$ErrorActionPreference = 'Stop'

# 定位项目根目录（脚本位于 <root>/scripts/）
$Root = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $Root 'ssl' }
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

# ── 1. 收集需要写入 SAN 的地址 ──────────────────────────────────────────
$dnsNames = New-Object System.Collections.Generic.List[string]
$ipAddrs  = New-Object System.Collections.Generic.List[string]

# 固定项：本机回环 + 主机名
$dnsNames.Add('localhost') | Out-Null
$ipAddrs.Add('127.0.0.1') | Out-Null
$hostName = [System.Net.Dns]::GetHostName()
if ($hostName) {
  $dnsNames.Add($hostName) | Out-Null
  $dnsNames.Add("$hostName.local") | Out-Null
}
if ($env:COMPUTERNAME -and $env:COMPUTERNAME -ne $hostName) {
  $dnsNames.Add($env:COMPUTERNAME) | Out-Null
  $dnsNames.Add("$env:COMPUTERNAME.local") | Out-Null
}

# 动态项：本机全部可用 IPv4（排除回环与 APIPA 169.254.x.x 链路本地地址）
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  ForEach-Object { $ipAddrs.Add($_.IPAddress) | Out-Null }

# 兜底：某些精简系统没有 Get-NetIPAddress
if ($ipAddrs.Count -le 1) {
  [System.Net.Dns]::GetHostAddresses($hostName) |
    Where-Object { $_.AddressFamily -eq 'InterNetwork' -and $_.IPAddressToString -notlike '127.*' } |
    ForEach-Object { $ipAddrs.Add($_.IPAddressToString) | Out-Null }
}

# 去重并保持顺序
$dnsNames = $dnsNames | Select-Object -Unique
$ipAddrs  = $ipAddrs  | Select-Object -Unique

# ── 2. 拼装 SAN 文本扩展 ────────────────────────────────────────────────
# 格式：2.5.29.17={text}DNS=a&IPAddress=1.2.3.4
$sanParts = @()
$sanParts += ($dnsNames | ForEach-Object { "DNS=$_" })
$sanParts += ($ipAddrs  | ForEach-Object { "IPAddress=$_" })
$sanValue = ($sanParts -join '&')

# ── 3. 生成自签名证书 ───────────────────────────────────────────────────
# 只通过 TextExtension 写扩展，不再传 -DnsName，避免与之重复或相互覆盖。
#   2.5.29.17 = Subject Alternative Name（同时含 DNS 与 IPAddress）
#   2.5.29.19 = Basic Constraints，标记为 CA，这样手机把本证书安装为
#               "受信任根证书"时才被系统认可为合法信任锚
#   2.5.29.37 = 增强型密钥用法（服务器身份验证）
$cert = New-SelfSignedCertificate `
  -Subject "CN=$hostName, O=WMS Warehouse" `
  -TextExtension @(
    "2.5.29.17={text}$sanValue",
    '2.5.29.19={critical}{text}ca=1',
    '2.5.29.37={text}1.3.6.1.5.5.7.3.1'
  ) `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -HashAlgorithm SHA256 `
  -KeyExportPolicy Exportable `
  -KeyUsage DigitalSignature, KeyEncipherment `
  -NotAfter (Get-Date).AddYears($Years) `
  -CertStoreLocation 'Cert:\CurrentUser\My'

$pfxPath = Join-Path $OutDir 'wms-cert.pfx'
$crtPath = Join-Path $OutDir 'wms-cert.crt'

try {
  # PFX：供 Node https.createServer 使用
  $securePwd = ConvertTo-SecureString -String $Passphrase -AsPlainText -Force
  Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePwd -Force | Out-Null

  # CRT：DER 编码，手机端下载安装用（iOS 描述文件 / Android 凭据安装均识别）
  Export-Certificate -Cert $cert -FilePath $crtPath -Type CERT -Force | Out-Null
}
finally {
  # 清理临时证书，不在用户证书存储里留垃圾
  Remove-Item -Path "Cert:\CurrentUser\My\$($cert.Thumbprint)" -Force -ErrorAction SilentlyContinue
}

# 展示用的主地址：优先局域网 IP，不要用回环地址（手机访问不到 127.0.0.1）
$primaryIp = ($ipAddrs | Where-Object { $_ -ne '127.0.0.1' } | Select-Object -First 1)
if (-not $primaryIp) { $primaryIp = '127.0.0.1' }

if ($Json) {
  [pscustomobject]@{
    ok        = $true
    pfx       = $pfxPath
    crt       = $crtPath
    thumbprint= $cert.Thumbprint
    dns       = @($dnsNames)
    ips       = @($ipAddrs)
    primaryIp = $primaryIp
    notAfter  = $cert.NotAfter.ToString('yyyy-MM-dd')
  } | ConvertTo-Json -Compress
} else {
  Write-Host "证书已生成：$crtPath" -ForegroundColor Green
  Write-Host "  PFX      : $pfxPath"
  Write-Host "  指纹      : $($cert.Thumbprint)"
  Write-Host "  有效期至  : $($cert.NotAfter.ToString('yyyy-MM-dd'))"
  Write-Host "  DNS      : $($dnsNames -join ', ')"
  Write-Host "  IP       : $($ipAddrs -join ', ')"
  Write-Host ""
  Write-Host "手机端访问：https://$primaryIp:3443" -ForegroundColor Cyan
  Write-Host "证书安装页：http://$primaryIp:3000/cert"
}
