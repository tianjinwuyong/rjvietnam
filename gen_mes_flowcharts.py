#!/usr/bin/env python3
"""Generate professional MES flow chart PNGs from xlsx data."""
import os

OUT_DIR = os.path.join(os.path.dirname(__file__), "apps/web/public/mes-flowcharts")
os.makedirs(OUT_DIR, exist_ok=True)

# ─────────────────────────────────────────────────────────
# Sheet 1: 自动线工艺流程  (horizontal flow)
# ─────────────────────────────────────────────────────────
FLOW1 = [
    "Vendor\n来料", "Receiving\n收货", "Storage\n存储", "IQC\n来料检验",
    "Material\nPrep\n备料", "PCB Open\n开封",
    "AI\n自动插件", "Placement\n贴片", "Reflow\n回流焊",
    "SMT-AOI", "VI\n目检", "PCBA\nLoading\n上料",
    "Repair\n维修", "Odd-Form\n异型件", "Wave\nSoldering\n波峰焊",
    "WS-AOI", "ICT\n自动测试", "FCT\n功能测试",
    "Dispensing\n点胶", "Glue Cure\n固化", "Depaneling\n分板",
    "Heat Sink\n螺丝", "MOS\n成型", "Temp\nStorage\n暂存",
    "AC Cable\nAssembly", "DC Cable\nAssembly", "Ultrasonic\n超声",
    "ATE1\n加载测试", "Burn-in\n老化", "PSU\nDownload", "Hi-pot\n耐压",
    "ATE2\n测试", "Enclosure\nLabeling", "Packing\nScan", "PE Bagging\n包装", "OQC\n测试",
]

FLOW1_PASS = ["PASS ✓", "OK ✓"]
FLOW1_NG = ["NG ✗", "FAIL ✗"]

# ─────────────────────────────────────────────────────────
# Sheet 2: PO流程  (vertical flowchart)
# ─────────────────────────────────────────────────────────
PO_STEPS = [
    ("客户PO", "Customer PO Received", "#4F46E5"),
    ("ERP: 创建生产工单", "Create Production Work Order", "#4F46E5"),
    ("ERP: 运行MRP", "Run MRP → Material Requirements", "#4F46E5"),
    ("ERP: 下达采购订单", "Issue Purchase Orders to Suppliers", "#4F46E5"),
    ("供应商送货", "Supplier Delivery", "#059669"),
    ("核对单据", "Document Verification", "#059669"),
    ("IQC检验", "Incoming Quality Control", "#D97706"),
    ("MES: 创建IQC待检任务", "Create IQC Inspection Task in MES", "#D97706"),
    ("合格料待用", "Qualified Material → Storage", "#059669"),
    ("不合格处理", "Non-conforming → Hold/Return/Scrap", "#DC2626"),
    ("按工单发料 (MES)", "Issue Material by Work Order (MES)", "#7C3AED"),
    ("物料上线 (MES扫码)", "Material Online (MES Scan)", "#7C3AED"),
    ("各工序生产与MES报工", "Production & MES Reporting", "#0369A1"),
    ("包装 (绑定成品SN)", "Packing (Bind FG SN)", "#0369A1"),
    ("送检 OQC", "Send for OQC Inspection", "#0369A1"),
    ("MES/ERP: 工单关闭", "Work Order Closed", "#059669"),
    ("成品入库", "Finished Goods to Warehouse", "#059669"),
]

PO_DISPOSITIONS = [
    "特采 (Use-as-is)", "退货 (Return to Supplier)", "返工 (Rework)", "报废 (Scrap)"
]

# ─────────────────────────────────────────────────────────
# Sheet 3: 追溯要求  (decision tree, SN query)
# ─────────────────────────────────────────────────────────
TRACE_QUERY = [
    "输入SN", "MES查询", "获取订单/Po信息",
    "获取生产时间线", "获取测试数据", "获取物料批次",
    "获取OQC数据", "获取维修数据",
]

TRACE_ANALYSIS = [
    ("是否有FAIL记录?", "分析OQC历史", "查看Fail原因", "定位维修环节"),
    ("分析物料批次", "定位特定物料", "追溯来料检验报告", ""),
    ("分析测试数据", "定位失效测试站", "获取详细数据记录", ""),
    ("分析生产时间线", "定位可疑工序", "获取人员/参数/设备记录", ""),
]

# ─────────────────────────────────────────────────────────
# Sheet 4: 复测要求  (ICT/FCT retest flow)
# ─────────────────────────────────────────────────────────
RETEST_FLOW = [
    ("ICT / FCT 测试", "FAIL", "第1次复测", "PASS?", "第2次复测", "PASS?", "返修", "OK"),
    [None, None, None, "Fail → 返修", None, "Fail → 报废", None, None],
]

# ─────────────────────────────────────────────────────────
# Sheet 5: 时效管控  (PCB time control)
# ─────────────────────────────────────────────────────────
TIME_FLOW = [
    ("PCB开封", "→ (≤168H?) →", "MES插件", "→ 白胶固化", "→ 分板", "→ 组装", "→ 暂存"),
    [None, "No → 烘烤2H → 投入插件", None, "≥4H", None, "≥4H", None],
]

# ─────────────────────────────────────────────────────────
# Sheet 6: MES岗位  (station flow)
# ─────────────────────────────────────────────────────────
MES_STATIONS = [
    "AI1", "AI2", "贴片1", "贴片2", "SMT-AOI",
    "PCBA上料", "WS-AOI", "ICT", "FCT", "分板", "PCBA Link",
    "ATE1", "Ultrasonic", "外观/限高", "BI Loading", "Burn-in",
    "Hi-pot", "ATE2", "Enclosure Label", "Packing Scan", "OQC",
]
MES_SUBFLOWS = {
    "AI1/AI2": ["Odd-Form Insertion"],
    "SMT-AOI": ["VI + AOI inspection"],
    "WS-AOI": ["Wave solder AOI"],
    "ICT": ["Automatic test"],
    "FCT": ["Functional test"],
    "ATE1/ATE2": ["Loading test", "Burn-in test"],
    "Hi-pot": ["Stethoscope test"],
    "OQC": ["Final quality check"],
}

# ─────────────────────────────────────────────────────────
# Drawing helpers
# ─────────────────────────────────────────────────────────
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.patches as mpatches
    from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
    import matplotlib.patheffects as pe
    HAS_MPL = True
except ImportError:
    HAS_MPL = False
    print("matplotlib not available, will use PIL fallback")

def draw_rounded_box(ax, x, y, w, h, text, color="#1E40AF", text_color="white",
                     fontsize=7, radius=0.4):
    box = FancyBboxPatch((x - w/2, y - h/2), w, h,
                          boxstyle=f"round,pad=0.05,rounding_size={radius}",
                          facecolor=color, edgecolor="white", linewidth=0.8, zorder=3)
    ax.add_patch(box)
    ax.text(x, y, text, ha="center", va="center", fontsize=fontsize,
            color=text_color, fontweight="bold", zorder=4,
            multialignment="center",
            fontfamily=["DejaVu Sans", "WenQuanYi Micro Hei", "SimHei", "Arial"])

def draw_diamond(ax, x, y, w, h, text, color="#D97706", text_color="white", fontsize=7):
    diamond = mpatches.RegularPolygon((x, y), numVertices=4, radius=w/1.4,
                                       orientation=0.785, facecolor=color,
                                       edgecolor="white", linewidth=0.8, zorder=3)
    ax.add_patch(diamond)
    ax.text(x, y, text, ha="center", va="center", fontsize=fontsize,
            color=text_color, fontweight="bold", zorder=4,
            multialignment="center", fontfamily=["DejaVu Sans", "WenQuanYi Micro Hei", "SimHei", "Arial"])

def draw_arrow(ax, x1, y1, x2, y2, color="#94A3B8"):
    ax.annotate("", xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(arrowstyle="-|>", color=color, lw=1.2),
                zorder=2)

def draw_arrow_curved(ax, x1, y1, x2, y2, color="#94A3B8"):
    ax.annotate("", xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(arrowstyle="-|>", color=color, lw=1.2,
                                connectionstyle="arc3,rad=0.0"),
                zorder=2)

# ─────────────────────────────────────────────────────────
# Sheet 1: Horizontal auto-line flow
# ─────────────────────────────────────────────────────────
def gen_sheet1():
    if not HAS_MPL:
        # PIL fallback - solid color rectangles with text
        from PIL import Image, ImageDraw, ImageFont
        W, H = 3200, 340
        img = Image.new("RGB", (W, H), "#0F172A")
        draw = ImageDraw.Draw(img)
        try:
            fnt = ImageFont.truetype("arial.ttf", 11)
            fnt_sm = ImageFont.truetype("arial.ttf", 9)
        except:
            fnt = ImageFont.load_default()
            fnt_sm = fnt

        colors = ["#1E40AF", "#7C3AED", "#0369A1", "#059669", "#D97706",
                  "#DC2626", "#DB2777", "#65A30D"]
        n = len(FLOW1)
        bw = W / n - 4
        for i, (step, color) in enumerate(zip(FLOW1, [colors[i % len(colors)] for i in range(n)])):
            bx = i * (W / n) + 2
            by = 30
            bh = H - 50
            draw.rounded_rectangle([bx, by, bx + bw - 4, by + bh], radius=8, fill=color)
            lines = step.split("\n")
            for j, line in enumerate(lines[:3]):
                size = fnt_sm if len(lines) > 2 else fnt
                draw.text((bx + bw/2 - 2, by + bh/2 - 8 + j*14), line,
                          fill="white", font=size, anchor="mm")
            # Arrow
            if i < n - 1:
                ax = bx + bw - 2
                draw.line([ax, H//2, ax + 4, H//2], fill="#94A3B8", width=2)

        img.save(os.path.join(OUT_DIR, "sheet1-auto-line-flow.png"))
        print("Saved sheet1 (PIL)")
        return

    fig, ax = plt.subplots(figsize=(32, 3.4))
    fig.patch.set_facecolor("#0F172A")
    ax.set_facecolor("#0F172A")
    ax.set_xlim(0, 32)
    ax.set_ylim(0, 3.4)
    ax.axis("off")

    colors = ["#1E40AF", "#7C3AED", "#0369A1", "#059669", "#D97706",
              "#DC2626", "#DB2777", "#65A30D", "#0891B2", "#BE185D"]
    n = len(FLOW1)
    bw = 0.72
    bh = 1.8
    gap = (32 - n * bw) / (n + 1)

    for i, (step, color) in enumerate(zip(FLOW1, [colors[i % len(colors)] for i in range(n)])):
        x = gap + i * (bw + gap) + bw/2
        y = 1.7
        draw_rounded_box(ax, x, y, bw, bh, step, color=color, fontsize=6.5)
        if i < n - 1:
            ax.annotate("", xy=(x + bw/2 + gap, y),
                        xytext=(x + bw/2, y),
                        arrowprops=dict(arrowstyle="-|>", color="#475569", lw=1.5), zorder=5)

    # Title
    ax.text(16, 3.1, "自动线工艺流程  |  AUTO-LINE PROCESS FLOW",
            ha="center", va="center", fontsize=13, color="white", fontweight="bold",
            fontfamily=["DejaVu Sans", "WenQuanYi Micro Hei", "SimHei", "Arial"])
    ax.text(16, 0.2, "Vendor → IQC → SMT → PCBA → Assembly → Test → Burn-in → Packing → OQC",
            ha="center", va="center", fontsize=8, color="#94A3B8",
            fontfamily=["DejaVu Sans", "Arial"])

    plt.tight_layout(pad=0)
    fig.savefig(os.path.join(OUT_DIR, "sheet1-auto-line-flow.png"), dpi=150,
                bbox_inches="tight", facecolor="#0F172A")
    plt.close()
    print("Saved sheet1 (matplotlib)")


# ─────────────────────────────────────────────────────────
# Sheet 2: PO 流程 (vertical)
# ─────────────────────────────────────────────────────────
def gen_sheet2():
    from PIL import Image, ImageDraw, ImageFont

    W, H = 900, 1400
    img = Image.new("RGB", (W, H), "#0F172A")
    draw = ImageDraw.Draw(img)

    try:
        fnt_title = ImageFont.truetype("arial.ttf", 16)
        fnt_box = ImageFont.truetype("arial.ttf", 11)
        fnt_sm = ImageFont.truetype("arial.ttf", 9)
        fnt_cn = ImageFont.truetype("C:/Windows/Fonts/simhei.ttf", 11)
        fnt_cn_sm = ImageFont.truetype("C:/Windows/Fonts/simhei.ttf", 9)
    except:
        fnt_title = fnt_box = fnt_sm = fnt_cn = fnt_cn_sm = ImageFont.load_default()

    def box(x, y, w, h, text, fill, text_col="white", radius=8):
        draw.rounded_rectangle([x, y, x+w, y+h], radius=radius, fill=fill)
        lines = text.split("\n")
        total_h = len(lines) * 16
        start_y = y + (h - total_h) // 2
        for j, line in enumerate(lines):
            draw.text((x + w//2, start_y + j*16), line, fill=text_col,
                      font=fnt_cn, anchor="mm")

    def arrow(x1, y1, x2, y2):
        draw.line([x1, y1, x2, y2], fill="#475569", width=2)
        # Arrowhead
        mx = (x1 + x2) // 2
        draw.polygon([(x2, y2), (x2-6, y2-8), (x2+6, y2-8)], fill="#475569")

    cx = W // 2
    bw = 340
    bh = 52
    x = cx - bw//2

    # Title
    draw.text((cx, 40), "PO生产流程  |  PO PRODUCTION FLOW", fill="white",
              font=fnt_title, anchor="mm")

    # Steps
    colors2 = ["#4F46E5", "#4F46E5", "#4F46E5", "#4F46E5",
              "#059669", "#059669", "#D97706", "#D97706",
              "#059669", "#DC2626", "#7C3AED", "#7C3AED",
              "#0369A1", "#0369A1", "#0369A1", "#059669", "#059669"]
    y_pos = 100
    step_h = 68

    for i, ((zh, en, col), ci) in enumerate(zip(PO_STEPS, range(len(PO_STEPS)))):
        y = y_pos + i * step_h
        box(x, y, bw, bh, f"{zh}\n{en}", col, radius=6)
        if i < len(PO_STEPS) - 1:
            ny = y + bh + 10
            draw.polygon([(cx, ny), (cx-5, ny-8), (cx+5, ny-8)], fill="#475569")

    # Disposition branch
    dx = cx + bw//2 + 10
    dy = y_pos + 9 * step_h
    draw.text((dx + 80, dy), "不合格处理 Disposition:", fill="#DC2626",
              font=fnt_cn, anchor="mm")
    disp_colors = ["#F59E0B", "#EF4444", "#8B5CF6", "#6B7280"]
    for j, (disp, dc) in enumerate(zip(PO_DISPOSITIONS, disp_colors)):
        dy2 = dy + 30 + j * 36
        bx2 = dx
        draw.rounded_rectangle([bx2, dy2, bx2+200, dy2+28], radius=5, fill=dc)
        draw.text((bx2+100, dy2+14), disp, fill="white", font=fnt_cn_sm, anchor="mm")

    img.save(os.path.join(OUT_DIR, "sheet2-po-flow.png"))
    print("Saved sheet2")


# ─────────────────────────────────────────────────────────
# Sheet 3: 追溯要求 (SN trace decision tree)
# ─────────────────────────────────────────────────────────
def gen_sheet3():
    from PIL import Image, ImageDraw, ImageFont

    W, H = 1100, 680
    img = Image.new("RGB", (W, H), "#0F172A")
    draw = ImageDraw.Draw(img)

    try:
        fnt = ImageFont.truetype("C:/Windows/Fonts/simhei.ttf", 10)
        fnt_sm = ImageFont.truetype("C:/Windows/Fonts/simhei.ttf", 8)
        fnt_title = ImageFont.truetype("arial.ttf", 14)
    except:
        fnt = fnt_sm = fnt_title = ImageFont.load_default()

    cx = W // 2

    # Title
    draw.text((cx, 30), "SN追溯查询流程  |  SN TRACEABILITY QUERY", fill="white",
              font=fnt_title, anchor="mm")

    # Top row: SN input + query
    def box2(x, y, w, h, text, fill, radius=6):
        draw.rounded_rectangle([x, y, x+w, y+h], radius=radius, fill=fill)
        draw.text((x+w//2, y+h//2), text, fill="white", font=fnt, anchor="mm")

    def arrow_v(x, y1, y2):
        draw.line([x, y1, x, y2], fill="#475569", width=2)
        draw.polygon([(x, y2), (x-5, y2-8), (x+5, y2-8)], fill="#475569")

    # Row 1: SN input
    bx, by, bw, bh = cx - 60, 65, 120, 38
    box2(bx, by, bw, bh, "输入SN\nInput SN", "#BE185D", 6)
    arrow_v(cx, by+bh, by+95)

    # Row 2: MES query
    bx2 = cx - 80
    box2(bx2, by+100, 160, 38, "MES综合查询\nMES Query", "#4F46E5", 6)
    arrow_v(cx, by+138, by+175)

    # Row 3: 4 branches
    branches = [
        ("获取该SN/工单信息\nOrder Info", "#7C3AED"),
        ("获取生产时间线\nTimeline", "#0369A1"),
        ("获取测试数据\nTest Data", "#059669"),
        ("获取物料批次\nMaterials", "#D97706"),
    ]
    bw3 = 200
    gap3 = (W - len(branches)*bw3) // (len(branches)+1)
    for j, (btext, bcol) in enumerate(branches):
        bx3 = gap3 + j * (bw3 + gap3)
        box2(bx3, by+180, bw3, 45, btext, bcol, 6)
        arrow_v(bx3+bw3//2, by+225, by+270)

    # Row 4: sub-branches
    subs = [
        [("获取完整时间线", "#0369A1"), ("获取OQC数据", "#0369A1")],
        [("获取测试站数据", "#059669"), ("获取维修数据", "#DC2626")],
        [("获取物料批次/Date code", "#D97706"), ("OQC检验报告", "#D97706")],
        [("维修/返工数据", "#DC2626"), ("异常位置/换料记录", "#DC2626")],
    ]
    sub_bw = 180
    sub_gap = (W - len(subs)*sub_bw) // (len(subs)+1)
    for j, sub_group in enumerate(subs):
        bx4 = sub_gap + j * (sub_bw + sub_gap)
        for k, (stext, scol) in enumerate(sub_group):
            sy = by + 275 + k * 52
            box2(bx4, sy, sub_bw, 40, stext, scol, 5)

    # Decision diamond
    dx = cx
    box2(dx-70, by+395, 140, 38, "是否有FAIL记录?\nHas Fail?", "#F59E0B", 6)
    for j in range(4):
        bx4 = sub_gap + j * (sub_bw + sub_gap)
        arrow_v(bx4+sub_bw//2, by+315, by+395)

    # Branch outputs
    outputs = [
        ("分析OQC历史\n查看Fail原因", "#059669"),
        ("分析测试数据\n定位失效站", "#059669"),
        ("分析物料批次\n定位特定物料", "#D97706"),
        ("分析维修记录\n定位异常工序", "#DC2626"),
    ]
    for j, (otext, ocol) in enumerate(outputs):
        bx5 = sub_gap + j * (sub_bw + sub_gap)
        box2(bx5, by+448, sub_bw, 42, otext, ocol, 5)
        arrow_v(bx5+sub_bw//2, by+433, by+448)

    # Bottom
    box2(cx-80, by+510, 160, 38, "输出: 完整追溯报告\nFull Trace Report", "#1E40AF", 6)
    for j in range(4):
        bx5 = sub_gap + j * (sub_bw + sub_gap)
        arrow_v(bx5+sub_bw//2, by+490, by+510)

    img.save(os.path.join(OUT_DIR, "sheet3-traceability.png"))
    print("Saved sheet3")


# ─────────────────────────────────────────────────────────
# Sheet 4: 复测要求 (ICT/FCT retest)
# ─────────────────────────────────────────────────────────
def gen_sheet4():
    from PIL import Image, ImageDraw, ImageFont

    W, H = 900, 400
    img = Image.new("RGB", (W, H), "#0F172A")
    draw = ImageDraw.Draw(img)

    try:
        fnt = ImageFont.truetype("C:/Windows/Fonts/simhei.ttf", 11)
        fnt_title = ImageFont.truetype("arial.ttf", 14)
    except:
        fnt = fnt_title = ImageFont.load_default()

    def box2(x, y, w, h, text, fill, radius=8):
        draw.rounded_rectangle([x, y, x+w, y+h], radius=radius, fill=fill)
        draw.text((x+w//2, y+h//2), text, fill="white", font=fnt, anchor="mm")

    def arrow(x1, y1, x2, y2, col="#475569"):
        draw.line([x1, y1, x2, y2], fill=col, width=2)
        draw.polygon([(x2, y2), (x2-6, y2-8), (x2+6, y2-8)], fill=col)

    cx = W // 2

    # Title
    draw.text((cx, 30), "复测流程  |  RETEST FLOW (ICT / FCT)", fill="white",
              font=fnt_title, anchor="mm")

    # Row 1: ICT/FCT
    box2(cx-65, 65, 130, 44, "ICT / FCT\n自动测试", "#4F46E5", 8)
    arrow(cx, 109, cx, 135)

    # FAIL diamond
    diamond_points = [(cx, 135), (cx+22, 160), (cx, 185), (cx-22, 160)]
    draw.polygon(diamond_points, fill="#F59E0B")
    draw.text((cx, 160), "FAIL?", "black", font=fnt, anchor="mm")
    arrow(cx, 185, cx, 205)

    # PASS
    box2(cx+30, 175, 90, 36, "PASS ✓\n通过", "#059669", 6)
    arrow(cx, 185, cx+30, 193)

    # 1st retest
    box2(cx-90, 210, 120, 36, "第1次复测\n1st Retest", "#7C3AED", 6)
    arrow(cx-90, 246, cx-90, 268)

    # Diamond 2
    diamond_points2 = [(cx-90, 268), (cx-90+22, 293), (cx-90, 318), (cx-90-22, 293)]
    draw.polygon(diamond_points2, fill="#F59E0B")
    draw.text((cx-90, 293), "PASS?", "black", font=fnt, anchor="mm")
    arrow(cx-90, 318, cx-90, 338)

    # 2nd retest
    box2(cx-90, 343, 120, 36, "第2次复测\n2nd Retest", "#7C3AED", 6)

    # Rework
    box2(cx+40, 310, 90, 36, "返修\nRework", "#DC2626", 6)
    arrow(cx-18, 293, 40, 310, "#DC2626")

    # OK
    box2(cx+40, 355, 90, 30, "OK ✓", "#059669", 6)
    arrow(cx-90, 379, cx-30, 370)
    arrow(cx-30, 358, 40, 355, "#DC2626")

    img.save(os.path.join(OUT_DIR, "sheet4-retest.png"))
    print("Saved sheet4")


# ─────────────────────────────────────────────────────────
# Sheet 5: 时效管控 (PCB time control)
# ─────────────────────────────────────────────────────────
def gen_sheet5():
    from PIL import Image, ImageDraw, ImageFont

    W, H = 1000, 500
    img = Image.new("RGB", (W, H), "#0F172A")
    draw = ImageDraw.Draw(img)

    try:
        fnt = ImageFont.truetype("C:/Windows/Fonts/simhei.ttf", 11)
        fnt_title = ImageFont.truetype("arial.ttf", 14)
        fnt_sm = ImageFont.truetype("C:/Windows/Fonts/simhei.ttf", 9)
    except:
        fnt = fnt_title = fnt_sm = ImageFont.load_default()

    cx = W // 2

    def box2(x, y, w, h, text, fill, radius=8):
        draw.rounded_rectangle([x, y, x+w, y+h], radius=radius, fill=fill)
        draw.text((x+w//2, y+h//2), text, fill="white", font=fnt, anchor="mm")

    def arrow(x1, y1, x2, y2, col="#475569"):
        draw.line([x1, y1, x2, y2], fill=col, width=2)
        draw.polygon([(x2, y2), (x2-6, y2-8), (x2+6, y2-8)], fill=col)

    # Title
    draw.text((cx, 30), "时效管控  |  PCB TIME CONTROL (≤168H)", fill="white",
              font=fnt_title, anchor="mm")

    # Main row
    steps = [
        ("PCB开封\nPCB Open", "#4F46E5"),
        ("MES插件\nMES Insert", "#7C3AED"),
        ("白胶固化\nGlue Cure", "#059669"),
        ("分板\nDepanel", "#0369A1"),
        ("组装\nAssembly", "#D97706"),
        ("暂存\nTemp Store", "#6B7280"),
    ]
    bw = 120
    gap = 20
    total = len(steps) * bw + (len(steps)-1) * gap
    sx = (W - total) // 2
    sy = 130
    bh = 55

    for i, ((text, col), j) in enumerate(zip(steps, range(len(steps)))):
        bx = sx + i * (bw + gap)
        box2(bx, sy, bw, bh, text, col, 8)
        if i < len(steps) - 1:
            arrow(bx+bw, sy+bh//2, bx+bw+gap, sy+bh//2)

    # Arrow down to MES from PCB open
    box2(sx-20, sy+80, 160, 44, "≤168H?\nWithin 168 Hours?", "#F59E0B", 8)
    arrow(sx+bw//2, sy+bh, sx+bw//2-20, sy+80)

    # Yes path
    draw.text((sx+bw//2+5, sy+55), "YES ✓ →", fill="#059669", font=fnt_sm, anchor="mm")

    # No path: bake
    bake_x = sx - 200
    bake_y = sy + 40
    box2(bake_x, bake_y, 150, 44, "烘烤2H\nBake 2H", "#DC2626", 8)
    arrow(sx-20+bw, sy+bh//2, bake_x+150, sy+bh//2, "#DC2626")
    draw.text((bake_x+150+5, sy+bh//2), "← NO ✗", fill="#DC2626", font=fnt_sm, anchor="lm")
    arrow(bake_x+75, bake_y, bake_x+75, sy)
    arrow(bake_x+75, sy, sx, sy+bh//2)

    # 168H note
    note = ("PCB开封到插件时间不允许超过168H。超期必须烘烤2H后才可投入插件。\n"
            "Time from PCB open to insertion must not exceed 168H. If exceeded, bake 2H before insertion.")
    draw.text((cx, sy+160), note, fill="#94A3B8", font=fnt_sm, anchor="mm")

    # Glue cure ≥4H note
    note2 = ("白胶固化时间 ≥4H\nGlue cure time ≥ 4H before depanel/assembly")
    draw.text((cx, sy+200), note2, fill="#94A3B8", font=fnt_sm, anchor="mm")

    img.save(os.path.join(OUT_DIR, "sheet5-time-control.png"))
    print("Saved sheet5")


# ─────────────────────────────────────────────────────────
# Sheet 6: MES岗位 (station flow)
# ─────────────────────────────────────────────────────────
def gen_sheet6():
    from PIL import Image, ImageDraw, ImageFont

    W, H = 1200, 380
    img = Image.new("RGB", (W, H), "#0F172A")
    draw = ImageDraw.Draw(img)

    try:
        fnt = ImageFont.truetype("C:/Windows/Fonts/simhei.ttf", 10)
        fnt_title = ImageFont.truetype("arial.ttf", 14)
    except:
        fnt = fnt_title = ImageFont.load_default()

    def box2(x, y, w, h, text, fill, radius=6):
        draw.rounded_rectangle([x, y, x+w, y+h], radius=radius, fill=fill)
        draw.text((x+w//2, y+h//2), text, fill="white", font=fnt, anchor="mm")

    cx = W // 2

    # Title
    draw.text((cx, 28), "MES工站流程  |  MES STATION FLOW", fill="white",
              font=fnt_title, anchor="mm")

    # Station colors
    station_colors = {
        "AI1": "#7C3AED", "AI2": "#7C3AED",
        "贴片1": "#0369A1", "贴片2": "#0369A1", "SMT-AOI": "#0369A1",
        "PCBA上料": "#7C3AED", "WS-AOI": "#0369A1", "ICT": "#059669",
        "FCT": "#059669", "分板": "#D97706", "PCBA Link": "#4F46E5",
        "ATE1": "#DC2626", "Ultrasonic": "#BE185D", "外观/限高": "#9CA3AF",
        "BI Loading": "#DC2626", "Burn-in": "#DC2626", "Hi-pot": "#F59E0B",
        "ATE2": "#DC2626", "Enclosure Label": "#6B7280", "Packing Scan": "#6B7280",
        "OQC": "#059669",
    }
    default_col = "#1E40AF"

    stations = MES_STATIONS
    n = len(stations)
    bw = 44
    bh = 50
    gap = 6
    total = n * bw + (n-1) * gap
    sx = (W - total) // 2
    sy = 120

    for i, station in enumerate(stations):
        bx = sx + i * (bw + gap)
        col = station_colors.get(station, default_col)
        box2(bx, sy, bw, bh, station, col, 5)
        if i < n - 1:
            draw.line([bx+bw, sy+bh//2, bx+bw+gap, sy+bh//2],
                      fill="#475569", width=2)
            draw.polygon([(bx+bw+gap, sy+bh//2),
                          (bx+bw+gap-5, sy+bh//2-7),
                          (bx+bw+gap-5, sy+bh//2+7)],
                         fill="#475569")

    # Phase labels
    phases = [
        (sx-10, sy-30, "SMT", "#7C3AED"),
        (sx + 6*(bw+gap), sy-30, "Post-SMT", "#0369A1"),
        (sx + 13*(bw+gap), sy-30, "Assembly", "#D97706"),
        (sx + 18*(bw+gap), sy-30, "Test/Burn-in", "#DC2626"),
        (sx + 21*(bw+gap), sy-30, "Packing", "#059669"),
    ]
    for px, py, plabel, pcol in phases:
        if px < W - 20:
            draw.text((px, py), plabel, fill=pcol, font=fnt, anchor="lm")

    # Key notes
    notes = [
        "PCB开封→插件: ≤168H | 白胶固化: ≥4H",
        "SMT-AOI + WS-AOI: AOI自动光学检测",
        "ICT/FCT: 电气性能测试 | Hi-pot: 耐压测试",
        "ATE1/ATE2: 加载功能测试 | Burn-in: 老化测试",
        "OQC: 最终出货质量检验",
    ]
    for j, note in enumerate(notes):
        draw.text((20, sy+bh+30+j*16), f"• {note}",
                  fill="#64748B", font=fnt)

    img.save(os.path.join(OUT_DIR, "sheet6-mes-stations.png"))
    print("Saved sheet6")


if __name__ == "__main__":
    gen_sheet1()
    gen_sheet2()
    gen_sheet3()
    gen_sheet4()
    gen_sheet5()
    gen_sheet6()
    print(f"\nAll flowcharts saved to: {OUT_DIR}")
    for f in os.listdir(OUT_DIR):
        print(f"  {f}")
