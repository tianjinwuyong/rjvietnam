# -*- coding: utf-8 -*-
"""
apiserver_fwd_aoi.py — AOI MySQL → MES API 转发服务

在 AOI 工站电脑 (192.168.6.90) 上运行，读取本地 MySQL 检测数据，
通过 HTTP POST 发送到 MES 服务器的 batch 端点。

数据源: 本地 MySQL (127.0.0.1:3306)
目标:   POST http://192.168.6.155:8080/api/mes/stations/scan/batch

用法:
    python apiserver_fwd_aoi.py            # 一次性同步
    python apiserver_fwd_aoi.py --watch    # 持续监控（轮询）
    python apiserver_fwd_aoi.py --once     # 一次性同步后退出

依赖:
    pip install pymysql requests
"""

import os, sys, json, time, hashlib, argparse
from datetime import datetime

# ════════════════════════════════════════════════════════════════
# 配置
# ════════════════════════════════════════════════════════════════
MES_API      = "http://192.168.6.155:8080"
STATION_CODE = "manu_aio"

# AOI 本地 MySQL
MYSQL_HOST = "127.0.0.1"
MYSQL_PORT = 3306
MYSQL_USER = "root"
MYSQL_PASS = "root1234"
MYSQL_DB   = "pcb_detection"   # 固定数据库

# 固定表和列映射（已知的 AOI 检测板表结构）
AOI_TABLE = "detection_board"
AOI_COL_SN = "number"       # PCB序列号/板号
AOI_COL_RESULT = "pass"     # 通过标志 (1=pass, 0=fail)
AOI_COL_TIME = "finish_time" # 检测时间 (varchar "YYYY-MM-DD HH:MM:SS")
AOI_COL_BCR = "bcr_codes"   # 条码

# 已转发 SN 追踪文件（脚本同目录）
STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".fwd_aoi_state.json")

# MES 认证 (从 state 文件加载 token)
AUTH_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".fwd_aoi_auth.json")

# 轮询间隔（秒）
POLL_INTERVAL = 5

# ════════════════════════════════════════════════════════════════

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def load_state():
    try:
        if os.path.exists(STATE_FILE):
            with open(STATE_FILE, 'r') as f:
                return set(json.load(f).get("forwarded", []))
    except Exception as e:
        log(f"State load warning: {e}")
    return set()

def save_state(forwarded):
    try:
        with open(STATE_FILE, 'w') as f:
            json.dump({"forwarded": list(forwarded), "updated_at": datetime.now().isoformat()}, f)
    except Exception as e:
        log(f"State save error: {e}")

def get_mysql_conn():
    import pymysql
    return pymysql.connect(
        host=MYSQL_HOST, port=MYSQL_PORT,
        user=MYSQL_USER, password=MYSQL_PASS,
        charset='utf8', connect_timeout=5
    )

def probe_schema():
    """探测 MySQL 数据库结构，返回 (db_name, table_name, columns)"""
    conn = get_mysql_conn()
    cursor = conn.cursor()

    # 找非系统库
    cursor.execute("SHOW DATABASES")
    dbs = [r[0] for r in cursor.fetchall() if r[0] not in ('information_schema','performance_schema','mysql','sys')]
    if not dbs:
        log("No user databases found!")
        conn.close()
        return None, None, None

    db_name = dbs[0]
    log(f"Using database: {db_name}")
    cursor.execute(f"USE `{db_name}`")

    # 列所有表
    cursor.execute("SHOW TABLES")
    tables = [r[0] for r in cursor.fetchall()]
    log(f"Tables: {', '.join(tables)}")

    # 找 AOI 数据表（有 SN/barcode + result 列的表）
    data_table = None
    data_cols = None
    for tname in tables:
        cursor.execute(f"SHOW COLUMNS FROM `{tname}`")
        cols = [r[0].lower() for r in cursor.fetchall()]
        if (any(c in ('sn', 'barcode', 'serial') for c in cols) and
            any('result' in c or 'pass' in c or 'fail' in c for c in cols)):
            data_table = tname
            cursor.execute(f"SHOW COLUMNS FROM `{tname}`")
            data_cols = [(r[0], r[1]) for r in cursor.fetchall()]
            log(f"  → AOI data table: {tname}")
            break

    if not data_table:
        # 模糊匹配
        for tname in tables:
            if 'aoi' in tname.lower() or 'inspect' in tname.lower():
                data_table = tname
                cursor.execute(f"SHOW COLUMNS FROM `{tname}`")
                data_cols = [(r[0], r[1]) for r in cursor.fetchall()]
                log(f"  → Candidate (fuzzy): {tname}")
                break

    conn.close()
    return db_name, data_table, data_cols

def find_column_mapping(cols):
    """自动匹配列名到 MES 字段"""
    col_names = [c[0] for c in cols]
    log(f"Columns: {', '.join(col_names)}")

    mapping = {}
    mapping['sn'] = next((c for c in col_names if c.lower() in ('sn','barcode','serial','psn')), col_names[0])
    mapping['result'] = next((c for c in col_names if c.lower() in ('result','judge','status','passflag')), col_names[1] if len(col_names) > 1 else col_names[0])
    mapping['time'] = next((c for c in col_names if 'time' in c.lower() or 'date' in c.lower()), None)
    mapping['defect'] = next((c for c in col_names if 'defect' in c.lower() or 'fail' in c.lower() or 'ng' in c.lower() or 'error' in c.lower()), None)

    log(f"Mapping: SN={mapping['sn']}, Result={mapping['result']}, Time={mapping['time'] or 'NOW()'}, Defect={mapping['defect'] or 'N/A'}")
    return mapping

def load_auth():
    """Load cached JWT token"""
    try:
        if os.path.exists(AUTH_FILE):
            with open(AUTH_FILE) as f:
                d = json.load(f)
                if d.get("token"):
                    return d["token"]
    except:
        pass
    return None

def save_auth(token):
    try:
        with open(AUTH_FILE, 'w') as f:
            json.dump({"token": token, "saved_at": datetime.now().isoformat()}, f)
    except Exception as e:
        log(f"Auth save error: {e}")

def ensure_token():
    """Get valid JWT token (login if needed)"""
    token = load_auth()
    if token:
        return token
    # Login to get token
    import requests
    try:
        resp = requests.post(
            f"{MES_API}/api/auth/login",
            json={"username": "VN_OP_001", "password": "Factory@123"},
            timeout=10
        )
        if resp.status_code == 200:
            data = resp.json()
            token = data.get("data", {}).get("token") or data.get("token")
            if token:
                save_auth(token)
                log(f"[OK] Got JWT token")
                return token
        log(f"[WARN] Login failed: {resp.status_code} {resp.text[:200]}")
    except Exception as e:
        log(f"[WARN] Login error: {e}")
    return None

def send_batch(records, token):
    """POST 数据到 MES batch 端点"""
    import requests
    payload = {
        "stationCode": STATION_CODE,
        "records": records
    }
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        resp = requests.post(
            f"{MES_API}/api/mes/stations/scan/batch",
            json=payload,
            headers=headers,
            timeout=10
        )
        if resp.status_code in (200, 201):
            data = resp.json()
            return data.get("inserted", 0), 0
        elif resp.status_code == 401:
            # Token expired - clear it
            log(f"[WARN] Auth failed (401), will re-login next round")
            return 0, len(records)
        else:
            log(f"[WARN] Batch error: {resp.status_code} {resp.text[:200]}")
            return 0, len(records)
    except requests.exceptions.RequestException as e:
        log(f"  POST error: {e}")
        return 0, len(records)

def sync_once():
    """一次同步：读取 MySQL 中未转发的记录，发送到 MES"""
    log(f"Scanning AOI MySQL ({MYSQL_HOST}:{MYSQL_PORT}/{MYSQL_DB}.{AOI_TABLE}) ...")

    # 读取数据（使用固定列映射）
    conn = get_mysql_conn()
    cursor = conn.cursor()
    cursor.execute(f"USE `{MYSQL_DB}`")
    cursor.execute(f"SELECT id, {AOI_COL_SN}, {AOI_COL_RESULT}, {AOI_COL_TIME}, {AOI_COL_BCR}, total, ng FROM `{AOI_TABLE}` ORDER BY id")
    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    log(f"Total rows in MySQL: {len(rows)}")

    forwarded = load_state()
    to_forward = []
    for row in rows:
        row_id, sn_raw, pass_raw, time_raw, bcr_raw, total_val, ng_val = row
        # SN: prefer number column, fall back to bcr_codes
        sn = str(sn_raw or bcr_raw or '').strip()
        if not sn:
            continue
        if sn in forwarded:
            continue

        # Result: use total+ng to determine true pass/fail
        # total>0 and ng=0 → pass; ng>0 or total=0 → fail
        t = int(total_val) if total_val is not None else 0
        n = int(ng_val) if ng_val is not None else 0
        result = 'pass' if (t > 0 and n == 0) else 'fail'

        # Time: finish_time is varchar "YYYY-MM-DD HH:MM:SS"
        occurred_at = str(time_raw) if time_raw else None

        to_forward.append({
            "pcbSerial": sn,
            "result": result,
            "occurredAt": occurred_at,
        })

    if not to_forward:
        log(f"No new records to forward (already forwarded: {len(forwarded)})")
        return 0, 0

    # Get auth token
    token = ensure_token()
    if not token:
        log(f"[ERROR] Cannot get auth token, giving up")
        return 0, len(to_forward)

    log(f"Forwarding {len(to_forward)} records to MES ...")

    # 分批发送
    BATCH = 50
    ok, fail = 0, 0
    for i in range(0, len(to_forward), BATCH):
        batch = to_forward[i:i+BATCH]
        inserted, failed = send_batch(batch, token)
        if inserted > 0:
            for rec in batch:
                forwarded.add(rec['pcbSerial'])
            ok += inserted
        fail += failed
        log(f"  Batch {i//BATCH + 1}: {inserted} ok / {failed} fail")
        # On auth failure, stop and re-login next round
        if failed == len(batch) and i == 0:
            break

    save_state(forwarded)
    log(f"Done: {ok} forwarded, {fail} failed")
    return ok, fail


def watch_loop():
    """持续监控模式"""
    log(f"AOI Forwarder starting (watch mode, {POLL_INTERVAL}s interval)")
    log(f"MySQL: {MYSQL_HOST}:{MYSQL_PORT}, MES: {MES_API}")

    # 首次同步
    ok, fail = sync_once()
    log(f"Initial sync done: {ok} ok / {fail} fail")

    # 持续轮询
    while True:
        time.sleep(POLL_INTERVAL)
        try:
            sync_once()
        except Exception as e:
            log(f"Poll error: {e}")
            time.sleep(10)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AOI MySQL → MES forwarder")
    parser.add_argument("--watch", action="store_true", help="Continuous monitoring mode")
    parser.add_argument("--once", action="store_true", help="Single sync and exit")
    args = parser.parse_args()

    missing = []
    try:
        import pymysql
    except ImportError:
        missing.append("pymysql")
    try:
        import requests
    except ImportError:
        missing.append("requests")

    if missing:
        print(f"[error] Missing dependencies: {', '.join(missing)}")
        print(f"Please run: pip install {' '.join(missing)}")
        sys.exit(1)

    if args.watch:
        watch_loop()
    elif args.once:
        sync_once()
    else:
        sync_once()
