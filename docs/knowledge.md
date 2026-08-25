# Manual Line — Station Architecture

## Web Access URLs

Dedicated manual-line 3D page: `http://localhost:5178/3dmanualline.html`.

| URL | Description | Auth |
|-----|-------------|------|
| `http://localhost:8080/#manual-line-3d` | 3D产线全屏视图（手动线） | 需登录（MES系统） |
| `http://localhost:8080/station-topology` | Station拓扑+Andon看板 | 无（静态页） |
| `http://localhost:5178` | Vite开发服务器（MES主系统） | 需登录 |
| `http://localhost:5175` | display-board独立开发服务器 | 无 |

## Ports

| Port | Purpose | Auth |
|------|---------|------|
| 8089 | **Sync API** — MES/3D dashboard reads pools, stats, SQLite data | `X-Api-Key: VN-FACTORY-2024` |
| 1004 | WebSocket broadcast — scan/NG/dup events to local UI | None |
| 10080 | Station HTTP API — start/stop/status/shutdown (legacy) | None |

## Station Sync API (port 8089)

All stations serve a **SyncHandler** on port 8089 with API key auth.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/stats` | `{total, pass, fail, dup, date}` — from SQLite `ate_center.db` |
| GET | `/pools` | `{sn_pool, ng_pool, dup_pool, counts}` — in-memory pools |
| GET | `/sn_records?limit=100` | Last N scans from `sn_records` table |
| GET | `/ng_pool` | NG queue from `ate_ng_pool.db` |
| GET | `/dup_pool` | Duplicate SN pool |
| GET | `/health` | `{status: ok}` |

### Authentication

```
Header: X-Api-Key: VN-FACTORY-2024
Or:    ?key=VN-FACTORY-2024
```

Default key. Override via env var `STATION_API_KEY`.

## Station → MES Communication

Stations push scan events to MES via background bridge thread:
```
POST http://192.168.6.122:8080/api/mes/stations/{stationCode}/events
```

MES stores canonical data in PostgreSQL (`pcb_serials`, `ng_defect_records`, `station_events`).

## Duplicate SN Detection (6 Layers)

| Layer | Source | Speed | Blocks scan? |
|-------|--------|-------|-------------|
| 1 | Memory pool (`_sn_pool`) | ~0ms | YES |
| 2 | Local SQLite (`sn_records`) | ~1ms | Late |
| 3 | MES product table | ~100ms | Late |
| 3.5 | MES NG registry | ~100ms | Late |
| 4 | Local SQLite (`ng_records`) | ~1ms | Late |
| 5 | Memory NG pool (`_ng_pool`) | ~0ms | YES |

Fast path: SN passes immediately → background threads fire all slow checks → if MES later finds dup/NG, SN gets flagged in memory pool → **next** scan triggers alarm.

## MES NG Detection

When SN scans FAIL:
1. Station locks ATE (`pssuspend`)
2. Writes to `pending_queue`
3. POSTs to MES `/mes/stations/:code/events` with `result=fail`
4. Asynchronously checks MES NG history — if found, marks `_ng_pool` and locks station

## 3D Dashboard Sync

```
3D Dashboard (5178)
  → POST /api/mes/manual-line/station-stats
    → backend proxies to http://192.168.1.x:8089/stats
      → station reads SQLite → returns {total, pass, fail, dup}
```

Polls every 5 seconds. API key passed by backend.

## EXE Deployment

EXEs rebuilt after source changes → copied to `C:\usb_deploy\Stations\`
Deploy via USB to station PC → copy to `D:\Stations\` → kill old process → start new exe.

## Station IP Mapping

| Dashboard # | Station | IP | Code |
|-------------|---------|-----|------|
| 4 | ICT | 192.168.1.91 | manu_ict |
| 5 | FCT | 192.168.1.92 | manu_fct |
| 6 | 分板机 | 192.168.1.93 | manu_depanel |
| 7 | QR外壳绑码 | 192.168.1.94 | manu_shellbinding |
| 8 | 组装ATE | 192.168.1.95 | manu_assem_ate |
| 9 | 超声波 | 192.168.1.96 | manu_supersonic |
| 10 | 老化柜 | 192.168.1.97 | manu_agingcab |
| 11 | 高压测试 | 192.168.1.98 | manu_hivolt_ate |
| 12 | 包装ATE | 192.168.1.99 | manu_package_ate |
| 13 | 外箱绑码 | 192.168.1.100 | manu_outer_box_binding |
| 14 | 栈板绑码 | 192.168.6.161 | manu_pallet_binding |

## Station Data Sources

### Ultrasonic (SQL Server)
| Item | Value |
|------|-------|
| Host | 192.168.1.96 |
| Port | 1433 |
| User | sa |
| Password | 888888 |
| Database | mesdb |
| NG Table | (待确认) |
| NG SN Column | PSN |
| NG Result Column | Result (`OK` / `NG`) |
| NG Time Column | TestDatetime |

### AgingCab (MySQL)
| Item | Value |
|------|-------|
| Host | 192.168.6.97 |
| Port | 3306 |
| User | root |
| Password | 8712234 |
| Database | ps |
| NG Table | ps_station_log |
| NG SN Column | sn |
| NG Result Column | result (`PASS` / `NG`) |
| NG Time Column | tested_at |
| NG Reason Column | ng_reason |
| Station Column | station |
| Notes | ps_station_log 当前为空；NG老化数据待写入 |

### All Other ATE Stations (Excel polling)
| Station | Data Source Path |
|---------|-----------------|
| ICT | D:\SRC |
| FCT, Depanel, AssemblyATE, HiVoltATE, PackingATE, Packing | D:\ATS\测试报表 |
| QRBinding, Ultrasonic, AgingCab | 无 Excel 数据源（DB 直连） |

## EXE Names

| Station | EXE |
|---------|-----|
| ICT | ICT_station.exe |
| FCT | FCT_station.exe |
| 分板机 | PCBADividerStation.exe |
| QR外壳绑码 | QRBinding_v2.exe |
| 组装ATE | AssemblyATE.exe |
| 超声波 | UltrasonicStation.exe |
| 老化柜 | AgingCab.exe |
| 高压测试 | HiVoltATE.exe |
| 包装ATE | PackingATE.exe |
| 包装 | PackingStation.exe |

## 远程部署到 192.168.6.161 (DESKTOP-ONL6MT1)

**问题**: MSI 安装失败（Error 1719 — Windows Installer Service SID 映射损坏）。Windows 能力安装也报 Access Denied。

**解法**: 下载 OpenSSH ZIP 便携版，手动 `sc.exe create` 注册服务。

```powershell
# 1. 下载 ZIP
Invoke-WebRequest -Uri "https://github.com/PowerShell/Win32-OpenSSH/releases/download/v9.5.0.0p1-Beta/OpenSSH-Win64.zip" -OutFile C:\Windows\Temp\OpenSSH-Win64.zip

# 2. 解压（解压出来会多一层 OpenSSH-Win64 目录）
Expand-Archive C:\Windows\Temp\OpenSSH-Win64.zip -DestinationPath "C:\Program Files\OpenSSH" -Force

# 3. 创建服务（注意路径要指向 sshd.exe）
sc.exe create sshd binPath= "C:\Program Files\OpenSSH\OpenSSH-Win64\sshd.exe" DisplayName= "OpenSSH SSH Server" start= auto

# 4. 启动
Start-Service sshd

# 5. 防火墙
New-NetFirewallRule -Name sshd -DisplayName "OpenSSH" -Direction Inbound -Protocol TCP -LocalPort 22 -Action Allow -Enabled True
```

**部署文件到 .161**（从本机）:

```bash
# 创建目录（SSH 进入）
sshpass -p rj ssh -o StrictHostKeyChecking=no admin@192.168.6.161 "mkdir C:\Stations; mkdir C:\Stations\shared"

# 上传 exe
sshpass -p rj scp -o StrictHostKeyChecking=no local_file.exe admin@192.168.6.161:C:\Stations\
```

**SSH 凭据**: `admin` / `rj`（DESKTOP-ONL6MT1 本地管理员）
