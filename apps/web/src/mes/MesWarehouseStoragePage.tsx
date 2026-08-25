import { useEffect, useRef, useState } from "react";
import { WarehouseScene3d } from "./WarehouseScene3d";
import { ProductWarehouseScene3d } from "./ProductWarehouseScene3d";
import { apiClient } from "../api/client";

type Locale = "zh-CN" | "en-US" | "vi-VN";

const COPY = {
  "zh-CN": { title: "仓库与线边存储 3D", subtitle: "WMS 实时库存、厂区存储区域与仓库货架统一视图", floor: "厂区与线边存储", warehouse: "成品仓库", fullscreen: "全屏浏览", exitFullscreen: "退出全屏", smart: "智能查询", showSmart: "显示智能查询", hideSmart: "隐藏智能查询", ask: "查询", placeholder: "询问库存、批次、供应商、IQC、工单或库位…", querying: "正在读取实时 WMS…" },
  "en-US": { title: "Warehouse & Floor Storage 3D", subtitle: "Unified WMS view of live inventory, floor storage areas, and warehouse racks", floor: "Floor & Line-side Storage", warehouse: "Finished Goods Warehouse", fullscreen: "Fullscreen", exitFullscreen: "Exit Fullscreen", smart: "Smart Query", showSmart: "Show Smart Query", hideSmart: "Hide Smart Query", ask: "Ask", placeholder: "Ask about stock, lots, suppliers, IQC, work orders, or locations…", querying: "Reading live WMS…" },
  "vi-VN": { title: "Kho và khu lưu trữ sàn 3D", subtitle: "Chế độ xem WMS thống nhất cho tồn kho, khu lưu trữ sàn và kệ kho theo thời gian thực", floor: "Lưu trữ sàn và cạnh chuyền", warehouse: "Kho thành phẩm", fullscreen: "Toàn màn hình", exitFullscreen: "Thoát toàn màn hình", smart: "Truy vấn thông minh", showSmart: "Hiện truy vấn thông minh", hideSmart: "Ẩn truy vấn thông minh", ask: "Tìm", placeholder: "Hỏi về tồn kho, lô, nhà cung cấp, IQC, lệnh hoặc vị trí…", querying: "Đang đọc WMS trực tiếp…" },
} as const;

export function MesWarehouseStoragePage({ locale }: { locale: Locale }) {
  const [view, setView] = useState<"floor" | "warehouse">("floor");
  const [fullscreen, setFullscreen] = useState(false);
  const [smartOpen, setSmartOpen] = useState(false);
  const [smartQuery, setSmartQuery] = useState("");
  const [smartAnswer, setSmartAnswer] = useState("");
  const [smartLoading, setSmartLoading] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const text = COPY[locale] ?? COPY["en-US"];
  const togglingRef = useRef(false);
  useEffect(() => {
    const update = () => {
      // Ignore browser events triggered by our own toggle — React state is already
      // set optimistically; only external exits (ESC key) should sync state.
      if (togglingRef.current) return;
      setFullscreen(document.fullscreenElement === pageRef.current);
    };
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  const toggleFullscreen = async () => {
    const next = !fullscreen;
    setFullscreen(next); // React state drives the CSS layout (100vh) — always responsive
    const target = pageRef.current;
    togglingRef.current = true;
    try {
      if (next) await target?.requestFullscreen?.();
      else if (document.fullscreenElement) await document.exitFullscreen();
    } catch (error) {
      // Browser API unavailable/headless: CSS fullscreen mode already applied above.
      console.warn("[3D WMS] fullscreen api fallback to CSS mode", error);
    } finally {
      togglingRef.current = false;
    }
  };
  const runSmartQuery = async (preset?: string) => {
    const query = (preset ?? smartQuery).trim();
    if (!query || smartLoading) return;
    setSmartQuery(query);
    setSmartLoading(true);
    setSmartAnswer("");
    try {
      const response = await apiClient.post<any>("/ai/query/inventory", { query, locale });
      const raw = response?.reply ?? response?.data?.reply ?? "—";
      // reply may be an object ({ sql, explanation }) — always surface readable text
      const text = typeof raw === "string" ? raw : String((raw as any)?.explanation ?? JSON.stringify(raw));
      setSmartAnswer(text);
    } catch (error) {
      setSmartAnswer(error instanceof Error ? error.message : String(error));
    } finally {
      setSmartLoading(false);
    }
  };
  return (
    <div ref={pageRef} className="surface-panel" style={{ padding: fullscreen ? 0 : 14, minHeight: fullscreen ? 0 : 780, width: fullscreen ? "100vw" : undefined, height: fullscreen ? "100vh" : undefined, boxSizing: "border-box", overflow: "hidden", background: "var(--surface)" }}>
      <div style={{ display: fullscreen ? "none" : "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div><h2 style={{ margin: 0 }}>{text.title}</h2><div style={{ marginTop: 4, color: "var(--muted)", fontSize: 13 }}>{text.subtitle}</div></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className={view === "floor" ? "active" : ""} onClick={() => setView("floor")}>{text.floor}</button>
          <button type="button" className={view === "warehouse" ? "active" : ""} onClick={() => setView("warehouse")}>{text.warehouse}</button>
          <button type="button" className={smartOpen ? "active" : ""} onClick={() => setSmartOpen(value => !value)}>⌕ {text.smart}</button>
          <button type="button" onClick={() => void toggleFullscreen()} style={{ fontWeight: 800 }}>{fullscreen ? text.exitFullscreen : text.fullscreen}</button>
        </div>
      </div>
      <div style={{ position: "relative", width: "100%", height: fullscreen ? "100vh" : "calc(100vh - 260px)", minHeight: fullscreen ? 0 : 680, overflow: "hidden", borderRadius: fullscreen ? 0 : 12, border: fullscreen ? 0 : "1px solid var(--border)", boxSizing: "border-box" }}>
        <button type="button" onClick={() => void toggleFullscreen()} style={{ position: "absolute", right: 16, top: 14, zIndex: 100, padding: "9px 14px", borderRadius: 8, border: "1px solid #38bdf8", background: "rgba(7,17,31,.94)", color: "#fff", fontWeight: 900, boxShadow: "0 6px 18px rgba(0,0,0,.3)" }}>{fullscreen ? text.exitFullscreen : text.fullscreen}</button>
        <button type="button" onClick={() => setSmartOpen(value => !value)} style={{ position: "absolute", right: 16, top: 58, zIndex: 100, padding: "9px 14px", borderRadius: 8, border: `1px solid ${smartOpen ? "#f59e0b" : "#22d3ee"}`, background: "rgba(7,17,31,.94)", color: "#fff", fontWeight: 900, boxShadow: "0 6px 18px rgba(0,0,0,.3)" }}>⌕ {smartOpen ? text.hideSmart : text.showSmart}</button>
        {smartOpen && <div style={{ position: "absolute", left: 16, top: 14, zIndex: 110, width: "min(620px, calc(100% - 190px))", padding: 12, borderRadius: 10, background: "rgba(7,17,31,.96)", color: "white", boxShadow: "0 8px 28px rgba(0,0,0,.38)" }}>
          <div style={{ fontWeight: 900, color: "#67e8f9", marginBottom: 8 }}>⌕ {text.smart} · LIVE WMS</div>
          <div style={{ display: "flex", gap: 7 }}><input value={smartQuery} onChange={event => setSmartQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void runSmartQuery(); }} placeholder={text.placeholder} style={{ flex: 1, minWidth: 0, padding: "9px 10px", borderRadius: 7, border: "1px solid #475569" }} /><button type="button" disabled={smartLoading} onClick={() => void runSmartQuery()} style={{ padding: "8px 14px", border: 0, borderRadius: 7, background: "#0891b2", color: "white", fontWeight: 800 }}>{text.ask}</button></div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 7 }}>{["查询 IQC HOLD 批次", "哪些物料库存不足", "按供应商汇总库存", "查找即将过期物料"].map(question => <button type="button" key={question} onClick={() => void runSmartQuery(question)} style={{ padding: "4px 7px", border: "1px solid #334155", borderRadius: 6, background: "#13263b", color: "#cbd5e1", fontSize: 11 }}>{question}</button>)}</div>
          {(smartLoading || smartAnswer) && <div style={{ marginTop: 9, maxHeight: 230, overflow: "auto", padding: 10, borderRadius: 7, background: "#0f243b", color: smartLoading ? "#fbbf24" : "#e2e8f0", whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.55 }}>{smartLoading ? text.querying : smartAnswer}</div>}
        </div>}
        {view === "floor" ? <WarehouseScene3d /> : <ProductWarehouseScene3d />}
      </div>
    </div>
  );
}
