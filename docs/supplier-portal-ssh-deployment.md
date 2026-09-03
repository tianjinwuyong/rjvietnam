# Supplier Portal SSH Deployment

## Server

- Host: `1.13.164.183`
- SSH user: `ubuntu`
- SSH port: `22`
- Authentication: password stored outside Git; never commit the password

```powershell
ssh ubuntu@1.13.164.183
```

## Remote layout

- Supplier Portal API: `/opt/ruijing-supplier-portal/main.py`
- Portal frontend releases: `/var/www/ruijing-supplier-label/releases/`
- Active frontend symlink: `/var/www/ruijing-supplier-label/current`
- Systemd service: `ruijing-supplier-portal.service`
- API local port: `8098`
- Nginx API proxy: `/supplier-api/` → `http://127.0.0.1:8098/`

## Verification

```bash
systemctl is-active ruijing-supplier-portal
readlink -f /var/www/ruijing-supplier-label/current
curl -fsS http://127.0.0.1:8098/health
```

## Release policy

Upload each frontend build into a new timestamped directory under `releases/`, then atomically switch the `current` symlink. Back up `main.py` before replacing the API and restart `ruijing-supplier-portal.service` only after the upload completes.

