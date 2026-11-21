#!/usr/bin/env python3
"""Generate all 74 SMT L001 station apps."""
import json, os
from pathlib import Path

BASE = Path("C:/Users/tianj/Desktop/越南工厂瑞晶/越南工厂瑞晶/smt-factory-system/integrations")
MES_API = "http://localhost:8080"
PORT_BASE = 5300

with open(BASE.parent / "_l001_stations.json", encoding="utf-8") as f:
    L001 = json.load(f)

I18N_S = json.dumps({
    "zh-CN": {"ready": "系统就绪", "pass": "PASS", "fail": "FAIL", "ng": "NG", "dup_sn": "重复SN"},
    "vi-VN": {"ready": "He thong san sang", "pass": "PASS", "fail": "FAIL", "ng": "NG", "dup_sn": "SN trung lap"},
    "en-US": {"ready": "System ready", "pass": "PASS", "fail": "FAIL", "ng": "NG", "dup_sn": "Duplicate SN"},
}, ensure_ascii=False)

SERVER_TEMPLATE = r"""#!/usr/bin/env python3
import json,threading,logging
from datetime import datetime
from flask import Flask,request,Response,jsonify
from flask_cors import CORS
MES_API="Mmes";PORT=Pport;SCODE="Scode";SNAME="Sname"
STYPE="Stype"
I18N=Ii18n
app=Flask(__name__)
CORS(app,resources={r"/api/*":{"origins":"*"}})
_tts=None
def _get_tts():
    global _tts
    if _tts is None:
        import pyttsx3 as _pyttsx3
        _tts=_pyttsx3.init();_tts.setProperty("rate",160)
    return _tts
def tts(text):
    def _s():
        try:_get_tts().say(text);_get_tts().runAndWait()
        except:pass
    threading.Thread(target=_s,daemon=True).start()
SN_RE=__import__("re").compile(r"^[A-Za-z0-9_\-]{1,50}$")
def validate_sn(sn):
    sn=sn.strip()
    if not sn:return "empty"
    if len(sn)>50:return "too_long"
    if not SN_RE.match(sn):return "invalid"
    return None
class State:
    def __init__(self):
        self.lock=threading.RLock();self.sn=None;self.work_order=None;self.op_id=None
        self.step="idle";self.last_err=None;self.last_rec=None
        self.locale="zh-CN";self._clients=[];self._hist=[]
    def t(self,k):return I18N.get(self.locale,I18N["zh-CN"]).get(k,k)
    def dup_check(self,sn):
        import urllib.request
        try:
            req=urllib.request.Request(f"{MES_API}/api/mes/sn-check",
                data=json.dumps({"sn":sn}).encode(),headers={"Content-Type":"application/json"})
            return json.loads(urllib.request.urlopen(req,timeout=5).read()).get("duplicate",False)
        except:return False
    def mes_event(self,sn,result,wo=None,ng_code=None,ng_qty=0,op=None):
        import urllib.request
        payload={"stationCode":SCODE,"operator":op or f"OP_{self.op_id}",
                  "result":result,"traceabilityKey":sn,"workOrderCode":wo or "",
                  "ngCode":ng_code or "","ngQty":ng_qty}
        try:
            urllib.request.urlopen(urllib.request.Request(
                f"{MES_API}/api/mes/events",
                data=json.dumps({"payload":payload}).encode(),
                headers={"Content-Type":"application/json"}),timeout=5)
        except Exception as e:logging.warning("MES event failed: %s",e)
    def do_scan(self,sn,op_id=None,wo=None):
        err=validate_sn(sn)
        with self.lock:
            self.last_err=None
            if err:
                msg={"empty":"SN不能为空","too_long":"SN太长","invalid":"SN格式非法"}[err]
                self.last_err=msg;self._bc();return {"ok":False,"error":msg}
            if self.dup_check(sn):
                self.last_err=self.t("dup_sn");tts(self.t("dup_sn"));self._bc()
                return {"ok":False,"error":self.t("dup_sn")}
            self.sn=sn.strip();self.work_order=wo
            if op_id:self.op_id=op_id
            self.step="scanned";self._bc()
            return {"ok":True,"step":"scanned","sn":self.sn}
    def do_pass(self,op_id=None):
        with self.lock:
            if self.step!="scanned":return {"ok":False,"error":"no scan"}
            op=op_id or self.op_id
            self.mes_event(self.sn,"PASS",self.work_order,op=f"OP_{op}")
            rec={"id":len(self._hist)+1,"sn":self.sn,"result":"PASS","station":SCODE,
                  "time":datetime.now().isoformat(),"operator":op,"wo":self.work_order}
            self._hist.insert(0,rec);self._hist=self._hist[:50]
            self.last_rec=rec;self.step="passed";self._bc();tts(self.t("pass"))
            return {"ok":True,"record":rec}
    def do_ng(self,ng_code,ng_qty=1,op_id=None):
        with self.lock:
            if self.step not in("scanned",):return {"ok":False,"error":"scan first"}
            op=op_id or self.op_id
            self.mes_event(self.sn,"NG",self.work_order,ng_code,ng_qty,f"OP_{op}")
            rec={"id":len(self._hist)+1,"sn":self.sn,"result":"NG","station":SCODE,
                  "time":datetime.now().isoformat(),"operator":op,"wo":self.work_order,
                  "ng_code":ng_code,"ng_qty":ng_qty}
            self._hist.insert(0,rec);self._hist=self._hist[:50]
            self.last_rec=rec;self.step="ng";self._bc();tts(self.t("fail"))
            return {"ok":True,"record":rec}
    def do_reset(self):
        with self.lock:
            self.sn=None;self.work_order=None;self.step="idle"
            self.last_err=None;self.last_rec=None;self._bc()
    def set_locale(self,locale):
        with self.lock:
            if locale in I18N:self.locale=locale;self._bc()
    def get_state(self):
        with self.lock:
            return {"step":self.step,"sn":self.sn,"work_order":self.work_order,
                    "op_id":self.op_id,"locale":self.locale,"last_err":self.last_err,
                    "last_rec":self.last_rec,"history":self._hist[:20],
                    "station_code":SCODE,"station_name":SNAME,"station_type":STYPE}
    def add_client(self,q):self._clients.append(q)
    def rm_client(self,q):
        if q in self._clients:self._clients.remove(q)
    def _bc(self):
        import queue;data=json.dumps(self.get_state());dead=[]
        for q in self._clients:
            try:q.put_nowait(data)
            except:dead.append(q)
        for q in dead:self.rm_client(q)
state=State()
@app.route("/api/scan",methods=["POST"])
def api_scan():
    b=request.get_json() or {}
    return jsonify(state.do_scan(b.get("sn",""),b.get("op_id"),b.get("work_order")))
@app.route("/api/pass",methods=["POST"])
def api_pass():
    b=request.get_json() or {}
    return jsonify(state.do_pass(b.get("op_id")))
@app.route("/api/ng",methods=["POST"])
def api_ng():
    b=request.get_json() or {}
    return jsonify(state.do_ng(b.get("ng_code",""),b.get("ng_qty",1),b.get("op_id")))
@app.route("/api/reset",methods=["POST"])
def api_reset():
    state.do_reset();return jsonify({"ok":True})
@app.route("/api/state",methods=["GET"])
def api_state():return jsonify(state.get_state())
@app.route("/api/locale",methods=["POST"])
def api_locale():
    b=request.get_json() or {}
    loc=b.get("locale","zh-CN")
    if loc not in I18N:return jsonify({"ok":False}),400
    state.set_locale(loc);return jsonify({"ok":True,"locale":loc})
@app.route("/api/sse",methods=["GET"])
def api_sse():
    import queue;q=queue.Queue();state.add_client(q)
    def gen():
        while True:
            try:d=q.get(timeout=30);yield f"data: {d}\n\n"
            except queue.Empty:yield "data: {'type':'ping'}\n\n"
    return Response(gen(),mimetype="text/event-stream",
                    headers={"X-Accel-Buffering":"no","Cache-Control":"no-cache"})
if __name__=="__main__":
    logging.basicConfig(level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
    logging.info("Starting %s port %s",SCODE,PORT)
    app.run(host="0.0.0.0",port=PORT,debug=False,threaded=True)
"""

def dname(code): return code.lower().replace("-","_")

def gen_server(st, port):
    return (SERVER_TEMPLATE
        .replace("Mmes", MES_API)
        .replace("Pport", str(port))
        .replace("Scode", st["code"])
        .replace("Sname", st["name_zh"])
        .replace("Stype", st.get("station_type",""))
        .replace("Ii18n", I18N_S))

def gen_html(st, port):
    code=st["code"];name_zh=st["name_zh"];name_en=st.get("name_en",name_zh)
    ui_zh=json.dumps({"title":name_zh,"ready":"系统就绪","scan":"请扫码 SN","pass":"PASS 过站","ng":"报 NG",
        "reset":"重置","sel_ng":"选择NG原因","qty":"数量","confirm":"确认","cancel":"取消",
        "pass_ok":"过站成功","ng_ok":"NG已记录","history":"最近记录",
        "step_idle":"就绪","step_scanned":"已扫描","step_passed":"PASS","step_ng":"NG"},ensure_ascii=False)
    ui_vi=json.dumps({"title":name_en,"ready":"He thong san sang","scan":"Quet SN","pass":"PASS Qua tram","ng":"Bao NG",
        "reset":"Dat lai","sel_ng":"Chon ly do NG","qty":"So luong","confirm":"Xac nhan","cancel":"Huy",
        "pass_ok":"Qua tram OK","ng_ok":"NG da ghi","history":"Lich su",
        "step_idle":"San sang","step_scanned":"Da quet","step_passed":"PASS","step_ng":"NG"},ensure_ascii=False)
    ui_en=json.dumps({"title":name_en,"ready":"System ready","scan":"Scan SN","pass":"PASS","ng":"Report NG",
        "reset":"Reset","sel_ng":"Select NG reason","qty":"Qty","confirm":"Confirm","cancel":"Cancel",
        "pass_ok":"Pass success","ng_ok":"NG recorded","history":"History",
        "step_idle":"Ready","step_scanned":"Scanned","step_passed":"PASS","step_ng":"NG"},ensure_ascii=False)
    ng_items=",".join('{{code:"{0}",label_zh:"{1}",label_en:"{2}"}}'.format(c,n,e) for c,n,e in [
        ("NG01","桥连/短路","Bridge/Short"),("NG02","缺件/Missing","Missing"),
        ("NG03","偏位/位移","Offset"),("NG04","立碑","Tombstone"),
        ("NG05","冷焊","Cold solder"),("NG06","焊点不良","Poor solder"),
        ("NG07","元器件坏","Component damaged"),("NG08","PCB划伤","PCB scratch"),
        ("NG09","极性反","Polarity reversed"),("NG10","其他","Other"),
    ])
    css=("* { margin: 0; padding: 0; box-sizing: border-box; }"
         "body { font-family: Arial, 'Microsoft YaHei', sans-serif; background: #1a1a2e; color: #eee; min-height: 100vh; }"
         ".hdr { background: #16213e; padding: 10px 24px; display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #0f3460; }"
         ".hdr-title { font-size: 20px; font-weight: 700; color: #e94560; }"
         ".hdr-station { font-size: 13px; color: #888; }"
         ".lang-btns { display: flex; gap: 6px; }"
         ".lang-btn { padding: 5px 12px; border-radius: 6px; border: none; cursor: pointer; font-size: 13px; font-weight: 600; background: #0f3460; color: #aaa; }"
         ".lang-btn.active { background: #e94560; color: #fff; }"
         ".main { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: calc(100vh - 140px); padding: 24px; gap: 20px; }"
         ".step-card { background: #16213e; border: 3px solid #0f3460; border-radius: 20px; padding: 40px 60px; text-align: center; min-width: 480px; box-shadow: 0 8px 32px rgba(0,0,0,0.4); transition: border-color 0.3s; }"
         ".step-label { font-size: 14px; color: #888; margin-bottom: 10px; }"
         ".step-title { font-size: 52px; font-weight: 900; line-height: 1; }"
         ".step-sn { margin-top: 16px; font-size: 18px; background: #0a0a1a; border-radius: 10px; padding: 10px 24px; display: inline-block; color: #aaa; }"
         ".step-sn b { color: #fff; letter-spacing: 2; }"
         ".step-error { margin-top: 14px; font-size: 16px; color: #f44336; font-weight: 700; }"
         ".result-banner { padding: 16px 40px; border-radius: 12px; font-size: 22px; font-weight: 800; text-align: center; }"
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
         ".hist-item { display: flex; gap: 16px; font-size: 13px; padding: 5px 0; border-bottom: 1px solid #1a1a2e; color: #888; }"
         ".hist-item .pass { color: #4caf50; }"
         ".hist-item .ngcol { color: #f44336; }"
         ".hist-item .sncol { color: #ccc; font-family: monospace; }"
         ".hist-item .time { margin-left: auto; color: #444; }")
    jsx = (
        'const API="http://localhost:' + str(port) + '";'
        'const NG=[' + ng_items + '];'
        'const UZ=' + ui_zh + ',UV=' + ui_vi + ',UE=' + ui_en + ';'
        'const LM={"zh-CN":UZ,"vi-VN":UV,"en-US":UE};'
        'const SC={idle:"#888",scanned:"#2196f3",passed:"#4caf50",ng:"#f44336"};'
        'const SB={idle:"#16213e",scanned:"#1a2f3e",passed:"#1b3a1f",ng:"#3a1b1b"};'
        'function App(){'
        'const[st,setSt]=React.useState({step:"idle",sn:null,locale:"zh-CN",history:[],last_rec:null,last_err:null});'
        'const[manual,setManual]=React.useState("");'
        'const[ngP,setNgP]=React.useState(false);'
        'const[ngS,setNgS]=React.useState(null);'
        'const[ngQ,setNgQ]=React.useState(1);'
        'const esRef=React.useRef(null),polRef=React.useRef(null);'
        'const u=LM[st.locale]||UZ;'
        'React.useEffect(()=>{'
        'fetch(API+"/api/state").then(r=>r.json()).then(setSt).catch(()=>{});'
        'const es=new EventSource(API+"/api/sse");'
        'es.onmessage=e=>{try{setSt(JSON.parse(e.data))}catch{}};'
        'es.onerror=()=>{es.close();if(!polRef.current)polRef.current=setInterval(()=>fetch(API+"/api/state").then(r=>r.json()).then(setSt).catch(()=>{}),2000);};'
        'esRef.current=es;'
        'return()=>{es.close();if(polRef.current)clearInterval(polRef.current);};'
        '},[]);'
        'const sendScan=sn=>{if(!sn.trim())return;setManual("");fetch(API+"/api/scan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sn:sn.trim()})}).catch(()=>{});};'
        'const doPass=()=>{if(st.step!=="scanned")return;fetch(API+"/api/pass",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}).catch(()=>{});};'
        'const doNg=()=>{if(!ngS)return;fetch(API+"/api/ng",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ng_code:ngS,ng_qty:ngQ})}).catch(()=>{});setNgP(false);setNgS(null);setNgQ(1);};'
        'const doReset=()=>{fetch(API+"/api/reset",{method:"POST"}).catch(()=>{});setManual("");setNgP(false);setNgS(null);};'
        'const chL=l=>{fetch(API+"/api/locale",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({locale:l})}).catch(()=>{});};'
        'const sl={idle:u.step_idle,scanned:u.step_scanned,passed:u.step_passed,ng:u.step_ng}[st.step]||u.step_idle;'
        'const scolor=SC[st.step]||"#888",sbg=SB[st.step]||"#16213e";'
        'return React.createElement("div",null,'
        'React.createElement("div",{className:"hdr"},'
        'React.createElement("div",null,'
        'React.createElement("div",{className:"hdr-title"},' + json.dumps(code) + '),'
        'React.createElement("div",{className:"hdr-station"},' + json.dumps(name_zh) + ')),'
        'React.createElement("div",{className:"lang-btns"},'
        '["zh-CN","vi-VN","en-US"].map(l=>React.createElement("button",{key:l,className:"lang-btn"+(st.locale===l?" active":""),onClick:()=>chL(l)},{"zh-CN":"中文","vi-VN":"Viet","en-US":"EN"}[l])))),'
        'React.createElement("div",{className:"main"},'
        'React.createElement("div",{className:"step-card",style:{background:sbg,borderColor:scolor}},'
        'React.createElement("div",{className:"step-label"},u.ready),'
        'React.createElement("div",{className:"step-title",style:{color:scolor}},sl),'
        'st.sn&&React.createElement("div",{className:"step-sn"},"SN: ",React.createElement("b",null,st.sn)),'
        'st.last_err&&React.createElement("div",{className:"step-error"},st.last_err)),'
        'st.last_rec&&React.createElement("div",{className:"result-banner "+(st.last_rec.result==="PASS"?"result-pass":"result-ng")},'
        '(st.last_rec.result==="PASS"?u.pass_ok:u.ng_ok)+" - "+st.last_rec.sn),'
        'ngP?'
        'React.createElement("div",{className:"ng-panel"},'
        'React.createElement("h3",null,u.sel_ng),'
        'React.createElement("div",{className:"ng-grid"},'
        'NG.map(nc=>React.createElement("div",{key:nc.code,className:"ng-item"+(ngS===nc.code?" sel":""),onClick:()=>setNgS(nc.code)},'
        'React.createElement("span",{className:"code"},nc.code),'
        '(st.locale==="zh-CN"?nc.label_zh:nc.label_en))),'
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
        'React.createElement("h4",null,u.history),'
        'st.history.map(h=>React.createElement("div",{key:h.id,className:"hist-item"},'
        'React.createElement("span",{className:h.result==="PASS"?"pass":"ngcol"},h.result),'
        'React.createElement("span",{className:"sncol"},h.sn),'
        'h.ng_code&&React.createElement("span",{style:{color:"#f44336"}},h.ng_code),'
        'React.createElement("span",{className:"time"},new Date(h.time).toLocaleTimeString()))))'
        '));}'
        'ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));'
    )
    html = (
        '<!DOCTYPE html><html lang="zh-CN">'
        '<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>'
        '<title>' + code + ' - ' + name_zh + '</title>'
        '<script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>'
        '<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>'
        '<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>'
        '<style>' + css + '</style></head>'
        '<body><div id="root"></div>'
        '<script type="text/babel">' + jsx + '</script>'
        '</body></html>'
    )
    return html

created = []
skipped = []
for i, st in enumerate(L001):
    code = st["code"]
    port = PORT_BASE + i
    dn = dname(code)
    dst = BASE / dn
    src = dst / "src"
    if (src / "server.py").exists():
        skipped.append(code)
        continue
    os.makedirs(src, exist_ok=True)
    with open(src / "server.py", "w", encoding="utf-8") as f:
        f.write(gen_server(st, port))
    with open(dst / "index.html", "w", encoding="utf-8") as f:
        f.write(gen_html(st, port))
    created.append((code, port))

print("Created: %d apps" % len(created))
print("Skipped: %d (already exist)" % len(skipped))
print("Ports: %d-%d" % (PORT_BASE, PORT_BASE + len(L001) - 1))
print()
for c, p in created[:8]:
    print("  %s -> :%d" % (c, p))
if len(created) > 8:
    print("  ... +%d more" % (len(created) - 8,))
if skipped:
    print("Existing: %s" % ", ".join(skipped[:5]))
