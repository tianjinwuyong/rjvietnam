import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Link2, Play, RefreshCw, RotateCcw,
  Send, Settings2, X, Zap,
} from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import {
  wmsApi,
  type MesSyncConfig, type MesSyncLogRow, type MesSyncMaterialRow,
  type MesSyncPendingRow, type MesSyncStatus, type MesWritebackRow,
} from "../api/wms";

type RunResult = {
  skipped?: boolean;
  reason?: string;
  pulled?: number;
  created?: number;
  updated?: number;
  failed?: number;
  sent?: number;
  messages?: string[];
};

const errOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const fmt = (v: string | null | undefined) =>
  v ? String(v).slice(0, 19).replace("T", " ") : "—";
const n0 = (v: number | null | undefined) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const TASK_KEY: Record<string, string> = {
  work_order: "wms.mesSync.taskWorkOrder",
  pending: "wms.mesSync.taskPending",
  picking: "wms.mesSync.taskPicking",
  writeback: "wms.mesSync.taskWriteback",
};
const RUN_KEY: Record<string, string> = {
  success: "wms.mesSync.statusSuccess",
  partial: "wms.mesSync.statusPartial",
  failed: "wms.mesSync.statusFailed",
};
const WB_KEY: Record<string, string> = {
  pending: "wms.mesSync.wbPending",
  sent: "wms.mesSync.wbSent",
  failed: "wms.mesSync.wbFailed",
  skipped: "wms.mesSync.wbSkipped",
};
const SECTION_LABEL: Record<string, string> = {
  smt: "SMT", dip: "DIP", assembly: "ASSY", packing: "PACK", aux: "AUX",
};

export function WmsMesSync({ locale }: { locale: Locale }) {
  const [status, setStatus] = useState<MesSyncStatus | null>(null);
  const [config, setConfig] = useState<MesSyncConfig | null>(null);
  const [form, setForm] = useState({
    baseUrl: "", intervalMinutes: 5, autoSync: false, autoPicking: false,
    pickingAutoApprove: true, pickingQtyMode: "suggest" as "suggest" | "open",
    operatorId: "", writebackEnabled: false, apiKey: "",
  });
  const [pending, setPending] = useState<MesSyncPendingRow[]>([]);
  const [keyword, setKeyword] = useState("");
  const [writebacks, setWritebacks] = useState<MesWritebackRow[]>([]);
  const [wbCounts, setWbCounts] = useState<Record<string, number>>({});
  const [wbStatus, setWbStatus] = useState("");
  const [wbKeyword, setWbKeyword] = useState("");
  const [logs, setLogs] = useState<MesSyncLogRow[]>([]);
  const [materialsFor, setMaterialsFor] = useState<MesSyncPendingRow | null>(null);
  const [materials, setMaterials] = useState<MesSyncMaterialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [st, cfg, pend, wb, lg] = await Promise.all([
        wmsApi.getMesSyncStatus(),
        wmsApi.getMesSyncConfig(),
        wmsApi.getMesSyncPending({ keyword, limit: 200 }),
        wmsApi.getMesWritebackList({ status: wbStatus, keyword: wbKeyword, limit: 50 }),
        wmsApi.getMesSyncLogs({ limit: 20 }),
      ]);
      setStatus(st);
      setConfig(cfg);
      setForm((f) => ({
        ...f,
        baseUrl: cfg.baseUrl ?? "",
        intervalMinutes: cfg.intervalMinutes ?? 5,
        autoSync: !!cfg.autoSync,
        autoPicking: !!cfg.autoPicking,
        pickingAutoApprove: !!cfg.pickingAutoApprove,
        pickingQtyMode: cfg.pickingQtyMode === "open" ? "open" : "suggest",
        operatorId: cfg.operatorId ?? "",
        writebackEnabled: !!cfg.writebackEnabled,
        apiKey: "",
      }));
      setPending(pend.items ?? []);
      setWritebacks(wb.items ?? []);
      setWbCounts(wb.counts ?? {});
      setLogs(lg.items ?? []);
    } catch (e) {
      setError(errOf(e));
    }
    setLoading(false);
  }, [keyword, wbStatus, wbKeyword]);

  useEffect(() => { void load(); }, [load]);

  const refreshQueues = useCallback(async () => {
    const [st, pend, wb, lg] = await Promise.all([
      wmsApi.getMesSyncStatus(),
      wmsApi.getMesSyncPending({ keyword, limit: 200 }),
      wmsApi.getMesWritebackList({ status: wbStatus, keyword: wbKeyword, limit: 50 }),
      wmsApi.getMesSyncLogs({ limit: 20 }),
    ]);
    setStatus(st);
    setPending(pend.items ?? []);
    setWritebacks(wb.items ?? []);
    setWbCounts(wb.counts ?? {});
    setLogs(lg.items ?? []);
  }, [keyword, wbStatus, wbKeyword]);

  const run = async (key: string, fn: () => Promise<RunResult | void>, doneMsg?: string) => {
    setBusy(key);
    setError("");
    setNotice("");
    setWarnings([]);
    try {
      const r = (await fn()) as RunResult | void;
      if (r && (r.skipped || r.pulled !== undefined)) {
        const bits: string[] = [];
        if (r.skipped) bits.push(`${t("wms.mesSync.wbSkipped", locale)}: ${r.reason ?? ""}`);
        if (r.pulled !== undefined) bits.push(`${t("wms.mesSync.runResult", locale)} ${r.pulled}`);
        if (r.created !== undefined) bits.push(`${t("wms.mesSync.runCreated", locale)} ${r.created}`);
        if (r.updated !== undefined) bits.push(`${t("wms.mesSync.runUpdated", locale)} ${r.updated}`);
        if (r.sent !== undefined) bits.push(`${t("wms.mesSync.wbSent", locale)} ${r.sent}`);
        if (r.failed !== undefined) bits.push(`${t("wms.mesSync.runFailed", locale)} ${r.failed}`);
        setNotice(bits.join(" · "));
        setWarnings(r.messages ?? []);
      } else if (doneMsg) {
        setNotice(doneMsg);
      }
      await refreshQueues();
    } catch (e) {
      setError(errOf(e));
    }
    setBusy("");
  };

  const saveConfig = () => run("save", async () => {
    const payload: Record<string, unknown> = {
      baseUrl: form.baseUrl,
      intervalMinutes: form.intervalMinutes,
      autoSync: form.autoSync,
      autoPicking: form.autoPicking,
      pickingAutoApprove: form.pickingAutoApprove,
      pickingQtyMode: form.pickingQtyMode,
      operatorId: form.operatorId,
      writebackEnabled: form.writebackEnabled,
    };
    if (form.apiKey.trim()) payload.apiKey = form.apiKey.trim();
    const cfg = await wmsApi.saveMesSyncConfig(payload);
    setConfig(cfg);
    setForm((f) => ({ ...f, apiKey: "" }));
  }, t("wms.mesSync.saved", locale));

  const testConn = () => run("test", async () => {
    const r = await wmsApi.testMesSync();
    setNotice(`${t("wms.mesSync.testOk", locale)} · ${r.service || "-"} · ${r.latencyMs} ms`);
  });

  const openMaterials = async (row: MesSyncPendingRow) => {
    setMaterialsFor(row);
    setMaterials([]);
    setError("");
    try {
      const r = await wmsApi.getMesSyncMaterials(row.workOrderNo);
      setMaterials(r.items ?? []);
    } catch (e) {
      setError(errOf(e));
    }
  };

  const resyncMaterials = async () => {
    if (!materialsFor) return;
    const moNo = materialsFor.workOrderNo;
    setBusy("materials");
    setError("");
    try {
      await wmsApi.syncMesMaterials(moNo);
      const r = await wmsApi.getMesSyncMaterials(moNo);
      setMaterials(r.items ?? []);
      await refreshQueues();
    } catch (e) {
      setError(errOf(e));
    }
    setBusy("");
  };

  const generate = (row: MesSyncPendingRow) => run(`gen:${row.workOrderNo}`, async () => {
    const r = await wmsApi.generateMesPicking(row.workOrderNo);
    const bits = [`${t("wms.mesSync.runCreated", locale)} ${r.created}`, `${t("wms.mesSync.runUpdated", locale)} ${r.refreshed}`];
    if (r.pickingNos?.length) bits.push(r.pickingNos.join(", "));
    setNotice(bits.join(" · "));
    setWarnings(r.warnings ?? []);
  });

  const totalUnmatched = useMemo(
    () => pending.reduce((s, r) => s + n0(r.unmatchedCount), 0),
    [pending],
  );
  const enabled = !loading && busy === "";

  return (
    <div className="screen-stack">
      {error && (
        <section className="surface-panel">
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", color: "var(--danger)" }}>
            <AlertTriangle size={16} style={{ marginTop: 2 }} />
            <div style={{ flex: 1 }}>{error}</div>
            <button className="action-button" type="button" onClick={() => setError("")} title={t("wms.mesSync.close", locale)}>
              <X size={13} />
            </button>
          </div>
        </section>
      )}
      {notice && (
        <section className="surface-panel">
          <div style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--ok)" }}>
            <CheckCircle2 size={16} />
            <div style={{ flex: 1, fontSize: 13 }}>{notice}</div>
            <button className="action-button" type="button" onClick={() => { setNotice(""); setWarnings([]); }} title={t("wms.mesSync.close", locale)}>
              <X size={13} />
            </button>
          </div>
          {warnings.length > 0 && (
            <ul style={{ margin: "8px 0 0 22px", padding: 0, fontSize: 12, color: "var(--warn)" }}>
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </section>
      )}
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>
              <Link2 size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />
              {t("wms.mesSync.title", locale)}
            </h2>
            <p>{t("wms.mesSync.subtitle", locale)}</p>
          </div>
          <div className="toolbar" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-secondary" type="button" disabled={!enabled} onClick={() => void run("syncFull", () => wmsApi.syncMesWorkOrders({ full: true }))}>
              <RefreshCw size={14} style={{ marginRight: 6 }} />{busy === "syncFull" ? t("wms.mesSync.running", locale) : t("wms.mesSync.syncFull", locale)}
            </button>
            <button className="btn btn-secondary" type="button" disabled={!enabled} onClick={() => void run("syncInc", () => wmsApi.syncMesWorkOrders({ full: false }))}>
              <Zap size={14} style={{ marginRight: 6 }} />{busy === "syncInc" ? t("wms.mesSync.running", locale) : t("wms.mesSync.syncIncremental", locale)}
            </button>
            <button className="action-button" type="button" disabled={!enabled} onClick={() => void run("syncPending", () => wmsApi.syncMesPending())} title={t("wms.mesSync.syncPending", locale)}>
              <Play size={14} />
            </button>
            <button className="action-button" type="button" disabled={!enabled} onClick={() => void load()} title={t("common.refresh", locale)}>
              <RotateCcw size={14} />
            </button>
          </div>
        </div>
        <div className="toolbar" style={{ gap: 20, flexWrap: "wrap", marginTop: 10, fontSize: 12 }}>
          <span>{t("wms.mesSync.baseUrl", locale)}: <code>{status?.baseUrl || "—"}</code></span>
          <span>{config?.hasApiKey ? `${t("wms.mesSync.apiKeyLabel", locale)} ${config.apiKeyMasked}` : t("wms.mesSync.notConfigured", locale)}</span>
          <span>{t("wms.mesSync.lastRun", locale)}: {fmt(status?.lastRunAt)}</span>
          <span>{t("wms.mesSync.cursor", locale)}: {status?.cursor || "—"}</span>
          {status?.lastStatus && (
            <span className="badge" style={{ background: status.lastStatus === "success" ? "var(--ok)" : status.lastStatus === "failed" ? "var(--danger)" : "var(--warn)", color: "#fff" }}>
              {t(RUN_KEY[status.lastStatus] || "wms.mesSync.statusPartial", locale)}
            </span>
          )}
        </div>
        <div className="toolbar" style={{ gap: 16, flexWrap: "wrap", marginTop: 12 }}>
          {([
            ["wms.mesSync.cntMesWo", status?.counts.mesWorkOrders],
            ["wms.mesSync.cntMesWoPending", status?.counts.mesWorkOrdersPending],
            ["wms.mesSync.cntOpenMaterials", status?.counts.openMaterials],
            ["wms.mesSync.cntMesPicking", status?.counts.mesPickingOrders],
            ["wms.mesSync.cntPickingToIssue", status?.counts.mesPickingToIssue],
            ["wms.mesSync.cntWbPending", status?.counts.writebackPending],
            ["wms.mesSync.cntWbFailed", status?.counts.writebackFailed],
          ] as Array<[string, number | undefined]>).map(([k, v]) => (
            <div key={k} style={{ flex: "1 1 110px", textAlign: "center", border: "1px solid var(--line, #e2e8f0)", borderRadius: 8, padding: "8px 4px" }}>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{n0(v)}</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{t(k, locale)}</div>
            </div>
          ))}
        </div>
      </section>
      <section className="surface-panel" style={{ marginTop: 16 }}>
        <div className="section-header">
          <div>
            <h3><Settings2 size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />{t("wms.mesSync.configTitle", locale)}</h3>
            <p style={{ fontSize: 12, color: "var(--muted)" }}>{t("wms.mesSync.operatorHint", locale)}</p>
          </div>
          <div className="toolbar" style={{ gap: 8 }}>
            <button className="btn btn-secondary" type="button" disabled={!enabled} onClick={() => void testConn()}>
              <Link2 size={14} style={{ marginRight: 6 }} />{busy === "test" ? t("wms.mesSync.testing", locale) : t("wms.mesSync.test", locale)}
            </button>
            <button className="btn" type="button" disabled={!enabled} onClick={() => void saveConfig()}>
              {t("wms.mesSync.save", locale)}
            </button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginTop: 8 }}>
          <label style={{ fontSize: 12 }}>
            {t("wms.mesSync.baseUrl", locale)}
            <input
              className="input"
              style={{ width: "100%", marginTop: 4 }}
              value={form.baseUrl}
              placeholder="http://mes-host:8080"
              onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
            />
          </label>
          <label style={{ fontSize: 12 }}>
            {t("wms.mesSync.apiKeyLabel", locale)}
            <input
              className="input"
              style={{ width: "100%", marginTop: 4 }}
              type="password"
              value={form.apiKey}
              placeholder={config?.hasApiKey ? `${config.apiKeyMasked} · ${t("wms.mesSync.apiKeyPlaceholder", locale)}` : t("wms.mesSync.apiKeyPlaceholder", locale)}
              onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
            />
          </label>
          <label style={{ fontSize: 12 }}>
            {t("wms.mesSync.intervalLabel", locale)}
            <input
              className="input"
              style={{ width: "100%", marginTop: 4 }}
              type="number"
              min={1}
              max={1440}
              value={form.intervalMinutes}
              onChange={(e) => setForm((f) => ({ ...f, intervalMinutes: Number(e.target.value) || 1 }))}
            />
          </label>
          <label style={{ fontSize: 12 }}>
            {t("wms.mesSync.qtyModeLabel", locale)}
            <select
              className="input"
              style={{ width: "100%", marginTop: 4 }}
              value={form.pickingQtyMode}
              onChange={(e) => setForm((f) => ({ ...f, pickingQtyMode: e.target.value === "open" ? "open" : "suggest" }))}
            >
              <option value="suggest">{t("wms.mesSync.qtyModeSuggest", locale)}</option>
              <option value="open">{t("wms.mesSync.qtyModeOpen", locale)}</option>
            </select>
          </label>
          <label style={{ fontSize: 12 }}>
            {t("wms.mesSync.operatorLabel", locale)}
            <input
              className="input"
              style={{ width: "100%", marginTop: 4 }}
              value={form.operatorId}
              placeholder={config?.operatorName || "users.id"}
              onChange={(e) => setForm((f) => ({ ...f, operatorId: e.target.value.replace(/[^0-9]/g, "") }))}
            />
          </label>
          <div style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 6, justifyContent: "center" }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={form.autoSync} onChange={(e) => setForm((f) => ({ ...f, autoSync: e.target.checked }))} />
              {t("wms.mesSync.autoSyncLabel", locale)}
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={form.autoPicking} onChange={(e) => setForm((f) => ({ ...f, autoPicking: e.target.checked }))} />
              {t("wms.mesSync.autoPickingLabel", locale)}
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={form.pickingAutoApprove} onChange={(e) => setForm((f) => ({ ...f, pickingAutoApprove: e.target.checked }))} />
              {t("wms.mesSync.autoApproveLabel", locale)}
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={form.writebackEnabled} onChange={(e) => setForm((f) => ({ ...f, writebackEnabled: e.target.checked }))} />
              {t("wms.mesSync.writebackLabel", locale)}
            </label>
          </div>
        </div>
      </section>
      <section className="surface-panel" style={{ marginTop: 16 }}>
        <div className="section-header">
          <div>
            <h3>{t("wms.mesSync.pendingTitle", locale)}</h3>
            {totalUnmatched > 0 && (
              <p style={{ fontSize: 12, color: "var(--warn)" }}>
                {t("wms.mesSync.colUnmatched", locale)}: {totalUnmatched}
              </p>
            )}
          </div>
          <div className="toolbar" style={{ gap: 8 }}>
            <input
              className="input"
              style={{ width: 240 }}
              value={keyword}
              placeholder={t("wms.mesSync.searchPlaceholder", locale)}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <button className="btn btn-secondary" type="button" disabled={!enabled} onClick={() => void run("syncPending2", () => wmsApi.syncMesPending())}>
              <Play size={14} style={{ marginRight: 6 }} />{t("wms.mesSync.syncPending", locale)}
            </button>
          </div>
        </div>

        {loading && <p style={{ textAlign: "center", padding: 40 }}>{t("common.loading", locale)}</p>}
        {!loading && pending.length === 0 && <p style={{ textAlign: "center", padding: 40 }}>{t("wms.mesSync.empty", locale)}</p>}
        {!loading && pending.length > 0 && (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("wms.mesSync.colWo", locale)}</th>
                  <th>{t("wms.mesSync.colProduct", locale)}</th>
                  <th>{t("wms.mesSync.colPlanQty", locale)}</th>
                  <th>{t("wms.mesSync.colLine", locale)}</th>
                  <th>{t("wms.mesSync.colWoType", locale)}</th>
                  <th>{t("wms.mesSync.colMesStatus", locale)}</th>
                  <th>{t("wms.mesSync.colWmsStatus", locale)}</th>
                  <th>{t("wms.mesSync.colIssue", locale)}</th>
                  <th>{t("wms.mesSync.colOpenQty", locale)}</th>
                  <th>{t("wms.mesSync.colPicking", locale)}</th>
                  <th>{t("wms.mesSync.colSyncedAt", locale)}</th>
                  <th>{t("common.actions", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((row) => (
                  <tr key={row.workOrderNo}>
                    <td><code style={{ fontSize: 11 }}>{row.workOrderNo}</code></td>
                    <td>
                      {row.productModel || row.productCode || "—"}
                      <br /><span style={{ fontSize: 10, color: "var(--muted)" }}>{row.productCode}</span>
                    </td>
                    <td>{n0(row.planQty)}</td>
                    <td>{row.lineCode || "—"}</td>
                    <td>{row.woType || "—"}</td>
                    <td>{row.mesStatus || "—"}</td>
                    <td><span className="badge" style={{ background: "var(--nav)", color: "#fff" }}>{row.status}</span></td>
                    <td><code style={{ fontSize: 11 }}>{row.mesIssueNo || "—"}</code></td>
                    <td>
                      {n0(row.openQty)}
                      {n0(row.unmatchedCount) > 0 && (
                        <span className="badge" style={{ marginLeft: 6, background: "var(--warn)", color: "#fff" }}>
                          {n0(row.unmatchedCount)}
                        </span>
                      )}
                    </td>
                    <td>
                      {n0(row.pickingCount) > 0
                        ? <span className="badge" style={{ background: "var(--ok)", color: "#fff" }}>{n0(row.pickingCount)}</span>
                        : (row.hasBom ? "—" : <span style={{ fontSize: 11, color: "var(--muted)" }}>{t("wms.mesSync.noBom", locale)}</span>)}
                    </td>
                    <td style={{ whiteSpace: "nowrap", fontSize: 11 }}>{fmt(row.mesSyncedAt)}</td>
                    <td style={{ width: 120, whiteSpace: "nowrap" }}>
                      <button className="action-button" type="button" onClick={() => void openMaterials(row)} title={t("wms.mesSync.viewMaterials", locale)}>
                        <Settings2 size={13} />
                      </button>
                      <button
                        className="action-button"
                        type="button"
                        disabled={!enabled || row.status === "closed" || row.status === "cancelled"}
                        onClick={() => void generate(row)}
                        title={t("wms.mesSync.generatePicking", locale)}
                      >
                        <Play size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {materialsFor && (
        <div className="modal-overlay" onClick={() => setMaterialsFor(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900 }}>
            <div className="section-header">
              <div>
                <h3>{t("wms.mesSync.materialsTitle", locale)} · <code>{materialsFor.workOrderNo}</code></h3>
                <p style={{ fontSize: 12, color: "var(--muted)" }}>{materialsFor.productModel || materialsFor.productCode}</p>
              </div>
              <div className="toolbar" style={{ gap: 8 }}>
                <button className="btn btn-secondary" type="button" disabled={busy !== ""} onClick={() => void resyncMaterials()}>
                  <RotateCcw size={14} style={{ marginRight: 6 }} />{t("wms.mesSync.resyncMaterials", locale)}
                </button>
                <button className="action-button" type="button" onClick={() => setMaterialsFor(null)} title={t("wms.mesSync.close", locale)}>
                  <X size={14} />
                </button>
              </div>
            </div>
            {materials.length === 0 && <p style={{ textAlign: "center", padding: 24 }}>{t("wms.mesSync.empty", locale)}</p>}
            {materials.length > 0 && (
              <div className="table-shell" style={{ maxHeight: "60vh", overflowY: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>{t("wms.mesSync.colMaterial", locale)}</th>
                      <th>{t("wms.mesSync.colSpec", locale)}</th>
                      <th>{t("wms.mesSync.colUnit", locale)}</th>
                      <th>{t("wms.mesSync.colSection", locale)}</th>
                      <th>{t("wms.mesSync.colOpenQty", locale)}</th>
                      <th>{t("wms.mesSync.colAvailQty", locale)}</th>
                      <th>{t("wms.mesSync.colShortageQty", locale)}</th>
                      <th>{t("wms.mesSync.colMpq", locale)}</th>
                      <th>{t("wms.mesSync.colSuggestQty", locale)}</th>
                      <th>{t("wms.mesSync.colResolved", locale)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {materials.map((m) => (
                      <tr key={`${m.workSection}:${m.materialCode}`}>
                        <td>
                          <code style={{ fontSize: 11 }}>{m.materialCode}</code>
                          <br /><span style={{ fontSize: 10, color: "var(--muted)" }}>{m.materialName}</span>
                        </td>
                        <td style={{ fontSize: 11 }}>{m.spec || "—"}</td>
                        <td>{m.unit || "—"}</td>
                        <td>{SECTION_LABEL[m.workSection] || m.workSection || "—"}</td>
                        <td>{n0(m.openQty)}</td>
                        <td>{n0(m.availableQty)}</td>
                        <td style={{ color: n0(m.shortageQty) > 0 ? "var(--danger)" : "inherit" }}>{n0(m.shortageQty)}</td>
                        <td>{n0(m.mpq)}</td>
                        <td>{n0(m.suggestQty)}</td>
                        <td>
                          {m.materialId
                            ? <span className="badge" style={{ background: "var(--ok)", color: "#fff" }}>{t("wms.mesSync.resolvedYes", locale)}</span>
                            : <span className="badge" style={{ background: "var(--warn)", color: "#fff" }}>{t("wms.mesSync.resolvedNo", locale)}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
      <section className="surface-panel" style={{ marginTop: 16 }}>
        <div className="section-header">
          <div>
            <h3>
              <Send size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
              {t("wms.mesSync.wbTitle", locale)}
              {n0(wbCounts.failed) > 0 && (
                <span className="badge" style={{ marginLeft: 8, background: "var(--danger)", color: "#fff" }}>{n0(wbCounts.failed)}</span>
              )}
            </h3>
          </div>
          <div className="toolbar" style={{ gap: 8, flexWrap: "wrap" }}>
            <select className="input" value={wbStatus} onChange={(e) => setWbStatus(e.target.value)} style={{ width: 130 }}>
              <option value="">{t("wms.mesSync.all", locale)}</option>
              <option value="pending">{t("wms.mesSync.wbPending", locale)}</option>
              <option value="sent">{t("wms.mesSync.wbSent", locale)}</option>
              <option value="failed">{t("wms.mesSync.wbFailed", locale)}</option>
              <option value="skipped">{t("wms.mesSync.wbSkipped", locale)}</option>
            </select>
            <input
              className="input"
              style={{ width: 240 }}
              value={wbKeyword}
              placeholder={t("wms.mesSync.wbSearch", locale)}
              onChange={(e) => setWbKeyword(e.target.value)}
            />
            <button className="btn btn-secondary" type="button" disabled={!enabled} onClick={() => void run("wbRun", () => wmsApi.runMesWriteback(20))}>
              <Send size={14} style={{ marginRight: 6 }} />{t("wms.mesSync.wbRunNow", locale)}
            </button>
          </div>
        </div>
        {writebacks.length === 0 && <p style={{ textAlign: "center", padding: 24 }}>{t("wms.mesSync.empty", locale)}</p>}
        {writebacks.length > 0 && (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("wms.mesSync.colPickingNo", locale)}</th>
                  <th>{t("wms.mesSync.colWo", locale)}</th>
                  <th>{t("wms.mesSync.colIssue", locale)}</th>
                  <th>{t("wms.mesSync.colSection", locale)}</th>
                  <th>{t("wms.mesSync.colQty", locale)}</th>
                  <th>{t("wms.mesSync.colEvent", locale)}</th>
                  <th>{t("wms.mesSync.colStatus", locale)}</th>
                  <th>{t("wms.mesSync.colAttempts", locale)}</th>
                  <th>{t("wms.mesSync.colSentAt", locale)}</th>
                  <th>{t("wms.mesSync.colError", locale)}</th>
                  <th>{t("common.actions", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {writebacks.map((w) => (
                  <tr key={w.id}>
                    <td><code style={{ fontSize: 11 }}>{w.pickingNo}</code></td>
                    <td><code style={{ fontSize: 11 }}>{w.moNo || "—"}</code></td>
                    <td><code style={{ fontSize: 11 }}>{w.mesIssueNo || "—"}</code></td>
                    <td>{SECTION_LABEL[w.workSection] || w.workSection || "—"}</td>
                    <td>{n0(w.totalQty)}</td>
                    <td>{w.eventType}</td>
                    <td>
                      <span className="badge" style={{
                        background: w.status === "sent" ? "var(--ok)" : w.status === "failed" ? "var(--danger)" : w.status === "skipped" ? "var(--muted)" : "var(--warn)",
                        color: "#fff",
                      }}>
                        {t(WB_KEY[w.status] || "wms.mesSync.wbPending", locale)}
                      </span>
                    </td>
                    <td>{n0(w.attempts)}</td>
                    <td style={{ whiteSpace: "nowrap", fontSize: 11 }}>{fmt(w.sentAt)}</td>
                    <td style={{ fontSize: 11, color: "var(--danger)", maxWidth: 220 }}>{w.lastError || "—"}</td>
                    <td>
                      <button
                        className="action-button"
                        type="button"
                        disabled={!enabled}
                        onClick={() => void run(`wb:${w.id}`, async () => {
                          await wmsApi.retryMesWriteback(w.id);
                        })}
                        title={t("wms.mesSync.wbRetry", locale)}
                      >
                        <RotateCcw size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="surface-panel" style={{ marginTop: 16 }}>
        <div className="section-header">
          <div><h3>{t("wms.mesSync.logsTitle", locale)}</h3></div>
          <button className="action-button" type="button" disabled={!enabled} onClick={() => void load()} title={t("common.refresh", locale)}>
            <RotateCcw size={14} />
          </button>
        </div>
        {logs.length === 0 && <p style={{ textAlign: "center", padding: 24 }}>{t("wms.mesSync.empty", locale)}</p>}
        {logs.length > 0 && (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("wms.mesSync.colTask", locale)}</th>
                  <th>{t("wms.mesSync.colStatus", locale)}</th>
                  <th>{t("wms.mesSync.runResult", locale)}</th>
                  <th>{t("wms.mesSync.runCreated", locale)}</th>
                  <th>{t("wms.mesSync.runUpdated", locale)}</th>
                  <th>{t("wms.mesSync.wbSkipped", locale)}</th>
                  <th>{t("wms.mesSync.runFailed", locale)}</th>
                  <th>{t("wms.mesSync.colMessage", locale)}</th>
                  <th>{t("wms.mesSync.colStarted", locale)}</th>
                  <th>{t("wms.mesSync.colFinished", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td>{t(TASK_KEY[l.task] || "wms.mesSync.taskWorkOrder", locale)}</td>
                    <td>
                      <span className="badge" style={{
                        background: l.status === "success" ? "var(--ok)" : l.status === "failed" ? "var(--danger)" : "var(--warn)",
                        color: "#fff",
                      }}>
                        {t(RUN_KEY[l.status] || "wms.mesSync.statusPartial", locale)}
                      </span>
                    </td>
                    <td>{n0(l.pulled)}</td>
                    <td>{n0(l.created)}</td>
                    <td>{n0(l.updated)}</td>
                    <td>{n0(l.skipped)}</td>
                    <td>{n0(l.failed)}</td>
                    <td style={{ fontSize: 11, maxWidth: 320 }}>{l.message || "—"}</td>
                    <td style={{ whiteSpace: "nowrap", fontSize: 11 }}>{fmt(l.startedAt)}</td>
                    <td style={{ whiteSpace: "nowrap", fontSize: 11 }}>{fmt(l.finishedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}