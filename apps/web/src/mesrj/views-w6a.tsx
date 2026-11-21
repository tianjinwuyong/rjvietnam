// MES-ruijing W6a 前端 —— 生产执行 · 过站台
// 源 api/exec.py 的过站/跳站/放行单/工单路线 4 个页面的移植。
// 路由（后端 services/api/src/routes/mesrj.js）：
//   POST /exec/pass                      过站
//   POST /exec/skip                      临时跳站
//   POST /exec/release                   开跳站放行单
//   POST /exec/release/:releaseNo/approve 审批放行单
//   GET  /exec/mo/:moNo/route            工单路线 + 每站完成情况 + drift
//   GET  /exec/route/temp                临时路线
//   POST /exec/route/lock                锁定路线
//   POST /exec/route/change              变更路线
//   POST /exec/route/restore             恢复标准路线
//   GET  /exec/sn/next                   镭码机取号
import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesrjApi, MesrjApiError } from "./api";
import { t } from "./i18n";

const box = { border: "1px solid var(--border, #e2e8f0)", borderRadius: 10, padding: 14, marginBottom: 14 } as const;
const inp = { padding: "6px 8px", marginRight: 6 } as const;

function Err({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div style={{ color: "#b91c1c", padding: "6px 0", fontSize: 13, whiteSpace: "pre-wrap" }}>{msg}</div>;
}
function Ok({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div style={{ color: "#15803d", padding: "6px 0", fontSize: 13, whiteSpace: "pre-wrap" }}>{msg}</div>;
}

async function call<T>(fn: () => Promise<T>): Promise<[T | null, string]> {
  try {
    return [await fn(), ""];
  } catch (ex) {
    return [null, ex instanceof MesrjApiError ? ex.message : String(ex)];
  }
}

// ── 类型 ────────────────────────────────────────────────────────────────────

interface PassResult {
  accepted: boolean;
  allow: boolean;
  blocked: boolean;
  rule: string;
  msg: string;
  sn: string;
  sn_status: string;
  station_code: string;
  station_name: string;
  mo_no: string;
  result: string;
  is_retest: boolean;
  created_sn: boolean;
  action: string;
  next_station: { station_code: string; station_name: string; seq_no: number } | null;
  route: { route_code: string; route_name: string; step_count: number };
  hint?: string;
}

interface MoRouteStep {
  seq_no: number;
  station_code: string;
  station_name: string;
  process_code: string;
  is_must_pass: number;
  pass_ok: number;
  pass_ng: number;
}

interface MoRouteData {
  mo: { mo_no: string; product_code: string; plan_qty: number; status: string; process_code: string };
  route: { route_code: string; route_name: string; step_count: number } | null;
  steps: MoRouteStep[];
  temp: { id: number; change_type: string; reason: string; expire_at: string; apply_by: string } | null;
  drift: { model: string; model_steps: number; snapshot_steps: number; missing: string[]; extra: string[] } | null;
  model_process: { model: string; process_name: string; steps: number; route_code: string } | null;
  group: { key: string; model: string; route_code: string; total_steps: number } | null;
  sn_total: number;
}

interface TempRouteData {
  mo_no: string;
  active: { id: number; change_type: string; reason: string; expire_at: string; apply_by: string; new_route: string; old_route: string } | null;
  rows: Array<{ id: number; change_type: string; old_route: string; new_route: string; reason: string; apply_by: string; status: string; expire_at: string; restored_at: string; created_at: string }>;
  now: string;
}

const RESULT_COLOR: Record<string, string> = { OK: "#15803d", NG: "#b91c1c" };

// ═══ 扫码过站台 ═════════════════════════════════════════════════════════════

export function ExecScanView({ locale }: { locale: Locale }) {
  const [sn, setSn] = useState("");
  const [station, setStation] = useState("");
  const [moNo, setMoNo] = useState("");
  const [result, setResult] = useState<"OK" | "NG">("OK");
  const [defect, setDefect] = useState("");
  const [reason, setReason] = useState("");
  const [res, setRes] = useState<PassResult | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"pass" | "skip">("pass");

  const doPass = async () => {
    setBusy(true); setErr(""); setMsg(""); setRes(null);
    const [d, e] = await call(() => mesrjApi.post<PassResult>("/exec/pass", {
      sn: sn.trim(), station_code: station.trim(), mo_no: moNo.trim(),
      result, defect_code: defect.trim(), source: "manual",
    }));
    setBusy(false);
    if (e) { setErr(e); return; }
    setRes(d);
    setMsg(d?.msg ?? "");
  };

  const doSkip = async () => {
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjApi.post<{ sn: string; station_code: string }>("/exec/skip", {
      sn: sn.trim(), station_code: station.trim(), reason: reason.trim(),
    }));
    setBusy(false);
    if (e) { setErr(e); return; }
    setMsg(`${t("exec.skip.done", locale)}：${d?.sn} / ${d?.station_code}`);
  };

  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 3 }}>{t("exec.scan.sn", locale)}</div>
          <input value={sn} onChange={e => setSn(e.target.value)} placeholder="SN"
            style={{ ...inp, width: 200 }} />
        </div>
        <div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 3 }}>{t("exec.scan.station", locale)}</div>
          <input value={station} onChange={e => setStation(e.target.value)} placeholder={t("exec.scan.station_ph", locale)}
            style={{ ...inp, width: 160 }} />
        </div>
        <div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 3 }}>{t("exec.scan.mo", locale)}</div>
          <input value={moNo} onChange={e => setMoNo(e.target.value)} placeholder={t("exec.scan.mo_ph", locale)}
            style={{ ...inp, width: 170 }} />
        </div>
        <div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 3 }}>{t("exec.scan.result", locale)}</div>
          <select value={result} onChange={e => setResult(e.target.value as "OK" | "NG")} style={inp}>
            <option value="OK">OK</option>
            <option value="NG">NG</option>
          </select>
        </div>
        {result === "NG" && (
          <div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 3 }}>{t("exec.scan.defect", locale)}</div>
            <input value={defect} onChange={e => setDefect(e.target.value)} placeholder={t("exec.scan.defect_ph", locale)}
              style={{ ...inp, width: 130 }} />
          </div>
        )}
      </div>

      <div style={{ ...box, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => setTab("pass")} disabled={tab === "pass"}
          style={{ fontWeight: tab === "pass" ? 600 : 400 }}>{t("exec.scan.pass", locale)}</button>
        <button onClick={() => setTab("skip")} disabled={tab === "skip"}
          style={{ fontWeight: tab === "skip" ? 600 : 400 }}>{t("exec.scan.skip", locale)}</button>
        {tab === "skip" && (
          <>
            <input value={reason} onChange={e => setReason(e.target.value)}
              placeholder={t("exec.skip.reason_ph", locale)} style={{ ...inp, width: 260 }} />
            <button onClick={() => void doSkip()} disabled={busy}>{t("exec.scan.skip_submit", locale)}</button>
          </>
        )}
        {tab === "pass" && (
          <button onClick={() => void doPass()} disabled={busy}>{t("exec.scan.pass_submit", locale)}</button>
        )}
      </div>

      <Err msg={err} />
      <Ok msg={msg} />

      {res && (
        <div style={box}>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "baseline", marginBottom: 8 }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: RESULT_COLOR[res.result] ?? "#334155" }}>
              {res.result}
            </span>
            <span style={{ fontSize: 14 }}>{res.sn}</span>
            <span style={{ fontSize: 13, color: "#64748b" }}>
              {res.station_code} · {res.station_name}
            </span>
            <span style={{ fontSize: 13, color: "#64748b" }}>{res.mo_no}</span>
            <span style={{ fontSize: 13, color: "#64748b" }}>
              {t("exec.scan.status", locale)}：{res.sn_status}
            </span>
            {res.created_sn && (
              <span style={{ fontSize: 12, color: "#15803d" }}>{t("exec.scan.created", locale)}</span>
            )}
            {res.is_retest && (
              <span style={{ fontSize: 12, color: "#b45309" }}>{t("exec.scan.retest", locale)}</span>
            )}
          </div>
          {res.blocked && (
            <div style={{ fontSize: 13, color: "#b91c1c", marginBottom: 6 }}>
              {t("exec.scan.blocked", locale)}：{res.rule}
            </div>
          )}
          {res.action && (
            <div style={{ fontSize: 13, color: "#475569" }}>{t("exec.scan.action", locale)}：{res.action}</div>
          )}
          {res.next_station && (
            <div style={{ fontSize: 13, color: "#475569" }}>
              {t("exec.scan.next", locale)}：{res.next_station.station_name}（{res.next_station.station_code}）
            </div>
          )}
          {res.route?.route_code && (
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
              {t("exec.scan.route", locale)}：{res.route.route_code} · {res.route.step_count} {t("exec.scan.steps", locale)}
            </div>
          )}
          {res.hint && (
            <div style={{ fontSize: 12, color: "#b45309", marginTop: 6, whiteSpace: "pre-wrap" }}>
              💡 {res.hint}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══ 工单路线 ═══════════════════════════════════════════════════════════════

export function ExecMoRouteView({ locale }: { locale: Locale }) {
  const [moNo, setMoNo] = useState("");
  const [data, setData] = useState<MoRouteData | null>(null);
  const [temp, setTemp] = useState<TempRouteData | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [changeReason, setChangeReason] = useState("");
  const [bypass, setBypass] = useState<string[]>([]);
  const [expireHours, setExpireHours] = useState("8");

  const load = useCallback(async () => {
    const m = moNo.trim();
    if (!m) return;
    const [d, e] = await call(() => mesrjApi.get<MoRouteData>(`/exec/mo/${encodeURIComponent(m)}/route`));
    if (e) { setErr(e); setData(null); return; }
    setErr(""); setData(d);
    const [td, te] = await call(() => mesrjApi.get<TempRouteData>("/exec/route/temp", { mo_no: m }));
    if (!te) setTemp(td);
  }, [moNo]);
  useEffect(() => { void load(); }, [load]);

  const lock = async () => {
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjApi.post<{ msg?: string }>("/exec/route/lock", { mo_no: moNo.trim() }));
    setBusy(false);
    if (e) { setErr(e); return; }
    setMsg(d?.msg ?? "");
    await load();
  };

  const change = async () => {
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjApi.post<{ msg?: string }>("/exec/route/change", {
      mo_no: moNo.trim(), reason: changeReason.trim(),
      bypass_stations: bypass, expire_hours: Number(expireHours || 0),
    }));
    setBusy(false);
    if (e) { setErr(e); return; }
    setMsg(d?.msg ?? "");
    setBypass([]); setChangeReason("");
    await load();
  };

  const restore = async () => {
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjApi.post<{ msg?: string }>("/exec/route/restore", {
      mo_no: moNo.trim(), reason: "设备恢复，手动恢复标准路线",
    }));
    setBusy(false);
    if (e) { setErr(e); return; }
    setMsg(d?.msg ?? "");
    await load();
  };

  const toggleBypass = (code: string) => {
    setBypass(b => (b.includes(code) ? b.filter(x => x !== code) : [...b, code]));
  };

  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input value={moNo} onChange={e => setMoNo(e.target.value)}
          placeholder={t("exec.moroute.mo_ph", locale)} style={{ ...inp, width: 200 }} />
        <button onClick={() => void load()}>{t("search", locale)}</button>
        <button onClick={() => void lock()} disabled={busy || !moNo.trim()}>
          {t("exec.moroute.lock", locale)}
        </button>
      </div>
      <Err msg={err} />
      <Ok msg={msg} />

      {data && (
        <>
          <div style={{ ...box, fontSize: 13, display: "flex", gap: 16, flexWrap: "wrap" }}>
            <span><b>{data.mo.mo_no}</b></span>
            <span>{t("exec.moroute.product", locale)}：{data.mo.product_code}</span>
            <span>{t("exec.moroute.status", locale)}：{data.mo.status}</span>
            <span>{t("exec.moroute.plan", locale)}：{data.mo.plan_qty}</span>
            <span>{t("exec.moroute.sn_total", locale)}：{data.sn_total}</span>
            {data.route && (
              <span>{t("exec.moroute.route", locale)}：{data.route.route_code}（{data.route.step_count}）</span>
            )}
          </div>

          {data.drift && (
            <div style={{ ...box, fontSize: 13, color: "#b45309" }}>
              ⚠ {t("exec.moroute.drift", locale)}：{data.drift.model} 当前工艺 {data.drift.model_steps} 站，
              快照 {data.drift.snapshot_steps} 站。
              {data.drift.missing.length > 0 && (
                <>　{t("exec.moroute.missing", locale)}：{data.drift.missing.join("、")}</>
              )}
              {data.drift.extra.length > 0 && (
                <>　{t("exec.moroute.extra", locale)}：{data.drift.extra.join("、")}</>
              )}
            </div>
          )}

          {data.temp && (
            <div style={{ ...box, fontSize: 13, color: "#b91c1c" }}>
              ⏱ {t("exec.moroute.temp_active", locale)}：{data.temp.change_type} · {data.temp.reason}
              {data.temp.expire_at && <>　{t("exec.moroute.expire", locale)}：{data.temp.expire_at}</>}
              <button onClick={() => void restore()} disabled={busy} style={{ marginLeft: 10 }}>
                {t("exec.moroute.restore", locale)}
              </button>
            </div>
          )}

          <div style={box}>
            <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>
              {t("exec.moroute.steps_title", locale)}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr>
                  {[t("exec.moroute.seq", locale), t("exec.moroute.station", locale),
                    t("exec.moroute.must", locale), t("exec.moroute.ok", locale),
                    t("exec.moroute.ng", locale), t("exec.moroute.bypass", locale)].map(h => (
                    <th key={h} style={{ padding: "7px 10px", borderBottom: "1px solid var(--border, #e2e8f0)", textAlign: "left" }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {data.steps.map(s => (
                    <tr key={`${s.station_code}-${s.seq_no}`}>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>{s.seq_no}</td>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>
                        <b>{s.station_code}</b> · {s.station_name}
                      </td>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>
                        {s.is_must_pass === 1 ? "✓" : "-"}
                      </td>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9", color: "#15803d" }}>
                        {s.pass_ok}
                      </td>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9", color: "#b91c1c" }}>
                        {s.pass_ng}
                      </td>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>
                        <input type="checkbox" checked={bypass.includes(s.station_code)}
                          onChange={() => toggleBypass(s.station_code)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
              <input value={changeReason} onChange={e => setChangeReason(e.target.value)}
                placeholder={t("exec.moroute.change_reason_ph", locale)} style={{ ...inp, width: 260 }} />
              <input value={expireHours} onChange={e => setExpireHours(e.target.value)}
                placeholder={t("exec.moroute.expire_hours", locale)} style={{ ...inp, width: 90 }} />
              <button onClick={() => void change()} disabled={busy || bypass.length === 0 || !changeReason.trim()}>
                {t("exec.moroute.change", locale)}
              </button>
            </div>
          </div>

          {temp && temp.rows.length > 0 && (
            <div style={box}>
              <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>
                {t("exec.moroute.temp_history", locale)}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr>
                    {["ID", t("exec.moroute.type", locale), t("exec.moroute.old_route", locale),
                      t("exec.moroute.new_route", locale), t("exec.moroute.status", locale),
                      t("exec.moroute.expire", locale), t("exec.moroute.apply_by", locale),
                      t("exec.moroute.reason", locale)].map(h => (
                    <th key={h} style={{ padding: "6px 8px", borderBottom: "1px solid var(--border, #e2e8f0)", textAlign: "left" }}>{h}</th>
                  ))}
                </tr></thead>
                  <tbody>
                    {temp.rows.map(r => (
                      <tr key={r.id}>
                        <td style={{ padding: "5px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.id}</td>
                        <td style={{ padding: "5px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.change_type}</td>
                        <td style={{ padding: "5px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.old_route}</td>
                        <td style={{ padding: "5px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.new_route}</td>
                        <td style={{ padding: "5px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.status}</td>
                        <td style={{ padding: "5px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.expire_at || "-"}</td>
                        <td style={{ padding: "5px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.apply_by}</td>
                        <td style={{ padding: "5px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ═══ 跳站放行单 ═════════════════════════════════════════════════════════════

interface ReleaseRow {
  id: number;
  release_no: string;
  scope: string;
  mo_no: string;
  sn: string;
  station_code: string;
  valid_from: string;
  valid_to: string;
  max_times: number;
  used_times: number;
  reason: string;
  apply_by: string;
  approve_by: string;
  status: string;
  created_at: string;
}

export function ExecReleaseView({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<ReleaseRow[]>([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState("按SN");
  const [sn, setSn] = useState("");
  const [moNo, setMoNo] = useState("");
  const [station, setStation] = useState("");
  const [reason, setReason] = useState("");
  const [maxTimes, setMaxTimes] = useState("1");
  const [autoApprove, setAutoApprove] = useState(false);

  const load = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<{ rows: ReleaseRow[]; total: number }>(
      "/exec/pass_release/list", { page: 1, size: 100 }));
    if (e) { setErr(e); return; }
    setErr(""); setRows(d?.rows ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjApi.post<{ release_no: string; status: string }>("/exec/release", {
      scope, sn: sn.trim(), mo_no: moNo.trim(), station_code: station.trim(),
      reason: reason.trim(), max_times: Number(maxTimes || 1), auto_approve: autoApprove,
    }));
    setBusy(false);
    if (e) { setErr(e); return; }
    setMsg(`${t("exec.release.created", locale)}：${d?.release_no}（${d?.status}）`);
    setSn(""); setMoNo(""); setStation(""); setReason("");
    await load();
  };

  const approve = async (no: string, status: string) => {
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjApi.post<{ msg?: string }>(
      `/exec/release/${encodeURIComponent(no)}/approve`, { status }));
    setBusy(false);
    if (e) { setErr(e); return; }
    setMsg(d?.msg ?? "");
    await load();
  };

  const STATUS_COLOR: Record<string, string> = {
    "已批准": "#15803d", "待审": "#b45309", "已驳回": "#b91c1c", "已用完": "#64748b",
  };

  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 3 }}>{t("exec.release.scope", locale)}</div>
          <select value={scope} onChange={e => setScope(e.target.value)} style={inp}>
            <option value="按SN">{t("exec.release.by_sn", locale)}</option>
            <option value="按工单">{t("exec.release.by_mo", locale)}</option>
          </select>
        </div>
        {scope === "按SN" ? (
          <div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 3 }}>SN</div>
            <input value={sn} onChange={e => setSn(e.target.value)} style={{ ...inp, width: 180 }} />
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 3 }}>{t("exec.release.mo", locale)}</div>
            <input value={moNo} onChange={e => setMoNo(e.target.value)} style={{ ...inp, width: 180 }} />
          </div>
        )}
        <div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 3 }}>{t("exec.release.station", locale)}</div>
          <input value={station} onChange={e => setStation(e.target.value)}
            placeholder={t("exec.release.station_ph", locale)} style={{ ...inp, width: 150 }} />
        </div>
        <div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 3 }}>{t("exec.release.reason", locale)}</div>
          <input value={reason} onChange={e => setReason(e.target.value)}
            placeholder={t("exec.release.reason_ph", locale)} style={{ ...inp, width: 240 }} />
        </div>
        <div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 3 }}>{t("exec.release.max_times", locale)}</div>
          <input value={maxTimes} onChange={e => setMaxTimes(e.target.value)} style={{ ...inp, width: 70 }} />
        </div>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={autoApprove} onChange={e => setAutoApprove(e.target.checked)} />
          {t("exec.release.auto_approve", locale)}
        </label>
        <button onClick={() => void create()} disabled={busy}>{t("exec.release.create", locale)}</button>
      </div>

      <Err msg={err} />
      <Ok msg={msg} />

      <div style={box}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr>
              {[t("exec.release.no", locale), t("exec.release.scope", locale),
                t("exec.release.target", locale), t("exec.release.station", locale),
                t("exec.release.used", locale), t("exec.release.status", locale),
                t("exec.release.apply_by", locale), t("exec.release.approve_by", locale),
                t("exec.release.reason", locale), t("common.actions", locale)].map(h => (
                <th key={h} style={{ padding: "6px 8px", borderBottom: "1px solid var(--border, #e2e8f0)", textAlign: "left" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td style={{ padding: "5px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.release_no}</td>
                  <td style={{ padding: "5px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.scope}</td>
                  <td style={{ padding: "5px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.scope === "按SN" ? r.sn : r.mo_no}</td>
                  <td style={{ padding: "5px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.station_code}</td>
                  <td style={{ padding: "5px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.used_times}/{r.max_times}</td>
                  <td style={{ padding: "5px 8px", borderBottom: "1px solid #f1f5f9", color: STATUS_COLOR[r.status] ?? "#334155" }}>
                    {r.status}
                  </td>
                  <td style={{ padding: "5px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.apply_by}</td>
                  <td style={{ padding: "5px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.approve_by || "-"}</td>
                  <td style={{ padding: "5px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.reason}</td>
                  <td style={{ padding: "5px 8px", borderBottom: "1px solid #f1f5f9" }}>
                    {r.status === "待审" && (
                      <>
                        <button onClick={() => void approve(r.release_no, "已批准")} disabled={busy}
                          style={{ marginRight: 6 }}>{t("exec.release.approve", locale)}</button>
                        <button onClick={() => void approve(r.release_no, "已驳回")} disabled={busy}>
                          {t("exec.release.reject", locale)}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={10} style={{ padding: "16px 8px", color: "#94a3b8", textAlign: "center" }}>
                  {t("no_data", locale)}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
