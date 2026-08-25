import { useState, useEffect, useCallback } from "react";
import {
  Package, FileText, Image, Video, ShieldCheck, Plus, X,
  Upload, Eye, Download, Clock, AlertTriangle, CheckCircle
} from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api/wms";

interface IncomingRecord {
  id: number; lot_no: string; material_code: string; material_name: string;
  supplier_code: string; supplier_name: string; po_no: string;
  delivery_note_no: string; invoice_no: string; received_qty: number;
  uom_code: string; received_at: string; packaging_status: string;
  msd_level: string; expiry_date: string; operator_id: string;
  iqc_status: string; attachments: {type:string;url:string;name:string;uploaded_at:string}[]; created_at: string;
}

const ATTACH_TYPES = [
  { key: "document", label_zh: "电子单据", label_vi: "Tai lieu", label_en: "Document", icon: FileText },
  { key: "photo", label_zh: "图片", label_vi: "Hinh anh", label_en: "Photo", icon: Image },
  { key: "video", label_zh: "视频", label_vi: "Video", label_en: "Video", icon: Video },
  { key: "certificate", label_zh: "证书", label_vi: "Chung chi", label_en: "Certificate", icon: ShieldCheck },
  { key: "inspection_report", label_zh: "检验单", label_vi: "Bao cao", label_en: "Report", icon: FileText },
];

function localeLabel(item: any, locale: Locale): string {
  if (locale === "vi-VN") return item.label_vi;
  if (locale === "en-US") return item.label_en;
  return item.label_zh;
}

export function WmsIncoming({ locale }: { locale: Locale }) {
  const [records, setRecords] = useState<IncomingRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const LIMIT = 20;
  const [search, setSearch] = useState("");
  const [iqcFilter, setIqcFilter] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showDetail, setShowDetail] = useState<IncomingRecord|null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    lot_no:"", material_code:"", material_name:"", supplier_code:"", supplier_name:"",
    po_no:"", delivery_note_no:"", invoice_no:"", received_qty:"", uom_code:"PCS",
    received_at: new Date().toISOString().slice(0,16), packaging_status:"good",
    msd_level:"", expiry_date:"", operator_id:"",
  });
  const [attachments, setAttachments] = useState<{type:string;name:string;url:string}[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await wmsApi.getIncomingRecords({ limit:LIMIT, offset:page*LIMIT, lot_no:search||undefined, iqc_status:iqcFilter||undefined });
      setRecords(res.items||[]);
      setTotal(res.total||0);
    } catch { setRecords([]); }
    setLoading(false);
  }, [page, search, iqcFilter]);

  useEffect(() => { load(); }, [load]);

  const submitNew = async () => {
    setSaving(true);
    try {
      await wmsApi.createIncomingRecord({ ...form, received_qty: parseFloat(form.received_qty)||0, attachments: JSON.stringify(attachments) });
      setShowNew(false);
      setForm({ lot_no:"", material_code:"", material_name:"", supplier_code:"", supplier_name:"", po_no:"", delivery_note_no:"", invoice_no:"", received_qty:"", uom_code:"PCS", received_at: new Date().toISOString().slice(0,16), packaging_status:"good", msd_level:"", expiry_date:"", operator_id:"" });
      setAttachments([]);
      load();
    } catch(e) { console.error(e); }
    setSaving(false);
  };

  const simulateUpload = (type: string, name: string) => {
    const id = Date.now();
    setAttachments(prev => [...prev, { type, name, url: `https://oss.ruijing.vn/incoming/${id}/${name}` }]);
  };

  const pkgBadge = (pkg: string) => {
    const m: Record<string,{bg:string;text:string;label:string}> = {
      good:{bg:"#d1fae5",text:"#065f46",label:locale==="vi-VN"?"Tot":"完好"},
      minor_damage:{bg:"#fef3c7",text:"#92400e",label:locale==="vi-VN"?"Hao":"轻微破损"},
      severe_damage:{bg:"#fee2e2",text:"#991b1b",label:locale==="vi-VN"?"Nang":"严重破损"},
    };
    const s = m[pkg]||m.good;
    return <span style={{background:s.bg,color:s.text,padding:"2px 8px",borderRadius:4,fontSize:12}}>{s.label}</span>;
  };

  const iqcBadge = (status: string) => {
    const m: Record<string,{bg:string;text:string;label:string}> = {
      pending:{bg:"#f3f4f6",text:"#374151",label:locale==="vi-VN"?"Cho":"待检"},
      exempt:{bg:"#d1fae5",text:"#065f46",label:locale==="vi-VN"?"Mien":"免检"},
      submitted:{bg:"#dbeafe",text:"#1e40af",label:locale==="vi-VN"?"Da":"已送检"},
    };
    const s = m[status]||m.pending;
    return <span style={{background:s.bg,color:s.text,padding:"2px 8px",borderRadius:4,fontSize:12}}>{s.label}</span>;
  };

  const msdBadge = (level: string) => {
    if (!level) return null;
    const colors: Record<string,string> = {"2":"#3b82f6","2a":"#f97316","3":"#ef4444","4":"#dc2626","5":"#7c3aed","5a":"#9333ea","6":"#b91c1c","6a":"#b91c1c"};
    return <span style={{background:"#fee2e2",color:colors[level]||"#991b1b",padding:"2px 8px",borderRadius:4,fontSize:12}}>MSD {level}</span>;
  };

  const f = (key: string) => t("wms.incoming."+key, locale);

  return (
    <div style={{padding:"0 24px 24px"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <Package size={22} style={{color:"#3b82f6"}}/>
        <h2 style={{margin:0,fontSize:18,fontWeight:700}}>{f("title")}</h2>
        <div style={{marginLeft:"auto",display:"flex",gap:8}}>
          <input value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} placeholder={f("search")+"..."} style={{border:"1px solid #d1d5db",borderRadius:6,padding:"6px 12px",width:200}}/>
          <select value={iqcFilter} onChange={e=>{setIqcFilter(e.target.value);setPage(0);}} style={{border:"1px solid #d1d5db",borderRadius:6,padding:"6px 12px"}}>
            <option value="">{f("all")||"All"}</option>
            <option value="pending">{f("pending")||"Pending"}</option>
            <option value="exempt">{f("exempt")||"Exempt"}</option>
            <option value="submitted">{f("submitted")||"Submitted"}</option>
          </select>
          <button onClick={()=>setShowNew(true)} style={{background:"#3b82f6",color:"#fff",border:"none",borderRadius:6,padding:"6px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:6,fontWeight:600}}>
            <Plus size={16}/> {f("newRecord")}
          </button>
        </div>
      </div>

      {loading ? <div style={{textAlign:"center",padding:40,color:"#6b7280"}}>Loading...</div> : (
        <>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead>
              <tr style={{background:"#f9fafb",borderBottom:"2px solid #e5e7eb"}}>
                {[{k:"lot_no",l:f("lotNo")},{k:"material_code",l:f("materialCode")},{k:"supplier",l:f("supplier")},{k:"qty",l:f("receivedQty")},{k:"time",l:f("receivedAt")},{k:"pkg",l:f("packagingStatus")},{k:"msd",l:f("msdLevel")},{k:"iqc",l:f("iqcStatus")}].map(h=>(
                  <th key={h.k} style={{padding:"8px 12px",textAlign:"left",color:"#6b7280",fontWeight:600}}>{h.l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map(r=>(
                <tr key={r.id} style={{borderBottom:"1px solid #f3f4f6",cursor:"pointer"}} onClick={()=>setShowDetail(r)}>
                  <td style={{padding:"8px 12px",fontFamily:"monospace",color:"#1d4ed8"}}>{r.lot_no}</td>
                  <td style={{padding:"8px 12px"}}>{r.material_code}</td>
                  <td style={{padding:"8px 12px",color:"#374151"}}>{r.supplier_name||r.supplier_code}</td>
                  <td style={{padding:"8px 12px",textAlign:"right"}}>{r.received_qty} {r.uom_code}</td>
                  <td style={{padding:"8px 12px",color:"#6b7280"}}>{r.received_at?r.received_at.slice(0,10):"-"}</td>
                  <td style={{padding:"8px 12px"}}>{pkgBadge(r.packaging_status)}</td>
                  <td style={{padding:"8px 12px"}}>{msdBadge(r.msd_level)}</td>
                  <td style={{padding:"8px 12px"}}>{iqcBadge(r.iqc_status)}</td>
                </tr>
              ))}
              {records.length===0&&<tr><td colSpan={8} style={{padding:40,textAlign:"center",color:"#9ca3af"}}>No records</td></tr>}
            </tbody>
          </table>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:16}}>
            <span style={{color:"#6b7280",fontSize:13}}>Total: {total}</span>
            <div style={{display:"flex",gap:4}}>
              <button disabled={page===0} onClick={()=>setPage(p=>p-1)} style={{padding:"4px 12px",border:"1px solid #d1d5db",borderRadius:4,background:"#fff",cursor:page===0?"not-allowed":"pointer"}}>Prev</button>
              <span style={{padding:"4px 12px",color:"#374151"}}>Page {page+1}</span>
              <button disabled={(page+1)*LIMIT>=total} onClick={()=>setPage(p=>p+1)} style={{padding:"4px 12px",border:"1px solid #d1d5db",borderRadius:4,background:"#fff",cursor:(page+1)*LIMIT>=total?"not-allowed":"pointer"}}>Next</button>
            </div>
          </div>
        </>
      )}

      {/* New Modal */}
      {showNew&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setShowNew(false)}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:12,padding:24,width:"90%",maxWidth:700,maxHeight:"90vh",overflow:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <h3 style={{margin:0}}>{f("newRecord")}</h3>
              <button onClick={()=>setShowNew(false)} style={{background:"none",border:"none",cursor:"pointer"}}><X size={20}/></button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
              {[
                {k:"lot_no",l:f("lotNo"),req:true},{k:"material_code",l:f("materialCode"),req:true},
                {k:"material_name",l:t("wms.incoming.materialName",locale)},
                {k:"supplier_code",l:t("wms.incoming.supplierCode",locale),req:true},
                {k:"supplier_name",l:t("wms.incoming.supplierName",locale)},
                {k:"po_no",l:t("wms.incoming.poNo",locale)},
                {k:"delivery_note_no",l:t("wms.incoming.deliveryNoteNo",locale)},
                {k:"invoice_no",l:t("wms.incoming.invoiceNo",locale)},
              ].map(field=>(
                <div key={field.k}>
                  <label style={{fontSize:12,color:"#6b7280",display:"block",marginBottom:4}}>{field.l}{field.req&&" *"}</label>
                  <input value={(form as any)[field.k]} onChange={e=>setForm(prev=>({...prev,[field.k]:e.target.value}))}
                    style={{width:"100%",border:"1px solid #d1d5db",borderRadius:6,padding:"8px 10px",fontSize:13,boxSizing:"border-box"}}/>
                </div>
              ))}
              <div>
                <label style={{fontSize:12,color:"#6b7280",display:"block",marginBottom:4}}>{f("receivedQty")} *</label>
                <div style={{display:"flex",gap:8}}>
                  <input type="number" value={form.received_qty} onChange={e=>setForm(prev=>({...prev,received_qty:e.target.value}))}
                    style={{flex:1,border:"1px solid #d1d5db",borderRadius:6,padding:"8px 10px",fontSize:13}}/>
                  <input value={form.uom_code} onChange={e=>setForm(prev=>({...prev,uom_code:e.target.value}))}
                    style={{width:80,border:"1px solid #d1d5db",borderRadius:6,padding:"8px 10px",fontSize:13}}/>
                </div>
              </div>
              <div>
                <label style={{fontSize:12,color:"#6b7280",display:"block",marginBottom:4}}>{f("receivedAt")}</label>
                <input type="datetime-local" value={form.received_at} onChange={e=>setForm(prev=>({...prev,received_at:e.target.value}))}
                  style={{width:"100%",border:"1px solid #d1d5db",borderRadius:6,padding:"8px 10px",fontSize:13}}/>
              </div>
              <div>
                <label style={{fontSize:12,color:"#6b7280",display:"block",marginBottom:4}}>{f("packagingStatus")}</label>
                <select value={form.packaging_status} onChange={e=>setForm(prev=>({...prev,packaging_status:e.target.value}))}
                  style={{width:"100%",border:"1px solid #d1d5db",borderRadius:6,padding:"8px 10px",fontSize:13}}>
                  <option value="good">{locale==="vi-VN"?"Tot":"完好"}</option>
                  <option value="minor_damage">{locale==="vi-VN"?"Hao":"轻微破损"}</option>
                  <option value="severe_damage">{locale==="vi-VN"?"Nang":"严重破损"}</option>
                </select>
              </div>
              <div>
                <label style={{fontSize:12,color:"#6b7280",display:"block",marginBottom:4}}>{f("msdLevel")}</label>
                <select value={form.msd_level} onChange={e=>setForm(prev=>({...prev,msd_level:e.target.value}))}
                  style={{width:"100%",border:"1px solid #d1d5db",borderRadius:6,padding:"8px 10px",fontSize:13}}>
                  <option value="">-</option>
                  {["2","2a","3","4","5","5a","6","6a"].map(l=><option key={l} value={l}>MSD Level {l}</option>)}
                </select>
              </div>
              <div>
                <label style={{fontSize:12,color:"#6b7280",display:"block",marginBottom:4}}>{f("expiryDate")}</label>
                <input type="date" value={form.expiry_date} onChange={e=>setForm(prev=>({...prev,expiry_date:e.target.value}))}
                  style={{width:"100%",border:"1px solid #d1d5db",borderRadius:6,padding:"8px 10px",fontSize:13}}/>
              </div>
              <div>
                <label style={{fontSize:12,color:"#6b7280",display:"block",marginBottom:4}}>{t("wms.incoming.operator",locale)}</label>
                <input value={form.operator_id} onChange={e=>setForm(prev=>({...prev,operator_id:e.target.value}))}
                  style={{width:"100%",border:"1px solid #d1d5db",borderRadius:6,padding:"8px 10px",fontSize:13}}/>
              </div>
            </div>

            {/* Attachments */}
            <div style={{marginTop:20}}>
              <label style={{fontSize:13,fontWeight:600,color:"#374151",display:"block",marginBottom:8}}>{f("attachments")}</label>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
                {ATTACH_TYPES.map(at=>{
                  const Icon = at.icon;
                  return (
                    <label key={at.key} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 12px",border:`1px solid ${"#"+(attachments.some(a=>a.type===at.key)?"3b82f6":"d1d5db")}`,borderRadius:6,cursor:"pointer",background:attachments.some(a=>a.type===at.key)?"#eff6ff":"#fff",fontSize:12}}>
                      <Icon size={14}/>
                      {localeLabel(at, locale)}
                      <input type="file" style={{display:"none"}} accept={at.key==="photo"||at.key==="video"?"image/*,video/*":"*"}
                        onChange={e=>{if(e.target.files?.[0])simulateUpload(at.key,e.target.files[0].name);}}/>
                    </label>
                  );
                })}
              </div>
              {attachments.length>0&&(
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(200px,1fr))",gap:8}}>
                  {attachments.map((a,i)=>(
                    <div key={i} style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"8px 10px",background:"#f9fafb",display:"flex",alignItems:"center",gap:8}}>
                      <span style={{flex:1,fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name}</span>
                      <span style={{fontSize:10,color:"#6b7280"}}>{a.type}</span>
                      <button onClick={()=>setAttachments(prev=>prev.filter(x=>x.url!==a.url))} style={{background:"none",border:"none",cursor:"pointer",color:"#ef4444"}}><X size={12}/></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{display:"flex",gap:12,justifyContent:"flex-end",marginTop:24}}>
              <button onClick={()=>setShowNew(false)} style={{padding:"8px 20px",border:"1px solid #d1d5db",borderRadius:6,background:"#fff",cursor:"pointer"}}>{f("cancel")||"Cancel"}</button>
              <button onClick={submitNew} disabled={saving||!form.lot_no||!form.material_code||!form.supplier_code}
                style={{padding:"8px 20px",border:"none",borderRadius:6,background:saving?"#9ca3af":"#3b82f6",color:"#fff",cursor:saving?"not-allowed":"pointer",fontWeight:600}}>
                {saving?"...":f("save")||"Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Drawer */}
      {showDetail&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setShowDetail(null)}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:12,padding:24,width:"90%",maxWidth:640,maxHeight:"90vh",overflow:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:20}}>
              <h3 style={{margin:0}}>{f("details")||"Details"}</h3>
              <button onClick={()=>setShowDetail(null)} style={{background:"none",border:"none",cursor:"pointer"}}><X size={20}/></button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
              {[
                {l:f("lotNo"),v:showDetail.lot_no},{l:f("materialCode"),v:showDetail.material_code},
                {l:t("wms.incoming.materialName",locale),v:showDetail.material_name},
                {l:showDetail.supplier_name?t("wms.incoming.supplierName",locale):f("supplier"),v:showDetail.supplier_name||showDetail.supplier_code},
                {l:t("wms.incoming.poNo",locale),v:showDetail.po_no},
                {l:t("wms.incoming.deliveryNoteNo",locale),v:showDetail.delivery_note_no},
                {l:t("wms.incoming.invoiceNo",locale),v:showDetail.invoice_no},
                {l:f("receivedQty"),v:`${showDetail.received_qty} ${showDetail.uom_code}`},
                {l:f("receivedAt"),v:showDetail.received_at?.slice(0,16)},
                {l:f("packagingStatus"),v:pkgBadge(showDetail.packaging_status)},
                {l:f("msdLevel"),v:msdBadge(showDetail.msd_level)},
                {l:f("expiryDate"),v:showDetail.expiry_date},
                {l:t("wms.incoming.operator",locale),v:showDetail.operator_id},
                {l:f("iqcStatus"),v:iqcBadge(showDetail.iqc_status)},
              ].map(({l,v})=>(
                <div key={l}>
                  <div style={{fontSize:11,color:"#6b7280",marginBottom:2}}>{l}</div>
                  <div style={{fontSize:13,fontWeight:500}}>{v||"-"}</div>
                </div>
              ))}
            </div>
            {showDetail.attachments&&showDetail.attachments.length>0&&(
              <div style={{marginTop:20}}>
                <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>{f("attachments")}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  {showDetail.attachments.map((a,i)=>(
                    <a key={i} href={a.url} target="_blank" rel="noreferrer" style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",border:"1px solid #e5e7eb",borderRadius:6,background:"#f9fafb",textDecoration:"none",color:"#374151",fontSize:12}}>
                      <FileText size={14}/>{a.name}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
