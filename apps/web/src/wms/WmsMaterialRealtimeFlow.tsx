import type { Locale } from "../../../../packages/shared-types/src/factory";

type StepKey = "receiving" | "qr" | "iqc" | "inventory" | "msd" | "usage" | "alarm";

export function WmsMaterialRealtimeFlow({ locale, materialCode, lotNo, boxQr, iqcStatus, locationCode, approvalCount, inspectionCount }: { locale: Locale; materialCode: string; lotNo: string; boxQr: string; iqcStatus: string; locationCode?: string; approvalCount?: number; inspectionCount?: number }) {
  const zh = locale === "zh-CN";
  const vi = locale === "vi-VN";
  const text = (z: string, v: string, e: string) => zh ? z : vi ? v : e;
  const hasMaterial = Boolean(materialCode.trim() || lotNo.trim() || boxQr.trim());
  const normalized = iqcStatus.toUpperCase();
  const iqcDone = ["PASS", "FAIL", "RELEASED", "REJECTED", "HOLD"].includes(normalized);
  const current: StepKey = !materialCode.trim() || !lotNo.trim() ? "receiving" : !boxQr.trim() ? "qr" : !iqcDone ? "iqc" : ["FAIL", "REJECTED", "HOLD"].includes(normalized) ? "alarm" : "inventory";
  const steps: Array<{ key: StepKey; label: string; next: string }> = [
    { key: "receiving", label: text("收料", "Nhận liệu", "Receiving"), next: text("确认收料信息", "Xác nhận thông tin nhận", "Confirm receiving") },
    { key: "qr", label: text("QR绑定仓库", "Liên kết QR kho", "QR binding"), next: text("绑定批次、箱号和库位", "Liên kết lô, thùng và vị trí", "Bind lot, box and location") },
    { key: "iqc", label: "IQC", next: text("完成来料检验", "Hoàn tất IQC", "Complete IQC") },
    { key: "inventory", label: text("库存台账", "Tồn kho", "Inventory"), next: text("查看库位、有效期和库存", "Xem vị trí, hạn dùng và tồn kho", "View location, expiry and stock") },
    { key: "msd", label: "MSD", next: text("开封、计时和寿命监控", "Mở gói, tính giờ và theo dõi MSD", "Open, time and monitor MSD") },
    { key: "usage", label: text("工单领料", "Cấp liệu theo WO", "WO issue/use"), next: text("绑定工单并按FIFO领料", "Liên kết WO và cấp liệu FIFO", "Bind WO and issue by FIFO") },
    { key: "alarm", label: text("异常/审批", "Bất thường/Phê duyệt", "Exception/approval"), next: text("进入MRB、特殊放行或报废审批", "Vào MRB, phê duyệt đặc biệt hoặc hủy", "Open MRB, special release or scrap approval") },
  ];
  const activeIndex = Math.max(0, steps.findIndex(step => step.key === current));
  const hrefFor = (step: StepKey) => {
    const tabs: Record<StepKey, string> = { receiving: "materialReceiving", qr: "qrBinding", iqc: "iqcInspect", inventory: "inventory", msd: "msd", usage: "pdaConsumption", alarm: "scrapFinanceApproval" };
    return `/?view=wms&wmsTab=${tabs[step]}${lotNo.trim() ? `&lotNo=${encodeURIComponent(lotNo.trim())}` : ""}${materialCode.trim() ? `&materialCode=${encodeURIComponent(materialCode.trim())}` : ""}`;
  };
  const navigate = (step: StepKey) => { window.location.href = hrefFor(step); };
  const traceHref = `/?view=wms&wmsTab=materialTrace${lotNo.trim() ? `&lotNo=${encodeURIComponent(lotNo.trim())}` : ""}${boxQr.trim() ? `&qr=${encodeURIComponent(boxQr.trim())}` : ""}`;
  return <section className="surface-panel" aria-label="Real-time material process flow">
    <div className="section-header"><div><h3>{text("物料实时状态与位置", "Trạng thái và vị trí vật liệu theo thời gian thực", "Real-time material status and location")}</h3><p>{hasMaterial ? `${materialCode || "—"} · ${lotNo || "—"} · ${boxQr || "—"}` : text("输入物料 SN/批次后查看", "Nhập SN/lô vật liệu để xem", "Enter material SN/lot to view")}</p><p style={{ marginTop: 4 }}>{text("当前位置", "Vị trí hiện tại", "Current location")}: <strong>{locationCode || "—"}</strong>　|　{text("下一步", "Bước tiếp theo", "Next step")}: <strong>{steps[activeIndex].next}</strong>　{current === "alarm" && `(${approvalCount ?? 0} ${text("条审批/异常", "phê duyệt/bất thường", "approval/exception records")})`}</p></div><button type="button" className="action-button" onClick={() => navigate(current)}>{text("进入当前流程", "Mở quy trình hiện tại", "Open current process")}</button></div>
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}><a className="action-button" href={traceHref}>{text("查看物料流程追踪", "Xem truy xuất quy trình vật liệu", "View material process trace")}</a></div>
    <div style={{ overflowX: "auto", marginBottom: 14 }}><svg viewBox="0 0 1180 330" width="100%" role="img" aria-label="Complete WMS material process map" style={{ minWidth: 980, background: "#f8fafc", borderRadius: 10 }}>
      <defs><marker id="wms-full-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#64748b" /></marker></defs>
      <g fontFamily="Arial, Microsoft YaHei, sans-serif" fontSize="14" textAnchor="middle" fill="#0f172a">
        <rect x="20" y="24" width="150" height="42" rx="8" fill="#e0f2fe" stroke="#0284c7"/><text x="95" y="50">{text("订单采购", "PO purchase", "Mua PO")}</text>
        <rect x="20" y="86" width="150" height="42" rx="8" fill="#e0f2fe" stroke="#0284c7"/><text x="95" y="112">{text("产线退料", "Line return", "Tra ve tu line")}</text>
        <rect x="20" y="148" width="150" height="42" rx="8" fill="#e0f2fe" stroke="#0284c7"/><text x="95" y="174">{text("返工修复完工", "Rework complete", "Hoan tat sua")}</text>
        <rect x="20" y="210" width="150" height="42" rx="8" fill="#e0f2fe" stroke="#0284c7"/><text x="95" y="236">{text("外协完工回厂", "Subcontract return", "Gia cong ve")}</text>
        <rect x="230" y="118" width="155" height="52" rx="10" fill="#fef3c7" stroke="#d97706" strokeWidth="2"/><text x="307" y="149">{text("收货仓库待办", "Receiving queue", "Hang cho nhan")}</text>
        <rect x="435" y="118" width="155" height="52" rx="10" fill="#dbeafe" stroke="#2563eb" strokeWidth="3"/><text x="512" y="149">QR {text("绑定仓库", "warehouse binding", "gan kho")}</text>
        <rect x="640" y="118" width="140" height="52" rx="10" fill="#ede9fe" stroke="#7c3aed" strokeWidth="2"/><text x="710" y="149">IQC</text>
        <rect x="850" y="56" width="150" height="52" rx="10" fill="#dcfce7" stroke="#16a34a" strokeWidth="2"/><text x="925" y="87">{text("成品仓库", "Finished stock", "Kho thanh pham")}</text>
        <rect x="850" y="190" width="150" height="52" rx="10" fill="#fee2e2" stroke="#dc2626" strokeWidth="2"/><text x="925" y="221">{text("不良品仓库", "Defect stock", "Kho loi")}</text>
        <rect x="1040" y="190" width="120" height="52" rx="10" fill="#fef2f2" stroke="#b91c1c" strokeWidth="2"/><text x="1100" y="221">MRB</text>
        <rect x="1040" y="260" width="120" height="38" rx="8" fill="#fff7ed" stroke="#ea580c"/><text x="1100" y="284">{text("返工/报废/退货", "Rework / scrap / return", "Sua / huy / tra")}</text>
        {[45,107,169,231].map(y => <line key={y} x1="170" y1={y} x2="230" y2="144" stroke="#64748b" strokeWidth="2" markerEnd="url(#wms-full-arrow)" />)}
        <line x1="385" y1="144" x2="435" y2="144" stroke="#64748b" strokeWidth="3" markerEnd="url(#wms-full-arrow)"/><line x1="590" y1="144" x2="640" y2="144" stroke="#64748b" strokeWidth="3" markerEnd="url(#wms-full-arrow)"/>
        <line x1="780" y1="135" x2="850" y2="82" stroke="#16a34a" strokeWidth="3" markerEnd="url(#wms-full-arrow)"/><line x1="780" y1="155" x2="850" y2="216" stroke="#dc2626" strokeWidth="3" markerEnd="url(#wms-full-arrow)"/>
        <line x1="1000" y1="216" x2="1040" y2="216" stroke="#dc2626" strokeWidth="3" markerEnd="url(#wms-full-arrow)"/><line x1="1100" y1="242" x2="1100" y2="260" stroke="#ea580c" strokeWidth="2" markerEnd="url(#wms-full-arrow)"/>
        <text x="812" y="78" fill="#16a34a" fontSize="12">{text("合格", "PASS", "DAT")}</text><text x="812" y="210" fill="#dc2626" fontSize="12">{text("不合格", "FAIL", "LOI")}</text>
      </g>
    </svg></div>
    <div style={{ overflowX: "auto" }}><svg viewBox="0 0 1120 155" width="100%" role="img" aria-label="Material process status map" style={{ minWidth: 820 }}>
      <defs><marker id="material-flow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#94a3b8" /></marker></defs>
      <line x1="72" y1="55" x2="1048" y2="55" stroke="#cbd5e1" strokeWidth="4" markerEnd="url(#material-flow-arrow)" />
      {steps.map((step, index) => { const done = index < activeIndex; const active = index === activeIndex; const x = 72 + index * 160; const color = step.key === "alarm" && active ? "#dc2626" : active ? "#0891b2" : done ? "#16a34a" : "#94a3b8"; return <a key={step.key} href={hrefFor(step.key)} aria-label={step.label} style={{ cursor: "pointer" }}><g><circle cx={x} cy="55" r={active ? 23 : 19} fill={active ? "#ecfeff" : "#fff"} stroke={color} strokeWidth="4" /><text x={x} y="61" textAnchor="middle" fontSize="17" fontWeight="700" fill={color}>{done ? "✓" : index + 1}</text><text x={x} y="100" textAnchor="middle" fontSize="14" fontWeight={active ? "700" : "500"} fill="#0f172a">{step.label}</text>{active && <text x={x} y="124" textAnchor="middle" fontSize="11" fill={color}>{step.next}</text>}</g></a>; })}
    </svg></div>
    <div style={{ marginTop: 8, color: "var(--muted)" }}>{text("IQC记录", "Bản ghi IQC", "IQC records")}: {inspectionCount ?? 0}　·　{text("审批/异常记录", "Phê duyệt/bất thường", "Approval/exception records")}: {approvalCount ?? 0}</div>
  </section>;
}
