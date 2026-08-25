import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient } from "../api/client";

type Batch = {
  id:number; batch_no:string; year:number; month:number; status:string; employee_count:number;
  total_gross:number; total_deductions:number; total_net:number; paid_count:number; exception_count:number;
};
type Dashboard = {batches:Batch[];summary:{batch_count:number;total_gross:number;total_deductions:number;total_net:number}};
type PayrollItem={id:number;employee_code:string;employee_name:string;gross_salary:number;net_salary:number;payment_method:string;payment_status:string;payment_id?:number;payment_record_status?:string;receiver_badge?:string};
type BatchDetail={batch:Batch;items:PayrollItem[];approvals:Array<{approval_role:string;decision:string;actor:string}>};

const copy = {
  "zh-CN": {title:"工资核算、审批与发放",sub:"考勤核算 → 人事审批 → 财务审批 → 银行发放/现金签领 → 锁账报表",year:"年度",month:"月份",create:"新建工资批次",batch:"批次",people:"人数",gross:"应发",deduct:"扣款/税保",net:"实发",status:"状态",paid:"已发",error:"异常",action:"操作",calc:"计算",hr:"人事批准",finance:"财务批准",close:"锁账",empty:"暂无工资批次",view:"查看工资单",employee:"员工",method:"方式",bank:"银行发放",cash:"现金发放",receive:"员工签领",badge:"员工工牌号"},
  "en-US": {title:"Payroll Calculation, Approval & Payment",sub:"Calculate → HR approval → Finance approval → Bank/Cash payment → Lock & report",year:"Year",month:"Month",create:"Create payroll",batch:"Batch",people:"Employees",gross:"Gross",deduct:"Deductions",net:"Net",status:"Status",paid:"Paid",error:"Exceptions",action:"Action",calc:"Calculate",hr:"HR approve",finance:"Finance approve",close:"Lock",empty:"No payroll batches",view:"View payslips",employee:"Employee",method:"Method",bank:"Pay bank",cash:"Pay cash",receive:"Receive cash",badge:"Employee badge"},
  "vi-VN": {title:"Tính, duyệt và chi trả lương",sub:"Tính lương → HR duyệt → Tài chính duyệt → Chuyển khoản/Tiền mặt → Khóa sổ",year:"Năm",month:"Tháng",create:"Tạo kỳ lương",batch:"Kỳ",people:"Nhân viên",gross:"Tổng lương",deduct:"Khấu trừ",net:"Thực nhận",status:"Trạng thái",paid:"Đã trả",error:"Lỗi",action:"Thao tác",calc:"Tính",hr:"HR duyệt",finance:"Tài chính duyệt",close:"Khóa",empty:"Chưa có kỳ lương",view:"Xem phiếu lương",employee:"Nhân viên",method:"Phương thức",bank:"Trả ngân hàng",cash:"Trả tiền mặt",receive:"Ký nhận",badge:"Mã nhân viên"},
} as const;
const money=(value:number)=>new Intl.NumberFormat("vi-VN",{style:"currency",currency:"VND",maximumFractionDigits:0}).format(Number(value||0));

export function HrPayroll({locale}:{locale:Locale}){
  const text=copy[locale],now=new Date();
  const [year,setYear]=useState(now.getFullYear()),[month,setMonth]=useState(now.getMonth()+1);
  const [data,setData]=useState<Dashboard|null>(null),[message,setMessage]=useState("");
  const [detail,setDetail]=useState<BatchDetail|null>(null),[receiverBadge,setReceiverBadge]=useState("");
  const load=useCallback(async()=>{try{setData(await apiClient.get<Dashboard>(`/hr/payroll/dashboard?year=${year}`));setMessage("");}catch(error){setMessage(error instanceof Error?error.message:String(error));}},[year]);
  useEffect(()=>{void load();},[load]);
  const post=async(path:string,body:unknown)=>{try{await apiClient.post(path,body);await load();}catch(error){setMessage(error instanceof Error?error.message:String(error));}};
  const openBatch=async(id:number)=>{try{setDetail(await apiClient.get<BatchDetail>(`/hr/payroll/batches/${id}`));}catch(error){setMessage(error instanceof Error?error.message:String(error));}};
  const pay=async(item:PayrollItem,method:"BANK"|"CASH")=>{await post(`/hr/payroll/items/${item.id}/pay`,{paymentMethod:method,actor:"FINANCE"});if(detail)await openBatch(detail.batch.id);};
  const receive=async(item:PayrollItem)=>{if(!item.payment_id||!receiverBadge)return;await post(`/hr/payroll/payments/${item.payment_id}/receive`,{receiverBadge,signatureMethod:"EMPLOYEE_BADGE"});if(detail)await openBatch(detail.batch.id);};
  return <div className="screen-stack">
    <section className="surface-panel">
      <div className="section-header"><div><h2>{text.title}</h2><p>{text.sub}</p></div>
        <div className="toolbar">
          <label>{text.year} <input type="number" value={year} onChange={e=>setYear(Number(e.target.value))}/></label>
          <label>{text.month} <input type="number" min={1} max={12} value={month} onChange={e=>setMonth(Number(e.target.value))}/></label>
          <button className="action-button" onClick={()=>void post("/hr/payroll/batches",{year,month,actor:"HR"})}>{text.create}</button>
        </div>
      </div>{message&&<p>{message}</p>}
      <div className="metric-grid">
        <div className="metric-card"><span>{text.batch}</span><strong>{data?.summary.batch_count??0}</strong></div>
        <div className="metric-card"><span>{text.gross}</span><strong>{money(data?.summary.total_gross??0)}</strong></div>
        <div className="metric-card"><span>{text.deduct}</span><strong>{money(data?.summary.total_deductions??0)}</strong></div>
        <div className="metric-card"><span>{text.net}</span><strong>{money(data?.summary.total_net??0)}</strong></div>
      </div>
    </section>
    <section className="surface-panel"><div className="table-shell"><table>
      <thead><tr><th>{text.batch}</th><th>{text.people}</th><th>{text.gross}</th><th>{text.deduct}</th><th>{text.net}</th><th>{text.paid}</th><th>{text.error}</th><th>{text.status}</th><th>{text.action}</th></tr></thead>
      <tbody>{data?.batches.length?data.batches.map(batch=><tr key={batch.id}>
        <td>{batch.batch_no}</td><td>{batch.employee_count}</td><td>{money(batch.total_gross)}</td><td>{money(batch.total_deductions)}</td><td>{money(batch.total_net)}</td>
        <td>{batch.paid_count}</td><td>{batch.exception_count}</td><td><span className="badge badge-info">{batch.status}</span></td>
        <td>
          {["DRAFT","CALCULATED"].includes(batch.status)&&<button onClick={()=>void post(`/hr/payroll/batches/${batch.id}/calculate`,{actor:"HR"})}>{text.calc}</button>}
          {batch.status==="CALCULATED"&&<button onClick={()=>void post(`/hr/payroll/batches/${batch.id}/decision`,{approvalRole:"HR",decision:"APPROVE",actor:"HR",comment:"Checked"})}>{text.hr}</button>}
          {batch.status==="HR_APPROVED"&&<button onClick={()=>void post(`/hr/payroll/batches/${batch.id}/decision`,{approvalRole:"FINANCE",decision:"APPROVE",actor:"FINANCE",comment:"Funding checked"})}>{text.finance}</button>}
          {["PAYING","PARTIALLY_PAID","PAID"].includes(batch.status)&&<button onClick={()=>void post(`/hr/payroll/batches/${batch.id}/close`,{actor:"FINANCE"})}>{text.close}</button>}
          <button onClick={()=>void openBatch(batch.id)}>{text.view}</button>
        </td>
      </tr>):<tr><td colSpan={9}>{text.empty}</td></tr>}</tbody>
    </table></div></section>
    {detail&&<section className="surface-panel">
      <div className="section-header"><h3>{detail.batch.batch_no} · {text.view}</h3><button onClick={()=>setDetail(null)}>×</button></div>
      <div className="toolbar"><input value={receiverBadge} onChange={e=>setReceiverBadge(e.target.value)} placeholder={text.badge}/></div>
      <div className="table-shell"><table><thead><tr><th>{text.employee}</th><th>{text.gross}</th><th>{text.net}</th><th>{text.method}</th><th>{text.status}</th><th>{text.action}</th></tr></thead>
        <tbody>{detail.items.map(item=><tr key={item.id}><td>{item.employee_code} {item.employee_name}</td><td>{money(item.gross_salary)}</td><td>{money(item.net_salary)}</td><td>{item.payment_method}</td><td>{item.payment_status}</td><td>
          {item.payment_status==="UNPAID"&&<><button onClick={()=>void pay(item,"BANK")}>{text.bank}</button> <button onClick={()=>void pay(item,"CASH")}>{text.cash}</button></>}
          {item.payment_method==="CASH"&&item.payment_status==="PROCESSING"&&<button onClick={()=>void receive(item)}>{text.receive}</button>}
        </td></tr>)}</tbody>
      </table></div>
    </section>}
  </div>;
}
