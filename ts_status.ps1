Get-Process tailscale -ErrorAction SilentlyContinue | Select-Object Name,Id
Get-NetIPAddress -InterfaceAlias 'Tailscale*' -ErrorAction SilentlyContinue | Select-Object IPAddress
