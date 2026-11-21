#!/usr/bin/env python3
"""
Generate 17 missing station apps in integrations/.
Each gets a Flask backend (src/server.py) and React frontend (index.html).
Port starts at 5374 (after gen74.py's 5300-5373 for L001 stations).
"""
import json, os
from pathlib import Path

BASE = Path(__file__).parent.parent / "integrations"
MES_API = "http://localhost:8080"
PORT_BASE = 5374

# Station definitions
STATIONS = [
    dict(dir="assy-ate", code="ASSY-ATE", name_zh="组装ATE测试", name_en="Assembly ATE Test",
         name_vi="Kiểm tra ATE lắp ráp", stype="ATE",
         ng_codes=[
             ("NG01","桥连/短路","Cầu nối/ngắn mạch","Bridge/Short"),
             ("NG02","缺件/Missing","Thiếu linh kiện","Missing"),
             ("NG03","偏位/位移","Lệch vị trí","Offset"),
             ("NG04","立碑","Đứng mộ","Tombstone"),
             ("NG05","冷焊","Hàn lạnh","Cold solder"),
             ("NG06","焊点不良","Mối hàn kém","Poor solder"),
             ("NG07","元器件坏","Linh kiện hỏng","Component damaged"),
             ("NG08","PCB划伤","Trầy PCB","PCB scratch"),
             ("NG09","极性反","Cực tính ngược","Polarity reversed"),
             ("NG10","ATE通信失败","ATE mất kết nối","ATE comm fail"),
             ("NG11","ATE超时","ATE vượt thời gian","ATE timeout"),
             ("NG12","通道异常","Kênh bất thường","Channel abnormal"),
             ("NG13","其他","Khác","Other"),
         ]),

    dict(dir="ai-insert", code="AI-INSERT", name_zh="AI插件", name_en="AI Insertion",
         name_vi="Cắm AI", stype="AI_INSERT",
         ng_codes=[
             ("NG01","元件极性反","Cực tính ngược","Polarity reversed"),
             ("NG02","元件偏移","Lệch vị trí","Component offset"),
             ("NG03","元件竖立","Đứng linh kiện","Component lifted"),
             ("NG04","元件破损","Linh kiện hỏng","Component damaged"),
             ("NG05","飞件","Bay linh kiện","Flying component"),
             ("NG06","少件","Thiếu linh kiện","Missing component"),
             ("NG07","错件","Sai linh kiện","Wrong component"),
             ("NG08","其他","Khác","Other"),
         ]),

    dict(dir="aoi", code="AOI", name_zh="AOI自动光学检测", name_en="AOI Inspection",
         name_vi="Kiểm tra AOI tự động", stype="AOI",
         ng_codes=[
             ("NG01","桥连","Cầu nối","Bridge"),
             ("NG02","短路","Ngắn mạch","Short"),
             ("NG03","缺件","Thiếu linh kiện","Missing"),
             ("NG04","偏移","Lệch vị trí","Offset"),
             ("NG05","立碑","Đứng mộ","Tombstone"),
             ("NG06","焊点不良","Mối hàn kém","Poor solder"),
             ("NG07","元器件坏","Linh kiện hỏng","Component damaged"),
             ("NG08","PCB变形","PCB biến dạng","PCB deformed"),
             ("NG09","极性反","Cực tính ngược","Polarity reversed"),
             ("NG10","其他","Khác","Other"),
         ]),

    dict(dir="burnin", code="BURNIN", name_zh="老化房", name_en="Burn-in Chamber",
         name_vi="Phòng già hóa", stype="BURNIN",
         ng_codes=[
             ("NG01","温度异常","Nhiệt độ bất thường","Temp abnormal"),
             ("NG02","设备故障","Thiết bị hỏng","Equipment failure"),
             ("NG03","产品移位","Sản phẩm dịch chuyển","Product shifted"),
             ("NG04","烧毁","Cháy","Burned"),
             ("NG05","其他","Khác","Other"),
         ]),

    dict(dir="depanel", code="DEPANEL", name_zh="分板", name_en="Depanel",
         name_vi="Tách panel", stype="DEPANEL",
         ng_codes=[
             ("NG01","分板毛刺","Mep panel","Panel burr"),
             ("NG02","PCBA裂纹","Vết nứt PCBA","PCBA crack"),
             ("NG03","分板尺寸异常","Kích thước bất thường","Size abnormal"),
             ("NG04","元器件脱落","Linh kiện rơi","Component fallout"),
             ("NG05","其他","Khác","Other"),
         ]),

    dict(dir="fct", code="FCT", name_zh="FCT功能测试", name_en="FCT Functional Test",
         name_vi="Kiểm tra chức năng FCT", stype="FCT",
         ng_codes=[
             ("NG01","通信失败","Mất kết nối","Comm failure"),
             ("NG02","电压异常","Điện áp bất thường","Voltage abnormal"),
             ("NG03","电流异常","Dòng điện bất thường","Current abnormal"),
             ("NG04","功能失效","Chức năng lỗi","Function failed"),
             ("NG05","超时装配","Vượt thời gian","Timeout"),
             ("NG06","无法开机","Không thể bật","Cannot power on"),
             ("NG07","显示屏异常","Màn hình bất thường","Display abnormal"),
             ("NG08","按键失效","Phím bấm lỗi","Key failure"),
             ("NG09","传感器失效","Cảm biến lỗi","Sensor failure"),
             ("NG10","其他","Khác","Other"),
         ]),

    dict(dir="hipot", code="HIPOT", name_zh="高压测试", name_en="Hi-pot Test",
         name_vi="Kiểm tra cao áp", stype="HI_POT",
         ng_codes=[
             ("NG01","耐压击穿","Đánh thủng cách điện","Dielectric breakdown"),
             ("NG02","漏电流过大","Dòng rò quá lớn","Leakage current high"),
             ("NG03","绝缘电阻低","Điện trở cách điện thấp","Insulation resistance low"),
             ("NG04","测试超时","Kiểm tra vượt thời gian","Test timeout"),
             ("NG05","其他","Khác","Other"),
         ]),

    dict(dir="ict", code="ICT", name_zh="ICT在线测试", name_en="ICT In-Circuit Test",
         name_vi="Kiểm tra mạch trong", stype="ICT",
         ng_codes=[
             ("NG01","开路","Hở mạch","Open circuit"),
             ("NG02","短路","Ngắn mạch","Short circuit"),
             ("NG03","元件值偏差","Giá trị linh kiện lệch","Component value offset"),
             ("NG04","缺件","Thiếu linh kiện","Missing component"),
             ("NG05","贴装不良","Đặt linh kiện kém","Placement bad"),
             ("NG06","焊点不良","Mối hàn kém","Solder joint bad"),
             ("NG07","其他","Khác","Other"),
         ]),

    dict(dir="laser-mark", code="LASER-MARK", name_zh="激光镭射", name_en="Laser Marking",
         name_vi="Khắc laser", stype="LASER",
         ng_codes=[
             ("NG01","码模糊","Mã mờ","Code blurry"),
             ("NG02","码缺损","Mã thiếu","Code incomplete"),
             ("NG03","位置偏移","Vị trí lệch","Position offset"),
             ("NG04","码重复","Mã trùng","Code duplicate"),
             ("NG05","设备异常","Thiết bị bất thường","Equipment abnormal"),
             ("NG06","其他","Khác","Other"),
         ]),

    dict(dir="label-printer", code="LABEL-PRINTER", name_zh="标签打印", name_en="Label Printing",
         name_vi="In nhãn", stype="LABEL",
         ng_codes=[
             ("NG01","标签模糊","Nhãn mờ","Label blurry"),
             ("NG02","标签缺失","Nhãn thiếu","Label missing"),
             ("NG03","标签错误","Nhãn sai","Label wrong"),
             ("NG04","打印头异常","Đầu in bất thường","Print head abnormal"),
             ("NG05","标签纸用尽","Hết giấy nhãn","Label paper empty"),
             ("NG06","其他","Khác","Other"),
         ]),

    dict(dir="barcode-scanner", code="BARCODE-SCANNER", name_zh="条码扫描", name_en="Barcode Scanning",
         name_vi="Quét mã vạch", stype="SCAN",
         ng_codes=[
             ("NG01","条码无法识别","Mã vạch không nhận dạng","Barcode unreadable"),
             ("NG02","条码重复","Mã vạch trùng","Barcode duplicate"),
             ("NG03","条码格式错误","Định dạng sai","Format error"),
             ("NG04","扫码枪故障","Máy quét hỏng","Scanner failure"),
             ("NG05","其他","Khác","Other"),
         ]),

    dict(dir="shell-bind", code="SHELL-BIND", name_zh="外壳绑定", name_en="Shell Binding",
         name_vi="Gán vỏ máy", stype="SHELL_BIND",
         ng_codes=[
             ("NG01","外壳划伤","Vỏ xước","Shell scratched"),
             ("NG02","外壳破损","Vỏ hỏng","Shell damaged"),
             ("NG03","外壳缺失","Thiếu vỏ","Shell missing"),
             ("NG04","绑定失败","Gán thất bại","Bind failed"),
             ("NG05","外壳不匹配","Vỏ không khớp","Shell mismatch"),
             ("NG06","其他","Khác","Other"),
         ]),

    dict(dir="smart-shelf", code="SMART-SHELF", name_zh="智能货架", name_en="Smart Shelf",
         name_vi="Kệ thông minh", stype="STORAGE",
         ng_codes=[
             ("NG01","货架传感器异常","Cảm biến kệ bất thường","Shelf sensor abnormal"),
             ("NG02","库存数据异常","Dữ liệu tồn kho bất thường","Inventory data abnormal"),
             ("NG03","物料缺失","Vật tư thiếu","Material missing"),
             ("NG04","物料放置错误","Vật tư đặt sai","Material placed wrong"),
             ("NG05","其他","Khác","Other"),
         ]),

    dict(dir="pcba-loading", code="PCBA-LOADING", name_zh="PCBA上料", name_en="PCBA Loading",
         name_vi="Nạp PCBA", stype="PCBA_LOAD",
         ng_codes=[
             ("NG01","PCBA方向错误","Hướng PCBA sai","PCBA direction wrong"),
             ("NG02","PCBA缺失","Thiếu PCBA","PCBA missing"),
             ("NG03","PCBA损坏","PCBA hỏng","PCBA damaged"),
             ("NG04","连接器不良","Đầu nối kém","Connector bad"),
             ("NG05","静电防护失效","Chống tĩnh điện thất bại","ESD protection failed"),
             ("NG06","其他","Khác","Other"),
         ]),

    dict(dir="print", code="PRINT", name_zh="锡膏印刷", name_en="Solder Paste Printing",
         name_vi="In kem hàn", stype="PRINT",
         ng_codes=[
             ("NG01","锡膏少/多","Kem thiếu/nhiều","Paste under/over"),
             ("NG02","偏移","Lệch vị trí","Offset"),
             ("NG03","拉尖","Kéo nhọn","Bridging"),
             ("NG04","焊盘不洁","Bề mặt pad bẩn","Pad dirty"),
             ("NG05","钢网堵塞","Lưới tắc","Stencil clogged"),
             ("NG06","印刷压力异常","Áp suất in bất thường","Print pressure abnormal"),
             ("NG07","其他","Khác","Other"),
         ]),

    dict(dir="smt-aoi", code="SMT-AOI", name_zh="SMT-AOI检测", name_en="SMT AOI",
         name_vi="AOI SMT", stype="SMT_AOI",
         ng_codes=[
             ("NG01","桥连","Cầu nối","Bridge"),
             ("NG02","短路","Ngắn mạch","Short"),
             ("NG03","缺件","Thiếu linh kiện","Missing"),
             ("NG04","偏移","Lệch vị trí","Offset"),
             ("NG05","立碑","Đứng mộ","Tombstone"),
             ("NG06","焊点不良","Mối hàn kém","Poor solder"),
             ("NG07","元器件坏","Linh kiện hỏng","Component damaged"),
             ("NG08","PCB变形","PCB biến dạng","PCB deformed"),
             ("NG09","极性反","Cực tính ngược","Polarity reversed"),
             ("NG10","其他","Khác","Other"),
         ]),

    dict(dir="spi", code="SPI", name_zh="SPI锡膏检测", name_en="SPI Solder Paste Inspection",
         name_vi="Kiểm tra SPI", stype="SPI",
         ng_codes=[
             ("NG01","锡膏不足","Kem không đủ","Paste insufficient"),
             ("NG02","锡膏过量","Kem quá nhiều","Paste excessive"),
             ("NG03","偏移","Lệch vị trí","Offset"),
             ("NG04","形状异常","Hình dạng bất thường","Shape abnormal"),
             ("NG05","焊盘覆盖不足","Pad phủ không đủ","Pad coverage insufficient"),
             ("NG06","高度异常","Chiều cao bất thường","Height abnormal"),
             ("NG07","体积异常","Thể tích bất thường","Volume abnormal"),
             ("NG08","其他","Khác","Other"),
         ]),

    dict(dir="ultra", code="ULTRA", name_zh="超声波焊接", name_en="Ultrasonic Welding",
         name_vi="Hàn siêu âm", stype="ULTRASONIC",
         ng_codes=[
             ("NG01","焊接不牢","Hàn không chắc","Weld not firm"),
             ("NG02","焊点开裂","Mối hàn nứt","Weld cracked"),
             ("NG03","功率异常","Công suất bất thường","Power abnormal"),
             ("NG04","产品移位","Sản phẩm dịch chuyển","Product shifted"),
             ("NG05","超声异常","Siêu âm bất thường","Ultrasonic abnormal"),
             ("NG06","其他","Khác","Other"),
         ]),
]


def build_ng_label_map(ng_codes):
    """Build NG code to label mapping for server.py"""
    parts = []
    for nc in ng_codes:
        parts.append('    "%s": "%s"' % (nc[0], nc[1]))
    return "{\n" + ",\n".join(parts) + "\n}"


def gen_server(st, port):
    """Generate Flask server.py content for a station."""
    ng_label_map = build_ng_label_map(st["ng_codes"])

    i18n_server = json.dumps({
        "zh-CN": {"ready": "系统就绪", "pass": "PASS", "fail": "FAIL", "ng": "NG", "dup_sn": "重复SN"},
        "vi-VN": {"ready": "He thong san sang", "pass": "PASS", "fail": "FAIL", "ng": "NG", "dup_sn": "SN trung lap"},
        "en-US": {"ready": "System ready", "pass": "PASS", "fail": "FAIL", "ng": "NG", "dup_sn": "Duplicate SN"},
    }, ensure_ascii=False)

    ng_list_str = ", ".join(
        '("%s", "%s")' % (nc[0], nc[1])
        for nc in st["ng_codes"]
    )

    server = (
        '#!/usr/bin/env python3\n'
        '# -*- coding: utf-8 -*-\n'
        '"""\n'
        '{code} station backend - {name_zh}\n'
        'Generated by gen_missing_stations.py | port {port}\n'
        '"""\n'
        'import json, threading, logging, sqlite3, os, time\n'
        'from datetime import datetime, timedelta\n'
        'from flask import Flask, request, Response, jsonify\n'
        'from flask_cors import CORS\n'
        '\n'
        'MES_API = "{mes_api}"\n'
        'PORT = {port}\n'
        'SCODE = "{code}"\n'
        'SNAME = "{name_zh}"\n'
        'STYPE = "{stype}"\n'
        '\n'
        'I18N = {i18n}\n'
        '\n'
        'app = Flask(__name__)\n'
        'CORS(app, resources={{r"/api/*": {{"origins": "*"}}}})\n'
        '\n'
        '# ===== Database (SQLite, 5-year retention) =====\n'
        'DB_DIR = os.path.dirname(os.path.abspath(__file__))\n'
        'DB_PATH = os.path.join(DB_DIR, "{dir}.db")\n'
        '\n'
        'def _init_db():\n'
        '    conn = sqlite3.connect(DB_PATH, timeout=10)\n'
        '    conn.execute("""\n'
        '        CREATE TABLE IF NOT EXISTS sn_records (\n'
        '            id INTEGER PRIMARY KEY AUTOINCREMENT,\n'
        '            sn TEXT NOT NULL,\n'
        '            result TEXT NOT NULL,\n'
        '            station TEXT NOT NULL,\n'
        '            operator TEXT,\n'
        '            work_order TEXT,\n'
        '            ng_code TEXT,\n'
        '            ng_qty INTEGER DEFAULT 0,\n'
        '            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n'
        '        )\n'
        '    """)\n'
        '    conn.execute("CREATE INDEX IF NOT EXISTS idx_sn ON sn_records(sn)")\n'
        '    conn.execute("CREATE INDEX IF NOT EXISTS idx_created ON sn_records(created_at)")\n'
        '    conn.execute("""\n'
        '        CREATE TABLE IF NOT EXISTS ng_pool (\n'
        '            id INTEGER PRIMARY KEY AUTOINCREMENT,\n'
        '            sn TEXT NOT NULL UNIQUE,\n'
        '            ng_code TEXT,\n'
        '            operator TEXT,\n'
        '            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n'
        '            cleared_at TIMESTAMP\n'
        '        )\n'
        '    """)\n'
        '    conn.commit()\n'
        '    conn.close()\n'
        '\n'
        '_init_db()\n'
        '\n'
        'def _clean_old_records():\n'
        '    """Delete records older than 5 years"""\n'
        '    try:\n'
        '        conn = sqlite3.connect(DB_PATH, timeout=10)\n'
        '        cutoff = (datetime.now() - timedelta(days=365*5)).strftime("%Y-%m-%d")\n'
        '        cur = conn.execute("DELETE FROM sn_records WHERE created_at < ?", (cutoff,))\n'
        '        conn.commit()\n'
        '        if cur.rowcount > 0:\n'
        '            logging.info("Cleaned %d old records", cur.rowcount)\n'
        '        conn.close()\n'
        '    except Exception as e:\n'
        '        logging.warning("Failed to clean old records: %s", e)\n'
        '\n'
        '_clean_old_records()\n'
        '\n'
        '# ===== TTS (Vietnamese TTS) =====\n'
        '_tts = None\n'
        'def _get_tts():\n'
        '    global _tts\n'
        '    if _tts is None:\n'
        '        try:\n'
        '            import pyttsx3\n'
        '            _tts = pyttsx3.init()\n'
        '            _tts.setProperty("rate", 160)\n'
        '        except Exception as e:\n'
        '            logging.warning("TTS init failed: %s", e)\n'
        '    return _tts\n'
        '\n'
        'def tts(text):\n'
        '    def _speak():\n'
        '        try:\n'
        '            engine = _get_tts()\n'
        '            if engine:\n'
        '                engine.say(text)\n'
        '                engine.runAndWait()\n'
        '        except Exception as e:\n'
        '            logging.warning("TTS failed: %s", e)\n'
        '    threading.Thread(target=_speak, daemon=True).start()\n'
        '\n'
        '# ===== SN Validation =====\n'
        "SN_RE = __import__('re').compile(r'^[A-Za-z0-9_\\-]{{1,50}}$')\n"
        '\n'
        'def validate_sn(sn):\n'
        '    sn = sn.strip()\n'
        '    if not sn: return "empty"\n'
        '    if len(sn) > 50: return "too_long"\n'
        '    if not SN_RE.match(sn): return "invalid"\n'
        '    return None\n'
        '\n'
        '# ===== NG Code Labels =====\n'
        'NG_LABELS = {ng_labels}\n'
        '\n'
        'def _ng_label(ng_code):\n'
        '    return NG_LABELS.get(ng_code, ng_code)\n'
        '\n'
        '# ===== Alarm (PC Speaker beep) =====\n'
        'def _alarm_beep(beeps=3):\n'
        '    """Fire alarm beeps via Windows winsound"""\n'
        '    def _beep():\n'
        '        try:\n'
        '            import winsound\n'
        '            for i in range(beeps):\n'
        '                winsound.Beep(800, 300)\n'
        '                time.sleep(0.2)\n'
        '        except Exception as e:\n'
        '            logging.warning("winsound alarm failed: %s", e)\n'
        '    threading.Thread(target=_beep, daemon=True).start()\n'
        '\n'
        'def _alarm(type="ng"):\n'
        '    """Trigger alarm: beep + optional visual signal via state"""\n'
        '    with state.lock:\n'
        '        state._alarm_type = type\n'
        '        state._alarm_since = time.time()\n'
        '        state._bc()\n'
        '    if type == "ng":\n'
        '        _alarm_beep(3)\n'
        '    elif type == "dup":\n'
        '        _alarm_beep(2)\n'
        '    elif type == "ate_comm":\n'
        '        _alarm_beep(5)\n'
        '    else:\n'
        '        _alarm_beep(1)\n'
        '\n'
        '# ===== State Machine =====\n'
        'class State:\n'
        '    def __init__(self):\n'
        '        self.lock = threading.RLock()\n'
        '        self.sn = None\n'
        '        self.work_order = None\n'
        '        self.op_id = None\n'
        '        self.step = "idle"\n'
        '        self.last_err = None\n'
        '        self.last_rec = None\n'
        '        self.locale = "zh-CN"\n'
        '        self._clients = []\n'
        '        self._hist = []\n'
        '        self._sn_pool = set()\n'
        '        self._ng_pool = set()\n'
        '        self._mes_on = True\n'
        '        self._alarm_type = None\n'
        '        self._alarm_since = None\n'
        '\n'
        '    def t(self, k):\n'
        '        return I18N.get(self.locale, I18N["zh-CN"]).get(k, k)\n'
        '\n'
        '    def dup_check(self, sn):\n'
        '        """Check SN duplicate: NG pool -> SN pool -> SQLite -> MES"""\n'
        '        if sn in self._ng_pool: return "ng_pool"\n'
        '        if sn in self._sn_pool: return "sn_pool"\n'
        '        try:\n'
        '            conn = sqlite3.connect(DB_PATH, timeout=5)\n'
        '            cur = conn.execute("SELECT 1 FROM sn_records WHERE sn=? LIMIT 1", (sn,))\n'
        '            if cur.fetchone():\n'
        '                conn.close()\n'
        '                return "local"\n'
        '            conn.close()\n'
        '        except Exception as e:\n'
        '            logging.warning("SQLite check failed: %s", e)\n'
        '        if self._mes_on:\n'
        '            try:\n'
        '                import urllib.request\n'
        '                req = urllib.request.Request(\n'
        '                    MES_API + "/api/mes/sn-check",\n'
        '                    data=json.dumps({{"sn": sn}}).encode(),\n'
        '                    headers={{"Content-Type": "application/json"}}\n'
        '                )\n'
        '                resp = json.loads(urllib.request.urlopen(req, timeout=5).read())\n'
        '                if resp.get("duplicate"): return "mes"\n'
        '            except Exception as e:\n'
        '                logging.warning("MES dup_check failed: %s", e)\n'
        '        return None\n'
        '\n'
        '    def mes_event(self, sn, result, wo=None, ng_code=None, ng_qty=0, op=None):\n'
        '        payload = {{\n'
        '            "stationCode": SCODE,\n'
        '            "operator": op or ("OP_" + str(self.op_id)),\n'
        '            "result": result,\n'
        '            "traceabilityKey": sn,\n'
        '            "workOrderCode": wo or "",\n'
        '            "ngCode": ng_code or "",\n'
        '            "ngQty": ng_qty,\n'
        '        }}\n'
        '        try:\n'
        '            import urllib.request\n'
        '            urllib.request.urlopen(\n'
        '                urllib.request.Request(\n'
        '                    MES_API + "/api/mes/events",\n'
        '                    data=json.dumps({{"payload": payload}}).encode(),\n'
        '                    headers={{"Content-Type": "application/json"}}\n'
        '                ),\n'
        '                timeout=5\n'
        '            )\n'
        '        except Exception as e:\n'
        '            logging.warning("MES event failed: %s", e)\n'
        '\n'
        '    def do_scan(self, sn, op_id=None, wo=None):\n'
        '        err = validate_sn(sn)\n'
        '        with self.lock:\n'
        '            self.last_err = None\n'
        '            if err:\n'
        '                msg = {{"empty": "SN不能为空", "too_long": "SN太长", "invalid": "SN格式非法"}}[err]\n'
        '                self.last_err = msg\n'
        '                self._bc()\n'
        '                return {{"ok": False, "error": msg}}\n'
        '            sn = sn.strip()\n'
        '            dup_type = self.dup_check(sn)\n'
        '            if dup_type:\n'
        '                msg = self.t("dup_sn")\n'
        '                self.last_err = msg\n'
        '                tts(msg)\n'
        '                _alarm("dup")\n'
        '                self._bc()\n'
        '                return {{"ok": False, "error": msg, "dup": dup_type}}\n'
        '            self.sn = sn\n'
        '            self.work_order = wo\n'
        '            if op_id: self.op_id = op_id\n'
        '            self.step = "scanned"\n'
        '            self._bc()\n'
        '            return {{"ok": True, "step": "scanned", "sn": self.sn}}\n'
        '\n'
        '    def do_pass(self, op_id=None):\n'
        '        with self.lock:\n'
        '            if self.step != "scanned":\n'
        '                return {{"ok": False, "error": "no scan"}}\n'
        '            op = op_id or self.op_id\n'
        '            sn = self.sn\n'
        '            wo = self.work_order\n'
        '            op_str = "OP_" + str(op)\n'
        '            self.mes_event(sn, "PASS", wo, op=op_str)\n'
        '            try:\n'
        '                conn = sqlite3.connect(DB_PATH, timeout=10)\n'
        '                conn.execute("""\n'
        '                    INSERT INTO sn_records (sn, result, station, operator, work_order, created_at)\n'
        '                    VALUES (?, ?, ?, ?, ?, ?)\n'
        '                """, (sn, "PASS", SCODE, op_str, wo or "", datetime.now().isoformat()))\n'
        '                conn.commit()\n'
        '                conn.close()\n'
        '            except Exception as e:\n'
        '                logging.warning("SQLite write failed: %s", e)\n'
        '            rec = {{\n'
        '                "id": len(self._hist) + 1,\n'
        '                "sn": sn,\n'
        '                "result": "PASS",\n'
        '                "station": SCODE,\n'
        '                "time": datetime.now().isoformat(),\n'
        '                "operator": op,\n'
        '                "wo": wo,\n'
        '            }}\n'
        '            self._hist.insert(0, rec)\n'
        '            self._hist = self._hist[:50]\n'
        '            self._sn_pool.add(sn)\n'
        '            self.last_rec = rec\n'
        '            self.step = "passed"\n'
        '            self._bc()\n'
        '            tts(self.t("pass"))\n'
        '            return {{"ok": True, "record": rec}}\n'
        '\n'
        '    def do_ng(self, ng_code, ng_qty=1, op_id=None):\n'
        '        with self.lock:\n'
        '            if self.step not in ("scanned",):\n'
        '                return {{"ok": False, "error": "scan first"}}\n'
        '            op = op_id or self.op_id\n'
        '            sn = self.sn\n'
        '            wo = self.work_order\n'
        '            op_str = "OP_" + str(op)\n'
        '            ng_label = _ng_label(ng_code)\n'
        '            self.mes_event(sn, "NG", wo, ng_code, ng_qty, op_str)\n'
        '            try:\n'
        '                conn = sqlite3.connect(DB_PATH, timeout=10)\n'
        '                conn.execute("""\n'
        '                    INSERT INTO sn_records (sn, result, station, operator, work_order, ng_code, ng_qty, created_at)\n'
        '                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)\n'
        '                """, (sn, "NG", SCODE, op_str, wo or "", ng_code, ng_qty, datetime.now().isoformat()))\n'
        '                conn.execute("INSERT OR IGNORE INTO ng_pool (sn, ng_code, operator, created_at) VALUES (?, ?, ?, ?)",\n'
        '                             (sn, ng_code, op_str, datetime.now().isoformat()))\n'
        '                conn.commit()\n'
        '                conn.close()\n'
        '            except Exception as e:\n'
        '                logging.warning("SQLite write failed: %s", e)\n'
        '            rec = {{\n'
        '                "id": len(self._hist) + 1,\n'
        '                "sn": sn,\n'
        '                "result": "NG",\n'
        '                "station": SCODE,\n'
        '                "time": datetime.now().isoformat(),\n'
        '                "operator": op,\n'
        '                "wo": wo,\n'
        '                "ng_code": ng_code,\n'
        '                "ng_label": ng_label,\n'
        '                "ng_qty": ng_qty,\n'
        '            }}\n'
        '            self._hist.insert(0, rec)\n'
        '            self._hist = self._hist[:50]\n'
        '            self._ng_pool.add(sn)\n'
        '            self.last_rec = rec\n'
        '            self.step = "ng"\n'
        '            self._bc()\n'
        '            tts(self.t("fail"))\n'
        '            _alarm("ng")\n'
        '            return {{"ok": True, "record": rec}}\n'
        '\n'
        '    def do_reset(self):\n'
        '        with self.lock:\n'
        '            self.sn = None\n'
        '            self.work_order = None\n'
        '            self.step = "idle"\n'
        '            self.last_err = None\n'
        '            self.last_rec = None\n'
        '            self._alarm_type = None\n'
        '            self._alarm_since = None\n'
        '            self._bc()\n'
        '\n'
        '    def set_locale(self, locale):\n'
        '        with self.lock:\n'
        '            if locale in I18N:\n'
        '                self.locale = locale\n'
        '                self._bc()\n'
        '\n'
        '    def get_state(self):\n'
        '        with self.lock:\n'
        '            return {{\n'
        '                "step": self.step,\n'
        '                "sn": self.sn,\n'
        '                "work_order": self.work_order,\n'
        '                "op_id": self.op_id,\n'
        '                "locale": self.locale,\n'
        '                "last_err": self.last_err,\n'
        '                "last_rec": self.last_rec,\n'
        '                "history": self._hist[:20],\n'
        '                "station_code": SCODE,\n'
        '                "station_name": SNAME,\n'
        '                "station_type": STYPE,\n'
        '                "mes_on": self._mes_on,\n'
        '                "sn_pool_size": len(self._sn_pool),\n'
        '                "ng_pool_size": len(self._ng_pool),\n'
        '                "alarm_type": self._alarm_type,\n'
        '                "alarm_since": self._alarm_since,\n'
        '            }}\n'
        '\n'
        '    def add_client(self, q):\n'
        '        self._clients.append(q)\n'
        '\n'
        '    def rm_client(self, q):\n'
        '        if q in self._clients:\n'
        '            self._clients.remove(q)\n'
        '\n'
        '    def _bc(self):\n'
        '        import queue\n'
        '        data = json.dumps(self.get_state())\n'
        '        dead = []\n'
        '        for q in self._clients:\n'
        '            try:\n'
        '                q.put_nowait(data)\n'
        '            except:\n'
        '                dead.append(q)\n'
        '        for q in dead:\n'
        '            self.rm_client(q)\n'
        '\n'
        'state = State()\n'
        '\n'
        '# ===== API Endpoints =====\n'
        '\n'
        '@app.route("/api/scan", methods=["POST"])\n'
        'def api_scan():\n'
        '    b = request.get_json() or {{}}\n'
        '    return jsonify(state.do_scan(b.get("sn",""), b.get("op_id"), b.get("work_order")))\n'
        '\n'
        '@app.route("/api/pass", methods=["POST"])\n'
        'def api_pass():\n'
        '    b = request.get_json() or {{}}\n'
        '    return jsonify(state.do_pass(b.get("op_id")))\n'
        '\n'
        '@app.route("/api/ng", methods=["POST"])\n'
        'def api_ng():\n'
        '    b = request.get_json() or {{}}\n'
        '    return jsonify(state.do_ng(b.get("ng_code",""), b.get("ng_qty",1), b.get("op_id")))\n'
        '\n'
        '@app.route("/api/reset", methods=["POST"])\n'
        'def api_reset():\n'
        '    state.do_reset()\n'
        '    return jsonify({{"ok": True}})\n'
        '\n'
        '@app.route("/api/state", methods=["GET"])\n'
        'def api_state():\n'
        '    return jsonify(state.get_state())\n'
        '\n'
        '@app.route("/api/locale", methods=["POST"])\n'
        'def api_locale():\n'
        '    b = request.get_json() or {{}}\n'
        '    loc = b.get("locale", "zh-CN")\n'
        '    if loc not in I18N:\n'
        '        return jsonify({{"ok": False}}), 400\n'
        '    state.set_locale(loc)\n'
        '    return jsonify({{"ok": True, "locale": loc}})\n'
        '\n'
        '@app.route("/api/sse", methods=["GET"])\n'
        'def api_sse():\n'
        '    import queue\n'
        '    q = queue.Queue()\n'
        '    state.add_client(q)\n'
        '    def gen():\n'
        '        while True:\n'
        '            try:\n'
        '                d = q.get(timeout=30)\n'
        '                yield "data: " + d + "\\n\\n"\n'
        '            except queue.Empty:\n'
        '                yield "data: {{\\"type\\": \\"ping\\"}}" + "\\n\\n"\n'
        '    return Response(\n'
        '        gen(),\n'
        '        mimetype="text/event-stream",\n'
        '        headers={{"X-Accel-Buffering": "no", "Cache-Control": "no-cache"}}\n'
        '    )\n'
        '\n'
        '@app.route("/api/history", methods=["GET"])\n'
        'def api_history():\n'
        '    limit = request.args.get("limit", 50, type=int)\n'
        '    try:\n'
        '        conn = sqlite3.connect(DB_PATH, timeout=10)\n'
        '        rows = conn.execute("""\n'
        '            SELECT sn, result, station, operator, work_order, ng_code, ng_qty, created_at\n'
        '            FROM sn_records ORDER BY id DESC LIMIT ?\n'
        '        """, (limit,)).fetchall()\n'
        '        conn.close()\n'
        '        records = [{{\n'
        '            "sn": r[0], "result": r[1], "station": r[2],\n'
        '            "operator": r[3], "wo": r[4], "ng_code": r[5], "ng_qty": r[6], "time": r[7]\n'
        '        }} for r in rows]\n'
        '        return jsonify({{"ok": True, "records": records}})\n'
        '    except Exception as e:\n'
        '        return jsonify({{"ok": False, "error": str(e)}}), 500\n'
        '\n'
        '@app.route("/api/pool-stats", methods=["GET"])\n'
        'def api_pool_stats():\n'
        '    with state.lock:\n'
        '        return jsonify({{\n'
        '            "sn_pool_size": len(state._sn_pool),\n'
        '            "ng_pool_size": len(state._ng_pool),\n'
        '            "mes_on": state._mes_on,\n'
        '        }})\n'
        '\n'
        '@app.route("/api/alarm-test", methods=["POST"])\n'
        'def api_alarm_test():\n'
        '    b = request.get_json() or {{}}\n'
        '    alarm_type = b.get("type", "ng")\n'
        '    _alarm(alarm_type)\n'
        '    return jsonify({{"ok": True, "type": alarm_type}})\n'
        '\n'
        'if __name__ == "__main__":\n'
        '    logging.basicConfig(\n'
        '        level=logging.INFO,\n'
        '        format="%(asctime)s %(levelname)s [%(name)s] %(message)s"\n'
        '    )\n'
        '    logging.info("Starting %s on port %d", SCODE, PORT)\n'
        '    app.run(host="0.0.0.0", port=PORT, debug=False, threaded=True)\n'
    ).format(
        code=st["code"],
        name_zh=st["name_zh"],
        port=port,
        mes_api=MES_API,
        stype=st["stype"],
        i18n=i18n_server,
        dir=st["dir"],
        ng_labels=ng_label_map,
    )

    return server
def gen_html(st, port):
    """Generate index.html for a station."""
    ng_items = ", ".join(
        '{code:"%s",label_zh:"%s",label_vi:"%s",label_en:"%s"}' % (nc[0], nc[1], nc[2], nc[3])
        for nc in st["ng_codes"]
    )

    ui_zh = json.dumps({
        "title": st["name_zh"], "ready": "系统就绪", "scan": "请扫码 SN",
        "pass": "PASS 过站", "ng": "报 NG", "reset": "重置",
        "sel_ng": "选择NG原因", "qty": "数量", "confirm": "确认", "cancel": "取消",
        "pass_ok": "过站成功", "ng_ok": "NG已记录", "history": "最近记录",
        "step_idle": "就绪", "step_scanned": "已扫描", "step_passed": "PASS", "step_ng": "NG",
    }, ensure_ascii=False)

    ui_vi = json.dumps({
        "title": st["name_vi"], "ready": "He thong san sang", "scan": "Quet SN",
        "pass": "PASS Qua tram", "ng": "Bao NG", "reset": "Dat lai",
        "sel_ng": "Chon ly do NG", "qty": "So luong", "confirm": "Xac nhan", "cancel": "Huy",
        "pass_ok": "Qua tram OK", "ng_ok": "NG da ghi", "history": "Lich su",
        "step_idle": "San sang", "step_scanned": "Da quet", "step_passed": "PASS", "step_ng": "NG",
    }, ensure_ascii=False)

    ui_en = json.dumps({
        "title": st["name_en"], "ready": "System ready", "scan": "Scan SN",
        "pass": "PASS", "ng": "Report NG", "reset": "Reset",
        "sel_ng": "Select NG reason", "qty": "Qty", "confirm": "Confirm", "cancel": "Cancel",
        "pass_ok": "Pass success", "ng_ok": "NG recorded", "history": "History",
        "step_idle": "Ready", "step_scanned": "Scanned", "step_passed": "PASS", "step_ng": "NG",
    }, ensure_ascii=False)

    css = (
        "* { margin: 0; padding: 0; box-sizing: border-box; }"
        "body { font-family: Arial, 'Microsoft YaHei', sans-serif; background: #1a1a2e; color: #eee; min-height: 100vh; }"
        ".hdr { background: #16213e; padding: 10px 24px; display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #0f3460; }"
        ".hdr-title { font-size: 20px; font-weight: 700; color: #e94560; }"
        ".hdr-station { font-size: 13px; color: #888; }"
        ".lang-btns { display: flex; gap: 6px; }"
        ".lang-btn { padding: 5px 12px; border-radius: 6px; border: none; cursor: pointer; font-size: 13px; font-weight: 600; background: #0f3460; color: #aaa; }"
        ".lang-btn.active { background: #e94560; color: #fff; }"
        ".main { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: calc(100vh - 160px); padding: 24px; gap: 20px; }"
        ".step-card { background: #16213e; border: 3px solid #0f3460; border-radius: 20px; padding: 40px 60px; text-align: center; min-width: 480px; box-shadow: 0 8px 32px rgba(0,0,0,0.4); transition: border-color 0.3s; }"
        ".step-label { font-size: 14px; color: #888; margin-bottom: 10px; }"
        ".step-title { font-size: 52px; font-weight: 900; line-height: 1; }"
        ".step-sn { margin-top: 16px; font-size: 18px; background: #0a0a1a; border-radius: 10px; padding: 10px 24px; display: inline-block; color: #aaa; }"
        ".step-sn b { color: #fff; letter-spacing: 2; }"
        ".step-error { margin-top: 14px; font-size: 16px; color: #f44336; font-weight: 700; }"
        ".result-banner { padding: 16px 40px; border-radius: 12px; font-size: 22px; font-weight: 800; text-align: center; display: none; }"
        ".result-pass { background: #1b3a1f; border: 2px solid #4caf50; color: #4caf50; }"
        ".result-ng { background: #3a1b1b; border: 2px solid #f44336; color: #f44336; }"
        ".btn-row { display: flex; gap: 16px; }"
        ".btn { font-size: 20px; font-weight: 800; padding: 16px 48px; border-radius: 14px; border: none; cursor: pointer; letter-spacing: 1; transition: transform 0.1s; }"
        ".btn:active { transform: scale(0.97); }"
        ".btn:hover { opacity: 0.9; }"
        ".btn-pass { background: #4caf50; color: #fff; }"
        ".btn-ng { background: #f44336; color: #fff; }"
        ".btn-reset { background: #37474f; color: #aaa; font-size: 15px; padding: 10px 28px; }"
        ".ng-panel { background: #1a1a2e; border: 2px solid #f44336; border-radius: 14px; padding: 24px 32px; min-width: 460px; }"
        ".ng-panel h3 { color: #f44336; margin-bottom: 16px; font-size: 18px; }"
        ".ng-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }"
        ".ng-item { background: #16213e; border: 1px solid #333; border-radius: 8px; padding: 10px 14px; cursor: pointer; text-align: center; font-size: 14px; color: #ccc; transition: all 0.15s; }"
        ".ng-item:hover { border-color: #f44336; color: #fff; }"
        ".ng-item.sel { border-color: #f44336; background: #3a1b1b; color: #f44336; font-weight: 700; }"
        ".ng-item .code { font-size: 11px; color: #888; display: block; }"
        ".ng-item.sel .code { color: #f44336; }"
        ".ng-qty-row { display: flex; align-items: center; gap: 10px; margin-top: 12px; color: #aaa; font-size: 14px; }"
        ".ng-qty-row input { width: 60px; padding: 6px 10px; border-radius: 6px; border: 1px solid #333; background: #16213e; color: #fff; text-align: center; }"
        ".ng-actions { display: flex; gap: 12px; margin-top: 16px; }"
        ".ng-submit { flex: 1; background: #f44336; color: #fff; font-size: 18px; font-weight: 700; padding: 12px; border-radius: 10px; border: none; cursor: pointer; }"
        ".ng-cancel { background: #37474f; color: #aaa; font-size: 14px; padding: 12px 24px; border-radius: 10px; border: none; cursor: pointer; }"
        ".scan-area { display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; max-width: 460px; }"
        ".scan-inp { font-size: 26px; padding: 16px 24px; width: 100%; border-radius: 12px; border: 2px solid #0f3460; background: #16213e; color: #fff; text-align: center; outline: none; }"
        ".scan-inp:focus { border-color: #e94560; }"
        ".scan-hint { font-size: 12px; color: #555; }"
        ".history { background: #0d0d1a; border-top: 1px solid #222; padding: 12px 24px; max-height: 200px; overflow-y: auto; }"
        ".history h4 { color: #666; font-size: 12px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1; }"
        ".hist-item { display: flex; gap: 16px; font-size: 13px; padding: 5px 0; border-bottom: 1px solid #1a1a2e; color: #888; flex-wrap: wrap; }"
        ".hist-item .pass { color: #4caf50; }"
        ".hist-item .ngcol { color: #f44336; }"
        ".hist-item .sncol { color: #ccc; font-family: monospace; }"
        ".hist-item .time { margin-left: auto; color: #444; }"
        ".status-bar { background: #0f1a2e; border-top: 1px solid #1a2a3e; padding: 6px 24px; font-size: 12px; color: #444; display: flex; gap: 20px; }"
        ".status-bar span { color: #4caf50; }"
        ".alarm-overlay { position: fixed; inset: 0; background: rgba(200,0,0,0.0); pointer-events: none; z-index: 9999; animation: alarmFlash 0.5s infinite alternate; display: none; }"
        ".alarm-overlay.active { display: block; }"
        ".alarm-box { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); background: #1a0000; border: 4px solid #f44336; border-radius: 20px; padding: 40px 60px; text-align: center; z-index: 10000; box-shadow: 0 0 60px rgba(244,67,54,0.5); min-width: 380px; animation: alarmZoom 0.3s; }"
        ".alarm-box.dup { border-color: #ff9800; box-shadow: 0 0 60px rgba(255,152,0,0.5); background: #1a1000; }"
        ".alarm-box.dup .alarm-title { color: #ff9800; }"
        ".alarm-title { font-size: 36px; font-weight: 900; color: #f44336; margin-bottom: 16px; }"
        ".alarm-sn { font-size: 28px; font-family: monospace; color: #fff; background: #0a0a0a; padding: 12px 24px; border-radius: 10px; display: inline-block; margin-bottom: 12px; }"
        ".alarm-msg { font-size: 18px; color: #f44336; }"
        ".alarm-box.dup .alarm-msg { color: #ff9800; }"
        ".alarm-dismiss { margin-top: 20px; background: #f44336; color: #fff; border: none; padding: 12px 36px; font-size: 16px; font-weight: 700; border-radius: 10px; cursor: pointer; }"
        ".alarm-box.dup .alarm-dismiss { background: #ff9800; }"
        "@keyframes alarmFlash { from { background: rgba(200,0,0,0.05); } to { background: rgba(200,0,0,0.25); } }"
        "@keyframes alarmZoom { from { transform: translate(-50%,-50%) scale(0.8); opacity: 0; } to { transform: translate(-50%,-50%) scale(1); opacity: 1; } }"
    )

    jsx = (
        'const API="http://localhost:' + str(port) + '";'
        'const NG=[' + ng_items + '];'
        'const UZ=' + ui_zh + ',UV=' + ui_vi + ',UE=' + ui_en + ';'
        'const LM={"zh-CN":UZ,"vi-VN":UV,"en-US":UE};'
        'const SC={idle:"#888",scanned:"#2196f3",passed:"#4caf50",ng:"#f44336"};'
        'const SB={idle:"#16213e",scanned:"#1a2f3e",passed:"#1b3a1f",ng:"#3a1b1b"};'
        'function App(){'
        'const[st,setSt]=React.useState({step:"idle",sn:null,locale:"zh-CN",history:[],last_rec:null,last_err:null,station_code:"","station_name":"",mes_on:true,sn_pool_size:0,ng_pool_size:0});'
        'const[manual,setManual]=React.useState("");'
        'const[ngP,setNgP]=React.useState(false);'
        'const[ngS,setNgS]=React.useState(null);'
        'const[ngQ,setNgQ]=React.useState(1);'
        'const esRef=React.useRef(null),polRef=React.useRef(null);'
        'const u=LM[st.locale]||UZ;'
        'React.useEffect(()=>{'
        'fetch(API+"/api/state").then(r=>r.json()).then(s=>{if(s&&s.station_code)setSt(s);}).catch(()=>{});'
        'const es=new EventSource(API+"/api/sse");'
        'es.onmessage=e=>{try{const d=JSON.parse(e.data);if(d&&d.station_code)setSt(d);}catch{}};'
        'es.onerror=()=>{es.close();if(!polRef.current)polRef.current=setInterval(()=>fetch(API+"/api/state").then(r=>r.json()).then(s=>{if(s&&s.station_code)setSt(s);}).catch(()=>{}),2000);};'
        'esRef.current=es;'
        'return()=>{if(esRef.current)esRef.current.close();if(polRef.current)clearInterval(polRef.current);};'
        '},[]);'
        'const sendScan=sn=>{if(!sn||!sn.trim())return;setManual("");fetch(API+"/api/scan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sn:sn.trim()})}).catch(()=>{});};'
        'const doPass=()=>{if(st.step!=="scanned")return;fetch(API+"/api/pass",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}).catch(()=>{});};'
        'const doNg=()=>{if(!ngS)return;fetch(API+"/api/ng",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ng_code:ngS,ng_qty:ngQ})}).catch(()=>{});setNgP(false);setNgS(null);setNgQ(1);};'
        'const doReset=()=>{fetch(API+"/api/reset",{method:"POST"}).catch(()=>{});setManual("");setNgP(false);setNgS(null);};'
        'const chL=l=>{fetch(API+"/api/locale",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({locale:l})}).catch(()=>{});};'
        'const sl={idle:u.step_idle,scanned:u.step_scanned,passed:u.step_passed,ng:u.step_ng}[st.step]||u.step_idle;'
        'const scolor=SC[st.step]||"#888",sbg=SB[st.step]||"#16213e";'
        'return React.createElement("div",null,'
        'React.createElement("div",{className:"hdr"},'
        'React.createElement("div",null,'
        'React.createElement("div",{className:"hdr-title"},st.station_code||' + json.dumps(st["code"]) + '),'
        'React.createElement("div",{className:"hdr-station"},st.station_name||' + json.dumps(st["name_zh"]) + ')),'
        'React.createElement("div",{className:"lang-btns"},'
        '["zh-CN","vi-VN","en-US"].map(l=>React.createElement("button",{key:l,className:"lang-btn"+(st.locale===l?" active":""),onClick:()=>chL(l)},{"zh-CN":"中文","vi-VN":"Viet","en-US":"EN"}[l])))),'
        'React.createElement("div",{className:"main"},'
        'React.createElement("div",{className:"step-card",style:{background:sbg,borderColor:scolor}},'
        'React.createElement("div",{className:"step-label"},u.ready),'
        'React.createElement("div",{className:"step-title",style:{color:scolor}},sl),'
        'st.sn&&React.createElement("div",{className:"step-sn"},"SN: ",React.createElement("b",null,st.sn)),'
        'st.last_err&&React.createElement("div",{className:"step-error"},st.last_err)),'
        'st.last_rec&&React.createElement("div",{className:"result-banner "+(st.last_rec.result==="PASS"?"result-pass":"result-ng")},'
        '(st.last_rec.result==="PASS"?u.pass_ok:u.ng_ok)+" - "+st.last_rec.sn+(st.last_rec.ng_code?" ["+st.last_rec.ng_code+"]":"")),'
        'ngP?'
        'React.createElement("div",{className:"ng-panel"},'
        'React.createElement("h3",null,u.sel_ng),'
        'React.createElement("div",{className:"ng-grid"},'
        'NG.map(nc=>React.createElement("div",{key:nc.code,className:"ng-item"+(ngS===nc.code?" sel":""),onClick:()=>setNgS(nc.code)},'
        'React.createElement("span",{className:"code"},nc.code),'
        'st.locale==="zh-CN"?nc.label_zh:st.locale==="vi-VN"?nc.label_vi:nc.label_en)),'
        'React.createElement("div",{className:"ng-qty-row"},'
        'React.createElement("span",null,u.qty+":"),'
        'React.createElement("input",{type:"number",min:"1",value:ngQ,onChange:e=>setNgQ(Math.max(1,+e.target.value))})),'
        'React.createElement("div",{className:"ng-actions"},'
        'React.createElement("button",{className:"ng-submit",onClick:doNg,disabled:!ngS},u.confirm),'
        'React.createElement("button",{className:"ng-cancel",onClick:()=>{setNgP(false);setNgS(null)}},u.cancel))),'
        'React.createElement("div",null,'
        'st.step==="scanned"&&React.createElement("div",{className:"btn-row"},'
        'React.createElement("button",{className:"btn btn-pass",onClick:doPass},"PASS ",u.pass),'
        'React.createElement("button",{className:"btn btn-ng",onClick:()=>setNgP(true)},"NG ",u.ng)),'
        'React.createElement("div",{className:"scan-area"},'
        'React.createElement("input",{className:"scan-inp",value:manual,onChange:e=>setManual(e.target.value),'
        'onKeyDown:e=>{if(e.key==="Enter")sendScan(manual)},placeholder:u.scan,autoFocus:true}),'
        'React.createElement("span",{className:"scan-hint"},"USB扫码枪自动输入 / 手动回车")),'
        'React.createElement("button",{className:"btn btn-reset",onClick:doReset},u.reset))),'
        'st.history&&st.history.length>0&&React.createElement("div",{className:"history"},'
        'React.createElement("h4",null,u.history+" ("+st.history.length+")"),'
        'st.history.map(h=>React.createElement("div",{key:h.id,className:"hist-item"},'
        'React.createElement("span",{className:h.result==="PASS"?"pass":"ngcol"},h.result),'
        'React.createElement("span",{className:"sncol"},h.sn),'
        'h.ng_code&&React.createElement("span",{style:{color:"#f44336"}},h.ng_code),'
        'React.createElement("span",{className:"time"},new Date(h.time).toLocaleTimeString())))),'
        'React.createElement("div",{className:"status-bar"},'
        'React.createElement("span",null,"MES: "+(st.mes_on?"ON":"OFF")),'
        'React.createElement("span",null,"Pool: SN="+st.sn_pool_size+" NG="+st.ng_pool_size),'
        'React.createElement("button",{style:{marginLeft:"auto",background:"#333",color:"#888",border:"none",padding:"4px 12px",borderRadius:"6px",cursor:"pointer",fontSize:"11px"},onClick:()=>fetch(API+"/api/alarm-test",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"ng"})}).catch(()=>{})},"Test Alarm")),'
        'st.alarm_type&&React.createElement(React.Fragment,null,'
        'React.createElement("div",{className:"alarm-overlay active"}),'
        'React.createElement("div",{className:"alarm-box "+(st.alarm_type==="dup"?"dup":"")},'
        'React.createElement("div",{className:"alarm-title"},st.alarm_type==="ng"?"NG报警":"重复SN"),'
        'st.sn&&React.createElement("div",{className:"alarm-sn"},st.sn),'
        'React.createElement("div",{className:"alarm-msg"},st.alarm_type==="ng"?u.step_ng:u.dup_sn),'
        'React.createElement("button",{className:"alarm-dismiss",onClick:doReset},u.reset)))'
        '));}'
        'ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));'
    )

    html = (
        '<!DOCTYPE html><html lang="zh-CN">'
        '<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>'
        '<title>' + st["code"] + ' - ' + st["name_zh"] + '</title>'
        '<script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>'
        '<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>'
        '<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>'
        '<style>' + css + '</style></head>'
        '<body><div id="root"></div>'
        '<script type="text/babel">' + jsx + '</script>'
        '</body></html>'
    )
    return html


def main():
    created = []
    skipped = []

    for i, st in enumerate(STATIONS):
        dn = st["dir"]
        port = PORT_BASE + i
        dst = BASE / dn
        src_dir = dst / "src"
        server_path = src_dir / "server.py"
        html_path = dst / "index.html"

        if server_path.exists():
            skipped.append(dn)
            continue

        os.makedirs(src_dir, exist_ok=True)

        with open(server_path, "w", encoding="utf-8") as f:
            f.write(gen_server(st, port))

        with open(html_path, "w", encoding="utf-8") as f:
            f.write(gen_html(st, port))

        created.append((dn, port, st["code"], st["name_zh"]))

    print("Created: %d station apps" % len(created))
    print("Skipped: %d (already exist)" % len(skipped))
    print("Ports: %d-%d" % (PORT_BASE, PORT_BASE + len(STATIONS) - 1))
    print()
    for dn, port, code, name in created:
        print("  %s (%s) -> :%d" % (code, name, port))
    if skipped:
        print("\nSkipped: %s" % ", ".join(skipped))


if __name__ == "__main__":
    main()
