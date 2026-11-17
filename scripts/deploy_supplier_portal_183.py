import os
import paramiko

password = os.environ["PORTAL_SSH_PASSWORD"]
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("1.13.164.183", username="ubuntu", password=password, timeout=10, allow_agent=False, look_for_keys=False)
command = """set -e
cp /opt/ruijing-supplier-portal/main.py /opt/ruijing-supplier-portal/main.py.before-supplier-sync
cp /home/ubuntu/main.py.latest /opt/ruijing-supplier-portal/main.py
mkdir -p /var/www/ruijing-supplier-label/releases/20260903-portal-sync
unzip -oq /home/ubuntu/supplier-portal-release.zip -d /var/www/ruijing-supplier-label/releases/20260903-portal-sync
chown -R ubuntu:ubuntu /var/www/ruijing-supplier-label/releases/20260903-portal-sync
ln -sfn /var/www/ruijing-supplier-label/releases/20260903-portal-sync /var/www/ruijing-supplier-label/current
systemctl restart ruijing-supplier-portal
"""
stdin, stdout, stderr = client.exec_command("sudo -S -p '' bash -s")
stdin.write(password + "\n" + command)
stdin.flush()
stdin.channel.shutdown_write()
exit_code = stdout.channel.recv_exit_status()
error = stderr.read().decode().strip()
client.close()
if exit_code:
    raise SystemExit(error or f"deployment failed: {exit_code}")
print("DEPLOY_OK")
