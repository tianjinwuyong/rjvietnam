@echo off
echo Test 1: ping 122 Tailscale
ping -n 2 -w 1000 100.116.166.118
echo.
echo Test 2: test port 5432 with PowerShell
powershell -Command "try { $t = New-Object System.Net.Sockets.TcpClient; $t.Connect('100.116.166.118', 5432); $t.Close(); Write-Host 'Port 5432 OPEN' } catch { Write-Host ('Port 5432 CLOSED: ' + $_.Exception.Message) }"
echo.
echo Test 3: check if 122:5432 is reachable
netcat -z -w 3 100.116.166.118 5432 2>&1 || echo nc not available
