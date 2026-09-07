import { useEffect, useMemo, useRef, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { WmsMaterialRealtimeFlow } from "./WmsMaterialRealtimeFlow";
import { MaterialRollQrGenerator, type MaterialRollPrefill } from "../mes/MaterialRollQrGenerator";
import { apiClient, type ListEnvelope } from "../api/client";
import { wmsApi } from "../api/wms";
import * as XLSX from "xlsx";
import QRCode from "qrcode";
import { oaRepository, type OaRequest } from "../oa/oaApi";
import { WmsReceivingEmployeeCommunication } from "./WmsReceivingEmployeeCommunication";
import { resolveReceivingPackageIdentity } from "./receivingPackageScan";

/** Generic material receiving entry point for warehouse/material receivers. */
export function WmsMaterialReceiving({ locale }: { locale: Locale }) {
  const zh = locale === "zh-CN";
  const vi = locale === "vi-VN";
  const tx = (cn: string, en: string, vn: string) => zh ? cn : vi ? vn : en;
  const [supplier, setSupplier] = useState("");
  const [materialName, setMaterialName] = useState("");
  const [specification, setSpecification] = useState("");
  const [purchaseOrder, setPurchaseOrder] = useState("");
  const [supplierDeliverySheetNo, setSupplierDeliverySheetNo] = useState("");
  const [manufactureDate, setManufactureDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [supplierBarcode, setSupplierBarcode] = useState("");
  const [referenceSn, setReferenceSn] = useState("");
  const [receiptDate, setReceiptDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [unit, setUnit] = useState("PCS");
  const [caseCount, setCaseCount] = useState("");
  const [boxQty, setBoxQty] = useState(() => {
    try { return localStorage.getItem("wms:default-quantity-per-box") || ""; } catch { return ""; }
  });
  const [expectedQty, setExpectedQty] = useState("");
  const [receivedQty, setReceivedQty] = useState("");
  const [msdLevel, setMsdLevel] = useState(() => {
    try { return localStorage.getItem("wms:default-msd-level") || ""; } catch { return ""; }
  });
  const [msdFloorLifeHours, setMsdFloorLifeHours] = useState("");
  const [msdRules, setMsdRules] = useState<Array<{ materialCode: string; msdLevel: string; floorLifeHours: string }>>([]);
  const [msdBindingStatus, setMsdBindingStatus] = useState("");
  const [partialBox, setPartialBox] = useState(false);
  const [materialCode, setMaterialCode] = useState("");
  const [ruijingMaterialCode, setRuijingMaterialCode] = useState("");
  const [materialCodeMapping, setMaterialCodeMapping] = useState<Array<{ vietnam: string; ruijing: string; specification?: string; supplier?: string; msdLevel?: string; floorLifeHours?: string }>>([]);
  const [materialMappingStatus, setMaterialMappingStatus] = useState("");
  type ReceivingImportRow = Record<string, string> & { __row: string };
  const [receivingImportRows, setReceivingImportRows] = useState<ReceivingImportRow[]>([]);
  const [receivingImportName, setReceivingImportName] = useState("");
  const [receivingImportStatus, setReceivingImportStatus] = useState("");
  const [lot, setLot] = useState("");
  const [palletQr, setPalletQr] = useState("");
  const [palletType, setPalletType] = useState<"" | "SINGLE_PRODUCT" | "MIXED_PRODUCT">("MIXED_PRODUCT");
  const [palletSize, setPalletSize] = useState("");
  const [palletMaterial, setPalletMaterial] = useState("");
  const [motherQr, setMotherQr] = useState("");
  const [motherQrImage, setMotherQrImage] = useState("");
  const [locationQr, setLocationQr] = useState("");
  const [areaQr, setAreaQr] = useState("");
  const [locationCapacity, setLocationCapacity] = useState<{ capacity: number; occupied: number; name?: string } | null>(null);
  const [boxQr, setBoxQr] = useState("");
  const [boxQrs, setBoxQrs] = useState<string[]>([]);
  const [packageScans, setPackageScans] = useState<Array<{qrValue:string;serialNo:string;packageLevel:string;parentSerialNo?:string;quantity:number;effectiveQty:number;countingSource:string}>>([]);
  const [generatedCaseQr, setGeneratedCaseQr] = useState("");
  const [generatedCaseQrImage, setGeneratedCaseQrImage] = useState("");
  const [bindings, setBindings] = useState<Array<{ palletQr: string; boxQr: string; materialCode: string; quantity: number }>>([]);
  const [supplierIqc, setSupplierIqc] = useState<"PENDING" | "PASS" | "FAIL">("PENDING");
  const [pdaStatus, setPdaStatus] = useState<string>("");
  type PdaReceivingDevice = { id: string; operator: string; stage: string; material: string; pallet: string; completedBoxes: number; totalBoxes: number; lastAt: number };
  const [pdaDevices, setPdaDevices] = useState<PdaReceivingDevice[]>([]);
  const [selectedPdaDevice, setSelectedPdaDevice] = useState("ALL");
  const syncPdaDevice = selectedPdaDevice !== "ALL"
    ? selectedPdaDevice
    : (pdaDevices.find(device => device.lastAt > 0 && Date.now() - device.lastAt < 30000)?.id || "");
  useEffect(() => {
    const loadRegisteredReceivingPdas = () => {
      void apiClient.get<{ items?: any[] }>("/wms/pda-devices", { pool: "RECEIVING" }).then(result => {
        const registered = (result.items || []).slice(0, 5).map(item => ({
          id: String(item.device_id ?? item.deviceCode ?? item.serial_no ?? item.id),
          operator: String(item.current_holder_name ?? item.last_operator ?? item.assigned_to ?? "未登录"),
          stage: String(item.device_status ?? "REGISTERED"), material: "", pallet: "",
          completedBoxes: 0, totalBoxes: 0,
          lastAt: item.last_event_at ? new Date(item.last_event_at).getTime() : 0,
        }));
        setPdaDevices(current => {
          const byId = new Map(registered.map(device => [device.id, device]));
          current.forEach(device => byId.set(device.id, { ...byId.get(device.id), ...device }));
          return [...byId.values()].slice(0, 5);
        });
      }).catch(() => { /* event stream remains available when API is offline */ });
    };
    loadRegisteredReceivingPdas();
    const timer = window.setInterval(loadRegisteredReceivingPdas, 10000);
    return () => window.clearInterval(timer);
  }, []);
  const [oaRequest, setOaRequest] = useState<OaRequest | null>(null);
  const [oaBusy, setOaBusy] = useState(false);
  type Certificate = { id: string; fileName: string; dataUrl: string; category: "DELIVERY_SHEET" | "QUALITY_CERTIFICATE" | "INSPECTION_REPORT" | "OTHER"; notes: string };
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [boundMaterials, setBoundMaterials] = useState<Array<Record<string, any>>>([]);
  type PendingReceivingMaterial = {
    id: number;
    po_no: string;
    material_code: string;
    lot_no: string;
    total_quantity: number;
    unit: string;
    outer_box_count: number;
    label_count: number;
    scanned_label_count: number;
    status: string;
    supplier_code: string;
    supplier_name: string;
    registered_at: string;
  };
  const testReceivingMaterials: PendingReceivingMaterial[] = [
    { id: -1, po_no: "PO-TEST-RECV-001", material_code: "R0210-01019", lot_no: "LOT-20260904-A", total_quantity: 5000, unit: "PCS", outer_box_count: 5, label_count: 5, scanned_label_count: 0, status: "READY", supplier_code: "SUP-TEST-01", supplier_name: "测试供应商 A", registered_at: new Date().toISOString() },
    { id: -2, po_no: "PO-TEST-RECV-002", material_code: "R0210-01020", lot_no: "LOT-20260904-B", total_quantity: 3000, unit: "PCS", outer_box_count: 3, label_count: 3, scanned_label_count: 0, status: "READY", supplier_code: "SUP-TEST-02", supplier_name: "测试供应商 B", registered_at: new Date().toISOString() },
    { id: -3, po_no: "PO-TEST-RECV-003", material_code: "R0210-01021", lot_no: "LOT-20260904-C", total_quantity: 1200, unit: "PCS", outer_box_count: 2, label_count: 2, scanned_label_count: 0, status: "READY", supplier_code: "SUP-TEST-03", supplier_name: "测试供应商 C", registered_at: new Date().toISOString() },
  ];
  const [pendingReceivingMaterials, setPendingReceivingMaterials] = useState<PendingReceivingMaterial[]>([]);
  const [pendingReceivingLoading, setPendingReceivingLoading] = useState(false);
  const loadPendingReceivingMaterials = () => {
    setPendingReceivingLoading(true);
    void apiClient
      .get<ListEnvelope<PendingReceivingMaterial>>("/wms/receiving/pre-receiving-manifests")
      .then((result) => setPendingReceivingMaterials(result.items?.length ? result.items : testReceivingMaterials))
      .catch(() => setPendingReceivingMaterials(testReceivingMaterials))
      .finally(() => setPendingReceivingLoading(false));
  };
  useEffect(() => {
    loadPendingReceivingMaterials();
    const timer = window.setInterval(loadPendingReceivingMaterials, 15000);
    return () => window.clearInterval(timer);
  }, []);
  const selectPendingReceivingMaterial = (row: PendingReceivingMaterial) => {
    setPurchaseOrder(row.po_no || "");
    setSupplier(row.supplier_name || row.supplier_code || "");
    setMaterialCode(row.material_code || "");
    setLot(row.lot_no || "");
    setUnit(row.unit || "PCS");
    setCaseCount(String(row.outer_box_count || row.label_count || ""));
    setExpectedQty(String(row.total_quantity || ""));
    setReceivedQty("");
    setAreaQr("前台");
    setPdaStatus(tx("已选择待收料物料；请扫描前台库位 QR", "Pending receipt selected; scan a Front Area location QR", "Đã chọn vật liệu chờ nhận; quét QR vị trí khu tiếp nhận"));
  };
  type PalletMaterialLine = {
    id: string;
    materialCode: string;
    ruijingMaterialCode: string;
    materialName: string;
    lot: string;
    caseCount: string;
    quantityPerBox: string;
    quantity: string;
    unit: string;
    supplier: string;
  };
  const [palletMaterials, setPalletMaterials] = useState<PalletMaterialLine[]>([]);
  useEffect(() => {
    if (palletType === "MIXED_PRODUCT" && palletMaterials.length === 0) {
      setPalletMaterials([{ id: `${Date.now()}-${Math.random()}`, materialCode: "", ruijingMaterialCode: "", materialName: "", lot: "", caseCount: "", quantityPerBox: "", quantity: "", unit: "PCS", supplier: supplier.trim() }]);
    }
  }, [palletType]);
  const certificateInput = useRef<HTMLInputElement>(null);
  const [labelImage, setLabelImage] = useState("");
  const [labelOcrBusy, setLabelOcrBusy] = useState(false);
  const [labelOcrMessage, setLabelOcrMessage] = useState("");
  const [labelOcrData, setLabelOcrData] = useState<Record<string, unknown> | null>(null);
  const [labelCameraStream, setLabelCameraStream] = useState<MediaStream | null>(null);
  const labelVideo = useRef<HTMLVideoElement>(null);
  const labelCanvas = useRef<HTMLCanvasElement>(null);
  const lastAppliedBoxQr = useRef("");
  const ocrImageInFlight = useRef("");
  useEffect(() => {
    try {
      if (boxQty.trim()) localStorage.setItem("wms:default-quantity-per-box", boxQty.trim());
      else localStorage.removeItem("wms:default-quantity-per-box");
    } catch { /* browser storage may be unavailable */ }
  }, [boxQty]);
  useEffect(() => {
    const perBox = Number(boxQty);
    const boxes = Number(caseCount);
    if (perBox > 0 && boxes > 0) {
      const total = String(perBox * boxes);
      setExpectedQty(total);
      setReceivedQty(total);
    }
  }, [boxQty, caseCount]);
  useEffect(() => {
    try {
      if (msdLevel.trim()) localStorage.setItem("wms:default-msd-level", msdLevel.trim());
      else localStorage.removeItem("wms:default-msd-level");
    } catch { /* browser storage may be unavailable */ }
  }, [msdLevel]);
  useEffect(() => {
    const code = materialCode.trim();
    if (!code) return;
    const localMatch = materialCodeMapping.find(row => row.vietnam.toUpperCase() === code.toUpperCase());
    if (localMatch?.ruijing) setRuijingMaterialCode(localMatch.ruijing);
    if (localMatch?.specification) setSpecification(localMatch.specification);
    if (localMatch?.supplier) setSupplier(localMatch.supplier);
    let cancelled = false;
    void apiClient.get<ListEnvelope<{ vietnamMaterialCode: string; ruijingMaterialCode: string; specification?: string; supplierName?: string; msdLevel?: string; floorLifeHours?: string }>>("/wms/material-label-master", { q: code }).then(result => {
      const match = (result.items || []).find(item => item.vietnamMaterialCode.trim().toUpperCase() === code.toUpperCase());
      if (!cancelled && match) {
        setRuijingMaterialCode(match.ruijingMaterialCode || "");
        if (match.specification) setSpecification(match.specification);
        if (match.supplierName) setSupplier(match.supplierName);
        if (match.msdLevel) setMsdLevel(match.msdLevel.replace(/^MS[- ]?/i, ""));
        if (match.floorLifeHours) setMsdFloorLifeHours(match.floorLifeHours);
      }
    }).catch(() => { /* manual entry remains available */ });
    return () => { cancelled = true; };
  }, [materialCode, materialCodeMapping]);
  useEffect(() => {
    const code = ruijingMaterialCode.trim();
    if (!code) return;
    const match = materialCodeMapping.find(row => row.ruijing.toUpperCase() === code.toUpperCase());
    if (match?.vietnam && match.vietnam.toUpperCase() !== materialCode.trim().toUpperCase()) setMaterialCode(match.vietnam);
    if (match?.specification) setSpecification(match.specification);
    if (match?.supplier) setSupplier(match.supplier);
    let cancelled = false;
    void apiClient.get<ListEnvelope<{ vietnamMaterialCode: string; ruijingMaterialCode: string; specification?: string; supplierName?: string; msdLevel?: string; floorLifeHours?: string }>>("/wms/material-label-master", { q: code }).then(result => {
      const remoteMatch = (result.items || []).find(item => item.ruijingMaterialCode.trim().toUpperCase() === code.toUpperCase());
      if (!cancelled && remoteMatch) {
        if (remoteMatch.vietnamMaterialCode && remoteMatch.vietnamMaterialCode.trim().toUpperCase() !== materialCode.trim().toUpperCase()) setMaterialCode(remoteMatch.vietnamMaterialCode);
        if (remoteMatch.specification) setSpecification(remoteMatch.specification);
        if (remoteMatch.supplierName) setSupplier(remoteMatch.supplierName);
        if (remoteMatch.msdLevel) setMsdLevel(remoteMatch.msdLevel.replace(/^MS[- ]?/i, ""));
        if (remoteMatch.floorLifeHours) setMsdFloorLifeHours(remoteMatch.floorLifeHours);
      }
    }).catch(() => { /* manual entry remains available */ });
    return () => { cancelled = true; };
  }, [ruijingMaterialCode, materialCodeMapping]);
  useEffect(() => {
    const code = materialCode.trim().toUpperCase();
    if (!code) return;
    const rule = msdRules.find(item => item.materialCode.toUpperCase() === code);
    if (rule) {
      setMsdLevel(rule.msdLevel);
      setMsdFloorLifeHours(rule.floorLifeHours);
    }
  }, [materialCode, msdRules]);
  useEffect(() => {
    const sn = referenceSn.trim();
    if (!sn) return;
    let cancelled = false;
    void apiClient.get<ListEnvelope<any>>("/wms/material-roll-labels", { q: sn }).then(result => {
      if (cancelled) return;
      const row = (result.items || []).find(item => String(item.materialSn || "").trim().toUpperCase() === sn.toUpperCase());
      if (!row) return;
      const qr = row.qrPayload && typeof row.qrPayload === "object" ? row.qrPayload : {};
      const code = String(row.materialCode || qr.materialCode || "").trim();
      const level = String(qr.msdLevel || "").trim().replace(/^MS[- ]?/i, "");
      if (code) setMaterialCode(code);
      if (level) setMsdLevel(level);
    }).catch(() => { /* keep scanned fields; SN mapping can retry on next scan */ });
    return () => { cancelled = true; };
  }, [referenceSn]);
  useEffect(() => {
    const code = materialCode.trim();
    const level = msdLevel.trim();
    if (!code || !level) return;
    let cancelled = false;
    const token = sessionStorage.getItem("auth_token");
    void fetch("/api/wms/material-msd-bindings/check-and-bind", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ materialCode: code, msdLevel: level, floorLifeHours: msdFloorLifeHours ? Number(msdFloorLifeHours) : null }) })
      .then(async response => { const body = await response.json().catch(() => ({})); if (cancelled) return; if (!response.ok) throw new Error(body?.error?.message || body?.message || "MSD binding conflict"); setMsdBindingStatus(tx("MS等级已与物料编码永久绑定", "MSD level permanently bound to material code", "MSD da duoc gan vinh vien voi ma vat lieu")); })
      .catch(error => { if (!cancelled) setMsdBindingStatus(String(error.message || error)); });
    return () => { cancelled = true; };
  }, [materialCode, msdLevel, msdFloorLifeHours]);
  // Publish the complete current WMS draft so the unified PDA shows exactly
  // the same fields. Blank values stay blank; the PDA never invents data.
  const workflowStage = !materialCode.trim() || !lot.trim()
        ? "MATERIAL_INFO"
        : !boxQr.trim() && !boxQrs.length
          ? "BOX_SCAN"
          : !locationQr.trim()
              ? "LOCATION_BIND"
              : "RECEIVING_COMPLETE";
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const payload = {
        source: "WMS_WEB",
        phase: "DRAFT",
        workflowStage,
        materialCode: materialCode.trim(),
        vietnamMaterialCode: materialCode.trim(),
        internalMaterialCode: ruijingMaterialCode.trim(),
        ruijingMaterialCode: ruijingMaterialCode.trim(),
        materialName: materialName.trim(),
        specification: specification.trim(),
        purchaseOrder: purchaseOrder.trim(),
        supplierDeliverySheetNo: supplierDeliverySheetNo.trim(),
        manufactureDate: manufactureDate.trim(),
        expiryDate: expiryDate.trim(),
        supplierBarcode: supplierBarcode.trim(),
        supplier: supplier.trim(),
        receiptDate,
        lotNo: lot.trim(),
        unit,
        expectedQty,
        receivedQty,
        quantityPerBox: boxQty,
        quantity: boxQty,
        boxCount: caseCount,
        partialBox,
        palletQr: palletQr.trim(),
        palletType,
        palletSize: palletSize.trim(),
        palletMaterial: palletMaterial.trim(),
        areaQr: areaQr.trim(),
        receivingArea: areaQr.trim(),
        boxQr: boxQr.trim(),
        locationCode: locationQr.trim(),
        storageLocation: locationQr.trim(),
        msLevel: msdLevel,
        msdLevel,
        msdFloorLifeHours,
        floorLifeHours: msdFloorLifeHours,
        iqcResult: supplierIqc,
        at: Date.now(),
      };
      const token = sessionStorage.getItem("auth_token");
      void fetch("/api/pda/events", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ from: "wms_receiving", to: syncPdaDevice || "unified_pda", type: "WMS_RECEIVING_WMS_DRAFT", stationCode: "wms_receiving", payload: { ...payload, palletMaterials, targetDeviceId: syncPdaDevice || null } }),
      }).catch(() => { /* PDA may be offline; next change retries */ });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [workflowStage, materialCode, ruijingMaterialCode, materialName, specification, purchaseOrder, supplierDeliverySheetNo, manufactureDate, expiryDate, supplierBarcode, supplier, receiptDate, lot, unit, expectedQty, receivedQty, boxQty, caseCount, palletQr, palletType, palletSize, palletMaterial, areaQr, boxQr, locationQr, msdLevel, msdFloorLifeHours, supplierIqc, palletMaterials, syncPdaDevice]);
  const importMaterialCodeMapping = async (file: File | undefined) => {
    if (!file) return;
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = workbook.Sheets["Sheet1"];
    if (!sheet) { setMaterialMappingStatus(tx("失败：Excel中没有Sheet1", "Failed: Sheet1 is missing", "Loi: thieu Sheet1")); return; }
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
    const headerIndex = matrix.findIndex(row => row.some(value => ["越南东泰料号", "越南料号", "深圳瑞晶料号", "规格"].includes(String(value).trim())));
    if (headerIndex < 0) { setMaterialMappingStatus(tx("失败：Sheet1物料主数据字段不匹配", "Failed: Sheet1 material-master headers were not recognized", "Loi: khong nhan dien duoc cot master tren Sheet1")); return; }
    const headers = matrix[headerIndex].map(value => String(value).trim());
    const rows = matrix.slice(headerIndex + 1).filter(row => row.some(value => String(value).trim() !== "")).map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]))) as Record<string, unknown>[];
    rows.forEach(row => {
      row["Vietnam material code"] = row["\u6df1\u5733\u745e\u6676\u6599\u53f7"] ?? row["\u745e\u6676\u6599\u53f7"] ?? row["\u54c1\u53f7"] ?? "";
      row["Ruijing material code"] = row["\u8d8a\u5357\u4e1c\u6cf0\u6599\u53f7"] ?? row["\u8d8a\u5357\u6599\u53f7"] ?? "";
      row["Specification"] = row["\u89c4\u683c"] ?? "";
      row["Supplier"] = row["\u4f9b\u5e94\u5546"] ?? "";
      row["MSD level"] = row["MSD"] ?? "";
    });
    const mappings = rows.map(row => ({
      vietnam: String(row["Vietnam material code"] ?? row["Vietnam code"] ?? row["越南料号"] ?? row["越南东泰料号"] ?? "").trim(),
      ruijing: String(row["Ruijing material code"] ?? row["Ruijing code"] ?? row["瑞晶料号"] ?? row["深圳瑞晶料号"] ?? row["物料编码"] ?? "").trim(),
      specification: String(row["Specification"] ?? row["规格型号"] ?? row["Description"] ?? "").trim(),
      supplier: String(row["Supplier"] ?? row["供应商"] ?? "").trim(),
      msdLevel: String(row["MSD level"] ?? row["MS level"] ?? row["MSD等级"] ?? row["MS等级"] ?? "").trim().replace(/^MS[- ]?/i, ""),
      floorLifeHours: String(row["Standard floor life hours"] ?? row["Floor life hours"] ?? row["标准暴露时限（小时）"] ?? row["标准暴露时限"] ?? "").trim(),
    })).filter(row => row.vietnam || row.ruijing);
    // MSD is maintained in the same workbook's warehouse ledger sheet.
    const msdSheet = workbook.Sheets["物料仓台账 (2)"];
    const msdMatrix = msdSheet ? XLSX.utils.sheet_to_json<unknown[]>(msdSheet, { header: 1, defval: "" }) : [];
    const msdHeaderIndex = msdMatrix.findIndex(row => row.some(value => ["RJ物料料号", "VN 料号", "越南料号", "湿敏等级(MSL)"].includes(String(value).trim())));
    const msdHeaders = msdHeaderIndex >= 0 ? msdMatrix[msdHeaderIndex].map(value => String(value).trim()) : [];
    const msdRows = msdHeaderIndex >= 0 ? msdMatrix.slice(msdHeaderIndex + 1).filter(row => row.some(value => String(value).trim() !== "")).map(row => Object.fromEntries(msdHeaders.map((header, index) => [header, row[index] ?? ""]))) as Record<string, unknown>[] : [];
    const msdText = (row: Record<string, unknown>, key: string) => String(row[key] ?? "").trim();
    const msdByCode = new Map<string, { msdLevel: string; floorLifeHours: string }>();
    msdRows.forEach(row => {
      const codes = [msdText(row, "越南料号"), msdText(row, "VN 料号"), msdText(row, "RJ物料料号")].filter(Boolean);
      const msdLevel = msdText(row, "湿敏等级(MSL)").replace(/^MS[- ]?/i, "");
      const floorLifeHours = (msdText(row, "允许开封时长") || msdText(row, "保存寿命")).replace(/[^0-9.]/g, "");
      codes.forEach(code => msdByCode.set(code.toUpperCase(), { msdLevel, floorLifeHours }));
      const vietnam = msdText(row, "RJ物料料号");
      const ruijing = msdText(row, "越南料号");
      if (vietnam || ruijing) mappings.push({ vietnam, ruijing, specification: msdText(row, "规格型号"), supplier: msdText(row, "供应商"), msdLevel, floorLifeHours });
    });
    mappings.forEach(row => {
      const msd = msdByCode.get(row.vietnam.toUpperCase()) || msdByCode.get(row.ruijing.toUpperCase());
      if (msd) { row.msdLevel = row.msdLevel || msd.msdLevel; row.floorLifeHours = row.floorLifeHours || msd.floorLifeHours; }
    });
    setMaterialCodeMapping(mappings);
    setMaterialMappingStatus(tx(`已导入 SMT 卷料 Excel · Sheet1 · ${mappings.length} 条`, `Imported the same SMT material-roll Excel · Sheet1 · ${mappings.length} rows`, `Da nhap Excel cuon vat lieu SMT · Sheet1 · ${mappings.length} dong`));
    await apiClient.post("/wms/material-label-master/import-sheet1", {
      payload: {
        sourceFile: file.name,
        sourceSheet: "Sheet1",
        rows: mappings.map(row => ({ vietnamMaterialCode: row.vietnam, ruijingMaterialCode: row.ruijing, specification: row.specification || "", supplierName: row.supplier || "", msdLevel: row.msdLevel || "", floorLifeHours: row.floorLifeHours || "" }))
      }
    }).catch(() => {
      setMaterialMappingStatus(tx(`本地映射已加载 · ${mappings.length} 条；服务器同步稍后重试`, `Local mapping loaded · ${mappings.length} rows; server sync will retry later`, `Da tai anh xa cuc bo · ${mappings.length} dong; se thu dong bo may chu sau`));
    });
    setMsdRules(mappings.filter(row => row.vietnam && row.msdLevel).map(row => ({ materialCode: row.vietnam, msdLevel: row.msdLevel, floorLifeHours: row.floorLifeHours })));
    const current = materialCode.trim().toUpperCase();
    const match = mappings.find(row => row.vietnam.toUpperCase() === current) || mappings[0];
    if (match) { setMaterialCode(match.vietnam); setRuijingMaterialCode(match.ruijing); }
  };
  const importSharedSmtMapping = async () => {
    setMaterialMappingStatus(tx("正在读取同一份 SMT 卷料 Excel…", "Reading the shared SMT material-roll Excel…", "Dang doc Excel cuon SMT dung chung…"));
    try {
      const response = await fetch("/material_label_master.xlsx", { cache: "no-store" });
      if (!response.ok) throw new Error("material_label_master.xlsx unavailable");
      await importMaterialCodeMapping(new File([await response.blob()], "material_label_master.xlsx"));
    } catch (error) {
      setMaterialMappingStatus(error instanceof Error ? error.message : "Shared material master import failed");
    }
  };
  const importMsdRules = async (file: File | undefined) => {
    if (!file) return;
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = workbook.Sheets["Sheet1"] || workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    const value = (row: Record<string, unknown>, keys: string[]) => {
      const key = keys.find(candidate => Object.prototype.hasOwnProperty.call(row, candidate));
      return key ? String(row[key] ?? "").trim() : "";
    };
    const rules = rows.map(row => ({
      materialCode: value(row, ["Vietnam material code", "Material code", "物料编码", "越南物料编码"]),
      msdLevel: value(row, ["MSD level", "MS level", "MSD等级", "MS等级"]).replace(/^MS[- ]?/i, ""),
      floorLifeHours: value(row, ["Standard floor life hours", "Floor life hours", "标准暴露时限（小时）", "标准暴露时限"]),
    })).filter(row => row.materialCode && row.msdLevel);
    setMsdRules(rules);
    const current = materialCode.trim().toUpperCase();
    const match = rules.find(row => row.materialCode.toUpperCase() === current) || rules[0];
    if (match) { setMaterialCode(match.materialCode); setMsdLevel(match.msdLevel); setMsdFloorLifeHours(match.floorLifeHours); }
  };
  const importReceivingExcel = async (file: File | undefined) => {
    if (!file) return;
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error("收料 Excel 没有工作表");
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const rows = raw.map((row, index) => Object.assign({ __row: String(index + 2) }, Object.fromEntries(Object.entries(row).map(([key, value]) => [String(key).trim(), String(value ?? "").trim()])))).filter(row => Object.entries(row).some(([key, value]) => key !== "__row" && value));
      if (!rows.length) throw new Error("收料 Excel 没有可用数据行");
      setReceivingImportRows(rows);
      setReceivingImportName(file.name);
      setReceivingImportStatus(`已读取 ${rows.length} 条收料记录；请选择一行带入收料表单`);
    } catch (error) {
      setReceivingImportRows([]);
      setReceivingImportName(file.name);
      setReceivingImportStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const selectReceivingImportRow = (row: ReceivingImportRow) => {
    const pick = (...keys: string[]) => { const key = keys.find(candidate => Object.prototype.hasOwnProperty.call(row, candidate) && row[candidate]); return key ? row[key] : ""; };
    setPurchaseOrder(pick("采购订单", "PO", "PO No", "Purchase Order"));
    setSupplierDeliverySheetNo(pick("供应商送货单", "送货单号", "Delivery Sheet", "Delivery Note"));
    setSupplier(pick("供应商", "Supplier", "Supplier Code"));
    setMaterialCode(pick("Vietnam material code", "越南物料编码", "物料编码", "Material Code"));
    setRuijingMaterialCode(pick("Ruijing material code", "瑞晶物料编码", "瑞晶编码"));
    setMaterialName(pick("物料名称", "Material Name", "Description"));
    setSpecification(pick("规格型号", "规格", "Specification"));
    setLot(pick("批次", "批次号", "Lot", "Lot No"));
    setManufactureDate(pick("生产日期", "Manufacture Date", "Date Code"));
    setExpiryDate(pick("有效期至", "Expiry Date"));
    setCaseCount(pick("箱数", "箱体数量", "Box Count", "Cases"));
    setBoxQty(pick("每箱数量", "每箱数量（标签数量）", "Quantity per Box", "Qty per Box"));
    setExpectedQty(pick("订单数量", "预计数量", "Expected Qty", "Ordered Qty"));
    setReceivedQty(pick("收料数量", "实收数量", "Received Qty", "Quantity"));
    setUnit(pick("单位", "Unit") || "PCS");
    setReceivingImportStatus(`已带入第 ${row.__row} 行，可继续扫描区域 QR、箱 QR 和仓位 QR`);
  };
  const receivingLabelPrefill = useMemo<MaterialRollPrefill>(() => ({
    materialSn: materialCode.trim(), materialCode: materialCode.trim(), description: specification.trim(),
    internalCode: ruijingMaterialCode.trim(), lotNo: lot.trim(), dateCode: (manufactureDate || receiptDate).trim(),
    supplierName: supplier.trim(), supplierBarcode: supplierBarcode.trim(), purchaseOrder: purchaseOrder.trim(),
    referenceSn: referenceSn.trim(),
    supplierLot: lot.trim(), quantity: Number(boxQty || receivedQty || expectedQty || 0), unit,
    msdLevel, floorLifeHours: msdFloorLifeHours, locationCode: locationQr.trim(),
    manufacturingDate: manufactureDate.trim(), expiryDate: expiryDate.trim(), plantCode: "RUIJING_VN",
    rollCount: Math.max(1, Number(caseCount) || 1), caseCount, palletQr: palletQr.trim(), boxQr: boxQr.trim(), supplierIqc,
    receivingStatus: "AWAITING_IQC",
  }), [materialCode, specification, ruijingMaterialCode, lot, manufactureDate, receiptDate, supplier, supplierBarcode, referenceSn, purchaseOrder, boxQty, receivedQty, expectedQty, unit, msdLevel, msdFloorLifeHours, locationQr, caseCount, palletQr, boxQr, supplierIqc]);
  const lookupSharedMaterial = (value: string, direction: "vietnam" | "ruijing") => {
    const code = value.trim().toUpperCase();
    if (!code) return;
    const match = materialCodeMapping.find(row => (direction === "vietnam" ? row.vietnam : row.ruijing).trim().toUpperCase() === code);
    if (!match) return;
    setMaterialCode(match.vietnam);
    setRuijingMaterialCode(match.ruijing);
    if (match.specification) setSpecification(match.specification);
    if (match.supplier) setSupplier(match.supplier);
    if (match.msdLevel) setMsdLevel(match.msdLevel.replace(/^MS[- ]?/i, ""));
    if (match.floorLifeHours) setMsdFloorLifeHours(match.floorLifeHours);
    setMaterialMappingStatus(tx("Excel双向互查完成", "Excel bidirectional lookup completed", "Da tra cuu hai chieu tu Excel"));
  };
  const addCertificates = async (files: FileList | null) => {
    if (!files) return;
    const next = await Promise.all(Array.from(files).map(file => new Promise<Certificate>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ id: `${file.name}-${file.lastModified}-${Math.random()}`, fileName: file.name, dataUrl: String(reader.result), category: "QUALITY_CERTIFICATE", notes: "" });
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    })));
    setCertificates(xs => [...xs, ...next]);
    if (certificateInput.current) certificateInput.current.value = "";
  };
  useEffect(() => {
    void apiClient.get<ListEnvelope<Record<string, any>>>("/wms/receiving/qr-bindings")
      .then(result => setBoundMaterials(result.items || []))
      .catch(() => setBoundMaterials([]));
  }, []);
  const startLabelCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      setLabelCameraStream(stream);
      if (labelVideo.current) labelVideo.current.srcObject = stream;
    } catch { setLabelOcrMessage(tx("无法打开PDA相机", "Unable to open PDA camera", "Khong the mo camera PDA")); }
  };
  const stopLabelCamera = () => { labelCameraStream?.getTracks().forEach(track => track.stop()); setLabelCameraStream(null); };
  const captureLabelImage = () => {
    if (!labelVideo.current || !labelCanvas.current) return;
    const video = labelVideo.current;
    const canvas = labelCanvas.current;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL("image/jpeg", 0.9);
    setLabelImage(image);
    setLabelOcrData(null);
    stopLabelCamera();
    void runLabelOcr(image);
  };
  const runLabelOcr = async (imageOverride?: string) => {
    const image = imageOverride || labelImage;
    if (!image) return;
    const imageKey = `${image.length}:${image.slice(-96)}`;
    if (ocrImageInFlight.current === imageKey) return;
    ocrImageInFlight.current = imageKey;
    setLabelOcrBusy(true);
    try {
      const token = sessionStorage.getItem("auth_token");
      const localDevHost = ["localhost", "127.0.0.1"].includes(window.location.hostname) && window.location.port === "5178";
      const ocrApi = localDevHost
        ? `${window.location.protocol}//${window.location.hostname}:8085/api/wms/receiving/label-ai`
        : "/api/wms/receiving/label-ai";
      const response = await fetch(ocrApi, {
        method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ image, qrValue: boxQr.trim() || palletQr.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error?.message || result?.message || "OCR failed");
      const data = result.data || result;
      const text = (value: unknown) => value == null ? "" : String(value).trim();
      if (data.parseFailed) {
        setLabelOcrData(null);
        setMsdBindingStatus("");
        setLabelOcrMessage(text(data.parseMessage) || tx("无法解析标签，请重新拍摄", "Unable to parse label; take another photo", "Không thể phân tích nhãn; vui lòng chụp lại"));
        return;
      }
      setLabelOcrData(data as Record<string, unknown>);
      const number = (value: unknown) => { const raw = text(value).replace(/,/g, ""); return raw && Number.isFinite(Number(raw)) ? raw : ""; };
      const vietnamCode = text(data.vietnamMaterialCode) || text(data.materialCode);
      if (vietnamCode) setMaterialCode(vietnamCode);
      if (text(data.ruijingMaterialCode)) setRuijingMaterialCode(text(data.ruijingMaterialCode));
      if (text(data.materialName)) setMaterialName(text(data.materialName));
      if (text(data.specification)) setSpecification(text(data.specification));
      if (text(data.lot)) setLot(text(data.lot));
      if (text(data.supplier)) setSupplier(text(data.supplier));
      if (text(data.purchaseOrder)) setPurchaseOrder(text(data.purchaseOrder));
      if (text(data.supplierBarcode)) setSupplierBarcode(text(data.supplierBarcode));
      if (text(data.referenceSn) || text(data.materialSn)) setReferenceSn(text(data.referenceSn) || text(data.materialSn));
      if (text(data.manufactureDate)) setManufactureDate(text(data.manufactureDate));
      if (text(data.expiryDate)) setExpiryDate(text(data.expiryDate));
      if (number(data.expectedQuantity)) setExpectedQty(number(data.expectedQuantity));
      // Supplier labels use “数量” for the quantity inside this box.
      // Keep it as quantity-per-box; total receiving quantity is calculated
      // from box quantity × verified box count.
      const detectedBoxQty = number(data.quantityPerBox) || number(data.boxQuantity) || number(data.quantity);
      if (detectedBoxQty) setBoxQty(detectedBoxQty);
      // Label quantity is the quantity inside this box. Total receiving
      // quantity is calculated only after the operator enters box count.
      if (text(data.unit)) setUnit(text(data.unit).toUpperCase());
      if (text(data.palletQr)) setPalletQr(text(data.palletQr));
      if (text(data.locationCode)) setLocationQr(text(data.locationCode));
      if (text(data.msdLevel)) setMsdLevel(text(data.msdLevel).replace(/^MS[- ]?/i, ""));
      if (number(data.floorLifeHours)) setMsdFloorLifeHours(number(data.floorLifeHours));
      const scannedBox = text(data.boxSn) || text(data.boxNumber);
      if (scannedBox) setBoxQr(scannedBox);
      if (!number(data.expectedQuantity) && number(data.quantity)) setExpectedQty(number(data.quantity));
      const warningText = Array.isArray(data.warnings) && data.warnings.length ? ` (${data.warnings.join("; ")})` : "";
      setLabelOcrMessage(tx(`识别完成，已回填收料信息${warningText}`, `OCR complete; receiving fields were filled${warningText}`, `OCR hoan tat; da dien thong tin tiep nhan${warningText}`));
    } catch (error) {
      setLabelOcrMessage(error instanceof Error ? error.message : String(error));
    } finally { ocrImageInFlight.current = ""; setLabelOcrBusy(false); }
  };
  const receivingDocuments = () => certificates.map(certificate => ({ documentType: certificate.category, documentUrl: certificate.dataUrl, fileName: certificate.fileName, capturedBy: sessionStorage.getItem("user_name") || "web-receiver", notes: certificate.notes, metadata: { source: "WMS_RECEIVING", purchaseOrder: purchaseOrder.trim(), supplierDeliverySheetNo: supplierDeliverySheetNo.trim(), lotNo: lot.trim(), supplier: supplier.trim(), receiptDate, category: certificate.category } }));
  const createMotherQr = async () => {
    const id = `WMS-PALLET:P${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    setMotherQr(id); setPalletQr(id);
    setMotherQrImage(await QRCode.toDataURL(id, { width: 180, margin: 1, errorCorrectionLevel: "M" }));
  };
  const printMotherQr = () => {
    if (!motherQr || !motherQrImage) return;
    const popup = window.open("", "mother-pallet-qr", "width=420,height=520");
    if (!popup) return;
    popup.document.write(`<html><body style="font-family:Arial;text-align:center;padding:24px"><h2>Mother Pallet QR</h2><img src="${motherQrImage}" width="240"><p>${motherQr}</p><script>window.onload=()=>window.print()</script></body></html>`);
    popup.document.close();
  };
  useEffect(() => {
    const apply = (incoming: any) => {
      if (!incoming) return;
      // Scanner events carry decoded material fields inside qrPayload while
      // older PDA events put them at the top level. Normalize both contracts
      // before updating the receiving form.
      const nestedQr = incoming.qrPayload && typeof incoming.qrPayload === "object" ? incoming.qrPayload : {};
      const payload = { ...incoming, ...nestedQr };
      // Outbound WMS drafts are for PDA consumption only. Ignore any stale
      // echoed copy that may still exist in live-state during a server reload.
      if (String(payload.source || "").toUpperCase() === "WMS_WEB") return;
      const now = Number(payload.at) || Date.now();
      const deviceId = String(payload.deviceId ?? payload.device_id ?? payload.from ?? "PDA-RECEIVING-UNKNOWN").trim();
      if (deviceId && deviceId !== "wms_receiving") {
        setPdaDevices(current => {
          const next = current.filter(device => device.id !== deviceId);
          next.push({
            id: deviceId,
            operator: String(payload.operatorName ?? payload.operator_name ?? payload.operator ?? "收料员"),
            stage: String(payload.workflowStage ?? payload.step ?? payload.phase ?? "DRAFT"),
            material: String(payload.materialCode ?? payload.vietnamMaterialCode ?? ""),
            pallet: String(payload.palletQr ?? ""),
            completedBoxes: Array.isArray(payload.labelsScanned) ? payload.labelsScanned.length : Number(payload.completedBoxes ?? 0) || 0,
            totalBoxes: Number(payload.boxCount ?? payload.totalBoxes ?? 0) || 0,
            lastAt: now,
          });
          return next.sort((a, b) => b.lastAt - a.lastAt).slice(0, 5);
        });
      }
      // Heartbeats only keep the PDA online. They often contain blank draft
      // fields and must never touch the currently displayed box information.
      if (String(payload.phase || "").toUpperCase() === "HEARTBEAT") return;
      const incomingArea = String(payload.areaQr ?? payload.receivingArea ?? "").trim();
      if (incomingArea && payload.changedField === "areaQr") {
        setAreaQr(incomingArea); setLocationQr(""); setLocationCapacity(null); setMaterialCode(""); setRuijingMaterialCode(""); setMaterialName(""); setSpecification(""); setSupplier(""); setSupplierBarcode(""); setSupplierDeliverySheetNo(""); setPurchaseOrder(""); setLot(""); setManufactureDate(""); setExpiryDate(""); setExpectedQty(""); setReceivedQty(""); setBoxQty(""); setCaseCount(""); setPartialBox(false); setPalletQr(""); setBoxQr(""); setBoxQrs([]); setBindings([]); setPalletMaterials([]); setGeneratedCaseQr(""); setGeneratedCaseQrImage(""); setPalletType("MIXED_PRODUCT"); setPalletSize(""); setPalletMaterial(""); setMsdLevel(""); setMsdFloorLifeHours(""); setMsdBindingStatus(""); setCertificates([]); setLabelImage(""); setLabelOcrData(null); setLabelOcrMessage(""); setSupplierIqc("PENDING"); setPdaStatus(`New warehouse area: ${incomingArea}; receiving inputs cleared`);
        return;
      }
      const hasNewImage = Boolean(payload.imageDataUrl || payload.image);
      const hasNewQr = Boolean(payload.materialRollQr || payload.materialQr || payload.qrPayload)
        || ["logistics-label-qr", "supplier-label-qr", "material-roll-qr-v2", "standard-qr-complete"]
          .includes(String(payload.changedField || ""));
      if (hasNewImage || hasNewQr) {
        if (hasNewImage) setLabelImage(String(payload.imageDataUrl || payload.image)); else setLabelImage("");
        setLabelOcrData(null);
        setLabelOcrMessage("");
      }
      // PDA may publish one scan as several patches (box QR, decoded fields,
      // then status). Never clear confirmed fields when the box patch arrives;
      // merge every non-empty decoded value below instead.
      const isCompletedQrRead = ["logistics-label-qr", "supplier-label-qr", "material-roll-qr-v2", "standard-qr-complete"]
        .includes(String(payload.changedField || ""));
      const incomingBoxIdentity = String(payload.boxQr ?? payload.supplierBarcode ?? payload.materialRollQr ?? payload.materialQr ?? "").trim();
      const isDifferentBox = isCompletedQrRead && Boolean(incomingBoxIdentity) && incomingBoxIdentity !== lastAppliedBoxQr.current;
      if (isDifferentBox) {
        lastAppliedBoxQr.current = incomingBoxIdentity;
        // Keep the previous box visible while scanning. Once the next QR has
        // decoded successfully, replace its material fields as one React batch.
        setMaterialCode(""); setRuijingMaterialCode(""); setMaterialName(""); setSpecification("");
        setSupplier(""); setSupplierBarcode(""); setPurchaseOrder(""); setLot("");
        setReferenceSn("");
        setManufactureDate(""); setExpiryDate(""); setExpectedQty(""); setReceivedQty("");
        setBoxQty(""); setBoxQr("");
      }
      if (payload.vietnamMaterialCode !== undefined || payload.materialCode !== undefined) setMaterialCode(String(payload.vietnamMaterialCode ?? payload.materialCode ?? ""));
      if (payload.ruijingMaterialCode !== undefined || payload.internalMaterialCode !== undefined) setRuijingMaterialCode(String(payload.ruijingMaterialCode ?? payload.internalMaterialCode ?? ""));
      if (payload.materialName !== undefined) setMaterialName(String(payload.materialName || ""));
      if (payload.areaQr || payload.receivingArea) setAreaQr(String(payload.areaQr ?? payload.receivingArea));
      if (payload.specification !== undefined) setSpecification(String(payload.specification || ""));
      if (payload.supplier !== undefined || payload.supplierName !== undefined) setSupplier(String(payload.supplier ?? payload.supplierName ?? ""));
      if (payload.purchaseOrder !== undefined || payload.poNo !== undefined) setPurchaseOrder(String(payload.purchaseOrder ?? payload.poNo ?? ""));
      if (payload.manufactureDate !== undefined || payload.dateCode !== undefined) setManufactureDate(String(payload.manufactureDate ?? payload.dateCode ?? ""));
      if (payload.expiryDate !== undefined) setExpiryDate(String(payload.expiryDate || ""));
      if (payload.supplierBarcode !== undefined) setSupplierBarcode(String(payload.supplierBarcode || ""));
      if (payload.referenceSn !== undefined || payload.materialSn !== undefined) setReferenceSn(String(payload.referenceSn ?? payload.materialSn ?? ""));
      if (payload.receiptDate) setReceiptDate(String(payload.receiptDate));
      if (payload.lotNo !== undefined || payload.lot !== undefined || payload.supplierLot !== undefined) setLot(String(payload.lotNo ?? payload.lot ?? payload.supplierLot ?? ""));
      if (payload.palletQr !== undefined) setPalletQr(String(payload.palletQr || ""));
      if (payload.palletType !== undefined) { const palletValue = String(payload.palletType); setPalletType(palletValue === "MIXED_PRODUCT" || palletValue.includes("混料") ? "MIXED_PRODUCT" : palletValue === "SINGLE_PRODUCT" || palletValue.includes("单一") ? "SINGLE_PRODUCT" : ""); }
      if (payload.palletSize !== undefined) setPalletSize(String(payload.palletSize || ""));
      if (payload.palletMaterial !== undefined) setPalletMaterial(String(payload.palletMaterial || ""));
      if (payload.boxQr !== undefined) setBoxQr(String(payload.boxQr || ""));
      if (payload.unit) setUnit(String(payload.unit));
      if (payload.expectedQty !== undefined) setExpectedQty(String(payload.expectedQty));
      if (payload.receivedQty !== undefined) setReceivedQty(String(payload.receivedQty));
      // PDA reports the quantity printed on one case. It must never overwrite
      // the receiving total; the total is calculated from verified box count.
      if (payload.quantityPerBox !== undefined || payload.quantity !== undefined) {
        const value = payload.quantityPerBox ?? payload.quantity;
        setBoxQty(String(value ?? ""));
      }
      if (payload.locationQr !== undefined || payload.storageLocation !== undefined || payload.locationCode !== undefined) setLocationQr(String(payload.locationQr ?? payload.storageLocation ?? payload.locationCode ?? ""));
      if (payload.partialBox !== undefined) setPartialBox(Boolean(payload.partialBox));
      if (payload.msdLevel !== undefined || payload.msLevel !== undefined) setMsdLevel(String(payload.msdLevel ?? payload.msLevel ?? "").replace(/^MS[- ]?/i, ""));
      if (payload.floorLifeHours !== undefined || payload.msdFloorLifeHours !== undefined) setMsdFloorLifeHours(String(payload.floorLifeHours ?? payload.msdFloorLifeHours ?? ""));
      if (payload.iqcResult) setSupplierIqc(String(payload.iqcResult).toUpperCase() === "PASS" ? "PASS" : String(payload.iqcResult).toUpperCase() === "FAIL" ? "FAIL" : "PENDING");
      setPdaStatus(String(payload.phase || "RECEIVED") + (payload.changedField ? ` · ${payload.changedField}` : "") + (payload.at ? ` · ${new Date(Number(payload.at) || payload.at).toLocaleString()}` : ""));
    };
    try { apply(JSON.parse(localStorage.getItem("wms:pda-receiving-status") || "null")); } catch { /* ignore malformed bridge data */ }
    const onStatus = (event: Event) => apply((event as CustomEvent).detail);
    window.addEventListener("wms:pda-receiving-status", onStatus);
    const stream = new EventSource("/api/pda/events?node=wms_receiving&replay=1&types=WMS_RECEIVING_PDA_ACTIVITY");
    stream.onmessage = (event) => { try { const item = JSON.parse(event.data); apply(item.payload || item); } catch { /* polling/manual entry remains available */ } };
    const aiStream = new EventSource("/api/pda/events?node=wms_receiving&replay=1&types=WMS_RECEIVING_AI_RESULT");
    aiStream.onmessage = (event) => {
      try {
        const item = JSON.parse(event.data);
        const payload = item.payload || item;
        if (payload) {
          if (payload.imageDataUrl || payload.image) setLabelImage(String(payload.imageDataUrl || payload.image));
          setLabelOcrData(payload as Record<string, unknown>);
          const value = (key: string) => payload[key] == null ? "" : String(payload[key]).trim();
          if (value("vietnamMaterialCode") || value("materialCode")) setMaterialCode(value("vietnamMaterialCode") || value("materialCode"));
          if (value("ruijingMaterialCode")) setRuijingMaterialCode(value("ruijingMaterialCode"));
          if (value("referenceSn") || value("materialSn")) setReferenceSn(value("referenceSn") || value("materialSn"));
          if (value("lot")) setLot(value("lot"));
          if (value("supplier")) setSupplier(value("supplier"));
          if (payload.expectedQuantity != null) setExpectedQty(String(payload.expectedQuantity));
          if (payload.quantityPerBox != null) setBoxQty(String(payload.quantityPerBox));
          else if (payload.quantity != null) setBoxQty(String(payload.quantity));
          if (value("unit")) setUnit(value("unit").toUpperCase());
          if (value("palletQr")) setPalletQr(value("palletQr"));
          if (value("locationCode")) setLocationQr(value("locationCode"));
          if (value("msdLevel")) setMsdLevel(value("msdLevel").replace(/^MS[- ]?/i, ""));
          if (payload.floorLifeHours != null) setMsdFloorLifeHours(String(payload.floorLifeHours));
          if (value("boxSn") || value("boxNumber")) setBoxQr(value("boxSn") || value("boxNumber"));
          const extracted = ["materialCode", "vietnamMaterialCode", "ruijingMaterialCode", "lot", "supplier", "quantity", "quantityPerBox"]
            .some(key => payload[key] != null && String(payload[key]).trim() !== "");
          const warning = Array.isArray(payload.warnings) ? payload.warnings.filter(Boolean).join("；") : "";
          setLabelOcrMessage(extracted
            ? tx("已实时接收 PDA 标签识别结果，并自动回填收料信息", "Live PDA label result received and automatically applied", "Da nhan ket qua nhan PDA va tu dong dien thong tin")
            : tx(`WMS 已收到图片，但 OCR 未识别出字段${warning ? `：${warning}` : ""}`, `WMS received the image, but OCR extracted no fields${warning ? `: ${warning}` : ""}`, `WMS da nhan anh nhung OCR khong nhan dang duoc truong${warning ? `: ${warning}` : ""}`));
        }
      } catch { /* keep manual entry available */ }
    };
    const captureStream = new EventSource("/api/pda/events?node=wms_receiving&replay=1&types=WMS_RECEIVING_LABEL_CAPTURED");
    captureStream.onmessage = (event) => {
      try {
        const item = JSON.parse(event.data);
        const payload = item.payload || item;
        if (payload?.imageDataUrl || payload?.image) {
          stopLabelCamera();
          setLabelImage(String(payload.imageDataUrl || payload.image));
          setLabelOcrData(null);
          setLabelOcrMessage(tx("已收到PDA图片，WMS正在进行OCR分析…", "PDA image received; WMS OCR is processing…", "Da nhan anh tu PDA; WMS dang xu ly OCR..."));
          // Start OCR with the event payload directly because React state is
          // updated asynchronously and labelImage still contains the old value.
          void runLabelOcr(String(payload.imageDataUrl || payload.image));
        }
      } catch { /* keep manual entry available */ }
    };
    let lastPolledAt = 0;
    const syncLatestCapture = () => {
      void fetch("/api/wms/receiving/live-state", { cache: "no-store" }).then(response => response.ok ? response.json() : null).then(result => {
        const payload = result?.data?.payload || result?.payload;
        const payloadAt = Number(result?.data?.at ?? result?.at ?? payload?.at ?? 0);
        if (payload && payloadAt > lastPolledAt) {
          lastPolledAt = payloadAt;
          apply(payload);
        }
        const image = payload?.imageDataUrl || payload?.image;
        if (image) {
          setLabelImage(String(image));
          setLabelOcrMessage(tx("已从WMS实时状态恢复PDA图片", "PDA image restored from WMS live state", "Da khoi phuc anh PDA tu trang thai WMS"));
        }
      }).catch(() => { /* SSE remains the primary live path */ });
    };
    syncLatestCapture();
     const devicePoll = window.setInterval(() => setPdaDevices(current => current.filter(device => Date.now() - device.lastAt < 30000)), 5000);
     return () => { window.removeEventListener("wms:pda-receiving-status", onStatus); stream.close(); aiStream.close(); captureStream.close(); window.clearInterval(devicePoll); };
  }, []);
  const addBox = async () => {
    const value = boxQr.trim();
    if (!value || !locationQr.trim() || boxQrs.includes(value)) return;
    const effectivePalletQr = palletQr.trim() || `WMS-PALLET:P${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    if (!palletQr.trim()) { setPalletQr(effectivePalletQr); setMotherQr(effectivePalletQr); setMotherQrImage(await QRCode.toDataURL(effectivePalletQr, { width: 180, margin: 1, errorCorrectionLevel: "M" })); }
    const token = sessionStorage.getItem("auth_token");
    let packageInfo:any=null;
    if(value.includes("*")){const packageResponse=await fetch("/api/wms/receiving/package-scan",{method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({qrValue:value,palletQr:effectivePalletQr,locationQr:locationQr.trim()})});if(!packageResponse.ok){const error=await packageResponse.json().catch(()=>({}));setPdaStatus(error?.error?.message||tx("供应商箱码格式无效","Invalid supplier package QR","QR kiện hàng NCC không hợp lệ"));return;}packageInfo=(await packageResponse.json()).data;setPackageScans(xs=>[...xs.filter(x=>x.qrValue!==value),packageInfo]);if(materialCode.trim()&&packageInfo.material_code&&packageInfo.material_code.toUpperCase()!==materialCode.trim().toUpperCase()){setPdaStatus(tx("箱码物料与当前收料物料不一致","Box material does not match current receiving material","Vật liệu trên thùng không khớp"));return;}setMaterialCode(String(packageInfo.material_code||""));setLot(String(packageInfo.lot_no||""));setPurchaseOrder(String(packageInfo.poNo||""));setSupplier(String(packageInfo.supplierCode||packageInfo.supplier_code||""));setExpectedQty(String(packageInfo.poRemainingQty||""));setReceivedQty(current=>String(Number(current||0)+Number(packageInfo.quantity||0)));}
    const identity = resolveReceivingPackageIdentity({ materialCode: materialCode.trim(), lotNo: lot.trim(), purchaseOrder: purchaseOrder.trim(), supplier: supplier.trim() }, packageInfo);
    const generatedCaseQrValue = [
      "CASE", `RSN${String(boxQrs.length + 1).padStart(3, "0")}`, identity.materialCode, ruijingMaterialCode.trim(), identity.lotNo, identity.purchaseOrder,
      manufactureDate.trim(), receiptDate, String(Number(packageInfo?.quantity || boxQty || receivedQty || 0)), unit,
      identity.supplier, supplierBarcode.trim(), msdLevel.trim(), msdFloorLifeHours.trim(), value, effectivePalletQr, areaQr.trim(), locationQr.trim(),
    ].join("|");
    const bindingQty=Number(packageInfo?.quantity||boxQty||receivedQty||0),packageLevel=packageInfo?.packageLevel||"OUTER",parentBoxQr=packageInfo?.parentSerialNo||null;
    const response = await fetch("/api/wms/receiving/pallet-box-bindings", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ areaQr: areaQr.trim(), palletQr: effectivePalletQr, palletType, palletSize: palletSize.trim(), palletMaterial: palletMaterial.trim(), materialCode: identity.materialCode, vietnamMaterialCode: identity.materialCode, ruijingMaterialCode: ruijingMaterialCode.trim(), specification: specification.trim(), quantity: bindingQty, declaredQty:bindingQty, packageLevel,parentBoxQr, boxQr: value, sourceBoxQr: value, generatedCaseQr: generatedCaseQrValue, caseQrValue: generatedCaseQrValue, lotNo: identity.lotNo, supplier: identity.supplier, purchaseOrder: identity.purchaseOrder, supplierBarcode: supplierBarcode.trim(), locationQr: locationQr.trim(), msdLevel: msdLevel || null, msdFloorLifeHours: msdFloorLifeHours ? Number(msdFloorLifeHours) : null, palletQrType: motherQr || !palletQr.trim() ? "GENERATED_MOTHER" : "SUPPLIER_PALLET", palletMaterials: palletMaterials.map(line => ({ ...line, quantity: Number(line.quantity || line.quantityPerBox || 0), caseCount: Number(line.caseCount || 0), quantityPerBox: Number(line.quantityPerBox || 0) })), receivingDocuments: receivingDocuments() }) });
    if (!response.ok) { const error=await response.json().catch(()=>({})); setPdaStatus(error?.error?.message||tx("箱码绑定失败","Box binding failed","Liên kết mã thùng thất bại")); return; }
    setBoxQrs(xs => [...xs, value]);
    setBindings(xs => [...xs, { palletQr: effectivePalletQr, boxQr: generatedCaseQrValue, materialCode: identity.materialCode, quantity: bindingQty }]);
    setBoxQr("");
  };
  const addPalletMaterial = () => setPalletMaterials(lines => [...lines, { id: `${Date.now()}-${Math.random()}`, materialCode: "", ruijingMaterialCode: "", materialName: "", lot: "", caseCount: "", quantityPerBox: "", quantity: "", unit: "PCS", supplier: supplier.trim() }]);
  const updatePalletMaterial = (id: string, field: keyof Omit<PalletMaterialLine, "id">, value: string) => setPalletMaterials(lines => lines.map(line => line.id === id ? { ...line, [field]: value } : line));
  const usePalletMaterial = (line: PalletMaterialLine) => {
    setMaterialCode(line.materialCode);
    setRuijingMaterialCode(line.ruijingMaterialCode);
    setMaterialName(line.materialName);
    setLot(line.lot);
    setCaseCount(line.caseCount);
    setBoxQty(line.quantityPerBox);
    setReceivedQty(line.quantity || (Number(line.caseCount || 0) * Number(line.quantityPerBox || 0)).toString());
    setUnit(line.unit);
    if (line.supplier) setSupplier(line.supplier);
  };
  const buildCaseQrValue = (sourceBoxQr: string, pallet: string) => [
    "CASE", `RSN${String(boxQrs.length + 1).padStart(3, "0")}`, materialCode.trim(), ruijingMaterialCode.trim(), lot.trim(), purchaseOrder.trim(),
    manufactureDate.trim(), receiptDate, String(Number(boxQty || receivedQty || 0)), unit,
    supplier.trim(), supplierBarcode.trim(), msdLevel.trim(), msdFloorLifeHours.trim(),
    sourceBoxQr.trim(), pallet.trim(), areaQr.trim(), locationQr.trim()
  ].join("|");
  const generateCaseQrPreview = async () => {
    const source = boxQr.trim() || `BOX-${boxQrs.length + 1}`;
    const value = buildCaseQrValue(source, palletQr.trim() || "PENDING-PALLET");
    setGeneratedCaseQr(value);
    setGeneratedCaseQrImage(await QRCode.toDataURL(value, { width: 180, margin: 1, errorCorrectionLevel: "M" }));
  };
  const resolveLocation = async () => { if (!locationQr.trim()) return; const token = sessionStorage.getItem("auth_token"); const headers = token ? { Authorization: `Bearer ${token}` } : {}; const value = encodeURIComponent(locationQr.trim()); const response = await fetch(`/api/wms/storage-locations/resolve?qr=${value}`, { headers }); if (!response.ok) { setLocationCapacity(null); setPdaStatus(tx("仓位 QR 未在 WMS 登记或不可用于绑定", "Location QR is not registered or cannot be used for binding", "QR vị trí chưa đăng ký hoặc không thể liên kết")); return; } const result = await response.json(); const data = result.data || result; setLocationQr(data.qrCode || locationQr.trim()); setAreaQr(String(data.area || data.areaName || data.areaCode || "")); setLocationCapacity({ capacity: Number(data.capacity || 0), occupied: Number(data.occupied || 0), name: data.nameZh || data.nameEn || data.nameVi || data.code }); };
  const submitMaterialReceivingOa = async () => {
    if (!materialCode.trim() || !lot.trim() || !receivedQty.trim() || !locationQr.trim()) {
      setPdaStatus(tx("收料前必须填写物料、批次、数量并绑定仓位", "Material, lot, quantity and location are required", "Can vat lieu, lo, so luong va vi tri"));
      return;
    }
    setOaBusy(true);
    try {
      const request = await oaRepository.submit({
        title: `物料收料审批 · ${lot.trim()}`,
        type: "material_receiving",
        requester: sessionStorage.getItem("username") || "WMS Receiver",
        department: "Warehouse / IQC",
        dueAt: receiptDate,
        summary: `申请对批次 ${lot.trim()} 执行收料、QR绑定及IQC前入库流程。`,
        details: [
          { label: "Vietnam material code", value: materialCode.trim() },
          { label: "Ruijing material code", value: ruijingMaterialCode.trim() || "-" },
          { label: "Lot / batch", value: lot.trim() },
          { label: "Received quantity", value: `${receivedQty.trim()} ${unit}` },
          { label: "Box count", value: caseCount.trim() || "-" },
          { label: "MSD level", value: msdLevel.trim() || "-" },
          { label: "Storage location", value: locationQr.trim() || "-" },
        ],
      });
      setOaRequest(request);
      const url = new URL(window.location.href);
      url.searchParams.set("view", "oa");
      sessionStorage.setItem("oa:return-target", JSON.stringify({ view: "wms", wmsTab: "materialReceiving" }));
      window.history.pushState({}, "", url);
      window.dispatchEvent(new CustomEvent("factory:navigate", { detail: { view: "oa", requestId: request.id, returnView: "wms", returnWmsTab: "materialReceiving" } }));
    } finally { setOaBusy(false); }
  };
  const [submitting, setSubmitting] = useState(false);
  const submitReceiving = async () => {
    if (!materialCode.trim() || !lot.trim() || !locationQr.trim() || boxQrs.length === 0) {
      setPdaStatus(tx("请先录入物料/批次、扫描箱码并绑定仓位", "Enter material/lot, scan box QR and bind a location before submitting", "Nhap vat lieu/lo, quet QR thung va lien ket vi tri"));
      return;
    }
    setSubmitting(true);
    try {
      await wmsApi.postReceive({
        lot_no: lot.trim(),
        po_no: purchaseOrder.trim(),
        inbound_order_no: purchaseOrder.trim(),
        material_code: materialCode.trim(),
        supplier_code: supplier.trim(),
        received_qty: Number(receivedQty) || Number(boxQty) || 0,
        received_at: receiptDate,
        receiving_notes: `WMS receiving · ${palletType} · ${boxQrs.length} box(es) · MSD ${msdLevel}`,
      });
      setPdaStatus(tx("收料已提交至数据库", "Receiving submitted to database", "Đã gửi nhận liệu vào cơ sở dữ liệu"));
    } catch (err: any) {
      setPdaStatus(tx(`收料提交失败: ${err.message || err}`, `Failed to submit receiving: ${err.message || err}`, `Gửi nhận liệu thất bại: ${err.message || err}`));
    } finally {
      setSubmitting(false);
    }
  };
  const printAllReceivingQrs = async (row: Record<string, any>) => {
    const labels = [
      { title: "WMS 箱 QR", value: String(row.material_qr || row.box_qr || row.case_qr_value || ""), detail: `${row.material_code || ""} · ${row.lot_no || ""} · ${row.msd_level || ""}` },
    ].filter(label => label.value);
    if (!labels.length) return;
    const rendered = await Promise.all(labels.map(async label => ({ ...label, image: await QRCode.toDataURL(label.value, { width: 420, margin: 1, errorCorrectionLevel: "M" }) })));
    const popup = window.open("", "_blank", "width=720,height=760");
    if (!popup) { window.alert("浏览器阻止了打印窗口，请允许弹出窗口后重试。"); return; }
    const root = popup.document.createElement("main");
    rendered.forEach(label => {
      const page = popup.document.createElement("section"); page.className = "qr-label";
      const title = popup.document.createElement("h1"); title.textContent = label.title;
      const image = popup.document.createElement("img"); image.src = label.image; image.alt = label.title;
      const detail = popup.document.createElement("p"); detail.textContent = label.detail;
      const value = popup.document.createElement("code"); value.textContent = label.value;
      page.append(title, image, detail, value); root.append(page);
    });
    const style = popup.document.createElement("style");
    style.textContent = `@page{size:60mm 40mm;margin:0}body{margin:0;font-family:Arial,"Microsoft YaHei",sans-serif}.qr-label{width:60mm;height:40mm;box-sizing:border-box;padding:2mm;display:grid;grid-template-columns:25mm 1fr;grid-template-rows:auto 1fr auto;break-after:page;page-break-after:always;overflow:hidden}.qr-label h1{grid-column:1/3;font-size:11pt;margin:0}.qr-label img{width:24mm;height:24mm;grid-row:2/4}.qr-label p{font-size:7pt;margin:2mm 0 0;word-break:break-all}.qr-label code{font-size:5.5pt;word-break:break-all;align-self:end}@media screen{body{background:#ddd}.qr-label{margin:8px;background:#fff;box-shadow:0 2px 8px #777}}`;
    popup.document.head.append(style); popup.document.body.append(root);
    popup.document.title = `WMS QR ${row.lot_no || row.material_code || ""}`;
    window.setTimeout(() => { popup.focus(); popup.print(); }, 250);
  };

  return (
    <div className="screen-stack">
      <section className="surface-panel" style={{ border: "2px solid #0f766e" }}>
        <div className="section-header">
          <div>
            <h2 style={{ margin: 0 }}>{tx("待收料 PO 清单", "Pending PO Receipts", "Danh sách PO chờ nhận")}</h2>
            <p style={{ margin: "5px 0 0" }}>{tx("从供应商 Portal 已登记的标签清单选择物料后开始收料。", "Select a supplier Portal manifest to start receiving.", "Chọn danh sách nhãn từ Portal nhà cung cấp để bắt đầu nhận hàng.")}</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="badge badge-info">{pendingReceivingMaterials.length} {tx("项待收", "pending", "đang chờ")}</span>
            <button type="button" className="btn btn-secondary" onClick={loadPendingReceivingMaterials} disabled={pendingReceivingLoading}>
              {pendingReceivingLoading ? tx("刷新中…", "Refreshing…", "Đang tải…") : tx("刷新", "Refresh", "Làm mới")}
            </button>
          </div>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>PO</th>
                <th>{tx("供应商", "Supplier", "Nhà cung cấp")}</th>
                <th>{tx("物料编码", "Material", "Mã vật liệu")}</th>
                <th>{tx("批次", "Lot", "Lô")}</th>
                <th>{tx("应收数量", "Expected qty", "SL dự kiến")}</th>
                <th>{tx("箱数", "Boxes", "Số thùng")}</th>
                <th>{tx("扫码进度", "Scan progress", "Tiến độ quét")}</th>
                <th>{tx("状态", "Status", "Trạng thái")}</th>
                <th>{tx("操作", "Action", "Thao tác")}</th>
              </tr>
            </thead>
            <tbody>
              {pendingReceivingMaterials.length ? pendingReceivingMaterials.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.po_no || "-"}</strong></td>
                  <td>{row.supplier_name || row.supplier_code || "-"}</td>
                  <td><strong>{row.material_code}</strong></td>
                  <td>{row.lot_no || "-"}</td>
                  <td>{Number(row.total_quantity || 0).toLocaleString()} {row.unit || "PCS"}</td>
                  <td>{row.outer_box_count || row.label_count || 0}</td>
                  <td>{row.scanned_label_count || 0} / {row.label_count || 0}</td>
                  <td><span className="badge badge-warning">{row.status}</span></td>
                  <td>
                    <button type="button" className="btn btn-primary" onClick={() => selectPendingReceivingMaterial(row)}>
                      {tx("开始收料", "Start receiving", "Bắt đầu nhận")}
                    </button>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={9} style={{ textAlign: "center", color: "#64748b", padding: 24 }}>{pendingReceivingLoading ? tx("正在读取待收料 PO…", "Loading pending POs…", "Đang tải PO…") : tx("暂无供应商 Portal 提交的待收料 PO", "No pending PO receipts from the supplier Portal", "Chưa có PO chờ nhận từ Portal nhà cung cấp")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <WmsReceivingEmployeeCommunication />
      <section className="surface-panel" style={{ padding: 24, border: "2px solid #2563eb", background: "linear-gradient(135deg,#eff6ff,#ffffff)" }}>
        <div className="no-print" style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 18 }}><div><div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>WMS RECEIVING · PRE-IQC LEDGER · PDA VALIDATION</div><h2 style={{ margin: "6px 0" }}>物料接收管理</h2><p style={{ margin: 0, color: "var(--muted)" }}>PO采购到货 → 箱数据采集 → 箱 QR 打印 → 绑定仓位 → IQC待检。</p></div><div style={{ textAlign: "right" }}><span className="badge badge-info">箱 QR · 越南 A1</span><div style={{ fontSize: 11, color: "var(--muted)", marginTop: 5 }}>PDA / WMS 同码打印</div><div style={{ fontSize: 11, color: "#f5b942", marginTop: 3 }}>库存以箱 QR 和仓位 QR 追溯</div></div></div>
        <div className="no-print" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: 12, marginBottom: 18, border: "2px solid var(--state-active,#18c6d9)", borderRadius: 12, background: "var(--surface-panel,#101d27)", boxShadow: "0 6px 18px rgba(0,0,0,.24)" }}>
          <strong style={{ marginRight: "auto", color: "#fff" }}>PO RECEIPT · 收货台账 · IQC PRE-CHECK</strong>
          <a className="action-button" href="/?view=wms&wmsTab=poReceipt">查看 PO 收货</a>
          <a className="action-button" href="/?view=wms&wmsTab=iqc">打开 IQC 队列</a>
          <a className="action-button" href="/?view=wms&wmsTab=qrBinding">QR 绑定仓库</a>
        </div>
        <div className="no-print" style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center", padding: "10px 14px", marginBottom: 14, border: "1px solid #93c5fd", borderRadius: 8, background: "#eff6ff", color: "#1e3a8a" }}>
          <strong>{tx("本收料任务由 WMS 自动分配", "This receiving task is assigned by WMS", "Tac vu nhan lieu nay do WMS tu dong phan cong")}</strong>
          <span>{tx("目标 PDA", "Target PDA", "PDA muc tieu")}: <b>{syncPdaDevice || tx("等待 PDA 注册", "Waiting for PDA registration", "Dang cho PDA dang ky")}</b></span>
          <span>{tx("已激活", "Activated", "Da kich hoat")}: <b>{pdaDevices.filter(device => device.lastAt > 0 && Date.now() - device.lastAt < 30000).length} / 5</b></span>
          <select value={selectedPdaDevice} onChange={event => setSelectedPdaDevice(event.target.value)} style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #93c5fd" }} aria-label={tx("选择目标 PDA", "Select target PDA", "Chon PDA muc tieu")}>
            <option value="ALL">{tx("自动选择在线 PDA", "Auto-select online PDA", "Tu dong chon PDA online")}</option>
            {pdaDevices.map(device => <option key={device.id} value={device.id}>{device.id} · {device.operator || "-"}</option>)}
          </select>
        </div>
        <div className="no-print" style={{ marginBottom: 18, padding: 14, border: "2px solid #0f766e", borderRadius: 10, background: "#f0fdfa" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <strong style={{ color: "#115e59" }}>{tx("已激活收料 PDA（点击查看实时现场）", "Activated receiving PDAs (click for live view)", "PDA nhan lieu dang kich hoat (bam de xem truc tiep)")}</strong>
            <span className="badge badge-success">{pdaDevices.filter(device => device.lastAt > 0 && Date.now() - device.lastAt < 30000).length} / 5</span>
          </div>
          {pdaDevices.length ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8 }}>
            {pdaDevices.map(device => {
              const online = device.lastAt > 0 && Date.now() - device.lastAt < 30000;
              return <a key={device.id} href={`/?view=wms&wmsTab=pdaReceivingMobile&pdaId=${encodeURIComponent(device.id)}&mode=monitor`} onClick={() => setSelectedPdaDevice(device.id)} style={{ textDecoration: "none", color: "inherit", padding: "10px 12px", borderRadius: 8, border: `1px solid ${online ? "#14b8a6" : "#cbd5e1"}`, background: online ? "#ccfbf1" : "#f8fafc" }}>
                <div style={{ fontWeight: 800 }}>{device.id}</div>
                <div style={{ fontSize: 12, marginTop: 3 }}>{device.operator || tx("未登录", "Not logged in", "Chua dang nhap")} · {online ? tx("在线", "ONLINE", "TRUC TUYEN") : tx("离线", "OFFLINE", "NGOAI TUYEN")}</div>
                <div style={{ fontSize: 12, color: "#475569", marginTop: 3 }}>{device.stage || "-"} · {device.completedBoxes}/{device.totalBoxes || "-"} {tx("箱", "boxes", "thung")}</div>
              </a>;
            })}
          </div> : <div style={{ color: "#64748b", fontSize: 13 }}>{tx("暂无设备；PDA 登录收料角色并确认后会自动注册。", "No device yet; a PDA appears after receiving-role login and confirmation.", "Chua co thiet bi; PDA se tu dong dang ky sau khi dang nhap vai tro nhan lieu.")}</div>}
        </div>
        <div className="section-header">
          <div>
            <h2>{tx("PDA物料标签大图OCR", "PDA Material Label OCR", "OCR nhan vat lieu PDA")}</h2>
            <p>{tx("拍摄或上传物料标签大图，识别后自动解析并回填下方收料信息。", "Capture or upload a large material-label image. OCR parses it and automatically fills the receiving form.", "Chup hoac tai anh lon cua nhan vat lieu; OCR tu dong phan tich va dien bieu mau.")}</p>
          </div>
          <span className="badge badge-warning">OCR · {labelOcrBusy ? tx("识别中", "PROCESSING", "DANG XU LY") : tx("已自动回填", "AUTO APPLIED", "DA TU DONG DIEN")}</span>
        </div>
        {labelCameraStream ? (
          <div style={{ display: "grid", gap: 10 }}>
            <video ref={labelVideo} autoPlay playsInline style={{ width: "100%", minHeight: 260, maxHeight: 520, objectFit: "contain", background: "#0f172a", borderRadius: 10 }} />
            <canvas ref={labelCanvas} style={{ display: "none" }} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn-primary" type="button" onClick={captureLabelImage}>{tx("拍摄标签并识别", "Capture label", "Chup nhan")}</button>
              <button className="btn-ghost" type="button" onClick={stopLabelCamera}>{tx("取消相机", "Cancel camera", "Huy camera")}</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ minHeight: 260, display: "grid", placeItems: "center", borderRadius: 10, border: "2px dashed #60a5fa", background: "#dbeafe", overflow: "hidden" }}>
              {labelImage ? <img src={labelImage} alt="Material label" style={{ width: "100%", maxHeight: 520, objectFit: "contain" }} /> : <div style={{ textAlign: "center", color: "#1d4ed8", fontSize: 18, fontWeight: 700 }}>{tx("请将物料标签放入大图区域", "Place the material label in the large image area", "Dat nhan vat lieu vao vung anh lon")}</div>}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <button className="btn-primary" type="button" onClick={startLabelCamera}>{tx("打开PDA相机", "Open PDA camera", "Mo camera PDA")}</button>
              <label className="btn-ghost" style={{ cursor: "pointer" }}>
                {tx("上传标签图片", "Upload label image", "Tai anh nhan")}
                <input type="file" accept="image/*" aria-label={tx("上传标签图片", "Upload label image", "Tai anh nhan")} style={{ display: "none" }} onChange={event => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = "";
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    const image = String(reader.result || "");
                    setLabelImage(image);
                    void runLabelOcr(image);
                  };
                  reader.readAsDataURL(file);
                }} />
              </label>
            </div>
          </>
        )}
        {labelOcrMessage && <div style={{ marginTop: 10, padding: 10, borderRadius: 6, background: labelOcrMessage.includes("failed") || labelOcrMessage.includes("失败") ? "#fee2e2" : "#dcfce7", color: labelOcrMessage.includes("failed") || labelOcrMessage.includes("失败") ? "#b91c1c" : "#166534" }}>{labelOcrMessage}</div>}
        {labelOcrData && <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: "#ffffff", border: "1px solid #bfdbfe" }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{tx("OCR识别结果（已自动回填）", "OCR result (automatically applied)", "Ket qua OCR (da tu dong dien)")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8, fontSize: 12 }}>
            {([
              ["Vietnam code", labelOcrData.vietnamMaterialCode || labelOcrData.materialCode],
              ["Ruijing code", labelOcrData.ruijingMaterialCode],
              ["Lot / batch", labelOcrData.lot],
              ["Supplier", labelOcrData.supplier],
              ["Quantity", labelOcrData.quantity],
              ["Qty / box", labelOcrData.quantityPerBox],
              ["Box count", labelOcrData.boxCount],
              ["Box SN / QR", labelOcrData.boxSn || labelOcrData.boxNumber],
              ["Location", labelOcrData.locationCode],
              ["MSD", labelOcrData.msdLevel],
              ["Floor life (h)", labelOcrData.floorLifeHours],
              ["PO", labelOcrData.purchaseOrder],
              ["Manufacture date", labelOcrData.manufactureDate],
              ["Expiry date", labelOcrData.expiryDate],
              ["UL file", labelOcrData.ulCode],
            ] as Array<[string, unknown]>).filter(([, value]) => value != null && String(value).trim()).map(([label, value]) => <div key={label} style={{ padding: "6px 8px", background: "#eff6ff", borderRadius: 5 }}><span style={{ color: "#475569" }}>{label}: </span><strong>{String(value)}</strong></div>)}
          </div>
        </div>}
      </section>
      {msdBindingStatus && <div style={{ margin: "8px 0", padding: 10, borderRadius: 6, background: msdBindingStatus.includes("conflict") || msdBindingStatus.includes("冲突") ? "#fee2e2" : "#dcfce7", color: msdBindingStatus.includes("conflict") || msdBindingStatus.includes("冲突") ? "#b91c1c" : "#166534", fontWeight: 700 }}>{msdBindingStatus}</div>}
      <section className="surface-panel" style={{ marginBottom: 12 }}><div className="section-header"><div><h3>已收料箱体 / IQC 待检队列</h3><p>箱 QR 已登记并绑定仓位后即完成收料。库存处于 IQC HOLD，检验放行前不可领料。</p></div><strong>{boundMaterials.length} 箱待检</strong></div><div className="table-shell"><table><thead><tr>{["物料ID", "批次", "物料", "箱 QR", "箱数量", "区域 QR", "仓位 QR", "PDA GPS", "来源", "IQC 状态", "打印"].map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{boundMaterials.length ? boundMaterials.map(row => <tr key={String(row.id)}><td>{row.material_id || row.material_code || "-"}</td><td>{row.lot_no || "-"}</td><td><strong>{row.material_code || "-"}</strong><br /><span>{row.material_name || "-"}</span></td><td>{row.material_qr || row.box_qr || row.case_qr_value || "-"}</td><td>{row.quantity ?? row.pallet_quantity ?? 0} {row.uom || ""}</td><td>{row.area_qr || row.receiving_area || "-"}</td><td>{row.location_code || row.warehouse_code || "-"}</td><td>{row.pda_x != null && row.pda_y != null ? `${row.pda_x}, ${row.pda_y} / ±${row.pda_accuracy ?? "-"}m` : "-"}</td><td>{row.source_type || "PO_RECEIPT"}</td><td><span className="badge badge-warning">{row.status || "IQC_PENDING"}</span></td><td><button type="button" onClick={() => void printAllReceivingQrs(row)}>打印箱 QR</button></td></tr>) : <tr><td colSpan={11}>暂无待检箱体；PDA 完成仓位绑定并确认收料后会自动进入此队列。</td></tr>}</tbody></table></div></section>
      <section id="material-realtime-flow" className="surface-panel" style={{ scrollMarginTop: 18, border: "3px solid #0f766e", background: "linear-gradient(135deg,#ecfeff,#ffffff)" }}>
        <div className="section-header"><div><h2 style={{ margin: 0 }}>物料收料动态流程图</h2><p style={{ margin: "4px 0 0" }}>采集箱数据 → WMS登记箱 QR → PDA/WMS打印 → 箱 QR绑定仓位 → 收料完成 → IQC_PENDING</p></div><span className="badge badge-success">PDA / WMS 实时同步</span></div>
        <WmsMaterialRealtimeFlow locale={locale} materialCode={materialCode} lotNo={lot} boxQr={boxQr} iqcStatus={supplierIqc} locationCode={locationQr} />
      </section>
      <section className="surface-panel" style={{ border: "1px solid #f59e0b", background: "linear-gradient(135deg,#fffbeb,#ffffff)" }}>
        <div className="section-header"><div><h3>湿敏 / 水分控制</h3><p>收料时建立湿敏物料控制记录；开封、暴露、烘烤和 IQC 放行独立于 SMT 卷料打印流程。</p></div><span className={`badge ${msdLevel ? "badge-warning" : "badge-info"}`}>{msdLevel ? `MSL ${msdLevel}` : "MSL 待确认"}</span></div>
        <div className="no-print" style={{ marginBottom: 12, padding: 12, border: "1px solid #fbbf24", borderRadius: 8, background: "#fff" }}>
          <strong>{tx("导入物料 MSD 映射到数据库", "Import material MSD mapping into database", "Nhap anh xa MSD vat lieu vao co so du lieu")}</strong>
          <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input type="file" accept=".xlsx,.xls" onChange={event => { void importMaterialCodeMapping(event.target.files?.[0]); event.currentTarget.value = ""; }} />
            <span style={{ color: "#64748b", fontSize: 12 }}>{tx("仅导入时读取 Excel；运行时始终查询数据库映射表。", "Excel is read only during import; runtime always queries the database mapping table.", "Excel chi duoc doc khi nhap; khi chay luon tra bang anh xa trong co so du lieu.")}</span>
          </div>
          {materialMappingStatus && <div style={{ marginTop: 8, color: "#92400e", fontWeight: 700 }}>{materialMappingStatus}</div>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
          <div style={{ padding: 12, borderRadius: 8, background: "#fff", border: "1px solid #fde68a" }}><small>标准暴露时限</small><strong style={{ display: "block", marginTop: 5 }}>{msdFloorLifeHours ? `${msdFloorLifeHours} 小时` : "数据库未配置 MSD 规则"}</strong></div>
          <div style={{ padding: 12, borderRadius: 8, background: "#fff", border: "1px solid #fde68a" }}><small>收料开封状态</small><strong style={{ display: "block", marginTop: 5 }}>未开封 / 未开始计时</strong></div>
          <div style={{ padding: 12, borderRadius: 8, background: "#fff", border: "1px solid #fde68a" }}><small>烘烤状态</small><strong style={{ display: "block", marginTop: 5 }}>无需烘烤 / 待判定</strong></div>
          <div style={{ padding: 12, borderRadius: 8, background: "#fff", border: "1px solid #fde68a" }}><small>IQC 放行锁定</small><strong style={{ display: "block", marginTop: 5, color: supplierIqc === "PASS" ? "#15803d" : "#b45309" }}>{supplierIqc === "PASS" ? "已放行" : "IQC 前锁定"}</strong></div>
        </div>
      </section>
      <section className="surface-panel">
        <div className="section-header"><div><h3>{tx("MS定义与暴露管控", "MS definition and exposure control", "Định nghĩa MS và kiểm soát phơi nhiễm")}</h3><p>{tx("收料时建立 MS 规则，后续开箱、关闭、预警和锁定都按此规则计算。", "Define the MS rule at receiving; opening, closing, warnings and lockout use this rule.", "Xác định quy tắc MS khi nhận; mở, đóng, cảnh báo và khóa dùng cùng quy tắc.")}</p></div></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
          <label>{tx("MS等级（数据库映射）", "MS level (database mapping)", "Cấp MS (ánh xạ cơ sở dữ liệu)")}<select className="form-input" value={msdLevel} disabled><option value="">{tx("数据库未配置", "Not configured in database", "Chưa cấu hình trong cơ sở dữ liệu")}</option><option value="1">MS-1</option><option value="2">MS-2</option><option value="2a">MS-2a</option><option value="3">MS-3</option><option value="4">MS-4</option><option value="5">MS-5</option><option value="5a">MS-5a</option><option value="6">MS-6</option></select></label>
          <label>{tx("标准暴露时限（数据库映射）", "Standard floor life (database mapping)", "Thời hạn phơi chuẩn (ánh xạ cơ sở dữ liệu)")}<input className="form-input" type="number" min="0" value={msdFloorLifeHours} readOnly placeholder={tx("由数据库规则自动带出", "Filled from database rules", "Tự động điền từ quy tắc cơ sở dữ liệu")} /></label>
          <div style={{ paddingTop: 22, fontSize: 12 }}>{tx("剩余≤720小时（30天）预警；剩余≤0小时锁定。", "Warn at ≤720 hours (30 days); lock at ≤0 hours.", "Cảnh báo khi còn ≤720 giờ (30 ngày); khóa khi còn ≤0 giờ.")}</div>
        </div>
      </section>
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{tx("物料收料", "Material Receiving", "Tiếp nhận vật liệu")}</h2>
            <p>{tx("PDA相机或USB/蓝牙扫描枪 → WMS收料 → IQC待检队列", "PDA camera or USB/Bluetooth scanner → WMS receiving → IQC queue", "Camera PDA hoặc máy quét USB/Bluetooth → WMS tiếp nhận → hàng đợi IQC")}</p>
          </div>
          <span className="badge badge-success">{tx("收料员", "RECEIVER", "NHÂN VIÊN NHẬN")}</span>
        </div>
      </section>
      <section className="surface-panel">
        <div className="section-header"><div><h3>{tx("箱体收料与仓位绑定", "Box Receiving & Location Binding", "Tiếp nhận thùng & liên kết vị trí")}</h3><p>{tx("每个箱 QR 在 IQC 放行前必须登记并绑定仓位。", "Every box QR must be registered and bound to a location before IQC release.", "Mỗi QR thùng phải được đăng ký và liên kết vị trí trước khi IQC phê duyệt.")}</p></div><span className={`badge ${supplierIqc === "PASS" ? "badge-success" : supplierIqc === "FAIL" ? "badge-danger" : "badge-warning"}`}>IQC: {supplierIqc === "PENDING" ? tx("待检", "PENDING", "CHỜ KIỂM") : supplierIqc}</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
          <label>{tx("供应商", "Supplier", "Nhà cung cấp")}<input className="form-input" value={supplier} onChange={e => setSupplier(e.target.value)} placeholder={tx("供应商代码/名称", "Supplier code / name", "Mã / tên nhà cung cấp")} /></label>
          <label>{tx("物料名称", "Material name", "Tên vật liệu")}<input className="form-input" value={materialName} onChange={e => setMaterialName(e.target.value)} /></label>
          <label>Vietnam material code<input className="form-input" required aria-label="Vietnam material code" value={materialCode} onChange={e => setMaterialCode(e.target.value)} onBlur={e => lookupSharedMaterial(e.target.value, "vietnam")} placeholder="Enter Vietnam material code" /></label>
          <label>Ruijing material code<input className="form-input" value={ruijingMaterialCode} onChange={e => setRuijingMaterialCode(e.target.value)} onBlur={e => lookupSharedMaterial(e.target.value, "ruijing")} placeholder="Enter Ruijing material code" /></label>
          <label>{tx("导入物料编码映射", "Import material-code mapping", "Nhap anh xa ma vat lieu")}<input className="form-input" type="file" accept=".xlsx,.xls" onChange={event => { void importMaterialCodeMapping(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
          <label>{tx("规格型号", "Specification", "Quy cách")}<input className="form-input" value={specification} onChange={e => setSpecification(e.target.value)} /></label>
          <label>{tx("采购订单", "Purchase order", "Đơn mua hàng")}<input className="form-input" value={purchaseOrder} onChange={e => setPurchaseOrder(e.target.value)} /></label>
          <label>{tx("供应商条码", "Supplier barcode", "Mã vạch nhà cung cấp")}<input className="form-input" value={supplierBarcode} onChange={e => setSupplierBarcode(e.target.value)} /></label>
          <label>{tx("收料日期", "Receipt date", "Ngày nhận")}<input className="form-input" type="date" value={receiptDate} onChange={e => setReceiptDate(e.target.value)} /></label>
          <label>{tx("批次", "Lot", "Lô hàng")}<input className="form-input" required aria-label={tx("批次", "Lot", "Lô hàng")} value={lot} onChange={e => setLot(e.target.value)} placeholder={tx("供应商批次", "Supplier lot", "Lô nhà cung cấp")} /></label>
          <label>{tx("生产日期", "Manufacture date", "Ngày sản xuất")}<input className="form-input" value={manufactureDate} onChange={e => setManufactureDate(e.target.value)} /></label>
          <label>{tx("有效期至", "Expiry date", "Hạn sử dụng")}<input className="form-input" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} /></label>
          <label>{tx("单位", "Unit", "Đơn vị")}<select className="form-input" value={unit} onChange={e => setUnit(e.target.value)}><option>PCS</option><option>KG</option><option>ROLL</option><option>SET</option><option>箱 / BOX</option></select></label>
          <label>{tx("箱/件数量（现场核验）", "Case / box count (verify on site)", "Số thùng / hộp (xác nhận tại chỗ)")}<input className="form-input" type="number" min="0" value={caseCount} onChange={e => setCaseCount(e.target.value)} /></label>
          <label>{tx("每箱数量（标签数量）", "Quantity per box (label quantity)", "Số lượng mỗi thùng (theo nhãn)")}<input className="form-input" type="number" min="0" value={boxQty} onChange={e => { const value = e.target.value; setBoxQty(value); if (!caseCount.trim()) { setReceivedQty(value); setExpectedQty(value); } }} /></label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 22 }}><input type="checkbox" checked={partialBox} onChange={e => setPartialBox(e.target.checked)} />{tx("尾数箱/部分箱", "Partial / tail box", "Thùng lẻ / một phần")}</label>
          <label>{tx("库位（现场扫码）", "Storage location (scan on site)", "Vị trí kho (quét tại chỗ)")}<input className="form-input" required aria-label={tx("仓位 QR", "Storage location QR", "QR vị trí kho")} value={locationQr} onChange={e => { setLocationQr(e.target.value); setLocationCapacity(null); }} onBlur={resolveLocation} placeholder={tx("现场扫描库位", "Scan location on site", "Quét vị trí tại chỗ")} /></label>
        </div>
        {locationCapacity && <div style={{ marginTop: 8, fontSize: 12, color: locationCapacity.occupied >= locationCapacity.capacity ? "#dc2626" : "#15803d" }}>{locationCapacity.name || locationQr}: {tx("容量", "Capacity", "Sức chứa")} {locationCapacity.occupied}/{locationCapacity.capacity} · {tx("剩余", "Available", "Còn lại")} {Math.max(0, locationCapacity.capacity - locationCapacity.occupied)}</div>}
        {(expectedQty || receivedQty || caseCount || boxQty) && <div style={{ marginTop: 8, padding: 10, background: "var(--nav)", borderRadius: 6 }}>{tx("数量核对", "Quantity reconciliation", "Đối chiếu số lượng")}: {tx("预计", "Expected", "Dự kiến")} {expectedQty || 0} {unit} · {tx("已收", "Received", "Đã nhận")} {receivedQty || 0} {unit} · {tx("差异", "Difference", "Chênh lệch")} {Number(expectedQty || 0) - Number(receivedQty || 0)} {unit}{partialBox ? ` · ${tx("尾数箱", "PARTIAL BOX", "THÙNG LẺ")}` : ""}</div>}
        {pdaStatus && <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 5, background: "rgba(37,99,235,0.1)", color: "#1d4ed8", fontSize: 12 }}>{tx("已接收统一PDA信息", "Unified PDA information received", "Đã nhận thông tin từ PDA hợp nhất")}: {pdaStatus}</div>}
        <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "end" }}>
          <label style={{ flex: 1 }}>{tx("料箱QR", "Material box QR", "QR thùng vật liệu")}<input className="form-input" aria-required={boxQrs.length === 0} aria-label={tx("料箱 QR", "Material box QR", "QR thùng vật liệu")} value={boxQr} onChange={e => setBoxQr(e.target.value)} onKeyDown={e => e.key === "Enter" && addBox()} placeholder={tx("扫描每个料箱 QR", "Scan each box QR", "Quét từng QR thùng")} /></label>
          <button className="btn-primary" type="button" onClick={addBox}>{tx("绑定料箱", "Bind box", "Liên kết thùng")}</button>
        </div>
        {boxQrs.length > 0 && <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>{boxQrs.map(qr => <span className="badge badge-success" key={qr}>{qr} → {locationQr || tx("待绑定仓位", "Location pending", "Chờ vị trí")}</span>)}</div>}
        {packageScans.length>0&&<div style={{marginTop:12,padding:12,border:"1px solid #60a5fa",borderRadius:8,background:"#eff6ff"}}><strong>{tx("供应商外箱/子箱层级","Supplier outer/sub-box hierarchy","Phân cấp thùng ngoài/thùng con")}</strong><div className="table-shell" style={{marginTop:8}}><table><thead><tr><th>{tx("层级","Level","Cấp")}</th><th>{tx("流水号","Serial","Số sê-ri")}</th><th>{tx("所属外箱","Parent outer box","Thùng ngoài")}</th><th>{tx("标签数量","Label qty","SL nhãn")}</th><th>{tx("有效计数规则","Effective counting","Quy tắc đếm")}</th></tr></thead><tbody>{packageScans.map(x=><tr key={x.qrValue}><td>{x.packageLevel==="SUB_BOX"?tx("子箱","SUB BOX","THÙNG CON"):tx("外箱","OUTER","THÙNG NGOÀI")}</td><td><b>{x.serialNo}</b></td><td>{x.parentSerialNo||"—"}</td><td>{Number(x.quantity)} {unit}</td><td>{x.countingSource==="SUB_BOX_SUM"?tx("按子箱合计，外箱不重复入账","Count sub-box sum; outer excluded","Cộng thùng con; không cộng lại thùng ngoài"):tx("尚无子箱，暂按外箱数量","No sub-box yet; count outer","Chưa có thùng con; đếm thùng ngoài")}</td></tr>)}</tbody></table></div></div>}
        {bindings.length > 0 && <div style={{ marginTop: 12, padding: 10, background: "var(--nav)", borderRadius: 6, fontSize: 12 }}><strong>{tx("箱体仓位绑定明细", "Box-location binding details", "Chi tiết liên kết thùng-vị trí")}</strong>{bindings.map(binding => <div key={binding.boxQr} style={{ marginTop: 5 }}>{binding.boxQr} → {locationQr} · {binding.materialCode} · {binding.quantity} {unit}</div>)}</div>}
        <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><span style={{ fontSize: 12, fontWeight: 700 }}>{tx("供应商IQC标记", "Supplier IQC mark", "Đánh dấu IQC nhà cung cấp")}:</span>{(["PENDING", "PASS", "FAIL"] as const).map(v => <button key={v} type="button" className={supplierIqc === v ? "btn-primary" : "btn-ghost"} onClick={() => setSupplierIqc(v)}>{v === "PENDING" ? tx("未检验/隔离", "Not inspected / hold", "Chưa kiểm / giữ lại") : v}</button>)}</div>
      </section>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button className="btn-primary" type="button" disabled={submitting} onClick={submitReceiving} style={{ background: submitting ? "#6b7280" : "#15803d", color: "#fff" }}>
            {submitting ? tx("提交中…", "Submitting…", "Đang gửi…") : tx("完成收料并提交数据库", "Complete Receiving & Submit to DB", "Hoàn tất nhận liệu và gửi vào CSDL")}
          </button>
          <button className="btn-ghost" type="button" onClick={() => { setBoxQr(""); }}>{tx("取消当前箱码", "Cancel current box", "Hủy box hiện tại")}</button>
          <button className="btn-ghost" type="button" onClick={() => { setSupplier(""); setLot(""); setPalletQr(""); setLocationQr(""); setLocationCapacity(null); setBoxQr(""); setBoxQrs([]); setBindings([]); setSupplierIqc("PENDING"); setPdaStatus(tx("本次收料已取消", "Receiving cancelled", "Đã hủy nhận liệu")); }}>{tx("取消本次收料", "Cancel receiving", "Hủy nhận liệu")}</button>
        </div>
      <section className="surface-panel" aria-label="Supplier quality certificate capture" style={{ marginTop: 12 }}>
        <div className="section-header"><div><h3>{tx("供应商质量证书", "Supplier quality certificates", "Chứng nhận chất lượng nhà cung cấp")}</h3><p>{tx("可多选图片，提交时随收料绑定上传。", "Select multiple images; they are uploaded with this receiving.", "Chọn nhiều ảnh; ảnh được tải cùng phiếu nhận hàng.")}</p></div></div>
        <input ref={certificateInput} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => void addCertificates(e.target.files)} />
        <button className="btn-ghost" type="button" onClick={() => certificateInput.current?.click()}>{tx("选择证书图片", "Select certificate images", "Chọn ảnh chứng nhận")}</button>
        {certificates.length > 0 && <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>{certificates.map(certificate => <div key={certificate.id} style={{ width: 160 }}><img src={certificate.dataUrl} alt={certificate.fileName} style={{ width: 160, height: 100, objectFit: "cover", borderRadius: 6 }} /><select className="form-input" value={certificate.category} onChange={e => setCertificates(xs => xs.map(x => x.id === certificate.id ? { ...x, category: e.target.value as Certificate["category"] } : x))}><option value="QUALITY_CERTIFICATE">Quality certificate</option><option value="INSPECTION_REPORT">Inspection report</option><option value="OTHER">Other</option></select><button type="button" className="btn-ghost" onClick={() => setCertificates(xs => xs.filter(x => x.id !== certificate.id))}>× {tx("移除", "Remove", "Xóa")}</button></div>)}</div>}
        {certificates.length > 0 && <button type="button" className="btn-ghost" style={{ marginTop: 8 }} onClick={() => setCertificates([])}>{tx("取消全部图片", "Cancel all images", "Hủy tất cả ảnh")}</button>}
      </section>
      <section className="surface-panel" style={{ marginTop: 12, border: "2px solid #2563eb", background: "#eff6ff" }}>
        <div className="section-header"><div><h3 style={{ margin: 0 }}>{tx("收料 PDA 设备管理（最多 5 台）", "Receiving PDA management (up to 5 devices)", "Quan ly PDA nhan lieu (toi da 5 thiet bi)")}</h3><p style={{ margin: "4px 0 0" }}>{tx("WMS 注册并监控设备；PDA 只执行现场采集，所有状态回传 WMS。", "WMS registers and monitors devices; PDA performs field collection and reports every state back.", "WMS dang ky va giam sat thiet bi; PDA thu thap tai hien truong va dong bo moi trang thai.")}</p></div><span className="badge badge-info">{pdaDevices.length} / 5 {tx("台在线/已注册", "online / registered", "dang ky / truc tuyen")}</span></div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>{["ALL", ...pdaDevices.map(device => device.id)].map(id => <button key={id} type="button" className={selectedPdaDevice === id ? "btn-primary" : "btn-ghost"} onClick={() => setSelectedPdaDevice(id)}>{id === "ALL" ? tx("全部 PDA", "All PDAs", "Tat ca PDA") : id}</button>)}</div>
         <div className="table-shell"><table><thead><tr>{[tx("设备ID", "Device ID", "ID thiet bi"), tx("操作员", "Operator", "Nguoi thao tac"), tx("当前阶段", "Stage", "Giai doan"), tx("物料", "Material", "Vat lieu"), tx("箱进度", "Boxes", "Tien do thung"), tx("最后同步", "Last sync", "Dong bo cuoi"), tx("状态", "Status", "Trang thai"), tx("独立实例", "Instance", "Instance")].map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{pdaDevices.filter(device => selectedPdaDevice === "ALL" || device.id === selectedPdaDevice).length ? pdaDevices.filter(device => selectedPdaDevice === "ALL" || device.id === selectedPdaDevice).map(device => { const online = device.lastAt > 0 && Date.now() - device.lastAt < 30000; return <tr key={device.id}><td><strong>{device.id}</strong></td><td>{device.operator}</td><td>{device.stage}</td><td>{device.material || "-"}</td><td>{device.completedBoxes} / {device.totalBoxes || "-"}</td><td>{device.lastAt ? new Date(device.lastAt).toLocaleString() : "-"}</td><td><span className={`badge ${online ? "badge-success" : "badge-warning"}`}>{online ? tx("在线", "ONLINE", "TRUC TUYEN") : tx("已注册/离线", "REGISTERED/OFFLINE", "DA DANG KY / NGOAI TUYEN")}</span></td><td><a className="btn-ghost" href={`/?view=wms&wmsTab=pdaReceivingMobile&pdaId=${encodeURIComponent(device.id)}&mode=monitor`}>{tx("打开", "Open", "Mo")}</a></td></tr>; }) : <tr><td colSpan={8}>{tx("暂无已注册收料 PDA；设备登录并发送心跳后会自动显示。", "No receiving PDA registered yet; devices appear after login and heartbeat.", "Chua co PDA nhan lieu; thiet bi se hien sau khi dang nhap va gui heartbeat.")}</td></tr>}</tbody></table></div>
      </section>
      <MaterialRollQrGenerator locale={locale} variant="wms" prefill={receivingLabelPrefill} />
    </div>
  );
}
