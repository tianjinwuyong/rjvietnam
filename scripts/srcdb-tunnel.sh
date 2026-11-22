#!/usr/bin/env bash
# Self-healing SSH tunnel to the running WMS/OA source host (100.107.212.49).
# The datasources providers wms_src/oa_src point at 127.0.0.1:15434/15433,
# which only exist while this tunnel is up. The source peer (Tailscale
# rjyn160) goes offline routinely; ssh -N exits when the link dies, so this
# wrapper re-arms forever. Emits exactly one TUNNEL_UP line per successful
# (re)establishment and TUNNEL_DOWN when a live tunnel dies, so supervisors
# can alert on state changes instead of per-retry noise.
SP="C:/Users/tianj/AppData/Local/Microsoft/WinGet/Packages/xhcoding.sshpass-win32_Microsoft.Winget.Source_8wekyb3d8bbwe/sshpass.exe"
port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && { exec 3>&-; return 0; } || return 1; }
up=0
while true; do
  "$SP" -p rj ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 \
    -o ServerAliveInterval=30 -o ServerAliveCountMax=4 -o ExitOnForwardFailure=yes \
    -N -L 15434:127.0.0.1:5434 -L 15433:127.0.0.1:5433 \
    administrator@100.107.212.49 &
  sshpid=$!
  # wait up to 20s for the forward to accept connections
  for _ in $(seq 1 20); do
    if port_open 15434 && port_open 15433; then
      if [ "$up" -ne 1 ]; then echo "TUNNEL_UP $(date -u +%H:%M:%SZ)"; up=1; fi
      break
    fi
    sleep 1
  done
  wait $sshpid
  rc=$?
  if [ "$up" -eq 1 ]; then echo "TUNNEL_DOWN $(date -u +%H:%M:%SZ) rc=$rc"; up=0; fi
  sleep 30
done
