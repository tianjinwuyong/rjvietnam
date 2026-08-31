import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api";
import { apiClient } from "../api/client";
import { WarehouseQrImage, warehouseAreaQrValue } from "./WarehouseQrImage";
import QRCode from "qrcode";
import * as XLSX from "xlsx";

interface StorageLocation {
  id: number;
  code: string;
  area: string;
  status: string;
  locationType: string;
  name_zh: string;
  name_en: string;
  name_vi: string;
  warehouseCode?: string;
  warehouseType?: string;
  zoneCode?: string;
  zoneId?: number;
  capacityQty?: number;
  lockedReason?: string;
  qrCode?: string;
  shape?: string;
  warehouseId?: number;
  buildingCode?: string;
  floorCode?: string;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  allowReceiving?: boolean;
  allowTransfer?: boolean;
  allowPutaway?: boolean;
  xCoord?: number;
  yCoord?: number;
  coordinateSystem?: string;
  aisleCode?: string;
  rackCode?: string;
  levelCode?: string;
  binCode?: string;
  temperatureMin?: number;
  temperatureMax?: number;
  humidityMin?: number;
  humidityMax?: number;
  msdAllowed?: boolean;
  maxPallets?: number;
  managementOwner?: string;
  managementStatus?: string;
  wmsLocked?: boolean;
}

interface FloorStorageArea {
  areaCode: string;
  areaQr: string;
  areaName: string;
  areaType: string;
  capacity: number;
  occupied: number;
  status: string;
}

interface WarehouseQrRule {
  kind: "AREA" | "LOCATION" | "RACK";
  code: string;
  prefix: string;
  buildingCode: string;
  floorCode: string;
  areaCode: string;
  name: string;
  qrValue: string;
  namingRule: string;
}

interface WarehouseLayoutItem {
  id: string;
  kind: string;
  label: string;
  x: number;
  y: number;
  color: string;
  width?: number;
  height?: number;
  sizeLabel?: string;
  qrCode?: string;
  points?: string;
  rackCode?: string;
  rackColumns?: number;
  rackRows?: number;
  rackLevels?: number;
  maxPallets?: number;
  rackHeightM?: number;
  rackLevelHeightM?: number;
  rackCellQrs?: string[];
  parentId?: string;
  positionQrCode?: string;
  shape?: string;
  aisleCode?: string;
  aisleOrientation?: string;
  aisleBetweenRow?: number;
  aisleBetweenColumn?: number;
  aisleWidthM?: number;
  aisleDepthM?: number;
}

const LAYOUT_TOOLBOX = [
  { kind: "PENCIL", label: "铅笔自由绘制", color: "#0f766e" },
  { kind: "AREA", label: "矩形区域", color: "#334155" },
  { kind: "AREA_GRID", label: "区域网格（X列 × Y行）", color: "#475569" },
  { kind: "RECEIVING", label: "收料区", color: "#0ea5e9" },
  { kind: "IQC", label: "IQC待检区", color: "#8b5cf6" },
  { kind: "GOOD", label: "良品仓库", color: "#16a34a" },
  { kind: "NG", label: "不良品仓库", color: "#dc2626" },
  { kind: "MRB", label: "MRB评审区", color: "#f97316" },
  { kind: "AISLE", label: "通道", color: "#64748b" },
  { kind: "AISLE_H", label: "水平通道", color: "#475569" },
  { kind: "AISLE_V", label: "垂直通道", color: "#334155" },
  { kind: "FORKLIFT", label: "叉车", color: "#f59e0b", sizeLabel: "叉车作业位" },
  { kind: "WORKBENCH", label: "工作台", color: "#92400e", sizeLabel: "工作台" },
  { kind: "COMPUTER", label: "电脑", color: "#475569", sizeLabel: "电脑终端" },
  { kind: "CHAIR", label: "椅子", color: "#7c3aed", sizeLabel: "操作员座椅" },
  { kind: "RACK", label: "货架", color: "#2563eb" },
  { kind: "PALLET", label: "栈板位", color: "#0891b2", sizeLabel: "1.1 × 1.1 m" },
  { kind: "PALLET_GRID", label: "栈板阵列（X列 × Y行）", color: "#0f766e" },
  { kind: "DELETE", label: "删除对象工具", color: "#b91c1c" },
];
const isStorageAreaKind = (kind: string) => kind.startsWith("AREA") || ["RECEIVING", "IQC", "GOOD", "NG", "MRB"].includes(kind);
const TOOL_DIMENSIONS_M: Record<string, { width: number; depth: number; label: string }> = {
  RACK: { width: 2.4, depth: 1.1, label: "2.40 × 1.10 m" },
  FORKLIFT: { width: 1.2, depth: 2.5, label: "1.20 × 2.50 m" },
  WORKBENCH: { width: 1.5, depth: 0.7, label: "1.50 × 0.70 m" },
  COMPUTER: { width: 0.7, depth: 0.7, label: "0.70 × 0.70 m" },
  CHAIR: { width: 0.6, depth: 0.6, label: "0.60 × 0.60 m" },
};

const DEFAULT_WAREHOUSE_LAYOUT: WarehouseLayoutItem[] = [
  { id: "demo-receiving", kind: "RECEIVING", label: "\u6536\u6599\u533a", x: 8, y: 12, width: 20, height: 22, color: "#0ea5e9", qrCode: "WMS-AREA:FL-RECV-01" },
  { id: "demo-iqc", kind: "IQC", label: "IQC\u5f85\u68c0\u533a", x: 32, y: 12, width: 20, height: 22, color: "#8b5cf6", qrCode: "WMS-AREA:FL-IQC-01" },
  { id: "demo-good", kind: "GOOD", label: "\u826f\u54c1\u4ed3\u5e93", x: 56, y: 12, width: 20, height: 22, color: "#16a34a", qrCode: "WMS-AREA:FL-FG-01" },
  { id: "demo-ng", kind: "NG", label: "\u4e0d\u826f\u54c1\u4ed3\u5e93", x: 32, y: 48, width: 20, height: 22, color: "#dc2626", qrCode: "WMS-AREA:FL-IQC-NG" },
  { id: "demo-mrb", kind: "MRB", label: "MRB\u8bc4\u5ba1\u533a", x: 56, y: 48, width: 20, height: 22, color: "#f97316", qrCode: "WMS-AREA:FL-NG-01" },
  { id: "demo-pallet-good-1", kind: "PALLET", label: "托板位 1-1", x: 51, y: 12, width: 5.5, height: 9, color: "#0891b2", sizeLabel: "1.10 × 1.10 m", qrCode: "WMS-PALLET:DEMO-GOOD-001" },
  { id: "demo-pallet-good-2", kind: "PALLET", label: "托板位 1-2", x: 61, y: 12, width: 5.5, height: 9, color: "#0891b2", sizeLabel: "1.10 × 1.10 m", qrCode: "WMS-PALLET:DEMO-GOOD-002" },
  { id: "demo-pallet", kind: "PALLET", label: "\u6837\u4f8b\u6258\u677f\u4f4d", x: 82, y: 18, width: 8, height: 12, color: "#0891b2", sizeLabel: "1.10 \u00d7 1.10 m", qrCode: "WMS-PALLET:DEMO-001" },
  { id: "demo-rack-01", kind: "RACK", label: "默认货架 R-01", x: 78, y: 54, width: 16, height: 10, color: "#2563eb", sizeLabel: "2.40 m 高 · 4 层", qrCode: "WMS-RACK:DEMO-R-01", rackCode: "R-01", rackColumns: 3, rackRows: 1, rackLevels: 4, rackHeightM: 2.4, rackLevelHeightM: 0.6, positionQrCode: "WMS-POSITION:R-01" },
];

export function WmsLocationManagement({ locale }: { locale: Locale }) {
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [floorAreas, setFloorAreas] = useState<FloorStorageArea[]>([]);
  const [editing, setEditing] = useState<StorageLocation | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [layoutItems, setLayoutItems] = useState<WarehouseLayoutItem[]>(() => {
    try {
      const saved = window.localStorage.getItem("wms:warehouse-layout");
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_WAREHOUSE_LAYOUT;
    } catch {
      return DEFAULT_WAREHOUSE_LAYOUT;
    }
  });
  const [toolEdits, setToolEdits] = useState<Record<string, { label?: string; color?: string; hidden?: boolean }>>(() => {
    try { return JSON.parse(window.localStorage.getItem("wms:warehouse-tool-edits") || "{}"); } catch { return {}; }
  });
  useEffect(() => {
    apiClient.get<{ items?: WarehouseLayoutItem[] }>("/api/3d/wms-layout").then((response) => {
      const items = (response as any).items || (response as any).data?.items;
      if (Array.isArray(items) && items.length) setLayoutItems(items);
    }).catch(() => undefined);
  }, []);
  const [customTools, setCustomTools] = useState<Array<{ kind: string; label: string; color: string; sizeLabel?: string }>>(() => {
    try { const value = JSON.parse(window.localStorage.getItem("wms:warehouse-custom-tools") || "[]"); return Array.isArray(value) ? value : []; } catch { return []; }
  });
  const [newToolLabel, setNewToolLabel] = useState("");
  const [showToolConfig, setShowToolConfig] = useState(false);
  const [draggingTool, setDraggingTool] = useState<string | null>(null);
  const [draggingItem, setDraggingItem] = useState<string | null>(null);
  const [selectedLayoutItem, setSelectedLayoutItem] = useState<string | null>(null);
  const [selectedLayoutItems, setSelectedLayoutItems] = useState<string[]>([]);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [selectionPreview, setSelectionPreview] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawPreview, setDrawPreview] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [pencilPoints, setPencilPoints] = useState<Array<{ x: number; y: number }>>([]);
  const objectPointerDownRef = useRef<{ id: string; width: number; height: number } | null>(null);
  const [cadSnapEnabled, setCadSnapEnabled] = useState(true);
  const [cadGridEnabled, setCadGridEnabled] = useState(true);
  const [cadSnapM, setCadSnapM] = useState(0.2);
  const [canvasZoom, setCanvasZoom] = useState(100);
  const layoutCanvasRef = useRef<HTMLDivElement | null>(null);
  const [layoutConfig, setLayoutConfig] = useState({
    warehouseWidthM: 20,
    warehouseDepthM: 12,
    palletWidthM: 1.1,
    palletDepthM: 1.1,
    clearanceM: 0.2,
    aisleClearanceM: 0.05,
    rowGapM: 0.2,
    columnGapM: 0.2,
    palletCountX: 3,
    palletCountY: 2,
    areaShape: "RECTANGLE",
    areaWidthM: 5,
    areaDepthM: 4,
    areaCountX: 2,
    areaCountY: 2,
    aisleWidthM: 0.9,
    aisleDepthM: 6,
    aisleCode: "AISLE-01",
    aisleOrientation: "HORIZONTAL",
    aisleBetweenRow: 2,
    aisleBetweenColumn: 4,
    rackLevels: 4,
    rackColumns: 3,
    rackRows: 1,
    rackHeightM: 2.4,
    rackLevelHeightM: 0.6,
    areaName: "新仓储区域",
    areaCodePrefix: "AREA",
    namingMethod: "ROW_COLUMN",
  });
  const autoPalletAreasRef = useRef<Set<string>>(new Set());
  const areaSizeSnapshotRef = useRef<Record<string, string>>({});
  useEffect(() => {
    const area = layoutItems.find(item => isStorageAreaKind(item.kind) && !autoPalletAreasRef.current.has(item.id) && item.width && item.height);
    if (!area) return;
    const areaWidthM = (area.width || 0) / 100 * layoutConfig.warehouseWidthM;
    const areaDepthM = (area.height || 0) / 100 * layoutConfig.warehouseDepthM;
    const stepX = layoutConfig.palletWidthM + layoutConfig.columnGapM;
    const stepY = layoutConfig.palletDepthM + layoutConfig.rowGapM;
    const countX = Math.max(0, Math.floor(areaWidthM / stepX));
    const countY = Math.max(0, Math.floor(areaDepthM / stepY));
    const left = area.x - (area.width || 0) / 2;
    const top = area.y - (area.height || 0) / 2;
    const existing = layoutItems.filter(candidate => (candidate.kind === "PALLET" || candidate.kind === "PALLET_GRID") && candidate.x >= left && candidate.x <= left + (area.width || 0) && candidate.y >= top && candidate.y <= top + (area.height || 0));
    autoPalletAreasRef.current.add(area.id);
    if (existing.length || !countX || !countY) return;
    const pallets = Array.from({ length: countX * countY }, (_, index) => {
      const row = Math.floor(index / countX);
      const column = index % countX;
      return { kind: "PALLET", label: `${area.label} P${String(row + 1).padStart(2, "0")}-${String(column + 1).padStart(2, "0")}`, id: `PALLET-AUTO-${area.id}-${Date.now()}-${index}`, parentId: area.id, positionQrCode: `WMS-POSITION:${area.id}-R${String(row + 1).padStart(2, "0")}-C${String(column + 1).padStart(2, "0")}`, x: left + ((column + 0.5) * (area.width || 0) / countX), y: top + ((row + 0.5) * (area.height || 0) / countY), width: layoutConfig.palletWidthM / layoutConfig.warehouseWidthM * 100, height: layoutConfig.palletDepthM / layoutConfig.warehouseDepthM * 100, color: "#0891b2", sizeLabel: `${layoutConfig.palletWidthM.toFixed(2)} × ${layoutConfig.palletDepthM.toFixed(2)} m`, qrCode: `WMS-PALLET:${area.id}-${row + 1}-${column + 1}` };
    });
    setLayoutItems(items => [...items, ...pallets]);
  }, [layoutItems, layoutConfig]);
  useEffect(() => {
    const area = layoutItems.find(item => isStorageAreaKind(item.kind) && item.width && item.height && areaSizeSnapshotRef.current[item.id] !== `${item.width}:${item.height}:${layoutItems.filter(child => child.parentId === item.id && child.kind !== "PALLET").map(child => `${child.id}:${child.x}:${child.y}:${child.width}:${child.height}`).join(",")}`);
    if (!area) return;
    areaSizeSnapshotRef.current[area.id] = `${area.width}:${area.height}:${layoutItems.filter(child => child.parentId === area.id && child.kind !== "PALLET").map(child => `${child.id}:${child.x}:${child.y}:${child.width}:${child.height}`).join(",")}`;
    const areaWidthM = (area.width || 0) / 100 * layoutConfig.warehouseWidthM;
    const areaDepthM = (area.height || 0) / 100 * layoutConfig.warehouseDepthM;
    const stepX = layoutConfig.palletWidthM + layoutConfig.columnGapM;
    const stepY = layoutConfig.palletDepthM + layoutConfig.rowGapM;
    const countX = Math.max(0, Math.floor(areaWidthM / stepX));
    const countY = Math.max(0, Math.floor(areaDepthM / stepY));
    const obstacles = layoutItems.filter(item => item.parentId === area.id && item.kind !== "PALLET");
    const left = area.x - (area.width || 0) / 2;
    const top = area.y - (area.height || 0) / 2;
    const clearanceX = layoutConfig.clearanceM / layoutConfig.warehouseWidthM * 100;
    const clearanceY = layoutConfig.clearanceM / layoutConfig.warehouseDepthM * 100;
    const aisleClearanceX = layoutConfig.aisleClearanceM / layoutConfig.warehouseWidthM * 100;
    const aisleClearanceY = layoutConfig.aisleClearanceM / layoutConfig.warehouseDepthM * 100;
    const palletHalfWidth = layoutConfig.palletWidthM / layoutConfig.warehouseWidthM * 100 / 2;
    const palletHalfHeight = layoutConfig.palletDepthM / layoutConfig.warehouseDepthM * 100 / 2;
    const slots = Array.from({ length: countX * countY }, (_, index) => ({ row: Math.floor(index / Math.max(1, countX)), column: index % Math.max(1, countX), x: left + (((index % Math.max(1, countX)) + 0.5) * (area.width || 0) / Math.max(1, countX)), y: top + ((Math.floor(index / Math.max(1, countX)) + 0.5) * (area.height || 0) / Math.max(1, countY)) })).filter(slot => !obstacles.some(obstacle => {
      const obstacleIsAisle = obstacle.kind === "AISLE";
      const obstacleOrientation = obstacle.aisleOrientation === "VERTICAL" ? "VERTICAL" : "HORIZONTAL";
      // Aisle dimensions are always taken from its real meter parameters. This
      // also repairs layouts saved before horizontal/vertical aisles were added.
      const obstacleWidth = obstacleIsAisle
        ? (obstacleOrientation === "VERTICAL" ? (obstacle.aisleWidthM || layoutConfig.aisleWidthM) : (obstacle.aisleDepthM || layoutConfig.aisleDepthM)) / layoutConfig.warehouseWidthM * 100
        : (obstacle.width || 0);
      const obstacleHeight = obstacleIsAisle
        ? (obstacleOrientation === "HORIZONTAL" ? (obstacle.aisleWidthM || layoutConfig.aisleWidthM) : (obstacle.aisleDepthM || layoutConfig.aisleDepthM)) / layoutConfig.warehouseDepthM * 100
        : (obstacle.height || 0);
      const obstacleClearanceX = obstacleIsAisle ? aisleClearanceX : clearanceX;
      const obstacleClearanceY = obstacleIsAisle ? aisleClearanceY : clearanceY;
      return Math.abs(slot.x - obstacle.x) < palletHalfWidth + obstacleWidth / 2 + obstacleClearanceX && Math.abs(slot.y - obstacle.y) < palletHalfHeight + obstacleHeight / 2 + obstacleClearanceY;
    }));
    const total = slots.length;
    setLayoutItems(items => {
      const children = items.filter(item => item.parentId === area.id && item.kind === "PALLET");
      const next = items.filter(item => item.parentId !== area.id || item.kind !== "PALLET").concat(children.slice(0, total).map((child, index) => {
        const slot = slots[index];
        const row = slot?.row ?? 0;
        const column = slot?.column ?? index;
        return { ...child, x: slot?.x ?? child.x, y: slot?.y ?? child.y, label: `${area.label} P${String(row + 1).padStart(2, "0")}-${String(column + 1).padStart(2, "0")}` };
      }));
      const missing = Array.from({ length: Math.max(0, total - children.length) }, (_, index) => {
        const slot = slots[children.length + index];
        const row = slot?.row ?? 0;
        const column = slot?.column ?? index;
        return { kind: "PALLET", label: `${area.label} P${String(row + 1).padStart(2, "0")}-${String(column + 1).padStart(2, "0")}`, id: `PALLET-AUTO-${area.id}-${Date.now()}-${index}`, parentId: area.id, x: slot?.x ?? area.x, y: slot?.y ?? area.y, width: layoutConfig.palletWidthM / layoutConfig.warehouseWidthM * 100, height: layoutConfig.palletDepthM / layoutConfig.warehouseDepthM * 100, color: "#0891b2", sizeLabel: `${layoutConfig.palletWidthM.toFixed(2)} × ${layoutConfig.palletDepthM.toFixed(2)} m`, qrCode: `WMS-PALLET:${area.id}-${row + 1}-${column + 1}` };
      });
      return [...next, ...missing];
    });
  }, [layoutItems, layoutConfig]);
  const blankForm = { code: "", qrCode: "", area: "", nameZh: "", nameEn: "", nameVi: "", warehouseId: "", buildingCode: "B01", floorCode: "F01", zoneId: "", locationType: "STANDARD", capacityQty: "", lengthCm: "", widthCm: "", heightCm: "", xCoord: "", yCoord: "", coordinateSystem: "WAREHOUSE_MAP", aisleCode: "", rackCode: "", levelCode: "", binCode: "", temperatureMin: "", temperatureMax: "", humidityMin: "", humidityMax: "", maxPallets: "", status: "active", lockedReason: "", managementOwner: "WMS", managementStatus: "DRAFT", wmsLocked: false, allowReceiving: true, allowTransfer: true, allowPutaway: true, msdAllowed: true };
  const [form, setForm] = useState(blankForm);
  useEffect(() => {
    const handleLayoutShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (!selectedLayoutItem) return;
      const isArrowKey = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key);
      if (!event.ctrlKey && !isArrowKey) return;
      const source = layoutItems.find(item => item.id === selectedLayoutItem);
      if (!source) return;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        const multiplier = event.shiftKey ? 5 : 1;
        const stepX = (cadSnapM / Math.max(0.1, layoutConfig.warehouseWidthM)) * 100 * multiplier;
        const stepY = (cadSnapM / Math.max(0.1, layoutConfig.warehouseDepthM)) * 100 * multiplier;
        const dx = event.key === "ArrowLeft" ? -stepX : event.key === "ArrowRight" ? stepX : 0;
        const dy = event.key === "ArrowUp" ? -stepY : event.key === "ArrowDown" ? stepY : 0;
        setLayoutItems(items => items.map(item => item.id === selectedLayoutItem || item.parentId === selectedLayoutItem ? { ...item, x: Math.max(1, Math.min(99, item.x + dx)), y: Math.max(1, Math.min(99, item.y + dy)) } : item));
        return;
      }
      if (event.key.toLowerCase() === "d") {
        event.preventDefault();
        const copy = { ...source, id: `${source.kind}-copy-${Date.now()}`, label: `${source.label} 副本`, x: Math.min(96, source.x + 3), y: Math.min(94, source.y + 3), qrCode: source.kind.startsWith("AREA") ? `WMS-AREA:${makeAreaIdentity(1, 1, Math.min(96, source.x + 3), Math.min(94, source.y + 3)).code}` : source.qrCode };
        setLayoutItems(items => [...items, copy]);
        setSelectedLayoutItem(copy.id);
      }
      if (event.key.toLowerCase() === "x") {
        event.preventDefault();
        const idsToDelete = selectedLayoutItems.length > 1 ? selectedLayoutItems : [selectedLayoutItem];
        setLayoutItems(items => items.filter(item => !idsToDelete.includes(item.id)));
        setSelectedLayoutItem(null);
        setSelectedLayoutItems([]);
      }
    };
    window.addEventListener("keydown", handleLayoutShortcut);
    return () => window.removeEventListener("keydown", handleLayoutShortcut);
  }, [layoutItems, selectedLayoutItem]);
  const [areaQrCode, setAreaQrCode] = useState("");
  const [areaQrPreview, setAreaQrPreview] = useState("");
  const [qrObjectType, setQrObjectType] = useState<"AREA" | "LOCATION" | "RACK">("AREA");
  const [qrTemplateStatus, setQrTemplateStatus] = useState("");
  const [layoutSaveStatus, setLayoutSaveStatus] = useState("");
  const [layoutQrPrinted, setLayoutQrPrinted] = useState(false);
  const [focusedAreaId, setFocusedAreaId] = useState<string | null>(null);
  const [wmsManagementStatus, setWmsManagementStatus] = useState(() => window.localStorage.getItem("wms:warehouse-management-status") || "DRAFT");
  const canCancelWmsManagement = ["admin", "management", "warehouse_manager", "wms_admin"].includes(String(sessionStorage.getItem("user_role") || sessionStorage.getItem("role") || "").toLowerCase());
  const [qrPrintSettings, setQrPrintSettings] = useState<{ labelWidthMm: number; labelHeightMm: number; columns: number; qrSizeMm: number; marginMm: number; copies: number; fromIndex: number; toIndex: number; showName: boolean; showCode: boolean }>(() => {
    const defaults = { labelWidthMm: 60, labelHeightMm: 40, columns: 3, qrSizeMm: 30, marginMm: 4, copies: 1, fromIndex: 1, toIndex: 0, showName: true, showCode: true };
    try { return { ...defaults, ...JSON.parse(window.localStorage.getItem("wms:qr-print-settings") || "{}")} ; } catch { return defaults; }
  });

  useEffect(() => {
    wmsApi.getStorageLocations({ limit: 500 }).then((r: any) => {
      setLocations(r.items ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    window.localStorage.setItem("wms:warehouse-layout", JSON.stringify(layoutItems));
  }, [layoutItems]);
  useEffect(() => { window.localStorage.setItem("wms:warehouse-tool-edits", JSON.stringify(toolEdits)); }, [toolEdits]);
  useEffect(() => { window.localStorage.setItem("wms:warehouse-custom-tools", JSON.stringify(customTools)); }, [customTools]);
  useEffect(() => { window.localStorage.setItem("wms:qr-print-settings", JSON.stringify(qrPrintSettings)); }, [qrPrintSettings]);

  const addPositionQrs = (items: WarehouseLayoutItem[]) => items.map((item) => {
    if (item.kind === "DELETE" || item.kind === "PENCIL" || item.kind === "FREEFORM") return item;
    const scope = item.parentId || "ROOT";
    if (item.kind === "RACK") {
      const rackCode = item.rackCode || item.id;
      const cellQrs = Array.from({ length: Math.max(1, (item.rackLevels || 4) * (item.rackRows || 1) * (item.rackColumns || 3)) }, (_, index) => {
        const columns = Math.max(1, item.rackColumns || 3);
        const rows = Math.max(1, item.rackRows || 1);
        const level = Math.floor(index / (rows * columns)) + 1;
        const row = Math.floor((index % (rows * columns)) / columns) + 1;
        const column = (index % columns) + 1;
        return `WMS-POSITION:${rackCode}:L${String(level).padStart(2, "0")}-R${String(row).padStart(2, "0")}-C${String(column).padStart(2, "0")}`;
      });
      return { ...item, rackCode, positionQrCode: item.positionQrCode || `WMS-POSITION:${scope}:RACK:${rackCode}`, rackCellQrs: item.rackCellQrs?.length === cellQrs.length ? item.rackCellQrs : cellQrs };
    }
    return item.positionQrCode ? item : { ...item, positionQrCode: `WMS-POSITION:${scope}:${item.kind}:${item.id}` };
  });

  const generatePositionQrs = () => {
    const nextItems = addPositionQrs(layoutItems);
    setLayoutItems(nextItems);
    setLayoutQrPrinted(false);
    const generated = nextItems.filter((item, index) => !layoutItems[index]?.positionQrCode && item.positionQrCode).length;
    setLayoutSaveStatus(`已生成 ${generated} 个位置 QR`);
    window.setTimeout(() => setLayoutSaveStatus(""), 2400);
  };

  const printLayoutQrs = async (areaId?: string) => {
    const nextItems = addPositionQrs(layoutItems);
    setLayoutItems(nextItems);
    const scopedItems = areaId ? nextItems.filter(item => item.id === areaId || item.parentId === areaId) : nextItems;
    const values = [...new Set(scopedItems.flatMap(item => [item.qrCode, item.positionQrCode, ...(item.rackCellQrs || [])].filter(Boolean) as string[]))];
    if (!values.length) { setLayoutSaveStatus("请先创建区域、货架或库位对象"); return; }
    const popup = window.open("", "wms-layout-qr-print", "width=900,height=800");
    if (!popup) { setLayoutSaveStatus("浏览器阻止了打印预览，请允许弹出窗口"); return; }
    const copies = Math.max(1, Math.min(100, Math.round(qrPrintSettings.copies)));
    const first = Math.max(1, Math.round(qrPrintSettings.fromIndex || 1));
    const last = Math.round(qrPrintSettings.toIndex || 0);
    const selectedValues = last > 0 ? values.slice(first - 1, last) : values.slice(first - 1);
    const printValues = selectedValues.flatMap(value => Array.from({ length: copies }, () => value));
    const qrPixels = Math.max(160, Math.round(qrPrintSettings.qrSizeMm * 8));
    const cards = await Promise.all(printValues.map(async value => `<article><img src="${await QRCode.toDataURL(value, { width: qrPixels, margin: 2, errorCorrectionLevel: "M" })}"/>${qrPrintSettings.showCode ? `<strong>${value}</strong>` : ""}</article>`));
    popup.document.write(`<html><head><title>WMS 仓库区域 QR 标签</title><style>body{font-family:Arial;padding:20px}main{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}article{border:1px solid #94a3b8;padding:10px;text-align:center;break-inside:avoid}img{width:220px;height:220px;image-rendering:pixelated}strong{display:block;font-size:12px;word-break:break-all;margin-top:8px}@media print{button{display:none}}</style></head><body><h2>${layoutConfig.areaName || "仓库区域"} · 区域/库位 QR 标签</h2><p>共 ${values.length} 个 QR；包含区域、位置、货架和货架格口。</p><main>${cards.join("")}</main><button onclick="window.print()">打印全部 QR</button></body></html>`);
    popup.document.head?.insertAdjacentHTML("beforeend", `<style>@page{size:${qrPrintSettings.labelWidthMm}mm ${qrPrintSettings.labelHeightMm}mm;margin:0}body{padding:8mm}main{grid-template-columns:repeat(${Math.max(1, Math.min(8, Math.round(qrPrintSettings.columns)))},${qrPrintSettings.labelWidthMm}mm)!important;gap:3mm!important}article{width:${qrPrintSettings.labelWidthMm}mm!important;height:${qrPrintSettings.labelHeightMm}mm!important;padding:${qrPrintSettings.marginMm}mm!important}img{width:${qrPrintSettings.qrSizeMm}mm!important;height:${qrPrintSettings.qrSizeMm}mm!important}</style>`);
    popup.document.close(); popup.focus();
    setLayoutQrPrinted(true);
    setLayoutSaveStatus(`已生成并打开 ${values.length} 个 QR 打印预览；确认打印后可保存布局`);
  };

  const saveWarehouseLayout = async () => {
    if (!layoutQrPrinted && !window.confirm("尚未完成 QR 打印预览，确定仍要保存吗？")) return;
    const nextItems = addPositionQrs(layoutItems);
    setLayoutItems(nextItems);
    window.localStorage.setItem("wms:warehouse-layout", JSON.stringify(nextItems));
  window.localStorage.setItem("wms:warehouse-layout-config", JSON.stringify(layoutConfig));
    try { await apiClient.post("/api/3d/wms-layout", { items: nextItems, config: layoutConfig });
   const areasToSync = nextItems.filter(item => isStorageAreaKind(item.kind) && item.qrCode); await Promise.all(areasToSync.map(area => { const width = (area.width || 0) / 100 * layoutConfig.warehouseWidthM; const depth = (area.height || 0) / 100 * layoutConfig.warehouseDepthM; const x = area.x / 100 * layoutConfig.warehouseWidthM - layoutConfig.warehouseWidthM / 2; const z = area.y / 100 * layoutConfig.warehouseDepthM - layoutConfig.warehouseDepthM / 2; const polygon = [[x - width / 2, z - depth / 2], [x + width / 2, z - depth / 2], [x + width / 2, z + depth / 2], [x - width / 2, z + depth / 2]]; const capacity = nextItems.filter(child => child.parentId === area.id && (child.kind === "PALLET" || child.kind === "PALLET_GRID")).length; return apiClient.post("/api/3d/wms-floor-storage-areas", { areaCode: area.qrCode!.replace(/^WMS-AREA:/, ""), areaQr: area.qrCode, areaName: area.label, areaType: area.kind, polygon, capacity, occupied: 0, status: "AVAILABLE", sourceLayout: "WMS warehouse canvas" }); })); setLayoutSaveStatus(areasToSync.length ? `已同步 ${areasToSync.length} 个区域及其 QR 到 WMS` : `已生成位置 QR 并保存 ${nextItems.length} 个布局对象`); } catch (error) { setLayoutSaveStatus(`布局已保存，但 WMS 区域同步失败：${error instanceof Error ? error.message : "请检查权限或 API"}`); }
    window.setTimeout(() => setLayoutSaveStatus(""), 2400);
  };

  const resetWarehouseLayout = () => {
    if (!window.confirm("确定恢复默认仓库布局吗？当前画布对象将被替换。")) return;
    setLayoutItems(DEFAULT_WAREHOUSE_LAYOUT.map(item => ({ ...item })));
    setSelectedLayoutItem(null);
    setDraggingTool(null);
    setDraggingItem(null);
    setPencilPoints([]);
    setDrawStart(null);
    setDrawPreview(null);
    setLayoutSaveStatus("已恢复默认画布");
    window.setTimeout(() => setLayoutSaveStatus(""), 2400);
  };

  const createQuickWarehouse = () => {
    const now = Date.now();
    const id = `AREA-QUICK-${now}`;
    const width = Math.max(8, Math.min(90, layoutConfig.areaWidthM / Math.max(0.1, layoutConfig.warehouseWidthM) * 100));
    const height = Math.max(8, Math.min(90, layoutConfig.areaDepthM / Math.max(0.1, layoutConfig.warehouseDepthM) * 100));
    const area: WarehouseLayoutItem = { id, kind: "AREA", label: layoutConfig.areaName || "新仓库区域", x: 50, y: 50, width, height, color: "#334155", shape: layoutConfig.areaShape, qrCode: `WMS-AREA:${layoutConfig.areaCodePrefix || "AREA"}-${now}`, sizeLabel: layoutConfig.areaShape === "CIRCLE" ? `R ${(layoutConfig.areaWidthM / 2).toFixed(2)} m` : `${layoutConfig.areaWidthM.toFixed(2)} × ${layoutConfig.areaDepthM.toFixed(2)} m` };
    const aisleIsVertical = layoutConfig.aisleOrientation === "VERTICAL";
    const aisle: WarehouseLayoutItem = { id: `AISLE-QUICK-${now}`, kind: "AISLE", label: layoutConfig.aisleCode, x: 50, y: 50, width: (aisleIsVertical ? layoutConfig.aisleWidthM : layoutConfig.aisleDepthM) / layoutConfig.warehouseWidthM * 100, height: (aisleIsVertical ? layoutConfig.aisleDepthM : layoutConfig.aisleWidthM) / layoutConfig.warehouseDepthM * 100, color: "#64748b", parentId: id, aisleCode: layoutConfig.aisleCode, aisleOrientation: layoutConfig.aisleOrientation, aisleBetweenRow: layoutConfig.aisleBetweenRow, aisleBetweenColumn: layoutConfig.aisleBetweenColumn, aisleWidthM: layoutConfig.aisleWidthM, aisleDepthM: layoutConfig.aisleDepthM, sizeLabel: `${layoutConfig.aisleWidthM.toFixed(2)} m 宽 × ${layoutConfig.aisleDepthM.toFixed(2)} m 长` };
    const rack: WarehouseLayoutItem = { id: `RACK-QUICK-${now}`, kind: "RACK", label: "R-01", x: 50, y: 35, width: 2.4 / layoutConfig.warehouseWidthM * 100, height: 1.1 / layoutConfig.warehouseDepthM * 100, color: "#2563eb", parentId: id, rackCode: "R-01", rackColumns: layoutConfig.rackColumns, rackRows: layoutConfig.rackRows, rackLevels: layoutConfig.rackLevels, rackHeightM: layoutConfig.rackHeightM, rackLevelHeightM: layoutConfig.rackLevelHeightM, sizeLabel: `${layoutConfig.rackHeightM.toFixed(2)} m 高 · ${layoutConfig.rackLevels} 层 · ${layoutConfig.rackColumns}列 × ${layoutConfig.rackRows}排` };
    setLayoutItems(addPositionQrs([area, aisle, rack]));
    setSelectedLayoutItem(id);
    setSelectedLayoutItems([id]);
    setLayoutSaveStatus("已创建仓库区域，托板将自动布置");
    window.setTimeout(() => setLayoutSaveStatus(""), 2400);
  };

  useEffect(() => {
    apiClient.get<{ floorAreas: FloorStorageArea[] }>("/api/3d/wms-control-state")
      .then((r) => setFloorAreas(r.floorAreas ?? []))
      .catch(() => setFloorAreas([]));
  }, []);

  const langKey = `name_${locale.slice(0, 2)}` as "name_zh" | "name_en" | "name_vi";
  const areas = [...new Set([
    ...locations.map((l) => l.area).filter(Boolean),
    ...floorAreas.flatMap((item) => [item.areaCode, item.areaName]).filter(Boolean),
  ])].sort();
  const namedAreaTools = [
    ...floorAreas.map((area) => ({ kind: `AREA:${area.areaCode}`, label: toolEdits[`AREA:${area.areaCode}`]?.label || area.areaName || area.areaCode, color: toolEdits[`AREA:${area.areaCode}`]?.color || "#334155" })),
    ...areas
      .filter((area) => !floorAreas.some((item) => item.areaCode === area || item.areaName === area))
      .map((area) => ({ kind: `AREA:${area}`, label: toolEdits[`AREA:${area}`]?.label || area, color: toolEdits[`AREA:${area}`]?.color || "#475569" })),
  ];
  const configuredTools = [...LAYOUT_TOOLBOX, ...customTools]
    .map(tool => ({ ...tool, ...(toolEdits[tool.kind] || {}) }))
    .filter(tool => !toolEdits[tool.kind]?.hidden || ["PALLET", "PALLET_GRID", "AISLE"].includes(tool.kind));
  const layoutTools = [...configuredTools, ...namedAreaTools].sort((a, b) => {
    const priority = (kind: string) => kind === "PALLET" ? 0 : kind === "PALLET_GRID" ? 1 : kind.startsWith("AREA") ? 2 : kind === "AISLE" ? 3 : 4;
    return priority(a.kind) - priority(b.kind);
  });
  const visibleAreas: FloorStorageArea[] = [
    ...floorAreas,
    ...layoutItems
      .filter(item => item.kind.startsWith("AREA") && item.qrCode)
      .map(item => ({
        areaCode: item.qrCode!.replace(/^WMS-AREA:/, ""), areaQr: item.qrCode!, areaName: item.label,
        areaType: item.kind, capacity: 0, occupied: 0, status: "LAYOUT_ONLY",
      })),
  ].filter((area, index, list) => list.findIndex(candidate => candidate.areaCode === area.areaCode) === index);
  const makeAreaIdentity = (row: number, column: number, x: number, y: number) => {
    const prefix = layoutConfig.areaCodePrefix.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "") || "AREA";
    const suffix = layoutConfig.namingMethod === "SEQUENTIAL"
      ? String((row - 1) * Math.max(1, layoutConfig.areaCountX) + column).padStart(3, "0")
      : layoutConfig.namingMethod === "COORDINATE"
        ? `X${x.toFixed(1)}-Y${y.toFixed(1)}`
        : `R${row}-C${column}`;
    return { label: `${layoutConfig.areaName || "区域"} ${suffix}`, code: `${prefix}-${suffix}` };
  };

  const filtered = locations.filter((l) => {
    const matchText = !filter || l.code.toLowerCase().includes(filter.toLowerCase()) || (l.name_zh ?? "").includes(filter);
    const matchArea = !areaFilter || l.area === areaFilter;
    return matchText && matchArea;
  });

  const statusBadge = (s: string) => s === "active" ? "ok" : s === "full" ? "warning" : "muted";
  const openCreate = () => { setEditing(null); setForm(blankForm); setShowForm(true); };
  const openEdit = (loc: StorageLocation) => {
    setEditing(loc);
    setForm({ ...blankForm, code: loc.code || "", qrCode: loc.qrCode || "", area: loc.area || "", nameZh: loc.name_zh || "", nameEn: loc.name_en || "", nameVi: loc.name_vi || "", warehouseId: String(loc.warehouseId || ""), buildingCode: loc.buildingCode || "B01", floorCode: loc.floorCode || "F01", zoneId: String(loc.zoneId || ""), locationType: loc.locationType || "STANDARD", capacityQty: String(loc.capacityQty || ""), lengthCm: String(loc.lengthCm || ""), widthCm: String(loc.widthCm || ""), heightCm: String(loc.heightCm || ""), xCoord: String(loc.xCoord ?? ""), yCoord: String(loc.yCoord ?? ""), coordinateSystem: loc.coordinateSystem || "WAREHOUSE_MAP", aisleCode: loc.aisleCode || "", rackCode: loc.rackCode || "", levelCode: loc.levelCode || "", binCode: loc.binCode || "", temperatureMin: String(loc.temperatureMin ?? ""), temperatureMax: String(loc.temperatureMax ?? ""), humidityMin: String(loc.humidityMin ?? ""), humidityMax: String(loc.humidityMax ?? ""), maxPallets: String(loc.maxPallets ?? ""), status: loc.status || "active", lockedReason: loc.lockedReason || "", allowReceiving: loc.allowReceiving !== false, allowTransfer: loc.allowTransfer !== false, allowPutaway: loc.allowPutaway !== false, msdAllowed: loc.msdAllowed !== false });
    setShowForm(true);
  };
  const saveLocation = async () => {
    setSaving(true);
    try {
      const generatedQr = form.qrCode || `WMS-POSITION:${form.warehouseId || "WH"}:${form.buildingCode || "B01"}:${form.floorCode || "F01"}:${form.area}:${form.code}`;
      const payload = { ...form, qrCode: generatedQr, warehouseId: form.warehouseId ? Number(form.warehouseId) : undefined, zoneId: form.zoneId ? Number(form.zoneId) : undefined, capacityQty: form.capacityQty ? Number(form.capacityQty) : undefined, lengthCm: form.lengthCm ? Number(form.lengthCm) : undefined, widthCm: form.widthCm ? Number(form.widthCm) : undefined, heightCm: form.heightCm ? Number(form.heightCm) : undefined };
      const response = editing ? await apiClient.patch(`/wms/storage-locations/${editing.id}`, payload) : await apiClient.post(`/wms/storage-locations`, payload);
      const saved = (response as any).item || response;
      setLocations((current) => editing ? current.map((item) => item.id === editing.id ? { ...item, ...saved } : item) : [...current, saved]);
      setShowForm(false);
    } finally { setSaving(false); }
  };

  const generateAreaQr = () => {
    const code = areaQrCode.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "-");
    if (code) {
      let templateRule: WarehouseQrRule | undefined;
      try { templateRule = (JSON.parse(localStorage.getItem("wms:qr-rules-template") || "[]") as WarehouseQrRule[]).find(row => row.kind === qrObjectType && row.code === code); } catch { templateRule = undefined; }
      const defaultPrefix = qrObjectType === "AREA" ? "WMS-AREA" : qrObjectType === "LOCATION" ? "WMS-POSITION" : "WMS-RACK";
      const hierarchy = templateRule
        ? [templateRule.prefix || defaultPrefix, templateRule.buildingCode, templateRule.floorCode, templateRule.areaCode, qrObjectType === "AREA" ? "" : templateRule.code].filter(Boolean).join(":")
        : `${defaultPrefix}:${code}`;
      setAreaQrPreview(/^WMS-(AREA|LOC|POSITION|RACK):/i.test(areaQrCode.trim()) ? areaQrCode.trim().toUpperCase() : templateRule?.qrValue || hierarchy);
    }
  };

  const printAreaQr = async () => {
    if (!areaQrPreview) return;
    const image = await QRCode.toDataURL(areaQrPreview, { width: 360, margin: 2, errorCorrectionLevel: "M" });
    const popup = window.open("", "wms-qr-preview", "width=520,height=680");
    if (!popup) return;
    popup.document.write(`<html><head><title>WMS QR Preview</title><style>body{font-family:Arial;text-align:center;padding:28px}img{width:360px;height:360px;image-rendering:pixelated}.code{font-size:20px;margin-top:18px;font-weight:700;word-break:break-all}@media print{button{display:none}}</style></head><body><h2>${qrObjectType === "AREA" ? "库区 QR" : "货架 QR"}</h2><img src="${image}" alt="QR"><div class="code">${areaQrPreview}</div><button onclick="window.print()">打印</button></body></html>`);
    popup.document.close();
  };

  const downloadQrTemplate = () => {
    const rows = [
      { qrType: "AREA", buildingCode: "B01", floorCode: "F01", areaCode: "RAW-E", code: "RAW-E", qrPrefix: "WMS-AREA", qrValue: "WMS-AREA:B01:F01:RAW-E", nameZh: "原材料仓储区 E", namingRule: "PREFIX:BUILDING:FLOOR:AREA" },
      { qrType: "LOCATION", buildingCode: "B01", floorCode: "F01", areaCode: "RAW-E", code: "P01-01", qrPrefix: "WMS-POSITION", qrValue: "WMS-POSITION:B01:F01:RAW-E:P01-01", nameZh: "原材料仓储区 E 位置 P01-01", namingRule: "PREFIX:BUILDING:FLOOR:AREA:POSITION" },
      { qrType: "RACK", buildingCode: "B01", floorCode: "F01", areaCode: "RAW-E", code: "R01", qrPrefix: "WMS-RACK", qrValue: "WMS-RACK:B01:F01:RAW-E:R01", nameZh: "原材料仓储区 E 货架 R01", namingRule: "PREFIX:BUILDING:FLOOR:AREA:RACK" },
    ];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), "QR_RULES");
    XLSX.writeFile(book, "wms_qr_rules_template.xlsx");
  };

  const importQrTemplate = async (file?: File) => {
    if (!file) return;
    try {
      const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = book.Sheets["QR_RULES"] || book.Sheets[book.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const valid = rows.filter(row => String(row.code || "").trim() && String(row.qrType || row.type || "").trim());
      if (!valid.length) throw new Error("模板没有有效的 qrType / code 数据");
      const imported: WarehouseQrRule[] = valid.map(row => {
        const kind = String(row.qrType || row.type).trim().toUpperCase() as WarehouseQrRule["kind"];
        if (!(["AREA", "LOCATION", "RACK"] as string[]).includes(kind)) throw new Error(`不支持的 qrType：${kind}`);
        const code = String(row.code).trim().toUpperCase();
        const buildingCode = String(row.buildingCode || row.building || "").trim().toUpperCase();
        const floorCode = String(row.floorCode || row.floor || "").trim().toUpperCase();
        const areaCode = String(row.areaCode || (kind === "AREA" ? code : "")).trim().toUpperCase();
        if (!buildingCode || !floorCode || !areaCode) throw new Error(`${kind}/${code} 缺少 buildingCode、floorCode 或 areaCode`);
        const prefix = String(row.qrPrefix || row.prefix || (kind === "AREA" ? "WMS-AREA" : kind === "LOCATION" ? "WMS-POSITION" : "WMS-RACK")).trim().toUpperCase();
        const qrValue = String(row.qrValue || [prefix, buildingCode, floorCode, areaCode, kind === "AREA" ? "" : code].filter(Boolean).join(":")).trim().toUpperCase();
        return { kind, code, prefix, buildingCode, floorCode, areaCode, name: String(row.nameZh || row.name || ""), qrValue, namingRule: String(row.namingRule || "PREFIX:BUILDING:FLOOR:AREA:CODE") };
      });
      const duplicate = imported.find((rule, index) => imported.findIndex(candidate => candidate.qrValue === rule.qrValue) !== index);
      if (duplicate) throw new Error(`QR重复：${duplicate.qrValue}`);
      localStorage.setItem("wms:qr-rules-template", JSON.stringify(imported));
      setQrTemplateStatus(`已导入 ${imported.length} 条分层 QR 规则（建筑/楼层/区域/位置）；下次生成将优先使用模板。`);
    } catch (error) { setQrTemplateStatus(error instanceof Error ? error.message : String(error)); }
  };

  const placeLayoutItem = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(2, Math.min(96, ((event.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(4, Math.min(92, ((event.clientY - rect.top) / rect.height) * 100));
    if (draggingTool === "DELETE") {
      setLayoutItems((items) => {
        let nearest = -1;
        let nearestDistance = 7;
        items.forEach((item, index) => {
          const distance = Math.hypot(item.x - x, item.y - y);
          if (distance < nearestDistance) { nearest = index; nearestDistance = distance; }
        });
        return nearest >= 0 ? items.filter((_, index) => index !== nearest) : items;
      });
    } else if (draggingItem) {
      setLayoutItems((items) => {
        const source = items.find(item => item.id === draggingItem);
        if (!source) return items;
        const dx = x - source.x;
        const dy = y - source.y;
        const movedX = source.x + dx;
        const movedY = source.y + dy;
        const targetArea = isStorageAreaKind(source.kind) ? undefined : items.find(candidate => isStorageAreaKind(candidate.kind) && movedX >= candidate.x - (candidate.width || 0) / 2 && movedX <= candidate.x + (candidate.width || 0) / 2 && movedY >= candidate.y - (candidate.height || 0) / 2 && movedY <= candidate.y + (candidate.height || 0) / 2);
        return items.map(item => item.id === draggingItem || item.parentId === draggingItem ? { ...item, x: item.x + dx, y: item.y + dy, ...(item.id === draggingItem && targetArea ? { parentId: targetArea.id } : {}) } : item);
      });
    } else if (draggingTool) {
      const tool = layoutTools.find((item) => item.kind === draggingTool);
      if (tool?.kind === "PALLET" || tool?.kind === "PALLET_GRID") {
        const { warehouseWidthM, warehouseDepthM, palletWidthM, palletDepthM, clearanceM, palletCountX, palletCountY } = layoutConfig;
        const stepX = palletWidthM + layoutConfig.columnGapM;
        const stepY = palletDepthM + layoutConfig.rowGapM;
        const palletWidth = Math.max(2, Math.min(25, (palletWidthM / warehouseWidthM) * 100));
        const palletHeight = Math.max(2, Math.min(25, (palletDepthM / warehouseDepthM) * 100));
        const startX = x - ((palletCountX - 1) * stepX / warehouseWidthM * 100) / 2;
        const startY = y - ((palletCountY - 1) * stepY / warehouseDepthM * 100) / 2;
        const now = Date.now();
        const pallets = Array.from({ length: palletCountX * palletCountY }, (_, index) => {
          const row = Math.floor(index / palletCountX);
          const column = index % palletCountX;
          return {
            ...tool,
            id: `${tool.kind}-${now}-${row + 1}-${column + 1}`,
            label: `栈板位 ${row + 1}-${column + 1}`,
            x: Math.max(2, Math.min(98, startX + (column * stepX / warehouseWidthM * 100))),
            y: Math.max(4, Math.min(96, startY + (row * stepY / warehouseDepthM * 100))),
            width: palletWidth,
            height: palletHeight,
            sizeLabel: `${palletWidthM.toFixed(2)} × ${palletDepthM.toFixed(2)} m | 净距 ${clearanceM.toFixed(2)} m/侧`,
          };
        });
        setLayoutItems((items) => [...items, ...pallets]);
      } else if (tool?.kind === "AREA_GRID") {
        const { warehouseWidthM, warehouseDepthM, areaWidthM, areaDepthM, clearanceM, areaCountX, areaCountY } = layoutConfig;
        const tileWidthM = layoutConfig.areaShape === "CIRCLE" ? areaWidthM * 2 : areaWidthM;
        const tileHeightM = layoutConfig.areaShape === "CIRCLE" ? areaDepthM * 2 : areaDepthM;
        const tileWidth = Math.max(4, Math.min(35, (tileWidthM / warehouseWidthM) * 100));
        const tileHeight = Math.max(4, Math.min(35, (tileHeightM / warehouseDepthM) * 100));
        const stepX = (areaWidthM + layoutConfig.columnGapM) / warehouseWidthM * 100;
        const stepY = (areaDepthM + layoutConfig.rowGapM) / warehouseDepthM * 100;
        const startX = x - ((areaCountX - 1) * stepX) / 2;
        const startY = y - ((areaCountY - 1) * stepY) / 2;
        const now = Date.now();
        const tiles = Array.from({ length: areaCountX * areaCountY }, (_, index) => {
          const row = Math.floor(index / areaCountX);
          const column = index % areaCountX;
          const cellX = Math.max(2, Math.min(98, startX + column * stepX));
          const cellY = Math.max(4, Math.min(96, startY + row * stepY));
          const identity = makeAreaIdentity(row + 1, column + 1, cellX, cellY);
          return { ...tool, id: `${tool.kind}-${now}-${row + 1}-${column + 1}`, label: identity.label, qrCode: `WMS-AREA:${identity.code}`, shape: layoutConfig.areaShape, x: cellX, y: cellY, width: tileWidth, height: tileHeight, sizeLabel: layoutConfig.areaShape === "CIRCLE" ? `R ${areaWidthM.toFixed(2)} m` : `${areaWidthM.toFixed(2)} × ${areaDepthM.toFixed(2)} m` };
        });
        setLayoutItems((items) => [...items, ...tiles]);
      } else if (tool) {
        const isArea = tool.kind.startsWith("AREA");
        const isAisle = tool.kind === "AISLE" || tool.kind === "AISLE_H" || tool.kind === "AISLE_V";
        const aisleOrientation = tool.kind === "AISLE_H" ? "HORIZONTAL" : tool.kind === "AISLE_V" ? "VERTICAL" : layoutConfig.aisleOrientation;
        const toolDimensions = TOOL_DIMENSIONS_M[tool.kind];
        const objectWidthM = isArea
          ? (layoutConfig.areaShape === "CIRCLE" ? layoutConfig.areaWidthM * 2 : layoutConfig.areaWidthM)
          : isAisle
            ? (aisleOrientation === "HORIZONTAL" ? layoutConfig.aisleDepthM : layoutConfig.aisleWidthM)
            : toolDimensions?.width;
        const objectDepthM = isArea
          ? (layoutConfig.areaShape === "CIRCLE" ? layoutConfig.areaDepthM * 2 : layoutConfig.areaDepthM)
          : isAisle
            ? (aisleOrientation === "HORIZONTAL" ? layoutConfig.aisleWidthM : layoutConfig.aisleDepthM)
            : toolDimensions?.depth;
        const width = objectWidthM ? Math.max(4, Math.min(90, (objectWidthM / layoutConfig.warehouseWidthM) * 100)) : 12;
        const height = objectDepthM ? Math.max(4, Math.min(90, (objectDepthM / layoutConfig.warehouseDepthM) * 100)) : 10;
        const sizeLabel = objectWidthM && objectDepthM ? (isArea && layoutConfig.areaShape === "CIRCLE" ? `R ${(objectWidthM / 2).toFixed(2)} m` : `${objectWidthM.toFixed(2)} × ${objectDepthM.toFixed(2)} m`) : ("sizeLabel" in tool && typeof tool.sizeLabel === "string" ? tool.sizeLabel : undefined);
        const identity = isArea ? makeAreaIdentity(1, 1, x, y) : undefined;
        const parentArea = !isArea ? layoutItems.find(candidate => isStorageAreaKind(candidate.kind) && x >= candidate.x - (candidate.width || 0) / 2 && x <= candidate.x + (candidate.width || 0) / 2 && y >= candidate.y - (candidate.height || 0) / 2 && y <= candidate.y + (candidate.height || 0) / 2) : undefined;
        const isAisleTool = isAisle && parentArea;
        const aisleX = isAisleTool && aisleOrientation === "VERTICAL" ? parentArea.x - (parentArea.width || 0) / 2 + (Math.max(0, Math.min(layoutConfig.palletCountX, layoutConfig.aisleBetweenColumn - 1)) / Math.max(1, layoutConfig.palletCountX) * (parentArea.width || 0)) : parentArea?.x;
        const aisleY = isAisleTool && aisleOrientation === "HORIZONTAL" ? parentArea.y - (parentArea.height || 0) / 2 + (Math.max(0, Math.min(layoutConfig.palletCountY, layoutConfig.aisleBetweenRow - 1)) / Math.max(1, layoutConfig.palletCountY) * (parentArea.height || 0)) : parentArea?.y;
        const aisleWidth = isAisleTool ? (aisleOrientation === "VERTICAL" ? layoutConfig.aisleWidthM / layoutConfig.warehouseWidthM * 100 : layoutConfig.aisleDepthM / layoutConfig.warehouseWidthM * 100) : parentArea?.width;
        const aisleHeight = isAisleTool ? (aisleOrientation === "HORIZONTAL" ? layoutConfig.aisleWidthM / layoutConfig.warehouseDepthM * 100 : layoutConfig.aisleDepthM / layoutConfig.warehouseDepthM * 100) : parentArea?.height;
        const isRackTool = tool.kind === "RACK";
        const rackCode = isRackTool ? `R-${String(Date.now()).slice(-4)}` : undefined;
        setLayoutItems((items) => [...items, { ...tool, id: `${tool.kind}-${Date.now()}`, kind: isAisleTool ? "AISLE" : tool.kind, label: isAisleTool ? layoutConfig.aisleCode : identity?.label || tool.label, qrCode: identity ? `WMS-AREA:${identity.code}` : undefined, shape: isArea ? layoutConfig.areaShape : undefined, parentId: parentArea?.id, x: aisleX ?? x, y: aisleY ?? y, width: aisleWidth ?? width, height: aisleHeight ?? height, rackCode, rackColumns: isRackTool ? layoutConfig.rackColumns : undefined, rackRows: isRackTool ? layoutConfig.rackRows : undefined, rackLevels: isRackTool ? layoutConfig.rackLevels : undefined, rackHeightM: isRackTool ? layoutConfig.rackHeightM : undefined, rackLevelHeightM: isRackTool ? layoutConfig.rackLevelHeightM : undefined, aisleCode: isAisleTool ? layoutConfig.aisleCode : undefined, aisleOrientation: isAisleTool ? aisleOrientation : undefined, aisleBetweenRow: isAisleTool ? layoutConfig.aisleBetweenRow : undefined, aisleBetweenColumn: isAisleTool ? layoutConfig.aisleBetweenColumn : undefined, aisleWidthM: isAisleTool ? layoutConfig.aisleWidthM : undefined, aisleDepthM: isAisleTool ? layoutConfig.aisleDepthM : undefined, sizeLabel: isAisleTool ? `${layoutConfig.aisleWidthM.toFixed(2)} m 宽 × ${layoutConfig.aisleDepthM.toFixed(2)} m 长 · ${aisleOrientation === "HORIZONTAL" ? `第${layoutConfig.aisleBetweenRow}行后` : `第${layoutConfig.aisleBetweenColumn}列后`}` : isRackTool ? `${layoutConfig.rackHeightM.toFixed(2)} m 高 · ${layoutConfig.rackLevels} 层 · ${layoutConfig.rackColumns}列 × ${layoutConfig.rackRows}排` : sizeLabel }]);
      }
    }
    setDraggingTool(null);
    setDraggingItem(null);
  };

  const finishPencilDrawing = (event: React.MouseEvent<HTMLDivElement>) => {
    if (draggingTool !== "PENCIL" || pencilPoints.length < 3) {
      setPencilPoints([]);
      setDrawStart(null);
      return;
    }
    const xs = pencilPoints.map(point => point.x);
    const ys = pencilPoints.map(point => point.y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const width = Math.max(2, Math.max(...xs) - left);
    const height = Math.max(2, Math.max(...ys) - top);
    const points = pencilPoints.map(point => `${(((point.x - left) / width) * 100).toFixed(2)},${(((point.y - top) / height) * 100).toFixed(2)}`).join(" ");
    const tool = layoutTools.find(item => item.kind === "PENCIL");
    if (tool) {
      const identity = makeAreaIdentity(1, 1, left + width / 2, top + height / 2);
      setLayoutItems(items => [...items, { ...tool, id: `PENCIL-${Date.now()}`, label: identity.label, qrCode: `WMS-AREA:${identity.code}`, shape: "FREEFORM", points, x: left + width / 2, y: top + height / 2, width, height, sizeLabel: `${(width / 100 * layoutConfig.warehouseWidthM).toFixed(2)} × ${(height / 100 * layoutConfig.warehouseDepthM).toFixed(2)} m` }]);
    }
    setPencilPoints([]);
    setDrawStart(null);
    setDraggingTool(null);
  };

  const autoPlacePallets = (areaId: string | null) => {
    if (!areaId) return;
    const area = layoutItems.find(item => item.id === areaId && item.kind.startsWith("AREA"));
    if (!area) return;
    const areaWidthM = (area.width || 0) / 100 * layoutConfig.warehouseWidthM;
    const areaDepthM = (area.height || 0) / 100 * layoutConfig.warehouseDepthM;
    const stepX = layoutConfig.palletWidthM + layoutConfig.columnGapM;
    const stepY = layoutConfig.palletDepthM + layoutConfig.rowGapM;
    const countX = Math.max(0, Math.floor(areaWidthM / stepX));
    const countY = Math.max(0, Math.floor(areaDepthM / stepY));
    const palletWidth = layoutConfig.palletWidthM / layoutConfig.warehouseWidthM * 100;
    const palletHeight = layoutConfig.palletDepthM / layoutConfig.warehouseDepthM * 100;
    const left = area.x - (area.width || 0) / 2;
    const top = area.y - (area.height || 0) / 2;
    const pallets = Array.from({ length: countX * countY }, (_, index) => {
      const row = Math.floor(index / countX);
      const column = index % countX;
        return { kind: "PALLET", label: `${area.label} P${String(row + 1).padStart(2, "0")}-${String(column + 1).padStart(2, "0")}`, id: `PALLET-AUTO-${area.id}-${Date.now()}-${index}`, parentId: area.id, positionQrCode: `WMS-POSITION:${area.id}-R${String(row + 1).padStart(2, "0")}-C${String(column + 1).padStart(2, "0")}`, x: left + ((column + 0.5) * area.width! / countX), y: top + ((row + 0.5) * area.height! / countY), width: palletWidth, height: palletHeight, color: "#0891b2", sizeLabel: `${layoutConfig.palletWidthM.toFixed(2)} × ${layoutConfig.palletDepthM.toFixed(2)} m`, qrCode: `WMS-PALLET:${area.label}-${row + 1}-${column + 1}` };
    });
    setLayoutItems(items => [...items, ...pallets]);
  };

  const finishGridDrawing = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!drawStart || (draggingTool !== "PALLET_GRID" && draggingTool !== "AREA_GRID")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const endX = Math.max(2, Math.min(98, ((event.clientX - rect.left) / rect.width) * 100));
    const endY = Math.max(4, Math.min(96, ((event.clientY - rect.top) / rect.height) * 100));
    const left = Math.min(drawStart.x, endX);
    const top = Math.min(drawStart.y, endY);
    const width = Math.max(8, Math.abs(endX - drawStart.x));
    const height = Math.max(8, Math.abs(endY - drawStart.y));
    const countX = draggingTool === "PALLET_GRID" ? layoutConfig.palletCountX : layoutConfig.areaCountX;
    const countY = draggingTool === "PALLET_GRID" ? layoutConfig.palletCountY : layoutConfig.areaCountY;
    const tool = layoutTools.find((item) => item.kind === draggingTool);
    if (tool) {
      const now = Date.now();
      const cells = Array.from({ length: countX * countY }, (_, index) => {
        const row = Math.floor(index / countX);
        const column = index % countX;
        const isPallet = draggingTool === "PALLET_GRID";
        const cellX = left + ((column + 0.5) * width / countX);
        const cellY = top + ((row + 0.5) * height / countY);
        const identity = !isPallet ? makeAreaIdentity(row + 1, column + 1, cellX, cellY) : undefined;
        return { ...tool, id: `${tool.kind}-draw-${now}-${row + 1}-${column + 1}`, label: isPallet ? `栈板位 ${row + 1}-${column + 1}` : identity!.label, qrCode: identity ? `WMS-AREA:${identity.code}` : undefined, shape: !isPallet ? layoutConfig.areaShape : undefined, x: cellX, y: cellY, width: width / countX, height: height / countY, sizeLabel: isPallet ? `${layoutConfig.palletWidthM.toFixed(2)} × ${layoutConfig.palletDepthM.toFixed(2)} m` : `${layoutConfig.areaWidthM.toFixed(2)} × ${layoutConfig.areaDepthM.toFixed(2)} m` };
      });
      setLayoutItems((items) => [...items, ...cells]);
    }
    setDrawStart(null);
    setDrawPreview(null);
    setDraggingTool(null);
  };

  const canvasScalePx = 40 * (canvasZoom / 100);
  const quickFieldOptions: Record<string, string[]> = {
    code: locations.map(location => location.code),
    qrCode: locations.map(location => location.qrCode || location.code),
    area: Array.from(new Set([...areas, "收料区", "IQC待检区", "良品仓库", "不良品仓库", "MRB评审区"])),
    warehouseId: Array.from(new Set(locations.map(location => String(location.warehouseId || "")).filter(Boolean))),
    zoneId: Array.from(new Set(locations.map(location => String(location.zoneId || "")).filter(Boolean))),
    locationType: ["STANDARD", "FLOOR", "RACK", "BIN", "STAGING", "QUARANTINE"],
    coordinateSystem: ["WAREHOUSE_MAP", "WAREHOUSE_MAP_3D", "PDA_SURVEY"],
    aisleCode: Array.from(new Set(locations.map(location => location.aisleCode || "").filter(Boolean))),
    rackCode: Array.from(new Set(locations.map(location => location.rackCode || "").filter(Boolean))),
    levelCode: Array.from(new Set(locations.map(location => location.levelCode || "").filter(Boolean))),
    binCode: Array.from(new Set(locations.map(location => location.binCode || "").filter(Boolean))),
    status: ["active", "locked", "full", "inactive"],
    lockedReason: ["维护中", "安全隔离", "容量已满", "质量隔离", ""],
  };

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.subnav.locationManagement", locale)}</h2>
            <p>{t("wms.subnav.basicData", locale)}</p>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {filtered.length} / {locations.length} locations
          </div>
          <button className="action-button" onClick={openCreate}>新增库位</button>
        </div>
        <div className="toolbar">
          <input className="input" placeholder={t("common.search", locale)} value={filter}
            onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 220 }} />
          <select className="input" value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)} style={{ maxWidth: 160 }}>
            <option value="">All Areas</option>
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        {selectedLayoutItem && (() => { const item = layoutItems.find(candidate => candidate.id === selectedLayoutItem); if (!item) return null; const widthM = ((item.width || 12) / 100) * layoutConfig.warehouseWidthM; const heightM = ((item.height || 10) / 100) * layoutConfig.warehouseDepthM; const updateSize = (key: "width" | "height", value: number) => setLayoutItems(items => items.map(candidate => { if (candidate.id !== item.id) return candidate; const nextWidth = key === "width" ? value : widthM; const nextHeight = key === "height" ? value : heightM; return { ...candidate, width: Math.max(0.01, nextWidth / layoutConfig.warehouseWidthM * 100), height: Math.max(0.01, nextHeight / layoutConfig.warehouseDepthM * 100), sizeLabel: `${nextWidth.toFixed(2)} × ${nextHeight.toFixed(2)} m` }; })); return <div style={{ marginTop: 8, padding: 10, border: "1px solid #0ea5e9", borderRadius: 8, background: "#f0f9ff" }}><strong>实际尺寸（米）</strong><span style={{ marginLeft: 10, color: "#0369a1", fontSize: 12 }}>修改后立即同步画布</span><div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}><label>实际宽度 m<input className="input" type="number" min="0.01" step="0.01" value={widthM.toFixed(2)} onChange={event => updateSize("width", Number(event.target.value) || 0.01)} /></label><label>实际高度 m<input className="input" type="number" min="0.01" step="0.01" value={heightM.toFixed(2)} onChange={event => updateSize("height", Number(event.target.value) || 0.01)} /></label></div></div>; })()}
       </section>

      <section className="surface-panel" style={{ border: "2px solid #0f766e" }}>
        <div className="section-header"><div><h2>库区/货架 QR 生成</h2><p>每个库区或货架编码生成独立 QR；生成后可预览并打印。</p></div><span className="badge badge-info">WMS QR</span></div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <label style={{ display: "grid", gap: 4 }}>对象类型<select className="input" value={qrObjectType} onChange={event => { setQrObjectType(event.target.value as "AREA" | "LOCATION" | "RACK"); setAreaQrPreview(""); }}><option value="AREA">库区 QR</option><option value="LOCATION">库位 QR</option><option value="RACK">货架 QR</option></select></label>
          <label style={{ display: "grid", gap: 4, minWidth: 240 }}>{qrObjectType === "AREA" ? "库区编码或已有 QR" : qrObjectType === "LOCATION" ? "库位编码或已有 QR" : "货架编码或已有 QR"}<input className="input" value={areaQrCode} onChange={event => setAreaQrCode(event.target.value)} placeholder={qrObjectType === "AREA" ? "例如 B1-18 或 WMS-AREA:B1-18" : qrObjectType === "LOCATION" ? "例如 B1-18-R01-C01 或 WMS-LOC:..." : "例如 RACK-B1-01 或 WMS-RACK:..."} onKeyDown={event => { if (event.key === "Enter") generateAreaQr(); }} /></label>
          <button className="action-button" type="button" onClick={generateAreaQr} disabled={!areaQrCode.trim()}>生成 QR</button>
          {areaQrPreview && <button className="btn btn-secondary" type="button" onClick={() => void printAreaQr()}>打印预览 / 打印</button>}
          <button className="btn btn-secondary" type="button" onClick={downloadQrTemplate}>下载 QR 规则模板</button>
          <label className="btn btn-secondary" style={{ cursor: "pointer" }}>导入 QR 规则<input type="file" accept=".xlsx,.xls,.csv" hidden onChange={event => void importQrTemplate(event.target.files?.[0])} /></label>
        </div>
        <div style={{ marginTop: 10, padding: 10, border: "1px solid #bae6fd", borderRadius: 8, background: "#f0f9ff", color: "#0c4a6e", fontSize: 12, lineHeight: 1.6 }}>
          <strong>QR 规则 Excel：</strong> 必填列 qrType、buildingCode、floorCode、areaCode、code；可选列 qrPrefix、qrValue、nameZh、namingRule。支持 AREA、LOCATION、RACK，同一文件可定义区域 QR 和全部位置 QR。
          <div><code>WMS-AREA:B01:F01:RAW-E</code> · <code>WMS-POSITION:B01:F01:RAW-E:P01-01</code></div>
        </div>
        {qrTemplateStatus && <div style={{ marginTop: 10, padding: 9, borderRadius: 8, background: "#ecfeff", color: "#155e75", fontSize: 13 }}>{qrTemplateStatus}</div>}
        {areaQrPreview && <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 14, padding: 12, border: "1px solid #99f6e4", borderRadius: 10, background: "#f0fdfa" }}><WarehouseQrImage value={areaQrPreview} label="库区 QR" /><code>{areaQrPreview}</code></div>}
      </section>

      {showForm && <section className="surface-panel" style={{ border: "2px solid #2563eb" }}>
        <div className="section-header"><div><h2>{editing ? "编辑库位属性" : "新增库位"}</h2><p>维护仓库、区域、库位类型、容量、尺寸、作业权限和锁定原因。</p></div><button className="btn btn-secondary" onClick={() => setShowForm(false)}>取消</button></div>
         <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: 12, marginBottom: 12, border: "1px solid #bae6fd", borderRadius: 10, background: "#f0f9ff" }}>
           <strong style={{ alignSelf: "center" }}>快速选择</strong>
           <label style={{ display: "grid", gap: 3 }}>所属库区<select className="input" value={form.area} onChange={event => setForm(current => ({ ...current, area: event.target.value }))}><option value="">选择库区</option>{areas.map(area => <option key={area} value={area}>{area}</option>)}<option value="收料区">收料区</option><option value="IQC待检区">IQC待检区</option><option value="良品仓库">良品仓库</option><option value="不良品仓库">不良品仓库</option></select></label>
           <label style={{ display: "grid", gap: 3 }}>库位类型<select className="input" value={form.locationType} onChange={event => setForm(current => ({ ...current, locationType: event.target.value }))}><option value="STANDARD">标准库位</option><option value="FLOOR">地面托板位</option><option value="RACK">货架位</option><option value="BIN">料箱位</option><option value="STAGING">暂存位</option><option value="QUARANTINE">隔离位</option></select></label>
           <label style={{ display: "grid", gap: 3 }}>坐标系<select className="input" value={form.coordinateSystem} onChange={event => setForm(current => ({ ...current, coordinateSystem: event.target.value }))}><option value="WAREHOUSE_MAP">仓库平面图</option><option value="WAREHOUSE_MAP_3D">仓库 3D</option><option value="PDA_SURVEY">PDA 现场测量</option></select></label>
           <label style={{ display: "grid", gap: 3 }}>状态<select className="input" value={form.status} onChange={event => setForm(current => ({ ...current, status: event.target.value }))}><option value="active">启用</option><option value="locked">锁定</option><option value="full">已满</option><option value="inactive">停用</option></select></label>
         </div>
         <div className="content-grid three">
         {([ ["code", "库位编码"], ["qrCode", "库位 QR"], ["area", "区域名称/Area"], ["nameZh", "中文名称"], ["nameEn", "英文名称"], ["nameVi", "越南文名称"], ["warehouseId", "仓库 ID"], ["buildingCode", "建筑编码"], ["floorCode", "楼层编码"], ["zoneId", "区域/Zone ID"], ["locationType", "库位类型"], ["xCoord", "X 坐标（米）"], ["yCoord", "Y 坐标（米）"], ["coordinateSystem", "坐标系"], ["aisleCode", "巷道"], ["rackCode", "货架"], ["levelCode", "层"], ["binCode", "格口"], ["capacityQty", "容量"], ["maxPallets", "最大栈板数"], ["lengthCm", "长度 cm"], ["widthCm", "宽度 cm"], ["heightCm", "高度 cm"], ["temperatureMin", "最低温度"], ["temperatureMax", "最高温度"], ["humidityMin", "最低湿度"], ["humidityMax", "最高湿度"], ["lockedReason", "锁定原因"] ] as const).map(([key, label]) => <label key={key} style={{ display: "grid", gap: 4 }}>{label}<input className="input" value={(form as any)[key]} onChange={(e) => setForm((current) => ({ ...current, [key]: e.target.value }))} disabled={Boolean(editing && key === "code")} /></label>)}
        </div>
        <div style={{ marginTop: 16, padding: 12, border: "1px dashed #2563eb", borderRadius: 10, background: "#eff6ff" }}>
          <strong>仓库平面图取点</strong><p style={{ margin: "4px 0 8px", fontSize: 12, color: "#475569" }}>点击地图生成库位 X/Y 坐标；坐标原点为仓库左上角，单位为米。</p>
          <div onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); const nextX = (((event.clientX - rect.left) / rect.width) * 100).toFixed(2); const nextY = (((event.clientY - rect.top) / rect.height) * 60).toFixed(2); setForm((current) => ({ ...current, xCoord: nextX, yCoord: nextY })); }} style={{ position: "relative", height: 180, borderRadius: 8, cursor: "crosshair", background: "repeating-linear-gradient(0deg,#dbeafe 0 1px,transparent 1px 30px),repeating-linear-gradient(90deg,#dbeafe 0 1px,transparent 1px 30px),#fff" }}>
            <span style={{ position: "absolute", left: 8, top: 8, fontSize: 11, color: "#64748b" }}>0,0</span>
            {(form.xCoord || form.yCoord) && <span style={{ position: "absolute", left: `${Math.min(96, Number(form.xCoord) || 0)}%`, top: `${Math.min(88, ((Number(form.yCoord) || 0) / 60) * 100)}%`, width: 12, height: 12, borderRadius: "50%", background: "#dc2626", border: "2px solid #fff" }} />}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 10 }}><span>当前坐标：X {form.xCoord || "-"} m / Y {form.yCoord || "-"} m</span>{(form.qrCode || form.code) && <WarehouseQrImage value={form.qrCode || form.code} label="库位 QR" />}</div>
        </div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 14 }}>
          {([ ["allowReceiving", "允许收料"], ["allowTransfer", "允许调拨"], ["allowPutaway", "允许上架"], ["msdAllowed", "允许 MSD 物料"] ] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={(form as any)[key]} onChange={(e) => setForm((current) => ({ ...current, [key]: e.target.checked }))} /> {label}</label>)}
          <label>状态 <select className="input" value={form.status} onChange={(e) => setForm((current) => ({ ...current, status: e.target.value }))}><option value="active">active</option><option value="full">full</option><option value="locked">locked</option><option value="inactive">inactive</option></select></label>
        </div>
        <button className="action-button" style={{ marginTop: 14 }} onClick={() => void saveLocation()} disabled={saving || !form.code || !form.area || !form.nameZh || !form.warehouseId || !form.zoneId}>{saving ? "保存中…" : "保存库位属性"}</button>
      </section>}

      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>仓库平面布局编辑器</h2>
            <p>从左侧拖动收料区、IQC、良品仓库、货架和栈板位到平面图；已放置对象可以再次拖动。</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" onClick={createQuickWarehouse}>快速创建仓库</button>
            <button className="btn btn-secondary" onClick={generatePositionQrs}>生成位置 QR</button>
            <button className="btn btn-secondary" onClick={() => void printLayoutQrs()}>预览/打印全部区域与库位 QR</button>
            <button className="btn btn-primary" onClick={saveWarehouseLayout}>保存布局</button>
            <button className="btn btn-secondary" onClick={resetWarehouseLayout}>重置画布</button>
            <button className="btn btn-secondary" onClick={() => setLayoutItems([])}>清空布局</button>
            <span className="badge badge-info">{layoutItems.length} 个对象</span>
            {layoutSaveStatus && <span style={{ alignSelf: "center", color: "#15803d", fontSize: 12, fontWeight: 700 }}>{layoutSaveStatus}</span>}
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: 10, padding: 12, marginBottom: 14, border: "1px solid #bae6fd", borderRadius: 10, background: "#f0f9ff" }}>
           <strong style={{ alignSelf: "center", color: "#0f3d56", marginRight: 4 }}>栈板/区域参数</strong>
           <label style={{ display: "grid", gap: 3, fontSize: 11, color: "#475569" }}>目标区域形状<select className="input" value={layoutConfig.areaShape} onChange={event => setLayoutConfig(current => ({ ...current, areaShape: event.target.value, areaDepthM: event.target.value === "SQUARE" || event.target.value === "CIRCLE" ? current.areaWidthM : current.areaDepthM }))} style={{ width: 120, padding: "6px 8px" }}><option value="RECTANGLE">矩形 L×W</option><option value="SQUARE">正方形</option><option value="L_SHAPE">L 型</option><option value="CUSTOM">自定义</option><option value="CIRCLE">圆形 Ø</option></select></label>
          <label style={{ display: "grid", gap: 3, fontSize: 11, color: "#475569" }}>
            区域名称
            <input className="input" value={layoutConfig.areaName} onChange={(event) => setLayoutConfig((current) => ({ ...current, areaName: event.target.value }))} placeholder="例如：IQC待检区" style={{ width: 150, padding: "6px 8px" }} />
          </label>
          <label style={{ display: "grid", gap: 3, fontSize: 11, color: "#475569" }}>通道编号<input className="input" value={layoutConfig.aisleCode} onChange={event => setLayoutConfig(current => ({ ...current, aisleCode: event.target.value }))} style={{ width: 106, padding: "6px 8px" }} /></label>
          <label style={{ display: "grid", gap: 3, fontSize: 11, color: "#475569" }}>通道方向<select className="input" value={layoutConfig.aisleOrientation} onChange={event => setLayoutConfig(current => ({ ...current, aisleOrientation: event.target.value }))} style={{ width: 106, padding: "6px 8px" }}><option value="HORIZONTAL">水平</option><option value="VERTICAL">垂直</option></select></label>
          {([
            ["warehouseWidthM", "仓库长度 (m)", 1], ["warehouseDepthM", "仓库宽度 (m)", 1],
            ["palletWidthM", "栈板长 (m)", 0.1], ["palletDepthM", "栈板宽 (m)", 0.1],
            ["clearanceM", "两侧净距 (m)", 0.05], ["aisleClearanceM", "通道净距 (m)", 0.05], ["columnGapM", "列间距 (m)", 0.05], ["rowGapM", "行间距 (m)", 0.05], ["palletCountX", "栈板 X 数", 1], ["palletCountY", "栈板 Y 数", 1],
             ["areaWidthM", "目标区域长 L (m)", 0.1], ["areaDepthM", "目标区域宽 W (m)", 0.1], ["areaCountX", "区域 X 列", 1], ["areaCountY", "区域 Y 行", 1],
            ["aisleWidthM", "通道宽 (m)", 0.1], ["aisleDepthM", "通道长 (m)", 0.1], ["aisleBetweenRow", "通道位于第几行后", 1], ["aisleBetweenColumn", "通道位于第几列后", 1], ["rackColumns", "货架格位列数", 1], ["rackRows", "货架格位排数", 1], ["rackLevels", "货架层数", 1], ["rackHeightM", "货架高度 (m)", 0.1], ["rackLevelHeightM", "货架层高 (m)", 0.1],
          ] as const).map(([key, label, step]) => (
            <label key={key} style={{ display: "grid", gap: 3, fontSize: 11, color: "#475569" }}>
              {label}
              <input className="input" type="number" min={key === "aisleWidthM" ? 0.9 : key.includes("Count") ? 1 : 0.1} max={key.includes("warehouse") || key.includes("area") ? 100 : key.includes("Count") ? 50 : 200} step={step}
                value={layoutConfig[key]}
                onChange={(event) => setLayoutConfig((current) => ({ ...current, [key]: Math.min(key.includes("warehouse") || key.includes("area") ? 100 : key.includes("Count") ? 50 : 200, Math.max(key === "aisleWidthM" ? 0.9 : key.includes("Count") ? 1 : 0.1, Number(event.target.value) || 0)) }))}
                style={{ width: 106, padding: "6px 8px" }} />
            </label>
          ))}
          <span style={{ alignSelf: "center", fontSize: 12, color: "#0369a1" }}>
            拖入栈板：{layoutConfig.palletCountX * layoutConfig.palletCountY} 个；每侧净距 {layoutConfig.clearanceM.toFixed(2)}m
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: 10, padding: 12, marginBottom: 10, border: "1px solid #fed7aa", borderRadius: 10, background: "#fff7ed" }}>
          <strong style={{ alignSelf: "center", color: "#9a3412", marginRight: 4 }}>QR 打印设置</strong>
          {([ ["labelWidthMm", "标签宽 mm", 20, 200], ["labelHeightMm", "标签高 mm", 20, 200], ["qrSizeMm", "QR尺寸 mm", 10, 180], ["marginMm", "边距 mm", 0, 30], ["columns", "每页列数", 1, 8], ["copies", "每个 QR 份数", 1, 100], ["fromIndex", "从第几个 QR", 1, 9999], ["toIndex", "到第几个 QR（0=全部）", 0, 9999] ] as const).map(([key, label, min, max]) => (
            <label key={key} style={{ display: "grid", gap: 3, fontSize: 11, color: "#7c2d12" }}>{label}
              <input className="input" type="number" min={min} max={max} value={qrPrintSettings[key]} onChange={event => setQrPrintSettings(current => ({ ...current, [key]: Math.min(max, Math.max(min, Number(event.target.value) || min)) }))} style={{ width: 86, padding: "6px 8px" }} />
            </label>
          ))}
          <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12, color: "#7c2d12" }}><input type="checkbox" checked={qrPrintSettings.showCode} onChange={event => setQrPrintSettings(current => ({ ...current, showCode: event.target.checked }))} />显示 QR 编码</label>
          <span style={{ alignSelf: "center", fontSize: 12, color: "#9a3412" }}>区域 QR、位置 QR、货架格口 QR 全部预览；范围由布局中的对象决定</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "8px 10px", marginBottom: 10, border: "1px solid #cbd5e1", borderRadius: 8, background: "#f8fafc" }}>
          <strong style={{ color: "#0f3d56" }}>CAD 编辑</strong>
          <button type="button" className="btn btn-secondary" disabled={!selectedLayoutItem} onClick={() => autoPlacePallets(selectedLayoutItem)}>自动布置托板</button>
          <button type="button" className="btn btn-secondary" onClick={() => { setSelectedLayoutItem(null); setSelectedLayoutItems([]); }}>选择/取消选择</button>
          {selectedLayoutItems.length > 1 && <span style={{ alignSelf: "center", color: "#2563eb", fontSize: 12, fontWeight: 700 }}>已框选 {selectedLayoutItems.length} 个对象</span>}
          {selectedLayoutItems.length > 1 && <button type="button" className="btn btn-secondary" onClick={() => { setLayoutItems(items => items.filter(item => !selectedLayoutItems.includes(item.id))); setSelectedLayoutItem(null); setSelectedLayoutItems([]); }}>删除已选</button>}
          <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12 }}><input type="checkbox" checked={cadGridEnabled} onChange={event => setCadGridEnabled(event.target.checked)} />显示网格</label>
          <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12 }}><input type="checkbox" checked={cadSnapEnabled} onChange={event => setCadSnapEnabled(event.target.checked)} />网格吸附</label>
          <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12 }}>吸附步长(m)<input className="input" type="number" min="0.1" step="0.1" value={cadSnapM} onChange={event => setCadSnapM(Math.max(0.1, Number(event.target.value) || 0.1))} style={{ width: 70, padding: "4px 6px" }} /></label>
          <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12 }}>画布缩放 <input type="range" min="50" max="250" step="10" value={canvasZoom} onChange={event => setCanvasZoom(Number(event.target.value))} style={{ width: 100 }} /><span style={{ minWidth: 40 }}>{canvasZoom}%</span></label>
          <button type="button" className="btn btn-secondary" onClick={() => setCanvasZoom(value => Math.max(50, value - 10))}>−</button>
          <button type="button" className="btn btn-secondary" onClick={() => setCanvasZoom(100)}>100%</button>
          <button type="button" className="btn btn-secondary" onClick={() => setCanvasZoom(value => Math.min(250, value + 10))}>+</button>
          <span style={{ color: "#64748b", fontSize: 12 }}>拖动对象移动；右下角调整大小；点击后编辑属性</span>
        </div>
        <div style={{ display: "block" }}>
          <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
             <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}><strong>拖拽工具（全部可配置）</strong><button type="button" className="btn btn-secondary" onClick={() => setShowToolConfig(value => !value)}>{showToolConfig ? "收起配置" : "展开配置"}</button></div>
             <div style={{ display: showToolConfig ? "block" : "none", padding: 8, border: "1px solid #cbd5e1", borderRadius: 8, background: "#f8fafc" }}>
              <div style={{ fontSize: 11, color: "#475569", marginBottom: 6 }}>可修改名称、颜色和显示状态；系统编码保持不变。</div>
              {layoutTools.map(tool => <div key={`tool-config-${tool.kind}`} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                <input className="input" value={tool.label} onChange={event => setToolEdits(current => ({ ...current, [tool.kind]: { ...current[tool.kind], label: event.target.value } }))} style={{ minWidth: 0, flex: 1, padding: "4px 6px", fontSize: 11 }} />
                <input type="color" value={tool.color} onChange={event => setToolEdits(current => ({ ...current, [tool.kind]: { ...current[tool.kind], color: event.target.value } }))} title="颜色" />
                <input type="checkbox" checked={!toolEdits[tool.kind]?.hidden} onChange={event => setToolEdits(current => ({ ...current, [tool.kind]: { ...current[tool.kind], hidden: !event.target.checked } }))} title="显示" />
              </div>)}
              <div style={{ display: "flex", gap: 4, marginTop: 6 }}><input className="input" value={newToolLabel} onChange={event => setNewToolLabel(event.target.value)} placeholder="新增工具名称" style={{ minWidth: 0, flex: 1, padding: "5px 6px", fontSize: 11 }} /><button type="button" className="btn btn-secondary" onClick={() => { const label = newToolLabel.trim(); if (!label) return; const kind = `CUSTOM_${Date.now()}`; setCustomTools(current => [...current, { kind, label, color: "#334155" }]); setNewToolLabel(""); }}>新增工具</button></div>
            </div>
             <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 10 }}>
             {layoutTools.map((tool) => (
              <div
                key={tool.kind}
                draggable
                onClick={() => { setDraggingTool(tool.kind); setDraggingItem(null); }}
                onDragStart={() => { setDraggingTool(tool.kind); setDraggingItem(null); }}
                onDragEnd={() => { setDraggingTool(null); setDraggingItem(null); }}
                 style={{ display: "inline-flex", alignItems: "center", padding: "6px 9px", border: `1px solid ${tool.color}`, borderRadius: 7, background: "#fff", color: tool.color, cursor: "grab", fontWeight: 700, fontSize: 11, whiteSpace: "nowrap" }}
              >
                <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: tool.color, marginRight: 8 }} />
                {tool.label}
              </div>
             ))}
             </div>
            <small style={{ color: "var(--muted)", lineHeight: 1.5 }}>坐标以左上角为原点。布局草稿自动保存在本机浏览器，可用于现场规划库位。</small>
          </div>
          <div style={{ display: "block", width: "100%", minWidth: 0, overflowX: "scroll", overflowY: "auto", maxHeight: 720, borderRadius: 12 }}>
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={placeLayoutItem}
            onMouseDown={(event) => {
              if (draggingTool === "PENCIL") {
                const rect = event.currentTarget.getBoundingClientRect();
                setPencilPoints([{ x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 }]);
                return;
              }
              if (!draggingTool && !draggingItem && event.target === event.currentTarget) {
                const rect = event.currentTarget.getBoundingClientRect();
                setSelectionStart({ x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 });
                setSelectionPreview(null);
                return;
              }
              if (draggingTool !== "PALLET_GRID" && draggingTool !== "AREA_GRID") return;
              const rect = event.currentTarget.getBoundingClientRect();
              setDrawStart({ x: Math.max(2, Math.min(98, ((event.clientX - rect.left) / rect.width) * 100)), y: Math.max(4, Math.min(96, ((event.clientY - rect.top) / rect.height) * 100)) });
            }}
            onMouseMove={(event) => {
              if (draggingTool === "PENCIL" && pencilPoints.length) {
                const rect = event.currentTarget.getBoundingClientRect();
                setPencilPoints(points => [...points, { x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 }]);
                return;
              }
              if (selectionStart) {
                const rect = event.currentTarget.getBoundingClientRect();
                const currentX = ((event.clientX - rect.left) / rect.width) * 100;
                const currentY = ((event.clientY - rect.top) / rect.height) * 100;
                setSelectionPreview({ x: Math.min(selectionStart.x, currentX), y: Math.min(selectionStart.y, currentY), width: Math.abs(currentX - selectionStart.x), height: Math.abs(currentY - selectionStart.y) });
                return;
              }
              if (!drawStart) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const currentX = ((event.clientX - rect.left) / rect.width) * 100;
              const currentY = ((event.clientY - rect.top) / rect.height) * 100;
              setDrawPreview({ x: Math.min(drawStart.x, currentX), y: Math.min(drawStart.y, currentY), width: Math.abs(currentX - drawStart.x), height: Math.abs(currentY - drawStart.y) });
            }}
            onMouseUp={event => {
              if (selectionStart) {
                const rect = event.currentTarget.getBoundingClientRect();
                const endX = ((event.clientX - rect.left) / rect.width) * 100;
                const endY = ((event.clientY - rect.top) / rect.height) * 100;
                const left = Math.min(selectionStart.x, endX);
                const right = Math.max(selectionStart.x, endX);
                const top = Math.min(selectionStart.y, endY);
                const bottom = Math.max(selectionStart.y, endY);
                const ids = layoutItems.filter(item => item.x >= left && item.x <= right && item.y >= top && item.y <= bottom).map(item => item.id);
                setSelectedLayoutItems(ids);
                setSelectedLayoutItem(ids[0] || null);
                setSelectionStart(null);
                setSelectionPreview(null);
                return;
              }
              if (draggingTool === "PENCIL") finishPencilDrawing(event);
              else finishGridDrawing(event);
            }}
            ref={layoutCanvasRef}
             style={{ position: "relative", width: `${Math.max(1, layoutConfig.warehouseWidthM) * canvasScalePx}px`, minWidth: `${Math.max(1, layoutConfig.warehouseWidthM) * canvasScalePx}px`, height: `${Math.max(1, layoutConfig.warehouseDepthM) * canvasScalePx}px`, minHeight: 320, overflow: "hidden", border: "2px dashed #94a3b8", borderRadius: 12, background: cadGridEnabled ? "linear-gradient(#bfdbfe 1px, transparent 1px), linear-gradient(90deg, #bfdbfe 1px, transparent 1px), #e0f2fe" : "#e0f2fe", backgroundSize: `${canvasScalePx}px ${canvasScalePx}px`, cursor: draggingTool || draggingItem ? "copy" : "default" }}
          >
            {drawPreview && <div style={{ position: "absolute", left: `${drawPreview.x}%`, top: `${drawPreview.y}%`, width: `${drawPreview.width}%`, height: `${drawPreview.height}%`, border: "2px dashed #0f766e", background: "rgba(15,118,110,.12)", pointerEvents: "none" }} />}
            {selectionPreview && <div style={{ position: "absolute", left: `${selectionPreview.x}%`, top: `${selectionPreview.y}%`, width: `${selectionPreview.width}%`, height: `${selectionPreview.height}%`, border: "2px dashed #2563eb", background: "rgba(37,99,235,.12)", pointerEvents: "none", zIndex: 50 }} />}
            <span style={{ position: "absolute", left: 10, top: 8, color: "#64748b", fontSize: 11 }}>0,0 · WMS warehouse coordinate plane</span>
             {layoutItems.filter(item => item.shape === "FREEFORM").map(item => <svg key={`freeform-${item.id}`} viewBox="0 0 100 100" preserveAspectRatio="none" onClick={() => setSelectedLayoutItem(item.id)} onContextMenu={(event) => { event.preventDefault(); setSelectedLayoutItem(item.id); window.setTimeout(() => document.getElementById("layout-object-editor")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0); }} style={{ position: "absolute", left: `${item.x - (item.width || 0) / 2}%`, top: `${item.y - (item.height || 0) / 2}%`, width: `${item.width || 0}%`, height: `${item.height || 0}%`, overflow: "visible", cursor: "pointer" }}><polygon points={item.points} fill={`${item.color}22`} stroke={item.color} strokeWidth="1.2" /><text x="50" y="48" textAnchor="middle" fill={item.color} fontSize="6" fontWeight="700">{item.label}</text><text x="50" y="58" textAnchor="middle" fill="#64748b" fontSize="4">{item.sizeLabel}</text></svg>)}
             {pencilPoints.length > 1 && <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}><polyline points={pencilPoints.map(point => `${point.x},${point.y}`).join(" ")} fill="rgba(15,118,110,.12)" stroke="#0f766e" strokeWidth="0.4" /></svg>}
             {layoutItems.filter(item => item.shape !== "FREEFORM").map((item) => (
              <div
                key={item.id}
                draggable
                 onDragStart={() => { setDraggingItem(item.id); setDraggingTool(null); setSelectedLayoutItem(item.id); }}
                 onDragEnd={() => { setDraggingItem(null); setDraggingTool(null); }}
                 onMouseDown={(event) => { if (event.button === 0) { const rect = event.currentTarget.getBoundingClientRect(); objectPointerDownRef.current = { id: item.id, width: rect.width, height: rect.height }; } }}
                  onClick={() => setSelectedLayoutItem(item.id)}
                 onContextMenu={(event) => { event.preventDefault(); setSelectedLayoutItem(item.id); window.setTimeout(() => document.getElementById("layout-object-editor")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0); }}
                 onMouseUp={(event) => {
                   if (event.button === 2) return;
                   if (item.kind === "DELETE" || !layoutCanvasRef.current) return;
                   const itemRect = event.currentTarget.getBoundingClientRect();
                   const startRect = objectPointerDownRef.current;
                   objectPointerDownRef.current = null;
                   if (!startRect || startRect.id !== item.id || (Math.abs(itemRect.width - startRect.width) < 2 && Math.abs(itemRect.height - startRect.height) < 2)) return;
                   const canvasRect = layoutCanvasRef.current.getBoundingClientRect();
                  setSelectedLayoutItem(item.id);
                  setLayoutItems((items) => items.map((candidate) => candidate.id === item.id ? {
                    ...candidate,
                    width: Math.max(8, Math.min(70, (itemRect.width / canvasRect.width) * 100)),
                    height: Math.max(8, Math.min(70, (itemRect.height / canvasRect.height) * 100)),
                    sizeLabel: item.shape === "CIRCLE"
                      ? `Ø ${((itemRect.width / canvasRect.width) * layoutConfig.warehouseWidthM).toFixed(2)} m`
                      : `${((itemRect.width / canvasRect.width) * layoutConfig.warehouseWidthM).toFixed(2)} × ${((itemRect.height / canvasRect.height) * layoutConfig.warehouseDepthM).toFixed(2)} m`,
                  } : candidate));
                }}
                 style={{ position: "absolute", left: `${item.x}%`, top: `${item.y}%`, transform: "translate(-50%, -50%)", width: item.kind === "AISLE" ? `${(item.aisleOrientation === "VERTICAL" ? (item.aisleWidthM || layoutConfig.aisleWidthM) / layoutConfig.warehouseWidthM * 100 : (item.aisleDepthM || layoutConfig.aisleDepthM) / layoutConfig.warehouseWidthM * 100)}%` : `${item.width ?? 12}%`, height: item.kind === "AISLE" ? `${(item.aisleOrientation === "HORIZONTAL" ? (item.aisleWidthM || layoutConfig.aisleWidthM) / layoutConfig.warehouseDepthM * 100 : (item.aisleDepthM || layoutConfig.aisleDepthM) / layoutConfig.warehouseDepthM * 100)}%` : `${item.height ?? 10}%`, minWidth: item.kind === "AISLE" ? 0 : item.kind === "PALLET" || item.kind === "PALLET_GRID" ? 1 : 92, minHeight: item.kind === "AISLE" ? 0 : item.kind === "PALLET" || item.kind === "PALLET_GRID" ? 1 : 70, maxWidth: "70%", maxHeight: "70%", minBlockSize: item.kind === "AISLE" ? 0 : undefined, boxSizing: "border-box", resize: item.kind === "AISLE" || item.kind === "DELETE" ? undefined : "both", overflow: "auto", padding: item.kind === "AISLE" || item.kind === "PALLET" || item.kind === "PALLET_GRID" ? "4px" : "12px 8px", display: "grid", alignContent: "center", textAlign: "center", borderRadius: item.shape === "CIRCLE" ? "50%" : 9, border: `${selectedLayoutItems.includes(item.id) || selectedLayoutItem === item.id ? 3 : 2}px solid ${selectedLayoutItems.includes(item.id) || selectedLayoutItem === item.id ? "#2563eb" : item.color}`, background: item.kind === "RACK" ? `repeating-linear-gradient(90deg, transparent 0 calc(${100 / Math.max(1, item.rackColumns || 3)}% - 1px), ${item.color}88 calc(${100 / Math.max(1, item.rackColumns || 3)}% - 1px) ${100 / Math.max(1, item.rackColumns || 3)}%), repeating-linear-gradient(0deg, transparent 0 calc(${100 / Math.max(1, item.rackRows || 1)}% - 1px), ${item.color}88 calc(${100 / Math.max(1, item.rackRows || 1)}% - 1px) ${100 / Math.max(1, item.rackRows || 1)}%), #fff` : item.kind.startsWith("AREA") ? "rgba(255,255,255,.55)" : "#fff", boxShadow: "0 4px 10px rgba(15,23,42,.14)", color: item.color, cursor: "grab", userSelect: "none", zIndex: item.kind === "AISLE" ? 20 : item.kind.startsWith("AREA") ? 1 : 5 }}
                title={`${item.label} · X ${item.x.toFixed(1)} / Y ${item.y.toFixed(1)}`}
              >
                <strong style={{ display: "block", fontSize: 12 }}>{item.label}</strong>
                 {item.sizeLabel && <small style={{ color: "#0f766e", fontWeight: 700 }}>{item.kind === "AISLE" ? `${item.aisleWidthM || layoutConfig.aisleWidthM} m 宽 × ${item.aisleDepthM || layoutConfig.aisleDepthM} m 长` : item.sizeLabel}</small>}
                 {item.kind.startsWith("AREA") && <small style={{ color: "#0f766e", fontWeight: 700 }}>{item.shape === "CIRCLE" ? `R ${(((item.width || 0) / 100 * layoutConfig.warehouseWidthM) / 2).toFixed(2)} m` : `L ${((item.width || 0) / 100 * layoutConfig.warehouseWidthM).toFixed(2)} m × W ${((item.height || 0) / 100 * layoutConfig.warehouseDepthM).toFixed(2)} m`}</small>}
                 {item.kind.startsWith("AREA") && <small style={{ color: "#1d4ed8", fontWeight: 700 }}>托板：{layoutItems.filter(candidate => (candidate.kind === "PALLET" || candidate.kind === "PALLET_GRID") && candidate.x >= item.x - (item.width || 0) / 2 && candidate.x <= item.x + (item.width || 0) / 2 && candidate.y >= item.y - (item.height || 0) / 2 && candidate.y <= item.y + (item.height || 0) / 2).length} / {Math.max(0, Math.floor(((item.width || 0) / 100 * layoutConfig.warehouseWidthM) / (layoutConfig.palletWidthM + layoutConfig.clearanceM * 2)) * Math.floor(((item.height || 0) / 100 * layoutConfig.warehouseDepthM) / (layoutConfig.palletDepthM + layoutConfig.clearanceM * 2)))}（{Math.max(0, Math.floor(((item.height || 0) / 100 * layoutConfig.warehouseDepthM) / (layoutConfig.palletDepthM + layoutConfig.clearanceM * 2)))}行 × {Math.max(0, Math.floor(((item.width || 0) / 100 * layoutConfig.warehouseWidthM) / (layoutConfig.palletWidthM + layoutConfig.clearanceM * 2)))}列）</small>}
                 {item.kind === "RACK" && <small style={{ color: "#1d4ed8", fontWeight: 700 }}>H {item.rackHeightM || 2.4}m · 层高 {item.rackLevelHeightM || 0.6}m · {item.rackLevels || 4} 层</small>}
                 {item.positionQrCode && <small style={{ color: "#64748b", fontSize: 9 }}>位置 QR：{item.positionQrCode}</small>}
                 <small style={{ color: "#64748b" }}>X {item.x.toFixed(1)} / Y {item.y.toFixed(1)}</small>
                <button type="button" onClick={(event) => { event.stopPropagation(); setLayoutItems((items) => items.filter((candidate) => candidate.id !== item.id)); }} style={{ display: "block", margin: "5px auto 0", border: 0, background: "transparent", color: "#b91c1c", fontSize: 10, cursor: "pointer" }}>删除</button>
              </div>
            ))}
            {!layoutItems.length && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#64748b", pointerEvents: "none" }}>把仓库工具拖到这里</div>}
          </div>
          </div>
          </div>
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #93c5fd", borderRadius: 10, background: "#f8fbff", color: "#334155" }}>
          <div style={{ fontWeight: 800, color: "#0f3d56", marginBottom: 8 }}>布局说明</div>
          {(() => {
            const areas = layoutItems.filter(item => item.kind === "AREA" || item.kind === "AREA_GRID");
            const aisles = layoutItems.filter(item => item.kind === "AISLE");
            const pallets = layoutItems.filter(item => item.kind === "PALLET" || item.kind === "PALLET_GRID");
            return <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8 }}>
                {areas.length ? areas.map(area => {
                  const children = layoutItems.filter(item => item.parentId === area.id);
                  const areaPallets = children.filter(item => item.kind === "PALLET" || item.kind === "PALLET_GRID");
                  const areaAisles = children.filter(item => item.kind === "AISLE");
                  const widthM = (area.width || 0) / 100 * layoutConfig.warehouseWidthM;
                  const depthM = (area.height || 0) / 100 * layoutConfig.warehouseDepthM;
                  return <div key={`layout-summary-${area.id}`} style={{ padding: 9, border: "1px solid #cbd5e1", borderRadius: 8, background: "#fff" }}>
                    <div style={{ fontWeight: 700, color: area.color }}>{area.label}</div>
                    <div>区域尺寸：{area.shape === "CIRCLE" ? `R ${(widthM / 2).toFixed(2)} m` : `${widthM.toFixed(2)} × ${depthM.toFixed(2)} m`}</div>
                    <div>托板数量：{areaPallets.length}（总布局 {pallets.length}）</div>
                    <div>通道：{areaAisles.length ? areaAisles.map(aisle => `${aisle.label} ${aisle.sizeLabel || ""}，位置 ${aisle.aisleOrientation === "VERTICAL" ? `列${aisle.aisleBetweenColumn || 1}后` : `行${aisle.aisleBetweenRow || 1}后`}`).join("；") : "无"}</div>
                  </div>;
                }) : <div>尚未创建区域。拖入“矩形区域”或“圆形区域”后，这里会显示区域说明。</div>}
              </div>
              <div style={{ marginTop: 8, lineHeight: 1.6 }}>自动布局规则：托板按托板尺寸、两侧净距、行间距和列间距排列；通道作为障碍物参与计算，通道宽度、方向及“位于第几行/列之后”会显示在对应区域下方。左键选择/拖动，右键编辑属性，尺寸通过右下角拖拽调整。</div>
            </>;
          })()}
        </div>
       {selectedLayoutItem && (() => { const item = layoutItems.find(candidate => candidate.id === selectedLayoutItem); if (!item) return null; const actualWidthM = ((item.width || 12) / 100) * layoutConfig.warehouseWidthM; const actualHeightM = ((item.height || 10) / 100) * layoutConfig.warehouseDepthM; return <div id="layout-object-editor" style={{ marginTop: 12, padding: 12, border: "2px solid #2563eb", borderRadius: 10, background: "#eff6ff" }}><div className="section-header"><strong>对象属性</strong><button type="button" className="btn btn-secondary" onClick={() => setSelectedLayoutItem(null)}>关闭</button></div><div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}><label>名称<input className="input" value={item.label} onChange={event => setLayoutItems(items => items.map(candidate => candidate.id === item.id ? { ...candidate, label: event.target.value } : candidate))} /></label><label>QR<input className="input" value={item.qrCode || ""} onChange={event => setLayoutItems(items => items.map(candidate => candidate.id === item.id ? { ...candidate, qrCode: event.target.value } : candidate))} /></label><label>X %<input className="input" type="number" value={item.x} onChange={event => setLayoutItems(items => items.map(candidate => candidate.id === item.id ? { ...candidate, x: Number(event.target.value) || 0 } : candidate))} /></label><label>Y %<input className="input" type="number" value={item.y} onChange={event => setLayoutItems(items => items.map(candidate => candidate.id === item.id ? { ...candidate, y: Number(event.target.value) || 0 } : candidate))} /></label><label>宽度 mm<input className="input" type="number" value={Math.round(((item.width || 12) / 100) * layoutConfig.warehouseWidthM * 1000)} onChange={event => setLayoutItems(items => items.map(candidate => candidate.id === item.id ? { ...candidate, width: Math.max(0.01, ((Number(event.target.value) || 1) / 1000) / layoutConfig.warehouseWidthM * 100), sizeLabel: `${((Number(event.target.value) || 1) / 100 * layoutConfig.warehouseWidthM).toFixed(2)} × ${actualHeightM.toFixed(2)} m` } : candidate))} /></label><label>高度 mm<input className="input" type="number" value={Math.round(((item.height || 10) / 100) * layoutConfig.warehouseDepthM * 1000)} onChange={event => setLayoutItems(items => items.map(candidate => candidate.id === item.id ? { ...candidate, height: Math.max(0.01, ((Number(event.target.value) || 1) / 1000) / layoutConfig.warehouseDepthM * 100), sizeLabel: `${actualWidthM.toFixed(2)} × ${((Number(event.target.value) || 1) / 100 * layoutConfig.warehouseDepthM).toFixed(2)} m` } : candidate))} /></label><button type="button" className="btn btn-secondary" onClick={() => { setLayoutItems(items => items.filter(candidate => candidate.id !== item.id)); setSelectedLayoutItem(null); }}>删除对象</button></div><div style={{ marginTop: 8, color: "#0f766e", fontWeight: 700 }}>实际尺寸：{item.shape === "CIRCLE" ? `R ${actualWidthM.toFixed(2)} m` : `${actualWidthM.toFixed(2)} × ${actualHeightM.toFixed(2)} m`}（随拖拽实时更新）</div></div>; })()}
      </section>

      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>3D 仓库布局预览</h2>
            <p>与上方2D仓库布局创建器实时同步，用于检查区域、通道和栈板间的空间关系。</p>
          </div>
          <span className="badge badge-info">实时预览 · {layoutItems.length} 个对象</span>
        </div>
       <div id="warehouse-3d-map" role="img" aria-label="仓库3D布局预览" style={{ position: "relative", height: 390, overflow: "hidden", borderRadius: 14, background: "linear-gradient(160deg,#dbeafe,#f8fafc 55%,#cbd5e1)", perspective: 900, padding: 26 }}>
          <div style={{ position: "relative", height: "100%", transform: "rotateX(58deg) rotateZ(-28deg) scale(.88)", transformStyle: "preserve-3d", transformOrigin: "center", background: "linear-gradient(#cbd5e1 1px, transparent 1px), linear-gradient(90deg,#cbd5e1 1px,transparent 1px), #eff6ff", backgroundSize: "5% 10%", border: "3px solid #64748b" }}>
            {layoutItems.map((item) => {
              const isArea = isStorageAreaKind(item.kind);
              const isAisle = item.kind === "AISLE";
              const isPallet = item.kind === "PALLET" || item.kind === "PALLET_GRID";
              const isRack = item.kind === "RACK";
              const height = isPallet ? 7 : isAisle ? 2 : isRack ? Math.max(12, Math.min(70, (item.rackHeightM || 2.4) * 12)) : isArea ? 5 : 9;
              return <div key={`3d-${item.id}`} title={`${item.label} | ${item.sizeLabel ?? ""}`} style={{ position: "absolute", left: `${item.x}%`, top: `${item.y}%`, width: `${item.width ?? 12}%`, height: `${item.height ?? 10}%`, transform: `translate(-50%,-50%) translateZ(${height * 2}px)`, transformStyle: "preserve-3d", border: `2px solid ${item.color}`, background: `${item.color}33`, boxShadow: `8px 8px 0 ${item.color}66`, color: item.color, display: "grid", placeItems: "center", textAlign: "center", fontSize: 11, fontWeight: 700, borderRadius: 6 }}>
                {isRack ? <span>{item.label}<br /><small>{item.rackLevels || 4} 层 · H {item.rackHeightM || 2.4}m</small></span> : item.label}
              </div>;
            })}
            {!layoutItems.length && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#64748b", transform: "rotateZ(28deg) rotateX(-58deg)" }}>请先在2D创建器中拖入区域或栈板</div>}
          </div>
          <span style={{ position: "absolute", left: 12, bottom: 10, fontSize: 11, color: "#475569" }}>X：仓库长度 · Y：仓库宽度 · Z：对象高度示意</span>
        </div>
      </section>

      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>DWG 厂区存储区域</h2>
            <p>与原材料仓库 3D 共用 WMS 占用数据</p>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>新工厂布局图 WMS.dwg</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}>
           {visibleAreas.length ? visibleAreas.map((area) => {
             const percent = area.capacity ? Math.round(area.occupied / area.capacity * 100) : 0;
           return <article key={area.areaCode} onClick={() => { const target = layoutItems.find(item => item.kind.startsWith("AREA") && (item.qrCode === area.areaQr || item.label === area.areaName || item.label === area.areaCode)); if (target) setFocusedAreaId(target.id); window.setTimeout(() => document.getElementById("warehouse-3d-map")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0); window.setTimeout(() => void printLayoutQrs(target?.id), 150); }} title="点击进入该区域地图并预览该区域 QR" style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <strong>{area.areaName}</strong><code>{area.areaCode}</code>
              </div>
              <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 5 }}>{area.areaType}</div>
              <WarehouseQrImage value={area.areaQr||warehouseAreaQrValue(area.areaCode)} label="WMS registered storage area QR" />
              <div style={{ height: 8, background: "var(--border)", borderRadius: 999, marginTop: 12, overflow: "hidden" }}>
                <div style={{ width: `${percent}%`, height: "100%", background: percent >= 90 ? "#ef4444" : "#22c55e" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 7, fontSize: 12 }}>
                <span>{area.occupied} / {area.capacity}</span><span>{percent}% · {area.status}</span>
              </div>
            </article>;
           }) : <div className="empty-state">暂无库区。请先在上方布局编辑器拖入“区域”工具，或登录后从 WMS 读取库区主数据。</div>}
        </div>
      </section>

      <section className="surface-panel">
        <div className="section-header"><div><h2>3D 仓库位置地图</h2><p>点击库位块查看占用、坐标和 QR；位置坐标以仓库左上角为原点。</p></div><span className="badge badge-info">WMS 位置主数据</span></div>
        <div style={{ height: 300, overflow: "hidden", borderRadius: 14, background: "linear-gradient(160deg,#dbeafe,#f8fafc 55%,#cbd5e1)", perspective: 900, padding: 28 }}>
          <div style={{ position: "relative", height: "100%", transform: "rotateX(58deg) rotateZ(-28deg) scale(.9)", transformStyle: "preserve-3d", transformOrigin: "center" }}>
            {Array.from({ length: 20 }, (_, index) => { const col = index % 5; const row = Math.floor(index / 5); const occupied = index === 6 || index === 12; const code = `RAW-${String(row + 1).padStart(2, "0")}-${String(col + 1).padStart(2, "0")}`; return <button key={code} title={`${code} · X ${(col * 2.4).toFixed(1)}m / Y ${(row * 2.4).toFixed(1)}m`} onClick={() => { setForm((current) => ({ ...current, code, qrCode: `WMS-LOC:${code}`, area: "原材料仓库", nameZh: `原材料库位 ${code}`, xCoord: (col * 2.4).toFixed(2), yCoord: (row * 2.4).toFixed(2) })); setShowForm(true); }} style={{ position: "absolute", left: `${col * 19 + 3}%`, top: `${row * 20 + 4}%`, width: "14%", height: "14%", border: `2px solid ${occupied ? "#f97316" : "#2563eb"}`, borderRadius: 5, background: occupied ? "#fed7aa" : "#bfdbfe", boxShadow: "8px 10px 0 #64748b", cursor: "pointer", color: "#0f172a", fontSize: 10, fontWeight: 700 }}>{code}</button>; })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 18, marginTop: 10, fontSize: 12, color: "#475569" }}><span>蓝色：可用</span><span style={{ color: "#c2410c" }}>橙色：有库存/占用</span><span>点击后进入库位属性编辑</span></div>
      </section>

      <section className="surface-panel">
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>{t("wms.locationManagement.code", locale)}</th>
                <th>{t("wms.locationManagement.name", locale)}</th>
                <th>Type</th>
                <th>Area</th>
                <th>{t("wms.locationManagement.warehouse", locale) ?? "仓库"}</th>
                <th>Zone</th>
                <th>Capacity</th>
                <th>{t("common.status", locale)}</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={7} className="empty-state">{t("common.loading", locale)}</td></tr>
               : filtered.length === 0 ? <tr><td colSpan={7} className="empty-state">{t("common.empty", locale)}</td></tr>
               : filtered.map((loc, idx) => (
                <tr key={loc.id}>
                  <td>{idx + 1}</td>
                  <td><code>{loc.code}</code></td>
                  <td><strong>{loc[langKey] ?? loc.name_en}</strong></td>
                  <td>{loc.locationType ?? "—"}</td>
                  <td>{loc.area}</td>
                  <td><code>{loc.warehouseCode ?? "—"}</code></td>
                  <td><code>{loc.zoneCode ?? "—"}</code></td>
                  <td>{loc.capacityQty ? loc.capacityQty.toLocaleString() : "—"}</td>
                  <td><span className={`badge badge-${statusBadge(loc.status)}`}>{t(`wms.status.${loc.status}`, locale)}</span></td>
                  <td><button className="btn btn-secondary" onClick={() => openEdit(loc)}>编辑属性</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {selectedLayoutItem && (() => { const item = layoutItems.find(candidate => candidate.id === selectedLayoutItem); if (!item) return null; const widthMm = ((item.width || 12) / 100) * layoutConfig.warehouseWidthM * 1000; const heightMm = ((item.height || 10) / 100) * layoutConfig.warehouseDepthM * 1000; return <section className="surface-panel" style={{ marginTop: 12 }}><strong>当前对象实际尺寸（mm）</strong><div style={{ display: "flex", gap: 12, marginTop: 8 }}><label>宽度 mm<input className="input" type="number" min="1" value={Math.round(widthMm)} onChange={event => setLayoutItems(items => items.map(candidate => candidate.id === item.id ? { ...candidate, width: Math.max(0.01, (Number(event.target.value) || 1) / 1000 / layoutConfig.warehouseWidthM * 100) } : candidate))} /></label><label>高度 mm<input className="input" type="number" min="1" value={Math.round(heightMm)} onChange={event => setLayoutItems(items => items.map(candidate => candidate.id === item.id ? { ...candidate, height: Math.max(0.01, (Number(event.target.value) || 1) / 1000 / layoutConfig.warehouseDepthM * 100) } : candidate))} /></label></div></section>; })()}
    </div>
  );
}
