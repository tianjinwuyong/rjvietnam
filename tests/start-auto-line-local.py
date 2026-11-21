import os
import subprocess
import sys
from pathlib import Path

WORKSPACE = Path(__file__).resolve().parents[2]
STATIONS_ROOT = next(p for p in WORKSPACE.iterdir() if p.is_dir() and any(c.name.startswith("002-") for c in p.iterdir()))
ROOT = next(p for p in STATIONS_ROOT.iterdir() if p.name.startswith("002-"))
def station(number): return next(p for p in ROOT.iterdir() if p.is_dir() and p.name.startswith(f"({number:02d})"))
PYTHONW = Path(r"C:\Users\tianj\AppData\Local\Programs\Python\Python38\pythonw.exe")
SCRIPTS = [
    station(2) / "aoi_quality_agent.py",
    station(3) / "ict_agent.py",
    station(4) / "fct_agent.py",
    station(5) / "depanel_heartbeat_agent.py",
    station(6) / "qrbinding.py",
    station(7) / "assembly_ate_agent.py",
    station(8) / "supersonic_agent.py",
    station(9) / "aging_cab_agent.py",
    station(10) / "hivolt_ate_agent.py",
    *[p / "packing_ate_agent.py" for p in ROOT.iterdir() if p.is_dir() and p.name.startswith("(11)")],
    station(12) / "qrbinding.py",
    station(13) / "pallet_binding_agent.py",
]

env = os.environ.copy()
env.update({
    "FACTORY_DOMAIN": "auto",
    "LINE_DOMAIN": "auto",
    "MES_API": "http://127.0.0.1:8080/api",
    "MES_API_URL": "http://127.0.0.1:8080/api/pda/events",
    "MES_BASE_URL": "http://127.0.0.1:8080",
    "MES_NEW_API": "http://127.0.0.1:8080/api",
    "MES_NG_CHECK_API": "http://127.0.0.1:8080/api/mes/ng-check",
    "ICT_WATCH_DIR": r"D:\RUIJING_TEST\AUTO\ICT",
    "FCT_WATCH_DIR": r"D:\RUIJING_TEST\AUTO\FCT",
    "ASSEMBLY_ATE_WATCH_DIR": r"D:\RUIJING_TEST\AUTO\ASSEMBLY_ATE",
    "HIVOLT_ATE_WATCH_DIR": r"D:\RUIJING_TEST\AUTO\HIVOLT_ATE",
    "PACKING_ATE_WATCH_DIR": r"D:\RUIJING_TEST\AUTO\PACKING_ATE",
    "ICT_SCANNER_TCP_PORT": "12003",
    "FCT_SCANNER_TCP_PORT": "12004",
})
for key in ("ICT_WATCH_DIR", "FCT_WATCH_DIR", "ASSEMBLY_ATE_WATCH_DIR",
            "HIVOLT_ATE_WATCH_DIR", "PACKING_ATE_WATCH_DIR"):
    Path(env[key]).mkdir(parents=True, exist_ok=True)
flags = (getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
         | getattr(subprocess, "DETACHED_PROCESS", 0))
requested = {value.lower() for value in sys.argv[1:]}
for script in SCRIPTS:
    if requested and script.stem.lower() not in requested and script.parent.name.lower() not in requested:
        continue
    station_env=env.copy()
    if script.parent.name.startswith("(06)"):
        station_env.update({"MES_NEW_STATION":"auto_shellbinding","STATION_IP":"192.168.6.54",
                            "STATION_LOCAL_PORT":"8089","STATION_WS_PORT":"11006"})
    elif script.parent.name.startswith("(12)"):
        station_env.update({"MES_NEW_STATION":"auto_case_binding","STATION_IP":"192.168.6.61",
                            "STATION_LOCAL_PORT":"8090","STATION_WS_PORT":"11012"})
    process = subprocess.Popen(
        [str(PYTHONW), str(script)], cwd=str(script.parent), env=station_env,
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL, creationflags=flags, close_fds=True,
    )
    print(f"STARTED {process.pid} {script}")
