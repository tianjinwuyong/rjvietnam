import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import {
  hubApi,
  liveSyncApi,
  type HubApp,
  type HubAppDraft,
  type HubAuthKind,
  type HubDirection,
  type HubStatus,
  type LiveSyncApp,
} from "../api/hub";

// Integration hub screen — the operator-facing half of "absorb every external app into
// this system and manage them from one place" (docs/grafting-standards.md §13). The list
// is integration_app joined with v_integration_app_health; there is no local fallback, so
// an unreachable API shows the error instead of an invented registry. The hub only
// aggregates: data-plane sync stays in AdminDataSources, per-app logs stay in each
// domain's itf log page.
const emptyDraft: HubAppDraft = {
  code: "",
  nameZh: "",
  direction: "both",
  authKind: "key",
  apiPathPrefix: "",
  keyRef: "",
  baseUrl: "",
  notes: "",
};

const DIRECTIONS: HubDirection[] = ["in", "out", "both"];
const AUTH_KINDS: HubAuthKind[] = ["key", "hmac", "jwt", "none"];
const STATUSES: HubStatus[] = ["active", "paused", "retired"];

function AdminIntegrationHub({ locale }: { locale: Locale }) {
  const L = (zh: string, en: string, vi: string) => (locale === "zh-CN" ? zh : locale === "vi-VN" ? vi : en);
  const [apps, setApps] = useState<HubApp[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<HubAppDraft>(emptyDraft);
  const [showForm, setShowForm] = useState(false);
  const [liveApps, setLiveApps] = useState<LiveSyncApp[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await hubApi.list();
      setApps(res.data ?? res.items ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    try {
      const ls = await liveSyncApi.status();
      setLiveApps(ls.items ?? ls.data ?? []);
    } catch {
      setLiveApps([]); // live-sync section degrades to empty, registry still renders
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!draft.code || !draft.nameZh) return;
    setBusy("save");
    try {
      await hubApi.create(draft);
      setDraft(emptyDraft);
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const patch = async (code: string, body: Record<string, unknown>, tag: string) => {
    setBusy(tag);
    try {
      await hubApi.update(code, body);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const liveConfig = async (code: string, body: Parameters<typeof liveSyncApi.config>[1], tag: string) => {
    setBusy(tag);
    try {
      await liveSyncApi.config(code, body);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const liveRun = async (code: string) => {
    setBusy(`run-${code}`);
    try {
      const r = await liveSyncApi.run(code);
      const bad = Object.entries(r.results ?? {}).filter(([, v]) => v.error);
      setError(bad.length ? `${code}: ${bad.map(([k, v]) => `${k} ${v.error}`).join("; ")}` : null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const dirLabel = (d: HubDirection) =>
    d === "in" ? L("被调", "in", "được gọi") : d === "out" ? L("外呼", "out", "gọi ra") : L("双向", "both", "hai chiều");

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{L("集成枢纽", "Integration hub", "Trung tâm tích hợp")}</h2>
            <p className="text-xs">
              {L(
                "被吸收进本系统的外部应用统一在此登记；健康数据按接口前缀从 itf_api_log 聚合，只汇聚不复制。",
                "Every external app absorbed into this system is registered here; health is aggregated from itf_api_log by API path prefix — aggregation only, no copies.",
                "Mọi ứng dụng ngoài được hấp thụ vào hệ thống đều đăng ký tại đây; sức khỏe tổng hợp từ itf_api_log theo tiền tố API — chỉ tổng hợp, không sao chép.",
              )}
            </p>
          </div>
          <button type="button" className={showForm ? "" : "active"} onClick={() => setShowForm((v) => !v)}>
            {showForm ? L("收起", "Close", "Thu gọn") : L("注册新应用", "Register app", "Đăng ký ứng dụng")}
          </button>
        </div>
        {error && <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
        {showForm && (
          <div className="toolbar" style={{ flexWrap: "wrap", gap: 8 }}>
            <input className="input" placeholder={L("代码 lowercase-code", "code", "mã")} value={draft.code}
                   onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, code: e.target.value })} />
            <input className="input" placeholder={L("名称", "name", "tên")} value={draft.nameZh}
                   onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, nameZh: e.target.value })} />
            <select className="input" value={draft.direction}
                    onChange={(e) => setDraft({ ...draft, direction: e.target.value as HubDirection })}>
              {DIRECTIONS.map((d) => <option key={d} value={d}>{dirLabel(d)}</option>)}
            </select>
            <select className="input" value={draft.authKind}
                    onChange={(e) => setDraft({ ...draft, authKind: e.target.value as HubAuthKind })}>
              {AUTH_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <input className="input" placeholder={L("接口前缀 /api/...", "API prefix /api/...", "tiền tố API")} value={draft.apiPathPrefix}
                   onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, apiPathPrefix: e.target.value })} />
            <input className="input" placeholder={L("密钥引用 sys_param 键", "key ref (sys_param key)", "tham chiếu khóa")} value={draft.keyRef}
                   onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, keyRef: e.target.value })} />
            <input className="input" placeholder={L("对端基址(出站)", "base URL (outbound)", "địa chỉ gốc (gọi ra)")} value={draft.baseUrl}
                   onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, baseUrl: e.target.value })} />
            <button type="button" className="active" disabled={busy === "save"} onClick={create}>
              {busy === "save" ? L("保存中…", "Saving…", "Đang lưu…") : L("登记", "Register", "Đăng ký")}
            </button>
          </div>
        )}
      </section>

      <section className="surface-panel">
        <div className="section-header"><div><h2>{L("已接入应用", "Registered apps", "Ứng dụng đã tiếp nạp")}</h2></div></div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{L("代码", "Code", "Mã")}</th>
                <th>{L("名称", "Name", "Tên")}</th>
                <th>{L("方向", "Direction", "Hướng")}</th>
                <th>{L("接口前缀", "API prefix", "Tiền tố API")}</th>
                <th>{L("鉴权", "Auth", "Xác thực")}</th>
                <th>{L("24h 调用", "24h calls", "Gọi 24h")}</th>
                <th>{L("最近活动", "Last activity", "Hoạt động gần nhất")}</th>
                <th>{L("状态", "Status", "Trạng thái")}</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((a) => (
                <tr key={a.code}>
                  <td><code>{a.code}</code></td>
                  <td>{a.name_zh}{a.notes && <div className="text-xs" style={{ color: "var(--muted)" }}>{a.notes}</div>}</td>
                  <td>{dirLabel(a.direction)}</td>
                  <td className="text-xs">{a.api_path_prefix || "—"}</td>
                  <td className="text-xs">{a.auth_kind}{a.key_ref ? ` · ${a.key_ref}` : ""}</td>
                  <td className="text-xs">
                    {a.calls_24h === null || a.calls_24h === undefined
                      ? "—"
                      : <span style={{ color: (a.calls_24h - (a.calls_ok_24h ?? 0)) > 0 ? "var(--danger)" : undefined }}>
                          {a.calls_ok_24h ?? 0}/{a.calls_24h}
                        </span>}
                  </td>
                  <td className="text-xs">
                    {a.last_call_at ? new Date(a.last_call_at).toLocaleString() : "—"}
                    {a.last_error && <div style={{ color: "var(--danger)" }}>✕ {a.last_error.slice(0, 80)}</div>}
                  </td>
                  <td>
                    <select className="input" value={a.status} disabled={busy === `st-${a.code}`}
                            onChange={(e) => patch(a.code, { status: e.target.value as HubStatus }, `st-${a.code}`)}>
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s === "active" ? L("启用", "active", "bật") : s === "paused" ? L("暂停", "paused", "tạm dừng") : L("退役", "retired", "ngừng")}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
              {apps.length === 0 && <tr><td colSpan={8} className="empty-state">{L("尚无接入应用", "No apps yet", "Chưa có ứng dụng")}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{L("动态同步（运行中的 WMS / OA）", "Live sync (running WMS / OA)", "Đồng bộ động (WMS / OA đang chạy)")}</h2>
            <p className="text-xs">
              {L(
                "从源系统的在线接口定时拉取，原样落 sync_stage 暂存区；不直接写业务表，收敛按 one-WMS 切片推进。",
                "Scheduled pull from the sources' live APIs, landed verbatim in sync_stage; never writes business tables directly — convergence follows the one-WMS slices.",
                "Truy xuất định kỳ từ API trực tuyến của nguồn, lưu nguyên bản vào sync_stage; không ghi thẳng bảng nghiệp vụ — hội tụ theo các lát one-WMS.",
              )}
            </p>
          </div>
          <button type="button" onClick={() => void load()} disabled={busy === "reload"}>
            {L("刷新", "Refresh", "Làm mới")}
          </button>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{L("源", "Source", "Nguồn")}</th>
                <th>{L("自动同步", "Auto", "Tự động")}</th>
                <th>{L("间隔(分)", "Interval(min)", "Khoảng(phút)")}</th>
                <th>{L("最近一轮", "Last round", "Vòng gần nhất")}</th>
                <th>{L("拉取", "Pulled", "Đã kéo")}</th>
                <th>{L("菜单漂移(7d)", "Menu drift(7d)", "Trôi menu(7ng)")}</th>
                <th>{L("操作", "Action", "Thao tác")}</th>
              </tr>
            </thead>
            <tbody>
              {liveApps.map((a) => (
                <tr key={a.app}>
                  <td>
                    <code>{a.app}</code>
                    <div className="text-xs" style={{ color: "var(--muted)" }}>
                      {a.baseUrl}{a.sessionActive ? ` · ${L("会话有效", "session ok", "phiên hợp lệ")}` : ""}
                    </div>
                  </td>
                  <td>
                    <select className="input" value={a.autoSync ? "on" : "off"} disabled={busy === `auto-${a.app}`}
                            onChange={(e) => liveConfig(a.app, { autoSync: e.target.value === "on" }, `auto-${a.app}`)}>
                      <option value="on">{L("开", "on", "bật")}</option>
                      <option value="off">{L("关", "off", "tắt")}</option>
                    </select>
                  </td>
                  <td className="text-xs">
                    <input className="input" type="number" min={1} max={1440} style={{ width: 72 }} value={a.intervalMinutes}
                           disabled={busy === `iv-${a.app}`}
                           onBlur={(e) => {
                             const v = Number(e.target.value);
                             if (Number.isFinite(v) && v !== a.intervalMinutes) liveConfig(a.app, { intervalMinutes: v }, `iv-${a.app}`);
                           }} />
                  </td>
                  <td className="text-xs">
                    {a.lastRun ? (
                      <span style={{ color: a.lastRun.status === "failed" ? "var(--danger)" : undefined }}>
                        {a.lastRun.task} · {a.lastRun.status} · {new Date(a.lastRun.started_at).toLocaleString()}
                        {a.lastRun.message ? <div>{a.lastRun.message.slice(0, 80)}</div> : null}
                      </span>
                    ) : L("未跑过", "never run", "chưa chạy")}
                  </td>
                  <td className="text-xs">{a.lastRun?.pulled ?? "—"}</td>
                  <td className="text-xs" style={{ color: a.menuDrifts7d > 0 ? "var(--warning)" : undefined }}>
                    {a.menuDrifts7d}
                    {a.lastMenuSnapshot ? ` · ${a.lastMenuSnapshot.item_count}` : ""}
                  </td>
                  <td>
                    <button type="button" onClick={() => void liveRun(a.app)} disabled={busy === `run-${a.app}` || a.running}>
                      {busy === `run-${a.app}` || a.running ? L("同步中…", "syncing…", "đang đồng bộ…") : L("立即同步", "Sync now", "Đồng bộ ngay")}
                    </button>
                  </td>
                </tr>
              ))}
              {liveApps.length === 0 && (
                <tr><td colSpan={7} className="empty-state">
                  {L("未取到 live-sync 状态（路由未注册或无权限）", "No live-sync status (route not registered or no permission)", "Không có trạng thái live-sync")}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export { AdminIntegrationHub };
