import { useEffect, useMemo, useState } from "react";
import bwipjs from "bwip-js";
import * as XLSX from "xlsx";
import type { Locale } from "../i18n";
import { apiClient, type ListEnvelope } from "../api/client";

type Roll = { id:number; materialSn:string; materialCode:string; supplierName?:string; supplierCode?:string; msdLevel?:string; lotNo:string; originalQty:number; remainingQty:number; unit:string; qrPayload:Record<string,unknown>; lifecycleStatus:string; printCount:number; lastPrintedAt?:string; createdAt?:string };
type Event = { id:number; eventType:string; printerName?:string; operator:string; reason?:string; occurredAt:string };
type BatchRow = { row:number; materialSn:string; materialCode:string; internalCode:string; lotNo:string; dateCode:string; msdLevel:string; referenceSn:string; description:string; supplierName?:string; quantity:number; unit:string; locationCode:string; status:"READY"|"ERROR"|"CREATED"; error?:string; recordId?:number; dataMatrix?:string; topBarcode?:string; internalBarcode?:string; rawExcelRecord?:Record<string,unknown> };
type ImportBatch = { id:number; sourceFile:string; sourceSheet?:string; totalRows:number; importedRows:number; skippedRows:number; failedRows:number; status:string; importedBy:string; startedAt:string; completedAt?:string };
type ImportRow = { id:number; sourceRow:number; materialSn?:string; wmsRollLabelId?:number; result:string; errorMessage?:string; rawRecord:Record<string,unknown>; processedAt:string };
export type MaterialRollPrefill = Partial<{ materialSn:string; materialCode:string; internalCode:string; lotNo:string; dateCode:string; msdLevel:string; referenceSn:string; rollCount:number; description:string; supplierLot:string; supplierCode:string; quantity:number; unit:string; locationCode:string; manufacturingDate:string; expiryDate:string; plantCode:string }>;

const inputStyle = { minHeight: 44, padding: "0 12px", borderRadius: 8, border: "1px solid var(--border-default, #2c414f)", background: "var(--surface-2)", color: "inherit" };

export function MaterialRollQrGenerator({ locale, prefill }: { locale: Locale; prefill?: MaterialRollPrefill }) {
  const zh = locale === "zh-CN";
  const [form, setForm] = useState({ materialSn:"", materialCode:"", internalCode:"", lotNo:"", dateCode:"", msdLevel:"", referenceSn:"", rollCount:1, description:"", supplierName:"", supplierLot:"", supplierCode:"", quantity:0, unit:"PCS", locationCode:"", manufacturingDate:"", expiryDate:"", plantCode:"RUIJING_VN" });
  const [printerName, setPrinterName] = useState(localStorage.getItem("materialQrPrinter") || "SYSTEM_DEFAULT_PRINTER");
  const [printConfig, setPrintConfig] = useState({ widthMm:100, heightMm:80, copies:1, dpi:203, rotation:0 });
  const [record, setRecord] = useState<Roll|null>(null);
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [search, setSearch] = useState("");
  const [qr, setQr] = useState("");
  const [topBarcode, setTopBarcode] = useState("");
  const [internalBarcode, setInternalBarcode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [batchPrinting, setBatchPrinting] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(true);
  const [bomStatus, setBomStatus] = useState("");
  const [startRollNumber, setStartRollNumber] = useState(1);
  const [importBatches, setImportBatches] = useState<ImportBatch[]>([]);
  const [selectedImport, setSelectedImport] = useState<ImportBatch|null>(null);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [printConfirmed, setPrintConfirmed] = useState(false);
  const [selectedMaterialRow, setSelectedMaterialRow] = useState<number|null>(null);
  const payload = useMemo(() => [
    form.materialSn,
    form.lotNo,
    form.dateCode,
    String(form.quantity),
    form.msdLevel,
    form.referenceSn,
    form.internalCode
  ].join("/"), [form.materialSn,form.lotNo,form.dateCode,form.quantity,form.msdLevel,form.referenceSn,form.internalCode]);
  const preview = {
    vietnamCode: form.materialSn || "R0210-01019",
    lotNo: form.lotNo || "20260509",
    dateCode: form.dateCode || "20260509",
    quantity: form.quantity || 5000,
    msdLevel: form.msdLevel || "3",
    referenceSn: form.referenceSn || "RSN001",
    internalCode: form.internalCode || "0.01.00.01.4231A-HF",
    description: form.description || "33pF ±5% 500V NP0 0805 330J CC0805JRNPOBBN330 无卤 品牌：国巨"
  };
  useEffect(() => { if (prefill) { setForm(v => ({ ...v, ...prefill })); setRecord(null); setEvents([]); setMessage(""); } }, [prefill]);

  useEffect(() => { try { const c=document.createElement("canvas"); bwipjs.toCanvas(c,{bcid:"datamatrix",text:payload,scale:2,padding:2}); setQr(c.toDataURL("image/png")); } catch { setQr(""); } }, [payload]);
  useEffect(() => {
    const render = (text:string) => { try { const c=document.createElement("canvas"); bwipjs.toCanvas(c,{bcid:"code128",text,scale:2,height:10,includetext:false}); return c.toDataURL("image/png"); } catch { return ""; } };
    setTopBarcode(render(form.materialSn || "R0210-01019")); setInternalBarcode(render(form.internalCode || "0.01.00.01.4231A-HF"));
  }, [form.materialSn,form.internalCode]);
  const loadRolls = async () => { const data = await apiClient.get<ListEnvelope<Roll>>("/wms/material-roll-labels", { q:search }); setRolls((data.items || []).filter(r=>!Object.prototype.hasOwnProperty.call((r.qrPayload?.rawExcelRecord as Record<string,unknown>)||{},"入库扫码"))); };
  const loadImports = async () => { const data=await apiClient.get<ListEnvelope<ImportBatch>>("/mes/material-roll-imports");setImportBatches(data.items||[]); };
  const openImport = async (batch:ImportBatch) => { setSelectedImport(batch);const data=await apiClient.get<ListEnvelope<ImportRow>>(`/mes/material-roll-imports/${batch.id}/rows`);setImportRows(data.items||[]); };
  useEffect(() => { void loadRolls().catch(() => undefined);void loadImports().catch(() => undefined); }, []);
  const change = (key:string, value:string|number) => { setPrintConfirmed(false); setForm(v => ({...v,[key]:value})); setRecord(null); };
  const fillFromMaterialMaster = async (vietnamCode:string) => {
    const code=vietnamCode.trim();
    if(!code){setForm(v=>({...v,materialCode:"",internalCode:"",description:"",supplierName:"",msdLevel:""}));return;}
    setMessage(`正在查询 WMS：${code}…`);
    try{
      const data=await apiClient.get<ListEnvelope<{vietnamMaterialCode:string;ruijingMaterialCode:string;specification:string;supplierName?:string;msdLevel?:string}>>("/wms/material-label-master",{q:code});
      const matches=(data.items||[]).filter(x=>x.vietnamMaterialCode.trim().toUpperCase()===code.toUpperCase());
      if(matches.length!==1) throw new Error(matches.length?"越南料号存在多个主数据匹配，请联系 WMS 管理员":"越南料号不在 WMS Sheet1 主数据中");
      const master=matches[0];
      setForm(v=>({...v,materialSn:master.vietnamMaterialCode,materialCode:master.vietnamMaterialCode,internalCode:master.ruijingMaterialCode,description:master.specification,supplierName:master.supplierName||"",msdLevel:master.msdLevel||""}));
      setMessage(`WMS 已自动带出：${master.ruijingMaterialCode} · ${master.specification}`);
    }catch(e){
      setForm(v=>({...v,materialCode:"",internalCode:"",description:"",supplierName:"",msdLevel:""}));
      setMessage(e instanceof Error?e.message:"WMS material lookup failed");
    }
  };
  const fillFromRuijingMaterialMaster = async (ruijingCode:string) => {
    const code=ruijingCode.trim();
    if(!code){setForm(v=>({...v,materialSn:"",materialCode:"",description:"",supplierName:"",msdLevel:""}));return;}
    setMessage(`正在按深圳瑞晶料号查询 WMS：${code}…`);
    try{
      const data=await apiClient.get<ListEnvelope<{vietnamMaterialCode:string;ruijingMaterialCode:string;specification:string;supplierName?:string;msdLevel?:string}>>("/wms/material-label-master",{q:code});
      const matches=(data.items||[]).filter(x=>x.ruijingMaterialCode.trim().toUpperCase()===code.toUpperCase());
      if(matches.length!==1) throw new Error(matches.length?"深圳瑞晶料号存在多个主数据匹配，请联系 WMS 管理员":"深圳瑞晶料号不在 WMS Sheet1 主数据中");
      const master=matches[0];
      setForm(v=>({...v,materialSn:master.vietnamMaterialCode,materialCode:master.vietnamMaterialCode,internalCode:master.ruijingMaterialCode,description:master.specification,supplierName:master.supplierName||"",msdLevel:master.msdLevel||""}));
      setMessage(`WMS 已反向带出越南料号：${master.vietnamMaterialCode} · ${master.specification}`);
    }catch(e){
      setForm(v=>({...v,materialSn:"",materialCode:"",description:"",supplierName:"",msdLevel:""}));
      setMessage(e instanceof Error?e.message:"WMS material lookup failed");
    }
  };
  const requiredPrintFieldsReady = Boolean(form.materialSn.trim()&&form.materialCode.trim()&&form.internalCode.trim()&&form.lotNo.trim()&&form.dateCode.trim()&&form.description.trim()&&form.msdLevel.trim()&&Number(form.quantity)>0);
  const confirmPrintInformation = async () => { if(!requiredPrintFieldsReady){setPrintConfirmed(false);setMessage("请先填写：越南料号、深圳瑞晶料号、批次、日期、数量、规格和 MSD。");return;} try{const data=await apiClient.get<ListEnvelope<{vietnamMaterialCode:string;ruijingMaterialCode:string;specification:string;supplierName?:string;msdLevel?:string}>>("/wms/material-label-master",{q:form.materialSn});const master=(data.items||[]).find(x=>x.vietnamMaterialCode.toUpperCase()===form.materialSn.trim().toUpperCase());if(!master)throw new Error("越南料号不在 Sheet1 物料主数据中");if(master.ruijingMaterialCode.trim().toUpperCase()!==form.internalCode.trim().toUpperCase())throw new Error("深圳瑞晶料号与 Sheet1 不匹配");if(String(master.msdLevel||"").trim()!==form.msdLevel.trim())throw new Error("MSD 与 Sheet1 不匹配");setPrintConfirmed(true);setMessage(`MES Sheet1 校验通过：${master.vietnamMaterialCode}；打印时由 WMS 自动生成唯一 R/SN。`);}catch(e){setPrintConfirmed(false);setMessage(e instanceof Error?e.message:"Sheet1 validation failed");} };
  const resolveBomFields = async (codes:string[]) => apiClient.post<ListEnvelope<{inputCode:string;status:string;internalCode?:string;description?:string;unit?:string}>>("/wms/material-roll-labels/resolve-bom-fields", {payload:{codes}});
  const fillFromBom = async () => { setBomStatus(zh?"正在查询 BOM…":"Resolving BOM…"); try { const data=await resolveBomFields([form.materialCode]); const item=data.items?.[0]; if(item?.status!=="RESOLVED") throw new Error(item?.status==="CONFLICT"?"BOM mapping conflict":"Material not found in active BOM"); setForm(v=>({...v,internalCode:item.internalCode||"",description:item.description||"",unit:item.unit||v.unit})); setBomStatus(zh?"已由有效 BOM 自动带出":"Resolved from active BOM"); } catch(e){setBomStatus(e instanceof Error?e.message:"BOM lookup failed");} };
  const openRecord = async (roll:Roll) => { setRecord(roll); setForm(v => ({...v, ...roll.qrPayload, materialSn:roll.materialSn, materialCode:roll.materialCode, lotNo:roll.lotNo, quantity:Number(roll.originalQty), unit:roll.unit})); const data=await apiClient.get<ListEnvelope<Event>>(`/wms/material-roll-labels/${roll.id}/events`); setEvents(data.items||[]); };

  const printLabel = async (roll:Roll, isReprint:boolean) => {
    if (roll.lifecycleStatus !== "ACTIVE") throw new Error(zh ? "已退役料卷禁止打印" : "Retired rolls cannot be printed");
    localStorage.setItem("materialQrPrinter", printerName);
    await apiClient.post(`/wms/material-roll-labels/${roll.id}/print-events`, { payload:{ operator:"MES_USER", printerName, reason:`${isReprint ? "MES authorized reprint" : "Initial MES print"}; template=DataMatrix-material-VN-A1; ${printConfig.widthMm}x${printConfig.heightMm}mm; ${printConfig.dpi}dpi; copies=${printConfig.copies}; rotation=${printConfig.rotation}` } });
    setRecord(roll); setMessage(zh ? `打印任务已记录：${printerName}` : `Print job recorded: ${printerName}`);
    await loadRolls(); window.setTimeout(() => window.print(), 100);
  };
  const rsnSequence = (start:string,count:number) => { const match=start.trim().match(/^(.*?)(\d+)$/); const prefix=match?.[1]||"RSN"; const first=Number(match?.[2]||1); const width=match?.[2]?.length||3; return Array.from({length:Math.max(1,count)},(_,i)=>`${prefix}${String(first+i).padStart(width,"0")}`); };
  const issueAndPrint = async () => { setBusy(true); setMessage(""); try { const rsns=Array.from({length:form.rollCount},(_,i)=>`RSN${String(startRollNumber+i).padStart(3,"0")}`);const createdRows:BatchRow[]=[]; for(let i=0;i<rsns.length;i++){const referenceSn=rsns[i];const rollPayload={...form,materialSn:referenceSn,materialCode:form.materialSn,labelNo:form.materialSn,chinaMaterialCode:form.internalCode,vietnamMaterialCode:form.materialSn,referenceSn,rollCount:undefined,operator:"MES_USER"};const created=await apiClient.post<{item:Roll}>("/wms/material-roll-labels",{payload:rollPayload});await apiClient.post(`/wms/material-roll-labels/${created.item.id}/print-events`,{payload:{operator:"MES_USER",printerName,reason:`Multi-roll issue ${i+1}/${form.rollCount}; template=DataMatrix-material-VN-A1; ${printConfig.widthMm}x${printConfig.heightMm}mm; ${printConfig.dpi}dpi`}});const dm=[form.materialSn,form.lotNo,form.dateCode,String(form.quantity),form.msdLevel,referenceSn,form.internalCode].join("/");createdRows.push({row:i+1,materialSn:form.materialSn,materialCode:form.materialSn,internalCode:form.internalCode,lotNo:form.lotNo,dateCode:form.dateCode,msdLevel:form.msdLevel,referenceSn,description:form.description,quantity:form.quantity,unit:form.unit,locationCode:form.locationCode,status:"CREATED",recordId:created.item.id,dataMatrix:barcode("datamatrix",dm),topBarcode:barcode("code128",form.materialSn),internalBarcode:barcode("code128",form.internalCode)});} setBatchRows(createdRows);setForm(v=>({...v,referenceSn:createdRows[0]?.referenceSn||""}));setMessage(`${createdRows.length} roll labels created: ${rsns[0]} → ${rsns.at(-1)}`);await loadRolls();window.setTimeout(()=>window.print(),100); } catch(e){setMessage(e instanceof Error?e.message:"Issue failed");} finally{setBusy(false);} };
  const retire = async (roll:Roll) => { const reason=window.prompt(zh?"请输入退役原因（报废/用完/标签损坏）":"Retirement reason"); if(!reason)return; await apiClient.post(`/wms/material-roll-labels/${roll.id}/retire`,{payload:{reason,operator:"MES_USER"}}); setMessage(zh?"料卷已退役，PDA 将拒绝绑定":"Roll retired; PDA binding is now blocked"); setRecord(null); setEvents([]); await loadRolls(); };
  const barcode = (bcid:string,text:string) => { try { const c=document.createElement("canvas"); bwipjs.toCanvas(c,{bcid,text,scale:2,height:bcid==="code128"?10:undefined,padding:bcid==="datamatrix"?2:undefined,includetext:false}); return c.toDataURL("image/png"); } catch { return ""; } };
  const downloadTemplate = () => {
    const rows=[{materialSn:"R0210-01019",materialCode:"CC0805JRNPOBBN330",internalCode:"0.01.00.01.4231A-HF",lotNo:"20260509",dateCode:"20260509",quantity:5000,unit:"PCS",msdLevel:"3",referenceSn:"RSN001",description:"33pF ±5% 500V NP0 0805 330J CC0805JRNPOBBN330 无卤 品牌：国巨",locationCode:"SMT-RACK-A01"}];
    const ws=XLSX.utils.json_to_sheet(rows); ws["!cols"]=[18,24,24,14,14,12,10,14,60,18].map(w=>({wch:w})); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"MaterialRollLabels"); XLSX.writeFile(wb,"Ruijing_Material_Roll_Batch_Template.xlsx");
  };
  const importExcel = async (file:File) => {
    const wb=XLSX.read(await file.arrayBuffer(),{type:"array",cellDates:true});
    const masterSheet=wb.Sheets["Sheet1"];
    const masterMatrix=masterSheet?XLSX.utils.sheet_to_json<unknown[]>(masterSheet,{header:1,defval:""}):[];
    const masterHeaderIndex=masterMatrix.findIndex(row=>row.some(v=>["越南东泰料号","品号"].includes(String(v).trim())));
    const masterHeaders=masterHeaderIndex>=0?masterMatrix[masterHeaderIndex].map(v=>String(v).trim()):[];
    const masterRows=masterHeaderIndex>=0?masterMatrix.slice(masterHeaderIndex+1).map(row=>Object.fromEntries(masterHeaders.map((h,i)=>[h,row[i]??""]))):[];
    const masterByVietnamCode=new Map(masterRows.map(r=>[String(r["越南东泰料号"]||r["品号"]||"").trim().toUpperCase(),{internalCode:String(r["深圳瑞晶料号"]||"").trim(),description:String(r["规格"]||"").trim(),msdLevel:String(r["MSD"]||"").trim()}]).filter(([k])=>k));
    const sheetName="Sheet1"; const sheet=wb.Sheets[sheetName]; if(!sheet){setBatchRows([]);setMessage("Sheet1 not found; hidden/secondary sheets are not used");return;} const matrix=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:""});
    const headerIndex=matrix.findIndex(row=>row.some(v=>["越南东泰料号","深圳瑞晶料号","规格"].includes(String(v).trim()))); if(headerIndex<0){setBatchRows([]);setMessage("Sheet1 material-master header not recognized");return;}
    const headers=matrix[headerIndex].map(v=>String(v).trim()); const raw=matrix.slice(headerIndex+1).filter(row=>row.some(v=>String(v).trim()!=="")).map(row=>Object.fromEntries(headers.map((h,i)=>[h,row[i]??""]))); const seen=new Set<string>();
    const preliminary=raw.map((r,i)=>{ const get=(...keys:string[])=>String(keys.map(k=>r[k]).find(v=>v!==undefined&&v!=="")||"").trim(); const code=get("越南东泰料号"); const internalCode=get("深圳瑞晶料号"); const description=get("规格"); const supplierName=get("供应商"); const msdLevel=get("MSD"); const errors:string[]=[]; if(!code)errors.push("越南东泰料号 required"); if(!internalCode)errors.push("深圳瑞晶料号 required"); if(!description)errors.push("规格 required"); return {row:headerIndex+i+2,materialSn:"",materialCode:code,internalCode,lotNo:"",dateCode:"",msdLevel,referenceSn:"",description,quantity:0,unit:"PCS",locationCode:"",supplierCode:"",supplierName,errors}; });
    let resolved:{inputCode:string;status:string;internalCode?:string;description?:string;unit?:string}[]=[]; try{resolved=(await resolveBomFields([...new Set(preliminary.map(r=>r.materialCode).filter(Boolean))])).items||[];}catch{ /* every row will show lookup failure */ }
    const rows=preliminary.map((base,index)=>{const master=masterByVietnamCode.get(base.materialCode.toUpperCase());const merged={...base,internalCode:base.internalCode||master?.internalCode||"",description:base.description||master?.description||"",msdLevel:base.msdLevel||master?.msdLevel||"",rawExcelRecord:raw[index]};return {...merged,status:(base.errors.length?"ERROR":"READY") as BatchRow["status"],error:base.errors.join("; ")};}); setBatchRows(rows); await apiClient.post("/wms/material-label-master/import-sheet1",{payload:{sourceFile:file.name,sourceSheet:"Sheet1",rows:rows.map(r=>({vietnamMaterialCode:r.materialCode,ruijingMaterialCode:r.internalCode,specification:r.description,supplierName:(r as BatchRow&{supplierName?:string}).supplierName||"",msdLevel:r.msdLevel}))}}); setMessage(`Sheet1: ${rows.length} rows displayed and synchronized to WMS material master`);
  };
  useEffect(()=>{ fetch("/material_label_master.xlsx").then(r=>r.blob()).then(blob=>importExcel(new File([blob],"物料标签基础信息(1).xlsx"))).catch(()=>setMessage("Sheet1 automatic import failed")); },[]);
  useEffect(()=>{
    const vietnamCode=form.materialSn.trim().toUpperCase();
    if(!vietnamCode||!batchRows.length)return;
    const excelRow=batchRows.find(r=>r.materialCode.trim().toUpperCase()===vietnamCode);
    if(!excelRow)return;
    setForm(current=>({
      ...current,
      materialCode:current.materialCode||excelRow.materialCode,
      internalCode:current.internalCode||excelRow.internalCode,
      description:current.description||excelRow.description,
      supplierName:current.supplierName||excelRow.supplierName||"",
      msdLevel:current.msdLevel||excelRow.msdLevel
    }));
  },[form.materialSn,batchRows]);
  const batchSaveAndPrint = async () => { const ready=batchRows.filter(r=>r.status==="READY"); if(!ready.length)return; setBatchPrinting(true); const next=[...batchRows]; for(const row of ready){ try{const created=await apiClient.post<{item:Roll}>("/wms/material-roll-labels",{payload:{...row,plantCode:"RUIJING_VN",operator:"MES_BATCH_IMPORT"}}); await apiClient.post(`/wms/material-roll-labels/${created.item.id}/print-events`,{payload:{operator:"MES_BATCH_IMPORT",printerName,reason:`Batch print; template=DataMatrix-material-VN-A1; ${printConfig.widthMm}x${printConfig.heightMm}mm; ${printConfig.dpi}dpi; copies=${printConfig.copies}`}}); const idx=next.findIndex(x=>x.row===row.row); next[idx]={...next[idx],status:"CREATED",recordId:created.item.id}; }catch(e){const idx=next.findIndex(x=>x.row===row.row);next[idx]={...next[idx],status:"ERROR",error:e instanceof Error?e.message:"Failed"};} setBatchRows([...next]); } setBatchPrinting(false); await loadRolls(); if(next.some(r=>r.status==="CREATED"))window.setTimeout(()=>window.print(),100); };
  const selectOneForPrint = (row:BatchRow) => { setSelectedMaterialRow(row.row); setRecord(null); setEvents([]); setPrintConfirmed(false); setForm(v=>({...v,materialSn:row.materialCode,materialCode:row.materialCode,internalCode:row.internalCode,description:row.description,msdLevel:row.msdLevel,supplierName:row.supplierName||"",lotNo:"",dateCode:"",referenceSn:"",quantity:0,rollCount:1,supplierCode:"",locationCode:""})); setPreviewVisible(true); setMessage(`当前打印项：${row.materialCode}。Sheet1 可用资料已自动填写；等待操作员扫描 R.S/N，并填写批次、日期、数量和库位。`); window.scrollTo({top:0,behavior:"smooth"}); };

  const fields:[string,string,string][] = [["materialSn","越南料号","Vietnam material number"],["internalCode","深圳瑞晶料号","Shenzhen Ruijing material code"],["supplierName","供应商","Supplier"],["lotNo","Lot No.","Lot No."],["dateCode","D/C","D/C"],["msdLevel","MSD Level","MSD Level"],["description","规格描述","Description"],["supplierLot","供应商批次","Supplier lot"],["locationCode","库位","Location"]];
  return <section className="surface-panel" style={{padding:24}}>
    <style>{`@page{size:${printConfig.widthMm}mm ${printConfig.heightMm}mm;margin:0}@media print{html,body{margin:0!important;padding:0!important;background:#fff!important}body *{visibility:hidden!important}.material-roll-print,.material-roll-print *,.batch-print-sheet,.batch-print-sheet *{visibility:visible!important}.material-roll-print,.batch-print-sheet{background:#fff!important;color:#000!important;padding:4mm!important;width:${printConfig.widthMm}mm!important;height:${printConfig.heightMm}mm!important;box-sizing:border-box!important;border-radius:0!important;page-break-after:always!important;break-after:page!important}.batch-print-stack{position:absolute!important;left:0!important;top:0!important}.no-print{display:none!important}}`}</style>
    <div className="no-print" style={{display:"flex",justifyContent:"space-between",gap:16,marginBottom:18}}><div><div style={{color:"var(--muted)",fontSize:12,fontWeight:800}}>WMS MASTER · MES ISSUE · PDA VALIDATION</div><h2 style={{margin:"6px 0"}}>{zh?"瑞晶料卷二维码与打印管理":"Material Roll QR & Print Management"}</h2><p style={{margin:0,color:"var(--muted)"}}>{zh?"一个料卷 SN 一个有效身份；原始数量不可覆盖；重打与退役全程审计。":"One identity per roll; immutable original quantity; audited reprint and retirement."}</p></div><div style={{textAlign:"right"}}><span className="badge badge-info">正式模板：DataMatrix-material · 越南 A1</span><div style={{fontSize:11,color:"var(--muted)",marginTop:5}}>BarTender 10.1 SR3 · 原始 BTW 已锁定</div><div style={{fontSize:11,color:"#f5b942",marginTop:3}}>网页标签仅供数据预览，正式版式以 BTW 为准</div></div></div>
    <div className="no-print" style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:10,padding:12,marginBottom:18,border:"2px solid var(--state-active,#18c6d9)",borderRadius:12,background:"var(--surface-panel,#101d27)",boxShadow:"0 6px 18px rgba(0,0,0,.24)"}}>
      <strong style={{marginRight:"auto"}}>{zh?"标签打印":"LABEL PRINT"}</strong><button className="action-button" onClick={()=>document.getElementById("wms-roll-ledger")?.scrollIntoView({behavior:"smooth",block:"start"})}>查看 WMS 料卷台账 / View ledger</button>
      <button className="action-button" onClick={()=>setPreviewVisible(v=>!v)}>{previewVisible?(zh?"隐藏预览":"Hide preview"):(zh?"显示预览":"Show preview")}</button>
      <button className="action-button" disabled={!qr} onClick={()=>window.print()}>{zh?"仅打印预览":"Print preview only"}</button>
      <button className="action-button" disabled={!requiredPrintFieldsReady||busy} onClick={confirmPrintInformation}>{printConfirmed?"✓ 已确认":"确认打印信息"}</button>
      <button className="action-button action-button-primary" disabled={busy||!!record||!printConfirmed} onClick={()=>void issueAndPrint()}>{busy?(zh?"处理中…":"Processing…"):(zh?"确认后打印正式标签":"Print confirmed label")}</button>
      {record&&<button className="action-button" disabled={busy||record.lifecycleStatus!=="ACTIVE"} onClick={()=>void printLabel(record,true).catch(e=>setMessage(e.message))}>{zh?"授权重打":"Authorized reprint"}</button>}
    </div>
    <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr)",gap:20}}>
      <div className="no-print" style={{display:"grid",gap:14}}>
        <h3 style={{margin:0}}>{zh?"1. 发码资料":"1. Label issuance"}</h3>
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(180px,1fr))",gap:12}}>{fields.map(([key,z,e])=><label key={key} style={{display:"grid",gap:6,fontWeight:700}}>{zh?z:e}{key==="materialSn"&&<small style={{color:"var(--state-active,#18c6d9)"}}>输入越南料号并按 Enter，自动带出深圳料号和标签资料</small>}{key==="internalCode"&&<small style={{color:"var(--state-active,#18c6d9)"}}>输入深圳瑞晶料号并按 Enter，反向带出越南料号和标签资料</small>}{key==="description"&&<small style={{color:"var(--state-active,#18c6d9)"}}>SHEET1 PREFILL · 可修改</small>}<input type={key.includes("Date")?"date":"text"} value={String((form as Record<string,unknown>)[key]||"")} disabled={!!record} onChange={x=>change(key,x.target.value)} onKeyDown={(key==="materialSn"||key==="internalCode")?x=>{if(x.key==="Enter"){x.preventDefault();x.stopPropagation();}}:undefined} onKeyUp={key==="materialSn"?x=>{if(x.key==="Enter"){x.preventDefault();x.stopPropagation();void fillFromMaterialMaster(x.currentTarget.value);}}:key==="internalCode"?x=>{if(x.key==="Enter"){x.preventDefault();x.stopPropagation();void fillFromRuijingMaterialMaster(x.currentTarget.value);}}:undefined} style={inputStyle}/></label>)}</div>
        <div style={{display:"flex",alignItems:"center",gap:10}}><button className="action-button" disabled={!form.materialCode||!!record} onClick={()=>void fillFromBom()}>{zh?"从 BOM 自动带出物料资料":"Fill fields from BOM"}</button>{bomStatus&&<span className="badge badge-info">{bomStatus}</span>}</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12}}><label style={{display:"grid",gap:6,fontWeight:700}}>{zh?"每卷数量":"Quantity per roll"}<input type="number" min={1} value={form.quantity} disabled={!!record} onChange={e=>change("quantity",Math.max(1,Number(e.target.value)||1))} style={inputStyle}/></label><label style={{display:"grid",gap:6,fontWeight:700}}>{zh?"起始卷号":"Start roll number"}<input type="number" min={1} value={startRollNumber} disabled={!!record} onChange={e=>setStartRollNumber(Math.max(1,Number(e.target.value)||1))} style={inputStyle}/></label><label style={{display:"grid",gap:6,fontWeight:700}}>{zh?"打印料卷数":"Number of rolls"}<input type="number" min={1} max={500} value={form.rollCount} disabled={!!record} onChange={e=>change("rollCount",Math.min(500,Math.max(1,Number(e.target.value)||1)))} style={inputStyle}/></label><label style={{display:"grid",gap:6,fontWeight:700}}>{zh?"单位":"Unit"}<input value={form.unit} disabled={!!record} onChange={e=>change("unit",e.target.value)} style={inputStyle}/></label><label style={{display:"grid",gap:6,fontWeight:700}}>{zh?"标签打印机":"Label printer"}<input value={printerName} onChange={e=>setPrinterName(e.target.value)} style={inputStyle}/></label></div>
        <div className="badge badge-info" style={{justifyContent:"flex-start"}}>{zh?`将生成 ${form.rollCount} 卷：RSN${String(startRollNumber).padStart(3,"0")} → RSN${String(startRollNumber+form.rollCount-1).padStart(3,"0")}；总数量 ${form.quantity*form.rollCount} ${form.unit}`:`Will create ${form.rollCount} rolls: RSN${String(startRollNumber).padStart(3,"0")} → RSN${String(startRollNumber+form.rollCount-1).padStart(3,"0")}; total ${form.quantity*form.rollCount} ${form.unit}`}</div>
        <div style={{padding:12,border:"1px solid var(--border-default,#2c414f)",borderRadius:10}}><strong>{zh?"打印配置（越南 A1）":"Print setup (Vietnam A1)"}</strong><div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginTop:8}}>{[["widthMm","宽 mm","Width mm"],["heightMm","高 mm","Height mm"],["dpi","DPI","DPI"],["copies","份数","Copies"],["rotation","旋转°","Rotation°"]].map(([k,z,e])=><label key={k} style={{display:"grid",gap:4,fontSize:12}}>{zh?z:e}<input type="number" value={printConfig[k as keyof typeof printConfig]} min={k==="copies"?1:0} onChange={x=>setPrintConfig(v=>({...v,[k]:Number(x.target.value)||0}))} style={inputStyle}/></label>)}</div><div style={{fontSize:12,color:"var(--muted)",marginTop:7}}>{zh?"建议：100×80 mm、203 DPI、纵向、打印对话框缩放设为 100%/实际大小。":"Recommended: 100×80 mm, 203 DPI, portrait, scale 100% / actual size."}</div></div>
        {message&&<div className="badge badge-info" style={{justifyContent:"flex-start"}}>{message}</div>}
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}><button className="action-button" disabled={!requiredPrintFieldsReady||busy} onClick={confirmPrintInformation}>{printConfirmed?"✓ 信息已确认":"确认打印信息"}</button><button className="action-button action-button-primary" disabled={busy||!!record||!printConfirmed} onClick={()=>void issueAndPrint()}>{busy?(zh?"处理中…":"Processing…"):(zh?"打印本料卷":"Print this roll")}</button>{record&&<button className="action-button" disabled={busy||record.lifecycleStatus!=="ACTIVE"} onClick={()=>void printLabel(record,true).catch(e=>setMessage(e.message))}>{zh?"授权重打":"Authorized reprint"}</button>}<button className="action-button" onClick={()=>{setRecord(null);setEvents([]);setPrintConfirmed(false);setMessage("");}}>{zh?"新建料卷":"New roll"}</button></div>
      </div>
      {previewVisible&&<div className="material-roll-print" style={{position:"relative",containerType:"inline-size",order:-1,width:"min(100%, 694px)",aspectRatio:"694 / 559",boxSizing:"border-box",margin:"0 auto 8px",background:"#fff",color:"#000",border:"1.5px solid #111",borderRadius:"7% / 9%",overflow:"hidden",textAlign:"left",fontFamily:"Arial,\"Microsoft YaHei\",sans-serif",boxShadow:"0 10px 30px rgba(0,0,0,.24)"}}>
        {topBarcode&&<img src={topBarcode} alt="Vietnam material barcode" style={{position:"absolute",left:"5.9%",top:"8.6%",width:"68.5%",height:"11.7%",objectFit:"fill"}}/>}
        <div style={{position:"absolute",left:"5.9%",top:"22.4%",fontSize:"4.05cqw",lineHeight:1}}>{preview.vietnamCode}</div>
        <div style={{position:"absolute",left:"5.9%",top:"29.6%",display:"grid",gridTemplateColumns:"36% 64%",columnGap:0,rowGap:"3.1%",width:"53%",fontSize:"3.03cqw",lineHeight:1.55}}>
          <span>Lot No.</span><span>{preview.lotNo}</span><span>D/C:</span><span>{preview.dateCode}</span><span>QTY:</span><span>{preview.quantity}</span><span>MSD Level:</span><span>{preview.msdLevel}</span><span style={{paddingLeft:6}}>R.S/N:</span><span>{preview.referenceSn}</span>
        </div>
        {qr&&<img src={qr} alt="DataMatrix material payload" style={{position:"absolute",right:"7%",top:"29.5%",width:"15.2%",aspectRatio:"1",objectFit:"contain",imageRendering:"pixelated"}}/>}
        {internalBarcode&&<img src={internalBarcode} alt="Shenzhen Ruijing material barcode" style={{position:"absolute",left:"5.9%",top:"65.5%",width:"55%",height:"9.7%",objectFit:"fill"}}/>}
        <div style={{position:"absolute",left:"5.9%",top:"77.1%",fontSize:"2.6cqw",lineHeight:1}}>{preview.internalCode}</div>
        <div style={{position:"absolute",left:"4.3%",right:"2%",bottom:"8.2%",fontFamily:"Arial Narrow,Arial,\"Microsoft YaHei\",sans-serif",fontStretch:"condensed",fontSize:"2.85cqw",lineHeight:1,whiteSpace:"nowrap",overflow:"hidden"}}>{preview.description}</div>
      </div>}
    </div>
    <div className="no-print" style={{marginTop:24,padding:16,border:"1px solid var(--border-default,#2c414f)",borderRadius:12}}><div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center"}}><div><h3 style={{margin:"0 0 4px"}}>{zh?"2. Excel 批量发码与打印":"2. Excel batch issue & print"}</h3><span style={{color:"var(--muted)"}}>{zh?"导入后先校验；只有 READY 行才写入 WMS 并进入打印队列。":"Validate first; only READY rows enter WMS and print queue."}</span></div><div style={{display:"flex",gap:8}}><button className="action-button" onClick={downloadTemplate}>{zh?"下载 Excel 模板":"Download template"}</button><label className="action-button" style={{cursor:"pointer"}}>{zh?"导入 Excel":"Import Excel"}<input type="file" accept=".xlsx,.xls,.csv" hidden onChange={e=>{const f=e.target.files?.[0];if(f)void importExcel(f);e.currentTarget.value="";}}/></label><button className="action-button action-button-primary" disabled={batchPrinting||!batchRows.some(r=>r.status==="READY")} onClick={()=>void batchSaveAndPrint()}>{batchPrinting?(zh?"写入与排队中…":"Queuing…"):(zh?`批量保存并打印 (${batchRows.filter(r=>r.status==="READY").length})`:`Save & print (${batchRows.filter(r=>r.status==="READY").length})`)}</button></div></div>
      {batchRows.length>0&&<div style={{overflowX:"auto",marginTop:12,maxHeight:480}}><table style={{width:"100%",borderCollapse:"collapse"}}><thead style={{position:"sticky",top:0,background:"var(--surface-panel,#101d27)"}}><tr>{["序号","越南东泰料号","深圳瑞晶料号","规格","供应商","MSD","瑞晶 SN","操作"].map(x=><th key={x} style={{textAlign:"left",padding:8,borderBottom:"1px solid var(--border-default,#2c414f)"}}>{x}</th>)}</tr></thead><tbody>{batchRows.map((r,index)=>{const selected=selectedMaterialRow===r.row;return <tr key={r.row} style={{background:selected?"rgba(24,198,217,.2)":undefined,outline:selected?"2px solid var(--state-active,#18c6d9)":undefined}}><td style={{padding:8}}>{index+1}</td><td><strong>{r.materialCode}</strong>{selected&&<span className="badge badge-info" style={{marginLeft:8}}>当前打印项</span>}</td><td style={{fontFamily:"Consolas"}}>{r.internalCode}</td><td style={{minWidth:360}}>{r.description}</td><td>{String((r as BatchRow&{supplierName?:string}).supplierName||"")}</td><td>{r.msdLevel}</td><td>{r.materialSn||"待生成"}</td><td><button className={`action-button ${selected?"action-button-primary":""}`} onClick={()=>selectOneForPrint(r)}>{selected?"正在处理":"单项打印"}</button></td></tr>})}</tbody></table></div>}
    </div>
    {batchRows.some(r=>r.status==="CREATED")&&<div className="batch-print-stack">{batchRows.filter(r=>r.status==="CREATED").flatMap(r=>Array.from({length:Math.max(1,printConfig.copies)},(_,copy)=><div className="batch-print-sheet" key={`${r.row}-${copy}`} style={{fontFamily:"Arial,sans-serif"}}>{r.topBarcode&&<img src={r.topBarcode} style={{width:"74%",height:48,objectFit:"fill"}}/>}<div style={{fontSize:20}}>{r.materialSn}</div><div style={{display:"grid",gridTemplateColumns:"1fr 110px",gap:12}}><div style={{display:"grid",gridTemplateColumns:"125px 1fr",fontSize:16,rowGap:8}}><span>Lot No.</span><strong>{r.lotNo}</strong><span>D/C:</span><strong>{r.dateCode}</strong><span>QTY:</span><strong>{r.quantity}</strong><span>MSD Level:</span><strong>{r.msdLevel}</strong><span>R.S/N:</span><strong>{r.referenceSn}</strong></div>{r.dataMatrix&&<img src={r.dataMatrix} style={{width:104,height:104}}/>}</div>{r.internalBarcode&&<img src={r.internalBarcode} style={{width:"62%",height:46,objectFit:"fill",marginTop:12}}/>}<div>{r.internalCode}</div><div style={{fontSize:15,marginTop:14}}>{r.description}</div></div>))}</div>}
    <div className="no-print" style={{marginTop:24,padding:16,border:"1px solid var(--border-default,#2c414f)",borderRadius:12}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}><div><h3 style={{margin:"0 0 4px"}}>3. MES formal Excel import records</h3><span style={{color:"var(--muted)"}}>Permanent batch and row traceability</span></div><button className="action-button" onClick={()=>void loadImports()}>Refresh</button></div><div style={{overflowX:"auto",marginTop:12}}><table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr>{["Batch","File","Operator","Total","Imported","Skipped","Failed","Status"].map(x=><th key={x} style={{textAlign:"left",padding:8,borderBottom:"1px solid var(--border-default,#2c414f)"}}>{x}</th>)}</tr></thead><tbody>{importBatches.map(b=><tr key={b.id}><td style={{padding:8}}><button className="action-button" onClick={()=>void openImport(b)}>#{b.id}</button></td><td>{b.sourceFile}</td><td><strong>{b.importedBy}</strong></td><td>{b.totalRows}</td><td style={{color:"#36d399"}}>{b.importedRows}</td><td>{b.skippedRows}</td><td style={{color:b.failedRows?"#ff6b6b":undefined}}>{b.failedRows}</td><td>{b.status}</td></tr>)}</tbody></table></div>{selectedImport&&<div style={{marginTop:14}}><strong>Batch #{selectedImport.id} row results</strong><div style={{overflowX:"auto",maxHeight:360,marginTop:8}}><table style={{width:"100%",borderCollapse:"collapse"}}><thead style={{position:"sticky",top:0,background:"var(--surface-panel,#101d27)"}}><tr>{["Excel row","Result","Roll SN","WMS ID","Error"].map(x=><th key={x} style={{textAlign:"left",padding:8,borderBottom:"1px solid var(--border-default,#2c414f)"}}>{x}</th>)}</tr></thead><tbody>{importRows.map(r=><tr key={r.id}><td style={{padding:8}}>{r.sourceRow}</td><td><span className={`badge ${r.result==="IMPORTED"?"badge-success":r.result==="FAILED"?"badge-danger":"badge-info"}`}>{r.result}</span></td><td style={{fontFamily:"Consolas"}}>{r.materialSn||"-"}</td><td>{r.wmsRollLabelId||"-"}</td><td style={{color:r.errorMessage?"#ff7b7b":undefined}}>{r.errorMessage||"-"}</td></tr>)}</tbody></table></div></div>}</div>
    <div id="wms-roll-ledger" className="no-print" style={{marginTop:24,scrollMarginTop:90,padding:16,border:"2px solid var(--state-active,#18c6d9)",borderRadius:12}}><div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"end"}}><div><h3 style={{margin:"0 0 4px"}}>4. WMS 料卷台账 / WMS Roll Ledger</h3><span style={{color:"var(--muted)"}}>{zh?"查询、重打、退役和完整事件历史":"Search, reprint, retire and audit history"}</span></div><div style={{display:"flex",gap:8}}><input value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")void loadRolls();}} placeholder={zh?"SN / 物料 / 批次":"SN / material / lot"} style={inputStyle}/><button className="action-button" onClick={()=>void loadRolls()}>{zh?"查询":"Search"}</button></div></div>
      <div style={{overflowX:"auto",marginTop:12}}><table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr>{[zh?"料卷SN":"Roll SN",zh?"越南料号":"Vietnam material",zh?"供应商":"Supplier","MSD",zh?"批次":"Lot",zh?"生成日期":"Generated",zh?"来料数量":"Received",zh?"已领用":"Issued",zh?"剩余数量":"Remaining",zh?"状态":"Status",zh?"打印":"Prints",zh?"操作":"Actions"].map(x=><th key={x} style={{textAlign:"left",padding:10,borderBottom:"1px solid var(--border-default,#2c414f)"}}>{x}</th>)}</tr></thead><tbody>{rolls.map(r=><tr key={r.id}><td style={{padding:10,fontFamily:"Consolas"}}><button className="action-button" onClick={()=>void openRecord(r)}>{r.materialSn}</button></td><td>{r.materialCode}</td><td>{String(r.supplierName||r.qrPayload?.supplierName||"-")}</td><td>{String(r.msdLevel||r.qrPayload?.msdLevel||"-")}</td><td>{r.lotNo}</td><td>{r.createdAt?new Date(r.createdAt).toLocaleString():String(r.qrPayload?.issuedAt||"-")}</td><td>{r.originalQty} {r.unit}</td><td>{Number(r.originalQty)-Number(r.remainingQty)} {r.unit}</td><td><strong>{r.remainingQty} {r.unit}</strong></td><td><span className={`badge ${r.lifecycleStatus==="ACTIVE"?"badge-success":"badge-danger"}`}>{r.lifecycleStatus}</span></td><td>{r.printCount||0}</td><td style={{display:"flex",gap:6,padding:8}}><button className="action-button" disabled={r.lifecycleStatus!=="ACTIVE"} onClick={()=>void openRecord(r).then(()=>printLabel(r,true)).catch(e=>setMessage(e.message))}>{zh?"重打":"Reprint"}</button><button className="action-button" disabled={r.lifecycleStatus!=="ACTIVE"} onClick={()=>void retire(r)}>{zh?"退役":"Retire"}</button></td></tr>)}</tbody></table></div>
      {record&&<div style={{marginTop:16,padding:14,background:"var(--surface-2)",borderRadius:10}}><strong>{record.materialSn} · {zh?"不可修改的事件历史":"Immutable event history"}</strong><div style={{display:"grid",gap:6,marginTop:8}}>{events.map(e=><div key={e.id} style={{display:"grid",gridTemplateColumns:"150px 110px 1fr 160px",gap:8}}><span>{new Date(e.occurredAt).toLocaleString()}</span><strong>{e.eventType}</strong><span>{e.reason||"-"}</span><span>{e.printerName||e.operator}</span></div>)}</div></div>}
    </div>
  </section>;
}




