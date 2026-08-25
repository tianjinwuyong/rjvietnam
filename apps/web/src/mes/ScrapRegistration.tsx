import { useEffect, useState } from "react";
import { CheckCircle, XCircle } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesApi } from "../api";
import type { ScrapRecord, ScrapReasonCode } from "../api/mes";

const statusBadgeClass: Record<string, string> = {
  pending: "badge-warning",
  approved: "badge-ok",
  rejected: "badge-danger",
};

function ScrapRow({ row, idx, locale, onApprove, onReject }: {
  row: ScrapRecord;
  idx: number;
  locale: Locale;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
}) {
  return (
    <tr>
      <td style={{ textAlign: "center" }}>{idx}</td>
      <td>{row.productModel ?? "—"}</td>
      <td>{row.quantity}</td>
      <td>{row.sn}</td>
      <td>{row.pcbNo ?? "—"}</td>
      <td>{row.laserQrDate ? new Date(row.laserQrDate).toLocaleDateString() : "—"}</td>
      <td>
        <span className="badge badge-info">{row.scrapReasonCode}</span>
        {row.scrapReasonName && <span style={{ marginLeft: 4 }}>{row.scrapReasonName}</span>}
        {row.scrapReasonDetail && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{row.scrapReasonDetail}</div>}
      </td>
      <td>{row.responsiblePerson ?? "—"}</td>
      <td>{row.notes ?? "—"}</td>
      <td>
        <span className={`badge ${statusBadgeClass[row.status] ?? "badge-info"}`}>
          {t(`mes.scrap.status.${row.status}` as any, locale)}
        </span>
      </td>
      <td>{row.poNumber ?? "—"}</td>
      <td>
        {row.status === "pending" && (
          <div style={{ display: "flex", gap: 4 }}>
            <button type="button" className="action-button" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => onApprove(row.id)}>
              {t("mes.scrap.approve" as any, locale)}
            </button>
            <button type="button" className="action-button" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => onReject(row.id)}>
              {t("mes.scrap.reject" as any, locale)}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

export function ScrapRegistration({ locale }: { locale: Locale }) {
  const [scraps, setScraps] = useState<ScrapRecord[]>([]);
  const [stationScraps, setStationScraps] = useState<any[]>([]);
  const [dataConflicts, setDataConflicts] = useState<any[]>([]);
  const [reasonCodes, setReasonCodes] = useState<ScrapReasonCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"pending" | "all">("pending");

  /* ── Filter state matching Excel header fields ── */
  const [showFilters, setShowFilters] = useState(false);
  const [filter, setFilter] = useState({
    customer: "",
    model: "",
    fromDate: "",
    toDate: "",
    station: "",
    lineCode: "",
    poNumber: "",
  });

  /* ── Form state ── */
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    sn: "", pcbNo: "", productModel: "",
    scrapStation: "", lineCode: "",
    scrapReasonCode: "", scrapReasonDetail: "",
    responsiblePerson: "", poNumber: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  /* ── Load data ── */
  function load() {
    setLoading(true);
    const params: Parameters<typeof mesApi.getScraps>[0] = {
      status: statusFilter === "pending" ? "pending" : undefined,
      limit: 500,
    };
    if (filter.station)   params.stationCode = filter.station;
    if (filter.lineCode)  params.lineCode    = filter.lineCode;
    if (filter.fromDate)  params.fromDate    = filter.fromDate;
    if (filter.toDate)    params.toDate      = filter.toDate;

    Promise.all([
      mesApi.getScraps(params),
      mesApi.getScrapReasonCodes(),
      fetch('/api/station/scrap-requests').then(response => response.ok ? response.json() : Promise.reject(response.status)),
      fetch('/api/station/sync/conflicts').then(response => response.ok ? response.json() : Promise.reject(response.status)),
    ])
      .then(([scrapsRes, reasonsRes, stationRes, conflictRes]) => {
        setScraps(scrapsRes.items);
        setReasonCodes(reasonsRes.items);
        setStationScraps(stationRes.items || []);
        setDataConflicts(conflictRes.items || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }

  useEffect(() => { load(); }, [statusFilter]);

  function handleApprove(id: number) {
    mesApi.updateScrap(id, { status: "approved" }).then(() => {
      setScraps((prev) => prev.map((s) => s.id === id ? { ...s, status: "approved" as const } : s));
    });
  }

  function handleReject(id: number) {
    mesApi.updateScrap(id, { status: "rejected" }).then(() => {
      setScraps((prev) => prev.map((s) => s.id === id ? { ...s, status: "rejected" as const } : s));
    });
  }

  async function approveStationScrap(row: any) {
    const approver = window.prompt('请输入MES审批人姓名');
    if (!approver) return;
    const reason = window.prompt('请输入批准意见');
    if (!reason) return;
    const response = await fetch(`/api/station/scrap-requests/${row.requestId}/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'MES_MANAGER', approver, reason }),
    });
    if (!response.ok) return window.alert(`MES审批失败 HTTP ${response.status}`);
    load();
  }

  async function rejectStationScrap(row: any) {
    const approver = window.prompt('请输入MES审批人姓名');
    if (!approver) return;
    const reason = window.prompt('请输入驳回原因');
    if (!reason) return;
    const response = await fetch(`/api/station/scrap-requests/${row.requestId}/reject`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approver, reason }),
    });
    if (!response.ok) return window.alert(`MES驳回失败 HTTP ${response.status}`);
    load();
  }

  async function assessStationScrap(row: any) {
    const assessedBy = window.prompt('请输入考核登记人'); if (!assessedBy) return;
    const responsiblePerson = window.prompt('请输入责任人（没有则填“无”）'); if (!responsiblePerson) return;
    const responsibilityType = window.prompt('责任类型：人员 / 设备 / 工艺 / 其他', '人员') || '其他';
    const score = Number(window.prompt('扣分（没有填0）', '0') || 0);
    const deductionAmount = Number(window.prompt('考核金额（没有填0）', '0') || 0);
    const assessmentNote = window.prompt('请输入考核说明'); if (!assessmentNote) return;
    const response = await fetch(`/api/station/scrap-requests/${row.requestId}/assessment`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assessedBy,
        responsiblePerson, responsibilityType, equipmentNo: row.equipmentNo, score, deductionAmount,
        assessmentResult: 'RECORDED', assessmentNote }),
    });
    if (!response.ok) window.alert(`考核保存失败 HTTP ${response.status}`); else window.alert('考核已保存到MES PostgreSQL');
  }

  async function recordMeetingVote(row: any) {
    const meetingNo=window.prompt('会议编号'); if(!meetingNo)return;
    const role=(window.prompt('角色：QUALITY / PRODUCTION / MES_IT / FACTORY_MANAGER')||'').toUpperCase(); if(!role)return;
    const voter=window.prompt('参会审批人姓名'); if(!voter)return;
    const decision=(window.prompt('表决：APPROVE 或 REJECT','APPROVE')||'').toUpperCase(); if(!decision)return;
    const opinion=window.prompt('请输入会议意见'); if(!opinion)return;
    const response=await fetch(`/api/station/sync/conflicts/${row.conflictId}/meeting-vote`,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({meetingNo,role,voter,decision,opinion})});
    if(!response.ok)window.alert(`会议表决保存失败 HTTP ${response.status}`);else window.alert('会议表决已写入不可篡改审计记录');
  }

  async function resolveConflict(row: any) {
    const correctSource=(window.prompt('确认正确数据来源：LOCAL / MES','MES')||'').toUpperCase(); if(!correctSource)return;
    const investigator=window.prompt('调查确认人'); if(!investigator)return;
    const note=window.prompt('调查依据和调整说明'); if(!note)return;
    const response=await fetch(`/api/station/sync/conflicts/${row.conflictId}/resolve`,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({correctSource,investigator,note})});
    if(!response.ok){const data=await response.json().catch(()=>({}));window.alert(data?.error?.message||`确认失败 HTTP ${response.status}`);}
    else load();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.sn || !form.scrapStation || !form.lineCode || !form.scrapReasonCode) {
      setError("Please fill in required fields");
      return;
    }
    setSubmitting(true);
    setError("");
    mesApi
      .createScrap({
        sn: form.sn,
        pcbNo: form.pcbNo || undefined,
        productModel: form.productModel || undefined,
        scrapStation: form.scrapStation,
        lineCode: form.lineCode,
        scrapReasonCode: form.scrapReasonCode,
        scrapReasonDetail: form.scrapReasonDetail || undefined,
        responsiblePerson: form.responsiblePerson || undefined,
        poNumber: form.poNumber || undefined,
      })
      .then((res) => {
        const newScrap: ScrapRecord = {
          id: res.item.id,
          sn: res.item.sn,
          status: res.item.status as ScrapRecord["status"],
          scrapStation: form.scrapStation,
          lineCode: form.lineCode,
          scrapReasonCode: form.scrapReasonCode,
          scrapReasonDetail: form.scrapReasonDetail || undefined,
          responsiblePerson: form.responsiblePerson || undefined,
          quantity: 1,
          createdAt: new Date().toISOString(),
        };
        setScraps((prev) => [newScrap, ...prev]);
        setShowForm(false);
        setForm({ sn: "", pcbNo: "", productModel: "", scrapStation: "", lineCode: "", scrapReasonCode: "", scrapReasonDetail: "", responsiblePerson: "", poNumber: "" });
        setSubmitting(false);
      })
      .catch(() => { setError("Failed to register scrap"); setSubmitting(false); });
  }

  const pendingCount = scraps.filter((s) => s.status === "pending").length;

  return (
    <div className="screen-stack">

      <section className="surface-panel">
        <div className="section-header"><div><h2>生产工位报废审批</h2><p>PostgreSQL统一管理 · 审批后进入报废品隔离留存，禁止擅自处理</p></div></div>
        <div className="table-shell"><table><thead><tr>
          <th>报废单号</th><th>工位</th><th>整盘/产品</th><th>原因</th><th>申请人</th><th>设备</th><th>状态</th><th>审批人</th><th>时间</th><th>操作</th>
        </tr></thead><tbody>{stationScraps.map(row => <tr key={row.requestId}>
          <td>SCR-{String(row.requestId).padStart(8, '0')}</td><td>{row.stationCode}</td><td>{row.batchId}</td>
          <td><span className="badge badge-info">{row.reasonCode || 'S99'}</span> {row.requestReason}</td>
          <td>{row.applicant || '-'}</td><td>{row.equipmentNo || '-'}</td>
          <td><span className={`badge ${row.status === 'PENDING_MES_APPROVAL' ? 'badge-warning' : row.status === 'REJECTED' ? 'badge-danger' : 'badge-ok'}`}>{row.status}</span></td>
          <td>{row.mesApprover || row.rejectedBy || '-'}</td><td>{new Date(row.mesApprovedAt || row.rejectedAt || row.requestedAt).toLocaleString()}</td>
          <td><div style={{display:'flex',gap:4}}>{row.status === 'PENDING_MES_APPROVAL' && <>
            <button className="action-button" onClick={() => approveStationScrap(row)}>MES批准</button>
            <button className="action-button" onClick={() => rejectStationScrap(row)}>驳回</button></>}
            {row.status === 'SCRAPPED_HELD' && <button className="action-button" onClick={() => assessStationScrap(row)}>责任考核</button>}
          </div></td>
        </tr>)}</tbody></table></div>
      </section>

      <section className="surface-panel">
        <div className="section-header"><div><h2>现场数据分歧调查与会议审批</h2><p>双方原始数据永久保留；以调查确认正确的一方为准调整</p></div></div>
        <div className="table-shell"><table><thead><tr>
          <th>事件</th><th>工位/数据集</th><th>级别</th><th>本地</th><th>MES</th><th>状态</th><th>调查结论</th><th>操作</th>
        </tr></thead><tbody>{dataConflicts.map(row=><tr key={row.conflictId}>
          <td>DCF-{String(row.conflictId).padStart(8,'0')}<div style={{fontSize:11,color:'var(--muted)'}}>{new Date(row.detectedAt).toLocaleString()}</div></td>
          <td>{row.stationCode}<br/><strong>{row.dataset}</strong></td>
          <td><span className={`badge ${row.severity==='NORMAL'?'badge-info':'badge-danger'}`}>{row.severity||'NORMAL'}</span></td>
          <td>V{row.localVersion||0} / {row.localPayload?.length||0}<div title={row.localHash} style={{fontSize:10}}>{String(row.localHash||'').slice(0,12)}</div></td>
          <td>V{row.mesVersion||0} / {row.mesPayload?.length||0}<div title={row.mesHash} style={{fontSize:10}}>{String(row.mesHash||'').slice(0,12)}</div></td>
          <td><span className={`badge ${row.status==='RESOLVED'?'badge-ok':'badge-warning'}`}>{row.status}</span></td>
          <td>{row.resolution||'-'}<div style={{fontSize:11}}>{row.investigatedBy||'-'} {row.investigationNote||''}</div></td>
          <td>{row.status==='PENDING_INVESTIGATION'&&<div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
            {row.meetingRequired&&<button className="action-button" onClick={()=>recordMeetingVote(row)}>会议表决</button>}
            <button className="action-button" onClick={()=>resolveConflict(row)}>调查确认</button>
          </div>}</td>
        </tr>)}</tbody></table></div>
      </section>

      {/* ── Summary cards ─────────────────────────────── */}
      <div className="metric-grid">
        <article className="stat-card">
          <span>{t("mes.scrap.filter.pending" as any, locale)}</span>
          <strong>{pendingCount}</strong>
          <span className={`badge ${pendingCount > 0 ? "badge-warning" : "badge-ok"}`}>{t("common.status" as any, locale)}</span>
        </article>
        <article className="stat-card">
          <span>{t("common.total" as any, locale)}</span>
          <strong>{scraps.length}</strong>
          <span className="badge badge-info">{t("mes.scrap.title" as any, locale)}</span>
        </article>
      </div>

      {/* ── Toolbar ─────────────────────────────────── */}
      <div className="toolbar">
        <button type="button" className={`action-button ${statusFilter === "pending" ? "active" : ""}`} onClick={() => setStatusFilter("pending")}>
          {t("mes.scrap.filter.pending" as any, locale)}
        </button>
        <button type="button" className={`action-button ${statusFilter === "all" ? "active" : ""}`} onClick={() => setStatusFilter("all")}>
          {t("mes.scrap.filter.all" as any, locale)}
        </button>
        <button type="button" className={`action-button ${showFilters ? "active" : ""}`} onClick={() => setShowFilters(!showFilters)}>
          {showFilters ? t("common.cancel" as any, locale) : "🔍 " + t("common.filter" as any, locale)}
        </button>
        <button type="button" className="action-button" style={{ marginLeft: "auto" }} onClick={() => setShowForm(!showForm)}>
          {showForm ? t("common.cancel" as any, locale) : t("mes.scrap.register" as any, locale)}
        </button>
      </div>

      {/* ── Filter bar (matches Excel B3-B9 header) ── */}
      {showFilters && (
        <section className="surface-panel">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, padding: 16 }}>
            {[
              { key: "customer",   label: t("mes.stagnation.customer" as any, locale) },
              { key: "model",       label: t("mes.stagnation.productModel" as any, locale) },
              { key: "fromDate",    label: t("mes.scrap.fromDate" as any, locale) },
              { key: "toDate",      label: t("mes.scrap.toDate" as any, locale) },
              { key: "station",     label: t("mes.scrap.station" as any, locale) },
              { key: "lineCode",    label: t("mes.scrap.line" as any, locale) },
              { key: "poNumber",    label: t("mes.scrap.poNumber" as any, locale) },
            ].map(({ key, label }) => (
              <label key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{label}</span>
                <input
                  type={key.includes("Date") ? "date" : "text"}
                  value={(filter as any)[key]}
                  onChange={(e) => setFilter((f) => ({ ...f, [key]: e.target.value }))}
                  placeholder={label}
                />
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, padding: "0 16px 16px" }}>
            <button type="button" className="action-button" onClick={load}>{t("common.filter" as any, locale)}</button>
            <button type="button" className="action-button" onClick={() => { setFilter({ customer: "", model: "", fromDate: "", toDate: "", station: "", lineCode: "", poNumber: "" }); load(); }}>
              {t("common.clear" as any, locale)}
            </button>
          </div>
        </section>
      )}

      {/* ── Registration form ────────────────────────── */}
      {showForm && (
        <section className="surface-panel">
          <div className="section-header">
            <h2>{t("mes.scrap.register" as any, locale)}</h2>
          </div>
          <form onSubmit={handleSubmit} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: 16 }}>
            {[
              { field: "sn",               label: `${t("mes.stagnation.sn" as any, locale)} *`,          placeholder: "PCB SN" },
              { field: "pcbNo",            label: t("mes.stagnation.pcbNo" as any, locale),             placeholder: "PCB No." },
              { field: "productModel",     label: t("mes.stagnation.productModel" as any, locale),      placeholder: "Model" },
              { field: "scrapStation",     label: `${t("mes.scrap.station" as any, locale)} *`,          placeholder: "Station code" },
              { field: "lineCode",         label: `${t("mes.scrap.line" as any, locale)} *`,              placeholder: "Line code" },
              { field: "responsiblePerson",label: t("mes.scrap.responsible" as any, locale),            placeholder: "Name" },
              { field: "poNumber",         label: t("mes.scrap.poNumber" as any, locale),               placeholder: "PO Number" },
            ].map(({ field, label, placeholder }) => (
              <label key={field} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 12 }}>{label}</span>
                <input
                  value={(form as any)[field]}
                  onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                  placeholder={placeholder}
                />
              </label>
            ))}
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12 }}>{t("mes.scrap.reasonCode" as any, locale)} *</span>
              <select value={form.scrapReasonCode} onChange={(e) => setForm((f) => ({ ...f, scrapReasonCode: e.target.value }))} required>
                <option value="">—</option>
                {reasonCodes.map((r) => (
                  <option key={r.code} value={r.code}>{r.code} — {r.name_zh}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12 }}>{t("mes.scrap.reasonDetail" as any, locale)}</span>
              <input value={form.scrapReasonDetail} onChange={(e) => setForm((f) => ({ ...f, scrapReasonDetail: e.target.value }))} placeholder="Additional details" />
            </label>
            {error && <p style={{ gridColumn: "1 / -1", color: "var(--danger)", fontSize: 13 }}>{error}</p>}
            <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
              <button type="submit" className="action-button" disabled={submitting}>
                {submitting ? "..." : t("mes.scrap.register" as any, locale)}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* ── Main table — matches Excel 产品报废 sheet ── */}
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("mes.scrap.title" as any, locale)}</h2>
            <p>{t("section.timeline" as any, locale)}</p>
          </div>
        </div>
        {loading ? (
          <div className="placeholder-view">{t("common.loading" as any, locale)}</div>
        ) : scraps.length === 0 ? (
          <div className="placeholder-view"><CheckCircle size={40} /><p>{t("common.noData" as any, locale)}</p></div>
        ) : (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: "center", width: 40 }}>No.</th>
                  <th>{t("mes.stagnation.productModel" as any, locale)}</th>
                  <th>{t("mes.scrap.times" as any, locale)}</th>
                  <th>{t("mes.stagnation.sn" as any, locale)}</th>
                  <th>{t("mes.stagnation.pcbNo" as any, locale)}</th>
                  <th>{t("mes.stagnation.laserQrDate" as any, locale)}</th>
                  <th>{t("mes.scrap.reason" as any, locale)}</th>
                  <th>{t("mes.scrap.responsible" as any, locale)}</th>
                  <th>{t("common.notes" as any, locale)}</th>
                  <th>{t("mes.scrap.status" as any, locale)}</th>
                  <th>{t("mes.scrap.poNumber" as any, locale)}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {scraps.map((row, i) => (
                  <ScrapRow key={row.id} row={row} idx={i + 1} locale={locale} onApprove={handleApprove} onReject={handleReject} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
