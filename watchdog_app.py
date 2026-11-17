#!/usr/bin/env python3
"""
Hermes cron watchdog — keeps smt-factory-system API + Vite alive.
Run as: python3 watchdog_app.py

Checks every 5 minutes:
  1. API server at http://127.0.0.1:8080/api/health  (or /mes/lines)
  2. Vite dev server at http://127.0.0.1:5178/

If either is down → kill old process → respawn via start_dev.js
Logs to watchdog.log in the project dir.

Exit 0 always (no-agent cron mode).
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
ROOT      = Path(r"C:\Users\tianj\Desktop\越南工厂瑞晶\越南工厂瑞晶\smt-factory-system")
START_SCR = ROOT / "start_dev.js"
LOG_FILE  = ROOT / "watchdog.log"
PID_FILE  = ROOT / "watchdog.pid"

API_URL   = "http://127.0.0.1:8080/api/health"
VITE_URL  = "http://127.0.0.1:5178/"
CHECK_TIMEOUT = 8   # seconds
RESTART_DELAY = 3   # seconds between kill and respawn
# ──────────────────────────────────────────────────────────────────────────────

def log(msg: str) -> None:
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def http_get(url: str, timeout: int = CHECK_TIMEOUT) -> bool:
    """Return True if URL returns 2xx/401/403 (server up), False if unreachable."""
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            resp.read()
            return True
    except urllib.error.HTTPError as e:
        # 401/403 means server up, just needs auth
        return e.code in (401, 403)
    except Exception:
        return False


def is_process_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def kill_pid(pid: int, name: str) -> None:
    try:
        os.kill(pid, signal.SIGTERM)
        log(f"[STOPPED] {name} pid={pid}")
    except OSError:
        pass


def kill_by_name(name: str) -> list[int]:
    """Kill all processes matching name via taskkill. Returns killed PIDs."""
    killed = []
    try:
        out = subprocess.check_output(
            ["tasklist", "/FI", f"IMAGENAME eq {name}"], text=True
        )
        for line in out.splitlines():
            if name.lower() in line.lower() and line.strip():
                parts = line.split()
                if len(parts) >= 2:
                    pid = int(parts[1])
                    try:
                        subprocess.run(
                            ["taskkill", "/F", "/PID", str(pid)],
                            check=True, capture_output=True,
                        )
                        killed.append(pid)
                    except subprocess.CalledProcessError:
                        pass
    except Exception:
        pass
    return killed


def respawn() -> bool:
    """Kill existing node processes for this app, then respawn via start_dev.js."""
    log("[RESPAWN] Stopping old processes...")

    # Write current watchdog PID to pid file
    try:
        with open(PID_FILE, "w") as f:
            f.write(str(os.getpid()))
    except Exception:
        pass

    # Kill node processes spawned by start_dev.js
    # The script spawns: node (server.js) and node (vite)
    killed_api  = kill_by_name("node.exe")
    log(f"[RESPAWN] Killed node.exe pids: {killed_api}")

    time.sleep(RESTART_DELAY)

    try:
        log(f"[RESPAWN] Starting: {START_SCR}")
        subprocess.Popen(
            ["node", str(START_SCR)],
            cwd=str(ROOT),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS,
        )
        log("[RESPAWN] start_dev.js launched OK")
        return True
    except Exception as e:
        log(f"[RESPAWN] FAILED: {e}")
        return False


def main() -> int:
    issues: list[str] = []

    api_ok  = http_get(API_URL)
    vite_ok = http_get(VITE_URL)

    if not api_ok:
        issues.append("API(8080) DOWN")
    if not vite_ok:
        issues.append("Vite(5178) DOWN")

    if issues:
        log(f"[DOWN] {' + '.join(issues)} — restarting...")
        respawn()
    else:
        log("[OK] API(8080) + Vite(5178) alive")

    # Write current watchdog PID
    try:
        with open(PID_FILE, "w") as f:
            f.write(str(os.getpid()))
    except Exception:
        pass

    return 0


if __name__ == "__main__":
    sys.exit(main())
