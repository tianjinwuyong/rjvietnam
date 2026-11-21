import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import {
  dataSourceApi,
  type DataSourceKind,
  type DataSourceProvider,
  type DataSourceSyncRun,
  type DataSourceSyncTable,
  type RemoteTable,
} from "../api/datasources";

// This screen is the operator-facing half of the "pull data from the other factory" feature.
// Everything it shows comes from /api/datasources; there is no local fallback list, so an
// unreachable API shows the error instead of an invented provider.

interface Draft {
  code: string;
  nameZh: string;
  kind: DataSourceKind;
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  schema: string;
}

const emptyDraft: Draft = {
  code: "",
  nameZh: "",
  kind: "postgres",
  host: "",
  port: "5432",
  database: "",
  user: "",
  password: "",
  schema: "public",
};

function AdminDataSources({ locale }: { locale: Locale }) {
  const L = (zh: string, en: string, vi: string) => (locale === "zh-CN" ? zh : locale === "vi-VN" ? vi : en);
  const [providers, setProviders] = useState<DataSourceProvider[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [showForm, setShowForm] = useState(false);

  // Sync panel state (one provider open at a time).
  const [activeId, setActiveId] = useState<number | null>(null);
  const [tables, setTables] = useState<RemoteTable[]>([]);
  const [tableFilter, setTableFilter] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [run, setRun] = useState<DataSourceSyncRun | null>(null);
  const [runTables, setRunTables] = useState<DataSourceSyncTable[]>([]);
  const pollTimer = useRef<number | null>(null);

  const load = useCallback(() => {
    dataSourceApi
      .list()
      .then((res) => {
        setProviders(res.items);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    load();
    return () => {
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    };
  }, [load]);

  const followRun = useCallback((runId: number) => {
    dataSourceApi
      .run(runId)
      .then((res) => {
        setRun(res.item.run);
        setRunTables(res.item.tables);
        if (res.item.run.status === "running") {
          pollTimer.current = window.setTimeout(() => followRun(runId), 1500);
        } else {
          load();
        }
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [load]);

  const openSync = async (provider: DataSourceProvider) => {
    if (activeId === provider.id) {
      setActiveId(null);
      return;
    }
    setActiveId(provider.id);
    setPicked(new Set());
    setTables([]);
    setRun(provider.last_run ?? null);
    setRunTables([]);
    setBusy(`tables-${provider.id}`);
    try {
      const res = await dataSourceApi.tables(provider.id);
      setTables(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const togglePick = (name: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const save = async () => {
    setBusy("save");
    try {
      await dataSourceApi.create({
        code: draft.code.trim(),
        nameZh: draft.nameZh.trim(),
        kind: draft.kind,
        config: {
          host: draft.host.trim(),
          port: Number(draft.port || (draft.kind === "mysql" ? 3306 : 5432)),
          database: draft.database.trim(),
          user: draft.user.trim(),
          password: draft.password || undefined,
          schema: draft.kind === "postgres" ? draft.schema.trim() || "public" : undefined,
        },
      });
      setDraft(emptyDraft);
      setShowForm(false);
      setError(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const test = async (provider: DataSourceProvider) => {
    setBusy(`test-${provider.id}`);
    try {
      const res = await dataSourceApi.test(provider.id);
      setError(res.item.ok ? null : res.item.message);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const toggleEnabled = async (provider: DataSourceProvider) => {
    setBusy(`toggle-${provider.id}`);
    try {
      await dataSourceApi.update(provider.id, { enabled: !provider.enabled });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (provider: DataSourceProvider) => {
    if (!window.confirm(L(`删除数据源 ${provider.code}？（已同步的 ext_${provider.code} 表不会删除）`, `Delete ${provider.code}? Already-synced ext_${provider.code} tables are kept.`, `Xóa ${provider.code}?`))) return;
    setBusy(`del-${provider.id}`);
    try {
      await dataSourceApi.remove(provider.id);
      if (activeId === provider.id) setActiveId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const startSync = async (provider: DataSourceProvider, all: boolean) => {
    setBusy(`sync-${provider.id}`);
    try {
      const res = await dataSourceApi.sync(provider.id, {
        tables: all ? undefined : Array.from(picked),
        mode,
        all,
      });
      setRun({ ...(run ?? {}) as DataSourceSyncRun, id: res.item.runId, status: "running", tables_total: res.item.tables, tables_done: 0, rows_copied: 0, provider_id: provider.id, mode, started_at: new Date().toISOString() });
      setRunTables([]);
      followRun(res.item.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const visibleTables = tables.filter((tb) => !tableFilter || tb.name.toLowerCase().includes(tableFilter.toLowerCase()));

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{L("数据源", "Data sources", "Nguồn dữ liệu")}</h2>
            <p>
              {L(
                "登记外部数据库（分厂 / 旧 MES / 镜像库），把表同步到本库的 ext_<代码> 暂存 schema。",
                "Register an external database (another plant, legacy MES, mirror) and pull its tables into the local ext_<code> staging schema.",
                "Đăng ký CSDL bên ngoài và đồng bộ bảng vào schema tạm ext_<code>.",
              )}
            </p>
          </div>
          <button type="button" className={showForm ? "" : "active"} onClick={() => setShowForm((v) => !v)}>
            {showForm ? L("取消", "Cancel", "Hủy") : L("新建数据源", "New source", "Thêm nguồn")}
          </button>
        </div>

        {error ? (
          <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>
        ) : null}

        {showForm ? (
          <div className="toolbar" style={{ flexWrap: "wrap", gap: 8 }}>
            <input className="input" placeholder={L("代码 lowercase_code", "code", "mã")} value={draft.code} onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, code: e.target.value })} />
            <input className="input" placeholder={L("名称", "name", "tên")} value={draft.nameZh} onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, nameZh: e.target.value })} />
            <select className="input" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as DataSourceKind, port: e.target.value === "mysql" ? "3306" : "5432" })}>
              <option value="postgres">PostgreSQL</option>
              <option value="mysql">MySQL</option>
            </select>
            <input className="input" placeholder="host" value={draft.host} onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, host: e.target.value })} />
            <input className="input" style={{ width: 90 }} placeholder="port" value={draft.port} onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, port: e.target.value })} />
            <input className="input" placeholder="database" value={draft.database} onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, database: e.target.value })} />
            <input className="input" placeholder="user" value={draft.user} onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, user: e.target.value })} />
            <input className="input" type="password" placeholder="password" value={draft.password} onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, password: e.target.value })} />
            {draft.kind === "postgres" ? (
              <input className="input" placeholder="schema" value={draft.schema} onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, schema: e.target.value })} />
            ) : null}
            <button type="button" className="active" disabled={busy === "save"} onClick={save}>
              {L("保存", "Save", "Lưu")}
            </button>
          </div>
        ) : null}
      </section>

      <section className="surface-panel">
        <div className="section-header"><div><h2>{L("已登记数据源", "Registered sources", "Nguồn đã đăng ký")}</h2></div></div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{L("代码", "Code", "Mã")}</th>
                <th>{L("名称", "Name", "Tên")}</th>
                <th>{L("类型", "Kind", "Loại")}</th>
                <th>{L("连接", "Target", "Kết nối")}</th>
                <th>{L("启用", "Enabled", "Bật")}</th>
                <th>{L("最近连接测试", "Last test", "Kiểm tra gần nhất")}</th>
                <th>{L("最近同步", "Last sync", "Đồng bộ gần nhất")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id}>
                  <td><code>{p.code}</code></td>
                  <td>{p.name_zh}</td>
                  <td>{p.kind === "mysql" ? "MySQL" : "PostgreSQL"}</td>
                  <td className="text-xs">{p.config.host}:{p.config.port}/{p.config.database}{p.kind === "postgres" ? ` (${p.config.schema ?? "public"})` : ""}</td>
                  <td>
                    <button type="button" className={p.enabled ? "active" : ""} disabled={busy === `toggle-${p.id}`} onClick={() => toggleEnabled(p)}>
                      {p.enabled ? L("启用", "on", "bật") : L("停用", "off", "tắt")}
                    </button>
                  </td>
                  <td className="text-xs">
                    {p.last_test_at ? (
                      <span style={{ color: p.last_test_ok ? "var(--success)" : "var(--danger)" }}>
                        {p.last_test_ok ? "✓ " : "✕ "}{p.last_test_message ?? ""}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="text-xs">
                    {p.last_run
                      ? `${p.last_run.status} ${p.last_run.tables_done}/${p.last_run.tables_total} · ${Number(p.last_run.rows_copied).toLocaleString()} ${L("行", "rows", "dòng")}`
                      : "—"}
                  </td>
                  <td>
                    <div className="toolbar">
                      <button type="button" disabled={busy === `test-${p.id}`} onClick={() => test(p)}>{L("测试", "Test", "Thử")}</button>
                      <button type="button" className={activeId === p.id ? "active" : ""} disabled={busy === `tables-${p.id}`} onClick={() => openSync(p)}>
                        {L("表同步", "Sync tables", "Đồng bộ bảng")}
                      </button>
                      <button type="button" disabled={busy === `del-${p.id}`} onClick={() => remove(p)}>{L("删除", "Delete", "Xóa")}</button>
                    </div>
                  </td>
                </tr>
              ))}
              {providers.length === 0 && <tr><td colSpan={8} className="empty-state">{L("尚无数据源", "No sources yet", "Chưa có nguồn")}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {activeId !== null ? (() => {
        const provider = providers.find((p) => p.id === activeId);
        if (!provider) return null;
        const running = run?.status === "running";
        return (
          <section className="surface-panel">
            <div className="section-header">
              <div>
                <h2>{L("表同步", "Table sync", "Đồng bộ bảng")} · {provider.code}</h2>
                <p>
                  {L("目标 schema", "Target schema", "Schema đích")} <code>ext_{provider.code}</code>
                  {tables.length ? ` · ${tables.length} ${L("张表", "tables", "bảng")}` : ""}
                </p>
              </div>
              <div className="toolbar">
                <select className="input" value={mode} onChange={(e) => setMode(e.target.value as "replace" | "append")} disabled={running}>
                  <option value="replace">{L("覆盖（先清空）", "replace", "ghi đè")}</option>
                  <option value="append">{L("追加", "append", "nối thêm")}</option>
                </select>
                <button type="button" className="active" disabled={running || picked.size === 0 || busy === `sync-${provider.id}`} onClick={() => startSync(provider, false)}>
                  {L(`同步选中 (${picked.size})`, `Sync selected (${picked.size})`, `Đồng bộ (${picked.size})`)}
                </button>
                <button type="button" disabled={running} onClick={() => startSync(provider, true)}>
                  {L("同步全部", "Sync all", "Đồng bộ tất cả")}
                </button>
              </div>
            </div>

            {run ? (
              <div className="text-xs" style={{ padding: "4px 0" }}>
                <strong>
                  {run.status === "running" ? (busy === `sync-${provider.id}` ? L("启动中…", "starting…", "đang chạy…") : `${L("同步中", "running", "đang chạy")} ${run.tables_done}/${run.tables_total}`) : run.status}
                </strong>
                {" · "}{Number(run.rows_copied).toLocaleString()} {L("行", "rows", "dòng")}
                {run.message ? ` · ${run.message}` : ""}
                {runTables.length ? (
                  <ul style={{ marginTop: 4 }}>
                    {runTables.map((tb) => (
                      <li key={tb.table_name}>
                        <code>{tb.table_name}</code> {tb.status} {Number(tb.rows_copied).toLocaleString()}
                        {tb.message ? ` — ${tb.message}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <div className="toolbar">
              <input className="input" placeholder={L("筛选表名", "filter tables", "lọc bảng")} value={tableFilter} onChange={(e: ChangeEvent<HTMLInputElement>) => setTableFilter(e.target.value)} />
              <button type="button" onClick={() => setPicked(new Set(visibleTables.map((tb) => tb.name)))}>{L("全选可见", "select visible", "chọn tất cả")}</button>
              <button type="button" onClick={() => setPicked(new Set())}>{L("清空选择", "clear", "bỏ chọn")}</button>
            </div>
            <div className="table-shell" style={{ maxHeight: 420, overflow: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th />
                    <th>{L("表", "Table", "Bảng")}</th>
                    <th>{L("估算行数", "Est. rows", "Số dòng ~")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTables.slice(0, 400).map((tb) => (
                    <tr key={tb.name}>
                      <td><input type="checkbox" checked={picked.has(tb.name)} onChange={() => togglePick(tb.name)} /></td>
                      <td><code>{tb.name}</code></td>
                      <td>{Number(tb.estRows || 0).toLocaleString()}</td>
                    </tr>
                  ))}
                  {visibleTables.length === 0 && (
                    <tr><td colSpan={3} className="empty-state">{busy === `tables-${provider.id}` ? L("读取中…", "loading…", "đang tải…") : L("无可同步的表", "no tables", "không có bảng")}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {visibleTables.length > 400 ? (
              <p className="text-xs">{L(`仅显示前 400 张表，请用筛选…… 共 ${visibleTables.length} 张`, `Showing the first 400 of ${visibleTables.length}; use the filter.`, "")}</p>
            ) : null}
          </section>
        );
      })() : null}
    </div>
  );
}

export { AdminDataSources };
