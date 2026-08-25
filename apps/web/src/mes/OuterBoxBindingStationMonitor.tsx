import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, OrbitControls, RoundedBox, Text } from "@react-three/drei";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Group } from "three";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { StationScannerControl } from "./StationScannerControl";

type Row = Record<string, unknown>;
type Snapshot = { stationCode?: string; bucketName?: string; payload?: Row[] };
const COPY = {
  "zh-CN": { title: "外箱包装绑码 3D 工位", sub: "多个产品绑定一个外箱 · 多个外箱绑定一个栈板", online: "在线", offline: "离线", bound: "已绑定产品", ng: "已确认不良拦截", dup: "重复产品", latest: "最新多对一绑定", product: "产品", box: "外箱", waiting: "等待扫码", note: "一个外箱可装多个产品。重复产品和已确认不良品由MES拦截。", model: "栈板 + 外箱 · 多对一" },
  "en-US": { title: "Outer-Box Packaging 3D", sub: "Many products to one case · many cases to one pallet", online: "ONLINE", offline: "OFFLINE", bound: "BOUND PRODUCTS", ng: "CONFIRMED NG BLOCKED", dup: "DUPLICATE PRODUCTS", latest: "LATEST MULTI-TO-ONE BINDING", product: "Product", box: "Case", waiting: "WAITING", note: "A case accepts multiple products. MES blocks duplicate products and confirmed NG.", model: "PALLET + CASES · MULTI → ONE" },
  "vi-VN": { title: "Trạm đóng gói thùng ngoài 3D", sub: "Nhiều sản phẩm vào một thùng · nhiều thùng vào một pallet", online: "TRỰC TUYẾN", offline: "NGOẠI TUYẾN", bound: "SẢN PHẨM ĐÃ GHÉP", ng: "NG ĐÃ CHẶN", dup: "SẢN PHẨM TRÙNG", latest: "GHÉP NHIỀU-MỘT MỚI NHẤT", product: "Sản phẩm", box: "Thùng", waiting: "ĐANG CHỜ", note: "Một thùng chứa nhiều sản phẩm. MES chặn sản phẩm trùng và NG đã xác nhận.", model: "PALLET + THÙNG · NHIỀU → MỘT" },
} as const;

function PackingCell({ active, blocked, label }: { active: boolean; blocked: boolean; label: string }) {
  const group = useRef<Group>(null);
  useFrame(({ clock }) => { if (group.current) group.current.rotation.y = Math.sin(clock.elapsedTime * .4) * .04; });
  return <group ref={group}><group position={[0, -1.1, 0]}>{[-2.7, 0, 2.7].map(z => <RoundedBox key={z} args={[7.6, .28, 1.8]} radius={.08} position={[0, 0, z]}><meshStandardMaterial color="#8b5a2b" roughness={.8}/></RoundedBox>)}{[-3.25, 0, 3.25].map(x => <RoundedBox key={x} args={[.55, .65, 5.8]} radius={.06} position={[x, -.42, 0]}><meshStandardMaterial color="#5b371c"/></RoundedBox>)}</group>{[-2.3, 0, 2.3].flatMap((x, xi) => [-1.55, 1.55].map((z, zi) => <RoundedBox key={`${x}-${z}`} args={[2.05, 1.55, 2.7]} radius={.14} position={[x, .15 + (xi === 1 && zi === 0 ? 1.65 : 0), z]}><meshStandardMaterial color={blocked ? "#7f1d1d" : active ? "#b45309" : "#475569"} emissive={blocked ? "#ef4444" : "#000"} emissiveIntensity={.28}/></RoundedBox>))}<Text position={[0, 3.25, 0]} fontSize={.42} color="#bae6fd">{label}</Text></group>;
}

export function OuterBoxBindingStationMonitor({ locale }: { locale: Locale }) {
  const w = COPY[locale] || COPY["en-US"];
  const [bindings, setBindings] = useState<Row[]>([]); const [ng, setNg] = useState<Row[]>([]); const [dup, setDup] = useState(0); const [online, setOnline] = useState(false);
  const refresh = useCallback(async () => { try { const [s, h] = await Promise.all([fetch("/api/station/bucket-snapshots").then(r => r.json()), fetch("/api/pda/heartbeats").then(r => r.json())]); const all: Snapshot[] = Array.isArray(s) ? s : s.items ?? s.snapshots ?? []; const own = all.filter(x => x.stationCode === "manu_outer_box_binding"); const rows = (name: string) => own.find(x => x.bucketName === name)?.payload ?? []; setBindings(rows("bindings")); setNg(rows("confirmed_ng")); setDup(Number(rows("stats")[0]?.dup || 0)); const now = Number(h.serverTime || Date.now()); setOnline((h.heartbeats || []).some((x: Row) => x.stationCode === "manu_outer_box_binding" && x.online !== false && now - Number(x.receivedAt || 0) < 45000)); } catch { setOnline(false); } }, []);
  useEffect(() => { void refresh(); const id = setInterval(() => void refresh(), 2500); return () => clearInterval(id); }, [refresh]);
  const last = bindings[0] ?? {};
  return <div style={{ position: "relative", height: 760, overflow: "hidden", borderRadius: 16, background: "#07111f", color: "#e2e8f0" }}><Canvas shadows camera={{ position: [9, 7, 10], fov: 42 }}><ambientLight intensity={.6}/><directionalLight position={[8, 12, 7]} intensity={2.8}/><PackingCell active={bindings.length > 0} blocked={ng.length > 0 || dup > 0} label={w.model}/><OrbitControls makeDefault/><Environment preset="warehouse"/></Canvas><header style={{ position: "absolute", left: 20, right: 20, top: 18, display: "flex" }}><div><h1 style={{ margin: 0, fontSize: 24 }}>{w.title}</h1><small>{w.sub}</small></div><b style={{ marginLeft: "auto", color: online ? "#22c55e" : "#ef4444" }}>● {online ? w.online : w.offline}</b></header><div style={{ position: "absolute", left: "50%", top: 18, transform: "translateX(-50%)", width: 410 }}><StationScannerControl stationCode="manu_outer_box_binding" locale={locale} compact/></div><div style={{ position: "absolute", left: 20, top: 100, width: 260, display: "grid", gap: 9 }}>{[[w.bound, bindings.length, "#22c55e"], [w.ng, ng.length, "#ef4444"], [w.dup, dup, "#f59e0b"]].map(([label, value, color]) => <div key={String(label)} style={{ padding: 12, background: "#10243b", border: `2px solid ${color}`, borderRadius: 10 }}><small>{label}</small><strong style={{ display: "block", fontSize: 25 }}>{value}</strong></div>)}</div><aside style={{ position: "absolute", right: 20, top: 100, width: 270, padding: 14, background: "#071525e8", border: "1px solid #334155", borderRadius: 10 }}><b>{w.latest}</b><p>{w.product}: {String(last.productSn || last.sn || w.waiting)}</p><p>{w.box}: {String(last.boxSn || w.waiting)}</p><small style={{ color: "#fbbf24" }}>{w.note}</small></aside></div>;
}
