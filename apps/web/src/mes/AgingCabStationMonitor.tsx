import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { StationScannerControl } from "./StationScannerControl";

type Row = Record<string, unknown>;
type Snapshot = { stationCode?: string; bucketName?: string; payload?: Row[] };
const STATION = "auto_agingcab";
const copy = {
  "zh-CN": { title: "自动线成品老化隧道 3D", sub: "20米连续老化 · 载具循环输送 · 每载具20槽", inlet: "上料区", aging: "恒温老化区", outlet: "出料区", complete: "滚出最终结果", active: "炉内载具", source: "MES实时记录", next: "下一工位：高压ATE" },
  "en-US": { title: "Auto-line Aging Tunnel 3D", sub: "20m continuous aging · circulating carriers · 20 slots each", inlet: "INLET", aging: "AGING ZONE", outlet: "OUTLET", complete: "FINAL RESULTS", active: "ACTIVE CARRIERS", source: "MES live records", next: "Next: High-voltage ATE" },
  "vi-VN": { title: "Hầm lão hóa dây chuyền tự động 3D", sub: "Lão hóa liên tục 20m · giá tuần hoàn · 20 khe mỗi giá", inlet: "KHU NẠP LIỆU", aging: "KHU LÃO HÓA", outlet: "KHU XUẤT HÀNG", complete: "KẾT QUẢ CUỐI", active: "GIÁ ĐANG CHẠY", source: "Dữ liệu MES trực tiếp", next: "Trạm tiếp theo: ATE cao áp" },
} as const;

function AgingLineCanvas({ carriers, locale }: { carriers: Row[][]; locale: Locale }) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(carriers);
  live.current = carriers;
  useEffect(() => {
    const el = host.current; if (!el) return;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x07111f); scene.fog = new THREE.FogExp2(0x07111f, .018);
    const camera = new THREE.PerspectiveCamera(44, el.clientWidth / el.clientHeight, .05, 120); camera.position.set(14, 8, 15); camera.lookAt(0, .4, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(el.clientWidth, el.clientHeight); renderer.shadowMap.enabled = true; el.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xbde7ff, 0x15202c, 1.7)); const sun = new THREE.DirectionalLight(0xffffff, 2.1); sun.position.set(-6, 13, 10); scene.add(sun);
    const mat = (color: number, metal = .1, opacity = 1) => new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: .45, transparent: opacity < 1, opacity });
    const box = (x: number, y: number, z: number, m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(x, y, z), m);
    const world = new THREE.Group(); world.position.x = -10; scene.add(world);
    const floor = box(30, .08, 8, mat(0x20364b)); floor.position.set(10, -.22, 0); world.add(floor);
    const wall = mat(0xe8edf0, .65, .72), frame = mat(0x496171, .85), dark = mat(0x101c27, .65), glass = mat(0x142d40, .5, .46);
    for (const z of [-1.1, 1.1]) { const side = box(20, 1.8, .08, wall); side.position.set(10, .9, z); world.add(side); }
    const roof = box(20, .08, 2.2, wall); roof.position.set(10, 1.8, 0); world.add(roof);
    for (let x = 0; x <= 20; x += 2) for (const z of [-1.12, 1.12]) { const f = box(.055, 1.86, .07, frame); f.position.set(x, .91, z); world.add(f); }
    for (let i = 0; i < 7; i++) { const win = box(2.15, .035, 1.15, glass); win.position.set(1.6 + i * 2.8, 1.855, 0); world.add(win); }
    for (const x of [-1.25, 21.25]) { const conveyor = box(2.5, .24, 1.25, dark); conveyor.position.set(x, .05, 0); world.add(conveyor); }
    const ret = box(25, .12, .72, dark); ret.position.set(10, -.02, 1.7); world.add(ret);
    const label = (text: string, x: number) => { const c = document.createElement("canvas"); c.width = 512; c.height = 80; const ctx = c.getContext("2d")!; ctx.font = "bold 32px Microsoft YaHei"; ctx.textAlign = "center"; ctx.fillStyle = "#9adfff"; ctx.fillText(text, 256, 48); const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true })); s.scale.set(3.8, .6, 1); s.position.set(x, 2.35, 0); world.add(s); };
    const w = copy[locale] || copy["en-US"]; label(w.inlet, -1.25); label(`20m · ${w.aging}`, 10); label(w.outlet, 21.25);
    const trays: THREE.Group[] = [];
    for (let n = 0; n < 8; n++) { const g = new THREE.Group(); g.rotation.y = Math.PI / 2; const base = box(1.6, .22, .55, mat(0xe8eef2, .65)); base.position.y = .11; g.add(base); for (let i = 0; i < 5; i++) { const rack = box(.035, .16, .48, mat(0xc82423, .55)); rack.position.set(-.62 + i * .31, .29, 0); g.add(rack); } const ring = new THREE.Mesh(new THREE.TorusGeometry(.085, .015, 10, 28), dark); ring.rotation.x = Math.PI / 2; ring.position.set(-.69, .25, 0); g.add(ring); for (let i = 0; i < 20; i++) { const a = box(.145, .05, .06, mat(0x66768c, .25)); a.position.set(-.71 + (i % 10) * .158, .31, (Math.floor(i / 10) - .5) * .25); a.userData.slot = i; g.add(a); } world.add(g); trays.push(g); }
    let drag = false, px = 0, py = 0, yaw = -.65, pitch = .42, distance = 22;
    const down = (e: PointerEvent) => { drag = true; px = e.clientX; py = e.clientY; }; const up = () => { drag = false; }; const move = (e: PointerEvent) => { if (!drag) return; yaw -= (e.clientX - px) * .006; pitch = Math.max(.08, Math.min(1.25, pitch + (e.clientY - py) * .006)); px = e.clientX; py = e.clientY; }; const wheel = (e: WheelEvent) => { distance = Math.max(8, Math.min(42, distance + e.deltaY * .015)); };
    el.addEventListener("pointerdown", down); window.addEventListener("pointerup", up); window.addEventListener("pointermove", move); el.addEventListener("wheel", wheel, { passive: true });
    let frameId = 0; const startedAt = Date.now(); const animate = () => { frameId = requestAnimationFrame(animate); const t = (Date.now() - startedAt) / 1000; camera.position.set(Math.cos(yaw) * Math.cos(pitch) * distance, Math.sin(pitch) * distance, Math.sin(yaw) * Math.cos(pitch) * distance); camera.lookAt(0, .45, 0); const rows = live.current; trays.forEach((g, n) => { const p = (t * .16 + n * 3.1) % 25; g.position.set(-2.5 + p, .05, p > 22.5 ? 1.7 : 0); const values = rows[n] ?? []; g.children.forEach(o => { const slot = o.userData.slot; if (slot === undefined || !(o as THREE.Mesh).material) return; const result = String(values[slot]?.result ?? values[slot]?.finalResult ?? "").toUpperCase(); ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).color.set(result === "NG" || result === "FAIL" ? 0xff414d : result === "PASS" || result === "OK" ? 0x2ddf78 : 0x66768c); }); }); renderer.render(scene, camera); };
    animate(); const resize = () => { camera.aspect = el.clientWidth / el.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(el.clientWidth, el.clientHeight); }; window.addEventListener("resize", resize);
    return () => { cancelAnimationFrame(frameId); window.removeEventListener("resize", resize); window.removeEventListener("pointerup", up); window.removeEventListener("pointermove", move); el.removeEventListener("pointerdown", down); renderer.dispose(); renderer.domElement.remove(); };
  }, [locale]);
  return <div ref={host} style={{ position: "absolute", inset: 0 }}/>
}

export function AgingCabStationMonitor({ locale }: { locale: Locale }) {
  const w = copy[locale] || copy["en-US"]; const [complete, setComplete] = useState<Row[]>([]), [processRows, setProcessRows] = useState<Row[]>([]), [online, setOnline] = useState(false);
  const refresh = useCallback(async () => { try { const [snapshots, heartbeats] = await Promise.all([fetch("/api/station/bucket-snapshots", { cache: "no-store" }).then(r => r.json()), fetch("/api/pda/heartbeats", { cache: "no-store" }).then(r => r.json())]); const all: Snapshot[] = Array.isArray(snapshots) ? snapshots : snapshots.items ?? snapshots.snapshots ?? []; const own = all.filter(x => x.stationCode === STATION); const rows = (name: string) => own.find(x => x.bucketName === name)?.payload ?? []; setComplete(rows("pass")); setProcessRows(rows("process")); const now = Number(heartbeats.serverTime || Date.now()); setOnline((heartbeats.heartbeats || []).some((x: Row) => x.stationCode === STATION && x.online !== false && now - Number(x.receivedAt || 0) < 45000)); } catch { setOnline(false); } }, []);
  useEffect(() => { void refresh(); const id = setInterval(() => void refresh(), 3000); return () => clearInterval(id); }, [refresh]);
  const carriers = useMemo(() => { const map = new Map<string, Row[]>(); processRows.forEach((row, i) => { const id = String(row.stand ?? row.vehicleNumber ?? row.batchId ?? Math.floor(i / 20)); const list = map.get(id) ?? []; list.push(row); map.set(id, list); }); return [...map.values()]; }, [processRows]);
  return <div style={{ position: "relative", height: 760, overflow: "hidden", borderRadius: 16, background: "#07111f", color: "#e2e8f0" }}><AgingLineCanvas carriers={carriers} locale={locale}/><div style={{ position: "absolute", left: 20, top: 18 }}><h1 style={{ margin: 0, fontSize: 24 }}>{w.title}</h1><div style={{ color: "#7dd3fc", fontSize: 12 }}>{w.sub}</div></div><div style={{ position: "absolute", left: "50%", top: 18, transform: "translateX(-50%)", width: 410 }}><StationScannerControl stationCode={STATION} locale={locale} compact/></div><div style={{ position: "absolute", right: 20, top: 18, color: online ? "#22c55e" : "#ef4444", fontWeight: 900 }}>● {online ? "ONLINE" : "OFFLINE"}</div><div style={{ position: "absolute", left: 20, top: 100, width: 215, display: "grid", gap: 10 }}><div style={{ padding: 12, background: "#10243bdd", border: "1px solid #38bdf8", borderRadius: 10 }}>{w.active}<strong style={{ display: "block", fontSize: 24 }}>{carriers.length}</strong></div><div style={{ padding: 12, background: "#052e2bdd", border: "1px solid #22c55e", borderRadius: 10 }}>{w.complete}<strong style={{ display: "block", fontSize: 24 }}>{complete.length}</strong></div></div><div style={{ position: "absolute", right: 20, bottom: 20, padding: 12, background: "#071525dd", border: "1px solid #334155", borderRadius: 10, fontSize: 11 }}>{w.source}<br/>{w.next}</div></div>;
}
