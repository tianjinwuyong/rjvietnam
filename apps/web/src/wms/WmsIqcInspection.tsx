import { useState, useEffect, useCallback } from "react";
import { ClipboardCheck, AlertTriangle, Ban, Search, CheckCircle, XCircle } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api";

interface IqcInspectionLot {
  id: string | number;
  lotNo: string;
  materialCode: string;
  materialNameZh: string;
  supplierCode: string;
  qty: number;
  iqcStatus: string;
  receivedDate: string;
}

interface TestItem {
  id: number;
  testName: string;
  standard: string;
  result: "pass" | "fail" | "na" | null;
  note: string;
}

export function WmsIqcInspection({ locale }: { locale: Locale }) {
  const [lots, setLots] = useState<IqcInspectionLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLot, setSelectedLot] = useState<IqcInspectionLot | null>(null);
  const [testItems, setTestItems] = useState<TestItem[]>([]);
  const [planId, setPlanId] = useState<number | null>(null);
  const [sampleSize, setSampleSize] = useState(20);
  const [defectCount, setDefectCount] = useState(0);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [searchQ, setSearchQ] = useState("");

  useEffect(() => {
    Promise.all([
      wmsApi.getMaterialLots({ iqcStatus: "pending", limit: 100 }),
      wmsApi.getMaterialLots({ iqcStatus: "hold", limit: 100 }),
    ])
      .then(([pending, hold]) => {
        const all = [...(pending.items ?? []), ...(hold.items ?? [])].map((lot) => ({
          id: lot.id!, lotNo: lot.lotNo, materialCode: lot.materialCode,
          materialNameZh: lot.name_zh ?? "", supplierCode: lot.supplierCode ?? "",
          qty: lot.qty ?? 0, iqcStatus: lot.iqcStatus,
          receivedDate: "",
        }));
        setLots(all);
        setLoading(false);
      })
      .catch((error) => {
        setLots([]);
        setFeedback({ ok: false, msg: error instanceof Error ? error.message : String(error) });
        setLoading(false);
      });
  }, []);

  const filteredLots = lots.filter((l) =>
    !searchQ || l.lotNo.toLowerCase().includes(searchQ.toLowerCase()) || l.materialCode.toLowerCase().includes(searchQ.toLowerCase())
  );

  const selectLot = async (lot: IqcInspectionLot) => {
    setSelectedLot(lot);
    setTestItems([]);
    setPlanId(null);
    setSampleSize(Math.min(lot.qty, 20));
    setDefectCount(0);
    setFeedback(null);
    try {
      const plan = await wmsApi.getIqcPlanForLot(lot.id);
      setPlanId(plan.id);
      setTestItems(plan.characteristics.map((item) => ({
        id: item.id,
        testName: locale === "vi-VN" ? item.name_vi ?? item.name_zh : locale === "en-US" ? item.name_en ?? item.name_zh : item.name_zh,
        standard: [item.lowerLimit != null ? `≥ ${item.lowerLimit}` : "", item.upperLimit != null ? `≤ ${item.upperLimit}` : "", item.unit ?? ""].filter(Boolean).join(" ") || item.dataType,
        result: null,
        note: "",
      })));
    } catch (error) {
      setFeedback({ ok: false, msg: error instanceof Error ? error.message : String(error) });
    }
  };

  const updateTestResult = (id: number, result: TestItem["result"]) => {
    setTestItems((prev) => prev.map((t) => (t.id === id ? { ...t, result } : t)));
  };

  const updateTestNote = (id: number, note: string) => {
    setTestItems((prev) => prev.map((t) => (t.id === id ? { ...t, note } : t)));
  };

  const submitIqcDecision = useCallback(
    async (decision: "pass" | "fail" | "hold") => {
      if (!selectedLot) return;
      if (!planId || testItems.length === 0 || testItems.some((item) => item.result === null)) {
        setFeedback({ ok: false, msg: "必须使用已批准的检验计划并完成全部检验项目" });
        return;
      }
      setBusy(true);
      setFeedback(null);
      try {
        await wmsApi.submitIqcInspection({
          materialLotId: selectedLot.id,
          planId,
          decision: decision === "pass" ? "PASS" : decision === "fail" ? "FAIL" : "HOLD",
          sampleSize,
          operator: "VN_IQC_003",
          results: testItems.map((item) => ({
            characteristicId: item.id,
            result: item.result === "pass" ? "PASS" : item.result === "fail" ? "FAIL" : "NA",
            measuredValue: item.note,
            note: item.note,
          })),
        });
        setFeedback({ ok: true, msg: `${selectedLot.lotNo}: ${t(decision === "pass" ? "iqc.released" : decision === "fail" ? "iqc.rejected" : "iqc.hold", locale)}` });
        setLots((prev) => prev.filter((l) => l.id !== selectedLot.id));
        setSelectedLot(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setFeedback({ ok: false, msg: `${selectedLot.lotNo}: ${msg}` });
      } finally {
        setBusy(false);
      }
    },
    [selectedLot, locale, planId, testItems, sampleSize],
  );

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.subnav.iqcInspect", locale)}</h2>
            <p>{t("wms.iqcSubtitle", locale)}</p>
          </div>
        </div>
      </section>

      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h3>{t("wms.selectLot", locale)}</h3>
          </div>
          <div className="scan-input" style={{ maxWidth: 320 }}>
            <Search size={16} />
            <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder={t("scan.placeholder", locale)} />
          </div>
        </div>
        {loading ? (
          <div style={{ padding: 24, color: "var(--muted)" }}>{t("common.loading", locale)}</div>
        ) : filteredLots.length === 0 ? (
          <div style={{ padding: 24, color: "var(--muted)", textAlign: "center" }}>{t("common.noData", locale)}</div>
        ) : (
          <div className="table-shell" style={{ maxHeight: 240, overflow: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>{t("common.lot", locale)}</th>
                  <th>{t("common.material", locale)}</th>
                  <th>{t("common.supplier", locale)}</th>
                  <th>{t("common.qty", locale)}</th>
                  <th>{t("common.status", locale)}</th>
                  <th>{t("table.action", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {filteredLots.map((lot) => (
                  <tr key={lot.id} style={{ background: selectedLot?.id === lot.id ? "rgba(59,130,246,0.08)" : undefined }}>
                    <td><code>{lot.lotNo}</code></td>
                    <td><strong>{lot.materialCode}</strong><br /><span style={{ fontSize: 11, color: "var(--muted)" }}>{lot.materialNameZh}</span></td>
                    <td>{lot.supplierCode}</td>
                    <td>{lot.qty.toLocaleString()}</td>
                    <td><span className={`badge badge-${lot.iqcStatus === "hold" ? "warning" : "info"}`}>{lot.iqcStatus}</span></td>
                    <td>
                      <button className="action-button" type="button" style={{ background: "var(--info)", padding: "4px 10px", fontSize: 12 }}
                        onClick={() => selectLot(lot)} disabled={selectedLot?.id === lot.id}>
                        <ClipboardCheck size={12} /> {t("wms.iqcInspect", locale)}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedLot && (
        <>
          <section className="surface-panel">
            <div className="section-header">
              <div>
                <h3>{selectedLot.materialCode} — {selectedLot.lotNo}</h3>
                <p>{t("wms.iqcTestItems", locale)}</p>
              </div>
              <div className="toolbar" style={{ gap: 12 }}>
                <label style={{ fontSize: 12 }}>
                  {t("wms.sampleSize", locale)}: <input type="number" className="input" style={{ width: 60, padding: "4px 6px" }} value={sampleSize} min={1} onChange={(e) => setSampleSize(Number(e.target.value))} />
                </label>
                <label style={{ fontSize: 12 }}>
                  {t("wms.defectCount", locale)}: <input type="number" className="input" style={{ width: 60, padding: "4px 6px" }} value={defectCount} min={0} onChange={(e) => setDefectCount(Number(e.target.value))} />
                </label>
              </div>
            </div>
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>{t("wms.testItem", locale)}</th>
                    <th>{t("wms.standard", locale)}</th>
                    <th>{t("common.result", locale)}</th>
                    <th>{t("wms.note", locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {testItems.map((item) => (
                    <tr key={item.id}>
                      <td><strong>{item.testName}</strong></td>
                      <td style={{ fontSize: 12, color: "var(--muted)" }}>{item.standard}</td>
                      <td>
                        <div className="toolbar" style={{ gap: 4 }}>
                          {(["pass", "fail", "na"] as const).map((r) => (
                            <button key={r} type="button"
                              className="action-button"
                              style={{
                                padding: "2px 10px", fontSize: 11,
                                background: item.result === r ? (r === "pass" ? "var(--ok)" : r === "fail" ? "var(--danger)" : "var(--muted)") : "var(--nav)",
                                color: item.result === r ? "#fff" : "var(--fg)",
                              }}
                              onClick={() => updateTestResult(item.id, r)}>
                              {r === "pass" ? "PASS" : r === "fail" ? "FAIL" : "N/A"}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td>
                        <input className="input" style={{ width: 160, padding: "4px 6px", fontSize: 12 }}
                          value={item.note} onChange={(e) => updateTestNote(item.id, e.target.value)} placeholder="备注" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="surface-panel">
            <div className="toolbar" style={{ justifyContent: "space-between" }}>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>
                {t("wms.sampleSize", locale)}: {sampleSize} | {t("wms.defectCount", locale)}: {defectCount} | {t("wms.passRate", locale)}: {sampleSize > 0 ? ((sampleSize - defectCount) / sampleSize * 100).toFixed(1) : "0"}%
              </div>
              <div className="toolbar" style={{ gap: 8 }}>
                <button className="action-button" type="button" style={{ background: "var(--warn)" }}
                  disabled={busy} onClick={() => submitIqcDecision("hold")}>
                  <Ban size={14} /> {t("wms.iqcHold", locale)}
                </button>
                <button className="action-button" type="button" style={{ background: "var(--danger)" }}
                  disabled={busy} onClick={() => submitIqcDecision("fail")}>
                  <XCircle size={14} /> {t("wms.iqcReject", locale)}
                </button>
                <button className="action-button" type="button" style={{ background: "var(--ok)" }}
                  disabled={busy} onClick={() => submitIqcDecision("pass")}>
                  <CheckCircle size={14} /> {t("iqc.release", locale)}
                </button>
              </div>
            </div>
            {feedback && (
              <div style={{ marginTop: 8, padding: "6px 12px", borderRadius: 6, background: feedback.ok ? "var(--ok-bg)" : "var(--danger-bg)", color: feedback.ok ? "var(--ok)" : "var(--danger)", fontSize: 13 }}>
                {feedback.ok ? <CheckCircle size={14} style={{ marginRight: 6 }} /> : <AlertTriangle size={14} style={{ marginRight: 6 }} />}
                {feedback.msg}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
// @ts-nocheck
