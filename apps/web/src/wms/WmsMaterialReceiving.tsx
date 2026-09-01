import { useEffect, useMemo, useRef, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { WmsPdaReceivingMobile } from "./WmsPdaReceivingMobile";
import { WmsMaterialRealtimeFlow } from "./WmsMaterialRealtimeFlow";
import { MaterialRollQrGenerator, type MaterialRollPrefill } from "../mes/MaterialRollQrGenerator";
import { apiClient, type ListEnvelope } from "../api/client";
import { wmsApi } from "../api/wms";
import * as XLSX from "xlsx";
import QRCode from "qrcode";
import { oaRepository, type OaRequest } from "../oa/oaApi";

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
  const labelInput = useRef<HTMLInputElement>(null);
  const labelVideo = useRef<HTMLVideoElement>(null);
  const labelCanvas = useRef<HTMLCanvasElement>(null);
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
  const workflowStage = !areaQr.trim()
    ? "AREA_SCAN"
    : !palletType
      ? "PALLET_TYPE"
      : !materialCode.trim() || !lot.trim()
        ? "MATERIAL_INFO"
        : !boxQr.trim() && !boxQrs.length
          ? "BOX_SCAN"
          : !palletQr.trim()
            ? "PALLET_QR"
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
      row["Vietnam material code"] = row["\u8d8a\u5357\u4e1c\u6cf0\u6599\u53f7"] ?? row["\u8d8a\u5357\u6599\u53f7"] ?? row["\u54c1\u53f7"] ?? "";
      row["Ruijing material code"] = row["\u6df1\u5733\u745e\u6676\u6599\u53f7"] ?? row["\u745e\u6676\u6599\u53f7"] ?? "";
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
      const vietnam = msdText(row, "越南料号");
      const ruijing = msdText(row, "RJ物料料号");
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
    setReceivingImportStatus(`已带入第 ${row.__row} 行，可继续扫描区域 QR、托板和箱 QR`);
  };
  const receivingLabelPrefill = useMemo<MaterialRollPrefill>(() => ({
    materialSn: materialCode.trim(), materialCode: materialCode.trim(), description: specification.trim(),
    internalCode: ruijingMaterialCode.trim(), lotNo: lot.trim(), dateCode: (manufactureDate || receiptDate).trim(),
    supplierName: supplier.trim(), supplierBarcode: supplierBarcode.trim(), purchaseOrder: purchaseOrder.trim(),
    supplierLot: lot.trim(), quantity: Number(boxQty || receivedQty || expectedQty || 0), unit,
    msdLevel, floorLifeHours: msdFloorLifeHours, locationCode: locationQr.trim(),
    manufacturingDate: manufactureDate.trim(), expiryDate: expiryDate.trim(), plantCode: "RUIJING_VN",
    rollCount: Math.max(1, Number(caseCount) || 1), caseCount, palletQr: palletQr.trim(), boxQr: boxQr.trim(), supplierIqc,
    receivingStatus: "AWAITING_IQC",
  }), [materialCode, specification, ruijingMaterialCode, lot, manufactureDate, receiptDate, supplier, supplierBarcode, purchaseOrder, boxQty, receivedQty, expectedQty, unit, msdLevel, msdFloorLifeHours, locationQr, caseCount, palletQr, boxQr, supplierIqc]);
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
  // Use the same Sheet1 material master workbook as the SMT material-roll page.
  useEffect(() => {
    fetch("/material_label_master.xlsx")
      .then(response => response.ok ? response.blob() : Promise.reject(new Error("material master workbook unavailable")))
      .then(blob => importMaterialCodeMapping(new File([blob], "material_label_master.xlsx")))
      .catch(() => setMaterialMappingStatus(tx("自动导入失败，请选择同一份 SMT 卷料 Excel", "Automatic import failed; choose the same SMT material-roll Excel", "Tu dong nhap that bai; hay chon cung file Excel cuon SMT")));
  }, []);
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
  const readLabelFile = async (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setLabelImage(String(reader.result || "")); setLabelOcrData(null); setLabelOcrMessage(""); };
    reader.readAsDataURL(file);
  };
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
    setLabelImage(canvas.toDataURL("image/jpeg", 0.9));
    setLabelOcrData(null);
    stopLabelCamera();
  };
  const runLabelOcr = async (imageOverride?: string) => {
    const image = imageOverride || labelImage;
    if (!image) return;
    setLabelOcrBusy(true); setLabelOcrMessage("");
    try {
      const token = sessionStorage.getItem("auth_token");
      const response = await fetch("/api/wms/receiving/label-ai", {
        method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ image, qrValue: boxQr.trim() || palletQr.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error?.message || result?.message || "OCR failed");
      const data = result.data || result;
      setLabelOcrData(data as Record<string, unknown>);
      const text = (value: unknown) => value == null ? "" : String(value).trim();
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
    } finally { setLabelOcrBusy(false); }
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
    const apply = (payload: any) => {
      if (!payload) return;
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
      const incomingArea = String(payload.areaQr ?? payload.receivingArea ?? "").trim();
      if (incomingArea && payload.changedField === "areaQr") {
        setAreaQr(incomingArea); setLocationQr(""); setLocationCapacity(null); setMaterialCode(""); setRuijingMaterialCode(""); setMaterialName(""); setSpecification(""); setSupplier(""); setSupplierBarcode(""); setSupplierDeliverySheetNo(""); setPurchaseOrder(""); setLot(""); setManufactureDate(""); setExpiryDate(""); setExpectedQty(""); setReceivedQty(""); setBoxQty(""); setCaseCount(""); setPartialBox(false); setPalletQr(""); setBoxQr(""); setBoxQrs([]); setBindings([]); setPalletMaterials([]); setGeneratedCaseQr(""); setGeneratedCaseQrImage(""); setPalletType("MIXED_PRODUCT"); setPalletSize(""); setPalletMaterial(""); setMsdLevel(""); setMsdFloorLifeHours(""); setMsdBindingStatus(""); setCertificates([]); setLabelImage(""); setLabelOcrData(null); setLabelOcrMessage(""); setSupplierIqc("PENDING"); setPdaStatus(`New warehouse area: ${incomingArea}; receiving inputs cleared`);
        return;
      }
      const hasNewImage = Boolean(payload.imageDataUrl || payload.image);
      const hasNewQr = payload.inputMethod === "STANDARD_QR" || Boolean(payload.materialRollQr || payload.materialQr || payload.qrPayload);
      if (hasNewImage || hasNewQr) {
        if (hasNewImage) setLabelImage(String(payload.imageDataUrl || payload.image)); else setLabelImage("");
        setLabelOcrData(null);
        setLabelOcrMessage("");
      }
      if (payload.vietnamMaterialCode !== undefined || payload.materialCode !== undefined) setMaterialCode(String(payload.vietnamMaterialCode ?? payload.materialCode ?? ""));
      if (payload.ruijingMaterialCode !== undefined || payload.internalMaterialCode !== undefined) setRuijingMaterialCode(String(payload.ruijingMaterialCode ?? payload.internalMaterialCode ?? ""));
      if (payload.materialName) setMaterialName(String(payload.materialName));
      if (payload.areaQr || payload.receivingArea) setAreaQr(String(payload.areaQr ?? payload.receivingArea));
      if (payload.specification) setSpecification(String(payload.specification));
      if (payload.supplier) setSupplier(String(payload.supplier));
      if (payload.purchaseOrder) setPurchaseOrder(String(payload.purchaseOrder));
      if (payload.manufactureDate) setManufactureDate(String(payload.manufactureDate));
      if (payload.expiryDate) setExpiryDate(String(payload.expiryDate));
      if (payload.supplierBarcode) setSupplierBarcode(String(payload.supplierBarcode));
      if (payload.receiptDate) setReceiptDate(String(payload.receiptDate));
      if (payload.lotNo) setLot(String(payload.lotNo));
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
          setLabelOcrMessage(tx("已实时接收 PDA 标签识别结果，并自动回填收料信息", "Live PDA label result received and automatically applied", "Da nhan ket qua nhan PDA va tu dong dien thong tin"));
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
    const syncLatestCapture = () => {
      void fetch("/api/wms/receiving/live-state", { cache: "no-store" }).then(response => response.ok ? response.json() : null).then(result => {
        const payload = result?.data?.payload || result?.payload;
        const image = payload?.imageDataUrl || payload?.image;
        if (image) {
          setLabelImage(String(image));
          setLabelOcrMessage(tx("已从WMS实时状态恢复PDA图片", "PDA image restored from WMS live state", "Da khoi phuc anh PDA tu trang thai WMS"));
        }
      }).catch(() => { /* SSE remains the primary live path */ });
    };
    syncLatestCapture();
    const capturePoll = window.setInterval(syncLatestCapture, 1000);
     const devicePoll = window.setInterval(() => setPdaDevices(current => current.filter(device => Date.now() - device.lastAt < 30000)), 5000);
     return () => { window.removeEventListener("wms:pda-receiving-status", onStatus); stream.close(); aiStream.close(); captureStream.close(); window.clearInterval(capturePoll); window.clearInterval(devicePoll); };
  }, []);
  const addBox = async () => {
    const value = boxQr.trim();
    if (!palletType) { setPdaStatus(tx("请先选择托板类型", "Select pallet type before binding", "Vui lòng chọn loại pallet trước")); return; }
    if (!value || !materialCode.trim() || !lot.trim() || !locationQr.trim() || boxQrs.includes(value)) return;
    if (palletType === "SINGLE_PRODUCT" && bindings.some(binding => binding.materialCode && binding.materialCode.toUpperCase() !== materialCode.trim().toUpperCase())) {
      setPdaStatus(tx("单一产品托板不能绑定其他物料编码", "A single-product pallet cannot bind another material code", "Pallet đơn sản phẩm không thể liên kết mã vật liệu khác"));
      return;
    }
    const effectivePalletQr = palletQr.trim() || `WMS-PALLET:P${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const generatedCaseQrValue = buildCaseQrValue(value, effectivePalletQr);
    if (!palletQr.trim()) { setPalletQr(effectivePalletQr); setMotherQr(effectivePalletQr); setMotherQrImage(await QRCode.toDataURL(effectivePalletQr, { width: 180, margin: 1, errorCorrectionLevel: "M" })); }
    const token = sessionStorage.getItem("auth_token");
    let packageInfo:any=null;
    if(value.includes("*")){const packageResponse=await fetch("/api/wms/receiving/package-scan",{method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({qrValue:value,palletQr:effectivePalletQr,locationQr:locationQr.trim()})});if(!packageResponse.ok){const error=await packageResponse.json().catch(()=>({}));setPdaStatus(error?.error?.message||tx("供应商箱码格式无效","Invalid supplier package QR","QR kiện hàng NCC không hợp lệ"));return;}packageInfo=(await packageResponse.json()).data;setPackageScans(xs=>[...xs.filter(x=>x.qrValue!==value),packageInfo]);if(packageInfo.material_code&&packageInfo.material_code.toUpperCase()!==materialCode.trim().toUpperCase()){setPdaStatus(tx("箱码物料与当前收料物料不一致","Box material does not match current receiving material","Vật liệu trên thùng không khớp"));return;}}
    const bindingQty=Number(packageInfo?.quantity||boxQty||receivedQty||0),packageLevel=packageInfo?.packageLevel||"OUTER",parentBoxQr=packageInfo?.parentSerialNo||null;
    const response = await fetch("/api/wms/receiving/pallet-box-bindings", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ areaQr: areaQr.trim(), palletQr: effectivePalletQr, palletType, palletSize: palletSize.trim(), palletMaterial: palletMaterial.trim(), materialCode: materialCode.trim(), vietnamMaterialCode: materialCode.trim(), ruijingMaterialCode: ruijingMaterialCode.trim(), specification: specification.trim(), quantity: bindingQty, declaredQty:bindingQty, packageLevel,parentBoxQr, boxQr: value, sourceBoxQr: value, generatedCaseQr: generatedCaseQrValue, caseQrValue: generatedCaseQrValue, lotNo: lot.trim(), supplier: supplier.trim(), purchaseOrder: purchaseOrder.trim(), supplierBarcode: supplierBarcode.trim(), locationQr: locationQr.trim(), msdLevel: msdLevel || null, msdFloorLifeHours: msdFloorLifeHours ? Number(msdFloorLifeHours) : null, palletQrType: motherQr || !palletQr.trim() ? "GENERATED_MOTHER" : "SUPPLIER_PALLET", palletMaterials: palletMaterials.map(line => ({ ...line, quantity: Number(line.quantity || line.quantityPerBox || 0), caseCount: Number(line.caseCount || 0), quantityPerBox: Number(line.quantityPerBox || 0) })), receivingDocuments: receivingDocuments() }) });
    if (!response.ok) return;
    setBoxQrs(xs => [...xs, value]);
    setBindings(xs => [...xs, { palletQr: effectivePalletQr, boxQr: generatedCaseQrValue, materialCode: materialCode.trim(), quantity: bindingQty }]);
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
  const resolveLocation = async () => { if (!locationQr.trim()) return; const token = sessionStorage.getItem("auth_token"); const response = await fetch(`/api/wms/floor-storage-areas/resolve?qr=${encodeURIComponent(locationQr.trim())}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }); if (!response.ok) { setLocationCapacity(null); return; } const result = await response.json(); const data = result.data || result; setLocationCapacity({ capacity: Number(data.capacity || 0), occupied: Number(data.occupied || 0), name: data.areaName || data.areaCode }); };
  const submitMaterialReceivingOa = async () => {
    if (!materialCode.trim() || !lot.trim() || !receivedQty.trim() || !palletType || !locationQr.trim()) {
      setPdaStatus(tx("收料前必须选择托板类型", "Pallet type is required before receiving", "Phải chọn loại pallet trước khi nhận"));
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
          { label: "Pallet type", value: palletType || "-" },
          { label: "Pallet size / material", value: `${palletSize.trim() || "-"} / ${palletMaterial.trim() || "-"}` },
          { label: "Pallet / location", value: `${palletQr.trim() || "AUTO"} / ${locationQr.trim() || "-"}` },
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
    if (!palletType || !materialCode.trim() || !lot.trim() || !locationQr.trim() || !palletQr.trim()) {
      setPdaStatus(tx("请先完成所有收料步骤（选择托板类型、录入物料/批次、扫描箱码、生成托板QR、绑定库位）", "Complete all receiving steps before submitting (pallet type, material/lot, box scan, pallet QR, location binding)", "Vui lòng hoàn thành tất cả bước nhận liệu trước khi gửi"));
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
      { title: "物料收料 QR", value: String(row.material_qr || ""), detail: `${row.material_code || ""} · ${row.lot_no || ""} · ${row.msd_level || ""}` },
      { title: "托板 QR", value: String(row.pallet_qr || ""), detail: `${row.material_code || ""} · ${row.lot_no || ""}` },
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
      <section className="surface-panel" style={{ padding: 24, border: "2px solid #2563eb", background: "linear-gradient(135deg,#eff6ff,#ffffff)" }}>
        <div className="no-print" style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 18 }}><div><div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>WMS RECEIVING · PRE-IQC LEDGER · PDA VALIDATION</div><h2 style={{ margin: "6px 0" }}>物料接收管理</h2><p style={{ margin: 0, color: "var(--muted)" }}>PO采购到货 → 收料确认 → QR绑定仓库 → IQC待检；收料信息、批次、数量和库位保持可追溯。</p></div><div style={{ textAlign: "right" }}><span className="badge badge-info">正式模板：DataMatrix-material · 越南 A1</span><div style={{ fontSize: 11, color: "var(--muted)", marginTop: 5 }}>BarTender 10.1 SR3 · 托盘/料箱QR绑定</div><div style={{ fontSize: 11, color: "#f5b942", marginTop: 3 }}>网页标签仅供数据预览，正式版式以 BTW 为准</div></div></div>
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
        <input ref={labelInput} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={e => void readLabelFile(e.target.files?.[0])} />
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
              <button className="btn-ghost" type="button" onClick={() => labelInput.current?.click()}>{tx("上传标签图片", "Upload label image", "Tai anh nhan")}</button>
              <button className="btn-primary" type="button" disabled={!labelImage || labelOcrBusy} onClick={() => void runLabelOcr()}>{labelOcrBusy ? tx("识别中…", "Reading…", "Dang doc…") : tx("开始OCR识别", "Run OCR", "Chay OCR")}</button>
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
              ["Pallet QR", labelOcrData.palletQr],
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
      <section className="surface-panel" style={{ marginBottom: 12 }}><div className="section-header"><div><h3>已绑定物料清单</h3><p>同一 Material ID / Lot 可对应多个托板；每个托板和库位独立显示，不互相覆盖。GPS 是 PDA 现场采集证据，正式位置以区域/库位 QR 为准。</p></div><strong>{boundMaterials.length} 条托板明细</strong></div><div className="table-shell"><table><thead><tr>{["物料ID", "批次", "物料", "物料QR", "栈板QR", "托板数量", "区域QR", "仓位QR", "PDA GPS (X/Y/精度)", "来源", "状态"].map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{boundMaterials.length ? boundMaterials.map(row => <tr key={String(row.id)}><td>{row.material_id || row.material_code || "-"}</td><td>{row.lot_no || "-"}</td><td><strong>{row.material_code || "-"}</strong><br /><span>{row.material_name || "-"}</span></td><td>{row.material_qr || "-"}</td><td>{row.pallet_qr || "-"}</td><td>{row.pallet_quantity ?? row.quantity ?? 0} {row.uom || ""}</td><td>{row.area_qr || row.receiving_area || "-"}</td><td>{row.location_code || row.warehouse_code || "-"}</td><td>{row.pda_x != null && row.pda_y != null ? `${row.pda_x}, ${row.pda_y} / ±${row.pda_accuracy ?? "-"}m` : "-"}</td><td>{row.source_type || "PO_RECEIPT"}</td><td><span className="badge badge-warning">{row.status || "IQC_PENDING"}</span></td></tr>) : <tr><td colSpan={11}>暂无已绑定物料；完成收料并生成 QR 后会显示在这里。</td></tr>}</tbody></table></div></section>
      <section id="material-realtime-flow" className="surface-panel" style={{ scrollMarginTop: 18, border: "3px solid #0f766e", background: "linear-gradient(135deg,#ecfeff,#ffffff)" }}>
        <div className="section-header"><div><h2 style={{ margin: 0 }}>物料收料动态流程图</h2><p style={{ margin: "4px 0 0" }}>区域 QR → 物料/箱 QR → 打印贴标 → 托板 QR → 库位 QR → IQC</p></div><span className="badge badge-success">PDA / WMS 实时同步</span></div>
        <WmsMaterialRealtimeFlow locale={locale} materialCode={materialCode} lotNo={lot} boxQr={boxQr} iqcStatus={supplierIqc} locationCode={locationQr} />
      </section>
      <section className="surface-panel" style={{ border: "1px solid #f59e0b", background: "linear-gradient(135deg,#fffbeb,#ffffff)" }}>
        <div className="section-header"><div><h3>湿敏 / 水分控制</h3><p>收料时建立湿敏物料控制记录；开封、暴露、烘烤和 IQC 放行独立于 SMT 卷料打印流程。</p></div><span className={`badge ${msdLevel ? "badge-warning" : "badge-info"}`}>{msdLevel ? `MSL ${msdLevel}` : "MSL 待确认"}</span></div>
        <div style={{ marginBottom: 12, padding: 14, border: "2px solid #16a34a", borderRadius: 10, background: "#f0fdf4" }}><strong style={{ fontSize: 16 }}>已收料 Excel 快速入账</strong><p style={{ margin: "5px 0 8px", color: "#475569", fontSize: 12 }}>导入现场已经完成收料的物料清单，用于快速填入 WMS 台账；不创建采购订单，也不替代 PDA 收料。</p><input className="form-input" type="file" accept=".xlsx,.xls,.csv" onChange={e => void importReceivingExcel(e.target.files?.[0])} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
          <div style={{ padding: 12, borderRadius: 8, background: "#fff", border: "1px solid #fde68a" }}><small>标准暴露时限</small><strong style={{ display: "block", marginTop: 5 }}>{msdFloorLifeHours ? `${msdFloorLifeHours} 小时` : "待导入 MSD 规则"}</strong></div>
          <div style={{ padding: 12, borderRadius: 8, background: "#fff", border: "1px solid #fde68a" }}><small>收料开封状态</small><strong style={{ display: "block", marginTop: 5 }}>未开封 / 未开始计时</strong></div>
          <div style={{ padding: 12, borderRadius: 8, background: "#fff", border: "1px solid #fde68a" }}><small>烘烤状态</small><strong style={{ display: "block", marginTop: 5 }}>无需烘烤 / 待判定</strong></div>
          <div style={{ padding: 12, borderRadius: 8, background: "#fff", border: "1px solid #fde68a" }}><small>IQC 放行锁定</small><strong style={{ display: "block", marginTop: 5, color: supplierIqc === "PASS" ? "#15803d" : "#b45309" }}>{supplierIqc === "PASS" ? "已放行" : "IQC 前锁定"}</strong></div>
        </div>
      </section>
      <section className="surface-panel">
        <div className="section-header"><div><h3>{tx("MS定义与暴露管控", "MS definition and exposure control", "Định nghĩa MS và kiểm soát phơi nhiễm")}</h3><p>{tx("收料时建立 MS 规则，后续开箱、关闭、预警和锁定都按此规则计算。", "Define the MS rule at receiving; opening, closing, warnings and lockout use this rule.", "Xác định quy tắc MS khi nhận; mở, đóng, cảnh báo và khóa dùng cùng quy tắc.")}</p></div></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
          <label>{tx("MS等级（Excel导入）", "MS level (Excel only)", "Cấp MS (chỉ Excel)")}<select className="form-input" value={msdLevel} disabled><option value="">{tx("未指定，请先导入Excel", "Not specified; import Excel first", "Chưa xác định; hãy nhập Excel")}</option><option value="1">MS-1</option><option value="2">MS-2</option><option value="2a">MS-2a</option><option value="3">MS-3</option><option value="4">MS-4</option><option value="5">MS-5</option><option value="5a">MS-5a</option><option value="6">MS-6</option></select></label>
          <label>{tx("标准暴露时限（Excel导入）", "Standard floor life (Excel only)", "Thời hạn phơi chuẩn (chỉ Excel)")}<input className="form-input" type="number" min="0" value={msdFloorLifeHours} readOnly placeholder="由Excel规则自动带出" /></label>
          <label>{tx("MSD规则Excel", "MSD rules Excel", "Excel quy tắc MSD")}<input className="form-input" type="file" accept=".xlsx,.xls,.csv" onChange={e => void importMsdRules(e.target.files?.[0])} /><small>{tx("列：material code、MSD level、Standard floor life hours", "Columns: material code, MSD level, Standard floor life hours", "Cột: material code, MSD level, Standard floor life hours")}</small></label>
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
        <div className="section-header"><div><h3>{tx("收料身份与绑定", "Receiving Identity & Binding", "Định danh & liên kết tiếp nhận")}</h3><p>{tx("每个托盘和料箱在IQC放行前必须可追溯。", "Every pallet and material box must be traceable before IQC release.", "Mỗi pallet và thùng vật liệu phải truy xuất được trước khi IQC phê duyệt.")}</p></div><span className={`badge ${supplierIqc === "PASS" ? "badge-success" : supplierIqc === "FAIL" ? "badge-danger" : "badge-warning"}`}>IQC: {supplierIqc === "PENDING" ? tx("待检", "PENDING", "CHỜ KIỂM") : supplierIqc}</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
          <label style={{ border: areaQr.trim() ? "1px solid #16a34a" : "2px solid #f59e0b", borderRadius: 8, padding: 8, background: areaQr.trim() ? "#f0fdf4" : "#fffbeb" }}>{tx("第一步：先扫描仓库区域 QR", "Step 1: scan warehouse area QR first", "Buoc 1: quet QR khu vuc kho truoc")}<input className="form-input" autoFocus value={areaQr} onChange={e => setAreaQr(e.target.value)} placeholder={tx("扫描区域名称/区域QR", "Scan area name / area QR", "Quet ten khu vuc / QR khu vuc")} /><small>{areaQr.trim() ? tx("区域已确认，继续扫描物料/箱/托板", "Area confirmed; continue with material, box and pallet", "Da xac nhan khu vuc; tiep tuc quet vat lieu, thung va pallet") : tx("必须先确定托板将进入哪个仓库区域", "Required before receiving any pallet", "Bat buoc truoc khi nhan pallet")}</small></label>
          <label>{tx("供应商", "Supplier", "Nhà cung cấp")}<input className="form-input" value={supplier} onChange={e => setSupplier(e.target.value)} placeholder={tx("供应商代码/名称", "Supplier code / name", "Mã / tên nhà cung cấp")} /></label>
          <label>{tx("物料名称", "Material name", "Tên vật liệu")}<input className="form-input" value={materialName} onChange={e => setMaterialName(e.target.value)} /></label>
          <label>Vietnam material code<input className="form-input" value={materialCode} onChange={e => setMaterialCode(e.target.value)} onBlur={e => lookupSharedMaterial(e.target.value, "vietnam")} placeholder="Enter Vietnam material code" /></label>
          <label>Ruijing material code<input className="form-input" value={ruijingMaterialCode} onChange={e => setRuijingMaterialCode(e.target.value)} onBlur={e => lookupSharedMaterial(e.target.value, "ruijing")} placeholder="Enter Ruijing material code" /></label>
          <label>{tx("规格型号", "Specification", "Quy cách")}<input className="form-input" value={specification} onChange={e => setSpecification(e.target.value)} /></label>
          <label>{tx("采购订单", "Purchase order", "Đơn mua hàng")}<input className="form-input" value={purchaseOrder} onChange={e => setPurchaseOrder(e.target.value)} /></label>
          <label>{tx("已收料清单 Excel（快速入账）", "Received-material Excel (quick ledger entry)", "Excel vat lieu da nhan (ghi so nhanh)")}
            <input className="form-input" type="file" accept=".xlsx,.xls,.csv" onChange={e => void importReceivingExcel(e.target.files?.[0])} />
            <small>{tx("按首个工作表读取；支持 PO、供应商、物料编码、批次、箱数、每箱数量、数量", "Reads the first sheet; supports PO, supplier, material, lot, box count, quantity per box and quantity", "Doc sheet dau; ho tro PO, nha cung cap, vat lieu, lot, so thung va so luong")}</small>
          </label>
          <label>{tx("供应商条码", "Supplier barcode", "Mã vạch nhà cung cấp")}<input className="form-input" value={supplierBarcode} onChange={e => setSupplierBarcode(e.target.value)} /></label>
          <label>{tx("SMT卷料物料编码映射（同一份Excel）", "SMT material-code mapping (shared Excel)", "Mapping ma vat lieu cuon SMT (Excel dung chung)")}
            <input className="form-input" type="file" accept=".xlsx,.xls,.csv" onChange={e => void importMaterialCodeMapping(e.target.files?.[0])} />
            <small>{tx("只读取 Sheet1；与 SMT 物料卷页面使用同一份 material_label_master.xlsx", "Sheet1 only; the same material_label_master.xlsx used by SMT material-roll", "Chi doc Sheet1; dung cung material_label_master.xlsx voi trang cuon SMT")}</small>
            <button className="btn-ghost" type="button" style={{ marginTop: 6 }} onClick={() => void importSharedSmtMapping()}>{tx("重新读取共享SMT卷料Excel", "Reload shared SMT material-roll Excel", "Doc lai Excel cuon SMT dung chung")}</button>
            {materialMappingStatus && <small style={{ display: "block", color: materialMappingStatus.includes("失败") || materialMappingStatus.includes("Failed") || materialMappingStatus.includes("Loi") ? "#b91c1c" : "#15803d" }}>{materialMappingStatus}</small>}
          </label>
          <label>{tx("收料日期", "Receipt date", "Ngày nhận")}<input className="form-input" type="date" value={receiptDate} onChange={e => setReceiptDate(e.target.value)} /></label>
          <label>{tx("批次", "Lot", "Lô hàng")}<input className="form-input" value={lot} onChange={e => setLot(e.target.value)} placeholder={tx("供应商批次", "Supplier lot", "Lô nhà cung cấp")} /></label>
          <label>{tx("生产日期", "Manufacture date", "Ngày sản xuất")}<input className="form-input" value={manufactureDate} onChange={e => setManufactureDate(e.target.value)} /></label>
          <label>{tx("有效期至", "Expiry date", "Hạn sử dụng")}<input className="form-input" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} /></label>
          <label>{tx("单位", "Unit", "Đơn vị")}<select className="form-input" value={unit} onChange={e => setUnit(e.target.value)}><option>PCS</option><option>KG</option><option>ROLL</option><option>SET</option><option>箱 / BOX</option></select></label>
          <label>{tx("箱/件数量（现场核验）", "Case / box count (verify on site)", "Số thùng / hộp (xác nhận tại chỗ)")}<input className="form-input" type="number" min="0" value={caseCount} onChange={e => setCaseCount(e.target.value)} /></label>
          <label>{tx("每箱数量（标签数量）", "Quantity per box (label quantity)", "Số lượng mỗi thùng (theo nhãn)")}<input className="form-input" type="number" min="0" value={boxQty} onChange={e => { const value = e.target.value; setBoxQty(value); if (!caseCount.trim()) { setReceivedQty(value); setExpectedQty(value); } }} /></label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 22 }}><input type="checkbox" checked={partialBox} onChange={e => setPartialBox(e.target.checked)} />{tx("尾数箱/部分箱", "Partial / tail box", "Thùng lẻ / một phần")}</label>
          <label>{tx("托盘QR", "Pallet QR", "QR pallet")}<input className="form-input" value={palletQr} onChange={e => setPalletQr(e.target.value)} placeholder={tx("扫描托盘QR", "Scan pallet QR", "Quét QR pallet")} /></label>
          <label>{tx("库位（现场扫码）", "Storage location (scan on site)", "Vị trí kho (quét tại chỗ)")}<input className="form-input" value={locationQr} onChange={e => { setLocationQr(e.target.value); setLocationCapacity(null); }} onBlur={resolveLocation} placeholder={tx("现场扫描库位", "Scan location on site", "Quét vị trí tại chỗ")} /></label>
        </div>
        {receivingImportStatus && <div style={{ marginTop: 10, padding: 10, borderRadius: 6, background: receivingImportRows.length ? "#ecfdf5" : "#fef2f2", color: receivingImportRows.length ? "#166534" : "#b91c1c" }}>{receivingImportName}: {receivingImportStatus}</div>}
        {receivingImportRows.length > 0 && <div className="table-shell" style={{ marginTop: 10, maxHeight: 220, overflow: "auto" }}><table><thead><tr><th>行</th><th>PO</th><th>物料编码</th><th>批次</th><th>数量</th><th>操作</th></tr></thead><tbody>{receivingImportRows.map(row => <tr key={row.__row}><td>{row.__row}</td><td>{row["采购订单"] || row.PO || row["PO No"] || "-"}</td><td>{row["Vietnam material code"] || row["越南物料编码"] || row["物料编码"] || row["Material Code"] || "-"}</td><td>{row["批次"] || row.Lot || row["Lot No"] || "-"}</td><td>{row["收料数量"] || row["Received Qty"] || row.Quantity || "-"}</td><td><button type="button" className="btn-ghost" onClick={() => selectReceivingImportRow(row)}>带入收料</button></td></tr>)}</tbody></table></div>}
        {locationCapacity && <div style={{ marginTop: 8, fontSize: 12, color: locationCapacity.occupied >= locationCapacity.capacity ? "#dc2626" : "#15803d" }}>{locationCapacity.name || locationQr}: {tx("容量", "Capacity", "Sức chứa")} {locationCapacity.occupied}/{locationCapacity.capacity} · {tx("剩余", "Available", "Còn lại")} {Math.max(0, locationCapacity.capacity - locationCapacity.occupied)}</div>}
        {(expectedQty || receivedQty || caseCount || boxQty) && <div style={{ marginTop: 8, padding: 10, background: "var(--nav)", borderRadius: 6 }}>{tx("数量核对", "Quantity reconciliation", "Đối chiếu số lượng")}: {tx("预计", "Expected", "Dự kiến")} {expectedQty || 0} {unit} · {tx("已收", "Received", "Đã nhận")} {receivedQty || 0} {unit} · {tx("差异", "Difference", "Chênh lệch")} {Number(expectedQty || 0) - Number(receivedQty || 0)} {unit}{partialBox ? ` · ${tx("尾数箱", "PARTIAL BOX", "THÙNG LẺ")}` : ""}</div>}
        {pdaStatus && <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 5, background: "rgba(37,99,235,0.1)", color: "#1d4ed8", fontSize: 12 }}>{tx("已接收统一PDA信息", "Unified PDA information received", "Đã nhận thông tin từ PDA hợp nhất")}: {pdaStatus}</div>}
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #cbd5e1", borderRadius: 8, background: "#f8fafc" }}>
          <strong>{tx("托板信息（收料时填写）", "Pallet information (complete during receiving)", "Thông tin pallet (điền khi nhận)")}</strong>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginTop: 8 }}>
            <label>{tx("托板类型（必选）", "Pallet type (required)", "Loại pallet (bắt buộc)")}<select className="form-input" value={palletType} onChange={e => setPalletType(e.target.value as "" | "SINGLE_PRODUCT" | "MIXED_PRODUCT")}><option value="">{tx("请选择", "Select", "Chọn")}</option><option value="SINGLE_PRODUCT">{tx("单一产品托板", "Single-product pallet", "Pallet đơn sản phẩm")}</option><option value="MIXED_PRODUCT">{tx("混装产品托板", "Mixed-product pallet", "Pallet hỗn hợp")}</option></select></label>
            <label>{tx("托板尺寸", "Pallet size", "Kích thước pallet")}<input className="form-input" value={palletSize} onChange={e => setPalletSize(e.target.value)} placeholder="L×W×H mm" /></label>
            <label>{tx("托板材质", "Pallet material", "Vật liệu pallet")}<input className="form-input" value={palletMaterial} onChange={e => setPalletMaterial(e.target.value)} placeholder={tx("例如：木托/塑料托", "e.g. wood / plastic", "vd: gỗ / nhựa")} /></label>
          </div>
        </div>
        {palletType === "MIXED_PRODUCT" && <div style={{ marginTop: 12, padding: 12, border: "2px solid #8b5cf6", borderRadius: 8, background: "#f5f3ff" }}>
          <div className="section-header" style={{ marginBottom: 8 }}><div><strong>{tx("混装托板物料明细", "Mixed-pallet material lines", "Chi tiet vat lieu pallet hon hop")}</strong><p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>{tx("同一托板可添加多个物料；先选择一行作为当前物料，再扫描该物料的箱码。", "Add multiple materials to this pallet; select a line before scanning its box QR.", "Them nhieu vat lieu tren cung pallet; chon mot dong truoc khi quet QR thung.")}</p></div><button className="btn-primary" type="button" onClick={addPalletMaterial}>＋ {tx("添加物料", "Add material", "Them vat lieu")}</button></div>
          {palletMaterials.length === 0 ? <div style={{ padding: 10, background: "#fff", borderRadius: 6, fontSize: 12 }}>{tx("当前为混装托板。点击“添加物料”录入第二种及更多物料。第一种物料使用上方主表单。", "This is a mixed pallet. Click Add material for the second and subsequent materials; the first uses the main form above.", "Pallet hon hop. Bam Them vat lieu cho vat lieu thu hai tro di; vat lieu dau tien dung bieu mau chinh.")}</div> : <div style={{ display: "grid", gap: 10 }}>{palletMaterials.map((line, index) => <div key={line.id} style={{ padding: 10, background: "#fff", border: "1px solid #c4b5fd", borderRadius: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}><strong>{tx("物料", "Material", "Vat lieu")} {index + 2}</strong><div style={{ display: "flex", gap: 6 }}><button className="btn-ghost" type="button" onClick={() => usePalletMaterial(line)}>{tx("设为当前绑定物料", "Use for current box binding", "Dung de lien ket thung hien tai")}</button><button className="btn-ghost" type="button" onClick={() => setPalletMaterials(lines => lines.filter(item => item.id !== line.id))}>×</button></div></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 8 }}>
              {([["materialCode", "Vietnam material code"], ["ruijingMaterialCode", "Ruijing material code"], ["materialName", tx("物料名称", "Material name", "Ten vat lieu")], ["lot", tx("批次", "Lot / batch", "Lot")], ["caseCount", tx("箱数", "Box count", "So thung")], ["quantityPerBox", tx("每箱数量", "Qty per box", "So luong moi thung")], ["quantity", tx("物料数量", "Material quantity", "So luong vat lieu")], ["supplier", tx("供应商", "Supplier", "Nha cung cap")]] as Array<[keyof Omit<PalletMaterialLine, "id">, string]>).map(([field, label]) => <label key={String(field)}>{label}<input className="form-input" type={field === "caseCount" || field === "quantityPerBox" || field === "quantity" ? "number" : "text"} value={line[field]} onChange={e => updatePalletMaterial(line.id, field, e.target.value)} /></label>)}
              <label>{tx("单位", "Unit", "Unit")}<select className="form-input" value={line.unit} onChange={e => updatePalletMaterial(line.id, "unit", e.target.value)}><option>PCS</option><option>KG</option><option>ROLL</option><option>SET</option></select></label>
            </div>
          </div>)}</div>}
        </div>}
        <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "end" }}>
          <label style={{ flex: 1 }}>{tx("料箱QR", "Material box QR", "QR thùng vật liệu")}<input className="form-input" value={boxQr} onChange={e => setBoxQr(e.target.value)} onKeyDown={e => e.key === "Enter" && addBox()} placeholder={tx("扫描托盘上的每个料箱QR", "Scan each box QR on the pallet", "Quét từng QR thùng trên pallet")} /></label>
          <button className="btn-primary" type="button" onClick={addBox}>{tx("绑定料箱", "Bind box", "Liên kết thùng")}</button>
        </div>
        {boxQrs.length > 0 && <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>{boxQrs.map(qr => <span className="badge badge-success" key={qr}>{palletQr} ↔ {qr}</span>)}</div>}
        {packageScans.length>0&&<div style={{marginTop:12,padding:12,border:"1px solid #60a5fa",borderRadius:8,background:"#eff6ff"}}><strong>{tx("供应商外箱/子箱层级","Supplier outer/sub-box hierarchy","Phân cấp thùng ngoài/thùng con")}</strong><div className="table-shell" style={{marginTop:8}}><table><thead><tr><th>{tx("层级","Level","Cấp")}</th><th>{tx("流水号","Serial","Số sê-ri")}</th><th>{tx("所属外箱","Parent outer box","Thùng ngoài")}</th><th>{tx("标签数量","Label qty","SL nhãn")}</th><th>{tx("有效计数规则","Effective counting","Quy tắc đếm")}</th></tr></thead><tbody>{packageScans.map(x=><tr key={x.qrValue}><td>{x.packageLevel==="SUB_BOX"?tx("子箱","SUB BOX","THÙNG CON"):tx("外箱","OUTER","THÙNG NGOÀI")}</td><td><b>{x.serialNo}</b></td><td>{x.parentSerialNo||"—"}</td><td>{Number(x.quantity)} {unit}</td><td>{x.countingSource==="SUB_BOX_SUM"?tx("按子箱合计，外箱不重复入账","Count sub-box sum; outer excluded","Cộng thùng con; không cộng lại thùng ngoài"):tx("尚无子箱，暂按外箱数量","No sub-box yet; count outer","Chưa có thùng con; đếm thùng ngoài")}</td></tr>)}</tbody></table></div></div>}
        {bindings.length > 0 && <div style={{ marginTop: 12, padding: 10, background: "var(--nav)", borderRadius: 6, fontSize: 12 }}><strong>{tx("托板绑定明细", "Pallet binding details", "Chi tiết liên kết pallet")}</strong>{bindings.map(binding => <div key={binding.boxQr} style={{ marginTop: 5 }}>{binding.palletQr} → {binding.boxQr} · {binding.materialCode} · {binding.quantity} {unit} <span style={{ color: "var(--muted)" }}> | {binding.boxQr} → {binding.palletQr}</span></div>)}</div>}
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
         <div className="table-shell"><table><thead><tr>{[tx("设备ID", "Device ID", "ID thiet bi"), tx("操作员", "Operator", "Nguoi thao tac"), tx("当前阶段", "Stage", "Giai doan"), tx("物料", "Material", "Vat lieu"), tx("托板QR", "Pallet QR", "QR pallet"), tx("箱进度", "Boxes", "Tien do thung"), tx("最后同步", "Last sync", "Dong bo cuoi"), tx("状态", "Status", "Trang thai"), tx("独立实例", "Instance", "Instance")].map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{pdaDevices.filter(device => selectedPdaDevice === "ALL" || device.id === selectedPdaDevice).length ? pdaDevices.filter(device => selectedPdaDevice === "ALL" || device.id === selectedPdaDevice).map(device => { const online = device.lastAt > 0 && Date.now() - device.lastAt < 30000; return <tr key={device.id}><td><strong>{device.id}</strong></td><td>{device.operator}</td><td>{device.stage}</td><td>{device.material || "-"}</td><td>{device.pallet || "-"}</td><td>{device.completedBoxes} / {device.totalBoxes || "-"}</td><td>{device.lastAt ? new Date(device.lastAt).toLocaleString() : "-"}</td><td><span className={`badge ${online ? "badge-success" : "badge-warning"}`}>{online ? tx("在线", "ONLINE", "TRUC TUYEN") : tx("已注册/离线", "REGISTERED/OFFLINE", "DA DANG KY / NGOAI TUYEN")}</span></td><td><a className="btn-ghost" href={`/?view=wms&wmsTab=pdaReceivingMobile&pdaId=${encodeURIComponent(device.id)}&mode=monitor`}>{tx("打开", "Open", "Mo")}</a></td></tr>; }) : <tr><td colSpan={9}>{tx("暂无已注册收料 PDA；设备登录并发送心跳后会自动显示。", "No receiving PDA registered yet; devices appear after login and heartbeat.", "Chua co PDA nhan lieu; thiet bi se hien sau khi dang nhap va gui heartbeat.")}</td></tr>}</tbody></table></div>
      </section>
      <WmsPdaReceivingMobile locale={locale} />
      <MaterialRollQrGenerator locale={locale} variant="wms" prefill={receivingLabelPrefill} />
    </div>
  );
}
