import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle, RotateCcw } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api";
import type { MaterialLot } from "../api";

const REASON_OPTIONS = [
  { code: "OVER_PRODUCTION", label_zh: "生产多余", label_en: "Over production", label_vi: "Sản xuất thừa" },
  { code: "DEFECT_RETURN", label_zh: "不良品退回", label_en: "Defect return", label_vi: "Trả lại lỗi" },
  { code: "SAMPLE_RETURN", label_zh: "样板返还", label_en: "Sample return", label_vi: "Trả mẫu" },
  { code: "LINE_CLEANUP", label_zh: "产线清理", label_en: "Line cleanup", label_vi: "Dọn dẹp line" },
  { code: "OTHER", label_zh: "其他", label_en: "Other", label_vi: "Khác" },
];

export function WmsReturnReceiving({ locale }: { locale: Locale }) {
  const [step, setStep] = useState<"scan" | "confirm">("scan");
  const [lots, setLots] = useState<MaterialLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanInput, setScanInput] = useState("");
  const [selectedLot, setSelectedLot] = useState<MaterialLot | null>(null);
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("OVER_PRODUCTION");
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    wmsApi.getMaterialLots({ limit: 200 }).then((res) => {
      // Show only released lots — eligible for return from line
      setLots(res.items.filter((l) => l.iqcStatus === "released"));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const langKey = locale === "zh-CN" ? "label_zh" : locale === "en-US" ? "label_en" : "label_vi";

  const handleScan = useCallback(() => {
    const input = scanInput.trim().toUpperCase();
    if (!input) return;
    const match = lots.find((l) => l.lotNo.toUpperCase() === input || l.materialCode.toUpperCase() === input);
    if (!match) {
      setFeedback({ ok: false, msg: `${input}: ${t("wms.lotNotFound", locale) ?? "Lot / material not found"}` });
      setScanInput("");
      return;
    }
    setSelectedLot(match);
    setQty(String(match.qty ?? 0));
    setReason("OVER_PRODUCTION");
    setFeedback(null);
    setStep("confirm");
    setScanInput("");
  }, [scanInput, lots, locale]);

  const handleReturn = async () => {
    if (!selectedLot) return;
    const qtyNum = Number(qty);
    if (!qtyNum || qtyNum <= 0) {
      setFeedback({ ok: false, msg: String(t("wms.qtyRequired", locale)) });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      await wmsApi.returnFromLine({
        lotNo: selectedLot.lotNo,
        workOrderCode: "",
        qty: qtyNum,
        operator: "VN_WH_010",
        reason,
      });
      setFeedback({ ok: true, msg: `${selectedLot.lotNo}: ${t("wms.returnSuccess", locale) ?? "Return recorded"}` });
      setStep("scan");
      setSelectedLot(null);
      setQty("");
    } catch (err) {
      setFeedback({ ok: false, msg: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const reasonLabel = REASON_OPTIONS.find((r) => r.code === reason)?.[langKey] ?? reason;

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.returnFromLine", locale)}</h2>
            <p>{t("wms.returnSubtitle", locale)}</p>
          </div>
        </div>

        <div className="scan-input" style={{ maxWidth: 520 }}>
          <RotateCcw size={24} />
          <input
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value.toUpperCase())}
            placeholder={t("wms.scanLotOrMaterial", locale) ?? "Scan lot or material code"}
            title={t("ui.scanInput", locale)}
            onKeyDown={(e) => { if (e.key === "Enter") handleScan(); }}
            autoFocus
          />
          <button
            className="action-button"
            type="button"
            style={{ background: "var(--ok)" }}
            disabled={!scanInput.trim() || busy}
            onClick={handleScan}
          >
            <CheckCircle size={16} />
          </button>
        </div>

        {feedback && (
          <div style={{
            marginTop: 12,
            padding: "10px 14px",
            borderRadius: 6,
            background: feedback.ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
            border: `1px solid ${feedback.ok ? "var(--ok)" : "var(--danger)"}`,
            color: feedback.ok ? "var(--ok)" : "var(--danger)",
          }}>
            {feedback.msg}
          </div>
        )}
      </section>

      {step === "confirm" && selectedLot && (
        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h2>{selectedLot.lotNo}</h2>
              <p>{selectedLot.materialCode} · {(selectedLot.qty ?? 0).toLocaleString()} {t("common.units", locale)}</p>
            </div>
            <div className="toolbar">
              <button
                type="button"
                className="action-button"
                style={{ background: "var(--muted)" }}
                onClick={() => { setStep("scan"); setSelectedLot(null); setFeedback(null); }}
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
                value={qty}
                min={1}
                max={selectedLot.qty ?? 0}
                onChange={(e) => setQty(e.target.value)}
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
                {REASON_OPTIONS.map((opt) => (
                  <option key={opt.code} value={opt.code}>{opt[langKey]}</option>
                ))}
              </select>
            </label>
          </div>

          <div style={{ marginTop: 20, display: "flex", gap: 12 }}>
            <button
              type="button"
              className="action-button"
              style={{ background: busy ? "var(--muted)" : "var(--ok)", flex: 1 }}
              disabled={busy}
              onClick={handleReturn}
            >
              {busy
                ? (t("common.loading", locale) ?? "Loading...")
                : `${t("wms.confirmReturn", locale) ?? "Confirm Return"} (${reasonLabel})`}
            </button>
          </div>
        </section>
      )}

      {!loading && lots.length > 0 && step === "scan" && (
        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h3>{t("wms.eligibleLots", locale)}</h3>
              <p>{t("wms.eligibleLotsSubtitle", locale)}</p>
            </div>
          </div>
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("common.lot", locale)}</th>
                  <th>{t("common.material", locale)}</th>
                  <th>{t("common.qty", locale)}</th>
                  <th>{t("common.location", locale)}</th>
                  <th>{t("table.action", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {lots.slice(0, 20).map((lot) => (
                  <tr key={lot.id}>
                    <td><code>{lot.lotNo}</code></td>
                    <td><strong>{lot.materialCode}</strong></td>
                    <td>{(lot.qty ?? 0).toLocaleString()}</td>
                    <td>{lot.locationCode ?? "—"}</td>
                    <td>
                      <button
                        type="button"
                        className="action-button"
                        style={{ background: "var(--info)", fontSize: 12, padding: "4px 10px" }}
                        onClick={() => {
                          setSelectedLot(lot);
                          setQty(String(lot.qty ?? 0));
                          setReason("OVER_PRODUCTION");
                          setStep("confirm");
                        }}
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
    </div>
  );
}
// @ts-nocheck
