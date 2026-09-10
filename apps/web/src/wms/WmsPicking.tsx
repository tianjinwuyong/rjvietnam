import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardCheck, RefreshCw, Search } from "lucide-react";
import { t } from "../i18n";
import type { Locale, PickOrder, PickOrderItem } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api";
import { WmsMaterialFetchFlow } from "./WmsMaterialFetchFlow";

type PickRow = { order: PickOrder; item: PickOrderItem };

export function WmsPicking({ locale }: { locale: Locale }) {
  const [pickOrders, setPickOrders] = useState<PickOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [workOrderInput, setWorkOrderInput] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const loadPickOrders = useCallback(async (workOrderCode?: string) => {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await wmsApi.getPickOrders(workOrderCode);
      setPickOrders(res.items);
      if (workOrderCode && res.items.length === 0) setFeedback({ ok: false, msg: `${workOrderCode}: ${t("common.noData", locale)}` });
    } catch (error) {
      setPickOrders([]);
      setFeedback({ ok: false, msg: error instanceof Error ? error.message : t("common.error", locale) });
    } finally {
      setLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    const trimmed = workOrderInput.trim();
    const timer = setTimeout(() => void loadPickOrders(trimmed.length >= 4 ? trimmed : undefined), trimmed ? 400 : 0);
    return () => clearTimeout(timer);
  }, [workOrderInput, loadPickOrders]);

  const rows = useMemo<PickRow[]>(() => pickOrders.flatMap((order) => order.items
    .filter((item) => (item.pickedQty ?? 0) < item.requiredQty)
    .map((item) => ({ order, item }))), [pickOrders]);

  const confirmPick = async (order: PickOrder, item: PickOrderItem) => {
    if (!item.lotNo) return;
    try {
      await wmsApi.postTransaction("PICK", { lotNo: item.lotNo, workOrderCode: order.workOrderCode, qty: item.requiredQty - (item.pickedQty ?? 0), operator: "VN_WH_010" });
      setFeedback({ ok: true, msg: `${item.materialCode}: ${t("wms.pickConfirm", locale)}` });
      await loadPickOrders(workOrderInput.trim().length >= 4 ? workOrderInput.trim() : undefined);
    } catch (error) {
      setFeedback({ ok: false, msg: error instanceof Error ? error.message : t("common.error", locale) });
    }
  };

  return <div className="screen-stack">
    <section className="surface-panel">
      <div className="section-header">
        <div><h2>{t("wms.pickQueue", locale)}</h2><p>{t("wms.pickQueueTip", locale)}</p></div>
        <button className="action-button" type="button" title={t("common.refresh", locale)} onClick={() => void loadPickOrders(workOrderInput.trim() || undefined)} disabled={loading}><RefreshCw size={16} /> {t("common.refresh", locale)}</button>
      </div>
      <div className="scan-input" style={{ maxWidth: 480 }}><Search size={24} /><input value={workOrderInput} onChange={(e) => setWorkOrderInput(e.target.value.toUpperCase())} placeholder={t("wms.pickByWO", locale)} title={t("ui.scanInput", locale)} />{loading && <span style={{ color: "var(--muted)", fontSize: 12 }}>...</span>}</div>
    </section>

    <WmsMaterialFetchFlow locale={locale} workOrderCode={workOrderInput.trim() || undefined} />

    <section className="surface-panel"><div className="table-shell"><table>
      <thead><tr>
        <th>{t("wms.pickNeed", locale)}</th><th>{t("common.workOrder", locale)}</th><th>{t("common.line", locale)}</th><th>{t("common.material", locale)}</th><th>{locale === "vi-VN" ? "Mã Ruijing" : locale === "zh-CN" ? "瑞晶编码" : "Ruijing code"}</th><th>{t("wms.latestFetchTime", locale)}</th><th>{t("common.requiredQty", locale) || t("common.qty", locale)}</th><th>{t("common.picked", locale)}</th><th>{t("wms.materialSn", locale)}</th><th>{t("common.lot", locale)}</th><th>{t("common.location", locale)}</th><th>{t("wms.scrappedQty", locale)}</th><th>{t("wms.returnedQty", locale)}</th><th>{t("common.action", locale)}</th>
      </tr></thead>
      <tbody>
        {rows.map(({ order, item }) => { const remaining = item.requiredQty - (item.pickedQty ?? 0); return <tr key={`${order.id}-${item.id}`}>
          <td><span className="badge badge-warning" title={t("ui.statusIndicator", locale)}>{t("status.pending", locale)}</span></td><td><strong>{order.workOrderCode}</strong></td><td>{order.lineCode || "—"}</td><td><strong>{item.materialCode}</strong></td><td>{item.ruijingCode || "—"}</td><td>{item.latestFetchTime ? new Date(item.latestFetchTime).toLocaleString(locale) : "—"}</td><td>{item.requiredQty.toLocaleString()}</td><td>{(item.pickedQty ?? 0).toLocaleString()} / {remaining.toLocaleString()}</td><td>{item.materialSn || "—"}</td><td>{item.lotNo || "—"}</td><td>{item.locationCode || "—"}</td><td>{(item.scrappedQty ?? 0).toLocaleString()}</td><td>{(item.returnedQty ?? 0).toLocaleString()}</td><td><button className="action-button" type="button" title={item.lotNo ? t("wms.pickConfirm", locale) : t("wms.fifo.noLots", locale)} disabled={!item.lotNo} onClick={() => void confirmPick(order, item)}><ClipboardCheck size={14} /></button></td>
        </tr>; })}
        {!loading && rows.length === 0 && <tr><td colSpan={14} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>{t("common.noData", locale)}</td></tr>}
      </tbody>
    </table></div></section>
    {feedback && <div style={{ padding: "6px 12px", borderRadius: 6, background: feedback.ok ? "var(--ok-bg)" : "var(--danger-bg)", color: feedback.ok ? "var(--ok)" : "var(--danger)", fontSize: 13 }}>{feedback.msg}</div>}
  </div>;
}
