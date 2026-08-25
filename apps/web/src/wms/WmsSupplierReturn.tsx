import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle, RotateCcw, Truck } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api";
import type { MaterialLot } from "../api";

const RETURN_REASON_OPTIONS = [
  { code: "IQC_FAIL", label_zh: "IQC不合格", label_en: "IQC failed", label_vi: "IQC không đạt" },
  { code: "WRONG_MATERIAL", label_zh: "物料错误", label_en: "Wrong material", label_vi: "Sai vật liệu" },
  { code: "OVER_DELIVERY", label_zh: "超量交付", label_en: "Over delivery", label_vi: "Giao thừa" },
  { code: "DAMAGED", label_zh: "运输损坏", label_en: "Shipping damage", label_vi: "Hư hỏng vận chuyển" },
  { code: "OTHER", label_zh: "其他", label_en: "Other", label_vi: "Khác" },
];

export function WmsSupplierReturn({ locale }: { locale: Locale }) {
  const [step, setStep] = useState<"list" | "confirm">("list");
  const [rejectedLots, setRejectedLots] = useState<MaterialLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLot, setSelectedLot] = useState<MaterialLot | null>(null);
  const [returnQty, setReturnQty] = useState("");
  const [reason, setReason] = useState("IQC_FAIL");
  const [supplierName, setSupplierName] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Load both rejected (already scrapped) and hold (pending IQC decision) lots
    Promise.all([
      wmsApi.getMaterialLots({ iqcStatus: "rejected", limit: 200 }),
      wmsApi.getMaterialLots({ iqcStatus: "hold", limit: 200 }),
    ]).then(([rejectedRes, holdRes]) => {
      setRejectedLots([...rejectedRes.items, ...holdRes.items]);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const langKey = locale === "zh-CN" ? "label_zh" : locale === "en-US" ? "label_en" : "label_vi";

  const handleSelect = (lot: MaterialLot) => {
    setSelectedLot(lot);
    setReturnQty(String(lot.qty ?? 0));
    setReason("IQC_FAIL");
    setSupplierName("");
    setFeedback(null);
    setStep("confirm");
  };

  const handleReturn = async () => {
    if (!selectedLot) return;
    const qtyNum = Number(returnQty);
    if (!qtyNum || qtyNum <= 0) {
      setFeedback({ ok: false, msg: String(t("wms.qtyRequired", locale)) });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      await wmsApi.supplierReturn({
        lotNo: selectedLot.lotNo,
        materialCode: selectedLot.materialCode,
        supplierCode: selectedLot.supplierCode ?? "",
        returnQty: qtyNum,
        reason: `${reason}${supplierName ? ` [${supplierName}]` : ""}`,
        operator: "VN_WH_010",
      });
      setRejectedLots((prev) => prev.filter((l) => l.id !== selectedLot.id));
      setFeedback({ ok: true, msg: `${selectedLot.lotNo}: ${t("wms.supplierReturnSuccess", locale) ?? "Supplier return recorded"}` });
      setTimeout(() => {
        setStep("list");
        setSelectedLot(null);
      }, 1500);
    } catch (err) {
      setFeedback({ ok: false, msg: String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.supplierReturn", locale)}</h2>
            <p>{t("wms.supplierReturnSubtitle", locale)}</p>
          </div>
        </div>
      </section>

      {step === "confirm" && selectedLot && (
        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h2>{selectedLot.lotNo}</h2>
              <p>{selectedLot.materialCode} · {(selectedLot.qty ?? 0).toLocaleString()} {t("common.units", locale)}</p>
              <p style={{ fontSize: 12, color: "var(--muted)" }}>
                {t("wms.supplier", locale)}: {selectedLot.supplierCode ?? "—"}
              </p>
            </div>
            <div className="toolbar">
              <button
                type="button"
                className="action-button"
                style={{ background: "var(--muted)" }}
                onClick={() => { setStep("list"); setSelectedLot(null); setFeedback(null); }}
              >
                <ArrowLeft size={14} />
                {t("common.back", locale)}
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gap: 16, maxWidth: 480 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("wms.returnQty", locale)}</span>
              <input
                type="number"
                className="input"
                value={returnQty}
                min={1}
                max={selectedLot.qty ?? 0}
                onChange={(e) => setReturnQty(e.target.value)}
                style={{ fontSize: 16 }}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("wms.returnReason", locale)}</span>
              <select
                className="input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                style={{ fontSize: 14 }}
              >
                {RETURN_REASON_OPTIONS.map((opt) => (
                  <option key={opt.code} value={opt.code}>{opt[langKey]}</option>
                ))}
              </select>
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("wms.supplierName", locale)}</span>
              <input
                type="text"
                className="input"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder={selectedLot.supplierCode ?? ""}
                style={{ fontSize: 14 }}
              />
            </label>
          </div>

          {feedback && (
            <div style={{
              marginTop: 16,
              padding: "10px 14px",
              borderRadius: 6,
              background: feedback.ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
              border: `1px solid ${feedback.ok ? "var(--ok)" : "var(--danger)"}`,
              color: feedback.ok ? "var(--ok)" : "var(--danger)",
            }}>
              {feedback.msg}
            </div>
          )}

          <div style={{ marginTop: 20 }}>
            <button
              type="button"
              className="action-button"
              style={{ background: busy ? "var(--muted)" : "var(--danger)", flex: 1, maxWidth: 360 }}
              disabled={busy}
              onClick={handleReturn}
            >
              {busy
                ? (t("common.loading", locale) ?? "Loading...")
                : `${t("wms.confirmReturn", locale) ?? "Confirm Return to Supplier"}`}
            </button>
          </div>
        </section>
      )}

      {step === "list" && (
        <>
          {!loading && rejectedLots.length === 0 && (
            <section className="surface-panel">
              <div style={{ textAlign: "center", padding: "40px 0", color: "var(--muted)" }}>
                <Truck size={32} style={{ margin: "0 auto 12px", display: "block", opacity: 0.4 }} />
                <p>{t("wms.noRejectedLots", locale)}</p>
              </div>
            </section>
          )}

          {!loading && rejectedLots.length > 0 && (
            <section className="surface-panel">
              <div className="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>{t("common.lot", locale)}</th>
                      <th>{t("common.material", locale)}</th>
                      <th>{t("common.qty", locale)}</th>
                      <th>{t("wms.supplier", locale)}</th>
                      <th>{t("table.status", locale)}</th>
                      <th>{t("table.action", locale)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rejectedLots.map((lot) => (
                      <tr key={lot.id}>
                        <td><code>{lot.lotNo}</code></td>
                        <td><strong>{lot.materialCode}</strong></td>
                        <td>{(lot.qty ?? 0).toLocaleString()}</td>
                        <td>{lot.supplierCode ?? "—"}</td>
                        <td>
                          <span className={`badge badge-${lot.iqcStatus === "rejected" ? "danger" : "warning"}`}>
                            {t(lot.iqcStatus === "rejected" ? "iqc.rejected" : "iqc.hold", locale)}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="action-button"
                            style={{ background: "var(--danger)", fontSize: 12, padding: "4px 10px" }}
                            onClick={() => handleSelect(lot)}
                          >
                            <RotateCcw size={12} />
                            {t("common.select", locale)}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
