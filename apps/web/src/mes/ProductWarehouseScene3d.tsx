import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Text } from "@react-three/drei";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { apiClient } from "../api/client";
import { WarehouseQrImage, WarehouseQrTag } from "./WarehouseQrTag";

const PALLET_W = 1.4;
const PALLET_D = 1.4;
const PALLET_H = 0.14;
const CARTON_W = 0.55;
const CARTON_D = 0.40;
const CARTON_H = 0.30;
const LEVEL_H  = 0.80;
const CELL_SPACING = 2.2;
const ROW_GAP    = 3.6;

const STATUS_COLOR: Record<string, string> = {
  AVAILABLE: "#22c55e",
  RESERVED:  "#f59e0b",
  HOLD:      "#ef4444",
  SHIPPED:   "#94a3b8",
  RETURNED:  "#a855f7",
  SCRAPPED:  "#1e293b",
};
const DEFAULT_COLOR = "#64748b";

function statusColor(s?: string) {
  return STATUS_COLOR[s ?? ""] ?? DEFAULT_COLOR;
}

type FinishedGoodItem = {
  id: number;
  serial_no: string;
  inventory_status: string;
  received_at: string;
  product_code: string;
  work_order_code: string;
  location_code: string;
  carton_code: string | null;
  pallet_code: string | null;
};

type FgInventoryResponse = { items: FinishedGoodItem[]; total: number };
type Wms3dSnapshot={metrics:Record<string,number>;finishedGoods:Array<{id:number;sn:string;status:string;productCode:string;workOrderCode:string;locationCode:string;cartonCode?:string;palletCode?:string}>};

function parseLocation(code: string) {
  const parts = code.split("-");
  if (parts.length >= 4) {
    return { zone: parts[1] ?? "??", row: parts[2] ?? "?", pos: parseInt(parts[3] ?? "0", 10) };
  }
  let hash = 0;
  for (const c of code) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return { zone: String.fromCharCode(65 + (hash % 4)), row: "?", pos: hash % 20 };
}

type LocationGroup = {
  locationCode: string;
  zone: string;
  row: string;
  pos: number;
  items: FinishedGoodItem[];
};

function groupPoint(group: LocationGroup): [number, number, number] {
  return [group.pos * CELL_SPACING - 12, 1.1, (group.row.charCodeAt(0) - 65) * ROW_GAP];
}

function SmoothCameraFocus({ selected }: { selected: LocationGroup | null }) {
  const { camera } = useThree();
  const controls = useRef<any>(null);
  const moving = useRef(false);
  const desiredPosition = useRef(new THREE.Vector3());
  const desiredTarget = useRef(new THREE.Vector3());
  useEffect(() => {
    const target = selected ? groupPoint(selected) : [0, 1.5, 4] as [number, number, number];
    desiredTarget.current.set(...target);
    desiredPosition.current.set(target[0] + (selected ? 4.2 : 2), target[1] + (selected ? 3.2 : 8.5), target[2] + (selected ? 5 : 14));
    moving.current = true;
  }, [selected]);
  useFrame(() => {
    if (!moving.current || !controls.current) return;
    camera.position.lerp(desiredPosition.current, 0.09);
    controls.current.target.lerp(desiredTarget.current, 0.11);
    controls.current.update();
    if (camera.position.distanceTo(desiredPosition.current) < 0.04 && controls.current.target.distanceTo(desiredTarget.current) < 0.04) moving.current = false;
  });
  return <OrbitControls ref={controls} makeDefault target={[0, 1.5, 4]} minDistance={2.4} maxDistance={55} maxPolarAngle={Math.PI / 2.05} />;
}

function PalletMesh({ group, onClick }: { group: LocationGroup; onClick: (g: LocationGroup) => void }) {
  const color = statusColor(group.items[0]?.inventory_status);
  const x = group.pos * CELL_SPACING - 12;
  const z = (group.row.charCodeAt(0) - 65) * ROW_GAP;
  const maxPerLayer = 4;
  const totalCartons = group.items.length;
  const layers = Math.ceil(totalCartons / maxPerLayer);

  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, PALLET_H / 2, 0]} castShadow receiveShadow
        onClick={(e) => { e.stopPropagation(); onClick(group); }}>
        <boxGeometry args={[PALLET_W, PALLET_H, PALLET_D]} />
        <meshStandardMaterial color="#b45309" roughness={0.9} />
      </mesh>
      {Array.from({ length: layers }, (_, layer) =>
        Array.from({ length: Math.min(maxPerLayer, totalCartons - layer * maxPerLayer) }, (_, slot) => {
          const itemIndex = layer * maxPerLayer + slot;
          const cartonCode = group.items[itemIndex]?.carton_code;
          const col = slot % 2;
          const row2 = Math.floor(slot / 2);
          const cx = (col - 0.5) * CARTON_W * 1.1;
          const cz = (row2 - 0.5) * CARTON_D * 1.1;
          const cy = PALLET_H + CARTON_H / 2 + layer * LEVEL_H;
          return (
            <group key={`c${layer}-${slot}`}>
              <mesh position={[cx, cy, cz]} castShadow onClick={(e) => { e.stopPropagation(); onClick(group); }}>
                <boxGeometry args={[CARTON_W, CARTON_H, CARTON_D]} />
                <meshStandardMaterial color={color} roughness={0.65} emissive={color} emissiveIntensity={0.15} />
              </mesh>
              {cartonCode && <WarehouseQrTag value={cartonCode} position={[cx, cy, cz + CARTON_D / 2 + 0.006]} size={0.17} onClick={() => onClick(group)} />}
            </group>
          );
        })
      )}
      <Text position={[0, PALLET_H + layers * LEVEL_H + 0.25, 0]} fontSize={0.18} color="#172033"
        anchorX="center" anchorY="bottom" rotation={[-Math.PI / 2, 0, 0]}>
        {group.locationCode}
      </Text>
      {group.items[0]?.pallet_code && <WarehouseQrTag value={group.items[0].pallet_code} position={[0.58, PALLET_H + Math.max(1, layers) * LEVEL_H * 0.55, 0.72]} size={0.46} onClick={() => onClick(group)} />}
    </group>
  );
}

function Warehouse({ groups, selected, onSelect }: { groups: LocationGroup[]; selected: LocationGroup | null; onSelect: (g: LocationGroup | null) => void }) {
  return (
    <>
      <color attach="background" args={["#0f172a"]} />
      <ambientLight intensity={1.2} />
      <directionalLight position={[12, 20, 8]} intensity={2.0} castShadow
        shadow-mapSize-width={2048} shadow-mapSize-height={2048}
        shadow-camera-far={120} shadow-camera-left={-30} shadow-camera-right={30}
        shadow-camera-top={30} shadow-camera-bottom={-30} />
      <hemisphereLight args={["#334155", "#0f172a"]} intensity={0.4} />
      <mesh position={[0, -0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[50, 20]} />
        <meshStandardMaterial color="#1e293b" roughness={0.95} />
      </mesh>
      {["A", "B", "C", "D"].map((zone, idx) => (
        <Text key={zone} position={[-14, 0.08, idx * ROW_GAP]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.9} color="#334155">
          {zone}
        </Text>
      ))}
      {groups.map((g) => (
        <PalletMesh key={g.locationCode} group={g} onClick={onSelect} />
      ))}
      <mesh position={[0, -0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} onClick={() => onSelect(null)}>
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial transparent opacity={0} />
      </mesh>
      <SmoothCameraFocus selected={selected} />
    </>
  );
}

export function ProductWarehouseScene3d() {
  const [groups, setGroups] = useState<LocationGroup[]>([]);
  const [selected, setSelected] = useState<LocationGroup | null>(null);
  const [selectedItem, setSelectedItem] = useState<FinishedGoodItem | null>(null);
  const [lineage, setLineage] = useState<any>(null);
  const [linkedMaterials, setLinkedMaterials] = useState<any[]>([]);
  const [detailStatus, setDetailStatus] = useState("");
  const [syncError, setSyncError] = useState("");
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [search,setSearch]=useState("");
  const [searchResults,setSearchResults]=useState<Wms3dSnapshot["finishedGoods"]>([]);
  const [metrics,setMetrics]=useState<Record<string,number>>({});
  const loadWmsDetail = useCallback(async (item: FinishedGoodItem) => {
    setSelectedItem(item);
    setDetailStatus("正在同步 WMS / MES 追溯…");
    const [lineageResult, materialResult] = await Promise.allSettled([
      fetch(`/api/mes/lineage/${encodeURIComponent(item.serial_no)}`).then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
        return body;
      }),
      apiClient.get<any>(`/wms/material-lots?q=${encodeURIComponent(item.work_order_code)}&limit=100`),
    ]);
    const lineageBody = lineageResult.status === "fulfilled" ? lineageResult.value : null;
    const materialBody = materialResult.status === "fulfilled" ? materialResult.value : null;
    setLineage(lineageBody);
    setLinkedMaterials(Array.isArray(materialBody?.items) ? materialBody.items : Array.isArray(materialBody?.data) ? materialBody.data : []);
    if (lineageBody?.provenanceComplete) setDetailStatus("WMS / MES 追溯完整");
    else if (lineageBody) setDetailStatus("WMS 已同步 · MES 追溯存在缺口");
    else setDetailStatus("WMS 库存已同步 · MES 追溯查询失败");
  }, []);
  const selectGroup = useCallback((group: LocationGroup | null) => {
    setSelected(group);
    if (group?.items[0]) void loadWmsDetail(group.items[0]);
    else { setSelectedItem(null); setLineage(null); setLinkedMaterials([]); setDetailStatus(""); }
  }, [loadWmsDetail]);
  const locate=useCallback(async(term=search)=>{
    const snap=await apiClient.get<Wms3dSnapshot>(`/api/3d/wms-snapshot${term.trim()?`?q=${encodeURIComponent(term.trim())}`:""}`);
    setSearchResults(snap.finishedGoods??[]);setMetrics(snap.metrics??{});
    const hit=snap.finishedGoods?.find(x=>x.locationCode);
    if(hit){const group=groups.find(g=>g.locationCode===hit.locationCode);if(group)setSelected(group);}
  },[search,groups]);

  const loadInventory = useCallback(async () => {
    try {
      const data = await apiClient.get<FgInventoryResponse>("/wms/finished-goods-inventory?limit=500");
      const items = data.items ?? [];
      const map = new Map<string, FinishedGoodItem[]>();
      for (const item of items) {
        const key = item.location_code ?? `UNK-${items.indexOf(item)}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(item);
      }
      const next: LocationGroup[] = [];
      for (const [loc, locItems] of map) {
        const { zone, row, pos } = parseLocation(loc);
        next.push({ locationCode: loc, zone, row, pos: pos > 0 ? pos - 1 : 0, items: locItems });
      }
      next.sort((a, b) => a.zone.localeCompare(b.zone) || a.row.localeCompare(b.row) || a.pos - b.pos);
      setGroups(next);
      setLastSync(new Date());
      setSyncError("");
      setLoading(false);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "无法连接WMS");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInventory();
    const timer = window.setInterval(() => void loadInventory(), 15000);
    return () => window.clearInterval(timer);
  }, [loadInventory]);

  const occupied = groups.reduce((s, g) => s + g.items.length, 0);

  return (
    <div style={{ position: "absolute", inset: 0, paddingTop: 48, background: "#0f172a" }}>
      <Canvas shadows camera={{ position: [2, 10, 18], fov: 52 }} style={{ width: "100%", height: "100%" }}>
        <Warehouse groups={groups} selected={selected} onSelect={selectGroup} />
      </Canvas>

      <button type="button" onClick={() => selectGroup(null)} style={{ position: "absolute", right: 16, top: 60, zIndex: 3, padding: "8px 13px", borderRadius: 8, border: "1px solid #475569", background: "rgba(7,17,31,.92)", color: "white", fontWeight: 800 }}>总览</button>

      <div style={{ position: "absolute", left: 16, top: 60, padding: "12px 15px", borderRadius: 12, background: "rgba(7,17,31,.9)", color: "white" }}>
        <div style={{ fontSize: 17, fontWeight: 800 }}>成品仓库 3D</div>
        <div style={{ marginTop: 4, fontSize: 12, color: "#cbd5e1" }}>
          {loading ? "加载中…" : `已占用 ${occupied} 件 · ${groups.length} 托盘位`}
        </div>
        <div style={{ marginTop: 4, fontSize: 11, color: syncError ? "#fca5a5" : "#86efac" }}>
          {syncError ? `WMS离线：${syncError}` : lastSync ? `WMS已连接 · ${lastSync.toLocaleTimeString()}` : "WMS连接中…"}
        </div>
        <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {Object.entries(STATUS_COLOR).map(([s, c]) => (
            <span key={s} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: c, display: "inline-block" }} />
              {s}
            </span>
          ))}
        </div>
      </div>
      <div style={{position:"absolute",left:300,top:60,width:450,padding:10,borderRadius:10,background:"rgba(7,17,31,.92)",color:"#fff"}}>
        <div style={{display:"flex",gap:6}}><input value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")void locate();}} placeholder="SN / 产品 / 工单 / 箱码 / 栈板码 / 库位" style={{flex:1,padding:"7px 9px",borderRadius:6,border:"1px solid #475569"}}/><button onClick={()=>void locate()} style={{padding:"7px 12px",border:0,borderRadius:6,background:"#22c55e",color:"#fff",fontWeight:700}}>快速定位</button></div>
        <div style={{marginTop:6,fontSize:11,color:"#cbd5e1"}}>冻结 {metrics.active_freezes??0} · 待审批 {metrics.pending_approval??0} · 交接超时 {metrics.overdue_handovers??0}</div>
        {searchResults.slice(0,4).map(x=><button key={x.id} onClick={()=>{setSearch(x.sn);void locate(x.sn);}} style={{display:"block",width:"100%",textAlign:"left",marginTop:3,padding:"4px 6px",border:0,borderRadius:4,background:"#1e293b",color:"#e2e8f0"}}>{x.sn} · {x.productCode??"—"} · {x.locationCode} · {x.status}</button>)}
      </div>

      <div style={{ position: "absolute", right: 16, top: 108, bottom: 18, width: 360, padding: 14, borderRadius: 12, background: "rgba(255,255,255,.97)", color: "#172033", boxShadow: "0 10px 30px rgba(0,0,0,.2)", overflow: "auto" }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>{selected?.locationCode ?? "成品仓位详情"}</div>
        {selected ? (
          <>
            {selectedItem?.pallet_code
              ? <WarehouseQrImage value={selectedItem.pallet_code} label="真实栈板二维码 / Pallet QR" />
              : <div style={{ padding: 8, marginBottom: 8, borderRadius: 7, background: "#fef3c7", color: "#92400e", fontSize: 11 }}>该库存尚未绑定真实栈板二维码</div>}
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>
              状态：<span style={{ color: statusColor(selected.items[0]?.inventory_status), fontWeight: 700 }}>
                {selected.items[0]?.inventory_status ?? "—"}
              </span>
            </div>
            <WmsDetail label="SN" value={selectedItem?.serial_no} />
            <WmsDetail label="产品" value={selectedItem?.product_code} />
            <WmsDetail label="工单" value={selectedItem?.work_order_code} />
            <WmsDetail label="工单绑定" value={lineage?.workOrder?.workOrderCode ?? lineage?.workOrderCode ?? selectedItem?.work_order_code} />
            <WmsDetail label="库存状态" value={selectedItem?.inventory_status} />
            <WmsDetail label="入库时间" value={selectedItem?.received_at ? new Date(selectedItem.received_at).toLocaleString() : null} />
            <WmsDetail label="库位" value={selectedItem?.location_code} />
            <WmsDetail label="箱码" value={selectedItem?.carton_code} />
            <WmsDetail label="栈板码" value={selectedItem?.pallet_code} />
            <WmsDetail label="供应商" value={[...new Set(linkedMaterials.map(row => row.supplierName).filter(Boolean))].join("、")} />
            <WmsDetail label="供应商编码" value={[...new Set(linkedMaterials.map(row => row.supplierCode).filter(Boolean))].join("、")} />
            <WmsDetail label="关联物料" value={[...new Set(linkedMaterials.map(row => row.materialCode).filter(Boolean))].join("、")} />
            <WmsDetail label="关联批次" value={[...new Set(linkedMaterials.map(row => row.lotNo).filter(Boolean))].join("、")} />
            <WmsDetail label="IQC状态" value={[...new Set(linkedMaterials.map(row => row.iqcStatus ?? row.inspectionResult).filter(Boolean))].join("、") || (lineage?.iqcStatus ?? lineage?.quality?.iqcStatus ?? lineage?.inspection?.iqcStatus)} />
            <WmsDetail label="检验结果" value={[...new Set(linkedMaterials.map(row => row.inspectionResult).filter(Boolean))].join("、") || (lineage?.inspectionResult ?? lineage?.quality?.inspectionResult ?? lineage?.inspection?.result)} />
            <WmsDetail label="箱内绑定" value={lineage?.containers?.map((row: any) => row.containerId).filter(Boolean).join("、") ?? selectedItem?.carton_code} />
            <WmsDetail label="栈板绑定" value={lineage?.pallets?.map((row: any) => row.palletCode).filter(Boolean).join("、") ?? selectedItem?.pallet_code} />
            <WmsDetail label="来源工站" value={lineage?.origin?.stationCode} />
            <WmsDetail label="当前位置" value={lineage?.currentLocation?.stationCode ?? "成品仓库"} />
            <WmsDetail label="下一节点" value={lineage?.nextExpectedStation?.stationCode ?? "出库/交货"} />
            <WmsDetail label="路由记录" value={lineage?.route?.length} />
            <div style={{ marginTop: 8, padding: 7, borderRadius: 6, background: lineage?.provenanceComplete ? "#dcfce7" : "#fef3c7", fontSize: 11 }}>{detailStatus || "点击托盘后同步 WMS 详情"}</div>
            <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 6, fontSize: 11, color: "#64748b" }}>
              同一仓位 {selected.items.length} 件：
            </div>
            {selected.items.slice(0, 8).map((item) => (
              <button type="button" key={item.serial_no} onClick={() => void loadWmsDetail(item)} style={{ display: "block", width: "100%", textAlign: "left", fontSize: 10, fontFamily: "monospace", marginTop: 3, padding: "5px 7px", borderRadius: 5, border: selectedItem?.serial_no === item.serial_no ? "1px solid #0284c7" : "1px solid #e2e8f0", background: selectedItem?.serial_no === item.serial_no ? "#e0f2fe" : "#f8fafc" }}>
                {item.serial_no} · {item.inventory_status}
              </button>
            ))}
            {selected.items.length > 8 && (
              <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
                +{selected.items.length - 8} more…
              </div>
            )}
          </>
        ) : (
          <div style={{ color: "#667085", fontSize: 13 }}>点击任一托盘位查看成品详情。</div>
        )}
      </div>

      <div style={{ position: "absolute", left: 16, bottom: 14, padding: "8px 12px", borderRadius: 9, background: "rgba(255,255,255,.92)", color: "#344054", fontSize: 12 }}>
        🟢 可用 · 🟡 预留 · 🔴 冻结 · ⚪ 已出库 · 拖拽旋转 · 滚轮缩放
      </div>
    </div>
  );
}

function WmsDetail({ label, value }: { label: string; value: unknown }) {
  return <div style={{ display: "flex", gap: 8, padding: "5px 0", borderBottom: "1px solid #edf1f5", fontSize: 12 }}><span style={{ width: 76, color: "#64748b", flexShrink: 0 }}>{label}</span><strong style={{ overflowWrap: "anywhere" }}>{value == null || value === "" ? "—" : String(value)}</strong></div>;
}
