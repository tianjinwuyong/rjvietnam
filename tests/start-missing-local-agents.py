import os, subprocess
from pathlib import Path

root = Path(r"C:\Users\tianj\Desktop\越南工厂瑞晶\瑞晶越南工位-正式命名")
pythonw = r"C:\Users\tianj\AppData\Local\Programs\Python\Python38\pythonw.exe"
scripts = [
    root / r"005-回修站质量工位\rework_2d_agent.py",
]
env = os.environ.copy()
env.update({"MES_API_URL":"http://127.0.0.1:8080/api/pda/events","MES_API":"http://127.0.0.1:8080/api",
            "MES_NEW_API":"http://127.0.0.1:8080/api","PDA_EVENT_URL":"http://127.0.0.1:8080/api/pda/events"})
for script in scripts:
    process = subprocess.Popen([pythonw, str(script)], cwd=str(script.parent), env=env)
    print(process.pid, script.name)
