import subprocess, re
pids = subprocess.check_output(['ps', 'aux']).decode()
for line in pids.split('\n'):
    if 'services/api/server.js' in line and 'grep' not in line:
        parts = line.split()
        pid = parts[1]
        ppid = parts[2]
        try:
            parent = subprocess.check_output(['ps', '-p', ppid.strip(), '-o', 'comm=']).decode().strip()
            print(f'PID:{pid} PPID:{ppid} PARENT:{parent}')
        except:
            print(f'PID:{pid} PPID:{ppid}')
