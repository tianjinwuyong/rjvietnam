import { useEffect, useState, useMemo } from "react";
import { ArrowLeftRight, Plus, Package, MapPin, History } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api";

type Tab = "transfer" | "adjust";

interface TxRecord {
  id: number;
  txNo: string;
  action: "TRANSFER" | "ADJUST";
  materialCode: string;
  lotNo: string;
  qty: number;
  fromLocation: string;
  toLocation: string;
  operator: string;
  occurredAt: string;
  reason?: string;
}

const _mockTxs: TxRecord[] = [
  { id: 1, txNo: "TX-20250627-001", action: "TRANSFER", materialCode: "CAP-CER-100UF", lotNo: "LOT-20250627-001", qty: 2000, fromLocation: "RCV-A", toLocation: "STORE-001-A1", operator: "VN_WHS_001", occurredAt: "2025-06-27 08:30", reason: "" },
  { id: 2, txNo: "TX-20250627-002", action: "ADJUST", materialCode: "RES-SMD-10K", lotNo: "LOT-20250625-003", qty: -50, fromLocation: "STORE-001-A1", toLocation: "", operator: "VN_WHS_002", occurredAt: "2025-06-27 09:15", reason: "盘点差异调整" },
  { id: 3, txNo: "TX-20250626-001", action: "TRANSFER", materialCode: "IC-MCU-STM32", lotNo: "LOT-20250622-005", qty: 100, fromLocation: "IQC-HOLD", toLocation: "STORE-001-B2", operator: "VN_WHS_001", occurredAt: "2025-06-26 14:00", reason: "IQC放行后入仓" },
  { id: 4, txNo: "TX-20250625-001", action: "ADJUST", materialCode: "LED-RED-0805", lotNo: "LOT-20250620-002", qty: 500, fromLocation: "RCV-B", toLocation: "STORE-002-C3", operator: "VN_WHS_001", occurredAt: "2025-06-25 10:30", reason: "收货录入修正" },
  { id: 5, txNo: "TX-20250624-001", action: "TRANSFER", materialCode: "CONN-USB-C-30P", lotNo: "LOT-20250623-004", qty: 3000, fromLocation: "STORE-002-C3", toLocation: "LINE-01-FEEDER", operator: "VN_WHS_003", occurredAt: "2025-06-24 07:45", reason: "产线发料" },
  { id: 6, txNo: "TX-20250624-002", action: "ADJUST", materialCode: "RES-SMD-10K", lotNo: "LOT-20250625-003", qty: -20, fromLocation: "STORE-001-A1", toLocation: "", operator: "VN_WHS_002", occurredAt: "2025-06-24 11:00", reason: "损耗报废" },
];

export function WmsTransferAdjust({ locale }: { locale: Locale }) {
  const [tab, setTab] = useState<Tab>("transfer");
  const [txs, setTxs] = useState<TxRecord[]>([]);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [tForm, setTForm] = useState({ lotNo: "", fromLoc: "", toLoc: "", qty: 0 });
  const [aForm, setAForm] = useState({ lotNo: "", qty: 0, reason: "" });

  const loadTransactions = async () => {
    const response = await wmsApi.getTransactions({ limit: 100 });
    setTxs(response.items
      .filter((item) => item.action === "TRANSFER" || item.action === "ADJUST")
      .map((item) => ({
        id: Number(item.id),
        txNo: item.txNo,
        action: item.action as TxRecord["action"],
        materialCode: item.materialCode ?? "-",
        lotNo: item.lotNo ?? item.lots?.[0]?.lotNo ?? "-",
        qty: Number(item.qty),
        fromLocation: item.fromLocation ?? "",
        toLocation: item.toLocation ?? "",
        operator: item.operator ?? "-",
        occurredAt: item.occurredAt,
      })));
  };

  useEffect(() => {
    void loadTransactions().catch((error) => {
      setFeedback({ ok: false, msg: error instanceof Error ? error.message : String(error) });
    });
  }, []);

  const doTransfer = async () => {
    if (!tForm.lotNo || !tForm.toLoc || !tForm.qty) return;
    setBusy(true);
    try {
      await wmsApi.postTransaction("TRANSFER", { lotNo: tForm.lotNo, qty: tForm.qty, fromLocation: tForm.fromLoc, toLocation: tForm.toLoc });
      await loadTransactions();
      setFeedback({ ok: true, msg: `${t("wms.transferDone", locale)}: ${tForm.lotNo} → ${tForm.toLoc}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFeedback({ ok: false, msg: `${tForm.lotNo}: ${msg}` });
    } finally {
      setTForm({ lotNo: "", fromLoc: "", toLoc: "", qty: 0 });
      setBusy(false);
    }
  };

  const doAdjust = async () => {
    if (!aForm.lotNo || !aForm.qty) return;
    setBusy(true);
    try {
      await wmsApi.postTransaction("ADJUST", { lotNo: aForm.lotNo, qty: aForm.qty, reason: aForm.reason });
      await loadTransactions();
      setFeedback({ ok: true, msg: `${t("wms.adjustDone", locale)}: ${aForm.lotNo} (${aForm.qty >= 0 ? "+" : ""}${aForm.qty})` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFeedback({ ok: false, msg: `${aForm.lotNo}: ${msg}` });
    } finally {
      setAForm({ lotNo: "", qty: 0, reason: "" });
      setBusy(false);
    }
  };

  const filteredTxs = useMemo(() => txs.filter((tx) => tx.action === (tab === "transfer" ? "TRANSFER" : "ADJUST")), [txs, tab]);

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2><ArrowLeftRight size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />{t("wms.subnav.transferAdjust", locale)}</h2>
            <p>{t("wms.txLogDesc", locale)}</p>
          </div>
          <div className="toolbar" style={{ gap: 4 }}>
            <button className="action-button" type="button"
              style={{ background: tab === "transfer" ? "var(--info)" : "var(--nav)", color: tab === "transfer" ? "#fff" : "var(--fg)" }}
              onClick={() => setTab("transfer")}>
              <ArrowLeftRight size={14} /> {t("wms.transfer", locale)}
            </button>
            <button className="action-button" type="button"
              style={{ background: tab === "adjust" ? "var(--warn)" : "var(--nav)", color: tab === "adjust" ? "#fff" : "var(--fg)" }}
              onClick={() => setTab("adjust")}>
              <Plus size={14} /> {t("wms.adjust", locale)}
            </button>
          </div>
        </div>
      </section>

      <section className="surface-panel">
        {tab === "transfer" ? (
          <>
            <div className="section-header"><div><h3>{t("wms.doTransfer", locale)}</h3></div></div>
            <div className="toolbar" style={{ gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <Package size={14} />
                <input className="input" style={{ padding: "4px 10px", width: 140 }} placeholder={t("common.lot", locale)}
                  value={tForm.lotNo} onChange={(e) => setTForm((p) => ({ ...p, lotNo: e.target.value }))} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <MapPin size={14} />
                <input className="input" style={{ padding: "4px 10px", width: 120 }} placeholder={t("wms.fromLocation", locale)}
                  value={tForm.fromLoc} onChange={(e) => setTForm((p) => ({ ...p, fromLoc: e.target.value }))} />
              </div>
              <ArrowLeftRight size={14} color="var(--muted)" />
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <MapPin size={14} />
                <input className="input" style={{ padding: "4px 10px", width: 120 }} placeholder={t("wms.toLocation", locale)}
                  value={tForm.toLoc} onChange={(e) => setTForm((p) => ({ ...p, toLoc: e.target.value }))} />
              </div>
              <input className="input" type="number" style={{ padding: "4px 10px", width: 80 }} placeholder={t("common.qty", locale)}
                value={tForm.qty || ""} onChange={(e) => setTForm((p) => ({ ...p, qty: Number(e.target.value) }))} />
              <button className="action-button" type="button" style={{ background: "var(--ok)" }} disabled={busy} onClick={doTransfer}>
                <ArrowLeftRight size={14} /> {t("wms.confirmTransfer", locale)}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="section-header"><div><h3>{t("wms.doAdjust", locale)}</h3></div></div>
            <div className="toolbar" style={{ gap: 12, flexWrap: "wrap" }}>
              <input className="input" style={{ padding: "4px 10px", width: 140 }} placeholder={t("common.lot", locale)}
                value={aForm.lotNo} onChange={(e) => setAForm((p) => ({ ...p, lotNo: e.target.value }))} />
              <input className="input" type="number" style={{ padding: "4px 10px", width: 100 }} placeholder={t("wms.newQty", locale)}
                value={aForm.qty || ""} onChange={(e) => setAForm((p) => ({ ...p, qty: Number(e.target.value) }))} />
              <input className="input" style={{ padding: "4px 10px", width: 200 }} placeholder={t("wms.adjustReason", locale)}
                value={aForm.reason} onChange={(e) => setAForm((p) => ({ ...p, reason: e.target.value }))} />
              <button className="action-button" type="button" style={{ background: "var(--warn)" }} disabled={busy} onClick={doAdjust}>
                <Plus size={14} /> {t("wms.confirmAdjust", locale)}
              </button>
            </div>
          </>
        )}
        {feedback && (
          <div style={{ marginTop: 8, padding: "6px 12px", borderRadius: 6, background: feedback.ok ? "var(--ok-bg)" : "var(--danger-bg)", color: feedback.ok ? "var(--ok)" : "var(--danger)", fontSize: 13 }}>
            {feedback.msg}
          </div>
        )}
      </section>

      <section className="surface-panel">
        <div className="section-header">
          <div><h3><History size={14} style={{ marginRight: 6 }} />{t("wms.transactionHistory", locale)}</h3></div>
        </div>
        <div className="table-shell" style={{ maxHeight: 320, overflow: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>{t("wms.txNo", locale)}</th>
                <th>{t("common.date", locale)}</th>
                <th>{t("common.action", locale)}</th>
                <th>{t("common.material", locale)}</th>
                <th>{t("common.lot", locale)}</th>
                <th>{t("common.qty", locale)}</th>
                <th>{t("wms.fromLocation", locale)}</th>
                <th>{t("wms.toLocation", locale)}</th>
                <th>{t("common.operator", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {filteredTxs.map((tx) => (
                <tr key={tx.id}>
                  <td><code style={{ fontSize: 10 }}>{tx.txNo}</code></td>
                  <td style={{ whiteSpace: "nowrap", fontSize: 11 }}>{tx.occurredAt}</td>
                  <td><span className={`badge badge-${tx.action === "TRANSFER" ? "info" : "warning"}`}>{tx.action}</span></td>
                  <td><strong style={{ fontSize: 12 }}>{tx.materialCode}</strong></td>
                  <td><code style={{ fontSize: 10 }}>{tx.lotNo}</code></td>
                  <td>{tx.qty.toLocaleString()}</td>
                  <td style={{ fontSize: 12 }}>{tx.fromLocation || "—"}</td>
                  <td style={{ fontSize: 12 }}>{tx.toLocation || "—"}</td>
                  <td style={{ fontSize: 12 }}>{tx.operator}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
// @ts-nocheck
