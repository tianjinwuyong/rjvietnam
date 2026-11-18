// MES-ruijing W5 自定义页面 —— 机型工艺编辑器（源 App.py 的 /route/process 页面）
// 工艺路线列表/工位规则走 resources.tsx 的 CRUD；这里放有业务流的机型工艺维护。
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

async function call<T>(fn: () => Promise<T>): Promise<[T | null, string]> {
  try {
    return [await fn(), ""];
  } catch (ex) {
    return [null, ex instanceof MesrjApiError ? ex.message : String(ex)];
  }
}

interface ProcStep {
  seq_no?: number; station_code: string; station_name: string; process_code: string;
  is_must_pass: number; enabled: number; is_sampling?: number; remark: string;
}
interface ProcSeg {
  process_code: string; process_name: string; count: number; total: number;
  disabled: number; must: number; steps: ProcStep[];
}
interface ProcData {
  models?: string[]; model: string; variant: string; source: string; source_label: string;
  variants: Array<{ variant: string; name: string; stations: number; live: number; is_std: boolean }>;
  steps: ProcStep[]; segments: ProcSeg[];
  total: number; total_all: number; total_disabled: number; total_must: number; total_sampling: number;
}

const SOURCE_COLOR: Record<string, string> = {
  own: "#15803d", fallback: "#b45309", template: "#64748b",
};

export function ModelProcessView({ locale }: { locale: Locale }) {
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [variant, setVariant] = useState("");
  const [data, setData] = useState<ProcData | null>(null);
  const [steps, setSteps] = useState<ProcStep[]>([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [relockMo, setRelockMo] = useState("");

  const loadModels = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<ProcData>("/route/process"));
    if (d) setModels(d.models ?? []); else setErr(e);
  }, []);
  useEffect(() => { void loadModels(); }, [loadModels]);

  const load = useCallback(async () => {
    if (!model.trim()) return;
    const [d, e] = await call(() => mesrjApi.get<ProcData>("/route/process",
      { model: model.trim(), variant }));
    if (e) { setErr(e); return; }
    setErr(""); setMsg("");
    setData(d);
    setSteps(d?.steps ?? []);
  }, [model, variant]);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setBusy(true);
    const [d, e] = await call(() => mesrjApi.post<{ msg?: string }>("/route/process/save", {
      model: model.trim(), variant, steps,
    }));
    setBusy(false);
    if (e) { setErr(e); return; }
    setErr(""); setMsg(d?.msg ?? "已保存");
    await load();
  };

  const syncMo = async () => {
    const [d, e] = await call(() => mesrjApi.post<{ msg?: string }>("/route/process/sync-mo",
      { model: model.trim() }));
    if (e) { setErr(e); return; }
    setErr(""); setMsg(d?.msg ?? "");
  };

  const reset = async () => {
    if (!window.confirm(`清空 ${model} 维护的工艺，回到通用模板？`)) return;
    const [d, e] = await call(() => mesrjApi.post<{ msg?: string }>("/route/process/reset",
      { model: model.trim() }));
    if (e) { setErr(e); return; }
    setErr(""); setMsg(d?.msg ?? "");
    await load();
  };

  const relock = async () => {
    const [d, e] = await call(() => mesrjApi.post<{ msg?: string }>("/route/process/relock-mo",
      { mo_no: relockMo.trim() }));
    if (e) { setErr(e); return; }
    setErr(""); setMsg(d?.msg ?? "");
  };

  const setStep = (i: number, patch: Partial<ProcStep>) => {
    setSteps(ss => ss.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  };

  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select value={model} onChange={e => { setModel(e.target.value); setVariant(""); }} style={{ ...inp, minWidth: 220 }}>
          <option value="">选择机型…</option>
          {models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        {(data?.variants?.length ?? 0) > 0 && (
          <select value={variant} onChange={e => setVariant(e.target.value)} style={inp}>
            {data!.variants.map(v => (
              <option key={v.variant} value={v.variant}>{v.name}（{v.live}/{v.stations} 站）</option>
            ))}
          </select>
        )}
        <button onClick={() => void load()}>{t("search", locale)}</button>
        {data && (
          <span style={{ fontSize: 12, color: SOURCE_COLOR[data.source] ?? "#64748b" }}>
            {data.source_label} · 启用 {data.total}/{data.total_all} · 过站 {data.total_must} · 抽检 {data.total_sampling}
          </span>
        )}
      </div>
      <Err msg={err} />
      {msg && <div style={{ color: "#15803d", padding: "4px 0", fontSize: 13, whiteSpace: "pre-wrap" }}>{msg}</div>}

      {data && data.source === "template" && (
        <div style={{ ...box, color: "#b45309", fontSize: 13 }}>
          ⚠ 该机型还没有专属工艺，下面是按产线模板拼装的草稿——确认后点「保存」即可生效。
        </div>
      )}

      {steps.length > 0 && (
        <div style={box}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <button onClick={() => void save()} disabled={busy}>{t("save", locale)}</button>
            <button onClick={() => void syncMo()} disabled={busy}>{t("route.process.sync_mo", locale)}</button>
            <button onClick={() => void reset()} disabled={busy}>{t("route.process.reset", locale)}</button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr>
                {[t("route.process.station", locale), "工序", t("route.process.must", locale),
                  t("route.process.enabled", locale), "抽检", t("route.process.remark2", locale)].map(h => (
                  <th key={h} style={{ padding: "7px 10px", borderBottom: "1px solid var(--border, #e2e8f0)", textAlign: "left" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {steps.map((s, i) => (
                  <tr key={`${s.station_code}-${i}`}>
                    <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>
                      <b>{s.station_code}</b> · {s.station_name}
                    </td>
                    <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>{s.process_code}</td>
                    <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>
                      <input type="checkbox" checked={s.is_must_pass === 1}
                        onChange={e => setStep(i, { is_must_pass: e.target.checked ? 1 : 0 })} />
                    </td>
                    <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>
                      <input type="checkbox" checked={s.enabled === 1}
                        onChange={e => setStep(i, { enabled: e.target.checked ? 1 : 0 })} />
                    </td>
                    <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9", color: "#94a3b8" }}>
                      {s.is_sampling === 1 ? "✓" : "-"}
                    </td>
                    <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>
                      <input value={s.remark ?? ""} onChange={e => setStep(i, { remark: e.target.value })}
                        style={{ ...inp, width: 200 }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && data.segments.length > 0 && (
        <div style={{ ...box, fontSize: 12, color: "#475569" }}>
          分段：{data.segments.map(s =>
            `${s.process_name} ${s.count}/${s.total}（过站 ${s.must}${s.disabled ? `，停用 ${s.disabled}` : ""}）`).join("  ·  ")}
        </div>
      )}

      <div style={{ ...box, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 13 }}>{t("route.process.relock", locale)}：</span>
        <input value={relockMo} onChange={e => setRelockMo(e.target.value)}
          placeholder="工单号" style={{ ...inp, minWidth: 180 }} />
        <button onClick={() => void relock()} disabled={!relockMo.trim() || !model}>执行</button>
      </div>
    </div>
  );
}
