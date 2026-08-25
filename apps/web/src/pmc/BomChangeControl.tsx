import { useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { bomApi, type BomImportChangeRequest } from "../api/bom";

const labels = {
  "zh-CN": { title:"BOM \u5dee\u5f02\u5ba1\u6279",desc:"\u540c\u4ea7\u54c1\u540c\u7248\u672c\u5185\u5bb9\u4e0d\u540c\u4e0d\u5f97\u8986\u76d6\uff1b\u6279\u51c6\u540e\u5fc5\u987b\u5f62\u6210\u65b0\u7248\u672c\u3002",product:"\u4ea7\u54c1",current:"\u73b0\u7248\u672c",source:"\u6765\u6e90\u6587\u4ef6",lines:"\u884c\u6570",status:"\u72b6\u6001",action:"\u64cd\u4f5c",approve:"\u6279\u51c6\u65b0\u7248\u672c",reject:"\u62d2\u7edd",none:"\u6682\u65e0\u5dee\u5f02\u7533\u8bf7",note:"\u8bf7\u8f93\u5165\u5ba1\u6279\u610f\u89c1",revision:"\u4e0d\u540c\u5185\u5bb9\u5fc5\u987b\u4f7f\u7528\u65b0\u7248\u672c" },
  "en-US": { title:"BOM Change Control",desc:"Different content never overwrites the same revision; approval creates a new revision.",product:"Product",current:"Current",source:"Source",lines:"Lines",status:"Status",action:"Action",approve:"Approve new revision",reject:"Reject",none:"No change requests",note:"Enter review note",revision:"Changed content requires a new revision" },
  "vi-VN": { title:"Ph\u00ea duy\u1ec7t thay \u0111\u1ed5i BOM",desc:"Kh\u00f4ng ghi \u0111\u00e8 c\u00f9ng s\u1ea3n ph\u1ea9m/phi\u00ean b\u1ea3n; ph\u00ea duy\u1ec7t ph\u1ea3i t\u1ea1o phi\u00ean b\u1ea3n m\u1edbi.",product:"S\u1ea3n ph\u1ea9m",current:"Phi\u00ean b\u1ea3n hi\u1ec7n t\u1ea1i",source:"T\u1ec7p ngu\u1ed3n",lines:"S\u1ed1 d\u00f2ng",status:"Tr\u1ea1ng th\u00e1i",action:"Thao t\u00e1c",approve:"Duy\u1ec7t",reject:"T\u1eeb ch\u1ed1i",none:"Kh\u00f4ng c\u00f3 y\u00eau c\u1ea7u",note:"Nh\u1eadp \u00fd ki\u1ebfn ph\u00ea duy\u1ec7t",revision:"N\u1ed9i dung m\u1edbi ph\u1ea3i d\u00f9ng phi\u00ean b\u1ea3n m\u1edbi" },
} as const;

export function BomChangeControl({ locale }: { locale: Locale }) {
  const c=labels[locale];
  const [items,setItems]=useState<BomImportChangeRequest[]>([]);
  const [error,setError]=useState("");
  const load=async()=>{try{const x=await bomApi.getImportChangeRequests("ALL");setItems(x.items);setError("");}catch(e){setError(e instanceof Error?e.message:String(e));}};
  useEffect(()=>{void load();},[]);
  const decide=async(x:BomImportChangeRequest,decision:"APPROVE"|"REJECT")=>{
    const note=prompt(c.note);if(!note)return;let revision:string|undefined;
    if(decision==="APPROVE"){revision=prompt(c.revision,x.requestedRevision)||undefined;if(!revision)return;}
    try{await bomApi.decideImportChange(x.id,decision,note,revision);await load();}catch(e){setError(e instanceof Error?e.message:String(e));}
  };
  return <section className="surface-panel" style={{padding:18}}><div className="section-header"><div><h2>{c.title}</h2><p>{c.desc}</p></div></div>
    {error&&<p style={{color:"var(--danger)"}}>{error}</p>}<div className="table-shell"><table><thead><tr><th>ID</th><th>{c.product}</th><th>{c.current}</th><th>{c.source}</th><th>{c.lines}</th><th>{c.status}</th><th>{c.action}</th></tr></thead><tbody>
    {items.map(x=><tr key={x.id}><td>{x.id}</td><td>{x.productCode}</td><td>{x.existingRevision}</td><td>{x.sourceFileName}</td><td>{x.lineCount}</td><td>{x.status}</td><td>{x.status==="PENDING_REVIEW"&&<div style={{display:"flex",gap:6}}><button onClick={()=>void decide(x,"APPROVE")}>{c.approve}</button><button onClick={()=>void decide(x,"REJECT")}>{c.reject}</button></div>}</td></tr>)}
    {!items.length&&<tr><td colSpan={7}>{c.none}</td></tr>}</tbody></table></div></section>;
}
