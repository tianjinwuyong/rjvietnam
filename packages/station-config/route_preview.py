import json
import tkinter as tk
from pathlib import Path
from tkinter import ttk


CONFIG_PATH = Path(__file__).with_name("stations.json")


class RoutePreview:
    def __init__(self, root):
        self.root = root
        self.config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        self.policies = {item["code"]: item for item in self.config["ngPolicies"]}
        root.title("MES 路由配置测试台 · stations.json")
        root.geometry("1480x860")
        root.configure(bg="#0b1220")
        self._build()

    def _build(self):
        header = tk.Frame(self.root, bg="#111827")
        header.pack(fill="x")
        tk.Label(header, text="MES 路由配置测试台", bg="#111827", fg="white",
                 font=("Microsoft YaHei", 20, "bold")).pack(side="left", padx=20, pady=14)
        meta = self.config["configuration"]
        tk.Label(header, text=f'{meta["revision"]}  ·  {meta["status"]}  ·  来源: {meta["source"]}',
                 bg="#111827", fg="#67e8f9", font=("Microsoft YaHei", 10, "bold")).pack(side="right", padx=20)

        note = tk.Label(self.root,
                        text="只读预览：PASS 按主路线前进；NG 按策略进入依赖路线；偏离路线由 MES 阻断并报警。",
                        bg="#422006", fg="#fde68a", anchor="w", padx=16, pady=9,
                        font=("Microsoft YaHei", 10, "bold"))
        note.pack(fill="x", padx=14, pady=(10, 4))

        book = ttk.Notebook(self.root)
        book.pack(fill="both", expand=True, padx=14, pady=10)
        for line in self.config["lines"]:
            frame = tk.Frame(book, bg="#0f172a")
            book.add(frame, text=line["name"]["zh-CN"])
            columns = ("seq", "code", "name", "capability", "gate", "pass", "ng", "important")
            tree = ttk.Treeview(frame, columns=columns, show="headings")
            headings = ("顺序", "工站编码", "工站", "能力", "MES 门禁", "PASS 下一站", "NG 策略", "关键规则")
            widths = (60, 180, 130, 190, 110, 190, 230, 360)
            for col, title, width in zip(columns, headings, widths):
                tree.heading(col, text=title)
                tree.column(col, width=width, anchor="center" if col != "important" else "w")
            for station in line["stations"]:
                rules = station.get("rules", {})
                policy = self.policies[station["onNg"]]
                action = policy["action"]
                important = "; ".join([f"{k}={v}" for k, v in {**rules, **action}.items()
                                       if k in ("blockOnNg", "retestLimit", "route", "returnStation",
                                                "unitsPerCase", "warehouseBlockedUntilRelease")])
                tree.insert("", "end", values=(station["sequence"], station["code"], station["name"]["zh-CN"],
                    station["capability"], station["gate"], station["onPass"] or "质量放行/结束",
                    station["onNg"], important))
            tree.pack(side="left", fill="both", expand=True)
            scroll = ttk.Scrollbar(frame, command=tree.yview)
            scroll.pack(side="right", fill="y")
            tree.configure(yscrollcommand=scroll.set)


if __name__ == "__main__":
    app_root = tk.Tk()
    RoutePreview(app_root)
    app_root.mainloop()
