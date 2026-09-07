import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient } from "../api/client";

export type IqcFlowPageKey =
  | "poReceipt" | "lineReturn" | "subcontractReturn" | "mrbReworkReturn"
  | "qrBinding" | "iqcPassMaintenance" | "defectArchive" | "mrbApproval"
  | "scrapFinanceApproval" | "reworkComplete" | "iqcReinspection";

type Row = Record<string, any>;
const pageInfo: Record<IqcFlowPageKey, { title: string; description: string; sourceType?: string }> = {
  poReceipt: { title: "PO采购到货", description: "收货后生成QR单据，绑定待检仓位并进入IQC。", sourceType: "PO_RECEIPT" },
  lineReturn: { title: "产线退料回仓", description: "产线退料收货后生成QR单据，进入IQC复检。", sourceType: "LINE_RETURN" },
  subcontractReturn: { title: "外协完工回厂", description: "外协加工完工收货后生成QR单据，进入IQC。", sourceType: "SUBCONTRACT_RETURN" },
  mrbReworkReturn: { title: "MRB返工修复回仓", description: "返工修复完成回仓，生成新QR单据并进入IQC复检。", sourceType: "REWORK_RETURN" },
  qrBinding: { title: "QR绑定仓库", description: "生成系统QR收货单，将物料批次绑定到指定待检仓位。" },
  iqcPassMaintenance: { title: "IQC合格结果维护", description: "维护IQC结果；合格后解除QR绑定并转入良品仓库。" },
  defectArchive: { title: "IQC不良品档案", description: "建立不良品档案，并记录从栈板移除。" },
  mrbApproval: { title: "MRB物料评审 / OA审批", description: "对不良品执行返工、报废或退货供应商的评审审批。" },
  scrapFinanceApproval: { title: "报废财务审批闭环", description: "财务审批报废金额；批准后由仓库执行报废并关闭库存台账。" },
  reworkComplete: { title: "返工修复完成回仓", description: "登记返工完成，生成新QR单据并等待IQC复检。" },
  iqcReinspection: { title: "IQC复检档案", description: "建立复检档案，完成PASS/FAIL判定；PASS后重新建立有效期记录。" },
};

const PO_RECEIPT_TEST_ROWS: Row[] = [
  { id: "TEST-PO-01", document_no: "TEST-IQC-PO-QR-1", lot_no: "TEST-IQC-PO-01", source_type: "PO_RECEIPT / TEST", status: "IQC_PENDING", quantity: 5000, material_code: "TEST-IQC-R-10K-0603", material_name: "TEST Chip Resistor 10KΩ 0603" },
  { id: "TEST-PO-02", document_no: "TEST-IQC-PO-QR-2", lot_no: "TEST-IQC-PO-02", source_type: "PO_RECEIPT / TEST", status: "IQC_PENDING", quantity: 12000, material_code: "TEST-IQC-C-100N-0402", material_name: "TEST MLCC Capacitor 100nF 0402" },
  { id: "TEST-PO-03", document_no: "TEST-IQC-PO-QR-3", lot_no: "TEST-IQC-PO-03", source_type: "PO_RECEIPT / TEST", status: "IQC_PENDING", quantity: 3000, material_code: "TEST-IQC-LED-GRN-0805", material_name: "TEST Green LED 0805" },
];

function BackButton() {
  return <button type="button" className="btn btn-secondary" onClick={() => window.history.length > 1 ? window.history.back() : window.location.assign("/?view=wms")}>返回来源页面</button>;
}

function value(row: Row, ...keys: string[]) {
  const found = keys.map(key => row[key]).find(item => item !== undefined && item !== null && item !== "");
  return found === undefined ? "-" : String(found);
}

function savedIqcGuidance(): any {
  try { return JSON.parse(sessionStorage.getItem("iqc_guidance_model") || "{}"); } catch { return {}; }
}

export function WmsIqcFlowPages({ page, locale: _locale }: { page: IqcFlowPageKey; locale: Locale }) {
  const info = pageInfo[page];
  const [rows, setRows] = useState<Row[]>([]);
  const [preIqcRows, setPreIqcRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [guidanceName, setGuidanceName] = useState(() => savedIqcGuidance().fileName || "");
  const [guidanceSheets, setGuidanceSheets] = useState<Array<{ name: string; rows: unknown[][] }>>(() => savedIqcGuidance().sheets || []);
  const [guidanceModel, setGuidanceModel] = useState<{ samplingRows: unknown[][]; inspectionItems: string[] }>(() => ({ samplingRows: savedIqcGuidance().samplingRows || [], inspectionItems: savedIqcGuidance().inspectionItems || [] }));
  const [managedGuidance, setManagedGuidance] = useState<Row[]>([]);
  const [virtualOpen, setVirtualOpen] = useState(false);
  const [virtualInput, setVirtualInput] = useState("");
  const [virtualMessages, setVirtualMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);
  const [virtualBusy, setVirtualBusy] = useState(false);
  const [virtualWatching, setVirtualWatching] = useState(false);
  const [virtualMonitorStatus, setVirtualMonitorStatus] = useState("IDLE");
  const virtualGuidanceRead = useRef(false);
  const [form, setForm] = useState({ lotNo: "", quantity: "", location: "", warehouse: "IQC-PENDING", operator: "operator", lotId: "", defectId: "", qrDocumentNo: "", decision: "REWORK", result: "PASS" });
  const endpoint = useMemo(() => page === "defectArchive" ? "/quality/iqc-defect-cases" : page === "mrbApproval" ? "/quality/iqc-mrb-tasks" : page === "scrapFinanceApproval" ? "/quality/iqc-scrap-finance-approvals" : page === "iqcReinspection" ? "/quality/iqc-reinspections" : "/wms/receiving/qr-bindings", [page]);
  const load = useCallback(async () => {
    setError("");
    try {
      const response: any = await apiClient.get(endpoint);
      const loaded = response.items ?? response.data ?? response ?? [];
      const filtered = page === "poReceipt" ? [] : loaded;
      setRows(filtered);
      if (!filtered.length && page !== "poReceipt") setError("");
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [endpoint]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (page !== "poReceipt") return;
    const loadPreIqc = () => {
      void apiClient.get<any>("/wms/receiving/pre-iqc")
        .then((r: any) => { setPreIqcRows(r.items ?? []); })
        .catch(() => setPreIqcRows([]));
    };
    loadPreIqc();
    const timer = window.setInterval(loadPreIqc, 2000);
    return () => window.clearInterval(timer);
  }, [page]);
  useEffect(() => { if (page !== "poReceipt") return; void apiClient.get<any>("/qms/iqc/guidance-documents").then((r: any) => { const docs = r.items ?? r.data?.items ?? r ?? []; setManagedGuidance(docs); const current = docs[0]; const workbook = current?.workbook; if (current && workbook) { const sheets = workbook.sheets || []; const model = { samplingRows: workbook.samplingRows || [], inspectionItems: workbook.inspectionItems || [] }; setGuidanceName(current.file_name || ""); setGuidanceSheets(sheets); setGuidanceModel(model); sessionStorage.setItem("iqc_guidance_model", JSON.stringify({ fileName: current.file_name || "", sheets, ...model })); } }).catch(() => setManagedGuidance([])); }, [page]);
  const update = (key: keyof typeof form, next: string) => setForm(current => ({ ...current, [key]: next }));
  const submit = async (path: string, body: Row) => {
    setError(""); setMessage("");
    try { await apiClient.post(path, body); setMessage("操作成功，已进入下一流程"); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
  const field = (key: keyof typeof form, placeholder: string) => <input className="form-input" value={form[key]} placeholder={placeholder} onChange={event => update(key, event.target.value)} />;
  const importIqcGuidance = async (file?: File) => {
    if (!file) return;
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const sheets = workbook.SheetNames.map(name => ({ name, rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: "" }).slice(0, 120) }));
      const flatText = sheets.flatMap(sheet => sheet.rows.flat().map(cell => String(cell ?? "").trim()).filter(Boolean));
      const samplingRows = sheets.find(sheet => /2828|抽样|sampling/i.test(`${file.name} ${sheet.name}`))?.rows.filter(row => row.some(cell => /\d+\s*[~～]\s*\d+/.test(String(cell ?? "")))) ?? [];
      const inspectionItems = [...new Set(flatText.filter(text => /包装|标签|外观|尺寸|规格|焊端|检验|packing|label|visual|dimension/i.test(text)).map(text => text.replace(/\n/g, " ")).slice(0, 30))];
      const model = {
        samplingRows,
        inspectionItems,
      };
      setGuidanceName(file.name); setGuidanceSheets(sheets); setGuidanceModel(model);
      sessionStorage.setItem("iqc_guidance_model", JSON.stringify({ fileName: file.name, sheets, ...model }));
      const managed = await apiClient.post<any>("/qms/iqc/guidance-documents", { guidanceKey: "SMT_IQC", fileName: file.name, versionNo: `V-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`, workbook: { sheets, samplingRows: model.samplingRows, inspectionItems: model.inspectionItems }, operator: "quality" });
      setManagedGuidance([managed.item ?? managed.data?.item ?? managed]);
      virtualGuidanceRead.current = false;
      setMessage(`已读取 IQC 指导文件：${file.name}。抽样方案和检验项目已载入 IQC 页面，实际结果仍需检验员录入。`);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
  const askVirtualEmployee = async () => {
    const question = virtualInput.trim(); if (!question || virtualBusy) return;
    setVirtualInput(""); setVirtualMessages(items => [...items, { role: "user", text: question }]); setVirtualBusy(true);
    try {
      const request = apiClient.post("/qms/iqc/virtual-employee/advice", { question, guidance: { fileName: guidanceName, ...guidanceModel }, pageContext: `WMS IQC ${page}`, lotNo: form.lotNo || rows[0]?.lot_no, materialCode: rows[0]?.material_code, realResults: [] });
      const result: any = await Promise.race([request, new Promise((_, reject) => window.setTimeout(() => reject(new Error("IQC-VIRTUAL-01: 本地模型 5 秒内未响应，请检查 Ollama；当前不会编造检验结果。")), 5000))]);
      const output = result.item?.output || result.output || result.data?.output || result;
      const answer = typeof output === "string" ? output : output.summary || output.nextAction || JSON.stringify(output);
      setVirtualMessages(items => [...items, { role: "assistant", text: answer }]);
    } catch (err) { setVirtualMessages(items => [...items, { role: "assistant", text: err instanceof Error ? err.message : String(err) }]); }
    finally { setVirtualBusy(false); }
  };
  const monitorIqcTable = async () => {
    const row = rows[0];
    if (!row) { setVirtualMonitorStatus("NO_PENDING_LOT"); return; }
    setVirtualMonitorStatus("READING_TABLE");
    try {
      const result: any = await apiClient.post("/qms/iqc/virtual-employee/plan", { guidanceKey: "SMT_IQC", lotNo: row.lot_no || row.lotNo, materialCode: row.material_code || row.materialCode, batchSize: Number(row.quantity || row.received_qty || 0), realResults: [], guidanceAlreadyLoaded: virtualGuidanceRead.current });
      virtualGuidanceRead.current = true;
      const plan = result.item || result.data?.item || result;
      setVirtualMonitorStatus(plan.decision || plan.stage || "MONITORED");
      setVirtualMessages(items => [...items, { role: "assistant", text: `表格监控：${row.lot_no || row.lotNo || row.id}；样本量 ${plan.sampleSize ?? "待匹配"}；状态 ${plan.decision || "WAITING_REAL_DATA"}。${plan.message || "请录入真实检验结果。"}` }]);
    } catch (err) { setVirtualMonitorStatus("ERROR"); setVirtualMessages(items => [...items, { role: "assistant", text: `表格监控失败：${err instanceof Error ? err.message : String(err)}` }]); }
  };
  useEffect(() => { if (!virtualWatching) return; void monitorIqcTable(); const timer = window.setInterval(() => { void load(); }, 15000); return () => window.clearInterval(timer); }, [virtualWatching, page]);
  const sourceForm = ["poReceipt", "lineReturn", "subcontractReturn", "mrbReworkReturn", "qrBinding"].includes(page);
  return <div className="screen-stack"><section className="surface-panel"><div className="section-header"><div><h2>{info.title}</h2><p>{info.description}</p></div><BackButton /></div>
    {error && <p style={{ color: "var(--danger)" }}>{error}</p>}{message && <p style={{ color: "var(--ok)" }}>{message}</p>}
    {sourceForm && page !== "poReceipt" && <div className="toolbar" style={{ flexWrap: "wrap" }}>{field("lotNo", "物料批次")}{field("quantity", "数量")}{field("location", "待检仓位")}{field("operator", "操作员")}<button className="btn btn-primary" onClick={() => void submit("/wms/receiving/qr-bindings", { lotNo: form.lotNo, quantity: Number(form.quantity), location: form.location, warehouse: form.warehouse, sourceType: info.sourceType || "PO_RECEIPT", operator: form.operator })}>收货并生成QR，进入IQC</button></div>}
    {page === "iqcPassMaintenance" && <div className="toolbar" style={{ flexWrap: "wrap" }}>{field("lotId", "物料批次ID")}{field("operator", "检验员")}<select value={form.result} onChange={event => update("result", event.target.value)}><option value="PASS">PASS 合格</option><option value="FAIL">FAIL 不合格</option></select><button className="btn btn-primary" onClick={() => void submit(`/wms/receiving/qr-bindings/${form.lotId}/iqc-result`, { result: form.result, operator: form.operator })}>提交IQC结果</button></div>}
    {page === "defectArchive" && <div className="toolbar" style={{ flexWrap: "wrap" }}>{field("defectId", "不良档案ID")}{field("operator", "移除人")}<button className="btn btn-primary" onClick={() => void submit(`/quality/iqc-defect-cases/${form.defectId}/pallet-removal`, { operator: form.operator })}>建档并从栈板移除</button></div>}
    {page === "mrbApproval" && <div className="toolbar" style={{ flexWrap: "wrap" }}>{field("defectId", "不良档案ID")}{field("operator", "评审人")}<select value={form.decision} onChange={event => update("decision", event.target.value)}><option value="REWORK">返工修复</option><option value="SCRAP">报废</option><option value="VENDOR_RETURN">退货供应商</option></select><button className="btn btn-primary" onClick={() => void submit(`/quality/iqc-defect-cases/${form.defectId}/mrb`, { decision: form.decision, operator: form.operator })}>提交MRB / OA审批</button></div>}
    {page === "scrapFinanceApproval" && <div className="toolbar" style={{ flexWrap: "wrap" }}>{field("defectId", "财务审批ID")}{field("operator", "审批/执行人")}<select value={form.result} onChange={event => update("result", event.target.value)}><option value="APPROVED">财务批准</option><option value="REJECTED">财务拒绝</option></select><button className="btn btn-primary" onClick={() => void submit(`/quality/iqc-scrap-finance-approvals/${form.defectId}/decision`, { decision: form.result, approver: form.operator })}>提交财务审批</button><button className="btn btn-secondary" onClick={() => void submit(`/quality/iqc-scrap-finance-approvals/${form.defectId}/execute`, { operator: form.operator })}>批准后执行报废</button></div>}
    {page === "reworkComplete" && <div className="toolbar" style={{ flexWrap: "wrap" }}>{field("defectId", "不良档案ID")}{field("lotNo", "批次")}{field("quantity", "数量")}{field("location", "复检仓位")}{field("operator", "操作员")}<button className="btn btn-primary" onClick={() => void submit(`/quality/iqc-defect-cases/${form.defectId}/rework-complete`, { operator: form.operator })}>确认返工完成</button><button className="btn btn-secondary" onClick={() => void submit("/wms/receiving/qr-bindings", { lotNo: form.lotNo, quantity: Number(form.quantity), location: form.location, warehouse: form.warehouse, sourceType: "REWORK_RETURN", operator: form.operator })}>生成新QR并进入复检</button></div>}
    {page === "iqcReinspection" && <div className="toolbar" style={{ flexWrap: "wrap" }}>{field("defectId", "不良档案ID")}{field("qrDocumentNo", "返工QR单据号")}{field("operator", "复检员")}<button className="btn btn-primary" onClick={() => void submit("/quality/iqc-reinspections", { caseId: Number(form.defectId), qrDocumentNo: form.qrDocumentNo, operator: form.operator })}>建立复检档案</button></div>}
    {page !== "poReceipt" && <div className="table-shell" style={{ marginTop: 16 }}><table><thead><tr>{["ID", "单据/档案", "批次", "状态/来源", "数量/金额", "操作"].map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={6}>暂无记录</td></tr> : rows.map(row => <tr key={row.id}><td>{value(row, "id", "material_lot_id")}</td><td>{value(row, "document_no", "approval_no", "case_no", "task_no", "reinspection_no")}</td><td>{value(row, "lot_no")}</td><td>{value(row, "status", "source_type", "decision")}</td><td>{page === "scrapFinanceApproval" ? `${value(row, "scrap_qty")} / ${value(row, "scrap_amount")} ${value(row, "currency")}` : value(row, "quantity", "defective_qty")}</td><td>{page === "scrapFinanceApproval" && row.status === "PENDING_FINANCE_APPROVAL" && <><button onClick={() => void submit(`/quality/iqc-scrap-finance-approvals/${row.id}/decision`, { decision: "APPROVED", approver: form.operator })}>财务批准</button><button onClick={() => void submit(`/quality/iqc-scrap-finance-approvals/${row.id}/decision`, { decision: "REJECTED", approver: form.operator })}>拒绝</button></>}{page === "scrapFinanceApproval" && row.status === "FINANCE_APPROVED" && <button onClick={() => void submit(`/quality/iqc-scrap-finance-approvals/${row.id}/execute`, { operator: form.operator })}>执行报废</button>}{page === "iqcReinspection" && ["OPEN", "PENDING"].includes(String(row.status)) && <><button onClick={() => void submit(`/quality/iqc-reinspections/${row.id}/complete`, { result: "PASS", operator: form.operator })}>PASS</button><button onClick={() => void submit(`/quality/iqc-reinspections/${row.id}/complete`, { result: "FAIL", operator: form.operator })}>FAIL</button></>}{page === "defectArchive" && row.status === "PALLET_REMOVAL_PENDING" && <button onClick={() => void submit(`/quality/iqc-defect-cases/${row.id}/pallet-removal`, { operator: form.operator })}>从栈板移除</button>}</td></tr>)}</tbody></table></div>}
    {page === "poReceipt" && <section style={{ marginTop: 16, padding: 14, border: "1px solid #fde68a", borderRadius: 8, background: "#fffbeb" }}><h3 style={{ margin: "0 0 8px", color: "#92400e" }}>前IQC管理 · 收料绑定待检</h3><p style={{ margin: "0 0 10px", fontSize: 12, color: "#92400e" }}>PDA 收料绑定成功并等待 IQC 检验的材料。</p><div className="table-shell"><table><thead><tr><th>Material SN</th><th>Supplier Code</th><th>Supplier Name</th><th>数量(合并)</th><th>生产日期</th><th>Lot</th><th>库位 QR</th><th>IQC 状态</th></tr></thead><tbody>{preIqcRows.length === 0 ? <tr><td colSpan={8}>暂无待检材料</td></tr> : preIqcRows.map((row: any, i) => { const iqc = String(row.iqcStatus || "pending").toLowerCase(); return <tr key={i}><td><code>{row.materialSn}</code></td><td><code>{row.supplierCode}</code></td><td>{row.supplierName}</td><td>{row.totalQty}</td><td>{row.productionDate ? new Date(row.productionDate).toLocaleDateString("zh-CN") : ""}</td><td><code>{row.lot}</code></td><td><code style={{ fontSize: 10 }}>{row.locationQrs}</code></td><td>{iqc.startsWith("pending") ? <select defaultValue="PASS" onChange={e => void apiClient.put(`/wms/receiving/pre-iqc/${encodeURIComponent(String(row.lot))}/result`, { result: e.target.value }).then(() => window.location.reload())}><option value="PASS">PASS</option><option value="FAIL">FAIL</option></select> : <span style={{ fontWeight: 700, color: iqc === "released" ? "var(--ok)" : "var(--danger)" }}>{iqc.toUpperCase()}</span>}</td></tr>; })}</tbody></table></div></section>}
    <div style={{ position: "fixed", right: 18, bottom: 18, zIndex: 30 }}><button type="button" className="btn btn-primary" onClick={() => setVirtualOpen(value => !value)}>IQC-VIRTUAL-01</button>{virtualOpen && <div style={{ position: "absolute", right: 0, bottom: 48, width: 360, maxWidth: "calc(100vw - 36px)", background: "#fff", border: "1px solid #c7d2fe", borderRadius: 12, boxShadow: "0 12px 35px rgba(15,23,42,.25)" }}><div style={{ padding: "10px 12px", background: "#312e81", color: "#fff", borderRadius: "12px 12px 0 0", display: "flex", justifyContent: "space-between" }}><strong>IQC-VIRTUAL-01</strong><button type="button" onClick={() => setVirtualOpen(false)}>×</button></div><div style={{ padding: 10, maxHeight: 220, overflow: "auto" }}>{virtualMessages.length === 0 && <div style={{ color: "#64748b", fontSize: 12 }}>可询问当前 Excel 指导、批次和下一步 IQC 操作。</div>}{virtualMessages.map((message, index) => <div key={index} style={{ textAlign: message.role === "user" ? "right" : "left", margin: "6px 0" }}><span style={{ display: "inline-block", padding: "6px 8px", borderRadius: 8, background: message.role === "user" ? "#dbeafe" : "#f1f5f9", fontSize: 12 }}>{message.text}</span></div>)}{virtualBusy && <div style={{ color: "#64748b", fontSize: 12 }}>IQC-VIRTUAL-01 正在读取指导文件和批次历史…</div>}</div><div style={{ display: "flex", gap: 6, padding: 10, borderTop: "1px solid #e2e8f0", flexWrap: "wrap" }}><button type="button" className="btn btn-secondary" onClick={() => { setVirtualWatching(value => !value); setVirtualOpen(true); }}>{virtualWatching ? "停止监控表格" : "开始监控表格"}</button><span style={{ fontSize: 11, color: "#64748b", alignSelf: "center" }}>{virtualMonitorStatus}</span><input value={virtualInput} onChange={event => setVirtualInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void askVirtualEmployee(); }} placeholder="给 IQC 员工指令" style={{ flex: 1, minWidth: 180 }} /><button type="button" className="btn btn-primary" onClick={() => void askVirtualEmployee()} disabled={virtualBusy}>发送</button></div></div>}</div>
  </section></div>;
}
