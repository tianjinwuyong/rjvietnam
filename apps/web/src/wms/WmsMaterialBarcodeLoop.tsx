import { useMemo, useState } from "react";
import type { Locale } from "../i18n";
import { MaterialRollQrGenerator, type MaterialRollPrefill } from "../mes/MaterialRollQrGenerator";

const supplierLabel: MaterialRollPrefill = { materialSn: "12058-0000362-20260810-001", materialCode: "12058-0000362", lotNo: "20260810", dateCode: "20260810", supplierCode: "CR075", supplierLot: "20260810", description: "Transformer EE17 / PC95 / 1150uH", quantity: 300000, unit: "PCS", rollCount: 1, referenceSn: "SUP-001" };
const warehouseLabel: MaterialRollPrefill = { materialSn: "M260807186558", materialCode: "0.13.00.02.0017", lotNo: "260723V103F", dateCode: "20260806", manufacturingDate: "2026-08-06", expiryDate: "2027-02-02", supplierCode: "H.081", supplierLot: "260723V103F", description: "Material label / warehouse receiving label", quantity: 500, unit: "PCS", rollCount: 2, referenceSn: "M260807186558" };

export function WmsMaterialBarcodeLoop({ locale }: { locale: Locale }) {
  const zh = locale === "zh-CN";
  const vi = locale === "vi-VN";
  const text = (z: string, v: string, e: string) => zh ? z : vi ? v : e;
  const [source, setSource] = useState<"supplier" | "warehouse">("supplier");
  const prefill = useMemo(() => source === "supplier" ? supplierLabel : warehouseLabel, [source]);
  const cards = source === "supplier" ? ["SupplierLabelPrinting", "12058-0000362", "20260810", "300000 PCS"] : ["WarehouseGenerator", "0.13.00.02.0017", "260723V103F", "500 PCS"];
  return <div className="screen-stack">
    <section className="surface-panel" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start", flexWrap: "wrap" }}><div><div style={{ color: "var(--state-active,#18c6d9)", fontSize: 12, fontWeight: 800, letterSpacing: 1 }}>{text("WMS 条码闭环", "VÒNG KÍN MÃ VẠCH WMS", "WMS BARCODE CLOSED LOOP")}</div><h2 style={{ margin: "6px 0" }}>{text("供应商标签 → 入库标签 → 打印履历", "Nhãn nhà cung cấp → nhãn nhập kho → lịch sử in", "Supplier label → warehouse label → print history")}</h2><p style={{ margin: 0, color: "var(--muted)" }}>{text("统一使用物料 SN、批次、数量和打印事件，避免供应商标签与仓库标签脱节。", "Dùng chung SN, lô, số lượng và sự kiện in để không mất liên kết.", "One material identity, lot, quantity and print-event history from receiving to warehouse.")}</p></div><div className="badge badge-success">{text("可追溯闭环", "Đã khép vòng truy xuất", "TRACEABILITY READY")}</div></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(260px,1fr))", gap: 14, marginTop: 18 }}>
        {([["supplier", "供应商标签 / Nhãn NCC / Supplier label", "Blueway SupplierLabelPrinting"], ["warehouse", "仓库条码 / Mã kho / Warehouse barcode", "Rui Jing warehouse generator"]] as const).map(([key, title, caption]) => <button key={key} type="button" onClick={() => setSource(key)} style={{ textAlign: "left", padding: 16, borderRadius: 12, border: source === key ? "2px solid var(--state-active,#18c6d9)" : "1px solid var(--border-default,#2c414f)", background: source === key ? "rgba(24,198,217,.12)" : "var(--surface-2)", color: "inherit", cursor: "pointer" }}><strong>{title}</strong><div style={{ color: "var(--muted)", fontSize: 12, marginTop: 6 }}>{caption}</div><div style={{ fontFamily: "Consolas", marginTop: 10 }}>{key === "supplier" ? "12058-0000362 · CR075 · 300000 PCS" : "0.13.00.02.0017 · H.081 · 500 PCS"}</div></button>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(130px,1fr))", gap: 10, marginTop: 16 }}>{[[text("来源", "Nguồn", "Source"), cards[0]], [text("物料", "Vật tư", "Material"), cards[1]], [text("批次", "Lô", "Lot"), cards[2]], [text("数量", "Số lượng", "Quantity"), cards[3]]].map(([label, value]) => <div key={label} style={{ padding: 12, borderRadius: 10, background: "var(--surface-2)" }}><div style={{ color: "var(--muted)", fontSize: 11 }}>{label}</div><strong style={{ display: "block", marginTop: 5, wordBreak: "break-word" }}>{value}</strong></div>)}</div>
    </section>
    <MaterialRollQrGenerator key={source} locale={locale} prefill={prefill} />
  </div>;
}
