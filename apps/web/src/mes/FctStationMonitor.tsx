import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { FctScene3D } from "./FctScene3D";
import { StationScannerControl } from "./StationScannerControl";
import type { Locale } from "../../../../packages/shared-types/src/factory";

type BucketName = "pending_ng" | "confirmed_ng" | "pass" | "process" | "stats";
type BoardResult = "PASS" | "FAIL" | "TEST" | "EMPTY";

interface BoardSlot {
  slot: number; sn: string; result: BoardResult;
  testCount?: number; retestRemaining?: number; defectCode?: string;
}

interface BucketSnapshot {
  stationCode: string; bucketName: BucketName; version?: number;
  payload?: unknown[]; records?: unknown[]; updatedAt?: string | number;
}

interface StationState {
  online: boolean; lastHeartbeat: number;
  pending: Record<string, unknown>[]; confirmed: Record<string, unknown>[]; passed: Record<string, unknown>[]; process: Record<string, unknown>[];
  stats: { total: number; pass: number; fail: number; dup: number };
  batchId: string; slots: BoardSlot[]; updatedAt: number;
}

const EMPTY_STATE: StationState = {
  online: false, lastHeartbeat: 0, pending: [], confirmed: [], passed: [], process: [],
  stats: { total: 0, pass: 0, fail: 0, dup: 0 }, batchId: "WAITING",
  slots: Array.from({ length: 12 }, (_, i) => ({ slot: i + 1, sn: "", result: "EMPTY" })), updatedAt: 0,
};

function recordsOf(snapshot: BucketSnapshot | undefined): Record<string, unknown>[] {
  const rows = snapshot?.payload ?? snapshot?.records ?? [];
  if (Array.isArray(rows)) return rows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"));
  return rows && typeof rows === "object" ? [rows as Record<string, unknown>] : [];
}

function childrenOf(record: Record<string, unknown>): Record<string, unknown>[] {
  const candidates = [record.subBoards, record.members, record.boards];
  const rows = candidates.find(Array.isArray);
  return Array.isArray(rows) ? rows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object")) : [];
}

function batchIdOf(record: Record<string, unknown> | undefined): string {
  return String(record?.batchId ?? record?.motherboardId ?? record?.id ?? "").trim();
}

function currentBoard(process: Record<string, unknown>[], pending: Record<string, unknown>[], confirmed: Record<string, unknown>[], passed: Record<string, unknown>[]) {
  const processBoard = process.find((row) => childrenOf(row).length);
  if (processBoard) return processBoard;
  // MES process is the live-board pointer. Resolve it against the complete
  // motherboard snapshot instead of using confirmed_ng[0] (oldest history).
  const liveBatch = batchIdOf(process[0]);
  if (liveBatch) {
    const match = [...pending, ...confirmed, ...passed].find((row) => batchIdOf(row) === liveBatch);
    if (match) return match;
  }
  return confirmed[0] ?? pending[0] ?? passed[0];
}

function makeSlots(process: Record<string, unknown>[], pending: Record<string, unknown>[], confirmed: Record<string, unknown>[], passed: Record<string, unknown>[], slotCount = 12) {
  const source = currentBoard(process, pending, confirmed, passed);
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
      slot, sn: String(row.sn ?? row.pcbSerial ?? ""),
      result: rawResult === "FAIL" || rawResult === "NG" ? "FAIL" : "PASS",
      testCount: Number(row.testCount ?? 1), retestRemaining: Number(row.retestRemaining ?? 0),
      defectCode: String(row.errorCode ?? row.defectCode ?? ""),
    });
    bySlotTime.set(slot, rowTime);
  });
  return Array.from({ length: slotCount }, (_, index) => bySlot.get(index + 1) ?? { slot: index + 1, sn: "", result: "EMPTY" as const });
}

function motherboardLayouts(records: Record<string, unknown>[]) {
  const grouped = new Map<string, ReturnType<typeof flattenBucket>>();
  for (const row of flattenBucket(records)) {
    const list = grouped.get(row.batchId) ?? []; list.push(row); grouped.set(row.batchId, list);
  }
  return [...grouped.entries()].map(([batchId, rows]) => ({
    batchId, slots: Array.from({ length: 12 }, (_, index) => rows.find(r => r.slot === index + 1) ?? {
      batchId, slot: index + 1, sn: "—", result: "EMPTY", testCount: 0, retestRemaining: 0, defectCode: "", errorCode: "", testTime: "", testCycleId: "", eventType: "", time: "",
    }),
  }));
}

interface FlattenedBucketRow {
  batchId: string; slot: number; channel: string; sn: string; result: string; testCount: number;
  retestRemaining: number; defectCode: string; errorCode: string; testTime: string; testCycleId: string;
  eventType: string; time: unknown; firstDetectedAt?: unknown; firstFailureTime?: unknown;
  dispatchDeadlineAt?: unknown; repairDeadlineAt?: unknown; maintenanceStatus?: unknown;
  repairWorkOrderNo?: unknown; workOrderNo?: unknown; retestAuthorized?: unknown; state?: unknown;
  createdAt?: unknown; syncStatus?: unknown;
}

function flattenBucket(records: Record<string, unknown>[]): FlattenedBucketRow[] {
  return records.flatMap((record) => {
    const children = childrenOf(record);
    const rows = children.length ? children : [record];
    return rows.map((board, index): FlattenedBucketRow => ({
      batchId: String(record.batchId ?? record.motherboardId ?? board.batchId ?? "—"),
      slot: Number(board.slot ?? index + 1),
      channel: String(board.channel ?? record.channel ?? ""),
      sn: String(board.sn ?? board.pcbSerial ?? "—"),
      result: String(board.finalResult ?? board.result ?? board.overallResult ?? "—").toUpperCase(),
      testCount: Number(board.testCount ?? record.testCount ?? 1),
      retestRemaining: Number(board.retestRemaining ?? record.retestRemaining ?? 0),
      defectCode: String(board.errorCode ?? board.defectCode ?? record.errorCode ?? record.defectCode ?? ""),
      errorCode: String(board.errorCode ?? record.errorCode ?? ""),
      testTime: String(board.testTime ?? record.testTime ?? board.sourceTestTimeIso ?? record.sourceTestTimeIso ?? ""),
      testCycleId: String(board.testCycleId ?? record.testCycleId ?? ""),
      eventType: String(board.eventType ?? record.eventType ?? ""),
      time: board.time ?? record.time ?? board.lastTestTime ?? record.updatedAt ?? "",
      firstDetectedAt: board.firstDetectedAt ?? record.firstDetectedAt,
      firstFailureTime: board.firstFailureTime ?? record.firstFailureTime,
      dispatchDeadlineAt: board.dispatchDeadlineAt ?? record.dispatchDeadlineAt,
      repairDeadlineAt: board.repairDeadlineAt ?? record.repairDeadlineAt,
      maintenanceStatus: board.maintenanceStatus ?? record.maintenanceStatus,
      repairWorkOrderNo: board.repairWorkOrderNo ?? record.repairWorkOrderNo,
      workOrderNo: board.workOrderNo ?? record.workOrderNo,
      retestAuthorized: board.retestAuthorized ?? record.retestAuthorized,
      state: board.state ?? record.state,
      createdAt: board.createdAt ?? record.createdAt,
      syncStatus: board.syncStatus ?? record.syncStatus,
    }));
  });
}

const copy = {
  "zh-CN": {
    title: "FCT测试 3D", subtitle: "Excel实时测试 · MES同步数字孪生",
    online: "在线", offline: "离线", heartbeat: "心跳",
    current: "当前母板", pending: "待复检 NG", confirmed: "确认不良", pass: "PASS",
    refresh: "刷新", source: "数据源", authority: "本页显示MES接收状态；FCT控制仍由本机Agent执行",
    noBatch: "等待FCT Excel母板数据", yield: "良品率",
  },
  "vi-VN": {
    title: "Trạm FCT 3D", subtitle: "Excel realtime test · MES synchronized digital twin",
    online: "Trực tuyến", offline: "Ngoại tuyến", heartbeat: "Nhịp tim",
    current: "Bo mạch hiện tại", pending: "NG chờ kiểm tra lại", confirmed: "NG đã xác nhận", pass: "PASS",
    refresh: "Làm mới", source: "Nguồn dữ liệu", authority: "Trang này hiển thị trạng thái MES; điều khiển vẫn ở Agent cục bộ",
    noBatch: "Đang chờ dữ liệu bo mạch FCT Excel", yield: "Tỷ lệ đạt",
  },
  "en-US": {
    title: "FCT 3D", subtitle: "Excel realtime test · MES synchronized digital twin",
    online: "ONLINE", offline: "OFFLINE", heartbeat: "Heartbeat",
    current: "Current motherboard", pending: "Pending NG", confirmed: "Confirmed NG", pass: "PASS",
    refresh: "Làm mới", source: "Data source", authority: "This view shows MES-accepted state; FCT control remains in local Agent",
    noBatch: "Waiting for FCT Excel motherboard data", yield: "Yield",
  },
} as const;

export function FctStationMonitor({ locale }: { locale: Locale }) {
  const [displayLocale, setDisplayLocale] = useState<Locale>(locale);
  const language = copy[displayLocale] ? displayLocale : "en-US";
  const text = copy[language];
  const [state, setState] = useState<StationState>(EMPTY_STATE);
  const [error, setError] = useState("");
  const [detailBox, setDetailBox] = useState<{ title: string; records: Record<string, unknown>[] } | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const latestBatchRef = useRef(state.batchId);
  latestBatchRef.current = state.batchId;

  useEffect(() => {
    const connect = () => {
      try {
        esRef.current = new EventSource("/api/station/sse/manu_fct");
        esRef.current.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "BATCH_UPDATE" || data.type === "SNAPSHOT_REFRESH") void refresh();
          } catch {}
        };
        esRef.current.onerror = () => { esRef.current?.close(); setTimeout(connect, 5000); };
      } catch {}
    };
    connect();
    return () => esRef.current?.close();
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [snapshotResponse, heartbeatResponse, centralResponse] = await Promise.all([
        fetch("/api/station/bucket-snapshots?domain=manual", { cache: "no-store", signal: AbortSignal.timeout(8000) }),
        fetch("/api/pda/heartbeats", { cache: "no-store" }),
        fetch("/api/station/confirmed-motherboards?line=manual&limit=5000", { cache: "no-store", signal: AbortSignal.timeout(8000) }),
      ]);
      if (!snapshotResponse.ok) throw new Error(`snapshot HTTP ${snapshotResponse.status}`);
      const snapshotBody = await snapshotResponse.json();
      const heartbeatBody = heartbeatResponse.ok ? await heartbeatResponse.json() : { heartbeats: [] };
      const snapshots: BucketSnapshot[] = Array.isArray(snapshotBody) ? snapshotBody : snapshotBody.items ?? snapshotBody.snapshots ?? [];
      const fct = snapshots.filter((item) => item.stationCode === "manu_fct");
      const bucket = (name: BucketName) => fct.find((item) => item.bucketName === name);
      const pending = recordsOf(bucket("pending_ng"));
      const confirmed = recordsOf(bucket("confirmed_ng"));
      const passed = recordsOf(bucket("pass"));
      const process = recordsOf(bucket("process"));
      const centralBody = centralResponse.ok ? await centralResponse.json() : { items: [] };
      const centralBoards = (Array.isArray(centralBody) ? centralBody : centralBody.items ?? []) as Record<string, unknown>[];
      const liveBatch = batchIdOf(process[0]);
      const central = centralBoards.find((item) => {
        const batch = String(item.motherboardId ?? item.ictBatchId ?? item.fctBatchId ?? item.batchId ?? "").trim();
        return Boolean(batch) && (!liveBatch || batch === liveBatch);
      });
      const statsRow = recordsOf(bucket("stats"))[0] ?? {};
      const heartbeat = (heartbeatBody.heartbeats ?? []).find((item: Record<string, unknown>) => item.stationCode === "manu_fct");
      const serverTime = Number(heartbeatBody.serverTime ?? Date.now());
      const receivedAt = Number(heartbeat?.receivedAt ?? 0);
      const focus = central && childrenOf(central).length ? central : currentBoard(process, pending, confirmed, passed);
      const batchId = batchIdOf(focus) || batchIdOf(process[0]) || "WAITING";
      setState({
        online: Boolean(heartbeat && heartbeat.online !== false && serverTime - receivedAt < 45_000),
        lastHeartbeat: receivedAt, pending, confirmed, passed, process,
        stats: {
          total: Number(statsRow.total ?? passed.length + pending.length + confirmed.length),
          pass: Number(statsRow.pass ?? passed.length),
          fail: Number(statsRow.fail ?? pending.length + confirmed.length),
          dup: Number(statsRow.dup ?? 0),
        }, batchId,
        slots: makeSlots(central && childrenOf(central).length ? [central] : process, pending, confirmed, passed, 12),
        updatedAt: Date.now(),
      });
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load FCT state");
      setState((current) => ({ ...current, online: false }));
    }
  }, []);

  useEffect(() => { void refresh(); const timer = window.setInterval(refresh, 3000); return () => window.clearInterval(timer); }, [refresh]);

  const yieldRate = useMemo(() => state.stats.total ? `${((state.stats.pass / state.stats.total) * 100).toFixed(1)}%` : "—", [state.stats]);

  return (
    <div className="ict3d-root">
      <style>{`
        .ict3d-root{position:relative;min-height:calc(100vh - 190px);height:760px;overflow:hidden;border:1px solid #26364f;border-radius:16px;background:#07111f;color:#e2e8f0;font-family:Inter,system-ui,sans-serif;box-shadow:0 24px 70px #02061788}
        .ict3d-canvas{position:absolute;inset:0}
        .ict3d-head{position:absolute;z-index:5;left:20px;right:20px;top:18px;display:flex;justify-content:space-between;align-items:flex-start;pointer-events:none}
        .ict3d-head h1{font-size:24px;margin:0 0 5px;letter-spacing:.02em}.ict3d-head p{margin:0;color:#8fa4bf;font-size:12px}
        .ict3d-status{display:flex;align-items:center;gap:9px;padding:8px 13px;border-radius:999px;background:#081424dc;border:1px solid #334155;font-size:12px;font-weight:800}.ict3d-dot{width:9px;height:9px;border-radius:50%;box-shadow:0 0 14px currentColor}
        .ict3d-metrics{position:absolute;z-index:5;left:20px;top:105px;display:grid;gap:10px;width:min(240px,calc(100% - 40px))}
        .ict3d-metric{text-align:left;color:#e2e8f0;background:#071525f2;border:2px solid #263850;border-radius:5px 5px 12px 12px;padding:11px 12px;backdrop-filter:blur(12px);cursor:pointer;box-shadow:inset 0 4px 0 #334155,0 8px 22px #02061788}.ict3d-metric:hover{border-color:#38bdf8;transform:translateY(-2px)}.ict3d-metric span{display:block;color:#cbd5e1;font-size:11px;font-weight:800}.ict3d-metric strong{display:block;font-size:24px;margin-top:3px}.ict3d-metric small{display:block;margin-top:3px;color:#64748b;font-size:9px}
        .ict3d-panel{position:absolute;z-index:6;right:20px;top:92px;width:250px;background:#071525e8;border:1px solid #263850;border-radius:12px;padding:14px;backdrop-filter:blur(12px)}
        .ict3d-panel h3{font-size:12px;margin:0 0 10px;color:#7dd3fc}.ict3d-row{display:flex;justify-content:space-between;gap:12px;border-top:1px solid #1d2b3f;padding:8px 0;font-size:11px}.ict3d-row span:first-child{color:#7f95b1}.ict3d-row strong{font-family:ui-monospace,monospace;text-align:right;word-break:break-all}
        .ict3d-footer{position:absolute;z-index:7;left:20px;right:20px;bottom:18px;display:flex;gap:10px;align-items:center}.ict3d-note{flex:1;padding:10px 12px;border:1px solid #1e7494;border-radius:9px;background:#082033dc;color:#bae6fd;font-size:11px}
        .ict3d-button{border:1px solid #38bdf8;background:#0c4a6e;color:white;border-radius:9px;padding:10px 16px;font-weight:800;cursor:pointer}.ict3d-button:hover{background:#075985}
        .ict3d-tooltip{white-space:nowrap;background:#020617e8;border:1px solid #475569;color:#e2e8f0;border-radius:6px;padding:5px 7px;font:10px ui-monospace,monospace;transform:translateY(-15px)}
        .ict3d-error{position:absolute;z-index:8;left:50%;top:48%;transform:translate(-50%,-50%);padding:10px 15px;border:1px solid #ef4444;border-radius:8px;background:#450a0add;color:#fecaca;font-size:12px}
        .ict3d-modal-shade{position:absolute;z-index:20;inset:62px 12px 48px;background:#020617b8;display:flex;align-items:flex-start;justify-content:center;padding:12px;overflow:hidden}.ict3d-modal{box-sizing:border-box;width:min(1100px,96%);height:100%;max-height:100%;display:flex;flex-direction:column;overflow:hidden;background:#081424;border:1px solid #38bdf8;border-radius:14px;box-shadow:0 28px 90px #000;padding:16px}.ict3d-modal-head{flex:0 0 auto;display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.ict3d-modal-head h2{margin:0;color:#7dd3fc;font-size:18px}.ict3d-close{border:1px solid #475569;background:#172033;color:white;border-radius:7px;padding:6px 11px;cursor:pointer}.ict3d-table-wrap{min-height:0;flex:1 1 auto;overflow:auto}.ict3d-table{width:100%;border-collapse:collapse;font-size:11px}.ict3d-table th{position:sticky;top:0;z-index:2;background:#102038;color:#93c5fd;text-align:left;padding:8px;border-bottom:1px solid #334155}.ict3d-table td{padding:7px 8px;border-bottom:1px solid #1e293b;font-family:ui-monospace,monospace}.ict3d-pass{color:#4ade80}.ict3d-fail{color:#f87171;font-weight:800}
        .ict3d-layout-scroll{min-height:0;flex:1 1 auto;overflow:auto;padding-right:5px}.ict3d-layout-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:12px}.ict3d-board-card{background:#0b1b2d;border:1px solid #334155;border-radius:10px;padding:11px;box-shadow:inset 0 0 0 2px #07111f}.ict3d-board-id{display:flex;justify-content:space-between;margin-bottom:8px;color:#7dd3fc;font:700 11px ui-monospace,monospace}.ict3d-slot-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.ict3d-slot{min-width:0;border:1px solid #475569;border-radius:6px;padding:6px;background:#1e293b;color:#94a3b8}.ict3d-slot.pass{background:#064e3b;border-color:#22c55e;color:#dcfce7}.ict3d-slot.fail{background:#7f1d1d;border-color:#ef4444;color:#fee2e2;box-shadow:0 0 10px #ef444466}.ict3d-slot-top{display:flex;justify-content:space-between;font-size:10px;font-weight:900}.ict3d-slot-sn{margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font:9px ui-monospace,monospace}.ict3d-slot-meta{margin-top:3px;color:#cbd5e1;font-size:8px}
      `}</style>

      <div className="ict3d-canvas">
        <Canvas shadows camera={{ position: [8.8, 7.1, 10.2], fov: 43 }}>
          <FctScene3D state={state} stationLabel={text.title.replace(" 3D", "")} stationCode="manu_fct" />
        </Canvas>
      </div>

      <div style={{ position: "absolute", zIndex: 12, left: "50%", top: 18, transform: "translateX(-50%)", width: 390 }}>
        <StationScannerControl stationCode="manu_fct" locale={displayLocale} compact />
      </div>

      <header className="ict3d-head">
        <div><h1>{text.title}</h1><p>{text.subtitle}</p></div>
        <div style={{ display: "flex", gap: 8, pointerEvents: "auto" }}>
          <button className="ict3d-button" type="button" onClick={() => setDisplayLocale(displayLocale === "zh-CN" ? "en-US" : displayLocale === "en-US" ? "vi-VN" : "zh-CN")}>中文 / EN / VI</button>
          <div className="ict3d-status">
            <span className="ict3d-dot" style={{ color: state.online ? "#22c55e" : "#ef4444", background: state.online ? "#22c55e" : "#ef4444" }} />
            {state.online ? text.online : text.offline}
          </div>
        </div>
      </header>

      <div className="ict3d-metrics">
        <button className="ict3d-metric" type="button" onClick={() => setDetailBox({ title: `${text.pass} 箱`, records: state.passed })}>
          <span>{text.pass}</span><strong style={{ color: "#22d3ee" }}>{state.stats.pass}</strong><small>点击查看明细</small>
        </button>
        <button className="ict3d-metric" type="button" onClick={() => setDetailBox({ title: text.pending, records: state.pending })}>
          <span>{text.pending}</span><strong style={{ color: "#f87171" }}>{state.stats.fail}</strong><small>点击查看明细</small>
        </button>
        <button className="ict3d-metric" type="button">
          <span>{text.yield}</span><strong style={{ color: "#22c55e" }}>{yieldRate}</strong><small>当前批次</small>
        </button>
      </div>

      <aside className="ict3d-panel">
        <h3>{text.current}</h3>
        <div className="ict3d-row"><span>ID</span><strong>{state.batchId === "WAITING" ? text.noBatch : state.batchId}</strong></div>
        <div className="ict3d-row"><span>{text.heartbeat}</span><strong>{state.lastHeartbeat ? new Date(state.lastHeartbeat).toLocaleTimeString() : "—"}</strong></div>
        <div className="ict3d-row"><span>{text.source}</span><strong>FCT Excel · 12 slots</strong></div>
        <div className="ict3d-row"><span>MES</span><strong>/api/station/bucket-snapshots</strong></div>
      </aside>

      {error && <div className="ict3d-error">MES: {error}</div>}

      {detailBox && (() => {
        const layouts = motherboardLayouts(detailBox.records);
        return <div className="ict3d-modal-shade" onClick={() => setDetailBox(null)}>
          <section className="ict3d-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ict3d-modal-head"><h2>{detailBox.title} · {layouts.length} 块母板</h2><button className="ict3d-close" type="button" onClick={() => setDetailBox(null)}>✕</button></div>
            <div className="ict3d-layout-scroll">
              <div className="ict3d-layout-grid">
                {layouts.map((layout) => (
                  <article className="ict3d-board-card" key={layout.batchId}>
                    <div className="ict3d-board-id"><span>母板 {layout.batchId}</span><span>12 SLOTS</span></div>
                    <div className="ict3d-slot-grid">
                      {layout.slots.map((slot) => {
                        const bad = slot.result === "FAIL"; const good = slot.result === "PASS";
                        return <div key={slot.slot} className={`ict3d-slot ${bad ? "fail" : good ? "pass" : ""}`}>
                          <div className="ict3d-slot-top"><span>#{slot.slot}</span><span>{slot.result}</span></div>
                          <div className="ict3d-slot-sn">{slot.sn}</div>
                          <div className="ict3d-slot-meta">测试 {slot.testCount} · 剩余 {slot.retestRemaining}</div>
                        </div>;
                      })}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
        </div>;
      })()}

      <footer className="ict3d-footer">
        <div className="ict3d-note">{text.authority}</div>
        <button className="ict3d-button" type="button" onClick={() => void refresh()}>{text.refresh}</button>
      </footer>
    </div>
  );
}
