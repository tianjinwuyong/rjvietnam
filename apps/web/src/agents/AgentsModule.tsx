import { useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { AgentDashboard } from "./AgentDashboard";
import { ServiceRegistry } from "./ServiceRegistry";
import { AgentBusMonitor } from "./AgentBusMonitor";
import { VirtualEmployeeCenter } from "./VirtualEmployeeCenter";
import { VirtualEmployeeManagement } from "./VirtualEmployeeManagement";
import { VirtualEmployeeDevelopment } from "./VirtualEmployeeDevelopment";
import { FactoryArchitectureView } from "./FactoryArchitectureView";
import { type SignInResult } from "../auth/AuthSignIn";

export type AgentTabKey="runtime"|"manage"|"development"|"architecture"|"org"|"services"|"bus";
interface Props{locale:Locale;currentUser:SignInResult}

export function AgentsModule({locale,currentUser}:Props){
  const [activeTab,setActiveTab]=useState<AgentTabKey>("runtime");
  const tabs:AgentTabKey[]=["runtime","manage","development","architecture","org","services","bus"];
  const label=(tab:AgentTabKey)=>tab==="runtime"?"运行监控":tab==="manage"?"员工档案":tab==="development"?"培训与绩效":tab==="architecture"?"系统架构":tab==="org"?t("agents.tab.org",locale):tab==="services"?t("agents.tab.services",locale):t("agents.tab.bus",locale);
  return <div>
    <section style={{margin:"0 0 14px",padding:"18px 20px",border:"1px solid #a7f3d0",borderRadius:12,background:"linear-gradient(110deg,#ecfdf5,#eff6ff)"}}><h2 style={{margin:0}}>虚拟员工指挥中心</h2><p style={{margin:"6px 0 0",color:"var(--text-2)"}}>统一组织、配置、训练、评价并实时监控工厂虚拟员工。所有高风险动作保留人工审批和审计记录。</p></section>
    <div style={{display:"flex",gap:4,borderBottom:"1px solid var(--border)",marginBottom:16,overflowX:"auto"}}>{tabs.map(tab=><button key={tab} onClick={()=>setActiveTab(tab)} style={{padding:"9px 16px",fontSize:13,fontWeight:activeTab===tab?700:400,background:"none",border:"none",borderBottom:activeTab===tab?"2px solid var(--info)":"2px solid transparent",color:activeTab===tab?"var(--text)":"var(--muted)",cursor:"pointer",marginBottom:-1,whiteSpace:"nowrap"}}>{label(tab)}</button>)}</div>
    {activeTab==="runtime"&&<VirtualEmployeeCenter/>}
    {activeTab==="manage"&&<VirtualEmployeeManagement/>}
    {activeTab==="development"&&<VirtualEmployeeDevelopment/>}
    {activeTab==="architecture"&&<FactoryArchitectureView/>}
    {activeTab==="org"&&<AgentDashboard locale={locale} currentUser={currentUser}/>}
    {activeTab==="services"&&<ServiceRegistry locale={locale} canManage={true}/>}
    {activeTab==="bus"&&<AgentBusMonitor locale={locale}/>}
  </div>;
}
