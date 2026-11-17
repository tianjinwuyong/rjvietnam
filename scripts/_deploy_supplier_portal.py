import os
import posixpath
import time
from pathlib import Path

import paramiko

host = "1.13.164.183"
username = "ubuntu"
password = os.environ["RJ_DEPLOY_PASSWORD"]
root = Path(__file__).resolve().parents[1]
dist = root / "apps" / "web" / "dist"
api_file = root / "services" / "supplier-portal-api" / "main.py"
release = time.strftime("%Y%m%d%H%M%S")
stage = f"/tmp/ruijing-supplier-{release}"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username=username, password=password, timeout=12)
sftp = client.open_sftp()

def mkdir(path: str) -> None:
    try:
        sftp.mkdir(path)
    except OSError:
        pass

mkdir(stage)
html = (dist / "supplier-label.html").read_text(encoding="utf-8")
asset_names = set(__import__("re").findall(r'(?:src|href)="/([^\"]+)"', html))
asset_names.update({"supplier-label.html", "supplier-label-manifest.json", "supplier-label-icon.svg"})
for relative in sorted(asset_names):
    local = dist / relative
    if not local.is_file():
        continue
    remote = posixpath.join(stage, relative.replace("\\", "/"))
    mkdir(posixpath.dirname(remote))
    sftp.put(str(local), remote)
sftp.put(str(api_file), f"/tmp/ruijing-supplier-main-{release}.py")
sftp.close()

privileged = (
    f"set -e; mkdir -p /var/www/ruijing-supplier-label/releases/{release}; "
    f"cp -a /var/www/ruijing-supplier-label/current/. /var/www/ruijing-supplier-label/releases/{release}/; "
    f"cp -a {stage}/. /var/www/ruijing-supplier-label/releases/{release}/; "
    f"cp /opt/ruijing-supplier-portal/main.py /opt/ruijing-supplier-portal/main.py.bak-{release}; "
    f"cp /tmp/ruijing-supplier-main-{release}.py /opt/ruijing-supplier-portal/main.py; "
    f"ln -sfn /var/www/ruijing-supplier-label/releases/{release} /var/www/ruijing-supplier-label/current; "
    f"systemctl restart ruijing-supplier-portal"
)
command = (
    f"sudo -S -p '' sh -c {__import__('shlex').quote(privileged)}; "
    f"rm -rf {stage} /tmp/ruijing-supplier-main-{release}.py; "
    f"systemctl is-active ruijing-supplier-portal; "
    f"readlink -f /var/www/ruijing-supplier-label/current; "
    f"curl -fsS http://127.0.0.1:8098/health"
)
stdin, stdout, stderr = client.exec_command(command, get_pty=True)
stdin.write(password + "\n")
stdin.flush()
output = stdout.read().decode("utf-8", "replace")
error = stderr.read().decode("utf-8", "replace")
status = stdout.channel.recv_exit_status()
client.close()
print(output.strip())
if status:
    raise SystemExit(error.strip() or f"deployment failed ({status})")
