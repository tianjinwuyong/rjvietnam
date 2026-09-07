import { ExternalLink, Network } from "lucide-react";

const architectureUrl="/architecture/factory-intelligent-system.html";

export function FactoryArchitectureView(){
  return <section className="surface-panel" style={{padding:0,overflow:"hidden",borderRadius:12}}>
    <header style={{display:"flex",alignItems:"center",gap:10,padding:"13px 16px",borderBottom:"1px solid var(--border)",background:"var(--surface-2)"}}>
      <Network size={20}/>
      <div><strong>工厂智能管理系统总架构</strong><div style={{fontSize:12,color:"var(--text-3)",marginTop:2}}>已通过 Archify showcase 9/9 验证 · 支持搜索、路径追踪、主题切换和导出</div></div>
      <a href={architectureUrl} target="_blank" rel="noreferrer" style={{marginLeft:"auto",display:"inline-flex",alignItems:"center",gap:6,padding:"8px 12px",border:"1px solid var(--border)",borderRadius:8,textDecoration:"none",color:"var(--text)"}}>全屏打开 <ExternalLink size={14}/></a>
    </header>
    <iframe title="工厂智能管理系统总架构" src={architectureUrl} style={{display:"block",width:"100%",height:"calc(100vh - 245px)",minHeight:680,border:0,background:"#f8fafc"}}/>
  </section>;
}
