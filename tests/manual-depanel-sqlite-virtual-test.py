import importlib.util
import gc
import shutil
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AGENT_DIR = ROOT / "瑞晶越南工位-正式命名" / "004-手动线" / "(05)PCBA分板工位"
sys.path.insert(0, str(AGENT_DIR))
spec = importlib.util.spec_from_file_location("depanel_virtual_agent", AGENT_DIR / "depanel_heartbeat_agent.py")
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)

temp = tempfile.mkdtemp(prefix="depanel-vtest-")
try:
    temp_path = Path(temp)
    agent.SN_DB = temp_path / "depanel_sn.db"
    agent.NG_DB = temp_path / "depanel_ng.db"
    agent.init_databases()

    tag = "VTESTDEP01"
    members = []
    for slot in range(1, 13):
        ict_ng = slot in (2, 5)
        fct_ng = slot in (5, 9)
        members.append({
            "slot": slot,
            "sn": f"VT{slot:08d}",
            "ictNg": ict_ng,
            "fctNg": fct_ng,
            "result": "FAIL" if ict_ng or fct_ng else "PASS",
        })
    event = {"payload": {
        "motherboardId": tag,
        "version": 1001,
        "updatedAt": "2026-07-27T00:00:00Z",
        "members": members,
    }}
    summary = agent.sync_merged_motherboard(event)
    expected = {"ICT_NG": 1, "FCT_NG": 1, "ICT_FCT_NG": 1}
    if summary["counts"] != expected:
        raise AssertionError(f"wrong depanel counts: {summary['counts']}")

    if agent.sync_merged_motherboard(event) is not None:
        raise AssertionError("stale MES version was written twice")

    with sqlite3.connect(agent.NG_DB) as conn:
        rows = conn.execute(
            "SELECT slot,sn,result,ict_ng,fct_ng FROM motherboard_members WHERE batch_id=? ORDER BY slot",
            (tag,),
        ).fetchall()
        ng_rows = conn.execute(
            "SELECT sn,ict_ng,fct_ng FROM confirmed_ng WHERE batch_id=? ORDER BY sn",
            (tag,),
        ).fetchall()
        scanned = conn.execute(
            "SELECT batch_id,slot,result,ict_ng,fct_ng FROM motherboard_members WHERE sn=?",
            ("VT00000005",),
        ).fetchone()
    del conn
    if len(rows) != 12 or len(ng_rows) != 3:
        raise AssertionError(f"wrong SQLite rows members={len(rows)} ng={len(ng_rows)}")
    if scanned != (tag, 5, "ICT_FCT_NG", 1, 1):
        raise AssertionError(f"scan lookup mismatch: {scanned}")
    print("PASS depanel: 12 members persisted, 3 exclusive NG, child SN lookup returns motherboard")
finally:
    gc.collect()
    removed = False
    for _ in range(10):
        try:
            shutil.rmtree(temp)
            removed = True
            break
        except PermissionError:
            gc.collect()
            time.sleep(0.2)
    if not removed:
        raise RuntimeError(f"temporary SQLite cleanup failed: {temp}")
    print("Cleanup complete: temporary depanel SQLite removed")
