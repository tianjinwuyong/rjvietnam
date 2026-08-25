import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Html, OrbitControls, RoundedBox, Text } from "@react-three/drei";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Group, Mesh } from "three";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { StationScannerControl } from "./StationScannerControl";

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
  slots: Array.from({ length: 12 }, (_, index) => ({ slot: index + 1, sn: "", result: "EMPTY" })),
  updatedAt: 0,
};

const copy = {
  "zh-CN": {
    title: "ICT 三维工位代理",
    subtitle: "实时数字孪生 · 工位操作权与中央3D监控严格分离",
    online: "在线",
    offline: "离线",
    heartbeat: "心跳",
    current: "当前母板",
    pending: "待复检 NG",
    confirmed: "确认不良",
    pass: "PASS",
    refresh: "刷新",
    source: "数据源",
    authority: "本页显示 MES 接收状态；工位控制仍由本机 ICT Agent 执行",
    noBatch: "等待 ICT CSV 母板数据",
  },
  "vi-VN": {
    title: "Tác nhân trạm ICT 3D",
    subtitle: "Bản sao số thời gian thực · Tách quyền trạm khỏi màn hình 3D trung tâm",
    online: "Trực tuyến",
    offline: "Ngoại tuyến",
    heartbeat: "Nhịp tim",
    current: "Bo mạch hiện tại",
    pending: "NG chờ kiểm tra lại",
    confirmed: "NG đã xác nhận",
    pass: "PASS",
    refresh: "Làm mới",
    source: "Nguồn dữ liệu",
    authority: "Trang này hiển thị trạng thái MES; điều khiển ICT vẫn ở Agent cục bộ",
    noBatch: "Đang chờ dữ liệu bo mạch ICT CSV",
  },
  "en-US": {
    title: "ICT 3D Station Agent",
    subtitle: "Live digital twin · Station authority is separated from central 3D monitoring",
    online: "ONLINE",
    offline: "OFFLINE",
    heartbeat: "Heartbeat",
    current: "Current motherboard",
    pending: "Pending NG",
    confirmed: "Confirmed NG",
    pass: "PASS",
    refresh: "Refresh",
    source: "Data source",
    authority: "This view shows MES-accepted state; ICT control remains in the local station Agent",
    noBatch: "Waiting for ICT CSV motherboard data",
  },
} as const;

function recordsOf(snapshot: BucketSnapshot | undefined): Record<string, unknown>[] {
  const rows = snapshot?.payload ?? snapshot?.records ?? [];
  return Array.isArray(rows) ? rows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object")) : [];
}

function childrenOf(record: Record<string, unknown>): Record<string, unknown>[] {
  const candidates = [record.subBoards, record.members, record.boards];
  const rows = candidates.find(Array.isArray);
  return Array.isArray(rows) ? rows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object")) : [];
}

function makeSlots(pending: Record<string, unknown>[], confirmed: Record<string, unknown>[], passed: Record<string, unknown>[], slotCount = 12, independentTwoSided = false) {
  const source = confirmed[0] ?? pending[0];
  const batchChildren = source ? childrenOf(source) : [];
  const passRows = passed.flatMap((row) => childrenOf(row).length ? childrenOf(row) : [row]);
  const independentRows = [...pending, ...confirmed, ...passed].flatMap((row) => childrenOf(row).length ? childrenOf(row) : [row]);
  const merged = independentTwoSided ? independentRows : [...batchChildren, ...passRows];
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
    if (independentTwoSided && bySlotTime.has(slot) && rowTime < Number(bySlotTime.get(slot))) return;
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

function Motherboard({ slots, batchId, assemblyLayout = false }: { slots: BoardSlot[]; batchId: string; assemblyLayout?: boolean }) {
  const group = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (group.current) group.current.rotation.y = Math.sin(clock.elapsedTime * 0.35) * 0.035;
  });
  return (
    <group ref={group} rotation={[-0.16, 0, 0]}>
      <RoundedBox args={[6.9, 0.34, 4.8]} radius={0.16} smoothness={4} position={[0, -0.08, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#052e25" metalness={0.28} roughness={0.48} />
      </RoundedBox>
      <RoundedBox args={[6.72, 0.28, 4.62]} radius={0.13} smoothness={4} position={[0, 0.14, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#07835f" metalness={0.22} roughness={0.5} />
      </RoundedBox>
      <RoundedBox args={[6.45, 0.06, 4.35]} radius={0.08} smoothness={3} position={[0, 0.31, 0]} castShadow>
        <meshStandardMaterial color="#c58b16" metalness={0.82} roughness={0.26} />
      </RoundedBox>
      <Text position={[0, 0.36, 2.02]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.22} color="#ecfccb" anchorX="center">
        {batchId}
      </Text>
      {slots.map((board, index) => {
        const column = index % 4;
        const row = Math.floor(index / 4);
        const x = assemblyLayout ? (index < 8 ? -2.35 : 2.35) : -2.43 + column * 1.62;
        const z = assemblyLayout ? -2.05 + (index % 8) * 0.59 : -1.25 + row * 1.25;
        const color = board.result === "FAIL" ? "#ef4444" : board.result === "PASS" ? "#22c55e" : board.result === "TEST" ? "#22d3ee" : "#334155";
        return (
          <group key={board.slot} position={[x, 0.48, z]}>
            <RoundedBox args={assemblyLayout ? [1.55, 0.24, 0.46] : [1.28, 0.24, 0.88]} radius={0.08} smoothness={3} castShadow>
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={board.result === "FAIL" ? 0.6 : board.result === "TEST" ? 1.1 : 0.12} roughness={0.42} />
            </RoundedBox>
            <Text position={[0, 0.15, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.19} color="#ffffff" anchorX="center">
              {`${board.slot}${board.result === "FAIL" ? " NG" : ""}`}
            </Text>
            {board.sn && (
              <Html position={[0, 0.25, 0]} center distanceFactor={8} style={{ pointerEvents: "none" }}>
                <div className="ict3d-tooltip">#{board.slot} {board.sn}<br />{board.result}{board.defectCode ? ` · ${board.defectCode}` : ""}</div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

function AssemblyIndependentPositions({ slots }: { slots: BoardSlot[] }) {
  return <group>{slots.slice(0,16).map((unit,index)=>{
    const left=index<8;
    const position=index%8;
    const x=left?-2.35:2.35;
    const z=-2.08+position*0.595;
    const color=unit.result==="FAIL"?"#ef4444":unit.result==="PASS"?"#22c55e":unit.result==="TEST"?"#22d3ee":"#334155";
    const label=`${left?"L":"R"}${position+1}`;
    return <group key={label} position={[x,0.48,z]}>
      <RoundedBox args={[1.7,0.3,0.48]} radius={0.07} smoothness={3} castShadow>
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={unit.result==="FAIL"?0.7:unit.result==="TEST"?1.1:0.12} roughness={0.4}/>
      </RoundedBox>
      <Text position={[0,0.19,0]} rotation={[-Math.PI/2,0,0]} fontSize={0.16} color="#fff" anchorX="center">{label}{unit.result==="FAIL"?" NG":""}</Text>
      {unit.sn&&<Html position={[0,0.28,0]} center distanceFactor={8} style={{pointerEvents:"none"}}><div className="ict3d-tooltip">{label} · {unit.sn}<br/>{unit.result}{unit.defectCode?` · ${unit.defectCode}`:""}</div></Html>}
    </group>;
  })}</group>;
}

function SignalTower({ online, alarm }: { online: boolean; alarm: boolean }) {
  const alarmLamp = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (alarmLamp.current) alarmLamp.current.visible = !alarm || Math.floor(clock.elapsedTime * 5) % 2 === 0;
  });
  return (
    <group position={[4.25, 0.15, -1.5]}>
      <mesh position={[0, 1.4, 0]}><cylinderGeometry args={[0.09, 0.09, 2.7, 16]} /><meshStandardMaterial color="#64748b" metalness={0.8} /></mesh>
      <mesh ref={alarmLamp} position={[0, 2.95, 0]}><cylinderGeometry args={[0.28, 0.28, 0.42, 24]} /><meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={alarm ? 2.5 : 0.05} /></mesh>
      <mesh position={[0, 2.52, 0]}><cylinderGeometry args={[0.28, 0.28, 0.42, 24]} /><meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={online ? 0.08 : 1.6} /></mesh>
      <mesh position={[0, 2.09, 0]}><cylinderGeometry args={[0.28, 0.28, 0.42, 24]} /><meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={online ? 1.8 : 0.05} /></mesh>
    </group>
  );
}

function StationScene({ state, stationKind = "ICT", stationLabel = stationKind, stationCode = "manu_ict" }: { state: StationState; stationKind?: "ICT" | "FCT" | "DEPANEL" | "ASSEMBLY ATE"; stationLabel?: string; stationCode?: string }) {
  const alarm = state.stats.dup > 0;
  if (stationKind === "FCT") return (
    <>
      <color attach="background" args={["#06101d"]} />
      <fog attach="fog" args={["#06101d", 13, 30]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[8, 13, 9]} intensity={3.2} castShadow />
      <pointLight position={[-5, 5, 4]} intensity={42} color="#22d3ee" distance={16} />
      <group position={[0, -0.2, 0]}>
        {/* Tall enclosed FCT tester. */}
        <RoundedBox args={[10.2, 1.45, 7.5]} radius={0.2} smoothness={4} position={[0, -1.15, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#1b2b3d" metalness={0.7} roughness={0.35} />
        </RoundedBox>
        <RoundedBox args={[9.25, 5.5, 1.25]} radius={0.2} smoothness={4} position={[0, 1.65, -3.1]} castShadow>
          <meshStandardMaterial color="#d7e0e8" metalness={0.5} roughness={0.28} />
        </RoundedBox>
        {/* Dark safety test chamber and glass door. */}
        <RoundedBox args={[6.1, 3.55, 0.22]} radius={0.12} smoothness={4} position={[-0.65, 1.45, -2.42]}>
          <meshStandardMaterial color="#06131f" emissive="#083344" emissiveIntensity={0.42} metalness={0.35} roughness={0.18} />
        </RoundedBox>
        <RoundedBox args={[2.05, 1.45, 0.18]} radius={0.1} smoothness={4} position={[3.15, 2.15, -2.38]}>
          <meshStandardMaterial color="#082f49" emissive="#0891b2" emissiveIntensity={0.72} />
        </RoundedBox>
        <Text position={[3.15, 2.2, -2.25]} fontSize={0.25} color="#a5f3fc" anchorX="center">FCT CONTROL</Text>
        <Text position={[3.15, 1.83, -2.25]} fontSize={0.14} color="#67e8f9" anchorX="center">EXCEL · 12 CHANNELS</Text>
        {/* Sliding fixture tray with the tested motherboard. */}
        <RoundedBox args={[7.5, 0.36, 5.1]} radius={0.14} smoothness={4} position={[-0.65, 0.05, 0.15]} castShadow receiveShadow>
          <meshStandardMaterial color="#35465b" metalness={0.78} roughness={0.25} />
        </RoundedBox>
        <Motherboard slots={state.slots} batchId={state.batchId}/>
        {[-4.35, 4.35].map(x => <mesh key={x} position={[x, -1.98, 0]}><cylinderGeometry args={[0.16, 0.16, 0.4, 16]} /><meshStandardMaterial color="#111827" /></mesh>)}
        <SignalTower online={state.online} alarm={alarm} />
        <Text position={[0, 4.8, -2.55]} fontSize={0.5} color="#e2e8f0" anchorX="center">FCT · MANU_FCT</Text>
      </group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.05, 0]} receiveShadow><planeGeometry args={[42, 42]} /><meshStandardMaterial color="#06101d" roughness={0.92} /></mesh>
      <gridHelper args={[42, 42, "#155e75", "#17233a"]} position={[0, -2.03, 0]} />
      <OrbitControls makeDefault enablePan minDistance={8} maxDistance={23} maxPolarAngle={Math.PI / 2.05} target={[0, 0.5, -0.4]} />
      <Environment preset="warehouse" />
    </>
  );
  return (
    <>
      <color attach="background" args={["#07111f"]} />
      <fog attach="fog" args={["#07111f", 12, 28]} />
      <ambientLight intensity={0.48} />
      <directionalLight position={[8, 12, 8]} intensity={2.8} castShadow shadow-mapSize={[2048, 2048]} />
      <pointLight position={[-5, 5, 4]} intensity={46} color="#38bdf8" distance={15} />
      <pointLight position={[4, 3, -5]} intensity={34} color="#f59e0b" distance={12} />
      <group position={[0, -0.15, 0]}>
        {/* Deep steel station cabinet */}
        <RoundedBox args={[10.8, 1.65, 7.8]} radius={0.22} smoothness={4} position={[0, -1.08, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#111c2f" metalness={0.62} roughness={0.48} />
        </RoundedBox>
        <RoundedBox args={[10.1, 0.38, 7.1]} radius={0.18} smoothness={4} position={[0, -0.12, 0]} receiveShadow>
          <meshStandardMaterial color="#172033" metalness={0.45} roughness={0.75} />
        </RoundedBox>
        {/* Recessed fixture bed */}
        <RoundedBox args={[7.45, 0.3, 5.25]} radius={0.16} smoothness={4} position={[0, 0.08, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#26364f" metalness={0.72} roughness={0.34} />
        </RoundedBox>
        {stationKind === "ASSEMBLY ATE"
          ? <AssemblyIndependentPositions slots={state.slots}/>
          : <Motherboard slots={state.slots} batchId={state.batchId}/>} 
        {/* Conveyor rails create strong front-to-back perspective */}
        {[-3.9, 3.9].map((x) => (
          <group key={x} position={[x, 0.28, 0]}>
            <RoundedBox args={[0.34, 0.34, 7.35]} radius={0.1} smoothness={3} castShadow>
              <meshStandardMaterial color="#64748b" metalness={0.9} roughness={0.2} />
            </RoundedBox>
            {[-2.8, -1.4, 0, 1.4, 2.8].map((z) => (
              <mesh key={z} position={[0, 0.25, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
                <cylinderGeometry args={[0.23, 0.23, 0.48, 18]} />
                <meshStandardMaterial color="#94a3b8" metalness={0.85} roughness={0.25} />
              </mesh>
            ))}
          </group>
        ))}
        {/* Rear instrument enclosure */}
        <RoundedBox args={[8.8, 3.65, 0.75]} radius={0.16} smoothness={4} position={[0, 1.78, -3.45]} castShadow receiveShadow>
          <meshStandardMaterial color="#172033" metalness={0.55} roughness={0.42} />
        </RoundedBox>
        <RoundedBox args={[3.1, 1.42, 0.12]} radius={0.08} smoothness={3} position={[-1.6, 1.83, -3.02]}>
          <meshStandardMaterial color="#06121f" emissive="#082f49" emissiveIntensity={0.8} metalness={0.2} roughness={0.3} />
        </RoundedBox>
        <Text position={[-1.6, 1.83, -2.93]} fontSize={0.3} color="#7dd3fc" anchorX="center">{stationLabel} CONTROLLER</Text>
        <SignalTower online={state.online} alarm={alarm} />
        <Text position={[0, 3.95, -3.02]} fontSize={0.48} color="#e2e8f0" anchorX="center">{stationLabel} · {stationCode.toUpperCase()}</Text>
      </group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.05, 0]} receiveShadow>
        <planeGeometry args={[42, 42]} />
        <meshStandardMaterial color="#07111f" metalness={0.05} roughness={0.92} />
      </mesh>
      <gridHelper args={[42, 42, "#1e7494", "#17233a"]} position={[0, -2.03, 0]} />
      <OrbitControls makeDefault enablePan minDistance={8} maxDistance={22} maxPolarAngle={Math.PI / 2.05} target={[0, 0.1, -0.4]} />
      <Environment preset="warehouse" />
    </>
  );
}

function Metric({ label, value, tone, onClick }: { label: string; value: string | number; tone: string; onClick?: () => void }) {
  return <button type="button" className="ict3d-metric" onClick={onClick}><span>▣ {label}</span><strong style={{ color: tone }}>{value}</strong><small>点击查看明细</small></button>;
}

interface FlattenedBucketRow {
  batchId: string;
  slot: number;
  channel: string;
  sn: string;
  result: string;
  testCount: number;
  retestRemaining: number;
  defectCode: string;
  errorCode: string;
  testTime: string;
  testCycleId: string;
  eventType: string;
  time: unknown;
  firstDetectedAt?: unknown;
  firstFailureTime?: unknown;
  dispatchDeadlineAt?: unknown;
  repairDeadlineAt?: unknown;
  maintenanceStatus?: unknown;
  repairWorkOrderNo?: unknown;
  workOrderNo?: unknown;
  retestAuthorized?: unknown;
  state?: unknown;
  createdAt?: unknown;
  syncStatus?: unknown;
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

function motherboardLayouts(records: Record<string, unknown>[]) {
  const grouped = new Map<string, ReturnType<typeof flattenBucket>>();
  for (const row of flattenBucket(records)) {
    const list = grouped.get(row.batchId) ?? [];
    list.push(row);
    grouped.set(row.batchId, list);
  }
  return [...grouped.entries()].map(([batchId, rows]) => ({
    batchId,
    slots: Array.from({ length: 12 }, (_, index) => rows.find((row) => row.slot === index + 1) ?? {
      batchId, slot: index + 1, sn: "—", result: "EMPTY", testCount: 0,
      retestRemaining: 0, defectCode: "", time: "",
    }),
  }));
}

export function IctStationMonitor({ locale, stationCode = "manu_ict", stationKind = "ICT", stationLabel = stationKind }: { locale: Locale; stationCode?: "manu_ict" | "manu_aio" | "manu_fct" | "manu_depanel" | "manu_assem_ate" | "manu_hivolt_ate" | "manu_package_ate"; stationKind?: "ICT" | "FCT" | "DEPANEL" | "ASSEMBLY ATE"; stationLabel?: string }) {
  const stationNames: Record<Locale, Record<string, string>> = {
    "zh-CN": { ICT: "ICT测试", FCT: "FCT测试", DEPANEL: "PCBA分板", "ASSEMBLY ATE": "组装ATE", "HIGH-VOLTAGE ATE": "高压ATE", "PACKAGING ATE": "包装ATE", "AOI QUALITY": "AOI质量工位" },
    "en-US": { ICT: "ICT", FCT: "FCT", DEPANEL: "PCBA Depanel", "ASSEMBLY ATE": "Assembly ATE", "HIGH-VOLTAGE ATE": "High-Voltage ATE", "PACKAGING ATE": "Packaging ATE", "AOI QUALITY": "AOI Quality" },
    "vi-VN": { ICT: "ICT", FCT: "FCT", DEPANEL: "Tách bo PCBA", "ASSEMBLY ATE": "ATE lắp ráp", "HIGH-VOLTAGE ATE": "ATE cao áp", "PACKAGING ATE": "ATE đóng gói", "AOI QUALITY": "Kiểm tra AOI" },
  };
  const localizedStationLabel = stationNames[locale]?.[stationLabel] ?? stationLabel;
  const [displayLocale, setDisplayLocale] = useState<Locale>(locale);
  const language = copy[displayLocale] ? displayLocale : "en-US";
  const text = copy[language];
  const [state, setState] = useState<StationState>(EMPTY_STATE);
  const [error, setError] = useState("");
  const [selectedSlot, setSelectedSlot] = useState<BoardSlot | null>(null);
  const [simulationSlots, setSimulationSlots] = useState<BoardSlot[] | null>(null);
  const [simulationBatch, setSimulationBatch] = useState("");
  const [detailBox, setDetailBox] = useState<{ title: string; records: Record<string, unknown>[] } | null>(null);
  const [selectedNgSns, setSelectedNgSns] = useState<Set<string>>(new Set());
  const [confirmedBy, setConfirmedBy] = useState("");
  const [confirmedRole, setConfirmedRole] = useState<"OPERATOR" | "QC">("OPERATOR");
  const [migrationStatus, setMigrationStatus] = useState("");
  const [testingPositions, setTestingPositions] = useState<Set<string>>(new Set());
  const [positionCommandStatus, setPositionCommandStatus] = useState("");
  const [activeAteTab, setActiveAteTab] = useState("LIVE");
  const batchAtSimulationStart = useRef("");
  const simulationResultBatch = useRef("");
  const latestBatchRef = useRef(state.batchId);
  latestBatchRef.current = state.batchId;


  const requestPositionTest = useCallback(async (side: "L" | "R") => {
    setTestingPositions(current => new Set(current).add(side));
    setPositionCommandStatus(`${side === "L" ? "LEFT 8" : "RIGHT 8"} · requesting test…`);
    try {
      const response=await fetch("/api/station/assembly-ate/test-position",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({side,operator:"3D_STATION_OPERATOR"}),
        ...(localStorage.getItem("token")?{headers:{"Content-Type":"application/json",Authorization:`Bearer ${localStorage.getItem("token")}`}}:{})});
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.message||`HTTP ${response.status}`);
      const generated=Array.isArray(body.results)?body.results:[];
      setSimulationBatch(String(body.runId||`TEST-${Date.now()}`));
      setSimulationSlots(current=>{
        const next=current?.length===16?[...current]:Array.from({length:16},(_,index)=>({slot:index+1,sn:"",result:"EMPTY" as const}));
        for(const row of generated){
          const match=/^([LR])([1-8])$/.exec(String(row.channel||"").toUpperCase());
          if(!match)continue;
          const slot=Number(match[2])+(match[1]==="R"?8:0);
          next[slot-1]={slot,sn:String(row.sn||""),result:String(row.result||"").toUpperCase()==="FAIL"?"FAIL":"PASS",
            defectCode:String(row.errorCode||""),testCount:1};
        }
        return next;
      });
      setTestingPositions(current=>{const next=new Set(current);next.delete(side);return next;});
      setPositionCommandStatus(`${side === "L" ? "LEFT 8" : "RIGHT 8"} · 8 results · ${new Date(body.testTime||Date.now()).toLocaleTimeString()}`);
    }catch(reason){
      setTestingPositions(current=>{const next=new Set(current);next.delete(side);return next;});
      setPositionCommandStatus(`${side} · ${reason instanceof Error?reason.message:"request failed"}`);
    }
  },[]);

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
      const ict = snapshots.filter((item) => item.stationCode === stationCode);
      const bucket = (name: BucketName) => ict.find((item) => item.bucketName === name);
      const realAssemblyExcelRow = (row: Record<string, unknown>) =>
        stationCode !== "manu_assem_ate" || String(row.eventType || "") === "assembly_ate_xlsx";
      const pending = recordsOf(bucket("pending_ng")).filter(realAssemblyExcelRow);
      const confirmed = recordsOf(bucket("confirmed_ng")).filter(realAssemblyExcelRow);
      const passed = recordsOf(bucket("pass")).filter(realAssemblyExcelRow);
      const statsRow = recordsOf(bucket("stats"))[0] ?? {};
      const heartbeat = (heartbeatBody.heartbeats ?? []).find((item: Record<string, unknown>) => item.stationCode === stationCode);
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
          total: stationCode === "manu_assem_ate" ? passed.length + pending.length + confirmed.length : Number(statsRow.total ?? passed.length + pending.length + confirmed.length),
          pass: stationCode === "manu_assem_ate" ? passed.length : Number(statsRow.pass ?? passed.length),
          fail: stationCode === "manu_assem_ate" ? pending.length + confirmed.length : Number(statsRow.fail ?? pending.length + confirmed.length),
          dup: Number(statsRow.dup ?? 0),
        },
        batchId,
        slots: makeSlots(pending, confirmed, passed, stationKind === "ASSEMBLY ATE" ? 16 : 12, stationKind === "ASSEMBLY ATE"),
        updatedAt: Date.now(),
      });
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Unable to load ${stationKind} state`);
      setState((current) => ({ ...current, online: false }));
    }
  }, [stationCode, stationKind]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 3_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const changeLanguage = (event: Event) => {
      const requested = (event as CustomEvent<{ locale?: Locale }>).detail?.locale;
      if (requested && copy[requested]) setDisplayLocale(requested);
    };
    window.addEventListener("station-language", changeLanguage);
    return () => window.removeEventListener("station-language", changeLanguage);
  }, []);

  useEffect(() => {
    let interval = 0;
    const startSimulation = (event: Event) => {
      window.clearInterval(interval);
      const slotCount = stationKind === "ASSEMBLY ATE" ? 16 : 12;
      batchAtSimulationStart.current = latestBatchRef.current;
      simulationResultBatch.current = "";
      const stamp = new Date();
      const batch = `SIM-${stamp.toTimeString().slice(0, 8).replaceAll(":", "")}`;
      const failSlots = new Set(
        ((event as CustomEvent<{ failSlots?: number[] }>).detail?.failSlots ?? [])
          .map(Number)
          .filter((slot) => slot >= 1 && slot <= slotCount)
      );
      setSimulationBatch(batch);
      setSimulationSlots(Array.from({ length: slotCount }, (_, index) => ({ slot: index + 1, sn: "", result: "EMPTY" })));
      let completed = 0;
      interval = window.setInterval(() => {
        completed += 1;
        setSimulationSlots((current) => (current ?? []).map((slot) => slot.slot <= completed
          ? { ...slot, sn: `SIM-${String(slot.slot).padStart(2, "0")}`, result: "TEST" }
          : slot));
        if (completed >= slotCount) {
          window.clearInterval(interval);
          setSimulationSlots((current) => (current ?? []).map((slot) => ({
            ...slot,
            result: failSlots.has(slot.slot) ? "FAIL" : "PASS",
            defectCode: failSlots.has(slot.slot) ? "ICT_SIM_NG" : "",
          })));
        }
      }, 260);
    };
    window.addEventListener("ict-simulation-start", startSimulation);
    window.addEventListener("assembly-ate-simulation-start", startSimulation);
    return () => {
      window.removeEventListener("ict-simulation-start", startSimulation);
      window.removeEventListener("assembly-ate-simulation-start", startSimulation);
      window.clearInterval(interval);
    };
  }, [refresh, stationKind]);

  useEffect(() => {
    if (!simulationSlots || state.batchId === "WAITING") return;
    // The first new batch is the authoritative result of this simulation.
    // Keep the latched red/green visual while its 12 CSV files arrive.
    if (!simulationResultBatch.current && state.batchId !== batchAtSimulationStart.current) {
      simulationResultBatch.current = state.batchId;
      return;
    }
    // Clear only when a later, different CSV batch is detected.
    if (simulationResultBatch.current && state.batchId !== simulationResultBatch.current) {
      setSimulationSlots(null);
      setSimulationBatch("");
      batchAtSimulationStart.current = "";
      simulationResultBatch.current = "";
    }
  }, [state.batchId, simulationSlots]);

  const yieldRate = useMemo(() => state.stats.total ? `${((state.stats.pass / state.stats.total) * 100).toFixed(1)}%` : "—", [state.stats]);
  const sceneState = simulationSlots ? { ...state, slots: simulationSlots, batchId: simulationBatch } : state;

  const migrateAssemblyNgToMaintenance = useCallback(async (recordsOverride?: ReturnType<typeof flattenBucket>, identityOverride?: string) => {
    const identity = String(identityOverride || confirmedBy).trim();
    if (!identity || (!recordsOverride?.length && selectedNgSns.size === 0)) {
      setMigrationStatus("Select NG products and enter operator/QC identity");
      return;
    }
    const records = recordsOverride?.length ? recordsOverride : flattenBucket(state.confirmed).filter((row) => selectedNgSns.has(String(row.sn || "").toUpperCase()));
    setMigrationStatus("MES is creating maintenance work order(s)…");
    try {
      const workOrders: string[] = [];
      for (const record of records) {
        const sn = String(record.sn || "").trim().toUpperCase();
        const batchId = String(record.batchId || sn);
        const response = await fetch("/api/station/maintenance-handovers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceStation: stationCode,
            sourceStationName: "组装ATE",
            ngSn: sn,
            batchId,
            product: record,
            members: [record],
            confirmedBy: identity,
            confirmedRole,
            submittedBy: identity,
            submittedRole: confirmedRole,
            clickedAt: Date.now(),
            firstDetectedAt: Number(record.firstDetectedAt || record.firstFailureTime || record.time || Date.now()),
            dispatchDeadlineAt: Number(record.dispatchDeadlineAt || 0) || undefined,
            repairDeadlineAt: Number(record.repairDeadlineAt || 0) || undefined,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(`${sn}: ${result.message || `HTTP ${response.status}`}`);
        workOrders.push(String(result.repairWorkOrderNo || ""));
      }
      setMigrationStatus(`MES migrated ${records.length} NG product(s) · WO ${workOrders.filter(Boolean).join(", ")}`);
      setSelectedNgSns(new Set());
      setDetailBox(null);
      await refresh();
    } catch (reason) {
      setMigrationStatus(reason instanceof Error ? reason.message : String(reason));
    }
  }, [confirmedBy, confirmedRole, refresh, selectedNgSns, state.confirmed, stationCode]);

  const migrateDepanelNgToMaintenance = useCallback(async () => {
    const records=flattenBucket(state.confirmed);
    if(!records.length){setMigrationStatus("No confirmed Depanel NG products.");return;}
    setMigrationStatus(`Migrating ${records.length} Depanel NG product(s) and generating MES maintenance WO(s)…`);
    try{
      const workOrders:string[]=[];
      for(const record of records){
        const sn=String(record.sn||"").trim().toUpperCase();
        if(!sn)continue;
        const batchId=String(record.batchId||sn);
        const defectCode=String(record.defectCode||"").trim().toUpperCase();
        const response=await fetch("/api/station/maintenance-handovers",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
          sourceStation:"manu_depanel",sourceStationName:"Depanel",ngSn:sn,batchId,defectCode,defectType:defectCode,
          product:record,members:[record],confirmedBy:"DEPANEL_OPERATOR_PANEL",confirmedRole:"OPERATOR",
          submittedBy:"DEPANEL_OPERATOR_PANEL",submittedRole:"OPERATOR",clickedAt:Date.now(),
          firstDetectedAt:Number(record.firstDetectedAt||record.firstFailureTime||record.time||Date.now()),
          dispatchDeadlineAt:Number(record.dispatchDeadlineAt||0)||undefined,repairDeadlineAt:Number(record.repairDeadlineAt||0)||undefined,
        })});
        const result=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(`${sn}: ${result.message||`HTTP ${response.status}`}`);
        workOrders.push(String(result.repairWorkOrderNo||""));
      }
      setMigrationStatus(`Depanel NG box migrated · WO ${workOrders.filter(Boolean).join(", ")}`);
      setDetailBox(null);await refresh();
    }catch(reason){setMigrationStatus(reason instanceof Error?reason.message:"Depanel migration failed");await refresh();}
  },[refresh,state.confirmed]);

  const ateAllRows = stationKind === "ASSEMBLY ATE" ? flattenBucket([...state.passed, ...state.pending, ...state.confirmed]) : [];
  const ateTabRows = activeAteTab === "PASS" ? ateAllRows.filter(row => String(row.result || "").toUpperCase() === "PASS")
    : activeAteTab === "NG" || activeAteTab === "NG RECORDS" ? ateAllRows.filter(row => ["FAIL", "NG", "CONFIRMED_NG"].includes(String(row.result || "").toUpperCase()))
    : activeAteTab === "REPAIR RETURN" ? ateAllRows.filter(row => row.maintenanceStatus || row.repairWorkOrderNo || row.workOrderNo || row.retestAuthorized)
    : ateAllRows;

  return (
    <div className="ict3d-root">
      <style>{`
        .ict3d-root{position:relative;min-height:calc(100vh - 190px);height:760px;overflow:hidden;border:1px solid #26364f;border-radius:16px;background:#07111f;color:#e2e8f0;font-family:Inter,system-ui,sans-serif;box-shadow:0 24px 70px #02061788}
        .ict3d-canvas{position:absolute;inset:0}
        .ict3d-head{position:absolute;z-index:5;left:20px;right:20px;top:18px;display:flex;justify-content:space-between;align-items:flex-start;pointer-events:none}
        .ict3d-head h1{font-size:24px;margin:0 0 5px;letter-spacing:.02em}.ict3d-head p{margin:0;color:#8fa4bf;font-size:12px}
        .ict3d-status{display:flex;align-items:center;gap:9px;padding:8px 13px;border-radius:999px;background:#081424dc;border:1px solid #334155;font-size:12px;font-weight:800}.ict3d-dot{width:9px;height:9px;border-radius:50%;box-shadow:0 0 14px currentColor}
        .ict3d-box-title{position:absolute;z-index:6;left:20px;top:82px;padding:4px 9px;border-radius:6px 6px 0 0;background:#0e7490;color:white;font-size:11px;font-weight:900;letter-spacing:.05em}
        .ict3d-metrics{position:absolute;z-index:5;left:20px;top:105px;display:grid;grid-template-columns:minmax(210px,1fr);gap:10px;width:min(260px,calc(100% - 40px))}
        .ict3d-metric{appearance:none;text-align:left;color:#e2e8f0;background:#071525f2;border:2px solid #263850;border-radius:5px 5px 12px 12px;padding:11px 12px;backdrop-filter:blur(12px);cursor:pointer;box-shadow:inset 0 4px 0 #334155,0 8px 22px #02061788}.ict3d-metric:hover{border-color:#38bdf8;transform:translateY(-2px)}.ict3d-metric span{display:block;color:#cbd5e1;font-size:11px;font-weight:800}.ict3d-metric strong{display:block;font-size:24px;margin-top:3px}.ict3d-metric small{display:block;margin-top:3px;color:#64748b;font-size:9px}
        .ate-maintenance-migrate{border:2px solid #f97316;border-radius:10px;background:#9a3412;color:#fff7ed;padding:12px;font-size:11px;font-weight:950;cursor:pointer;box-shadow:0 0 20px #f9731644}.ate-maintenance-migrate:hover{background:#c2410c;border-color:#fdba74}.ate-maintenance-migrate:disabled{opacity:.45;cursor:not-allowed}
        .ict3d-panel{position:absolute;z-index:6;right:20px;top:92px;width:250px;background:#071525e8;border:1px solid #263850;border-radius:12px;padding:14px;backdrop-filter:blur(12px)}
        .ict3d-panel h3{font-size:12px;margin:0 0 10px;color:#7dd3fc}.ict3d-row{display:flex;justify-content:space-between;gap:12px;border-top:1px solid #1d2b3f;padding:8px 0;font-size:11px}.ict3d-row span:first-child{color:#7f95b1}.ict3d-row strong{font-family:ui-monospace,monospace;text-align:right;word-break:break-all}
        .ict3d-footer{position:absolute;z-index:7;left:20px;right:20px;bottom:18px;display:flex;gap:10px;align-items:center}.ict3d-note{flex:1;padding:10px 12px;border:1px solid #1e7494;border-radius:9px;background:#082033dc;color:#bae6fd;font-size:11px}.ict3d-button{border:1px solid #38bdf8;background:#0c4a6e;color:white;border-radius:9px;padding:10px 16px;font-weight:800;cursor:pointer}.ict3d-button:hover{background:#075985}
        .ict3d-tooltip{white-space:nowrap;background:#020617e8;border:1px solid #475569;color:#e2e8f0;border-radius:6px;padding:5px 7px;font:10px ui-monospace,monospace;transform:translateY(-15px)}
        .ict3d-error{position:absolute;z-index:8;left:50%;top:48%;transform:translate(-50%,-50%);padding:10px 15px;border:1px solid #ef4444;border-radius:8px;background:#450a0add;color:#fecaca;font-size:12px}
        .ate-position-controls{position:absolute;z-index:9;left:50%;top:88px;transform:translateX(-50%);display:grid;grid-template-columns:repeat(2,180px);gap:8px 18px;padding:12px;border:1px solid #334155;border-radius:12px;background:#071525e8;backdrop-filter:blur(10px)}.ate-position-button{height:42px;border:1px solid #0e7490;border-radius:8px;background:#0c4a6e;color:#e0f2fe;font:900 12px ui-monospace,monospace;cursor:pointer}.ate-position-button:hover{background:#0369a1;border-color:#67e8f9}.ate-position-button.testing{background:#a16207;border-color:#facc15;color:#fff}.ate-position-status{grid-column:1/-1;text-align:center;color:#fbbf24;font-size:10px;min-height:13px}
        .ate3d-tabs{position:absolute;z-index:14;left:275px;right:285px;top:174px;display:flex;gap:4px;overflow-x:auto;padding:5px;border:1px solid #334155;border-radius:9px;background:#071525ee}.ate3d-tab{white-space:nowrap;border:1px solid #334155;border-radius:6px;background:#102038;color:#94a3b8;padding:7px 10px;font-size:9px;font-weight:900;cursor:pointer}.ate3d-tab.active{background:#0e7490;border-color:#67e8f9;color:white}.ate3d-data-panel{position:absolute;z-index:13;left:275px;right:285px;top:218px;bottom:60px;display:flex;flex-direction:column;overflow:hidden;padding:12px;border:1px solid #38bdf8;border-radius:11px;background:#06111ff2;box-shadow:0 20px 70px #000}.ate3d-data-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;color:#7dd3fc}.ate3d-data-head h3{margin:0;font-size:15px}.ate3d-json{max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#94a3b8}
        .ict3d-modal-shade{position:absolute;z-index:20;inset:62px 12px 48px;background:#020617b8;display:flex;align-items:flex-start;justify-content:center;padding:12px;overflow:hidden}.ict3d-modal{box-sizing:border-box;width:min(1100px,96%);height:100%;max-height:100%;display:flex;flex-direction:column;overflow:hidden;background:#081424;border:1px solid #38bdf8;border-radius:14px;box-shadow:0 28px 90px #000;padding:16px}.ict3d-modal-head{flex:0 0 auto;display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.ict3d-modal-head h2{margin:0;color:#7dd3fc;font-size:18px}.ict3d-close{border:1px solid #475569;background:#172033;color:white;border-radius:7px;padding:6px 11px;cursor:pointer}.ict3d-table-wrap{min-height:0;flex:1 1 auto;overflow:auto}.ict3d-table{width:100%;border-collapse:collapse;font-size:11px}.ict3d-table th{position:sticky;top:0;z-index:2;background:#102038;color:#93c5fd;text-align:left;padding:8px;border-bottom:1px solid #334155}.ict3d-table td{padding:7px 8px;border-bottom:1px solid #1e293b;font-family:ui-monospace,monospace}.ict3d-pass{color:#4ade80}.ict3d-fail{color:#f87171;font-weight:800}.ict3d-empty{padding:40px;text-align:center;color:#64748b}
        .ict3d-layout-scroll{min-height:0;flex:1 1 auto;overflow:auto;padding-right:5px}.ict3d-layout-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:12px}.ict3d-board-card{background:#0b1b2d;border:1px solid #334155;border-radius:10px;padding:11px;box-shadow:inset 0 0 0 2px #07111f}.ict3d-board-id{display:flex;justify-content:space-between;margin-bottom:8px;color:#7dd3fc;font:700 11px ui-monospace,monospace}.ict3d-slot-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.ict3d-slot{min-width:0;border:1px solid #475569;border-radius:6px;padding:6px;background:#1e293b;color:#94a3b8}.ict3d-slot.pass{background:#064e3b;border-color:#22c55e;color:#dcfce7}.ict3d-slot.fail{background:#7f1d1d;border-color:#ef4444;color:#fee2e2;box-shadow:0 0 10px #ef444466}.ict3d-slot-top{display:flex;justify-content:space-between;font-size:10px;font-weight:900}.ict3d-slot-sn{margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font:9px ui-monospace,monospace}.ict3d-slot-meta{margin-top:3px;color:#cbd5e1;font-size:8px}
        @media(max-width:1000px){.ict3d-panel{display:none}.ict3d-metrics{grid-template-columns:repeat(3,1fr)}.ict3d-root{height:680px}}
      `}</style>
      <div className="ict3d-canvas"><Canvas shadows camera={{ position: [8.8, 7.1, 10.2], fov: 43 }}><StationScene state={sceneState} stationKind={stationKind} stationLabel={localizedStationLabel} stationCode={stationCode} /></Canvas></div>
      <div style={{position:"absolute",zIndex:12,left:"50%",top:18,transform:"translateX(-50%)",width:390}}><StationScannerControl stationCode={stationCode} locale={displayLocale} compact /></div>
      <header className="ict3d-head">
        <div><h1>{localizedStationLabel} 3D</h1><p>{locale === "zh-CN" ? (stationKind === "FCT" ? "Excel实时测试 · MES同步数字孪生" : stationKind === "DEPANEL" ? "合并ICT与FCT结果 · MES同步数字孪生" : stationKind === "ASSEMBLY ATE" ? "独立产品 · 接受设备报告中的任意SN与通道 · MES同步" : text.subtitle) : stationKind === "FCT" ? "Excel realtime test · MES synchronized digital twin" : stationKind === "DEPANEL" ? "Merged ICT+FCT identification · MES synchronized digital twin" : stationKind === "ASSEMBLY ATE" ? "Independent products · tester-defined SN and channels · MES synchronized" : text.subtitle}</p></div>
        <div style={{display:"flex",gap:8,pointerEvents:"auto"}}>
          <button className="ict3d-button" type="button" onClick={() => setDisplayLocale(displayLocale === "zh-CN" ? "en-US" : displayLocale === "en-US" ? "vi-VN" : "zh-CN")}>中文 / EN / VI</button>
          <div className="ict3d-status"><span className="ict3d-dot" style={{ color: state.online ? "#22c55e" : "#ef4444", background: state.online ? "#22c55e" : "#ef4444" }} />{state.online ? text.online : text.offline}</div>
        </div>
      </header>
      <div className="ict3d-box-title">产品箱 / PRODUCT BOXES · 点击箱子查看内容</div>
      {stationKind === "ASSEMBLY ATE" && <div className="ate-position-controls">
        <button type="button" className={`ate-position-button ${testingPositions.has("L")?"testing":""}`} onClick={()=>void requestPositionTest("L")}>{testingPositions.has("L")?"TESTING LEFT 8":"TEST LEFT 8"}</button>
        <button type="button" className={`ate-position-button ${testingPositions.has("R")?"testing":""}`} onClick={()=>void requestPositionTest("R")}>{testingPositions.has("R")?"TESTING RIGHT 8":"TEST RIGHT 8"}</button>
        <div className="ate-position-status">{positionCommandStatus||"Two test banks · sixteen independent product results"}</div>
      </div>}
      {stationKind === "ASSEMBLY ATE" && <div className="ate3d-tabs">{["LIVE","PASS","NG","SN RECORDS","NG RECORDS","REPAIR RETURN","RESIDENCE","RAW DATA","MES COMMS"].map(tab=><button type="button" key={tab} className={`ate3d-tab ${activeAteTab===tab?"active":""}`} onClick={()=>setActiveAteTab(tab)}>{tab}</button>)}</div>}
      {stationKind === "ASSEMBLY ATE" && activeAteTab !== "LIVE" && <section className="ate3d-data-panel">
        <div className="ate3d-data-head"><h3>{activeAteTab} · independent Assembly ATE products</h3><span>{activeAteTab === "MES COMMS" ? (state.online ? "MES ONLINE" : "MES OFFLINE") : `${ateTabRows.length} records`}</span></div>
        <div className="ict3d-table-wrap"><table className="ict3d-table"><thead><tr><th>Channel</th><th>SN</th><th>Result / State</th><th>Error</th><th>Test time</th><th>Cycle / WO</th><th>MES / Details</th></tr></thead><tbody>
          {activeAteTab === "MES COMMS" ? <tr><td>—</td><td>{stationCode}</td><td className={state.online?"ict3d-pass":"ict3d-fail"}>{state.online?"ONLINE":"OFFLINE"}</td><td>{error||"—"}</td><td>{state.lastHeartbeat?new Date(state.lastHeartbeat).toLocaleString():"—"}</td><td>AGENT_HEARTBEAT</td><td>PASS {state.stats.pass} · NG {state.stats.fail} · DUP {state.stats.dup}</td></tr> : ateTabRows.map((row,index)=>{
            const result=String(row.result||row.state||"").toUpperCase();const time=Number(row.time||row.firstDetectedAt||row.createdAt||0);const testTime=String(row.testTime||"");const age=time?Math.max(0,Math.floor((Date.now()-time)/1000)):0;
            const detail=activeAteTab==="RAW DATA"?JSON.stringify(row):activeAteTab==="RESIDENCE"?`${Math.floor(age/3600)}h ${Math.floor((age%3600)/60)}m ${age%60}s`:String(row.maintenanceStatus||row.syncStatus||row.eventType||"MES bucket");
            return <tr key={`${String(row.sn||index)}-${index}`}><td>{String(row.channel||row.slot||"—")}</td><td>{String(row.sn||"—")}</td><td className={result==="PASS"?"ict3d-pass":result.includes("NG")||result==="FAIL"?"ict3d-fail":""}>{result||"—"}</td><td>{String(row.errorCode||row.defectCode||"—")}</td><td>{testTime||(time?new Date(time).toLocaleString():"—")}</td><td>{String(row.testCycleId||row.repairWorkOrderNo||row.workOrderNo||row.batchId||"—")}</td><td><span className={activeAteTab==="RAW DATA"?"ate3d-json":""}>{detail}</span></td></tr>;
          })}
          {activeAteTab !== "MES COMMS" && ateTabRows.length===0 && <tr><td colSpan={7}><div className="ict3d-empty">No records</div></td></tr>}
        </tbody></table></div>
      </section>}
      <div className="ict3d-metrics">
        <Metric label={stationKind === "ASSEMBLY ATE" ? "PASS PRODUCTS" : "PASS 箱"} value={stationKind === "ASSEMBLY ATE" ? flattenBucket(state.passed).length : motherboardLayouts(state.passed).length} tone="#22d3ee" onClick={() => setDetailBox({ title: stationKind === "ASSEMBLY ATE" ? "PASS PRODUCTS" : "PASS 箱（PASS母板历史）", records: state.passed })} />
        {stationKind === "DEPANEL" ? <>
          {([['ICT NG','ICT_ONLY_NG','#f97316'],['FCT NG','FCT_ONLY_NG','#ef4444'],['ICT+FCT NG','ICT_FCT_NG','#a855f7']] as const).map(([label, code, tone]) => {
            const rows = [...state.pending, ...state.confirmed].filter(record => flattenBucket([record]).some(item => item.defectCode === code));
            return <Metric key={code} label={label} value={motherboardLayouts(rows).length} tone={tone} onClick={() => setDetailBox({ title: `${label}（合并母板布局）`, records: rows })} />;
          })}
        </> : <Metric label={stationKind === "ASSEMBLY ATE" ? "NG PRODUCTS" : "NG 箱"} value={stationKind === "ASSEMBLY ATE" ? flattenBucket(state.confirmed).length : motherboardLayouts(state.confirmed).length} tone="#f87171" onClick={() => setDetailBox({ title: stationKind === "ASSEMBLY ATE" ? "NG PRODUCTS" : "NG 箱（NG母板历史）", records: state.confirmed })} />}
        {stationKind === "ASSEMBLY ATE" && <button type="button" className="ate-maintenance-migrate" disabled={!flattenBucket(state.confirmed).length} onClick={()=>{
          const rows=flattenBucket(state.confirmed);
          setMigrationStatus(`Migrating complete NG box (${rows.length} products) and generating MES maintenance WO(s)…`);
          void migrateAssemblyNgToMaintenance(rows,"ATE_OPERATOR_PANEL");
        }}>MIGRATE NG BOX → MAINTENANCE</button>}
        {stationKind === "DEPANEL" && <button type="button" className="ate-maintenance-migrate" disabled={!flattenBucket(state.confirmed).length} onClick={()=>void migrateDepanelNgToMaintenance()}>MIGRATE ALL DEPANEL NG → MAINTENANCE</button>}
      </div>
      <aside className="ict3d-panel">
        <h3>{stationKind === "ASSEMBLY ATE" ? "CURRENT INDEPENDENT PRODUCT" : text.current}</h3>
        <div className="ict3d-row"><span>{stationKind === "ASSEMBLY ATE" ? "SN / TEST RUN" : "ID"}</span><strong>{state.batchId === "WAITING" ? (stationKind === "ASSEMBLY ATE" ? "Waiting for independent product Excel data" : stationKind === "FCT" ? "Waiting for FCT Excel motherboard data" : text.noBatch) : state.batchId}</strong></div>
        <div className="ict3d-row"><span>{text.heartbeat}</span><strong>{state.lastHeartbeat ? new Date(state.lastHeartbeat).toLocaleTimeString() : "—"}</strong></div>
        <div className="ict3d-row"><span>{text.source}</span><strong>{stationKind === "ASSEMBLY ATE" ? "D:\\ATS\\测试报表 · Excel · recursive" : stationKind === "FCT" ? "FCT Excel · 12 slots" : "D:\\SRC · CSV · 12 slots"}</strong></div>
        <div className="ict3d-row"><span>MES</span><strong>/api/station/bucket-snapshots</strong></div>
        <div className="ict3d-row"><span>Selected</span><strong>{selectedSlot ? `#${selectedSlot.slot} ${selectedSlot.sn}` : "Clicking is display-only"}</strong></div>
      </aside>
      {error && <div className="ict3d-error">MES: {error}</div>}
      {detailBox && (() => {
        const rows = flattenBucket(detailBox.records);
        const layouts = motherboardLayouts(detailBox.records);
        return <div className="ict3d-modal-shade" onClick={() => setDetailBox(null)}>
          <section className="ict3d-modal" onClick={(event) => event.stopPropagation()}>
            <div className="ict3d-modal-head"><h2>{detailBox.title} · {stationKind === "ASSEMBLY ATE" ? `${rows.length} independent products` : `${layouts.length} 块母板 / ${rows.length} 个子板`}</h2><button className="ict3d-close" type="button" onClick={() => setDetailBox(null)}>✕</button></div>
            {stationKind === "ASSEMBLY ATE" && detailBox.title.startsWith("NG") && rows.length > 0 && <div style={{display:"grid",gridTemplateColumns:"1fr 150px auto",gap:8,marginBottom:12}}>
              <input value={confirmedBy} onChange={(event) => setConfirmedBy(event.target.value)} placeholder="Operator/QC ID" style={{background:"#102038",border:"1px solid #475569",borderRadius:7,color:"white",padding:"8px"}} />
              <select value={confirmedRole} onChange={(event) => setConfirmedRole(event.target.value as "OPERATOR" | "QC")} style={{background:"#102038",border:"1px solid #475569",borderRadius:7,color:"white",padding:"8px"}}><option value="OPERATOR">Operator</option><option value="QC">QC</option></select>
              <button className="ict3d-button" type="button" onClick={() => void migrateAssemblyNgToMaintenance()}>Confirm → Maintenance WO</button>
              <div style={{gridColumn:"1 / -1",color:"#fbbf24",fontSize:11}}>{migrationStatus || "Select products below. MES keeps them in the NG box until confirmation."}</div>
            </div>}
            {rows.length === 0 ? <div className="ict3d-empty">No records</div> : stationKind === "ASSEMBLY ATE" ? <div className="ict3d-table-wrap"><table className="ict3d-table"><thead><tr><th>Position</th><th>Select</th><th>SN</th><th>Result</th><th>Defect</th><th>First NG / Test time</th><th>NG age</th><th>Repair deadline</th></tr></thead><tbody>{rows.map((row, index) => { const sn=String(row.sn||"").toUpperCase(); const detected=Number(row.firstDetectedAt||row.firstFailureTime||row.time||Date.now()); const ageSeconds=Math.max(0,Math.floor((Date.now()-detected)/1000)); const age=`${Math.floor(ageSeconds/3600)}h ${Math.floor((ageSeconds%3600)/60)}m ${ageSeconds%60}s`; const deadline=Number(row.repairDeadlineAt||detected+120*60*1000); const isNg=detailBox.title.startsWith("NG"); return <tr key={`${sn}-${index}`}><td>{String(row.channel||row.slot||"") || (index<8?`L${index+1}`:`R${index-7}`)}</td><td>{isNg?<input type="checkbox" checked={selectedNgSns.has(sn)} onChange={(event) => setSelectedNgSns((current) => { const next=new Set(current); if(event.target.checked) next.add(sn); else next.delete(sn); return next; })} />:"—"}</td><td>{sn}</td><td className={String(row.result||"").toUpperCase()==="PASS"?"ict3d-pass":"ict3d-fail"}>{String(row.result||"NG")}</td><td>{String(row.defectCode||row.errorCode||"")}</td><td>{new Date(detected).toLocaleString()}</td><td className={isNg&&Date.now()>deadline?"ict3d-fail":""}>{isNg?age:"—"}</td><td>{isNg?new Date(deadline).toLocaleString():"—"}</td></tr>;})}</tbody></table></div> : <div className="ict3d-layout-scroll"><div className="ict3d-layout-grid">
              {layouts.map((layout) => <article className="ict3d-board-card" key={layout.batchId}>
                <div className="ict3d-board-id"><span>母板 {layout.batchId}</span><span>12 SLOTS</span></div>
                <div className="ict3d-slot-grid">{layout.slots.map((slot) => {
                  const bad = slot.result === "FAIL" || slot.result === "NG";
                  const good = slot.result === "PASS";
                  return <div key={slot.slot} className={`ict3d-slot ${bad ? "fail" : good ? "pass" : ""}`} title={`${slot.sn} · ${slot.result} · ${slot.defectCode || "No defect"}`}>
                    <div className="ict3d-slot-top"><span>#{slot.slot}</span><span>{slot.result}</span></div>
                    <div className="ict3d-slot-sn">{slot.sn}</div>
                    <div className="ict3d-slot-meta">测试 {slot.testCount} · 剩余 {slot.retestRemaining}</div>
                  </div>;
                })}</div>
              </article>)}
            </div></div>}
          </section>
        </div>;
      })()}
      <footer className="ict3d-footer">
        <div className="ict3d-note">{stationKind === "FCT" ? "MES synchronized display; production control remains in the local FCT Agent" : text.authority}</div>
        <button className="ict3d-button" type="button" onClick={() => void refresh()}>{text.refresh}</button>
      </footer>
      <div aria-hidden style={{ display: "none" }}>{state.slots.map((slot) => <button key={slot.slot} onClick={() => setSelectedSlot(slot)}>{slot.sn}</button>)}</div>
    </div>
  );
}
