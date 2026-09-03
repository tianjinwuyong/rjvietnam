param(
    [string]$RemoteHost = "1.13.164.183",
    [string]$RemoteUser = "ubuntu",
    [string]$IdentityFile = "$env:ProgramData\Ruijing\keys\wms-183-ed25519",
    [int]$RemotePort = 18080,
    [int]$LocalWmsPort = 8080
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $IdentityFile)) {
    throw "WMS tunnel identity file is missing: $IdentityFile"
}
$arguments = @(
    "-NT",
    "-i", $IdentityFile,
    "-o", "BatchMode=yes",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=20",
    "-o", "ServerAliveCountMax=3",
    "-o", "StrictHostKeyChecking=accept-new",
    "-R", "127.0.0.1:${RemotePort}:127.0.0.1:${LocalWmsPort}",
    "${RemoteUser}@${RemoteHost}"
)

while ($true) {
    & ssh @arguments
    Start-Sleep -Seconds 5
}
