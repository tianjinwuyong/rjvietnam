"""
SN Binding Terminal — Flask backend
Runs on port 5199.
API: POST /api/scan  POST /api/bind  GET /api/state  GET /api/sse
Scanner: reads serial port, dispatches scan to in-memory state + SSE.
"""

import threading
import json
import time
import logging
from datetime import datetime, timezone
from flask import Flask, request, Response, jsonify
from flask_cors import CORS
# psycopg2 imported lazily inside do_bind() to avoid blocking waitress worker init

# ── Config ────────────────────────────────────────────────────────────────────
DB_CONFIG = {
    "host": "127.0.0.1",
    "port": 5432,
    "user": "postgres",
    "password": "postgres",
    "database": "smt_factory",
}
API_PORT = 5199
# USB 扫码枪是键盘输入（HID），不需要串口配置
# 扫码枪扫的字符直接发到焦点的输入框

# ── TTS (lazy init to avoid blocking startup) ─────────────────────────────────
_tts_engine = None

def _get_tts():
    global _tts_engine
    if _tts_engine is None:
        import pyttsx3 as _pyttsx3
        _tts_engine = _pyttsx3.init()
        _tts_engine.setProperty("rate", 160)
    return _tts_engine

def tts(text: str):
    def _speak():
        try:
            engine = _get_tts()
            engine.say(text)
            engine.runAndWait()
        except Exception:
            pass
    t = threading.Thread(target=_speak, daemon=True)
    t.start()

# ── QR validation ──────────────────────────────────────────────────────────────
import re
SN_RE = re.compile(r"^[A-Za-z0-9_\-]{1,50}$")

def validate_sn(sn: str) -> str | None:
    sn = sn.strip()
    if not sn:
        return "error_empty"
    if len(sn) > 50:
        return "error_long"
    if not SN_RE.match(sn):
        return "error_invalid"
    return None
I18N = {
    "zh-CN": {
        "ready":          "系统就绪",
        "scan_pcba":      "请扫码 PCBA",
        "scan_shell":     "请扫码外壳",
        "binding":        "正在绑定",
        "success":        "绑定成功",
        "error_same":     "两次扫码相同，请重新扫",
        "error_empty":    "QR 不能为空",
        "error_long":     "QR 太长（最多 50 字符）",
        "error_invalid":  "QR 包含非法字符（只允许字母、数字、-、_）",
        "error_db":       "数据库错误",
        "binding_record": "绑定记录",
        "pcba_sn":        "PCBA 序列号",
        "shell_sn":       "外壳序列号",
        "operator":       "操作员",
        "station":        "工位",
        "re_scan":        "重新扫码",
        "history":        "历史记录",
    },
    "vi-VN": {
        "ready":          "Hệ thống sẵn sàng",
        "scan_pcba":      "Quét PCBA",
        "scan_shell":     "Quét vỏ máy",
        "binding":        "Đang gán",
        "success":        "Gán thành công",
        "error_same":     "Hai lần quét giống nhau, quét lại",
        "error_empty":    "QR không được trống",
        "error_long":     "QR quá dài (tối đa 50 ký tự)",
        "error_invalid":  "QR chứa ký tự không hợp lệ (chỉ chữ cái, số, -, _)",
        "error_db":       "Lỗi cơ sở dữ liệu",
        "binding_record": "Bản ghi gán",
        "pcba_sn":        "SN PCBA",
        "shell_sn":       "SN vỏ máy",
        "operator":       "Nhân viên",
        "station":        "Trạm",
        "re_scan":        "Quét lại",
        "history":        "Lịch sử",
    },
    "en-US": {
        "ready":          "System ready",
        "scan_pcba":      "Scan PCBA",
        "scan_shell":     "Scan shell",
        "binding":        "Binding",
        "success":        "Binding success",
        "error_same":     "Same scan twice, please rescan",
        "error_empty":    "QR cannot be empty",
        "error_long":     "QR too long (max 50 chars)",
        "error_invalid":  "QR contains invalid chars (letters, numbers, -, _ only)",
        "error_db":       "Database error",
        "binding_record": "Binding record",
        "pcba_sn":        "PCBA serial",
        "shell_sn":       "Shell serial",
        "operator":       "Operator",
        "station":        "Station",
        "re_scan":        "Rescan",
        "history":        "History",
    },
}

# ── In-memory state ───────────────────────────────────────────────────────────
class BindingState:
    def __init__(self):
        self.lock = threading.RLock()  # RLock: reentrant, safe for _broadcast() while lock held
        self.pcba_sn: str | None = None
        self.shell_sn: str | None = None
        self.step: str = "scan_pcba"   # scan_pcba | scan_shell | done
        self.last_error: str | None = None
        self.last_binding: dict | None = None
        self.locale: str = "zh-CN"
        self.operator_id: int | None = None
        self.station_id: int | None = None
        self._sse_clients: list = []

    def t(self, key: str) -> str:
        return I18N[self.locale].get(key, key)

    def handle_scan(self, sn: str, operator_id: int | None, station_id: int | None):
        with self.lock:
            self.last_error = None
            if self.step == "scan_pcba":
                self.pcba_sn = sn.strip()
                self.step = "scan_shell"
                if operator_id: self.operator_id = operator_id
                if station_id: self.station_id = station_id
                self._broadcast()
                return {"ok": True, "step": self.step, "t": self.t("scan_shell")}
            elif self.step == "scan_shell":
                self.shell_sn = sn.strip()
                if self.shell_sn == self.pcba_sn:
                    self.last_error = self.t("error_same")
                    self.step = "scan_pcba"
                    self.pcba_sn = None
                    self._broadcast()
                    return {"ok": False, "error": self.last_error}
                self.step = "done"
                self._broadcast()
                return {"ok": True, "step": self.step, "t": self.t("binding")}
            return {"ok": False}

    def do_bind(self, operator_id: int | None, station_id: int | None):
        import psycopg2  # lazy import
        with self.lock:
            if self.step != "done" or not self.pcba_sn or not self.shell_sn:
                return {"ok": False, "error": "invalid state"}
            oid = operator_id or self.operator_id or 0
            sid = station_id or self.station_id or 0
            try:
                conn = psycopg2.connect(**DB_CONFIG)
                cur = conn.cursor()
                cur.execute("""
                    INSERT INTO sn_binding_records
                      (work_order_id, binding_type, sn_a, sn_b, station_id, operator_id, bound_at)
                    VALUES (0, 'PCBA_SHELL', %s, %s, %s, %s, %s)
                    RETURNING id, bound_at
                """, (self.pcba_sn, self.shell_sn, sid, oid,
                      datetime.now(timezone.utc)))
                row = cur.fetchone()
                conn.commit()
                record = {
                    "id": row[0],
                    "sn_a": self.pcba_sn,
                    "sn_b": self.shell_sn,
                    "bound_at": row[1].isoformat(),
                    "binding_type": "PCBA_SHELL",
                }
                self.last_binding = record
                self.pcba_sn = None
                self.shell_sn = None
                self.step = "scan_pcba"
                self._broadcast()
                return {"ok": True, "record": record}
            except Exception as e:
                logging.exception("bind db error")
                return {"ok": False, "error": str(e)}
            finally:
                try:
                    conn.close()
                except Exception:
                    pass

    def reset(self):
        with self.lock:
            self.pcba_sn = None
            self.shell_sn = None
            self.step = "scan_pcba"
            self.last_error = None
            self.last_binding = None
            self._broadcast()

    def set_locale(self, locale: str):
        with self.lock:
            self.locale = locale
            self._broadcast()

    def get_state(self) -> dict:
        with self.lock:
            return {
                "step": self.step,
                "pcba_sn": self.pcba_sn,
                "shell_sn": self.shell_sn,
                "last_error": self.last_error,
                "last_binding": self.last_binding,
                "locale": self.locale,
                "t": {k: self.t(k) for k in [
                    "ready","scan_pcba","scan_shell","binding","success",
                    "error_same","error_db","binding_record","pcba_sn",
                    "shell_sn","operator","station","re_scan","history",
                ]},
            }

    def add_client(self, client_queue):
        self._sse_clients.append(client_queue)

    def remove_client(self, client_queue):
        if client_queue in self._sse_clients:
            self._sse_clients.remove(client_queue)

    def _broadcast(self):
        data = json.dumps(self.get_state())
        dead = []
        for q in self._sse_clients:
            try:
                q.put_nowait(data)
            except Exception:
                dead.append(q)
        for q in dead:
            self.remove_client(q)


state = BindingState()

# ── Flask app ─────────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

@app.route("/api/scan", methods=["POST"])
def api_scan():
    body = request.get_json() or {}
    sn = body.get("sn", "")
    err_key = validate_sn(sn)
    if err_key:
        err_msg = I18N[state.locale].get(err_key, err_key)
        return jsonify({"ok": False, "error": err_msg}), 400
    result = state.handle_scan(
        sn,
        operator_id=body.get("operator_id"),
        station_id=body.get("station_id"),
    )
    step = state.step
    if result["ok"]:
        if step == "scan_shell":
            t = threading.Thread(target=tts, args=(I18N[state.locale]["scan_shell"],))
            t.start()
        elif step == "done":
            t = threading.Thread(target=tts, args=(I18N[state.locale]["binding"],))
            t.start()
    else:
        if result.get("error"):
            t = threading.Thread(target=tts, args=(result["error"],))
            t.start()
    return jsonify(result)

@app.route("/api/bind", methods=["POST"])
def api_bind():
    body = request.get_json() or {}
    result = state.do_bind(
        operator_id=body.get("operator_id"),
        station_id=body.get("station_id"),
    )
    if result["ok"]:
        t = threading.Thread(target=tts, args=(I18N[state.locale]["success"],))
        t.start()
    else:
        t = threading.Thread(target=tts, args=(I18N[state.locale]["error_db"],))
        t.start()
    return jsonify(result)

@app.route("/api/state", methods=["GET"])
def api_state():
    return jsonify(state.get_state())

@app.route("/api/locale", methods=["POST"])
def api_locale():
    body = request.get_json() or {}
    locale = body.get("locale", "zh-CN")
    if locale not in I18N:
        return jsonify({"ok": False}), 400
    state.set_locale(locale)
    return jsonify({"ok": True, "locale": locale})

@app.route("/api/tts", methods=["POST"])
def api_tts():
    body = request.get_json() or {}
    text = body.get("text", "")
    if text:
        threading.Thread(target=tts, args=(text,), daemon=True).start()
    return jsonify({"ok": True})

@app.route("/api/reset", methods=["POST"])
def api_reset():
    state.reset()
    return jsonify({"ok": True})

@app.route("/api/sse", methods=["GET"])
def api_sse():
    import queue
    q: queue.Queue = queue.Queue()
    state.add_client(q)

    def gen():
        while True:
            try:
                data = q.get(timeout=30)
                yield f"data: {data}\n\n"
            except queue.Empty:
                yield f"data: {json.dumps({'type':'ping'})}\n\n"

    headers = {
        "X-Accel-Buffering": "no",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
    }
    return Response(gen(), mimetype="text/event-stream", headers=headers)

# ── Startup ───────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s")
    app.run(host="0.0.0.0", port=API_PORT, debug=False, threaded=True)