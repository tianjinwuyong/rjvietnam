import os
import subprocess
from pathlib import Path

ROOT = Path(r"C:\Users\tianj\Desktop\越南工厂瑞晶\瑞晶越南工位-正式命名")
PYTHONW = Path(r"C:\Users\tianj\AppData\Local\Programs\Python\Python38\pythonw.exe")
SCRIPTS = [
    ROOT / r"004-手动线\(01)PDA扫码上料\pda_station.py",
    ROOT / r"004-手动线\(02)AOI质量工位\aoi_station.py",
    ROOT / r"004-手动线\wave_solder_heartbeat_agent.py",
    ROOT / r"004-手动线\(03)ICT\ict_agent.py",
    ROOT / r"004-手动线\(04)FCT\fct_agent.py",
    ROOT / r"004-手动线\(05)PCBA分板工位\depanel_heartbeat_agent.py",
    ROOT / r"004-手动线\(06)PCBA外壳绑码\qrbinding.py",
    ROOT / r"004-手动线\(07)组装ATE\assembly_ate_agent.py",
    ROOT / r"004-手动线\(08)超声\supersonic_agent.py",
    ROOT / r"004-手动线\(09)成品老化\aging_cab_agent.py",
    ROOT / r"004-手动线\(10)高压ATE\hivolt_ate_agent.py",
    ROOT / r"004-手动线\(11)包装ATE\packing_ate_agent.py",
    ROOT / r"004-手动线\(12)外箱绑码\outer_box_binding_agent.py",
    ROOT / r"004-手动线\(13)栈板绑码\pallet_binding_agent.py",
    ROOT / r"005-回修站质量工位\rework_2d_agent.py",
]

env = os.environ.copy()
env.update({
    "MES_API_URL": "http://127.0.0.1:8080/api/pda/events",
    "MES_API": "http://127.0.0.1:8080/api",
    "MES_NEW_API": "http://127.0.0.1:8080/api",
    "MES_NG_CHECK_API": "http://127.0.0.1:8080/api/mes/ng-check",
    "PDA_EVENT_URL": "http://127.0.0.1:8080/api/pda/events",
    "STATION_ACTIVITY_API": "http://127.0.0.1:8080/api/station/activity",
    "LOCAL_PREFLIGHT": "1",
})

for script in SCRIPTS:
    if not script.exists():
        print(f"MISSING {script}")
        continue
    try:
        process = subprocess.Popen([str(PYTHONW), str(script)], cwd=str(script.parent), env=env)
        print(f"STARTED pid={process.pid} {script.name}")
    except Exception as exc:
        print(f"FAILED {script}: {exc}")
