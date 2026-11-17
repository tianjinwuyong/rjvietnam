#!/usr/bin/env python3
"""Generate all 74 SMT L001 station apps.
Each app: Flask backend (server.py) + React UI (index.html)
Run: python3 generate-stations.py
"""

import json, os
from pathlib import Path

BASE    = Path("C:/Users/tianj/Desktop/越南工厂瑞晶/越南工厂瑞晶/smt-factory-system/integrations")
SRCBASE = Path("C:/Users/tianj/Desktop/越南工厂瑞晶/越南工厂瑞晶/smt-factory-system/apps")
MES_API = "http://localhost:8080"
PORT_BASE = 5300

# ── Load L001 stations ────────────────────────────────────────────────────────
with open(BASE / "../_l001_stations.json", encoding="utf-8") as f:
    L001 = json.load(f)

NG_CODES = [
    ("NG01", "桥连/短路", "Bridge/Short"),
    ("NG02", "缺件/Missing", "Missing"),
    ("NG03", "偏位/位移", "Offset"),
    ("NG04", "立碑", "Tombstone"),
    ("NG05", "冷焊", "Cold solder"),
    ("NG06", "焊点不良", "Poor solder"),
    ("NG07", "元器件坏", "Component damaged"),
    ("NG08", "PCB划伤", "PCB scratch"),
    ("NG09", "极性反", "Polarity reversed"),
    ("NG10", "其他", "Other"),
]
NG_CODES_JSON = json.dumps(NG_CODES, ensure_ascii=False)

I18N_SERVER = json.dumps({
    "zh-CN": {
        "ready":"系统就绪","scan_sn":"请扫码","pass":"PASS","fail":"FAIL","ng":"NG",
        "dup_sn":"重复SN","history":"历史","operator":"操作员","station":"工位",
        "no_scan":"请先扫码","error_db":"数据库错误","ng分类":"NG分类",
    },
    "vi-VN": {
        "ready":"He thong san sang","scan_sn":"Quet ma","pass":"PASS","fail":"FAIL","ng":"NG",
        "dup_sn":"SN trung lap","history":"Lich su","operator":"Nhan vien","station":"Tram",
        "no_scan":"Quet SN truoc","error_db":"Loi DB","ng分类":"Phan loai NG",
    },
    "en-US": {
        "ready":"System ready","scan_sn":"Scan barcode","pass":"PASS","fail":"FAIL","ng":"NG",
        "dup_sn":"Duplicate SN","history":"History","operator":"Operator","station":"Station",
        "no_scan":"Scan SN first","error_db":"DB error","ng分类":"NG Category",
    },
}, ensure_ascii=False)

UI_JSON = json.dumps({
    "zh-CN": {
        "title":"{}","ready":"系统就绪","scan":"请扫码 SN","pass":"PASS 过站","ng":"报 NG",
        "reset":"重置","dup":"重复SN，已拦截！","no_scan":"请先扫码",
        "sel_ng":"选择NG原因","qty":"数量","confirm":"确认","cancel":"取消",
        "pass_ok":"过站成功","ng_ok":"NG已记录","history":"最近记录",
        "step_idle":"就绪","step_scanned":"已扫描","step_passed":"PASS","step_ng":"NG",
        "wo":"工单",
    },
    "vi-VN": {
        "title":"{}","ready":"He thoong san sang","scan":"Quet SN","pass":"PASS Qua tram","ng":"Bao NG",
        "reset":"Dat lai","dup":"SN trung, da chan!","no_scan":"Quet SN truoc",
        "sel_ng":"Chon ly do NG","qty":"So luong","confirm":"Xac nhan","cancel":"Huy",
        "pass_ok":"Qua tram OK","ng_ok":"NG da ghi","history":"Lich su",
        "step_idle":"San sang","step_scanned":"Da quet","step_passed":"PASS","step_ng":"NG",
        "wo":"Lenh SX",
    },
    "en-US": {
        "title":"{}","ready":"System ready","scan":"Scan SN","pass":"PASS","ng":"Report NG",
        "reset":"Reset","dup":"Duplicate SN blocked!","no_scan":"Scan SN first",
        "sel_ng":"Select NG reason","qty":"Qty","confirm":"Confirm","cancel":"Cancel",
        "pass_ok":"Pass success","ng_ok":"NG recorded","history":"History",
        "step_idle":"Ready","step_scanned":"Scanned","step_passed":"PASS","step_ng":"NG",
        "wo":"Work Order",
    },
}, ensure_ascii=False)


# ── Flask server.py ──────────────────────────────────────────────────────────
def make_server(st, port):
    return '''#!/usr/bin/env python3
"""
Station App: {code} — {name_zh}
Line: {line_zh}  |  Type: {stype}  |  Port: {port}
"""

import json, threading, logging
from datetime import datetime, timezone
from flask import Flask, request, Response, jsonify
from flask_cors import CORS

MES_API   = "{MES_API}"
DB_CONFIG = {{
    "host": "127.0.0.1", "port": 5432,
    "user": "postgres", "password": "postgres", "database": "smt_factory",
}}
PORT  = {port}
SCODE = "{code}"
SNAME = "{name_zh}"
STYPE = "{stype}"

I18N = {I18N_SERVER}

app = Flask(__name__)
CORS(app, resources={{r"/api/*": {{"origins": "*"}}}})

_tts = None
def _get_tts():
    global _tts
    if _tts is None:
        import pyttsx3 as _pyttsx3
        _tts = _pyttsx3.init(); _tts.setProperty("rate", 160)
    return _tts

def tts(text):
    def _s():
        try: e=_get_tts(); e.say(text); e.runAndWait()
        except: pass
    threading.Thread(target=_s, daemon=True).start()

SN_RE = __import__("re").compile(r"^[A-Za-z0-9_\-]{{1,50}}$")

def validate_sn(sn):
    sn = sn.strip()
    if not sn: return "empty"
    if len(sn) > 50: return "too_long"
    if not SN_RE.match(sn): return "invalid"
    return None

class State:
    def __init__(self):
        self.lock = threading.RLock()
        self.sn = None; self.work_order = None; self.op_id = None
        self.step = "idle"; self.last_err = None; self.last_rec = None
        self.locale = "zh-CN"; self.ng_code = None; self.ng_qty = 1
        self._clients = []; self._hist = []

    def t(self, k):
        return I18N.get(self.locale, I18N["zh-CN"]).get(k, k)

    def dup_check(self, sn):
        import urllib.request
        try:
            req = urllib.request.Request(
                f"{{MES_API}}/api/mes/sn-check",
                data=json.dumps({{"sn": sn}}).encode(),
                headers={{"Content-Type": "application/json"}})
            r = urllib.request.urlopen(req, timeout=5)
            return json.loads(r.read()).get("duplicate", False)
        except: return False

    def mes_event(self, sn, result, wo=None, ng_code=None, ng_qty=0, op=None):
        import urllib.request
        payload = {{
            "stationCode": SCODE, "operator": op or f"OP_{{self.op_id}}",
            "result": result, "traceabilityKey": sn,
            "workOrderCode": wo or "", "ngCode": ng_code or "", "ngQty": ng_qty,
        }}
        try:
            req = urllib.request.Request(
                f"{{MES_API}}/api/mes/events",
                data=json.dumps({{"payload": payload}}).encode(),
                headers={{"Content-Type": "application/json"}})
            urllib.request.urlopen(req, timeout=5)
        except Exception as e:
            logging.warning("MES event failed: %s", e)

    def do_scan(self, sn, op_id=None, wo=None):
        err = validate_sn(sn)
        with self.lock:
            self.last_err = None
            if err:
                msg = {{"empty":"SN不能为空","too_long":"SN太长","invalid":"SN格式非法"}}[err]
                self.last_err = msg; self._bc(); return {{"ok":False,"error":msg}}
            if self.dup_check(sn):
                self.last_err = self.t("dup_sn"); tts(self.t("dup_sn"))
                self._bc(); return {{"ok":False,"error":self.t("dup_sn")}}
            self.sn = sn.strip(); self.work_order = wo
            if op_id: self.op_id = op_id
            self.step = "scanned"; self._bc()
            return {{"ok":True,"step":"scanned","sn":self.sn}}

    def do_pass(self, op_id=None):
        with self.lock:
            if self.step != "scanned": return {{"ok":False,"error":"no scan"}}
            op = op_id or self.op_id
            self.mes_event(self.sn, "PASS", self.work_order, op=f"OP_{{op}}")
            rec = {{"id":len(self._hist)+1,"sn":self.sn,"result":"PASS",
                    "station":SCODE,"time":datetime.now().isoformat(),
                    "operator":op,"wo":self.work_order}}
            self._hist.insert(0,rec); self._hist=self._hist[:50]
            self.last_rec=rec; self.step="passed"; self._bc(); tts(self.t("pass"))
            return {{"ok":True,"record":rec}}

    def do_ng(self, ng_code, ng_qty=1, op_id=None):
        with self.lock:
            if self.step not in ("scanned",): return {{"ok":False,"error":"scan first"}}
            op = op_id or self.op_id
            self.mes_event(self.sn,"NG",self.work_order,ng_code,ng_qty,f"OP_{{op}}")
            rec = {{"id":len(self._hist)+1,"sn":self.sn,"result":"NG",
                    "station":SCODE,"time":datetime.now().isoformat(),
                    "operator":op,"wo":self.work_order,"ng_code":ng_code,"ng_qty":ng_qty}}
            self._hist.insert(0,rec); self._hist=self._hist[:50]
            self.last_rec=rec; self.step="ng"; self._bc(); tts(self.t("fail"))
            return {{"ok":True,"record":rec}}

    def do_reset(self):
        with self.lock:
            self.sn=None; self.work_order=None; self.step="idle"
            self.last_err=None; self.last_rec=None; self.ng_code=None
            self._bc()

    def set_locale(self, locale):
        with self.lock:
            if locale in I18N: self.locale=locale; self._bc()

    def get_state(self):
        with self.lock:
            return {{
                "step":self.step,"sn":self.sn,"work_order":self.work_order,
                "op_id":self.op_id,"locale":self.locale,"last_err":self.last_err,
                "last_rec":self.last_rec,"history":self._hist[:20],
                "station_code":SCODE,"station_name":SNAME,"station_type":STYPE,
            }}

    def add_client(self,q): self._clients.append(q)
    def rm_client(self,q):
        if q in self._clients: self._clients.remove(q)
    def _bc(self):
        import queue, json
        data = json.dumps(self.get_state())
        dead=[]
        for q in self._clients:
            try: q.put_nowait(data)
            except: dead.append(q)
        for q in dead: self.rm_client(q)

state = State()

@app.route("/api/scan", methods=["POST"])
def api_scan():
    b=request.get_json() or {{}}
    r=state.do_scan(b.get("sn",""),b.get("op_id"),b.get("work_order"))
    return jsonify(r)

@app.route("/api/pass", methods=["POST"])
def api_pass():
    b=request.get_json() or {{}}
    return jsonify(state.do_pass(b.get("op_id")))

@app.route("/api/ng", methods=["POST"])
def api_ng():
    b=request.get_json() or {{}}
    return jsonify(state.do_ng(b.get("ng_code",""),b.get("ng_qty",1),b.get("op_id")))

@app.route("/api/reset", methods=["POST"])
def api_reset():
    state.do_reset(); return jsonify({{"ok":True}})

@app.route("/api/state", methods=["GET"])
def api_state():
    return jsonify(state.get_state())

@app.route("/api/locale", methods=["POST"])
def api_locale():
    b=request.get_json() or {{}}
    loc=b.get("locale","zh-CN")
    if loc not in I18N: return jsonify({{"ok":False}}),400
    state.set_locale(loc); return jsonify({{"ok":True,"locale":loc}})

@app.route("/api/sse", methods=["GET"])
def api_sse():
    import queue
    q=queue.Queue(); state.add_client(q)
    def gen():
        while True:
            try:
                d=q.get(timeout=30); yield f"data: {{d}}\\n\\n"
            except queue.Empty:
                yield f"data: {{\"type\":\"ping\"}}\\n\\n"
    return Response(gen(), mimetype="text/event-stream",
                    headers={{"X-Accel-Buffering":"no","Cache-Control":"no-cache"}})

if __name__=="__main__":
    logging.basicConfig(level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
    logging.info("Starting %s on port %s", SCODE, PORT)
    app.run(host="0.0.0.0", port=PORT, debug=False, threaded=True)
'''.format(
    MES_API=MES_API,
    port=port,
    code=st["code"], name_zh=st["name_zh"],
    line_zh=st.get("line_name_zh",""), stype=st.get("station_type",""),
    I18N_SERVER=I18N_SERVER,
)


# ── HTML UI (no f-string — plain string concatenation) ───────────────────────
def make_html(st, port):
    code    = st["code"]
    name_zh = st["name_zh"]
    name_en = st.get("name_en", name_zh)
    line_zh = st.get("line_name_zh", "")

    # UI strings per locale
    ui_zh = json.dumps({
        "title": name_zh, "ready":"系统就绪","scan":"请扫码 SN","pass":"PASS 过站","ng":"报 NG",
        "reset":"重置","dup":"重复SN，已拦截！","no_scan":"请先扫码",
        "sel_ng":"选择NG原因","qty":"数量","confirm":"确认","cancel":"取消",
        "pass_ok":"过站成功","ng_ok":"NG已记录","history":"最近记录",
        "step_idle":"就绪","step_scanned":"已扫描","step_passed":"PASS","step_ng":"NG",
        "wo":"工单",
    })
    ui_vi = json.dumps({
        "title": name_en, "ready":"He thong san sang","scan":"Quet SN","pass":"PASS Qua tram","ng":"Bao NG",
        "reset":"Dat lai","dup":"SN trung, da chan!","no_scan":"Quet SN truoc",
        "sel_ng":"Chon ly do NG","qty":"So luong","confirm":"Xac nhan","cancel":"Huy",
        "pass_ok":"Qua tram OK","ng_ok":"NG da ghi","history":"Lich su",
        "step_idle":"San sang","step_scanned":"Da quet","step_passed":"PASS","step_ng":"NG",
        "wo":"Lenh SX",
    })
    ui_en = json.dumps({
        "title": name_en, "ready":"System ready","scan":"Scan SN","pass":"PASS","ng":"Report NG",
        "reset":"Reset","dup":"Duplicate SN blocked!","no_scan":"Scan SN first",
        "sel_ng":"Select NG reason","qty":"Qty","confirm":"Confirm","cancel":"Cancel",
        "pass_ok":"Pass success","ng_ok":"NG recorded","history":"History",
        "step_idle":"Ready","step_scanned":"Scanned","step_passed":"PASS","step_ng":"NG",
        "wo":"Work Order",
    })

    ng_items_zh = ",\n".join(
        f'{{code:"{c}",label_zh:"{n}",label_en:"{e}"}}'
        for c,n,e in NG_CODES
    )

    # JSX uses {var} — write as raw JS string concatenated
    return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n' \
           '<meta charset="UTF-8"/>\n' \
           '<meta name="viewport" content="width=device-width,initial-scale=1"/>\n' \
           '<title>' + code + ' — ' + name_zh + '</title>\n' \
           '<script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>\n' \
           '<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>\n' \
           '<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>\n' \
           '<style>\n' \
           '*{margin:0;padding:0;box-sizing:border-box}\n' \
           'body{font-family:Arial,Microsoft YaHei,sans-serif;background:#1a1a2e;color:#eee;min-height:100vh}\n' \
           '.hdr{background:#16213e;padding:10px 24px;display:flex;align-items:center;' \
           'justify-content:space-between;border-bottom:2px solid #0f3460}\n' \
           '.hdr-title{font-size:20px;font-weight:700;color:#e94560}\n' \
           '.hdr-station{font-size:13px;color:#888}\n' \
           '.lang-btns{display:flex;gap:6px}\n' \
           '.lang-btn{padding:5px 12px;border-radius:6px;border:none;cursor:pointer;' \
           'font-size:13px;font-weight:600;background:#0f3460;color:#aaa}\n' \
           '.lang-btn.active{background:#e94560;color:#fff}\n' \
           '.main{display:flex;flex-direction:column;align-items:center;' \
           'justify-content:center;min-height:calc(100vh - 140px);padding:24px;gap:20px}\n' \
           '.step-card{background:#16213e;border:3px solid #0f3460;border-radius:20px;' \
           'padding:40px 60px;text-align:center;min-width:480px;' \
           'box-shadow:0 8px 32px rgba(0,0,0,0.4);transition:border-color 0.3s}\n' \
           '.step-label{font-size:14px;color:#888;margin-bottom:10px}\n' \
           '.step-title{font-size:52px;font-weight:900;line-height:1}\n' \
           '.step-sn{margin-top:16px;font-size:18px;background:#0a0a1a;border-radius:10px;' \
           'padding:10px 24px;display:inline-block;color:#aaa}\n' \
           '.step-sn b{color:#fff;letter-spacing:2}\n' \
           '.step-error{margin-top:14px;font-size:16px;color:#f44336;font-weight:700}\n' \
           '.step-wo{margin-top:8px;font-size:13px;color:#666}\n' \
           '.result-banner{padding:16px 40px;border-radius:12px;font-size:22px;font-weight:800;' \
           'text-align:center}\n' \
           '.result-pass{background:#1b3a1f;border:2px solid #4caf50;color:#4caf50}\n' \
           '.result-ng{background:#3a1b1b;border:2px solid #f44336;color:#f44336}\n' \
           '.btn-row{display:flex;gap:16px}\n' \
           '.btn{font-size:20px;font-weight:800;padding:16px 48px;border-radius:14px;' \
           'border:none;cursor:pointer;letter-spacing:1;transition:transform 0.1s}\n' \
           '.btn:active{transform:scale(0.97)}\n' \
           '.btn:hover{opacity:0.9}\n' \
           '.btn-pass{background:#4caf50;color:#fff}\n' \
           '.btn-ng{background:#f44336;color:#fff}\n' \
           '.btn-reset{background:#37474f;color:#aaa;font-size:15px;padding:10px 28px}\n' \
           '.ng-panel{background:#1a1a2e;border:2px solid #f44336;border-radius:14px;' \
           'padding:24px 32px;min-width:460px}\n' \
           '.ng-panel h3{color:#f44336;margin-bottom:16px;font-size:18px}\n' \
           '.ng-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}\n' \
           '.ng-item{background:#16213e;border:1px solid #333;border-radius:8px;' \
           'padding:10px 14px;cursor:pointer;text-align:center;font-size:14px;' \
           'color:#ccc;transition:all 0.15s}\n' \
           '.ng-item:hover{border-color:#f44336;color:#fff}\n' \
           '.ng-item.sel{border-color:#f44336;background:#3a1b1b;color:#f44336;font-weight:700}\n' \
           '.ng-item .code{font-size:11px;color:#888;display:block}\n' \
           '.ng-item.sel .code{color:#f44336}\n' \
           '.ng-qty-row{display:flex;align-items:center;gap:10px;margin-top:12px;' \
           'color:#aaa;font-size:14px}\n' \
           '.ng-qty-row input{width:60px;padding:6px 10px;border-radius:6px;' \
           'border:1px solid #333;background:#16213e;color:#fff;text-align:center}\n' \
           '.ng-actions{display:flex;gap:12px;margin-top:16px}\n' \
           '.ng-submit{flex:1;background:#f44336;color:#fff;font-size:18px;font-weight:700;' \
           'padding:12px;border-radius:10px;border:none;cursor:pointer}\n' \
           '.ng-cancel{background:#37474f;color:#aaa;font-size:14px;padding:12px 24px;' \
           'border-radius:10px;border:none;cursor:pointer}\n' \
           '.scan-area{display:flex;flex-direction:column;align-items:center;' \
           'gap:10px;width:100%;max-width:460px}\n' \
           '.scan-inp{font-size:26px;padding:16px 24px;width:100%;border-radius:12px;' \
           'border:2px solid #0f3460;background:#16213e;color:#fff;' \
           'text-align:center;outline:none}\n' \
           '.scan-inp:focus{border-color:#e94560}\n' \
           '.scan-hint{font-size:12px;color:#555}\n' \
           '.history{background:#0d0d1a;border-top:1px solid #222;padding:12px 24px;' \
           'max-height:200px;overflow-y:auto}\n' \
           '.history h4{color:#666;font-size:12px;margin-bottom:8px;' \
           'text-transform:uppercase;letter-spacing:1}\n' \
           '.hist-item{display:flex;gap:16px;font-size:13px;padding:5px 0;' \
           'border-bottom:1px solid #1a1a2e;color:#888}\n' \
           '.hist-item .res{font-weight:700}\n' \
           '.hist-item .pass{color:#4caf50}\n' \
           '.hist-item .ng{color:#f44336}\n' \
           '.hist-item .sn{color:#ccc;font-family:monospace}\n' \
           '.hist-item .time{margin-left:auto;color:#444}\n' \
           '</style>\n' \
           '</head>\n<body>\n<div id="root"></div>\n' \
           '<script type="text/babel">\n' \
           'const API = "http://localhost:' + str(port) + '";\n' \
           'const NG_CODES = [\n' + ng_items_zh + '\n];\n' \
           'const UI_ZH = ' + ui_zh + ';\n' \
           'const UI_VI = ' + ui_vi + ';\n' \
           'const UI_EN = ' + ui_en + ';\n' \
           'const LANG_MAP = {{"zh-CN":UI_ZH,"vi-VN":UI_VI,"en-US":UI_EN}};\n' \
           'const STEPS = {{idle:"idle",scanned:"scanned",passed:"passed",ng:"ng"}};\n' \
           'const SC = {{idle:"#888",scanned:"#2196f3",passed:"#4caf50",ng:"#f44336"}};\n' \
           'const SB = {{idle:"#16213e",scanned:"#1a2f3e",passed:"#1b3a1f",ng:"#3a1b1b"}};\n' \
           'function App(){{\n' \
           '  const [st, setSt] = React.useState({{step:"idle",sn:null,work_order:null,' \
           'locale:"zh-CN",history:[],last_rec:null,last_err:null}});\n' \
           '  const [manual, setManual] = React.useState("");\n' \
           '  const [ngPanel, setNgPanel] = React.useState(false);\n' \
           '  const [ngSel, setNgSel] = React.useState(null);\n' \
           '  const [ngQty, setNgQty] = React.useState(1);\n' \
           '  const esRef = React.useRef(null);\n' \
           '  const polRef = React.useRef(null);\n' \
           '  const u = LANG_MAP[st.locale] || UI_ZH;\n' \
           '  React.useEffect(()=>{{\n' \
           '    fetch(API+"/api/state").then(r=>r.json()).then(setSt).catch(()=>{{}});\n' \
           '    const es = new EventSource(API+"/api/sse");\n' \
           '    es.onmessage = e => {{ try{{setSt(JSON.parse(e.data))}}catch{{}} }};\n' \
           '    es.onerror = () => {{\n' \
           '      es.close(); esRef.current=null;\n' \
           '      if(!polRef.current) polRef.current = setInterval(()=>\n' \
           '        fetch(API+"/api/state").then(r=>r.json()).then(setSt).catch(()=>{{}}), 2000);\n' \
           '    }};\n' \
           '    esRef.current = es;\n' \
           '    return () => {{ es.close(); if(polRef.current) clearInterval(polRef.current); }};\n' \
           '  }},[]);\n' \
           '  const sendScan = sn => {{\n' \
           '    if(!sn.trim()) return;\n' \
           '    setManual("");\n' \
           '    fetch(API+"/api/scan",{{method:"POST",headers:{{"Content-Type":"application/json"}},\n' \
           '      body:JSON.stringify({{sn:sn.trim(),work_order:st.work_order||undefined}})}}).catch(()=>{{}});\n' \
           '  }};\n' \
           '  const doPass = () => {{\n' \
           '    if(st.step!=="scanned") return;\n' \
           '    fetch(API+"/api/pass",{{method:"POST",headers:{{"Content-Type":"application/json"}},body:"{{}}"}}).catch(()=>{{}});\n' \
           '  }};\n' \
           '  const doNg = () => {{\n' \
           '    if(!ngSel) return;\n' \
           '    fetch(API+"/api/ng",{{method:"POST",headers:{{"Content-Type":"application/json"}},\n' \
           '      body:JSON.stringify({{ng_code:ngSel,ng_qty:ngQty}})}}).catch(()=>{{}});\n' \
           '    setNgPanel(false); setNgSel(null); setNgQty(1);\n' \
           '  }};\n' \
           '  const doReset = () => {{\n' \
           '    fetch(API+"/api/reset",{{method:"POST"}}).catch(()=>{{}});\n' \
           '    setManual(""); setNgPanel(false); setNgSel(null);\n' \
           '  }};\n' \
           '  const chLocale = l => {{\n' \
           '    fetch(API+"/api/locale",{{method:"POST",headers:{{"Content-Type":"application/json"}},\n' \
           '      body:JSON.stringify({{locale:l}})}}).catch(()=>{{}});\n' \
           '  }};\n' \
           '  const sl = {{\n' \
           '    [STEPS.idle]:u.step_idle,[STEPS.scanned]:u.step_scanned,\n' \
           '    [STEPS.passed]:u.step_passed,[STEPS.ng]:u.step_ng\n' \
           '  }}[st.step]||u.step_idle;\n' \
           '  const scolor = SC[st.step]||"#888";\n' \
           '  const sbg = SB[st.step]||"#16213e";\n' \
           '  return (\n' \
           '    <div>\n' \
           '      <div className="hdr">\n' \
           '        <div>\n' \
           '          <div className="hdr-title">' + code + '</div>\n' \
           '          <div className="hdr-station">' + name_zh + ' · ' + line_zh + '</div>\n' \
           '        </div>\n' \
           '        <div className="lang-btns">\n' \
           '          {["zh-CN","vi-VN","en-US"].map(l=>(\n' \
           '            <button key={{l}} className={{"lang-btn":true,active:st.locale===l}}\n' \
           '              onClick={{()=>chLocale(l)}}>\n' \
           '              {{"zh-CN":"中文","vi-VN":"Viet","en-US":"EN"}}[l]\n' \
           '            </button>\n' \
           '          ))}\n' \
           '        </div>\n' \
           '      </div>\n' \
           '      <div className="main">\n' \
           '        <div className="step-card" style={{{{background:sbg,borderColor:scolor}}}}>\n' \
           '          <div className="step-label">{{u.ready}}</div>\n' \
           '          <div className="step-title" style={{{{color:scolor}}}}>{{sl}}</div>\n' \
           '          {st.sn && <div className="step-sn">SN: <b>{{st.sn}}</b></div>}\n' \
           '          {st.work_order && <div className="step-wo">{{u.wo}}: {{st.work_order}}</div>}\n' \
           '          {st.last_err && <div className="step-error">{{st.last_err}}</div>}\n' \
           '        </div>\n' \
           '        {st.last_rec && (\n' \
           '          <div className={{"result-banner":true,\n' \
           '            "result-pass":st.last_rec.result==="PASS","result-ng":st.last_rec.result==="NG"}}>\n' \
           '            {st.last_rec.result==="PASS"?u.pass_ok:u.ng_ok} — {{st.last_rec.sn}}\n' \
           '          </div>\n' \
           '        )}\n' \
           '        {ngPanel ? (\n' \
           '          <div className="ng-panel">\n' \
           '            <h3>{{u.sel_ng}}</h3>\n' \
           '            <div className="ng-grid">\n' \
           '              {NG_CODES.map(nc=>(\n' \
           '                <div key={{nc.code}}\n' \
           '                  className={{"ng-item":true,sel:ngSel===nc.code}}\n' \
           '                  onClick={{()=>setNgSel(nc.code)}}>\n' \
           '                  <span className="code">{{nc.code}}</span>\n' \
           '                  {st.locale==="zh-CN"?nc.label_zh:nc.label_en}\n' \
           '                </div>\n' \
           '              ))}\n' \
           '            </div>\n' \
           '            <div className="ng-qty-row">\n' \
           '              <span>{{u.qty}}:</span>\n' \
           '              <input type="number" min="1" value={{ngQty}}\n' \
           '                onChange={{e=>setNgQty(Math.max(1,+e.target.value))}}/>\n' \
           '            </div>\n' \
           '            <div className="ng-actions">\n' \
           '              <button className="ng-submit" onClick={{doNg}} disabled={{!ngSel}}>{{u.confirm}}</button>\n' \
           '              <button className="ng-cancel" onClick={{()=>{{setNgPanel(false);setNgSel(null)}}}}>{{u.cancel}}</button>\n' \
           '            </div>\n' \
           '          </div>\n' \
           '        ) : (\n' \
           '          <>\n' \
           '            {st.step==="scanned" && (\n' \
           '              <div className="btn-row">\n' \
           '                <button className="btn btn-pass" onClick={{doPass}}>PASS {u.pass}</button>\n' \
           '                <button className="btn btn-ng" onClick={{()=>setNgPanel(true)}}>NG {u.ng}</button>\n' \
           '              </div>\n' \
           '            )}\n' \
           '            <div className="scan-area">\n' \
           '              <input className="scan-inp" value={{manual}}\n' \
           '                onChange={{e=>setManual(e.target.value)}}\n' \
           '                onKeyDown={{e=>{{if(e.key==="Enter")sendScan(manual)}}}}\n' \
           '                placeholder={{u.scan}} autoFocus/>\n' \
           '              <span className="scan-hint">USB扫码枪自动聚焦 · 或手动输入回车</span>\n' \
           '            </div>\n' \
           '            <button className="btn btn-reset" onClick={{doReset}}>{{u.reset}}</button>\n' \
           '          </>\n' \
           '        )}\n' \
           '      </div>\n' \
           '      {st.history&&st.history.length>0&&(\n' \
           '        <div className="history">\n' \
           '          <h4>{{u.history}}</h4>\n' \
           '          {st.history.map(h=>(\n' \
           '            <div key={{h.id}} className="hist-item">\n' \
           '              <span className={{"res":true,[h.result==="PASS"?"pass":"ng"]:true}}>{{h.result}}</span>\n' \
           '              <span className="sn">{{h.sn}}</span>\n' \
           '              {h.ng_code&&<span style={{color:"#f44336"}}>{{h.ng_code}}</span>}\n' \
           '              <span className="time">{{new Date(h.time).toLocaleTimeString()}}</span>\n' \
           '            </div>\n' \
           '          ))}\n' \
           '        </div>\n' \
           '      )}\n' \
           '    </div>\n' \
           '  );\n' \
           '}}\n' \
           'ReactDOM.createRoot(document.getElementById("root")).render(<App/>);\n' \
           '</script>\n</body>\n</html>\n'


def make_readme(st, port):
    return '''# {code} — {name_zh}

**Type:** `{stype}`  |  **Line:** {line_zh}  |  **Port:** {port}

## Run
```bash
cd "$(dirname "$0")/src"
python3 server.py
```

## API
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/scan | Scan SN |
| POST | /api/pass | Confirm pass |
| POST | /api/ng | Report NG |
| POST | /api/reset | Reset |
| GET  | /api/state | Current state |
| GET  | /api/sse | SSE stream |
| POST | /api/locale | Set language |

## Features
- USB扫码枪 (HID keyboard input)
- Duplicate SN check via MES API
- NG reason codes (10 common types)
- PASS/NG event logging to MES
- Real-time SSE updates
- i18n: zh-CN · vi-VN · en-US
- TTS voice feedback
'''.format(
    code=st["code"], name_zh=st["name_zh"],
    line_zh=st.get("line_name_zh",""), stype=st.get("station_type",""),
    port=port,
)


def dname(code):
    return code.lower().replace("-", "_")


def generate():
    created = []
    skipped = []

    for i, st in enumerate(L001):
        code = st["code"]
        port = PORT_BASE + i
        dn   = dname(code)
        dst  = BASE / dn
        src  = dst / "src"

        # Skip if already has server.py
        if (src / "server.py").exists():
            skipped.append(code)
            continue

        os.makedirs(src, exist_ok=True)

        with open(src / "server.py", "w", encoding="utf-8") as f:
            f.write(make_server(st, port))
        with open(dst / "index.html", "w", encoding="utf-8") as f:
            f.write(make_html(st, port))
        with open(dst / "README.md", "w", encoding="utf-8") as f:
            f.write(make_readme(st, port))

        created.append((code, port))

    print(f"Created:  {len(created)} apps")
    print(f"Skipped:  {len(skipped)} (already exist)")
    if skipped:
        print(f"Existing: {', '.join(skipped[:10])}" +
              (f" ... +{len(skipped)-10} more" if len(skipped)>10 else ""))
    print(f"\nPorts:    {PORT_BASE} – {PORT_BASE + len(L001) - 1} (74 ports)")
    print(f"\nNext:     cd <station-dir>/src && python3 server.py")


if __name__ == "__main__":
    generate()
