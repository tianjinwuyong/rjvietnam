import { Canvas } from "@react-three/fiber";
import { Environment, OrbitControls, Text } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";

type Station = { code: string; zh: string; en: string; x: number };
type Row = { type: string; stationCode: string; sn: string; result: string; time: number };

const STATIONS: Station[] = [
  { code: "smt_pda_loading",   zh: "PD扫码上料", en: "PDA Loading",    x: -9 },
  { code: "smt_laser_marking", zh: "镭雕机",      en: "Laser",          x: -6 },
  { code: "smt_auto_insertion",zh: "AI插件机",    en: "AI Insertion",   x: -3 },
  { code: "smt_printer",       zh: "印刷机",      en: "Printer",        x:  0 },
  { code: "smt_spi",           zh: "SPI",         en: "SPI",            x:  3 },
  { code: "smt_placement",     zh: "贴片机",      en: "Placement",      x:  6 },
  { code: "smt_aoi",           zh: "SMT-AOI",     en: "SMT AOI",        x:  9 },
];

function Machine({ s, online, last }: { s: Station; online: boolean; last?: Row }) {
  const ng = last?.result === "NG";
  return (
    <group position={[s.x, 0, 0]}>
      {/* body */}
      <mesh position={[0, 1.05, 0]} castShadow>
        <boxGeometry args={[2.1, 2.1, 1.8]} />
        <meshStandardMaterial
          color={ng ? "#991b1b" : online ? "#155e75" : "#334155"}
          metalness={0.35}
        />
      </mesh>
      {/* status light */}
      <mesh position={[0, 1.2, 0.92]}>
        <boxGeometry args={[1.45, 0.75, 0.08]} />
        <meshStandardMaterial
          color={ng ? "#ef4444" : online ? "#22c55e" : "#64748b"}
          emissive={ng ? "#7f1d1d" : online ? "#14532d" : "#111827"}
        />
      </mesh>
      {/* zh label */}
      <Text position={[0, 2.45, 0]} fontSize={0.3} color="#e2e8f0">
        {s.zh}
      </Text>
      {/* en label */}
      <Text position={[0, 2.08, 0]} fontSize={0.18} color="#94a3b8">
        {s.en}
      </Text>
      {/* sn */}
      <Text position={[0, 0.98, 1]} fontSize={0.16} color="#fff">
        {last?.sn || "WAITING"}
      </Text>
    </group>
  );
}

export function SmtLineDashboard() {
  const [beats, setBeats] = useState<Record<string, number>>({});
  const [events, setEvents] = useState<Row[]>([]);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const load = () => {
      fetch("/api/pda/heartbeats", { cache: "no-store" })
        .then(r => r.json())
        .then(d => {
          const n: Record<string, number> = {};
          (d.heartbeats || []).forEach((b: any) => {
            if (String(b.stationCode).startsWith("smt_") && b.online !== false) {
              n[b.stationCode] = Number(b.receivedAt || Date.now());
            }
          });
          setBeats(n);
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const es = new EventSource(
      "/api/pda/events?node=smt_line_3d&replay=1&types=AGENT_HEARTBEAT,SN_SCAN_CHECK,STATION_TEST_RESULT,NG_DEFECT,DUPLICATE_SN"
    );
    es.onmessage = e => {
      try {
        const x = JSON.parse(e.data);
        const p = x.payload || x;
        const c = x.stationCode || p.stationCode;
        if (!String(c).startsWith("smt_")) return;
        if (x.type === "AGENT_HEARTBEAT") {
          setBeats(v => ({ ...v, [c]: Date.now() }));
        } else {
          setEvents(v => [
            {
              type: x.type,
              stationCode: c,
              sn: p.sn || "—",
              result: String(p.result || p.decision || ""),
              time: Date.now(),
            },
            ...v,
          ].slice(0, 100));
        }
      } catch (e) { console.error('[SSE parse error]', e); }
    };
    return () => es.close();
  }, []);

  const online = useMemo(
    () =>
      new Set(
        Object.entries(beats)
          .filter(([, t]) => Date.now() - t < 45000)
          .map(([c]) => c)
      ),
    [beats]
  );

  const latest = useMemo(
    () =>
      Object.fromEntries(
        STATIONS.map(s => [s.code, events.find(e => e.stationCode === s.code)])
      ),
    [events]
  );

  return (
    <div
      style={{
        height: "100vh",
        background: "#020617",
        color: "#e2e8f0",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <Canvas
        shadows
        camera={{ position: [0, 11, 18], fov: 48 }}
        style={{ width: "100%", height: "100%" }}
      >
        <ambientLight intensity={0.65} />
        <directionalLight position={[4, 12, 8]} intensity={2.2} castShadow />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[28, 12]} />
          <meshStandardMaterial color="#0f172a" />
        </mesh>
        {STATIONS.map(s => (
          <Machine
            key={s.code}
            s={s}
            online={online.has(s.code)}
            last={latest[s.code] as Row | undefined}
          />
        ))}
        <OrbitControls makeDefault />
        <Environment preset="warehouse" />
      </Canvas>

      <header
        style={{
          position: "absolute",
          top: 16,
          left: 20,
          right: 20,
          display: "flex",
          justifyContent: "space-between",
          pointerEvents: "none",
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>SMT L001 · 3D MES MONITOR</h1>
          <div style={{ color: "#67e8f9" }}>
            smt domain · Station → MES → 3D · read-only
          </div>
        </div>
        <div
          style={{
            background: "#0f172add",
            padding: "12px 16px",
            borderRadius: 8,
            fontWeight: 700,
          }}
        >
          ONLINE {online.size} / 7
        </div>
      </header>

      <button
        onClick={() => setOpen(v => !v)}
        style={{
          position: "absolute",
          right: open ? 370 : 16,
          top: 80,
          zIndex: 2,
          background: "#0f172a",
          border: "1px solid #1e3a5f",
          borderRadius: 8,
          padding: "6px 14px",
          color: "#94a3b8",
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        {open ? "关闭实时数据" : "打开实时数据"}
      </button>

      {open && (
        <aside
          style={{
            position: "absolute",
            right: 12,
            top: 72,
            bottom: 12,
            width: 340,
            background: "#07111fee",
            border: "1px solid #164e63",
            borderRadius: 10,
            padding: 14,
            overflow: "auto",
          }}
        >
          <h3 style={{ margin: "0 0 12px", color: "#67e8f9" }}>SMT 实时数据</h3>
          {events.length ? (
            events.map((e, i) => (
              <div
                key={`${e.time}-${i}`}
                style={{
                  padding: "9px 0",
                  borderBottom: "1px solid #1e293b",
                  fontSize: 12,
                }}
              >
                <b style={{ color: e.result === "NG" ? "#f87171" : "#22d3ee" }}>
                  {e.type}
                </b>
                <div style={{ color: "#94a3b8" }}>{e.stationCode}</div>
                <div>
                  {e.sn} {e.result}
                </div>
              </div>
            ))
          ) : (
            <div style={{ color: "#64748b", fontSize: 13 }}>
              等待 SMT Agent 数据…
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
