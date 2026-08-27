import { useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { pmcApi } from "../api/pmc";
import { wmsApi } from "../api/wms";

export type WmsWorkOrderMaterialItem = {
  materialCode: string;
  materialNameZh: string;
  uom: string;
  totalRequired: number;
  pickedQty: number;
  shortfall: number;
  bestLot?: { lotNo: string; locationCode: string; availableQty: number } | null;
};
type Item = WmsWorkOrderMaterialItem;

export function WmsWorkOrderMaterialFlow({ locale, workOrderCode, onSelect }: { locale: Locale; workOrderCode: string; onSelect?: (item: Item) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [summary, setSummary] = useState<{ fulfillmentPct: number; totalShortfall: number } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [allocation, setAllocation] = useState<{ materialCode: string; materialLotId: number; lotNo: string; qty: number; availableQty: number; locationCode: string } | null>(null);

  const allocate = async (item: Item) => {
    if (!workOrderCode.trim()) return;
    setAllocation(null);
    try {
      const result = await wmsApi.getLotRecommendations(workOrderCode.trim(), item.materialCode);
      const first = result.items?.[0];
      if (!first) throw new Error(`物料 ${item.materialCode} 暂无可分配的 FIFO 批次`);
      const remaining = Math.max(0, Number(item.totalRequired || 0) - Number(item.pickedQty || 0));
      const availableQty = Number(first.availableQty || 0);
      const qty = Math.min(remaining || availableQty, availableQty);
      const next = { materialCode: item.materialCode, materialLotId: Number(first.id), lotNo: first.lotNo, qty, availableQty, locationCode: first.locationCode || item.bestLot?.locationCode || "" };
      setAllocation(next);
      window.dispatchEvent(new CustomEvent("wms:work-order-material-selected", { detail: { ...item, allocation: next } }));
      setMessage(`已自动分配 FIFO：${qty} ${item.uom}；物料ID ${first.id}；库位 ${next.locationCode || "-"}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    let active = true;
    const code = workOrderCode.trim();
    if (!code) { setItems([]); setSummary(null); setMessage(""); return () => { active = false; }; }
    const refresh = () => {
      setBusy(true);
      void pmcApi.getWorkOrderMaterialStatus(code).then((res) => {
        if (!active) return;
        setItems((res.items ?? []) as Item[]);
        setSummary(res.summary);
        setMessage("");
      }).catch((error) => { if (active) { setItems([]); setSummary(null); setMessage(error instanceof Error ? error.message : String(error)); } })
        .finally(() => { if (active) setBusy(false); });
    };
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [workOrderCode]);

  if (!workOrderCode.trim()) return null;
  const zh = locale === "zh-CN";
  const vi = locale === "vi-VN";
  const text = (z: string, v: string, e: string) => zh ? z : vi ? v : e;
  return <section className="surface-panel" style={{ maxWidth: 1180, margin: "0 auto" }}>
    <div className="section-header">
      <div><h3>{text("工单绑定物料 SVG 状态图", "Sơ đồ SVG vật liệu liên kết lệnh SX", "Work-order material binding map")}</h3>
        <p>{text("绑定前先检查工单 BOM、IQC 放行、库存和 FIFO；点击物料节点进入绑定。", "Kiểm tra BOM, IQC, tồn kho và FIFO trước khi liên kết; nhấn nút vật liệu để liên kết.", "BOM, IQC release, stock and FIFO are checked before binding; click a material node to bind.")}</p></div>
      <span className="status-chip">{busy ? "…" : `${summary?.fulfillmentPct ?? 0}%`}</span>
    </div>
    {message && <div className="notice">{message}</div>}
    {allocation && <div className="notice" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8, marginTop: 10 }}>
      <strong>自动分配：{allocation.materialCode}</strong><span>物料ID：{allocation.materialLotId}</span><span>数量：{allocation.qty}</span><span>批次：{allocation.lotNo}</span><span>库位：{allocation.locationCode || "-"}</span><span>可用：{allocation.availableQty}</span>
    </div>}
    {!busy && !items.length && !message && <div className="empty-state">{text("工单没有可显示的物料", "Không có vật liệu cho lệnh SX", "No work-order materials")}</div>}
    {!!items.length && <div style={{ overflowX: "auto" }}>
      <svg width={Math.max(920, 300 + items.length * 230)} height="310" role="img" aria-label="work order material binding flow">
        <defs><marker id="wms-flow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#64748b" /></marker></defs>
        <g fontFamily="inherit" fontSize="13">
          <rect x="24" y="112" width="150" height="70" rx="12" fill="#0f2a43" stroke="#38bdf8" strokeWidth="2" />
          <text x="99" y="140" textAnchor="middle" fill="white" fontWeight="700">WO {workOrderCode}</text>
          <text x="99" y="162" textAnchor="middle" fill="#bae6fd">BOM / 工单</text>
          {items.map((item, index) => {
            const x = 230 + index * 230;
            const ok = item.shortfall <= 0;
            const lot = item.bestLot;
            return <g key={item.materialCode} onClick={() => { onSelect?.(item); void allocate(item); }} style={{ cursor: onSelect ? "pointer" : "default" }}>
              <line x1={174} y1={147} x2={x - 12} y2={147} stroke="#64748b" strokeWidth="2" markerEnd="url(#wms-flow-arrow)" />
              <rect x={x} y="42" width="198" height="210" rx="12" fill={ok ? "#f0fdf4" : "#fff7ed"} stroke={ok ? "#22c55e" : "#f97316"} strokeWidth="2" />
              <text x={x + 99} y="68" textAnchor="middle" fill="#0f172a" fontWeight="700">{item.materialCode}</text>
              <text x={x + 99} y="88" textAnchor="middle" fill="#475569">{item.materialNameZh || "Material"}</text>
              <text x={x + 16} y="116" fill="#334155">{text("需求", "Nhu cầu", "Required")}: {item.totalRequired} {item.uom}</text>
              <text x={x + 16} y="137" fill="#334155">{text("已绑定/领用", "Đã liên kết", "Bound/issued")}: {item.pickedQty}</text>
              <text x={x + 16} y="158" fill={ok ? "#15803d" : "#c2410c"} fontWeight="700">{ok ? "✓ " : "⚠ "}{text("短缺", "Thiếu", "Short")}: {item.shortfall}</text>
              <text x={x + 16} y="184" fill="#334155">FIFO: {lot?.lotNo || "—"}</text>
              <text x={x + 16} y="203" fill="#334155">{lot?.locationCode || text("无可用库位", "Không có vị trí", "No location")}</text>
              <text x={x + 16} y="224" fill={lot ? "#0369a1" : "#b91c1c"} fontWeight="700">{lot ? `${lot.availableQty} ${item.uom} available` : text("不能绑定", "Không thể liên kết", "Cannot bind")}</text>
            </g>;
          })}
        </g>
      </svg>
    </div>}
    {summary && <div style={{ marginTop: 8, color: "var(--muted)" }}>{text("总短缺", "Tổng thiếu", "Total shortfall")}: {summary.totalShortfall}</div>}
  </section>;
}
