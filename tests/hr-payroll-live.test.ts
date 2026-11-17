import pg from "pg";
import { describe, expect, it } from "vitest";

const apiBase=process.env.HR_API_BASE;
const live=process.env.RUN_HR_PAYROLL_LIVE==="1"&&Boolean(apiBase);

describe.skipIf(!live)("HR payroll closed loop",()=>{
  it("calculates, approves, pays, locks and exports payroll to finance",async()=>{
    const db=new pg.Pool({host:"127.0.0.1",database:"smt_factory",user:"postgres",password:"postgres"});
    const login=await fetch(`${apiBase}/api/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"admin",password:"Factory@123"})});
    expect(login.ok).toBe(true);
    const token=(await login.json() as any).data.token;
    const headers={"content-type":"application/json",authorization:`Bearer ${token}`};
    const employee=(await db.query("SELECT id FROM employees WHERE status='active' ORDER BY id LIMIT 1")).rows[0];
    expect(employee).toBeTruthy();
    const year=2099,month=12;
    const salary=(await db.query(`INSERT INTO salary_records(employee_id,year,month,base_salary,normal_days,ot_hours,ot_rate,
      allowances_total,bonus_other,deduction_other,personal_tax,social_insurance,health_insurance,unemployment_ins,
      gross_salary,total_deductions,net_salary,status)
      VALUES($1,$2,$3,10000000,22,8,1.5,500000,200000,100000,500000,800000,150000,100000,11200000,1650000,9550000,'draft')
      RETURNING id`,[employee.id,year,month])).rows[0];
    let batchId:number|undefined;
    try{
      const post=async(path:string,body:unknown)=>{
        const response=await fetch(`${apiBase}${path}`,{method:"POST",headers,body:JSON.stringify(body)});
        const json=await response.json() as any;
        expect(response.ok,JSON.stringify(json)).toBe(true);
        return json.data.item;
      };
      const batch=await post("/hr/payroll/batches",{year,month,actor:"HR-LIVE"});
      batchId=Number(batch.id);
      const calculated=await post(`/hr/payroll/batches/${batchId}/calculate`,{actor:"HR-LIVE"});
      expect(calculated).toMatchObject({status:"CALCULATED",employee_count:1});
      expect(Number(calculated.total_net)).toBe(9550000);
      expect((await post(`/hr/payroll/batches/${batchId}/decision`,{approvalRole:"HR",decision:"APPROVE",actor:"HR",comment:"Checked"})).status).toBe("HR_APPROVED");
      expect((await post(`/hr/payroll/batches/${batchId}/decision`,{approvalRole:"FINANCE",decision:"APPROVE",actor:"FINANCE",comment:"Funds ready"})).status).toBe("FINANCE_APPROVED");
      const item=(await db.query("SELECT id FROM hr_payroll_items WHERE batch_id=$1",[batchId])).rows[0];
      const payment=await post(`/hr/payroll/items/${item.id}/pay`,{paymentMethod:"BANK",bankReference:"BANK-LIVE-001",actor:"FINANCE"});
      expect(payment.status).toBe("PAID");
      expect((await post(`/hr/payroll/batches/${batchId}/close`,{actor:"FINANCE"})).status).toBe("LOCKED");
      const state=(await db.query(`SELECT b.status,
        (SELECT COUNT(*)::int FROM hr_payroll_approvals WHERE batch_id=b.id) approvals,
        (SELECT COUNT(*)::int FROM hr_payroll_accounting_exports WHERE batch_id=b.id AND status='POSTED' AND journal_entry_id IS NOT NULL) finance_exports,
        (SELECT COUNT(*)::int FROM hr_payroll_audit WHERE batch_id=b.id) audit_events
        FROM hr_payroll_batches b WHERE b.id=$1`,[batchId])).rows[0];
      expect(state).toMatchObject({status:"LOCKED",approvals:2,finance_exports:1});
      expect(state.audit_events).toBeGreaterThanOrEqual(6);
    }finally{
      if(batchId){
        await db.query("DELETE FROM hr_payroll_cash_receipts WHERE payment_id IN(SELECT id FROM hr_payroll_payments WHERE batch_id=$1)",[batchId]);
        const journal=(await db.query("SELECT journal_entry_id FROM hr_payroll_accounting_exports WHERE batch_id=$1",[batchId])).rows[0];
        for(const table of ["hr_payroll_payments","hr_payroll_accounting_exports","hr_payroll_source_reconciliations","hr_payroll_audit","hr_payroll_approvals","hr_payroll_items"]){
          await db.query(`DELETE FROM ${table} WHERE batch_id=$1`,[batchId]);
        }
        if(journal?.journal_entry_id)await db.query("DELETE FROM gl_journal_entries WHERE id=$1",[journal.journal_entry_id]);
        await db.query("DELETE FROM hr_payroll_batches WHERE id=$1",[batchId]);
      }
      await db.query("DELETE FROM salary_records WHERE id=$1",[salary.id]);
      await db.end();
    }
  });
});
