// ERP master data (/erp/customers, /erp/products, /erp/customer-pos), moved out of
// services/api/server.js.
//
// 14 registrations: customer master with its lifecycle transition, audit trail and status
// changes, product master the same way, and customer PO creation with its closure audit.
//
// Pure registrations, no module-level statements. `pmcPoClosureReady` -- the DDL promise
// declared immediately after this block -- is NOT used here, so it stays in server.js.
export function registerErpMasterRoutes(app, deps) {
  const {
    query, pgPool, requirePermission, envelope, errorEnvelope, mutateEnvelope,
    customerGovernanceReady,
  } = deps;

app.get("/erp/customers", requirePermission("pmc.view"), async (_req, res) => {
  try {
    await customerGovernanceReady;
    const rows=await query(
      `SELECT c.id,c.code,c.name_zh AS name,c.status,
              g.lifecycle_status AS "lifecycleStatus",g.risk_level AS "riskLevel",
              g.contact_name AS "contactName",g.email,g.phone,
              g.payment_terms_days AS "paymentTermsDays"
         FROM customers c JOIN erp_customer_governance g ON g.customer_id=c.id
        ORDER BY g.lifecycle_status,c.name_zh,c.code`,
    );
    res.json(envelope({items:rows.rows,total:rows.rowCount}));
  } catch (error) {
    res.status(500).json(errorEnvelope("ERP_CUSTOMER_LIST_FAILED",error.message));
  }
});

app.post("/erp/customers", requirePermission("pmc.edit"), async (req, res) => {
  const client=await pgPool.connect();
  try {
    await customerGovernanceReady;
    const p=req.body?.payload??req.body??{};
    const code=String(p.code??"").trim().toUpperCase();
    const nameZh=String(p.nameZh??"").trim();
    const nameEn=String(p.nameEn??nameZh).trim();
    const email=String(p.email??"").trim().toLowerCase();
    const contactName=String(p.contactName??"").trim();
    const phone=String(p.phone??"").trim();
    const riskLevel=String(p.riskLevel??"LOW").trim().toUpperCase();
    const paymentTermsDays=Math.max(0,Number(p.paymentTermsDays??30));
    if(!code||!nameZh)return res.status(400).json(errorEnvelope("VALIDATION","customer code and name required"));
    if(!["LOW","MEDIUM","HIGH"].includes(riskLevel)||!Number.isInteger(paymentTermsDays)){
      return res.status(400).json(errorEnvelope("VALIDATION","invalid risk level or payment terms"));
    }
    const duplicate=(await client.query(
      `SELECT id,code,name_zh FROM customers
        WHERE UPPER(code)=UPPER($1) OR LOWER(name_zh)=LOWER($2)
           OR ($3<>'' AND id IN(SELECT customer_id FROM erp_customer_governance WHERE LOWER(email)=LOWER($3)))
        LIMIT 1`,[code,nameZh,email],
    )).rows[0];
    if(duplicate)return res.status(409).json(errorEnvelope("CUSTOMER_DUPLICATE",`Potential duplicate customer: ${duplicate.code}`));
    await client.query("BEGIN");
    const row=(await client.query(
      `INSERT INTO customers(code,name_zh,name_en,name_vi,status)
       VALUES($1,$2,$3,$3,'inactive')
       RETURNING id,code,name_zh AS name,status`,
      [code,nameZh,nameEn],
    )).rows[0];
    await client.query(
      `INSERT INTO erp_customer_governance(
         customer_id,lifecycle_status,risk_level,contact_name,email,phone,payment_terms_days
       ) VALUES($1,'DRAFT',$2,$3,$4,$5,$6)`,
      [row.id,riskLevel,contactName,email,phone,paymentTermsDays],
    );
    await client.query(
      `INSERT INTO erp_customer_audit(customer_id,event_type,to_status,actor,reason,detail)
       VALUES($1,'CUSTOMER_CREATED','DRAFT',$2,'Customer draft created',$3::jsonb)`,
      [row.id,String(req.user?.username??"PMC"),JSON.stringify({code,nameZh,email,contactName,phone,riskLevel,paymentTermsDays})],
    );
    await client.query("COMMIT");
    row.lifecycleStatus="DRAFT";
    res.status(201).json(mutateEnvelope(row));
  } catch (error) {
    await client.query("ROLLBACK").catch(()=>{});
    const duplicate=error.code==="23505";
    res.status(duplicate?409:500).json(errorEnvelope(duplicate?"CUSTOMER_CODE_DUPLICATE":"ERP_CUSTOMER_CREATE_FAILED",duplicate?"Customer code already exists":error.message));
  } finally {
    client.release();
  }
});

app.post("/erp/customers/:id/transition", requirePermission("pmc.edit"), async (req,res) => {
  const client=await pgPool.connect();
  try {
    await customerGovernanceReady;
    const action=String(req.body?.payload?.action??req.body?.action??"").toLowerCase();
    const reason=String(req.body?.payload?.reason??req.body?.reason??"").trim();
    if(!reason)return res.status(400).json(errorEnvelope("VALIDATION","transition reason required"));
    const transitions={
      submit:{from:["DRAFT","REJECTED"],to:"PENDING_APPROVAL",base:"inactive"},
      approve:{from:["PENDING_APPROVAL"],to:"ACTIVE",base:"active"},
      reject:{from:["PENDING_APPROVAL"],to:"REJECTED",base:"inactive"},
      hold:{from:["ACTIVE"],to:"ON_HOLD",base:"inactive"},
      reactivate:{from:["ON_HOLD"],to:"ACTIVE",base:"active"},
      archive:{from:["DRAFT","REJECTED","ACTIVE","ON_HOLD"],to:"ARCHIVED",base:"inactive"},
    };
    const rule=transitions[action];
    if(!rule)return res.status(400).json(errorEnvelope("VALIDATION","unsupported customer transition"));
    await client.query("BEGIN");
    const current=(await client.query(
      `SELECT c.id,c.code,g.lifecycle_status FROM customers c
       JOIN erp_customer_governance g ON g.customer_id=c.id WHERE c.id=$1 FOR UPDATE`,
      [req.params.id],
    )).rows[0];
    if(!current){await client.query("ROLLBACK");return res.status(404).json(errorEnvelope("NOT_FOUND","Customer not found"));}
    if(!rule.from.includes(current.lifecycle_status)){
      await client.query("ROLLBACK");
      return res.status(409).json(errorEnvelope("INVALID_CUSTOMER_TRANSITION",`${current.lifecycle_status} cannot ${action}`));
    }
    if(["hold","archive"].includes(action)){
      const open=(await client.query(
        `SELECT COUNT(*)::int count FROM customer_pos WHERE customer_id=$1
          AND status NOT IN('closed','voided','cancelled')`,[req.params.id],
      )).rows[0].count;
      if(open>0){await client.query("ROLLBACK");return res.status(409).json(errorEnvelope("CUSTOMER_HAS_OPEN_PO","Customer with an open PO cannot be frozen or archived"));}
    }
    const actor=String(req.user?.username??"PMC");
    await client.query(`UPDATE customers SET status=$2,updated_at=NOW() WHERE id=$1`,[req.params.id,rule.base]);
    await client.query(
      `UPDATE erp_customer_governance SET lifecycle_status=$2::text,updated_at=NOW(),
       submitted_at=CASE WHEN $2::text='PENDING_APPROVAL' THEN NOW() ELSE submitted_at END,
       approved_at=CASE WHEN $2::text='ACTIVE' THEN NOW() ELSE approved_at END,
       approved_by=CASE WHEN $2::text='ACTIVE' THEN $3 ELSE approved_by END
       WHERE customer_id=$1`,[req.params.id,rule.to,actor],
    );
    await client.query(
      `INSERT INTO erp_customer_audit(customer_id,event_type,from_status,to_status,actor,reason)
       VALUES($1,'CUSTOMER_TRANSITION',$2,$3,$4,$5)`,
      [req.params.id,current.lifecycle_status,rule.to,actor,reason],
    );
    await client.query("COMMIT");
    res.json(mutateEnvelope({id:Number(req.params.id),code:current.code,lifecycleStatus:rule.to,status:rule.base}));
  } catch(error) {
    await client.query("ROLLBACK").catch(()=>{});
    res.status(500).json(errorEnvelope("ERP_CUSTOMER_TRANSITION_FAILED",error.message));
  } finally { client.release(); }
});

app.get("/erp/customers/:id/audit", requirePermission("pmc.view"), async (req,res) => {
  try {
    await customerGovernanceReady;
    const rows=await query(
      `SELECT id,event_type AS "eventType",from_status AS "fromStatus",to_status AS "toStatus",
              actor,reason,detail,created_at AS "createdAt"
         FROM erp_customer_audit WHERE customer_id=$1 ORDER BY id DESC`,[req.params.id],
    );
    res.json(envelope({items:rows.rows,total:rows.rowCount}));
  } catch(error) { res.status(500).json(errorEnvelope("ERP_CUSTOMER_AUDIT_FAILED",error.message)); }
});

app.patch("/erp/customers/:id/status", requirePermission("pmc.edit"), async (req, res) => {
  res.status(409).json(errorEnvelope(
    "CUSTOMER_LIFECYCLE_REQUIRED",
    "Direct status changes are forbidden; use the governed customer transition workflow",
  ));
});

app.patch("/erp/customers/:id", requirePermission("pmc.edit"), async (req, res) => {
  const client=await pgPool.connect();
  try {
    await customerGovernanceReady;
    const p=req.body?.payload??req.body??{};
    await client.query("BEGIN");
    const row=(await client.query(
      `UPDATE customers SET
         code=COALESCE(NULLIF($2,''),code),
         name_zh=COALESCE(NULLIF($3,''),name_zh),
         name_en=COALESCE(NULLIF($4,''),name_en),
         name_vi=COALESCE(NULLIF($4,''),name_vi),
         updated_at=NOW()
       WHERE id=$1 RETURNING id,code,name_zh AS name,status`,
      [req.params.id,String(p.code??"").trim().toUpperCase(),String(p.nameZh??"").trim(),String(p.nameEn??p.nameZh??"").trim()],
    )).rows[0];
    if(!row){await client.query("ROLLBACK");return res.status(404).json(errorEnvelope("NOT_FOUND","Customer not found"));}
    await client.query(
      `UPDATE erp_customer_governance SET
       contact_name=COALESCE($2,contact_name),email=COALESCE($3,email),phone=COALESCE($4,phone),
       payment_terms_days=COALESCE($5,payment_terms_days),risk_level=COALESCE($6,risk_level),updated_at=NOW()
       WHERE customer_id=$1`,
      [req.params.id,p.contactName??null,p.email??null,p.phone??null,p.paymentTermsDays??null,p.riskLevel??null],
    );
    await client.query(
      `INSERT INTO erp_customer_audit(customer_id,event_type,actor,reason,detail)
       VALUES($1,'CUSTOMER_UPDATED',$2,'Customer master updated',$3::jsonb)`,
      [req.params.id,String(req.user?.username??"PMC"),JSON.stringify(p)],
    );
    await client.query("COMMIT");
    res.json(mutateEnvelope(row));
  } catch (error) {
    await client.query("ROLLBACK").catch(()=>{});
    res.status(error.code==="23505"?409:500).json(errorEnvelope(error.code==="23505"?"CUSTOMER_CODE_DUPLICATE":"ERP_CUSTOMER_UPDATE_FAILED",error.message));
  } finally { client.release(); }
});

app.delete("/erp/customers/:id", requirePermission("pmc.edit"), async (req, res) => {
  try {
    const used=(await query(
      `SELECT
         (SELECT COUNT(*) FROM customer_pos WHERE customer_id=$1)
         +(SELECT COUNT(*) FROM ar_invoices WHERE customer_id=$1) AS count`,
      [req.params.id],
    )).rows[0].count;
    if(Number(used)>0)return res.status(409).json(errorEnvelope("CUSTOMER_IN_USE","Customer is referenced; deactivate it instead of deleting"));
    const row=(await query("DELETE FROM customers WHERE id=$1 RETURNING id,code",[req.params.id])).rows[0];
    if(!row)return res.status(404).json(errorEnvelope("NOT_FOUND","Customer not found"));
    res.json(mutateEnvelope(row));
  } catch (error) {
    res.status(500).json(errorEnvelope("ERP_CUSTOMER_DELETE_FAILED",error.message));
  }
});

app.get("/erp/products", requirePermission("pmc.view"), async (_req, res) => {
  try {
    const rows=await query(
      `SELECT id,code,name_zh AS "nameZh",name_en AS "nameEn",revision,status
         FROM products ORDER BY status,code`,
    );
    res.json(envelope({items:rows.rows,total:rows.rowCount}));
  } catch (error) {
    res.status(500).json(errorEnvelope("ERP_PRODUCT_LIST_FAILED",error.message));
  }
});

app.post("/erp/products", requirePermission("pmc.edit"), async (req, res) => {
  try {
    const p=req.body?.payload??req.body??{};
    const code=String(p.code??"").trim().toUpperCase();
    const nameZh=String(p.nameZh??"").trim();
    const nameEn=String(p.nameEn??nameZh).trim();
    const revision=String(p.revision??"V1.0").trim();
    if(!code||!nameZh)return res.status(400).json(errorEnvelope("VALIDATION","product code and Chinese name required"));
    const row=(await query(
      `INSERT INTO products(code,name_zh,name_en,name_vi,revision,status,domain_code)
       VALUES($1,$2,$3,$3,$4,'active','FINISHED_GOODS')
       RETURNING id,code,name_zh AS "nameZh",name_en AS "nameEn",revision,status`,
      [code,nameZh,nameEn,revision],
    )).rows[0];
    res.status(201).json(mutateEnvelope(row));
  } catch (error) {
    const duplicate=error.code==="23505";
    res.status(duplicate?409:500).json(errorEnvelope(duplicate?"PRODUCT_CODE_DUPLICATE":"ERP_PRODUCT_CREATE_FAILED",duplicate?"Product code already exists":error.message));
  }
});

app.patch("/erp/products/:id/status", requirePermission("pmc.edit"), async (req, res) => {
  try {
    const status=String(req.body?.payload?.status??req.body?.status??"").toLowerCase();
    if(!["active","inactive"].includes(status))return res.status(400).json(errorEnvelope("VALIDATION","status must be active or inactive"));
    if(status==="inactive"){
      const open=(await query(
        `SELECT COUNT(*)::int count FROM customer_pos
          WHERE product_id=$1 AND status NOT IN('closed','voided','cancelled')`,
        [req.params.id],
      )).rows[0].count;
      if(open>0)return res.status(409).json(errorEnvelope("PRODUCT_HAS_OPEN_PO","Product with an open PO cannot be deactivated"));
    }
    const row=(await query(
      `UPDATE products SET status=$2,updated_at=NOW() WHERE id=$1
       RETURNING id,code,name_zh AS "nameZh",status`,
      [req.params.id,status],
    )).rows[0];
    if(!row)return res.status(404).json(errorEnvelope("NOT_FOUND","Product not found"));
    res.json(mutateEnvelope(row));
  } catch (error) {
    res.status(500).json(errorEnvelope("ERP_PRODUCT_STATUS_FAILED",error.message));
  }
});

app.patch("/erp/products/:id", requirePermission("pmc.edit"), async (req, res) => {
  try {
    const p=req.body?.payload??req.body??{};
    const row=(await query(
      `UPDATE products SET
         code=COALESCE(NULLIF($2,''),code),
         name_zh=COALESCE(NULLIF($3,''),name_zh),
         name_en=COALESCE(NULLIF($4,''),name_en),
         name_vi=COALESCE(NULLIF($4,''),name_vi),
         revision=COALESCE(NULLIF($5,''),revision),
         updated_at=NOW()
       WHERE id=$1 RETURNING id,code,name_zh AS "nameZh",name_en AS "nameEn",revision,status`,
      [req.params.id,String(p.code??"").trim().toUpperCase(),String(p.nameZh??"").trim(),String(p.nameEn??p.nameZh??"").trim(),String(p.revision??"").trim()],
    )).rows[0];
    if(!row)return res.status(404).json(errorEnvelope("NOT_FOUND","Product not found"));
    res.json(mutateEnvelope(row));
  } catch (error) {
    res.status(error.code==="23505"?409:500).json(errorEnvelope(error.code==="23505"?"PRODUCT_CODE_DUPLICATE":"ERP_PRODUCT_UPDATE_FAILED",error.message));
  }
});

app.delete("/erp/products/:id", requirePermission("pmc.edit"), async (req, res) => {
  try {
    const used=(await query(
      `SELECT
         (SELECT COUNT(*) FROM customer_pos WHERE product_id=$1)
         +(SELECT COUNT(*) FROM work_orders WHERE product_id=$1)
         +(SELECT COUNT(*) FROM boms WHERE product_id=$1)
         +(SELECT COUNT(*) FROM ar_invoice_lines WHERE product_id=$1) AS count`,
      [req.params.id],
    )).rows[0].count;
    if(Number(used)>0)return res.status(409).json(errorEnvelope("PRODUCT_IN_USE","Product is referenced; deactivate it instead of deleting"));
    const row=(await query("DELETE FROM products WHERE id=$1 RETURNING id,code",[req.params.id])).rows[0];
    if(!row)return res.status(404).json(errorEnvelope("NOT_FOUND","Product not found"));
    res.json(mutateEnvelope(row));
  } catch (error) {
    res.status(500).json(errorEnvelope("ERP_PRODUCT_DELETE_FAILED",error.message));
  }
});

app.post("/erp/customer-pos", requirePermission("pmc.edit"), async (req, res) => {
  const client=await pgPool.connect();
  try {
    const p=req.body?.payload??req.body??{};
    const poNumber=String(p.poNumber??"").trim();
    const customerId=Number(p.customerId);
    const productId=Number(p.productId);
    const orderQty=Number(p.orderQty);
    const dueDate=String(p.dueDate??"").trim();
    if(!poNumber||!Number.isInteger(customerId)||!Number.isInteger(productId)||!Number.isFinite(orderQty)||orderQty<=0||!dueDate){
      return res.status(400).json(errorEnvelope("VALIDATION","poNumber, customerId, productId, positive orderQty and dueDate required"));
    }
    await client.query("BEGIN");
    const masters=(await client.query(
      `SELECT EXISTS(SELECT 1 FROM customers WHERE id=$1 AND status='active') customer_ok,
              EXISTS(SELECT 1 FROM products WHERE id=$2 AND status='active') product_ok`,
      [customerId,productId],
    )).rows[0];
    if(!masters.customer_ok||!masters.product_ok)throw new Error("Active customer and product master data required");
    const row=(await client.query(
      `INSERT INTO customer_pos(po_number,customer_id,product_id,order_qty,due_date,status,created_by)
       VALUES($1,$2,$3,$4,$5,'confirmed',$6) RETURNING *`,
      [poNumber,customerId,productId,orderQty,dueDate,req.user?.userId??null],
    )).rows[0];
    await client.query(
      `INSERT INTO pmc_po_closure_audit(customer_po_id,event_type,actor,detail)
       VALUES($1,'PO_CREATED',$2,$3)`,
      [row.id,String(req.user?.username??"PMC"),JSON.stringify({poNumber,customerId,productId,orderQty,dueDate})],
    );
    await client.query("COMMIT");
    res.status(201).json(mutateEnvelope(row));
  } catch (error) {
    await client.query("ROLLBACK").catch(()=>{});
    const duplicate=error.code==="23505";
    res.status(duplicate?409:400).json(errorEnvelope(duplicate?"CUSTOMER_PO_DUPLICATE":"CUSTOMER_PO_CREATE_FAILED",duplicate?"PO number already exists":error.message));
  } finally {
    client.release();
  }
});
}
