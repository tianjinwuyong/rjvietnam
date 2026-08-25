import { Canvas, useFrame } from "@react-three/fiber";
import {
  Environment,
  OrbitControls,
  RoundedBox,
  Text,
} from "@react-three/drei";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Group } from "three";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { StationScannerControl } from "./StationScannerControl";

type Row = Record<string, unknown>;
type Snapshot = { stationCode?: string; bucketName?: string; payload?: Row[] };
const COPY = {
  "zh-CN": {
    title: "超声波焊接 3D 工位",
    sub: "扫码 → 超声焊接 → SQL结果 → MES",
    pass: "PASS 产品",
    ng: "NG 产品",
    migrate: "迁移 NG 箱 → 维修",
    source: "SQL Server 实时结果",
    next: "下一工位：成品老化",
  },
  "en-US": {
    title: "Supersonic Welding 3D Station",
    sub: "Scan → weld → SQL result → MES",
    pass: "PASS PRODUCTS",
    ng: "NG PRODUCTS",
    migrate: "MIGRATE NG BOX → MAINTENANCE",
    source: "SQL Server live results",
    next: "Next: Finished-product aging",
  },
  "vi-VN": {
    title: "Trạm hàn siêu âm 3D",
    sub: "Quét → hàn → kết quả SQL → MES",
    pass: "SẢN PHẨM PASS",
    ng: "SẢN PHẨM NG",
    migrate: "CHUYỂN HỘP NG → BẢO TRÌ",
    source: "Kết quả SQL Server trực tiếp",
    next: "Tiếp theo: Lão hóa thành phẩm",
  },
} as const;

function Welder({ active, ng }: { active: boolean; ng: boolean }) {
  const horn = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (horn.current)
      horn.current.position.y = active
        ? 1.35 + Math.sin(clock.elapsedTime * 28) * 0.035
        : 2.15;
  });
  return (
    <group position={[0, -0.5, 0]}>
      <RoundedBox args={[8.8, 1.1, 6.2]} radius={0.22} position={[0, -1.05, 0]}>
        <meshStandardMaterial color="#16263b" metalness={0.65} />
      </RoundedBox>
      <RoundedBox
        args={[7.4, 0.35, 4.7]}
        radius={0.16}
        position={[0, -0.28, 0]}
      >
        <meshStandardMaterial color="#334155" metalness={0.75} />
      </RoundedBox>
      <RoundedBox args={[3.8, 0.5, 2.4]} radius={0.18} position={[0, 0.08, 0]}>
        <meshStandardMaterial
          color={ng ? "#7f1d1d" : "#075985"}
          emissive={ng ? "#ef4444" : "#0e7490"}
          emissiveIntensity={0.45}
        />
      </RoundedBox>
      <group ref={horn}>
        <mesh>
          <cylinderGeometry args={[0.65, 0.28, 2.7, 32]} />
          <meshStandardMaterial
            color="#d1d5db"
            metalness={0.9}
            roughness={0.18}
          />
        </mesh>
        <RoundedBox
          args={[2.6, 0.34, 0.75]}
          radius={0.12}
          position={[0, -1.45, 0]}
        >
          <meshStandardMaterial color="#fbbf24" metalness={0.8} />
        </RoundedBox>
      </group>
      <RoundedBox
        args={[7.8, 3.7, 0.7]}
        radius={0.16}
        position={[0, 1.55, -2.8]}
      >
        <meshStandardMaterial color="#1e293b" metalness={0.55} />
      </RoundedBox>
      <Text position={[0, 2.1, -2.38]} fontSize={0.42} color="#67e8f9">
        SUPERSONIC · MANU_SUPERSONIC
      </Text>
    </group>
  );
}

export function SupersonicStationMonitor({ locale }: { locale: Locale }) {
  const words = COPY[locale] || COPY["en-US"];
  const [pass, setPass] = useState<Row[]>([]),
    [ng, setNg] = useState<Row[]>([]),
    [processRows, setProcessRows] = useState<Row[]>([]),
    [online, setOnline] = useState(false),
    [status, setStatus] = useState(""),
    [alarmNg, setAlarmNg] = useState<Row | null>(null);
  const lastAlarmKey = useRef("");
  const refresh = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([
        fetch("/api/station/bucket-snapshots").then((r) => r.json()),
        fetch("/api/pda/heartbeats").then((r) => r.json()),
      ]);
      const all: Snapshot[] = Array.isArray(s)
        ? s
        : (s.items ?? s.snapshots ?? []);
      const own = all.filter((x) => x.stationCode === "manu_supersonic");
      const rows = (name: string) =>
        own.find((x) => x.bucketName === name)?.payload ?? [];
      setPass(rows("pass"));
      setNg(rows("confirmed_ng"));
      setProcessRows(rows("process"));
      const now = Number(h.serverTime || Date.now());
      setOnline(
        (h.heartbeats || []).some(
          (x: Row) =>
            x.stationCode === "manu_supersonic" &&
            x.online !== false &&
            now - Number(x.receivedAt || 0) < 45000,
        ),
      );
    } catch {
      setOnline(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (!ng.length) {
      setAlarmNg(null);
      return;
    }
    const latest = [...ng].sort(
      (a, b) =>
        Number(b.firstDetectedAt || b.time || 0) -
        Number(a.firstDetectedAt || a.time || 0),
    )[0];
    setAlarmNg(latest);
    const key = `${String(latest.sn || latest.pcbSerial || "")}:${String(latest.firstDetectedAt || latest.time || "")}`;
    if (key && key !== lastAlarmKey.current) {
      lastAlarmKey.current = key;
      new Audio("/audio/supersonic-ng.wav").play().catch(() => void 0);
    }
  }, [ng]);
  async function migrate() {
    if (!ng.length) return;
    setStatus(`Migrating ${ng.length} NG…`);
    try {
      for (const row of ng) {
        const sn = String(row.sn || row.pcbSerial || "").toUpperCase();
        if (!sn) continue;
        const token = localStorage.getItem("token");
        const response = await fetch("/api/station/maintenance-handovers", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            sourceStation: "manu_supersonic",
            sourceStationName: "Supersonic",
            ngSn: sn,
            batchId: String(row.batchId || sn),
            members: [row],
            product: row,
            confirmedBy: "SUPERSONIC_OPERATOR_PANEL",
            confirmedRole: "OPERATOR",
            submittedBy: "SUPERSONIC_OPERATOR_PANEL",
            firstDetectedAt: Number(
              row.firstDetectedAt || row.time || Date.now(),
            ),
          }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.message || `HTTP ${response.status}`);
        }
      }
      setStatus("MES maintenance WO created");
      new Audio("/audio/ng-migrated-maintenance.wav")
        .play()
        .catch(() => void 0);
      await refresh();
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Migration failed");
    }
  }
  const active = processRows.some(
    (row) =>
      String(row.stage || "").includes("TEST") ||
      String(row.stage || "").includes("WELD"),
  );
  return (
    <div
      style={{
        position: "relative",
        height: 760,
        overflow: "hidden",
        borderRadius: 16,
        background: "#07111f",
        color: "#e2e8f0",
      }}
    >
      <Canvas shadows camera={{ position: [9, 7, 10], fov: 42 }}>
        <ambientLight intensity={0.55} />
        <directionalLight position={[8, 12, 7]} intensity={2.8} castShadow />
        <Welder active={active} ng={ng.length > 0} />
        <OrbitControls makeDefault target={[0, 0.2, 0]} />
        <Environment preset="warehouse" />
      </Canvas>
      <div style={{ position: "absolute", left: 20, top: 18 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>{words.title}</h1>
        <div style={{ color: "#7dd3fc", fontSize: 12 }}>{words.sub}</div>
      </div>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 18,
          transform: "translateX(-50%)",
          width: 410,
        }}
      >
        <StationScannerControl
          stationCode="manu_supersonic"
          locale={locale}
          compact
        />
      </div>
      <div
        style={{
          position: "absolute",
          right: 20,
          top: 18,
          color: online ? "#22c55e" : "#ef4444",
          fontWeight: 900,
        }}
      >
        ● {online ? "ONLINE" : "OFFLINE"}
      </div>
      <div
        style={{
          position: "absolute",
          left: 20,
          top: 100,
          width: 245,
          display: "grid",
          gap: 10,
        }}
      >
        <button
          onClick={() => void 0}
          style={{
            padding: 14,
            textAlign: "left",
            background: "#052e2b",
            color: "#86efac",
            border: "1px solid #22c55e",
            borderRadius: 10,
            fontWeight: 900,
          }}
        >
          {words.pass}
          <strong style={{ display: "block", fontSize: 26 }}>
            {pass.length}
          </strong>
        </button>
        <button
          onClick={() => void 0}
          style={{
            padding: 14,
            textAlign: "left",
            background: "#450a0a",
            color: "#fecaca",
            border: "1px solid #ef4444",
            borderRadius: 10,
            fontWeight: 900,
          }}
        >
          {words.ng}
          <strong style={{ display: "block", fontSize: 26 }}>
            {ng.length}
          </strong>
        </button>
        <button
          disabled={!ng.length}
          onClick={() => void migrate()}
          style={{
            padding: 13,
            background: "#9a3412",
            color: "white",
            border: "2px solid #f97316",
            borderRadius: 10,
            fontWeight: 900,
            cursor: "pointer",
          }}
        >
          {words.migrate}
        </button>
        <div style={{ fontSize: 10, color: "#fbbf24" }}>{status}</div>
      </div>
      <div
        style={{
          position: "absolute",
          right: 20,
          bottom: 20,
          padding: 12,
          background: "#071525dd",
          border: "1px solid #334155",
          borderRadius: 10,
          fontSize: 11,
        }}
      >
        {words.source}
        <br />
        {words.next}
      </div>
      {alarmNg && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: 20,
            transform: "translateX(-50%)",
            minWidth: 440,
            padding: "13px 20px",
            background: "#991b1bef",
            border: "3px solid #ef4444",
            borderRadius: 12,
            color: "white",
            textAlign: "center",
            fontWeight: 900,
            boxShadow: "0 0 28px #ef444488",
          }}
        >
          SQL SERVER NG ALARM
          <div style={{ fontFamily: "monospace", fontSize: 20 }}>
            {String(alarmNg.sn || alarmNg.pcbSerial || "")}
          </div>
          <div style={{ fontSize: 11, color: "#fecaca" }}>
            {String(alarmNg.sourceTable || "dbo.Upload_data")}
          </div>
        </div>
      )}
    </div>
  );
}
