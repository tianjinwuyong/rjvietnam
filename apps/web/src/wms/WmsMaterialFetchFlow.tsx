import type { Locale } from "../../../../packages/shared-types/src/factory";

type NodeId = "iqc_pass" | "create_wo" | "freeze_bom" | "fetch_queue" | "pick" | "handover" | "receive" | "issue_line" | "shortage" | "reserve_stock" | "writeoff";

export function WmsMaterialFetchFlow({ locale, workOrderCode }: { locale: Locale; workOrderCode?: string }) {
  const zh = locale === "zh-CN";
  const vi = locale === "vi-VN";
  const text = (z: string, v: string, e: string) => zh ? z : vi ? v : e;

  const wms = (tab: string) => {
    const base = `?view=wms&wmsTab=${tab}`;
    return workOrderCode?.trim() ? `${base}&workOrderCode=${encodeURIComponent(workOrderCode.trim())}` : base;
  };

  const go = (tab: string) => {
    window.dispatchEvent(new CustomEvent("factory:navigate", { detail: { view: "wms", wmsTab: tab } }));
    const url = new URL(window.location.href);
    url.searchParams.set("view", "wms");
    url.searchParams.set("wmsTab", tab);
    window.history.replaceState({}, "", url);
  };

  const nodes: Array<{ id: NodeId; tab: string; x: number; y: number; w: number; label: { z: string; v: string; e: string }; sub: string; kind: "main" | "branch" }> = [
    { id: "iqc_pass", tab: "iqcPassMaintenance", x: 20, y: 160, w: 150, label: { z: "IQC 通过", v: "IQC đạt", e: "IQC pass" }, sub: "iqc_status=released", kind: "branch" },
    { id: "create_wo", tab: "picking", x: 20, y: 24, w: 150, label: { z: "创建工单", v: "Tạo lệnh SX", e: "Create WO" }, sub: "PMC", kind: "main" },
    { id: "freeze_bom", tab: "picking", x: 20, y: 86, w: 150, label: { z: "冻结 BOM 需求", v: "Đóng băng BOM", e: "Freeze BOM" }, sub: "work_order_bom_requirements", kind: "main" },
    { id: "fetch_queue", tab: "picking", x: 210, y: 86, w: 150, label: { z: "领料队列", v: "Hàng cấp liệu", e: "Fetch queue" }, sub: "FIFO released lots", kind: "main" },
    { id: "pick", tab: "picking", x: 400, y: 86, w: 150, label: { z: "拣货领料", v: "Chọn hàng", e: "Pick" }, sub: "PICK transaction", kind: "main" },
    { id: "handover", tab: "issue", x: 590, y: 24, w: 150, label: { z: "出库交接", v: "Bàn giao xuất kho", e: "Handover" }, sub: "fetch-packages handover", kind: "main" },
    { id: "receive", tab: "issue", x: 780, y: 86, w: 150, label: { z: "产线接收", v: "Dây chuyền nhận", e: "Line receive" }, sub: "fetch-packages receive", kind: "main" },
    { id: "issue_line", tab: "issue", x: 970, y: 86, w: 150, label: { z: "发料上线", v: "Cấp liệu lên máy", e: "Issue to line" }, sub: "ISSUE_TO_LINE", kind: "main" },
    { id: "shortage", tab: "fifoMonitor", x: 210, y: 210, w: 150, label: { z: "缺料告警", v: "Cảnh báo thiếu", e: "Shortage" }, sub: "material-shortages", kind: "branch" },
    { id: "reserve_stock", tab: "inventory", x: 400, y: 210, w: 150, label: { z: "库存预留", v: "Đặt trước tồn kho", e: "Reserve" }, sub: "reserved_qty", kind: "branch" },
    { id: "writeoff", tab: "materialConsumption", x: 970, y: 210, w: 150, label: { z: "消耗冲销", v: "Trừ tiêu hao", e: "Write-off" }, sub: "bom-writeoffs", kind: "branch" },
  ];

  const edges: Array<{ from: NodeId; to: NodeId; color: string; w: number; dash?: string; label?: string; lx?: number; ly?: number }> = [
    { from: "create_wo", to: "freeze_bom", color: "#64748b", w: 2, label: text("BOM 绑定", "Gắn BOM", "BOM bind"), lx: 95, ly: 10 },
    { from: "freeze_bom", to: "fetch_queue", color: "#64748b", w: 2, label: text("需求生成", "Sinh nhu cầu", "Generate") },
    { from: "iqc_pass", to: "fetch_queue", color: "#16a34a", w: 3, dash: "5,4", label: text("released 可领", "released sẵn sàng", "released ready"), ly: 16 },
    { from: "fetch_queue", to: "pick", color: "#0891b2", w: 3, label: text("FIFO 匹配", "Khớp FIFO", "FIFO") },
    { from: "pick", to: "handover", color: "#64748b", w: 2, label: text("出库", "Xuất kho", "Ship") },
    { from: "handover", to: "receive", color: "#dc2626", w: 3, label: text("交接", "Bàn giao", "Handoff") },
    { from: "receive", to: "issue_line", color: "#64748b", w: 2, label: text("发料", "Cấp liệu", "Issue") },
    { from: "fetch_queue", to: "shortage", color: "#dc2626", w: 2, dash: "5,4", label: text("可用不足", "Không đủ", "Short") },
    { from: "pick", to: "reserve_stock", color: "#0891b2", w: 2, dash: "5,4", label: text("预留", "Đặt trước", "Reserve") },
    { from: "issue_line", to: "writeoff", color: "#7c3aed", w: 2, dash: "5,4", label: text("销账", "Trừ sổ", "Write-off") },
  ];

  const cx = (n: typeof nodes[number]) => n.x + n.w / 2;
  const cy = (n: typeof nodes[number]) => n.y + 26;
  const isLast = (id: NodeId) => ["issue_line"].includes(id);

  return <section className="surface-panel" aria-label="Material fetching flow">
    <div className="section-header">
      <div><h3>{text("物料领料流程", "Quy trình cấp liệu", "Material fetching flow")}</h3>
        <p>{workOrderCode?.trim() ? `${workOrderCode}` : text("材料通过 IQC（iqc_status=released）后即可领料；点击节点跳转到对应模块", "Sau khi qua IQC (iqc_status=released) có thể cấp liệu; bấm nút để mở module", "Material is fetch-ready once IQC passes (iqc_status=released); click a node to open its module")}</p></div>
    </div>
    <div style={{ overflowX: "auto", marginBottom: 14 }}>
      <svg viewBox="0 0 1180 270" width="100%" role="img" aria-label="Material fetching workflow map" style={{ minWidth: 980, background: "#f8fafc", borderRadius: 10 }}>
        <defs>
          <marker id="mf-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#64748b" /></marker>
          <marker id="mf-arrow-ct" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#0891b2" /></marker>
          <marker id="mf-arrow-rd" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#dc2626" /></marker>
          <marker id="mf-arrow-vt" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#7c3aed" /></marker>
          <marker id="mf-arrow-gn" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#16a34a" /></marker>
        </defs>
        <g fontFamily="Arial, Microsoft YaHei, sans-serif" fontSize="14" textAnchor="middle" fill="#0f172a">
          {edges.map((e, i) => <line key={i} x1={cx(nodes.find(n => n.id === e.from)!)} y1={cy(nodes.find(n => n.id === e.from)!)} x2={cx(nodes.find(n => n.id === e.to)!)} y2={cy(nodes.find(n => n.id === e.to)!)} stroke={e.color} strokeWidth={e.w} strokeDasharray={e.dash} markerEnd={`url(#mf-arrow-${e.color === "#0891b2" ? "ct" : e.color === "#dc2626" ? "rd" : e.color === "#7c3aed" ? "vt" : e.color === "#16a34a" ? "gn" : "arrow"})`} />)}
        </g>
        <g fontFamily="Arial, Microsoft YaHei, sans-serif" fontSize="12" textAnchor="middle" fill="#334155">
          {edges.filter(e => e.label).map((e, i) => <text key={i} x={(cx(nodes.find(n => n.id === e.from)!) + cx(nodes.find(n => n.id === e.to)!)) / 2 + (e.lx ?? 0)} y={(cy(nodes.find(n => n.id === e.from)!) + cy(nodes.find(n => n.id === e.to)!)) / 2 - 10 + (e.ly ?? 0)} fill={e.color} stroke="#f8fafc" strokeWidth={3} paintOrder="stroke">{e.label}</text>)}
        </g>
        <g fontFamily="Arial, Microsoft YaHei, sans-serif" textAnchor="middle">
          {nodes.map((n) => <a key={n.id} href={wms(n.tab)} onClick={(e) => { e.preventDefault(); go(n.tab); }} aria-label={n.label.e} style={{ cursor: "pointer", textDecoration: "none" }}>
            <rect x={n.x} y={n.y} width={n.w} height="52" rx="10" fill={n.kind === "main" ? "#dbeafe" : "#fef3c7"} stroke={n.kind === "main" ? "#2563eb" : "#d97706"} strokeWidth="2" />
            <text x={cx(n)} y={n.y + 22} fontSize="14" fontWeight="700" fill="#0f172a" textAnchor="middle">{n.label.z}</text>
            <text x={cx(n)} y={n.y + 38} fontSize={n.sub.length > 24 ? 8 : 10} fill="#64748b" textAnchor="middle">{n.sub}</text>
          </a>)}
        </g>
      </svg>
    </div>
  </section>;
}
