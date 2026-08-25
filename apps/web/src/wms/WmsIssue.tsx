import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Barcode, CheckCircle, Package, XCircle, RotateCcw, Trash2, Clock, AlertTriangle, ChevronDown } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import type { PickOrder, PickOrderItem } from "../../../../packages/shared-types/src/factory";
import { wmsApi, type InventoryTransaction } from "../api/wms";
import { inventoryTransactions as _demoTxs, materialLots as _demoLots } from "../data";
import { WmsReturnFlow, type ReturnRecord } from "./WmsReturnFlow";
import { WmsScrapFlow, type ScrapRecord } from "./WmsScrapFlow";

interface IssueLineItem extends PickOrderItem {
  issued: boolean;
  scannedReel?: string;
  issuedAt?: string;
}function txSeq(prefix: string): string {
  return `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(Math.floor(Math.random() * 999) + 1).padStart(3, "0")}`;
}

export function WmsIssue({ locale }: { locale: Locale }) {
  const [step, setStep] = useState<"select" | "confirm">("select");
  const [workOrderInput, setWorkOrderInput] = useState("");
  const [workOrders, setWorkOrders] = useState<PickOrder[]>([]);
  const [selectedWo, setSelectedWo] = useState<string | null>(null);
  const [lineItems, setLineItems] = useState<IssueLineItem[]>([]);
  const [scanInput, setScanInput] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [txLog, setTxLog] = useState<InventoryTransaction[]>([..._demoTxs as unknown as InventoryTransaction[]]);
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [scraps, setScraps] = useState<ScrapRecord[]>([]);
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scanRef.current?.focus();
  }, [step]);

  const loadWorkOrder = useCallback(async (woCode: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await wmsApi.getPickOrdersByWorkOrder(woCode);
      if (res.items.length === 0) {
        setFeedback({ ok: false, msg: `${woCode}: ${t("common.noData", locale)}` });
        setBusy(false);
        return;
      }
      const order = res.items[0];
      setSelectedWo(woCode);
      setLineItems(
        order.items
          .filter((it) => (it.pickedQty ?? 0) < it.requiredQty)
          .map((it) => ({ ...it, issued: false })),
      );
      setStep("confirm");
    } catch {
      setFeedback({ ok: false, msg: String(t("common.error", locale)) });
    } finally {
      setBusy(false);
    }
  }, [locale]);

  const handleScan = useCallback(() => {
    const reel = scanInput.trim().toUpperCase();
    if (!reel) return;

    const matchIdx = lineItems.findIndex(
      (it) => !it.issued && ((it.lotNo ?? "").toUpperCase().includes(reel) || it.materialCode.toUpperCase().includes(reel)),
    );

    if (matchIdx === -1) {
      setFeedback({ ok: false, msg: `${reel}: ${t("wms.lotNotFound", locale) ?? "Lot not found in issue list"}` });
      setScanInput("");
      scanRef.current?.focus();
      return;
    }

    const item = lineItems[matchIdx];
    const now = new Date().toISOString();
    const issuedQty = (item.requiredQty ?? 0) - (item.pickedQty ?? 0);

    setLineItems((prev) => {
      const updated = [...prev];
      updated[matchIdx] = { ...updated[matchIdx], issued: true, scannedReel: reel, issuedAt: now };
      return updated;
    });

    const txNo = txSeq("ISS");
    const tx: InventoryTransaction = {
      id: txSeq("TX"),
      txNo,
      action: "ISSUE_TO_LINE",
      materialLotId: item.id ? String(item.id) : undefined,
      materialCode: item.materialCode,
      lotNo: item.lotNo ?? reel,
      qty: issuedQty,
      fromLocation: item.locationCode ?? "B02-01-01",
      workOrderCode: selectedWo ?? "",
      operator: "VN_WH_010",
      occurredAt: now,
      txStatus: "completed",
    };
    setTxLog((prev) => [tx, ...prev]);

    setFeedback({ ok: true, msg: `${reel}: ${t("status.issued", locale)} (${txNo})` });
    setScanInput("");
    scanRef.current?.focus();
  }, [scanInput, lineItems, selectedWo, locale]);

  const handleIssueAll = useCallback(async () => {
    if (!selectedWo) return;
    setBusy(true);
    try {
      for (const item of lineItems.filter((it) => !it.issued)) {
        const now = new Date().toISOString();
        const issuedQty = (item.requiredQty ?? 0) - (item.pickedQty ?? 0);
        const txNo = txSeq("ISS");
        const tx: InventoryTransaction = {
          id: txSeq("TX"),
          txNo,
          action: "ISSUE_TO_LINE",
          materialLotId: item.id ? String(item.id) : undefined,
          materialCode: item.materialCode,
          lotNo: item.lotNo ?? "",
          qty: issuedQty,
          fromLocation: item.locationCode ?? "B02-01-01",
          workOrderCode: selectedWo,
          operator: "VN_WH_010",
          occurredAt: now,
          txStatus: "completed",
        };
        setTxLog((prev) => [tx, ...prev]);
      }
      setLineItems((prev) => prev.map((it) => ({ ...it, issued: true, issuedAt: new Date().toISOString() })));
      setFeedback({ ok: true, msg: `${selectedWo}: ${t("wms.issueComplete", locale) ?? "Issue complete"}` });
    } catch {
      setFeedback({ ok: false, msg: String(t("common.error", locale)) });
    } finally {
      setBusy(false);
    }
  }, [selectedWo, lineItems, locale]);

  const allIssued = lineItems.length > 0 && lineItems.every((it) => it.issued);
  const pendingCount = lineItems.filter((it) => !it.issued).length;

  const selectedWoLine = workOrders.find((wo) => wo.workOrderCode === selectedWo)?.lineCode;

  return (
    <div className="screen-stack">
      {step === "select" && (
        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h2>{t("wms.issueToLine", locale)}</h2>
              <p>{t("wms.scanReelToIssue", locale)}</p>
            </div>
          </div>

          <div className="scan-input" style={{ maxWidth: 520 }}>
            <Barcode size={24} />
            <input
              value={workOrderInput}
              onChange={(e) => setWorkOrderInput(e.target.value.toUpperCase())}
              placeholder={t("wms.scanWorkOrder", locale) ?? "Scan / enter work order"}
              title={t("ui.scanInput", locale)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && workOrderInput.trim()) {
                  loadWorkOrder(workOrderInput.trim());
                }
              }}
            />
            <button
              className="action-button"
              type="button"
              style={{ background: "var(--ok)" }}
              disabled={!workOrderInput.trim() || busy}
              onClick={() => workOrderInput.trim() && loadWorkOrder(workOrderInput.trim())}
            >
              <ArrowRight size={16} />
            </button>
          </div>

          {feedback && (
            <div style={{
              marginTop: 8, padding: "6px 12px", borderRadius: 6,
              background: feedback.ok ? "var(--ok-bg)" : "var(--danger-bg)",
              color: feedback.ok ? "var(--ok)" : "var(--danger)", fontSize: 13,
            }}>
              {feedback.msg}
            </div>
          )}

          {/* Quick demo WO loader */}
          <div style={{ marginTop: 16, padding: "12px", border: "1px dashed rgba(238,248,250,0.2)", borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>{t("wms.demoWorkOrders", locale) ?? "Demo work orders"}:</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {["26061010008", "26061020003"].map((wo) => (
                <button key={wo} type="button" className="action-button" style={{ background: "var(--nav)", fontSize: 12 }} onClick={() => { setWorkOrderInput(wo); loadWorkOrder(wo); }}>
                  {wo}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {step === "confirm" && selectedWo && (
        <>
          <section className="surface-panel">
            <div className="section-header">
              <div>
                <h2>{selectedWo} <span style={{ fontSize: 13, color: "var(--muted)" }}>· Line {selectedWoLine ?? "—"}</span></h2>
                <p>{pendingCount} {t("common.pending", locale)} · {lineItems.length} {t("wms.items", locale)}</p>
              </div>
              <div className="toolbar">
                <button
                  type="button"
                  className="action-button"
                  style={{ background: "var(--muted)" }}
                  onClick={() => { setStep("select"); setSelectedWo(null); setLineItems([]); }}
                >
                  {t("common.back", locale) ?? "Back"}
                </button>
                <button
                  type="button"
                  className="action-button"
                  style={{ background: pendingCount > 0 ? "var(--warn)" : "var(--muted)" }}
                  disabled={pendingCount === 0 || busy}
                  onClick={handleIssueAll}
                >
                  <ArrowRight size={14} />
                  {t("wms.issueAll", locale) ?? "Issue All"}
                </button>
              </div>
            </div>

            <div className="scan-input" style={{ maxWidth: 520, marginBottom: 16 }} >
              <Barcode size={24} />
              <input
                ref={scanRef}
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value.toUpperCase())}
                placeholder={t("wms.scanReel", locale) ?? "Scan reel / lot barcode"}
                title={t("ui.scanInput", locale)}
                onKeyDown={(e) => { if (e.key === "Enter") handleScan(); }}
                autoFocus
              />
              <button
                className="action-button"
                type="button"
                style={{ background: "var(--ok)" }}
                onClick={handleScan}
              >
                <CheckCircle size={16} />
              </button>
            </div>

            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>{t("common.status", locale)}</th>
                    <th>{t("common.material", locale)}</th>
                    <th>{t("common.lot", locale)}</th>
                    <th>{t("common.location", locale)}</th>
                    <th>{t("wms.issueQty", locale)}</th>
                    <th>{t("common.scanned", locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((it, idx) => (
                    <tr key={idx} style={{ opacity: it.issued ? 0.55 : 1 }}>
                      <td>
                        {it.issued
                          ? <CheckCircle size={16} color="var(--ok)" />
                          : <XCircle size={16} color="var(--muted)" />}
                      </td>
                      <td>
                        <strong>{it.materialCode}</strong>
                        <span style={{ color: "var(--muted)", fontSize: 12, display: "block" }}>
                          {String(it.materialName ?? "—")}
                        </span>
                      </td>
                      <td>{it.lotNo ?? "—"}</td>
                      <td>{it.locationCode ?? "—"}</td>
                      <td>{((it.requiredQty ?? 0) - (it.pickedQty ?? 0)).toLocaleString()}</td>
                      <td>
                        {it.scannedReel
                          ? <span style={{ color: "var(--ok)", fontSize: 12 }}>{it.scannedReel}</span>
                          : <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {allIssued && (
              <div style={{ marginTop: 12, padding: "12px 16px", borderRadius: 6, background: "var(--ok-bg)", color: "var(--ok)", fontSize: 14 }}>
                <CheckCircle size={16} style={{ verticalAlign: "middle", marginRight: 6 }} />
                {t("wms.issueComplete", locale) ?? "All items issued to line"}
              </div>
            )}
          </section>

          {/* Return + Scrap side by side */}
          <section className="surface-panel">
            <div className="section-header">
              <div>
                <h3>{t("wms.returnScrap", locale)}</h3>
                <p>{t("wms.returnScrapDesc", locale)}</p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <WmsReturnFlow
                locale={locale}
                txLog={txLog}
                onReturn={(r) => {
                  setReturns((prev) => [r, ...prev]);
                  const tx: InventoryTransaction = {
                    id: txSeq("TX"),
                    txNo: txSeq("RTN"),
                    action: "RETURN_FROM_LINE",
                    materialLotId: r.lotNo,
                    materialCode: r.materialCode,
                    lotNo: r.lotNo,
                    qty: r.qty,
                    toLocation: r.locationCode,
                    workOrderCode: r.workOrderCode,
                    operator: r.operator,
                    occurredAt: r.returnedAt,
                    txStatus: "completed",
                  };
                  setTxLog((prev) => [tx, ...prev]);
                }}
              />
              <WmsScrapFlow
                locale={locale}
                onScrap={(s) => {
                  setScraps((prev) => [s, ...prev]);
                  const tx: InventoryTransaction = {
                    id: txSeq("TX"),
                    txNo: txSeq("SCP"),
                    action: "SCRAP",
                    materialLotId: s.lotNo,
                    materialCode: s.materialCode,
                    lotNo: s.lotNo,
                    qty: s.qty,
                    operator: s.operator,
                    occurredAt: s.createdAt,
                    txStatus: "pending",
                  };
                  setTxLog((prev) => [tx, ...prev]);
                }}
              />
            </div>
          </section>

          {/* Recent Transaction Log */}
          <section className="surface-panel">
            <div className="section-header">
              <div>
                <h3><Clock size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />{t("wms.txLog", locale)}</h3>
                <p>{t("wms.txLogDesc", locale)}</p>
              </div>
            </div>
            <div className="table-shell" style={{ maxHeight: 320, overflow: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>{t("common.time", locale)}</th>
                    <th>{t("common.txNo", locale)}</th>
                    <th>{t("common.action", locale)}</th>
                    <th>{t("common.material", locale)}</th>
                    <th>{t("common.lot", locale)}</th>
                    <th>{t("common.qty", locale)}</th>
                    <th>{t("common.location", locale)}</th>
                    <th>{t("common.workOrder", locale)}</th>
                    <th>{t("common.operator", locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {txLog.slice(0, 30).map((tx) => {
                    const actionColor = tx.action === "SCRAP" ? "var(--danger)" : tx.action === "RETURN_FROM_LINE" ? "var(--warn)" : "var(--ok)";
                    return (
                      <tr key={tx.id} style={{ fontSize: 12 }}>
                        <td style={{ whiteSpace: "nowrap" }}>{new Date(tx.occurredAt).toLocaleString()}</td>
                        <td><span style={{ fontSize: 11, color: "var(--muted)" }}>{tx.txNo}</span></td>
                        <td><span style={{ color: actionColor, fontWeight: 600, fontSize: 11 }}>{tx.action}</span></td>
                        <td>{tx.materialCode}</td>
                        <td>{tx.lotNo}</td>
                        <td>{tx.qty.toLocaleString()}</td>
                        <td>{tx.fromLocation ?? tx.toLocation ?? "—"}</td>
                        <td>{tx.workOrderCode ?? "—"}</td>
                        <td>{tx.operator ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Return/Scrap history */}
          {(returns.length > 0 || scraps.length > 0) && (
            <section className="surface-panel">
              <div className="section-header">
                <div>
                  <h3><RotateCcw size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />{t("wms.returnHistory", locale)}</h3>
                  <h3 style={{ marginLeft: 24 }}><Trash2 size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />{t("wms.scrapHistory", locale)}</h3>
                </div>
              </div>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                {returns.length > 0 && (
                  <div style={{ flex: 1, minWidth: 300 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>{t("common.time", locale)}</th>
                          <th>{t("common.lot", locale)}</th>
                          <th>{t("common.qty", locale)}</th>
                          <th>{t("wms.reason", locale)}</th>
                          <th>{t("common.workOrder", locale)}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {returns.map((r) => (
                          <tr key={r.id} style={{ fontSize: 12 }}>
                            <td>{new Date(r.returnedAt).toLocaleString()}</td>
                            <td>{r.lotNo}</td>
                            <td style={{ color: "var(--warn)" }}>+{r.qty.toLocaleString()}</td>
                            <td>{r.reason}</td>
                            <td>{r.workOrderCode}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {scraps.length > 0 && (
                  <div style={{ flex: 1, minWidth: 300 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>{t("common.time", locale)}</th>
                          <th>{t("common.lot", locale)}</th>
                          <th>{t("common.qty", locale)}</th>
                          <th>{t("wms.reason", locale)}</th>
                          <th>{t("wms.status", locale)}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scraps.map((s) => (
                          <tr key={s.id} style={{ fontSize: 12 }}>
                            <td>{new Date(s.createdAt).toLocaleString()}</td>
                            <td>{s.lotNo}</td>
                            <td style={{ color: "var(--danger)" }}>-{s.qty.toLocaleString()}</td>
                            <td>{s.reason}</td>
                            <td>
                              <span className={`badge badge-${s.status === "approved" ? "ok" : s.status === "rejected" ? "danger" : "warning"}`}>
                                {s.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          )}
        </>
      )}

      {feedback && step === "confirm" && (
        <div style={{
          padding: "6px 12px", borderRadius: 6,
          background: feedback.ok ? "var(--ok-bg)" : "var(--danger-bg)",
          color: feedback.ok ? "var(--ok)" : "var(--danger)", fontSize: 13,
        }}>
          {feedback.msg}
        </div>
      )}
    </div>
  );
}
// @ts-nocheck
