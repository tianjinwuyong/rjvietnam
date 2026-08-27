import { useEffect, useMemo, useRef, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { WmsPdaReceivingMobile } from "./WmsPdaReceivingMobile";
import { WmsMaterialRealtimeFlow } from "./WmsMaterialRealtimeFlow";
import { MaterialRollQrGenerator, type MaterialRollPrefill } from "../mes/MaterialRollQrGenerator";
import { apiClient, type ListEnvelope } from "../api/client";
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
  const [materialCodeMapping, setMaterialCodeMapping] = useState<Array<{ vietnam: string; ruijing: string; specification?: string; supplier?: string; msdLevel?: string; floorLifeHours?: string }>>(() => {
    try { return JSON.parse(localStorage.getItem("wms:material-code-mapping") || "[]"); } catch { return []; }
  });
  const [lot, setLot] = useState("");
  const [palletQr, setPalletQr] = useState("");
  const [motherQr, setMotherQr] = useState("");
  const [motherQrImage, setMotherQrImage] = useState("");
  const [locationQr, setLocationQr] = useState("");
  const [locationCapacity, setLocationCapacity] = useState<{ capacity: number; occupied: number; name?: string } | null>(null);
  const [boxQr, setBoxQr] = useState("");
  const [boxQrs, setBoxQrs] = useState<string[]>([]);
  const [bindings, setBindings] = useState<Array<{ palletQr: string; boxQr: string }>>([]);
  const [supplierIqc, setSupplierIqc] = useState<"PENDING" | "PASS" | "FAIL">("PENDING");
  const [pdaStatus, setPdaStatus] = useState<string>("");
  const [oaRequest, setOaRequest] = useState<OaRequest | null>(null);
  const [oaBusy, setOaBusy] = useState(false);
  type Certificate = { id: string; fileName: string; dataUrl: string; category: "QUALITY_CERTIFICATE" | "INSPECTION_REPORT" | "OTHER"; notes: string };
  const [certificates, setCertificates] = useState<Certificate[]>([]);
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
    void apiClient.get<ListEnvelope<{ vietnamMaterialCode: string; ruijingMaterialCode: string }>>("/wms/material-label-master", { q: code }).then(result => {
      const match = (result.items || []).find(item => item.vietnamMaterialCode.trim().toUpperCase() === code.toUpperCase());
      if (!cancelled && match?.ruijingMaterialCode) setRuijingMaterialCode(match.ruijingMaterialCode);
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
    void apiClient.get<ListEnvelope<{ vietnamMaterialCode: string; ruijingMaterialCode: string }>>("/wms/material-label-master", { q: code }).then(result => {
      const remoteMatch = (result.items || []).find(item => item.ruijingMaterialCode.trim().toUpperCase() === code.toUpperCase());
      if (!cancelled && remoteMatch?.vietnamMaterialCode && remoteMatch.vietnamMaterialCode.trim().toUpperCase() !== materialCode.trim().toUpperCase()) setMaterialCode(remoteMatch.vietnamMaterialCode);
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
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const payload = {
        source: "WMS_WEB",
        phase: "DRAFT",
        materialCode: materialCode.trim(),
        vietnamMaterialCode: materialCode.trim(),
        internalMaterialCode: ruijingMaterialCode.trim(),
        ruijingMaterialCode: ruijingMaterialCode.trim(),
        materialName: materialName.trim(),
        specification: specification.trim(),
        purchaseOrder: purchaseOrder.trim(),
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
        body: JSON.stringify({ from: "wms_receiving", to: "unified_pda", type: "WMS_RECEIVING_WMS_DRAFT", stationCode: "wms_receiving", payload }),
      }).catch(() => { /* PDA may be offline; next change retries */ });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [materialCode, ruijingMaterialCode, materialName, specification, purchaseOrder, manufactureDate, expiryDate, supplierBarcode, supplier, receiptDate, lot, unit, expectedQty, receivedQty, boxQty, caseCount, palletQr, boxQr, locationQr, msdLevel, msdFloorLifeHours, supplierIqc]);
  const importMaterialCodeMapping = async (file: File | undefined) => {
    if (!file) return;
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = workbook.Sheets["Sheet1"] || workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    const mappings = rows.map(row => ({
      vietnam: String(row["Vietnam material code"] ?? row["Vietnam code"] ?? row["越南料号"] ?? row["越南东泰料号"] ?? "").trim(),
      ruijing: String(row["Ruijing material code"] ?? row["Ruijing code"] ?? row["瑞晶料号"] ?? row["深圳瑞晶料号"] ?? row["物料编码"] ?? "").trim(),
      specification: String(row["Specification"] ?? row["规格型号"] ?? row["Description"] ?? "").trim(),
      supplier: String(row["Supplier"] ?? row["供应商"] ?? "").trim(),
      msdLevel: String(row["MSD level"] ?? row["MS level"] ?? row["MSD等级"] ?? row["MS等级"] ?? "").trim().replace(/^MS[- ]?/i, ""),
      floorLifeHours: String(row["Standard floor life hours"] ?? row["Floor life hours"] ?? row["标准暴露时限（小时）"] ?? row["标准暴露时限"] ?? "").trim(),
    })).filter(row => row.vietnam || row.ruijing);
    setMaterialCodeMapping(mappings);
    try { localStorage.setItem("wms:material-code-mapping", JSON.stringify(mappings)); } catch { /* storage may be unavailable */ }
    setMsdRules(mappings.filter(row => row.vietnam && row.msdLevel).map(row => ({ materialCode: row.vietnam, msdLevel: row.msdLevel, floorLifeHours: row.floorLifeHours })));
    const current = materialCode.trim().toUpperCase();
    const match = mappings.find(row => row.vietnam.toUpperCase() === current) || mappings[0];
    if (match) { setMaterialCode(match.vietnam); setRuijingMaterialCode(match.ruijing); }
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
      if (vietnamCode && !materialCode.trim()) setMaterialCode(vietnamCode);
      if (text(data.ruijingMaterialCode) && !ruijingMaterialCode.trim()) setRuijingMaterialCode(text(data.ruijingMaterialCode));
      if (text(data.materialName) && !materialName.trim()) setMaterialName(text(data.materialName));
      if (text(data.specification) && !specification.trim()) setSpecification(text(data.specification));
      if (text(data.lot) && !lot.trim()) setLot(text(data.lot));
      if (text(data.supplier) && !supplier.trim()) setSupplier(text(data.supplier));
      if (text(data.purchaseOrder) && !purchaseOrder.trim()) setPurchaseOrder(text(data.purchaseOrder));
      if (text(data.supplierBarcode) && !supplierBarcode.trim()) setSupplierBarcode(text(data.supplierBarcode));
      if (text(data.manufactureDate) && !manufactureDate.trim()) setManufactureDate(text(data.manufactureDate));
      if (text(data.expiryDate) && !expiryDate.trim()) setExpiryDate(text(data.expiryDate));
      if (number(data.expectedQuantity) && !expectedQty.trim()) setExpectedQty(number(data.expectedQuantity));
      if (number(data.quantity) && !receivedQty.trim()) setReceivedQty(number(data.quantity));
      if (number(data.quantityPerBox) && !boxQty.trim()) setBoxQty(number(data.quantityPerBox));
      if (text(data.unit) && !unit.trim()) setUnit(text(data.unit).toUpperCase());
      if (text(data.palletQr) && !palletQr.trim()) setPalletQr(text(data.palletQr));
      if (text(data.locationCode) && !locationQr.trim()) setLocationQr(text(data.locationCode));
      if (text(data.msdLevel) && !msdLevel.trim()) setMsdLevel(text(data.msdLevel).replace(/^MS[- ]?/i, ""));
      if (number(data.floorLifeHours) && !msdFloorLifeHours.trim()) setMsdFloorLifeHours(number(data.floorLifeHours));
      const scannedBox = text(data.boxSn) || text(data.boxNumber);
      if (scannedBox && !boxQr.trim()) setBoxQr(scannedBox);
      if (!number(data.expectedQuantity) && number(data.quantity)) setExpectedQty(number(data.quantity));
      const warningText = Array.isArray(data.warnings) && data.warnings.length ? ` (${data.warnings.join("; ")})` : "";
      setLabelOcrMessage(tx(`识别完成，已回填收料信息${warningText}`, `OCR complete; receiving fields were filled${warningText}`, `OCR hoan tat; da dien thong tin tiep nhan${warningText}`));
    } catch (error) {
      setLabelOcrMessage(error instanceof Error ? error.message : String(error));
    } finally { setLabelOcrBusy(false); }
  };
  const receivingLabelPrefill = useMemo<MaterialRollPrefill>(() => ({
    materialSn: materialCode.trim(),
    materialCode: materialCode.trim(),
    description: specification.trim(),
    internalCode: ruijingMaterialCode.trim(),
    lotNo: lot.trim(),
    dateCode: (manufactureDate || receiptDate).trim(),
    supplierName: supplier.trim(),
    supplierBarcode: supplierBarcode.trim(),
    purchaseOrder: purchaseOrder.trim(),
    supplierLot: lot.trim(),
    quantity: Number(boxQty || receivedQty || expectedQty || 0),
    unit,
    msdLevel,
    floorLifeHours: msdFloorLifeHours,
    locationCode: locationQr.trim(),
    manufacturingDate: manufactureDate.trim(),
    expiryDate: expiryDate.trim(),
    plantCode: "RUIJING_VN",
    rollCount: 1,
    caseCount,
    palletQr: palletQr.trim(),
    boxQr: boxQr.trim(),
    supplierIqc,
    receivingStatus: "AWAITING_IQC",
  }), [materialCode, ruijingMaterialCode, lot, receiptDate, supplier, boxQty, receivedQty, expectedQty, unit, msdLevel, locationQr, caseCount, palletQr, boxQr, supplierIqc]);
  const receivingDocuments = () => certificates.map(certificate => ({ documentType: certificate.category, documentUrl: certificate.dataUrl, fileName: certificate.fileName, capturedBy: sessionStorage.getItem("user_name") || "web-receiver", notes: certificate.notes, metadata: { source: "WMS_RECEIVING", lotNo: lot.trim(), supplier: supplier.trim(), receiptDate, category: certificate.category } }));
  const createMotherQr = async () => {
    const id = `MOTHER-PALLET-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
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
      if (payload.vietnamMaterialCode !== undefined || payload.materialCode !== undefined) setMaterialCode(String(payload.vietnamMaterialCode ?? payload.materialCode ?? ""));
      if (payload.ruijingMaterialCode !== undefined || payload.internalMaterialCode !== undefined) setRuijingMaterialCode(String(payload.ruijingMaterialCode ?? payload.internalMaterialCode ?? ""));
      if (payload.materialName) setMaterialName(String(payload.materialName));
      if (payload.specification) setSpecification(String(payload.specification));
      if (payload.supplier) setSupplier(String(payload.supplier));
      if (payload.purchaseOrder) setPurchaseOrder(String(payload.purchaseOrder));
      if (payload.manufactureDate) setManufactureDate(String(payload.manufactureDate));
      if (payload.expiryDate) setExpiryDate(String(payload.expiryDate));
      if (payload.supplierBarcode) setSupplierBarcode(String(payload.supplierBarcode));
      if (payload.receiptDate) setReceiptDate(String(payload.receiptDate));
      if (payload.lotNo) setLot(String(payload.lotNo));
      if (payload.palletQr !== undefined) setPalletQr(String(payload.palletQr || ""));
      if (payload.boxQr !== undefined) setBoxQr(String(payload.boxQr || ""));
      if (payload.unit) setUnit(String(payload.unit));
      if (payload.expectedQty !== undefined) setExpectedQty(String(payload.expectedQty));
      if (payload.receivedQty !== undefined) setReceivedQty(String(payload.receivedQty));
      if (payload.quantity !== undefined || payload.quantityPerBox !== undefined) { const value = payload.quantity ?? payload.quantityPerBox; setBoxQty(String(value ?? "")); setExpectedQty(String(value ?? "")); setReceivedQty(String(value ?? "")); }
      if (payload.storageLocation !== undefined || payload.locationCode !== undefined) setLocationQr(String(payload.storageLocation ?? payload.locationCode ?? ""));
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
          if (payload.quantity != null) setReceivedQty(String(payload.quantity));
          if (payload.quantityPerBox != null) setBoxQty(String(payload.quantityPerBox));
          if (value("unit")) setUnit(value("unit").toUpperCase());
          if (value("palletQr")) setPalletQr(value("palletQr"));
          if (value("locationCode")) setLocationQr(value("locationCode"));
          if (value("msdLevel")) setMsdLevel(value("msdLevel").replace(/^MS[- ]?/i, ""));
          if (payload.floorLifeHours != null) setMsdFloorLifeHours(String(payload.floorLifeHours));
          if (value("boxSn") || value("boxNumber")) setBoxQr(value("boxSn") || value("boxNumber"));
          setLabelOcrMessage(tx("已实时接收 PDA 标签识别结果，请确认后提交", "Live PDA label result received; confirm before submitting", "Da nhan ket qua nhan PDA theo thoi gian thuc; hay xac nhan truoc khi gui"));
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
    return () => { window.removeEventListener("wms:pda-receiving-status", onStatus); stream.close(); aiStream.close(); captureStream.close(); };
  }, []);
  const addBox = async () => { const value = boxQr.trim(); if (!value || !lot.trim() || !locationQr.trim() || boxQrs.includes(value)) return; const effectivePalletQr = palletQr.trim() || `MOTHER-PALLET-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`; if (!palletQr.trim()) { setPalletQr(effectivePalletQr); setMotherQr(effectivePalletQr); setMotherQrImage(await QRCode.toDataURL(effectivePalletQr, { width: 180, margin: 1, errorCorrectionLevel: "M" })); } const token = sessionStorage.getItem("auth_token"); const response = await fetch("/api/wms/receiving/pallet-box-bindings", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ palletQr: effectivePalletQr, boxQr: value, lotNo: lot.trim(), supplier: supplier.trim(), locationQr: locationQr.trim(), msdLevel: msdLevel || null, msdFloorLifeHours: msdFloorLifeHours ? Number(msdFloorLifeHours) : null, palletQrType: motherQr || !palletQr.trim() ? "GENERATED_MOTHER" : "SUPPLIER_PALLET", receivingDocuments: receivingDocuments() }) }); if (!response.ok) return; setBoxQrs(xs => [...xs, value]); setBindings(xs => [...xs, { palletQr: effectivePalletQr, boxQr: value }]); setBoxQr(""); };
  const resolveLocation = async () => { if (!locationQr.trim()) return; const token = sessionStorage.getItem("auth_token"); const response = await fetch(`/api/wms/floor-storage-areas/resolve?qr=${encodeURIComponent(locationQr.trim())}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }); if (!response.ok) { setLocationCapacity(null); return; } const result = await response.json(); const data = result.data || result; setLocationCapacity({ capacity: Number(data.capacity || 0), occupied: Number(data.occupied || 0), name: data.areaName || data.areaCode }); };
  const submitMaterialReceivingOa = async () => {
    if (!materialCode.trim() || !lot.trim() || !receivedQty.trim()) return;
    setOaBusy(true);
    try {
      const request = await oaRepository.submit({
        title: `物料收料审批 · ${lot.trim()}`,
        type: "material_receiving",
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
  return (
    <div className="screen-stack">
      <section className="surface-panel" style={{ border: "2px solid #2563eb", background: "linear-gradient(135deg,#eff6ff,#ffffff)" }}>
        <div className="section-header">
          <div>
            <h2>{tx("PDA物料标签大图OCR", "PDA Material Label OCR", "OCR nhan vat lieu PDA")}</h2>
            <p>{tx("拍摄或上传物料标签大图，识别后自动回填下方收料信息。识别结果必须人工确认。", "Capture or upload a large material-label image. OCR fills the receiving form below for confirmation.", "Chup hoac tai anh lon cua nhan vat lieu; OCR se dien vao bieu mau ben duoi de xac nhan.")}</p>
          </div>
          <span className="badge badge-warning">OCR · {labelOcrBusy ? tx("识别中", "PROCESSING", "DANG XU LY") : tx("待确认", "CONFIRM REQUIRED", "CAN XAC NHAN")}</span>
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
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{tx("OCR识别结果（已回填，可在下方表单修改）", "OCR result (applied; edit in the form below)", "Ket qua OCR (da dien; co the sua ben duoi)")}</div>
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
      <WmsMaterialRealtimeFlow locale={locale} materialCode={materialCode} lotNo={lot} boxQr={boxQr} iqcStatus={supplierIqc} locationCode={locationQr} />
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
          <label>{tx("供应商", "Supplier", "Nhà cung cấp")}<input className="form-input" value={supplier} onChange={e => setSupplier(e.target.value)} placeholder={tx("供应商代码/名称", "Supplier code / name", "Mã / tên nhà cung cấp")} /></label>
          <label>{tx("物料名称", "Material name", "Tên vật liệu")}<input className="form-input" value={materialName} onChange={e => setMaterialName(e.target.value)} /></label>
          <label>Vietnam material code<input className="form-input" value={materialCode} onChange={e => setMaterialCode(e.target.value)} placeholder="Enter Vietnam material code" /></label>
          <label>Ruijing material code<input className="form-input" value={ruijingMaterialCode} onChange={e => setRuijingMaterialCode(e.target.value)} placeholder="Enter Ruijing material code" /></label>
          <label>{tx("规格型号", "Specification", "Quy cách")}<input className="form-input" value={specification} onChange={e => setSpecification(e.target.value)} /></label>
          <label>{tx("采购订单", "Purchase order", "Đơn mua hàng")}<input className="form-input" value={purchaseOrder} onChange={e => setPurchaseOrder(e.target.value)} /></label>
          <label>{tx("供应商条码", "Supplier barcode", "Mã vạch nhà cung cấp")}<input className="form-input" value={supplierBarcode} onChange={e => setSupplierBarcode(e.target.value)} /></label>
          <label>Code mapping Excel<input className="form-input" type="file" accept=".xlsx,.xls,.csv" onChange={e => void importMaterialCodeMapping(e.target.files?.[0])} /></label>
          <label>{tx("收料日期", "Receipt date", "Ngày nhận")}<input className="form-input" type="date" value={receiptDate} onChange={e => setReceiptDate(e.target.value)} /></label>
          <label>{tx("批次", "Lot", "Lô hàng")}<input className="form-input" value={lot} onChange={e => setLot(e.target.value)} placeholder={tx("供应商批次", "Supplier lot", "Lô nhà cung cấp")} /></label>
          <label>{tx("生产日期", "Manufacture date", "Ngày sản xuất")}<input className="form-input" value={manufactureDate} onChange={e => setManufactureDate(e.target.value)} /></label>
          <label>{tx("有效期至", "Expiry date", "Hạn sử dụng")}<input className="form-input" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} /></label>
          <label>{tx("单位", "Unit", "Đơn vị")}<select className="form-input" value={unit} onChange={e => setUnit(e.target.value)}><option>PCS</option><option>KG</option><option>ROLL</option><option>SET</option><option>箱 / BOX</option></select></label>
          <label>{tx("箱/件数量（现场核验）", "Case / box count (verify on site)", "Số thùng / hộp (xác nhận tại chỗ)")}<input className="form-input" type="number" min="0" value={caseCount} onChange={e => setCaseCount(e.target.value)} /></label>
          <label>{tx("数量", "Quantity", "Số lượng")}<input className="form-input" type="number" min="0" value={boxQty} onChange={e => { const value = e.target.value; setBoxQty(value); setReceivedQty(value); setExpectedQty(value); }} /></label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 22 }}><input type="checkbox" checked={partialBox} onChange={e => setPartialBox(e.target.checked)} />{tx("尾数箱/部分箱", "Partial / tail box", "Thùng lẻ / một phần")}</label>
          <label>{tx("托盘QR", "Pallet QR", "QR pallet")}<input className="form-input" value={palletQr} onChange={e => setPalletQr(e.target.value)} placeholder={tx("扫描托盘QR", "Scan pallet QR", "Quét QR pallet")} /></label>
          <label>{tx("库位（现场扫码）", "Storage location (scan on site)", "Vị trí kho (quét tại chỗ)")}<input className="form-input" value={locationQr} onChange={e => { setLocationQr(e.target.value); setLocationCapacity(null); }} onBlur={resolveLocation} placeholder={tx("现场扫描库位", "Scan location on site", "Quét vị trí tại chỗ")} /></label>
        </div>
        {locationCapacity && <div style={{ marginTop: 8, fontSize: 12, color: locationCapacity.occupied >= locationCapacity.capacity ? "#dc2626" : "#15803d" }}>{locationCapacity.name || locationQr}: {tx("容量", "Capacity", "Sức chứa")} {locationCapacity.occupied}/{locationCapacity.capacity} · {tx("剩余", "Available", "Còn lại")} {Math.max(0, locationCapacity.capacity - locationCapacity.occupied)}</div>}
        {(expectedQty || receivedQty || caseCount || boxQty) && <div style={{ marginTop: 8, padding: 10, background: "var(--nav)", borderRadius: 6 }}>{tx("数量核对", "Quantity reconciliation", "Đối chiếu số lượng")}: {tx("预计", "Expected", "Dự kiến")} {expectedQty || 0} {unit} · {tx("已收", "Received", "Đã nhận")} {receivedQty || 0} {unit} · {tx("差异", "Difference", "Chênh lệch")} {Number(expectedQty || 0) - Number(receivedQty || 0)} {unit}{partialBox ? ` · ${tx("尾数箱", "PARTIAL BOX", "THÙNG LẺ")}` : ""}</div>}
        {pdaStatus && <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 5, background: "rgba(37,99,235,0.1)", color: "#1d4ed8", fontSize: 12 }}>{tx("已接收统一PDA信息", "Unified PDA information received", "Đã nhận thông tin từ PDA hợp nhất")}: {pdaStatus}</div>}
        <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "end" }}>
          <label style={{ flex: 1 }}>{tx("料箱QR", "Material box QR", "QR thùng vật liệu")}<input className="form-input" value={boxQr} onChange={e => setBoxQr(e.target.value)} onKeyDown={e => e.key === "Enter" && addBox()} placeholder={tx("扫描托盘上的每个料箱QR", "Scan each box QR on the pallet", "Quét từng QR thùng trên pallet")} /></label>
          <button className="btn-primary" type="button" onClick={addBox}>{tx("绑定料箱", "Bind box", "Liên kết thùng")}</button>
        </div>
        {boxQrs.length > 0 && <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>{boxQrs.map(qr => <span className="badge badge-success" key={qr}>{palletQr} ↔ {qr}</span>)}</div>}
        {bindings.length > 0 && <div style={{ marginTop: 12, padding: 10, background: "var(--nav)", borderRadius: 6, fontSize: 12 }}><strong>{tx("双向追溯", "Bidirectional Trace", "Truy xuất hai chiều")}</strong>{bindings.map(binding => <div key={binding.boxQr} style={{ marginTop: 5 }}>{binding.palletQr} → {binding.boxQr} <span style={{ color: "var(--muted)" }}> | {binding.boxQr} → {binding.palletQr}</span></div>)}</div>}
        <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><span style={{ fontSize: 12, fontWeight: 700 }}>{tx("供应商IQC标记", "Supplier IQC mark", "Đánh dấu IQC nhà cung cấp")}:</span>{(["PENDING", "PASS", "FAIL"] as const).map(v => <button key={v} type="button" className={supplierIqc === v ? "btn-primary" : "btn-ghost"} onClick={() => setSupplierIqc(v)}>{v === "PENDING" ? tx("未检验/隔离", "Not inspected / hold", "Chưa kiểm / giữ lại") : v}</button>)}</div>
      </section>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button className="btn-ghost" type="button" onClick={() => { setBoxQr(""); }}>{tx("取消当前箱码", "Cancel current box", "Hủy box hiện tại")}</button>
        <button className="btn-ghost" type="button" onClick={() => { setSupplier(""); setLot(""); setPalletQr(""); setLocationQr(""); setLocationCapacity(null); setBoxQr(""); setBoxQrs([]); setBindings([]); setSupplierIqc("PENDING"); setPdaStatus(tx("本次收料已取消", "Receiving cancelled", "Đã hủy nhận liệu")); }}>{tx("取消本次收料", "Cancel receiving", "Hủy nhận liệu")}</button>
      </div>
      <section className="surface-panel" style={{ marginTop: 12 }}>
        <div className="section-header"><div><h3>{tx("OA审批申请", "OA approval request", "Yêu cầu phê duyệt OA")}</h3><p>{tx("收料、QR绑定和IQC前入库需要先生成审批申请单。", "Create an approval request before receiving and QR binding.", "Tạo yêu cầu phê duyệt trước khi tiếp nhận và liên kết QR.")}</p></div></div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn-primary" type="button" disabled={oaBusy || !materialCode.trim() || !lot.trim() || !receivedQty.trim()} onClick={() => void submitMaterialReceivingOa()}>{oaBusy ? tx("提交中…", "Submitting…", "Đang gửi…") : tx("生成OA审批申请单并进入审批", "Create OA request and open approval", "Tạo yêu cầu OA và mở phê duyệt")}</button>
          {oaRequest && <span className="badge badge-warning">{oaRequest.id} · {tx("待审批", "Pending", "Chờ duyệt")}</span>}
        </div>
      </section>
      <section className="surface-panel" aria-label="Supplier quality certificate capture" style={{ marginTop: 12 }}>
        <div className="section-header"><div><h3>{tx("供应商质量证书", "Supplier quality certificates", "Chứng nhận chất lượng nhà cung cấp")}</h3><p>{tx("可多选图片，提交时随收料绑定上传。", "Select multiple images; they are uploaded with this receiving.", "Chọn nhiều ảnh; ảnh được tải cùng phiếu nhận hàng.")}</p></div></div>
        <input ref={certificateInput} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => void addCertificates(e.target.files)} />
        <button className="btn-ghost" type="button" onClick={() => certificateInput.current?.click()}>{tx("选择证书图片", "Select certificate images", "Chọn ảnh chứng nhận")}</button>
        {certificates.length > 0 && <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>{certificates.map(certificate => <div key={certificate.id} style={{ width: 160 }}><img src={certificate.dataUrl} alt={certificate.fileName} style={{ width: 160, height: 100, objectFit: "cover", borderRadius: 6 }} /><select className="form-input" value={certificate.category} onChange={e => setCertificates(xs => xs.map(x => x.id === certificate.id ? { ...x, category: e.target.value as Certificate["category"] } : x))}><option value="QUALITY_CERTIFICATE">Quality certificate</option><option value="INSPECTION_REPORT">Inspection report</option><option value="OTHER">Other</option></select><button type="button" className="btn-ghost" onClick={() => setCertificates(xs => xs.filter(x => x.id !== certificate.id))}>× {tx("移除", "Remove", "Xóa")}</button></div>)}</div>}
        {certificates.length > 0 && <button type="button" className="btn-ghost" style={{ marginTop: 8 }} onClick={() => setCertificates([])}>{tx("取消全部图片", "Cancel all images", "Hủy tất cả ảnh")}</button>}
      </section>
      <WmsPdaReceivingMobile locale={locale} />
      <MaterialRollQrGenerator locale={locale} variant="wms" prefill={receivingLabelPrefill} />
    </div>
  );
}
