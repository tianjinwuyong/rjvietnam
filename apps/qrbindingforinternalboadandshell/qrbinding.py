"""
QR码绑定系统 - QR Code Binding System
PCBA主板与外壳二维码绑定 | 越南瑞晶工厂内部工具
"""

import tkinter as tk
from tkinter import scrolledtext, ttk
import datetime
import json
import os
import sys
import sqlite3
import re
import subprocess
import threading
import queue
from typing import Optional, List, Tuple
from enum import Enum
import csv
import urllib.request
import urllib.error

APP_VERSION = "1.0.0"


def app_root() -> str:
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


CONFIG_FILE = os.path.join(app_root(), "config.json")


def _ensure_config():
    """config.json不存在时创建带规则的默认配置"""
    if os.path.exists(CONFIG_FILE):
        return
    default = {
        "sn_rules": {
            "_note": "patterns空=不校验, 填正则即开启校验",
            "pcba": {
                "patterns": [
                    "^5G\\d{7}[A-Z]$"
                ],
                "prefix": "",
                "min_length": 10,
                "max_length": 10,
                "description": "PCBA版规则: 5G+7位数字+1位字母"
            },
            "shell": {
                "patterns": [
                    "^NV18A[A-Z0-9]{9}$"
                ],
                "prefix": "",
                "min_length": 14,
                "max_length": 14,
                "description": "外壳规则: NV18A+9位字母或数字"
            }
        },
        "voice": {
            "enabled": True,
            "prompts": {
                "scan_pcba": "请扫版码",
                "scan_shell": "请扫壳码",
                "binding": "绑定",
                "violation": "违规",
                "success": "绑定成功"
            }
        },
        "binding_rules": {
            "prevent_duplicate_pcba": True,
            "prevent_duplicate_shell": True,
            "auto_bind": True
        }
    }
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(default, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


_ensure_config()


class SNRule:

    def __init__(self, pattern, prefix='', min_length=1, max_length=100, description=''):
        self.pattern = re.compile(pattern)
        self.prefix = prefix
        self.min_length = min_length
        self.max_length = max_length
        self.description = description

    def validate(self, sn: str) -> Tuple[bool, str]:
        sn = sn.strip()
        if not sn:
            return (False, 'SN为空')
        if len(sn) < self.min_length:
            return (False, f"过短({len(sn)}<{self.min_length})")
        if len(sn) > self.max_length:
            return (False, f"过长({len(sn)}>{self.max_length})")
        if self.prefix and not sn.startswith(self.prefix):
            return (False, f"应以{self.prefix}开头")
        if self.pattern.match(sn):
            return (True, 'OK')
        return (False, f"格式不匹配: {self.description}")


class SNValidator:

    def __init__(self, config_path: Optional[str] = None):
        self.pcba_rules = []
        self.shell_rules = []
        if config_path and os.path.exists(config_path):
            self._load_config(config_path)

    def _load_config(self, path: str):
        try:
            with open(path, "r", encoding="utf-8") as f:
                cfg = json.load(f).get("sn_rules", {})
            for key, rules_list, cfg_key in [
                ("pcba", self.pcba_rules, cfg.get("pcba", {})),
                ("shell", self.shell_rules, cfg.get("shell", {}))
            ]:
                rules_list.clear()
                for p in cfg_key.get("patterns", []):
                    if p and p.strip():
                        try:
                            re.compile(p.strip())
                        except re.error:
                            print(f"无效正则已跳过: {p}")
                            continue
                        rules_list.append(SNRule(
                            pattern=p.strip(),
                            prefix=cfg_key.get("prefix", ""),
                            min_length=cfg_key.get("min_length", 1),
                            max_length=cfg_key.get("max_length", 100),
                            description=cfg_key.get("description", "")
                        ))
        except Exception as e:
            print(f"规则加载失败: {e}")

    def _check(self, rules: List[SNRule], sn: str, label: str) -> Tuple[bool, str]:
        sn = sn.strip()
        if not sn:
            return (False, 'SN为空')
        if not rules:
            return (True, f"{label}规则未设置, 自动通过")
        for r in rules:
            ok, msg = r.validate(sn)
            if ok:
                return (True, f"{label}通过: {r.description}")
        return (False, f"{label}规则不匹配")

    def validate_pcba(self, sn: str) -> Tuple[bool, str]:
        return self._check(self.pcba_rules, sn, "PCBA")

    def validate_shell(self, sn: str) -> Tuple[bool, str]:
        return self._check(self.shell_rules, sn, "外壳")

    def pcba_rules_desc(self) -> List[str]:
        if self.pcba_rules:
            return [r.description for r in self.pcba_rules]
        return ["未设置规则, 不校验"]

    def shell_rules_desc(self) -> List[str]:
        if self.shell_rules:
            return [r.description for r in self.shell_rules]
        return ["未设置规则, 不校验"]


class VoiceEngine:

    def __init__(self, config_path: Optional[str] = None):
        self.enabled = True
        self.prompts = {
            "scan_pcba": "请扫版码",
            "scan_shell": "请扫壳码",
            "binding": "绑定",
            "violation": "违规",
            "success": "绑定成功"
        }
        if config_path and os.path.exists(config_path):
            try:
                vc = json.load(open(config_path, "r", encoding="utf-8")).get("voice", {})
                self.enabled = vc.get("enabled", True)
                self.prompts.update(vc.get("prompts", {}))
            except Exception:
                pass

    def _speak(self, text: str):
        if not self.enabled or not text:
            return
        try:
            safe = text.replace("'", "''")
            subprocess.Popen(
                ["powershell", "-NoProfile",
                 f"Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('{safe}')"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0
            )
        except Exception:
            pass

    def speak(self, text: str):
        self._speak(text)

    def say(self, key: str):
        if key in self.prompts:
            self._speak(self.prompts[key])


class BindingStore:

    def __init__(self):
        self.db_path = os.path.join(app_root(), "binding_records.db")
        with sqlite3.connect(self.db_path) as c:
            c.execute("""CREATE TABLE IF NOT EXISTS bindings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pcba_sn TEXT NOT NULL, shell_sn TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                created_date TEXT DEFAULT (date('now')))""")
            c.execute("CREATE INDEX IF NOT EXISTS idx_bd_pcba ON bindings(pcba_sn)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_bd_shell ON bindings(shell_sn)")

    def save(self, pcba_sn: str, shell_sn: str) -> dict:
        with sqlite3.connect(self.db_path) as c:
            c.execute("INSERT INTO bindings (pcba_sn, shell_sn) VALUES (?, ?)",
                      (pcba_sn, shell_sn))
            return {"id": c.lastrowid, "pcba": pcba_sn, "shell": shell_sn}

    def exists_pcba(self, sn: str) -> bool:
        with sqlite3.connect(self.db_path) as c:
            c.execute("SELECT COUNT(*) FROM bindings WHERE pcba_sn=?", (sn.strip(),))
            return c.fetchone()[0] > 0

    def exists_shell(self, sn: str) -> bool:
        with sqlite3.connect(self.db_path) as c:
            c.execute("SELECT COUNT(*) FROM bindings WHERE shell_sn=?", (sn.strip(),))
            return c.fetchone()[0] > 0

    def today_count(self) -> int:
        with sqlite3.connect(self.db_path) as c:
            c.execute("SELECT COUNT(*) FROM bindings WHERE created_date=date('now')")
            return c.fetchone()[0]

    def all_records(self) -> List[Tuple]:
        with sqlite3.connect(self.db_path) as c:
            c.execute("SELECT pcba_sn, shell_sn, created_at FROM bindings ORDER BY id DESC")
            return c.fetchall()

    def export_csv(self) -> str:
        path = os.path.join(app_root(), "binding_records.csv")
        with open(path, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow(["PCBA码", "外壳码", "时间"])
            for r in reversed(self.all_records()):
                w.writerow(r)
        return path

    def clear_all(self):
        with sqlite3.connect(self.db_path) as c:
            c.execute("DELETE FROM bindings")

    def delete_by_pcba_shell(self, pcba_sn: str, shell_sn: str):
        with sqlite3.connect(self.db_path) as c:
            c.execute("DELETE FROM bindings WHERE pcba_sn=? AND shell_sn=?",
                      (pcba_sn, shell_sn))


class AppState(Enum):
    IDLE = 0
    BINDING = 1
    BOUND = 2
    VIOLATION = 3


STATE_TEXT = {
    AppState.IDLE: "等待扫码",
    AppState.BINDING: "绑定中...",
    AppState.BOUND: "✅ 绑定成功",
    AppState.VIOLATION: "❌ 违规"
}


class App:

    def __init__(self):
        self.root = tk.Tk()
        self.root.title("QR码绑定系统 - PCBA主板与外壳绑定")
        self.root.geometry("780x620")
        self.root.minsize(650, 500)
        self.root.configure(bg="#f0f2f5")
        self.cfg = self._load_cfg()
        self.validator = SNValidator(CONFIG_FILE)
        self.voice = VoiceEngine(CONFIG_FILE)
        self.store = BindingStore()
        self.state = AppState.IDLE
        self.pcba_sn = ""
        self.shell_sn = ""
        self.total_ok = 0
        self.total_bad = 0
        self.scan_var = tk.StringVar()
        self.voice_q = queue.Queue()
        self._voice_worker_running = True
        self._start_voice()
        self._scan_timer = None
        self._last_scan_len = 0
        now_ms = int(datetime.datetime.now().timestamp() * 1000)
        self._sim_pcba_counter = now_ms % 10000000
        self._sim_shell_counter = now_ms % 1000000000
        self._build_ui()
        self._update_ui()
        threading.Thread(target=self._sync_local_history_to_mes, daemon=True).start()
        self.root.after(300, lambda: self.voice.say("scan_pcba"))
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    def _load_cfg(self) -> dict:
        d = {
            "mes_api_base": "http://192.168.6.155:8080/api",
            "binding_rules": {
                "prevent_duplicate_pcba": True,
                "prevent_duplicate_shell": True,
                "auto_bind": True
            }
        }
        if os.path.exists(CONFIG_FILE):
            try:
                loaded = json.load(open(CONFIG_FILE, "r", encoding="utf-8"))
                for k in d:
                    if k in loaded:
                        if isinstance(d[k], dict) and isinstance(loaded[k], dict):
                            d[k].update(loaded[k])
                        else:
                            d[k] = loaded[k]
            except Exception:
                pass
        return d

    def _build_ui(self):
        tk.Label(self.root, text="🔗 QR码绑定系统",
                 font=('微软雅黑', 18, 'bold'), fg="#1a1a2e",
                 bg="#f0f2f5").pack(anchor="w", padx=12, pady=(10, 0))
        nb = ttk.Notebook(self.root)
        nb.pack(fill=tk.BOTH, expand=True, padx=12, pady=10)
        self.tab_bind = tk.Frame(nb, bg="#f0f2f5")
        nb.add(self.tab_bind, text="📋 绑定")
        self._build_bind_tab()
        self.tab_records = tk.Frame(nb, bg="#f0f2f5")
        nb.add(self.tab_records, text="📐 记录")
        self._build_records_tab()
        bar = tk.Frame(self.root, bg="#dfe6e9", height=24, relief=tk.SUNKEN, bd=1)
        bar.pack(fill=tk.X, pady=(0, 0))
        self.footer = tk.Label(bar, text="就绪 | 绑定: 0  违规: 0",
                               font=('微软雅黑', 9), fg="#636e72",
                               bg="#dfe6e9", anchor="w", padx=8)
        self.footer.pack(fill=tk.X)
        self.root.after(200, lambda: self.scan_text.focus_set())

    def _build_bind_tab(self):
        main = self.tab_bind
        tk.Label(main, text="PCBA主板 ↔ 外壳  |  先扫版码, 后扫壳码, 自动绑定",
                 font=('微软雅黑', 10), fg="#636e72",
                 bg="#f0f2f5").pack(anchor="w", pady=(0, 6))
        card = tk.Frame(main, bg="white", relief=tk.GROOVE, bd=1)
        card.pack(fill=tk.X, pady=(0, 6))
        row1 = tk.Frame(card, bg="white")
        row1.pack(fill=tk.X, padx=14, pady=(10, 4))
        tk.Label(row1, text="版码:", font=('微软雅黑', 11, 'bold'), fg="#e17055",
                 bg="white", width=5, anchor="w").pack(side=tk.LEFT)
        self.pcba_var = tk.StringVar()
        self.pcba_entry = tk.Entry(row1, textvariable=self.pcba_var,
                                   font=('Consolas', 14), bd=1,
                                   relief=tk.SUNKEN, bg="#fff3f0",
                                   state="readonly", readonlybackground="#fff3f0")
        self.pcba_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, ipady=4)
        self.pcba_icon = tk.Label(row1, text="⬚", font=('微软雅黑', 14), bg="white")
        self.pcba_icon.pack(side=tk.LEFT, padx=(6, 0))
        row2 = tk.Frame(card, bg="white")
        row2.pack(fill=tk.X, padx=14, pady=(4, 10))
        tk.Label(row2, text="壳码:", font=('微软雅黑', 11, 'bold'), fg="#0984e3",
                 bg="white", width=5, anchor="w").pack(side=tk.LEFT)
        self.shell_var = tk.StringVar()
        self.shell_entry = tk.Entry(row2, textvariable=self.shell_var,
                                    font=('Consolas', 14), bd=1,
                                    relief=tk.SUNKEN, bg="#f0f8ff",
                                    state="readonly", readonlybackground="#f0f8ff")
        self.shell_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, ipady=4)
        self.shell_icon = tk.Label(row2, text="⬚", font=('微软雅黑', 14), bg="white")
        self.shell_icon.pack(side=tk.LEFT, padx=(6, 0))
        self.scan_text = tk.Text(main, font=('Consolas', 13), height=1, bd=2,
                                 relief=tk.SUNKEN, bg="#fff8e1")
        self.scan_text.pack(fill=tk.X, ipady=3, pady=(0, 6))
        self.scan_text.bind("<KeyPress>", self._on_scan_key)
        self.scan_text.bind("<Return>", self._on_scan)
        self.root.bind("<Button-1>", self._refocus_scan, add="+")
        self._scan_timer = None
        btn_row = tk.Frame(main, bg="#f0f2f5")
        btn_row.pack(fill=tk.X, pady=(0, 6))
        self.bind_btn = tk.Button(btn_row, text="✅ 绑定",
                                  font=('微软雅黑', 11, 'bold'), bg="#00b894",
                                  fg="white", bd=0, cursor="hand2",
                                  command=self._do_bind,
                                  activebackground="#00a381",
                                  state=tk.DISABLED, padx=18, pady=4)
        self.bind_btn.pack(side=tk.LEFT, padx=(0, 6))
        self.reset_btn = tk.Button(btn_row, text="🔄 重置",
                                   font=('微软雅黑', 10), bg="#dfe6e9",
                                   fg="#2d3436", bd=0, cursor="hand2",
                                   command=self._do_reset, padx=14, pady=4)
        self.reset_btn.pack(side=tk.LEFT, padx=(0, 6))
        self.rule_btn = tk.Button(btn_row, text="✎ 规则",
                                  font=('微软雅黑', 10), bg="#74b9ff",
                                  fg="white", bd=0, cursor="hand2",
                                  command=self._show_rules, padx=14, pady=4)
        self.rule_btn.pack(side=tk.LEFT, padx=(0, 6))
        self.test_btn = tk.Button(btn_row, text="🔍 测试规则",
                                  font=('微软雅黑', 10), bg="#a29bfe",
                                  fg="white", bd=0, cursor="hand2",
                                  command=self._show_test_rules, padx=14, pady=4)
        self.test_btn.pack(side=tk.LEFT, padx=(0, 6))
        self.sim_pcba_btn = tk.Button(
            btn_row, text="模拟 PCBA 扫码", font=('微软雅黑', 10),
            bg="#fdcb6e", fg="#2d3436", bd=0, cursor="hand2",
            command=self._simulate_pcba_scan, padx=12, pady=4)
        self.sim_pcba_btn.pack(side=tk.LEFT, padx=(0, 6))
        self.sim_shell_btn = tk.Button(
            btn_row, text="模拟外壳扫码", font=('微软雅黑', 10),
            bg="#55efc4", fg="#2d3436", bd=0, cursor="hand2",
            command=self._simulate_shell_scan, padx=12, pady=4)
        self.sim_shell_btn.pack(side=tk.LEFT, padx=(0, 6))
        self.status_label = tk.Label(btn_row, text="等待扫码...",
                                     font=('微软雅黑', 10), fg="#0984e3",
                                     bg="#f0f2f5")
        self.status_label.pack(side=tk.RIGHT, padx=(0, 4))
        rules_info = self._rules_summary()
        tk.Label(main, text=rules_info, font=('微软雅黑', 9), fg="#999",
                 bg="#f0f2f5", anchor="w").pack(fill=tk.X, pady=(0, 4))
        log_card = tk.Frame(main, bg="white", relief=tk.GROOVE, bd=1)
        log_card.pack(fill=tk.BOTH, expand=True)
        log_header = tk.Frame(log_card, bg="white")
        log_header.pack(fill=tk.X, padx=12, pady=(6, 2))
        tk.Label(log_header, text="📐 绑定日志",
                 font=('微软雅黑', 11, 'bold'), fg="#1a1a2e",
                 bg="white").pack(side=tk.LEFT)
        tk.Button(log_header, text="清空", font=('微软雅黑', 9), bg="#dfe6e9",
                  fg="#555", bd=0, command=self._clear_log,
                  padx=6, pady=0, cursor="hand2").pack(side=tk.RIGHT)
        self.log = scrolledtext.ScrolledText(log_card, font=('Consolas', 10),
                                             bg="#1a1a2e", fg="#dfe6e9",
                                             height=8, padx=8, pady=6,
                                             state=tk.DISABLED, wrap=tk.WORD,
                                             relief=tk.FLAT)
        self.log.pack(fill=tk.BOTH, expand=True, padx=12, pady=(0, 8))

    def _build_records_tab(self):
        main = self.tab_records
        stats = tk.Frame(main, bg="#f0f2f5")
        stats.pack(fill=tk.X, pady=(0, 6))
        self.stat_today = tk.Label(stats, text="今日: 0",
                                   font=('微软雅黑', 12, 'bold'), fg="#00b894",
                                   bg="#dfe6e9", padx=20, pady=8)
        self.stat_today.pack(side=tk.LEFT, padx=(0, 10))
        self.stat_total = tk.Label(stats, text="总计: 0",
                                   font=('微软雅黑', 12), fg="#0984e3",
                                   bg="#dfe6e9", padx=20, pady=8)
        self.stat_total.pack(side=tk.LEFT, padx=(0, 10))
        tk.Button(stats, text="📛 导出CSV", font=('微软雅黑', 10), bg="#74b9ff",
                  fg="white", bd=0, cursor="hand2",
                  command=self._export_csv, padx=14, pady=4).pack(side=tk.LEFT)
        tk.Button(stats, text="🔄 刷新", font=('微软雅黑', 10), bg="#dfe6e9",
                  fg="#2d3436", bd=0, cursor="hand2",
                  command=self._refresh_records, padx=14, pady=4).pack(side=tk.LEFT)
        tk.Button(stats, text="🗑️ 清空记录", font=('微软雅黑', 10), bg="#ff7675",
                  fg="white", bd=0, cursor="hand2",
                  command=self._clear_records, padx=14, pady=4).pack(side=tk.LEFT)
        tree_frame = tk.Frame(main)
        tree_frame.pack(fill=tk.BOTH, expand=True)
        cols = ('pcba', 'shell', 'time')
        self.records_tree = ttk.Treeview(tree_frame, columns=cols,
                                         show="headings", height=20)
        self.records_tree.heading("pcba", text="PCBA码")
        self.records_tree.heading("shell", text="外壳码")
        self.records_tree.heading("time", text="绑定时间")
        self.records_tree.column("pcba", width=200)
        self.records_tree.column("shell", width=200)
        self.records_tree.column("time", width=180)
        self.records_tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar = tk.Scrollbar(tree_frame, orient=tk.VERTICAL,
                                 command=self.records_tree.yview)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        self.records_tree.config(yscrollcommand=scrollbar.set)
        btn_row = tk.Frame(main, bg="#f0f2f5")
        btn_row.pack(fill=tk.X, pady=(6, 0))
        tk.Button(btn_row, text="🗑️ 删除选中", font=('微软雅黑', 10), bg="#ff7675",
                  fg="white", bd=0, cursor="hand2",
                  command=self._delete_selected_record,
                  padx=14, pady=4).pack(side=tk.LEFT, padx=(0, 6))
        self._refresh_records()

    def _refresh_records(self):
        """刷新记录列表"""
        today = self.store.today_count()
        all_records = self.store.all_records()
        total = len(all_records)
        self.stat_today.config(text=f"今日: {today}")
        self.stat_total.config(text=f"总计: {total}")
        for item in self.records_tree.get_children():
            self.records_tree.delete(item)
        for r in all_records:
            self.records_tree.insert("", tk.END, values=r)

    def _export_csv(self):
        """导出CSV"""
        path = self.store.export_csv()
        self._log("INFO", f"已导出: {path}")

    def _clear_records(self):
        """清空所有记录"""
        w = tk.Toplevel(self.root)
        w.title("确认清空")
        w.geometry("300x150")
        w.transient(self.root)
        w.grab_set()
        tk.Label(w, text="确定要清空所有绑定记录吗？\n此操作不可恢复！",
                 font=('微软雅黑', 11), fg="#d63031").pack(pady=20)

        def _do_clear():
            self.store.clear_all()
            self._refresh_records()
            self._log("INFO", "已清空所有记录")
            w.destroy()

        btn_row = tk.Frame(w)
        btn_row.pack(pady=10)
        tk.Button(btn_row, text="确认清空", font=('微软雅黑', 10, 'bold'),
                  command=_do_clear, bg="#d63031", fg="white", bd=0,
                  padx=16, pady=4).pack(side=tk.LEFT, padx=6)
        tk.Button(btn_row, text="取消", font=('微软雅黑', 10),
                  command=w.destroy, bg="#dfe6e9", bd=0,
                  padx=16, pady=4).pack(side=tk.LEFT, padx=6)

    def _delete_selected_record(self):
        """删除选中的记录"""
        selection = self.records_tree.selection()
        if not selection:
            return
        item = selection[0]
        values = self.records_tree.item(item, "values")
        pcba_sn = values[0]
        shell_sn = values[1]
        w = tk.Toplevel(self.root)
        w.title("确认删除")
        w.geometry("300x120")
        w.transient(self.root)
        w.grab_set()
        tk.Label(w, text=f"删除这条记录？\n{pcba_sn} → {shell_sn}",
                 font=('微软雅黑', 11), fg="#d63031").pack(pady=15)

        def _do_delete():
            self.store.delete_by_pcba_shell(pcba_sn, shell_sn)
            self._refresh_records()
            self._log("INFO", f"已删除: {pcba_sn} → {shell_sn}")
            w.destroy()

        btn_row = tk.Frame(w)
        btn_row.pack(pady=10)
        tk.Button(btn_row, text="确认删除", font=('微软雅黑', 10),
                  command=_do_delete, bg="#d63031", fg="white", bd=0,
                  padx=16, pady=4).pack(side=tk.LEFT, padx=6)
        tk.Button(btn_row, text="取消", font=('微软雅黑', 10),
                  command=w.destroy, bg="#dfe6e9", bd=0,
                  padx=16, pady=4).pack(side=tk.LEFT, padx=6)

    def _rules_summary(self) -> str:
        pcba = "有" if self.validator.pcba_rules else "无"
        shell = "有" if self.validator.shell_rules else "无"
        return f"💡 PCBA规则: {pcba}  |  外壳规则: {shell}  |  编辑 config.json 自定义规则"

    def _start_voice(self):
        def worker():
            while self._voice_worker_running:
                try:
                    text = self.voice_q.get(timeout=0.5)
                    if text:
                        self.voice.speak(text)
                except queue.Empty:
                    continue
                except Exception:
                    pass

        threading.Thread(target=worker, daemon=True).start()

    def _say(self, key: str):
        self.voice_q.put(self.voice.prompts.get(key, key))

    def _refocus_scan(self, event=None):
        """点击任意位置都回到扫码框"""
        try:
            self.scan_text.focus_set()
        except Exception:
            pass

    def _on_scan_key(self, event):
        """捕获按键，构建完整扫码内容"""
        if event.char and event.char.isprintable():
            if self._scan_timer:
                self.root.after_cancel(self._scan_timer)
            self._scan_timer = self.root.after(500, self._process_scan_buffer)

    def _process_scan_buffer(self):
        """处理缓冲区中的内容(从Text widget读取)"""
        self._scan_timer = None
        raw = self.scan_text.get("1.0", tk.END).strip()
        if raw and len(raw) >= 5:
            self.scan_text.delete("1.0", tk.END)
            self._process_scan(raw)

    def _on_scan(self, event):
        """扫码枪按Enter时触发(从Text widget读取)"""
        raw = self.scan_text.get("1.0", tk.END).strip()
        if raw and len(raw) >= 5:
            self.scan_text.delete("1.0", tk.END)
            self._process_scan(raw)

    def _process_scan(self, raw):
        """统一处理扫描输入"""
        self.scan_var.set(raw)
        self.root.after(1000, lambda: self.scan_var.set(""))
        if self.state == AppState.BINDING or self.state == AppState.BOUND:
            self._do_reset()
        if not self.pcba_sn:
            self._try_pcba(raw)
        elif not self.shell_sn:
            self._try_shell(raw)
        else:
            self._do_reset()
            self._try_pcba(raw)
        self.root.after(50, lambda: self.scan_text.focus_set())

    def _simulate_pcba_scan(self):
        """2D station simulation: station supplies and validates the barcode."""
        self._sim_pcba_counter = (self._sim_pcba_counter + 1) % 10000000
        suffix = str(self._sim_pcba_counter).zfill(7)
        value = f"5G{suffix}A"
        self._do_reset()
        self._log("INFO", f"模拟 PCBA 扫码生成: {value}")
        self._process_scan(value)

    def _simulate_shell_scan(self):
        """2D station simulation: use the exact shell barcode entered locally."""
        if not self.pcba_sn:
            self._log("INFO", "请先模拟或扫描 PCBA 条码")
            self._say("scan_pcba")
            return
        self._sim_shell_counter = (self._sim_shell_counter + 1) % 1000000000
        suffix = str(self._sim_shell_counter).zfill(9)
        value = f"NV18A{suffix}"
        self._log("INFO", f"模拟外壳扫码生成: {value}")
        self._process_scan(value)

    def _mes_post(self, path: str, payload: dict) -> dict:
        """Send exact station values to MES; MES does not validate format."""
        base = str(self.cfg.get("mes_api_base", "http://192.168.6.155:8080/api")).rstrip("/")
        request = urllib.request.Request(
            base + path,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST")
        try:
            with urllib.request.urlopen(request, timeout=8) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            try:
                body = json.loads(error.read().decode("utf-8"))
            except Exception:
                body = {}
            raise RuntimeError(body.get("code") or body.get("error", {}).get("message") or f"MES HTTP {error.code}")

    def _mes_guard(self, sn: str, phase: str):
        return self._mes_post("/pda/events", {
            "from": "qrbinding_agent", "to": "mes_server",
            "type": "SCAN_GUARD_CHECK", "stationCode": "manu_shellbinding",
            "priority": "info", "payload": {
                "sn": sn, "bindingPhase": phase, "result": "CLEAR",
                "operator": "QR_BINDING_2D"
            }
        })

    def _sync_local_history_to_mes(self):
        """Idempotently back up every historical local binding into MES."""
        synced = 0
        for pcba_sn, shell_sn, _created_at in reversed(self.store.all_records()):
            try:
                self._mes_post("/station/shell-bindings/commit", {
                    "pcbaSn": pcba_sn, "shellSn": shell_sn,
                    "stationCode": "manu_shellbinding",
                    "operator": "QR_BINDING_2D_HISTORY_SYNC"
                })
                synced += 1
            except Exception:
                continue
        if synced:
            self.root.after(0, lambda: self._log(
                "INFO", f"MES 历史备份完成: {synced} 条"))

    def _try_pcba(self, sn: str):
        ok, msg = self.validator.validate_pcba(sn)
        if not ok:
            # Test-day QR Binding rule: format is informational only. MES still
            # blocks duplicate and confirmed-NG identities.
            self._log("WARN", f"PCBA format flagged (allowed): {sn} | {msg}")
        if self.cfg.get("binding_rules", {}).get("prevent_duplicate_pcba", True):
            if self.store.exists_pcba(sn):
                self._duplicate(sn, "PCBA码")
                return
        try:
            self._mes_guard(sn, "board")
        except Exception as error:
            self._violation(sn, str(error))
            return
        self.pcba_sn = sn
        self.pcba_var.set(sn)
        self.pcba_icon.config(text="✅")
        self.pcba_entry.config(readonlybackground="#e6ffe6")
        self._log("INFO", f"版码: {sn} ✅")
        self._say("scan_shell")
        self._update_ui()

    def _try_shell(self, sn: str):
        ok, msg = self.validator.validate_shell(sn)
        if not ok:
            self._log("WARN", f"Shell format flagged (allowed): {sn} | {msg}")
        if self.cfg.get("binding_rules", {}).get("prevent_duplicate_shell", True):
            if self.store.exists_shell(sn):
                self._duplicate(sn, "外壳码")
                return
        try:
            self._mes_guard(sn, "shell")
        except Exception as error:
            self._violation(sn, str(error))
            return
        self.shell_sn = sn
        self.shell_var.set(sn)
        self.shell_icon.config(text="✅")
        self.shell_entry.config(readonlybackground="#e6ffe6")
        self._log("INFO", f"壳码: {sn} ✅")
        self._update_ui()
        if self.cfg.get("binding_rules", {}).get("auto_bind", True):
            self.root.after(300, self._do_bind)

    def _violation(self, sn: str, detail: str = ''):
        self.state = AppState.VIOLATION
        self.total_bad += 1
        self._say("violation")
        msg = f"违规: {sn}  |  {detail}" if detail else f"违规: {sn}"
        self._log("ERROR", msg)
        self._update_ui()
        self.root.after(2000, self._clear_violation)

    def _duplicate(self, sn: str, label: str = '码'):
        """重复扫描，不算违规"""
        self.state = AppState.VIOLATION
        self._say("violation")
        self._log("WARN", f"{label}重复: {sn}")
        self._update_ui()
        self.root.after(2000, self._clear_violation)

    def _clear_violation(self):
        if self.state == AppState.VIOLATION:
            self.state = AppState.IDLE
            self._update_ui()

    def _do_bind(self):
        if not self.pcba_sn or not self.shell_sn:
            return
        self.state = AppState.BINDING
        self._update_ui()
        try:
            self._mes_post("/station/shell-bindings/commit", {
                "pcbaSn": self.pcba_sn, "shellSn": self.shell_sn,
                "stationCode": "manu_shellbinding", "operator": "QR_BINDING_2D"
            })
            rec = self.store.save(self.pcba_sn, self.shell_sn)
            self._log("SUCCESS",
                      f"✅ 绑定成功 | 版码: {self.pcba_sn}  →  壳码: {self.shell_sn}")
            self._refresh_records()
        except Exception as e:
            self._log("ERROR", f"写入DB失败: {e}")
            self.state = AppState.IDLE
            self._update_ui()
            return

        self.total_ok += 1
        self.state = AppState.BOUND
        self.voice_q.put("绑码成功")
        self._update_ui()
        # Keep the binding pair and success state visible to the operator.
        self.root.after(5000, self._do_reset)

    def _do_reset(self):
        self.state = AppState.IDLE
        self.pcba_sn = ""
        self.shell_sn = ""
        self.pcba_var.set("")
        self.shell_var.set("")
        self.pcba_icon.config(text="⬚")
        self.shell_icon.config(text="⬚")
        self.pcba_entry.config(readonlybackground="#fff3f0")
        self.shell_entry.config(readonlybackground="#f0f8ff")
        self._update_ui()
        self.root.after(100, lambda: self.scan_text.focus_set())
        self._say("scan_pcba")

    def _update_ui(self):
        st = STATE_TEXT.get(self.state, "")
        colors = {
            AppState.IDLE: "#0984e3",
            AppState.BINDING: "#fdcb6e",
            AppState.BOUND: "#00b894",
            AppState.VIOLATION: "#d63031"
        }
        self.status_label.config(text=st, fg=colors.get(self.state, "#636e72"))
        can_bind = self.state == AppState.IDLE and self.pcba_sn and self.shell_sn
        self.bind_btn.config(
            state=tk.NORMAL if can_bind else tk.DISABLED,
            bg="#00b894" if can_bind else "#b2bec3"
        )
        self.footer.config(
            text=f"状态: {st} | 绑定: {self.total_ok} | 违规: {self.total_bad}")

    def _log(self, level: str, msg: str):
        colors = {'INFO': "#74b9ff", 'SUCCESS': "#00b894", 'ERROR': "#d63031"}
        prefix = {'INFO': " ℹ️", 'SUCCESS': " ✅", 'ERROR': " ❌"}
        ts = datetime.datetime.now().strftime("%H:%M:%S")
        line = f'[{ts}]{prefix.get(level, " ")}{msg}\n'
        self.log.config(state=tk.NORMAL)
        self.log.insert(tk.END, line)
        self.log.see(tk.END)
        self.log.config(state=tk.DISABLED)

    def _clear_log(self):
        self.log.config(state=tk.NORMAL)
        self.log.delete("1.0", tk.END)
        self.log.config(state=tk.DISABLED)

    def _test_input(self):
        pcba = self.pcba_sn.strip()
        shell = self.shell_sn.strip()
        if not pcba and not shell:
            self._log("INFO", "请先扫描PCBA或外壳码")
            return
        self.validator = SNValidator(CONFIG_FILE)
        results = []
        if pcba:
            ok, msg = self.validator.validate_pcba(pcba)
            results.append(f"PCBA: {ok}, {msg}")
        if shell:
            ok, msg = self.validator.validate_shell(shell)
            results.append(f"外壳: {ok}, {msg}")
        self._log("INFO", " | ".join(results))

    def _show_test_rules(self):
        """通用规则测试工具"""
        w = tk.Toplevel(self.root)
        w.title("规则测试工具")
        w.geometry("600x500")
        w.transient(self.root)
        tk.Label(w, text="🔍 正则规则测试工具",
                 font=('微软雅黑', 14, 'bold'), fg="#1a1a2e").pack(pady=10)
        f1 = tk.LabelFrame(w, text="PCBA规则测试",
                           font=('微软雅黑', 10), padx=10, pady=5)
        f1.pack(fill=tk.X, padx=10, pady=5)
        tk.Label(f1, text="正则:", font=('微软雅黑', 9)).pack(anchor="w")
        pcba_regex = tk.Entry(f1, font=('Consolas', 10))
        pcba_regex.pack(fill=tk.X, pady=2)
        pcba_regex.insert(0, "^5G\\d{7}[A-Z]$")
        tk.Label(f1, text="测试SN (逗号分隔):", font=('微软雅黑', 9)).pack(anchor="w")
        pcba_tests = tk.Entry(f1, font=('Consolas', 10))
        pcba_tests.pack(fill=tk.X, pady=2)
        pcba_tests.insert(0, "5G5608888A,5G560888,5G5608888AA")
        pcba_result = tk.Text(f1, font=('Consolas', 9), height=3, bg="#f8f9fa")
        pcba_result.pack(fill=tk.X, pady=5)
        f2 = tk.LabelFrame(w, text="外壳规则测试",
                           font=('微软雅黑', 10), padx=10, pady=5)
        f2.pack(fill=tk.X, padx=10, pady=5)
        tk.Label(f2, text="正则:", font=('微软雅黑', 9)).pack(anchor="w")
        shell_regex = tk.Entry(f2, font=('Consolas', 10))
        shell_regex.pack(fill=tk.X, pady=2)
        shell_regex.insert(0, "^NV18A[A-Z0-9]{9}$")
        tk.Label(f2, text="测试SN (逗号分隔):", font=('微软雅黑', 9)).pack(anchor="w")
        shell_tests = tk.Entry(f2, font=('Consolas', 10))
        shell_tests.pack(fill=tk.X, pady=2)
        shell_tests.insert(0, "NV18A2619K2371,NV18A2619K23,123456")
        shell_result = tk.Text(f2, font=('Consolas', 9), height=3, bg="#f8f9fa")
        shell_result.pack(fill=tk.X, pady=5)

        def test_regex(pattern, test_cases, result_text):
            result_text.delete("1.0", tk.END)
            if not pattern.strip():
                result_text.insert(tk.END, "请输入正则表达式\n")
                return
            try:
                regex = re.compile(pattern.strip())
                result_text.insert(tk.END, f"✅ 正则有效: {pattern}\n")
                result_text.insert(tk.END, "----------------------------------------\n")
                for sn in test_cases.split(","):
                    sn = sn.strip()
                    if not sn:
                        continue
                    match = bool(regex.match(sn))
                    icon = "✅" if match else "❌"
                    result_text.insert(tk.END, f"{icon} {sn}\n")
            except re.error as e:
                result_text.insert(tk.END, f"❌ 正则错误: {e}\n")

        def do_test_pcba():
            test_regex(pcba_regex.get(), pcba_tests.get(), pcba_result)

        def do_test_shell():
            test_regex(shell_regex.get(), shell_tests.get(), shell_result)

        btn_frame = tk.Frame(w)
        btn_frame.pack(pady=10)
        tk.Button(btn_frame, text="测试PCBA", font=('微软雅黑', 10),
                  command=do_test_pcba, bg="#00b894", fg="white",
                  padx=15).pack(side=tk.LEFT, padx=5)
        tk.Button(btn_frame, text="测试外壳", font=('微软雅黑', 10),
                  command=do_test_shell, bg="#0984e3", fg="white",
                  padx=15).pack(side=tk.LEFT, padx=5)
        tk.Button(btn_frame, text="关闭", font=('微软雅黑', 10),
                  command=w.destroy, bg="#dfe6e9",
                  padx=15).pack(side=tk.LEFT, padx=5)

    def _make_regex(self, total, prefix, suffix, middle_type, middle_custom):
        """根据可视化字段生成正则表达式"""
        if not total:
            return ""
        try:
            tot = int(total)
        except Exception:
            return ""

        prefix = prefix.strip()
        suffix = suffix.strip()
        middle_type = middle_type or "数字"

        if middle_type == "数字":
            mid_pat = "\\d"
        elif middle_type == "字母":
            mid_pat = "[A-Za-z]"
        elif middle_type == "字母数字":
            mid_pat = "[A-Za-z0-9]"
        elif middle_type == "指定字符":
            mc = middle_custom.strip()
            mid_pat = f"[{mc}]" if mc else "\\w"
        else:
            mid_pat = "\\w"

        fixed_len = len(prefix) + len(suffix)
        mid_count = tot - fixed_len
        if mid_count <= 0:
            return ""
        middle = f'{mid_pat}{"{" + str(mid_count) + "}"}'
        regex = f"^{re.escape(prefix)}{middle}{re.escape(suffix)}$"
        return regex

    def _build_rule_section(self, parent, title, color, existing_patterns):
        """构建一个规则的可视化编辑器 + 原始正则文本区"""
        frame = tk.LabelFrame(parent, text=title,
                              font=('微软雅黑', 10, 'bold'), fg=color,
                              padx=10, pady=6)
        builder = tk.Frame(frame)
        builder.pack(fill=tk.X, pady=(0, 6))
        tk.Label(builder, text="可视化配置（生成正则）",
                 font=('微软雅黑', 9), fg="#636e72").pack(anchor="w")
        row1 = tk.Frame(builder, bg=frame["bg"])
        row1.pack(fill=tk.X, pady=2)
        tk.Label(row1, text="总字符", font=('微软雅黑', 9), width=7,
                 anchor="w", bg=frame["bg"]).pack(side=tk.LEFT)
        e_total = tk.Entry(row1, font=('Consolas', 10), width=8)
        e_total.pack(side=tk.LEFT, padx=(0, 8))
        tk.Label(row1, text="开头", font=('微软雅黑', 9), width=5,
                 anchor="w", bg=frame["bg"]).pack(side=tk.LEFT)
        e_prefix = tk.Entry(row1, font=('Consolas', 10), width=10)
        e_prefix.pack(side=tk.LEFT, padx=(0, 8))
        tk.Label(row1, text="结尾:", font=('微软雅黑', 9), width=5,
                 anchor="w", bg=frame["bg"]).pack(side=tk.LEFT)
        e_suffix = tk.Entry(row1, font=('Consolas', 10), width=10)
        e_suffix.pack(side=tk.LEFT)
        row2 = tk.Frame(builder, bg=frame["bg"])
        row2.pack(fill=tk.X, pady=2)
        tk.Label(row2, text="中间:", font=('微软雅黑', 9), width=7,
                 anchor="w", bg=frame["bg"]).pack(side=tk.LEFT)
        mid_var = tk.StringVar(value="数字")
        om = ttk.Combobox(row2, textvariable=mid_var,
                          values=["数字", "字母", "字母数字", "指定字符"],
                          font=('微软雅黑', 9), width=10, state="readonly")
        om.pack(side=tk.LEFT, padx=(0, 6))
        e_custom = tk.Entry(row2, font=('Consolas', 9), width=12)
        e_custom.pack(side=tk.LEFT, padx=(0, 6))
        tk.Label(row2, text="指定字符如A-Z0-9", font=('微软雅黑', 8),
                 fg="#999", bg=frame["bg"]).pack(side=tk.LEFT)
        row3 = tk.Frame(builder, bg=frame["bg"])
        row3.pack(fill=tk.X, pady=2)
        tk.Label(row3, text="预览:", font=('微软雅黑', 9), width=7,
                 anchor="w", bg=frame["bg"]).pack(side=tk.LEFT)
        preview = tk.Label(row3, text="（请填写上方条件）",
                           font=('Consolas', 10, 'bold'), fg="#0984e3",
                           bg="#f0f8ff", anchor="w", padx=4)
        preview.pack(side=tk.LEFT, fill=tk.X, expand=True, ipady=2)

        def _update_preview(*args):
            r = self._make_regex(e_total.get(), e_prefix.get(), e_suffix.get(),
                                 mid_var.get(), e_custom.get())
            preview.config(text=r if r else "（请填写上方条件）")

        e_total.bind("<KeyRelease>", _update_preview)
        e_prefix.bind("<KeyRelease>", _update_preview)
        e_suffix.bind("<KeyRelease>", _update_preview)
        om.bind("<<ComboboxSelected>>", _update_preview)
        e_custom.bind("<KeyRelease>", _update_preview)

        def _add_to_list():
            r = self._make_regex(e_total.get(), e_prefix.get(), e_suffix.get(),
                                 mid_var.get(), e_custom.get())
            if r and r not in existing_patterns:
                existing_patterns.append(r)
                _refresh_list()
                _update_preview()

        tk.Button(row3, text="+ 添加规则", font=('微软雅黑', 9), bg="#00b894",
                  fg="white", bd=0, padx=8,
                  command=_add_to_list).pack(side=tk.RIGHT, padx=(4, 0))
        tk.Label(builder, text="已添加的规则（可直接编辑，删除即移除）",
                 font=('微软雅黑', 9), fg="#636e72").pack(anchor="w", pady=(4, 2))
        list_frame = tk.Frame(builder)
        list_frame.pack(fill=tk.X)
        listbox = tk.Listbox(list_frame, font=('Consolas', 10), height=3,
                             bg="white", selectmode=tk.EXTENDED)
        listbox.pack(side=tk.LEFT, fill=tk.X, expand=True)
        scroll = tk.Scrollbar(list_frame, orient=tk.VERTICAL,
                              command=listbox.yview)
        scroll.pack(side=tk.RIGHT, fill=tk.Y)
        listbox.config(yscrollcommand=scroll.set)

        def _refresh_list():
            listbox.delete(0, tk.END)
            for p in existing_patterns:
                listbox.insert(tk.END, p)

        _refresh_list()

        def _del_selected():
            sel = listbox.curselection()
            for i in reversed(sel):
                existing_patterns.pop(i)
            _refresh_list()

        tk.Button(list_frame, text="删除", font=('微软雅黑', 8), bg="#ff7675",
                  fg="white", bd=0, padx=6,
                  command=_del_selected).pack(pady=2)
        sep = tk.Frame(frame, bg="#dfe6e9", height=1)
        sep.pack(fill=tk.X, pady=6)
        tk.Label(frame, text="专家模式 - 直接写正则（每行一条，覆盖上方）",
                 font=('微软雅黑', 9), fg="#999").pack(anchor="w")
        raw_text = tk.Text(frame, font=('Consolas', 10), fg="#333", height=2,
                           bg="white", relief=tk.SOLID, bd=1, padx=6, pady=4)
        raw_text.pack(fill=tk.X)
        raw_text.insert(tk.END, "\n".join(existing_patterns))

        def _sync_to_raw(*args):
            current_raw = raw_text.get("1.0", tk.END).strip()
            for p in existing_patterns:
                if p not in current_raw:
                    current_raw += "\n" + p
            raw_text.delete("1.0", tk.END)
            raw_text.insert(tk.END, current_raw.strip())

        return (frame, existing_patterns, _refresh_list, raw_text)

    def _show_rules(self):
        w = tk.Toplevel(self.root)
        w.title("SN规则配置")
        w.geometry("680x620")
        w.transient(self.root)
        w.grab_set()
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                cfg = json.load(f)
        except Exception:
            cfg = {"sn_rules": {"pcba": {"patterns": []}, "shell": {"patterns": []}}}
        else:
            pcba_patterns = list(cfg.get("sn_rules", {}).get("pcba", {}).get("patterns", []))
            shell_patterns = list(cfg.get("sn_rules", {}).get("shell", {}).get("patterns", []))
            tk.Label(w, text="🔡 规则配置  |  上方可视化配置适合常规格式，右下专家模式可写任意正则",
                     font=('微软雅黑', 10), fg="#636e72").pack(anchor="w", padx=14, pady=(10, 4))
            v_scroll = tk.Scrollbar(w, orient=tk.VERTICAL)
            v_scroll.pack(side=tk.RIGHT, fill=tk.Y, padx=(0, 10), pady=(0, 10))
            canvas = tk.Canvas(w, bg="#f0f2f5", highlightthickness=0,
                               yscrollcommand=v_scroll.set)
            canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True,
                        padx=(10, 0), pady=(0, 10))
            v_scroll.config(command=canvas.yview)
            scrollable = tk.Frame(canvas, bg="#f0f2f5")
            scroll_win = canvas.create_window((0, 0), window=scrollable, anchor="nw")

            def _on_frame_configure(event):
                bbox = canvas.bbox("all")
                if bbox:
                    canvas.config(scrollregion=bbox)
                    cw = canvas.winfo_width()
                    if cw > 1:
                        canvas.itemconfig(scroll_win, width=cw)

            scrollable.bind("<Configure>", _on_frame_configure)

            def _on_mousewheel(event):
                canvas.yview_scroll(-1 * (event.delta // 120), "units")

            canvas.bind("<MouseWheel>", _on_mousewheel)
            pcba_frame, pcba_list, pcba_refresh, pcba_raw_text = \
                self._build_rule_section(scrollable, "📋 PCBA版规则", "#e17055", pcba_patterns)
            pcba_frame.pack(fill=tk.X, padx=6, pady=(0, 8))
            shell_frame, shell_list, shell_refresh, shell_raw_text = \
                self._build_rule_section(scrollable, "📋 外壳规则", "#0984e3", shell_patterns)
            shell_frame.pack(fill=tk.X, padx=6, pady=(0, 8))

            def _on_mousewheel(event):
                canvas.yview_scroll(-1 * (event.delta // 120), "units")

            canvas.bind_all("<MouseWheel>", _on_mousewheel)

            def _do_save():
                pcba_text_raw = pcba_raw_text.get("1.0", tk.END).strip()
                shell_text_raw = shell_raw_text.get("1.0", tk.END).strip()
                pcba_final = [l.strip() for l in pcba_text_raw.split("\n") if l.strip()]
                shell_final = [l.strip() for l in shell_text_raw.split("\n") if l.strip()]
                try:
                    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                        cfg = json.load(f)
                except Exception:
                    cfg = {}
                if "sn_rules" not in cfg:
                    cfg["sn_rules"] = {"pcba": {}, "shell": {}}
                cfg["sn_rules"]["pcba"]["patterns"] = pcba_final
                cfg["sn_rules"]["shell"]["patterns"] = shell_final
                with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                    json.dump(cfg, f, ensure_ascii=False, indent=2)
                self.validator = SNValidator(CONFIG_FILE)
                self._log("INFO", f"规则已保存: PCBA {len(pcba_final)}条, 外壳 {len(shell_final)}条")
                canvas.unbind_all("<MouseWheel>")
                w.destroy()

            btn_row = tk.Frame(w, bg="#f0f2f5")
            btn_row.pack(pady=(0, 8))
            tk.Button(btn_row, text="💾 保存", font=('微软雅黑', 11, 'bold'),
                      command=_do_save, padx=20, pady=4, bg="#00b894",
                      fg="white", bd=0, cursor="hand2").pack(side=tk.LEFT, padx=6)
            tk.Button(btn_row, text="取消", font=('微软雅黑', 10),
                      command=lambda: (canvas.unbind_all("<MouseWheel>"), w.destroy()),
                      padx=16, pady=4, bg="#dfe6e9", bd=0,
                      cursor="hand2").pack(side=tk.LEFT, padx=6)

    def _on_close(self):
        self._voice_worker_running = False
        self.root.destroy()

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    App().run()
