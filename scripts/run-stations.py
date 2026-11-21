#!/usr/bin/env python3
"""Run station apps. Usage: python run-stations.py [start|stop|status] [port|code|all]"""
import subprocess, signal, os, sys, time
from pathlib import Path

ROOT = Path("C:/Users/tianj/Desktop/越南工厂瑞晶/越南工厂瑞晶/smt-factory-system/integrations")
BASE_PORT = 5300
PROC_FILE = Path("C:/Users/tianj/Desktop/越南工厂瑞晶/越南工厂瑞晶/smt-factory-system/_station_procs.txt")

def load_json():
    import json
    with open(ROOT.parent / "_l001_stations.json", encoding="utf-8") as f:
        return json.load(f)

def code_to_port(code):
    stations = load_json()
    for i, st in enumerate(stations):
        if st["code"] == code:
            return BASE_PORT + i
    return None

def port_to_code(port):
    stations = load_json()
    idx = port - BASE_PORT
    if 0 <= idx < len(stations):
        return stations[idx]["code"]
    return None

def start(target):
    stations = load_json()
    running = []
    if target == "all":
        targets = stations
    else:
        port = int(target) if target.isdigit() else code_to_port(target)
        if port is None:
            print(f"Unknown: {target}"); return
        targets = [s for i, s in enumerate(stations) if BASE_PORT + i == port]
        if not targets:
            print(f"Station not found: {target}"); return

    for st in targets:
        idx = stations.index(st)
        port = BASE_PORT + idx
        srv = ROOT / st["code"].lower().replace("-","_") / "src" / "server.py"
        if not srv.exists():
            print(f"SKIP {st['code']}: no server.py")
            continue
        log = ROOT.parent / f"_station_{port}.log"
        with open(log, "w") as lf:
            p = subprocess.Popen(
                ["C:/Users/tianj/AppData/Local/Programs/Python/Python314/python.exe", str(srv)],
                stdout=lf, stderr=subprocess.STDOUT,
                cwd=str(srv.parent), creationflags=0x08 if os.name=="nt" else 0
            )
        running.append(f"{st['code']}:{port}:{p.pid}")
        print(f"Started {st['code']} on :{port} (pid={p.pid})")
        time.sleep(0.3)

    with open(PROC_FILE, "w") as f:
        f.write("\n".join(running))
    print(f"\n{running.__len__()} station(s) started")

def stop():
    if not PROC_FILE.exists():
        print("No processes recorded"); return
    lines = PROC_FILE.read_text().strip().split("\n")
    killed = 0
    for line in lines:
        if not line.strip(): continue
        parts = line.split(":")
        if len(parts) >= 3:
            pid = int(parts[2])
            try:
                os.kill(pid, signal.SIGTERM)
                print(f"Killed {parts[0]} (pid={pid})")
                killed += 1
            except: pass
    PROC_FILE.unlink()
    print(f"{killed} stopped")

def status():
    if not PROC_FILE.exists():
        print("No station processes recorded"); return
    lines = PROC_FILE.read_text().strip().split("\n")
    for line in lines:
        if not line.strip(): continue
        parts = line.split(":")
        print(f"  {parts[0]} :{parts[1]} (pid={parts[2]})")

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    arg = sys.argv[2] if len(sys.argv) > 2 else "all"
    if cmd == "start":
        start(arg)
    elif cmd == "stop":
        stop()
    elif cmd == "status":
        status()
    else:
        print("Usage: run-stations.py [start|stop|status] [port|code|all]")
