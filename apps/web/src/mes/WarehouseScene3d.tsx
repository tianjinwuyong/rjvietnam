import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, Html, OrbitControls, Text } from "@react-three/drei";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { apiClient } from "../api/client";
import { PLANT_ANCHORS, PLANT_AREAS, PLANT_BOUNDS } from "./factory-layout";
import { WarehouseQrImage, WarehouseQrTag, warehouseAreaQrValue } from "./WarehouseQrTag";

const BAY = 2.5, DEPTH = 1.29, HEIGHT = 2.85;
const LEVELS = [0.4, 1.55] as const;
const BLUE = "#0057b8", RED = "#d82020";
type Zone = "A" | "B" | "C" | "D";
type RackRow = { zone: Zone; z: number; segments: number[]; startX: number };
type Bin = { code: string; shelfCode: string; cellNumber: string; zone: Zone; level: number; position: number };
type Cell = {
  shelfCode: string; cellNumber: string; status: "empty" | "occupied" | "reserved" | "fault";
  lightColor: number | null; lightAt: string | null; updatedAt: string;
  labelId: string | null; lotNo: string | null; qty: number | null;
  materialCode: string | null; materialName: string | null;
  iqcStatus: string | null; inspectionDate: string | null; acceptanceDate: string | null; expiryDate: string | null;
  inspectorName: string | null; inspectionResult: string | null; workOrderCode: string | null;
  acceptedBy: string | null;
  supplierCode: string | null; supplierName: string | null;
};
type Task = {
  taskNo: string; taskType: string; sourceShelf: string | null; sourceCell: string | null;
  targetShelf: string | null; targetCell: string | null; labelId: string | null; status: string;
  assignedRole: string; createdBy: string; createdAt: string;
};
type Command = { commandId: string; action: string; taskNo: string | null; status: string; requestedBy: string; reason: string; createdAt: string };
type TwinSummary = {
  generatedAt: string;
  totals: { lotCount: number; materialCount: number; totalQty: number };
  iqc: Record<string, { count: number; qty: number }>;
  expiring: number; expired: number; lowStock: number; activeTasks: number;
  utilization: number; cells: { occupied: number; total: number };
  alerts: Array<{ type: string; materialCode: string; lotNo: string; qty: number; detail: string; expiryDate: string | null }>;
};
type FloorArea = {
  areaCode: string; areaQr: string; areaName: string; areaType: string; polygon: number[][];
  capacity: number; occupied: number; status: string; sourceLayout: string; updatedAt: string;
};
type FloorPlacement={id:number;materialLotId:number;materialQr:string|null;palletQr:string|null;areaCode:string;x:number;z:number;workOrderCode:string|null;lotNo:string;qty:number;materialCode:string;materialName:string;iqcStatus:string};
type ControlState = {
  stateVersion: string; generatedAt: string; actor: { username: string; roleKey: string };
  cells: Cell[]; tasks: Task[]; commands: Command[]; floorAreas: FloorArea[]; floorPlacements:FloorPlacement[];
};
type PdaReceivingStatus = { phase: "DRAFT" | "SCANNED" | "RECEIVING" | "COMPLETED" | "FAILED"; lotNo?: string; materialCode?: string; materialName?: string; palletQr?: string; boxQr?: string; expectedQty?: string; receivedQty?: string; qty?: number; locationCode?: string; floorAreaCode?: string; iqcResult?: string; operator?: string; changedField?: string; at: string };
type Action = "ANDON" | "ANDON_CLEAR" | "LIGHT_ON" | "LIGHT_OFF" | "RESERVE" | "RELEASE" | "MOVE" | "COUNT";
type FocusPoint = [number, number, number];

const ROWS: RackRow[] = [
  { zone: "A", z: -6.2, segments: [7], startX: -12.5 },
  { zone: "B", z: -2.2, segments: [7, 2], startX: -12.5 },
  { zone: "C", z: -2.2 + DEPTH, segments: [7, 2], startX: -12.5 },
  { zone: "D", z: 4.0, segments: [2, 2, 2, 2], startX: -12.5 },
];
const RAW_WAREHOUSE = PLANT_AREAS.find(area => area.code === "RAW")!;
const RAW_CENTER: [number, number] = RAW_WAREHOUSE.center;
const OVERVIEW_TARGET: FocusPoint = [0, 1.1, -5];
const OVERVIEW_POSITION: FocusPoint = [45, 46, 52];
const SCENE_FLOOR = {
  width: PLANT_BOUNDS.width,
  depth: PLANT_BOUNDS.depth + RAW_WAREHOUSE.size[1],
  centerZ: -RAW_WAREHOUSE.size[1] / 2,
};
const STATUS_STYLE: Record<string, { color: string; label: string }> = {
  occupied: { color: "#22c55e", label: "正常有货" },
  empty: { color: "#94a3b8", label: "空库位" },
  reserved: { color: "#f59e0b", label: "已预留" },
  fault: { color: "#ef4444", label: "冻结/异常" },
};
const ACTION_ROLES: Record<Action, string[]> = {
  ANDON: ["warehouse", "iqc", "quality", "production_transport", "management", "admin"],
  ANDON_CLEAR: ["warehouse", "iqc", "quality", "management", "admin"],
  LIGHT_ON: ["warehouse", "iqc", "quality", "management", "admin"],
  LIGHT_OFF: ["warehouse", "iqc", "quality", "management", "admin"],
  RESERVE: ["warehouse", "management", "admin"],
  RELEASE: ["warehouse", "management", "admin"],
  MOVE: ["warehouse", "management", "admin"],
  COUNT: ["warehouse", "iqc", "quality", "management", "admin"],
};

function Brace({ x, z, reverse = false }: { x: number; z: number; reverse?: boolean }) {
  const length = Math.hypot(HEIGHT - 0.18, DEPTH);
  return <mesh position={[x, HEIGHT / 2, z + DEPTH / 2]} rotation={[Math.atan2(HEIGHT - 0.18, DEPTH) * (reverse ? -1 : 1), 0, 0]}>
    <boxGeometry args={[0.04, 0.02, length]} /><meshStandardMaterial color={BLUE} />
  </mesh>;
}

function PalletLoad({ cell, x, y, z, onFocus }: { cell?: Cell; x: number; y: number; z: number; onFocus?: () => void }) {
  const occupied = cell?.status === "occupied";
  const loadColor = cell?.iqcStatus === "released" ? "#16a34a" : cell?.iqcStatus === "hold" ? "#f59e0b" : "#2563eb";
  return <group onClick={onFocus ? (event) => { event.stopPropagation(); onFocus(); } : undefined}>
    {/* Wooden pallet is always visible, while material cartons only exist for occupied WMS slots. */}
    <mesh position={[x, y + 0.055, z]} castShadow receiveShadow>
      <boxGeometry args={[1.1, 0.11, 1.1]} />
      <meshStandardMaterial color="#a86f32" roughness={0.9} />
    </mesh>
    {[[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]].map(([dx, dz], index) =>
      <mesh key={`foot-${index}`} position={[x + dx, y - 0.01, z + dz]} castShadow>
        <boxGeometry args={[0.2, 0.12, 0.2]} /><meshStandardMaterial color="#815328" roughness={0.95} />
      </mesh>)}
    {occupied && <>
      {[0, 1].flatMap(layer => [0, 1].map(column =>
        <mesh key={`load-${layer}-${column}`} position={[x + (column ? 0.25 : -0.25), y + 0.25 + layer * 0.32, z]} castShadow>
          <boxGeometry args={[0.48, 0.3, 0.92]} />
          <meshStandardMaterial color={loadColor} roughness={0.68} />
        </mesh>))}
      <Billboard position={[x, y + 1.08, z]}>
        <mesh position={[0, 0, -0.012]}>
          <planeGeometry args={[1.42, 0.44]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.94} />
        </mesh>
        <Text position={[0, 0.09, 0]} fontSize={0.15} maxWidth={1.32} color="#07111f" anchorX="center">
          {cell?.labelId || "未绑定栈板码"}
        </Text>
        <Text position={[0, -0.1, 0]} fontSize={0.105} maxWidth={1.32} color="#0f2742" anchorX="center">
          {`${cell?.materialCode || "MATERIAL"} · ${cell?.qty ?? 0}`}
        </Text>
      </Billboard>
      {cell?.labelId && <WarehouseQrTag value={cell.labelId} position={[x + 0.48, y + 0.62, z + 0.48]} size={0.34} onClick={onFocus} />}
    </>}
  </group>;
}

function heatColor(ratio: number) {
  return ratio < 0.34 ? "#22c55e" : ratio < 0.67 ? "#f59e0b" : "#ef4444";
}

function RackSegment({ row, bayCount, bayOffset, positionOffset, cells, selected, select, heatmap, zoneRatio }: {
  row: RackRow; bayCount: number; bayOffset: number; positionOffset: number;
  cells: Map<string, Cell>; selected: string | null; select: (bin: Bin) => void;
  heatmap: boolean; zoneRatio: Record<string, number>;
}) {
  const x0 = row.startX + bayOffset * BAY;
  return <group>
    {Array.from({ length: bayCount + 1 }, (_, i) => x0 + i * BAY).flatMap(x => [0, DEPTH].map(dz =>
      <mesh key={`post-${x}-${dz}`} position={[x, HEIGHT / 2, row.z + dz]} castShadow>
        <boxGeometry args={[0.09, HEIGHT, 0.09]} /><meshStandardMaterial color={BLUE} metalness={0.25} roughness={0.55} />
      </mesh>))}
    {LEVELS.flatMap(y => [0, DEPTH].flatMap(dz => Array.from({ length: bayCount }, (_, bay) =>
      <mesh key={`beam-${y}-${dz}-${bay}`} position={[x0 + (bay + 0.5) * BAY, y, row.z + dz]} castShadow>
        <boxGeometry args={[BAY, 0.04, 0.12]} /><meshStandardMaterial color={RED} metalness={0.2} roughness={0.5} />
      </mesh>)))}
    {Array.from({ length: bayCount }, (_, bay) => LEVELS.flatMap((beamY, levelIndex) => [0, 1].map(half => {
      const position = (positionOffset + bay) * 2 + half + 1;
      const code = `${row.zone}${levelIndex + 1}-${position}`;
      const shelfCode = `RAW-${row.zone}`, cellNumber = `${levelIndex + 1}-${position}`;
      const cell = cells.get(`${shelfCode}:${cellNumber}`);
      const style = STATUS_STYLE[cell?.status ?? "empty"];
      const x = x0 + bay * BAY + (BAY - 2.2) / 2 + 0.55 + half * 1.1;
      const y = beamY + 0.02;
      const active = selected === code;
      return <group key={code}>
        <PalletLoad cell={cell} x={x} y={y} z={row.z + DEPTH / 2} onFocus={() => select({ code, shelfCode, cellNumber, zone: row.zone, level: levelIndex + 1, position })} />
        <mesh position={[x, y + 0.49, row.z + DEPTH / 2]} onClick={event => {
          event.stopPropagation(); select({ code, shelfCode, cellNumber, zone: row.zone, level: levelIndex + 1, position });
        }} castShadow>
          <boxGeometry args={[1.04, 0.76, 1.04]} />
          <meshStandardMaterial color={cell?.lightColor === 1 ? "#ef4444" : heatmap ? heatColor(zoneRatio[row.zone] ?? 0) : style.color} transparent opacity={heatmap ? 0.34 : (cell?.status === "empty" || !cell ? 0.08 : 0.16)}
            emissive={cell?.lightColor === 1 ? "#ef4444" : cell?.lightColor ? style.color : active ? "#38bdf8" : "#000"} emissiveIntensity={cell?.lightColor ? 1.4 : active ? 0.9 : 0} />
        </mesh>
        <Text position={[x, y + 0.92, row.z + DEPTH / 2 + 0.57]} fontSize={0.15} color="#172033">{code}</Text>
      </group>;
    })))}
    {Array.from({ length: bayCount }, (_, bay) => {
      const firstCellPosition = (positionOffset + bay) * 2 + 1;
      const shelfCode = `RAW-${row.zone}`;
      // The physical rack tag opens the same canonical location shown by the UI.
      // Never encode a bay range here: scanners and the details panel must agree byte-for-byte.
      const rackCode = `${shelfCode}:1-${firstCellPosition}`;
      return <WarehouseQrTag
        key={`rack-qr-${rackCode}`}
        value={rackCode}
        position={[x0 + (bay + 0.5) * BAY, HEIGHT - 0.28, row.z + DEPTH + 0.12]}
        size={0.42}
        onClick={() => select({ code: `${row.zone}1-${firstCellPosition}`, shelfCode: `RAW-${row.zone}`, cellNumber: `1-${firstCellPosition}`, zone: row.zone, level: 1, position: firstCellPosition })}
      />;
    })}
    <Brace x={x0} z={row.z} /><Brace x={x0 + bayCount * BAY} z={row.z} reverse />
  </group>;
}

const AREA_COLORS: Record<string, string> = {
  IQC_HOLD: "#f59e0b", RECEIVING: "#0ea5e9", QUARANTINE: "#ef4444",
  LINE_SIDE: "#8b5cf6", FLOOR_PALLET: "#16a34a",
};

function FloorStorageArea({ area, onFocus }: { area: FloorArea; onFocus: (area: FloorArea, point: FocusPoint) => void }) {
  const xs = area.polygon.map(point => point[0]), zs = area.polygon.map(point => point[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const width = maxX - minX, depth = maxZ - minZ, x = (minX + maxX) / 2, z = (minZ + maxZ) / 2;
  const color = AREA_COLORS[area.areaType] ?? "#64748b";
  return <group>
    <mesh position={[x, 0.015, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow onClick={(event) => { event.stopPropagation(); onFocus(area, [x, 0.6, z]); }}>
      <planeGeometry args={[width, depth]} />
      <meshStandardMaterial color={color} transparent opacity={0.48} />
    </mesh>
    <mesh position={[x, 0.025, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[Math.max(0.8, Math.min(width, depth) * .16), Math.max(0.92, Math.min(width, depth) * .20), 4]} />
      <meshBasicMaterial color={color} />
    </mesh>
    <Billboard position={[x, 1.55, minZ + 0.5]}>
      <mesh position={[0, 0, -0.02]}>
        <planeGeometry args={[Math.min(7.5, Math.max(4.2, width * 0.86)), 1.35]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.94} />
      </mesh>
      <Text position={[0, 0.17, 0]} fontSize={0.42} maxWidth={6.8} color="#07111f" anchorX="center" anchorY="middle">
        {area.areaName}
      </Text>
      <Text position={[0, -0.30, 0]} fontSize={0.28} maxWidth={6.8} color={color} anchorX="center" anchorY="middle">
        {`占用 ${area.occupied} / 容量 ${area.capacity}`}
      </Text>
    </Billboard>
    {Array.from({ length: Math.min(area.occupied, 8) }, (_, index) => {
      const columns = Math.max(1, Math.floor(width / 1.35));
      const px = minX + .8 + (index % columns) * 1.25;
      const pz = minZ + .85 + Math.floor(index / columns) * 1.3;
      return <PalletLoad key={`${area.areaCode}-${index}`} x={px} y={0.05} z={pz} onFocus={() => onFocus([px, 0.75, pz])} cell={{
        shelfCode: area.areaCode, cellNumber: String(index + 1), status: "occupied", lightColor: null,
        lightAt: null, updatedAt: area.updatedAt, labelId: null,
        lotNo: null, qty: 1, materialCode: area.areaType, materialName: area.areaName, iqcStatus: area.status,
        inspectionDate: null, acceptanceDate: null, expiryDate: null, inspectorName: null,
        inspectionResult: null, workOrderCode: null, acceptedBy: null, supplierCode: null, supplierName: null,
      }} />;
    })}
  </group>;
}

function FactoryLayout({ floorAreas }: { floorAreas: FloorArea[] }) {
  const hasLiveWmsOverlay = (area: (typeof PLANT_AREAS)[number]) => floorAreas.some(live => {
    const xs = live.polygon.map(point => point[0]);
    const zs = live.polygon.map(point => point[1]);
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const centerZ = (Math.min(...zs) + Math.max(...zs)) / 2;
    const width = Math.max(...xs) - Math.min(...xs);
    const depth = Math.max(...zs) - Math.min(...zs);
    return Math.abs(area.center[0] - centerX) < 0.15 && Math.abs(area.center[1] - centerZ) < 0.15
      && Math.abs(area.size[0] - width) < 0.15 && Math.abs(area.size[1] - depth) < 0.15;
  });
  return <group>
    <mesh position={[0, 1.8, SCENE_FLOOR.centerZ - SCENE_FLOOR.depth / 2]}><boxGeometry args={[PLANT_BOUNDS.width, 3.6, .12]} /><meshStandardMaterial color="#64748b" transparent opacity={.42} /></mesh>
    <mesh position={[-PLANT_BOUNDS.width / 2, 1.8, SCENE_FLOOR.centerZ]}><boxGeometry args={[.12, 3.6, SCENE_FLOOR.depth]} /><meshStandardMaterial color="#64748b" transparent opacity={.42} /></mesh>
    <mesh position={[PLANT_BOUNDS.width / 2, 1.8, SCENE_FLOOR.centerZ]}><boxGeometry args={[.12, 3.6, SCENE_FLOOR.depth]} /><meshStandardMaterial color="#64748b" transparent opacity={.42} /></mesh>
    <mesh position={[0, 1.8, PLANT_BOUNDS.depth / 2]}><boxGeometry args={[PLANT_BOUNDS.width, 3.6, .12]} /><meshStandardMaterial color="#64748b" transparent opacity={.42} /></mesh>
    {PLANT_AREAS.filter(area => !hasLiveWmsOverlay(area)).map(area => {
      const color = area.type === "production" ? "#38bdf8" : area.type === "warehouse" ? "#22c55e"
        : area.type === "quality" ? "#f59e0b" : area.type === "logistics" ? "#a78bfa" : "#94a3b8";
      return <group key={area.code}>
        <mesh position={[area.center[0], .012, area.center[1]]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={area.size} /><meshBasicMaterial color={color} transparent opacity={.13} />
        </mesh>
        <Text position={[area.center[0], .035, area.center[1]]} rotation={[-Math.PI / 2, 0, 0]}
          fontSize={.5} maxWidth={area.size[0] - .5} color="#0f2742">{area.name}</Text>
      </group>;
    })}
    {PLANT_ANCHORS.map(anchor =>
      <group key={anchor.code} position={[anchor.position[0], .08, anchor.position[1]]}>
        <mesh><boxGeometry args={[1.2, .14, .7]} /><meshStandardMaterial color={anchor.kind === "door" ? "#fde047" : "#64748b"} /></mesh>
        <Text position={[0, .18, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={.22} color="#172033">{anchor.name}</Text>
      </group>)}
  </group>;
}

function SmoothCameraFocus({ focus: _focus, overviewNonce: _overviewNonce }: { focus: FocusPoint | null; overviewNonce:number }) {
  const { camera } = useThree();
  const controls = useRef<any>(null);
  const lastReported = useRef(0);  useEffect(() => {
    if (!controls.current) return;
    if (_focus) {
      controls.current.target.set(_focus[0], _focus[1], _focus[2]);
      camera.position.set(_focus[0] + 4.4, _focus[1] + 3.5, _focus[2] + 5.4);
      controls.current.update();
    } else if (_overviewNonce > 0) {
      controls.current.target.set(OVERVIEW_TARGET[0], OVERVIEW_TARGET[1], OVERVIEW_TARGET[2]);
      camera.position.set(...OVERVIEW_POSITION);
      controls.current.update();
    }
  }, [_focus, _overviewNonce, camera]);
  useFrame(({ clock }) => {
    if (controls.current && clock.elapsedTime - lastReported.current > .25) {
      lastReported.current = clock.elapsedTime;
      const output = document.getElementById("warehouse-camera-telemetry");
      if (output) output.textContent = JSON.stringify({
        position: camera.position.toArray().map(value => Number(value.toFixed(4))),
        rotation: [camera.rotation.x, camera.rotation.y, camera.rotation.z].map(value => Number(value.toFixed(6))),
        target: controls.current.target.toArray().map((value: number) => Number(value.toFixed(4))),
        fov: "fov" in camera ? Number((camera as THREE.PerspectiveCamera).fov.toFixed(2)) : null,
      });
    }
  });
  return <OrbitControls ref={controls} makeDefault enableRotate enablePan enableZoom enableDamping dampingFactor={0.08} minDistance={2.4} maxDistance={100} maxPolarAngle={Math.PI / 2.05} />;
}

function binFocusPoint(bin: Bin): FocusPoint {
  const row = ROWS.find(item => item.zone === bin.zone) ?? ROWS[0];
  const globalBay = Math.floor((bin.position - 1) / 2);
  const half = (bin.position - 1) % 2;
  let used = 0;
  let localX = row.startX;
  row.segments.some((count, segmentIndex) => {
    if (globalBay < used + count) {
      const bayOffset = used + segmentIndex * 1.1;
      localX = row.startX + (bayOffset + globalBay - used) * BAY + 0.7 + half * 1.1;
      return true;
    }
    used += count;
    return false;
  });
  return [RAW_CENTER[0] + localX, bin.level === 1 ? 1.0 : 2.15, RAW_CENTER[1] + row.z + DEPTH / 2];
}

function Warehouse({ cells, floorAreas, floorPlacements, selected, select, focus, overviewNonce, onAreaFocus, onOverview, heatmap, zoneRatio }: { cells: Map<string, Cell>; floorAreas: FloorArea[]; floorPlacements:FloorPlacement[]; selected: string | null; select: (bin: Bin) => void; focus: FocusPoint | null; overviewNonce:number; onAreaFocus: (area: FloorArea, point: FocusPoint) => void; onOverview: () => void; heatmap: boolean; zoneRatio: Record<string, number>; }) {
  const segments = useMemo(() => ROWS.flatMap(row => {
    let used = 0;
    return row.segments.map((bayCount, segment) => {
      const value = { row, bayCount, bayOffset: used + segment * 1.1, positionOffset: used, key: `${row.zone}-${segment}` };
      used += bayCount; return value;
    });
  }), []);
  return <>
    <color attach="background" args={["#dfe8f1"]} /><ambientLight intensity={1.5} />
    <directionalLight position={[8, 16, 6]} intensity={2.2} castShadow />
    <mesh position={[0, -0.06, SCENE_FLOOR.centerZ]} receiveShadow><boxGeometry args={[SCENE_FLOOR.width, 0.12, SCENE_FLOOR.depth]} /><meshStandardMaterial color="#cfd6dd" roughness={0.95} /></mesh>
    <FactoryLayout floorAreas={floorAreas} />
    {floorAreas.map(area => <FloorStorageArea key={area.areaCode} area={area} onFocus={onAreaFocus} />)}
    {floorPlacements.map(item=><group key={item.id} position={[Number(item.x),.28,Number(item.z)]}>
      <mesh castShadow><boxGeometry args={[.9,.55,.72]}/><meshStandardMaterial color={item.iqcStatus==="released"?"#c58b42":"#ef4444"}/></mesh>
      <WarehouseQrTag value={item.materialQr||item.palletQr||item.lotNo} position={[0,.3,.37]} size={.34}/>
      <Billboard position={[0,.85,0]}><Text fontSize={.22} color="#172033">{item.materialCode}{"\n"}{item.qty}</Text></Billboard>
    </group>)}
    <group position={[RAW_CENTER[0], 0, RAW_CENTER[1]]}>
    {segments.map(({ key, ...segment }) =>
      <RackSegment key={key} {...segment} cells={cells} selected={selected} select={select} heatmap={heatmap} zoneRatio={zoneRatio} />)}
    {ROWS.map(row => <Text key={row.zone} position={[-15.3, 0.08, row.z + DEPTH / 2]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.72} color="#0f2742">{row.zone}区</Text>)}
    </group>
    <SmoothCameraFocus focus={focus} overviewNonce={overviewNonce}/>
  </>;
}

function commandId() {
  return `3D-${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

export function WarehouseScene3d() {
  const [state, setState] = useState<ControlState | null>(null);
  const [uiCollapsed, setUiCollapsed] = useState(false);
  const [selected, setSelected] = useState<Bin | null>(null);
  const [selectedArea, setSelectedArea] = useState<FloorArea | null>(null);
  const [focus, setFocus] = useState<FocusPoint | null>(null);
  const [overviewNonce,setOverviewNonce]=useState(0);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"detail" | "tasks" | "audit">("detail");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("现场仓库作业");
  const [connected, setConnected] = useState(false);
  const versionRef = useRef("");
  const [twin, setTwin] = useState<TwinSummary | null>(null);
  const [heatmap, setHeatmap] = useState(false);
  const [twinTab, setTwinTab] = useState<"kpi" | "alerts">("kpi");
  const [pdaReceiving, setPdaReceiving] = useState<PdaReceivingStatus | null>(null);


  const loadTwin = useCallback(async () => {
    try {
      const next = await apiClient.get<TwinSummary>("/api/3d/wms-twin-summary");
      setTwin(next);
    } catch (error) {
      console.error("[3D WMS] twin summary load failed", error);
    }
  }, []);
  useEffect(() => {
    void loadTwin();
    const timer = window.setInterval(() => void loadTwin(), 5_000);
    return () => window.clearInterval(timer);
  }, [loadTwin]);

  const load = useCallback(async () => {
    try {
      const next = await apiClient.get<ControlState>("/api/3d/wms-control-state");
      if (next.stateVersion !== versionRef.current) {
        versionRef.current = next.stateVersion;
        setState(next);
      }
      setConnected(true);
    } catch (error) {
      console.error("[3D WMS] live state load failed", error);
      setConnected(false);
      setMessage(error instanceof Error ? error.message : "WMS连接失败");
      try {
        const markerState=await apiClient.get<{floorAreas:FloorArea[]}>("/public/wms-area-markers");
        setState(current=>({stateVersion:current?.stateVersion??"markers-only",generatedAt:new Date().toISOString(),
          actor:current?.actor??{username:"—",roleKey:"viewer"},cells:current?.cells??[],tasks:current?.tasks??[],commands:current?.commands??[],
          floorAreas:markerState.floorAreas??[],floorPlacements:current?.floorPlacements??[]}));
      } catch (markerError) { console.error("[3D WMS] area marker load failed",markerError); }
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 2_000);
    return () => window.clearInterval(timer);
  }, [load]);
  const refreshWms = useCallback(() => { versionRef.current = ""; void load(); void loadTwin(); }, [load, loadTwin]);
  useEffect(() => {
    const apply = (value: unknown) => {
      try { const next = typeof value === "string" ? JSON.parse(value) : value; if (next?.at) { setPdaReceiving(next); setFocus([RAW_CENTER[0], 1.1, RAW_CENTER[1]]); refreshWms(); } } catch { /* stale local status */ }
    };
    try { apply(window.localStorage.getItem("wms:pda-receiving-status")); } catch { /* private mode */ }
    const onStatus = (event: Event) => apply((event as CustomEvent<PdaReceivingStatus>).detail);
    const onStorage = (event: StorageEvent) => { if (event.key === "wms:pda-receiving-status") apply(event.newValue); };
    const stream = new EventSource("/api/pda/events?node=wms_receiving_3d&replay=1&types=WMS_RECEIVING_PDA_ACTIVITY");
    stream.onmessage = (event) => { try { const item = JSON.parse(event.data); const payload = item.payload || item; if (payload.at) apply({ ...payload, at: new Date(Number(payload.at) || payload.at).toISOString() }); } catch { /* refresh loop remains active */ } };
    window.addEventListener("wms:pda-receiving-status", onStatus);
    window.addEventListener("storage", onStorage);
    return () => { window.removeEventListener("wms:pda-receiving-status", onStatus); window.removeEventListener("storage", onStorage); stream.close(); };
  }, [refreshWms]);

  const cells = useMemo(() => new Map((state?.cells ?? []).map(cell => [`${cell.shelfCode}:${cell.cellNumber}`, cell])), [state]);
  const selectedCell = selected ? cells.get(`${selected.shelfCode}:${selected.cellNumber}`) : undefined;
  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return [];
    return (state?.cells ?? []).filter(c => [c.shelfCode, c.cellNumber, c.labelId, c.lotNo, c.materialCode, c.materialName]
      .some(value => String(value ?? "").toUpperCase().includes(q))).slice(0, 8);
  }, [search, state]);
  const counts = useMemo(() => (state?.cells ?? []).reduce((acc, cell) => {
    acc[cell.status] = (acc[cell.status] ?? 0) + 1; return acc;
  }, {} as Record<string, number>), [state]);

  const zoneRatio = useMemo(() => {
    const byZone: Record<string, { occ: number; total: number }> = {};
    for (const cell of state?.cells ?? []) {
      const z = cell.shelfCode.replace("RAW-", "");
      byZone[z] ??= { occ: 0, total: 0 };
      byZone[z].total += 1;
      if (cell.status === "occupied") byZone[z].occ += 1;
    }
    return Object.fromEntries(Object.entries(byZone).map(([z, v]) => [z, v.total ? v.occ / v.total : 0]));
  }, [state]);
  const role = state?.actor.roleKey ?? "viewer";
  const can = (action: Action) => ACTION_ROLES[action].includes(role);

  const selectCellRecord = (cell: Cell) => {
    const zone = cell.shelfCode.replace("RAW-", "") as Zone;
    const match = cell.cellNumber.match(/^(\d+)-(\d+)$/);
    if (!match) return;
    const bin = { code: `${zone}${match[1]}-${match[2]}`, shelfCode: cell.shelfCode, cellNumber: cell.cellNumber, zone, level: Number(match[1]), position: Number(match[2]) } as Bin;
    setSelected(bin);
    setFocus(binFocusPoint(bin));
    setTab("detail");
  };
  const run = async (action: Action) => {
    if (!selected || !can(action)) return;
    setBusy(true); setMessage("");
    try {
      let targetShelf: string | undefined, targetCell: string | undefined, taskNo: string | undefined;
      if (action === "MOVE") {
        const match = target.trim().toUpperCase().match(/^([A-D])([12])-(\d+)$/);
        if (!match) throw new Error("目标库位格式应为 A1-1");
        targetShelf = `RAW-${match[1]}`; targetCell = `${match[2]}-${match[3]}`;
        taskNo = `MOVE-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
      } else if (action === "COUNT") taskNo = `COUNT-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
      await apiClient.post("/api/3d/wms-commands", {
        commandId: commandId(), action, taskNo,
        sourceShelf: selected.shelfCode, sourceCell: selected.cellNumber,
        targetShelf, targetCell, labelId: selectedCell?.labelId, reason,
      });
      versionRef.current = "";
      await load();
      setMessage(action === "MOVE" ? `移库任务 ${taskNo} 已创建并推送到PDA` : "操作完成，三端已同步");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally { setBusy(false); }
  };
  return <div style={{ position: "absolute", inset: 0, paddingTop: 48, background: "#dfe8f1", fontFamily: "'Microsoft YaHei', sans-serif" }}>
    <output id="warehouse-camera-telemetry" aria-label="仓库相机数据" style={{ position:"absolute", left:-10000, width:1, height:1, overflow:"hidden" }} />
    <Canvas shadows camera={{ position: OVERVIEW_POSITION, fov: 48 }}><Warehouse cells={cells} floorAreas={state?.floorAreas ?? []} floorPlacements={state?.floorPlacements??[]} selected={selected?.code ?? null} select={(bin) => { setSelected(bin); setSelectedArea(null); setFocus(binFocusPoint(bin)); }} focus={focus} overviewNonce={overviewNonce} onAreaFocus={(area, point) => { const isSameArea = selectedArea?.areaCode === area.areaCode; setSelected(null); setSelectedArea(isSameArea ? null : area); setFocus(isSameArea ? null : point); setTab("detail"); }} onOverview={() => { setSelected(null); setFocus(null); setOverviewNonce(n=>n+1); }} heatmap={heatmap} zoneRatio={zoneRatio} /></Canvas>

    {!uiCollapsed && <header style={{ position: "absolute", left: 16, right: 16, top: 58, display: "flex", alignItems: "center", gap: 10, padding: "10px 13px", borderRadius: 12, background: "rgba(7,17,31,.94)", color: "white", boxShadow: "0 8px 24px rgba(0,0,0,.22)" }}>
      <div style={{ minWidth: 205 }}><strong style={{ fontSize: 17 }}>原材料仓库 · 3D WMS</strong><div style={{ fontSize: 11, color: "#94a3b8" }}>统一Server · 统一账本 · 统一权限</div></div>
      <div style={{ display: "flex", gap: 6 }}>
        {Object.entries(STATUS_STYLE).map(([key, value]) => <span key={key} style={{ padding: "5px 8px", borderRadius: 8, background: "#15243a", fontSize: 11 }}><i style={{ display: "inline-block", width: 7, height: 7, borderRadius: 9, background: value.color, marginRight: 5 }} />{value.label} {counts[key] ?? 0}</span>)}
      </div>
      <button type="button" onClick={() => setHeatmap(v => !v)} style={{ padding: "7px 11px", borderRadius: 7, border: heatmap ? "1px solid #f59e0b" : "1px solid #475569", background: heatmap ? "#78350f" : "#0f2742", color: "white", fontWeight: 700 }}>🔥 {heatmap ? "热度图开" : "热度图"}</button>
      <button type="button" onClick={() => { setSelected(null); setSelectedArea(null); setFocus(null); setOverviewNonce(n=>n+1); }} style={{ padding: "7px 11px", borderRadius: 7, border: "1px solid #475569", background: "#0f2742", color: "white", fontWeight: 700 }}>总览</button>
      <div style={{ marginLeft: "auto", textAlign: "right", fontSize: 11 }}><div style={{ color: connected ? "#86efac" : "#fca5a5" }}>● {connected ? "实时同步" : "连接中断"}</div><div>{state?.actor.username ?? "—"} · {role}</div></div>
    </header>}

    {!uiCollapsed && pdaReceiving && <section data-testid="pda-receiving-live" style={{ position: "absolute", left: 320, top: 132, width: 280, borderRadius: 10, padding: 11, background: "rgba(7,17,31,.94)", color: "white", boxShadow: "0 8px 22px rgba(0,0,0,.22)", borderLeft: `4px solid ${pdaReceiving.phase === "FAILED" ? "#ef4444" : pdaReceiving.phase === "COMPLETED" ? "#22c55e" : "#f59e0b"}` }}>
      <div style={{ fontSize: 10, color: "#93c5fd", letterSpacing: ".08em", fontWeight: 800 }}>PDA RECEIVING · LIVE</div>
      <strong style={{ display: "block", marginTop: 4 }}>{pdaReceiving.phase} · {pdaReceiving.lotNo || "—"}</strong>
      <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 4 }}>{pdaReceiving.materialCode || "—"} · {pdaReceiving.qty ?? 0} pcs</div>
      <div style={{ fontSize: 11, color: "#7dd3fc", marginTop: 4 }}>WMS location: {pdaReceiving.locationCode || pdaReceiving.floorAreaCode || "pending assignment"}</div>
      <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>IQC {pdaReceiving.iqcResult || "pending"} · {new Date(pdaReceiving.at).toLocaleTimeString()}</div>
    </section>}

    {!uiCollapsed && <section data-testid="twin-dashboard" style={{ position: "absolute", left: 16, bottom: 18, width: 344, borderRadius: 12, background: "rgba(7,17,31,.95)", color: "white", boxShadow: "0 10px 30px rgba(0,0,0,.3)", overflow: "hidden" }}>
      <div style={{ display: "flex", background: "#0f2742" }}>
        {(["kpi", "alerts"] as const).map(key => <button key={key} data-testid={`twin-tab-${key}`} type="button" onClick={() => setTwinTab(key)} style={{ flex: 1, padding: "8px 10px", border: 0, borderBottom: twinTab === key ? "3px solid #f59e0b" : "3px solid transparent", background: "transparent", color: "white", fontWeight: 800, fontSize: 12 }}>{key === "kpi" ? "📊 数字孪生 KPI" : "🚨 实时告警"}</button>)}</div>
      <div style={{ padding: 11, maxHeight: 218, overflow: "auto" }}>
        {twinTab === "kpi" ? (twin ? <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 7 }}>
          {[
            ["库存总量", (twin.totals.totalQty ?? 0).toLocaleString(), "#38bdf8"],
            ["物料数", String(twin.totals.materialCount ?? 0), "#a78bfa"],
            ["库位利用率", `${twin.utilization ?? 0}%`, "#22d3ee"],
            ["IQC待检", String((twin.iqc?.hold?.count ?? 0) + (twin.iqc?.pending?.count ?? 0)), "#f59e0b"],
            ["不合格", String(twin.iqc?.rejected?.count ?? 0), "#f87171"],
            ["临期(90天)", String(twin.expiring ?? 0), "#fbbf24"],
            ["已过期", String(twin.expired ?? 0), "#ef4444"],
            ["低库存", String(twin.lowStock ?? 0), "#fb7185"],
            ["活跃任务", String(twin.activeTasks ?? 0), "#4ade80"],
          ].map(([label, value, color]) => <div key={String(label)} style={{ padding: "7px 5px", borderRadius: 8, background: "#15243a", textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: color as string }}>{value as string}</div>
            <div style={{ fontSize: 9.5, color: "#94a3b8", marginTop: 2 }}>{label as string}</div>
          </div>)}
        </div> : <div style={{ color: "#94a3b8", fontSize: 11, padding: 8 }}>正在读取数字孪生数据…</div>) : (
          (twin?.alerts?.length ? twin.alerts.map((a, index) => {
            const badge = a.type === "EXPIRED" ? ["已过期", "#ef4444"] : a.type === "EXPIRING" ? ["临期", "#fbbf24"] : a.type === "IQC_HOLD" ? ["待检/HOLD", "#f59e0b"] : ["不合格", "#f87171"];
            return <div key={`${a.type}-${index}`} style={{ display: "flex", gap: 8, padding: "6px 0", borderBottom: "1px solid #1e293b", fontSize: 11 }}>
              <span style={{ flex: "none", padding: "2px 6px", borderRadius: 5, background: badge[1], color: "#07111f", fontWeight: 900, fontSize: 9.5 }}>{badge[0]}</span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.materialCode}{a.lotNo ? ` · ${a.lotNo}` : ""}</span>
              <span style={{ marginLeft: "auto", color: "#cbd5e1", flex: "none" }}>{a.qty.toLocaleString()}</span>
            </div>;
          }) : <div style={{ color: "#94a3b8", fontSize: 11, padding: 8 }}>当前无告警 ✅</div>))}
      </div>
    </section>}

    {!uiCollapsed && <section style={{ position: "absolute", left: 16, top: 132, width: 290, borderRadius: 12, padding: 12, background: "rgba(255,255,255,.96)", boxShadow: "0 10px 28px rgba(0,0,0,.2)" }}>
      <div style={{ display: "flex", gap: 6 }}><input value={search} onChange={e => setSearch(e.target.value)} placeholder="物料/批次/托盘/库位" style={{ flex: 1, minWidth: 0, padding: "8px 9px", border: "1px solid #cbd5e1", borderRadius: 7 }} /><button onClick={() => filtered[0] && selectCellRecord(filtered[0])} style={primary}>定位</button></div>
      {filtered.map(cell => <button key={`${cell.shelfCode}:${cell.cellNumber}`} onClick={() => selectCellRecord(cell)} style={{ display: "block", width: "100%", textAlign: "left", marginTop: 5, padding: 7, border: 0, borderRadius: 7, background: "#eef3f8", color: "#172033" }}><strong>{cell.shelfCode.replace("RAW-", "")}{cell.cellNumber}</strong> · {cell.materialCode ?? "空库位"}<div style={{ fontSize: 10, color: "#64748b" }}>{cell.lotNo ?? "—"} · {cell.qty ?? 0}</div></button>)}
    </section>}

    {!uiCollapsed && <aside style={{ position: "absolute", right: 16, top: 132, bottom: 18, width: 330, borderRadius: 12, background: "rgba(255,255,255,.97)", color: "#172033", boxShadow: "0 10px 30px rgba(0,0,0,.22)", overflow: "hidden" }}>
      <div style={{ display: "flex", background: "#e8eef5" }}>{(["detail", "tasks", "audit"] as const).map(key => <button key={key} onClick={() => setTab(key)} style={{ flex: 1, padding: 10, border: 0, borderBottom: tab === key ? "3px solid #0284c7" : "3px solid transparent", background: "transparent", fontWeight: 700 }}>{key === "detail" ? "库位操作" : key === "tasks" ? "运输任务" : "操作审计"}</button>)}</div>
      <div style={{ padding: 14, overflow: "auto", height: "calc(100% - 46px)" }}>
        {tab === "detail" && <>{selected ? <>
          <h3 style={{ margin: "0 0 9px" }}>{selected.code} <small style={{ color: STATUS_STYLE[selectedCell?.status ?? "empty"].color }}>{selectedCell?.status === "occupied" ? "TAKEN（占用）" : selectedCell?.status === "empty" || !selectedCell ? "FREE（空闲）" : selectedCell.status === "reserved" ? "RESERVED（预留）" : "FAULT（异常）"}</small></h3>
          <WarehouseQrImage value={`${selected.shelfCode}:${selected.cellNumber}`} label="真实库位二维码 / Rack Location QR" />
          {selectedCell?.labelId
            ? <WarehouseQrImage value={selectedCell.labelId} label="真实物料二维码 / Material QR" />
            : selectedCell?.status === "occupied" && <div style={{ padding: 8, marginBottom: 8, borderRadius: 7, background: "#fef3c7", color: "#92400e", fontSize: 11 }}>该物料尚未绑定真实二维码</div>}
          <Detail label="物料" value={selectedCell?.materialCode} /><Detail label="名称" value={selectedCell?.materialName} />
          <Detail label="批次" value={selectedCell?.lotNo} /><Detail label="栈板号" value={selectedCell?.labelId ?? "未绑定栈板码"} />
          <Detail label="数量" value={selectedCell?.qty} /><Detail label="绑定工单" value={selectedCell?.workOrderCode} />
          <Detail label="供应商" value={selectedCell?.supplierName} /><Detail label="供应商编码" value={selectedCell?.supplierCode} />
          <Detail label="IQC状态" value={selectedCell?.inspectionResult ?? selectedCell?.iqcStatus} />
          <Detail label="检验员" value={selectedCell?.inspectorName} />
          <Detail label="检验日期" value={selectedCell?.inspectionDate ? new Date(selectedCell.inspectionDate).toLocaleDateString() : null} />
          <Detail label="验收日期" value={selectedCell?.acceptanceDate ? new Date(selectedCell.acceptanceDate).toLocaleString() : null} />
          <Detail label="验收人" value={selectedCell?.acceptedBy} />
          <Detail label="物料有效期" value={selectedCell?.expiryDate ? `${new Date(selectedCell.expiryDate).toLocaleDateString()} · ${new Date(selectedCell.expiryDate).getTime() >= Date.now() ? "VALID（有效）" : "EXPIRED（过期）"}` : null} />
          <Detail label="更新时间" value={selectedCell?.updatedAt ? new Date(selectedCell.updatedAt).toLocaleString() : null} />
          <label style={labelStyle}>操作原因<input value={reason} onChange={e => setReason(e.target.value)} style={inputStyle} /></label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginTop: 10 }}>
            {selectedCell?.lightColor !== 1
              ? <ActionButton disabled={busy || !can("ANDON")} onClick={() => void run("ANDON")}>🚨 发起 Andon</ActionButton>
              : <ActionButton disabled={busy || !can("ANDON_CLEAR")} onClick={() => void run("ANDON_CLEAR")}>✅ 解除 Andon</ActionButton>}
            <ActionButton disabled={busy || !can("LIGHT_ON")} onClick={() => void run("LIGHT_ON")}>💡 定位亮灯</ActionButton>
            <ActionButton disabled={busy || !can("LIGHT_OFF")} onClick={() => void run("LIGHT_OFF")}>关闭灯光</ActionButton>
            {selectedCell?.status === "empty" && <ActionButton disabled={busy || !can("RESERVE")} onClick={() => void run("RESERVE")}>预留库位</ActionButton>}
            {selectedCell?.status === "reserved" && <ActionButton disabled={busy || !can("RELEASE")} onClick={() => void run("RELEASE")}>释放预留</ActionButton>}
            <ActionButton disabled={busy || !can("COUNT")} onClick={() => void run("COUNT")}>创建盘点任务</ActionButton>
          </div>
          {selectedCell?.status === "occupied" && <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #dbe3ec" }}>
            <label style={labelStyle}>目标库位<input value={target} onChange={e => setTarget(e.target.value)} placeholder="例如 A1-2" style={inputStyle} /></label>
            <button disabled={busy || !can("MOVE")} onClick={() => void run("MOVE")} style={{ ...primary, width: "100%", marginTop: 8, opacity: busy || !can("MOVE") ? .45 : 1 }}>创建移库任务并推送PDA</button>
          </div>}
        </> : selectedArea ? <>
          <h3 style={{ margin: "0 0 9px" }}>{selectedArea.areaName}</h3>
          <div style={{ padding: 10, marginBottom: 10, borderRadius: 8, background: "#e0f2fe", color: "#0c4a6e", fontWeight: 800 }}>Floor storage area · click again to hide</div>
          <Detail label="Area code" value={selectedArea.areaCode} />
          <Detail label="Type" value={selectedArea.areaType} />
          <Detail label="Status" value={selectedArea.status} />
          <Detail label="Occupied" value={`${selectedArea.occupied} / ${selectedArea.capacity}`} />
          <Detail label="Location control" value="MES/WMS area code; no floor QR required" />
          <Detail label="Updated" value={selectedArea.updatedAt ? new Date(selectedArea.updatedAt).toLocaleString() : null} />
        </> : <Empty text="点击3D货架或地面区域开始操作" />}
        {message && <div style={{ marginTop: 10, padding: 8, borderRadius: 7, background: message.includes("失败") || message.includes("不能") ? "#fee2e2" : "#dcfce7", fontSize: 12 }}>{message}</div>}</>}
        {tab === "tasks" && <>{(state?.tasks ?? []).length ? (state?.tasks ?? []).map(t => <div key={t.taskNo} style={{ padding: "9px 0", borderBottom: "1px solid #e5eaf0" }}>
          <strong style={{ fontSize: 12 }}>{t.taskType} · {t.taskNo}</strong>
          <div style={{ fontSize: 11, marginTop: 3 }}>{t.sourceShelf ?? "—"}/{t.sourceCell ?? "—"} → {t.targetShelf ?? "—"}/{t.targetCell ?? "—"}</div>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 3 }}>{t.status} · {new Date(t.createdAt).toLocaleString()}</div>
          {["CREATED", "ACCEPTED"].includes(t.status) && <div style={{ marginTop: 6, color: "#64748b", fontSize: 10 }}>请在 WMS PDA 扫码接收并完成</div>}
        </div>) : <Empty text="暂无运输或盘点任务" />}{message && <div style={{ marginTop: 10, fontSize: 12 }}>{message}</div>}</>}
        {tab === "audit" && <List items={(state?.commands ?? []).map(c => ({ title: `${c.action} · ${c.status}`, line: c.reason, meta: `${c.requestedBy} · ${new Date(c.createdAt).toLocaleString()}` }))} />}
      </div>
    </aside>}
    <button type="button" onClick={() => setUiCollapsed(value => !value)} style={{
      position: "absolute", right: 16, bottom: 18, zIndex: 20, border: 0, borderRadius: 9,
      padding: "9px 13px", background: "rgba(7,17,31,.94)", color: "white", fontWeight: 700,
      boxShadow: "0 6px 18px rgba(0,0,0,.25)", cursor: "pointer",
    }}>{uiCollapsed ? "显示仓库界面" : "隐藏仓库界面"}</button>
  </div>;
}

const primary: React.CSSProperties = { padding: "8px 11px", border: 0, borderRadius: 7, background: "#0284c7", color: "white", fontWeight: 700, cursor: "pointer" };
const labelStyle: React.CSSProperties = { display: "block", marginTop: 8, fontSize: 11, color: "#64748b" };
const inputStyle: React.CSSProperties = { display: "block", width: "100%", boxSizing: "border-box", marginTop: 4, padding: 8, border: "1px solid #cbd5e1", borderRadius: 7 };
function Detail({ label, value }: { label: string; value: unknown }) { return <div style={{ display: "flex", padding: "5px 0", borderBottom: "1px solid #edf1f5", fontSize: 12 }}><span style={{ color: "#64748b", width: 78 }}>{label}</span><strong style={{ flex: 1, overflowWrap: "anywhere" }}>{value == null || value === "" ? "—" : String(value)}</strong></div>; }
function ActionButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) { return <button {...props} style={{ padding: 8, border: "1px solid #cbd5e1", borderRadius: 7, background: "#f8fafc", color: "#172033", fontWeight: 700, opacity: props.disabled ? .45 : 1 }}>{children}</button>; }
function Empty({ text }: { text: string }) { return <div style={{ padding: "40px 12px", textAlign: "center", color: "#64748b" }}>{text}</div>; }
function List({ items }: { items: Array<{ title: string; line: string; meta: string }> }) { return items.length ? <>{items.map((item, index) => <div key={`${item.title}-${index}`} style={{ padding: "9px 0", borderBottom: "1px solid #e5eaf0" }}><strong style={{ fontSize: 12 }}>{item.title}</strong><div style={{ fontSize: 11, marginTop: 3 }}>{item.line}</div><div style={{ fontSize: 10, color: "#64748b", marginTop: 3 }}>{item.meta}</div></div>)}</> : <Empty text="暂无记录" />; }
// @ts-nocheck
