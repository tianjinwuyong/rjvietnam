import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { hrApi } from "../api";
import type { Employee, Department } from "../api";
import QRCode from "qrcode";

// ── QR canvas renderer using the qrcode package ────────────────────────
async function drawQRToCanvas(canvas: HTMLCanvasElement, data: string, size = 200): Promise<void> {
  try {
    await QRCode.toCanvas(canvas, data, {
      width: size,
      margin: 1,
      color: { dark: "#000000", light: "#ffffff" },
      errorCorrectionLevel: "M",
    });
  } catch {
    // Fallback: draw placeholder
    const ctx = canvas.getContext("2d")!;
    canvas.width = size;
    canvas.height = size;
    ctx.fillStyle = "#f0f0f0";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#999";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("QR Error", size / 2, size / 2);
  }
}

// ── Component ─────────────────────────────────────────────────────────
type QrStatus = "none" | "active" | "expired" | "revoked";

function getQrStatus(qr: { hasActiveQr: boolean; expiresAt: string | null } | null): QrStatus {
  if (!qr || !qr.hasActiveQr) return "none";
  if (qr.expiresAt && new Date(qr.expiresAt) < new Date()) return "expired";
  return "active";
}

export function HrEmployeeList({ locale }: { locale: Locale }) {

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterDept, setFilterDept] = useState<string>("all");
  const [searchText, setSearchText] = useState<string>("");
  const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null);

  // QR state
  const [qrEmp, setQrEmp] = useState<Employee | null>(null);
  const [qrData, setQrData] = useState<any>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrTab, setQrTab] = useState<"qr" | "history">("qr");
  const [auditData, setAuditData] = useState<any[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    Promise.all([
      hrApi.getEmployees(),
      hrApi.getDepartments(),
    ]).then(([empRes, deptRes]) => {
      setEmployees(empRes.items);
      setDepartments(deptRes.items);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    return employees.filter((emp) => {
      if (filterDept !== "all" && String(emp.departmentId) !== filterDept) return false;
      if (searchText) {
        const q = searchText.toLowerCase();
        if (!emp.name_zh.includes(searchText) && !emp.name_en.toLowerCase().includes(q) && !emp.name_vi.toLowerCase().includes(q) && !emp.code.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [employees, filterDept, searchText]);

  const openQrModal = useCallback(async (emp: Employee, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setQrEmp(emp);
    setQrTab("qr");
    setQrLoading(true);
    setQrData(null);
    try {
      const res = await hrApi.getEmployeeQr(Number(emp.id));
      setQrData(res);
    } catch {
      setQrData({ hasActiveQr: false });
    }
    setQrLoading(false);
  }, []);

  const closeQrModal = useCallback(() => {
    setQrEmp(null);
    setQrData(null);
    setAuditData([]);
  }, []);

  const generateQr = useCallback(async (validDays = 365) => {
    if (!qrEmp) return;
    setQrLoading(true);
    try {
      const res = await hrApi.generateEmployeeQr(Number(qrEmp.id), validDays);
      setQrData(res.item);
    } catch {
      setQrData({ hasActiveQr: false });
    }
    setQrLoading(false);
  }, [qrEmp]);

  const revokeQr = useCallback(async () => {
    if (!qrEmp || !confirm(t("hr.qr.confirmRevoke", locale))) return;
    setQrLoading(true);
    try {
      await hrApi.revokeEmployeeQr(Number(qrEmp.id));
      setQrData({ hasActiveQr: false });
    } catch { /* noop */ }
    setQrLoading(false);
  }, [qrEmp, locale]);

  const handleBatchPrint = useCallback(async () => {
    if (!selectedRows.size) return;
    setBatchLoading(true);
    try {
      const ids = Array.from(selectedRows);
      const res = await hrApi.getEmployeeQrBatch(ids);
      const cards = await Promise.all(res.items.map(async (emp: any) => {
        let qrImg: string;
        if (emp.hasActiveQr && emp.qrContent) {
          try {
            const dataUrl = await QRCode.toDataURL(emp.qrContent, { width: 120, margin: 1, color: { dark: "#000", light: "#fff" } });
            qrImg = `<img src="${dataUrl}" width="120" height="120"/>`;
          } catch {
            qrImg = `<div style="width:120px;height:120px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;font-size:11px;color:#999">${t("hr.qr.inactive", locale)}</div>`;
          }
        } else {
          qrImg = `<div style="width:120px;height:120px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;font-size:11px;color:#999">${t("hr.qr.inactive", locale)}</div>`;
        }
        return `<div class="card">
          ${qrImg}
          <div class="name">${emp.name_zh || emp.employee_no || ""}</div>
          <div class="code">${emp.employee_no || ""}</div>
          <div class="exp">${emp.hasActiveQr && emp.qr_code_expires_at ? new Date(emp.qr_code_expires_at).toLocaleDateString() : "—"}</div>
        </div>`;
      }));
      const cardsHtml = cards.join("");
      const html = `<html><head><title>${t("hr.qr.printBatch", locale)}</title>
<style>
body{font-family:sans-serif;padding:16px;margin:0}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.card{border:1px solid #ddd;border-radius:8px;padding:12px;text-align:center;background:#fff}
.name{font-size:13px;font-weight:bold;margin-top:6px;color:#222}
.code{font-size:11px;color:#666;margin-top:2px}
.exp{font-size:10px;color:#999;margin-top:2px}
@media print{.card{break-inside:avoid}}
</style></head><body>
<div class="grid">${cardsHtml}</div>
<script>window.onload=()=>setTimeout(()=>window.print(),500)<\/script>
</body></html>`;
      const w = window.open("", "_blank");
      if (w) { w.document.write(html); w.document.close(); }
    } finally {
      setBatchLoading(false);
    }
  }, [selectedRows, locale]);

  const loadAudit = useCallback(async () => {
    if (!qrEmp) return;
    try {
      const res = await hrApi.getEmployeeQrAudit(Number(qrEmp.id));
      setAuditData(res.items);
      setAuditTotal(res.total);
    } catch { setAuditData([]); }
  }, [qrEmp]);

  const openAuditTab = useCallback(() => {
    setQrTab("history");
    loadAudit();
  }, [loadAudit]);

  useEffect(() => {
    if (qrTab === "history" && qrEmp) loadAudit();
  }, [qrTab, qrEmp, loadAudit]);

  useEffect(() => {
    if (qrData?.qrContent && canvasRef.current) {
      drawQRToCanvas(canvasRef.current, qrData.qrContent, 200).catch(() => {});
    }
  }, [qrData?.qrContent]);

  // Batch print - builds HTML outside JSX return to avoid nested backtick issues
  const buildBatchPrintHtml = (items: any[]): string => {
    const cards = items.map(item => (
      "<div class=\"card\">" +
      "<div class=\"name\">" + (item.name_zh || item.employee_no || "") + "</div>" +
      "<div class=\"code\">" + (item.employee_no || "") + "</div>" +
      "</div>"
    )).join("");
    return "<html><head><title>Batch QR</title>" +
      "<style>body{font-family:sans-serif;padding:20px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.card{border:1px solid #ccc;padding:12px;text-align:center}.name{font-size:13px;font-weight:bold}.code{font-size:11px;color:#666}@media print{body{padding:0}.card{break-inside:avoid}}</style>" +
      "</head><body><div class=\"grid\">" + cards + "</div>" +
      "<script>setTimeout(()=>window.print(),300)<\/script></body></html>";
  };

  if (loading) {
    return <div style={{ padding: 24, color: "var(--muted)" }}>{t("common.loading", locale)}...</div>;
  }

  const status = qrData ? getQrStatus(qrData) : "none";

  return (
    <div className="screen-stack">
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("hr.subnav.employees", locale)}</h2>
            <p>{t("page.hr", locale)}</p>
          </div>
          {selectedRows.size > 0 && (
            <button className="btn-primary" style={{ fontSize: 12 }} onClick={handleBatchPrint} disabled={batchLoading}>
              {batchLoading ? "..." : `${t("hr.qr.printBatch", locale)} (${selectedRows.size})`}
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 12, padding: "8px 16px", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>{t("hr.department", locale)}:</span>
          <select
            value={filterDept}
            onChange={(e) => setFilterDept(e.target.value)}
            style={{ fontSize: 12, padding: "2px 6px" }}
          >
            <option value="all">{t("ui.filterTabs", locale)}</option>
            {departments.map((dept) => (
              <option key={dept.id} value={String(dept.id)}>{dept.name_zh}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder={t("ui.searchInput", locale)}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ fontSize: 12, padding: "3px 8px", flex: 1, maxWidth: 240, marginLeft: 12 }}
          />
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {filtered.length} / {employees.length}
          </span>
        </div>
      </div>

      <section className="surface-panel">
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input type="checkbox"
                    checked={selectedRows.size === filtered.length && filtered.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedRows(new Set(filtered.map((emp) => Number(emp.id))));
                      else setSelectedRows(new Set());
                    }}
                  />
                </th>
                <th style={{ width: 40 }}></th>
                <th>{t("hr.employeeNo", locale)}</th>
                <th>{t("common.name", locale)}</th>
                <th>{t("hr.department", locale)}</th>
                <th>{t("hr.position", locale)}</th>
                <th>{t("hr.gender", locale)}</th>
                <th>{t("hr.phone", locale)}</th>
                <th>{t("hr.email", locale)}</th>
                <th>{t("hr.status", locale)}</th>
                <th>{t("hr.qr.title", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((emp) => (
                <tr key={emp.id} onClick={() => setSelectedEmp(emp)} style={{ cursor: "pointer" }}>
                  <td onClick={(e) => { e.stopPropagation(); const id = Number(emp.id); const s = new Set(selectedRows); s.has(id) ? s.delete(id) : s.add(id); setSelectedRows(s); }}>
                    <input type="checkbox" checked={selectedRows.has(Number(emp.id))} onChange={() => {}} />
                  </td>
                  <td style={{ width: 40 }}>
                    {emp.avatar_url
                      ? <img src={emp.avatar_url} alt={emp.name_zh} style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", verticalAlign: "middle" }} />
                      : <span style={{ display: "inline-block", width: 32, height: 32, borderRadius: "50%", background: "#e0e7ff", color: "#3730a3", fontSize: 11, fontWeight: 700, textAlign: "center", lineHeight: "32px" }}>{emp.name_zh?.slice(0, 2) || emp.code?.slice(0, 2) || "?"}</span>
                    }
                  </td>
                  <td><strong>{emp.code}</strong></td>
                  <td>
                    <div>
                      <span>{emp.name_zh}</span>
                      <span style={{ color: "var(--muted)", fontSize: 11, marginLeft: 6 }}>
                        ({emp.name_en})
                      </span>
                    </div>
                  </td>
                  <td>{emp.departmentNameZh}</td>
                  <td>{emp.positionTitleZh}</td>
                  <td>{t(emp.gender === "M" ? "hr.male" : emp.gender === "F" ? "hr.female" : "hr.other", locale)}</td>
                  <td>{emp.phone}</td>
                  <td>{emp.email}</td>
                  <td>
                    <span className={`badge badge-${emp.status === "active" ? "ok" : emp.status === "inactive" ? "muted" : "warning"}`}>
                      {t(emp.status === "active" ? "status.approved" : emp.status === "inactive" ? "status.closed" : "status.hold", locale)}
                    </span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button
                      className="btn-ghost"
                      style={{ fontSize: 11, padding: "2px 8px" }}
                      onClick={() => openQrModal(emp)}
                      title={t("hr.qr.view", locale)}
                    >
                      {t("hr.qr.title", locale)}
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>
                    {t("common.noData", locale)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedEmp && (
        <div className="drawer-overlay" onClick={() => setSelectedEmp(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <h3>{selectedEmp.name_zh}</h3>
              <button className="btn-ghost" onClick={() => setSelectedEmp(null)}>✕</button>
            </div>
            <div className="drawer-body">
              <div className="info-grid">
                <div className="info-label">{t("hr.employeeNo", locale)}</div>
                <div className="info-value">{selectedEmp.code}</div>
                <div className="info-label">{t("common.name", locale)}</div>
                <div className="info-value">{selectedEmp.name_zh} / {selectedEmp.name_en} / {selectedEmp.name_vi}</div>
                <div className="info-label">{t("hr.department", locale)}</div>
                <div className="info-value">{selectedEmp.departmentNameZh}</div>
                <div className="info-label">{t("hr.position", locale)}</div>
                <div className="info-value">{selectedEmp.positionTitleZh}</div>
                <div className="info-label">{t("hr.status", locale)}</div>
                <div className="info-value">
                  <span className={`badge badge-${selectedEmp.status === "active" ? "ok" : "muted"}`}>
                    {selectedEmp.status}
                  </span>
                </div>
                {selectedEmp.managerNameZh && (
                  <>
                    <div className="info-label">{t("hr.reportsTo", locale)}</div>
                    <div className="info-value">{selectedEmp.managerNameZh}</div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {qrEmp && (
        <div className="drawer-overlay" onClick={closeQrModal}>
          <div className="drawer" onClick={(e) => e.stopPropagation()} style={{ minWidth: 360 }}>
            <div className="drawer-header" style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {qrEmp.avatar_url
                ? <img src={qrEmp.avatar_url} alt={qrEmp.name_zh} style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }} />
                : <span style={{ display: "inline-block", width: 36, height: 36, borderRadius: "50%", background: "#e0e7ff", color: "#3730a3", fontSize: 12, fontWeight: 700, textAlign: "center", lineHeight: "36px", flexShrink: 0 }}>{qrEmp.name_zh?.slice(0, 2) || "?"}</span>
              }
              <h3 style={{ margin: 0 }}>{t("hr.qr.title", locale)} — {qrEmp.name_zh}</h3>
              <button className="btn-ghost" onClick={closeQrModal} style={{ marginLeft: "auto" }}>✕</button>
            </div>
            <div className="drawer-body">
              <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
                <button className={qrTab === "qr" ? "btn-primary" : "btn-ghost"} style={{ flex: 1, fontSize: 12 }} onClick={() => setQrTab("qr")}>
                  {t("hr.qr.title", locale)}
                </button>
                <button className={qrTab === "history" ? "btn-primary" : "btn-ghost"} style={{ flex: 1, fontSize: 12 }} onClick={() => setQrTab("history")}>
                  {t("hr.qr.scanHistory", locale)}
                </button>
              </div>

              {qrTab === "qr" && (
                              <div style={{ textAlign: "center" }}>
                                {qrLoading ? (
                                  <div style={{ padding: 40, color: "var(--muted)" }}>...</div>
                                ) : qrData?.qrContent ? (
                                  <>
                                    <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 16, display: "inline-block", marginBottom: 12 }}>
                                      <canvas ref={canvasRef} style={{ display: "block", margin: "0 auto" }} />
                                    </div>
                                    <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>
                                      <div>{t("hr.qr.expiresAt", locale)}: {qrData.expiresAt ? new Date(qrData.expiresAt).toLocaleDateString() : "—"}</div>
                                      <div>{t("hr.qr.issuedAt", locale)}: {qrData.issuedAt ? new Date(qrData.issuedAt).toLocaleDateString() : "—"}</div>
                                    </div>
                                    <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                                      <button className="btn-primary" style={{ fontSize: 12 }} onClick={() => generateQr(365)}>
                                        {t("hr.qr.regenerate", locale)}
                                      </button>
                                      <a
                                        href={`/api/hr/employees/${qrEmp.id}/qr-image`}
                                        download={`QR_${qrEmp.code}.png`}
                                        className="btn-ghost"
                                        style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}
                                      >
                                        {t("common.download", locale)}
                                      </a>
                                      <button className="btn-ghost" style={{ fontSize: 12, color: "var(--danger)" }} onClick={revokeQr}>
                                        {t("hr.qr.revoke", locale)}
                                      </button>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <div style={{ padding: "32px 0", color: "var(--muted)", fontSize: 13, marginBottom: 12 }}>
                                      {t("hr.qr.inactive", locale)}
                                    </div>
                                    <button className="btn-primary" style={{ fontSize: 12 }} onClick={() => generateQr(365)}>
                                      {t("hr.qr.generate", locale)}
                                    </button>
                                  </>
                                )}
                              </div>
                            )}

              {qrTab === "history" && (
                <div>
                  {auditData.length === 0 ? (
                    <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                      {t("common.noData", locale)}
                    </div>
                  ) : (
                    <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--border)" }}>
                          <th style={{ textAlign: "left", padding: "4px 8px" }}>{t("hr.qr.scannedAt", locale)}</th>
                          <th style={{ textAlign: "left", padding: "4px 8px" }}>{t("hr.qr.scannerDevice", locale)}</th>
                          <th style={{ textAlign: "left", padding: "4px 8px" }}>IP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditData.map((row: any) => (
                          <tr key={row.id} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td style={{ padding: "4px 8px" }}>{row.scannedAt ? new Date(row.scannedAt).toLocaleString() : "—"}</td>
                            <td style={{ padding: "4px 8px" }}>{row.scannerDevice || "—"}</td>
                            <td style={{ padding: "4px 8px", color: "var(--muted)" }}>{row.ipAddress || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <div style={{ marginTop: 8, fontSize: 11, color: "var(--muted)" }}>
                    {auditTotal > 0 ? `${auditTotal} ${t("hr.qr.scanHistory", locale)}` : ""}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
