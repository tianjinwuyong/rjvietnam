import React, { useRef, useState, useEffect, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from "recharts";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls, RoundedBox, Text as DreiText } from "@react-three/drei";
import * as THREE from "three";
import { WarehouseScene3d } from "./WarehouseScene3d";
import { ProductWarehouseScene3d } from "./ProductWarehouseScene3d";
import { SmtLineDashboard } from "./SmtLineDashboard";
import { NgRealtimeTracking } from "./NgRealtimeTracking";
import { mesApi } from "../api/mes";
import { pmcApi } from "../api/pmc";

class Warehouse3DErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  state = { hasError: false, message: "" };

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error("[Warehouse3D] isolated render failure", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "#0f172a", color: "#dbeafe", padding: 24 }}>
        <div style={{ maxWidth: 520, textAlign: "center", border: "1px solid #475569", borderRadius: 12, padding: 24, background: "#172033" }}>
          <div style={{ fontSize: 30, marginBottom: 10 }}>🏭</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>仓库 3D 暂时无法显示</div>
          <div style={{ marginTop: 8, color: "#94a3b8", fontSize: 13 }}>MES 其余功能仍可用。请重试仓库视图，或继续使用库存列表。</div>
          {this.state.message && <div style={{ marginTop: 10, color: "#fbbf24", fontSize: 11, wordBreak: "break-word" }}>{this.state.message}</div>}
          <button type="button" onClick={() => this.setState({ hasError: false, message: "" })} style={{ marginTop: 16, padding: "8px 18px", border: 0, borderRadius: 7, background: "#0284c7", color: "white", cursor: "pointer", fontWeight: 700 }}>重试 3D</button>
        </div>
      </div>
    );
  }
}

// Drei's generated Text props can become incompatible with the installed
// three/fiber type versions even though the runtime API is valid.
const Text = DreiText as any;

// ── Click sound: speak station name + bucket label via Web Speech API ───────────
function speakStation(stationId: number, label: string) {
  if (typeof window === "undefined") return;
  try {
    const station = STATIONS.find(s => s.id === stationId);
    const stationName = station ? station.nameZh : `站点${stationId}`;
    const text = `${stationName}，${label}`;
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = "zh-CN";
    utt.volume = 1;
    utt.rate = 1.1;
    utt.pitch = 1.2;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utt);
  } catch {}
}

// ── Types ────────────────────────────────────────────────────────────────────
type StationStatus = "running" | "idle" | "down" | "offline";
type UiLanguage = "zh" | "en";

const BUCKET_TEXT: Record<string, Record<UiLanguage, string>> = {
  "NG": { zh: "不良", en: "NG" },
  "First Retest": { zh: "第一次复测", en: "First Retest" },
  "Confirmed NG": { zh: "确认不良", en: "Confirmed NG" },
  "Aged NG": { zh: "超时不良", en: "Aged NG" },
  "ICT NG": { zh: "ICT不良", en: "ICT NG" },
  "FCT NG": { zh: "FCT不良", en: "FCT NG" },
  "ICT+FCT NG": { zh: "ICT+FCT不良", en: "ICT+FCT NG" },
  "PASS": { zh: "合格", en: "PASS" },
};

function bucketText(label: string, language: UiLanguage) {
  return BUCKET_TEXT[label]?.[language] || label;
}

interface NgRecord {
  sn: string;
  defectCode: string;
  defectDescription?: string;
  time: number; // timestamp of last test
  lastTestTime?: number;
  birthTime?: number;
  operator?: string;
  testCount: number; // how many times tested (1 = initial, 2 = first retest, 3 = second retest)
  firstFailureTime: number; // timestamp of first failure (for age calculation)
  isConfirmed: boolean; // true = confirmed NG (moved to NG Pool), false = pending retest
  slot?: number; // slot number in batch (1-12)
  batchId?: string; // batch identifier
  overallResult?: string; // PASS / FAIL / CONFIRMED_NG
  disposition?: 'repair' | 'fct' | 'depanel'; // confirmed-NG handling route
  stationResults?: StationTestResult[];
  motherboardIdentityVerified?: boolean;
  identityError?: string;
  originStationCode?: string;
  returnStationCode?: string;
  sourceStation?: string;
  transferStatus?: 'WAITING_RECEIPT' | 'RECEIVED';
}

interface StationTestResult {
  stationCode: string;
  results: string[];
  finalResult: string;
  testCount: number;
}

interface PassRecord {
  sn: string;
  time: number;
  operator?: string;
  stationCode: string;
  stationName: string;
  batchId?: string;
  slot?: number;
  boardSn?: string;
  shellSn?: string;
  originStationCode?: string;
  returnStationCode?: string;
  sourceStationCode?: string;
  destinationStationCode?: string;
}

interface HandoverRecord {
  transferId: number; batchId: string; sourceStation: string; destinationStation: string;
  destinationType: string; memberCount: number; status: string;
  sentAt: string; receivedAt?: string; acceptedBy?: string;
}

// NG Item wrapper - cleaner API for bucket display
interface NgItem {
  // Identity
  sn: string;
  // Origin
  birthTime: number; // when first failed (timestamp)
  birthStation: string; // station code where first failed
  birthPlace: string; // station name (Chinese) where first failed
  operator?: string; // who performed the test
  sourceStationCode?: string;
  destinationStationCode?: string;
  originStationCode?: string;
  returnStationCode?: string;
  // Defect
  defectCode: string;
  defectDescription?: string;
  // Test tracking
  testCount: number; // how many times tested (1 = initial, 2 = first retest, 3 = second retest)
  lastTestTime: number; // timestamp of last test
  // State
  isConfirmed: boolean; // true = confirmed NG (moved to NG Pool)
  // Computed
  ageHours: number; // (Date.now() - birthTime) / 3600000
  retestRemaining: number; // 3 - testCount
  isAged: boolean; // ageHours > 2
  label: string; // "NG" | "NG Pool" | "Aged NG"
  batchId?: string; // stable motherboard group ID
  slot?: number;
  disposition?: 'repair' | 'fct' | 'depanel';
  stationResults?: StationTestResult[];
  motherboardIdentityVerified?: boolean;
  identityError?: string;
  boardSn?: string;
  shellSn?: string;
}

function toNgItem(r: NgRecord, label: string, birthStation?: string, birthPlace?: string): NgItem {
  const ageMs = Date.now() - r.firstFailureTime;
  return {
    sn: r.sn,
    defectCode: r.defectCode,
    defectDescription: r.defectDescription,
    operator: r.operator,
    testCount: r.testCount,
    lastTestTime: r.time,
    isConfirmed: r.isConfirmed,
    birthTime: r.firstFailureTime,
    birthStation: birthStation || "",
    birthPlace: birthPlace || "",
    ageHours: ageMs / 3600000,
    retestRemaining: 3 - r.testCount,
    isAged: ageMs > 2 * 3600000,
    label,
    batchId: r.batchId,
    slot: r.slot,
    disposition: r.disposition,
    stationResults: r.stationResults,
    motherboardIdentityVerified: r.motherboardIdentityVerified,
    identityError: r.identityError,
    originStationCode: r.originStationCode,
    returnStationCode: r.returnStationCode,
  };
}

interface Station {
  id: number;
  nameZh: string;
  code: string;
  px: number;
  status: StationStatus;
  wipCount: number;
  ngCount: number;
  ip: string;
}

// 模块级人流热力图数据（供3D场景渲染使用，避免 TypeScript 声明顺序作用域问题）
const moduleStationFlowCounts: Record<string, { enter: number; exit: number }> = {};
let moduleFlowForceUpdate: ((fn: (n: number) => number) => void) | null = null;

// 模块级工位实时SN列表（每个工位最近处理的SN）
type SnEntry = { sn: string; result: 'PASS' | 'FAIL' | 'NG' | 'UNKNOWN'; time: number };
const MAX_SN_PER_STATION = 8;
const moduleStationSnLists: Record<string, SnEntry[]> = {};
let moduleSnForceUpdate: ((fn: (n: number) => number) => void) | null = null;
// 当前被追踪的SN（右侧相机标签显示）
let moduleTrackedSn: string = '';

// Station codes must match db/stations.code for scan data lookup
const STATIONS: Station[] = [
  { id: 1,  nameZh: "PDA扫码上料", code: "pda_load",          px: 0,  status: "offline", wipCount: 0, ngCount: 0, ip: "" },
  { id: 2,  nameZh: "波峰焊",      code: "wave_solder",       px: 5,  status: "offline", wipCount: 0, ngCount: 0, ip: "192.168.6.10" },
  { id: 3,  nameZh: "AOI",         code: "manu_aio",          px: 10, status: "offline", wipCount: 0, ngCount: 0, ip: "192.168.6.90" },
  { id: 4, nameZh: "ICT",         code: "manu_ict",          px: 15, status: "offline", wipCount: 0, ngCount: 0, ip: "192.168.6.91" },
  { id: 5,  nameZh: "FCT",         code: "manu_fct",          px: 20, status: "offline", wipCount: 0, ngCount: 0, ip: "192.168.6.92" },
  { id: 6,  nameZh: "分板机",      code: "manu_depanel",      px: 25, status: "offline", wipCount: 0, ngCount: 0, ip: "192.168.6.93" },
  { id: 7,  nameZh: "绑码",        code: "manu_shellbinding", px: 30, status: "offline", wipCount: 0, ngCount: 0, ip: "192.168.6.94" },
  { id: 8,  nameZh: "组装ATE",     code: "manu_assem_ate",    px: 35, status: "offline", wipCount: 0, ngCount: 0, ip: "192.168.6.95" },
  { id: 9,  nameZh: "超声波",      code: "manu_supersonic",   px: 40, status: "offline", wipCount: 0, ngCount: 0, ip: "192.168.6.96" },
  { id: 10, nameZh: "老化",        code: "manu_agingcab",     px: 45, status: "offline", wipCount: 0, ngCount: 0, ip: "192.168.6.97" },
  { id: 11, nameZh: "高压测试",    code: "manu_hivolt_ate",   px: 50, status: "offline", wipCount: 0, ngCount: 0, ip: "192.168.6.98" },
  { id: 12, nameZh: "包装ATE",     code: "manu_package_ate",  px: 55, status: "offline", wipCount: 0, ngCount: 0, ip: "192.168.6.99" },
  { id: 29, nameZh: "外箱码绑定",  code: "manu_case_binding", px: 60, status: "offline", wipCount: 0, ngCount: 0, ip: "192.168.6.100" },
  { id: 13, nameZh: "栈板绑码",    code: "manu_pallet_binding", px: 65, status: "offline", wipCount: 0, ngCount: 0, ip: "192.168.6.161" },
  { id: 14, nameZh: "回修站",     code: "manu_rework",      px: 30, status: "offline", wipCount: 0, ngCount: 0, ip: "192.168.6.160" },
  // ── 自动线 ──
  { id: 15, nameZh: "自动线PDA",   code: "auto_pda",         px: 0,   status: "offline", wipCount: 0, ngCount: 0, ip: "192.168.6.50" },
  { id: 16, nameZh: "自动线AOI",   code: "auto_aio",         px: 5,   status: "offline", wipCount: 0, ngCount: 0, ip: "192.168.6.50" },
  { id: 17, nameZh: "自动线ICT",   code: "auto_ict",         px: 10,  status: "offline", wipCount: 0, ngCount: 0, ip: "192.168.6.51" },
  { id: 18, nameZh: "自动线FCT",   code: "auto_fct",         px: 15,  status: "offline", wipCount: 0, ngCount: 0, ip: "192.168.6.52" },
  { id: 19, nameZh: "自动线分板",  code: "auto_depanel",     px: 20,  status: "offline", wipCount: 0, ngCount: 0, ip: "192.168.6.53" },
  { id: 20, nameZh: "自动线绑码",  code: "auto_shellbinding",px: 25,  status: "offline", wipCount: 0, ngCount: 0, ip: "192.168.6.54" },
  { id: 21, nameZh: "自动线ATE",   code: "auto_assem_ate",   px: 30,  status: "offline", wipCount: 0, ngCount: 0, ip: "192.168.6.55" },
  { id: 22, nameZh: "自动线超声",  code: "auto_supersonic",  px: 35,  status: "offline", wipCount: 0, ngCount: 0, ip: "192.168.6.56" },
  { id: 23, nameZh: "自动线绑扎",  code: "auto_agingcab",    px: 40,  status: "offline", wipCount: 0, ngCount: 0, ip: "192.168.6.57" },
  { id: 24, nameZh: "自动线高压",  code: "auto_hivolt_ate",  px: 45,  status: "offline", wipCount: 0, ngCount: 0, ip: "192.168.6.58" },
  { id: 25, nameZh: "自动线包装ATE", code: "auto_package_ate", px: 52.5, status: "offline", wipCount: 0, ngCount: 0, ip: "192.168.6.59" },
  { id: 27, nameZh: "自动线外箱码绑定", code: "auto_case_binding",px: 60, status: "offline", wipCount: 0, ngCount: 0, ip: "192.168.6.61" },
  { id: 28, nameZh: "自动线栈板",  code: "auto_pallet_binding",px:65,status: "offline", wipCount: 0, ngCount: 0, ip: "192.168.6.62" },
  // ── SMT L001 (IP addresses are assigned during commissioning) ──
  { id: 101, nameZh: "PD扫码上料", code: "smt_pda_loading",    px:  0, status: "offline", wipCount: 0, ngCount: 0, ip: "PENDING" },
  { id: 102, nameZh: "镭雕机",     code: "smt_laser_marking",  px:  5, status: "offline", wipCount: 0, ngCount: 0, ip: "PENDING" },
  { id: 103, nameZh: "AI插件机",   code: "smt_auto_insertion", px: 10, status: "offline", wipCount: 0, ngCount: 0, ip: "PENDING" },
  { id: 104, nameZh: "印刷机",     code: "smt_printer",        px: 15, status: "offline", wipCount: 0, ngCount: 0, ip: "PENDING" },
  { id: 105, nameZh: "SPI锡膏检测",code: "smt_spi",            px: 20, status: "offline", wipCount: 0, ngCount: 0, ip: "PENDING" },
  { id: 106, nameZh: "贴片机",     code: "smt_placement",      px: 25, status: "offline", wipCount: 0, ngCount: 0, ip: "PENDING" },
  { id: 107, nameZh: "SMT-AOI",    code: "smt_aoi",            px: 30, status: "offline", wipCount: 0, ngCount: 0, ip: "PENDING" },
];

// Stable lookup map — survives HMR module replacement, no closure issue
const STATION_BY_CODE: Record<string, Station> = {};
for (const s of STATIONS) { STATION_BY_CODE[s.code] = s; }

// The 3D line is a read-only MES projection. Legacy/equipment aliases are
// normalized only while reading events; all displayed state uses canonical IDs.
const STATION_CODE_ALIASES: Record<string, string> = {
  manu_pda: 'pda_load',
  manu_aoi: 'manu_aio',
  manu_qrbinding: 'manu_shellbinding',
  manu_assembly: 'manu_assem_ate',
  manu_hivolt: 'manu_hivolt_ate',
  manu_packing: 'manu_package_ate',
  manu_case: 'manu_case_binding',
  manu_outer_box_binding: 'manu_case_binding',
  manu_pallet: 'manu_pallet_binding',
  auto_ate_left: 'auto_package_ate',
  auto_ate_right: 'auto_package_ate',
  smt_pda: 'smt_pda_loading',
  smt_laser: 'smt_laser_marking',
  smt_ai: 'smt_auto_insertion',
  smt_print: 'smt_printer',
  smt_mounter: 'smt_placement',
};
function canonicalStationCode(code?: string) {
  const value = String(code || '').trim();
  return STATION_CODE_ALIASES[value] || value;
}

// This page is the manual-line MES/3D view.  Keep automatic-line stations in
// the shared registry for API/status lookups, but never render them here.
// Previously auto_* entries were included in DISPLAY_STATIONS, which placed
// the six automatic machines at the front of the manual-line scene.
const DISPLAY_STATIONS = STATIONS.filter(station =>
  station.code !== 'pda_load' && station.code.startsWith('manu_')
);
const SMT_LINE_Z = 34;
const MANUAL_LINE_Z = 4;
const AUTO_LINE_Z = 19;
const MANUAL_VIDEO_LINE_Z_OFFSET = -5;
// The supplied videos show both sides of one manual line. The process enters
// along the left bench and returns along the right bench, forming a U around
// the central operator/material aisle.
const MANUAL_STATION_POSITIONS: Record<string, [number, number, number]> = {
  wave_solder:          [4.5, 0, 0.8],
  manu_aio:             [10.5, 0, 0.8],
  manu_ict:             [16.5, 0, 0.8],
  manu_fct:             [22.5, 0, 0.8],
  manu_depanel:         [28.5, 0, 0.8],
  manu_shellbinding:    [35.0, 0, 0.8],
  manu_assem_ate:       [35.0, 0, 7.6],
  manu_supersonic:      [29.0, 0, 7.6],
  manu_agingcab:        [23.0, 0, 10.7],
  manu_hivolt_ate:      [17.0, 0, 7.6],
  manu_package_ate:     [11.0, 0, 7.6],
  manu_case_binding:    [5.0, 0, 7.6],
  manu_pallet_binding:  [-1.0, 0, 7.6],
  manu_rework:          [28.5, 0, -5.0],
};
function stationScenePosition(station: Station): [number, number, number] {
  const manualPosition = MANUAL_STATION_POSITIONS[station.code];
  return manualPosition
    ? [manualPosition[0], manualPosition[1], manualPosition[2] + MANUAL_VIDEO_LINE_Z_OFFSET]
    : [station.px, 0, stationLineZ(station.code)];
}
function stationLineZ(code: string) {
  if (code === 'manu_rework') return -5;
  if (code.startsWith('smt_')) return SMT_LINE_Z;
  if (code.startsWith('auto_')) return AUTO_LINE_Z;
  return MANUAL_LINE_Z;
}
const MANUAL_FLOW_STATIONS = DISPLAY_STATIONS.filter(station => station.code !== 'manu_rework')
  .filter(station => !station.code.startsWith('auto_') && !station.code.startsWith('smt_'))
  .sort((a, b) => a.px - b.px);
const AUTO_FLOW_STATIONS = DISPLAY_STATIONS.filter(station => station.code.startsWith('auto_'))
  .sort((a, b) => a.px - b.px);

// SMT产线：smt_ 前缀工站，z=-12
const SMT_FLOW_STATIONS = DISPLAY_STATIONS.filter(station => station.code.startsWith('smt_'))
  .sort((a, b) => a.px - b.px);

type BucketKind = 'NG' | 'PASS' | 'First Retest' | 'Confirmed NG' | 'Aged NG';
const STATION_BUCKETS: Record<string, BucketKind[]> = Object.fromEntries(
  DISPLAY_STATIONS.map((station) => [station.code,
    station.code === 'wave_solder' ? [] : ['PASS', 'NG']])
) as Record<string, BucketKind[]>;

function stationHasBucket(stationCode: string, bucket: BucketKind) {
  return (STATION_BUCKETS[stationCode] || ['PASS', 'NG']).includes(bucket as BucketKind);
}

function stationRouteLabel(code?: string) {
  if (!code) return '-';
  const station = STATION_BY_CODE[code];
  return station ? `${station.nameZh} (${station.code})` : code;
}

function inferPassRoute(stationCode: string, sourceStationCode?: string, destinationStationCode?: string) {
  const current = STATION_BY_CODE[stationCode];
  let source = sourceStationCode;
  let destination = destinationStationCode;
  if (current && current.id >= 1 && current.id <= 13) {
    source ||= current.id === 1 ? 'MES投产' : STATIONS.find(s => s.id === current.id - 1)?.code;
    destination ||= current.id === 13 ? '成品入库' : STATIONS.find(s => s.id === current.id + 1)?.code;
  } else if (current && current.id >= 15 && current.id <= 28) {
    source ||= current.id === 15 ? 'MES投产' : STATIONS.find(s => s.id === current.id - 1)?.code;
    destination ||= current.id === 28 ? '成品入库' : STATIONS.find(s => s.id === current.id + 1)?.code;
  } else if (stationCode === 'manu_rework') {
    source ||= '确认不良路由';
    destination ||= '维修通过后返回原产线';
  }
  return { source: source || 'MES路由', current: stationCode, destination: destination || 'MES路由' };
}

// exe name per station code — used by start-stations button
const EXE_MAP: Record<string, string> = {
  "manu_ict":       "ICT_station.exe",   // ICT_station.exe on 192.168.6.91
  manu_fct:        "FCT_station.exe",
  manu_depanel:     "PCBADividerStation.exe",
  manu_shellbinding: "QRBinding_v2.exe",
  manu_assem_ate:   "AssemblyATE.exe",
  manu_supersonic:  "UltrasonicStation.exe",
  manu_agingcab:    "AgingCab.exe",
  manu_hivolt_ate:  "HiVoltATE.exe",
  manu_package_ate: "PackingATE.exe",
  manu_case_binding: "OuterBoxBindingStation.exe",
  manu_pallet_binding: "PackingStation.exe",
  manu_rework: "ReworkStation.exe",
  // ── 自动线 ──
  auto_pda:          "PDA_station.exe",
  auto_aio:          "AOI_station.exe",
  auto_ict:          "ICT_station.exe",
  auto_fct:          "FCT_station.exe",
  auto_depanel:      "Depanel_station.exe",
  auto_shellbinding: "ShellBinding_station.exe",
  auto_assem_ate:    "AssemblyATE_station.exe",
  auto_supersonic:   "Supersonic_station.exe",
  auto_agingcab:     "AgingCab_station.exe",
  auto_hivolt_ate:   "HiVoltATE_station.exe",
  auto_package_ate:  "PackingATE_station.exe",
  auto_case_binding: "CaseBinding_station.exe",
  auto_pallet_binding: "PalletBinding_station.exe",
};

const STATUS_COLOR: Record<StationStatus, string> = {
  running: "#22c55e",
  idle:    "#eab308",
  down:    "#ef4444",
  offline: "#6b7280",
};

/** Read-only KPI board shared by the manual-line MES view.
 * Values come directly from stationStats (the same snapshot used by each
 * station card); zero/unknown stations are not replaced with sample data.
 */
function ManualLineKpiBoard({
  stationStats,
}: { stationStats: Record<number, { total: number; pass: number; fail: number; dup: number }> }) {
  const manualStations = STATIONS.filter(s => s.code.startsWith("manu_") && s.code !== "manu_rework");
  const rows = manualStations.map(station => {
    const stat = stationStats[station.id];
    const total = Number(stat?.total || 0);
    const pass = Number(stat?.pass || 0);
    const ng = Number(stat?.fail || 0);
    return { station, total, pass, ng, yieldRate: total ? (pass / total) * 100 : null };
  });
  const total = rows.reduce((n, r) => n + r.total, 0);
  const pass = rows.reduce((n, r) => n + r.pass, 0);
  const ng = rows.reduce((n, r) => n + r.ng, 0);
  const yieldRate = total ? (pass / total) * 100 : null;
  const maxTotal = Math.max(1, ...rows.map(r => r.total));
  const metric = (label: string, value: string, color: string) => (
    <div style={{ flex: 1, minWidth: 70, padding: "6px 8px", border: "1px solid #1e3a5f", borderRadius: 6, background: "rgba(15,23,42,.9)" }}>
      <div style={{ color: "#94a3b8", fontSize: 9 }}>{label}</div>
      <div style={{ color, fontSize: 18, fontWeight: 800, lineHeight: 1.1 }}>{value}</div>
    </div>
  );
  return (
    <aside aria-label="Manual line KPI board" style={{
      position: "absolute", top: 58, left: "50%", transform: "translateX(-50%)", zIndex: 220, width: "min(720px, calc(100% - 28px))", maxHeight: 205,
      overflowY: "auto", padding: 8, border: "1px solid #1e3a5f", borderRadius: 9,
      background: "rgba(7,17,31,.94)", color: "#e2e8f0", fontFamily: "system-ui, sans-serif",
      boxShadow: "0 8px 24px rgba(0,0,0,.25)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
        <strong style={{ fontSize: 12 }}>Manual Line KPI</strong>
        <span style={{ color: "#64748b", fontSize: 9 }}>MES snapshot</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 5, marginBottom: 8 }}>
        {metric("TOTAL", total ? String(total) : "—", "#e2e8f0")}
        {metric("PASS", total ? String(pass) : "—", "#4ade80")}
        {metric("NG", total ? String(ng) : "—", ng ? "#f87171" : "#94a3b8")}
        {metric("YIELD", yieldRate == null ? "—" : `${yieldRate.toFixed(1)}%`, "#38bdf8")}
      </div>
      {rows.map(({ station, total: count, pass: ok, ng: fail, yieldRate: rate }) => (
        <div key={station.code} style={{ marginTop: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
            <span style={{ color: "#cbd5e1" }}>{station.nameZh}</span>
            <span style={{ color: rate == null ? "#64748b" : rate >= 95 ? "#4ade80" : "#fbbf24" }}>
              {count ? `${ok}/${count} · ${rate!.toFixed(0)}%` : "—"}
            </span>
          </div>
          <div style={{ display: "flex", height: 5, marginTop: 3, borderRadius: 3, overflow: "hidden", background: "#1e293b" }}>
            <div style={{ width: `${(ok / maxTotal) * 100}%`, background: "#22c55e" }} />
            <div style={{ width: `${(fail / maxTotal) * 100}%`, background: "#ef4444" }} />
          </div>
        </div>
      ))}
    </aside>
  );
}

// ── Camera Quick Views ──────────────────────────────────────────────────────
interface CamView {
  id: string;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
}

const CAM_VIEWS: CamView[] = [
  { id: "overview", label: "🏞 总览",    position: [35, 18, 56] as [number, number, number], target: [30, 1, 19] as [number, number, number] },
  { id: "topdown",  label: "🛰 俯视",    position: [30, 68, 19] as [number, number, number], target: [30, 0, 19] as [number, number, number] },
  { id: "side",     label: "↔ 侧视",    position: [72, 10, 19] as [number, number, number], target: [30, 1, 19] as [number, number, number] },
  ...DISPLAY_STATIONS.map(s => ({
    id: `s${s.id}`,
    label: `${String(s.id).padStart(2, "0")} ${s.nameZh.length > 6 ? s.nameZh.slice(0, 6) + "…" : s.nameZh}`,
position: [s.px, 4.2, stationLineZ(s.code) + 8] as [number, number, number],
  target: [s.px, 1.4, stationLineZ(s.code)] as [number, number, number],
  })),
];

// ── Manual Raycaster — bypasses R3F event system for reliable clicks ──────────
// R3F's onClick doesn't work in headless environments. This does manual raycasting.
function ManualRaycaster({ onStationClick, onNgBlockClick, onBucketToggle, onBatchClick, onBackgroundClick }: {
  onStationClick: (s: Station) => void;
  onNgBlockClick: (item: NgItem) => void;
  onBucketToggle: (stationId: number, label: string) => void;
  onBatchClick?: (batch: any) => void;
  onBackgroundClick?: () => void; // fires when nothing else is hit
}) {
  const { camera, gl, scene } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const mouse = useRef(new THREE.Vector2());

  useEffect(() => {
    const canvas = gl.domElement;
    const handleClick = (event: MouseEvent) => {
      // Background click: click directly on canvas element (not HTML overlay)
      if (event.target !== canvas) {
        onBackgroundClick?.();
        return;
      }

      const rect = canvas.getBoundingClientRect();
      mouse.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.current.setFromCamera(mouse.current, camera);
      const intersects = raycaster.current.intersectObjects(scene.children, true);

      let handled = false;
      for (const hit of intersects) {
        const obj = hit.object as THREE.Mesh;

        // Check obj userData
        const userData = (obj as any).userData;
        if (userData?.ngItem) {
          console.log('NgBlock clicked:', userData.ngItem.sn);
          onNgBlockClick(userData.ngItem);
          handled = true;
          break;
        }
        if (userData?.bucket) {
          console.log('Bucket clicked:', userData.stationId, userData.label);
          speakStation(userData.stationId, userData.label);
          onBucketToggle(userData.stationId, userData.label);
          handled = true;
          break;
        }
        if (userData?.batchData) {
          console.log('BatchBlock clicked:', userData.batchData.mainSn);
          onBatchClick?.(userData.batchData);
          handled = true;
          break;
        }
        if (userData?.stationId !== undefined) {
          const station = STATIONS.find(s => s.id === userData.stationId);
          if (station) {
            console.log('Station clicked:', station.nameZh);
            onStationClick(station);
            handled = true;
            break;
          }
        }

        // Traverse parent chain for group-level userData
        let current: THREE.Object3D | null = obj.parent;
        while (current) {
          const gd = (current as any).userData;
          if (gd?.ngItem) {
            console.log('NgBlock clicked (group):', gd.ngItem.sn);
            onNgBlockClick(gd.ngItem);
            handled = true;
            break;
          }
          if (gd?.bucket) {
            console.log('Bucket clicked (group):', gd.stationId, gd.label);
            speakStation(gd.stationId, gd.label);
            onBucketToggle(gd.stationId, gd.label);
            handled = true;
            break;
          }
          if (gd?.batchData) {
            console.log('BatchBlock clicked (group):', gd.batchData.mainSn);
            onBatchClick?.(gd.batchData);
            handled = true;
            break;
          }
          if (gd?.stationId !== undefined) {
            const station = STATIONS.find(s => s.id === gd.stationId);
            if (station) {
              console.log('Station clicked (group):', station.nameZh);
              onStationClick(station);
              handled = true;
              break;
            }
          }
          current = current.parent;
        }
        if (handled) break;
      }

      // Clicked on canvas but no interactive 3D object hit → background
      if (!handled) {
        onBackgroundClick?.();
      }
    };

    canvas.addEventListener('click', handleClick);
    return () => canvas.removeEventListener('click', handleClick);
  }, [camera, gl, scene, onStationClick, onNgBlockClick, onBucketToggle, onBatchClick, onBackgroundClick]);

  return null;
}

// ── CameraRig — smoothly animates camera + orbit target to a CamView ─────────
function CameraRig({ view }: { view: CamView | null }) {
  const cam = useThree(s => s.camera);
  const controls = useThree(s => s.controls) as any;
  const from = useRef<{ pos: THREE.Vector3; tgt: THREE.Vector3 } | null>(null);
  const elapsed = useRef(0);

  // When view changes, snapshot the current camera + target as start point
  // Controls are NEVER disabled — camera stays free at all times.
  useEffect(() => {
    if (!view) return;
    from.current = {
      pos: cam.position.clone(),
      tgt: controls ? controls.target.clone() : new THREE.Vector3(...view.target),
    };
    elapsed.current = 0;
  }, [view, cam, controls]);

  useFrame((_, dt) => {
    if (!view || !from.current) return;
    elapsed.current += dt;
    const t = Math.min(1, elapsed.current / 0.9); // 900ms ease
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
    cam.position.lerpVectors(from.current.pos, new THREE.Vector3(...view.position), ease);
    if (controls) {
      controls.target.lerpVectors(from.current.tgt, new THREE.Vector3(...view.target), ease);
      controls.update();
    }
    // Animation done → clear so useFrame stops overriding camera
    if (t >= 1) from.current = null;
  });

  return null;
}

// ── Ambient factory sounds (Web Audio API) ────────────────────────────────────
function useFactoryAudio(volume: number, enabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const humRef = useRef<{ osc: OscillatorNode; gain: GainNode } | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const clickIdxRef = useRef(0);

  // Start audio context on first user interaction (browser autoplay rules)
  const ensureCtx = useCallback(() => {
    if (typeof window === "undefined") return null;
    if (!ctxRef.current) {
      const AC = (window.AudioContext || (window as any).webkitAudioContext);
      if (!AC) return null;
      ctxRef.current = new AC();
      const master = ctxRef.current.createGain();
      master.gain.value = 1;
      master.connect(ctxRef.current.destination);
      masterRef.current = master;
    }
    if (ctxRef.current.state === "suspended") {
      ctxRef.current.resume().catch(() => {});
    }
    return ctxRef.current;
  }, []);

  // Continuous conveyor hum
  useEffect(() => {
    if (!enabled) {
      if (humRef.current) {
        try { humRef.current.gain.gain.setTargetAtTime(0, ctxRef.current?.currentTime ?? 0, 0.05); } catch {}
      }
      return;
    }
    const ctx = ensureCtx();
    if (!ctx) return;
    if (!humRef.current) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = 60; // low hum
      const gain = ctx.createGain();
      gain.gain.value = 0.05;
      osc.connect(gain);
      gain.connect(masterRef.current!);
      osc.start();
      humRef.current = { osc, gain };
    }
    return () => {
      // keep alive across enable toggles
    };
  }, [enabled, ensureCtx]);

  // Master volume
  useEffect(() => {
    if (masterRef.current) {
      masterRef.current.gain.setTargetAtTime(volume, ctxRef.current?.currentTime ?? 0, 0.1);
    }
  }, [volume]);

  // Periodic PCBs passing stations → click + beeps
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => {
      const ctx = ctxRef.current;
      if (!ctx || !masterRef.current) return;
      clickIdxRef.current = (clickIdxRef.current + 1) % STATIONS.length;
      const station = STATIONS[clickIdxRef.current];
      // brief beep at different pitch per station
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 280 + station.id * 30;
      gain.gain.value = 0.06;
      osc.connect(gain);
      gain.connect(masterRef.current);
      osc.start();
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      osc.stop(ctx.currentTime + 0.1);
    }, 700);
    return () => clearInterval(t);
  }, [enabled]);

  // Cleanup
  useEffect(() => {
    return () => {
      try { humRef.current?.osc.stop(); } catch {}
      ctxRef.current?.close().catch(() => {});
    };
  }, []);
}

// ── Day / Night palettes ─────────────────────────────────────────────────────
const PALETTES = {
  day: {
    bg: "#cfe6f5",
    floor: "#7a8590",
    floorSurface: "#9aa5ad",
    ambient: 0.9,
    ambientColor: "#f4e4c1",   // warm sunlight bounce
    directionalColor: "#fff4d6",
  },
  night: {
    bg: "#0a0e1a",
    floor: "#1a2332",
    floorSurface: "#1e293b",
    ambient: 0.4,
    ambientColor: "#60a5fa",   // cool blue moonlight
    directionalColor: "#a8c5e0",
  },
} as const;

type Mode = keyof typeof PALETTES;
type ViewMode = 'full' | 'warehouse' | 'material' | 'product' | 'quality' | 'repair' | 'smt';

// ── Barcode Scanner (realistic scan sweep + beep + flash) ──────────────
function BarcodeScanner({ flashVisible, sn }: { flashVisible: boolean; sn?: string }) {
  const winRef = useRef<THREE.MeshStandardMaterial>(null);
  const laserRef = useRef<THREE.MeshStandardMaterial>(null);
  const sweepGroup = useRef<THREE.Group>(null);
  const lineOpacityRef = useRef<THREE.MeshStandardMaterial>(null);
  const prevFlash = useRef(false);
  const scanAnim = useRef(0); // 0=idle, 1=sweeping, 2=done

  // Play scanner beep
  const beep = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      // First beep (high)
      const osc1 = ctx.createOscillator();
      const g1 = ctx.createGain();
      osc1.type = "square";
      osc1.frequency.setValueAtTime(2800, ctx.currentTime);
      g1.gain.setValueAtTime(0.25, ctx.currentTime);
      g1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      osc1.connect(g1); g1.connect(ctx.destination);
      osc1.start(ctx.currentTime); osc1.stop(ctx.currentTime + 0.1);
      // Second beep (lower, after brief gap — classic double-beep)
      const osc2 = ctx.createOscillator();
      const g2 = ctx.createGain();
      osc2.type = "square";
      osc2.frequency.setValueAtTime(2200, ctx.currentTime + 0.12);
      g2.gain.setValueAtTime(0.25, ctx.currentTime + 0.12);
      g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
      osc2.connect(g2); g2.connect(ctx.destination);
      osc2.start(ctx.currentTime + 0.12); osc2.stop(ctx.currentTime + 0.22);
    } catch { /* audio not available */ }
  }, []);

  useFrame(({ clock }) => {
    if (!winRef.current || !laserRef.current || !lineOpacityRef.current || !sweepGroup.current) return;

    const t = clock.elapsedTime;
    const justTriggered = flashVisible && !prevFlash.current;
    prevFlash.current = flashVisible;

    if (justTriggered) {
      scanAnim.current = 1; // start sweep
      beep();
    }

    if (flashVisible && scanAnim.current === 1) {
      // Phase 1: laser line sweeps (0–0.5s)
      const sweepTime = Math.min((t - Math.floor(t / 3) * 3) % 3, 0.5);
      const sweep = Math.sin(sweepTime * 30) * 0.6; // rapid oscillation
      sweepGroup.current.rotation.y = sweep;

      // Laser pulse
      const lPulse = sweepTime < 0.3
        ? Math.sin(sweepTime * 40) * 0.5 + 0.5
        : 0;
      laserRef.current.emissiveIntensity = 3.0 + lPulse * 6.0;
      laserRef.current.opacity = 0.35 + lPulse * 0.5;
      lineOpacityRef.current.opacity = 0.9;
      lineOpacityRef.current.emissiveIntensity = 5.0 + lPulse * 5.0;

      // Window: bright red flash during beep
      if (sweepTime > 0.1 && sweepTime < 0.4) {
        winRef.current.color.setHex(0xff4444);
        winRef.current.emissive.setHex(0xff0000);
        winRef.current.emissiveIntensity = 4.0;
      } else if (sweepTime >= 0.4) {
        winRef.current.color.setHex(0xfacc15);
        winRef.current.emissive.setHex(0xfacc15);
        winRef.current.emissiveIntensity = 2.0;
      }

      // After 0.5s, lock to "done" until flashVisible ends
      if (sweepTime >= 0.5) {
        scanAnim.current = 2;
        sweepGroup.current.rotation.y = 0;
      }
    } else if (flashVisible && scanAnim.current === 2) {
      // Phase 2: settled, window glows brighter
      winRef.current.color.setHex(0xfacc15);
      winRef.current.emissive.setHex(0xfacc15);
      winRef.current.emissiveIntensity = 2.0;
      laserRef.current.emissiveIntensity = 3.0;
      laserRef.current.opacity = 0.35;
      lineOpacityRef.current.opacity = 0.9;
    } else {
      // Idle — dim steady laser
      scanAnim.current = 0;
      sweepGroup.current.rotation.y = 0;
      winRef.current.color.setHex(0xfacc15);
      winRef.current.emissive.setHex(0xfacc15);
      winRef.current.emissiveIntensity = 1.2;
      laserRef.current.emissiveIntensity = 2.0;
      laserRef.current.opacity = 0.25;
      lineOpacityRef.current.opacity = 0.6;
    }
  });

  return (
    <group position={[1.05, 2.0, 3.0]} rotation={[0, 0, 0]}>
      {/* Main body */}
      <mesh position={[0, -0.02, 0]}>
        <boxGeometry args={[0.35, 0.14, 0.45]} />
        <meshStandardMaterial color="#1a1a2e" metalness={0.7} roughness={0.3} />
      </mesh>
      {/* Scanner head — angled nose pointing toward camera */}
      <mesh position={[0, 0.04, 0.18]} rotation={[0.25, 0, 0]}>
        <boxGeometry args={[0.22, 0.1, 0.14]} />
        <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.25} />
      </mesh>
      {/* Scanning window — yellow glow at head tip */}
      <mesh position={[0, 0.023, 0.248]} rotation={[0.25, 0, 0]}>
        <boxGeometry args={[0.18, 0.07, 0.04]} />
        <meshStandardMaterial ref={winRef} color="#facc15" emissive="#facc15" emissiveIntensity={1.2} />
      </mesh>
      {/* Pistol grip — pointing down */}
      <mesh position={[0, -0.18, -0.06]} rotation={[0.1, 0, 0]}>
        <boxGeometry args={[0.08, 0.22, 0.1]} />
        <meshStandardMaterial color="#1a1a2e" metalness={0.4} roughness={0.6} />
      </mesh>
      {/* Trigger */}
      <mesh position={[0.07, -0.08, 0.04]}>
        <boxGeometry args={[0.04, 0.06, 0.04]} />
        <meshStandardMaterial color="#eab308" metalness={0.3} roughness={0.5} />
      </mesh>
      {/* Cable — loops down to station */}
      <mesh position={[0, -0.35, -0.1]} rotation={[0.3, 0, 0]}>
        <cylinderGeometry args={[0.025, 0.03, 0.4]} />
        <meshStandardMaterial color="#334155" />
      </mesh>

      {/* Laser assembly — positioned at window center, same angle */}
      <group ref={sweepGroup} position={[0, 0.023, 0.248]} rotation={[0.25, 0, 0]}>
        {/* Laser beam — thin red line extending forward from window */}
        <mesh position={[0, 0, 1.25]}>
          <boxGeometry args={[0.01, 0.01, 2.5]} />
          <meshStandardMaterial ref={laserRef} color="#ef4444" emissive="#ef4444" emissiveIntensity={2.0} transparent opacity={0.25} />
        </mesh>
        {/* Horizontal scan line — at far end of beam */}
        <mesh position={[0, 0, 2.5]}>
          <planeGeometry args={[2.0, 0.015]} />
          <meshStandardMaterial ref={lineOpacityRef} color="#ff2222" emissive="#ff0000" emissiveIntensity={4.0} transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
        {/* Scanned SN — projects from orifice along laser axis */}
        {sn && sn !== 'UNKNOWN' && (
          <Text
            position={[0, 0.1, 0.45]}
            fontSize={0.1}
            color="#22d3ee"
            anchorX="center"
            anchorY="middle"
            fontFamily="monospace"
            maxWidth={1.6}
          >
            {sn}
          </Text>
        )}
      </group>
    </group>
  );
}

// ── NG Block (small cube representing one NG item) ────────────────────────────
function NgBlock({ position, item, index, onClick }: { position: [number, number, number]; item: NgItem; index: number; onClick?: (item: NgItem) => void }) {
  const handleClick = (e: any) => {
    e.stopPropagation();
    console.log('NgBlock clicked:', item.sn, 'isConfirmed:', item.isConfirmed, 'defectCode:', item.defectCode);
    onClick?.(item);
  };

  return (
    <group position={position}>
      {/* Hit area - LARGE clickable box in front of everything */}
      <mesh
        position={[0, 0.08, 0.15]}
        onClick={handleClick}
        userData={{ ngItem: item }}
      >
        <boxGeometry args={[0.5, 0.35, 0.15]} />
        <meshStandardMaterial
          color="#fbbf24"
          emissive="#fbbf24"
          emissiveIntensity={0.5}
          transparent
          opacity={0.5}
        />
      </mesh>
      {/* Visible block - behind hit area */}
      <mesh position={[0, 0.08, 0]}>
        <boxGeometry args={[0.3, 0.2, 0.1]} />
        <meshStandardMaterial color="#ef4444" emissive="#dc2626" emissiveIntensity={0.4} />
      </mesh>
      {/* SN text */}
      <Text
        position={[0, 0.14, 0.05]}
        fontSize={0.055}
        color="#fff"
        anchorX="center"
        anchorY="middle"
        fontFamily="monospace"
        maxWidth={0.28}
      >
        {item.sn.slice(-4)}
      </Text>
    </group>
  );
}

// ── Batch Block — ICT NG batch display (HTML overlay for reliable click) ───────
function BatchBlock({ position, batch, onClick }: { position: [number, number, number]; batch: any; onClick?: (batch: any) => void }) {
  if (!batch) return null;
  const failBoards = (batch.subBoards || []).filter((b: any) => b.result === 'FAIL');
  const confirmedBoards = (batch.subBoards || []).filter((b: any) => b.isConfirmedNG);
  const blockColor = confirmedBoards.length > 0 ? '#7f1d1d' : '#dc2626';
  const borderColor = confirmedBoards.length > 0 ? '#f97316' : '#ef4444';

  return (
    <group position={position} userData={{ batch: true, batchData: batch }}>
      <mesh
        onClick={(e) => { e.stopPropagation(); onClick?.(batch); }}
        userData={{ batch: true, batchData: batch }}
      >
        <boxGeometry args={[0.9, 0.45, 0.1]} />
        <meshStandardMaterial color={blockColor} metalness={0.2} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0, 0.056]}>
        <planeGeometry args={[0.92, 0.47]} />
        <meshStandardMaterial color={borderColor} emissive={borderColor} emissiveIntensity={0.8} transparent opacity={0.9} />
      </mesh>
      <Text position={[0, 0.1, 0.065]} fontSize={0.085} color={borderColor} anchorX="center" anchorY="middle" fontFamily="monospace">
        {confirmedBoards.length > 0 ? 'CONFIRMED_NG' : 'NG BATCH'}
      </Text>
      <Text position={[0, 0.02, 0.065]} fontSize={0.065} color="#fbbf24" anchorX="center" anchorY="middle" maxWidth={0.85}>
        {batch.mainSn}
      </Text>
      <Text position={[0, -0.06, 0.065]} fontSize={0.055} color="#9ca3af" anchorX="center" anchorY="middle">
        {batch.batchId}
      </Text>
      <Text position={[0, -0.15, 0.065]} fontSize={0.05} color="#ef4444" anchorX="center" anchorY="middle">
        FAIL {failBoards.length}/{batch.slotCount} R:{batch.retestMax}x Age:{batch.ageHours}h
      </Text>
    </group>
  );
}

// ── Protected product box with NG/SN blocks display ──────────────────────────
function Bucket({ position, label, color, ngRecords, passRecords, needsAuth, birthStation, birthPlace, itemCount, onNgBlockClick, expanded, stationId, uiLanguage }: {
  position: [number, number, number];
  label: string;
  color: string;
  ngRecords?: NgRecord[];
  passRecords?: PassRecord[]; // for PASS bucket
  needsAuth?: boolean; // Aged NG requires admin auth to retest
  birthStation?: string; // station code for born info
  birthPlace?: string; // station name (Chinese) where first failed
  itemCount?: number; // explicit count (for PASS bucket)
  onNgBlockClick?: (item: NgItem) => void; // called when an NG block is clicked
  expanded?: boolean; // if true, blocks are visible; if false, blocks are hidden
  stationId?: number; // station ID for bucket identification
  uiLanguage: UiLanguage;
}) {
  const isAgedNg = label === 'Aged NG';
  const isPass = label === 'PASS';
  let items: NgItem[] = (ngRecords || []).map(r => toNgItem(r, label, birthStation, birthPlace));
  if (label === 'NG') items = items.filter(item => !item.isConfirmed && item.testCount <= 1 && !item.isAged);
  if (label === 'First Retest') items = items.filter(item => !item.isConfirmed && item.testCount === 2 && !item.isAged);
  if (label === 'Confirmed NG') items = items.filter(item => item.isConfirmed);
  if (isAgedNg) items = items.filter(item => !item.isConfirmed && item.isAged);
  // For PASS bucket, build items from passRecords
  if (isPass && passRecords) {
    items = passRecords.map(r => ({
      sn: r.sn,
      defectCode: 'PASS',
      defectDescription: r.stationName,
      operator: r.operator,
      testCount: 0,
      lastTestTime: r.time,
      isConfirmed: true,
      birthTime: r.time,
      birthStation: r.stationCode,
      birthPlace: r.stationName,
      ageHours: 0,
      retestRemaining: 0,
      isAged: false,
      label: 'PASS',
      batchId: r.batchId,
      slot: r.slot,
    }));
  }
  // NG lifecycle buckets count physical motherboards, not loose daughterboards.
  const motherboardCount = new Set(items.map(item => item.batchId || item.sn)).size;
  const displayCount = itemCount ?? (isPass ? items.length : motherboardCount);

  // Hover state for tooltip
  const [hovered, setHovered] = useState(false);

  return (
    <group
      position={position}
      onPointerEnter={(e) => { e.stopPropagation(); setHovered(true); }}
      onPointerLeave={(e) => { e.stopPropagation(); setHovered(false); }}
      userData={{ bucket: true, stationId: stationId || 0, label }}
    >
      {/* Industrial product tote: open rectangular box, never a waste bucket. */}
      <group scale={0.65}>
        <mesh position={[0, 0.08, 0]} castShadow>
          <boxGeometry args={[1.05, 0.12, 0.72]} />
          <meshStandardMaterial color="#334155" metalness={0.12} roughness={0.78} />
        </mesh>
        <mesh position={[0, 0.37, -0.33]} castShadow>
          <boxGeometry args={[1.05, 0.58, 0.08]} />
          <meshStandardMaterial color="#475569" roughness={0.68} />
        </mesh>
        <mesh position={[-0.49, 0.37, 0]} castShadow>
          <boxGeometry args={[0.08, 0.58, 0.72]} />
          <meshStandardMaterial color="#475569" roughness={0.68} />
        </mesh>
        <mesh position={[0.49, 0.37, 0]} castShadow>
          <boxGeometry args={[0.08, 0.58, 0.72]} />
          <meshStandardMaterial color="#475569" roughness={0.68} />
        </mesh>
        <mesh position={[0, 0.2, 0.33]} castShadow>
          <boxGeometry args={[1.05, 0.24, 0.08]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.12} roughness={0.62} />
        </mesh>
        {/* Reinforced color-coded top rails */}
        <mesh position={[0, 0.68, -0.34]}>
          <boxGeometry args={[1.12, 0.07, 0.09]} />
          <meshStandardMaterial color={color} metalness={0.15} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.34, 0.38]}>
          <boxGeometry args={[1.12, 0.07, 0.09]} />
          <meshStandardMaterial color={color} metalness={0.15} roughness={0.5} />
        </mesh>
        {/* Product-box label */}
        <Text
          position={[0, 0.2, 0.385]}
          fontSize={0.13}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
          fontFamily="monospace"
        >
          {`${bucketText(label, uiLanguage)} BOX`}
        </Text>
        {/* Count badge - show for all buckets */}
        <Text
          position={[0, 0.76, 0]}
          fontSize={0.14}
          color={displayCount > 0 ? "#fbbf24" : "#6b7280"}
          anchorX="center"
          anchorY="middle"
        >
          {displayCount}
        </Text>
        {/* Auth required icon for Aged NG */}
        {needsAuth && (
          <Text
            position={[0.3, 0.65, 0]}
            fontSize={0.14}
            color="#fbbf24"
            anchorX="center"
            anchorY="middle"
          >
            🔒
          </Text>
        )}
        {/* Expand indicator - show arrow when collapsed */}
        {!expanded && displayCount > 0 && (
          <Text
            position={[0, 0.85, 0]}
            fontSize={0.16}
            color="#94a3b8"
            anchorX="center"
            anchorY="middle"
          >
            ▼
          </Text>
        )}
      </group>
      {/* NG blocks container shown via HTML overlay - 3D bucket just shows tooltip */}
      {/* Hover tooltip - context-aware */}
      {hovered && (
        <Text
          position={[0, 1.1, 0]}
          fontSize={0.22}
          color="#22d3ee"
          anchorX="center"
          anchorY="middle"
          fontFamily="monospace"
          outlineWidth={0.015}
          outlineColor="#0f172a"
        >
          {expanded ? '点击隐藏' : '点击显示'}
        </Text>
      )}
    </group>
  );
}

// ── Single Station ───────────────────────────────────────────────────────────
// ── Floating SN (rises up slowly + fades out over 3s) ─────────────────────────
function FloatingSn({ sn, scannedAt }: { sn: string; scannedAt: number }) {
  const textRef = useRef<any>(null);
  const startRef = useRef(scannedAt);

  useEffect(() => { startRef.current = scannedAt; }, [scannedAt]);

  useFrame(() => {
    if (!textRef.current) return;
    const elapsed = Date.now() - startRef.current;
    const t = Math.min(elapsed / 3000, 1);
    const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
    const y = -0.3 + 1.8 * ease;
    const opacity = Math.max(0, 1 - ease);

    textRef.current.position.y = y;
    if (textRef.current.material) {
      textRef.current.material.opacity = opacity;
      textRef.current.material.transparent = true;
    }
  });

  return (
    <Text
      ref={textRef}
      position={[0, -0.3, 0.99]}
      fontSize={0.22}
      color="#22d3ee"
      anchorX="center"
      anchorY="middle"
      fontFamily="monospace"
      maxWidth={1.8}
    >
      {sn}
    </Text>
  );
}

type LineBoardSlot = {
  slot: number; sn: string; result: 'PASS' | 'FAIL' | 'EMPTY'; defectCode?: string;
  ngType?: 'ICT' | 'FCT' | 'ICT+FCT' | 'NG';
};

function lineBoardChildren(record: any): any[] {
  if (!record || typeof record !== 'object') return [];
  for (const value of [record.subBoards, record.members, record.boards, record.motherboard?.subBoards]) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function lineBoardTime(record: any): number {
  const raw = record?.updatedAt ?? record?.time ?? record?.testedAt ?? record?.sourceTestTimeIso
    ?? record?.batchEnd ?? record?.testCycleId ?? record?.batchId ?? 0;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(raw || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function lineBoardNgType(row: any): LineBoardSlot['ngType'] {
  const explicit = String(row?.ngType || row?.defectType || row?.defectCode || row?.errorCode || '').toUpperCase();
  const failedStations = (Array.isArray(row?.stationResults) ? row.stationResults : [])
    .filter((item: any) => /FAIL|NG/.test(String(item?.finalResult || item?.result || '').toUpperCase()))
    .map((item: any) => String(item?.stationCode || '').toLowerCase());
  const ict = failedStations.some((code: string) => code.includes('ict')) || explicit.includes('ICT');
  const fct = failedStations.some((code: string) => code.includes('fct')) || explicit.includes('FCT');
  if (ict && fct) return 'ICT+FCT';
  if (ict) return 'ICT';
  if (fct) return 'FCT';
  return 'NG';
}

function buildLineBoardView(stationCode: string, rawBatch: any, passed: any[] = [], pending: any[] = [], confirmed: any[] = []) {
  const rawBoard = rawBatch && (lineBoardChildren(rawBatch).length || (rawBatch.sn && rawBatch.slot)) ? rawBatch : null;
  // auto_fct: if confirmed is empty but pending has data, use pending as fallback (handles version-filter skip case)
  const effectiveConfirmed = (stationCode === 'auto_fct' && confirmed.length === 0 && pending.length > 0) ? pending : confirmed;
  const records = [rawBoard, ...effectiveConfirmed, ...pending, ...passed].filter(Boolean);
  const batches = new Map<string, { batchId: string; rows: any[]; time: number; priority: number }>();
  records.forEach((record: any, recordIndex) => {
    const children = lineBoardChildren(record);
    const rows = children.length ? children : [record];
    const batchId = String(record?.batchId || record?.motherboardId || record?.testCycleId
      || record?.ictBatchId || record?.fctBatchId || rows[0]?.batchId || rows[0]?.motherboardId || 'WAITING');
    const current = batches.get(batchId) || { batchId, rows: [], time: 0, priority: 0 };
    current.rows.push(...rows);
    current.time = Math.max(current.time, lineBoardTime(record), ...rows.map(lineBoardTime));
    current.priority = Math.max(current.priority, recordIndex === 0 && rawBoard ? 2 : children.length ? 1 : 0);
    batches.set(batchId, current);
  });
  const selected = [...batches.values()].sort((a, b) => b.time - a.time || b.priority - a.priority)[0];
  const bySlot = new Map<number, LineBoardSlot & { time: number }>();
  (selected?.rows || []).forEach((row: any, index: number) => {
    const channel = String(row?.channel || row?.position || '').toUpperCase();
    const match = /^([LR])(?:0?)([1-9]|1[0-2])$/.exec(channel);
    const channelSlot = match ? Number(match[2]) + (match[1] === 'R' && Number(match[2]) <= 8 ? 8 : 0) : 0;
    const slot = Math.max(1, Math.min(12, Number(row?.slot || channelSlot || index + 1)));
    const rawResult = String(row?.finalResult || row?.result || row?.overallResult || 'PASS').toUpperCase();
    const result: LineBoardSlot['result'] = /FAIL|NG|NOK/.test(rawResult) ? 'FAIL' : 'PASS';
    const time = lineBoardTime(row) || index;
    const prior = bySlot.get(slot);
    if (!prior || time >= prior.time || (result === 'FAIL' && prior.result !== 'FAIL')) {
      bySlot.set(slot, { slot, sn: String(row?.sn || row?.pcbSerial || row?.boardSn || ''), result,
        defectCode: String(row?.defectCode || row?.errorCode || ''),
        ngType: result === 'FAIL' && stationCode.includes('depanel') ? lineBoardNgType(row) : undefined, time });
    }
  });
  return { batchId: selected?.batchId || 'WAITING', slots: Array.from({ length: 12 }, (_, index): LineBoardSlot => {
    const value = bySlot.get(index + 1);
    return value ? { slot: value.slot, sn: value.sn, result: value.result, defectCode: value.defectCode, ngType: value.ngType }
      : { slot: index + 1, sn: '', result: 'EMPTY' };
  }) };
}

function AnimatedStationMechanism({ stationCode, running }: { stationCode: string; running: boolean }) {
  const movingRef = useRef<THREE.Group>(null);
  const productRef = useRef<THREE.Mesh>(null);
  const wheelRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime;
    const activity = running ? 1 : 0.28;
    if (movingRef.current) {
      if (stationCode === 'manu_supersonic') {
        movingRef.current.position.y = 1.48 + (Math.sin(t * 3.2) * 0.5 + 0.5) * 0.42 * activity;
      } else if (stationCode === 'manu_depanel') {
        movingRef.current.position.x = Math.sin(t * 2.4) * 0.55 * activity;
      } else {
        movingRef.current.rotation.y = Math.sin(t * 2.1) * 0.18 * activity;
      }
    }
    if (productRef.current) {
      const travel = ((t * (running ? 0.42 : 0.12)) % 1) * 2 - 1;
      productRef.current.position.x = travel * 1.45;
    }
    if (wheelRef.current) wheelRef.current.rotation.z -= delta * (running ? 5 : 1.1);
  });

  if (stationCode === 'manu_aio' || stationCode === 'wave_solder') {
    return (
      <mesh ref={productRef} position={[-1.4, 0.91, 0]} castShadow>
        <boxGeometry args={[0.62, 0.05, 0.46]} />
        <meshStandardMaterial color="#159447" emissive="#064e3b" emissiveIntensity={0.18} />
      </mesh>
    );
  }
  if (stationCode === 'manu_depanel') {
    return (
      <group ref={movingRef} position={[0, 1.6, 0.45]}>
        <mesh><boxGeometry args={[0.4, 0.18, 0.38]} /><meshStandardMaterial color="#f59e0b" metalness={0.7} /></mesh>
        <mesh ref={wheelRef} position={[0, -0.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.18, 0.18, 0.04, 20]} /><meshStandardMaterial color="#d1d5db" metalness={0.9} />
        </mesh>
      </group>
    );
  }
  if (stationCode === 'manu_supersonic') {
    return (
      <group ref={movingRef} position={[0, 1.48, 0]}>
        <mesh><cylinderGeometry args={[0.14, 0.2, 0.52, 18]} /><meshStandardMaterial color="#cbd5e1" metalness={0.72} /></mesh>
        <mesh position={[0, -0.32, 0]}><cylinderGeometry args={[0.08, 0.08, 0.16, 16]} /><meshStandardMaterial color="#fbbf24" metalness={0.55} /></mesh>
      </group>
    );
  }
  if (['manu_assem_ate', 'manu_hivolt_ate', 'manu_package_ate', 'manu_shellbinding'].includes(stationCode)) {
    return (
      <group ref={movingRef} position={[0, 1.31, 0.28]}>
        <mesh position={[-0.2, 0, 0]}><boxGeometry args={[0.12, 0.25, 0.42]} /><meshStandardMaterial color="#f59e0b" metalness={0.55} /></mesh>
        <mesh position={[0.2, 0, 0]}><boxGeometry args={[0.12, 0.25, 0.42]} /><meshStandardMaterial color="#f59e0b" metalness={0.55} /></mesh>
      </group>
    );
  }
  return null;
}

function StationBox({ station, onClick, onNgBlockClick, onBatchClick, onClearIctData, flash, wsConnected, stats, ngRecords, realNgRecords, passRecords, rawBatch, expandedBuckets, onBucketToggle, uiLanguage, bindingMatch, containerData, flowCounts, repairSummary }: { station: Station; onClick: (s: Station) => void; onNgBlockClick: (item: NgItem) => void; onBatchClick?: (batch: any) => void; onClearIctData?: () => void; flash?: { sn: string; scannedAt: number; batchId?: string }; wsConnected?: boolean; stats?: { total: number; pass: number; fail: number; dup: number }; ngRecords?: NgRecord[]; realNgRecords?: NgRecord[]; passRecords?: PassRecord[]; rawBatch?: any; expandedBuckets: Record<string, boolean>; onBucketToggle: (stationId: number, label: string) => void; uiLanguage: UiLanguage; bindingMatch?: { shellSn?: string; boardSn?: string }; containerData?: any; flowCounts?: { enter: number; exit: number }; repairSummary?: { waitingReceipt: number; inProgress: number; waitingReturn: number; closed: number; total: number } }) {
  const lightRef = useRef<THREE.PointLight>(null);
  const statusMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  // WS connected = bright cyan (station exe running + WS broadcasting)
  // WS disconnected = gray (offline)
  const color = wsConnected ? "#22d3ee" : "#6b7280";
  const isOnline = !!wsConnected;
  const duplicateSn = /^(DUP|DUP_ACK):/.test(flash?.sn || '')
    ? (flash?.sn || '').replace(/^(DUP|DUP_ACK):/, '')
    : '';
  const duplicateReleasedByAgent = flash?.sn?.startsWith('DUP_ACK:') || false;
  const duplicateSns = duplicateSn ? duplicateSn.split('|').filter(Boolean) : [];
  const duplicateSnGrid = Array.from({ length: Math.ceil(duplicateSns.length / 3) }, (_, row) =>
    duplicateSns.slice(row * 3, row * 3 + 3).join('   ')
  ).join('\n');
  const [duplicateAlarmAcknowledged, setDuplicateAlarmAcknowledged] = useState(false);
  const isFctMachine = station.code === 'manu_fct';
  const isDepanelMachine = station.code === 'manu_depanel';
  const isWaveMachine = station.code === 'wave_solder';
  const isAoiMachine = station.code === 'manu_aio';
  const isAgingController = station.code === 'manu_agingcab';
  const isManualBenchStation = ['manu_shellbinding', 'manu_assem_ate', 'manu_supersonic', 'manu_hivolt_ate', 'manu_package_ate', 'manu_case_binding', 'manu_pallet_binding'].includes(station.code);

  useEffect(() => {
    if (duplicateSn) setDuplicateAlarmAcknowledged(duplicateReleasedByAgent);
  }, [duplicateSn, duplicateReleasedByAgent, flash?.scannedAt]);

  const releaseDuplicateAlarm = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    setDuplicateAlarmAcknowledged(true);
    window.speechSynthesis?.cancel();
  };

  useFrame(({ clock }) => {
    const duplicateAlarm = Boolean(
      duplicateSn && !duplicateAlarmAcknowledged
    );
    if (lightRef.current) {
      if (duplicateAlarm) {
        const alarmOn = Math.sin(clock.elapsedTime * 14) > 0;
        const alarmColor = alarmOn ? '#ef4444' : '#fbbf24';
        lightRef.current.color.set(alarmColor);
        lightRef.current.intensity = alarmOn ? 5 : 0.4;
        statusMaterialRef.current?.color.set(alarmColor);
        statusMaterialRef.current?.emissive.set(alarmColor);
        if (statusMaterialRef.current) statusMaterialRef.current.emissiveIntensity = alarmOn ? 3 : 0.5;
      } else {
        const pulse = Math.sin(clock.elapsedTime * 2 + station.id) * 0.15 + 0.85;
        lightRef.current.color.set(color);
        lightRef.current.intensity = isOnline ? pulse * 2.0 : 0.3;
        statusMaterialRef.current?.color.set(color);
        statusMaterialRef.current?.emissive.set(color);
        if (statusMaterialRef.current) statusMaterialRef.current.emissiveIntensity = 1.5;
      }
    }
  });

  return (
    <group position={stationScenePosition(station)} onClick={(e) => { e.stopPropagation(); onClick(station); }} userData={{ stationId: station.id }}>
      {isWaveMachine ? (
        <group>
          {/* Long enclosed wave-solder body seen at the beginning of the line. */}
          <mesh position={[0, 1.15, 0]} castShadow receiveShadow><boxGeometry args={[4.6, 2.3, 2.0]} /><meshStandardMaterial color="#dce3e7" metalness={0.38} roughness={0.35} /></mesh>
          <mesh position={[-1.15, 1.45, 1.02]}><boxGeometry args={[1.35, 0.72, 0.06]} /><meshStandardMaterial color="#111827" emissive="#0ea5e9" emissiveIntensity={0.18} /></mesh>
          <mesh position={[1.25, 1.55, 1.04]}><boxGeometry args={[0.62, 0.42, 0.05]} /><meshStandardMaterial color="#082f49" emissive="#38bdf8" emissiveIntensity={0.55} /></mesh>
          {[-1.7,-0.6,0.6,1.7].map(x => <mesh key={x} position={[x,0.12,0]}><cylinderGeometry args={[0.1,0.1,0.24,12]} /><meshStandardMaterial color="#111827" /></mesh>)}
        </group>
      ) : isAoiMachine ? (
        <group>
          {/* White/blue AOI inspection cell with front monitor and infeed. */}
          <mesh position={[0, 1.2, 0]} castShadow receiveShadow><boxGeometry args={[2.65, 2.4, 2.0]} /><meshStandardMaterial color="#e5eaed" metalness={0.35} roughness={0.32} /></mesh>
          <mesh position={[0, 2.28, 0]}><boxGeometry args={[2.65, 0.28, 2.02]} /><meshStandardMaterial color="#1686b8" metalness={0.3} /></mesh>
          <mesh position={[0.62, 1.55, 1.02]}><boxGeometry args={[0.82, 0.58, 0.06]} /><meshStandardMaterial color="#081c28" emissive="#22d3ee" emissiveIntensity={0.35} /></mesh>
          <mesh position={[-1.9, 0.78, 0]}><boxGeometry args={[1.25, 0.16, 1.25]} /><meshStandardMaterial color="#1e8a55" metalness={0.25} /></mesh>
          <mesh position={[1.9, 0.78, 0]}><boxGeometry args={[1.25, 0.16, 1.25]} /><meshStandardMaterial color="#1e8a55" metalness={0.25} /></mesh>
        </group>
      ) : isAgingController ? (
        <group>
          {/* The seven full cabinets are modeled by ManualLineHall; this is the shared operator terminal. */}
          <mesh position={[0, 0.9, -1.2]} castShadow><boxGeometry args={[1.25, 1.8, 0.75]} /><meshStandardMaterial color="#d9dee2" metalness={0.32} /></mesh>
          <mesh position={[0, 1.18, -0.81]}><boxGeometry args={[0.78, 0.5, 0.04]} /><meshStandardMaterial color="#071827" emissive="#22d3ee" emissiveIntensity={0.32} /></mesh>
        </group>
      ) : isManualBenchStation ? (
        <group>
          {/* Individual tester/fixture placed on the real green shared bench. */}
          <mesh position={[0, 1.08, 0]} castShadow><boxGeometry args={[1.45, 0.38, 1.05]} /><meshStandardMaterial color={station.code === 'manu_supersonic' ? '#374151' : '#e2e8f0'} metalness={0.35} roughness={0.38} /></mesh>
          <mesh position={[0.48, 1.38, -0.12]}><boxGeometry args={[0.48, 0.38, 0.06]} /><meshStandardMaterial color="#082f49" emissive="#38bdf8" emissiveIntensity={0.42} /></mesh>
          <mesh position={[-0.38, 1.34, 0]}><cylinderGeometry args={[0.12,0.16,0.45,16]} /><meshStandardMaterial color={station.code === 'manu_supersonic' ? '#111827' : '#94a3b8'} metalness={0.58} /></mesh>
          <mesh position={[0, 0.42, 1.1]}><cylinderGeometry args={[0.28,0.28,0.08,18]} /><meshStandardMaterial color="#111827" /></mesh>
          <mesh position={[0, 0.2, 1.1]}><cylinderGeometry args={[0.035,0.035,0.44,10]} /><meshStandardMaterial color="#64748b" metalness={0.7} /></mesh>
        </group>
      ) : isFctMachine ? (
        <group>
          {/* FCT: tall enclosed electrical tester with a dark test chamber. */}
          <mesh position={[0, 1.1, 0]} castShadow receiveShadow>
            <boxGeometry args={[2.45, 2.2, 1.75]} />
            <meshStandardMaterial color="#d7dee7" metalness={0.45} roughness={0.32} />
          </mesh>
          <mesh position={[0, 1.35, 0.89]}>
            <boxGeometry args={[1.72, 1.05, 0.09]} />
            <meshStandardMaterial color="#071827" emissive="#0e7490" emissiveIntensity={0.18} metalness={0.2} />
          </mesh>
          <mesh position={[0.7, 1.75, 0.96]}>
            <boxGeometry args={[0.42, 0.3, 0.08]} />
            <meshStandardMaterial color="#082f49" emissive="#22d3ee" emissiveIntensity={0.55} />
          </mesh>
          <mesh position={[0, 0.58, 0.96]}>
            <boxGeometry args={[1.72, 0.12, 0.25]} />
            <meshStandardMaterial color="#334155" metalness={0.65} />
          </mesh>
          {[-0.92, 0.92].map(x => <mesh key={x} position={[x, 0.08, 0]}><cylinderGeometry args={[0.09, 0.09, 0.18, 12]} /><meshStandardMaterial color="#111827" /></mesh>)}
        </group>
      ) : isDepanelMachine ? (
        <group>
          {/* Depanel: low cutting enclosure with long in/out conveyors. */}
          <mesh position={[0, 0.95, 0]} castShadow receiveShadow>
            <boxGeometry args={[2.6, 1.65, 2.05]} />
            <meshStandardMaterial color="#35566b" metalness={0.55} roughness={0.3} />
          </mesh>
          <mesh position={[0, 1.22, 1.05]}>
            <boxGeometry args={[1.55, 0.78, 0.1]} />
            <meshStandardMaterial color="#10212c" emissive="#f59e0b" emissiveIntensity={0.12} />
          </mesh>
          {[-2.15, 2.15].map(x => (
            <group key={x} position={[x, 0.72, 0]}>
              <mesh><boxGeometry args={[1.7, 0.16, 1.15]} /><meshStandardMaterial color="#64748b" metalness={0.75} /></mesh>
              {[-0.55, -0.18, 0.18, 0.55].map(z => <mesh key={z} position={[0, 0.1, z]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.055, 0.055, 1.55, 10]} /><meshStandardMaterial color="#94a3b8" metalness={0.8} /></mesh>)}
            </group>
          ))}
          <mesh position={[0, 1.82, 0]}><boxGeometry args={[1.25, 0.28, 1.15]} /><meshStandardMaterial color="#1e293b" metalness={0.6} /></mesh>
          <mesh position={[0, 1.82, 0.59]}><boxGeometry args={[0.65, 0.18, 0.06]} /><meshStandardMaterial color="#3f2508" emissive="#f59e0b" emissiveIntensity={0.7} /></mesh>
        </group>
      ) : (
        <group>
          <mesh position={[0, 1, 0]} castShadow receiveShadow><boxGeometry args={[2.2, 2, 1.8]} /><meshStandardMaterial color="#5a6a7a" metalness={0.1} roughness={0.7} /></mesh>
          <mesh position={[0, 2.1, 0]} castShadow><boxGeometry args={[2, 0.1, 1.6]} /><meshStandardMaterial color="#7a8a9a" metalness={0.2} roughness={0.6} /></mesh>
          <mesh position={[0, 2.0, 0]} receiveShadow><boxGeometry args={[2.3, 0.05, 1.9]} /><meshStandardMaterial color="#8ab4f8" emissive="#8ab4f8" emissiveIntensity={0.15} /></mesh>
        </group>
      )}
      <AnimatedStationMechanism stationCode={station.code} running={isOnline} />
      <mesh
        position={[0, 2.35, 0]}
        onClick={(event) => {
          if (!duplicateSn) return;
          releaseDuplicateAlarm(event);
        }}
        onPointerOver={() => { if (duplicateSn) document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { document.body.style.cursor = 'default'; }}
      >
        <sphereGeometry args={[0.22, 12, 12]} />
        <meshStandardMaterial ref={statusMaterialRef} color={color} emissive={color} emissiveIntensity={1.5} />
      </mesh>
      <pointLight ref={lightRef} position={[0, 2.35, 0]} color={color} distance={4} />

      {/* 人流热力图指示器：位于状态球下方，显示进出平衡 */}
      {flowCounts && (flowCounts.enter > 0 || flowCounts.exit > 0) && (() => {
        const imb = flowCounts.enter - flowCounts.exit;
        // 计算颜色：进多=绿(0,1,0)，平衡=黄(1,1,0)，出多=红(1,0,0)
        const ratio = Math.max(-1, Math.min(1, imb / Math.max(1, Math.max(flowCounts.enter, flowCounts.exit))));
        const r = ratio <= 0 ? 1 : 1 - ratio;
        const g = ratio >= 0 ? 1 : 1 + ratio;
        const b = 0;
        const heatColor = `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*180)})`;
        return (
          <group position={[1.4, 2.35, 0]}>
            {/* 背景黑框 */}
            <mesh position={[0, 0, -0.01]}>
              <boxGeometry args={[0.7, 0.55, 0.02]} />
              <meshStandardMaterial color="#1a1a2e" metalness={0.5} roughness={0.5} />
            </mesh>
            {/* 进出条形 */}
            <mesh position={[0, 0, 0]}>
              <boxGeometry args={[0.6, 0.08, 0.03]} />
              <meshStandardMaterial color={heatColor} emissive={heatColor} emissiveIntensity={1.2} />
            </mesh>
            {/* 进入数 */}
            <Text position={[0, 0.18, 0]} fontSize={0.13} color="#4ade80" anchorX="center" anchorY="middle">
              {flowCounts.enter}进
            </Text>
            {/* 离开数 */}
            <Text position={[0, -0.18, 0]} fontSize={0.13} color="#f87171" anchorX="center" anchorY="middle">
              {flowCounts.exit}离
            </Text>
          </group>
        );
      })()}

      {/* 分板机上方显示母板PASS/NG布局 */}
      {station.code === 'manu_depanel' && (() => {
        const list = moduleStationSnLists['manu_depanel'] || [];
        const latestPanel = list[0];
        if (!latestPanel) return null;
        // 从ICT/FCT历史批次数据中查找该母板的子板状态
        const ictBatch = Object.values(rawBatch || {}).find((b: any) => b.mainSn === latestPanel.sn || b.batchId === latestPanel.sn);
        const subBoards: any[] = (ictBatch as any)?.subBoards || [];
        return (
          <group position={[0, 3.1, 0]}>
            <mesh position={[0, 0, -0.01]}>
              <boxGeometry args={[3.6, 0.8, 0.04]} />
              <meshStandardMaterial color="#0f172a" metalness={0.4} roughness={0.6} />
            </mesh>
            <mesh position={[0, 0.36, 0]}>
              <boxGeometry args={[3.6, 0.08, 0.05]} />
              <meshStandardMaterial color="#a855f7" emissive="#a855f7" emissiveIntensity={0.9} />
            </mesh>
            <Text position={[0, 0.22, 0.02]} fontSize={0.13} color="#c084fc" anchorX="center" anchorY="middle" fontFamily="monospace">
              分板机 · {latestPanel.sn}
            </Text>
            {subBoards.length > 0 ? (
              <>
                {subBoards.slice(0, 12).map((board: any, i: number) => {
                  const isFail = board.result === 'FAIL';
                  const col = i % 6;
                  const row = Math.floor(i / 6);
                  return (
                    <mesh key={i} position={[-1.35 + col * 0.45, -0.05 - row * 0.22, 0.02]}>
                      <boxGeometry args={[0.38, 0.16, 0.03]} />
                      <meshStandardMaterial color={isFail ? "#ef4444" : "#22c55e"} emissive={isFail ? "#ef4444" : "#22c55e"} emissiveIntensity={isFail ? 0.7 : 0.4} />
                    </mesh>
                  );
                })}
                <Text position={[0, -0.32, 0.02]} fontSize={0.11} color="#4ade80" anchorX="center" anchorY="middle">
                  {`✓ ${subBoards.filter((b: any) => b.result !== 'FAIL').length} 良品`}
                </Text>
                <Text position={[-0.8, -0.32, 0.02]} fontSize={0.11} color="#f87171" anchorX="center" anchorY="middle">
                  {`✗ ${subBoards.filter((b: any) => b.result === 'FAIL').length} 不良品`}
                </Text>
              </>
            ) : (
              <Text position={[0, -0.1, 0.02]} fontSize={0.11} color="#94a3b8" anchorX="center" anchorY="middle">
                等待ICT/FCT批次数据...
              </Text>
            )}
          </group>
        );
      })()}

      {/* 绑码显示绑定过程 */}
      {station.code === 'manu_shellbinding' && bindingMatch && (() => {
        return (
          <group position={[0, 3.1, 0]}>
            <mesh position={[0, 0, -0.01]}>
              <boxGeometry args={[3.6, 0.6, 0.04]} />
              <meshStandardMaterial color="#0f172a" metalness={0.4} roughness={0.6} />
            </mesh>
            <mesh position={[0, 0.26, 0]}>
              <boxGeometry args={[3.6, 0.08, 0.05]} />
              <meshStandardMaterial color="#06b6d4" emissive="#06b6d4" emissiveIntensity={0.9} />
            </mesh>
            <Text position={[0, 0.16, 0.02]} fontSize={0.12} color="#22d3ee" anchorX="center" anchorY="middle" fontFamily="monospace">
              绑定中 · {bindingMatch.shellSn || '—'}
            </Text>
            <Text position={[0, 0, 0.02]} fontSize={0.12} color="#4ade80" anchorX="center" anchorY="middle" fontFamily="monospace">
              ✓ {bindingMatch.boardSn || '—'}
            </Text>
            <Text position={[0, -0.15, 0.02]} fontSize={0.1} color="#64748b" anchorX="center" anchorY="middle">
              {bindingMatch.boardSn ? '绑定完成' : '等待扫码...'}
            </Text>
          </group>
        );
      })()}

      {/* ATE显示8块SN状态 */}
      {station.code === 'manu_assem_ate' && (() => {
        const list = moduleStationSnLists['manu_assem_ate'] || [];
        return (
          <group position={[0, 3.1, 0]}>
            <mesh position={[0, 0, -0.01]}>
              <boxGeometry args={[3.6, 0.8, 0.04]} />
              <meshStandardMaterial color="#0f172a" metalness={0.4} roughness={0.6} />
            </mesh>
            <mesh position={[0, 0.36, 0]}>
              <boxGeometry args={[3.6, 0.08, 0.05]} />
              <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={0.9} />
            </mesh>
            <Text position={[0, 0.22, 0.02]} fontSize={0.13} color="#fbbf24" anchorX="center" anchorY="middle" fontFamily="monospace">
              ATE 组装 · {list.length}/8
            </Text>
            {list.slice(0, 8).map((e, i) => {
              const isFail = e.result === 'FAIL';
              const col = i % 4;
              const row = Math.floor(i / 4);
              return (
                <mesh key={i} position={[-0.75 + col * 0.4, -0.05 - row * 0.3, 0.02]}>
                  <boxGeometry args={[0.34, 0.24, 0.03]} />
                  <meshStandardMaterial color={isFail ? "#ef4444" : "#22c55e"} emissive={isFail ? "#ef4444" : "#22c55e"} emissiveIntensity={isFail ? 0.7 : 0.4} />
                </mesh>
              );
            })}
            <Text position={[0, -0.32, 0.02]} fontSize={0.1} color="#4ade80" anchorX="center" anchorY="middle">
              {`✓ ${list.filter(e => e.result !== 'FAIL').length}`}
            </Text>
            <Text position={[-0.6, -0.32, 0.02]} fontSize={0.1} color="#f87171" anchorX="center" anchorY="middle">
              {`✗ ${list.filter(e => e.result === 'FAIL').length}`}
            </Text>
          </group>
        );
      })()}

      {/* ICT/FCT/分板机 工位上方垂直母板 — 朝向 +Z */}
      {(station.code === 'manu_ict' || station.code === 'auto_ict' || station.code === 'manu_fct' || station.code === 'auto_fct' || station.code === 'manu_depanel' || station.code === 'auto_depanel') && (() => {
        const isIct = station.code.includes('ict');
        const isFct = station.code.includes('fct');
        const isDepanel = station.code.includes('depanel');
        const boardView = buildLineBoardView(station.code, rawBatch, passRecords || [], ngRecords || [], realNgRecords || []);
        const occupied = boardView.slots.filter(slot => slot.result !== 'EMPTY');
        const passCount = occupied.filter(slot => slot.result === 'PASS').length;
        const failCount = occupied.filter(slot => slot.result === 'FAIL').length;
        const hasData = occupied.length > 0;
        const panelW = 2.8;
        const panelH = 2.2;
        const panelD = 0.08;
        const colW = panelW / 4.6;
        const rowH = panelH / 3.6;
        return (
          <group position={[0, 4.2, 0]}>
            <RoundedBox args={[panelW, panelH, panelD]} radius={0.06} smoothness={3} castShadow>
              <meshStandardMaterial color="#052e25" metalness={0.28} roughness={0.48} />
            </RoundedBox>
            <RoundedBox args={[panelW - 0.08, panelH - 0.08, panelD * 0.5]} radius={0.04} smoothness={3}>
              <meshStandardMaterial color="#07835f" metalness={0.22} roughness={0.5} transparent opacity={0.6} />
            </RoundedBox>
            <Text position={[0, panelH / 2 - 0.15, panelD / 2 + 0.02]} fontSize={0.11} color="#38bdf8" anchorX="center" anchorY="middle">
              {`${isIct ? 'ICT' : isFct ? 'FCT' : isDepanel ? '分板' : ''} · ${boardView.batchId}`}
            </Text>
            {boardView.slots.map((sd, i) => {
              const slotNum = sd.slot;
              const col = i % 4;
              const row = Math.floor(i / 4);
              const x = -panelW / 2 + colW + col * colW;
              const y = panelH / 2 - rowH - row * rowH;
              const isEmpty = sd.result === 'EMPTY';
              const isFail = sd.result === 'FAIL';
              const color = isFail ? '#ef4444' : isEmpty ? '#334155' : '#22c55e';
              const eIntensity = isFail ? 0.6 : isEmpty ? 0 : 0.12;
              return (
                <group key={slotNum} position={[x, y + 0.08, panelD / 2 + 0.03]}>
                  <RoundedBox args={[colW * 0.7, rowH * 0.5, 0.03]} radius={0.02} smoothness={2} castShadow>
                    <meshStandardMaterial color={color} emissive={color} emissiveIntensity={eIntensity} roughness={0.42} />
                  </RoundedBox>
                  <Text position={[0, rowH * 0.32, 0.025]} fontSize={0.07} color="#ffffff" anchorX="center" anchorY="middle">
                    {`S${String(slotNum).padStart(2, '0')}${isFail ? ` ${sd.ngType || 'NG'}` : ''}`}
                  </Text>
                  {!isEmpty && (
                    <Text position={[0, -rowH * 0.12, 0.025]} fontSize={0.05} color={isFail ? '#fca5a5' : '#86efac'} anchorX="center" anchorY="middle">
                      {sd.sn.length > 10 ? sd.sn.slice(-10) : sd.sn}
                    </Text>
                  )}
                  {isEmpty && (
                    <Text position={[0, 0, 0.025]} fontSize={0.06} color="#64748b" anchorX="center" anchorY="middle">
                      --
                    </Text>
                  )}
                </group>
              );
            })}
            {hasData && (
              <Text position={[0, -panelH / 2 + 0.12, panelD / 2 + 0.02]} fontSize={0.08} color="#4ade80" anchorX="center" anchorY="middle">
                {`PASS ${passCount} · NG ${failCount} · MES实时`}
              </Text>
            )}
            {!hasData && (
              <Text position={[0, 0, panelD / 2 + 0.02]} fontSize={0.09} color="#64748b" anchorX="center" anchorY="middle">
                等待数据...
              </Text>
            )}
          </group>
        );
      })()}

      {/* FCT 工位上方显示当前批次+子板良品/NG */}
      {station.code === 'manu_fct' && lineBoardChildren(rawBatch).length > 0 && (() => {
        const batch = rawBatch;
        const subBoards: any[] = batch.subBoards || [];
        const passCount = subBoards.filter((b: any) => b.result !== 'FAIL').length;
        const failCount = subBoards.filter((b: any) => b.result === 'FAIL').length;
        return (
          <group position={[0, 3.1, 0]}>
            <mesh position={[0, 0, -0.01]}>
              <boxGeometry args={[3.6, 0.8, 0.04]} />
              <meshStandardMaterial color="#0f172a" metalness={0.4} roughness={0.6} />
            </mesh>
            <mesh position={[0, 0.36, 0]}>
              <boxGeometry args={[3.6, 0.08, 0.05]} />
              <meshStandardMaterial color="#0ea5e9" emissive="#0ea5e9" emissiveIntensity={0.9} />
            </mesh>
            <Text position={[0, 0.22, 0.02]} fontSize={0.13} color="#38bdf8" anchorX="center" anchorY="middle" fontFamily="monospace">
              FCT 批次 · {batch.mainSn || '—'}
            </Text>
            {subBoards.slice(0, 12).map((board: any, i: number) => {
              const isFail = board.result === 'FAIL';
              const col = i % 6;
              const row = Math.floor(i / 6);
              return (
                <mesh key={i} position={[-1.35 + col * 0.45, -0.05 - row * 0.22, 0.02]}
                  onClick={(e) => { e.stopPropagation(); onBatchClick?.(batch); }}>
                  <boxGeometry args={[0.38, 0.16, 0.03]} />
                  <meshStandardMaterial
                    color={isFail ? "#ef4444" : "#22c55e"}
                    emissive={isFail ? "#ef4444" : "#22c55e"}
                    emissiveIntensity={isFail ? 0.7 : 0.4}
                  />
                </mesh>
              );
            })}
            <Text position={[0, -0.32, 0.02]} fontSize={0.11} color="#4ade80" anchorX="center" anchorY="middle">
              {`✓ ${passCount} 良品`}
            </Text>
            <Text position={[-0.8, -0.32, 0.02]} fontSize={0.11} color="#f87171" anchorX="center" anchorY="middle">
              {`✗ ${failCount} 不良品`}
            </Text>
          </group>
        );
      })()}

      {/* 所有工位上方展示当前SN列表 */}
      {station.code === 'manu_rework' && repairSummary && (
        <group position={[0, 3.7, 0]}>
          <mesh position={[0, 0, -0.03]}>
            <boxGeometry args={[4.6, 0.92, 0.08]} />
            <meshStandardMaterial color="#071827" emissive="#0e7490" emissiveIntensity={0.28} />
          </mesh>
          <Text position={[0, 0.27, 0.03]} fontSize={0.18} color="#7dd3fc" anchorX="center" anchorY="middle">
            {`MES维修工单 ${repairSummary.total}`}
          </Text>
          <Text position={[0, -0.08, 0.03]} fontSize={0.14} color="#fbbf24" anchorX="center" anchorY="middle">
            {`待收 ${repairSummary.waitingReceipt}  ·  维修中 ${repairSummary.inProgress}  ·  待返 ${repairSummary.waitingReturn}`}
          </Text>
          <Text position={[0, -0.31, 0.03]} fontSize={0.11} color="#4ade80" anchorX="center" anchorY="middle">
            {`已完成/关闭 ${repairSummary.closed}`}
          </Text>
        </group>
      )}

      {(() => {
        const list = moduleStationSnLists[station.code] || [];
        if (list.length === 0) return null;
        return (
          <group position={[0, 4.0, 0]}>
            {/* 底板 */}
            <mesh position={[0, 0, -0.01]}>
              <boxGeometry args={[3.2, 0.55, 0.04]} />
              <meshStandardMaterial color="#0f172a" metalness={0.4} roughness={0.6} />
            </mesh>
            {/* 绿色条-良品 */}
            <mesh position={[-0.55, 0, 0]}>
              <boxGeometry args={[0.08, 0.55, 0.05]} />
              <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={0.8} />
            </mesh>
            {/* 红色条-NG */}
            <mesh position={[0.55, 0, 0]}>
              <boxGeometry args={[0.08, 0.55, 0.05]} />
              <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={0.8} />
            </mesh>
            {/* 绿色SN */}
              {list.filter(e => e.result === 'PASS').slice(0, 6).map((e, i) => (
                <Text key={`p${i}`} position={[-0.3 + i * 0.35, 0.12, 0.02]} fontSize={0.11} color="#4ade80" anchorX="center" anchorY="middle">
                  {((e.sn as string | undefined) ?? '').length > 8 ? ((e.sn as string) ?? '').slice(-8) : (e.sn ?? '')}
                </Text>
              ))}
              {/* 红色SN */}
              {list.filter(e => e.result !== 'PASS').slice(0, 4).map((e, i) => (
                <Text key={`f${i}`} position={[-0.1 + i * 0.42, -0.12, 0.02]} fontSize={0.11} color="#f87171" anchorX="center" anchorY="middle">
                  {((e.sn as string | undefined) ?? '').length > 8 ? ((e.sn as string) ?? '').slice(-8) : (e.sn ?? '')}
                </Text>
              ))}
          </group>
        );
      })()}

      {/* Keep the repeated code attached to the alarm beacon until the next scan. */}
      {duplicateSn && (
        <group position={[0, 3.12, 0]}>
          <mesh position={[0, 0, -0.02]}>
            <boxGeometry args={[5.5, 1.5, 0.08]} />
            <meshStandardMaterial color="#450a0a" emissive="#ef4444" emissiveIntensity={0.65} />
          </mesh>
          <Text
            position={[0, 0.55, 0.04]}
            fontSize={0.2}
            color="#fef2f2"
            anchorX="center"
            anchorY="middle"
          >
            {uiLanguage === 'zh' ? '重复号码' : 'DUPLICATE SN'}
          </Text>
          <Text
            position={[0, 0.05, 0.04]}
            fontSize={0.2}
            color="#fbbf24"
            anchorX="center"
            anchorY="middle"
            fontFamily="monospace"
            maxWidth={5.2}
            lineHeight={1.35}
          >
            {duplicateSnGrid}
          </Text>
        </group>
      )}

      {station.code === 'manu_ict' && duplicateSn && !duplicateAlarmAcknowledged && (
        <Html position={[0, 3.9, 0]} center transform distanceFactor={8}>
          <button
            type="button"
            onClick={releaseDuplicateAlarm}
            style={{ whiteSpace: 'nowrap', padding: '12px 36px', borderRadius: 8, border: '2px solid #fef08a', background: '#dc2626', color: '#fff', fontSize: 16, fontWeight: 900, cursor: 'pointer', boxShadow: '0 0 18px rgba(239,68,68,.9)' }}
          >
            {uiLanguage === 'zh' ? '解除重码报警' : 'RELEASE DUP ALARM'}
          </button>
        </Html>
      )}

      <BarcodeScanner flashVisible={flash?.scannedAt != null && flash.scannedAt > 0} sn={duplicateSns.at(-1) || flash?.sn?.replace(/^(PASS:|NG:|CONFIRMED:)/, '')} />

      {station.code === 'manu_shellbinding' && (
        <group position={[0, 1.65, 2.15]}>
          {[-0.72, 0.72].map((x, index) => (
            <mesh key={x} position={[x, 0, 0]}>
              <boxGeometry args={[1.35, 0.9, 0.08]} />
              <meshStandardMaterial color={index === 0 ? '#164e63' : '#1e3a8a'} emissive={index === 0 ? '#0891b2' : '#2563eb'} emissiveIntensity={0.45} />
            </mesh>
          ))}
          <Text position={[-0.72, 0.28, 0.06]} fontSize={0.14} color="#67e8f9">SHELL SN</Text>
          <Text position={[0.72, 0.28, 0.06]} fontSize={0.14} color="#93c5fd">BOARD SN</Text>
          <Text position={[-0.72, -0.1, 0.06]} fontSize={0.13} color="#fff" maxWidth={1.2}>{bindingMatch?.shellSn || 'WAIT'}</Text>
          <Text position={[0.72, -0.1, 0.06]} fontSize={0.13} color="#fff" maxWidth={1.2}>{bindingMatch?.boardSn || 'WAIT'}</Text>
        </group>
      )}

      {/* 栈板/包装 工位上方显示箱子信息 */}
      {['manu_pallet_binding', 'manu_outer_box_binding'].includes(station.code) && containerData && (
        <group position={[0, 4.0, 0]}>
          <mesh position={[0, 0, -0.01]}>
            <boxGeometry args={[4.2, 1.1, 0.05]} />
            <meshStandardMaterial color="#78350f" metalness={0.6} roughness={0.4} />
          </mesh>
          {/* 橙色顶部条 */}
          <mesh position={[0, 0.5, 0]}>
            <boxGeometry args={[4.2, 0.1, 0.06]} />
            <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={1.0} />
          </mesh>
          {/* 箱码/栈板码（大字） */}
          <Text position={[0, 0.28, 0.02]} fontSize={0.24} color="#fef3c7" anchorX="center" anchorY="middle" fontFamily="monospace">
            {containerData.palletCode
              ? `📦 ${containerData.palletCode}  ${containerData.cartonCount}/${containerData.targetCartons} 箱`
              : `📦 ${containerData.containerId}  ${containerData.currentCount}/${containerData.capacity} 个`}
          </Text>
          {/* 进度条 */}
          <Text position={[0, 0.05, 0.02]} fontSize={0.16} color="#fbbf24" anchorX="center" anchorY="middle">
            {containerData.palletCode
              ? (uiLanguage === 'zh' ? `还差 ${containerData.remaining} 箱 · ${containerData.status}` : `${containerData.remaining} cartons · ${containerData.status}`)
              : (uiLanguage === 'zh' ? `还差 ${containerData.remaining} 个` : `${containerData.remaining} remaining`)}
          </Text>
          {/* 箱码列表 */}
          <Text position={[0, -0.18, 0.02]} fontSize={0.12} color="#ffffff" anchorX="center" anchorY="middle" maxWidth={4}>
            {(containerData.palletCode ? containerData.cartons : containerData.items || []).slice(-6).join('  ') || (uiLanguage === 'zh' ? '等待扫码' : 'WAITING')}
          </Text>
        </group>
      )}

      {/* NG lifecycle buckets */}
      {stationHasBucket(station.code, 'NG') && station.code !== 'manu_depanel' && (
        <Bucket
          position={[-1.8, 0.5, 2.0]}
          label="NG"
          color="#ef4444"
          ngRecords={realNgRecords}
          birthStation={station.code}
          birthPlace={station.nameZh}
          onNgBlockClick={onNgBlockClick}
          expanded={!!expandedBuckets[`${station.id}-NG`]}
          stationId={station.id}
          uiLanguage={uiLanguage}
        />
      )}

      {station.code === 'manu_depanel' && ([
        { label: 'ICT NG', code: 'ICT_ONLY_NG', position: [-1.8, 0.5, 2.0] as [number, number, number], color: '#f97316' },
        { label: 'FCT NG', code: 'FCT_ONLY_NG', position: [0, 0.5, 2.0] as [number, number, number], color: '#ef4444' },
        { label: 'ICT+FCT NG', code: 'ICT_FCT_NG', position: [1.8, 0.5, 2.0] as [number, number, number], color: '#a855f7' },
      ] as const).map(box => (
        <Bucket
          key={box.code}
          position={box.position}
          label={box.label}
          color={box.color}
          ngRecords={(realNgRecords || []).filter(record => record.defectCode === box.code)}
          birthStation={station.code}
          birthPlace={station.nameZh}
          onNgBlockClick={onNgBlockClick}
          expanded={!!expandedBuckets[`${station.id}-${box.label}`]}
          stationId={station.id}
          uiLanguage={uiLanguage}
        />
      ))}

      {stationHasBucket(station.code, 'First Retest') && (
        <Bucket
          position={[-0.9, 0.5, 2.0]}
          label="First Retest"
          color="#f59e0b"
          ngRecords={ngRecords}
          birthStation={station.code}
          birthPlace={station.nameZh}
          onNgBlockClick={onNgBlockClick}
          expanded={!!expandedBuckets[`${station.id}-First Retest`]}
          stationId={station.id}
          uiLanguage={uiLanguage}
        />
      )}

      {/* ICT Batch Block — 3D mesh in scene */}
      {station.id === 4 && lineBoardChildren(rawBatch).length > 0 && (
        <BatchBlock position={[-1.0, 0.9, 2.5]} batch={rawBatch} onClick={onBatchClick} />
      )}

      {/* PASS Bucket - right side, aligned at z=2.0 */}
      {stationHasBucket(station.code, 'PASS') && (
        <Bucket position={[0.9, 0.5, 2.0]} label="PASS" color="#22d3ee" passRecords={passRecords} itemCount={stats?.pass ?? 0} expanded={!!expandedBuckets[`${station.id}-PASS`]} stationId={station.id} uiLanguage={uiLanguage} />
      )}

      {/* Confirmed NG Bucket - final failed retest */}
      {stationHasBucket(station.code, 'Confirmed NG') && <Bucket
        position={[0, 0.5, 2.0]}
        label="Confirmed NG"
        color="#a855f7"
        ngRecords={realNgRecords}
        birthStation={station.code}
        birthPlace={station.nameZh}
        onNgBlockClick={onNgBlockClick}
        expanded={!!expandedBuckets[`${station.id}-Confirmed NG`]}
        stationId={station.id}
        uiLanguage={uiLanguage}
      />}

      {/* Aged NG Bucket - far right, aligned at z=2.0 */}
      {stationHasBucket(station.code, 'Aged NG') && (
        <Bucket
          position={[1.8, 0.5, 2.0]}
          label="Aged NG"
          color="#6b7280"
          ngRecords={realNgRecords}
          needsAuth
          birthStation={station.code}
          birthPlace={station.nameZh}
          onNgBlockClick={onNgBlockClick}
          expanded={!!expandedBuckets[`${station.id}-Aged NG`]}
          stationId={station.id}
          uiLanguage={uiLanguage}
        />
      )}
      <Text
        position={[0, 2.75, 2.0]}
        fontSize={0.32}
        color="#f1f5f9"
        anchorX="center"
        anchorY="middle"
        maxWidth={2.2}
      >
        {station.nameZh}
      </Text>
      {/* Station ID — top-left on face */}
      <Text
        position={[-0.75, 1.65, 0.97]}
        fontSize={0.24}
        color="#cbd5e1"
        anchorX="left"
        anchorY="middle"
      >
        {`#${String(station.id).padStart(2, "0")}`}
      </Text>

      {/* Status badge — top-right on face */}
      <Text
        position={[0.75, 1.65, 0.97]}
        fontSize={0.22}
        color={color}
        anchorX="right"
        anchorY="middle"
      >
        {wsConnected ? "▶ 运行" : "⚪ 离线"}
      </Text>

      {/* IP address — center */}
      <Text
        position={[0, 1.05, 0.97]}
        fontSize={0.18}
        color="#94a3b8"
        anchorX="center"
        anchorY="middle"
        fontFamily="monospace"
      >
        {station.ip || "—"}
      </Text>

      {/* Last scanned SN — floating animation */}
      {flash?.scannedAt != null && flash.scannedAt > 0 && (
        <FloatingSn sn={flash.sn} scannedAt={flash.scannedAt} />
      )}

      {/* Pass/WIP count — bottom-left */}
      <Text
        position={[-0.75, 0.55, 0.97]}
        fontSize={0.22}
        color="#4ade80"
        anchorX="left"
        anchorY="middle"
      >
        {`OK: ${stats?.pass ?? station.wipCount ?? 0}`}
      </Text>

      {/* NG count — bottom-right */}
      <Text
        position={[0.75, 0.55, 0.97]}
        fontSize={0.22}
        color={(stats?.fail ?? station.ngCount ?? 0) > 0 ? "#ef4444" : "#4ade80"}
        anchorX="right"
        anchorY="middle"
      >
        {`NG: ${stats?.fail ?? station.ngCount ?? 0}`}
      </Text>

      {/* Front info panel background */}
      <mesh position={[0, 1.1, 0.91]} receiveShadow>
        <boxGeometry args={[1.8, 1.3, 0.02]} />
        <meshStandardMaterial color="#1e293b" transparent opacity={0.6} />
      </mesh>

      <mesh position={[0, 0.3, 0.95]} receiveShadow>
        <boxGeometry args={[2, 0.1, 0.1]} />
        <meshStandardMaterial color="#374151" metalness={0.5} roughness={0.5} />
      </mesh>
    </group>
  );
}

// ── Conveyor Segment ─────────────────────────────────────────────────────────
function Conveyor({ fromPx, toPx, lineZ }: { fromPx: number; toPx: number; lineZ: number }) {
  const stripeRef = useRef<THREE.Mesh>(null);
  const midX = (fromPx + toPx) / 2;
  const len = toPx - fromPx;
  const z = lineZ; // conveyor center at same z as the line

  useFrame(({ clock }) => {
    if (stripeRef.current) {
      const offset = (clock.elapsedTime * 0.6) % 0.5;
      stripeRef.current.position.x = midX + offset - 0.25;
    }
  });

  return (
    <group>
      <mesh position={[midX, 0.3, z]} receiveShadow>
        <boxGeometry args={[len, 0.1, 0.35]} />
        <meshStandardMaterial color="#1e293b" metalness={0.3} roughness={0.9} />
      </mesh>
      <mesh ref={stripeRef} position={[midX, 0.36, z]}>
        <boxGeometry args={[0.12, 0.02, 0.28]} />
        <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={0.4} />
      </mesh>
      <mesh position={[midX, 0.2, z - 0.17]}>
        <boxGeometry args={[len, 0.06, 0.04]} />
        <meshStandardMaterial color="#4b5563" metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[midX, 0.2, z + 0.17]}>
        <boxGeometry args={[len, 0.06, 0.04]} />
        <meshStandardMaterial color="#4b5563" metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[midX - len / 2 + 0.5, 0.1, z]}>
        <boxGeometry args={[0.08, 0.4, 0.08]} />
        <meshStandardMaterial color="#374151" />
      </mesh>
      <mesh position={[midX + len / 2 - 0.5, 0.1, z]}>
        <boxGeometry args={[0.08, 0.4, 0.08]} />
        <meshStandardMaterial color="#374151" />
      </mesh>
    </group>
  );
}

// Video-derived manual-line hall details (2026-08-01 factory walk-through).
// The live station objects stay authoritative; these meshes only reproduce the
// physical benches, aisle, utilities, aging cabinets and material handling seen on site.
function ManualWorkBench({ x, z, length = 5.2 }: { x: number; z: number; length?: number }) {
  return (
    <group position={[x, 0, z]}>
      {/* green ESD work surface + lower return shelf */}
      <mesh position={[0, 0.86, 0]} castShadow receiveShadow>
        <boxGeometry args={[length, 0.11, 1.65]} />
        <meshStandardMaterial color="#17834f" roughness={0.58} metalness={0.12} />
      </mesh>
      <mesh position={[0, 0.34, 0]} receiveShadow>
        <boxGeometry args={[length, 0.07, 1.5]} />
        <meshStandardMaterial color="#1f6f4a" roughness={0.65} />
      </mesh>
      {[-1, 1].flatMap(side => [-length / 2 + 0.18, length / 2 - 0.18].map(px => (
        <mesh key={`${side}-${px}`} position={[px, 0.43, side * 0.67]} castShadow>
          <boxGeometry args={[0.07, 0.86, 0.07]} />
          <meshStandardMaterial color="#bac4c9" metalness={0.75} roughness={0.28} />
        </mesh>
      )))}
      {/* upper instruction/light rail */}
      {[-length / 2 + 0.2, length / 2 - 0.2].map(px => (
        <mesh key={px} position={[px, 1.65, -0.68]}>
          <boxGeometry args={[0.06, 1.55, 0.06]} />
          <meshStandardMaterial color="#d7dde0" metalness={0.7} />
        </mesh>
      ))}
      <mesh position={[0, 2.28, -0.68]} castShadow>
        <boxGeometry args={[length, 0.13, 0.16]} />
        <meshStandardMaterial color="#e8edef" metalness={0.48} />
      </mesh>
      <rectAreaLight position={[0, 2.18, -0.35]} rotation={[-Math.PI / 2, 0, 0]} width={length - 0.25} height={0.35} intensity={2.1} color="#efffff" />
      {/* red component bins visible across the line */}
      {Array.from({ length: Math.max(3, Math.floor(length / 0.7)) }, (_, i) => (
        <mesh key={i} position={[-length / 2 + 0.45 + i * 0.68, 1.06, -0.48]} castShadow>
          <boxGeometry args={[0.5, 0.24, 0.38]} />
          <meshStandardMaterial color={i % 4 === 0 ? "#2563eb" : "#dc2626"} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

function ManualLineHall() {
  return (
    <group>
      {/* Long double-sided manual assembly benches from the videos. */}
      {[7.5, 20.5, 33.5, 46.5, 59.5].map((x, i) => (
        <React.Fragment key={x}>
          <ManualWorkBench x={x} z={7.4} length={10.8} />
          {i > 1 && <ManualWorkBench x={x} z={1.0} length={10.8} />}
        </React.Fragment>
      ))}

      {/* Seven independent finished-product aging cabinets confirmed by station folder/video. */}
      {Array.from({ length: 7 }, (_, i) => (
        <group key={i} position={[43 + i * 1.48, 0, 10.7]}>
          <mesh position={[0, 1.25, 0]} castShadow receiveShadow>
            <boxGeometry args={[1.28, 2.5, 1.45]} />
            <meshStandardMaterial color="#d9dee2" metalness={0.35} roughness={0.38} />
          </mesh>
          <mesh position={[0, 1.34, -0.735]}>
            <boxGeometry args={[0.9, 1.72, 0.04]} />
            <meshStandardMaterial color="#12202a" metalness={0.5} roughness={0.28} />
          </mesh>
          {Array.from({ length: 5 }, (_, shelf) => (
            <mesh key={shelf} position={[0, 0.68 + shelf * 0.31, -0.77]}>
              <boxGeometry args={[0.82, 0.045, 0.06]} />
              <meshStandardMaterial color="#4ade80" emissive="#22c55e" emissiveIntensity={0.22} />
            </mesh>
          ))}
          <Text position={[0, 2.68, 0]} fontSize={0.22} color="#0f172a" anchorX="center">{`CAB ${i + 1}`}</Text>
        </group>
      ))}

      {/* Blue epoxy floor aisle and real yellow/black safety edges. */}
      <mesh position={[32.5, 0.012, 4.2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[70, 4.0]} />
        <meshStandardMaterial color="#778b99" roughness={0.86} />
      </mesh>
      {[-2.0, 2.0].map(offset => (
        <mesh key={offset} position={[32.5, 0.025, 4.2 + offset]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[70, 0.09]} />
          <meshStandardMaterial color="#facc15" emissive="#facc15" emissiveIntensity={0.12} />
        </mesh>
      ))}

      {/* Structural columns, overhead cable trays and extraction drops. */}
      {[0, 14, 28, 42, 56, 70].map(x => (
        <group key={x} position={[x, 0, 4.2]}>
          <mesh position={[0, 2.8, 0]} castShadow><boxGeometry args={[0.38, 5.6, 0.38]} /><meshStandardMaterial color="#d7dde2" metalness={0.5} /></mesh>
          <mesh position={[0, 5.2, 0]}><boxGeometry args={[13.8, 0.18, 0.28]} /><meshStandardMaterial color="#8b979e" metalness={0.78} /></mesh>
        </group>
      ))}
      {[5, 18, 31, 44, 57].map(x => (
        <group key={x} position={[x, 0, 8.5]}>
          <mesh position={[0, 2.0, 0]}><cylinderGeometry args={[0.1, 0.18, 3.4, 14]} /><meshStandardMaterial color="#6b7280" metalness={0.75} /></mesh>
          <mesh position={[0, 0.42, 0]}><cylinderGeometry args={[0.48, 0.48, 0.75, 16]} /><meshStandardMaterial color="#c7ced3" metalness={0.45} /></mesh>
        </group>
      ))}

      {/* carts, stools and carton staging seen along the outer aisle */}
      {[12, 26, 39, 54].map((x, i) => (
        <group key={x} position={[x, 0, 12.3]}>
          <mesh position={[0, 0.78, 0]}><boxGeometry args={[1.2, 0.08, 0.85]} /><meshStandardMaterial color="#9ca3af" metalness={0.72} /></mesh>
          {[[-0.5,-0.34],[-0.5,0.34],[0.5,-0.34],[0.5,0.34]].map(([px,pz], j) => <mesh key={j} position={[px,0.35,pz]}><boxGeometry args={[0.06,0.7,0.06]} /><meshStandardMaterial color="#6b7280" metalness={0.7} /></mesh>)}
          {i % 2 === 0 && <mesh position={[0, 1.18, 0]} castShadow><boxGeometry args={[1.05, 0.72, 0.72]} /><meshStandardMaterial color="#a86f32" roughness={0.85} /></mesh>}
        </group>
      ))}
    </group>
  );
}

// ── PCB Board ────────────────────────────────────────────────────────────────
// PCB floats above conveyor at Y=1.2 — visually "on" the conveyor but not touching it
const MANUAL_CARRIER_PATH: Array<[number, number, number]> = [
  [1.5, 1.16, 0.8], [10.5, 1.16, 0.8], [16.5, 1.16, 0.8],
  [22.5, 1.16, 0.8], [28.5, 1.16, 0.8], [35, 1.16, 0.8],
  [37.5, 1.16, 4.2], [35, 1.16, 7.6], [29, 1.16, 7.6],
  [23, 1.16, 10.7], [17, 1.16, 7.6], [11, 1.16, 7.6],
  [5, 1.16, 7.6], [-1, 1.16, 7.6],
];

function pointOnManualCarrierPath(progress: number) {
  const segmentCount = MANUAL_CARRIER_PATH.length - 1;
  const scaled = THREE.MathUtils.clamp(progress, 0, 0.9999) * segmentCount;
  const index = Math.floor(scaled);
  const local = scaled - index;
  const from = MANUAL_CARRIER_PATH[index];
  const to = MANUAL_CARRIER_PATH[index + 1];
  return new THREE.Vector3(
    THREE.MathUtils.lerp(from[0], to[0], local),
    THREE.MathUtils.lerp(from[1], to[1], local),
    THREE.MathUtils.lerp(from[2], to[2], local),
  );
}

function ManualCarrierFlow() {
  const carrierRefs = useRef<Array<THREE.Group | null>>([]);
  useFrame(({ clock }) => {
    carrierRefs.current.forEach((carrier, index) => {
      if (!carrier) return;
      const progress = (clock.elapsedTime * 0.018 + index / 4) % 1;
      const position = pointOnManualCarrierPath(progress);
      const ahead = pointOnManualCarrierPath((progress + 0.002) % 1);
      carrier.position.copy(position);
      carrier.rotation.y = Math.atan2(ahead.x - position.x, ahead.z - position.z);
    });
  });
  return (
    <group>
      {Array.from({ length: 4 }, (_, carrierIndex) => (
        <group key={carrierIndex} ref={(node) => { carrierRefs.current[carrierIndex] = node; }}>
          <mesh castShadow><boxGeometry args={[1.15, 0.1, 0.72]} /><meshStandardMaterial color="#e5e7eb" metalness={0.45} roughness={0.38} /></mesh>
          {Array.from({ length: 4 }, (_, row) => Array.from({ length: 5 }, (_, column) => (
            <mesh key={`${row}-${column}`} position={[-0.44 + column * 0.22, 0.11, -0.25 + row * 0.17]} castShadow>
              <boxGeometry args={[0.15, 0.1, 0.1]} />
              <meshStandardMaterial color={carrierIndex % 2 ? "#1f2937" : "#334155"} roughness={0.48} />
            </mesh>
          )))}
          <mesh position={[-0.57, 0.17, 0]}><boxGeometry args={[0.04, 0.32, 0.72]} /><meshStandardMaterial color="#dc2626" /></mesh>
          <mesh position={[0.57, 0.17, 0]}><boxGeometry args={[0.04, 0.32, 0.72]} /><meshStandardMaterial color="#dc2626" /></mesh>
        </group>
      ))}
    </group>
  );
}

function PCB() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      const t = (clock.elapsedTime * 0.25) % 1;
      ref.current.position.x = t * 60 - 1;
      ref.current.position.y = 1.2; // float above conveyor surface
      ref.current.visible = t > 0.02 && t < 0.98;
    }
  });
  return (
    <mesh ref={ref} position={[-1, 1.2, 1.25]} castShadow>
      <boxGeometry args={[0.7, 0.04, 0.5]} />
      <meshStandardMaterial color="#16a34a" metalness={0.1} roughness={0.9} />
    </mesh>
  );
}

// ── Floor ────────────────────────────────────────────────────────────────────
function Floor({ mode }: { mode: Mode }) {
  const palette = PALETTES[mode];
  return (
    <>
      <mesh position={[30, -0.5, 0]} receiveShadow>
        <boxGeometry args={[220, 1, 90]} />
        <meshStandardMaterial color={palette.floor} roughness={1} metalness={0} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[30, 0.005, 0]} receiveShadow>
        <planeGeometry args={[220, 125]} />
        <meshStandardMaterial color={palette.floorSurface} roughness={1} metalness={0} />
      </mesh>
      <gridHelper args={[220, 44, mode === "day" ? "#6b7785" : "#3a4a5a", mode === "day" ? "#5a6573" : "#2a3a4a"]} position={[30, 0.01, 0]} />
    </>
  );
}

// ── WASD Roaming ─────────────────────────────────────────────────────────────
function WASDControls() {
  const cam = useThree(s => s.camera);
  const controls = useThree(s => s.controls) as any;
  const keys = useRef({ w: false, a: false, s: false, d: false });

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k in keys.current) { keys.current[k as keyof typeof keys.current] = true; e.preventDefault(); }
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k in keys.current) { keys.current[k as keyof typeof keys.current] = false; }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  useFrame((_, dt) => {
    const speed = 12 * dt;
    if (!keys.current.w && !keys.current.a && !keys.current.s && !keys.current.d) return;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const right = new THREE.Vector3();
    right.crossVectors(dir, cam.up).normalize();
    if (keys.current.w) cam.position.addScaledVector(dir, speed);
    if (keys.current.s) cam.position.addScaledVector(dir, -speed);
    if (keys.current.a) cam.position.addScaledVector(right, -speed);
    if (keys.current.d) cam.position.addScaledVector(right, speed);
    if (controls) {
      controls.target.copy(cam.position).addScaledVector(dir, 30);
      controls.update();
    }
  });

  return null;
}

// ── Camera-Mounted Light (follows camera to light the front view) ────────────
function CameraLight() {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const targetRef = useRef<THREE.Object3D>(null);
  const { camera } = useThree();

  useFrame(() => {
    if (!lightRef.current || !targetRef.current) return;
    // Position light above & behind camera in world space
    const offset = new THREE.Vector3(0, 4, -8);
    offset.applyQuaternion(camera.quaternion);
    lightRef.current.position.copy(camera.position).add(offset);

    // Target: camera forward * 20 units
    const fwd = new THREE.Vector3(0, 0, -20);
    fwd.applyQuaternion(camera.quaternion);
    targetRef.current.position.copy(camera.position).add(fwd);
    lightRef.current.target.updateMatrixWorld();
  });

  return (
    <>
      <directionalLight ref={lightRef} intensity={1.2} color="#ffffff" />
      <object3D ref={targetRef} />
    </>
  );
}

// ── Dashboard Views ──────────────────────────────────────────────────────────────
function FlowHeatmapView({ flows }: { flows: Record<string, { enter: number; exit: number }> }) {
  const stations = STATIONS.filter(s => !s.code.startsWith('auto_') && s.code !== 'manu_rework');
  const maxVal = Math.max(1, ...stations.map(s => Math.max(flows[s.code]?.enter || 0, flows[s.code]?.exit || 0)));

  return (
    <div style={{ fontFamily: "monospace" }}>
      <h3 style={{ color: "#38bdf8", margin: "0 0 16px", fontSize: 15 }}>工位人流热力图</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
        {stations.map(s => {
          const { enter = 0, exit = 0 } = flows[s.code] || {};
          const imb = enter - exit;
          const ratio = maxVal > 0 ? Math.max(enter, exit) / maxVal : 0;
          const enterRatio = maxVal > 0 ? enter / maxVal : 0;
          const exitRatio = maxVal > 0 ? exit / maxVal : 0;
          const heatColor = imb >= 0
            ? `rgb(0,${Math.round(180 * ratio)},${Math.round(100 * ratio)})`
            : `rgb(${Math.round(180 * ratio)},${Math.round(80 * ratio)},0)`;
          return (
            <div key={s.code} style={{
              background: "rgba(15,23,42,.9)", border: "1px solid #1e3a5f",
              borderRadius: 10, padding: "12px 14px",
            }}>
              <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 6 }}>{s.nameZh}</div>
              <div style={{ color: "#64748b", fontSize: 10, marginBottom: 4 }}>{s.code}</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                <div style={{ flex: 1, height: 6, background: "#1e293b", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${enterRatio * 100}%`, height: "100%", background: "#22c55e", transition: "width .3s" }} />
                </div>
                <span style={{ color: "#4ade80", fontSize: 11, minWidth: 30 }}>{enter}进</span>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <div style={{ flex: 1, height: 6, background: "#1e293b", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${exitRatio * 100}%`, height: "100%", background: "#ef4444", transition: "width .3s" }} />
                </div>
                <span style={{ color: "#f87171", fontSize: 11, minWidth: 30 }}>{exit}离</span>
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: heatColor, fontWeight: 700 }}>
                差值: {imb >= 0 ? `+${imb}` : imb}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NgClosedLoopView({ ngRecords, realNgRecords }: {
  ngRecords: Record<number, NgRecord[]>;
  realNgRecords: Record<number, NgRecord[]>;
}) {
  const totalNg = Object.values(ngRecords).reduce((sum, arr) => sum + arr.length, 0);
  const totalConfirmed = Object.values(realNgRecords).reduce((sum, arr) => sum + arr.length, 0);
  const unresolved = totalNg - totalConfirmed;

  return (
    <div style={{ fontFamily: "monospace" }}>
      <h3 style={{ color: "#f87171", margin: "0 0 16px", fontSize: 15 }}>NG闭环看板</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "NG总数", val: totalNg, color: "#fbbf24" },
          { label: "已确认闭环", val: totalConfirmed, color: "#4ade80" },
          { label: "未闭环", val: unresolved, color: unresolved > 0 ? "#ef4444" : "#4ade80" },
        ].map(s => (
          <div key={s.label} style={{
            background: "rgba(15,23,42,.9)", border: `1px solid ${s.color}44`,
            borderRadius: 10, padding: "14px 16px", textAlign: "center",
          }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
        {STATIONS.filter(s => !s.code.startsWith('auto_')).map(s => {
          const ng = ngRecords[s.id] || [];
          const confirmed = realNgRecords[s.id] || [];
          return (
            <div key={s.code} style={{
              background: "rgba(15,23,42,.9)", border: "1px solid #1e3a5f",
              borderRadius: 8, padding: "10px 12px",
            }}>
              <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>{s.nameZh} ({s.code})</div>
              <div style={{ display: "flex", gap: 8 }}>
                <span style={{ color: "#fbbf24", fontSize: 13 }}>NG {ng.length}</span>
                <span style={{ color: "#4ade80", fontSize: 13 }}>已确 {confirmed.length}</span>
                {ng.length - confirmed.length > 0 && (
                  <span style={{ color: "#ef4444", fontSize: 13 }}>未确 {ng.length - confirmed.length}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ThroughputView({ stats }: { stats: Record<number, { total: number; pass: number; fail: number; dup: number }> }) {
  const allStations = STATIONS.filter(s => !s.code.startsWith('auto_'));
  const totalPass = Object.values(stats).reduce((s, v) => s + v.pass, 0);
  const totalFail = Object.values(stats).reduce((s, v) => s + v.fail, 0);
  const total = totalPass + totalFail;
  const yield_ = total > 0 ? ((totalPass / total) * 100).toFixed(1) : "—";

  return (
    <div style={{ fontFamily: "monospace" }}>
      <h3 style={{ color: "#38bdf8", margin: "0 0 16px", fontSize: 15 }}>Throughput</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Pass", val: totalPass, color: "#4ade80" },
          { label: "Fail", val: totalFail, color: "#ef4444" },
          { label: "良率", val: `${yield_}%`, color: "#38bdf8" },
        ].map(s => (
          <div key={s.label} style={{
            background: "rgba(15,23,42,.9)", border: `1px solid ${s.color}44`,
            borderRadius: 10, padding: "14px 16px", textAlign: "center",
          }}>
            <div style={{ fontSize: 24, fontWeight: 900, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
        {allStations.map(s => {
          const st = stats[s.id];
          if (!st || st.total === 0) return null;
          const yieldPct = st.total > 0 ? ((st.pass / st.total) * 100).toFixed(0) : 0;
          return (
            <div key={s.code} style={{
              background: "rgba(15,23,42,.9)", border: "1px solid #1e3a5f",
              borderRadius: 8, padding: "10px 12px",
            }}>
              <div style={{ color: "#e2e8f0", fontSize: 12, marginBottom: 6 }}>{s.nameZh}</div>
              <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
                <div style={{ flex: 1, height: 8, background: "#1e293b", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ width: `${yieldPct}%`, height: "100%", background: "#4ade80", transition: "width .3s" }} />
                </div>
                <span style={{ color: "#4ade80", fontSize: 10 }}>{yieldPct}%</span>
              </div>
              <div style={{ display: "flex", gap: 8, fontSize: 10, color: "#94a3b8" }}>
                <span style={{ color: "#4ade80" }}>✓{st.pass}</span>
                <span style={{ color: "#ef4444" }}>✗{st.fail}</span>
                <span style={{ color: "#fbbf24" }}>⚡{st.dup}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StuckAlertView({ residenceMonitor }: {
  residenceMonitor: { thresholdMinutes: number; summary: any[]; current: any[] };
}) {
  return (
    <div style={{ fontFamily: "monospace" }}>
      <h3 style={{ color: "#f97316", margin: "0 0 16px", fontSize: 15 }}>
        滞留告警 (阈值 {residenceMonitor.thresholdMinutes}min)
      </h3>
      {residenceMonitor.current.length === 0 ? (
        <div style={{ color: "#4ade80", fontSize: 13, padding: "20px 0" }}>✓ 当前无滞留超时</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {residenceMonitor.current.map((item: any, i: number) => (
            <div key={i} style={{
              background: "rgba(15,23,42,.9)", border: "1px solid #f9731644",
              borderRadius: 8, padding: "10px 14px",
              display: "flex", gap: 12, alignItems: "center",
            }}>
              <span style={{ color: "#f97316", fontSize: 16 }}>⚠</span>
              <div style={{ flex: 1 }}>
                <div style={{ color: "#e2e8f0", fontSize: 12 }}>SN: {item.sn || item.batchId || "—"}</div>
                <div style={{ color: "#94a3b8", fontSize: 10, marginTop: 2 }}>
                  {item.stationCode} · 滞留 {item.residenceSeconds ? Math.round(item.residenceSeconds / 60) : "?"}min
                </div>
              </div>
              <div style={{ color: "#f97316", fontSize: 11, fontWeight: 700 }}>
                {item.workOrderCode || ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PackagingProgressView() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const url = "/api/station/packaging-boxes?limit=50";
    fetch(url).then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { setData(d.items || []); setLoading(false); })
      .catch(() => { setLoading(false); });
  }, []);

  if (loading) return <div style={{ color: "#94a3b8", fontFamily: "monospace" }}>加载中...</div>;

  const packagingStation = STATIONS.find(s => s.code === 'manu_package_ate');

  return (
    <div style={{ fontFamily: "monospace" }}>
      <h3 style={{ color: "#a78bfa", margin: "0 0 16px", fontSize: 15 }}>包装线进度</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10, marginBottom: 20 }}>
        {STATIONS.filter(s => s.code.includes('package') || s.code.includes('case') || s.code.includes('pallet')).map(s => {
          const stationData = data.filter((item: any) => item.stationCode === s.code || item.currentStation === s.code);
          const packed = stationData.filter((item: any) => item.status === 'PACKED').length;
          const capacity = stationData[0]?.capacity || 0;
          return (
            <div key={s.code} style={{
              background: "rgba(15,23,42,.9)", border: "1px solid #a78bfa44",
              borderRadius: 8, padding: "12px 14px",
            }}>
              <div style={{ color: "#e2e8f0", fontSize: 12, marginBottom: 6 }}>{s.nameZh}</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: "#a78bfa" }}>{packed}</div>
              <div style={{ color: "#64748b", fontSize: 10 }}>已包装</div>
            </div>
          );
        })}
      </div>
      <div style={{ color: "#64748b", fontSize: 11 }}>共 {data.length} 条包装记录</div>
    </div>
  );
}

// ── Scene ────────────────────────────────────────────────────────────────────
function Scene({
  onStationClick,
  onNgBlockClick,
  onBatchClick,
  onClearIctData,
  lightScale,
  mode,
  cameraView,
  flashes,
  wsAlive,
  wsConnected,
  stationStats,
  ngRecords,
  realNgRecords,
  passRecords,
  rawBatch,
  expandedBuckets,
  onBucketToggle,
  onBackgroundClick,
  uiLanguage,
  bindingMatch,
  containerData,
  repairSummary,
}: {
  onStationClick: (s: Station) => void;
  onNgBlockClick: (item: NgItem) => void;
  onBatchClick?: (batch: any) => void;
  onClearIctData: () => void;
  uiLanguage: UiLanguage;
  bindingMatch: { shellSn?: string; boardSn?: string };
  containerData?: any;
  repairSummary?: { waitingReceipt: number; inProgress: number; waitingReturn: number; pickupPending: number; closed: number; total: number };
  lightScale: number;
  mode: Mode;
  cameraView: CamView | null;
  flashes: Record<number, { sn: string; scannedAt: number; batchId?: string }>;
  wsAlive: Record<number, boolean>;
  wsConnected: Record<number, boolean>;
  stationStats: Record<number, { total: number; pass: number; fail: number; dup: number }>;
  ngRecords: Record<number, NgRecord[]>;
  realNgRecords: Record<number, NgRecord[]>;
  passRecords: Record<number, PassRecord[]>;
  rawBatch: Record<number, any>;
  expandedBuckets: Record<string, boolean>;
  onBucketToggle: (stationId: number, label: string) => void;
  onBackgroundClick?: () => void;
}) {
  const palette = PALETTES[mode];
  return (
    <>
      <ManualRaycaster onStationClick={onStationClick} onNgBlockClick={onNgBlockClick} onBucketToggle={onBucketToggle} onBatchClick={onBatchClick} onBackgroundClick={onBackgroundClick} />
      <ambientLight intensity={palette.ambient * lightScale} color={palette.ambientColor} />
      <directionalLight
        position={[30, 50, 20]}
        intensity={1.6 * lightScale}
        color={palette.directionalColor}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={250}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={60}
        shadow-camera-bottom={-10}
      />

      {/* Hemisphere for natural ambient — brightens all materials */}
      <hemisphereLight
        args={[palette.directionalColor, "#445566"]}
        intensity={0.6 * lightScale}
      />

      {/* Front-fill light — illuminates the station faces */}
      <directionalLight
        position={[30, 5, 30]}
        intensity={0.5 * lightScale}
        color={palette.directionalColor}
      />

      {/* Overhead lights along the line — every ~15 units */}
      {[0, 15, 30, 45, 60].map(x => (
        <pointLight
          key={`overhead-${x}`}
          position={[x, 6, -2]}
          intensity={0.8 * lightScale}
          color={palette.directionalColor}
          distance={20}
          decay={2}
        />
      ))}
      {/* Under-canopy forward lights — shine on station fronts */}
      {[5, 20, 35, 50].map(x => (
        <spotLight
          key={`canopy-${x}`}
          position={[x, 3.5, 4]}
          angle={0.5}
          penumbra={0.6}
          intensity={0.5 * lightScale}
          color={palette.directionalColor}
          distance={15}
          decay={2}
        />
      ))}

      <CameraLight />
      <WASDControls />

      <Floor mode={mode} />

      {/* Physical manual line: the two supplied videos are the left and right
          sides of the same central aisle, not two separate production areas. */}
      <group position={[0, 0, MANUAL_VIDEO_LINE_Z_OFFSET]}>
        <ManualLineHall />
        <ManualCarrierFlow />
      </group>

      {DISPLAY_STATIONS.map(s => (
        <StationBox key={s.id} station={s} onClick={onStationClick} onNgBlockClick={onNgBlockClick} onBatchClick={onBatchClick} onClearIctData={onClearIctData} flash={flashes[s.id]} wsConnected={wsAlive[s.id]} stats={stationStats[s.id]} ngRecords={ngRecords[s.id]} realNgRecords={realNgRecords[s.id]} passRecords={passRecords[s.id]} rawBatch={rawBatch[s.id]} expandedBuckets={expandedBuckets} onBucketToggle={onBucketToggle} uiLanguage={uiLanguage} bindingMatch={s.code === 'manu_shellbinding' ? bindingMatch : undefined} containerData={s.code === 'manu_pallet_binding' ? containerData : undefined} flowCounts={moduleStationFlowCounts[s.code]} repairSummary={s.code === 'manu_rework' ? repairSummary : undefined} />
      ))}

      {/* Manual line uses the real two-sided benches above; the former single
          straight conveyor was intentionally removed because it contradicted
          the left/right videos. */}
      {AUTO_FLOW_STATIONS.slice(0, -1).map((s, i) => (
        <Conveyor key={`a-${s.id}`} fromPx={s.px} toPx={AUTO_FLOW_STATIONS[i + 1].px} lineZ={AUTO_LINE_Z} />
      ))}
      {SMT_FLOW_STATIONS.slice(0, -1).map((s, i) => (
        <Conveyor key={`s-${s.id}`} fromPx={s.px} toPx={SMT_FLOW_STATIONS[i + 1].px} lineZ={SMT_LINE_Z} />
      ))}

      <PCB />

      <OrbitControls
        makeDefault
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        }}
        minDistance={3}
        maxDistance={150}
        maxPolarAngle={Math.PI / 2.05}
        target={[30, 1, 0]}
      />

      <CameraRig view={cameraView} />
    </>
  );
}

// ── Data Source badge color per type ──────────────────────────────────────────
const DS_BADGE: Record<string, { bg: string; label: string }> = {
  mysql:    { bg: "#047857", label: "MySQL" },
  sqlserver:{ bg: "#1e40af", label: "SQL Server" },
  dir:      { bg: "#854d0e", label: "文件目录" },
  unknown:  { bg: "#6b7280", label: "未配置" },
};

// ── Tooltip ──────────────────────────────────────────────────────────────────
// __DEBUG_NM_COPY_2026_07_13__
function Tooltip({ station, onClose, stats, stationData, dataFilter, onFilterChange, kpiData }: {
  station: Station; onClose: () => void;
  stats?: { total: number; pass: number; fail: number; dup: number };
  stationData?: any; dataFilter?: string; onFilterChange?: (v: string) => void;
  kpiData?: any;
}) {
  const ds = stationData;
  const srcType: string = ds?.sourceType ?? "unknown";
  const badge = DS_BADGE[srcType] ?? DS_BADGE.unknown;

  return (
    <div style={{
      position: "absolute",
      top: "50%", left: "50%",
      transform: "translate(-50%, -50%)",
      background: "rgba(15,23,42,0.97)",
      border: "1px solid #334155",
      borderRadius: 12,
      padding: "18px 22px",
      color: "#e2e8f0",
      fontFamily: "system-ui, sans-serif",
      fontSize: 13,
      minWidth: 380,
      maxWidth: 560,
      maxHeight: "80vh",
      overflowY: "auto",
      zIndex: 200,
      boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
    }}
      onClick={e => e.stopPropagation()}
    >
      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <strong style={{ fontSize: 16 }}>{station.nameZh}</strong>
          <span style={{
            background: badge.bg, color: "#fff", fontSize: 10,
            borderRadius: 4, padding: "2px 6px", fontWeight: 700,
          }}>{badge.label}</span>
        </div>
        <span onClick={onClose} style={{ color: "#64748b", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</span>
      </div>

      {/* ── Station info ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 14px", marginBottom: 12, background: "#1e293b", borderRadius: 8, padding: "10px 12px" }}>
        <span style={{ color: "#64748b" }}>工位</span><span style={{ fontFamily: "monospace" }}>{station.code}</span>
        <span style={{ color: "#64748b" }}>IP</span><span style={{ fontFamily: "monospace" }}>{station.ip || "—"}</span>
        <span style={{ color: "#64748b" }}>PASS</span><span style={{ color: "#4ade80" }}>{stats?.pass ?? station.wipCount ?? 0}</span>
        <span style={{ color: "#64748b" }}>FAIL</span>
        <span style={{ color: (stats?.fail ?? 0) > 0 ? "#ef4444" : "#22c55e", fontWeight: 700 }}>{stats?.fail ?? 0}</span>
      </div>

      {/* ── KPI Dashboard ── */}
      <div style={{ borderTop: "1px solid #334155", paddingTop: 12 }}>
        {!kpiData && (
          <div style={{ color: "#64748b", fontSize: 12, textAlign: "center", padding: "16px 0" }}>
            正在加载 KPI 数据…
          </div>
        )}
        {kpiData?.error && (
          <div style={{ color: "#ef4444", fontSize: 12, padding: "8px 0" }}>⚠️ {kpiData.error}</div>
        )}
        {kpiData && !kpiData.stats && !kpiData.error && (
          <div style={{ color: "#64748b", fontSize: 12, textAlign: "center", padding: "16px 0" }}>
            {kpiData.note ?? "今日无生产数据"}
          </div>
        )}
        {kpiData?.stats && (() => {
          const s = kpiData.stats;
          const passColor = s.pass_rate >= 95 ? "#4ade80" : s.pass_rate >= 90 ? "#facc15" : "#ef4444";
          const ngColor = s.ng_rate <= 2 ? "#4ade80" : s.ng_rate <= 5 ? "#facc15" : "#ef4444";
          return (
            <div>
              {/* KPI Cards */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                {[
                  { label: "良率", value: `${s.pass_rate}%`, color: passColor },
                  { label: "不良率", value: `${s.ng_rate}%`, color: ngColor },
                  { label: "DPU", value: s.dpu.toFixed(3), color: "#38bdf8" },
                  { label: "DPPM", value: s.dppm.toLocaleString(), color: "#a78bfa" },
                  { label: "产出", value: s.board_count.toLocaleString(), color: "#60a5fa" },
                  { label: "NG池", value: kpiData.ng_pool?.length ?? 0, color: "#f472b6" },
                ].map(card => (
                  <div key={card.label} style={{ background: "#1e293b", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#64748b", marginBottom: 2 }}>{card.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: card.color }}>{card.value}</div>
                  </div>
                ))}
              </div>

              {/* 7-Day Trend BarChart */}
              {kpiData.trend && kpiData.trend.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>7日趋势</div>
                  <ResponsiveContainer width="100%" height={100}>
                    <BarChart data={kpiData.trend} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                      <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#64748b" }} tickFormatter={d => d.slice(5)} />
                      <YAxis tick={{ fontSize: 9, fill: "#64748b" }} />
                      <RechartsTooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 11 }} />
                      <Bar dataKey="boards" name="产出" fill="#4ade80" maxBarSize={20} />
                      <Bar dataKey="ng" name="不良" fill="#ef4444" maxBarSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Defect Distribution */}
              {kpiData.defects && kpiData.defects.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>缺陷分布</div>
                  {kpiData.defects.slice(0, 5).map((d: any) => (
                    <div key={d.type} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "2px 0" }}>
                      <span style={{ color: "#e2e8f0" }}>{d.type}</span>
                      <span style={{ color: "#ef4444", fontWeight: 600 }}>{d.count}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* NG Pool Table */}
              {kpiData.ng_pool && kpiData.ng_pool.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>NG池 (最近)</div>
                  <div style={{ maxHeight: 120, overflowY: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                      <thead>
                        <tr style={{ color: "#64748b" }}>
                          <th style={{ textAlign: "left", padding: "2px 4px" }}>SN</th>
                          <th style={{ textAlign: "left", padding: "2px 4px" }}>模板</th>
                          <th style={{ textAlign: "right", padding: "2px 4px" }}>元件</th>
                          <th style={{ textAlign: "right", padding: "2px 4px" }}>时间</th>
                        </tr>
                      </thead>
                      <tbody>
                        {kpiData.ng_pool.slice(0, 10).map((r: any) => (
                          <tr key={r.id} style={{ borderTop: "1px solid #1e293b" }}>
                            <td style={{ padding: "2px 4px", color: "#f472b6" }}>{r.sn}</td>
                            <td style={{ padding: "2px 4px", color: "#e2e8f0" }}>{r.template}</td>
                            <td style={{ padding: "2px 4px", color: "#ef4444", textAlign: "right" }}>{r.failed_components}</td>
                            <td style={{ padding: "2px 4px", color: "#64748b", textAlign: "right" }}>{r.test_time?.slice(5, 16)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      <div onClick={onClose} style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #334155", fontSize: 11, color: "#64748b", textAlign: "center", cursor: "pointer" }}>
        点击空白关闭
      </div>
    </div>
  );
}

// ── NG Item Detail Panel ──────────────────────────────────────────────────────
function NgItemPanel({ item, onClose, onDispositionChange }: { item: NgItem; onClose: () => void; onDispositionChange: (value: 'repair' | 'fct' | 'depanel' | 'line' | 'return_source') => void }) {
  const defectDesc = item.defectDescription || item.defectCode;
  return (
    <div style={{
      position: "absolute",
      top: "50%", left: "50%",
      transform: "translate(-50%, -50%)",
      background: "rgba(15,23,42,0.97)",
      border: "1px solid #ef4444",
      borderRadius: 12,
      padding: "18px 22px",
      color: "#e2e8f0",
      fontFamily: "system-ui, sans-serif",
      fontSize: 13,
      minWidth: 360,
      zIndex: 300,
      boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
    }}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <strong style={{ fontSize: 16, color: "#ef4444" }}>NG Item</strong>
          <span style={{
            background: "#dc2626", color: "#fff", fontSize: 10,
            borderRadius: 4, padding: "2px 6px", fontWeight: 700,
          }}>{item.isConfirmed ? "已确认" : "待确认"}</span>
        </div>
        <span onClick={onClose} style={{ color: "#64748b", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</span>
      </div>

      {/* Properties */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 14px", marginBottom: 12, background: "#1e293b", borderRadius: 8, padding: "10px 12px" }}>
        <span style={{ color: "#64748b" }}>SN</span>
        <span style={{ fontFamily: "monospace", color: "#fbbf24" }}>{item.sn}</span>
        <span style={{ color: "#64748b" }}>缺陷代码</span>
        <span style={{ fontFamily: "monospace", color: "#ef4444" }}>{item.defectCode}</span>
        <span style={{ color: "#64748b" }}>缺陷描述</span>
        <span style={{ color: "#fca5a5" }}>{defectDesc}</span>
        <span style={{ color: "#64748b" }}>测试次数</span>
        <span style={{ color: "#22d3ee" }}>{item.testCount}次</span>
        <span style={{ color: "#64748b" }}>剩余重测</span>
        <span style={{ color: item.retestRemaining > 0 ? "#4ade80" : "#ef4444" }}>{item.retestRemaining}次</span>
        <span style={{ color: "#64748b" }}>年龄</span>
        <span style={{ color: item.isAged ? "#ef4444" : "#94a3b8" }}>{item.ageHours.toFixed(1)}h {item.isAged ? "⚠️" : ""}</span>
        <span style={{ color: "#64748b" }}>工站</span>
        <span style={{ fontFamily: "monospace" }}>{item.birthStation}</span>
        <span style={{ color: "#64748b" }}>地点</span>
        <span style={{ color: "#94a3b8" }}>{item.birthPlace}</span>
        {item.originStationCode && <>
          <span style={{ color: "#64748b" }}>来源工位</span>
          <span style={{ color: "#fbbf24" }}>{stationRouteLabel(item.originStationCode)}</span>
          <span style={{ color: "#64748b" }}>维修后返回</span>
          <span style={{ color: "#4ade80" }}>{stationRouteLabel(item.returnStationCode || item.originStationCode)}</span>
        </>}
        {item.operator && (
          <>
            <span style={{ color: "#64748b" }}>操作员</span>
            <span style={{ fontFamily: "monospace" }}>{item.operator}</span>
          </>
        )}
      </div>

      {item.isConfirmed && (
        <div style={{ marginBottom: 12, background: '#1e293b', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 6, background: '#450a0a', color: '#fecaca', fontWeight: 700 }}>
            没有测试机会，请转到维修站或 FCT 工站
          </div>
          <label htmlFor="confirmed-ng-disposition" style={{ display: 'block', color: '#fca5a5', marginBottom: 6, fontWeight: 700 }}>
            处理办法
          </label>
          <div style={{ position: 'relative' }}>
            <select
              id="confirmed-ng-disposition"
              value={item.disposition || ''}
              onChange={event => onDispositionChange(event.target.value as 'repair' | 'fct' | 'depanel' | 'line' | 'return_source')}
              style={{ width: '100%', padding: '8px 38px 8px 10px', borderRadius: 6, border: '1px solid #475569', background: '#0f172a', color: '#e2e8f0', fontSize: 13, appearance: 'none', cursor: 'pointer' }}
            >
              <option value="" disabled>请选择处理办法</option>
              <option value="repair">1 去维修站</option>
              {item.birthStation === 'manu_ict'
                ? <option value="depanel">2 去分板工位 ICT NG BOX</option>
                : item.birthStation === 'manu_fct'
                  ? <option value="depanel">2 去分板工位 FCT NG BOX</option>
                  : <option value="fct">2 去 FCT</option>}
              <option value="line">3 返回产线（撤销确认不良并放行）</option>
              {item.birthStation === 'manu_rework' && item.returnStationCode &&
                <option value="return_source">4 维修完成，返回原工位</option>}
            </select>
            <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#fbbf24', fontSize: 14, pointerEvents: 'none' }}>
              ▼
            </span>
          </div>
        </div>
      )}

      <div onClick={onClose} style={{ marginTop: 8, paddingTop: 10, borderTop: "1px solid #334155", fontSize: 11, color: "#64748b", textAlign: "center", cursor: "pointer" }}>
        点击空白关闭
      </div>
    </div>
  );
}

// ── Batch Item Panel — shows ICT NG batch details ─────────────────────────────
function BatchPanel({ batch, onClose }: { batch: any; onClose: () => void }) {
  const failBoards = (batch.subBoards || []).filter((b: any) => b.result === 'FAIL');
  const confirmedBoards = (batch.subBoards || []).filter((b: any) => b.isConfirmedNG);

  return (
    <div style={{
      position: "absolute",
      top: "50%", left: "50%",
      transform: "translate(-50%, -50%)",
      background: "rgba(15,23,42,0.97)",
      border: "1px solid #dc2626",
      borderRadius: 12,
      padding: "18px 22px",
      color: "#e2e8f0",
      fontFamily: "system-ui, sans-serif",
      fontSize: 13,
      minWidth: 420,
      maxHeight: "80vh",
      overflowY: "auto",
      zIndex: 300,
      boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
    }}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <strong style={{ fontSize: 16, color: "#ef4444" }}>NG Batch</strong>
          <span style={{
            background: confirmedBoards.length > 0 ? "#dc2626" : "#7f1d1d",
            color: "#fff", fontSize: 10,
            borderRadius: 4, padding: "2px 6px", fontWeight: 700,
          }}>{confirmedBoards.length > 0 ? "已确认NG" : "待确认"}</span>
        </div>
        <span onClick={onClose} style={{ color: "#64748b", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</span>
      </div>

      {/* Batch info */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 14px", marginBottom: 12, background: "#1e293b", borderRadius: 8, padding: "10px 12px" }}>
        <span style={{ color: "#64748b" }}>Main SN</span>
        <span style={{ fontFamily: "monospace", color: "#fbbf24" }}>{batch.mainSn}</span>
        <span style={{ color: "#64748b" }}>Batch ID</span>
        <span style={{ fontFamily: "monospace", color: "#fbbf24" }}>{batch.batchId}</span>
        <span style={{ color: "#64748b" }}>Overall</span>
        <span style={{ fontFamily: "monospace", color: "#ef4444" }}>{batch.overallResult}</span>
        <span style={{ color: "#64748b" }}>Slots</span>
        <span style={{ color: "#22d3ee" }}>{batch.slotCount} 个</span>
        <span style={{ color: "#64748b" }}>FAIL</span>
        <span style={{ color: "#ef4444" }}>{failBoards.length} 个</span>
        <span style={{ color: "#64748b" }}>Confirmed NG</span>
        <span style={{ color: "#f97316" }}>{confirmedBoards.length} 个</span>
        <span style={{ color: "#64748b" }}>Age</span>
        <span style={{ color: batch.isAged ? "#ef4444" : "#94a3b8" }}>{batch.ageHours}h {batch.isAged ? "⚠️" : ""}</span>
        <span style={{ color: "#64748b" }}>Station</span>
        <span style={{ fontFamily: "monospace" }}>{batch.stationCode}</span>
      </div>

      {/* Sub-boards table */}
      {failBoards.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ color: "#64748b", fontSize: 11, marginBottom: 6 }}>FAIL 子板</div>
          <div style={{ background: "#1e293b", borderRadius: 8, padding: "8px 10px", maxHeight: 200, overflowY: "auto" }}>
            {failBoards.map((b: any) => (
              <div key={b.slot} style={{ display: "grid", gridTemplateColumns: "40px 1fr 60px 60px", gap: 6, padding: "3px 0", borderBottom: "1px solid #334155", fontSize: 12 }}>
                <span style={{ color: "#64748b" }}>#{b.slot}</span>
                <span style={{ fontFamily: "monospace", color: "#fbbf24", overflow: "hidden", textOverflow: "ellipsis" }}>{b.sn}</span>
                <span style={{ color: "#ef4444" }}>{b.testCount}x</span>
                <span style={{ color: b.isConfirmedNG ? "#f97316" : "#94a3b8" }}>{b.isConfirmedNG ? "CONF" : "PENDING"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div onClick={onClose} style={{ marginTop: 8, paddingTop: 10, borderTop: "1px solid #334155", fontSize: 11, color: "#64748b", textAlign: "center", cursor: "pointer" }}>
        点击空白关闭
      </div>
    </div>
  );
}

// ── MysqlView ─────────────────────────────────────────────────────────────────
function MysqlView({ tables, host, port, database, filter, onFilterChange }: {
  tables: any[]; host: string; port: number; database: string;
  filter?: string; onFilterChange?: (v: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const f = (filter ?? "").toLowerCase();
  const filtered = tables.filter(t => !f || t.name.toLowerCase().includes(f) || t.columns.some((c: any) => c.field.toLowerCase().includes(f)));
  const totalRows = tables.reduce((a, t) => a + (t.totalRows ?? 0), 0);

  return (
    <div>
      <div style={{ fontSize: 12, color: "#60a5fa", fontWeight: 700, marginBottom: 8 }}>
        <span>🟢 {host}:{port}/{database}</span>
        <span style={{ color: "#64748b", fontWeight: 400, marginLeft: 8 }}>{tables.length} 表 · {totalRows.toLocaleString()} 行</span>
      </div>
      <input
        value={filter ?? ""}
        onChange={e => onFilterChange?.(e.target.value)}
        placeholder="🔍 搜索表名/列名…"
        style={{
          width: "100%", background: "#0f172a", border: "1px solid #334155",
          borderRadius: 6, padding: "6px 8px", color: "#e2e8f0", fontSize: 12,
          outline: "none", marginBottom: 8, boxSizing: "border-box",
        }}
      />
      <div style={{ maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
        {filtered.map(t => {
          const open = expanded[t.name] ?? false;
          const typeColors: Record<string, string> = { int: "#f59e0b", varchar: "#38bdf8", datetime: "#a78bfa", text: "#f472b6", decimal: "#34d399" };
          return (
            <div key={t.name} style={{ background: "#1e293b", borderRadius: 6, overflow: "hidden" }}>
              <div
                onClick={() => setExpanded(prev => ({ ...prev, [t.name]: !open }))}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 8px", cursor: "pointer", userSelect: "none" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: open ? "#60a5fa" : "#64748b", fontSize: 10 }}>{open ? "▾" : "▸"}</span>
                  <span style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 13 }}>{t.name}</span>
                  <span style={{ color: "#64748b", fontWeight: 400, fontSize: 11 }}>
                    {t.totalRows.toLocaleString()} 行
                  </span>
                </div>
                <div style={{ display: "flex", gap: 2 }}>
                  {t.columns.slice(0, 4).map((c: any) => (
                    <span key={c.field} style={{
                      background: "#334155", color: typeColors[c.type.split("(")[0]] ?? "#94a3b8",
                      fontSize: 9, borderRadius: 3, padding: "1px 4px",
                    }}>{c.field}</span>
                  ))}
                  {t.columns.length > 4 && <span style={{ color: "#64748b", fontSize: 9 }}>+{t.columns.length - 4}</span>}
                </div>
              </div>
              {open && (
                <div style={{ padding: "2px 8px 6px 20px", borderTop: "1px solid #0f172a" }}>
                  {t.columns.map((c: any) => {
                    const baseType = c.type.split("(")[0];
                    return (
                      <div key={c.field} style={{ display: "flex", gap: 6, fontSize: 11, padding: "2px 0", alignItems: "center" }}>
                        <span style={{ color: "#e2e8f0", fontWeight: 500 }}>{c.field}</span>
                        <span style={{
                          color: typeColors[baseType] ?? "#94a3b8",
                          fontSize: 10, background: "#0f172a", borderRadius: 3, padding: "0 4px",
                        }}>{c.type}</span>
                        {c.key === "PRI" && <span style={{ color: "#facc15", fontSize: 9 }}>🔑</span>}
                        {c.nullable && <span style={{ color: "#64748b", fontSize: 9 }}>NULL</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && <div style={{ textAlign: "center", color: "#64748b", fontSize: 12, padding: 12 }}>无匹配结果</div>}
      </div>
    </div>
  );
}

// ── SqlserverView — same layout as MysqlView ──────────────────────────────────
function SqlserverView(props: { tables: any[]; host: string; port: number; database: string; filter?: string; onFilterChange?: (v: string) => void }) {
  return <MysqlView {...props} />;
}

// ── DirView ───────────────────────────────────────────────────────────────────
function DirView({ files, path: dirPath, filter, onFilterChange }: {
  files: any[]; path: string; filter?: string; onFilterChange?: (v: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const f = (filter ?? "").toLowerCase();
  const filtered = files.filter(fi => !f || fi.name.toLowerCase().includes(f));
  const exts: Record<string, number> = {};
  files.forEach(fi => { if (fi.ext) exts[fi.ext] = (exts[fi.ext] ?? 0) + 1; });

  return (
    <div>
      <div style={{ fontSize: 12, color: "#f59e0b", fontWeight: 700, marginBottom: 8 }}>
        <span>📁 {dirPath}</span>
        <span style={{ color: "#64748b", fontWeight: 400, marginLeft: 8 }}>{files.length} 文件</span>
        <span style={{ color: "#64748b", fontWeight: 400, marginLeft: 6 }}>
          {Object.entries(exts).map(([ext, cnt]) => `${ext.replace(".", "").toUpperCase()}×${cnt}`).join(" ")}
        </span>
      </div>
      <input
        value={filter ?? ""}
        onChange={e => onFilterChange?.(e.target.value)}
        placeholder="🔍 搜索文件名…"
        style={{
          width: "100%", background: "#0f172a", border: "1px solid #334155",
          borderRadius: 6, padding: "6px 8px", color: "#e2e8f0", fontSize: 12,
          outline: "none", marginBottom: 8, boxSizing: "border-box",
        }}
      />
      <div style={{ maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
        {filtered.map(fi => (
          <div key={fi.name} style={{ background: "#1e293b", borderRadius: 6, overflow: "hidden" }}>
            <div
              onClick={() => fi.sheets ? setExpanded(prev => ({ ...prev, [fi.name]: !prev[fi.name] })) : undefined}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 8px", cursor: fi.sheets ? "pointer" : "default" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span>{fi.type === "dir" ? "📂" : fi.ext === ".xlsx" || fi.ext === ".xls" ? "📊" : "📄"}</span>
                <span style={{ color: "#e2e8f0", fontWeight: 500, fontSize: 13 }}>{fi.name}</span>
                {fi.size != null && (
                  <span style={{ color: "#64748b", fontSize: 10 }}>
                    {(fi.size / 1024).toFixed(1)} KB
                  </span>
                )}
              </div>
              {fi.sheets && (
                <span style={{ color: "#64748b", fontSize: 10 }}>
                  {fi.sheets.length} sheet
                  {fi.sheets.reduce((a: number, s: any) => a + (s.rows ?? 0), 0) > 0 && ` · ${fi.sheets.reduce((a: number, s: any) => a + (s.rows ?? 0), 0)} 行`}
                </span>
              )}
            </div>
            {fi.sheets && expanded[fi.name] && (
              <div style={{ padding: "2px 8px 6px 26px", borderTop: "1px solid #0f172a" }}>
                {fi.sheets.map((s: any) => (
                  <div key={s.name} style={{ display: "flex", gap: 8, fontSize: 11, padding: "2px 0" }}>
                    <span style={{ color: "#38bdf8" }}>{s.name}</span>
                    <span style={{ color: "#64748b" }}>{s.rows} 行</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {filtered.length === 0 && <div style={{ textAlign: "center", color: "#64748b", fontSize: 12, padding: 12 }}>无匹配文件</div>}
      </div>
    </div>
  );
}

// ── Settings Panel (fullscreen / day-night / light / sound) ──────────────────
function SettingsPanel({
  isFullscreen,
  toggleFullscreen,
  mode,
  setMode,
  lightScale,
  setLightScale,
  soundEnabled,
  setSoundEnabled,
  volume,
  setVolume,
}: {
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  lightScale: number;
  setLightScale: (v: number) => void;
  soundEnabled: boolean;
  setSoundEnabled: (b: boolean) => void;
  volume: number;
  setVolume: (v: number) => void;
}) {
  const [open, setOpen] = useState(false);

  const labelStyle: React.CSSProperties = {
    color: "#cbd5e1", fontSize: 11, marginBottom: 4, display: "block",
    textTransform: "uppercase", letterSpacing: 0.5,
  };
  const sliderStyle: React.CSSProperties = {
    width: "100%", accentColor: "#60a5fa", height: 4,
  };

  return (
    <div
      style={{
        position: "absolute", top: 16, right: 16, zIndex: 200,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {/* Settings toggle button */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Settings"
        style={{
          background: "rgba(15,23,42,0.92)",
          border: "1px solid #334155",
          borderRadius: 10,
          padding: "10px 12px",
          color: "#e2e8f0",
          fontSize: 16,
          cursor: "pointer",
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          display: "flex", alignItems: "center", gap: 6,
        }}
      >
        ⚙️
      </button>

      {open && (
        <div
          style={{
            marginTop: 8,
            background: "rgba(15,23,42,0.95)",
            border: "1px solid #334155",
            borderRadius: 10,
            padding: "14px 16px",
            minWidth: 240,
            color: "#e2e8f0",
            fontSize: 13,
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            backdropFilter: "blur(8px)",
          }}
        >
          {/* Fullscreen */}
          <button
            onClick={toggleFullscreen}
            style={{
              width: "100%",
              background: isFullscreen ? "#1e40af" : "#1e293b",
              border: "1px solid #475569",
              borderRadius: 6,
              padding: "8px 10px",
              color: "#e2e8f0",
              fontSize: 12,
              cursor: "pointer",
              marginBottom: 12,
              fontWeight: 600,
            }}
          >
            {isFullscreen ? "⛶ 退出全屏" : "⛶ 全屏显示"}
          </button>

          {/* Day / Night */}
          <div style={{ marginBottom: 12 }}>
            <span style={labelStyle}>🌗 模式</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => setMode("day")}
                style={{
                  flex: 1,
                  background: mode === "day" ? "#0ea5e9" : "#1e293b",
                  border: "1px solid #475569",
                  borderRadius: 6,
                  padding: "6px",
                  color: "#fff",
                  fontSize: 12,
                  cursor: "pointer",
                  fontWeight: mode === "day" ? 700 : 400,
                }}
              >
                ☀ 白天
              </button>
              <button
                onClick={() => setMode("night")}
                style={{
                  flex: 1,
                  background: mode === "night" ? "#1e3a8a" : "#1e293b",
                  border: "1px solid #475569",
                  borderRadius: 6,
                  padding: "6px",
                  color: "#fff",
                  fontSize: 12,
                  cursor: "pointer",
                  fontWeight: mode === "night" ? 700 : 400,
                }}
              >
                🌙 夜晚
              </button>
            </div>
          </div>

          {/* Light slider */}
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>
              💡 光照强度: {(lightScale * 100).toFixed(0)}%
            </label>
            <input
              type="range" min={0.2} max={1.5} step={0.05}
              value={lightScale}
              onChange={e => setLightScale(Number(e.target.value))}
              style={sliderStyle}
            />
          </div>

          {/* Sound */}
          <div style={{ marginBottom: 4 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={labelStyle}>🔊 声音</span>
              <button
                onClick={() => setSoundEnabled(!soundEnabled)}
                style={{
                  background: soundEnabled ? "#16a34a" : "#374151",
                  border: "none",
                  borderRadius: 4,
                  padding: "2px 8px",
                  color: "#fff",
                  fontSize: 10,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                {soundEnabled ? "开启" : "关闭"}
              </button>
            </div>
            <input
              type="range" min={0} max={1} step={0.01}
              value={volume}
              onChange={e => setVolume(Number(e.target.value))}
              disabled={!soundEnabled}
              style={{ ...sliderStyle, opacity: soundEnabled ? 1 : 0.4 }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Quick Views Panel (bottom strip — camera presets) ─────────────────────────
function QuickViewsPanel({
  activeId,
  onSelect,
}: {
  activeId: string | null;
  onSelect: (v: CamView) => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: 16,
        transform: "translateX(-50%)",
        zIndex: 150,
        background: "rgba(15,23,42,0.92)",
        border: "1px solid #334155",
        borderRadius: 10,
        padding: "8px 10px",
        backdropFilter: "blur(8px)",
        display: "flex",
        gap: 6,
        maxWidth: "calc(100% - 320px)",
        overflowX: "auto",
        fontFamily: "system-ui, sans-serif",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      }}
    >
      <div style={{
        fontSize: 10,
        color: "#64748b",
        alignSelf: "center",
        padding: "0 6px 0 2px",
        writingMode: "vertical-rl",
        textOrientation: "mixed",
      }}>
        快速视角
      </div>
      {CAM_VIEWS.map(v => {
        const active = v.id === activeId;
        return (
          <button
            key={v.id}
            onClick={() => onSelect(v)}
            title={v.label}
            style={{
              background: active ? "#0ea5e9" : "#1e293b",
              border: "1px solid " + (active ? "#38bdf8" : "#475569"),
              borderRadius: 6,
              padding: "6px 10px",
              color: active ? "#fff" : "#cbd5e1",
              fontSize: 11,
              cursor: "pointer",
              whiteSpace: "nowrap",
              fontWeight: active ? 700 : 400,
              transition: "all .15s",
            }}
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

// ── PDA / SMT 上料状态面板 ────────────────────────────────────────────────────
function LoaderStatusPanel({ station, bindings, activeWos, selectedWo, onWoChange, onClose }: {
  station: Station;
  bindings: any[];
  activeWos: any[];
  selectedWo: string;
  onWoChange: (wo: string) => void;
  onClose: () => void;
}) {
  const filtered = bindings.filter(b => !selectedWo || b._wo === selectedWo);
  const byMachine = filtered.reduce<Record<string, any[]>>((acc, b) => {
    const k = b.machineCode || "未知机台";
    if (!acc[k]) acc[k] = [];
    acc[k].push(b);
    return acc;
  }, {});

  const total = filtered.length;
  const confirmed = filtered.filter(b => b.status === "confirmed" || b.status === "loaded").length;
  const pending = total - confirmed;
  const pct = total > 0 ? Math.round((confirmed / total) * 100) : 0;

  return (
    <div style={{
      position: "absolute", top: "50%", left: "50%",
      transform: "translate(-50%, -50%)",
      background: "rgba(10,16,30,0.97)", border: "1px solid #1e40af",
      borderRadius: 14, padding: "20px 24px", color: "#e2e8f0",
      fontFamily: "system-ui, sans-serif", fontSize: 13,
      minWidth: 480, maxWidth: 620, maxHeight: "78vh", overflowY: "auto",
      zIndex: 200, boxShadow: "0 24px 64px rgba(0,0,0,0.7)",
    }} onClick={e => e.stopPropagation()}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#93c5fd" }}>
            {station.nameZh}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
            {station.code === "smt_pda_loading" ? "SMT产线 · 上料监控" : "手动线上料监控"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {/* Progress ring */}
          <svg width="44" height="44" viewBox="0 0 44 44">
            <circle cx="22" cy="22" r="18" fill="none" stroke="#1e293b" strokeWidth="4"/>
            <circle cx="22" cy="22" r="18" fill="none" stroke={pct >= 80 ? "#22c55e" : pct >= 50 ? "#eab308" : "#ef4444"}
              strokeWidth="4" strokeDasharray={`${pct * 1.13} 113`} strokeLinecap="round"
              transform="rotate(-90 22 22)"/>
            <text x="22" y="26" textAnchor="middle" fill="#e2e8f0" fontSize="11" fontWeight="700">{pct}%</text>
          </svg>
          <button onClick={onClose} style={{
            background: "#1e293b", border: "1px solid #334155", color: "#94a3b8",
            borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 12
          }}>关闭</button>
        </div>
      </div>

      {/* WO selector */}
      {activeWos.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 5 }}>工单</div>
          <select value={selectedWo} onChange={e => onWoChange(e.target.value)} style={{
            width: "100%", background: "#0f172a", border: "1px solid #1e40af",
            color: "#93c5fd", borderRadius: 6, padding: "6px 10px", fontSize: 12,
          }}>
            {activeWos.map((wo: any) => (
              <option key={wo.code} value={wo.code}>{wo.code} · {wo.productCode} · {wo.plannedQty}件</option>
            ))}
          </select>
        </div>
      )}

      {/* Stats row */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        {[
          { label: "已上料", value: confirmed, color: "#22c55e" },
          { label: "待确认", value: pending, color: "#f59e0b" },
          { label: "总计", value: total, color: "#94a3b8" },
        ].map(s => (
          <div key={s.label} style={{
            flex: 1, background: "#0f172a", borderRadius: 8, padding: "10px 12px",
            border: "1px solid #1e293b", textAlign: "center"
          }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Per-machine breakdown */}
      {Object.entries(byMachine).map(([machine, binds]: [string, any[]]) => {
        const machineBindings = binds as any[];
        const done = machineBindings.filter((b: any) => b.status === "confirmed" || b.status === "loaded").length;
        const total2 = machineBindings.length;
        return (
          <div key={machine} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ color: "#93c5fd", fontWeight: 600 }}>机台: {machine}</span>
              <span style={{ color: "#64748b", fontSize: 11 }}>{done}/{total2} 已上料</span>
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {machineBindings.map((b: any, i: number) => {
                const isDone = b.status === "confirmed" || b.status === "loaded";
                return (
                  <div key={i} style={{
                    background: isDone ? "#052e16" : "#1c1408",
                    border: `1px solid ${isDone ? "#166534" : "#92400e"}`,
                    borderRadius: 5, padding: "4px 8px", fontSize: 11,
                    color: isDone ? "#86efac" : "#fcd34d",
                    minWidth: 70,
                  }}>
                    <div style={{ fontWeight: 600 }}>{b.slotNo ?? b.feederNo ?? i + 1}</div>
                    <div style={{ color: "#64748b", fontSize: 10, marginTop: 1 }}>{b.lotNo || "—"}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {total === 0 && (
        <div style={{ textAlign: "center", padding: "24px 0", color: "#475569" }}>
          暂无上料数据，请先在PDA上执行上料操作
        </div>
      )}
    </div>
  );
}

export function ManualLineDashboard() {
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>("zh");
  const [selected, setSelected] = useState<Station | null>(null);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [mode, setMode] = useState<Mode>("night");
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const requestedView = new URLSearchParams(window.location.search).get("view");
    return requestedView === "material-warehouse" ? "material" : "full";
  });
  const [tabBarCollapsed, setTabBarCollapsed] = useState(false);
  const [showRealtimeSync, setShowRealtimeSync] = useState(true);
  const [showNgTrace, setShowNgTrace] = useState(true);
  const [realtimeSyncEvents, setRealtimeSyncEvents] = useState<Array<{
    id: string; time: number; stationCode: string; stationName: string; type: string; summary: string;
    destination: string; isNgFlow: boolean;
  }>>([]);
  const realtimeSyncScrollRef = useRef<HTMLDivElement>(null);
  const [lightScale, setLightScale] = useState(1);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [volume, setVolume] = useState(0.4);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [heartbeatPos, setHeartbeatPos] = useState({ x: 16, y: 16 });
  const heartbeatDragRef = useRef<{ started: boolean; startX: number; startY: number; startPx: number; startPy: number }>({ started: false, startX: 0, startY: 0, startPx: 0, startPy: 0 });
  const [cameraView, setCameraView] = useState<CamView | null>(CAM_VIEWS[0]);
  const [showWarehouse3d, setShowWarehouse3d] = useState(false); // TODO: remove, replaced by viewMode=warehouse
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const ngItemRef = useRef<HTMLDivElement>(null);
  const [selectedNgItem, setSelectedNgItem] = useState<NgItem | null>(null);
  const [ngTransfers, setNgTransfers] = useState<Array<{ id: number; sn: string; destination: 'repair' | 'fct' }>>([]);
  const batchItemRef = useRef<HTMLDivElement>(null);
  const [selectedBatch, setSelectedBatch] = useState<any>(null);
  const [flashes, setFlashes] = useState<Record<number, { sn: string; scannedAt: number; batchId?: string }>>({});
  const lastSnRef = useRef<Record<string, string>>({});
  const [wsConnected, setWsConnected] = useState<Record<number, boolean>>({});
  const [wsAlive, setWsAlive] = useState<Record<number, boolean>>({}); // heartbeat: received msg < 10s
  const lastMsgAtRef = useRef<Record<number, number>>({});
  const [stationStats, setStationStats] = useState<Record<number, { total: number; pass: number; fail: number; dup: number }>>({});
  const [stationData, setStationData] = useState<Record<string, any>>({});
  const [dataFilter, setDataFilter] = useState("");
  const [kpiData, setKpiData] = useState<Record<string, any>>({});
  const [ictFctMismatch, setIctFctMismatch] = useState<{ ict: number; fct: number; pending: string[] }>({ ict: 0, fct: 0, pending: [] });
  const [ngRecords, setNgRecords] = useState<Record<number, NgRecord[]>>({}); // 当天NG记录 per station
  // 注册 forceUpdate 到模块变量，供 SSE 回调触发重渲染
  const [, forceUpdate] = useState(0);
  moduleFlowForceUpdate = forceUpdate;
  moduleSnForceUpdate = forceUpdate;

  // ── Feeder Binding / PDA 上料状态 ──────────────────────────────────
  const [feederBindings, setFeederBindings] = useState<any[]>([]);
  const [activeWos, setActiveWos] = useState<any[]>([]);
  const [selectedWo, setSelectedWo] = useState<string>("");

  // Poll feeder bindings for SMT PDA stations (10s interval)
  useEffect(() => {
    let cancelled = false;
    async function loadFeederData() {
      try {
        const woRes = await pmcApi.getWorkOrders({ status: "running", limit: 10 });
        const wos = (woRes.data?.items ?? []).filter((w: any) =>
          w.status === "running" || w.status === "released"
        );
        if (cancelled) return;
        setActiveWos(wos);
        if (wos.length > 0 && !selectedWo) setSelectedWo(wos[0].code);

        const allBindings: any[] = [];
        await Promise.all(
          wos.slice(0, 5).map(async (wo: any) => {
            try {
              const res = await mesApi.getFeederBindings({ workOrderCode: wo.code, bound: true, limit: 50 });
              if (!cancelled && res.data?.items) {
                allBindings.push(...res.data.items.map((b: any) => ({ ...b, _wo: wo.code })));
              }
            } catch { /* skip individual WO failures */ }
          })
        );
        if (cancelled) return;
        setFeederBindings(allBindings.sort((a, b) =>
          new Date(b.boundAt).getTime() - new Date(a.boundAt).getTime()
        ));
      } catch { /* silent fail */ }
    }
    loadFeederData();
    const id = setInterval(loadFeederData, 10000);
    return () => { cancelled = true; clearInterval(id); };
  }, [selectedWo]);

  useEffect(() => {
    if (!showRealtimeSync) return;
    const panel = realtimeSyncScrollRef.current;
    if (panel) panel.scrollTop = panel.scrollHeight;
  }, [realtimeSyncEvents, showRealtimeSync]);
  const [realNgRecords, setRealNgRecords] = useState<Record<number, NgRecord[]>>({}); // 确认NG记录 per station
  const [passRecords, setPassRecords] = useState<Record<number, PassRecord[]>>({}); // PASS记录 per station
  const [rawBatch, setRawBatch] = useState<Record<number, any>>({}); // 原始批次对象 per station
  const [handoverRecords, setHandoverRecords] = useState<HandoverRecord[]>([]);
  const [repairWorkOrders, setRepairWorkOrders] = useState<any[]>([]);
  const [revivalRecords, setRevivalRecords] = useState<any[]>([]);
  const [residenceMonitor, setResidenceMonitor] = useState<{ thresholdMinutes: number; summary: any[]; current: any[] }>({ thresholdMinutes: 30, summary: [], current: [] });
  const [continuity, setContinuity] = useState<{summary:{total:number;critical:number;warning:number};gaps:any[]}>(
    {summary:{total:0,critical:0,warning:0},gaps:[]});
  const [mesManagers,setMesManagers]=useState<any[]>([]);
  const [managerTarget,setManagerTarget]=useState('ROUTE_MANAGER');
  const [managerCommand,setManagerCommand]=useState('REPORT_NOW');
  const [managerOperator,setManagerOperator]=useState('');
  const [managerNote,setManagerNote]=useState('');
  const [managerInstructionStatus,setManagerInstructionStatus]=useState('');
  const sendManagerInstruction=async()=>{
    if(!managerOperator.trim()){setManagerInstructionStatus('Enter your name / 请输入姓名');return;}
    setManagerInstructionStatus('Sending…');
    try{
      const response=await fetch('/api/mes/managers/instructions',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({managerCode:managerTarget,command:managerCommand,instructedBy:managerOperator.trim(),note:managerNote.trim()})});
      const data=await response.json();
      if(!response.ok)throw new Error(data?.error?.message||data?.message||`HTTP ${response.status}`);
      setManagerInstructionStatus(`Accepted #${data.instructionId}`);
      setManagerNote('');
    }catch(error){setManagerInstructionStatus(String(error));}
  };
  useEffect(() => {
    let cancelled = false;
    const refresh = () => fetch('/api/station/handovers')
      .then(response => response.ok ? response.json() : Promise.reject(response.status))
      .then(data => { if (!cancelled) setHandoverRecords(data.items || []); })
      .catch(() => {});
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => fetch('/api/station/maintenance-handovers')
      .then(response => response.ok ? response.json() : Promise.reject(response.status))
      .then(data => {
        if (cancelled) return;
        // A repair return is another route request, not another repair work order.
        // Count only records entering maintenance (or records carrying an actual RWO).
        const repairItems = (data.items || []).filter((item: any) =>
          canonicalStationCode(item.destinationStation) === 'manu_rework'
          || Boolean(item.repairWorkOrderNo)
        );
        setRepairWorkOrders(repairItems);
      })
      .catch(() => {});
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  useEffect(()=>{
    let cancelled=false;
    const refresh=()=>fetch('/api/mes/managers/status')
      .then(response=>response.ok?response.json():Promise.reject(response.status))
      .then(data=>{if(!cancelled)setMesManagers(data.managers||[])})
      .catch(()=>{if(!cancelled)setMesManagers([])});
    refresh();
    const timer=window.setInterval(refresh,5000);
    return()=>{cancelled=true;window.clearInterval(timer)};
  },[]);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => fetch('/api/station/residence-stats')
      .then(response => response.ok ? response.json() : Promise.reject(response.status))
      .then(data => { if (!cancelled) setResidenceMonitor({ thresholdMinutes: data.thresholdMinutes || 30,
        summary: data.summary || [], current: data.current || [] }); })
      .catch(() => {});
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const response = await fetch('/api/mes/manual-line/continuity-gaps');
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json();
        if (!cancelled) setContinuity({summary:data.summary || {total:0,critical:0,warning:0},gaps:data.gaps || []});
      } catch {
        // Retain the last successful snapshot during a transient MES delay.
      } finally {
        loading = false;
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => fetch('/api/rework/revival-board')
      .then(response => response.ok ? response.json() : Promise.reject(response.status))
      .then(data => { if (!cancelled) setRevivalRecords(data.items || []); })
      .catch(() => {});
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  const [bindingMatch, setBindingMatch] = useState<{ shellSn?: string; boardSn?: string }>({});
  const [containerData, setContainerData] = useState<any>(() => {
    try { return JSON.parse(localStorage.getItem('manu_pallet_binding_container') || 'null'); }
    catch { return null; }
  });
  useEffect(() => {
    if (containerData) localStorage.setItem('manu_pallet_binding_container', JSON.stringify(containerData));
  }, [containerData]);
  useEffect(() => {
    let cancelled = false;
    const refreshPallet = () => fetch('/api/station/pallets')
      .then(response => response.ok ? response.json() : Promise.reject(response.status))
      .then(data => {
        const latest = data.items?.[0];
        if (!cancelled && latest) setContainerData({ ...latest, remaining: Math.max(0, Number(latest.targetCartons) - Number(latest.cartonCount)) });
      })
      .catch(() => {});
    refreshPallet();
    const timer = window.setInterval(refreshPallet, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  const [bucketSnapshotsReady, setBucketSnapshotsReady] = useState(false);
  const bucketVersionsRef = useRef<Record<string, number>>({});
  const applyingServerSnapshotRef = useRef(false);
  const ngRecordsRef = useRef(ngRecords);
  const realNgRecordsRef = useRef(realNgRecords);
  const passRecordsRef = useRef(passRecords);
  useEffect(() => { ngRecordsRef.current = ngRecords; }, [ngRecords]);
  useEffect(() => { realNgRecordsRef.current = realNgRecords; }, [realNgRecords]);
  useEffect(() => { passRecordsRef.current = passRecords; }, [passRecords]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/station/bucket-snapshots')
      .then(response => response.ok ? response.json() : Promise.reject(new Error(`snapshot ${response.status}`)))
      .then(data => {
        if (cancelled) return;
        const pending: Record<number, NgRecord[]> = {};
        const confirmed: Record<number, NgRecord[]> = {};
        const passed: Record<number, PassRecord[]> = {};
        const stats: Record<number, { total: number; pass: number; fail: number; dup: number }> = {};
        for (const snapshot of data.items || []) {
          const canonicalCode = canonicalStationCode(snapshot.stationCode);
          const station = STATION_BY_CODE[canonicalCode];
          if (!Array.isArray(snapshot.payload)) continue;
          if (snapshot.bucketName === 'pending_ng') pending[station.id] = snapshot.payload;
          if (snapshot.bucketName === 'confirmed_ng') confirmed[station.id] = snapshot.payload;
          if (snapshot.bucketName === 'pass') passed[station.id] = snapshot.payload;
          if (snapshot.bucketName === 'stats' && snapshot.payload[0]) stats[station.id] = snapshot.payload[0];
          bucketVersionsRef.current[`${canonicalCode}:${snapshot.bucketName}`] = Number(snapshot.version) || 0;
        }
        setNgRecords(pending);
        setRealNgRecords(confirmed);
        setPassRecords(passed);
        setStationStats(stats);
        // 同步SN列表到moduleStationSnLists（3D产线SN显示的数据源）
        for (const [stationId, records] of Object.entries(passed)) {
          const station = STATIONS.find(s => String(s.id) === String(stationId));
          if (!station || !Array.isArray(records)) continue;
          const list: SnEntry[] = records.map(r => ({ sn: (r.sn as string | null | undefined) ?? '', result: 'PASS' as const, time: r.time }));
          if (list.length > 0) moduleStationSnLists[station.code] = list;
        }
        // 同步FAIL SN（pending_ng + confirmed_ng）
        for (const [stationId, records] of Object.entries(pending)) {
          const station = STATIONS.find(s => String(s.id) === String(stationId));
          if (!station || !Array.isArray(records)) continue;
          const list: SnEntry[] = records.map(r => ({ sn: (r.sn as string | null | undefined) ?? '', result: 'FAIL' as const, time: r.lastTestTime || r.birthTime || 0 }));
          if (list.length > 0) moduleStationSnLists[station.code] = list;
        }
        for (const [stationId, records] of Object.entries(confirmed)) {
          const station = STATIONS.find(s => String(s.id) === String(stationId));
          if (!station || !Array.isArray(records)) continue;
          const list: SnEntry[] = records.map(r => ({ sn: (r.sn as string | null | undefined) ?? '', result: 'FAIL' as const, time: r.lastTestTime || r.birthTime || 0 }));
          if (list.length > 0) moduleStationSnLists[station.code] = list;
        }
        // 触发3D产线SN显示重渲染（moduleStationSnLists已从快照填充）
        moduleSnForceUpdate?.(n => n + 1);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setBucketSnapshotsReady(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!bucketSnapshotsReady) return;
    // Production browsers are read-only projections. Only MES server code may
    // commit station_bucket_snapshots; this prevents competing tabs/users from
    // overwriting one another with stale React state.
    const browserSnapshotWritesEnabled = false;
    if (!browserSnapshotWritesEnabled) return;
    if (applyingServerSnapshotRef.current) {
      applyingServerSnapshotRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      for (const station of DISPLAY_STATIONS) {
        const snapshots = [
          ['pending_ng', ngRecords[station.id] || []],
          ['confirmed_ng', realNgRecords[station.id] || []],
          ['pass', passRecords[station.id] || []],
          ['stats', [stationStats[station.id] || { total: 0, pass: 0, fail: 0, dup: 0 }]],
        ] as const;
        for (const [bucketName, payload] of snapshots) {
          fetch(`/api/station/bucket-snapshots/${station.code}/${bucketName}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload }),
          }).catch(() => {});
        }
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [bucketSnapshotsReady, ngRecords, realNgRecords, passRecords, stationStats]);

  // Reconcile from the MES authority after reconnects or missed broadcasts.
  // Versions prevent an older response from replacing newer browser state.
  useEffect(() => {
    if (!bucketSnapshotsReady) return;
    const reconcile = () => fetch('/api/station/bucket-snapshots')
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(data => {
        for (const snapshot of data.items || []) {
          const canonicalCode = canonicalStationCode(snapshot.stationCode);
          const station = STATION_BY_CODE[canonicalCode];
          const key = `${canonicalCode}:${snapshot.bucketName}`;
          const version = Number(snapshot.version) || 0;
          if (!station || !Array.isArray(snapshot.payload) || version <= (bucketVersionsRef.current[key] || 0)) continue;
          bucketVersionsRef.current[key] = version;
          applyingServerSnapshotRef.current = true;
          if (snapshot.bucketName === 'pending_ng') {
            setNgRecords(prev => ({ ...prev, [station.id]: snapshot.payload }));
            // 同步FAIL SN到moduleStationSnLists
            const list: SnEntry[] = snapshot.payload.map((r: NgRecord) => ({ sn: (r.sn as string | null | undefined) ?? '', result: 'FAIL' as const, time: r.lastTestTime || r.birthTime || 0 }));
            if (list.length > 0) moduleStationSnLists[station.code] = list;
            else delete moduleStationSnLists[station.code];
          }
          else if (snapshot.bucketName === 'confirmed_ng') {
            setRealNgRecords(prev => ({ ...prev, [station.id]: snapshot.payload }));
            // 同步FAIL SN到moduleStationSnLists
            const list: SnEntry[] = snapshot.payload.map((r: NgRecord) => ({ sn: (r.sn as string | null | undefined) ?? '', result: 'FAIL' as const, time: r.lastTestTime || r.birthTime || 0 }));
            if (list.length > 0) moduleStationSnLists[station.code] = list;
            else delete moduleStationSnLists[station.code];
          }
          else if (snapshot.bucketName === 'pass') {
            setPassRecords(prev => ({ ...prev, [station.id]: snapshot.payload }));
            // 同步更新moduleStationSnLists（3D产线SN显示数据源）
            const list: SnEntry[] = snapshot.payload.map((r: PassRecord) => ({ sn: (r.sn as string | null | undefined) ?? '', result: 'PASS' as const, time: r.time }));
            if (list.length > 0) moduleStationSnLists[station.code] = list;
            else delete moduleStationSnLists[station.code];
          }
          else if (snapshot.bucketName === 'stats' && snapshot.payload[0]) setStationStats(prev => ({ ...prev, [station.id]: snapshot.payload[0] }));
        }
      })
      .catch(() => {});
    const timer = window.setInterval(reconcile, 3000);
    return () => window.clearInterval(timer);
  }, [bucketSnapshotsReady]);
  const [expandedBuckets, setExpandedBuckets] = useState<Record<string, boolean>>({}); // bucket toggle state: key = `${stationId}-${label}`
  const [showDataFlowPanel, setShowDataFlowPanel] = useState(false);   // MES 数据接力监控
  const [showResidencePanel, setShowResidencePanel] = useState(false); // 工位滞留时间监控
  const [showNgRevivalPanel, setShowNgRevivalPanel] = useState(false); // NG 复活看板
  const [showMonitorDrawer, setShowMonitorDrawer] = useState(false);
  // DEBUG: expose state to window for testing
  useEffect(() => {
    (window as any).debugData = { ngRecords, realNgRecords, passRecords, rawBatch, expandedBuckets, stationStats, STATIONS };
    // Test helper: window.testToggle(stationId, label) to open bucket detail
    (window as any).testToggle = (stationId: number, label: string) => {
      const key = `${stationId}-${label}`;
      setExpandedBuckets(prev => {
        if (prev[key]) return prev;
        const next: Record<string, boolean> = {};
        next[key] = true;
        return next;
      });
    };
    (window as any).testSetNgRecords = (data: Record<number, any[]>) => setNgRecords(data);
    (window as any).testSetPassRecords = (data: Record<number, PassRecord[]>) => setPassRecords(data);
    (window as any).testSetStationStats = (data: Record<number, any>) => setStationStats(data);
  }, [ngRecords, realNgRecords, passRecords, rawBatch, expandedBuckets, stationStats]);

  useFactoryAudio(volume, soundEnabled);


  const handleClick = useCallback((s: Station) => {
    setSelected(prev => prev?.id === s.id ? null : s);
    const z = s.id === 14 ? -5 : s.id >= 101 ? -12 : s.id >= 15 ? 10 : 7;
    // Camera directly in front of station (no angle)
    setCameraView({
      id: `station-${s.id}`,
      label: s.nameZh,
      position: [s.px, 4, z + 10] as [number, number, number],
      target: [s.px, 1, z] as [number, number, number],
    });
  }, []);

  const clearIctStationData = useCallback(async () => {
    if (!window.confirm('Clear all ICT station display data?\n确认清空 ICT 工位全部显示数据？')) return;
    const response = await fetch('/api/station/data/manu_ict', { method: 'DELETE' });
    if (!response.ok) {
      window.alert(`ICT clear failed / 清空失败: HTTP ${response.status}`);
      return;
    }
    setNgRecords(current => ({ ...current, 4: [] }));
    setRealNgRecords(current => ({ ...current, 4: [] }));
    setPassRecords(current => ({ ...current, 4: [] }));
    setRawBatch(current => { const next = { ...current }; delete next[4]; return next; });
    setStationStats(current => ({ ...current, 4: { total: 0, pass: 0, fail: 0, dup: 0 } }));
    setFlashes(current => { const next = { ...current }; delete next[4]; return next; });
    setExpandedBuckets({});
    setSelectedBatch(null);
    setSelectedNgItem(null);
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith('confirmed-ng-disposition:')) localStorage.removeItem(key);
    }
  }, []);

  // 清空所有工位数据（通过API删除 + SSE广播触发UI同步）
  const clearAllStationsData = useCallback(async () => {
    const stations = DISPLAY_STATIONS;
    const names = stations.map(s => s.nameZh).join('、');
    if (!window.confirm(`确认清空以下工位全部数据？\n${names}\n\n此操作不可恢复！`)) return;
    for (const station of stations) {
      try {
        await fetch(`/api/station/data/${station.code}`, { method: 'DELETE' });
      } catch { /* broadcast handles cleanup */ }
    }
  }, []);

  const handleNgBlockClick = useCallback((item: NgItem) => {
    const saved = localStorage.getItem(`confirmed-ng-disposition:${item.sn}`) as 'repair' | 'fct' | 'depanel' | null;
    const nextItem = saved ? { ...item, disposition: saved } : item;
    setSelectedNgItem(prev => prev?.sn === item.sn ? null : nextItem);
  }, []);

  const saveNgDisposition = useCallback(async (sn: string, value: 'repair' | 'fct') => {
    setSelectedNgItem(current => current?.sn === sn ? { ...current, disposition: value } : current);
    const sourceEntry = Object.entries(realNgRecords).find(([, records]) => records.some(record => record.sn === sn));
    if (!sourceEntry) return;
    const sourceStationId = Number(sourceEntry[0]);
    const sourceStation = STATIONS.find(station => station.id === sourceStationId);
    const sourceStationCode = sourceStation?.code || 'unknown';
    const sourceRecords = sourceEntry[1];
    const sourceRecord = sourceRecords.find(record => record.sn === sn);
    if (!sourceRecord) return;
    const motherboardRecords = sourceRecords.filter(record =>
      sourceRecord.batchId
        ? record.batchId === sourceRecord.batchId && record.isConfirmed
        : record.sn === sn
    );
    const goodSiblingRecords = (passRecords[sourceStationId] || []).filter(record =>
      Boolean(sourceRecord.batchId) && record.batchId === sourceRecord.batchId
    );
    const migratingSns = new Set(motherboardRecords.map(record => record.sn));
    const migratingGoodSns = new Set(goodSiblingRecords.map(record => record.sn));
    const destinationStationId = value === 'repair' ? 14 : 5;
    const destinationStation = STATIONS.find(station => station.id === destinationStationId);

    if (value === 'repair') {
      try {
        await Promise.all(motherboardRecords.map(async record => {
          const response = await fetch('/api/rework/local-ng', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sn: record.sn,
              sourceStation: sourceStationCode,
              batchId: record.batchId,
              slot: record.slot,
              defectCode: record.defectCode,
              defectReason: record.defectDescription,
              returnStation: sourceStationCode,
            }),
          });
          if (!response.ok) throw new Error(`${record.sn}: HTTP ${response.status}`);
        }));
      } catch (error) {
        window.alert(`维修站 SQLite 写入失败，整块母板未转移：${String(error)}`);
        return;
      }
    }

    const mesCommand = await fetch('/api/station/operator-command', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'MIGRATE_BATCH', sourceStationCode,
        destinationStationCode: destinationStation?.code,
        batchId: sourceRecord.batchId, sn: sourceRecord.sn,
        destinationBucket: 'confirmed_ng', disposition: value,
      }),
    });
    if (!mesCommand.ok) {
      window.alert(`MES migration failed / MES杞Щ澶辫触: HTTP ${mesCommand.status}`);
      return;
    }

    const transferId = Date.now();
    const motherboardUnits = [
      ...motherboardRecords.map(record => record.sn),
      ...goodSiblingRecords.map(record => record.sn),
    ];
    setNgTransfers(current => [
      ...current,
      ...motherboardUnits.map((unitSn, index) => ({
        id: transferId + index,
        sn: unitSn,
        destination: value,
      })),
    ]);
    await new Promise(resolve => window.setTimeout(resolve, 1400));
    setNgTransfers(current => current.filter(item => item.id < transferId || item.id >= transferId + motherboardUnits.length));

    // Keep the confirmed lifecycle when routing to another station.
    const routedRecords: NgRecord[] = motherboardRecords.map(record => ({
        ...record,
        disposition: value,
        originStationCode: record.originStationCode || sourceStationCode,
        returnStationCode: sourceStationCode,
        defectDescription: value === 'repair'
          ? `${sourceStationCode} Confirmed NG → 维修站`
          : `${sourceStationCode} Confirmed NG → FCT`,
        time: Date.now(),
        testCount: Math.max(record.testCount, 3),
        isConfirmed: true,
      }));
      setRealNgRecords(records => {
        const withoutSource = Object.fromEntries(
          Object.entries(records).map(([stationId, items]) => [
            stationId,
            items.filter(record => !migratingSns.has(record.sn)),
          ])
        ) as Record<number, NgRecord[]>;
        const destination = (withoutSource[destinationStationId] || []).filter(record => !migratingSns.has(record.sn));
        return { ...withoutSource, [destinationStationId]: [...destination, ...routedRecords] };
      });
      setPassRecords(records => {
        const withoutSource = Object.fromEntries(
          Object.entries(records).map(([stationId, items]) => [
            stationId,
            items.filter(record => !migratingGoodSns.has(record.sn)),
          ])
        ) as Record<number, PassRecord[]>;
        const destination = (withoutSource[destinationStationId] || []).filter(
          record => !migratingGoodSns.has(record.sn)
        );
        const routedGoodSiblings = goodSiblingRecords.map(record => ({
          ...record,
          time: Date.now(),
          stationCode: destinationStation?.code || (value === 'repair' ? 'manu_rework' : 'manu_fct'),
          stationName: destinationStation?.nameZh || (value === 'repair' ? '回修站' : 'FCT'),
        }));
        return { ...withoutSource, [destinationStationId]: [...destination, ...routedGoodSiblings] };
      });
      setStationStats(stats => {
        const current = stats[destinationStationId] ?? { total: 0, pass: 0, fail: 0, dup: 0 };
        return {
          ...stats,
          [destinationStationId]: {
            ...current,
            total: current.total + routedRecords.length + goodSiblingRecords.length,
            pass: current.pass + goodSiblingRecords.length,
            fail: current.fail + routedRecords.length,
          },
        };
      });
    motherboardRecords.forEach(record =>
      localStorage.setItem(`confirmed-ng-disposition:${record.sn}`, value)
    );
    setSelectedNgItem(null);
  }, [passRecords, realNgRecords]);

  const releaseConfirmedNgToLine = useCallback(async (item: NgItem) => {
    const sourceRecord = Object.values(realNgRecords).flat().find(record => record.sn === item.sn);
    if (!sourceRecord) return;
    const released = Object.values(realNgRecords).flat().filter(record =>
      sourceRecord.batchId ? record.batchId === sourceRecord.batchId && record.isConfirmed : record.sn === item.sn
    );
    try {
      await Promise.all(released.map(async record => {
        const response = await fetch('/api/rework/clear-ng', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sn: record.sn, repairResult: 'pass', operator: '3D_LINE_RELEASE' }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(`${record.sn}: HTTP ${response.status}`);
        if (result.approvalRequired) throw new Error(`${record.sn}: 已提交复活申请，等待主管批准后请再次执行返回`);
      }));
    } catch (error) {
      window.alert(`MES 撤销确认不良失败，产品仍被拦截：${String(error)}`);
      return;
    }
    const mesCommand = await fetch('/api/station/operator-command', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'RELEASE_CONFIRMED',
        sourceStationCode: item.birthStation || sourceRecord.originStationCode || 'manu_rework',
        batchId: sourceRecord.batchId, sn: sourceRecord.sn,
      }),
    });
    if (!mesCommand.ok) {
      window.alert(`MES release failed / MES鏀捐澶辫触: HTTP ${mesCommand.status}`);
      return;
    }
    const releasedSns = new Set(released.map(record => record.sn));
    setRealNgRecords(records => Object.fromEntries(
      Object.entries(records).map(([stationId, rows]) => [stationId, rows.filter(record => !releasedSns.has(record.sn))])
    ) as Record<number, NgRecord[]>);
    released.forEach(record => {
      localStorage.removeItem(`confirmed-ng-disposition:${record.sn}`);
      localStorage.setItem(`confirmed-ng-release:${record.sn}`, JSON.stringify({
        releasedAt: Date.now(), batchId: record.batchId, action: 'RETURN_TO_LINE', operator: '3D_LINE_RELEASE',
      }));
    });
    setSelectedNgItem(null);
  }, [realNgRecords]);

  const routeConfirmedToDepanel = useCallback(async (item: NgItem) => {
    const sourceStationId = item.birthStation === 'manu_fct' ? 5 : 4;
    const sourceKind = sourceStationId === 5 ? 'FCT' : 'ICT';
    const source = (realNgRecords[sourceStationId] || []).find(record => record.sn === item.sn);
    if (!source) return;
    const motherboard = (realNgRecords[sourceStationId] || []).filter(record =>
      source.batchId ? record.batchId === source.batchId && record.isConfirmed : record.sn === source.sn
    );
    const sns = new Set(motherboard.map(record => record.sn));
    const goodSiblings = (passRecords[sourceStationId] || []).filter(record =>
      Boolean(source.batchId) && record.batchId === source.batchId
    );
    const mesCommand = await fetch('/api/station/operator-command', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'MIGRATE_BATCH', sourceStationCode: sourceKind === 'ICT' ? 'manu_ict' : 'manu_fct',
        destinationStationCode: 'manu_depanel', batchId: source.batchId, sn: source.sn,
        destinationBucket: 'pending_ng', disposition: 'depanel',
      }),
    });
    if (!mesCommand.ok) {
      window.alert(`MES depanel migration failed: HTTP ${mesCommand.status}`);
      return;
    }
    setRealNgRecords(records => ({
      ...records,
      [sourceStationId]: (records[sourceStationId] || []).filter(record => !sns.has(record.sn)),
    }));
    setNgRecords(records => {
      const boardId = source.batchId || source.sn;
      const existing = records[6] || [];
      const sameBoard = existing.filter(record => (record.batchId || record.sn) === boardId);
      const otherSourceExists = sameBoard.some(record => sourceKind === 'ICT'
        ? ['FCT_ONLY_NG', 'ICT_FCT_NG'].includes(record.defectCode)
        : ['ICT_ONLY_NG', 'ICT_FCT_NG'].includes(record.defectCode));
      const targetCode = otherSourceExists ? 'ICT_FCT_NG' : `${sourceKind}_ONLY_NG`;
      const targetDescription = otherSourceExists
        ? 'NG at both ICT and FCT → Depanel ICT+FCT NG BOX'
        : `${sourceKind} Confirmed NG → Depanel ${sourceKind} NG BOX`;
      const keep = existing
        .filter(record => !sns.has(record.sn))
        .map(record => (record.batchId || record.sn) === boardId && otherSourceExists
          ? { ...record, defectCode: 'ICT_FCT_NG', defectDescription: targetDescription }
          : record);
      const routed = motherboard.map(record => ({
        ...record, isConfirmed: false, defectCode: targetCode,
        defectDescription: targetDescription, disposition: 'depanel' as const, time: Date.now(),
      }));
      return { ...records, 6: [...keep, ...routed] };
    });
    if (goodSiblings.length > 0) {
      const goodSns = new Set(goodSiblings.map(record => record.sn));
      setPassRecords(records => ({
        ...records,
        [sourceStationId]: (records[sourceStationId] || []).filter(record => !goodSns.has(record.sn)),
        6: [
          ...(records[6] || []).filter(record => !goodSns.has(record.sn)),
          ...goodSiblings.map(record => ({
            ...record,
            time: Date.now(),
            sourceStationCode: sourceKind === 'ICT' ? 'manu_ict' : 'manu_fct',
            destinationStationCode: 'manu_depanel',
          })),
        ],
      }));
    }
    motherboard.forEach(record => localStorage.setItem(
      `confirmed-ng-disposition:${record.sn}`, 'depanel'
    ));
    setSelectedNgItem(null);
  }, [passRecords, realNgRecords]);

  const returnRepairedMotherboardToSource = useCallback(async (item: NgItem) => {
    const sourceCode = item.returnStationCode || item.originStationCode;
    const destination = sourceCode ? STATION_BY_CODE[sourceCode] : undefined;
    if (!destination) {
      window.alert('缺少原工位信息，禁止无目标返回产线');
      return;
    }
    const repairRecord = (realNgRecords[14] || []).find(record => record.sn === item.sn);
    if (!repairRecord) return;
    const motherboard = (realNgRecords[14] || []).filter(record =>
      repairRecord.batchId ? record.batchId === repairRecord.batchId : record.sn === repairRecord.sn
    );
    try {
      await Promise.all(motherboard.map(async record => {
        const response = await fetch('/api/rework/clear-ng', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sn: record.sn, batchId: record.batchId,
            originStation: record.originStationCode || record.returnStationCode,
            defectCode: record.defectCode, returnStation: sourceCode,
            repairResult: 'pass', operator: 'REWORK_RETURN_TO_SOURCE' }),
        });
        if (!response.ok) throw new Error(`${record.sn}: HTTP ${response.status}`);
      }));
    } catch (error) {
      window.alert(`MES维修放行失败，母板仍留在维修站：${String(error)}`);
      return;
    }
    const mesCommand = await fetch('/api/station/operator-command', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'MIGRATE_BATCH', sourceStationCode: 'manu_rework',
        destinationStationCode: sourceCode, batchId: repairRecord.batchId, sn: repairRecord.sn,
        destinationBucket: 'pending_ng', disposition: 'return_source',
      }),
    });
    if (!mesCommand.ok) {
      window.alert(`MES return-to-source failed: HTTP ${mesCommand.status}`);
      return;
    }
    const sns = new Set(motherboard.map(record => record.sn));
    const returned = motherboard.map(record => ({
      ...record, isConfirmed: false, testCount: 1, time: Date.now(),
      transferStatus: 'WAITING_RECEIPT' as const,
      defectCode: 'REPAIRED_RETURN',
      defectDescription: `维修完成 → 返回 ${sourceCode}`,
    }));
    setRealNgRecords(records => ({ ...records, 14: (records[14] || []).filter(record => !sns.has(record.sn)) }));
    setNgRecords(records => ({
      ...records,
      [destination.id]: [...(records[destination.id] || []).filter(record => !sns.has(record.sn)), ...returned],
    }));
    const goodSiblings = (passRecords[14] || []).filter(record =>
      Boolean(repairRecord.batchId) && record.batchId === repairRecord.batchId
    );
    if (goodSiblings.length) {
      setPassRecords(records => ({
        ...records,
        14: (records[14] || []).filter(record => !goodSiblings.some(sibling => sibling.sn === record.sn)),
        [destination.id]: [...(records[destination.id] || []), ...goodSiblings.map(record => ({
          ...record, stationCode: sourceCode || record.stationCode, stationName: destination.nameZh,
          sourceStationCode: 'manu_rework', destinationStationCode: sourceCode, time: Date.now(),
        }))],
      }));
    }
    setSelectedNgItem(null);
  }, [passRecords, realNgRecords]);

  const handleNgDispositionChange = useCallback((value: 'repair' | 'fct' | 'depanel' | 'line' | 'return_source') => {
    if (!selectedNgItem?.sn) return;
    if (value === 'line') releaseConfirmedNgToLine(selectedNgItem);
    else if (value === 'return_source') returnRepairedMotherboardToSource(selectedNgItem);
    else if (value === 'depanel') routeConfirmedToDepanel(selectedNgItem);
    else saveNgDisposition(selectedNgItem.sn, value);
  }, [releaseConfirmedNgToLine, returnRepairedMotherboardToSource, routeConfirmedToDepanel, saveNgDisposition, selectedNgItem]);

  const handleBatchClick = useCallback((batch: any) => {
    setSelectedBatch((prev: any) => prev?.batchId === batch.batchId ? null : batch);
  }, []);

  // Toggle bucket expanded/collapsed - shows or hides the NG blocks inside
  const handleBucketToggle = useCallback((stationId: number, label: string) => {
    const key = `${stationId}-${label}`;
    setExpandedBuckets(prev => {
      if (prev[key]) {
        // Already open → close it
        return { ...prev, [key]: false };
      }
      // Closed → close ALL containers, then open only this one
      const next: Record<string, boolean> = {};
      next[key] = true;
      return next;
    });
  }, []);

  // Click on canvas background → close all containers
  const handleBackgroundClick = useCallback(() => {
    setExpandedBuckets({});
  }, []);

  // Click anywhere outside tooltip → close detail panel
  useEffect(() => {
    if (!selected) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (tooltipRef.current?.contains(target)) return;
      setSelected(null);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [selected]);

  // Click anywhere outside NgItem panel → close it
  useEffect(() => {
    if (!selectedNgItem) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ngItemRef.current?.contains(target)) return;
      setSelectedNgItem(null);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [selectedNgItem]);

  // Click anywhere outside BatchItem panel → close it
  useEffect(() => {
    if (!selectedBatch) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (batchItemRef.current?.contains(target)) return;
      setSelectedBatch(null);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [selectedBatch]);

  // Heartbeat checker — if no SSE message in 10s, mark station as idle
  useEffect(() => {
    const check = () => {
      const now = Date.now();
      setWsAlive(prev => {
        const next = { ...prev };
        for (const s of STATIONS) {
          const last = lastMsgAtRef.current[s.id];
          next[s.id] = last !== undefined && (now - last) < 45000;
        }
        return next;
      });
    };
    const id = setInterval(check, 3000);
    return () => clearInterval(id);
  }, []);

  // Snapshot fallback restores online lights after a page or SSE reconnect.
  useEffect(() => {
    let cancelled = false;
    const refreshHeartbeats = async () => {
      try {
        const response = await fetch('/api/pda/heartbeats');
        if (!response.ok) return;
        const data = await response.json();
        if (cancelled) return;
        const browserNow = Date.now();
        const HEARTBEAT_TIMEOUT_MS = 30000; // 30 seconds
        // Track which stations are confirmed alive this round
        const aliveNow = new Set<number>();
        for (const heartbeat of data.heartbeats || []) {
          const station = STATION_BY_CODE[canonicalStationCode(heartbeat.stationCode)];
          if (!station) continue;
          const age = Math.max(0, Number(data.serverTime || browserNow) - Number(heartbeat.receivedAt || browserNow));
          lastMsgAtRef.current[station.id] = browserNow - age;
          // online=true (or undefined) → mark alive; online=false → mark dead
          if (heartbeat.online !== false && age < HEARTBEAT_TIMEOUT_MS) {
            aliveNow.add(station.id);
          } else {
            aliveNow.add(station.id); // keep in sync with backend truth
          }
        }
        // Expire any station that hasn't sent a recent heartbeat
        setWsAlive(prev => {
          const next: Record<number, boolean> = {};
          for (const id of Object.keys(prev)) {
            next[Number(id)] = prev[Number(id)] && aliveNow.has(Number(id));
          }
          // Also set newly confirmed alive stations
          for (const id of aliveNow) {
            next[id] = true;
          }
          return next;
        });
        setWsConnected({ 0: true });
      } catch {
        // SSE remains primary; retry on the next interval.
      }
    };
    refreshHeartbeats();
    const timer = window.setInterval(refreshHeartbeats, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  // MES reconciliation warning: ICT batches without a matching FCT batch.
  // This state is rendered over the dashboard and all 3D simulation views.
  useEffect(() => {
    let cancelled = false;
    const refreshIctFctMatch = async () => {
      try {
        const response = await fetch('/api/station/confirmed-motherboards?line=manual&limit=5000', { cache: 'no-store' });
        if (!response.ok) return;
        const body = await response.json();
        const items = Array.isArray(body.items) ? body.items : [];
        const ict = new Set(items.map((item: any) => item.ictBatchId || item.motherboardId).filter(Boolean));
        const fct = new Set(items.map((item: any) => item.fctBatchId).filter(Boolean));
        const pending = items
          .filter((item: any) => (item.ictBatchId || item.motherboardId) && !item.fctBatchId)
          .map((item: any) => String(item.motherboardId || item.ictBatchId))
          .filter((value: string, index: number, values: string[]) => values.indexOf(value) === index);
        if (!cancelled) setIctFctMismatch({ ict: ict.size, fct: fct.size, pending });
      } catch { /* live SSE remains the fallback */ }
    };
    refreshIctFctMatch();
    const timer = window.setInterval(refreshIctFctMatch, 30000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  // SSE subscription for NG events — real-time NG lifecycle tracking
  useEffect(() => {
    if (!bucketSnapshotsReady) return;
    const token = localStorage.getItem('token');
    // Listen for: NG_DEFECT (new fail), ng_retry (retest fail), ng_confirmed (sealed), AGENT_HEARTBEAT, pass (removed)
    const es = new EventSource(`/api/pda/events?node=manual_line_3d&replay=0&types=NG_DEFECT,SN_SCAN,STATION_TEST_RESULT,SMT_STATION_ACTIVITY,STATION_FAULT_OCCURRED,STATION_FAULT_ACKNOWLEDGED,STATION_FAULT_CLEARED,ICT_PROCESS,FCT_PROCESS,ICT_ROUTE_SELECTED,STATION_ROUTE_SELECTED,TRANSFER_RECEIVED,HANDOVER_TIMEOUT,HANDOVER_TIMEOUT_RELEASE,HANDOVER_ALARM_ACKNOWLEDGED,NG_MAINTENANCE_DISPATCH_TIMEOUT,REPAIR_TIMEOUT,REPAIR_WORK_ORDER_CREATED,REPAIR_RECEIVED,REPAIR_COMPLETED,REPAIR_RETURN_WAITING_RECEIPT,PASS_SHORTAGE_ALARM,PASS_SHORTAGE_ALARM_RELEASE,RESIDENCE_TIMEOUT,DUPLICATE_SN,DUPLICATE_ALARM_RELEASE,NG_PICKUP_ANNOUNCEMENT,NG_PICKUP_FEEDBACK,NG_PICKUP_ALARM_RESOLVED,NG_REVIVAL_ALARM_RESOLVED,AGENT_HEARTBEAT,CONTAINER_UPDATE,BUCKET_SNAPSHOT_UPDATE,STATION_DATA_CLEARED,STATION_NG_PICKED,NG_REVIVED,REPAIR_TEST_COMPLETED,REPAIR_SCRAPPED,NG_GONE_ALARM,ACTIVE_NG_REGISTRY_CHANGED,LINE_ENTRY,STATION_EXIT${token ? `&token=${token}` : ''}`);

    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data);
        if (evt.type === 'CONNECTED') {
          // Mark SSE as connected — all stations show "connecting" state (dim cyan)
          setWsConnected({ 0: true });
          return;
        }
        console.log('[ICT] ict send data', evt);
        const { type } = evt;
        const payloadStation = String(evt.payload?.sourceStation || evt.payload?.originStation || '');
        const stationCode = canonicalStationCode(
          payloadStation.startsWith('smt_') ? payloadStation : (evt.stationCode || evt.payload?.stationCode)
        );
        // Use STATION_BY_CODE map — stable lookup, no stale closure
        const station = STATION_BY_CODE[stationCode];
        if (!station) {
          console.warn('[ICT] unknown stationCode:', stationCode);
          return;
        }
        const now = Date.now();
        const payload = evt.payload || {};
        const syncSn = String(
          payload.sn || payload.mainSn || payload.batchId || payload.motherboardId ||
          payload.records?.[0]?.sn || payload.records?.[0]?.batchId || ''
        );
        const syncBucket = payload.bucketName ? ` · ${payload.bucketName}` : '';
        const syncCount = Array.isArray(payload.records) ? ` · ${payload.records.length}条` : '';
        const destinationCode = canonicalStationCode(
          payload.destinationStation || payload.targetStation || payload.returnStation || payload.originStation || ''
        );
        const isNgFlow = ['NG_DEFECT','STATION_NG_PICKED','TRANSFER_RECEIVED','NG_MAINTENANCE_DISPATCH_TIMEOUT',
          'REPAIR_TIMEOUT','REPAIR_WORK_ORDER_CREATED','REPAIR_RECEIVED','REPAIR_COMPLETED',
          'REPAIR_RETURN_WAITING_RECEIPT','REPAIR_TEST_COMPLETED','REPAIR_SCRAPPED','NG_REVIVED','NG_GONE_ALARM','NG_PICKUP_ANNOUNCEMENT','NG_PICKUP_FEEDBACK','NG_PICKUP_ALARM_RESOLVED','NG_REVIVAL_ALARM_RESOLVED']
          .includes(String(type)) || (payload.bucketName === 'confirmed_ng' && Array.isArray(payload.records) && payload.records.length > 0);
        setRealtimeSyncEvents(prev => [...prev, {
          id: String(evt._id || `${now}-${Math.random()}`),
          time: now,
          stationCode,
          stationName: station.nameZh,
          type: String(type || 'EVENT'),
          summary: `${syncSn || '—'}${syncBucket}${syncCount}`,
          destination: destinationCode ? stationRouteLabel(destinationCode) : (isNgFlow ? 'MES确认NG' : ''),
          isNgFlow,
        }].slice(-150));

        if (type === 'PASS_SHORTAGE_ALARM') {
          const count=Number(payload.shortageCount||0);
          const utter=new SpeechSynthesisUtterance(`PASS产品短缺${count}个，请立即核对`);utter.lang='zh-CN';
          speechSynthesis.cancel();speechSynthesis.speak(utter);
          setFlashes(prev=>({...prev,[station.id]:{sn:`PASS短缺:${count}`,scannedAt:now,batchId:payload.batchId}}));
          setRawBatch(prev=>({...prev,[station.id]:{...payload,stage:'PASS_SHORTAGE'}}));return;
        }
        if (type === 'PASS_SHORTAGE_ALARM_RELEASE' || type === 'HANDOVER_ALARM_ACKNOWLEDGED') {
          speechSynthesis.cancel();setFlashes(prev=>{const next={...prev};delete next[station.id];return next;});return;
        }

        if (type === 'HANDOVER_TIMEOUT') {
          const utter = new SpeechSynthesisUtterance(`母板号${payload.batchId || ''}，交接超过两分钟未完成，请立即处理`);
          utter.lang = 'zh-CN'; utter.rate = 1.05;
          speechSynthesis.cancel(); speechSynthesis.speak(utter);
          setFlashes(prev => ({ ...prev, [station.id]: { sn: `交接超时:${payload.batchId || ''}`, scannedAt: now, batchId: payload.batchId } }));
          setRawBatch(prev => ({ ...prev, [station.id]: { ...payload, stage: 'HANDOVER_TIMEOUT' } }));
          return;
        }
        if (type === 'NG_MAINTENANCE_DISPATCH_TIMEOUT') {
          const count = Number(payload.ngCount || payload.sns?.length || 0);
          const utter = new SpeechSynthesisUtterance(`SMT不良品已滞留二十分钟，共${count}个，请立即确认送往维修站`);
          utter.lang = 'zh-CN';
          speechSynthesis.cancel();
          speechSynthesis.speak(utter);
          setFlashes(prev => ({ ...prev, [station.id]: {
            sn: `NG送修超时:${count}`, scannedAt: now, batchId: payload.batchSignature,
          } }));
          setRawBatch(prev => ({ ...prev, [station.id]: { ...payload, stage: 'NG_MAINTENANCE_DISPATCH_TIMEOUT' } }));
          return;
        }
        if (type === 'NG_PICKUP_ANNOUNCEMENT') {
          const quantity = Number(payload.quantity || payload.sns?.length || 0);
          const utter = new SpeechSynthesisUtterance(`NG缁翠慨鍝佹湁${quantity}涓緟棰嗗彇锛岃绾块暱鎴栫粍闀挎墦寮€PDA纭`);
          utter.lang = 'zh-CN'; speechSynthesis.cancel(); speechSynthesis.speak(utter);
          setFlashes(prev => ({ ...prev, [station.id]: { sn: `NG取件待确认:${quantity}`, scannedAt: now, batchId: payload.commandId || payload.eventId } }));
          setRawBatch(prev => ({ ...prev, [station.id]: { ...payload, stage: 'NG_PICKUP_ANNOUNCEMENT' } }));
          return;
        }
        if (type === 'NG_PICKUP_FEEDBACK') {
          setRawBatch(prev => ({ ...prev, [station.id]: { ...payload, stage: `NG_PICKUP_${payload.feedbackStatus || 'FEEDBACK'}` } }));
          if (['RECEIVED', 'COLLECTED', 'REJECTED', 'BLOCKED'].includes(String(payload.feedbackStatus || '').toUpperCase())) {
            speechSynthesis.cancel();
            setFlashes(prev => { const next = { ...prev }; delete next[station.id]; return next; });
          }
          return;
        }
        if (type === 'NG_PICKUP_ALARM_RESOLVED' || type === 'NG_REVIVAL_ALARM_RESOLVED') {
          speechSynthesis.cancel();
          const sourceStationCode = canonicalStationCode(String(payload.sourceStation || payload.originStation || evt.stationCode || ''));
          const sourceStation = STATION_BY_CODE[sourceStationCode];
          const matchId = String(payload.commandId || payload.alarmId || '').trim();
          setFlashes(prev => {
            const next = { ...prev };
            if (sourceStation) delete next[sourceStation.id];
            if (station) delete next[station.id];
            Object.keys(next).forEach(key => {
              const item = next[Number(key)];
              if (item && (String(item.batchId || '') === String(payload.batchId || '') || String(item.batchId || '') === matchId)) delete next[Number(key)];
            });
            return next;
          });
          setRawBatch(prev => ({ ...prev, [station.id]: { ...payload, stage: type } }));
          return;
        }
        if (type === 'REPAIR_TIMEOUT') {
          const utter = new SpeechSynthesisUtterance(`不良品${payload.batchId || ''}超过两小时仍未完成维修复活`);
          utter.lang = 'zh-CN';
          speechSynthesis.cancel();
          speechSynthesis.speak(utter);
          setFlashes(prev => ({ ...prev, [station.id]: {
            sn: `维修超时:${payload.batchId || ''}`, scannedAt: now, batchId: payload.batchId,
          } }));
          setRawBatch(prev => ({ ...prev, [station.id]: { ...payload, stage: 'REPAIR_TIMEOUT' } }));
          return;
        }
        if (type === 'STATION_FAULT_OCCURRED') {
          const fault = String(payload.faultCode || payload.code || payload.message || '设备异常');
          const utter = new SpeechSynthesisUtterance(`${station.nameZh}设备报警，${fault}`);
          utter.lang = 'zh-CN';
          speechSynthesis.cancel();
          speechSynthesis.speak(utter);
          setFlashes(prev => ({ ...prev, [station.id]: {
            sn: `设备报警:${fault}`, scannedAt: now, batchId: payload.eventId,
          } }));
          setRawBatch(prev => ({ ...prev, [station.id]: { ...payload, stage: 'STATION_FAULT_OCCURRED' } }));
          return;
        }
        if (type === 'STATION_FAULT_ACKNOWLEDGED' || type === 'STATION_FAULT_CLEARED') {
          speechSynthesis.cancel();
          setFlashes(prev => { const next = { ...prev }; delete next[station.id]; return next; });
          setRawBatch(prev => ({ ...prev, [station.id]: { ...payload, stage: String(type) } }));
          return;
        }
        if (type === 'RESIDENCE_TIMEOUT') {
          const minutes = Math.max(1, Math.round(Number(payload.seconds || 0) / 60));
          const utter = new SpeechSynthesisUtterance(`产品${payload.sn || ''}在本站滞留${minutes}分钟，请立即处理`);
          utter.lang = 'zh-CN'; window.speechSynthesis.speak(utter);
          setFlashes(prev => ({ ...prev, [station.id]: { sn: `滞留超时:${payload.sn || ''}`, scannedAt: now, batchId: payload.batchId } }));
          setRawBatch(prev => ({ ...prev, [station.id]: { ...payload, stage: 'RESIDENCE_TIMEOUT' } }));
          return;
        }
        if (type === 'HANDOVER_TIMEOUT_RELEASE') {
          setFlashes(prev => { const next = { ...prev }; delete next[station.id]; return next; });
          return;
        }

        if (type === 'TRANSFER_RECEIVED') {
          const utter = new SpeechSynthesisUtterance(`母板号${payload.batchId || ''}，交接接收完成`);
          utter.lang = 'zh-CN';
          speechSynthesis.cancel();
          speechSynthesis.speak(utter);
          setRawBatch(prev => ({ ...prev, [station.id]: { ...payload, stage: 'TRANSFER_RECEIVED' } }));
          if (String(payload.destinationStation || payload.destinationStationCode || '').toLowerCase() === 'manu_rework') {
            const source = STATION_BY_CODE[canonicalStationCode(String(payload.sourceStation || payload.sourceStationCode || ''))];
            if (source) setFlashes(prev => { const next = { ...prev }; delete next[source.id]; return next; });
          }
          return;
        }

        // Voice announcement — only SN or NG result, skip heartbeat
        const isManualScannerInput = type === 'SN_SCAN' && payload.eventType !== 'ict_csv';
        if (type !== 'AGENT_HEARTBEAT' && type !== 'DUPLICATE_ALARM_RELEASE' && type !== 'BUCKET_SNAPSHOT_UPDATE' && type !== 'STATION_DATA_CLEARED' && !isManualScannerInput) {
          const sn = payload.sn || evt.sn || payload.batchId || '';
          const ngCode = payload.ngCode || payload.overallResult || '';
          const msg = type === 'DUPLICATE_SN'
            ? '发现重复编码，禁止离开本站'
            : (sn ? `SN ${sn}` : (ngCode || type));
          const utter = new SpeechSynthesisUtterance(msg);
          utter.lang = type === 'DUPLICATE_SN' ? 'zh-CN' : 'en-US';
          utter.rate = 1.2;
          speechSynthesis.cancel();
          speechSynthesis.speak(utter);
        }

        // PASS/NG records and counters are projected and versioned by MES.
        // Browsers only render transient scan feedback; they never mutate the
        // production buckets from raw station events.
        if (type === 'ICT_PROCESS' || type === 'FCT_PROCESS' || type === 'ICT_ROUTE_SELECTED' || type === 'STATION_ROUTE_SELECTED') {
          setRawBatch(prev => ({ ...prev, [station.id]: payload }));
          if (payload.batchId) setFlashes(prev => ({ ...prev, [station.id]: { sn: `${payload.stage || 'ICT'}:${payload.progress || 0}/12`, scannedAt: now, batchId: payload.batchId } }));
          return;
        }
        if (type === 'NG_DEFECT') {
          if (payload.batchId) setRawBatch(prev => ({ ...prev, [station.id]: payload }));
          setFlashes(prev => ({ ...prev, [station.id]: { sn: `NG:${payload.mainSn || payload.sn || 'BATCH'}`, scannedAt: now, batchId: payload.batchId } }));
          return;
        }
        if (type === 'LINE_ENTRY') {
          // SN进站：更新热力图计数
          moduleStationFlowCounts[stationCode] = { enter: (moduleStationFlowCounts[stationCode]?.enter || 0) + 1, exit: moduleStationFlowCounts[stationCode]?.exit || 0 };
          moduleFlowForceUpdate?.(n => n + 1);
          return;
        }
        if (type === 'STATION_EXIT') {
          // SN离站：更新热力图计数
          moduleStationFlowCounts[stationCode] = { enter: moduleStationFlowCounts[stationCode]?.enter || 0, exit: (moduleStationFlowCounts[stationCode]?.exit || 0) + 1 };
          moduleFlowForceUpdate?.(n => n + 1);
          return;
        }
        if (type === 'SN_SCAN' && station.code !== 'manu_shellbinding') {
          const scanSn = String(payload.sn || evt.sn || payload.pcbSerial || '').trim().toUpperCase();
          if (scanSn) {
            const result = String(payload.result || 'PASS').toUpperCase() === 'FAIL' ? 'FAIL' : 'PASS';
            // 从所有其他工位移除该SN（产品流动到下一站）
            for (const key of Object.keys(moduleStationSnLists)) {
              if (key !== stationCode) {
                const idx = moduleStationSnLists[key].findIndex(e => e.sn === scanSn);
                if (idx >= 0) moduleStationSnLists[key].splice(idx, 1);
              }
            }
            // 更新当前工位SN列表
            const list = moduleStationSnLists[stationCode] || [];
            const existing = list.findIndex(e => e.sn === scanSn);
            if (existing >= 0) list.splice(existing, 1);
            list.unshift({ sn: scanSn, result: result as SnEntry['result'], time: now });
            if (list.length > MAX_SN_PER_STATION) list.length = MAX_SN_PER_STATION;
            moduleStationSnLists[stationCode] = list;
            // 追踪最新SN
            moduleTrackedSn = scanSn;
            moduleSnForceUpdate?.(n => n + 1);
          }
          setFlashes(prev => ({ ...prev, [station.id]: { sn: `${String(payload.result || 'PASS').toUpperCase() === 'FAIL' ? 'NG' : 'PASS'}:${scanSn}`, scannedAt: now, batchId: payload.batchId } }));
          return;
        }

        if (type === 'BUCKET_SNAPSHOT_UPDATE') {
          const bucketName = String(payload.bucketName || '');
          const version = Number(payload.version) || 0;
          const versionKey = `${station.code}:${bucketName}`;
          if (version <= (bucketVersionsRef.current[versionKey] || 0)) return;
          bucketVersionsRef.current[versionKey] = version;
          const records = Array.isArray(payload.records) ? payload.records : [];
          applyingServerSnapshotRef.current = true;
          if (bucketName === 'pending_ng') {
            setNgRecords(prev => ({ ...prev, [station.id]: records }));
            // 同步到moduleStationSnLists（3D产线实时SN显示）
            const list: SnEntry[] = records.map((r: NgRecord) => ({ sn: (r.sn as string | null | undefined) ?? '', result: 'FAIL' as const, time: r.lastTestTime || r.birthTime || 0 }));
            if (list.length > 0) moduleStationSnLists[station.code] = list;
            else delete moduleStationSnLists[station.code];
            moduleSnForceUpdate?.(n => n + 1);
          } else if (bucketName === 'confirmed_ng') {
            setRealNgRecords(prev => ({ ...prev, [station.id]: records }));
            const list: SnEntry[] = records.map((r: NgRecord) => ({ sn: (r.sn as string | null | undefined) ?? '', result: 'FAIL' as const, time: r.lastTestTime || r.birthTime || 0 }));
            if (list.length > 0) moduleStationSnLists[station.code] = list;
            else delete moduleStationSnLists[station.code];
            moduleSnForceUpdate?.(n => n + 1);
          } else if (bucketName === 'pass') {
            setPassRecords(prev => ({ ...prev, [station.id]: records }));
            const list: SnEntry[] = records.map((r: PassRecord) => ({ sn: (r.sn as string | null | undefined) ?? '', result: 'PASS' as const, time: r.time }));
            if (list.length > 0) moduleStationSnLists[station.code] = list;
            else delete moduleStationSnLists[station.code];
            moduleSnForceUpdate?.(n => n + 1);
          } else if (bucketName === 'stats' && records[0]) setStationStats(prev => ({ ...prev, [station.id]: records[0] }));
        } else if (type === 'STATION_DATA_CLEARED') {
          applyingServerSnapshotRef.current = true;
          setNgRecords(prev => ({ ...prev, [station.id]: [] }));
          setRealNgRecords(prev => ({ ...prev, [station.id]: [] }));
          setPassRecords(prev => ({ ...prev, [station.id]: [] }));
          setFlashes(prev => { const next = { ...prev }; delete next[station.id]; return next; });
          setStationStats(prev => ({ ...prev, [station.id]: { total: 0, pass: 0, fail: 0, dup: 0 } }));
          // 清空moduleStationSnLists（3D产线SN显示数据源）
          delete moduleStationSnLists[stationCode];
          moduleSnForceUpdate?.(n => n + 1);
        } else if (type === 'CONTAINER_UPDATE') {
          setContainerData(payload);
          setFlashes(prev => ({ ...prev, [station.id]: { sn: `BOX:${payload.containerId}`, scannedAt: now } }));
          setStationStats(prev => {
            const current = prev[station.id] ?? { total: 0, pass: 0, fail: 0, dup: 0 };
            return { ...prev, [station.id]: { ...current, pass: Number(payload.currentCount) || 0 } };
          });
        } else if (type === 'NG_DEFECT') {
          // 存原始批次对象
          if (payload.batchId) {
            setRawBatch(prev => ({ ...prev, [station.id]: payload }));
          }
          // 解析 FAIL subBoards → NgRecords
          const subBoards: any[] = payload.subBoards || [];
          const batchBirthTime = payload.isAged
            ? now - Math.max(Number(payload.ageHours) || 2, 2.01) * 3600000
            : now;
          console.log('[NG_DEFECT] subBoards length:', subBoards.length, 'records:', JSON.stringify(subBoards));
          if (subBoards.length > 0) {
            const ictRecords = [...(ngRecordsRef.current[4] || []), ...(realNgRecordsRef.current[4] || [])];
            const ictPasses = passRecordsRef.current[4] || [];
            const upstreamIds = station.code === 'manu_fct'
              ? subBoards.map((board: any) => ictRecords.find(r => r.sn === board.sn)?.batchId || ictPasses.find(r => r.sn === board.sn)?.batchId)
              : [];
            const uniqueUpstreamIds = new Set(upstreamIds.filter(Boolean));
            const matchedDistinctSns = new Set(subBoards.filter((_: any, index: number) => Boolean(upstreamIds[index])).map((board: any) => board.sn));
            const identityVerified = station.code !== 'manu_fct' || (matchedDistinctSns.size >= 2 && uniqueUpstreamIds.size === 1);
            const identityError = identityVerified ? undefined
              : matchedDistinctSns.size < 2
                ? `ICT dual-SN check incomplete (${matchedDistinctSns.size}/2 SN matched)`
                : `SNs belong to ${uniqueUpstreamIds.size} different ICT motherboards`;
            const upstreamBatchId = identityVerified && station.code === 'manu_fct' ? String([...uniqueUpstreamIds][0]) : undefined;
            const mergedBatchId = upstreamBatchId || payload.batchId;
            // ICT and FCT results belong to a complete 12-slot motherboard.
            // Persist PASS siblings so NG/Confirmed-NG details always render all 12 slots.
            if (station.code === 'manu_ict' || station.code === 'manu_fct') {
              const passBoards = subBoards.filter((item: any) => item.result === 'PASS');
              setPassRecords(prev => {
                const next = [...(prev[station.id] || [])];
                for (const board of passBoards) {
                  const record: PassRecord = { sn: board.sn, time: now, operator: payload.operator || station.nameZh, stationCode: station.code, stationName: station.nameZh, batchId: mergedBatchId, slot: board.slot };
                  const index = next.findIndex(item => item.sn === board.sn);
                  if (index >= 0) next[index] = record; else next.push(record);
                }
                return { ...prev, [station.id]: next };
              });
              if (passBoards.length > 0) {
                // SN_SCAN already counts each PASS board. NG_DEFECT is the
                // completed motherboard summary and must not count them again.
                if (passBoards.length === subBoards.length) {
                  setFlashes(prev => ({ ...prev, [station.id]: { sn: `PASS:${mergedBatchId}`, scannedAt: now, batchId: mergedBatchId } }));
                }
              }
            }
            const mergedStationResults = (board: any): StationTestResult[] => {
              const prior = ictRecords.find(record => record.sn === board.sn);
              const history = prior?.stationResults || (prior ? [{ stationCode: 'manu_ict', results: [prior.overallResult === 'PASS' ? 'PASS' : 'FAIL'], finalResult: prior.overallResult || 'FAIL', testCount: prior.testCount }] : []);
              return [...history.filter(item => item.stationCode !== station.code), { stationCode: station.code, results: Array.isArray(board.results) ? board.results : [board.result], finalResult: board.result, testCount: board.testCount || 1 }];
            };
            // Batch mode: each FAIL sub-board → one NgRecord
            const failRecords: NgRecord[] = subBoards
              .filter((b: any) => b.result === 'FAIL')
              .map((b: any) => ({
                sn: b.sn || 'UNKNOWN',
                defectCode: `${station.code.replace(/^manu_/, '').toUpperCase()}_FAIL`,
                defectDescription: b.isConfirmedNG ? 'Confirmed NG' : 'NG',
                time: now,
                operator: payload.operator || station.nameZh,
                testCount: b.testCount || 1,
                firstFailureTime: batchBirthTime,
                isConfirmed: b.isConfirmedNG || false,
                slot: b.slot,
                batchId: mergedBatchId,
                overallResult: payload.overallResult,
                stationResults: mergedStationResults(b),
                motherboardIdentityVerified: identityVerified,
                identityError,
              }));
            if (failRecords.length > 0) {
              setNgRecords(prev => {
                const existing = prev[station.id] || [];
                const confirmedSns = new Set(failRecords.filter(r => r.isConfirmed).map(r => r.sn));
                const merged = existing.filter(r => !confirmedSns.has(r.sn));
                for (const rec of failRecords.filter(r => !r.isConfirmed)) {
                  const idx = merged.findIndex(r => r.sn === rec.sn);
                  if (idx >= 0) {
                    merged[idx] = {
                      ...merged[idx],
                      ...rec,
                      firstFailureTime: payload.isAged
                        ? rec.firstFailureTime
                        : merged[idx].firstFailureTime,
                      testCount: rec.testCount,
                    };
                  } else {
                    merged.push(rec);
                  }
                }
                return { ...prev, [station.id]: merged };
              });
              const confirmedRecords = failRecords.filter(r => r.isConfirmed);
              if (confirmedRecords.length > 0) {
                setRealNgRecords(prev => {
                  const merged = [...(prev[station.id] || [])];
                  for (const rec of confirmedRecords) {
                    const idx = merged.findIndex(r => r.sn === rec.sn);
                    if (idx >= 0) {
                      merged[idx] = {
                        ...merged[idx],
                        ...rec,
                        firstFailureTime: merged[idx].firstFailureTime,
                      };
                    } else {
                      merged.push(rec);
                    }
                  }
                  return { ...prev, [station.id]: merged };
                });
              }
              setStationStats(prev => {
                const cur = prev[station.id] ?? { total: 0, pass: 0, fail: 0, dup: 0 };
                return { ...prev, [station.id]: { ...cur, fail: cur.fail + failRecords.length, total: cur.total + failRecords.length } };
              });
              setFlashes(prev => ({ ...prev, [station.id]: { sn: `NG:${payload.mainSn || 'BATCH'}`, scannedAt: now } }));
              // 同步FAIL SN到moduleStationSnLists（3D产线SN显示）
              for (const rec of failRecords) {
                const list = moduleStationSnLists[stationCode] || [];
                const idx = list.findIndex(e => e.sn === rec.sn);
                if (idx >= 0) list.splice(idx, 1);
                list.unshift({ sn: rec.sn, result: 'FAIL' as const, time: now });
                if (list.length > MAX_SN_PER_STATION) list.length = MAX_SN_PER_STATION;
                moduleStationSnLists[stationCode] = list;
              }
              moduleSnForceUpdate?.(n => n + 1);
            }
          } else {
            // Legacy single-SN mode
            const sn = payload.sn || evt.sn;
            if (!sn) return;
            setNgRecords(prev => {
              const existing = (prev[station.id] || []).find(r => r.sn === sn);
              if (existing) {
                return {
                  ...prev,
                  [station.id]: (prev[station.id] || []).map(r =>
                    r.sn === sn ? { ...r, testCount: r.testCount + 1, time: now } : r
                  ),
                };
              }
              const newRecord: NgRecord = {
                sn,
                defectCode: payload.defectCode || 'NG',
                defectDescription: payload.defectDescription,
                time: now,
                operator: payload.operator,
                testCount: 1,
                firstFailureTime: now,
                isConfirmed: false,
              };
              return {
                ...prev,
                [station.id]: [...(prev[station.id] || []), newRecord],
              };
            });
            setStationStats(prev => {
              const cur = prev[station.id] ?? { total: 0, pass: 0, fail: 0, dup: 0 };
              return { ...prev, [station.id]: { ...cur, fail: cur.fail + 1, total: cur.total + 1 } };
            });
            setFlashes(prev => ({ ...prev, [station.id]: { sn: `NG:${sn}`, scannedAt: now } }));
            // 同步FAIL SN到moduleStationSnLists（3D产线SN显示）
            const list = moduleStationSnLists[stationCode] || [];
            const idx = list.findIndex(e => e.sn === sn);
            if (idx >= 0) list.splice(idx, 1);
            list.unshift({ sn, result: 'FAIL' as const, time: now });
            if (list.length > MAX_SN_PER_STATION) list.length = MAX_SN_PER_STATION;
            moduleStationSnLists[stationCode] = list;
            moduleSnForceUpdate?.(n => n + 1);
          }
        } else if (type === 'ng_confirmed') {
          // 3rd fail — move to NG SQLite (confirmed)
          const sn = evt.payload?.sn;
          if (!sn) return;
          setNgRecords(prev => {
            const rec = (prev[station.id] || []).find(r => r.sn === sn);
            if (!rec) return prev;
            // Move to realNgRecords
            setRealNgRecords(prev2 => ({
              ...prev2,
              [station.id]: [...(prev2[station.id] || []), { ...rec, isConfirmed: true, time: now }],
            }));
            // Remove from ngRecords
            return {
              ...prev,
              [station.id]: (prev[station.id] || []).filter(r => r.sn !== sn),
            };
          });
          setFlashes(prev => ({ ...prev, [station.id]: { sn: `CONFIRMED:${sn}`, scannedAt: now } }));
          // 同步CONFIRMED FAIL SN到moduleStationSnLists
          const list = moduleStationSnLists[stationCode] || [];
          const idx = list.findIndex(e => e.sn === sn);
          if (idx >= 0) list.splice(idx, 1);
          list.unshift({ sn, result: 'FAIL' as const, time: now });
          if (list.length > MAX_SN_PER_STATION) list.length = MAX_SN_PER_STATION;
          moduleStationSnLists[stationCode] = list;
          moduleSnForceUpdate?.(n => n + 1);
        } else if (type === 'ng_retry') {
          // Retest failed — increment testCount
          const sn = evt.payload?.sn;
          if (!sn) return;
          const attempts = evt.payload?.attempts || 2;
          setNgRecords(prev => ({
            ...prev,
            [station.id]: (prev[station.id] || []).map(r =>
              r.sn === sn ? { ...r, testCount: attempts, time: now } : r
            ),
          }));
          setFlashes(prev => ({ ...prev, [station.id]: { sn: `NG:${sn}`, scannedAt: now } }));
        } else if (type === 'DUPLICATE_SN') {
          const sn = payload.sn || evt.sn;
          if (!sn) return;
          const batchId = String(payload.batchId || evt.batchId || '');
          setFlashes(prev => {
            const current = prev[station.id];
            const sameBoard = current?.sn.startsWith('DUP:') && current.batchId === batchId;
            const existing = sameBoard
              ? current.sn.replace(/^DUP:/, '').split('|').filter(Boolean)
              : [];
            const group = existing.includes(sn) ? existing : [...existing, sn];
            return {
              ...prev,
              [station.id]: { sn: `DUP:${group.join('|')}`, scannedAt: now, batchId },
            };
          });
        } else if (type === 'DUPLICATE_ALARM_RELEASE') {
          speechSynthesis.cancel();
          setFlashes(prev => {
            const next = { ...prev };
            delete next[station.id];
            return next;
          });
        } else if (type === 'AGENT_HEARTBEAT') {
          // Agent heartbeat — mark station as alive
          lastMsgAtRef.current[station.id] = now;
          setWsAlive(prev => ({ ...prev, [station.id]: true }));
        } else if (type === 'STATION_NG_PICKED') {
          // NG被取出：3D场景中该位置的NG闪烁消失，同时从moduleStationSnLists移除
          const sn = payload.sn;
          if (sn) {
            setFlashes(prev => ({ ...prev, [station.id]: { sn: `NG_PICKED:${sn}`, scannedAt: now } }));
            const list = moduleStationSnLists[stationCode] || [];
            const idx = list.findIndex(e => e.sn === sn);
            if (idx >= 0) { list.splice(idx, 1); moduleStationSnLists[stationCode] = list; }
            moduleSnForceUpdate?.(n => n + 1);
            // 语音提示
            const utter = new SpeechSynthesisUtterance(`不良品${sn}已取出`);
            utter.lang = 'zh-CN'; speechSynthesis.cancel(); speechSynthesis.speak(utter);
          }
        } else if (type === 'NG_REVIVED') {
          // NG撤销：SN返回产线，3D场景显示绿色通行
          const sn = payload.sn;
          if (sn) {
            setFlashes(prev => ({ ...prev, [station.id]: { sn: `REVIVED:${sn}`, scannedAt: now } }));
            const utter = new SpeechSynthesisUtterance(`不良品${sn}已撤销，返回产线`);
            utter.lang = 'zh-CN'; speechSynthesis.cancel(); speechSynthesis.speak(utter);
            // 从moduleStationSnLists移除FAIL SN
            const list = moduleStationSnLists[stationCode] || [];
            const idx = list.findIndex(e => e.sn === sn);
            if (idx >= 0) list.splice(idx, 1);
            moduleStationSnLists[stationCode] = list;
            moduleSnForceUpdate?.(n => n + 1);
          }
        } else if (type === 'REPAIR_TEST_COMPLETED') {
          // 维修复测完成：3D场景显示维修完成状态
          const sn = payload.sn;
          const result = payload.repairResult;
          if (sn) {
            setFlashes(prev => ({ ...prev, [station.id]: { sn: `REPAIRED:${sn}|${result}`, scannedAt: now } }));
            const utter = new SpeechSynthesisUtterance(result === 'repaired' ? `产品${sn}维修完成` : `产品${sn}维修失败报废`);
            utter.lang = 'zh-CN'; speechSynthesis.cancel(); speechSynthesis.speak(utter);
            // 同步到moduleStationSnLists：repaired移除FAIL，scrapped保持FAIL
            const list = moduleStationSnLists[stationCode] || [];
            const idx = list.findIndex(e => e.sn === sn);
            if (result === 'repaired') {
              if (idx >= 0) list.splice(idx, 1);
            } else {
              if (idx >= 0) list.splice(idx, 1);
              list.unshift({ sn, result: 'FAIL' as const, time: now });
              if (list.length > MAX_SN_PER_STATION) list.length = MAX_SN_PER_STATION;
            }
            moduleStationSnLists[stationCode] = list;
            moduleSnForceUpdate?.(n => n + 1);
          }
        } else if (type === 'REPAIR_SCRAPPED') {
          // 维修报废：SN从moduleStationSnLists移除
          const sn = payload.sn;
          if (sn) {
            const list = moduleStationSnLists[stationCode] || [];
            const idx = list.findIndex(e => e.sn === sn);
            if (idx >= 0) { list.splice(idx, 1); moduleStationSnLists[stationCode] = list; }
            moduleSnForceUpdate?.(n => n + 1);
            setFlashes(prev => ({ ...prev, [station.id]: { sn: `SCRAPPED:${sn}`, scannedAt: now } }));
            const utter = new SpeechSynthesisUtterance(`产品${sn}已报废`);
            utter.lang = 'zh-CN'; speechSynthesis.cancel(); speechSynthesis.speak(utter);
          }
        } else if (type === 'NG_GONE_ALARM') {
          // NG异常消失报警：3D场景红色闪烁
          const alerts = payload.alerts || [];
          for (const alert of alerts) {
            // NG异常消失时从moduleStationSnLists移除该SN
            const list = moduleStationSnLists[stationCode] || [];
            const idx = list.findIndex(e => e.sn === alert.sn);
            if (idx >= 0) { list.splice(idx, 1); moduleStationSnLists[stationCode] = list; }
            const utter = new SpeechSynthesisUtterance(`警告：NG记录异常消失，SN=${alert.sn}`);
            utter.lang = 'zh-CN'; utter.rate = 0.9;
            speechSynthesis.cancel(); speechSynthesis.speak(utter);
          }
          if (alerts.length > 0) moduleSnForceUpdate?.(n => n + 1);
          setFlashes(prev => ({ ...prev, 0: { sn: `NG_GONE_ALARM:${alerts.length}`, scannedAt: now } }));
        } else if (type === 'ACTIVE_NG_REGISTRY_CHANGED') {
          // NG注册表变更：触发一次reconcile确保moduleStationSnLists同步
          moduleSnForceUpdate?.(n => n + 1);
        } else if (type === 'SN_SCAN' && station.code === 'manu_shellbinding' && String(payload.result || '').toUpperCase() !== 'PASS') {
          const phase = String(payload.bindingPhase || '');
          setBindingMatch(prev => phase === 'shell'
            ? { shellSn: payload.shellSn || payload.sn, boardSn: undefined }
            : { ...prev, shellSn: payload.shellSn || prev.shellSn, boardSn: payload.pcbaSn || payload.sn });
          setFlashes(prev => ({ ...prev, [station.id]: { sn: `SCAN:${payload.sn || evt.sn}`, scannedAt: now } }));
        } else if (type === 'SN_SCAN' && station.code === 'manu_depanel') {
          const sn = String(payload.sn || evt.sn || '').trim().toUpperCase();
          if (!sn) return;
          const waitingNg = (ngRecordsRef.current[6] || []).find(record => record.sn.toUpperCase() === sn);
          const ngHit = Boolean(waitingNg || payload.ngHit);
          setFlashes(prev => ({
            ...prev,
            [station.id]: { sn: ngHit ? `DUP:${sn}` : `SCAN:${sn}`, scannedAt: now, batchId: waitingNg?.batchId },
          }));
          if (ngHit) {
            setNgRecords(prev => ({ ...prev, 6: (prev[6] || []).filter(record => record.sn.toUpperCase() !== sn) }));
            const utterance = new SpeechSynthesisUtterance('发现不良品，禁止不良品离开本站。');
            utterance.lang = 'zh-CN';
            speechSynthesis.cancel();
            speechSynthesis.speak(utterance);
          }
        } else if (type === 'pass' || type === 'SN_SCAN' || type === 'SCAN') {
          // PASS / SCAN — remove from ngRecords, show flash, increment pass count
          const sn = evt.payload?.sn || evt.sn;
          if (!sn) return;
          const scanResult = String(evt.payload?.result || '').toUpperCase();
          const updateScanFlash = () => setFlashes(prev => {
            const batchId = String(evt.payload?.batchId || '');
            if (station.code !== 'manu_ict' || !batchId) {
              return { ...prev, [station.id]: { sn, scannedAt: now, batchId } };
            }
            const current = prev[station.id];
            const prior = current?.batchId === batchId
              ? current.sn.replace(/^BOARD:/, '').split('|').filter(Boolean)
              : [];
            const motherboard = Array.from(new Set([...prior, String(sn)])).slice(-12);
            return {
              ...prev,
              [station.id]: {
                sn: `BOARD:${motherboard.join('|')}`,
                scannedAt: now,
                batchId,
              },
            };
          });
          if (type === 'SN_SCAN' && scanResult !== 'PASS') {
            updateScanFlash();
            return;
          }
          setNgRecords(prev => ({
            ...prev,
            [station.id]: (prev[station.id] || []).filter(r => r.sn !== sn),
          }));
          setPassRecords(prev => {
            const existing = prev[station.id] || [];
            const record: PassRecord = {
              sn,
              time: now,
              operator: evt.payload?.operator || 'ICT',
              stationCode,
              stationName: station.nameZh,
              batchId: evt.payload?.batchId,
              slot: evt.payload?.slot,
              boardSn: evt.payload?.pcbaSn,
              shellSn: evt.payload?.shellSn,
            };
            const index = existing.findIndex(r => r.sn === sn);
            const next = [...existing];
            if (index >= 0) next[index] = record;
            else next.push(record);
            return { ...prev, [station.id]: next };
          });
          setStationStats(prev => {
            const cur = prev[station.id] ?? { total: 0, pass: 0, fail: 0, dup: 0 };
            return { ...prev, [station.id]: { ...cur, pass: cur.pass + 1, total: cur.total + 1 } };
          });
          updateScanFlash();
        }
      } catch (err) {
          console.error('[SSE onmessage error]', err);
        }
    };

    es.onerror = () => {
      // Silent — SSE will auto-reconnect
    };

    return () => { es.close(); };
  }, [bucketSnapshotsReady]);

  // Fetch station data source info when a station is selected (once per station)
  useEffect(() => {
    if (!selected) return;
    const code = selected.code;
    if (stationData[code]) return; // already fetched
    stationData[code] = {}; // mark as loading (simplistic - prevents re-fetch)
    setStationData(prev => ({ ...prev, [code]: { _loading: true } }));
    fetch(`/api/mes/manual-line/station-data/${code}`)
      .then(async r => {
        const data = await r.json();
        setStationData(prev => ({ ...prev, [code]: { ...data, _error: !r.ok ? data.error : null } }));
      })
      .catch(() => setStationData(prev => ({ ...prev, [code]: { _error: "Network error" } })));
  }, [selected]);

  // Fetch KPI data when a station is selected
  useEffect(() => {
    if (!selected) return;
    const code = selected.code;
    if (kpiData[code]) return; // already fetched
    const token = localStorage.getItem('token');
    fetch(`/api/mes/manual-line/station-kpi/${code}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(d => setKpiData(prev => ({ ...prev, [code]: d })))
      .catch(() => {});
  }, [selected]);

  // Fullscreen toggle
  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (e) {
      console.warn("Fullscreen toggle failed:", e);
    }
  }, []);

  // Sync fullscreen state if user presses Esc
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const palette = PALETTES[mode];
  const repairSummary = repairWorkOrders.reduce((summary, item) => {
    const status = String(item.status || '').toUpperCase();
    const pickupStatus = String(item.pickupStatus || item.pickup_status || '').toUpperCase();
    summary.total += 1;
    if (status === 'PENDING_PICKUP' || pickupStatus.includes('PENDING_PICKUP') || pickupStatus.includes('WAITING_LINE_LEADER')) summary.pickupPending += 1;
    else if (status === 'WAITING_RECEIPT' || status === 'PENDING_RECEIPT') summary.waitingReceipt += 1;
    else if (status.includes('REPAIR') && !status.includes('COMPLETED')) summary.inProgress += 1;
    else if (status.includes('RETURN') || status === 'WAITING_ORIGIN_RECEIPT') summary.waitingReturn += 1;
    else if (status.includes('COMPLETED') || status.includes('CLOSED') || status.includes('REVIVED') || status.includes('SCRAPPED')) summary.closed += 1;
    return summary;
  }, { waitingReceipt: 0, inProgress: 0, waitingReturn: 0, pickupPending: 0, closed: 0, total: 0 });

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: "calc(100vh - 140px)",
        minHeight: 600,
        background: palette.bg,
        borderRadius: 8,
        overflow: "hidden",
        transition: "background 0.6s ease",
      }}
    >
      {ictFctMismatch.pending.length > 0 && (
        <div style={{ position: 'absolute', top: 52, left: 14, zIndex: 280, maxWidth: 'min(620px, 48vw)', padding: '9px 12px', borderRadius: 8, background: 'rgba(127,29,29,.96)', border: '1px solid #ef4444', color: '#fee2e2', boxShadow: '0 8px 24px rgba(0,0,0,.35)', fontSize: 11, fontWeight: 800 }}>
          ⚠ ICT/FCT MISMATCH · ICT {ictFctMismatch.ict} / FCT {ictFctMismatch.fct} · 待FCT {ictFctMismatch.pending.length} 批
          <div style={{ marginTop: 4, color: '#fecaca', fontSize: 10, fontWeight: 600 }}>
            Missing FCT: {ictFctMismatch.pending.slice(0, 6).join(', ')}{ictFctMismatch.pending.length > 6 ? ' …' : ''}
          </div>
        </div>
      )}
      {/* 视图切换按钮 — 可折叠 */}
      <div style={{
        position: "absolute", top: tabBarCollapsed ? 12 : 12, left: "50%", transform: "translateX(-50%)",
        zIndex: 300, display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
      }}>
        {/* 展开/收起按钮 */}
        <button type="button" onClick={() => setTabBarCollapsed(c => !c)}
          style={{
            background: "rgba(7,17,31,.92)", border: "1px solid #1e3a5f",
            borderRadius: 8, padding: "4px 10px", color: "#94a3b8",
            cursor: "pointer", fontSize: 11, fontWeight: 700,
          }}>
          {tabBarCollapsed ? "▲ 视图" : "▼ 收起"}
        </button>
        {/* Tab栏 */}
        {!tabBarCollapsed && (() => {
          const tabs: { key: ViewMode; label: string }[] = [
            { key: 'full', label: '主厂房' },
            { key: 'material', label: '原材料仓库' },
            { key: 'product', label: '成品仓库' },
            { key: 'quality', label: '质检' },
            { key: 'repair', label: '维修' },
            { key: 'smt', label: 'SMT产线' },
          ];
          return (
            <div style={{
              display: "flex", gap: 4,
              background: "rgba(7,17,31,.92)", border: "1px solid #1e3a5f",
              borderRadius: 10, padding: "4px 8px",
            }}>
              {tabs.map(tab => (
                <button key={tab.key} type="button" onClick={() => setViewMode(tab.key)}
                  style={{
                    padding: "5px 12px", borderRadius: 7, border: "none", cursor: "pointer",
                    fontWeight: viewMode === tab.key ? 800 : 400, fontSize: 11,
                    background: viewMode === tab.key ? "#0ea5e9" : "transparent",
                    color: viewMode === tab.key ? "#fff" : "#94a3b8",
                    transition: "all .15s", whiteSpace: "nowrap",
                  }}>
                  {tab.label}
                </button>
              ))}
              <button type="button" onClick={() => setShowNgTrace(v => !v)}
                style={{
                  padding: "5px 12px", borderRadius: 7, border: "1px solid #ef444466", cursor: "pointer",
                  fontWeight: 800, fontSize: 11, background: showNgTrace ? "#7f1d1d" : "transparent",
                  color: showNgTrace ? "#fecaca" : "#fca5a5", whiteSpace: "nowrap",
                }}>
                {showNgTrace ? "NG追踪已开" : "NG追踪"}
              </button>
            </div>
          );
        })()}
      </div>

      {/* Legacy split-camera layout is disabled; production uses one 3D view. */}
      {false && (
        <div style={{ position: "absolute", inset: 0, display: "flex", paddingTop: 48 }}>
          {/* 左侧相机：追踪SN/产品 */}
          <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
            <Canvas shadows camera={{ position: [30, 6, 45], fov: 52 }} gl={{ antialias: true }} style={{ width: "100%", height: "100%" }}>
              <Scene onStationClick={handleClick} onNgBlockClick={handleNgBlockClick} onBatchClick={handleBatchClick} onClearIctData={clearIctStationData} lightScale={lightScale} mode={mode} cameraView={cameraView} flashes={flashes} wsAlive={wsAlive} wsConnected={wsConnected} stationStats={stationStats} ngRecords={ngRecords} realNgRecords={realNgRecords} passRecords={passRecords} rawBatch={rawBatch} expandedBuckets={expandedBuckets} onBucketToggle={handleBucketToggle} onBackgroundClick={handleBackgroundClick} uiLanguage={uiLanguage} bindingMatch={bindingMatch} containerData={containerData} repairSummary={repairSummary} />
            </Canvas>
            {/* 左侧标签：追踪SN */}
            <div style={{ position: "absolute", top: 8, left: 10, color: "#38bdf8", fontSize: 11, fontFamily: "monospace", fontWeight: 700, textShadow: "0 1px 4px #000" }}>
              🏭 追踪SN · {moduleTrackedSn || '—'}
            </div>
            {/* 俯视SN列表叠加层 */}
            <div style={{
              position: "absolute", bottom: 8, left: 10, right: 10,
              display: "flex", flexDirection: "column", gap: 4,
              maxHeight: 200, overflowY: "auto",
              pointerEvents: "none",
            }}>
              {STATIONS.filter(s => !s.code.startsWith('auto_') && (moduleStationSnLists[s.code]?.length || 0) > 0).map(s => (
                <div key={s.code} style={{
                  background: "rgba(7,17,31,.88)", border: "1px solid #1e3a5f",
                  borderRadius: 6, padding: "5px 10px",
                }}>
                  <div style={{ color: "#64748b", fontSize: 10, fontFamily: "monospace", marginBottom: 3 }}>
                    {s.nameZh}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                    {(moduleStationSnLists[s.code] || []).map((e, i) => (
                      <span key={i} style={{
                        fontSize: 9, fontFamily: "monospace",
                        color: e.result === 'PASS' ? '#4ade80' : e.result === 'FAIL' ? '#ef4444' : '#fbbf24',
                        background: "#0f172a", borderRadius: 3, padding: "1px 4px",
                      }}>
                        {e.sn}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 分隔线 */}
          <div style={{ width: 3, background: "#1e3a5f", flexShrink: 0 }} />

          {/* 右侧相机：追踪设备状态 */}
          <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
            <Canvas shadows camera={{ position: [35, 60, 8], fov: 40 }} gl={{ antialias: true }} style={{ width: "100%", height: "100%" }}>
              <Scene onStationClick={handleClick} onNgBlockClick={handleNgBlockClick} onBatchClick={handleBatchClick} onClearIctData={clearIctStationData} lightScale={lightScale} mode={mode} cameraView={cameraView} flashes={flashes} wsAlive={wsAlive} wsConnected={wsConnected} stationStats={stationStats} ngRecords={ngRecords} realNgRecords={realNgRecords} passRecords={passRecords} rawBatch={rawBatch} expandedBuckets={expandedBuckets} onBucketToggle={handleBucketToggle} onBackgroundClick={handleBackgroundClick} uiLanguage={uiLanguage} bindingMatch={bindingMatch} containerData={containerData} repairSummary={repairSummary} />
            </Canvas>
            {/* 右侧标签：设备状态 */}
            <div style={{ position: "absolute", top: 8, left: 10, color: "#a78bfa", fontSize: 11, fontFamily: "monospace", fontWeight: 700, textShadow: "0 1px 4px #000" }}>
              🔧 设备状态 · 全局俯视
            </div>
            {/* 设备状态统计叠加 */}
            <div style={{
              position: "absolute", bottom: 8, left: 10, right: 10,
              display: "flex", flexDirection: "column", gap: 4,
              maxHeight: 200, overflowY: "auto",
              pointerEvents: "none",
            }}>
              {STATIONS.filter(s => !s.code.startsWith('auto_')).map(s => {
                const st = stationStats[s.id];
                const alive = wsAlive[s.id];
                const ng = ngRecords[s.id]?.length || 0;
                return (
                  <div key={s.code} style={{
                    background: "rgba(7,17,31,.88)", border: `1px solid ${alive ? '#22c55e33' : '#ef444433'}`,
                    borderRadius: 6, padding: "5px 10px",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                      <span style={{ color: "#94a3b8", fontSize: 10, fontFamily: "monospace" }}>{s.nameZh}</span>
                      <span style={{ color: alive ? '#4ade80' : '#ef4444', fontSize: 10, fontWeight: 700 }}>
                        {alive ? '● ONLINE' : '○ OFFLINE'}
                      </span>
                    </div>
                    {st && st.total > 0 && (
                      <div style={{ display: "flex", gap: 6, fontSize: 9, fontFamily: "monospace", color: "#64748b" }}>
                        <span style={{ color: "#4ade80" }}>✓{st.pass}</span>
                        <span style={{ color: "#ef4444" }}>✗{st.fail}</span>
                        {ng > 0 && <span style={{ color: "#fbbf24" }}>⚠{ng}NG</span>}
                        <span>良{((st.pass / st.total) * 100).toFixed(0)}%</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 全屏3D */}
      {viewMode === 'full' && (
        <ManualLineKpiBoard stationStats={stationStats} />
      )}

      {viewMode === 'full' && (
        <Canvas shadows camera={{ position: [30, 6, 45], fov: 52 }} gl={{ antialias: true }} style={{ width: "100%", height: "100%" }}>
          <Scene onStationClick={handleClick} onNgBlockClick={handleNgBlockClick} onBatchClick={handleBatchClick} onClearIctData={clearIctStationData} lightScale={lightScale} mode={mode} cameraView={cameraView} flashes={flashes} wsAlive={wsAlive} wsConnected={wsConnected} stationStats={stationStats} ngRecords={ngRecords} realNgRecords={realNgRecords} passRecords={passRecords} rawBatch={rawBatch} expandedBuckets={expandedBuckets} onBucketToggle={handleBucketToggle} onBackgroundClick={handleBackgroundClick} uiLanguage={uiLanguage} bindingMatch={bindingMatch} containerData={containerData} repairSummary={repairSummary} />
        </Canvas>
      )}

      {viewMode === 'full' && showNgTrace && (
        <aside style={{
          position: "absolute", left: 12, top: 88, bottom: 14, width: "min(560px, 43vw)", minWidth: 360,
          zIndex: 220, overflowY: "auto", padding: 10, borderRadius: 12,
          background: "rgba(7,17,31,.94)", border: "1px solid #ef444477",
          boxShadow: "0 12px 34px rgba(0,0,0,.5)", backdropFilter: "blur(8px)",
        }}>
          <NgRealtimeTracking locale={uiLanguage === "zh" ? "zh-CN" : "en-US"} />
        </aside>
      )}

      {/* 原材料仓库 */}
      {viewMode === 'material' && (
        <Warehouse3DErrorBoundary>
          <WarehouseScene3d />
        </Warehouse3DErrorBoundary>
      )}

      {/* 成品仓库 */}
      {viewMode === 'product' && (
        <Warehouse3DErrorBoundary>
          <ProductWarehouseScene3d />
        </Warehouse3DErrorBoundary>
      )}

      {/* 质检 */}
      {viewMode === 'quality' && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a", paddingTop: 48 }}>
          <div style={{ textAlign: "center", color: "#94a3b8" }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>🔍</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>质检</div>
            <div style={{ fontSize: 13, color: "#64748b" }}>Quality Control — MES</div>
          </div>
        </div>
      )}

      {/* 维修 */}
      {viewMode === 'repair' && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a", paddingTop: 48 }}>
          <div style={{ textAlign: "center", color: "#94a3b8" }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>🔧</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>维修</div>
            <div style={{ fontSize: 13, color: "#64748b" }}>Repair Station — MES</div>
          </div>
        </div>
      )}

      {/* SMT产线 */}
      {viewMode === 'smt' && (
        <SmtLineDashboard />
      )}

      {/* MES实时同步侧边抽屉：单视图下保留可滚动的数据观察窗口。 */}
      {!showRealtimeSync && (
        <button type="button" onClick={() => setShowRealtimeSync(true)} title="打开实时同步数据"
          style={{
            position:'absolute',right:0,top:90,zIndex:230,
            writingMode:'vertical-rl',padding:'12px 7px',borderRadius:'8px 0 0 8px',
            border:'1px solid #0ea5e9',background:'rgba(7,17,31,.94)',color:'#7dd3fc',
            fontSize:11,fontWeight:800,cursor:'pointer',letterSpacing:1,
          }}>
          实时同步
        </button>
      )}
      {showRealtimeSync && (
        <aside style={{
          position:'absolute',right:12,top:58,width:390,maxWidth:'36vw',height:'min(62vh,560px)',
          zIndex:225,display:'flex',flexDirection:'column',overflow:'hidden',
          background:'rgba(7,17,31,.94)',border:'1px solid #0ea5e9',borderRadius:10,
          boxShadow:'0 12px 34px rgba(0,0,0,.45)',backdropFilter:'blur(8px)',color:'#e2e8f0',
        }}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'9px 11px',borderBottom:'1px solid #1e3a5f'}}>
            <div>
              <div style={{fontSize:12,fontWeight:900,color:'#7dd3fc'}}>实时同步数据 / LIVE SYNC</div>
              <div style={{fontSize:9,color:'#64748b',marginTop:2}}>工站 → MES → 3D · 最近 {realtimeSyncEvents.length}/150</div>
            </div>
            <button type="button" onClick={() => setShowRealtimeSync(false)} title="收起"
              style={{border:'1px solid #334155',borderRadius:6,background:'#0f172a',color:'#94a3b8',cursor:'pointer',padding:'3px 8px'}}>▶</button>
          </div>
          <div style={{padding:'7px 9px',borderBottom:'1px solid #1e3a5f',background:'rgba(14,116,144,.10)'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:10,fontWeight:900,color:'#7dd3fc'}}>
              <span>维修站MES同步 / REPAIR SYNC</span><span>{repairSummary.total} 工单</span>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:5,marginTop:6,fontSize:9,textAlign:'center'}}>
              <span style={{padding:4,borderRadius:5,background:'#422006',color:'#fbbf24'}}>待接收 {repairSummary.waitingReceipt}</span>
              <span style={{padding:4,borderRadius:5,background:'#172554',color:'#93c5fd'}}>维修中 {repairSummary.inProgress}</span>
              <span style={{padding:4,borderRadius:5,background:'#3b0764',color:'#d8b4fe'}}>待返回 {repairSummary.waitingReturn}</span>
              <span style={{padding:4,borderRadius:5,background:'#052e16',color:'#4ade80'}}>已关闭 {repairSummary.closed}</span>
            </div>
            <div style={{marginTop:6,padding:'5px 7px',borderRadius:5,background:'#7f1d1d',color:'#fecaca',fontSize:10,fontWeight:900}}>
              REPAIR PICKUP REQUIRED · LINE LEADER / TEAM LEADER: {repairSummary.pickupPending}
            </div>
            {realtimeSyncEvents.filter(item => item.isNgFlow).slice(-3).map(item => (
              <div key={`flow-${item.id}`} style={{display:'flex',gap:5,alignItems:'center',marginTop:5,fontSize:9,color:'#cbd5e1'}}>
                <b style={{color:'#fb7185'}}>{item.stationName}</b><span>→</span><b style={{color:'#fbbf24'}}>{item.destination}</b>
                <span style={{marginLeft:'auto',color:'#64748b'}}>{item.summary}</span>
              </div>
            ))}
          </div>
          <div ref={realtimeSyncScrollRef} style={{flex:1,overflowY:'auto',padding:'5px 8px',fontFamily:'Consolas,monospace'}}>
            {realtimeSyncEvents.length === 0 ? (
              <div style={{padding:18,textAlign:'center',fontSize:11,color:'#64748b'}}>等待MES实时事件…</div>
            ) : realtimeSyncEvents.map(item => (
              <div key={item.id} style={{display:'grid',gridTemplateColumns:'62px 90px 1fr',gap:6,padding:'5px 3px',borderBottom:'1px solid rgba(51,65,85,.45)',fontSize:9}}>
                <span style={{color:'#64748b'}}>{new Date(item.time).toLocaleTimeString()}</span>
                <span style={{color:'#38bdf8',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={item.stationCode}>{item.stationName}</span>
                <span style={{minWidth:0}}>
                  <b style={{color:item.type.includes('NG')||item.type.includes('DUPLICATE')?'#fb7185':item.type==='AGENT_HEARTBEAT'?'#4ade80':'#fbbf24'}}>{item.type}</b>
                  <span style={{color:'#cbd5e1',marginLeft:5,wordBreak:'break-all'}}>{item.summary}</span>
                </span>
              </div>
            ))}
          </div>
        </aside>
      )}
      <div style={{display:showMonitorDrawer?'block':'none',position:'absolute',right:12,top:56,width:370,maxHeight:250,overflow:'auto',zIndex:24,
        background:'rgba(7,17,31,.96)',border:'1px solid #38bdf8',borderRadius:9,padding:9,color:'#e2e8f0'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontWeight:900,marginBottom:7}}>
          <span style={{color:'#7dd3fc'}}>MES MANAGERS / MES 管理器</span>
          <span style={{fontSize:10,color:mesManagers.length?'#4ade80':'#f87171'}}>
            {mesManagers.length?`${mesManagers.length} REPORTING`:'NO REPORT'}
          </span>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
          {mesManagers.map(manager=><div key={manager.code} style={{background:'#0f243b',border:`1px solid ${manager.status==='attention'?'#ef4444':'#22c55e'}`,
            borderRadius:6,padding:7,fontSize:10}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:6,fontWeight:800}}>
              <span>{manager.name}</span><span style={{color:manager.status==='attention'?'#f87171':'#4ade80'}}>●</span>
            </div>
            <div style={{color:'#94a3b8',marginTop:4}}>{Object.entries(manager.metrics||{}).map(([key,value])=>`${key}: ${value}`).join(' · ')}</div>
            <div style={{color:'#64748b',marginTop:3}}>{manager.lastActivity?new Date(manager.lastActivity).toLocaleString():'waiting for activity'}</div>
          </div>)}
        </div>
        <div style={{borderTop:'1px solid #334155',marginTop:8,paddingTop:7,display:'grid',gap:5}}>
          <div style={{fontSize:10,fontWeight:800,color:'#fbbf24'}}>INSTRUCT MANAGER / 指令</div>
          <div style={{display:'flex',gap:4}}>
            <select value={managerTarget} onChange={event=>setManagerTarget(event.target.value)} style={{flex:1,fontSize:10}}>
              {mesManagers.map(manager=><option key={manager.code} value={manager.code}>{manager.name}</option>)}
            </select>
            <select value={managerCommand} onChange={event=>setManagerCommand(event.target.value)} style={{fontSize:10}}>
              <option value="REPORT_NOW">Report now</option><option value="RUN_AUDIT">Run audit</option><option value="RECONCILE">Reconcile</option>
            </select>
          </div>
          <div style={{display:'flex',gap:4}}>
            <input value={managerOperator} onChange={event=>setManagerOperator(event.target.value)} placeholder="Your name / 姓名" style={{width:115,fontSize:10}}/>
            <input value={managerNote} onChange={event=>setManagerNote(event.target.value)} placeholder="Instruction note" style={{flex:1,fontSize:10}}/>
            <button onClick={sendManagerInstruction} style={{fontSize:10,background:'#0369a1',color:'white',border:'1px solid #38bdf8',borderRadius:4}}>SEND</button>
          </div>
          {managerInstructionStatus&&<div style={{fontSize:10,color:managerInstructionStatus.startsWith('Accepted')?'#4ade80':'#fbbf24'}}>{managerInstructionStatus}</div>}
          <div style={{fontSize:9,color:'#64748b'}}>Instructions cannot bypass sequence, release NG, or erase history.</div>
        </div>
      </div>
      {showDataFlowPanel && (
      <div style={{position:'absolute',left:'50%',top:12,transform:'translateX(-50%)',width:680,maxHeight:190,
        overflow:'auto',background:'rgba(7,17,31,.96)',border:`1px solid ${continuity.summary.critical?'#ef4444':'#22c55e'}`,
        borderRadius:8,color:'#e2e8f0',padding:9,zIndex:22}}>
        <div style={{display:'flex',justifyContent:'space-between',fontWeight:800,marginBottom:5}}>
          <span style={{color:'#7dd3fc'}}>MES 数据接力监控 / DATA FLOW</span>
          <span style={{display:'flex',gap:8,alignItems:'center'}}>
            <span style={{color:continuity.summary.critical?'#f87171':'#4ade80'}}>
              空白点 {continuity.summary.total} · 严重 {continuity.summary.critical} · 警告 {continuity.summary.warning}
            </span>
            <button onClick={() => setShowDataFlowPanel(false)} style={{background:'none',border:'none',color:'#94a3b8',cursor:'pointer',fontSize:14,padding:'0 2px',lineHeight:1}} title="关闭">✕</button>
          </span>
        </div>
        {continuity.gaps.length===0?<div style={{color:'#4ade80',fontSize:11}}>数据流连续，未发现未确认接力。</div>:
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:10}}><thead><tr style={{color:'#94a3b8',textAlign:'left'}}>
            <th>类型</th><th>工位/来源</th><th>目标</th><th>SN/整盘/事件</th><th>开始时间</th>
          </tr></thead><tbody>{continuity.gaps.slice(0,30).map((gap,index)=><tr key={`${gap.type}-${gap.transferId||gap.stagingId||gap.residenceId||gap.stationCode||index}`} style={{borderTop:'1px solid #1e293b'}}>
            <td style={{color:gap.severity==='CRITICAL'?'#f87171':'#fbbf24',fontWeight:700}}>{gap.type}</td>
            <td>{gap.stationCode||gap.sourceStation||'-'}</td><td>{gap.destinationStation||'-'}</td>
            <td>{gap.sn||gap.batchId||gap.eventId||'-'}</td><td>{gap.openedAt?new Date(gap.openedAt).toLocaleString():gap.lastSeen?new Date(gap.lastSeen).toLocaleString():'-'}</td>
          </tr>)}</tbody></table>}
      </div>
      )}
      {showResidencePanel && (
      <div style={{ position: 'absolute', left: 14, bottom: 14, width: 570, maxHeight: 230,
        overflow: 'auto', background: 'rgba(7,17,31,.95)', border: '1px solid #38bdf8',
        borderRadius: 8, color: '#e2e8f0', padding: 9, zIndex: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, marginBottom: 6 }}>
          <span style={{ color: '#7dd3fc' }}>工位滞留时间监控 / RESIDENCE TIME</span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: '#fbbf24' }}>报警阈值 {residenceMonitor.thresholdMinutes} 分钟</span>
            <button onClick={() => setShowResidencePanel(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1 }} title="关闭">✕</button>
          </span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
          <thead><tr style={{ color: '#94a3b8', textAlign: 'left' }}>
            <th>工位</th><th>PASS入</th><th>PASS出</th><th>结存</th><th>NG</th><th>平均</th><th>最长</th><th>最久产品</th>
          </tr></thead>
          <tbody>{residenceMonitor.summary.map(row => {
            const oldest = residenceMonitor.current.filter(item => item.stationCode === row.stationCode)
              .sort((a, b) => Number(b.seconds || 0) - Number(a.seconds || 0))[0];
            const overdue = Number(row.maxSeconds || 0) >= residenceMonitor.thresholdMinutes * 60;
            const stationName = STATION_BY_CODE[row.stationCode]?.nameZh || row.stationCode;
            const fmt = (seconds: number) => `${Math.floor(Number(seconds || 0) / 3600)}:${String(Math.floor(Number(seconds || 0) % 3600 / 60)).padStart(2, '0')}:${String(Number(seconds || 0) % 60).padStart(2, '0')}`;
            return <tr key={row.stationCode} style={{ borderTop: '1px solid #1e293b',
              background: overdue ? 'rgba(220,38,38,.22)' : 'transparent' }}>
              <td style={{ color: overdue ? '#fca5a5' : '#e2e8f0', fontWeight: 700 }}>{stationName}</td>
              <td style={{ color: '#4ade80' }}>{row.passIn || 0}</td><td style={{ color: '#38bdf8' }}>{row.passOut || 0}</td>
              <td style={{ color: Number(row.passBalance) < 0 ? '#f87171' : '#fbbf24', fontWeight: 700 }}>{row.passBalance || 0}</td>
              <td style={{ color: Number(row.currentNgCount) ? '#fb7185' : '#94a3b8' }}>{row.currentNgCount}</td>
              <td>{fmt(row.avgSeconds)}</td><td style={{ color: overdue ? '#f87171' : '#fbbf24' }}>{fmt(row.maxSeconds)}</td>
              <td title={oldest?.batchId || ''}>{oldest ? `${oldest.sn} ${fmt(oldest.seconds)}` : '-'}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      )}
      <div style={{ display: showMonitorDrawer ? 'block' : 'none', position: 'absolute', right: 14, bottom: 14, width: 620, maxHeight: 210,
        overflow: 'auto', background: 'rgba(7,17,31,.94)', border: '1px solid #334155',
        borderRadius: 8, color: '#e2e8f0', padding: 9, zIndex: 20 }}>
        <div style={{ fontWeight: 800, color: '#7dd3fc', marginBottom: 6 }}>MES 工位交接监控</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
          <thead><tr style={{ color: '#94a3b8', textAlign: 'left' }}>
            <th>母板号</th><th>来源</th><th>目标</th><th>数量</th><th>状态</th><th>送出/接收</th>
          </tr></thead>
          <tbody>{handoverRecords.slice(0, 20).map(row => (
            <tr key={row.transferId} style={{ borderTop: '1px solid #1e293b' }}>
              <td>{row.batchId}</td><td>{row.sourceStation}</td><td>{row.destinationStation}</td>
              <td>{row.memberCount}</td>
              <td style={{ color: row.status === 'COMPLETED' ? '#4ade80' : '#fbbf24', fontWeight: 700 }}>
                {row.status === 'COMPLETED' ? '已接收' : '等待扫码接收'}
              </td>
              <td>{new Date(row.receivedAt || row.sentAt).toLocaleTimeString()}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {showNgRevivalPanel && (
      <div style={{ position: 'absolute', right: 14, bottom: 235, width: 620, maxHeight: 180,
        overflow: 'auto', background: 'rgba(7,17,31,.94)', border: '1px solid #22c55e',
        borderRadius: 8, color: '#e2e8f0', padding: 9, zIndex: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, marginBottom: 6 }}>
          <span style={{ color: '#4ade80' }}>NG复活看板 / NG REVIVAL</span>
          <button onClick={() => setShowNgRevivalPanel(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1 }} title="关闭">✕</button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
          <thead><tr style={{ color: '#94a3b8', textAlign: 'left' }}>
            <th>SN</th><th>整盘</th><th>原工位</th><th>审批状态</th><th>返回工位</th><th>操作员/批准人</th><th>操作</th>
          </tr></thead>
          <tbody>{revivalRecords.slice(0, 20).map(row => (
            <tr key={row.revivalId} style={{ borderTop: '1px solid #1e293b' }}>
              <td>{row.sn}</td><td>{row.batchId || '-'}</td><td>{row.originStation || '-'}</td>
              <td style={{ color: row.approvalStatus === 'REVIVED' ? '#4ade80' : '#fbbf24', fontWeight: 700 }}>{row.approvalStatus}</td>
              <td>{row.returnStation || '-'}</td><td>{row.operator || '-'} / 质检:{row.qualityApprover || '-'} / 线长:{row.lineLeaderApprover || '-'}</td>
              <td>{row.approvalStatus === 'REVIVED'
                ? new Date(row.approvedAt || row.revivedAt).toLocaleString()
                : '仅显示；请在 MES NG复活管理页面处理'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      )}

      <style>{`
        @keyframes ng-to-repair {
          0% { left: 36%; top: 38%; transform: scale(.75) rotate(-8deg); opacity: 0; }
          18% { opacity: 1; }
          55% { left: 53%; top: 16%; transform: scale(1.15) rotate(4deg); }
          100% { left: 72%; top: 72%; transform: scale(.75) rotate(0deg); opacity: .25; }
        }
        @keyframes ng-to-fct {
          0% { left: 36%; top: 38%; transform: scale(.75); opacity: 0; }
          18% { opacity: 1; }
          55% { left: 45%; top: 18%; transform: scale(1.15); }
          100% { left: 54%; top: 45%; transform: scale(.75); opacity: .25; }
        }
      `}</style>
      {ngTransfers.map(transfer => (
        <div
          key={transfer.id}
          style={{
            position: 'absolute',
            zIndex: 450,
            pointerEvents: 'none',
            minWidth: 150,
            padding: '9px 12px',
            borderRadius: 7,
            border: '2px solid #fbbf24',
            background: '#7f1d1d',
            color: '#fff',
            fontFamily: 'monospace',
            fontWeight: 700,
            textAlign: 'center',
            boxShadow: '0 0 24px rgba(251,191,36,.9)',
            animation: `${transfer.destination === 'repair' ? 'ng-to-repair' : 'ng-to-fct'} 1.4s ease-in-out forwards`,
          }}
        >
          <div style={{ color: '#fbbf24', fontSize: 10 }}>
            ICT → {transfer.destination === 'repair' ? '维修站' : 'FCT'}
          </div>
          <div style={{ marginTop: 3 }}>{transfer.sn}</div>
        </div>
      ))}

      <SettingsPanel
        isFullscreen={isFullscreen}
        toggleFullscreen={toggleFullscreen}
        mode={mode}
        setMode={setMode}
        lightScale={lightScale}
        setLightScale={setLightScale}
        soundEnabled={soundEnabled}
        setSoundEnabled={setSoundEnabled}
        volume={volume}
        setVolume={setVolume}
      />





      {/* Floating heartbeat panel — draggable */}
      <div
        style={{
          display: "none",
          position: "absolute",
          top: heartbeatPos.y,
          left: heartbeatPos.x,
          background: "rgba(15,23,42,0.88)",
          border: "1px solid #334155",
          borderRadius: 8,
          padding: "6px 10px",
          zIndex: 200,
          cursor: "move",
          userSelect: "none",
          fontSize: 10,
          color: "#e2e8f0",
          fontFamily: "system-ui, sans-serif",
        }}
        onMouseDown={(e) => {
          heartbeatDragRef.current = {
            started: true,
            startX: e.clientX,
            startY: e.clientY,
            startPx: heartbeatPos.x,
            startPy: heartbeatPos.y,
          };
        }}
        onMouseMove={(e) => {
          if (!heartbeatDragRef.current.started) return;
          const dx = e.clientX - heartbeatDragRef.current.startX;
          const dy = e.clientY - heartbeatDragRef.current.startY;
          setHeartbeatPos({
            x: heartbeatDragRef.current.startPx + dx,
            y: heartbeatDragRef.current.startPy + dy,
          });
        }}
        onMouseUp={() => { heartbeatDragRef.current.started = false; }}
        onMouseLeave={() => { heartbeatDragRef.current.started = false; }}
      >
        <div style={{ color: "#64748b", marginBottom: 4, fontSize: 9 }}>心跳</div>
        <div style={{ display: "flex", gap: 3 }}>
          {DISPLAY_STATIONS.map(s => (
            <div key={s.id} title={s.nameZh} style={{
              padding: "1px 4px",
              borderRadius: 3,
              fontSize: 9,
              fontWeight: 700,
              background: wsAlive[s.id] ? "#22d3ee" : wsConnected[0] ? "#475569" : "#1e293b",
              color: wsAlive[s.id] ? "#0f172a" : wsConnected[0] ? "#94a3b8" : "#475569",
            }}>
              {s.code.replace("manu_", "")}
            </div>
          ))}
        </div>
      </div>

      {/* Quick camera views — hidden inside the raw-material warehouse view. */}
      {viewMode !== 'material' && (
        <QuickViewsPanel activeId={cameraView?.id ?? null} onSelect={setCameraView} />
      )}

      {/* Legend bottom-left */}
      <div style={{
        display: showMonitorDrawer ? "block" : "none",
        position: "absolute", bottom: 16, left: 16,
        background: "rgba(15,23,42,0.92)",
        border: "1px solid #334155",
        borderRadius: 10,
        padding: "10px 14px",
        color: "#e2e8f0",
        fontFamily: "system-ui, sans-serif",
        fontSize: 12,
        backdropFilter: "blur(8px)",
        zIndex: 100,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 5 }}>状态图例</div>
        {[
          { c: "#22c55e", l: "运行中" },
          { c: "#eab308", l: "空闲" },
          { c: "#ef4444", l: "故障" },
          { c: "#6b7280", l: "离线" },
        ].map(({ c, l }) => (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: c, boxShadow: `0 0 6px ${c}` }} />
            <span>{l}</span>
          </div>
        ))}
      </div>

      {/* Controls hint bottom-right (only when settings panel closed) — actually moved hint here next to settings */}
      {!isFullscreen && showMonitorDrawer && (
        <div style={{
          position: "absolute", bottom: 16, right: 16,
          background: "rgba(15,23,42,0.92)",
          border: "1px solid #334155",
          borderRadius: 10,
          padding: "10px 14px",
          color: "#94a3b8",
          fontFamily: "system-ui, sans-serif",
          fontSize: 11,
          backdropFilter: "blur(8px)",
          zIndex: 100,
        }}>
          <div>🖱️ 左键拖动: 旋转</div>
          <div>🖱️ 右键拖动: 平移</div>
          <div>🖱️ 滚轮: 缩放</div>
          <div style={{ marginTop: 4, color: "#64748b" }}>点击工站查看详情</div>
        </div>
      )}

      {selected && (() => {
        const isPdaStation = selected.code === "smt_pda_loading" || selected.code === "pda_load";
        return isPdaStation ? (
          <div ref={tooltipRef}>
            <LoaderStatusPanel
              station={selected}
              bindings={feederBindings}
              activeWos={activeWos}
              selectedWo={selectedWo}
              onWoChange={setSelectedWo}
              onClose={() => { setSelected(null); setDataFilter(""); }}
            />
          </div>
        ) : (
          <div ref={tooltipRef}>
            <Tooltip station={selected} onClose={() => { setSelected(null); setDataFilter(""); }} stats={stationStats[selected.id]} stationData={stationData[selected.code]} dataFilter={dataFilter} onFilterChange={setDataFilter} kpiData={kpiData[selected.code]} />
          </div>
        );
      })()}


      {selectedNgItem && (
        <div ref={ngItemRef}>
          <NgItemPanel item={selectedNgItem} onClose={() => setSelectedNgItem(null)} onDispositionChange={handleNgDispositionChange} />
        </div>
      )}



      {selectedBatch && (
        <div ref={batchItemRef}>
          <BatchPanel batch={selectedBatch} onClose={() => setSelectedBatch(null)} />
        </div>
      )}

      {/* NG Container HTML overlay — only one container open at a time, rendered outside Canvas */}
      {(() => {
        const openKey = Object.keys(expandedBuckets).find(k => expandedBuckets[k] === true);
        if (!openKey) return null;
        const [stationIdStr, ...labelParts] = openKey.split('-');
        const label = labelParts.join('-');
        const stationId = Number(stationIdStr);
        const station = STATIONS.find(s => s.id === stationId);

        let items: NgItem[] = [];
        if (label === 'PASS') {
          const passRecs = passRecords[stationId] || [];
          items = passRecs.map(r => ({
            sn: r.sn,
            defectCode: 'PASS',
            defectDescription: r.stationName,
            operator: r.operator,
            testCount: 0,
            lastTestTime: r.time,
            isConfirmed: true,
            birthTime: r.time,
            birthStation: r.stationCode,
            birthPlace: r.stationName,
            ageHours: 0,
            retestRemaining: 0,
            isAged: false,
            label: 'PASS',
            batchId: r.batchId,
            slot: r.slot,
            boardSn: r.boardSn,
            shellSn: r.shellSn,
            sourceStationCode: r.sourceStationCode,
            destinationStationCode: r.destinationStationCode,
          }));
        } else {
          const depanelClass = label === 'ICT NG' ? 'ICT_ONLY_NG'
            : label === 'FCT NG' ? 'FCT_ONLY_NG'
            : label === 'ICT+FCT NG' ? 'ICT_FCT_NG' : '';
          const isMotherboardStation = ['manu_ict', 'manu_fct'].includes(station?.code || '');
          const records = label === 'NG' && isMotherboardStation
            ? (realNgRecords[stationId] || [])
            : label === 'NG' || label === 'First Retest' || label === 'Aged NG'
              ? (ngRecords[stationId] || [])
            : Boolean(depanelClass)
              ? (realNgRecords[stationId] || [])
            : (realNgRecords[stationId] || []);
          const depanelBatchIds = depanelClass
            ? new Set((realNgRecords[stationId] || [])
                .filter(record => record.defectCode === depanelClass)
                .map(record => record.batchId || record.sn))
            : null;
          items = records
            .filter(r => {
              const item = toNgItem(r, label);
              if (label === 'NG') return isMotherboardStation ? true : (!r.isConfirmed && r.testCount <= 1 && !item.isAged);
              if (label === 'First Retest') return !r.isConfirmed && r.testCount === 2 && !item.isAged;
              if (label === 'Aged NG') return !r.isConfirmed && item.isAged;
              if (label === 'Confirmed NG') return Boolean(r.isConfirmed);
              // A depanel box selects motherboards by NG category, then shows
              // every member of each selected motherboard so all three boxes
              // retain the same complete merged ICT+FCT 12-slot layout.
              if (depanelClass) return Boolean(depanelBatchIds?.has(r.batchId || r.sn));
              return false;
            })
            .map(r => toNgItem(r, label, station?.code, station?.nameZh || ''));
        }
        if (items.length === 0) return null;

        const isPass = label === 'PASS';
        const motherboardGroups = isPass ? [] : Array.from(
          items.reduce((groups, item) => {
            const key = item.batchId || item.sn;
            const group = groups.get(key) || { batchId: key, ngItems: [] as NgItem[], goodSiblings: [] as PassRecord[] };
            group.ngItems.push(item);
            groups.set(key, group);
            return groups;
          }, new Map<string, { batchId: string; ngItems: NgItem[]; goodSiblings: PassRecord[] }>()).values()
        ).map(group => ({
          ...group,
          goodSiblings: (passRecords[stationId] || []).filter(record => record.batchId === group.batchId),
        }));
        return (
          <div style={{
            position: "absolute",
            top: 60,
            right: 20,
            width: 560,
            maxHeight: "calc(100vh - 160px)",
            background: "rgba(15,23,42,0.97)",
            border: `1px solid ${isPass ? '#0891b2' : '#334155'}`,
            borderRadius: 12,
            zIndex: 200,
            overflowY: "auto",
            fontFamily: "monospace",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          }}>
            {/* Header */}
            <div style={{
              padding: "12px 14px",
              borderBottom: "1px solid #334155",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              position: "sticky",
              top: 0,
              background: "rgba(15,23,42,0.98)",
              zIndex: 1,
            }}>
              <div>
                <div style={{ color: isPass ? "#22d3ee" : "#38bdf8", fontWeight: 700, fontSize: 13 }}>
                  {station?.code || stationId} · {label}
                </div>
                <div style={{ color: "#64748b", fontSize: 11, marginTop: 2 }}>
                  {isPass ? `${items.length} 件 PASS 产品` : `${motherboardGroups.length} 块含 NG 母板`}
                </div>
                <div style={{ color: "#94a3b8", fontSize: 10, marginTop: 2 }}>
                  {isPass
                    ? `${new Set(items.map(item => item.batchId).filter(Boolean)).size} motherboard groups`
                    : `${items.length} NG daughterboards`}
                </div>
              </div>
              <button
                onClick={() => setExpandedBuckets({})}
                style={{
                  background: "#334155",
                  border: "none",
                  borderRadius: 6,
                  color: "#e2e8f0",
                  padding: "6px 10px",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                关闭
              </button>
            </div>
            {/* Items grid */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 6,
              padding: "10px 12px",
            }}>
              {isPass ? items.map((item, i) => (
                <div
                  key={`${item.sn}-${item.defectCode}-${i}`}
                  title={`${item.sn} · ${item.defectCode}`}
                  style={{
                    background: isPass ? "#0e7490" : (item.isConfirmed ? "#7f1d1d" : "#dc2626"),
                    border: isPass ? "1px solid #0891b2" : "1px solid #991b1b",
                    borderRadius: 3,
                    padding: "7px 8px",
                    textAlign: "left",
                    color: "#fff",
                    fontSize: 10,
                    fontFamily: "monospace",
                    cursor: "pointer",
                  }}
                  onClick={() => { handleNgBlockClick(item); }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700, wordBreak: "break-all" }}>{item.sn}</div>
                  <div style={{ opacity: 0.8, marginTop: 3 }}>
                    {item.defectCode} · {new Date(item.lastTestTime).toLocaleString()}
                  </div>
                  <div style={{ color: "#fbbf24", marginTop: 3, wordBreak: "break-all" }}>
                    MB: {item.batchId || '-'} · Slot: {item.slot ?? '-'}
                  </div>
                  {item.boardSn && item.shellSn && (
                    <div style={{ color: '#a7f3d0', marginTop: 3, wordBreak: 'break-all', fontWeight: 700 }}>
                      BOARD: {item.boardSn}<br />SHELL: {item.shellSn}
                    </div>
                  )}
                  <div style={{ opacity: 0.85, marginTop: 4, lineHeight: 1.45 }}>
                    {(() => {
                      const route = inferPassRoute(item.birthStation, item.sourceStationCode, item.destinationStationCode);
                      return <>
                        <div>来源 FROM: {stationRouteLabel(route.source)}</div>
                        <div>进入 AT: {stationRouteLabel(route.current)}</div>
                        <div>去向 TO: {stationRouteLabel(route.destination)}</div>
                        <div style={{ color: '#bae6fd', marginTop: 3 }}>规则: 来源 → 当前工位 PASS → 下一工位</div>
                        <div>操作员: {item.operator || '-'}</div>
                      </>;
                    })()}
                  </div>
                </div>
              )) : motherboardGroups.map(group => {
                const knownBoards = [
                  ...group.ngItems.map(item => ({ sn: item.sn, slot: item.slot, result: 'NG' as const, stationResults: item.stationResults })),
                  ...group.goodSiblings.map(item => ({ sn: item.sn, slot: item.slot, result: 'PASS' as const, stationResults: undefined as StationTestResult[] | undefined })),
                ];
                const allBoards = Array.from({ length: 12 }, (_, index) => {
                  const slot = index + 1;
                  return knownBoards.find(board => board.slot === slot) || {
                    sn: '等待母板成员资料', slot, result: 'UNKNOWN' as const,
                    stationResults: undefined as StationTestResult[] | undefined,
                  };
                });
                const routeItem = group.ngItems[0];
                const identityError = group.ngItems.find(item => item.motherboardIdentityVerified === false)?.identityError;
                return (
                  <div key={group.batchId} style={{ gridColumn: '1 / -1', background: '#1e293b', border: '1px solid #991b1b', borderRadius: 7, padding: 10, color: '#fff' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <strong style={{ color: '#fbbf24' }}>MB: {group.batchId}</strong>
                      <span style={{ color: '#fca5a5' }}>{group.ngItems.length} NG / {allBoards.length || 12}</span>
                    </div>
                    {identityError ? (
                      <div style={{ marginTop: 7, padding: '6px 8px', borderRadius: 4, background: '#7f1d1d', border: '1px solid #ef4444', color: '#fee2e2', fontWeight: 700 }}>
                        Motherboard ID mismatch: {identityError}. FCT result was not merged with ICT.
                      </div>
                    ) : routeItem?.motherboardIdentityVerified ? (
                      <div style={{ marginTop: 7, color: '#86efac', fontSize: 10 }}>Motherboard ID verified: two SNs match the same ICT motherboard.</div>
                    ) : null}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 4, marginTop: 8 }}>
                      {allBoards.map(board => (
                        <div key={`${board.slot}-${board.sn}`} style={{ padding: '5px 6px', borderRadius: 4, background: board.result === 'NG' ? '#991b1b' : board.result === 'PASS' ? '#065f46' : '#334155', border: `1px solid ${board.result === 'NG' ? '#ef4444' : board.result === 'PASS' ? '#10b981' : '#64748b'}` }}>
                          <div style={{ fontWeight: 700 }}>S{board.slot ?? '-'} · {board.result}</div>
                          <div style={{ marginTop: 2, wordBreak: 'break-all', opacity: .9 }}>{board.sn}</div>
                          {board.stationResults?.map(history => (
                            <div key={history.stationCode} style={{ marginTop: 2, color: history.finalResult === 'PASS' ? '#86efac' : '#fecaca', fontSize: 9 }}>
                              {history.stationCode === 'manu_ict' ? 'ICT' : history.stationCode === 'manu_fct' ? 'FCT' : history.stationCode}: {history.results.join(' → ')}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                    {label === 'Confirmed NG' && routeItem && (
                      <div style={{ position: 'relative', marginTop: 9 }}>
                        <select
                          aria-label={`母板处理办法 ${group.batchId}`}
                          value={localStorage.getItem(`confirmed-ng-disposition:${routeItem.sn}`) ?? ''}
                          onChange={event => {
                            const value = event.target.value;
                            if (value === 'depanel') routeConfirmedToDepanel(routeItem);
                            else saveNgDisposition(routeItem.sn, value as 'repair' | 'fct');
                          }}
                          style={{ width: '100%', padding: '7px 34px 7px 9px', appearance: 'none', borderRadius: 5, border: '1px solid #fca5a5', background: '#0f172a', color: '#fff', cursor: 'pointer' }}
                        >
                          <option value="" disabled>整块母板处理办法</option>
                          <option value="repair">1 整板去维修站</option>
                          {station?.code === 'manu_ict'
                            ? <option value="depanel">2 整板去分板 ICT NG BOX</option>
                            : station?.code === 'manu_fct'
                              ? <option value="depanel">2 整板去分板 FCT NG BOX</option>
                              : <option value="fct">2 整板去 FCT</option>}
                        </select>
                        <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#fbbf24', pointerEvents: 'none' }}>▼</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
// @ts-nocheck
