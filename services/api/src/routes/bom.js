// ============================================================================
// BOM 域 —— 从 server.js 整段搬迁（refactor-plan-2026-11-21 阶段3轮4）。
//   registerBomRoutes = 原 server.js 14323-14953（BOM schema 注释 +
//     resolveProductId/resolveMaterialId 两个模块私有 helper + 12 路由：
//     boms CRUD/状态/行项/import/history 与 /erp/boms/product/:code PDA 读端点）。
//   registerBomChangeRequestsRoutes = 原 server.js 17992-18025（2 路由：
//     bom-import-change-requests 列表与决定）。
// 挂载位置在 app 级鉴权闸门之后（原行号处各留 register 调用）,wrapper 鉴权语义不变;
// 两个挂载点共用 server.js 侧同一份 hoisted bomDeps（check:register-deps 要求每个
// 挂载点传齐模块内解构的全部名字）。query/envelope 族直接 import。
// ============================================================================
import { query } from "../db.js";
import { envelope, listEnvelope, mutateEnvelope, errorEnvelope } from "../shared/helpers.js";

export function registerBomRoutes(app, deps) {
  const { pgPool, requirePermission } = deps;

// ── BOM ──────────────────────────────────────────────────────────────────
//
// BOM schema:
//   boms(id, product_id, revision, status, effective_from, effective_to, created_at, updated_at)
//   bom_lines(id, bom_id, material_id, reference_designators, qty_per, loss_rate,
//              substitute_group, effective_from, effective_to, created_at, updated_at)
//              ↑ also has china_material_code, material_category, spec, unit (denormalized for display)
//
// The import path (POST /boms/import) upserts products + materials by code, then creates boms + bom_lines.
// The create path (POST /boms) accepts materialCode strings and resolves to material_id.

// Helper: resolve a product by code (upsert if not exists)
async function resolveProductId(productCode) {
  const p = await query("SELECT id FROM products WHERE code = $1", [productCode]);
  if (p.rows.length > 0) return p.rows[0].id;
  // Upsert with placeholder names
  const r = await query(
    `INSERT INTO products (code, name_zh, name_en, name_vi, revision, status, domain_code)
     VALUES ($1, $1, $1, $1, 'V1.0', 'active', 'FINISHED_GOODS')
     ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code
     RETURNING id`,
    [productCode],
  );
  return r.rows[0].id;
}

// Helper: resolve material by code (upsert if not exists)
// Vietnamese codes (R0xxx-xxxxx) go into materials.vietnam_code;
// Chinese codes (0.xx.xx.xx.xxxx) go into materials.code
async function resolveMaterialId(materialCode, extra = {}) {
  // Try to find by vietnam_code first (for R0xxx codes), then by code
  let m = await query("SELECT id FROM materials WHERE vietnam_code = $1", [materialCode]);
  if (m.rows.length > 0) return m.rows[0].id;
  m = await query("SELECT id FROM materials WHERE code = $1", [materialCode]);
  if (m.rows.length > 0) return m.rows[0].id;

  // Upsert: determine which column to use
  const isVietnamCode = /^R0\d{3}/.test(materialCode);
  if (isVietnamCode) {
    const r = await query(
      `INSERT INTO materials (code, vietnam_code, name_zh, name_en, name_vi, uom, material_type, status, domain_code)
       VALUES ($1, $2, $2, $2, $2, $3, 'component', 'active', 'RAW_MATERIAL')
       ON CONFLICT (vietnam_code) DO UPDATE SET vietnam_code = EXCLUDED.vietnam_code
       RETURNING id`,
      [materialCode, materialCode, extra.unit || "PCS"],
    );
    return r.rows[0].id;
  } else {
    const r = await query(
      `INSERT INTO materials (code, name_zh, name_en, name_vi, uom, material_type, status, domain_code)
       VALUES ($1, $1, $1, $1, $2, 'component', 'active', 'RAW_MATERIAL')
       ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code
       RETURNING id`,
      [materialCode, extra.unit || "PCS"],
    );
    return r.rows[0].id;
  }
}

// GET /boms — list BOMs with optional filter
app.get("/boms", async (req, res) => {
  try {
    const { productCode, status, q, limit = 50, offset = 0 } = req.query;
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    const conditions = [];
    const params = [];
    let idx = 1;
    if (productCode) {
      conditions.push(`p.code = $${idx++}`);
      params.push(productCode);
    }
    if (status) {
      conditions.push(`b.status = $${idx++}`);
      params.push(status);
    }
    if (q) {
      conditions.push(`(p.code ILIKE $${idx} OR p.name_zh ILIKE $${idx})`);
      params.push(`%${q}%`);
      idx++;
    }
    const joins = "JOIN products p ON p.id = b.product_id";
    const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

    const [countR, dataR] = await Promise.all([query(`SELECT count(*)::int AS total FROM boms b ${joins} ${where}`, params), query(
      `SELECT b.id, p.code AS "productCode", p.name_zh AS "productNameZh",
              b.revision, b.status, b.created_at AS "createdAt",
              b.effective_from AS "effectiveFrom", b.effective_to AS "effectiveTo",
              (SELECT count(*)::int FROM bom_lines WHERE bom_id = b.id) AS "lineCount",
              (SELECT count(*)::int FROM bom_lines WHERE bom_id = b.id) AS "materialCount"
       FROM boms b ${joins} ${where}
       ORDER BY b.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, safeLimit, safeOffset],
    )]);
    res.json(listEnvelope(dataR.rows, countR.rows[0]?.total ?? 0));
  } catch (err) {
    console.error("GET /boms:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /boms/:id — get BOM with all lines
app.get("/boms/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const bomR = await query(
      `SELECT b.id, p.code AS "productCode", p.name_zh AS "productNameZh",
              p.name_en AS "productNameEn", p.name_vi AS "productNameVi",
              b.revision, b.status, b.created_at AS "createdAt",
              b.updated_at AS "updatedAt",
              b.effective_from AS "effectiveFrom", b.effective_to AS "effectiveTo"
       FROM boms b JOIN products p ON p.id = b.product_id
       WHERE b.id = $1`,
      [id],
    );
    if (bomR.rows.length === 0) {
      return res.status(404).json(errorEnvelope("NOT_FOUND", `BOM ${id} not found`));
    }
    const bom = bomR.rows[0];

    const linesR = await query(
      `SELECT bl.id, bl.material_id AS "materialId",
              m.code AS "materialCode", bl.qty_per AS "qtyPer",
              bl.loss_rate AS "lossRate",
              COALESCE(bl.reference_designators, '') AS "referenceDesignators",
              COALESCE(bl.substitute_group, '') AS "substituteGroup",
              COALESCE(bl.china_material_code, m.code) AS "chinaMaterialCode",
              COALESCE(bl.material_category, '') AS "materialCategory",
              COALESCE(bl.spec, '') AS "spec",
              COALESCE(bl.unit, m.uom) AS "unit",
              COALESCE(bl.material_name_zh, m.name_zh) AS "materialNameZh",
              COALESCE(bl.material_name_en, m.name_en) AS "materialNameEn",
              COALESCE(bl.material_name_vi, m.name_vi) AS "materialNameVi",
              bl.effective_from AS "effectiveFrom", bl.effective_to AS "effectiveTo"
       FROM bom_lines bl
       JOIN materials m ON m.id = bl.material_id
       WHERE bl.bom_id = $1
       ORDER BY bl.id`,
      [id],
    );

    const lines = linesR.rows.map((l) => ({
      ...l,
      referenceDesignators: l.referenceDesignators ? l.referenceDesignators.split(",").filter(Boolean) : [],
    }));

    res.json(envelope({ ...bom, lines }));
  } catch (err) {
    console.error("GET /boms/:id:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /boms/product/:code — latest active BOM for a product
app.get("/boms/product/:code", async (req, res) => {
  try {
    const { code } = req.params;
    const bomR = await query(
      `SELECT b.id, p.code AS "productCode", p.name_zh AS "productNameZh",
              b.revision, b.status, b.created_at AS "createdAt",
              b.effective_from AS "effectiveFrom", b.effective_to AS "effectiveTo"
       FROM boms b JOIN products p ON p.id = b.product_id
       WHERE p.code = $1 AND b.status = 'active'
       ORDER BY b.created_at DESC LIMIT 1`,
      [code],
    );
    if (bomR.rows.length === 0) {
      return res.status(404).json(errorEnvelope("NOT_FOUND", `No active BOM for product ${code}`));
    }
    const bom = bomR.rows[0];

    const linesR = await query(
      `SELECT bl.id, bl.material_id AS "materialId",
              m.code AS "materialCode", bl.qty_per AS "qtyPer",
              bl.loss_rate AS "lossRate",
              COALESCE(bl.reference_designators, '') AS "referenceDesignators",
              COALESCE(bl.substitute_group, '') AS "substituteGroup",
              COALESCE(bl.china_material_code, m.code) AS "chinaMaterialCode",
              COALESCE(bl.material_category, '') AS "materialCategory",
              COALESCE(bl.spec, '') AS "spec",
              COALESCE(bl.unit, m.uom) AS "unit",
              COALESCE(bl.material_name_zh, m.name_zh) AS "materialNameZh"
       FROM bom_lines bl
       JOIN materials m ON m.id = bl.material_id
       WHERE bl.bom_id = $1
       ORDER BY bl.id`,
      [bom.id],
    );
    const lines = linesR.rows.map((l) => ({
      ...l,
      referenceDesignators: l.referenceDesignators ? l.referenceDesignators.split(",").filter(Boolean) : [],
    }));

    res.json(envelope({ ...bom, lines }));
  } catch (err) {
    console.error("GET /boms/product/:code:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// GET /erp/boms/product/:productCode — latest active BOM for a product (for PDA app)
app.get("/erp/boms/product/:productCode", async (req, res) => {
  try {
    const { productCode } = req.params;
    const bomR = await query(
      `SELECT b.id, p.code AS "productCode", p.name_zh AS "productNameZh",
              b.revision, b.status, b.created_at AS "createdAt"
       FROM boms b JOIN products p ON p.id = b.product_id
       WHERE p.code = $1 AND b.status = 'active'
       ORDER BY b.created_at DESC LIMIT 1`,
      [productCode],
    );
    if (bomR.rows.length === 0) {
      return res.status(404).json(errorEnvelope("NOT_FOUND", `No active BOM for product ${productCode}`));
    }
    const bom = bomR.rows[0];

    const linesR = await query(
      `SELECT bl.id, bl.material_id AS "materialId",
              m.code AS "materialCode", bl.qty_per AS "qtyPer",
              bl.loss_rate AS "lossRate",
              COALESCE(bl.reference_designators, '') AS "referenceDesignators",
              COALESCE(bl.unit, m.uom) AS "unit",
              COALESCE(bl.material_name_zh, m.name_zh) AS "materialNameZh"
       FROM bom_lines bl
       JOIN materials m ON m.id = bl.material_id
       WHERE bl.bom_id = $1
       ORDER BY bl.id`,
      [bom.id],
    );
    const lines = linesR.rows.map((l) => ({
      ...l,
      referenceDesignators: l.referenceDesignators ? l.referenceDesignators.split(",").filter(Boolean) : [],
    }));

    res.json(envelope({ ...bom, lines }));
  } catch (err) {
    console.error("GET /erp/boms/product/:productCode:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// POST /boms — create BOM with lines (accepts materialCode strings)
app.post("/boms", requirePermission("bom.edit"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    const { productCode, revision = "V1.0", status = "draft", lines = [], effectiveFrom, effectiveTo } = req.body?.payload ?? {};
    if (!productCode) return res.status(400).json(errorEnvelope("VALIDATION", "productCode required"));
    if (lines.length === 0) return res.status(400).json(errorEnvelope("VALIDATION", "lines required"));

    await client.query("BEGIN");

    // Resolve product
    const productId = await resolveProductId(productCode);

    // Check duplicate revision
    const dupR = await client.query(
      "SELECT id FROM boms WHERE product_id = $1 AND revision = $2",
      [productId, revision],
    );
    if (dupR.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json(errorEnvelope("DUPLICATE", `BOM ${productCode} revision ${revision} already exists`));
    }

    // Create BOM
    const bomR = await client.query(
      `INSERT INTO boms (product_id, revision, status, effective_from, effective_to)
       VALUES ($1, $2, 'draft', $3, $4) RETURNING id`,
      [productId, revision, effectiveFrom || null, effectiveTo || null],
    );
    const bomId = bomR.rows[0].id;

    // Insert lines: resolve each materialCode → material_id
    for (const line of lines) {
      const materialId = await resolveMaterialId(line.materialCode, { unit: line.unit });
      const refDes = Array.isArray(line.referenceDesignators)
        ? line.referenceDesignators.join(",")
        : (line.referenceDesignators ?? "");

      await client.query(
        `INSERT INTO bom_lines (bom_id, material_id, reference_designators, qty_per, loss_rate,
                                china_material_code, material_category, spec, unit,
                                material_name_zh, material_name_en, material_name_vi,
                                substitute_group)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$10,$11)`,
        [
          bomId, materialId, refDes,
          line.qtyPer ?? 1, line.lossRate ?? 0,
          line.chinaMaterialCode || null,
          line.materialCategory || null,
          line.spec || null,
          line.unit || "PCS",
          line.name || line.materialCode,
          line.substituteGroup || null,
        ],
      );
    }

    if(status==='active'){
      await client.query(`UPDATE boms SET status='superseded',effective_to=CURRENT_DATE WHERE product_id=$1 AND status='active' AND id<>$2`,[productId,bomId]);
      await client.query(`UPDATE boms SET status='active',effective_from=COALESCE(effective_from,CURRENT_DATE) WHERE id=$1`,[bomId]);
      await client.query(`UPDATE products SET revision=$2,updated_at=NOW() WHERE id=$1`,[productId,revision]);
    }
    await client.query("COMMIT");
    res.status(201).json(mutateEnvelope({ id: bomId }));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /boms:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  } finally {
    client.release();
  }
});

// PATCH /boms/:id/status
app.patch("/boms/:id/status", requirePermission("bom.edit"), async (req, res) => {
  const client=await pgPool.connect();
  try {
    const { id } = req.params;
    const { status } = req.body?.payload ?? {};
    if (!status) return res.status(400).json(errorEnvelope("VALIDATION", "status required"));
    if(!['draft','active','obsolete','superseded'].includes(status))return res.status(422).json(errorEnvelope('BOM_STATUS_INVALID','invalid BOM status'));
    await client.query('BEGIN');
    const current=(await client.query(`SELECT id,product_id,status,revision FROM boms WHERE id=$1 FOR UPDATE`,[id])).rows[0];
    if(!current){await client.query('ROLLBACK');return res.status(404).json(errorEnvelope("NOT_FOUND",`BOM ${id} not found`));}
    if(status==='active'){
      const validation=(await client.query(`SELECT COUNT(*)::int total,
        COUNT(*) FILTER(WHERE bl.qty_per<=0 OR m.domain_code<>'RAW_MATERIAL')::int invalid,
        (COUNT(*)-COUNT(DISTINCT bl.material_id))::int duplicates
        FROM bom_lines bl JOIN materials m ON m.id=bl.material_id WHERE bl.bom_id=$1`,[id])).rows[0];
      if(!validation.total||validation.invalid||validation.duplicates){await client.query('ROLLBACK');return res.status(409).json(errorEnvelope('BOM_ACTIVATION_VALIDATION_FAILED','BOM requires unique RAW_MATERIAL lines with positive quantities'));}
      await client.query(`UPDATE boms SET status='superseded',effective_to=CURRENT_DATE,updated_at=NOW() WHERE product_id=$1 AND status='active' AND id<>$2`,[current.product_id,id]);
      await client.query(`UPDATE products SET revision=$2,updated_at=NOW() WHERE id=$1`,[current.product_id,current.revision]);
    }
    const r = await client.query("UPDATE boms SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id", [status, id]);
    await client.query('COMMIT');
    res.json(mutateEnvelope({ id: Number(id), status }));
  } catch (err) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error("PATCH /boms/:id/status:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  } finally { client.release(); }
});

// PATCH /boms/:id — full BOM update (product info, revision, status, lines)
app.patch("/boms/:id", requirePermission("bom.edit"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    const { id } = req.params;
    const { productCode, productNameZh, productNameEn, productNameVi, revision, status, lines, effectiveFrom, effectiveTo } = req.body?.payload ?? {};
    if (!productCode && !revision && !status && !lines && !effectiveFrom && !effectiveTo) {
      return res.status(400).json(errorEnvelope("VALIDATION", "No fields to update"));
    }

    await client.query("BEGIN");
    const editable=(await client.query(`SELECT status FROM boms WHERE id=$1 FOR UPDATE`,[id])).rows[0];
    if(!editable){await client.query('ROLLBACK');return res.status(404).json(errorEnvelope('NOT_FOUND',`BOM ${id} not found`));}
    if(editable.status!=='draft'){await client.query('ROLLBACK');return res.status(409).json(errorEnvelope('BOM_IMMUTABLE','only draft BOM can be edited; create a new revision'));}

    // Update product info if productCode changed
    if (productCode) {
      const productId = await resolveProductId(productCode);
      await client.query("UPDATE boms SET product_id = $1 WHERE id = $2", [productId, id]);
    }

    // Update basic fields
    const sets = [];
    const params = [];
    let idx = 1;
    if (revision) { sets.push(`revision = $${idx++}`); params.push(revision); }
    if (status) { sets.push(`status = $${idx++}`); params.push(status); }
    if (effectiveFrom) { sets.push(`effective_from = $${idx++}`); params.push(effectiveFrom); }
    if (effectiveTo) { sets.push(`effective_to = $${idx++}`); params.push(effectiveTo); }
    if (sets.length > 0) {
      params.push(id);
      await client.query(`UPDATE boms SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${idx}`, params);
    }

    // Replace lines if provided
    if (lines && lines.length > 0) {
      await client.query("DELETE FROM bom_lines WHERE bom_id = $1", [id]);
      for (const line of lines) {
        const materialId = await resolveMaterialId(line.materialCode, { unit: line.unit });
        const refDes = Array.isArray(line.referenceDesignators)
          ? line.referenceDesignators.join(",")
          : (line.referenceDesignators ?? "");
        const pos = line.position ? [line.position] : (refDes ? refDes.split(",") : []);

        await client.query(
          `INSERT INTO bom_lines (bom_id, material_id, reference_designators, qty_per, loss_rate,
                                  china_material_code, material_category, spec, unit,
                                  material_name_zh, material_name_en, material_name_vi)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$10)`,
          [
            id, materialId,
            pos.join(","),
            line.qtyPer ?? 1,
            line.lossRate ?? 0,
            line.chinaMaterialCode || null,
            line.materialCategory || null,
            line.spec || null,
            line.unit || "PCS",
            line.name || line.materialCode,
          ],
        );
      }
    }

    await client.query("COMMIT");
    res.json(mutateEnvelope({ id: Number(id) }));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("PATCH /boms/:id:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  } finally {
    client.release();
  }
});

// DELETE /boms/:id
app.delete("/boms/:id", requirePermission("bom.edit"), async (req, res) => {
  const client=await pgPool.connect();
  try {
    const { id } = req.params;await client.query('BEGIN');
    const bom=(await client.query(`SELECT status FROM boms WHERE id=$1 FOR UPDATE`,[id])).rows[0];
    if(!bom){await client.query('ROLLBACK');return res.status(404).json(errorEnvelope('NOT_FOUND',`BOM ${id} not found`));}
    if(bom.status!=='draft'){await client.query('ROLLBACK');return res.status(409).json(errorEnvelope('BOM_IMMUTABLE','only draft BOM can be deleted'));}
    await client.query("DELETE FROM bom_lines WHERE bom_id = $1", [id]);
    await client.query("DELETE FROM boms WHERE id = $1", [id]);await client.query('COMMIT');
    res.json(mutateEnvelope({ id: Number(id) }));
  } catch (err) {await client.query('ROLLBACK');
    console.error("DELETE /boms/:id:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }finally{client.release();}
});

// PATCH /bom-lines/:id — update individual BOM line fields (no delete+recreate needed)
app.patch("/bom-lines/:id", requirePermission("bom.edit"), async (req, res) => {
  try {
    const { id } = req.params;
    const { qtyPer, lossRate, referenceDesignators, materialCategory, spec, unit, materialNameZh, materialNameEn, materialNameVi } = req.body?.payload ?? {};

    const sets = [];
    const params = [];
    let idx = 1;

    if (qtyPer !== undefined)            { sets.push(`qty_per = $${idx++}`);             params.push(qtyPer); }
    if (lossRate !== undefined)          { sets.push(`loss_rate = $${idx++}`);           params.push(lossRate); }
    if (referenceDesignators !== undefined) { sets.push(`reference_designators = $${idx++}`); params.push(referenceDesignators); }
    if (materialCategory !== undefined)  { sets.push(`material_category = $${idx++}`);   params.push(materialCategory); }
    if (spec !== undefined)              { sets.push(`spec = $${idx++}`);                 params.push(spec); }
    if (unit !== undefined)              { sets.push(`unit = $${idx++}`);                 params.push(unit); }
    if (materialNameZh !== undefined)    { sets.push(`material_name_zh = $${idx++}`);     params.push(materialNameZh); }
    if (materialNameEn !== undefined)    { sets.push(`material_name_en = $${idx++}`);     params.push(materialNameEn); }
    if (materialNameVi !== undefined)    { sets.push(`material_name_vi = $${idx++}`);     params.push(materialNameVi); }

    if (sets.length === 0) return res.status(400).json(errorEnvelope("VALIDATION", "No fields to update"));
    sets.push(`updated_at = now()`);
    params.push(id);

    const r = await query(
      `UPDATE bom_lines SET ${sets.join(", ")} WHERE id = $${idx} RETURNING id`,
      params,
    );
    if (r.rows.length === 0) return res.status(404).json(errorEnvelope("NOT_FOUND", "BOM line not found"));
    res.json(mutateEnvelope({ id: Number(id) }));
  } catch (err) {
    console.error("PATCH /bom-lines/:id:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// POST /boms/import — import BOM from parsed Excel data
// Payload: { productCode, productName?, revision?, status?, lines: [{ materialCode, chinaMaterialCode?, name?, spec?, unit?, qtyPer, lossRate?, position?, materialCategory? }] }
app.post("/boms/import", requirePermission("bom.edit"), async (req, res) => {
  const client = await pgPool.connect();
  try {
    const {
      productCode,
      productName,
      revision = "V1.0",
      status = "active",
      sourceFileName,
      sourceFingerprint,
      lines = [],
    } = req.body?.payload ?? {};

    if (!productCode) return res.status(400).json(errorEnvelope("VALIDATION", "productCode required"));
    if (lines.length === 0) return res.status(400).json(errorEnvelope("VALIDATION", "lines required"));
    if (!sourceFileName || !/^[a-f0-9]{64}$/i.test(String(sourceFingerprint||"")))
      return res.status(400).json(errorEnvelope("BOM_SOURCE_REQUIRED", "sourceFileName and SHA-256 sourceFingerprint required"));
    const invalid=lines.find(line=>!line.materialCode||!Number.isFinite(Number(line.qtyPer))||Number(line.qtyPer)<=0);
    if(invalid)return res.status(422).json(errorEnvelope("BOM_LINE_INVALID","every BOM material must have a code and positive quantity"));
    const codes=lines.map(line=>String(line.materialCode).trim().toUpperCase());
    const duplicate=codes.find((code,index)=>codes.indexOf(code)!==index);
    if(duplicate)return res.status(409).json(errorEnvelope("BOM_DUPLICATE_MATERIAL",`duplicate material ${duplicate} must be merged or separated by an approved substitute group`));

    await client.query("BEGIN");

    // Upsert product with name if provided
    let productId;
    if (productName) {
      const pR = await client.query(
        `INSERT INTO products (code, name_zh, name_en, name_vi, revision, status, domain_code)
         VALUES ($1, $2, $2, $2, $3, 'active', 'FINISHED_GOODS')
         ON CONFLICT (code) DO UPDATE SET name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en, name_vi = EXCLUDED.name_vi
         RETURNING id`,
        [productCode, productName, revision],
      );
      productId = pR.rows[0].id;
    } else {
      productId = (await resolveProductId(productCode));
    }

    // Same product+revision is immutable. Exact repeats are idempotent; changed
    // content becomes a review request and can never silently overwrite history.
    const existingR = await client.query(
      "SELECT id,source_fingerprint FROM boms WHERE product_id = $1 AND revision = $2",
      [productId, revision],
    );
    if (existingR.rows.length > 0) {
      const existing=existingR.rows[0];
      if(existing.source_fingerprint===sourceFingerprint){await client.query("COMMIT");return res.json(mutateEnvelope({id:existing.id,idempotent:true}));}
      const change=await client.query(`INSERT INTO bom_import_change_requests
        (product_id,existing_bom_id,requested_revision,source_file_name,source_fingerprint,proposed_payload,requested_by)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(product_id,requested_revision,source_fingerprint)
        DO UPDATE SET source_file_name=EXCLUDED.source_file_name RETURNING id`,[productId,existing.id,revision,
          sourceFileName,sourceFingerprint,JSON.stringify({productCode,productName,revision,status,lines}),req.user?.id||null]);
      await client.query("COMMIT");return res.status(409).json(errorEnvelope("BOM_REVISION_CONTENT_CONFLICT",
        `same revision has different content; review request ${change.rows[0].id} created`));
    }

    // Create new BOM
    const bomR = await client.query(
      `INSERT INTO boms (product_id, revision, status,source_file_name,source_fingerprint,source_imported_at)
       VALUES ($1, $2, 'draft',$3,$4,NOW()) RETURNING id`,
      [productId, revision,sourceFileName,sourceFingerprint],
    );
    const bomId = bomR.rows[0].id;

    // Insert all lines
    for (const line of lines) {
      const materialId = await resolveMaterialId(line.materialCode, { unit: line.unit || "PCS" });
      const refDes = line.position ? [line.position] : (line.referenceDesignators ?? []);

      await client.query(
        `INSERT INTO bom_lines (bom_id, material_id, reference_designators, qty_per, loss_rate,
                                china_material_code, material_category, spec, unit,
                                material_name_zh, material_name_en, material_name_vi,
                                process_stage, process_domain)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$10,$11,$12)`,
        [
          bomId, materialId,
          refDes.join(","),
          line.qtyPer ?? 1,
          line.lossRate ?? 0,
          line.chinaMaterialCode || null,
          line.materialCategory || null,
          line.spec || null,
          line.unit || "PCS",
          line.name || line.materialCode,
          line.processStage || null,
          line.processDomain || null,
        ],
      );
    }

    if(status==='active'){
      await client.query(`UPDATE boms SET status='superseded',effective_to=CURRENT_DATE WHERE product_id=$1 AND status='active' AND id<>$2`,[productId,bomId]);
      await client.query(`UPDATE boms SET status='active',effective_from=CURRENT_DATE WHERE id=$1`,[bomId]);
      await client.query(`UPDATE products SET revision=$2,updated_at=NOW() WHERE id=$1`,[productId,revision]);
    }
    await client.query("COMMIT");
    res.status(201).json(mutateEnvelope({ id: bomId }));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /boms/import:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  } finally {
    client.release();
  }
});

// GET /boms/:id/history
app.get("/boms/:id/history", async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await query(
      `SELECT beh.id, beh.bom_id AS "bomId", beh.action, beh.operator_id AS "operatorId",
              beh.operator_name AS "operatorName", beh.operated_at AS "operatedAt",
              beh.source, beh.snapshot, beh.change_summary AS "changeSummary"
       FROM bom_edit_history beh
       WHERE beh.bom_id = $1
       ORDER BY beh.operated_at DESC`,
      [id],
    );
    res.json(envelope(rows.rows));
  } catch (err) {
    console.error("GET /boms/:id/history:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// POST /boms/:id/history — record edit history entry
app.post("/boms/:id/history", requirePermission("bom.edit"), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      action, source, snapshot, changeSummary,
      operatorName = "operator",
    } = req.body?.payload ?? {};

    if (!action || !source) {
      return res.status(400).json(errorEnvelope("VALIDATION", "action and source required"));
    }

    const r = await query(
      `INSERT INTO bom_edit_history (bom_id, action, source, snapshot, operator_name, change_summary)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, bom_id AS "bomId", action, source, operator_name AS "operatorName",
                 operated_at AS "operatedAt", change_summary AS "changeSummary"`,
      [id, action, source, JSON.stringify(snapshot), operatorName, changeSummary || null],
    );
    res.status(201).json(mutateEnvelope(r.rows[0]));
  } catch (err) {
    console.error("POST /boms/:id/history:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});
}

export function registerBomChangeRequestsRoutes(app, deps) {
  const { pgPool, requirePermission } = deps;

app.get("/bom-import-change-requests", requirePermission("bom.view"), async(req,res)=>{
  try{const status=String(req.query.status||'PENDING_REVIEW');const r=await query(`SELECT c.id,p.code AS "productCode",
    b.revision AS "existingRevision",c.requested_revision AS "requestedRevision",c.source_file_name AS "sourceFileName",
    c.source_fingerprint AS "sourceFingerprint",c.status,c.requested_at AS "requestedAt",c.reviewed_at AS "reviewedAt",
    c.review_note AS "reviewNote",jsonb_array_length(c.proposed_payload->'lines') AS "lineCount"
    FROM bom_import_change_requests c JOIN products p ON p.id=c.product_id JOIN boms b ON b.id=c.existing_bom_id
    WHERE ($1='ALL' OR c.status=$1) ORDER BY c.requested_at DESC LIMIT 500`,[status]);res.json(envelope({items:r.rows,total:r.rowCount}));
  }catch(error){res.status(500).json(errorEnvelope('BOM_CHANGE_QUERY_FAILED',error.message));}
});

app.post("/bom-import-change-requests/:id/decision", requirePermission("bom.edit"), async(req,res)=>{
  const client=await pgPool.connect();
  try{const decision=String(req.body?.decision||'').toUpperCase(),note=String(req.body?.note||'').trim();
    if(!['APPROVE','REJECT'].includes(decision)||!note)return res.status(400).json(errorEnvelope('VALIDATION','decision and review note required'));
    await client.query('BEGIN');const request=(await client.query(`SELECT * FROM bom_import_change_requests WHERE id=$1 AND status='PENDING_REVIEW' FOR UPDATE`,[req.params.id])).rows[0];
    if(!request){await client.query('ROLLBACK');return res.status(409).json(errorEnvelope('INVALID_STATE','request is not pending review'));}
    if(decision==='REJECT'){await client.query(`UPDATE bom_import_change_requests SET status='REJECTED',reviewed_by=$2,reviewed_at=NOW(),review_note=$3 WHERE id=$1`,[request.id,req.user?.id||null,note]);await client.query('COMMIT');return res.json(mutateEnvelope({id:request.id,status:'REJECTED'}));}
    const newRevision=String(req.body?.newRevision||'').trim();if(!newRevision||newRevision===request.requested_revision){await client.query('ROLLBACK');return res.status(422).json(errorEnvelope('NEW_BOM_REVISION_REQUIRED','approved changed content must use a new revision'));}
    const payload=request.proposed_payload,exists=await client.query(`SELECT 1 FROM boms WHERE product_id=$1 AND revision=$2`,[request.product_id,newRevision]);
    if(exists.rows.length){await client.query('ROLLBACK');return res.status(409).json(errorEnvelope('BOM_REVISION_EXISTS','new revision already exists'));}
    await client.query(`UPDATE boms SET status='superseded',effective_to=CURRENT_DATE WHERE product_id=$1 AND status='active'`,[request.product_id]);
    const bom=(await client.query(`INSERT INTO boms(product_id,revision,status,effective_from,source_file_name,source_fingerprint,source_imported_at)
      VALUES($1,$2,'draft',CURRENT_DATE,$3,$4,NOW()) RETURNING id`,[request.product_id,newRevision,request.source_file_name,request.source_fingerprint])).rows[0];
    for(const line of payload.lines){let material=(await client.query(`SELECT id FROM materials WHERE UPPER(code)=UPPER($1) OR UPPER(COALESCE(vietnam_code,''))=UPPER($1) LIMIT 1`,[line.materialCode])).rows[0];
      if(!material)material=(await client.query(`INSERT INTO materials(code,vietnam_code,name_zh,name_en,name_vi,uom,material_type,status,domain_code)
        VALUES($1,$2,$3,$3,$3,$4,'component','active','RAW_MATERIAL') RETURNING id`,[line.materialCode,/^R0\d{3}/.test(line.materialCode)?line.materialCode:null,line.name||line.materialCode,line.unit||'PCS'])).rows[0];
      await client.query(`INSERT INTO bom_lines(bom_id,material_id,reference_designators,qty_per,loss_rate,china_material_code,material_category,spec,unit,material_name_zh,material_name_en,material_name_vi)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$10)`,[bom.id,material.id,line.position||'',line.qtyPer,line.lossRate||0,line.chinaMaterialCode||null,line.materialCategory||null,line.spec||null,line.unit||'PCS',line.name||line.materialCode]);}
    await client.query(`UPDATE boms SET status='active' WHERE id=$1`,[bom.id]);
    await client.query(`UPDATE products SET revision=$2,updated_at=NOW() WHERE id=$1`,[request.product_id,newRevision]);
    await client.query(`UPDATE bom_import_change_requests SET status='APPLIED',reviewed_by=$2,reviewed_at=NOW(),review_note=$3 WHERE id=$1`,[request.id,req.user?.id||null,note]);
    await client.query('COMMIT');res.json(mutateEnvelope({id:request.id,status:'APPLIED',bomId:bom.id,newRevision}));
  }catch(error){await client.query('ROLLBACK');res.status(409).json(errorEnvelope('BOM_CHANGE_DECISION_FAILED',error.message));}finally{client.release();}
});
}

