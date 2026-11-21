import subprocess
from pathlib import Path

root = Path(r'C:\Users\tianj\Desktop\越南工厂瑞晶\smt-factory-system')
flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0) | getattr(subprocess, 'DETACHED_PROCESS', 0)
process = subprocess.Popen(['node.exe', str(root / 'services' / 'api' / 'server.js')], cwd=str(root),
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, creationflags=flags)
print(process.pid)
