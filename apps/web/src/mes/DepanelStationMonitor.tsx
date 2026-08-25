import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { DepanelScene3D } from "./DepanelScene3D";
import { StationScannerControl } from "./StationScannerControl";
import { DepanelMergePanel } from "./DepanelMergePanel";
import { mergeDepanelRecords, buildDepanelNgMigrationPayload, type NgCategory } from "./DepanelMergeEngine";
import type { Locale } from "../../../../packages/shared-types/src/factory";

type BucketName = "pending_ng" | "confirmed_ng" | "pass" | "stats";
type BoardResult = "PASS" | "FAIL" | "TEST" | "EMPTY";

interface BoardSlot {
  slot: number;
  sn: string;
  result: BoardResult;
  testCount?: number;
  retestRemaining?: number;
  defectCode?: string;
}

interface BucketSnapshot {
  stationCode: string;
  bucketName: BucketName;
  version?: number;
  payload?: unknown[];
  records?: unknown[];
  updatedAt?: string | number;
}

interface StationState {
  online: boolean;
  lastHeartbeat: number;
  pending: Record<string, unknown>[];
  confirmed: Record<string, unknown>[];
  passed: Record<string, unknown>[];
  stats: { total: number; pass: number; fail: number; dup: number };
  batchId: string;
  slots: BoardSlot[];
  updatedAt: number;
}

const EMPTY_STATE: StationState = {
  online: false,
  lastHeartbeat: 0,
  pending: [],
  confirmed: [],
  passed: [],
  stats: { total: 0, pass: 0, fail: 0, dup: 0 },
  batchId: "WAITING",
  slots: Array.from({ length: 12 }, (_, i) => ({ slot: i + 1, sn: "", result: "EMPTY" })),
  updatedAt: 0,
};

function recordsOf(snapshot: BucketSnapshot | undefined): Record<string, unknown>[] {
  const rows = snapshot?.payload ?? snapshot?.records ?? [];
  return Array.isArray(rows) ? rows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object")) : [];
}

function childrenOf(record: Record<string, unknown>): Record<string, unknown>[] {
  const candidates = [record.subBoards, record.members, record.boards];
  const rows = candidates.find(Array.isArray);
  return Array.isArray(rows) ? rows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object")) : [];
}

function makeSlots(pending: Record<string, unknown>[], confirmed: Record<string, unknown>[], passed: Record<string, unknown>[], slotCount = 12) {
  const source = confirmed[0] ?? pending[0];
  const batchChildren = source ? childrenOf(source) : [];
  const passRows = passed.flatMap((row) => childrenOf(row).length ? childrenOf(row) : [row]);
  const merged = [...batchChildren, ...passRows];
  const bySlot = new Map<number, BoardSlot>();
  const bySlotTime = new Map<number, number>();
  merged.forEach((row, index) => {
    const channel = String(row.channel ?? row.position ?? "").trim().toUpperCase();
    const channelMatch = /^([LR])([1-8])$/.exec(channel);
    const channelSlot = channelMatch ? Number(channelMatch[2]) + (channelMatch[1] === "R" ? 8 : 0) : 0;
    const slot = Math.max(1, Math.min(slotCount, channelSlot || Number(row.slot ?? index + 1) || index + 1));
    const rawTime = row.testTime ?? row.sourceTestTimeIso ?? row.time ?? row.createdAt ?? 0;
    const parsedTime = typeof rawTime === "number" ? rawTime : Date.parse(String(rawTime).replace("/", "T"));
    const rowTime = Number.isFinite(parsedTime) ? parsedTime : index;
    if (bySlotTime.has(slot) && rowTime < Number(bySlotTime.get(slot))) return;
    const rawResult = String(row.finalResult ?? row.result ?? row.overallResult ?? "PASS").toUpperCase();
    bySlot.set(slot, {
      slot,
      sn: String(row.sn ?? row.pcbSerial ?? ""),
      result: rawResult === "FAIL" || rawResult === "NG" ? "FAIL" : "PASS",
      testCount: Number(row.testCount ?? 1),
      retestRemaining: Number(row.retestRemaining ?? 0),
      defectCode: String(row.errorCode ?? row.defectCode ?? ""),
    });
    bySlotTime.set(slot, rowTime);
  });
  return Array.from({ length: slotCount }, (_, index) => bySlot.get(index + 1) ?? { slot: index + 1, sn: "", result: "EMPTY" as const });
}

const copy = {
  "zh-CN": {
    title: "分板工位 3D",
    subtitle: "DEPANEL · ICT+FCT合并数字孪生",
    online: "在线",
    offline: "离线",
    heartbeat: "心跳",
    current: "当前母板",
    ictOnlyNg: "ICT唯NG",
    fctOnlyNg: "FCT唯NG",
    ictFctNg: "ICT+FCT双NG",
    pass: "PASS",
    refresh: "刷新",
    authority: "本页显示MES状态；分板控制仍由本机Agent执行",
    noBatch: "等待ICT+FCT数据",
    merge: "合并面板",
    oee: "OEE",
    availability: "可用率",
    performance: "性能率",
    quality: "质量率",
  },
  "vi-VN": {
    title: "Trạm cắt bo 3D",
    subtitle: "DEPANEL · Bản sao số hợp nhất ICT+FCT",
    online: "Trực tuyến",
    offline: "Ngoại tuyến",
    heartbeat: "Nhịp tim",
    current: "Bo mạch hiện tại",
    ictOnlyNg: "NG chỉ ICT",
    fctOnlyNg: "NG chỉ FCT",
    ictFctNg: "NG ICT+FCT",
    pass: "PASS",
    refresh: "Làm mới",
    authority: "Trang này hiển thị trạng thái MES; điều khiển vẫn ở Agent cục bộ",
    noBatch: "Đang chờ dữ liệu ICT+FCT",
    merge: "Bảng hợp nhất",
    oee: "OEE",
    availability: "Khả dụng",
    performance: "Hiệu suất",
    quality: "Chất lượng",
  },
  "en-US": {
    title: "Depanel 3D",
    subtitle: "DEPANEL · ICT+FCT merged digital twin",
    online: "ONLINE",
    offline: "OFFLINE",
    heartbeat: "Heartbeat",
    current: "Current motherboard",
    ictOnlyNg: "ICT-only NG",
    fctOnlyNg: "FCT-only NG",
    ictFctNg: "ICT+FCT NG",
    pass: "PASS",
    refresh: "Refresh",
    authority: "This view shows MES state; depanel control remains in local Agent",
    noBatch: "Waiting for ICT+FCT data",
    merge: "Merge Panel",
    oee: "OEE",
    availability: "Availability",
    performance: "Performance",
    quality: "Quality",
  },
} as const;

export function DepanelStationMonitor({ locale }: { locale: Locale }) {
  const [displayLocale, setDisplayLocale] = useState<Locale>(locale);
  const language = copy[displayLocale] ? displayLocale : "en-US";
  const text = copy[language];
  const [state, setState] = useState<StationState>(EMPTY_STATE);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"3D" | "MERGE" | "OEE">("3D");
  const [migrationStatus, setMigrationStatus] = useState("");
  const latestBatchRef = useRef(state.batchId);
  latestBatchRef.current = state.batchId;

  // SSE for real-time updates
  const esRef = useRef<EventSource | null>(null);
  useEffect(() => {
    const connect = () => {
      try {
        esRef.current = new EventSource("/api/station/sse/manu_depanel");
        esRef.current.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "BATCH_UPDATE" || data.type === "SNAPSHOT_REFRESH") {
              void refresh();
            }
          } catch { /* ignore parse errors */ }
        };
        esRef.current.onerror = () => {
          esRef.current?.close();
          setTimeout(connect, 5000);
        };
      } catch { /* EventSource not available */ }
    };
    connect();
    return () => esRef.current?.close();
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [snapshotResponse, heartbeatResponse] = await Promise.all([
        fetch("/api/station/bucket-snapshots", { cache: "no-store" }),
        fetch("/api/pda/heartbeats", { cache: "no-store" }),
      ]);
      if (!snapshotResponse.ok) throw new Error(`snapshot HTTP ${snapshotResponse.status}`);
      const snapshotBody = await snapshotResponse.json();
      const heartbeatBody = heartbeatResponse.ok ? await heartbeatResponse.json() : { heartbeats: [] };
      const snapshots: BucketSnapshot[] = Array.isArray(snapshotBody) ? snapshotBody : snapshotBody.items ?? snapshotBody.snapshots ?? [];
      const depanel = snapshots.filter((item) => item.stationCode === "manu_depanel");
      const ict = snapshots.filter((item) => item.stationCode === "manu_ict");
      const fct = snapshots.filter((item) => item.stationCode === "manu_fct");
      const bucket = (name: BucketName) => depanel.find((item) => item.bucketName === name);
      const pending = recordsOf(bucket("pending_ng"));
      const confirmed = recordsOf(bucket("confirmed_ng"));
      const passed = recordsOf(bucket("pass"));
      const statsRow = recordsOf(bucket("stats"))[0] ?? {};
      const heartbeat = (heartbeatBody.heartbeats ?? []).find((item: Record<string, unknown>) => item.stationCode === "manu_depanel");
      const serverTime = Number(heartbeatBody.serverTime ?? Date.now());
      const receivedAt = Number(heartbeat?.receivedAt ?? 0);
      const focus = confirmed[0] ?? pending[0];
      const batchId = String(focus?.batchId ?? focus?.motherboardId ?? focus?.id ?? "WAITING");
      setState({
        online: Boolean(heartbeat && heartbeat.online !== false && serverTime - receivedAt < 45_000),
        lastHeartbeat: receivedAt,
        pending,
        confirmed,
        passed,
        stats: {
          total: Number(statsRow.total ?? passed.length + pending.length + confirmed.length),
          pass: Number(statsRow.pass ?? passed.length),
          fail: Number(statsRow.fail ?? pending.length + confirmed.length),
          dup: Number(statsRow.dup ?? 0),
        },
        batchId,
        slots: makeSlots(pending, confirmed, passed, 12),
        updatedAt: Date.now(),
      });
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load Depanel state");
      setState((current) => ({ ...current, online: false }));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  // ICT + FCT records for merge panel
  const { ictRecords, fctRecords } = useMemo(() => {
    return { ictRecords: state.pending, fctRecords: state.confirmed };
  }, [state.pending, state.confirmed]);

  const handleMigrateNg = useCallback(async (category: NgCategory, payload: object) => {
    setMigrationStatus(`迁移 ${category} → 维修工单…`);
    try {
      const response = await fetch("/api/station/maintenance-handovers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
      setMigrationStatus(`迁移完成 · WO ${String(result.repairWorkOrderNo || "")}`);
      await refresh();
    } catch (reason) {
      setMigrationStatus(reason instanceof Error ? reason.message : "迁移失败");
    }
  }, [refresh]);

  const oee = useMemo(() => {
    const { total, pass, fail } = state.stats;
    const avail = total > 0 ? Math.min(1, (pass + fail) / Math.max(1, total)) : 0.95;
    const perf = total > 0 ? Math.min(1, pass / Math.max(1, total)) : 0.98;
    const qual = total > 0 ? pass / Math.max(1, pass + fail) : 1.0;
    return { avail: (avail * 100).toFixed(1), perf: (perf * 100).toFixed(1), qual: (qual * 100).toFixed(1), oee: ((avail * perf * qual) * 100).toFixed(1) };
  }, [state.stats]);

  const mergedResult = useMemo(() => {
    return mergeDepanelRecords({ ictRecords: ictRecords as never[], fctRecords: fctRecords as never[], slotCount: 12 });
  }, [ictRecords, fctRecords]);

  return (
    <div className="ict3d-root">
      <style>{`
        .ict3d-root{position:relative;min-height:calc(100vh - 190px);height:760px;overflow:hidden;border:1px solid #26364f;border-radius:16px;background:#07111f;color:#e2e8f0;font-family:Inter,system-ui,sans-serif;box-shadow:0 24px 70px #02061788}
        .ict3d-canvas{position:absolute;inset:0}
        .ict3d-head{position:absolute;z-index:5;left:20px;right:20px;top:18px;display:flex;justify-content:space-between;align-items:flex-start;pointer-events:none}
        .ict3d-head h1{font-size:24px;margin:0 0 5px;letter-spacing:.02em}.ict3d-head p{margin:0;color:#8fa4bf;font-size:12px}
        .ict3d-status{display:flex;align-items:center;gap:9px;padding:8px 13px;border-radius:999px;background:#081424dc;border:1px solid #334155;font-size:12px;font-weight:800}.ict3d-dot{width:9px;height:9px;border-radius:50%;box-shadow:0 0 14px currentColor}
        .ict3d-button{border:1px solid #38bdf8;background:#0c4a6e;color:white;border-radius:9px;padding:10px 16px;font-weight:800;cursor:pointer}.ict3d-button:hover{background:#075985}
        .ict3d-error{position:absolute;z-index:8;left:50%;top:48%;transform:translate(-50%,-50%);padding:10px 15px;border:1px solid #ef4444;border-radius:8px;background:#450a0add;color:#fecaca;font-size:12px}
        .ict3d-footer{position:absolute;z-index:7;left:20px;right:20px;bottom:18px;display:flex;gap:10px;align-items:center}.ict3d-note{flex:1;padding:10px 12px;border:1px solid #1e7494;border-radius:9px;background:#082033dc;color:#bae6fd;font-size:11px}
        .ict3d-tab-bar{position:absolute;z-index:14;left:20px;right:20px;top:76px;display:flex;gap:4px}
        .ict3d-tab{white-space:nowrap;border:1px solid #334155;border-radius:6px;background:#102038;color:#94a3b8;padding:7px 14px;font-size:10px;font-weight:900;cursor:pointer}.ict3d-tab.active{background:#0e7490;border-color:#67e8f9;color:white}
        .oee-panel{position:absolute;z-index:10;right:20px;top:82px;width:220px;background:#071525e8;border:1px solid #263850;border-radius:12px;padding:14px;backdrop-filter:blur(12px)}
        .oee-title{font-size:12px;font-weight:900;color:#7dd3fc;margin:0 0 10px}.oee-row{display:flex;justify-content:space-between;gap:8px;border-top:1px solid #1d2b3f;padding:7px 0;font-size:11px}.oee-row span:first-child{color:#7f95b1}.oee-big{font-size:28px;font-weight:900;color:#22d3ee;text-align:center;margin:6px 0}
        .merge-panel-overlay{position:absolute;z-index:15;inset:70px 12px 48px;background:#020617b8;display:flex;align-items:flex-start;justify-content:center;padding:12px;overflow:hidden}
        .merge-panel{box-sizing:border-box;width:min(1200px,96%);height:100%;max-height:100%;display:flex;flex-direction:column;overflow:hidden;background:#081424;border:1px solid #38bdf8;border-radius:14px;box-shadow:0 28px 90px #000;padding:16px}
      `}</style>

      {activeTab === "3D" && (
        <div className="ict3d-canvas">
          <Canvas shadows camera={{ position: [8.8, 7.1, 10.2], fov: 43 }}>
            <DepanelScene3D state={state} stationLabel={text.title.replace(" 3D", "")} stationCode="manu_depanel" />
          </Canvas>
        </div>
      )}

      {activeTab === "MERGE" && (
        <div className="merge-panel-overlay">
          <div className="merge-panel">
            <DepanelMergePanel
              locale={displayLocale}
              ictRecords={ictRecords}
              fctRecords={fctRecords}
              onMigrateNg={handleMigrateNg}
            />
            {migrationStatus && (
              <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, background: "#082033", border: "1px solid #1e7494", color: "#bae6fd", fontSize: 11 }}>
                {migrationStatus}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "OEE" && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
          <div className="oee-panel" style={{ position: "relative", top: "auto", right: "auto" }}>
            <div className="oee-title">{text.oee} — DEPANEL</div>
            <div className="oee-big">{oee.oee}%</div>
            <div className="oee-row"><span>{text.availability}</span><strong style={{ color: Number(oee.avail) > 85 ? "#22c55e" : "#f59e0b" }}>{oee.avail}%</strong></div>
            <div className="oee-row"><span>{text.performance}</span><strong style={{ color: Number(oee.perf) > 90 ? "#22c55e" : "#f59e0b" }}>{oee.perf}%</strong></div>
            <div className="oee-row"><span>{text.quality}</span><strong style={{ color: Number(oee.qual) > 95 ? "#22c55e" : "#f59e0b" }}>{oee.qual}%</strong></div>
            <div className="oee-row" style={{ marginTop: 8, borderTop: "2px solid #334155" }}>
              <span>PASS</span><strong style={{ color: "#22c55e" }}>{state.stats.pass}</strong>
              <span>NG</span><strong style={{ color: "#ef4444" }}>{state.stats.fail}</strong>
            </div>
          </div>
        </div>
      )}

      <div style={{ position: "absolute", zIndex: 12, left: "50%", top: 18, transform: "translateX(-50%)", width: 390 }}>
        <StationScannerControl stationCode="manu_depanel" locale={displayLocale} compact />
      </div>

      <header className="ict3d-head">
        <div>
          <h1>{text.title}</h1>
          <p>{text.subtitle}</p>
        </div>
        <div style={{ display: "flex", gap: 8, pointerEvents: "auto" }}>
          <button className="ict3d-button" type="button" onClick={() => setDisplayLocale(displayLocale === "zh-CN" ? "en-US" : displayLocale === "en-US" ? "vi-VN" : "zh-CN")}>中文 / EN / VI</button>
          <div className="ict3d-status">
            <span className="ict3d-dot" style={{ color: state.online ? "#22c55e" : "#ef4444", background: state.online ? "#22c55e" : "#ef4444" }} />
            {state.online ? text.online : text.offline}
          </div>
        </div>
      </header>

      <div className="ict3d-tab-bar">
        {([["3D", "3D数字孪生"], ["MERGE", "ICT+FCT合并"], ["OEE", "OEE仪表盘"]] as const).map(([key, label]) => (
          <button key={key} type="button" className={`ict3d-tab ${activeTab === key ? "active" : ""}`} onClick={() => setActiveTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {error && <div className="ict3d-error">MES: {error}</div>}

      <footer className="ict3d-footer">
        <div className="ict3d-note">{text.authority}</div>
        <button className="ict3d-button" type="button" onClick={() => void refresh()}>{text.refresh}</button>
      </footer>
    </div>
  );
}
