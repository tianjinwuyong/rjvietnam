"""Regenerate all 74 station HTML UIs with Vanilla JS (no CDN)."""
import json, os
from pathlib import Path

BASE = Path("C:/Users/tianj/Desktop/越南工厂瑞晶/越南工厂瑞晶/smt-factory-system/integrations")

with open(BASE.parent / "_l001_stations.json", encoding="utf-8") as f:
    L001 = json.load(f)

PORT_BASE = 5300

CSS = ("*{margin:0;padding:0;box-sizing:border-box}"
      "body{font-family:Arial,'Microsoft YaHei',sans-serif;background:#1a1a2e;color:#eee;min-height:100vh}"
      ".hdr{background:#16213e;padding:10px 24px;display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #0f3460}"
      ".hdr-title{font-size:20px;font-weight:700;color:#e94560}"
      ".hdr-station{font-size:13px;color:#888}"
      ".lang-btns{display:flex;gap:6px}"
      ".lang-btn{padding:5px 12px;border-radius:6px;border:none;cursor:pointer;font-size:13px;font-weight:600;background:#0f3460;color:#aaa}"
      ".lang-btn.active{background:#e94560;color:#fff}"
      ".main{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:calc(100vh - 140px);padding:24px;gap:20px}"
      ".step-card{background:#16213e;border:3px solid #0f3460;border-radius:20px;padding:40px 60px;text-align:center;min-width:480px;box-shadow:0 8px 32px rgba(0,0,0,0.4);transition:border-color 0.3s}"
      ".step-label{font-size:14px;color:#888;margin-bottom:10px}"
      ".step-title{font-size:52px;font-weight:900;line-height:1}"
      ".step-sn{margin-top:16px;font-size:18px;background:#0a0a1a;border-radius:10px;padding:10px 24px;display:inline-block;color:#aaa}"
      ".step-sn b{color:#fff;letter-spacing:2}"
      ".step-error{margin-top:14px;font-size:16px;color:#f44336;font-weight:700;display:none}"
      ".result-banner{padding:16px 40px;border-radius:12px;font-size:22px;font-weight:800;text-align:center;display:none}"
      ".result-pass{background:#1b3a1f;border:2px solid #4caf50;color:#4caf50}"
      ".result-ng{background:#3a1b1b;border:2px solid #f44336;color:#f44336}"
      ".btn-row{display:flex;gap:16px}"
      ".btn{font-size:20px;font-weight:800;padding:16px 48px;border-radius:14px;border:none;cursor:pointer;letter-spacing:1;transition:transform 0.1s}"
      ".btn:active{transform:scale(0.97)}"
      ".btn:hover{opacity:0.9}"
      ".btn-pass{background:#4caf50;color:#fff}"
      ".btn-ng{background:#f44336;color:#fff}"
      ".btn-reset{background:#37474f;color:#aaa;font-size:15px;padding:10px 28px}"
      ".ng-panel{background:#1a1a2e;border:2px solid #f44336;border-radius:14px;padding:24px 32px;min-width:460px;display:none}"
      ".ng-panel.show{display:block}"
      ".ng-panel h3{color:#f44336;margin-bottom:16px;font-size:18px}"
      ".ng-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}"
      ".ng-item{background:#16213e;border:1px solid #333;border-radius:8px;padding:10px 14px;cursor:pointer;text-align:center;font-size:14px;color:#ccc;transition:all 0.15s}"
      ".ng-item:hover{border-color:#f44336;color:#fff}"
      ".ng-item.sel{border-color:#f44336;background:#3a1b1b;color:#f44336;font-weight:700}"
      ".ng-item .code{display:block;font-size:11px;color:#888}"
      ".ng-item.sel .code{color:#f44336}"
      ".ng-qty-row{display:flex;align-items:center;gap:10px;margin-top:12px;color:#aaa;font-size:14px}"
      ".ng-qty-row input{width:60px;padding:6px 10px;border-radius:6px;border:1px solid #333;background:#16213e;color:#fff;text-align:center}"
      ".ng-actions{display:flex;gap:12px;margin-top:16px}"
      ".ng-submit{flex:1;background:#f44336;color:#fff;font-size:18px;font-weight:700;padding:12px;border-radius:10px;border:none;cursor:pointer}"
      ".ng-cancel{background:#37474f;color:#aaa;font-size:14px;padding:12px 24px;border-radius:10px;border:none;cursor:pointer}"
      ".scan-area{display:flex;flex-direction:column;align-items:center;gap:10px;width:100%;max-width:460px}"
      ".scan-inp{font-size:26px;padding:16px 24px;width:100%;border-radius:12px;border:2px solid #0f3460;background:#16213e;color:#fff;text-align:center;outline:none}"
      ".scan-inp:focus{border-color:#e94560}"
      ".scan-hint{font-size:12px;color:#555}"
      ".history{background:#0d0d1a;border-top:1px solid #222;padding:12px 24px;max-height:200px;overflow-y:auto;display:none}"
      ".history h4{color:#666;font-size:12px;margin-bottom:8px;text-transform:uppercase;letter-spacing:1}"
      ".hist-item{display:flex;gap:16px;font-size:13px;padding:5px 0;border-bottom:1px solid #1a1a2e;color:#888}"
      ".hist-item .pass{color:#4caf50}"
      ".hist-item .ngcol{color:#f44336}"
      ".hist-item .sncol{color:#ccc;font-family:monospace}"
      ".hist-item .time{margin-left:auto;color:#444}")

NG_CODES = [["NG01","桥连/短路","Bridge/Short"],["NG02","缺件/Missing","Missing"],
    ["NG03","偏位/位移","Offset"],["NG04","立碑","Tombstone"],
    ["NG05","冷焊","Cold solder"],["NG06","焊点不良","Poor solder"],
    ["NG07","元器件坏","Component damaged"],["NG08","PCB划伤","PCB scratch"],
    ["NG09","极性反","Polarity reversed"],["NG10","其他","Other"]]

I18N = {"zh-CN":{"ready":"系统就绪","scan":"请扫码 SN","pass":"PASS 过站","ng":"报 NG","reset":"重置",
    "sel_ng":"选择NG原因","qty":"数量","confirm":"确认","cancel":"取消",
    "pass_ok":"过站成功","ng_ok":"NG已记录","history":"最近记录",
    "step_idle":"就绪","step_scanned":"已扫描","step_passed":"PASS","step_ng":"NG"},
   "vi-VN":{"ready":"He thong san sang","scan":"Quet SN","pass":"PASS Qua tram","ng":"Bao NG","reset":"Dat lai",
    "sel_ng":"Chon ly do NG","qty":"So luong","confirm":"Xac nhan","cancel":"Huy",
    "pass_ok":"Qua tram OK","ng_ok":"NG da ghi","history":"Lich su",
    "step_idle":"San sang","step_scanned":"Da quet","step_passed":"PASS","step_ng":"NG"},
   "en-US":{"ready":"System ready","scan":"Scan SN","pass":"PASS","ng":"Report NG","reset":"Reset",
    "sel_ng":"Select NG reason","qty":"Qty","confirm":"Confirm","cancel":"Cancel",
    "pass_ok":"Pass success","ng_ok":"NG recorded","history":"History",
    "step_idle":"Ready","step_scanned":"Scanned","step_passed":"PASS","step_ng":"NG"}}

def esc(s): return s.replace("\\","\\\\").replace('"','\\"').replace("\n","\\n")

def make_html(code, name_zh, port):
    # Build NG grid HTML
    ng_grid_zh = "".join(
        '<div class="ng-item" data-code="'+nc[0]+'"><span class="code">'+nc[0]+'</span>'+nc[1]+'</div>'
        for nc in NG_CODES)

    tpl = (
        '<!DOCTYPE html><html lang="zh-CN">'
        '<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>'
        '<title>{CODE} - {NAME}</title>'
        '<style>{CSS}</style>'
        '</head><body>'
        '<div class="hdr">'
        '  <div><div class="hdr-title">{CODE}</div><div class="hdr-station">{NAME}</div></div>'
        '  <div class="lang-btns" id="lb"></div>'
        '</div>'
        '<div class="main">'
        '  <div class="step-card" id="sc" style="border-color:#0f3460;background:#16213e">'
        '    <div class="step-label" id="sl">系统就绪</div>'
        '    <div class="step-title" id="st" style="color:#888">就绪</div>'
        '    <div class="step-sn" id="ssn" style="display:none">SN: <b id="sv"></b></div>'
        '    <div class="step-error" id="se"></div>'
        '  </div>'
        '  <div class="result-banner" id="rb"></div>'
        '  <div class="ng-panel" id="np">'
        '    <h3 id="nt">选择NG原因</h3>'
        '    <div class="ng-grid" id="ng">{NG_ZH}</div>'
        '    <div class="ng-qty-row"><span id="ql">数量:</span><input type="number" id="nq" value="1" min="1"/></div>'
        '    <div class="ng-actions">'
        '      <button class="ng-submit" id="ns" onclick="subNg()" disabled>确认</button>'
        '      <button class="ng-cancel" id="nc" onclick="cancelNg()">取消</button>'
        '    </div>'
        '  </div>'
        '  <div>'
        '    <div class="btn-row" id="br" style="display:none">'
        '      <button class="btn btn-pass" id="bp" onclick="doPass()">PASS</button>'
        '      <button class="btn btn-ng" id="bn" onclick="showNg()">NG</button>'
        '    </div>'
        '    <div class="scan-area">'
        '      <input class="scan-inp" id="si" placeholder="请扫码 SN" onkeydown="if(event.key===\'Enter\')sendScan()"/>'
        '      <span class="scan-hint">USB扫码枪自动输入 / 手动回车</span>'
        '    </div>'
        '    <button class="btn btn-reset" id="brst" onclick="doReset()">重置</button>'
        '  </div>'
        '</div>'
        '<div class="history" id="hp"><h4 id="ht">最近记录</h4><div id="hl"></div></div>'
        '<script>'
        'const API="http://localhost:{PORT}";'
        'const NC={NGS};'
        'const I18N={I18NS};'
        'const LL={{"zh-CN":"中文","vi-VN":"Viet","en-US":"EN"}};'
        'const SC={{idle:"#888",scanned:"#2196f3",passed:"#4caf50",ng:"#f44336"}};'
        'const SB={{idle:"#16213e",scanned:"#1a2f3e",passed:"#1b3a1f",ng:"#3a1b1b"}};'
        'var st={step:"idle",sn:null,locale:"zh-CN",history:[],last_rec:null,last_err:null};'
        'var selNg=null,es=null,pol=null;'
        'function u(k){return (I18N[st.locale]||I18N["zh-CN"])[k]||k;}'
        'function upd(){'
        '  var c=document.getElementById("sc");'
        '  var scol=SC[st.step]||"#888",sbg=SB[st.step]||"#16213e";'
        '  c.style.borderColor=scol;c.style.background=sbg;'
        '  var sm={idle:u("step_idle"),scanned:u("step_scanned"),passed:u("step_passed"),ng:u("step_ng")};'
        '  var tt=document.getElementById("st");tt.textContent=sm[st.step]||u("step_idle");tt.style.color=scol;'
        '  var sd=document.getElementById("ssn"),sv=document.getElementById("sv");'
        '  if(st.sn){sd.style.display="inline-block";sv.textContent=st.sn;}else{sd.style.display="none";}'
        '  var ed=document.getElementById("se");'
        '  if(st.last_err){ed.style.display="block";ed.textContent=st.last_err;}else{ed.style.display="none";}'
        '  var br=document.getElementById("br");br.style.display=st.step==="scanned"?"flex":"none";'
        '  var rb=document.getElementById("rb");'
        '  if(st.last_rec){rb.style.display="block";'
        '    rb.className="result-banner "+(st.last_rec.result==="PASS"?"result-pass":"result-ng");'
        '    rb.textContent=(st.last_rec.result==="PASS"?u("pass_ok"):u("ng_ok"))+" - "+st.last_rec.sn;'
        '  }else{rb.style.display="none";}'
        '  var lb=document.getElementById("lb");lb.innerHTML="";'
        '  Object.keys(LL).forEach(function(l){'
        '    var b=document.createElement("button");b.className="lang-btn"+(st.locale===l?" active":"");'
        '    b.textContent=LL[l];b.onclick=function(){setL(l);};lb.appendChild(b);'
        '  });'
        '  document.getElementById("nt").textContent=u("sel_ng");'
        '  document.getElementById("ql").textContent=u("qty")+":";'
        '  document.getElementById("ns").textContent=u("confirm");'
        '  document.getElementById("nc").textContent=u("cancel");'
        '  document.getElementById("si").placeholder=u("scan");'
        '  document.getElementById("ht").textContent=u("history");'
        '  var ng=document.getElementById("ng");ng.innerHTML="";'
        '  NC.forEach(function(nc){'
        '    var label=st.locale==="zh-CN"?nc[1]:nc[2];'
        '    var d=document.createElement("div");'
        '    d.className="ng-item"+(selNg===nc[0]?" sel":"");'
        '    d.dataset.code=nc[0];'
        '    d.innerHTML=\'<span class="code">\'+nc[0]+\'</span>\'+label;'
        '    d.onclick=function(){selNgEl(d,nc[0]);};'
        '    ng.appendChild(d);'
        '  });'
        '  var hp=document.getElementById("hp"),hl=document.getElementById("hl");'
        '  if(st.history&&st.history.length>0){hp.style.display="block";hl.innerHTML="";'
        '    st.history.forEach(function(h){'
        '      var d=document.createElement("div");d.className="hist-item";'
        '      var t=new Date(h.time).toLocaleTimeString();'
        '      d.innerHTML=\'<span class="\'+(h.result==="PASS"?"pass":"ngcol")+\'">\'+h.result+\'</span>\''
        '        +\'<span class="sncol">\'+h.sn+\'</span>\''
        '        +(h.ng_code?\'<span style="color:#f44336">\'+h.ng_code+\'</span>\':\'\')'
        '        +\'<span class="time">\'+t+\'</span>\';'
        '      hl.appendChild(d);'
        '    });'
        '  }else{hp.style.display="none";}'
        '  document.getElementById("bp").textContent="PASS "+u("pass");'
        '  document.getElementById("bn").textContent="NG "+u("ng");'
        '  document.getElementById("brst").textContent=u("reset");'
        '}'
        'function selNgEl(el,code){'
        '  document.querySelectorAll(".ng-item").forEach(function(e){e.classList.remove("sel");});'
        '  el.classList.add("sel");selNg=code;'
        '  document.getElementById("ns").disabled=false;'
        '}'
        'function showNg(){document.getElementById("np").classList.add("show");selNg=null;document.getElementById("ns").disabled=true;document.getElementById("nq").value=1;}'
        'function cancelNg(){document.getElementById("np").classList.remove("show");selNg=null;}'
        'function subNg(){if(!selNg)return;'
        '  var q=parseInt(document.getElementById("nq").value)||1;'
        '  fetch(API+"/api/ng",{method:"POST",headers:{"Content-Type":"application/json"},'
        '    body:JSON.stringify({ng_code:selNg,ng_qty:q})}).catch(function(){});'
        '  document.getElementById("np").classList.remove("show");selNg=null;'
        '}'
        'function sendScan(){'
        '  var sn=document.getElementById("si").value.trim();'
        '  if(!sn)return;'
        '  document.getElementById("si").value="";'
        '  fetch(API+"/api/scan",{method:"POST",headers:{"Content-Type":"application/json"},'
        '    body:JSON.stringify({sn:sn})}).catch(function(){});'
        '}'
        'function doPass(){if(st.step!=="scanned")return;'
        '  fetch(API+"/api/pass",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}).catch(function(){});'
        '}'
        'function doReset(){'
        '  fetch(API+"/api/reset",{method:"POST",headers:{"Content-Type":"application/json"}}).catch(function(){});'
        '  document.getElementById("si").value="";'
        '}'
        'function setL(l){'
        '  fetch(API+"/api/locale",{method:"POST",headers:{"Content-Type":"application/json"},'
        '    body:JSON.stringify({locale:l})}).catch(function(){});'
        '}'
        'function connSSE(){if(es){es.close();es=null;}es=new EventSource(API+"/api/sse");'
        '  es.onmessage=function(e){try{st=JSON.parse(e.data);upd();}catch{}};'
        '  es.onerror=function(){es.close();es=null;'
        '    if(!pol)pol=setInterval(function(){'
        '      fetch(API+"/api/state").then(function(r){return r.json();}).then(function(s){st=s;upd();}).catch(function(){});'
        '    },2000);'
        '  };'
        '}'
        'function init(){'
        '  fetch(API+"/api/state").then(function(r){return r.json();}).then(function(s){st=s;upd();}).catch(function(){});'
        '  connSSE();'
        '  document.getElementById("si").focus();'
        '}'
        'document.addEventListener("DOMContentLoaded",init);'
        'document.addEventListener("keydown",function(e){if(e.key==="F5"){e.preventDefault();doReset();}});'
        '</script></body></html>'
    )

    return (tpl
        .replace("{CODE}", code)
        .replace("{NAME}", name_zh)
        .replace("{CSS}", CSS)
        .replace("{PORT}", str(port))
        .replace("{NGS}", json.dumps(NG_CODES, ensure_ascii=False))
        .replace("{I18NS}", json.dumps(I18N, ensure_ascii=False))
        .replace("{NG_ZH}", ng_grid_zh))

count = 0
for i, st in enumerate(L001):
    code = st["code"]
    name_zh = st["name_zh"]
    port = PORT_BASE + i
    dn = code.lower().replace("-","_")
    dst = BASE / dn
    with open(dst / "index.html", "w", encoding="utf-8") as f:
        f.write(make_html(code, name_zh, port))
    count += 1

print("Regenerated " + str(count) + " HTML files (Vanilla JS, no CDN)")
