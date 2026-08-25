import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, Html, OrbitControls, Text as DreiText, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { API_BASE } from "../api/client";
import stationConfig from "../../../../packages/station-config/stations.json";
import { NgRealtimeTracking } from "./NgRealtimeTracking";

// The production 5178 server may be static and omit Vite's /api proxy.
// Keep the 3D projection connected to the canonical MES API in both modes.
const MES_API_ORIGIN = API_BASE.replace(/\/$/, "");
const fetch: typeof globalThis.fetch = (input, init) => {
  const raw = String(input);
  const isMesApi = raw.startsWith("/api/");
  const target = isMesApi ? `${MES_API_ORIGIN}${raw}` : input;
  if (!isMesApi) return globalThis.fetch(target, init);
  const headers = new Headers(init?.headers);
  const token = window.sessionStorage.getItem("auth_token") || window.localStorage.getItem("token");
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  return globalThis.fetch(target, { ...init, headers });
};

const Text = DreiText as any;
const GREEN = "#197d4b";
const STEEL = "#dce3e7";
const IS_AUTO_LINE = window.location.pathname.includes("auto-line-video-3d");
// Real MES is the default source of truth. Mock data is opt-in for demos only.
const USE_CODEX_MOCK = new URLSearchParams(window.location.search).get("mock") === "1";
const SIM_BOARD_INTERVAL_MS = 5000;
const MANUAL_STATIONS = [
  ["pda_load", "PDA扫码上料"],
  ["manu_aio", "AOI"],
  ["manu_ict", "ICT"],
  ["manu_fct", "FCT"],
  ["manu_depanel", "分板机"],
  ["manu_shellbinding", "外壳绑码"],
  ["manu_assem_ate", "组装 ATE"],
  ["manu_supersonic", "超声波"],
  ["manu_agingcab", "老化柜"],
  ["manu_hivolt_ate", "高压 ATE"],
  ["manu_package_ate", "包装 ATE"],
  ["manu_outer_box_binding", "外箱绑码"],
  ["manu_pallet_binding", "栈板绑码"],
] as const;
// The station-agent manifest is the layout authority. Keep the 3D lane in the
// same sequence, while retaining the runtime aliases used by the MES API.
const MANUAL_AGENT_LAYOUT = [
  "manu_pda", "manu_aio", "manu_ict", "manu_fct", "manu_depanel",
  "manu_case_binding", "manu_assembly_ate", "manu_supersonic", "manu_aging",
  "manu_hivolt_ate", "manu_packing_ate", "manu_outer_box_binding", "manu_pallet_binding",
] as const;
const MANUAL_LAYOUT_ALIAS: Record<string, string> = {
  manu_case_binding: "manu_shellbinding",
  manu_assembly_ate: "manu_assem_ate",
  manu_aging: "manu_agingcab",
  manu_packing_ate: "manu_package_ate",
};
const MANUAL_AGENT_LAYOUT_RUNTIME = MANUAL_AGENT_LAYOUT.map((code) => MANUAL_LAYOUT_ALIAS[code] || code);
const AUTO_STATIONS = [
  ["auto_pda", "自动线 PDA扫码上料"],
  ["auto_aio", "自动线 AOI"],
  ["auto_ict", "自动线 ICT"],
  ["auto_fct", "自动线 FCT"],
  ["auto_depanel", "自动线 分板机"],
  ["auto_shellbinding", "自动线 外壳绑码"],
  ["auto_assem_ate", "自动线 组装 ATE"],
  ["auto_supersonic", "自动线 超声波"],
  ["auto_agingcab", "自动线 20米老化柜"],
  ["auto_hivolt_ate", "自动线 高压 ATE"],
  ["auto_package_ate", "自动线 包装 ATE"],
  ["auto_case_binding", "自动线 外箱绑码"],
  ["auto_pallet_binding", "自动线 栈板绑码"],
] as const;
const MES_STATIONS = IS_AUTO_LINE ? AUTO_STATIONS : MANUAL_STATIONS;
// Render the configured station panels for both line domains. The separate
// SMT six-machine layout is intentionally not mounted in the manual scene.
const VISIBLE_3D_SCREEN_STATIONS = MES_STATIONS;
const lineCode = (suffix: string) => `${IS_AUTO_LINE ? "auto" : "manu"}_${suffix}`;
const toDateTimeLocal = (value: Date) => {
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
};
type LineLocale = "zh-CN" | "en-US" | "vi-VN";
const STATION_I18N: Record<string, [string, string, string]> = {
  pda: ["PDA扫码上料", "PDA Loading", "Nạp liệu PDA"],
  aio: ["AOI", "AOI", "AOI"], ict: ["ICT", "ICT", "ICT"], fct: ["FCT", "FCT", "FCT"],
  depanel: ["分板机", "Depanel", "Tách bảng"], shellbinding: ["外壳绑码", "Shell Binding", "Liên kết vỏ"],
  assem_ate: ["组装 ATE", "Assembly ATE", "ATE lắp ráp"], supersonic: ["超声波", "Ultrasonic", "Siêu âm"],
  agingcab: ["7台老化柜", "7 Aging Cabinets", "7 tủ lão hóa"],
  hivolt_ate: ["高压 ATE", "Hi-Pot ATE", "ATE cao áp"], package_ate: ["包装 ATE", "Packaging ATE", "ATE đóng gói"],
  case_binding: ["外箱绑码", "Outer-box Binding", "Liên kết thùng ngoài"],
  outer_box_binding: ["外箱绑码", "Outer-box Binding", "Liên kết thùng ngoài"],
  pallet_binding: ["栈板绑码", "Pallet Binding", "Liên kết pallet"],
  rework: ["维修站", "Repair Station", "Trạm sửa chữa"],
};
const localizedStationName = (code: string, locale: LineLocale) => {
  const suffix = code.replace(/^(auto|manu)_/, "");
  const labels = code === "auto_agingcab"
    ? ["自动线 20米老化柜", "Auto 20 m Aging Cabinet", "Tủ lão hóa tự động 20 m"]
    : STATION_I18N[suffix] || [code, code, code];
  const label = labels[locale === "zh-CN" ? 0 : locale === "en-US" ? 1 : 2];
  return IS_AUTO_LINE
    ? `${locale === "zh-CN" ? "自动线" : locale === "en-US" ? "Auto Line" : "Dây chuyền tự động"} · ${label}`
    : label;
};
const UI_I18N = {
  overview: ["总览", "Overview", "Tổng quan"], live: ["实时", "Live", "Trực tiếp"], trace: ["NG追溯", "NG Trace", "Truy vết NG"],
  motherboard: ["母版查询", "Motherboard", "Bo mạch mẹ"], alarms: ["报警处理", "Alarm Handling", "Xử lý cảnh báo"], memory: ["智能查询", "Smart Query", "Tra cứu thông minh"],
  hide: ["隐藏 UI", "Hide UI", "Ẩn UI"], show: ["显示 UI", "Show UI", "Hiện UI"], fullscreen: ["全屏", "Fullscreen", "Toàn màn hình"], exitFullscreen: ["退出全屏", "Exit Fullscreen", "Thoát toàn màn hình"], livePanel: ["实时面板", "Live Panel", "Bảng trực tiếp"], closePanel: ["关闭面板", "Close Panel", "Đóng bảng"],
  currentSn: ["当前 SN", "Current SN", "SN hiện tại"], status: ["状态", "Status", "Trạng thái"], noData: ["暂无数据", "No data", "Chưa có dữ liệu"],
  lineTitle: ["现场三维实时生产线", "Live 3D Production Line", "Dây chuyền sản xuất 3D trực tiếp"],
  lineSubtitle: ["MES 实时数据 · 单向直线流动 · 鼠标旋转 / 滚轮缩放", "Live MES data · One-way flow · Drag to rotate / Wheel to zoom", "Dữ liệu MES trực tiếp · Luồng một chiều · Kéo để xoay / Lăn để thu phóng"],
  simulateNext: ["模拟下一个 SN", "Simulate Next SN", "Mô phỏng SN tiếp theo"], simulateNg: ["模拟 NG", "Simulate NG", "Mô phỏng NG"],
  simulateLine: ["模拟整线流程", "Simulate Full Line", "Mô phỏng toàn tuyến"], simulating: ["整线模拟中…", "Simulating line…", "Đang mô phỏng…"],
  alarmTitle: ["NG 报警", "NG Alarm", "Cảnh báo NG"], confirmAlarm: ["确认报警", "Acknowledge", "Xác nhận cảnh báo"], removed: ["确认已取出", "Confirm Removed", "Xác nhận đã lấy ra"],
  alarmFlow: ["本地 Agent 检测 NG → 本机声光报警 → 操作员处理 → MES 留痕", "Local agent detects NG → local sound/light alarm → operator handling → MES audit", "Agent cục bộ phát hiện NG → cảnh báo âm thanh/đèn → xử lý → MES lưu vết"],
  query: ["查询", "Search", "Tìm kiếm"], querying: ["查询中", "Searching", "Đang tìm"], loading: ["加载中…", "Loading…", "Đang tải…"],
  recentNg: ["最近 NG 记录", "Recent NG Records", "Bản ghi NG gần đây"], noNg: ["本工站暂无 NG 记录", "No NG records for this station", "Trạm này chưa có bản ghi NG"],
  alarmRecords: ["报警处理记录", "Alarm Handling Records", "Lịch sử xử lý cảnh báo"], noAlarms: ["本工站暂无报警", "No alarms for this station", "Trạm này chưa có cảnh báo"],
  duration: ["处理时长", "Handling time", "Thời gian xử lý"], seconds: ["秒", "sec", "giây"],
  packingProgress: ["装箱进度", "Packing Progress", "Tiến độ đóng thùng"], empty: ["空", "Empty", "Trống"],
  aiMemory: ["AI 记忆查询", "AI Memory Search", "Tra cứu bộ nhớ AI"],
  memoryHint: ["点击工站对话框，可查询该工站与当前 SN 的管理系统记忆。", "Open a station panel to search management memory for that station and current SN.", "Mở bảng trạm để tra cứu bộ nhớ quản lý của trạm và SN hiện tại."],
  motherboardHint: ["可由任一子板 SN 查询唯一母版及全部兄弟板。", "Use any daughter-board SN to find its unique motherboard and all siblings.", "Dùng bất kỳ SN bo con nào để tìm bo mẹ duy nhất và toàn bộ bo cùng mẹ."],
  scanDaughter: ["扫描或输入子板 SN", "Scan or enter daughter-board SN", "Quét hoặc nhập SN bo con"],
  online: ["在线", "Online", "Trực tuyến"], offline: ["离线", "Offline", "Ngoại tuyến"], language: ["语言", "Language", "Ngôn ngữ"],
} as const;
const tr = (key: keyof typeof UI_I18N, locale: LineLocale) => UI_I18N[key][locale === "zh-CN" ? 0 : locale === "en-US" ? 1 : 2];
const MANUAL_CAMERA_STATIONS = [
  ["总览", [36, 1.2, 0]],
  ["PDA扫码上料", [0, 1.2, 0]],
  ["AOI", [5, 1.2, 0]],
  ["ICT", [11, 1.2, 0]],
  ["FCT", [17, 1.2, 0]],
  ["分板机", [23, 1.2, 0]],
  ["外壳绑码", [28, 1.2, 0]],
  ["组装 ATE", [34, 1.2, 0]],
  ["超声波", [40, 1.2, 0]],
  ["老化柜", [48, 1.2, 0]],
  ["高压 ATE", [55, 1.2, 0]],
  ["包装 ATE", [61, 1.2, 0]],
  ["外箱绑码", [67, 1.2, 0]],
  ["栈板绑码", [71, 1.2, 0]],
] as const;
const REPAIR_STATION_POSITION = IS_AUTO_LINE ? [40, 0, -15] as const : [36, 0, -8] as const;
const REPAIR_CAMERA_TARGET = IS_AUTO_LINE ? [40, 1.5, -15] as const : [36, 1.5, -8] as const;
// Downstream cells run beside the tunnel on the machine-direction left side.
// The final pallet cell aligns with the tunnel outlet at x≈66.
const AUTO_X = [0, 5, 11, 17, 23, 28, 34, 40, 53, 46, 52, 62, 66] as const;
const AUTO_Z = [0, 0, 0, 0, 0, 0, 0, 0, 0, -8.45, -8.45, -8.45, -8.45] as const;
const CAMERA_STATIONS = IS_AUTO_LINE
  ? ([
      ["总览", [44, 1.2, -4.225]],
      ...AUTO_STATIONS.map((station, index) => [station[1], [AUTO_X[index], 1.2, AUTO_Z[index]]]),
    ] as readonly (readonly [string, readonly number[]])[])
  : MANUAL_CAMERA_STATIONS;
const stationX = (index: number) => {
  if (IS_AUTO_LINE) return AUTO_X[index];
  const code = MES_STATIONS[index]?.[0];
  const layoutIndex = MANUAL_AGENT_LAYOUT_RUNTIME.indexOf(code);
  return [0, 5, 11, 17, 23, 28, 34, 40, 48, 55, 61, 67, 71][layoutIndex >= 0 ? layoutIndex : index];
};
const stationZ = (index: number) => IS_AUTO_LINE ? AUTO_Z[index] : 0;
type MesRow = {
  online: boolean;
  machineQr?: string;
  sn: string;
  pass: number;
  ng: number;
  dup: number;
  time: number;
  status?: "PASS" | "NG" | "";
  alarmActive?: boolean;
  slots?: Array<{ sn: string; result: string }>;
  target?: number;
  workOrderCode?: string;
  workOrderStatus?: string;
  materialCount?: number;
  boundMaterialCount?: number;
  wipCount?: number;
  wipCapacity?: number;
  jammed?: boolean;
  speedPerMinute?: number;
  activeMaterialCode?: string;
  materialAvailableQty?: number;
  materialConsumptionRatePerMinute?: number;
  materialNextLoadAt?: number;
  materialStarvationRisk?: boolean;
  materialLoadingStatus?: string;
  lastSyncAt?: number;
  dataError?: string;
  syncState?: "LIVE" | "DEGRADED" | "UNAVAILABLE";
  dataSource?: "MES" | "MOCK";
  currentNgCount?: number;
  repairStatus?: string;
  repairCurrentWorkOrder?: string;
  repairDefectCode?: string;
  repairSourceStation?: string;
  repairOperator?: string;
  repairOpenCount?: number;
  repairFinishedCount?: number;
  repairHistoryCount?: number;
  repairLast10Count?: number;
  repairHistoryRows?: RepairWorkOrder[];
};

type RepairWorkOrder = {
  id?: string | number;
  repairWorkOrderNo?: string;
  workOrderNo?: string;
  sn?: string;
  sourceStation?: string;
  status?: string;
  result?: string;
  defectCode?: string;
  operator?: string;
  submittedAt?: string;
  updatedAt?: string;
  repairedAt?: string;
  repairCompletedAt?: string;
};

type ManualLineWorkOrder = {
  workOrderCode: string;
  status?: string;
  plannedQty?: number;
  completedQty?: number;
  productCode?: string;
  productNameZh?: string;
  lineCode?: string;
  materialCount?: number;
  boundMaterialCount?: number;
  materialLoadingStatus?: string;
  materials?: Array<{
    materialCode?: string;
    requiredQty?: number;
    bound?: boolean;
    availableQty?: number;
    consumptionRatePerMinute?: number;
    actualConsumptionRatePerMinute?: number;
    estimatedDepletionAt?: string;
    safetyStockQty?: number;
  }>;
};

// Local-only fixture used when the API is unavailable or has no released order.
// It is deliberately marked so it can never be mistaken for production data.
const CODEX_MOCK_MANUAL_WO: ManualLineWorkOrder = {
  workOrderCode: "CODEX-MOCK-MANUAL-LOADING",
  status: "MOCK_RELEASED",
  plannedQty: 10,
  productCode: "CODEX-MOCK-PCBA",
  productNameZh: "CODEX Mock Manual-Line Product",
  lineCode: "L004",
  materialCount: 3,
  boundMaterialCount: 0,
  materialLoadingStatus: "MOCK_OPEN",
  materials: [
    { materialCode: "CODEX-MOCK-PCB", requiredQty: 10, bound: false },
    { materialCode: "CODEX-MOCK-R-10K", requiredQty: 20, bound: false },
    { materialCode: "CODEX-MOCK-C-100N", requiredQty: 20, bound: false },
  ],
};

type BucketSnapshot = {
  stationCode?: string;
  bucketName?: string;
  payload?: unknown;
};

const BOARD_STATIONS = new Set(IS_AUTO_LINE ? ["auto_ict", "auto_fct", "auto_depanel"] : ["manu_ict", "manu_fct", "manu_depanel"]);
const ATE_STATIONS = new Set(IS_AUTO_LINE ? ["auto_assem_ate", "auto_hivolt_ate", "auto_package_ate"] : ["manu_assem_ate", "manu_hivolt_ate", "manu_package_ate"]);
const STATION_CODE_ALIASES: Record<string, string> = {
  manu_case_binding: "manu_outer_box_binding",
  auto_outer_box_binding: "auto_case_binding",
};
const canonicalStationCode = (value: unknown) => {
  const code = String(value || "").trim();
  return STATION_CODE_ALIASES[code] || code;
};
const TWIN_SUPPORT_STATIONS = new Set(["manu_rework"]);
const isTwinStation = (code: string) =>
  MES_STATIONS.some(([value]) => value === code) || TWIN_SUPPORT_STATIONS.has(code);

function snapshotRecords(snapshot?: BucketSnapshot) {
  const payload = snapshot?.payload;
  if (Array.isArray(payload)) return payload.filter((item) => item && typeof item === "object") as Record<string, unknown>[];
  if (payload && typeof payload === "object") {
    const value = payload as Record<string, unknown>;
    const rows = value.records ?? value.items ?? value.rows;
    if (Array.isArray(rows)) return rows.filter((item) => item && typeof item === "object") as Record<string, unknown>[];
    return [value];
  }
  return [];
}

function childBoards(record: Record<string, unknown>) {
  const rows = [record.subBoards, record.members, record.boards].find(Array.isArray);
  return Array.isArray(rows)
    ? rows.filter((item) => item && typeof item === "object") as Record<string, unknown>[]
    : [];
}

function boardStateFromEvents(events: unknown[], stationCode: string) {
  const candidates = events
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .filter((item) => String(item.stationCode ?? "") === stationCode)
    .filter((item) => String(item.type ?? "").toUpperCase() === "STATION_TEST_RESULT")
    .sort((a, b) => Date.parse(String(b.receivedAt ?? "")) - Date.parse(String(a.receivedAt ?? "")));
  const latest = candidates[0];
  const payload = latest?.payload && typeof latest.payload === "object"
    ? latest.payload as Record<string, unknown>
    : {};
  const children = childBoards(payload);
  if (!latest || !children.length) return null;
  const slotCount = stationCode.startsWith("auto_") ? 6 : 12;
  const slots = Array.from({ length: slotCount }, (_, index) => {
    const item = children.find((child) => Number(child.slot ?? child.position ?? 0) === index + 1);
    const raw = String(item?.finalResult ?? item?.result ?? item?.overallResult ?? "").toUpperCase();
    return {
      sn: String(item?.sn ?? item?.pcbSerial ?? item?.serialNumber ?? ""),
      result: raw === "FAIL" || raw === "NG" ? "FAIL" : raw === "TEST" ? "TEST" : raw === "PASS" ? "PASS" : "EMPTY",
    };
  });
  return {
    sn: String(payload.batchId ?? payload.motherboardId ?? payload.mainSn ?? ""),
    slots,
  };
}

function motherboardState(snapshots: BucketSnapshot[], stationCode: string) {
  const slotCount = stationCode.startsWith("auto_") ? 6 : 12;
  const own = snapshots.filter((item) => item.stationCode === stationCode);
  const records = (name: string) => snapshotRecords(own.find((item) => item.bucketName === name));
  const pending = records("pending_ng");
  const confirmed = records("confirmed_ng");
  const passed = records("pass");
  const process = records("process");
  const liveBatch = String(process[0]?.batchId ?? process[0]?.motherboardId ?? process[0]?.id ?? "").trim();
  const processBoard = process.find((row) => childBoards(row).length);
  // MES process is the current-board pointer. Do not use confirmed[0], which
  // is historical NG order and can make the 3D show an older motherboard than
  // the live FCT Agent.
  const focus = processBoard || (liveBatch && [...pending, ...confirmed, ...passed].find((row) =>
    String(row.batchId ?? row.motherboardId ?? row.id ?? "").trim() === liveBatch
  )) || confirmed[0] || pending[0] || passed[0];
  const children = focus ? childBoards(focus) : [];
  const passRows = passed.flatMap((item) => childBoards(item).length ? childBoards(item) : [item]);
  const merged = children.length ? [...children, ...passRows] : [...pending, ...confirmed, ...passRows];
  const bySlot = new Map<number, { sn: string; result: string }>();
  merged.forEach((item, index) => {
    const slot = Math.max(1, Math.min(slotCount, Number(item.slot ?? item.position ?? index + 1) || index + 1));
    const raw = String(item.finalResult ?? item.result ?? item.overallResult ?? "PASS").toUpperCase();
    bySlot.set(slot, {
      sn: String(item.sn ?? item.pcbSerial ?? item.serialNumber ?? ""),
      result: raw === "FAIL" || raw === "NG" ? "FAIL" : raw === "TEST" ? "TEST" : "PASS",
    });
  });
  return {
    sn: String(focus?.batchId ?? focus?.motherboardId ?? focus?.id ?? liveBatch ?? ""),
    slots: Array.from({ length: slotCount }, (_, index) => bySlot.get(index + 1) ?? { sn: "", result: "EMPTY" }),
  };
}

function ateEightState(snapshots: BucketSnapshot[], stationCode: string) {
  const own = snapshots.filter((item) => item.stationCode === stationCode);
  const rows = ["pending_ng", "confirmed_ng", "pass"]
    .flatMap((name) => snapshotRecords(own.find((item) => item.bucketName === name)))
    .flatMap((item) => childBoards(item).length ? childBoards(item) : [item]);
  const bySlot = new Map<number, { sn: string; result: string; time: number }>();
  rows.forEach((item, index) => {
    const channel = String(item.channel ?? item.position ?? "").trim().toUpperCase();
    const channelMatch = /^[LR]?([1-8])$/.exec(channel);
    const slot = Math.max(1, Math.min(8, Number(item.slot ?? channelMatch?.[1] ?? index + 1) || index + 1));
    const rawTime = item.testTime ?? item.sourceTestTimeIso ?? item.time ?? item.createdAt ?? index;
    const parsed = typeof rawTime === "number" ? rawTime : Date.parse(String(rawTime));
    const time = Number.isFinite(parsed) ? parsed : index;
    if (bySlot.has(slot) && time < Number(bySlot.get(slot)?.time)) return;
    const raw = String(item.finalResult ?? item.result ?? item.overallResult ?? "PASS").toUpperCase();
    bySlot.set(slot, {
      sn: String(item.sn ?? item.pcbSerial ?? item.serialNumber ?? ""),
      result: raw === "FAIL" || raw === "NG" ? "FAIL" : raw === "TEST" ? "TEST" : "PASS",
      time,
    });
  });
  const latest = [...bySlot.values()].sort((a, b) => b.time - a.time)[0];
  return {
    sn: latest?.sn ?? "",
    slots: Array.from({ length: 8 }, (_, index) => {
      const value = bySlot.get(index + 1);
      return value ? { sn: value.sn, result: value.result } : { sn: "", result: "EMPTY" };
    }),
  };
}

function outerBoxState(snapshots: BucketSnapshot[], stationCode = "manu_outer_box_binding") {
  const own = snapshots.filter((item) => item.stationCode === stationCode);
  const bindings = snapshotRecords(own.find((item) => item.bucketName === "bindings"));
  const confirmedNg = snapshotRecords(own.find((item) => item.bucketName === "confirmed_ng"));
  const latest = bindings[0];
  const boxSn = String(latest?.boxSn ?? latest?.box_sn ?? latest?.containerSn ?? "");
  const current = boxSn
    ? bindings.filter((item) => String(item.boxSn ?? item.box_sn ?? item.containerSn ?? "") === boxSn)
    : [];
  const ngSet = new Set(confirmedNg.map((item) => String(item.productSn ?? item.sn ?? item.serialNumber ?? "")));
  return {
    sn: boxSn,
    slots: current.map((item) => {
      const sn = String(item.productSn ?? item.sn ?? item.serialNumber ?? "");
      const raw = String(item.result ?? item.status ?? "PASS").toUpperCase();
      return { sn, result: ngSet.has(sn) || raw === "NG" || raw === "FAIL" ? "FAIL" : "PASS" };
    }),
  };
}

const SCREEN_POSITIONS: Record<string, [number, number, number]> = {
  pda_load: [0, 2.05, 0.72],
  manu_aio: [5, 2.75, 0.95],
  manu_ict: [11, 2.75, 0.95],
  manu_fct: [17, 2.75, 0.95],
  manu_depanel: [23, 2.75, 0.95],
  manu_shellbinding: [28, 2.05, 0.72],
  manu_assem_ate: [34, 2.05, 0.72],
  manu_supersonic: [40, 2.35, 0.72],
  manu_agingcab: [48, 3.15, 0.72],
  manu_hivolt_ate: [55, 2.05, 0.72],
  manu_package_ate: [61, 2.05, 0.72],
  manu_outer_box_binding: [67, 2.05, 0.72],
  manu_pallet_binding: [71, 2.05, 0.72],
  manu_rework: [36, 3.1, -7.2],
};
// Keep the ICT/FCT/Depanel motherboard visualizations clear of the station screens below.
const MOTHERBOARD_PANEL_Y = 4.65;
if (IS_AUTO_LINE) {
  const autoCodes = AUTO_STATIONS.map(([code]) => code);
  const xs = [...AUTO_X];
  autoCodes.forEach((code, index) => { SCREEN_POSITIONS[code] = [xs[index], code === "auto_agingcab" ? 3.45 : 2.55, AUTO_Z[index] - 0.95]; });
  // Manual and auto lines share the same MES repair station. Only its 3D placement changes.
  SCREEN_POSITIONS.manu_rework = [40, 3.1, -14.2];
}

function StationScreen({
  code,
  name,
  row,
}: {
  code: string;
  name: string;
  row?: MesRow;
}) {
  const position = SCREEN_POSITIONS[code] || [0, 2.4, 0.8];
  const wipCount = row?.wipCount ?? row?.slots?.length ?? 0;
  const wipCapacity = row?.wipCapacity ?? 1;
  const jammed = row?.jammed ?? wipCount > wipCapacity;
  const speed = row?.speedPerMinute;
  const throughput = (row?.pass || 0) + (row?.ng || 0);
  const yieldRate = throughput > 0 ? ((row?.pass || 0) / throughput) * 100 : null;
  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[1.2, 0.72, 0.08]} />
        <meshStandardMaterial color="#111827" metalness={0.45} />
      </mesh>
      <Html
        transform
        distanceFactor={5.2}
        position={[0, 0, 0.05]}
        style={{ pointerEvents: "none" }}
      >
        <div
          className="manual-line-chat-panel"
          style={{
            width: 174,
            height: 102,
            padding: "8px 9px",
            borderRadius: 5,
            background: "#071923",
            color: "#e5f4f7",
            fontFamily: "system-ui",
            boxShadow: `inset 0 0 0 2px ${jammed ? "#ef4444" : row?.online ? "#22c55e" : "#475569"}`,
          }}
        >
           <div
             style={{
               display: "flex",
              justifyContent: "space-between",
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            <span>{name}</span>
            <span style={{ color: jammed ? "#f87171" : row?.online ? "#4ade80" : "#94a3b8" }}>
              {jammed ? "JAMMED" : row?.online ? "ONLINE" : "OFFLINE"}
            </span>
          </div>
          <div
            style={{
              marginTop: 8,
              fontFamily: "Consolas,monospace",
              fontSize: 11,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            SN {row?.sn || "—"}
          </div>
           <div
             style={{
               marginTop: 5,
               fontFamily: "Consolas,monospace",
               fontSize: 9,
               color: "#67e8f9",
               whiteSpace: "nowrap",
               overflow: "hidden",
               textOverflow: "ellipsis",
             }}
             title={row?.machineQr || `RJ-MACHINE:${code}`}
           >
             MQR {row?.machineQr || `RJ-MACHINE:${code}`}
           </div>
           <div style={{ marginTop: 5, color: jammed ? "#f87171" : "#fbbf24", fontSize: 10, fontWeight: 800 }}>
             WIP {wipCount}/{wipCapacity}{jammed ? " · BLOCK UPSTREAM" : ""}
           </div>
            <div style={{ marginTop: 3, color: (row?.currentNgCount ?? 0) > 0 ? "#f87171" : "#86efac", fontSize: 10, fontWeight: 800 }}>
              NG NOW {row?.currentNgCount ?? 0}
            </div>
            {code === "manu_rework" && <div style={{ marginTop: 3, color: "#fbbf24", fontSize: 9, fontWeight: 800 }}>
              REPAIR WO {row?.repairOpenCount ?? 0} OPEN / {row?.repairFinishedCount ?? 0} FINISHED
            </div>}
            <div style={{ marginTop: 3, color: "#67e8f9", fontSize: 10, fontWeight: 700 }}>
             SPEED {speed == null ? "--" : speed.toFixed(2)} PCS/MIN
           </div>
           <div style={{ marginTop: 3, color: "#e5f4f7", fontSize: 10, fontWeight: 700 }}>
             KPI OUT {throughput} · YIELD {yieldRate == null ? "--" : `${yieldRate.toFixed(1)}%`}
           </div>
           <div
             style={{
               display: "flex",
               justifyContent: "space-between",
               marginTop: 8,
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            <span style={{ color: "#4ade80" }}>PASS {row?.pass || 0}</span>
            <span style={{ color: "#f87171" }}>NG {row?.ng || 0}</span>
            <span style={{ color: "#fbbf24" }}>DUP {row?.dup || 0}</span>
          </div>
        </div>
      </Html>
    </group>
  );
}

function CanvasStationScreen({
  code,
  name,
  row,
  onSelect,
}: {
  code: string;
  name: string;
  row?: MesRow;
  onSelect?: (code: string) => void;
}) {
  const position = SCREEN_POSITIONS[code] || [0, 2.4, 0.8];
  const screen = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 288;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    return { canvas, texture };
  }, []);
  useEffect(() => {
    const context = screen.canvas.getContext("2d");
    if (!context) return;
    const online = Boolean(row?.online);
    const wipCount = row?.wipCount ?? row?.slots?.length ?? 0;
    const wipCapacity = row?.wipCapacity ?? 1;
    const jammed = row?.jammed ?? wipCount > wipCapacity;
    const speed = row?.speedPerMinute;
    const throughput = (row?.pass || 0) + (row?.ng || 0);
    const yieldRate = throughput > 0 ? ((row?.pass || 0) / throughput) * 100 : null;
    const currentNg = row?.status === "NG";
    const currentPass = row?.status === "PASS";
    context.fillStyle = "#071923";
    context.fillRect(0, 0, 512, 288);
    context.strokeStyle = jammed
      ? "#ef4444"
      : currentNg
      ? "#ef4444"
      : currentPass
        ? "#22c55e"
        : online
          ? "#06b6d4"
          : "#64748b";
    context.lineWidth = 10;
    context.strokeRect(5, 5, 502, 278);
    context.fillStyle = "#e5f4f7";
    context.font = "bold 34px Microsoft YaHei, Arial";
    context.fillText(name, 28, 54);
    context.textAlign = "right";
    context.fillStyle = jammed ? "#f87171" : online ? "#4ade80" : "#94a3b8";
    context.font = "bold 25px Arial";
    context.fillText(jammed ? "JAMMED" : online ? "ONLINE" : "OFFLINE", 484, 52);
    context.font = "bold 16px Arial";
    context.fillStyle = currentNg ? "#f87171" : currentPass ? "#4ade80" : "#fbbf24";
    context.fillText(`STATE ${row?.status || "IDLE"}`, 484, 76);
    context.textAlign = "left";
    context.fillStyle = "#b7cbd4";
    context.font = "25px Consolas, monospace";
    const sn = String(row?.sn || "—");
    context.fillText(
      `SN  ${sn.length > 24 ? sn.slice(0, 24) + "…" : sn}`,
      28,
      128,
    );
    context.fillStyle = "#67e8f9";
    context.font = "18px Consolas, monospace";
    const machineQr = String(row?.machineQr || `RJ-MACHINE:${code}`);
    context.fillText(`MQR  ${machineQr}`, 28, 158);
    context.fillStyle = jammed ? "#f87171" : "#fbbf24";
    context.font = "bold 18px Arial";
    context.fillText(`WIP ${wipCount}/${wipCapacity}${jammed ? " · BLOCK UPSTREAM" : ""}`, 28, 186);
    context.fillStyle = "#67e8f9";
    context.font = "bold 18px Arial";
     context.fillStyle = (row?.currentNgCount ?? 0) > 0 ? "#f87171" : "#86efac";
     context.font = "bold 16px Arial";
     context.fillText(`NG NOW ${row?.currentNgCount ?? 0}`, 28, 204);
     context.fillText(`SPEED ${speed == null ? "--" : speed.toFixed(2)} PCS/MIN`, 270, 186);
    context.font = "bold 27px Arial";
    context.fillStyle = "#4ade80";
    context.fillText(`PASS ${row?.pass || 0}`, 28, 218);
    context.fillStyle = "#f87171";
    context.fillText(`NG ${row?.ng || 0}`, 210, 218);
    context.fillStyle = "#fbbf24";
    context.fillText(`DUP ${row?.dup || 0}`, 350, 218);
    context.fillStyle = "#e5f4f7";
    context.font = "bold 16px Arial";
    context.fillText(`KPI OUT ${throughput} · YIELD ${yieldRate == null ? "--" : `${yieldRate.toFixed(1)}%`}`, 28, 242);
    context.fillStyle = "#67808c";
    context.font = "18px Arial";
    context.fillText(row?.workOrderCode ? `WO ${row.workOrderCode} · MAT ${row.materialCount ?? 0}/${row.boundMaterialCount ?? 0} · SIM 1/3s` : code, 28, 260);
    context.textAlign = "right";
    context.fillStyle = "#94a3b8";
    const scanTime = row?.time ? new Date(row.time).toLocaleTimeString("en-GB", { hour12: false }) : "--:--:--";
    context.fillText(scanTime, 484, 260);
    context.textAlign = "left";
    context.fillStyle = row?.materialStarvationRisk ? "#f87171" : "#94a3b8";
    context.font = "bold 13px Arial";
    const material = row?.activeMaterialCode || "NO MATERIAL";
    const materialQty = row?.materialAvailableQty == null ? "--" : String(row.materialAvailableQty);
    const source = row?.dataSource || "MES";
    const syncTime = row?.lastSyncAt ? new Date(row.lastSyncAt).toLocaleTimeString("en-GB", { hour12: false }) : "--:--:--";
    context.fillText(`MAT ${material} · QTY ${materialQty} · ${row?.materialLoadingStatus || "READY"}`, 28, 278);
    context.textAlign = "right";
    context.fillText(`${source} · SYNC ${syncTime}`, 484, 278);
    context.textAlign = "left";
    screen.texture.needsUpdate = true;
  }, [
    code,
    name,
    row?.dup,
    row?.ng,
    row?.online,
    row?.pass,
    row?.sn,
    row?.machineQr,
    row?.status,
    row?.time,
    row?.workOrderCode,
    row?.workOrderStatus,
    row?.materialCount,
    row?.boundMaterialCount,
    row?.materialLoadingStatus,
    row?.activeMaterialCode,
    row?.materialAvailableQty,
    row?.materialStarvationRisk,
    row?.dataSource,
    row?.lastSyncAt,
    row?.wipCount,
    row?.wipCapacity,
    row?.jammed,
     row?.speedPerMinute,
     row?.currentNgCount,
     row?.repairOpenCount,
     row?.repairFinishedCount,
     screen,
  ]);
  const width = 1.8;
  const height = 1.02;
  return (
    <group
      position={position}
      rotation={[0, IS_AUTO_LINE ? Math.PI : 0, 0]}
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.(code);
      }}
    >
      <mesh>
        <boxGeometry args={[width, height, 0.08]} />
        <meshStandardMaterial color="#111827" metalness={0.45} />
      </mesh>
      <mesh position={[0, 0, 0.046]}>
        <planeGeometry args={[width - 0.1, height - 0.1]} />
        <meshBasicMaterial map={screen.texture} toneMapped={false} />
      </mesh>
    </group>
  );
}

function useManualLineMesData() {
  const snapshotNgCounts = useRef<Record<string, number> | null>(null);
  const [rows, setRows] = useState<Record<string, MesRow>>(() => {
    try {
      const saved = JSON.parse(
        window.localStorage.getItem("manual-line-last-sn") || "{}",
      ) as Record<string, string>;
      return Object.fromEntries(
        MES_STATIONS.filter(([code]) => saved[code] && !String(saved[code]).startsWith("SIM-")).map(([code]) => [
          code,
          {
            online: false,
            sn: saved[code],
            pass: 0,
            ng: 0,
            dup: 0,
            time: 0,
          },
        ]),
      );
    } catch {
      return {};
    }
  });
  useEffect(() => {
    let closed = false;
    const hydrateRealAgentState = async () => {
      try {
        const stationHistory = await Promise.all(MES_STATIONS.map(async ([stationCode]) => {
          const eventStationCode = stationCode === "manu_outer_box_binding" ? "manu_case_binding" : stationCode;
          const response = await fetch(`/api/pda/events/history?stationCode=${encodeURIComponent(eventStationCode)}&limit=10`, { cache: "no-store" });
          if (!response.ok) return [];
          const body = await response.json();
          return body.events || [];
        }));
        if (closed) return;
        const latestByStation = new Map<string, any>();
        for (const event of stationHistory.flat()) {
          const code = canonicalStationCode(event.stationCode || event.payload?.stationCode);
          if (!isTwinStation(code) || latestByStation.has(code)) continue;
          const payload = event.payload || {};
          const sn = String(payload.sn || payload.mainSn || payload.batchId || payload.serialNumber || payload.serial_number || "");
          if (!sn) continue;
          latestByStation.set(code, { event, payload, sn });
        }
        setRows((old) => {
          const next = { ...old };
          for (const [code, value] of latestByStation) {
            const result = String(value.payload.result || value.payload.status || "").toUpperCase();
            next[code] = {
              ...(next[code] || { online: false, pass: 0, ng: 0, dup: 0, time: 0 }),
              sn: value.sn,
              status: result === "FAIL" || result === "NG" ? "NG" : result === "PASS" ? "PASS" : "",
              time: Date.parse(value.event.receivedAt || "") || Date.now(),
              ...(Array.isArray(value.payload.subBoards)
                ? { slots: value.payload.subBoards.map((board: any) => ({
                    sn: String(board.sn || board.serialNumber || ""),
                    result: String(board.result || "EMPTY").toUpperCase(),
                  })) }
                : Array.isArray(value.payload.slots)
                  ? { slots: value.payload.slots }
                  : {}),
            };
          }
          return next;
        });
      } catch {}
    };
    const refreshRepairAgent = async () => {
      try {
        const [dashboardResponse, handoverResponse, revivalResponse] = await Promise.all([
          fetch("/api/mes/rework/dashboard", { cache: "no-store" }),
          fetch("/api/station/maintenance-handovers?destinationStation=manu_rework", { cache: "no-store" }),
          fetch("/api/rework/revival-board", { cache: "no-store" }),
        ]);
        if (closed) return;
        const dashboardBody = dashboardResponse.ok ? await dashboardResponse.json() : {};
        const handoverBody = handoverResponse.ok ? await handoverResponse.json() : {};
        const revivalBody = revivalResponse.ok ? await revivalResponse.json() : {};
        const dashboard = dashboardBody?.data ?? dashboardBody;
        const handovers = Array.isArray(handoverBody.items) ? handoverBody.items : [];
        const revivalHistory = Array.isArray(revivalBody.items) ? revivalBody.items : [];
        const allWorkOrders = handovers.filter((item: RepairWorkOrder) =>
          canonicalStationCode(item.sourceStation) || item.repairWorkOrderNo,
        );
        const dashboardOpenRecords = Array.isArray(dashboard.openRecords) ? dashboard.openRecords : [];
        const dashboardRecentRecords = Array.isArray(dashboard.recentRecords) ? dashboard.recentRecords : [];
        const isFinishedStatus = (item: RepairWorkOrder) => [
          "COMPLETED", "CLOSED", "SCRAPPED", "PENDING_QUALITY", "REPAIRED", "PASS",
        ].includes(String(item.status || item.result || "").toUpperCase());
        const openRecords = dashboardOpenRecords.length
          ? dashboardOpenRecords
          : allWorkOrders.filter((item: RepairWorkOrder) => !isFinishedStatus(item));
        const recentRecords = dashboardRecentRecords.length
          ? dashboardRecentRecords
          : allWorkOrders.filter(isFinishedStatus);
        const finished = recentRecords.filter((item: RepairWorkOrder) =>
          ["REPAIRED", "SCRAPPED", "PASS", "NG", "CLOSED"].includes(String(item.result || "").toUpperCase()),
        );
        const current = openRecords[0] || allWorkOrders.find((item: RepairWorkOrder) =>
          !["COMPLETED", "CLOSED", "SCRAPPED", "PENDING_QUALITY"].includes(String(item.status || "").toUpperCase()),
        ) || {};
        const sortTime = (item: RepairWorkOrder) => Date.parse(String(item.repairedAt || item.updatedAt || item.submittedAt || item.repairCompletedAt || "")) || 0;
        const last10 = [...allWorkOrders, ...recentRecords]
          .sort((a, b) => sortTime(b) - sortTime(a))
          .filter((item, index, list) => {
            const key = String(item.repairWorkOrderNo || item.workOrderNo || item.id || item.sn || index);
            return list.findIndex((candidate) => String(candidate.repairWorkOrderNo || candidate.workOrderNo || candidate.id || candidate.sn || "") === key) === index;
          })
          .slice(0, 10);
        const currentStatus = String(current.result || current.status || (openRecords.length ? "OPEN" : "IDLE")).toUpperCase();
        setRows((old) => ({
          ...old,
          manu_rework: {
            ...(old.manu_rework || { online: dashboard?.line?.status !== "OFFLINE", sn: "", pass: 0, ng: 0, dup: 0, time: 0 }),
            online: dashboardResponse.ok || handoverResponse.ok,
            sn: String(current.sn || old.manu_rework?.sn || ""),
            status: ["REPAIRED", "PASS", "CLOSED"].includes(currentStatus) ? "PASS" : ["SCRAPPED", "NG", "FAILED"].includes(currentStatus) ? "NG" : "",
            time: sortTime(current) || Date.now(),
            lastSyncAt: Date.now(),
            dataSource: "MES",
            wipCount: openRecords.length,
            wipCapacity: 50,
            jammed: openRecords.length >= 50,
            repairStatus: currentStatus,
            repairCurrentWorkOrder: String(current.repairWorkOrderNo || current.workOrderNo || ""),
            workOrderCode: String(current.repairWorkOrderNo || current.workOrderNo || ""),
            materialCount: openRecords.length,
            boundMaterialCount: finished.length,
            repairDefectCode: String(current.defectCode || ""),
            repairSourceStation: String(current.sourceStation || ""),
            repairOperator: String(current.operator || ""),
            repairOpenCount: openRecords.length,
            repairFinishedCount: finished.length,
            repairHistoryCount: allWorkOrders.length + revivalHistory.length,
            repairLast10Count: last10.length,
            repairHistoryRows: last10,
            activeMaterialCode: `OPEN ${openRecords.length} · DONE ${finished.length}`,
            materialLoadingStatus: `HISTORY ${allWorkOrders.length + revivalHistory.length} · LAST10 ${last10.length}`,
          },
        }));
      } catch {
        // Keep the last valid repair-agent snapshot during transient API/MES downtime.
      }
    };
    const snapshot = async () => {
      const [results, snapshotBody, confirmedMotherboardsBody, palletBody, mesNgBody, dashboardBody, boardHistoryResults] = await Promise.all([
        Promise.all(MES_STATIONS.map(async ([code]) => {
          if (IS_AUTO_LINE) return [code, {}] as const;
          try {
            const response = await fetch(
              `/api/mes/manual-line/station-data/${code}`,
              { cache: "no-store", signal: AbortSignal.timeout(2500) },
            );
            if (!response.ok) return null;
            return [code, await response.json()] as const;
          } catch {
            return null;
          }
        })),
        fetch(`/api/station/bucket-snapshots?domain=${IS_AUTO_LINE ? "auto" : "manual"}`, { cache: "no-store", signal: AbortSignal.timeout(8000) })
          .then((response) => response.ok ? response.json() : [])
          .catch(() => []),
        fetch(`/api/station/confirmed-motherboards?line=${IS_AUTO_LINE ? "auto" : "manual"}&limit=5000`, { cache: "no-store", signal: AbortSignal.timeout(8000) })
          .then((response) => response.ok ? response.json() : { items: [] })
          .catch(() => ({ items: [] })),
        fetch("/api/station/pallets", { cache: "no-store", signal: AbortSignal.timeout(3000) })
          .then((response) => response.ok ? response.json() : [])
          .catch(() => []),
        fetch("/api/station/ng-guard", { cache: "no-store", signal: AbortSignal.timeout(3000) })
          .then((response) => response.ok ? response.json() : { items: [] })
          .catch(() => ({ items: [] })),
          // The MES dashboard aggregates station data and normally needs a few seconds.
          // Do not abort it before the response can become the 3D source of truth.
          fetch("/api/mes/manu-line/dashboard", { cache: "no-store", signal: AbortSignal.timeout(8000) })
          .then((response) => response.ok ? response.json() : null)
          .catch(() => null),
        Promise.all([...BOARD_STATIONS].map(async (code) => {
          try {
            const response = await fetch(
              `/api/pda/events/history?stationCode=${encodeURIComponent(code)}&limit=30`,
              { cache: "no-store", signal: AbortSignal.timeout(3000) },
            );
            if (!response.ok) return [code, []] as const;
            const body = await response.json();
            return [code, Array.isArray(body.events) ? body.events : []] as const;
          } catch {
            return [code, []] as const;
          }
        })),
      ]);
      if (closed) return;
      const dashboardStations = Array.isArray(dashboardBody)
        ? dashboardBody
        : dashboardBody?.data?.stations ?? dashboardBody?.stations ?? [];
      const dashboardByCode = new Map<string, Record<string, unknown>>(
        dashboardStations
          .filter((station: unknown): station is Record<string, unknown> => Boolean(station && typeof station === "object"))
          .map((station: Record<string, unknown>) => [canonicalStationCode(station.code ?? station.stationCode), station]),
      );
      const bucketSnapshots: BucketSnapshot[] = Array.isArray(snapshotBody)
        ? snapshotBody
        : snapshotBody.items ?? snapshotBody.snapshots ?? [];
      const confirmedMotherboards = (Array.isArray(confirmedMotherboardsBody)
        ? confirmedMotherboardsBody
        : confirmedMotherboardsBody?.items ?? []) as Record<string, unknown>[];
      for (const stationCode of BOARD_STATIONS) {
        const processSnapshot = bucketSnapshots.find((item) => item.stationCode === stationCode && item.bucketName === "process");
        const processPayload = processSnapshot?.payload && typeof processSnapshot.payload === "object"
          ? processSnapshot.payload as Record<string, unknown> : {};
        const liveBatch = String(processPayload.batchId ?? processPayload.motherboardId ?? processPayload.id ?? "").trim();
        const central = confirmedMotherboards.find((item) => {
          const batch = String(item.motherboardId ?? item.ictBatchId ?? item.fctBatchId ?? item.batchId ?? "").trim();
          return Boolean(batch) && (!liveBatch || batch === liveBatch);
        });
        if (central) {
          const existing = bucketSnapshots.findIndex((item) => item.stationCode === stationCode && item.bucketName === "process");
          const snapshot = { stationCode, bucketName: "process", payload: central } as BucketSnapshot;
          if (existing >= 0) bucketSnapshots[existing] = snapshot;
          else bucketSnapshots.push(snapshot);
        }
      }
      const boardHistoryByStation = new Map<string, unknown[]>(boardHistoryResults);
      const eventBoardStates = new Map<string, ReturnType<typeof boardStateFromEvents>>();
      for (const code of BOARD_STATIONS) {
        eventBoardStates.set(code, boardStateFromEvents(boardHistoryByStation.get(code) ?? [], code));
      }
      const nextNgCounts: Record<string, number> = {};
      const mesNgItems = (Array.isArray(mesNgBody) ? mesNgBody : mesNgBody?.items ?? []) as Record<string, unknown>[];
      const mesNgByStation = new Map<string, Record<string, unknown>[]>();
      for (const item of mesNgItems) {
        const code = String(item.sourceStationCode ?? item.stationCode ?? "");
        if (!isTwinStation(code)) continue;
        const rows = mesNgByStation.get(code) ?? [];
        rows.push(item);
        mesNgByStation.set(code, rows);
      }
      for (const result of results) {
        if (!result) continue;
        const [code, data] = result;
        const ngRecords = Array.isArray(data.ngRecords) ? data.ngRecords : [];
        const confirmed = snapshotRecords(
          bucketSnapshots.find(
            (item) => item.stationCode === code && item.bucketName === "confirmed_ng",
          ),
        );
        const mesRecords = mesNgByStation.get(code) ?? [];
        const eventNgCount = eventBoardStates.get(code)?.slots.filter((slot) => slot.result === "FAIL").length ?? 0;
        const count = Math.max(ngRecords.length, confirmed.length, mesRecords.length, eventNgCount);
        nextNgCounts[code] = count;
      }
      snapshotNgCounts.current = nextNgCounts;
      setRows((old) => {
        const next = { ...old };
        for (const result of results) {
          if (!result) continue;
          const [code, data] = result;
          const hasSourceRows = Array.isArray(data.ngRecords);
          const ngRecords = hasSourceRows ? data.ngRecords : [];
          const last = ngRecords[0] || ngRecords[ngRecords.length - 1] || {};
          const eventBoard = eventBoardStates.get(code) ?? null;
          const board = BOARD_STATIONS.has(code)
            // MES snapshots are authoritative for the live digital twin.
            // Event history is only a fallback when MES has no motherboard snapshot.
            ? (motherboardState(bucketSnapshots, code) || eventBoard)
            : ATE_STATIONS.has(code)
              ? ateEightState(bucketSnapshots, code)
              : code === "manu_outer_box_binding" || code === "auto_case_binding"
                ? outerBoxState(bucketSnapshots, code)
                : null;
          const dashboardStation = dashboardByCode.get(code);
          next[code] = {
            ...(next[code] || {
              online: false,
              sn: "",
              pass: 0,
              ng: 0,
              dup: 0,
              time: 0,
            }),
            online: hasSourceRows ? Boolean(data.connected && !data.error) : Boolean(next[code]?.online),
            syncState: hasSourceRows
              ? (data.error ? "DEGRADED" : data.connected ? "LIVE" : "UNAVAILABLE")
              : (next[code]?.syncState || "UNAVAILABLE"),
            ...(data.error ? { dataError: String(data.error) } : { dataError: undefined }),
            machineQr: String(
              data.machineQr || data.station?.machineQr || next[code]?.machineQr ||
                `RJ-MACHINE:${code}`,
            ),
            sn: String(board?.sn || next[code]?.sn || last.sn || last.serialNumber || ""),
            pass: Number(
              dashboardStation?.pass ?? dashboardStation?.passCount ?? data.pass ?? data.passCount ??
                (board ? board.slots.filter((slot) => slot.result === "PASS").length : next[code]?.pass ?? 0),
            ),
            ng: Number(
              (eventBoard ? eventBoard.slots.filter((slot) => slot.result === "FAIL").length : null) ??
                dashboardStation?.ng ?? dashboardStation?.ngCount ?? data.ng ?? data.ngCount ??
                (hasSourceRows ? ngRecords.length : next[code]?.ng ?? 0),
            ),
            dup: Number(
              dashboardStation?.dup ?? dashboardStation?.duplicateCount ?? data.dup ?? data.duplicateCount ??
                next[code]?.dup ?? 0,
            ),
            time: Number(
              last.time || last.timestamp || data.updatedAt || data.lastUpdatedAt || Date.now(),
            ),
            status: String(
              (eventBoard && eventBoard.slots.some((slot) => slot.result === "FAIL") ? "FAIL" : null) ??
                dashboardStation?.status ?? data.status ?? last.result ?? last.status ?? next[code]?.status ?? "",
            ).toUpperCase() === "FAIL" ? "NG" : String(
              (eventBoard && eventBoard.slots.some((slot) => slot.result === "FAIL") ? "FAIL" : null) ??
                dashboardStation?.status ?? data.status ?? last.result ?? last.status ?? next[code]?.status ?? "",
            ).toUpperCase() as "PASS" | "NG" | "",
            lastSyncAt: Date.now(),
            dataSource: "MES",
            currentNgCount: nextNgCounts[code] ?? 0,
            speedPerMinute: Number(
              dashboardStation?.speedPerMinute ?? data.speedPerMinute ?? data.productionRatePerMinute ?? data.actualRatePerMinute ??
                next[code]?.speedPerMinute ?? 0,
            ) || undefined,
            wipCount: Number(dashboardStation?.wipCount ?? data.wipCount ?? next[code]?.wipCount ?? 0),
            wipCapacity: Number(dashboardStation?.wipCapacity ?? data.wipCapacity ?? next[code]?.wipCapacity ?? 1),
            jammed: Boolean(dashboardStation?.jammed ?? data.jammed ?? false),
            alarmActive: Boolean(dashboardStation?.alarmActive ?? data.alarmActive ?? data.alarm ?? next[code]?.alarmActive ?? false),
            ...(board ? { slots: board.slots } : {}),
            ...(!board && Array.isArray(data.slots) ? { slots: data.slots } : {}),
          };
        }
        // The line dashboard is the authoritative MES snapshot for the twin.
        // Per-station file/database sources are enrichment only; they may be
        // unavailable while the central MES dashboard remains healthy.
        for (const station of dashboardStations) {
          const code = canonicalStationCode(station.code ?? station.stationCode);
          if (!isTwinStation(code)) continue;
          const current = next[code] || { online: false, sn: "", pass: 0, ng: 0, dup: 0, time: 0 };
          const stationStatus = String(station.status ?? "").toLowerCase();
          const dashboardOnline = stationStatus === "running" || stationStatus === "online" || station.online === true;
          const dashboardStatus = String(station.result ?? station.status ?? "").toUpperCase();
          next[code] = {
            ...current,
            online: current.syncState === "DEGRADED" ? false : dashboardOnline || current.online,
            syncState: current.syncState === "DEGRADED" ? "DEGRADED" : (dashboardOnline || current.online ? "LIVE" : "UNAVAILABLE"),
            sn: String(station.currentSn ?? station.sn ?? station.serialNumber ?? current.sn ?? ""),
            pass: Number(station.todayPass ?? station.pass ?? station.passCount ?? current.pass ?? 0),
            ng: Number(station.todayNg ?? station.todayFail ?? station.ng ?? station.ngCount ?? station.failCount ?? current.ng ?? 0),
            dup: Number(station.duplicateCount ?? station.dup ?? current.dup ?? 0),
            status: dashboardStatus === "FAIL" || dashboardStatus === "NG" ? "NG" : dashboardStatus === "PASS" ? "PASS" : current.status ?? "",
            wipCount: Number(station.wipCount ?? current.wipCount ?? 0),
            wipCapacity: Number(station.wipCapacity ?? current.wipCapacity ?? 1),
            jammed: Boolean(station.jammed ?? current.jammed ?? false),
            alarmActive: Boolean(station.alarmActive ?? station.alarm ?? current.alarmActive ?? false),
            currentNgCount: Number(station.currentNgCount ?? station.activeNgCount ?? current.currentNgCount ?? 0),
            speedPerMinute: Number(station.speedPerMinute ?? current.speedPerMinute ?? 0) || undefined,
            time: Date.parse(String(station.lastEventAt ?? "")) || current.time || Date.now(),
            lastSyncAt: Date.now(),
            dataSource: "MES",
          };
        }
        // The MES dashboard exposes the line gateway separately from the
        // physical stations. Project that line-level state onto the PDA/load
        // node so the 3D view reports a complete MES-controlled line.
        const lineState = dashboardBody?.data?.line ?? dashboardBody?.line;
        if (lineState && typeof lineState === "object") {
          const current = next.pda_load || { online: false, sn: "", pass: 0, ng: 0, dup: 0, time: 0 };
          const status = String(lineState.status ?? "").toLowerCase();
          next.pda_load = {
            ...current,
            online: status !== "offline" && status !== "stopped",
            syncState: "LIVE",
            dataSource: "MES",
            lastSyncAt: Date.now(),
            machineQr: String(current.machineQr || "MES-LINE-GATEWAY:L004"),
          };
        }
        for (const [code, records] of mesNgByStation) {
          if (!records.length) continue;
          const current = next[code] || { online: true, sn: "", pass: 0, ng: 0, dup: 0, time: 0 };
          next[code] = {
            ...current,
            ng: Math.max(current.ng, records.length),
            // Historical NG is trace data only. It must never create or
            // reactivate a live station alarm.
            alarmActive: current.alarmActive ?? false,
          };
        }
        const pallets = Array.isArray(palletBody)
          ? palletBody
          : Array.isArray(palletBody?.items)
            ? palletBody.items
            : [];
        const activePallet = pallets.find((item: any) => String(item.status || "").toLowerCase() === "loading") ?? pallets[0];
        if (activePallet) {
          const cartons = Array.isArray(activePallet.cartons) ? activePallet.cartons : [];
          const palletStationCode = lineCode("pallet_binding");
          next[palletStationCode] = {
            ...(next[palletStationCode] || { online: true, sn: "", pass: 0, ng: 0, dup: 0, time: 0 }),
            sn: String(activePallet.palletCode ?? activePallet.pallet_code ?? ""),
            pass: cartons.length,
            target: Number(activePallet.targetCartons ?? activePallet.target_cartons ?? cartons.length),
            status: String(activePallet.status || "").toLowerCase() === "sealed" ? "PASS" : "",
            slots: cartons.map((carton: unknown) => ({ sn: String(carton), result: "PASS" })),
          };
        }
        return next;
      });
    };
    const heartbeat = async () => {
      try {
        const response = await fetch("/api/pda/heartbeats");
        if (!response.ok) return;
        const data = await response.json();
        if (closed) return;
        const now = Date.now();
        setRows((old) => {
          const next = { ...old };
          for (const item of data.heartbeats || []) {
            const code = canonicalStationCode(item.stationCode);
            if (!isTwinStation(code)) continue;
            const payload = item.payload || {};
            const heartbeatSn = String(payload.currentSn || payload.sn || payload.serialNumber || "");
            next[code] = {
              ...(next[code] || { sn: "", pass: 0, ng: 0, dup: 0, time: 0 }),
              online:
                item.online !== false &&
                Number(data.serverTime || now) - Number(item.receivedAt || 0) <
                  45000,
              syncState: item.online === false ? "UNAVAILABLE" : "LIVE",
              dataError: undefined,
              dataSource: "MES",
              lastSyncAt: now,
              sn: BOARD_STATIONS.has(code) ? next[code]?.sn || "" : heartbeatSn || next[code]?.sn || "",
              machineQr: String(
                item.machineQr || payload.machineQr || item.station?.machineQr ||
                  next[code]?.machineQr || `RJ-MACHINE:${code}`,
              ),
              time: Number(item.receivedAt || next[code]?.time || 0),
            };
          }
          return next;
        });
      } catch {}
    };
    hydrateRealAgentState();
    refreshRepairAgent();
    snapshot();
    heartbeat();
    const timer = window.setInterval(heartbeat, 5000);
    // Keep the polling below the dashboard's normal response time to avoid
    // overlapping requests and repeatedly cancelling a valid MES snapshot.
    const snapshotTimer = window.setInterval(snapshot, 5000);
    const repairTimer = window.setInterval(refreshRepairAgent, 3000);
    const events = new EventSource(
      `${MES_API_ORIGIN}/api/pda/events?node=${IS_AUTO_LINE ? "auto_line_video_3d" : "manual_line_video_3d"}&replay=0&types=SN_SCAN,STATION_TEST_RESULT,NG_DEFECT,NG_MARKED,DUPLICATE_SN,AGENT_HEARTBEAT,CONTAINER_UPDATE,ALARM_STARTED,ALARM_ACKNOWLEDGED,ALARM_RESOLVED,ALARM_PROCESS_STARTED,ALARM_PROCESS_COMPLETED`,
    );
    events.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data);
        const payload = event.payload || event.data || event;
        const code = canonicalStationCode(
          payload.stationCode ||
            payload.station_code ||
            event.stationCode ||
            "",
        );
        if (!isTwinStation(code)) return;
        const type = String(event.type || payload.type || "");
        const result = String(
          payload.result || payload.status || "",
        ).toUpperCase();
        const sn = String(
          BOARD_STATIONS.has(code)
            ? payload.batchId || payload.motherboardId || payload.mainSn || payload.sn || payload.serialNumber || payload.serial_number || ""
            : payload.sn || payload.mainSn || payload.batchId || payload.serialNumber || payload.serial_number || "",
        );
        if (type === "ALARM_PROCESS_COMPLETED" || type === "ALARM_RESOLVED") {
          setRows((old) => old[code] ? {
            ...old,
            [code]: { ...old[code], alarmActive: false },
          } : old);
          window.dispatchEvent(
            new CustomEvent("manual-line-alarm-completed", {
              detail: {
                code,
                sn,
                completedAt: Number(payload.completedAt || Date.now()),
                durationMs: Number(payload.durationMs || 0),
                status: String(payload.status || "ACKNOWLEDGED"),
              },
            }),
          );
          return;
        }
        if (type === "ALARM_STARTED") {
          setRows((old) => {
            const current = old[code] || { online: true, sn: "", pass: 0, ng: 0, dup: 0, time: 0 };
            return { ...old, [code]: { ...current, alarmActive: true, sn: BOARD_STATIONS.has(code) ? current.sn : sn || current.sn } };
          });
          window.dispatchEvent(
            new CustomEvent("manual-line-ng-alarm", {
              detail: {
                code,
                sn: sn || String((payload.sns || [])[0] || ""),
              },
            }),
          );
          return;
        }
        const nextStatus: "PASS" | "NG" | "" =
          result === "NG" ||
          result === "FAIL" ||
          type === "NG_DEFECT" ||
          type === "NG_MARKED"
            ? "NG"
            : result === "PASS"
              ? "PASS"
              : type === "SN_SCAN"
                ? ""
                : "";
        if (sn) {
          try {
            const saved = JSON.parse(
              window.localStorage.getItem("manual-line-last-sn") || "{}",
            );
            saved[code] = sn;
            window.localStorage.setItem(
              "manual-line-last-sn",
              JSON.stringify(saved),
            );
          } catch {}
        }
        // MES remains authoritative for ICT/FCT/Depanel counters and slots,
        // but the live scanner event must still be visible immediately on the
        // 3D station (current SN, state and scan time).
        setRows((old) => {
          const current = old[code] || {
            online: true,
            sn: "",
            pass: 0,
            ng: 0,
            dup: 0,
            time: 0,
          };
          const mesAuthoritative = BOARD_STATIONS.has(code) && current.dataSource === "MES";
          const preserveBoardIdentity = BOARD_STATIONS.has(code);
          return {
            ...old,
            [code]: {
              ...current,
               online: true,
               machineQr: String(
                 payload.machineQr || event.machineQr || current.machineQr ||
                   `RJ-MACHINE:${code}`,
               ),
              sn: sn || current.sn,
              pass: mesAuthoritative ? current.pass : current.pass + (result === "PASS" ? 1 : 0),
              ng:
                mesAuthoritative ? current.ng : current.ng +
                (result === "NG" ||
                result === "FAIL" ||
                type === "NG_DEFECT" ||
                type === "NG_MARKED"
                  ? 1
                  : 0),
              dup: mesAuthoritative ? current.dup : current.dup + (type === "DUPLICATE_SN" ? 1 : 0),
              time: Date.now(),
              status: type === "SN_SCAN" ? "" : nextStatus || current.status || "",
              alarmActive: mesAuthoritative ? (current.alarmActive || nextStatus === "NG") : nextStatus === "NG" && type !== "NG_MARKED",
              ...(!preserveBoardIdentity && Array.isArray(payload.subBoards)
                ? { slots: payload.subBoards.map((board: any) => ({
                    sn: String(board.sn || board.serialNumber || ""),
                    result: String(board.result || "EMPTY").toUpperCase(),
                  })) }
                : !preserveBoardIdentity && Array.isArray(payload.slots)
                  ? { slots: payload.slots }
                  : {}),
            },
          };
        });
        if (nextStatus === "NG" && type !== "NG_MARKED") {
          window.dispatchEvent(
            new CustomEvent("manual-line-ng-alarm", {
              detail: { code, sn },
            }),
          );
        }
      } catch {}
    };
    const simulationHandler = (rawEvent: Event) => {
      const detail = (
        rawEvent as CustomEvent<{
          code: string;
          sn: string;
          result?: "PASS" | "NG" | "";
          slots?: Array<{ sn: string; result: string }>;
        }>
      ).detail;
      if (!detail?.code || !detail.sn) return;
      setRows((old) => ({
        ...old,
        [detail.code]: {
          ...(old[detail.code] || {
            pass: 0,
            ng: 0,
            dup: 0,
            time: 0,
          }),
          online: true,
          dataSource: "MOCK",
          lastSyncAt: Date.now(),
          sn: detail.sn,
          time: Date.now(),
          status: detail.result || "",
          alarmActive: detail.result === "NG",
          slots:
            detail.slots ||
            (detail.code.includes("_ate")
              ? [
                  ...(old[detail.code]?.slots || []).filter(
                    (slot) => slot.sn !== detail.sn,
                  ),
                  { sn: detail.sn, result: detail.result || "" },
                ].slice(-8)
              : old[detail.code]?.slots),
        },
      }));
      window.dispatchEvent(
        new CustomEvent("manual-line-flow-update", {
          detail: {
            code: detail.code,
            sn: detail.sn,
            status: detail.result || "",
          },
        }),
      );
      try {
        const saved = JSON.parse(
          window.localStorage.getItem("manual-line-last-sn") || "{}",
        );
        saved[detail.code] = detail.sn;
        window.localStorage.setItem(
          "manual-line-last-sn",
          JSON.stringify(saved),
        );
      } catch {}
      if (detail.result === "NG") {
        window.dispatchEvent(
          new CustomEvent("manual-line-ng-alarm", {
            detail: { code: detail.code, sn: detail.sn },
          }),
        );
      }
    };
    window.addEventListener("manual-line-sim-sn", simulationHandler);
    return () => {
      closed = true;
      window.clearInterval(timer);
      window.clearInterval(snapshotTimer);
      window.clearInterval(repairTimer);
      events.close();
      window.removeEventListener("manual-line-sim-sn", simulationHandler);
    };
  }, []);
  useEffect(() => {
    let closed = false;
    const lineDomain = IS_AUTO_LINE ? "auto" : "manual";
    const fctStationCode = IS_AUTO_LINE ? "auto_fct" : "manu_fct";
    const syncFctBoard = async () => {
      try {
        const [snapshotResponse, boardResponse] = await Promise.all([
          fetch(`/api/station/bucket-snapshots?domain=${lineDomain}`, { cache: "no-store", signal: AbortSignal.timeout(5000) }),
          fetch(`/api/station/confirmed-motherboards?line=${lineDomain}&limit=5000`, { cache: "no-store", signal: AbortSignal.timeout(5000) }),
        ]);
        if (!snapshotResponse.ok || !boardResponse.ok || closed) return;
        const snapshotBody = await snapshotResponse.json();
        const boardBody = await boardResponse.json();
        const snapshots = (Array.isArray(snapshotBody) ? snapshotBody : snapshotBody.items ?? []) as BucketSnapshot[];
        const centralBoards = (Array.isArray(boardBody) ? boardBody : boardBody.items ?? []) as Record<string, unknown>[];
        const processPayload = snapshots.find((item) => item.stationCode === fctStationCode && item.bucketName === "process")?.payload;
        const process = processPayload && typeof processPayload === "object" ? processPayload as Record<string, unknown> : {};
        const liveBatch = String(process.batchId ?? process.motherboardId ?? process.id ?? "").trim();
        const board = centralBoards.find((item) => String(item.fctBatchId ?? item.motherboardId ?? item.batchId ?? "").trim() === liveBatch);
        const members = Array.isArray(board?.members) ? board.members as Record<string, unknown>[] : [];
        if (!board || members.length === 0) return;
        const slots = Array.from({ length: 12 }, (_, index) => {
          const member = members.find((item) => Number(item.slot ?? index + 1) === index + 1) ?? {};
          return {
            sn: String(member.sn ?? member.pcbSerial ?? ""),
            result: member.fctNg ? "FAIL" : "PASS",
          };
        });
        if (closed) return;
        setRows((old) => ({
          ...old,
          [fctStationCode]: {
            ...(old[fctStationCode] || { pass: 0, ng: 0, dup: 0, time: 0 }),
            dataSource: "MES",
            syncState: "LIVE",
            online: true,
            sn: String(board.motherboardId ?? board.fctBatchId ?? liveBatch),
            slots,
            pass: slots.filter((slot) => slot.result === "PASS").length,
            ng: slots.filter((slot) => slot.result === "FAIL").length,
            currentNgCount: slots.filter((slot) => slot.result === "FAIL").length,
            lastSyncAt: Date.now(),
            time: Date.now(),
          },
        }));
      } catch {}
    };
    syncFctBoard();
    const timer = window.setInterval(syncFctBoard, 2000);
    return () => { closed = true; window.clearInterval(timer); };
  }, []);
  return rows;
}

function Bench({
  x,
  z,
  length = 6,
}: {
  x: number;
  z: number;
  length?: number;
}) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.88, 0]} castShadow>
        <boxGeometry args={[length, 0.13, 1.25]} />
        <meshStandardMaterial color={GREEN} roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.36, 0]}>
        <boxGeometry args={[length, 0.08, 1.05]} />
        <meshStandardMaterial color="#77848c" metalness={0.6} />
      </mesh>
      {[-length / 2 + 0.25, length / 2 - 0.25].map((px) => (
        <React.Fragment key={px}>
          <mesh position={[px, 0.43, -0.48]}>
            <boxGeometry args={[0.08, 0.86, 0.08]} />
            <meshStandardMaterial color="#c9d1d5" metalness={0.65} />
          </mesh>
          <mesh position={[px, 0.43, 0.48]}>
            <boxGeometry args={[0.08, 0.86, 0.08]} />
            <meshStandardMaterial color="#c9d1d5" metalness={0.65} />
          </mesh>
        </React.Fragment>
      ))}
    </group>
  );
}

function RepairStationModel({ row, position, onSelect }: { row?: MesRow; position: readonly [number, number, number]; onSelect?: () => void }) {
  const hasWork = Boolean(row?.wipCount || row?.slots?.length || row?.sn);
  return (
    <group
      position={position}
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.();
      }}
    >
      <mesh position={[0, 0.06, 0]} receiveShadow>
        <boxGeometry args={[7.2, 0.12, 3.6]} />
        <meshStandardMaterial color="#475569" roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.08, 0]} castShadow>
        <boxGeometry args={[3.6, 0.18, 1.45]} />
        <meshStandardMaterial color="#d6a85f" roughness={0.72} />
      </mesh>
      {[-1.45, 1.45].map((x) => [-0.52, 0.52].map((z) => (
        <mesh key={`${x}-${z}`} position={[x, 0.56, z]}>
          <boxGeometry args={[0.12, 1.05, 0.12]} />
          <meshStandardMaterial color="#334155" metalness={0.45} />
        </mesh>
      )))}
      <mesh position={[2.05, 1.1, 0.1]} castShadow>
        <boxGeometry args={[0.9, 1.45, 0.9]} />
        <meshStandardMaterial color="#1e293b" metalness={0.35} />
      </mesh>
      {[-0.24, 0, 0.24].map((y) => (
        <mesh key={y} position={[2.05, 0.75 + y, 0.57]}>
          <boxGeometry args={[0.58, 0.06, 0.04]} />
          <meshStandardMaterial color="#38bdf8" emissive="#0ea5e9" emissiveIntensity={0.35} />
        </mesh>
      ))}
      <mesh position={[-2.05, 0.42, 0.55]} castShadow>
        <boxGeometry args={[0.82, 0.82, 0.72]} />
        <meshStandardMaterial color={hasWork ? "#dc2626" : "#64748b"} roughness={0.72} />
      </mesh>
      <Text position={[0, 2.0, 0]} fontSize={0.3} color="#f8fafc" anchorX="center">
        REPAIR STATION · MES REWORK
      </Text>
      <Text position={[-2.05, 0.42, 0.92]} fontSize={0.13} color="#ffffff" anchorX="center" anchorY="middle">
        {hasWork
          ? `${row?.repairStatus || "OPEN"} · ${row?.wipCount ?? row?.slots?.length ?? 1}`
          : "EMPTY"}
      </Text>
    </group>
  );
}

function NgRoutingNetwork() {
  if (IS_AUTO_LINE) return null;
  const routeZ = 4.85;
  const mergeX = 77;
  const repairApproachZ = -6.15;
  return (
    <group>
      <Text position={[mergeX - 8, 0.08, routeZ + 0.45]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.24} color="#991b1b" anchorX="center">
        NG ROUTING · ALL STATIONS → REPAIR
      </Text>
      {MANUAL_STATIONS.map(([code], index) => {
        const x = stationX(index);
        return (
          <group key={`ng-route-${code}`}>
            <mesh position={[x, 0.035, (2.45 + routeZ) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[0.32, routeZ - 2.45]} />
              <meshBasicMaterial color="#dc2626" transparent opacity={0.72} />
            </mesh>
            <mesh position={[x, 0.04, routeZ]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[0.58, 0.16]} />
              <meshBasicMaterial color="#f97316" />
            </mesh>
            <Text position={[x, 0.07, routeZ + 0.18]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.12} color="#7f1d1d" anchorX="center">
              {code.replace("manu_", "")}
            </Text>
          </group>
        );
      })}
      <mesh position={[(MANUAL_STATIONS[0] ? stationX(0) : 0) + (mergeX - stationX(0)) / 2, 0.035, routeZ]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[mergeX - stationX(0), 0.42]} />
        <meshBasicMaterial color="#dc2626" transparent opacity={0.82} />
      </mesh>
      <mesh position={[mergeX, 0.035, (routeZ + repairApproachZ) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.42, routeZ - repairApproachZ]} />
        <meshBasicMaterial color="#dc2626" transparent opacity={0.82} />
      </mesh>
      <mesh position={[(mergeX + 36) / 2, 0.035, repairApproachZ]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[mergeX - 36, 0.42]} />
        <meshBasicMaterial color="#dc2626" transparent opacity={0.82} />
      </mesh>
      {Array.from({ length: 6 }, (_, index) => (
        <mesh key={`ng-arrow-${index}`} position={[68 - index * 6, 0.08, routeZ]} rotation={[0, 0, -Math.PI / 2]}>
          <coneGeometry args={[0.38, 0.9, 3]} />
          <meshBasicMaterial color="#991b1b" />
        </mesh>
      ))}
      {Array.from({ length: 3 }, (_, index) => (
        <mesh key={`ng-repair-arrow-${index}`} position={[mergeX, 0.08, 1.7 - index * 2.2]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.38, 0.9, 3]} />
          <meshBasicMaterial color="#991b1b" />
        </mesh>
      ))}
      <Text position={[mergeX - 5, 0.08, repairApproachZ - 0.45]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.22} color="#991b1b" anchorX="center">
        NG → REPAIR
      </Text>
    </group>
  );
}

function AutoNgRoutingRoutes() {
  if (!IS_AUTO_LINE) return null;
  const line = (stationConfig as any).lines?.find((item: any) => item.domain === "AUTO_LINE");
  const definitions = line?.stations || [];
  const policies = (stationConfig as any).ngPolicies || [];
  const repairX = 40;
  const redLaneZ = -11.15;
  const greenLaneZ = -12.35;
  const autoCode = (code: string) => code.startsWith("manu_") ? `AUTO_${code.slice(5).toUpperCase()}` : code;
  const stationIndex = (code: string) => AUTO_STATIONS.findIndex(([stationCode]) => stationCode === code.toLowerCase().replace(/^auto_/, "auto_") || stationCode.toUpperCase() === code.toUpperCase());
  const returnTargets = (sourceIndex: number) => {
    const sourceCode = AUTO_STATIONS[sourceIndex][0].toUpperCase();
    const policy = policies.find((item: any) => item.appliesTo?.some((code: string) => code.toUpperCase() === sourceCode));
    const action = policy?.action || {};
    if (action.returnStation) {
      const index = stationIndex(autoCode(String(action.returnStation)));
      if (index >= 0) return [index];
    }
    if (String(action.route || "").includes("RETURN_TO_ORIGIN") || String(action.route || "").includes("ORIGIN")) return [sourceIndex];
    if (action.returnCapability) {
      const destination = definitions.find((item: any) => item.capability === action.returnCapability)?.code;
      const index = stationIndex(String(destination || ""));
      if (index >= 0) return [index];
    }
    if (policy?.code === "DEPANEL_INTERCEPT" || String(action.route || "").includes("REPAIR")) return [sourceIndex];
    return [];
  };
  const floorStrip = (key: string, x: number, z: number, width: number, depth: number, color: string, opacity = 0.82) => (
    <mesh key={key} position={[x, 0.045, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[width, depth]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} />
    </mesh>
  );
  return (
    <group>
      <Text position={[repairX, 0.1, redLaneZ - 0.42]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.22} color="#991b1b" anchorX="center">
        AUTO NG → REPAIR / MES ROUTE
      </Text>
      <Text position={[repairX, 0.1, greenLaneZ - 0.42]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.22} color="#166534" anchorX="center">
        AUTO REPAIRED NG → DESIGNATED RETURN
      </Text>
      {AUTO_STATIONS.map(([code], sourceIndex) => {
        const sourceX = stationX(sourceIndex);
        const sourceZ = stationZ(sourceIndex);
        const redLength = Math.abs(sourceX - repairX);
        const redDirection = sourceX <= repairX ? 1 : -1;
        return (
          <group key={`auto-ng-route-${code}`}>
            {floorStrip(`auto-ng-vertical-${code}`, sourceX, (sourceZ + redLaneZ) / 2, 0.24, Math.abs(sourceZ - redLaneZ), "#dc2626")}
            {redLength > 0.2 && floorStrip(`auto-ng-horizontal-${code}`, (sourceX + repairX) / 2, redLaneZ, redLength, 0.32, "#dc2626")}
            <mesh position={[sourceX, 0.09, sourceZ + (redDirection > 0 ? -0.8 : 0.8)]} rotation={[Math.PI / 2, 0, 0]}>
              <coneGeometry args={[0.28, 0.72, 3]} />
              <meshBasicMaterial color="#991b1b" />
            </mesh>
            {redLength > 0.2 && (
              <mesh position={[sourceX + redDirection * Math.min(redLength * 0.58, 6), 0.09, redLaneZ]} rotation={[0, 0, redDirection > 0 ? -Math.PI / 2 : Math.PI / 2]}>
                <coneGeometry args={[0.28, 0.72, 3]} />
                <meshBasicMaterial color="#991b1b" />
              </mesh>
            )}
            {returnTargets(sourceIndex).map((targetIndex, returnIndex) => {
              const targetX = stationX(targetIndex);
              const targetZ = stationZ(targetIndex);
              const length = Math.abs(targetX - repairX);
              const direction = targetX >= repairX ? 1 : -1;
              return (
                <group key={`auto-return-${code}-${returnIndex}-${targetIndex}`}>
                  {floorStrip(`auto-return-horizontal-${code}-${returnIndex}`, (repairX + targetX) / 2, greenLaneZ, length, 0.28, "#16a34a")}
                  {floorStrip(`auto-return-vertical-${code}-${returnIndex}`, targetX, (greenLaneZ + targetZ) / 2, 0.22, Math.abs(greenLaneZ - targetZ), "#16a34a")}
                  <mesh position={[repairX + direction * Math.min(length * 0.58, 6), 0.09, greenLaneZ]} rotation={[0, 0, direction > 0 ? -Math.PI / 2 : Math.PI / 2]}>
                    <coneGeometry args={[0.28, 0.72, 3]} />
                    <meshBasicMaterial color="#15803d" />
                  </mesh>
                  <mesh position={[targetX, 0.09, targetZ + (targetZ > greenLaneZ ? 0.8 : -0.8)]} rotation={[Math.PI / 2, 0, 0]}>
                    <coneGeometry args={[0.28, 0.72, 3]} />
                    <meshBasicMaterial color="#15803d" />
                  </mesh>
                </group>
              );
            })}
          </group>
        );
      })}
    </group>
  );
}

function NgRoutingStationRoutes() {
  if (IS_AUTO_LINE) return null;
  const repairX = 36;
  const repairIntakeZ = -6.15;
  const laneZ = (index: number) => 4.45 + index * 0.34;
  return (
    <group>
      <Text position={[repairX, 0.09, repairIntakeZ - 0.55]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.24} color="#991b1b" anchorX="center">
        MES NG → REPAIR / REPAIRED → RETURN
      </Text>
      {MANUAL_STATIONS.map(([code], index) => {
        const sourceX = stationX(index);
        const z = laneZ(index);
        const intakeX = 32.8 + index * 0.53;
        const length = Math.abs(intakeX - sourceX);
        const direction = sourceX <= intakeX ? 1 : -1;
        return (
          <group key={`station-route-${code}`}>
            <mesh position={[sourceX, 0.04, (2.45 + z) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[0.26, z - 2.45]} />
              <meshBasicMaterial color="#dc2626" />
            </mesh>
            {length > 0.2 && (
              <>
                <mesh position={[(sourceX + intakeX) / 2, 0.04, z]} rotation={[-Math.PI / 2, 0, 0]}>
                  <planeGeometry args={[length, 0.34]} />
                  <meshBasicMaterial color="#dc2626" />
                </mesh>
                <mesh position={[sourceX + direction * Math.min(length * 0.58, 7), 0.09, z]} rotation={[0, 0, direction > 0 ? -Math.PI / 2 : Math.PI / 2]}>
                  <coneGeometry args={[0.34, 0.82, 3]} />
                  <meshBasicMaterial color="#991b1b" />
                </mesh>
              </>
            )}
            <mesh position={[intakeX, 0.04, (z + repairIntakeZ) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[0.24, z - repairIntakeZ]} />
              <meshBasicMaterial color="#dc2626" />
            </mesh>
            <mesh position={[intakeX, 0.09, z - Math.min(Math.abs(z - repairIntakeZ) * 0.55, 1.6)]} rotation={[Math.PI / 2, 0, 0]}>
              <coneGeometry args={[0.34, 0.82, 3]} />
              <meshBasicMaterial color="#991b1b" />
            </mesh>
            <mesh position={[intakeX, 0.05, repairIntakeZ - 0.9]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[0.7, 0.28]} />
              <meshBasicMaterial color="#16a34a" />
            </mesh>
            <Text position={[intakeX + 0.22, 0.08, repairIntakeZ - 0.9]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.1} color="#166534" anchorX="left">
              RETURN
            </Text>
          </group>
        );
      })}
      <mesh position={[repairX, 0.05, (repairIntakeZ - 0.9 + -8) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.7, Math.abs(-8 - (repairIntakeZ - 0.9))]} />
        <meshBasicMaterial color="#16a34a" />
      </mesh>
      <mesh position={[repairX, 0.1, -7.45]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.42, 1, 3]} />
        <meshBasicMaterial color="#15803d" />
      </mesh>
    </group>
  );
}

function DesignatedRepairReturnRoutes() {
  if (IS_AUTO_LINE) return null;
  const repairX = 36;
  const repairZ = -7.8;
  const returnLaneZ = (index: number) => 9.2 + index * 0.22;
  const returnTargets = (sourceIndex: number) => {
    const sourceCode = MANUAL_STATIONS[sourceIndex][0] === "pda_load"
      ? "manu_pda"
      : MANUAL_STATIONS[sourceIndex][0] === "manu_outer_box_binding"
        ? "manu_case_binding"
        : MANUAL_STATIONS[sourceIndex][0];
    const line = (stationConfig as any).lines?.find((item: any) => item.domain === "MANUAL_LINE");
    const definitions = line?.stations || [];
    const policies = (stationConfig as any).ngPolicies || [];
    const policy = policies.find((item: any) => item.appliesTo?.includes(sourceCode));
    const action = policy?.action || {};
    if (policy?.code === "ICT_PANEL_NG" && action.returnStation) {
      return [MANUAL_STATIONS.findIndex(([code]) => code === action.returnStation)];
    }
    if (policy?.code === "DEPANEL_INTERCEPT") {
      const configured = (stationConfig as any).offlineContinuity?.returnRules?.ICT_FCT_NG || ["manu_ict", "manu_fct"];
      return configured.map((code: string) => MANUAL_STATIONS.findIndex(([stationCode]) => stationCode === code)).filter((index: number) => index >= 0);
    }
    if (String(action.route || "").includes("RETURN_TO_ORIGIN") || String(action.route || "").includes("ORIGIN")) {
      return [sourceIndex];
    }
    if (action.returnCapability) {
      const destination = definitions.find((item: any) => item.capability === action.returnCapability)?.code;
      const target = MANUAL_STATIONS.findIndex(([code]) => code === destination);
      if (target >= 0) return [target];
    }
    if (String(action.route || "").includes("REPAIR")) return [sourceIndex];
    return [];
  };
  return (
    <group>
      <Text position={[repairX + 2.5, 0.1, 9.0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.22} color="#166534" anchorX="center">
        DESIGNATED RETURN STATIONS
      </Text>
      {MANUAL_STATIONS.flatMap(([code], sourceIndex) => returnTargets(sourceIndex).map((targetIndex, routeIndex) => {
        const targetX = stationX(targetIndex);
        const z = returnLaneZ(sourceIndex) + routeIndex * 0.12;
        const intakeX = 32.8 + sourceIndex * 0.53;
        const length = Math.abs(targetX - intakeX);
        const direction = targetX <= intakeX ? -1 : 1;
        return (
          <group key={`designated-return-${code}-${targetIndex}`}>
            <mesh position={[intakeX, 0.06, (repairZ + z) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[0.22, z - repairZ]} />
              <meshBasicMaterial color="#16a34a" />
            </mesh>
            <mesh position={[(intakeX + targetX) / 2, 0.06, z]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[Math.max(length, 0.3), 0.34]} />
              <meshBasicMaterial color="#16a34a" />
            </mesh>
            <mesh position={[intakeX + direction * Math.min(Math.max(length * 0.56, 0.5), 7), 0.11, z]} rotation={[0, 0, direction > 0 ? -Math.PI / 2 : Math.PI / 2]}>
              <coneGeometry args={[0.34, 0.82, 3]} />
              <meshBasicMaterial color="#15803d" />
            </mesh>
            <mesh position={[targetX, 0.06, (z + 2.45) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[0.22, z - 2.45]} />
              <meshBasicMaterial color="#16a34a" />
            </mesh>
            <Text position={[targetX, 0.1, z + 0.18]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.12} color="#166534" anchorX="center">
              {targetIndex === 6 ? "RETURN → ASSEMBLY ATE" : targetIndex === 2 || targetIndex === 3 ? `RETURN → ${MANUAL_STATIONS[targetIndex][0].replace("manu_", "")}` : `RETURN → ${MANUAL_STATIONS[targetIndex][0].replace("manu_", "")}`}
            </Text>
          </group>
        );
      }))}
    </group>
  );
}

function Operator({
  x,
  z,
  facing = 1,
}: {
  x: number;
  z: number;
  facing?: number;
}) {
  return (
    <group position={[x, 0, z]} rotation={[0, facing > 0 ? Math.PI : 0, 0]}>
      <mesh position={[0, 0.72, 0]} castShadow>
        <cylinderGeometry args={[0.18, 0.22, 0.72, 12]} />
        <meshStandardMaterial color="#79b9d4" roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.18, 0]} castShadow>
        <sphereGeometry args={[0.15, 16, 12]} />
        <meshStandardMaterial color="#f0c9a5" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.29, 0]} castShadow>
        <sphereGeometry args={[0.17, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#70b9d7" roughness={0.72} />
      </mesh>
      {[-0.19, 0.19].map((arm) => (
        <mesh
          key={arm}
          position={[arm, 0.83, -0.22]}
          rotation={[0.9, 0, arm * 0.5]}
        >
          <capsuleGeometry args={[0.055, 0.42, 5, 8]} />
          <meshStandardMaterial color="#79b9d4" />
        </mesh>
      ))}
      <mesh position={[0, 0.32, 0.12]}>
        <cylinderGeometry args={[0.23, 0.23, 0.08, 18]} />
        <meshStandardMaterial color="#222b31" />
      </mesh>
      <mesh position={[0, 0.16, 0.12]}>
        <cylinderGeometry args={[0.035, 0.035, 0.32, 10]} />
        <meshStandardMaterial color="#66737b" metalness={0.7} />
      </mesh>
    </group>
  );
}

function ManualLineDetails() {
  const workCells = [5, 11, 17, 23, 29, 35, 41, 47, 53, 59, 65, 71];
  return (
    <group>
      <mesh position={[36, 0.96, 0]} receiveShadow>
        <boxGeometry args={[73, 0.12, 0.78]} />
        <meshStandardMaterial color="#16834f" roughness={0.48} />
      </mesh>
      {[-0.46, 0.46].map((z) => (
        <mesh key={z} position={[36, 1.03, z]}>
          <boxGeometry args={[73, 0.075, 0.055]} />
          <meshStandardMaterial color="#d4dadd" metalness={0.75} />
        </mesh>
      ))}
      {workCells.map((x, cellIndex) => (
        <group key={x}>
          <mesh position={[x, 1.47, -0.7]} castShadow>
            <boxGeometry args={[5.5, 0.08, 0.48]} />
            <meshStandardMaterial color="#e7ecee" metalness={0.38} />
          </mesh>
          {[-2.55, 2.55].map((dx) => (
            <mesh key={dx} position={[x + dx, 1.2, -0.72]}>
              <boxGeometry args={[0.055, 1.45, 0.055]} />
              <meshStandardMaterial color="#d9e0e3" metalness={0.72} />
            </mesh>
          ))}
          {Array.from({ length: 4 }, (_, i) => (
            <mesh key={`wi-${i}`} position={[x - 1.8 + i * 1.2, 1.97, -0.76]}>
              <planeGeometry args={[0.85, 0.55]} />
              <meshStandardMaterial
                color="#f8fafc"
                roughness={0.94}
                side={THREE.DoubleSide}
              />
            </mesh>
          ))}
          <pointLight
            position={[x, 1.78, -0.25]}
            intensity={0.32}
            distance={3.1}
            color="#f6ffff"
          />
          {cellIndex % 2 === 0 && <Operator x={x - 0.7} z={1.16} />}
        </group>
      ))}
      {[25, 31, 37, 58, 63].map((x) => (
        <group key={`carton-${x}`} position={[x, 0, 1.62]}>
          <mesh position={[-0.58, 0.26, -0.06]} castShadow>
            <boxGeometry args={[0.64, 0.52, 0.52]} />
            <meshStandardMaterial color="#9a6435" roughness={0.88} />
          </mesh>
          <mesh position={[0.58, 0.18, 0.12]} castShadow>
            <boxGeometry args={[0.48, 0.36, 0.42]} />
            <meshStandardMaterial color="#b7793f" roughness={0.88} />
          </mesh>
        </group>
      ))}
      {[8, 20, 44, 56, 68].map((x) => (
        <group key={`rack-${x}`} position={[x, 0, -1.45]}>
          {[0.4, 0.9, 1.4].map((y) => (
            <mesh key={y} position={[0, y, 0]}>
              <boxGeometry args={[2.1, 0.06, 0.65]} />
              <meshStandardMaterial color="#cbd5da" metalness={0.55} />
            </mesh>
          ))}
          {[-0.98, 0.98].map((dx) =>
            [-0.28, 0.28].map((z) => (
              <mesh key={`${dx}-${z}`} position={[dx, 0.75, z]}>
                <boxGeometry args={[0.055, 1.5, 0.055]} />
                <meshStandardMaterial color="#aab6bc" metalness={0.65} />
              </mesh>
            )),
          )}
        </group>
      ))}
    </group>
  );
}

// SMT loading view: the physical NPM layout is three back-to-back rows.  Each
// machine has a fixed left and right bank of 17 feeder positions; this is the
// machine map, not an Excel-derived production layout.
function SmtThreeDLayout() {
  const rows = [
    { left: "MACHINE 1", right: "MACHINE 2" },
    { left: "MACHINE 3", right: "MACHINE 4" },
    { left: "MACHINE 5", right: "MACHINE 6" },
  ];
  const positions = [-12, 0, 12];
  const renderMachine = (label: string, x: number, z: number, side: "LEFT" | "RIGHT") => (
    <group key={label} position={[x, 0, z]} rotation={[0, side === "RIGHT" ? Math.PI : 0, 0]}>
      <mesh position={[0, 0.7, 0]} castShadow>
        <boxGeometry args={[5.8, 1.4, 2.45]} />
        <meshStandardMaterial color="#e8eef2" metalness={0.42} roughness={0.3} />
      </mesh>
      <mesh position={[0, 1.55, 0]} castShadow>
        <boxGeometry args={[4.7, 0.22, 1.75]} />
        <meshStandardMaterial color="#34566b" metalness={0.3} roughness={0.42} />
      </mesh>
      <mesh position={[0, 1.68, 0.9]}>
        <boxGeometry args={[2.1, 0.58, 0.05]} />
        <meshStandardMaterial color="#082f49" emissive="#0e7490" emissiveIntensity={0.35} />
      </mesh>
      {Array.from({ length: 17 }, (_, i) => {
        const px = -2.35 + i * (4.7 / 16);
        return (
          <group key={`L-${i}`} position={[px, 0.22, -1.31]}>
            <mesh>
              <boxGeometry args={[0.18, 0.38, 0.14]} />
              <meshStandardMaterial color="#22c55e" emissive="#16a34a" emissiveIntensity={0.25} />
            </mesh>
            <Text position={[0, -0.32, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.105} color="#0f172a" anchorX="center">
              {`L${String(i + 1).padStart(2, "0")}`}
            </Text>
          </group>
        );
      })}
      {Array.from({ length: 17 }, (_, i) => {
        const px = -2.35 + i * (4.7 / 16);
        return (
          <group key={`R-${i}`} position={[px, 0.22, 1.31]}>
            <mesh>
              <boxGeometry args={[0.18, 0.38, 0.14]} />
              <meshStandardMaterial color="#38bdf8" emissive="#0284c7" emissiveIntensity={0.22} />
            </mesh>
            <Text position={[0, -0.32, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.105} color="#0f172a" anchorX="center">
              {`R${String(i + 1).padStart(2, "0")}`}
            </Text>
          </group>
        );
      })}
      <Text position={[0, 2.25, 0]} fontSize={0.32} color="#0f172a" anchorX="center">{label}</Text>
      <Text position={[0, 1.98, 0]} fontSize={0.14} color="#475569" anchorX="center">{side} SIDE · 17 CHANNELS</Text>
    </group>
  );
  return (
    <group>
      <Text position={[0, 0.12, -8.1]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.42} color="#0f172a" anchorX="center">
        SMT NPM MATERIAL LOADING · 3 ROWS / 6 MACHINES
      </Text>
      <Text position={[0, 0.1, 8.1]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.22} color="#334155" anchorX="center">
        BACK-TO-BACK MACHINE PAIRS · LEFT L01–L17 · RIGHT R01–R17
      </Text>
      {rows.map((row, index) => (
        <React.Fragment key={row.left}>
          {renderMachine(row.left, positions[index], -4.2, "LEFT")}
          {renderMachine(row.right, positions[index], 4.2, "RIGHT")}
          <Text position={[positions[index], 0.09, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.18} color="#64748b" anchorX="center">
            {`ROW ${index + 1}`}
          </Text>
        </React.Fragment>
      ))}
      <mesh position={[0, 0.055, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[28, 0.62]} />
        <meshBasicMaterial color="#dc2626" />
      </mesh>
      {[-9, -3, 3, 9].map((x) => (
        <mesh key={x} position={[x, 0.12, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <coneGeometry args={[0.5, 1.45, 3]} />
          <meshBasicMaterial color="#991b1b" />
        </mesh>
      ))}
      <Text position={[0, 0.13, 0.55]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.22} color="#991b1b" anchorX="center">
        PRODUCTION FLOW →
      </Text>
    </group>
  );
}

function MotherboardPanel({
  x,
  station,
  row,
  separated = false,
  onFocus,
}: {
  x: number;
  station: string;
  row?: MesRow;
  separated?: boolean;
  onFocus?: () => void;
}) {
  const slotCount = IS_AUTO_LINE ? 6 : 12;
  const columns = IS_AUTO_LINE ? 3 : 4;
  const rows = Math.ceil(slotCount / columns);
  const alarmLayout = useRef<THREE.Group>(null);
  const hasNg = row?.alarmActive === true;
  useFrame(({ clock }) => {
    if (!alarmLayout.current) return;
    const pulse = hasNg ? 1 + (Math.sin(clock.elapsedTime * 9) + 1) * 0.045 : 1;
    alarmLayout.current.scale.setScalar(pulse);
  });
  const resultColor =
    row?.status === "NG"
      ? "#ef4444"
      : row?.status === "PASS"
        ? "#22c55e"
        : "#334155";
  return (
    <Billboard
      ref={alarmLayout}
      position={[x, MOTHERBOARD_PANEL_Y, 0.98]}
      follow
      onClick={(event) => {
        event.stopPropagation();
        onFocus?.();
      }}
      onPointerOver={() => { document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { document.body.style.cursor = "default"; }}
    >
      {hasNg && <pointLight color="#ef4444" intensity={2.8} distance={4.5} />}
      {hasNg && (
        <Text position={[0, 1.28, 0.12]} fontSize={0.22} color="#ef4444" anchorX="center" anchorY="middle">
          NG ALARM
        </Text>
      )}
      <mesh position={[0, 0, -0.095]} castShadow receiveShadow>
        <boxGeometry args={[2.35, 1.82, 0.12]} />
        <meshStandardMaterial color="#e2e8f0" metalness={0.35} roughness={0.42} />
      </mesh>
      {!separated && (
        <>
          <mesh position={[0, 0, -0.025]} castShadow>
            <boxGeometry args={[2.12, 1.58, 0.06]} />
            <meshStandardMaterial color="#14532d" roughness={0.58} />
          </mesh>
          <mesh position={[0, 0, 0.012]}>
            <boxGeometry args={[1.98, 1.44, 0.018]} />
            <meshStandardMaterial color="#07835f" metalness={0.22} roughness={0.5} />
          </mesh>
        </>
      )}
      {Array.from({ length: slotCount }, (_, index) => {
        const column = index % columns;
        const rowIndex = Math.floor(index / columns);
        const px = (column - (columns - 1) / 2) * (IS_AUTO_LINE ? 0.62 : 0.48);
        const py = (rowIndex - (rows - 1) / 2) * (IS_AUTO_LINE ? 0.62 : 0.48);
        const slot = row?.slots?.[index];
        const slotColor =
          slot?.result === "NG" || slot?.result === "FAIL"
            ? "#ef4444"
            : slot?.result === "PASS"
              ? "#22c55e"
              : slot?.result === "TEST"
                ? "#22d3ee"
                : resultColor;
        return (
          <group
            key={index}
            position={[
              px + (separated ? (column - (columns - 1) / 2) * 0.055 : 0),
              py + (separated ? (rowIndex - (rows - 1) / 2) * 0.07 : 0),
              0.045,
            ]}
          >
            <mesh castShadow>
              <boxGeometry args={[0.42, 0.29, 0.055]} />
              <meshStandardMaterial
                color={slotColor}
                emissive={slotColor}
                emissiveIntensity={slot?.result === "NG" || slot?.result === "FAIL" ? 0.6 : slot?.result === "TEST" ? 1.1 : 0.12}
                roughness={0.42}
              />
            </mesh>
            <mesh position={[0, -0.09, 0.047]}>
              <boxGeometry args={[0.39, 0.095, 0.018]} />
              <meshStandardMaterial color="#f8fafc" roughness={0.62} />
            </mesh>
            <Text
              position={[-0.18, 0.125, 0.064]}
              fontSize={0.045}
              color="#ffffff"
              anchorX="left"
              anchorY="middle"
            >
              {`#${index + 1}`}
            </Text>
            <Text
              position={[0, -0.105, 0.066]}
              fontSize={0.034}
              color="#0f172a"
              anchorX="center"
              anchorY="middle"
              maxWidth={0.4}
              textAlign="center"
            >
              {slot?.sn || "—"}
            </Text>
          </group>
        );
      })}
      <Text
        position={[0, 1.02, 0.08]}
        fontSize={0.16}
        color="#f8fafc"
        anchorX="center"
        anchorY="middle"
      >
        {`${station} · ${row?.sn || "等待母版"}`}
      </Text>
    </Billboard>
  );
}

function AteEightSlotFixture({
  x,
  z = 0,
  station,
  row,
  onFocus,
}: {
  x: number;
  z?: number;
  station: string;
  row?: MesRow;
  onFocus?: () => void;
}) {
  const alarmLayout = useRef<THREE.Group>(null);
  const hasNg = row?.alarmActive === true;
  useFrame(({ clock }) => {
    if (!alarmLayout.current) return;
    const pulse = hasNg ? 1 + (Math.sin(clock.elapsedTime * 9) + 1) * 0.045 : 1;
    alarmLayout.current.scale.setScalar(pulse);
  });
  return (
    <Billboard
      ref={alarmLayout}
      position={[x, 3.75, z + 0.82]}
      follow
      onClick={(event) => {
        event.stopPropagation();
        onFocus?.();
      }}
      onPointerOver={() => { document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { document.body.style.cursor = "default"; }}
    >
      {hasNg && <pointLight color="#ef4444" intensity={2.8} distance={4.5} />}
      {hasNg && (
        <Text position={[0, 0.98, 0.12]} fontSize={0.22} color="#ef4444" anchorX="center" anchorY="middle">
          NG ALARM
        </Text>
      )}
      <mesh position={[0, 0, -0.03]} castShadow>
        <boxGeometry args={[2.25, 1.05, 0.08]} />
        <meshStandardMaterial
          color="#334155"
          metalness={0.45}
          roughness={0.48}
        />
      </mesh>
      {Array.from({ length: 8 }, (_, index) => {
        const slot = row?.slots?.[index];
        const column = index % 4;
        const rowIndex = Math.floor(index / 4);
        const color =
          slot?.result === "NG" || slot?.result === "FAIL"
            ? "#ef4444"
            : slot?.result === "PASS"
              ? "#22c55e"
              : slot?.result === "TEST"
                ? "#22d3ee"
                : "#64748b";
        return (
          <group
            key={index}
            position={[-0.78 + column * 0.52, -0.25 + rowIndex * 0.5, 0.05]}
          >
            <mesh castShadow>
              <boxGeometry args={[0.45, 0.4, 0.08]} />
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={slot?.sn ? 0.25 : 0}
              />
            </mesh>
            <Text
              position={[0, 0.02, 0.055]}
              fontSize={0.043}
              color="#ffffff"
              anchorX="center"
              anchorY="middle"
              maxWidth={0.39}
              lineHeight={0.9}
              textAlign="center"
            >
              {slot?.sn || `SLOT ${index + 1}`}
            </Text>
          </group>
        );
      })}
      <Text
        position={[0, 0.72, 0.08]}
        fontSize={0.16}
        color="#f8fafc"
        anchorX="center"
        anchorY="middle"
      >
        {`${station} · 8 SN`}
      </Text>
    </Billboard>
  );
}

function OuterBoxSnFixture({ x, z = 0, row, onFocus }: { x: number; z?: number; row?: MesRow; onFocus?: () => void }) {
  const alarmLayout = useRef<THREE.Group>(null);
  const products = row?.slots ?? [];
  const hasNg = row?.alarmActive === true;
  useFrame(({ clock }) => {
    if (!alarmLayout.current) return;
    const pulse = hasNg ? 1 + (Math.sin(clock.elapsedTime * 9) + 1) * 0.045 : 1;
    alarmLayout.current.scale.setScalar(pulse);
  });
  const columns = 5;
  const rows = Math.max(1, Math.ceil(products.length / columns));
  const height = Math.max(1.15, rows * 0.27 + 0.48);
  return (
    <Billboard
      ref={alarmLayout}
      position={[x, 3.85, z + 0.82]}
      follow
      onClick={(event) => {
        event.stopPropagation();
        onFocus?.();
      }}
      onPointerOver={() => { document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { document.body.style.cursor = "default"; }}
    >
      {hasNg && <pointLight color="#ef4444" intensity={2.8} distance={4.5} />}
      {hasNg && (
        <Text position={[0, height / 2 + 0.45, 0.12]} fontSize={0.22} color="#ef4444" anchorX="center" anchorY="middle">
          NG ALARM
        </Text>
      )}
      <mesh position={[0, 0, -0.04]} castShadow>
        <boxGeometry args={[2.3, height, 0.1]} />
        <meshStandardMaterial color="#8b5a2b" roughness={0.78} />
      </mesh>
      {products.map((product, index) => {
        const column = index % columns;
        const line = Math.floor(index / columns);
        const color = product.result === "NG" || product.result === "FAIL" ? "#ef4444" : "#22c55e";
        return (
          <group key={`${product.sn}-${index}`} position={[-0.84 + column * 0.42, -height / 2 + 0.27 + line * 0.27, 0.05]}>
            <mesh castShadow>
              <boxGeometry args={[0.36, 0.21, 0.065]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} />
            </mesh>
            <Text position={[0, 0, 0.04]} fontSize={0.055} color="#ffffff" anchorX="center" anchorY="middle" maxWidth={0.32}>
              {index + 1}
            </Text>
          </group>
        );
      })}
      <Text position={[0, height / 2 + 0.18, 0.08]} fontSize={0.15} color="#ffffff" anchorX="center" anchorY="middle">
        {`${row?.sn || "等待箱码"} · ${products.length} SN`}
      </Text>
    </Billboard>
  );
}

function PalletBindingFixture({ x, z = 0, row, onFocus }: { x: number; z?: number; row?: MesRow; onFocus?: () => void }) {
  const cartons = row?.slots ?? [];
  const columns = 4;
  const lines = Math.max(1, Math.ceil(Math.max(cartons.length, 1) / columns));
  const height = Math.max(1.25, lines * 0.3 + 0.62);
  const hasNg = row?.alarmActive === true;
  return (
    <Billboard
      position={[x, 3.95, z + 0.82]}
      follow
      onClick={(event) => { event.stopPropagation(); onFocus?.(); }}
      onPointerOver={() => { document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { document.body.style.cursor = "default"; }}
    >
      <mesh position={[0, 0, -0.05]} castShadow>
        <boxGeometry args={[2.6, height, 0.12]} />
        <meshStandardMaterial color={hasNg ? "#7f1d1d" : "#1e3a5f"} roughness={0.58} metalness={0.22} />
      </mesh>
      <Text position={[0, height / 2 - 0.18, 0.08]} fontSize={0.145} color="#ffffff" anchorX="center" anchorY="middle">
        {`栈板 ${row?.sn || "等待扫码"} · ${cartons.length}/${row?.target ?? cartons.length} 箱`}
      </Text>
      {cartons.map((carton, index) => {
        const column = index % columns;
        const line = Math.floor(index / columns);
        const ng = carton.result === "NG" || carton.result === "FAIL";
        return (
          <group key={`${carton.sn}-${index}`} position={[-0.9 + column * 0.6, height / 2 - 0.48 - line * 0.3, 0.05]}>
            <mesh castShadow>
              <boxGeometry args={[0.53, 0.23, 0.065]} />
              <meshStandardMaterial color={ng ? "#ef4444" : "#22c55e"} emissive={ng ? "#7f1d1d" : "#14532d"} emissiveIntensity={0.35} />
            </mesh>
            <Text position={[0, 0, 0.04]} fontSize={0.05} color="#ffffff" anchorX="center" anchorY="middle" maxWidth={0.49} textAlign="center">
              {carton.sn}
            </Text>
          </group>
        );
      })}
      {!cartons.length && (
        <Text position={[0, -0.12, 0.07]} fontSize={0.14} color="#94a3b8" anchorX="center" anchorY="middle">等待外箱绑定</Text>
      )}
      {hasNg && <Text position={[0, height / 2 + 0.24, 0.1]} fontSize={0.2} color="#ef4444" anchorX="center">NG ALARM</Text>}
    </Billboard>
  );
}

function CabinetBank() {
  return (
    <group position={[44, 0, 1.8]}>
      <Text position={[4.35, 3.35, 0]} fontSize={0.3} color="#15212a" anchorX="center">
        7 AGING CABINETS · manu_agingcab
      </Text>
      {Array.from({ length: 7 }, (_, i) => (
        <group key={i} position={[i * 1.45, 0, 0]}>
          <mesh position={[0, 1.35, 0]} castShadow>
            <boxGeometry args={[1.28, 2.7, 1.35]} />
            <meshStandardMaterial
              color="#e3e8ea"
              metalness={0.28}
              roughness={0.4}
            />
          </mesh>
          <mesh position={[0, 1.4, 0.69]}>
            <boxGeometry args={[0.95, 1.9, 0.035]} />
            <meshStandardMaterial color="#1d2931" metalness={0.5} />
          </mesh>
          {Array.from({ length: 6 }, (_, s) => (
            <mesh key={s} position={[0, 0.62 + s * 0.3, 0.72]}>
              <boxGeometry args={[0.82, 0.04, 0.05]} />
              <meshStandardMaterial
                color="#4ade80"
                emissive="#22c55e"
                emissiveIntensity={0.45}
              />
            </mesh>
          ))}
          <Text
            position={[0, 2.9, 0]}
            fontSize={0.22}
            color="#15212a"
          >{`AGING CAB ${i + 1}`}</Text>
        </group>
      ))}
    </group>
  );
}

function AutoAgingLineModel() {
  const model = useGLTF("/models/auto-aging-line.glb");
  const scene = useMemo(() => model.scene.clone(true), [model.scene]);
  return (
    <group position={[43, 0, 0]} scale={[1.0, 1.0, 1.0]}>
      <primitive object={scene} />
      <Text position={[10, 3.25, 0]} fontSize={0.34} color="#b91c1c" anchorX="center">
        自动线 20米连续老化柜 · auto_agingcab
      </Text>
    </group>
  );
}
useGLTF.preload("/models/auto-aging-line.glb");

function Machine({
  x,
  z,
  label,
  type,
}: {
  x: number;
  z: number;
  label: string;
  type: string;
}) {
  const effectiveZ = IS_AUTO_LINE && z === 0 && x >= AUTO_X[9] ? AUTO_Z[9] : z;
  const head = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!head.current) return;
    const t = clock.elapsedTime;
    if (type === "ultra")
      head.current.position.y = 1.35 + (Math.sin(t * 3) + 1) * 0.22;
    if (type === "depanel") head.current.position.x = Math.sin(t * 2.2) * 0.55;
  });
  const large = ["aoi", "ict", "fct", "depanel"].includes(type);
  return (
    <group position={[x, 0, effectiveZ]}>
      <mesh position={[0, large ? 1.15 : 0.98, 0]} castShadow>
        <boxGeometry
          args={[large ? 2.25 : 1.45, large ? 2.3 : 0.55, large ? 1.7 : 1.0]}
        />
        <meshStandardMaterial
          color={type === "depanel" ? "#395d70" : STEEL}
          metalness={0.35}
          roughness={0.34}
        />
      </mesh>
      {large && (
        <>
          <mesh position={[0, 1.45, 0.87]}>
            <boxGeometry args={[1.4, 0.75, 0.05]} />
            <meshStandardMaterial
              color="#112530"
              emissive="#177b91"
              emissiveIntensity={0.18}
            />
          </mesh>
          <mesh position={[0.65, 1.82, 0.92]}>
            <boxGeometry args={[0.42, 0.3, 0.04]} />
            <meshStandardMaterial
              color="#083344"
              emissive="#22d3ee"
              emissiveIntensity={0.6}
            />
          </mesh>
        </>
      )}
      <group ref={head} position={[0, 1.55, 0.18]}>
        {type === "ultra" && (
          <>
            <mesh>
              <cylinderGeometry args={[0.15, 0.21, 0.52, 18]} />
              <meshStandardMaterial color="#cbd5e1" metalness={0.72} />
            </mesh>
            <mesh position={[0, -0.32, 0]}>
              <cylinderGeometry args={[0.08, 0.08, 0.16, 16]} />
              <meshStandardMaterial color="#fbbf24" />
            </mesh>
          </>
        )}
        {type === "depanel" && (
          <mesh>
            <boxGeometry args={[0.44, 0.2, 0.38]} />
            <meshStandardMaterial color="#f59e0b" metalness={0.7} />
          </mesh>
        )}
      </group>
      <mesh position={[0, 0.04, 0]}>
        <boxGeometry args={[large ? 2.55 : 1.75, 0.08, large ? 2 : 1.25]} />
        <meshStandardMaterial color="#26323a" />
      </mesh>
      <Text
        position={[0, large ? 2.55 : 1.55, 0]}
        fontSize={0.27}
        color="#17212a"
        anchorX="center"
      >
        {label}
      </Text>
    </group>
  );
}

function CameraMove({
  target,
  requestId,
}: {
  target: readonly number[];
  requestId: number;
}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as any;
  const moving = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    // Do not seize the camera on the first render.  The operator must be
    // able to control the scene immediately after the canvas appears.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    window.dispatchEvent(new Event("manual-line-cancel-overview"));
    moving.current = true;
  }, [requestId]);
  useEffect(() => {
    const stopPresetMove = () => {
      moving.current = false;
    };
    window.addEventListener("manual-line-go-overview", stopPresetMove);
    window.addEventListener("manual-line-user-camera", stopPresetMove);
    return () => {
      window.removeEventListener("manual-line-go-overview", stopPresetMove);
      window.removeEventListener("manual-line-user-camera", stopPresetMove);
    };
  }, []);
  useFrame((_, delta) => {
    if (!moving.current || !controls) return;
    const focus = new THREE.Vector3(target[0], target[1], target[2]);
    const overview = target[0] === 36;
    const layoutCloseup = target[3] === 1;
    const desired = focus
      .clone()
      .add(
        layoutCloseup
          ? new THREE.Vector3(0, 0.35, 3.25)
          : overview
          ? new THREE.Vector3(0, 14, 25)
          : new THREE.Vector3(0, 5.2, 8.5),
      );
    const factor = 1 - Math.exp(-4.2 * delta);
    camera.position.lerp(desired, factor);
    controls.target.lerp(focus, factor);
    controls.update();
    if (
      camera.position.distanceTo(desired) < 0.05 &&
      controls.target.distanceTo(focus) < 0.03
    )
      moving.current = false;
  });
  return null;
}

// Persists the operator-selected overview camera across station focus changes.
function CameraOverviewBookmark() {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as any;
  const sliding = useRef(false);
  const destinationPosition = useRef(new THREE.Vector3());
  const destinationTarget = useRef(new THREE.Vector3());
  useEffect(() => {
    const exposeSaved = () => {
      const saved = window.localStorage.getItem("manual-line-overview-camera");
      if (saved)
        document.documentElement.setAttribute(
          "data-manual-line-overview-camera",
          saved,
        );
    };
    const save = () => {
      if (!controls) return;
      window.localStorage.setItem(
        "manual-line-overview-camera",
        JSON.stringify({
          position: camera.position.toArray(),
          target: controls.target.toArray(),
        }),
      );
      exposeSaved();
    };
    const restore = () => {
      if (!controls) return;
      try {
        const saved = JSON.parse(
          window.localStorage.getItem("manual-line-overview-camera") || "null",
        );
        if (saved?.position?.length === 3 && saved?.target?.length === 3) {
          destinationPosition.current.fromArray(saved.position);
          destinationTarget.current.fromArray(saved.target);
          controls.enabled = false;
          sliding.current = true;
        }
      } catch {}
    };
    const cancel = () => {
      sliding.current = false;
      if (controls) controls.enabled = true;
    };
    const userCamera = () => cancel();
    window.addEventListener("manual-line-save-overview", save);
    window.addEventListener("manual-line-go-overview", restore);
    window.addEventListener("manual-line-cancel-overview", cancel);
    window.addEventListener("manual-line-user-camera", userCamera);
    exposeSaved(); // Make the saved bookmark inspectable without touching 3D state.
    return () => {
      if (controls) controls.enabled = true;
      window.removeEventListener("manual-line-save-overview", save);
      window.removeEventListener("manual-line-go-overview", restore);
      window.removeEventListener("manual-line-cancel-overview", cancel);
      window.removeEventListener("manual-line-user-camera", userCamera);
    };
  }, [camera, controls]);
  useFrame((_, delta) => {
    if (!sliding.current || !controls) return;
    const factor = 1 - Math.exp(-2.25 * delta);
    camera.position.lerp(destinationPosition.current, factor);
    controls.target.lerp(destinationTarget.current, factor);
    controls.update();
    if (
      camera.position.distanceTo(destinationPosition.current) < 0.025 &&
      controls.target.distanceTo(destinationTarget.current) < 0.02
    ) {
      camera.position.copy(destinationPosition.current);
      controls.target.copy(destinationTarget.current);
      controls.update();
      sliding.current = false;
      controls.enabled = true;
    }
  });
  return null;
}

function NgIsolationBox({ code, count }: { code: string; count: number }) {
  const stationPosition = SCREEN_POSITIONS[code] || [0, 0, 0];
  const active = count > 0;
  // Keep manual-line NG boxes in their own front lane so they never intersect
  // the carton staging boxes placed along the conveyor.
  const isolationZ = IS_AUTO_LINE ? stationPosition[2] + 0.33 : 2.45;
  return (
    <group position={[stationPosition[0] + 1.65, 0, isolationZ]}>
      <mesh position={[0, 0.38, 0]} castShadow>
        <boxGeometry args={[0.72, 0.76, 0.58]} />
        <meshStandardMaterial
          color={active ? "#dc2626" : "#991b1b"}
          roughness={0.62}
          emissive={active ? "#7f1d1d" : "#000000"}
          emissiveIntensity={active ? 0.32 : 0}
        />
      </mesh>
      <mesh position={[0, 0.79, 0]}>
        <boxGeometry args={[0.76, 0.08, 0.62]} />
        <meshStandardMaterial color="#7f1d1d" roughness={0.55} />
      </mesh>
      <Text
        position={[0, 0.5, 0.296]}
        fontSize={0.2}
        color="#ffffff"
        anchorX="center"
        anchorY="middle"
      >
        NG {count}
      </Text>
      <Text
        position={[0, 0.22, 0.296]}
        fontSize={0.11}
        color="#fee2e2"
        anchorX="center"
        anchorY="middle"
      >
        隔离箱
      </Text>
    </group>
  );
}

function OperatorChatBubble({
  code,
  name,
  row,
  onOpen,
}: {
  code: string;
  name: string;
  row?: MesRow;
  onOpen: (code: string, name: string) => void;
}) {
  const stationPosition = SCREEN_POSITIONS[code] || [0, 0, 0];
  const message =
    row?.status === "NG"
      ? "当前 SN 为 NG，请隔离"
      : row?.status === "PASS"
        ? "当前 SN 测试通过"
        : row?.sn
          ? `正在处理 ${row.sn}`
          : row?.online
            ? "等待扫码"
            : "工站离线";
  const accent =
    row?.status === "NG"
      ? "#dc2626"
      : row?.status === "PASS"
        ? "#16a34a"
        : row?.online
          ? "#0891b2"
          : "#64748b";
  return (
    <group
      position={[stationPosition[0], 1.78, stationPosition[2] + 0.78]}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(code, name);
      }}
      onPointerOver={() => {
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "default";
      }}
    >
      <mesh castShadow>
        <planeGeometry args={[2.3, 1.02]} />
        <meshBasicMaterial color="#ffffff" side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[-1.055, 0, 0.006]}>
        <planeGeometry args={[0.08, 1.02]} />
        <meshBasicMaterial color={accent} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, -0.6, 0]} rotation={[0, 0, Math.PI / 4]}>
        <planeGeometry args={[0.28, 0.28]} />
        <meshBasicMaterial color="#ffffff" side={THREE.DoubleSide} />
      </mesh>
      <Text
        position={[-0.88, 0.3, 0.012]}
        fontSize={0.16}
        color="#173042"
        anchorX="left"
        anchorY="middle"
        maxWidth={1.7}
      >
        {name}
      </Text>
      <Text
        position={[-0.88, 0, 0.012]}
        fontSize={0.145}
        color="#0f172a"
        anchorX="left"
        anchorY="middle"
        maxWidth={1.85}
      >
        {`SN: ${row?.sn || "—"}`}
      </Text>
      <Text
        position={[-0.88, -0.3, 0.012]}
        fontSize={0.12}
        color={row?.status === "NG" ? "#b91c1c" : "#475569"}
        anchorX="left"
        anchorY="middle"
        maxWidth={1.7}
      >
        {message}
      </Text>
    </group>
  );
}

// A high-visibility KPI placard for every manual-line station.  The monitor
// screens contain the same detail, but this placard keeps the station's
// current production counters readable in the line overview camera.
function ManualStationKpiBadge({
  code,
  name,
  row,
}: {
  code: string;
  name: string;
  row?: MesRow;
}) {
  const position = SCREEN_POSITIONS[code] || [0, 2.4, 0.8];
  const pass = row?.pass ?? 0;
  const ng = row?.ng ?? 0;
  const dup = row?.dup ?? 0;
  const output = pass + ng;
  const yieldRate = output > 0 ? Math.round((pass / output) * 100) : null;
  const online = Boolean(row?.online);
  const status = row?.status === "NG" ? "NG" : row?.status === "PASS" ? "PASS" : online ? "READY" : "OFFLINE";
  const accent = status === "NG" ? "#ef4444" : status === "PASS" ? "#22c55e" : online ? "#06b6d4" : "#64748b";
  return (
    <group position={[position[0], 6.05, position[2] + 1.05]}>
      <Html transform sprite distanceFactor={3.4} style={{ pointerEvents: "none" }}>
        <div
          className="manual-line-station-kpi"
          style={{
            minWidth: 204,
            padding: "7px 10px",
            borderRadius: 7,
            border: `2px solid ${accent}`,
            background: "rgba(3, 15, 24, 0.94)",
            color: "#f8fafc",
            fontFamily: "system-ui, sans-serif",
            boxShadow: `0 4px 14px rgba(0,0,0,.28), 0 0 10px ${accent}55`,
            lineHeight: 1.2,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11, fontWeight: 900 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
            <span style={{ color: accent }}>{status}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 11, fontFamily: "Consolas, monospace", fontWeight: 800 }}>
            <span style={{ color: "#86efac" }}>PASS {pass}</span>
            <span style={{ color: "#fca5a5" }}>NG {ng}</span>
            <span style={{ color: "#fde68a" }}>DUP {dup}</span>
            <span style={{ color: "#bae6fd" }}>Y {yieldRate == null ? "--" : `${yieldRate}%`}</span>
          </div>
          <div style={{ marginTop: 3, color: "#bae6fd", fontSize: 9, fontWeight: 800, letterSpacing: ".02em" }}>
            OUT {output} · {row?.dataSource === "MES" ? "MES LIVE" : "WAITING SYNC"}
          </div>
        </div>
      </Html>
    </group>
  );
}

function SnFlowMarker({
  code,
  sn,
  status,
}: {
  code: string;
  sn: string;
  status: string;
}) {
  const position = SCREEN_POSITIONS[code] || [0, 0, 0];
  const color =
    status === "NG" ? "#ef4444" : status === "PASS" ? "#22c55e" : "#f59e0b";
  const marker = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (marker.current)
      marker.current.position.y = 2.95 + Math.sin(clock.elapsedTime * 4) * 0.12;
  });
  return (
    <group ref={marker} position={[position[0], 2.95, 1.15]}>
      <mesh>
        <sphereGeometry args={[0.18, 20, 14]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.85}
        />
      </mesh>
      <pointLight color={color} intensity={1.2} distance={2.8} />
      <Text
        position={[0, 0.38, 0]}
        fontSize={0.2}
        color={color}
        anchorX="center"
        anchorY="middle"
      >
        {sn}
      </Text>
    </group>
  );
}

function AutoDownstreamConveyor() {
  const startX = 43.5;
  const endX = 68.5;
  const length = endX - startX;
  const centerX = (startX + endX) / 2;
  const z = -5.85;
  const rollers = Array.from({ length: 50 }, (_, index) => startX + 0.25 + index * 0.5);

  return (
    <group>
      <mesh position={[centerX, 0.48, z]} castShadow receiveShadow>
        <boxGeometry args={[length, 0.18, 1.05]} />
        <meshStandardMaterial color="#374151" metalness={0.55} roughness={0.42} />
      </mesh>
      {rollers.map((x) => (
        <mesh key={x} position={[x, 0.59, z]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.055, 0.055, 0.9, 12]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.8} roughness={0.25} />
        </mesh>
      ))}
      {[startX, endX].map((x) => (
        <mesh key={x} position={[x, 0.48, z]} castShadow>
          <boxGeometry args={[0.12, 0.42, 1.18]} />
          <meshStandardMaterial color="#f59e0b" metalness={0.35} roughness={0.5} />
        </mesh>
      ))}
      {Array.from({ length: 9 }, (_, index) => startX + 1.2 + index * 2.8).map((x) => (
        <group key={x}>
          <mesh position={[x, 0.22, z - 0.42]} castShadow>
            <boxGeometry args={[0.1, 0.44, 0.1]} />
            <meshStandardMaterial color="#475569" metalness={0.55} roughness={0.45} />
          </mesh>
          <mesh position={[x, 0.22, z + 0.42]} castShadow>
            <boxGeometry args={[0.1, 0.44, 0.1]} />
            <meshStandardMaterial color="#475569" metalness={0.55} roughness={0.45} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function LineStatusBillboard({ mes, locale, started }: { mes: Record<string, MesRow>; locale: LineLocale; started: boolean }) {
  return (
    <Html position={[36, 7.2, 2.2]} center distanceFactor={12} transform sprite>
      <LineStatusPanel mes={mes} locale={locale} started={started} />
    </Html>
  );
}

function LineStatusPanel({ mes, locale, started }: { mes: Record<string, MesRow>; locale: LineLocale; started: boolean }) {
  const row = mes.pda_load;
  const bound = row?.boundMaterialCount ?? 0;
  const total = row?.materialCount ?? 0;
  const jammedStations = MES_STATIONS.filter(([code]) => {
    const station = mes[code];
    const count = station?.wipCount ?? station?.slots?.length ?? 0;
    return station?.jammed ?? count > (station?.wipCapacity ?? 1);
  });
  const stationSpeeds = MES_STATIONS.map(([code]) => mes[code]?.speedPerMinute).filter((value): value is number => typeof value === "number" && value > 0);
  const currentNgTotal = MES_STATIONS.reduce((sum, [code]) => sum + (mes[code]?.currentNgCount ?? 0), 0);
  const repairRow = mes.manu_rework;
  const lineSpeed = stationSpeeds.length ? stationSpeeds.reduce((sum, value) => sum + value, 0) / stationSpeeds.length : null;
  const nextFeedMinutes = row?.materialNextLoadAt
    ? Math.max(0, Math.ceil((row.materialNextLoadAt - Date.now()) / 60_000))
    : null;
  const nextFeedLabel = nextFeedMinutes == null ? "--" : nextFeedMinutes <= 0 ? "DUE NOW" : `${nextFeedMinutes} MIN`;
  const syncRows = MES_STATIONS.map(([code]) => mes[code]).filter(Boolean);
  const degradedCount = syncRows.filter((item) => item?.syncState === "DEGRADED").length;
  const unavailableCount = syncRows.filter((item) => item?.syncState === "UNAVAILABLE").length;
  return (
    <div className="manual-line-status-panel" style={{ width: 300, padding: "10px 12px", borderRadius: 12, background: "rgba(8,31,53,.94)", color: "#e8f3ff", border: "2px solid #38bdf8", boxShadow: "0 8px 24px rgba(0,0,0,.3)", fontFamily: "Arial" }}>
        <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: .6 }}>MANUAL LINE · LINE STATUS</div>
        <div style={{ marginTop: 6, fontSize: 12, color: "#7dd3fc" }}>{row?.workOrderCode || (USE_CODEX_MOCK ? "CODEX-MOCK-MANUAL-LOADING" : "NO MES WORK ORDER")} · L004</div>
        <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 12 }}>
          <span>MES: <b style={{ color: degradedCount || unavailableCount ? "#fbbf24" : "#86efac" }}>{degradedCount || unavailableCount ? `${degradedCount} ERR / ${unavailableCount} OFF` : "ONLINE"}</b></span>
          <span>WO: <b>{row?.workOrderStatus || row?.status || (USE_CODEX_MOCK ? "MOCK_RELEASED" : "NO DATA")}</b></span>
          <span>Source: <b>{row?.dataSource || "MES"}</b></span>
          <span>Sync: <b>{row?.lastSyncAt ? new Date(row.lastSyncAt).toLocaleTimeString("en-GB", { hour12: false }) : "--:--:--"}</b></span>
          <span>Materials: <b>{bound}/{total}</b></span>
          <span>Speed: <b style={{ color: "#fbbf24" }}>1 / 3 sec</b></span>
          <span>Line speed: <b style={{ color: "#67e8f9" }}>{lineSpeed == null ? "--" : `${lineSpeed.toFixed(2)} PCS/MIN`}</b></span>
          <span>Next feed: <b style={{ color: row?.materialStarvationRisk ? "#f87171" : "#fbbf24" }}>{nextFeedLabel}</b></span>
          <span>Material: <b>{row?.activeMaterialCode || "--"}</b></span>
          <span>Consume: <b>{row?.materialConsumptionRatePerMinute ? `${row.materialConsumptionRatePerMinute.toFixed(3)} / MIN` : "--"}</b></span>
          <span>WIP: <b style={{ color: jammedStations.length ? "#f87171" : "#86efac" }}>{jammedStations.length ? `${jammedStations.length} JAMMED` : "NORMAL"}</b></span>
           <span>MES gate: <b style={{ color: jammedStations.length ? "#f87171" : "#86efac" }}>{jammedStations.length ? "BLOCK UPSTREAM" : "RELEASE"}</b></span>
           <span>NG now: <b style={{ color: currentNgTotal ? "#f87171" : "#86efac" }}>{currentNgTotal}</b></span>
           <span>Repair WOs: <b style={{ color: "#fbbf24" }}>{repairRow?.repairOpenCount ?? 0} open / {repairRow?.repairFinishedCount ?? 0} finished</b></span>
         </div>
         {(degradedCount > 0 || unavailableCount > 0) && <div style={{ marginTop: 7, padding: "6px 8px", borderRadius: 6, background: "#402e0c", color: "#fde68a", fontSize: 10, fontWeight: 800 }}>
           DATA CHECK: {degradedCount} station source errors · {unavailableCount} station sources unavailable
         </div>}
         <div style={{ marginTop: 7, padding: "6px 8px", borderRadius: 6, background: "#172554", fontSize: 10, lineHeight: 1.5 }}>
           <b>NG BY STATION</b><br />
           {MES_STATIONS.map(([code]) => `${code.replace(/^(manu|auto)_/, "")}: ${mes[code]?.currentNgCount ?? 0}`).join(" · ")}
         </div>
        {jammedStations.length > 0 && <div style={{ marginTop: 7, padding: "6px 8px", borderRadius: 6, background: "#7f1d1d", color: "#fee2e2", fontSize: 11, fontWeight: 800 }}>JAMMED STATIONS: {jammedStations.map(([code]) => code).join(", ")}</div>}
        {row?.materialStarvationRisk && <div style={{ marginTop: 7, padding: "6px 8px", borderRadius: 6, background: "#7f1d1d", color: "#fee2e2", fontSize: 11, fontWeight: 800 }}>MATERIAL STARVATION RISK · REQUEST FEEDING</div>}
        <div style={{ marginTop: 8, height: 8, borderRadius: 8, background: "#334155", overflow: "hidden" }}><div style={{ width: `${total ? Math.round((bound / total) * 100) : 0}%`, height: "100%", background: "#22c55e", transition: "width .3s" }} /></div>
        <button type="button" onClick={() => window.dispatchEvent(new Event("manual-line-mock-start"))} style={{ marginTop: 9, width: "100%", padding: "7px 10px", border: 0, borderRadius: 7, background: started ? "#166534" : "#f59e0b", color: "#fff", fontWeight: 800, cursor: "pointer" }}>{started ? "● LOADING RUNNING" : "▶ START MOCK LOADING"}</button>
        <div style={{ marginTop: 5, fontSize: 10, color: "#cbd5e1" }}>{locale === "zh-CN" ? "模拟物料消耗，仅用于验证" : locale === "vi-VN" ? "Mô phỏng tiêu hao vật tư (kiểm thử)" : "Mock material consumption (test only)"}</div>
    </div>
  );
}

function Hall({
  mes,
  locale,
  onOpenChat,
  onFocusLayout,
  activeFlow,
  mockLoadingStarted,
}: {
  mes: Record<string, MesRow>;
  locale: LineLocale;
  onOpenChat: (code: string, name: string) => void;
  onFocusLayout: (x: number, y: number, z: number) => void;
  activeFlow: { code: string; sn: string; status: string } | null;
  mockLoadingStarted: boolean;
}) {
  return (
    <>
      <color attach="background" args={["#b8c9d4"]} />
      <ambientLight intensity={1.15} />
      <directionalLight position={[8, 18, 10]} intensity={2} castShadow />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[IS_AUTO_LINE ? 38 : 0, 0, IS_AUTO_LINE ? -2.5 : 0]}
        receiveShadow
      >
        <planeGeometry args={[IS_AUTO_LINE ? 94 : 34, IS_AUTO_LINE ? 38 : 20]} />
        <meshStandardMaterial color="#7194aa" roughness={0.92} />
      </mesh>
      <mesh position={[36, 0.012, 3.15]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[78, 3.8]} />
        <meshStandardMaterial color="#83939c" />
      </mesh>
      {[-1.9, 1.9].map((v) => (
        <mesh
          key={v}
          position={[36, 0.025, 3.15 + v]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[78, 0.1]} />
          <meshStandardMaterial color="#facc15" />
        </mesh>
      ))}
      {(IS_AUTO_LINE
        ? [0, 1, 2, 3, 4, 5, 6, 7].map((index) => ({ x: stationX(index), z: stationZ(index) }))
        : [4, 11, 18, 25, 32, 39, 46, 53, 60, 67].map((x) => ({ x, z: 0 })))
        .map(({ x, z }, index) => <Bench key={`${x}-${z}-${index}`} x={x} z={z} />)}
      {IS_AUTO_LINE && <AutoDownstreamConveyor />}
      {VISIBLE_3D_SCREEN_STATIONS.map(([code, name]) => (
        <CanvasStationScreen
          key={`screen-${code}`}
          code={code}
          name={localizedStationName(code, locale) || name}
          row={mes[code]}
          onSelect={onOpenChat}
        />
      ))}
      {VISIBLE_3D_SCREEN_STATIONS.map(([code, name]) => (
        <ManualStationKpiBadge
          key={`kpi-${code}`}
          code={code}
          name={localizedStationName(code, locale) || name}
          row={mes[code]}
        />
      ))}
      {!IS_AUTO_LINE && <ManualLineDetails />}
      {IS_AUTO_LINE && <AutoNgRoutingRoutes />}
      {!IS_AUTO_LINE && <NgRoutingStationRoutes />}
      {!IS_AUTO_LINE && <DesignatedRepairReturnRoutes />}
      <RepairStationModel
        row={mes.manu_rework}
        position={REPAIR_STATION_POSITION}
        onSelect={() => onOpenChat("manu_rework", localizedStationName("manu_rework", locale))}
      />
      <CanvasStationScreen
        code="manu_rework"
        name={localizedStationName("manu_rework", locale)}
        row={mes.manu_rework}
        onSelect={onOpenChat}
      />
      <MotherboardPanel x={stationX(2)} station={localizedStationName(lineCode("ict"), locale)} row={mes[lineCode("ict")]} onFocus={() => onFocusLayout(stationX(2), MOTHERBOARD_PANEL_Y, 0.98)} />
      <MotherboardPanel x={stationX(3)} station={localizedStationName(lineCode("fct"), locale)} row={mes[lineCode("fct")]} onFocus={() => onFocusLayout(stationX(3), MOTHERBOARD_PANEL_Y, 0.98)} />
      <MotherboardPanel
        x={stationX(4)}
        station={localizedStationName(lineCode("depanel"), locale)}
        row={mes[lineCode("depanel")]}
        separated={mes[lineCode("depanel")]?.status === "PASS"}
        onFocus={() => onFocusLayout(23, MOTHERBOARD_PANEL_Y, 0.98)}
      />
      <AteEightSlotFixture x={stationX(6)} station={localizedStationName(lineCode("assem_ate"), locale)} row={mes[lineCode("assem_ate")]} onFocus={() => onFocusLayout(stationX(6), 3.75, 0.82)} />
      <AteEightSlotFixture
        x={stationX(9)}
        z={stationZ(9)}
        station={localizedStationName(lineCode("hivolt_ate"), locale)}
        row={mes[lineCode("hivolt_ate")]}
        onFocus={() => onFocusLayout(55, 3.75, 0.82)}
      />
      <AteEightSlotFixture
        x={stationX(10)}
        z={stationZ(10)}
        station={localizedStationName(lineCode("package_ate"), locale)}
        row={mes[lineCode("package_ate")]}
        onFocus={() => onFocusLayout(61, 3.75, 0.82)}
      />
      {IS_AUTO_LINE && <AteEightSlotFixture x={57} z={-8.45} station="Packaging ATE Right" row={mes.auto_package_ate} onFocus={() => onFocusLayout(57, 3.75, -7.63)} />}
      <OuterBoxSnFixture x={stationX(11)} z={stationZ(11)} row={mes[IS_AUTO_LINE ? "auto_case_binding" : "manu_outer_box_binding"]} onFocus={() => onFocusLayout(stationX(11), 3.85, stationZ(11) + 0.82)} />
      <PalletBindingFixture x={stationX(12)} z={stationZ(12)} row={mes[lineCode("pallet_binding")]} onFocus={() => onFocusLayout(stationX(12), 3.95, stationZ(12) + 0.82)} />
      <Machine x={0} z={0} label="PDA 扫码上料" type="bench" />
      <Machine x={5} z={0} label="AOI 质量检测" type="aoi" />
      <Machine x={11} z={0} label="ICT" type="ict" />
      <Machine x={17} z={0} label="FCT" type="fct" />
      <Machine x={23} z={0} label="PCBA 分板" type="depanel" />
      <Machine x={28} z={0} label="外壳绑码" type="bench" />
      <Machine x={34} z={0} label="组装 ATE" type="bench" />
      <Machine x={40} z={0} label="超声波" type="ultra" />
      <Machine x={stationX(9)} z={0} label="高压 ATE" type="bench" />
      <Machine x={stationX(10)} z={0} label="包装 ATE" type="bench" />
      <Machine x={stationX(11)} z={0} label="外箱绑码" type="bench" />
      <Machine x={stationX(12)} z={0} label="栈板绑码" type="bench" />
      {IS_AUTO_LINE && <Machine x={57} z={-8.45} label="Packaging ATE Right" type="bench" />}
      {IS_AUTO_LINE ? <AutoAgingLineModel /> : <CabinetBank />}
      {activeFlow && <SnFlowMarker {...activeFlow} />}
      {MES_STATIONS.map(([code]) => (
        <NgIsolationBox
          key={`ng-${code}`}
          code={code}
          count={mes[code]?.ng || 0}
        />
      ))}
      {MES_STATIONS.map(([code]) => (
        <OperatorChatBubble
          key={`chat-${code}`}
          code={code}
          name={localizedStationName(code, locale)}
          row={mes[code]}
          onOpen={onOpenChat}
        />
      ))}
      <Text
        position={[36, 5.9, -2.7]}
        fontSize={0.65}
        color="#173042"
        anchorX="center"
      >
        瑞晶越南工厂 · 直线式手动生产线
      </Text>
    </>
  );
}

function App() {
  const [manualWorkOrders, setManualWorkOrders] = useState<ManualLineWorkOrder[]>(USE_CODEX_MOCK ? [CODEX_MOCK_MANUAL_WO] : []);
  const [mockLoadingStarted, setMockLoadingStarted] = useState(false);
  const mesData = useManualLineMesData();
  const mes = useMemo(() => {
    const next = { ...mesData };
    const current = manualWorkOrders[0];
    if (current) {
      next.pda_load = {
        ...(next.pda_load || { online: true, sn: "", pass: 0, ng: 0, dup: 0, time: Date.now() }),
        workOrderCode: current.workOrderCode,
        workOrderStatus: current.status,
        materialCount: current.materialCount ?? current.materials?.length ?? 0,
        boundMaterialCount: current.boundMaterialCount ?? 0,
        materialLoadingStatus: current.materialLoadingStatus,
        activeMaterialCode: current.materials?.find((material) => !material.bound)?.materialCode,
        materialAvailableQty: current.materials?.find((material) => !material.bound)?.availableQty,
        materialConsumptionRatePerMinute: current.materials?.find((material) => !material.bound)?.consumptionRatePerMinute
          ?? current.materials?.find((material) => !material.bound)?.actualConsumptionRatePerMinute,
        materialNextLoadAt: (() => {
          const material = current.materials?.find((item) => !item.bound);
          if (!material) return undefined;
          if (material.estimatedDepletionAt) return Date.parse(material.estimatedDepletionAt) || undefined;
          const rate = Number(material.consumptionRatePerMinute ?? material.actualConsumptionRatePerMinute ?? 0);
          const available = Number(material.availableQty ?? 0);
          const safety = Number(material.safetyStockQty ?? 0);
          return rate > 0 ? Date.now() + Math.max(available - safety, 0) / rate * 60_000 : undefined;
        })(),
        materialStarvationRisk: (() => {
          const material = current.materials?.find((item) => !item.bound);
          if (!material) return false;
          return Number(material.availableQty ?? 0) <= Number(material.safetyStockQty ?? 0);
        })(),
        dataSource: USE_CODEX_MOCK ? "MOCK" : "MES",
        lastSyncAt: Date.now(),
      };
    }
    return next;
  }, [manualWorkOrders, mesData]);
  const onlineStationCount = MES_STATIONS.filter(([code]) => Boolean(mes[code]?.online)).length;
  const mesSnapshotCount = MES_STATIONS.filter(([code]) => mesData[code]?.dataSource === "MES").length;
  const latestMesSyncAt = Math.max(0, ...Object.values(mesData).map((row) => Number(row.lastSyncAt || 0)));
  const mesSyncState = USE_CODEX_MOCK
    ? "MOCK DEMO"
    : mesSnapshotCount === MES_STATIONS.length
      ? "MES LIVE"
      : mesSnapshotCount > 0
        ? "MES PARTIAL"
        : "MES WAITING";
  const lineKpi = useMemo(() => {
    const rows = MES_STATIONS.map(([code]) => mes[code]).filter(Boolean);
    const pass = rows.reduce((total, row) => total + Number(row?.pass ?? 0), 0);
    const ng = rows.reduce((total, row) => total + Number(row?.ng ?? 0), 0);
    const duplicate = rows.reduce((total, row) => total + Number(row?.dup ?? 0), 0);
    const activeSn = rows.filter((row) => Boolean(row?.sn && row.sn !== "—")).length;
    const currentWo = manualWorkOrders[0];
    return {
      pass,
      ng,
      duplicate,
      activeSn,
      currentWo: currentWo?.workOrderCode || "—",
      plannedQty: Number(currentWo?.plannedQty ?? 0),
    };
  }, [manualWorkOrders, mes]);
  const [locale, setLocale] = useState<LineLocale>(() => {
    const saved = window.localStorage.getItem("factory-3d-locale");
    return saved === "en-US" || saved === "vi-VN" ? saved : "zh-CN";
  });
  useEffect(() => {
    window.localStorage.setItem("factory-3d-locale", locale);
    document.documentElement.lang = locale;
  }, [locale]);
  const [cameraTarget, setCameraTarget] = useState<readonly number[]>(
    CAMERA_STATIONS[0][1],
  );
  const [cameraRequest, setCameraRequest] = useState(0);
  const [showUi, setShowUi] = useState(true);
  const [statusPanelOpen, setStatusPanelOpen] = useState(true);
  const [showAllNgTrace, setShowAllNgTrace] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(
    Boolean(document.fullscreenElement),
  );
  const [chatStation, setChatStation] = useState<{
    code: string;
    name: string;
  } | null>(null);
  const [selectedRepairWorkOrder, setSelectedRepairWorkOrder] = useState<RepairWorkOrder | null>(null);
  const [memoryQuery, setMemoryQuery] = useState("");
  const [memoryResults, setMemoryResults] = useState<
    Array<Record<string, unknown>>
  >([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryError, setMemoryError] = useState("");
  const [ngHistory, setNgHistory] = useState<Array<Record<string, unknown>>>([]);
  const [ngHistoryLoading, setNgHistoryLoading] = useState(false);
  const [ngRangeStart, setNgRangeStart] = useState(() => toDateTimeLocal(new Date(Date.now() - 24 * 60 * 60 * 1000)));
  const [ngRangeEnd, setNgRangeEnd] = useState(() => toDateTimeLocal(new Date()));
  const [ngRangeIsDefault, setNgRangeIsDefault] = useState(true);
  const [ngHistoryFallback, setNgHistoryFallback] = useState(false);
  const [ngTraceRefresh, setNgTraceRefresh] = useState(0);
  const [motherboardQuery, setMotherboardQuery] = useState("");
  const [motherboardResult, setMotherboardResult] = useState<Record<string, unknown> | null>(null);
  const [motherboardError, setMotherboardError] = useState("");
  const [motherboardLoading, setMotherboardLoading] = useState(false);
  const [motherboardHistory, setMotherboardHistory] = useState<Array<Record<string, unknown>>>([]);
  const [motherboardHistoryLoading, setMotherboardHistoryLoading] = useState(false);
  const [motherboardHistoryFallback, setMotherboardHistoryFallback] = useState(false);
  const [stationPanelTab, setStationPanelTab] = useState<
    "live" | "trace" | "motherboard" | "alarms" | "memory"
  >("live");
  const [simulationStation, setSimulationStation] = useState(
    MES_STATIONS[0][0] as string,
  );
  const [simulationSequence, setSimulationSequence] = useState(1);
  const [processSimulationRunning, setProcessSimulationRunning] =
    useState(false);
  const [ngAlarm, setNgAlarm] = useState<{
    code: string;
    sn: string;
  } | null>(null);
  const [alarmProcesses, setAlarmProcesses] = useState<
    Array<{
      id: string;
      code: string;
      sn: string;
      detectedAt: number;
      completedAt?: number;
      durationMs?: number;
      status: "ALARMING" | "ACKNOWLEDGED" | "REMOVED";
    }>
  >([]);
  const [alarmClock, setAlarmClock] = useState(Date.now());
  const [activeFlow, setActiveFlow] = useState<{
    code: string;
    sn: string;
    status: string;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const loadWorkOrders = async () => {
      if (USE_CODEX_MOCK) {
        setManualWorkOrders([CODEX_MOCK_MANUAL_WO]);
        return;
      }
      try {
        const response = await fetch(
          "/api/smt/loading/work-orders?lineCode=L004&lineType=MANUAL&pdaId=MANUAL-LINE-3D",
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        if (!cancelled) {
          const rows = Array.isArray(body.data) ? body.data : [];
          setManualWorkOrders(rows);
        }
      } catch {
        if (!cancelled) setManualWorkOrders([]);
      }
    };
    void loadWorkOrders();
    const timer = window.setInterval(loadWorkOrders, 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (!USE_CODEX_MOCK || !mockLoadingStarted) return;
    const timer = window.setInterval(() => {
      setManualWorkOrders((current) => current.map((wo) => {
        if (wo.workOrderCode !== CODEX_MOCK_MANUAL_WO.workOrderCode) return wo;
        const total = wo.materialCount ?? wo.materials?.length ?? 0;
        const next = Math.min(total, (wo.boundMaterialCount ?? 0) + 1);
        return { ...wo, boundMaterialCount: next, materials: (wo.materials ?? []).map((material, index) => ({ ...material, bound: index < next })) };
      }));
    }, 3000);
    return () => window.clearInterval(timer);
  }, [mockLoadingStarted]);
  useEffect(() => {
    const start = () => setMockLoadingStarted(true);
    window.addEventListener("manual-line-mock-start", start);
    return () => window.removeEventListener("manual-line-mock-start", start);
  }, []);
  useEffect(() => {
    const update = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setAlarmClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!chatStation) return;
    let cancelled = false;
    setNgHistoryLoading(true);
    setNgHistoryFallback(false);
    const isBoardStation = BOARD_STATIONS.has(chatStation.code);
    const rangeParams = new URLSearchParams({
      lineDomain: IS_AUTO_LINE ? "AUTO_LINE" : "MANUAL_LINE",
      stationCode: chatStation.code,
      limit: "500",
    });
    const startDate = new Date(ngRangeStart);
    const endDate = new Date(ngRangeEnd);
    if (!Number.isNaN(startDate.getTime())) rangeParams.set("from", startDate.toISOString());
    if (!Number.isNaN(endDate.getTime())) rangeParams.set("to", endDate.toISOString());
    const historyRequest = fetch(`/api/mes/ng-trace-history?${rangeParams.toString()}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then(async (data) => {
        if (!ngRangeIsDefault || !Array.isArray(data.items) || data.items.length > 0) return data;
        const fallbackParams = new URLSearchParams({
          lineDomain: IS_AUTO_LINE ? "AUTO_LINE" : "MANUAL_LINE",
          stationCode: chatStation.code,
          limit: "10",
        });
        const fallbackResponse = await fetch(`/api/mes/ng-trace-history?${fallbackParams.toString()}`, { cache: "no-store" });
        if (!fallbackResponse.ok) return data;
        const fallbackData = await fallbackResponse.json();
        return { ...fallbackData, __fallback: true };
      });
    Promise.all([
      historyRequest,
      isBoardStation
        ? fetch(`/api/station/confirmed-motherboards?line=${IS_AUTO_LINE ? "auto" : "manual"}&limit=5000`, { cache: "no-store" }).then((response) => response.ok ? response.json() : { items: [] })
        : Promise.resolve({ items: [] }),
    ])
      .then(([data, boardsBody]) => {
        if (cancelled) return;
        const history = Array.isArray(data.items) ? data.items : [];
        setNgHistoryFallback(Boolean(data.__fallback));
        const boards = Array.isArray(boardsBody) ? boardsBody : boardsBody?.items ?? [];
        const enriched = isBoardStation
          ? history.map((item: Record<string, unknown>) => {
            const sn = String(item.sn ?? item.serialNumber ?? "").trim();
            const board = boards.find((candidate: Record<string, unknown>) => {
              const members = Array.isArray(candidate.members) ? candidate.members : [];
              return String(candidate.motherboardId ?? candidate.ictBatchId ?? candidate.fctBatchId ?? "") === sn
                || members.some((member: any) => String(member?.sn ?? member?.serialNumber ?? "") === sn);
            });
            const members = board && Array.isArray(board.members) ? board.members : [];
            return {
              ...item,
              motherboardSn: board?.motherboardId ?? board?.ictBatchId ?? board?.fctBatchId ?? item.batchId ?? "",
              daughterSns: members.map((member: any) => String(member?.sn ?? member?.serialNumber ?? "")).filter(Boolean),
            };
          })
          : history;
        setNgHistory(enriched);
      })
      .catch(() => { if (!cancelled) setNgHistory([]); })
      .finally(() => { if (!cancelled) setNgHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [chatStation, ngRangeStart, ngRangeEnd, ngRangeIsDefault, ngTraceRefresh]);
  useEffect(() => {
    if (stationPanelTab !== "motherboard" || !chatStation || !BOARD_STATIONS.has(chatStation.code)) return;
    let cancelled = false;
    setMotherboardHistoryLoading(true);
    setMotherboardHistoryFallback(false);
    const line = IS_AUTO_LINE ? "auto" : "manual";
    const startDate = new Date(ngRangeStart);
    const endDate = new Date(ngRangeEnd);
    const loadBoards = async (useRange: boolean) => {
      const params = new URLSearchParams({ line, limit: "5000" });
      if (useRange && !Number.isNaN(startDate.getTime())) params.set("since", startDate.toISOString());
      const response = await fetch(`/api/station/confirmed-motherboards?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      return Array.isArray(body.items) ? body.items : [];
    };
    void (async () => {
      try {
        let boards = await loadBoards(true);
        const inRange = (board: Record<string, unknown>) => {
          const timestamp = Date.parse(String(board.updatedAt || board.createdAt || ""));
          return Number.isNaN(timestamp) || Number.isNaN(endDate.getTime()) || timestamp <= endDate.getTime();
        };
        boards = boards.filter(inRange).sort((a, b) => Date.parse(String(b.updatedAt || b.createdAt || "")) - Date.parse(String(a.updatedAt || a.createdAt || "")));
        if (ngRangeIsDefault && boards.length === 0) {
          boards = (await loadBoards(false)).sort((a, b) => Date.parse(String(b.updatedAt || b.createdAt || "")) - Date.parse(String(a.updatedAt || a.createdAt || "")));
          if (!cancelled) setMotherboardHistoryFallback(true);
        }
        if (!cancelled) setMotherboardHistory(boards.slice(0, 10));
      } catch {
        if (!cancelled) setMotherboardHistory([]);
      } finally {
        if (!cancelled) setMotherboardHistoryLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [stationPanelTab, ngRangeStart, ngRangeEnd, ngRangeIsDefault, ngTraceRefresh]);
  useEffect(() => {
    const flowHandler = (rawEvent: Event) => {
      const detail = (
        rawEvent as CustomEvent<{
          code: string;
          sn: string;
          status: string;
        }>
      ).detail;
      if (detail?.code && detail.sn) setActiveFlow(detail);
    };
    window.addEventListener("manual-line-flow-update", flowHandler);
    return () =>
      window.removeEventListener("manual-line-flow-update", flowHandler);
  }, []);
  useEffect(() => {
    const alarmHandler = (rawEvent: Event) => {
      const detail = (rawEvent as CustomEvent<{ code: string; sn: string }>)
        .detail;
      if (!detail?.code) return;
      const markOnly = detail.code === lineCode("ict") || detail.code === lineCode("fct");
      if (markOnly) {
        void fetch("/api/pda/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "manual_line_3d_alarm_monitor",
            to: "mes_server",
            type: "NG_MARKED",
            stationCode: detail.code,
            priority: "warning",
            payload: {
              sn: detail.sn || "",
              markedAt: Date.now(),
              status: "MARK_ONLY",
            },
          }),
        }).catch(() => undefined);
        return;
      }
      setNgAlarm(detail);
      const detectedAt = Date.now();
      setAlarmProcesses((current) => [
        {
          id: `${detail.code}-${detail.sn}-${detectedAt}`,
          code: detail.code,
          sn: detail.sn || "—",
          detectedAt,
          status: "ALARMING",
        },
        ...current,
      ].slice(0, 20));
      void fetch("/api/pda/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "manual_line_3d_alarm_monitor",
          to: "mes_server",
          type: "ALARM_PROCESS_STARTED",
          stationCode: detail.code,
          priority: "critical",
          payload: { sn: detail.sn || "", detectedAt, status: "ALARMING" },
        }),
      }).catch(() => undefined);
      const stationIndex = MES_STATIONS.findIndex(([code]) => code === detail.code);
      const ngCameraTarget = CAMERA_STATIONS[stationIndex + 1]?.[1];
      const alarmOnly = detail.code === lineCode("agingcab");
      if (ngCameraTarget && !alarmOnly) {
        setCameraTarget(ngCameraTarget);
        setCameraRequest((value) => value + 1);
      }
      const stationName =
        MES_STATIONS.find(([code]) => code === detail.code)?.[1] || detail.code;
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const speech = new SpeechSynthesisUtterance(
          detail.code === lineCode("depanel")
            ? "分板机发现不良子板，请立即取出，不得流入下游"
            : `${stationName}，发现不良品，请立即隔离`,
        );
        speech.lang = "zh-CN";
        speech.rate = 1.15;
        window.speechSynthesis.speak(speech);
      }
    };
    window.addEventListener("manual-line-ng-alarm", alarmHandler);
    return () =>
      window.removeEventListener("manual-line-ng-alarm", alarmHandler);
  }, []);
  useEffect(() => {
    const completedHandler = (rawEvent: Event) => {
      const detail = (
        rawEvent as CustomEvent<{
          code: string;
          sn: string;
          completedAt: number;
          durationMs: number;
          status: string;
        }>
      ).detail;
      if (!detail?.code) return;
      window.speechSynthesis?.cancel();
      setNgAlarm((current) =>
        current && current.code === detail.code && (!detail.sn || current.sn === detail.sn)
          ? null
          : current,
      );
      setAlarmProcesses((current) =>
        current.map((item) =>
          item.code === detail.code && (!detail.sn || item.sn === detail.sn) && item.status === "ALARMING"
            ? {
                ...item,
                completedAt: detail.completedAt,
                durationMs: detail.durationMs || detail.completedAt - item.detectedAt,
                status: detail.status === "REMOVED" ? "REMOVED" : "ACKNOWLEDGED",
              }
            : item,
        ),
      );
    };
    window.addEventListener("manual-line-alarm-completed", completedHandler);
    return () => window.removeEventListener("manual-line-alarm-completed", completedHandler);
  }, []);
  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  };
  const moveCamera = (target: readonly number[]) => {
    setCameraTarget(target);
    setCameraRequest((value) => value + 1);
  };
  const goOverview = () =>
    window.dispatchEvent(new Event("manual-line-go-overview"));
  const saveOverview = () =>
    window.dispatchEvent(new Event("manual-line-save-overview"));
  const currentAlarmProcess = ngAlarm
    ? alarmProcesses.find(
        (item) =>
          item.code === ngAlarm.code &&
          item.sn === (ngAlarm.sn || "—") &&
          item.status === "ALARMING",
      )
    : undefined;
  const searchStationMemory = async () => {
    if (!chatStation || !memoryQuery.trim() || memoryLoading) return;
    setMemoryLoading(true);
    setMemoryError("");
    try {
      const currentSn = mes[chatStation.code]?.sn || "";
      const response = await fetch("http://127.0.0.1:9876/search_all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `手动线 ${chatStation.name} 工站${currentSn ? `，当前SN ${currentSn}` : ""}：${memoryQuery.trim()}`,
          top_k: 12,
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.error) throw new Error(String(data.error));
      setMemoryResults(Array.isArray(data.results) ? data.results : []);
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : String(error));
      setMemoryResults([]);
    } finally {
      setMemoryLoading(false);
    }
  };
  const searchMotherboard = async () => {
    const daughterSn = motherboardQuery.trim().toUpperCase();
    if (!daughterSn || motherboardLoading) return;
    setMotherboardLoading(true);
    setMotherboardError("");
    setMotherboardResult(null);
    try {
      const response = await fetch(`/api/station/confirmed-motherboards/identify/${encodeURIComponent(daughterSn)}?line=${IS_AUTO_LINE ? "auto" : "manual"}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(String(data?.error?.message || data?.message || `HTTP ${response.status}`));
      setMotherboardResult(data);
    } catch (error) {
      setMotherboardError(error instanceof Error ? error.message : String(error));
    } finally {
      setMotherboardLoading(false);
    }
  };
  return (
    <div style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", overflow: "hidden", fontFamily: "system-ui" }}>
      <Canvas shadows style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} camera={{ position: IS_AUTO_LINE ? [44, 20, -27] : [0, 18, 28], fov: 50 }}>
        <Hall
          mes={mes}
          locale={locale}
          activeFlow={activeFlow}
          mockLoadingStarted={mockLoadingStarted}
          onFocusLayout={(x, y, z) => {
            setCameraTarget([x, y, z, 1]);
            setCameraRequest((value) => value + 1);
          }}
          onOpenChat={(code) => {
            setChatStation({ code, name: localizedStationName(code, locale) });
            setStationPanelTab("live");
            setMemoryQuery("");
            setMemoryResults([]);
            setMemoryError("");
            setMotherboardQuery(mes[code]?.sn || "");
            setMotherboardResult(null);
            setMotherboardError("");
          }}
        />
        <CameraMove target={cameraTarget} requestId={cameraRequest} />
        <CameraOverviewBookmark />
        <OrbitControls
          makeDefault
          target={[36, 1.2, 3]}
          minDistance={5}
          maxDistance={90}
          enabled
          enableRotate
          enablePan
          enableZoom
          onStart={() => window.dispatchEvent(new Event("manual-line-user-camera"))}
        />
      </Canvas>
      {!IS_AUTO_LINE && (
        <div
          className="manual-line-status-dock"
          style={{
            position: "fixed",
            left: 18,
            top: 18,
            zIndex: 50,
            display: showUi && statusPanelOpen ? "block" : "none",
            width: 300,
            maxHeight: "calc(100vh - 150px)",
            overflow: "auto",
            borderRadius: 12,
            filter: "drop-shadow(0 8px 24px rgba(0,0,0,.35))",
          }}
        >
          <button
            type="button"
            onClick={() => setStatusPanelOpen(false)}
            aria-label={tr("closePanel", locale)}
            title={tr("closePanel", locale)}
            style={{ position: "absolute", right: 8, top: 8, zIndex: 2, width: 26, height: 26, border: 0, borderRadius: 6, background: "#334155", color: "white", fontSize: 18, lineHeight: 1, cursor: "pointer" }}
          >
            ×
          </button>
          <LineStatusPanel mes={mes} locale={locale} started={mockLoadingStarted} />
        </div>
      )}
      {!IS_AUTO_LINE && showUi && (
        <>
          <button
            type="button"
            onClick={() => setShowAllNgTrace((value) => !value)}
            style={{
              position: "fixed",
              left: 18,
              bottom: 18,
              zIndex: 45,
              padding: "10px 14px",
              border: "2px solid #38bdf8",
              borderRadius: 9,
              background: showAllNgTrace ? "#0e7490" : "#082f49",
              color: "white",
              fontWeight: 900,
              cursor: "pointer",
              boxShadow: "0 8px 24px rgba(0,0,0,.3)",
            }}
          >
            {showAllNgTrace ? "全站 NG 追踪 · 已开" : "全站 NG 追踪"}
          </button>
          {showAllNgTrace && (
            <aside
              aria-label="全工站 NG 追踪"
              style={{
                position: "fixed",
                left: "auto",
                right: 18,
                top: 170,
                bottom: 150,
                zIndex: 42,
                width: "min(560px, 44vw)",
                minWidth: 360,
                overflowY: "auto",
                overflowX: "hidden",
                overscrollBehavior: "contain",
                scrollbarGutter: "stable",
                padding: 10,
                borderRadius: 14,
                background: "rgba(241,245,249,.97)",
                boxShadow: "0 18px 55px rgba(15,23,42,.38)",
              }}
            >
              <button
                type="button"
                aria-label="关闭全站 NG 追踪"
                title="关闭全站 NG 追踪"
                onClick={() => setShowAllNgTrace(false)}
                style={{
                  position: "absolute",
                  right: 18,
                  top: 18,
                  zIndex: 3,
                  width: 32,
                  height: 32,
                  border: 0,
                  borderRadius: 8,
                  background: "#334155",
                  color: "white",
                  fontSize: 22,
                  lineHeight: 1,
                  cursor: "pointer",
                }}
              >
                ×
              </button>
              <NgRealtimeTracking locale={locale} defaultLine="MANUAL_LINE" />
            </aside>
          )}
        </>
      )}
      {ngAlarm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            pointerEvents: "none",
            border: "18px solid #ef4444",
            boxShadow: "inset 0 0 90px rgba(239,68,68,.75)",
            animation: "manualNgFlash .55s steps(2,end) infinite",
          }}
        >
          <style>{`@keyframes manualNgFlash{50%{opacity:.28}}`}</style>
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: 24,
              transform: "translateX(-50%)",
              padding: "14px 22px",
              borderRadius: 10,
              background: "#b91c1c",
              color: "white",
              fontSize: 20,
              fontWeight: 900,
              pointerEvents: "auto",
            }}
          >
            {tr("alarmTitle", locale)} ·{" "}
            {localizedStationName(ngAlarm.code, locale)}{" "}
            · {ngAlarm.sn || "—"}
            {ngAlarm.code === "manu_depanel" ? " · 立即取出，不得流入下游" : ""}
            <div
              style={{
                marginTop: 9,
                fontSize: 13,
                fontWeight: 700,
                whiteSpace: "nowrap",
              }}
            >
              {tr("alarmFlow", locale)}
              {currentAlarmProcess
                ? ` · 已持续 ${Math.max(0, Math.floor((alarmClock - currentAlarmProcess.detectedAt) / 1000))} 秒`
                : ""}
            </div>
            <button
              onClick={() => {
                window.speechSynthesis?.cancel();
                const completedAt = Date.now();
                const durationMs = currentAlarmProcess
                  ? completedAt - currentAlarmProcess.detectedAt
                  : 0;
                const completedStatus =
                  ngAlarm.code === "manu_depanel"
                    ? "REMOVED"
                    : "ACKNOWLEDGED";
                setAlarmProcesses((current) =>
                  current.map((item) =>
                    item.code === ngAlarm.code &&
                    item.sn === (ngAlarm.sn || "—") &&
                    item.status === "ALARMING"
                      ? {
                          ...item,
                          status:
                            ngAlarm.code === "manu_depanel"
                              ? "REMOVED"
                              : "ACKNOWLEDGED",
                          completedAt,
                          durationMs,
                        }
                      : item,
                  ),
                );
                void fetch("/api/pda/events", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    from: "manual_line_3d_alarm_monitor",
                    to: "mes_server",
                    type: "ALARM_PROCESS_COMPLETED",
                    stationCode: ngAlarm.code,
                    priority: "info",
                    payload: {
                      sn: ngAlarm.sn || "",
                      detectedAt: currentAlarmProcess?.detectedAt,
                      completedAt,
                      durationMs,
                      status: completedStatus,
                    },
                  }),
                }).catch(() => undefined);
                setNgAlarm(null);
              }}
              style={{
                marginLeft: 18,
                padding: "7px 12px",
                border: 0,
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              {ngAlarm.code === "manu_depanel" ? tr("removed", locale) : tr("confirmAlarm", locale)}
            </button>
          </div>
        </div>
      )}
      <div
        style={{
          position: "fixed",
          right: 18,
          bottom: 86,
          zIndex: 24,
          display: showUi && new URLSearchParams(window.location.search).get("simulate") === "1" ? "flex" : "none",
          gap: 6,
          padding: 7,
          borderRadius: 8,
          background: "rgba(15,23,42,.9)",
        }}
      >
        <select
          value={simulationStation}
          onChange={(event) => setSimulationStation(event.target.value)}
          style={{ padding: "7px 8px", borderRadius: 6, border: 0 }}
        >
          {MES_STATIONS.map(([code, name]) => (
            <option key={code} value={code}>
              {localizedStationName(code, locale)}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            const sn = `SIM-${simulationStation.toUpperCase()}-${String(simulationSequence).padStart(3, "0")}`;
            window.dispatchEvent(
              new CustomEvent("manual-line-sim-sn", {
                detail: { code: simulationStation, sn },
              }),
            );
            setSimulationSequence((value) => value + 1);
          }}
          style={{
            padding: "7px 11px",
            border: 0,
            borderRadius: 6,
            background: "#f59e0b",
            color: "#111827",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          {tr("simulateNext", locale)}
        </button>
        <button
          onClick={() => {
            const currentSn =
              mes[simulationStation]?.sn ||
              `SIM-NG-${Date.now().toString().slice(-6)}`;
            window.dispatchEvent(
              new CustomEvent("manual-line-sim-sn", {
                detail: {
                  code: simulationStation,
                  sn: currentSn,
                  result: "NG",
                  slots: BOARD_STATIONS.has(simulationStation)
                    ? Array.from({ length: IS_AUTO_LINE ? 6 : 12 }, (_, slotIndex) => ({
                        sn: `${currentSn}-D${String(slotIndex + 1).padStart(2, "0")}`,
                        result: slotIndex === 0 ? "NG" : "PASS",
                      }))
                    : undefined,
                },
              }),
            );
          }}
          style={{
            padding: "7px 11px",
            border: 0,
            borderRadius: 6,
            background: "#ef4444",
            color: "white",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          {tr("simulateNg", locale)}
        </button>
        <button
          disabled={processSimulationRunning}
          onClick={async () => {
            if (processSimulationRunning) return;
            setProcessSimulationRunning(true);
            const simulationStartedAt = Date.now();
            for (let boardIndex = 0; boardIndex < 12; boardIndex += 1) {
              const productSn = `SIM-NV18A-${String(simulationStartedAt).slice(-6)}-${String(boardIndex + 1).padStart(2, "0")}`;
              for (let index = 0; index < MES_STATIONS.length; index += 1) {
                const [code] = MES_STATIONS[index];
                window.dispatchEvent(
                  new CustomEvent("manual-line-sim-sn", {
                    detail: {
                      code,
                      sn: productSn,
                    result: "PASS",
                    slots: BOARD_STATIONS.has(code)
                      ? Array.from({ length: IS_AUTO_LINE ? 6 : 12 }, (_, slotIndex) => ({
                          sn: `${productSn}-D${String(slotIndex + 1).padStart(2, "0")}`,
                          result: "PASS",
                        }))
                      : code.includes("_ate")
                        ? Array.from({ length: 8 }, (_, slotIndex) => ({
                            sn:
                              slotIndex === 0
                                ? productSn
                                : `${productSn.slice(0, -2)}${String(slotIndex + 1).padStart(2, "0")}`,
                            result: "PASS",
                          }))
                        : undefined,
                    },
                  }),
                );
              }
              moveCamera(CAMERA_STATIONS[MES_STATIONS.length]?.[1] || [36, 1.2, 0]);
              await new Promise((resolve) => window.setTimeout(resolve, SIM_BOARD_INTERVAL_MS));
            }
            setProcessSimulationRunning(false);
          }}
          style={{
            padding: "7px 11px",
            border: 0,
            borderRadius: 6,
            background: processSimulationRunning ? "#64748b" : "#22c55e",
            color: "#052e16",
            fontWeight: 800,
            cursor: processSimulationRunning ? "default" : "pointer",
          }}
        >
          {processSimulationRunning
            ? (locale === "zh-CN" ? "12 块母板模拟中 · 每块 5 秒" : locale === "vi-VN" ? "Đang mô phỏng 12 bo · 5 giây/bo" : "SIMULATING 12 BOARDS · 5 SEC/BOARD")
            : (locale === "zh-CN" ? "模拟 12 块母板 · 每块 5 秒" : locale === "vi-VN" ? "MÔ PHỎNG 12 BO · 5 GIÂY/BO" : "SIMULATE 12 BOARDS · 5 SEC/BOARD")}
        </button>
      </div>
      {chatStation && (
        <div
          style={{
            position: "fixed",
            right: 18,
            top: 18,
            zIndex: 40,
            width: 390,
            maxHeight: "calc(100vh - 36px)",
            display: "flex",
            flexDirection: "column",
            borderRadius: 12,
            overflow: "hidden",
            background: "rgba(248,250,252,.97)",
            color: "#173042",
            boxShadow: "0 18px 55px rgba(15,23,42,.35)",
          }}
        >
          <div
            style={{
              padding: "13px 15px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: "#0e7490",
              color: "white",
            }}
          >
            <div>
              <b>{localizedStationName(chatStation.code, locale)} · {tr("aiMemory", locale)}</b>
              <div style={{ fontSize: 11, opacity: 0.85 }}>
                {tr("currentSn", locale)}：{mes[chatStation.code]?.sn || "—"}
              </div>
            </div>
            <button
              onClick={() => setChatStation(null)}
              style={{
                border: 0,
                background: "transparent",
                color: "white",
                fontSize: 22,
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>
          <div style={{ padding: 12, display: "flex", gap: 7 }}>
            {([
              ["live", tr("live", locale)],
              ["trace", tr("trace", locale)],
              ...(BOARD_STATIONS.has(chatStation.code) ? [["motherboard", tr("motherboard", locale)] as const] : []),
              ["alarms", tr("alarms", locale)],
              ["memory", tr("memory", locale)],
            ] as const).map(([tab, label]) => (
              <button
                key={tab}
                onClick={() => setStationPanelTab(tab)}
                style={{
                  padding: "7px 8px",
                  border: 0,
                  borderRadius: 6,
                  background: stationPanelTab === tab ? "#0e7490" : "#e2e8f0",
                  color: stationPanelTab === tab ? "white" : "#334155",
                  fontWeight: 700,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {stationPanelTab === "memory" && <div style={{ padding: "0 12px 12px", display: "flex", gap: 7 }}>
            <input
              autoFocus
              value={memoryQuery}
              onChange={(event) => setMemoryQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") searchStationMemory();
              }}
              placeholder={locale === "zh-CN" ? "查询 SN、NG、历史、工艺或异常…" : locale === "en-US" ? "Search SN, NG, history, process or exception…" : "Tìm SN, NG, lịch sử, quy trình hoặc bất thường…"}
              style={{
                flex: 1,
                minWidth: 0,
                padding: "9px 10px",
                border: "1px solid #cbd5e1",
                borderRadius: 7,
              }}
            />
            <button
              onClick={searchStationMemory}
              disabled={memoryLoading || !memoryQuery.trim()}
              style={{
                padding: "8px 13px",
                border: 0,
                borderRadius: 7,
                background: "#0891b2",
                color: "white",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {memoryLoading ? tr("querying", locale) : tr("query", locale)}
            </button>
          </div>}
          <div style={{ overflowY: "auto", padding: "0 12px 12px" }}>
            {stationPanelTab === "live" && (() => {
              const row = mes[chatStation.code];
              const slots = row?.slots || [];
              const target = row?.target || (chatStation.code === "manu_outer_box_binding" ? 20 : 0);
              return (
                <div>
                  <div style={{ marginBottom: 9, padding: 9, borderRadius: 7, background: "#ecfeff", border: "1px solid #67e8f9" }}>
                    <div style={{ fontSize: 11, fontWeight: 900, color: "#155e75" }}>MANUAL LINE · WO / MATERIAL LOAD</div>
                    {manualWorkOrders.length === 0 ? <div style={{ marginTop: 4, fontSize: 11, color: "#64748b" }}>No released work order</div> : manualWorkOrders.slice(0, 2).map((wo) => (
                      <div key={wo.workOrderCode} style={{ marginTop: 5, fontSize: 11 }}>
                        <b>{wo.workOrderCode}</b> · {wo.status || "released"} · {wo.materialCount ?? wo.materials?.length ?? 0} materials
                        <div style={{ marginTop: 3, maxHeight: 72, overflowY: "auto", color: "#334155" }}>
                          {(wo.materials || []).slice(0, 8).map((material) => `${material.materialCode || "-"} × ${material.requiredQty ?? 0}${material.bound ? " ✓" : ""}`).join("  ·  ") || "Material details pending"}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {[
                      [tr("currentSn", locale), row?.sn || "—"],
                      ["Machine QR", row?.machineQr || `RJ-MACHINE:${chatStation.code}`],
                      [tr("status", locale), row?.status || (row?.online ? tr("online", locale) : tr("offline", locale))],
                      ["PASS", row?.pass || 0],
                      ["NG / DUP", `${row?.ng || 0} / ${row?.dup || 0}`],
                      ["NG now", row?.currentNgCount ?? 0],
                      ...(chatStation.code.endsWith("_rework") ? [
                        ["Repair open WOs", row?.repairOpenCount ?? 0],
                        ["Repair finished WOs", row?.repairFinishedCount ?? 0],
                        ["Repair history", row?.repairHistoryCount ?? 0],
                        ["Repair last 10", row?.repairLast10Count ?? 0],
                      ] : []),
                    ].map(([label, value]) => (
                      <div key={String(label)} style={{ padding: 9, borderRadius: 7, background: "white", border: "1px solid #dbe4ea" }}>
                        <div style={{ fontSize: 11, color: "#64748b" }}>{label}</div>
                        <div style={{ fontSize: 13, fontWeight: 800, overflowWrap: "anywhere" }}>{value}</div>
                      </div>
                    ))}
                  </div>
                  {BOARD_STATIONS.has(chatStation.code) && (
                    <div style={{ marginTop: 10, padding: 9, borderRadius: 7, background: "#eff6ff", border: "2px solid #60a5fa" }}>
                      <div style={{ fontSize: 12, fontWeight: 900, color: "#1d4ed8", marginBottom: 6 }}>MOTHERBOARD / DAUGHTER BOARD LAYOUT</div>
                      <div style={{ padding: 7, borderRadius: 6, background: "#dbeafe", color: "#1e3a8a", fontSize: 12, fontWeight: 900 }}>MOTHER SN · {row?.sn || "—"}</div>
                      <div style={{ marginTop: 7, display: "grid", gridTemplateColumns: slots.length > 8 ? "repeat(3, 1fr)" : "repeat(2, 1fr)", gap: 5 }}>
                        {slots.length === 0 ? <div style={{ gridColumn: "1 / -1", fontSize: 11, color: "#64748b" }}>No daughter-board snapshot</div> : slots.map((slot, index) => {
                          const failed = ["NG", "FAIL"].includes(String(slot.result).toUpperCase());
                          return <div key={`layout-${slot.sn}-${index}`} style={{ padding: 6, borderRadius: 5, background: failed ? "#fee2e2" : slot.sn ? "#dcfce7" : "#f1f5f9", color: failed ? "#991b1b" : "#166534", fontSize: 10, overflow: "hidden" }}>
                            <b>DAUGHTER {String(index + 1).padStart(2, "0")}</b><br />{slot.sn || "—"}<br />{slot.result}
                          </div>;
                        })}
                      </div>
                    </div>
                  )}
                  {chatStation.code.endsWith("_rework") && (
                    <div style={{ marginTop: 10, padding: 9, borderRadius: 7, background: "#fffbeb", border: "1px solid #fbbf24" }}>
                      <div style={{ fontSize: 12, fontWeight: 900, color: "#92400e", marginBottom: 6 }}>REPAIR WO HISTORY</div>
                      {(row?.repairHistoryRows || []).length === 0 ? (
                        <div style={{ fontSize: 11, color: "#78716c" }}>No repair WO history returned by Repair Agent</div>
                      ) : (row?.repairHistoryRows || []).map((wo, index) => {
                        const woNo = wo.repairWorkOrderNo || wo.workOrderNo || wo.id || `WO-${index + 1}`;
                        const status = String(wo.result || wo.status || "UNKNOWN").toUpperCase();
                        const when = wo.repairedAt || wo.repairCompletedAt || wo.updatedAt || wo.submittedAt || "";
                        return <div
                          key={`${woNo}-${index}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedRepairWorkOrder(wo)}
                          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedRepairWorkOrder(wo); }}
                          style={{ padding: "6px 0", borderTop: index ? "1px solid #fde68a" : 0, fontSize: 11, cursor: "pointer" }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                            <b style={{ color: "#78350f" }}>{woNo}</b>
                            <b style={{ color: ["COMPLETED", "CLOSED", "REPAIRED", "PASS"].includes(status) ? "#15803d" : "#b45309" }}>{status}</b>
                          </div>
                          <div style={{ marginTop: 2, color: "#57534e" }}>SN {wo.sn || "—"} · FROM {wo.sourceStation || "—"} · DEFECT {wo.defectCode || "—"}</div>
                          <div style={{ marginTop: 2, color: "#78716c" }}>{wo.operator || "Operator —"}{when ? ` · ${when}` : ""}</div>
                        </div>;
                      })}
                      {selectedRepairWorkOrder && (
                        <div style={{ marginTop: 8, padding: 9, borderRadius: 6, background: "#fff7ed", border: "2px solid #f59e0b", color: "#431407" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontWeight: 900 }}>
                            <span>WO DETAILS</span>
                            <button type="button" onClick={() => setSelectedRepairWorkOrder(null)} style={{ border: 0, background: "transparent", color: "#92400e", cursor: "pointer", fontWeight: 900 }}>×</button>
                          </div>
                          <div style={{ marginTop: 6, fontSize: 12 }}><b>WO:</b> {selectedRepairWorkOrder.repairWorkOrderNo || selectedRepairWorkOrder.workOrderNo || selectedRepairWorkOrder.id || "—"}</div>
                          <div style={{ marginTop: 3, fontSize: 12 }}><b>STATUS:</b> {String(selectedRepairWorkOrder.result || selectedRepairWorkOrder.status || "UNKNOWN").toUpperCase()}</div>
                          <div style={{ marginTop: 3, fontSize: 11 }}>SN {selectedRepairWorkOrder.sn || "—"} · SOURCE {selectedRepairWorkOrder.sourceStation || "—"}</div>
                          <div style={{ marginTop: 3, fontSize: 11 }}>DEFECT {selectedRepairWorkOrder.defectCode || "—"} · OPERATOR {selectedRepairWorkOrder.operator || "—"}</div>
                          <div style={{ marginTop: 3, fontSize: 10, color: "#78716c" }}>SUBMITTED {selectedRepairWorkOrder.submittedAt || "—"}</div>
                          <div style={{ marginTop: 2, fontSize: 10, color: "#78716c" }}>UPDATED {selectedRepairWorkOrder.updatedAt || "—"}</div>
                          <div style={{ marginTop: 2, fontSize: 10, color: "#78716c" }}>COMPLETED {selectedRepairWorkOrder.repairedAt || selectedRepairWorkOrder.repairCompletedAt || "—"}</div>
                        </div>
                      )}
                    </div>
                  )}
                  {target > 0 && <div style={{ marginTop: 9, fontWeight: 800 }}>{tr("packingProgress", locale)}：{slots.length} / {target}</div>}
                  {slots.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: slots.length > 8 ? "repeat(3,1fr)" : "repeat(2,1fr)", gap: 5, marginTop: 9 }}>
                      {slots.map((slot, index) => {
                        const failed = ["NG", "FAIL"].includes(String(slot.result).toUpperCase());
                        return <div key={`${slot.sn}-${index}`} style={{ padding: 6, borderRadius: 5, background: failed ? "#fee2e2" : slot.sn ? "#dcfce7" : "#f1f5f9", color: failed ? "#991b1b" : "#166534", fontSize: 10, overflow: "hidden" }}>
                          <b>{index + 1}</b> {slot.sn || tr("empty", locale)}<br />{slot.result}
                        </div>;
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
            {stationPanelTab === "trace" && (
              <div>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>{tr("recentNg", locale)}</div>
                <div style={{ padding: 9, marginBottom: 9, borderRadius: 7, background: "#f8fafc", border: "1px solid #cbd5e1" }}>
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "end" }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 10, fontWeight: 800, color: "#475569" }}>
                      {locale === "zh-CN" ? "开始时间" : locale === "en-US" ? "From" : "Từ"}
                      <input type="datetime-local" value={ngRangeStart} onChange={(event) => { setNgRangeIsDefault(false); setNgRangeStart(event.target.value); }} style={{ padding: "6px 7px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 11 }} />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 10, fontWeight: 800, color: "#475569" }}>
                      {locale === "zh-CN" ? "结束时间" : locale === "en-US" ? "To" : "Đến"}
                      <input type="datetime-local" value={ngRangeEnd} onChange={(event) => { setNgRangeIsDefault(false); setNgRangeEnd(event.target.value); }} style={{ padding: "6px 7px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 11 }} />
                    </label>
                    <button type="button" onClick={() => { setNgRangeIsDefault(true); setNgRangeStart(toDateTimeLocal(new Date(Date.now() - 24 * 60 * 60 * 1000))); setNgRangeEnd(toDateTimeLocal(new Date())); setNgTraceRefresh((value) => value + 1); }} style={{ padding: "7px 9px", border: 0, borderRadius: 6, background: "#0f766e", color: "white", fontWeight: 800, fontSize: 11, cursor: "pointer" }}>
                      {locale === "zh-CN" ? "最近24小时" : locale === "en-US" ? "Last 24 hours" : "24 giờ qua"}
                    </button>
                    <button type="button" onClick={() => setNgTraceRefresh((value) => value + 1)} style={{ padding: "7px 9px", border: 0, borderRadius: 6, background: "#0891b2", color: "white", fontWeight: 800, fontSize: 11, cursor: "pointer" }}>
                      {locale === "zh-CN" ? "查询" : locale === "en-US" ? "Search" : "Tìm"}
                    </button>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 10, color: "#64748b" }}>
                    {locale === "zh-CN" ? "默认显示最近24小时；可选择其他日期和时间查看历史 NG。" : locale === "en-US" ? "Defaults to the last 24 hours; choose another date/time to view historical NG." : "Mặc định 24 giờ qua; chọn ngày/giờ khác để xem NG lịch sử."}
                  </div>
                </div>
                {ngHistoryFallback && <div style={{ padding: 7, marginBottom: 8, borderRadius: 6, background: "#fffbeb", border: "1px solid #fcd34d", color: "#92400e", fontSize: 11 }}>{locale === "zh-CN" ? "最近24小时没有 NG，以下显示该工站最近已有记录。请选择日期查看指定范围。" : locale === "en-US" ? "No NG in the last 24 hours; showing the latest records for this station. Choose a date range for an exact period." : "Không có NG trong 24 giờ qua; đang hiển thị bản ghi gần nhất của trạm. Chọn khoảng thời gian để lọc chính xác."}</div>}
                {ngHistoryLoading ? <div>{tr("loading", locale)}</div> : ngHistory.length === 0 ? <div style={{ color: "#64748b" }}>{tr("noNg", locale)}</div> : ngHistory.map((item, index) => (
                  <div key={String(item.ngDefectId || item.id || index)} style={{ padding: 9, marginBottom: 7, background: "white", border: "1px solid #fecaca", borderRadius: 7 }}>
                    <b style={{ color: "#b91c1c" }}>NG · SN {String(item.sn || item.serialNumber || "—")}</b>
                    <div style={{ marginTop: 3, fontSize: 11, color: "#475569" }}>WHERE {String(item.sourceStationCode || chatStation.code || "—")}</div>
                    <div style={{ fontSize: 12 }}>WHAT {String(item.defectDescription || item.reason || item.defectCode || item.result || "NG")}</div>
                    {BOARD_STATIONS.has(chatStation.code) && <>
                      <div style={{ marginTop: 3, fontSize: 11, color: "#1d4ed8", fontWeight: 800 }}>MOTHER SN {String(item.motherboardSn || item.batchId || "—")}</div>
                      <div style={{ marginTop: 2, fontSize: 10, color: "#475569", lineHeight: 1.35 }}>DAUGHTERS {Array.isArray(item.daughterSns) && item.daughterSns.length ? item.daughterSns.join(" · ") : "—"}</div>
                    </>}
                    <div style={{ fontSize: 11, color: "#64748b" }}>WHEN {String(item.sourceTestTime || item.createdAt || item.detectedAt || "—")}</div>
                  </div>
                ))}
              </div>
            )}
            {stationPanelTab === "motherboard" && (
              <div>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>{locale === "zh-CN" ? "母板 / 子板记录" : locale === "en-US" ? "Motherboard / Daughter Records" : "Bản ghi bo mẹ / bo con"}</div>
                <div style={{ padding: 9, marginBottom: 9, borderRadius: 7, background: "#f8fafc", border: "1px solid #cbd5e1" }}>
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "end" }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 10, fontWeight: 800, color: "#475569" }}>{locale === "zh-CN" ? "开始时间" : "From"}<input type="datetime-local" value={ngRangeStart} onChange={(event) => { setNgRangeIsDefault(false); setNgRangeStart(event.target.value); }} style={{ padding: "6px 7px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 11 }} /></label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 10, fontWeight: 800, color: "#475569" }}>{locale === "zh-CN" ? "结束时间" : "To"}<input type="datetime-local" value={ngRangeEnd} onChange={(event) => { setNgRangeIsDefault(false); setNgRangeEnd(event.target.value); }} style={{ padding: "6px 7px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 11 }} /></label>
                    <button type="button" onClick={() => { setNgRangeIsDefault(true); setNgRangeStart(toDateTimeLocal(new Date(Date.now() - 24 * 60 * 60 * 1000))); setNgRangeEnd(toDateTimeLocal(new Date())); setNgTraceRefresh((value) => value + 1); }} style={{ padding: "7px 9px", border: 0, borderRadius: 6, background: "#0f766e", color: "white", fontWeight: 800, fontSize: 11 }}>{locale === "zh-CN" ? "最近24小时" : "Last 24 hours"}</button>
                    <button type="button" onClick={() => setNgTraceRefresh((value) => value + 1)} style={{ padding: "7px 9px", border: 0, borderRadius: 6, background: "#0891b2", color: "white", fontWeight: 800, fontSize: 11 }}>{locale === "zh-CN" ? "查询" : "Search"}</button>
                  </div>
                  {motherboardHistoryFallback && <div style={{ marginTop: 6, fontSize: 10, color: "#92400e" }}>{locale === "zh-CN" ? "最近24小时无记录，显示最近10条母板记录。" : "No records in the last 24 hours; showing the latest 10 motherboards."}</div>}
                </div>
                {motherboardHistoryLoading ? <div style={{ color: "#64748b", marginBottom: 9 }}>{tr("loading", locale)}</div> : motherboardHistory.length === 0 ? <div style={{ color: "#64748b", marginBottom: 9 }}>{locale === "zh-CN" ? "暂无母板记录" : "No motherboard records"}</div> : motherboardHistory.map((board, index) => {
                  const members = Array.isArray(board.members) ? board.members as Array<Record<string, unknown>> : [];
                  return <div key={String(board.motherboardId || index)} style={{ padding: 9, marginBottom: 7, background: "#eff6ff", border: "1px solid #93c5fd", borderRadius: 7 }}>
                    <div style={{ fontWeight: 900, color: "#1d4ed8" }}>MOTHER · {String(board.motherboardId || "—")}</div>
                    <div style={{ marginTop: 3, fontSize: 10, color: "#64748b" }}>UPDATED · {String(board.updatedAt || "—")}</div>
                    <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 5 }}>{members.length ? members.map((member, memberIndex) => <div key={`${String(member.sn || member.serialNumber || memberIndex)}`} style={{ padding: 6, borderRadius: 5, background: "white", fontSize: 10 }}><b>DAUGHTER {String(memberIndex + 1).padStart(2, "0")}</b><br />{String(member.sn || member.serialNumber || "—")}<br />{String(member.result || member.status || "—")}</div>) : <div style={{ fontSize: 10, color: "#64748b" }}>No daughter records</div>}</div>
                  </div>;
                })}
                <div style={{ display: "flex", gap: 7, marginBottom: 9 }}>
                  <input value={motherboardQuery} onChange={(event) => setMotherboardQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchMotherboard(); }} placeholder={tr("scanDaughter", locale)} style={{ flex: 1, minWidth: 0, padding: "9px 10px", border: "1px solid #cbd5e1", borderRadius: 7 }} />
                  <button onClick={() => void searchMotherboard()} disabled={motherboardLoading || !motherboardQuery.trim()} style={{ padding: "8px 12px", border: 0, borderRadius: 7, background: "#0891b2", color: "white", fontWeight: 700 }}>{tr("query", locale)}</button>
                </div>
                {motherboardError && <div style={{ color: "#b91c1c" }}>{motherboardError}</div>}
                {motherboardResult && <pre style={{ margin: 0, padding: 10, whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: "#f1f5f9", borderRadius: 7, fontSize: 11 }}>{JSON.stringify(motherboardResult, null, 2)}</pre>}
                {!motherboardResult && !motherboardError && <div style={{ color: "#64748b" }}>{tr("motherboardHint", locale)}</div>}
              </div>
            )}
            {stationPanelTab === "alarms" && (
              <div>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>{tr("alarmRecords", locale)}</div>
                {alarmProcesses.filter((item) => item.code === chatStation.code).length === 0 ? <div style={{ color: "#64748b" }}>{tr("noAlarms", locale)}</div> : alarmProcesses.filter((item) => item.code === chatStation.code).map((item) => (
                  <div key={item.id} style={{ padding: 9, marginBottom: 7, background: item.status === "ALARMING" ? "#fee2e2" : "#f1f5f9", borderRadius: 7 }}>
                    <b>{item.sn}</b> · {item.status}
                    <div style={{ fontSize: 11, color: "#64748b" }}>{tr("duration", locale)}：{Math.floor(((item.durationMs ?? (alarmClock - item.detectedAt)) / 1000))} {tr("seconds", locale)}</div>
                  </div>
                ))}
              </div>
            )}
            {stationPanelTab === "memory" && <>
            {memoryError && (
              <div
                style={{
                  padding: 10,
                  color: "#b91c1c",
                  background: "#fee2e2",
                  borderRadius: 7,
                }}
              >
                记忆服务不可用：{memoryError}
              </div>
            )}
            {!memoryLoading && !memoryError && memoryResults.length === 0 && (
              <div
                style={{ padding: "18px 8px", color: "#64748b", fontSize: 13 }}
              >
                {tr("memoryHint", locale)}
              </div>
            )}
            {memoryResults.map((result, index) => (
              <div
                key={String(result.id || index)}
                style={{
                  padding: 11,
                  marginBottom: 8,
                  border: "1px solid #dbe4ea",
                  borderRadius: 8,
                  background: "white",
                }}
              >
                <div
                  style={{ fontSize: 11, color: "#64748b", marginBottom: 5 }}
                >
                  {String(result.agent_id || "管理系统")}
                  {typeof result.score === "number"
                    ? ` · ${(result.score * 100).toFixed(1)}%`
                    : ""}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    lineHeight: 1.45,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {String(
                    result.memory || result.text || JSON.stringify(result),
                  )}
                </div>
              </div>
            ))}
            </>}
          </div>
        </div>
      )}
      <label className="manual-line-language" style={{ position: "fixed", right: chatStation ? 426 : 18, top: 66, zIndex: 50, display: "flex", alignItems: "center", gap: 7, padding: "7px 10px", borderRadius: 8, background: "rgba(15,23,42,.92)", color: "white", fontWeight: 800 }}>
        {tr("language", locale)}
        <select
          aria-label={tr("language", locale)}
          value={locale}
          onChange={(event) => setLocale(event.target.value as LineLocale)}
          style={{ padding: "5px 7px", borderRadius: 6, border: 0, background: "white", color: "#173042", fontWeight: 700 }}
        >
          <option value="zh-CN">中文</option>
          <option value="en-US">English</option>
          <option value="vi-VN">Tiếng Việt</option>
        </select>
      </label>
      <div className="manual-line-top-controls" style={{ position: "fixed", top: 18, right: chatStation ? 426 : 18, zIndex: 55, display: "flex", gap: 7, alignItems: "center" }}>
      {!statusPanelOpen && (
        <button
          type="button"
          onClick={() => setStatusPanelOpen(true)}
          style={{ padding: "8px 12px", border: 0, borderRadius: 7, background: "#0f766e", color: "white", fontWeight: 800, cursor: "pointer", boxShadow: "0 5px 18px #102b3a55" }}
        >
          {tr("livePanel", locale)}
        </button>
      )}
      <button
        onClick={() => setShowUi((value) => !value)}
        style={{
          padding: "8px 12px",
          border: 0,
          borderRadius: 7,
          background: "#0891b2",
          color: "white",
          fontWeight: 800,
          cursor: "pointer",
          boxShadow: "0 5px 18px #102b3a55",
        }}
      >
        {showUi ? tr("hide", locale) : tr("show", locale)}
      </button>
      <button
        onClick={toggleFullscreen}
        style={{
          padding: "8px 12px",
          border: 0,
          borderRadius: 7,
          background: "#334155",
          color: "white",
          fontWeight: 800,
          cursor: "pointer",
          boxShadow: "0 5px 18px #102b3a55",
        }}
      >
        {isFullscreen ? tr("exitFullscreen", locale) : tr("fullscreen", locale)}
      </button>
      <button
        onClick={goOverview}
        title={tr("overview", locale)}
        style={{
          padding: "8px 14px",
          border: 0,
          borderRadius: 7,
          background: "#0f766e",
          color: "white",
          fontWeight: 800,
          cursor: "pointer",
          boxShadow: "0 5px 18px #102b3a55",
        }}
      >
        {tr("overview", locale)}
      </button>
      <button
        onClick={saveOverview}
        disabled
        title="将当前相机位置保存为总览"
        style={{
          display: "none",
          padding: "8px 12px",
          border: 0,
          borderRadius: 7,
          background: "#475569",
          color: "white",
          fontWeight: 800,
          cursor: "pointer",
          boxShadow: "0 5px 18px #102b3a55",
        }}
      >
        设为总览
      </button>
      </div>
      <section
        aria-label="MES 全线 KPI"
        className="manual-line-kpi-ribbon"
        style={{
          position: "fixed",
          top: 18,
          left: 340,
          right: chatStation ? 426 : 340,
          zIndex: 80,
          display: showUi ? "flex" : "none",
          alignItems: "stretch",
          gap: 7,
          maxWidth: "none",
          overflowX: "auto",
          padding: 7,
          border: "1px solid rgba(148,163,184,.45)",
          borderRadius: 12,
          background: "rgba(8,25,36,.92)",
          boxShadow: "0 9px 28px rgba(15,23,42,.28)",
          backdropFilter: "blur(8px)",
          color: "#f8fafc",
        }}
      >
        <div style={{ minWidth: 94, alignSelf: "stretch", display: "flex", flexDirection: "column", justifyContent: "center", padding: "5px 10px", borderRight: "1px solid #365260" }}>
          <div style={{ fontSize: 12, fontWeight: 950, letterSpacing: .5 }}>全线 KPI</div>
          <div style={{ marginTop: 2, fontSize: 9, fontWeight: 800, color: "#67e8f9" }}>MES · REAL-TIME</div>
        </div>
        <div style={{ minWidth: 116, padding: "5px 9px", borderRadius: 8, background: mesSyncState === "MES LIVE" ? "#14532d" : "#78350f" }}>
          <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: .7, color: "#bbf7d0" }}>MES SYNC</div>
          <div style={{ marginTop: 2, fontSize: 13, fontWeight: 900 }}>{mesSyncState}</div>
        </div>
        <div style={{ minWidth: 94, padding: "5px 9px", borderRadius: 8, background: "#123b4a" }}>
          <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: .7, color: "#a5f3fc" }}>ONLINE</div>
          <div style={{ marginTop: 2, fontSize: 14, fontWeight: 900 }}>{onlineStationCount}/{MES_STATIONS.length}</div>
        </div>
        <div style={{ minWidth: 82, padding: "5px 9px", borderRadius: 8, background: "#14532d" }}>
          <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: .7, color: "#bbf7d0" }}>PASS</div>
          <div style={{ marginTop: 2, fontSize: 14, fontWeight: 900 }}>{lineKpi.pass}</div>
        </div>
        <div style={{ minWidth: 82, padding: "5px 9px", borderRadius: 8, background: lineKpi.ng > 0 ? "#7f1d1d" : "#334155" }}>
          <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: .7, color: "#fecaca" }}>NG / DUP</div>
          <div style={{ marginTop: 2, fontSize: 14, fontWeight: 900 }}>{lineKpi.ng} / {lineKpi.duplicate}</div>
        </div>
        <div style={{ minWidth: 132, padding: "5px 9px", borderRadius: 8, background: "#334155" }}>
          <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: .7, color: "#cbd5e1" }}>ACTIVE SN / WO</div>
          <div style={{ marginTop: 2, fontSize: 12, fontWeight: 900 }}>{lineKpi.activeSn} · {lineKpi.currentWo}</div>
        </div>
      </section>
      <div
        className="manual-line-summary"
        style={{
          display: showUi ? "block" : "none",
          padding: "10px 14px",
          borderRadius: 8,
          background: "rgba(255,255,255,.9)",
          color: "#173042",
          boxShadow: "0 6px 24px #29495d44",
        }}
      >
        <b>{IS_AUTO_LINE ? localizedStationName("auto_agingcab", locale).split(" · ")[0] : (locale === "zh-CN" ? "手动线" : locale === "en-US" ? "Manual Line" : "Dây chuyền thủ công")} · {tr("lineTitle", locale)}</b>
        <div style={{ fontSize: 12, marginTop: 3 }}>
          {tr("lineSubtitle", locale)}
        </div>
        <div style={{ marginTop: 9, padding: "8px 10px", borderRadius: 7, background: "#ecfeff", border: "1px solid #67e8f9", color: "#164e63", minWidth: 275 }}>
          <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: .3 }}>MES · MANUAL LINE MATERIAL LOADING</div>
          {manualWorkOrders.length === 0 ? (
            <div style={{ marginTop: 4, fontSize: 11 }}>当前没有已发布的手动线工单</div>
          ) : manualWorkOrders.slice(0, 2).map((wo) => (
            <div key={wo.workOrderCode} style={{ marginTop: 5, fontSize: 11 }}>
              <b>WO {wo.workOrderCode}</b> · {wo.status || "released"} · {wo.productCode || "-"}<br />
              <span>物料 {wo.materialCount ?? wo.materials?.length ?? 0} 项 · 已绑定 {wo.boundMaterialCount ?? 0} · 数量 {wo.plannedQty ?? 0}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7, fontSize: 11, fontWeight: 800, color: onlineStationCount === MES_STATIONS.length ? "#15803d" : "#b45309" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: onlineStationCount === MES_STATIONS.length ? "#16a34a" : "#f59e0b", display: "inline-block" }} />
          MES 实时同步 · {onlineStationCount}/{MES_STATIONS.length} 工站在线
        </div>
      </div>
      <div style={{ marginTop: 4, fontSize: 10, fontWeight: 800, color: mesSyncState === "MES LIVE" ? "#15803d" : mesSyncState === "MOCK DEMO" ? "#b45309" : "#b91c1c" }}>
        {mesSyncState} · {mesSnapshotCount}/{MES_STATIONS.length} snapshots · {onlineStationCount}/{MES_STATIONS.length} online
        {latestMesSyncAt > 0 && <span style={{ marginLeft: 5, fontWeight: 600, color: "#64748b" }}>· {new Date(latestMesSyncAt).toLocaleTimeString("en-GB", { hour12: false })}</span>}
      </div>
      <div
        className="manual-line-station-rail"
        style={{
          position: "fixed",
          left: 18,
          right: chatStation ? 426 : 18,
          bottom: 16,
          zIndex: 35,
          display: showUi ? "flex" : "none",
          gap: 7,
          overflowX: "auto",
          padding: "8px",
          borderRadius: 10,
          background: "rgba(10,25,35,.9)",
          boxShadow: "0 8px 28px #102b3a66",
        }}
      >
        <button
          onClick={goOverview}
          style={{
            minWidth: 72,
            padding: "8px",
            border: 0,
            borderRadius: 7,
            background: "#0891b2",
            color: "white",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          {tr("overview", locale)}
        </button>
        {MES_STATIONS.map(([code, name], index) => {
          const row = mes[code];
          return (
            <button
              key={code}
              onClick={() => {
                moveCamera(CAMERA_STATIONS[index + 1]?.[1] || [36, 1.2, 0]);
                setChatStation({ code, name: localizedStationName(code, locale) });
                setStationPanelTab("live");
                setMemoryQuery("");
                setMemoryResults([]);
                setMemoryError("");
                setMotherboardQuery(mes[code]?.sn || "");
                setMotherboardResult(null);
                setMotherboardError("");
              }}
              style={{
                minWidth: 126,
                padding: "7px 9px",
                textAlign: "left",
                border: `1px solid ${row?.online ? "#22c55e" : "#526473"}`,
                borderRadius: 7,
                background: "#172b36",
                color: "#e8f4f7",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                <span>{localizedStationName(code, locale)}</span>
                <span style={{ color: row?.online ? "#4ade80" : "#94a3b8" }}>
                  ●
                </span>
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "#a9bec8",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                SN {row?.sn || "—"}
              </div>
              <div style={{ fontSize: 10, marginTop: 2 }}>
                <span style={{ color: "#4ade80" }}>P {row?.pass || 0}</span> ·{" "}
                <span style={{ color: "#f87171" }}>NG {row?.ng || 0}</span> ·{" "}
                <span style={{ color: "#fbbf24" }}>D {row?.dup || 0}</span>
              </div>
            </button>
          );
        })}
       </div>
       <button
         type="button"
         onClick={() => {
           moveCamera(REPAIR_CAMERA_TARGET);
           setChatStation({ code: "manu_rework", name: localizedStationName("manu_rework", locale) });
           setSelectedRepairWorkOrder(null);
           setStationPanelTab("live");
           setMotherboardQuery("");
           setMotherboardResult(null);
           setMotherboardError("");
         }}
         style={{ minWidth: 150, padding: "7px 9px", textAlign: "left", border: "1px solid #f59e0b", borderRadius: 7, background: "#422006", color: "#fef3c7", cursor: "pointer" }}
       >
         <div style={{ fontSize: 12, fontWeight: 800 }}>Repair Station</div>
         <div style={{ fontSize: 10, marginTop: 2 }}>OPEN {mes.manu_rework?.repairOpenCount ?? 0} · FINISHED {mes.manu_rework?.repairFinishedCount ?? 0}</div>
       </button>
       <div
         style={{
           display: "none",
          position: "fixed",
          right: 16,
          top: 16,
          bottom: 16,
          width: 310,
          overflow: "auto",
          padding: 12,
          borderRadius: 10,
          background: "rgba(10,25,35,.9)",
          color: "#e8f4f7",
          boxShadow: "0 8px 28px #102b3a66",
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 9 }}>
          MES 手动线实时数据
        </div>
        {MES_STATIONS.map(([code, name]) => {
          const row = mes[code];
          return (
            <div
              key={code}
              style={{
                padding: "8px 9px",
                marginBottom: 6,
                borderRadius: 7,
                background: "rgba(255,255,255,.07)",
                borderLeft: `4px solid ${row?.online ? "#22c55e" : "#64748b"}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                <span>{name}</span>
                <span style={{ color: row?.online ? "#4ade80" : "#94a3b8" }}>
                  {row?.online ? "在线" : "离线"}
                </span>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "#b7cbd4",
                  marginTop: 3,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                SN：{row?.sn || "—"}
              </div>
              <div
                style={{ display: "flex", gap: 12, fontSize: 11, marginTop: 3 }}
              >
                <span style={{ color: "#4ade80" }}>PASS {row?.pass || 0}</span>
                <span style={{ color: "#f87171" }}>NG {row?.ng || 0}</span>
                <span style={{ color: "#fbbf24" }}>DUP {row?.dup || 0}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
// @ts-nocheck
