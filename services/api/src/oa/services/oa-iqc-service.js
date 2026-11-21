// ============================================================
// oa-iqc-service —— OA 侧 IQC 来料检验（结构化版）
//
// 与旧版的区别（2026-10-22 重建）：
//   旧版：ipqc_template 富文本 + 一段 content + 单一结论；
//   新版：**沿用当前 OA 的模板库建模**（iqc_template / iqc_template_item /
//         iqc_standard_item / iqc_template_material，见 sql/80），
//         逐项录入 n 个实测值 → 本地 spec 判定 → Ac/Re 推导 → 结构化报告。
//
// 边界（规格 §2.1，不可越界）：
//   · OA 是「判定与审批」的主人：模板维护、待检任务、录入、抽样推定、判定、报告、审批；
//   · WMS 是「库存与批次」的主人：批次生成、库存迁移、欠料冲减、MRB 建单、严格度；
//   · **OA 绝不直接改库存**，落账只通过 WMS /api/oa/iqc/approve 完成。
//
// 三条纪律：
//   1) 幂等靠 WMS 的 CAS：重复回填会拿到 409，OA 据此提示"已在 WMS 处理"；
//   2) 状态只由本侧写：mirror.status 归 OA，WMS 的 iqc_lot.status 归 WMS；
//   3) 报告一旦提交，项目属性全部是快照（规格 §3.2.7 快照原则）。
// ============================================================
import { many, one, query, transaction } from '../db/index.js';
import { wmsCall } from './wms-client.js';
import { createInstance, submitInstance } from './flow-engine.js';
import { toInt } from '../utils/params.js';
import { planForItem, planForAppearance, normalizeLevel } from './qc-sampling.js';
import { judgeItem, judgeBatch, normalizeDefectType, DEFECT_TYPES } from './qc-judge.js';

const CLAIM_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * 「已提交过」的审批态。规格记忆只认这些记录（用户 2026-10-23 确认）：
 * 草稿里的半成品/试填如果参与记忆，会把下一批的标准带歪。
 * returned = 被驳回退回，但它确实提交过，规格是检验员确认过的，算数。
 */
const SUBMITTED_APPROVALS = ['running', 'approved', 'returned'];

const SECTION_LABEL = {
  packaging: '包装', appearance: '外观', dimension: '尺寸&功能',
  reliability: '可靠性', environmental: '环保',
};
const SECTION_ORDER = ['packaging', 'appearance', 'dimension', 'reliability', 'environmental'];

function bad(msg, statusCode = 400) {
  return Object.assign(new Error(msg), { statusCode, isBiz: true });
}

/** 报告号：优先沿用 WMS 的检验编号（WMS 口径：IQC 报告编号即 inspection_no） */
function reportNoOf(mirror, recordId) {
  if (mirror.inspection_no) return mirror.inspection_no;
  const d = new Date(mirror.receipt_date || Date.now()).toISOString().slice(0, 10).replace(/-/g, '');
  return `JY${d}${String(recordId).padStart(4, '0')}`;
}

/**
 * 物料当前严格度：WMS 主责，OA 只消费推送里的快照（规格 §2.1 / §7）。
 *
 * ⚠️ 必须原样保留 `suspended` / `exempt`，不能"不认识就当 normal"：
 * suspended 是质量体系里唯一一道"停线别检了"的闸门（§9 V-10），
 * 静默归一成 normal 的后果是——照常推定抽样、照常提交、照常判合格落账，
 * 而且不报错，事后完全查不出来（产品评审定级：高于所有其它缺陷）。
 *
 * 口径窗口：这里的严格度是 WMS 推送那一刻的快照，认领到提交之间可能已变化。
 * 本轮按"快照 + 提交时校验"处理；实时回查 WMS 列为 P1（见交付报告）。
 */
function strictnessOf(lot) {
  const s = lot?.sampling?.strictness;
  return ['normal', 'tightened', 'reduced', 'suspended', 'exempt'].includes(s) ? s : 'normal';
}

/**
 * 工段 → 录入形态。`iqc_template_item` 表没有 value_type 列（见 sql/80），
 * 所以类型只能由工段推断：
 *   dimension                        → 多值实测（measure），逐格录实测值
 *   packaging / appearance /
 *   reliability / environmental      → 不良数（count）
 *
 * 2026-10-23 按用户要求：可靠性&安规、环保两项也改成「录不良数」，
 * 不再用 OK/NG 单选（原来的 attribute 形态在这两个工段上只会产出 0/1，
 * 与 Ac/Re 的判定口径对不齐：抽 2 件坏 2 件和坏 1 件都被压成 1）。
 */
function inferValueType(sectionType) {
  if (sectionType === 'dimension') return 'measure';
  return 'count';
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------
 * 一、入站：WMS 推送待检批次
 * ---------------------------------------------------------- */
export async function receiveLot(payload, meta = {}) {
  const lot = payload?.lot || payload?.data?.lot || {};
  const lotNo = String(lot.lotNo || payload?.bizKey || '').trim();
  if (!lotNo) throw bad('payload.lot.lotNo 必填');

  // 1) 幂等：同一批次只处理一次（唯一键兜底，重复推送直接返回 duplicated）
  const ins = await query(
    `INSERT INTO iqc_event_inbox (event, biz_key, payload, status)
     VALUES ($1,$2,$3,'done')
     ON CONFLICT (event, biz_key) DO NOTHING
     RETURNING id`,
    [payload?.event || 'lot.created', lotNo, JSON.stringify(payload || {})]
  );
  if (ins.rowCount === 0) {
    const cur = await one(`SELECT id, status FROM iqc_lot_mirror WHERE lot_no = $1`, [lotNo]);
    return { mirrorId: cur?.id || null, status: 'duplicated', existingStatus: cur?.status || null };
  }

  // 2) 落镜像（重复推送若已存在，只更新 WMS 侧快照字段，不动 OA 状态）
  const sampling = payload?.sampling || null;
  const row = await one(
    `INSERT INTO iqc_lot_mirror
       (lot_no, inspection_no, receipt_date, supplier_code, supplier_name,
        material_code, material_name, material_type, material_spec,
        qty, unit, batch_no, locations, sampling, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (lot_no) DO UPDATE SET
       inspection_no = COALESCE(EXCLUDED.inspection_no, iqc_lot_mirror.inspection_no),
       receipt_date  = COALESCE(EXCLUDED.receipt_date,  iqc_lot_mirror.receipt_date),
       supplier_code = COALESCE(EXCLUDED.supplier_code, iqc_lot_mirror.supplier_code),
       supplier_name = COALESCE(EXCLUDED.supplier_name, iqc_lot_mirror.supplier_name),
       material_code = COALESCE(EXCLUDED.material_code, iqc_lot_mirror.material_code),
       material_name = COALESCE(EXCLUDED.material_name, iqc_lot_mirror.material_name),
       material_type = COALESCE(EXCLUDED.material_type, iqc_lot_mirror.material_type),
       material_spec = COALESCE(EXCLUDED.material_spec, iqc_lot_mirror.material_spec),
       qty           = COALESCE(EXCLUDED.qty,           iqc_lot_mirror.qty),
       unit          = COALESCE(EXCLUDED.unit,          iqc_lot_mirror.unit),
       batch_no      = COALESCE(EXCLUDED.batch_no,      iqc_lot_mirror.batch_no),
       locations     = COALESCE(EXCLUDED.locations,     iqc_lot_mirror.locations),
       sampling      = COALESCE(EXCLUDED.sampling,      iqc_lot_mirror.sampling),
       payload       = EXCLUDED.payload,
       updated_at    = now()
     RETURNING *`,
    [
      lotNo,
      lot.inspectionNo || null,
      lot.receiptDate || null,
      lot.supplier?.code || null,
      lot.supplier?.name || null,
      lot.material?.code || null,
      lot.material?.name || null,
      lot.material?.type || null,
      lot.material?.spec || null,
      lot.qty ?? null,
      lot.unit || null,
      lot.batchNo || null,
      lot.locations ? JSON.stringify(lot.locations) : null,
      sampling ? JSON.stringify(sampling) : null,
      JSON.stringify(payload || {}),
    ]
  );

  // 3) 自动匹配模板：物料绑定 → 该库最新启用的 IQC 模板
  const tpl = await matchTemplate(row);
  if (tpl) {
    await query(`UPDATE iqc_lot_mirror SET template_id = $1, updated_at = now() WHERE id = $2`, [tpl.id, row.id]);
    row.template_id = tpl.id;
  }

  return { mirrorId: row.id, status: 'pending', templateId: row.template_id || null, source: meta.source || 'wms' };
}

/** 可选的 IQC 模板清单（现场选模板用）：只列启用中的，带项目数便于判断 */
export async function listIqcTemplates() {
  return many(
    `SELECT t.id, t.template_code, t.template_name, t.version,
            count(i.id)::int AS item_count
       FROM iqc_template t
       LEFT JOIN iqc_template_item i ON i.template_id = t.id
      WHERE t.library_scope = 'iqc' AND t.status = 'active'
      GROUP BY t.id
      ORDER BY t.updated_at DESC, t.id DESC`
  );
}

/**
 * 取「该物料上一次检验」的规格（用户 2026-10-23 需求）：
 * 模板只做框架，规格在首次检验时录入；下次同物料自动带入，形成“越用越准”。
 *
 * 三个口径：
 *   · 只认已提交过的记录（草稿不参与），避免半成品污染标准；
 *   · 按「模板项目 id」优先匹配，模板改版导致 id 变化时按「工段+项目名」兜底；
 *   · 每个项目取最近一次非空规格（ORDER BY 后 first-wins）。
 */
async function loadLastSpecs(materialCode) {
  const byItemId = new Map();
  const byName = new Map();
  const code = String(materialCode || '').trim();
  if (!code) return { byItemId, byName };

  const rows = await many(
    `SELECT ri.template_item_id, ri.section_type, ri.item_name, ri.spec, ri.unit,
            r.inspected_at
       FROM iqc_record_item ri
       JOIN iqc_record r ON r.id = ri.record_id
       JOIN iqc_lot_mirror m ON m.lot_no = r.lot_no
      WHERE m.material_code = $1
        AND r.approval = ANY($2::text[])
        AND ri.spec IS NOT NULL AND btrim(ri.spec) <> ''
      ORDER BY r.inspected_at DESC NULLS LAST, ri.id DESC
      LIMIT 500`,
    [code, SUBMITTED_APPROVALS]
  );
  for (const r of rows) {
    if (r.template_item_id && !byItemId.has(Number(r.template_item_id))) {
      byItemId.set(Number(r.template_item_id), r);
    }
    const k = `${r.section_type}|${r.item_name}`;
    if (!byName.has(k)) byName.set(k, r);
  }
  return { byItemId, byName };
}

/**
 * 模板匹配（规格 §3.2.4 / §9 V-18）：
 *   **只认物料绑定** iqc_template_material → 未绑定返回 null，由打开检验单时阻断。
 *
 * ⚠️ 这里刻意不兜底"取该库最新启用的模板"：库里有 1 条模板时，任何新物料都会被
 * 套上那条模板（今天就是"变压器"的 7 个项目去检塑料件），而后果是
 * **用错误的标准产出合规的合格结论** —— 比让检验员先绑一次模板的代价高得多。
 * 驳回兜底的裁决记录见 deliverables/gstack/ 报告与规格 §3.2.4 的冲突说明。
 */
async function matchTemplate(mirror) {
  const code = String(mirror.material_code || '').trim();
  if (!code) return null;
  return one(
    `SELECT t.id, t.template_name
       FROM iqc_template_material m
       JOIN iqc_template t ON t.id = m.template_id
      WHERE m.material_code = $1 AND t.status = 'active' AND t.library_scope = 'iqc'
      ORDER BY t.updated_at DESC, t.id DESC LIMIT 1`,
    [code]
  );
}

/* ------------------------------------------------------------
 * 二、查询
 * ---------------------------------------------------------- */
export async function listLots({ status, keyword, page = 1, size = 20 } = {}) {
  const p = Math.max(1, Number(page) || 1);
  const s = Math.min(100, Math.max(1, Number(size) || 20));
  const where = [];
  const params = [];
  // wms_closed = WMS 侧已处理完、OA 从未介入的批次（见 wms-iqc-pull.closeFinishedInWms）。
  // 默认过滤：不滤的话页面会积压一堆「其实 WMS 早检完了」的假待检。
  if (status !== 'wms_closed') where.push(`m.status <> 'wms_closed'`);
  if (status && status !== 'all') {
    params.push(status);
    where.push(`m.status = $${params.length}`);
  }
  if (keyword) {
    params.push(`%${String(keyword).trim()}%`);
    const i = params.length;
    where.push(`(m.lot_no ILIKE $${i} OR COALESCE(m.inspection_no,'') ILIKE $${i}
                OR COALESCE(m.material_code,'') ILIKE $${i} OR COALESCE(m.material_name,'') ILIKE $${i}
                OR COALESCE(m.supplier_name,'') ILIKE $${i})`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = Number((await one(`SELECT count(*)::int AS c FROM iqc_lot_mirror m ${w}`, params))?.c || 0);
  params.push(s, (p - 1) * s);
  const list = await many(
    `SELECT m.*, u.real_name AS claimed_by_name,
            t.template_name,
            r.id AS record_pk, r.report_no, r.approval, r.result AS record_result,
            r.wms_synced, r.instance_id, r.manual_required, r.backfill_attempts,
            r.wms_sync_error,
            CASE WHEN m.claimed_at IS NULL THEN NULL
                 ELSE CEIL(EXTRACT(EPOCH FROM (m.claimed_at + interval '4 hours' - now())) / 60)::int
            END AS claim_left_min
       FROM iqc_lot_mirror m
       LEFT JOIN org_user u ON u.id = m.claimed_by
       LEFT JOIN iqc_template t ON t.id = m.template_id
       LEFT JOIN iqc_record r ON r.id = m.record_id
       ${w}
      ORDER BY CASE m.status WHEN 'pending' THEN 0 WHEN 'inspecting' THEN 1 ELSE 2 END,
               m.receipt_date DESC NULLS LAST, m.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return { list, total, page: p, size: s };
}

export async function getLot(id) {
  const row = await one(
    `SELECT m.*, u.real_name AS claimed_by_name, t.template_name,
            r.id AS record_pk, r.report_no, r.result AS record_result,
            r.approval, r.instance_id, r.wms_synced, r.wms_sync_error
       FROM iqc_lot_mirror m
       LEFT JOIN org_user u ON u.id = m.claimed_by
       LEFT JOIN iqc_template t ON t.id = m.template_id
       LEFT JOIN iqc_record r ON r.id = m.record_id
      WHERE m.id = $1`,
    [id]
  );
  if (!row) throw bad('待检批次不存在', 404);
  return row;
}

/** 取批次可用的检验模板（含项目清单）；没有则抛 V-18 */
/**
 * 解析本次使用的模板。
 * @param {object} lot
 * @param {object} opts { templateId }  检验员现场选定/更换的模板
 * @returns {{tpl, items}|null}  null = 该物料还没定过模板（由调用方引导现场选择）
 *
 * 「记住」的语义（用户 2026-10-23 确认）：现场选定即写物料绑定，且**替换该物料的旧绑定**。
 * 一个物料同时挂多个 IQC 模板时，「下次用哪个」就变成按更新时间的偶然结果 —— 那不是"记住"。
 */
async function resolveTemplate(lot, opts = {}) {
  let tpl = null;
  const pickedId = Number(opts.templateId) || null;

  if (pickedId) {
    tpl = await one(
      `SELECT * FROM iqc_template WHERE id = $1 AND status = 'active' AND library_scope = 'iqc'`, [pickedId]
    );
    if (!tpl) throw bad('所选检验模板不存在或已停用', 404);
    const code = String(lot.material_code || '').trim();
    if (code) {
      await query(`DELETE FROM iqc_template_material WHERE material_code = $1`, [code]);
      await query(
        `INSERT INTO iqc_template_material (template_id, material_code, created_by)
         VALUES ($1,$2,$3) ON CONFLICT (template_id, material_code) DO NOTHING`,
        [tpl.id, code, lot.claimed_by || null]
      );
    }
    // 用量大的物料，把选择记回镜像，列表里能直接看到用的是哪份模板
    await query(`UPDATE iqc_lot_mirror SET template_id = $2, updated_at = now() WHERE id = $1`, [lot.id, tpl.id]);
  } else {
    if (lot.template_id) {
      tpl = await one(`SELECT * FROM iqc_template WHERE id = $1 AND status = 'active'`, [lot.template_id]);
    }
    if (!tpl) tpl = await matchTemplate(lot);
  }

  if (!tpl) return null;

  const items = await many(
    `SELECT * FROM iqc_template_item WHERE template_id = $1
      ORDER BY array_position(ARRAY['packaging','appearance','dimension','reliability','environmental']::varchar[], section_type),
               sort_order, id`,
    [tpl.id]
  );
  return { tpl, items };
}

/**
 * 打开检验单（规格 §4 第 5 步）：模板 → 项目快照 → 抽样推定 → 已有草稿/记录。
 * 抽样推定在**服务端**算，前端只渲染（Ac/Re 不得存前端，§14 禁止事项）。
 */
export async function getSheet(lotId, opts = {}) {
  const lot = await getLot(lotId);
  // V-10 闸门之"开单"：暂停检验的物料连检验单都不该打开。
  // 为什么拦在这里而不是只拦提交：WMS 的错误文案不会透传到界面（wmsCall 会包成
  // "调用 WMS 失败"），用户看到的是"系统坏了"而不是"规则不允许"，
  // 拦得越晚越会促使人回 WMS 直接操作，把好不容易收敛的双入口又打开。
  if (strictnessOf(lot) === 'suspended') {
    throw bad('该物料检验已暂停（严格度 suspended），不能开检验单。请品质主管确认供应方改进后恢复加严检验。', 409);
  }
  if (['approved', 'void'].includes(lot.status)) {
    // 已完成的批次仍允许看（只读），模板可能已被改版 → 用记录里的快照兜底
  }
  const resolved = await resolveTemplate(lot, opts);
  if (!resolved) {
    // 没有模板不是异常，是"还没定框架"——把可选清单一起给前端，现场选完即记住
    return {
      lot,
      needsTemplate: true,
      templates: await listIqcTemplates(),
      template: null,
      strictness: strictnessOf(lot),
      lotSize: Number(lot.qty) || 0,
      sections: [],
      record: null,
    };
  }
  const { tpl, items } = resolved;
  const lastSpecs = await loadLastSpecs(lot.material_code);
  const strictness = strictnessOf(lot);
  const lotSize = Number(lot.qty) || 0;
  // 暂停/免检状态下国标表不再适用，抽样沿用模板行内值（提交时会被 V-10 拦住）

  const sections = SECTION_ORDER
    .map((type) => {
      const rows = items
        .filter((it) => it.section_type === type)
        .map((it) => {
          // 外观段要按「重缺陷 / 轻缺陷」两个 AQL 各算一次 Ac/Re（共用同一批样本）
          const plan = it.section_type === 'appearance'
            ? planForAppearance(it, lotSize, strictness)
            : planForItem(it, lotSize, strictness);
          // 规格三级优先：该物料上次检验录的 > 模板自带 > 空（待本次录入）
          const last = lastSpecs.byItemId.get(Number(it.id))
            || lastSpecs.byName.get(`${it.section_type}|${it.item_name}`);
          const spec = (last?.spec && String(last.spec).trim()) || (it.spec && String(it.spec).trim()) || null;
          return {
            item_id: it.id,
            section_type: it.section_type,
            item_name: it.item_name,
            item_name_vi: it.item_name_vi,
            item_name_en: it.item_name_en,
            standard: it.standard,
            spec,
            spec_source: last?.spec ? 'last' : (it.spec ? 'template' : 'none'),
            spec_last_at: last?.inspected_at || null,
            template_spec: it.spec || null,
            unit: last?.unit || it.unit,
            value_type: it.value_type || inferValueType(it.section_type),
            aql: it.aql,
            aql_minor: it.aql_minor || null,
            ac_minor: plan.minor ? plan.minor.ac : null,
            re_minor: plan.minor ? plan.minor.re : null,
            sampling_plan_text: it.sampling_plan_text || plan.planText || null,
            // ⚠️ 顶层 n/Ac/Re 一律回填**生效值**（= plan 的推定结果），不是模板行内值。
            // 模板行内值另存 template_* 供追溯。原因：前端按 `sample_size ?? plan.sampleSize`
            // 取值、后端按 plan.ac 判定，两处只要有一处优先行内值，界面和判定就会用两套阈值
            // （模板行 ac=0 而查表 ac=1 时，检验员按 0 判、服务端按 1 判，结论直接相反）。
            sample_size: plan.sampleSize,
            ac: plan.ac,
            re: plan.re,
            template_sample_size: it.sample_size,
            template_ac: it.ac,
            template_re: it.re,
            is_required: it.is_required,
            sort_order: it.sort_order,
            plan: {
              sampleSize: plan.sampleSize,
              ac: plan.ac,
              re: plan.re,
              level: plan.inspectionLevel || null,
              codeLetter: plan.codeLetter || null,
              aql: plan.aql || it.aql || null,
              planText: plan.planText || it.sampling_plan_text || null,
              applied: plan.applied !== false,
              strictness: plan.strictness,
              fullInspection: !!plan.fullInspection,
              fallback: !!plan.fallback,
              minor: plan.minor || null,
            },
          };
        });
      return { section_type: type, label: SECTION_LABEL[type], items: rows };
    })
    .filter((sec) => sec.items.length > 0);

  let record = null;
  if (lot.record_id) {
    const rec = await one(`SELECT * FROM iqc_record WHERE id = $1`, [lot.record_id]);
    if (rec) {
      const recItems = await many(
        `SELECT * FROM iqc_record_item WHERE record_id = $1 ORDER BY sort_order, id`, [rec.id]
      );
      record = { ...rec, items: recItems };
    }
  }

  return {
    lot,
    // 免检（exempt）：规格 §7.1 要求「不生成检验任务」。本轮只做**标记透出**（页面显示"免检"），
    // 自动走免检关闭需要 WMS 侧一个"免检放行"契约，尚未定义 → P1，见交付报告规格回写清单 #8。
    // 注意不能把它当 suspended 拦掉：该免的照检，等于把免检物料卡死在待检区，比不拦更糟。
    exempt: strictness === 'exempt',
    suspended: strictness === 'suspended',
    template: {
      id: tpl.id,
      template_code: tpl.template_code,
      template_name: tpl.template_name,
      version: tpl.version,
      selected_sections: tpl.selected_sections,
      packaging_aql: tpl.packaging_aql,
      appearance_level: tpl.appearance_level,
      appearance_aql: tpl.appearance_aql,
      dimension_level: tpl.dimension_level,
      dimension_aql: tpl.dimension_aql,
      reliability_sample_size: tpl.reliability_sample_size,
      environmental_sample_size: tpl.environmental_sample_size,
    },
    strictness,
    lotSize,
    sections,
    record,
  };
}

/* ------------------------------------------------------------
 * 三、认领 / 释放（双入口防冲突）
 * ---------------------------------------------------------- */
export async function claimLot(id, user) {
  const cur = await one(`SELECT * FROM iqc_lot_mirror WHERE id = $1`, [id]);
  if (!cur) throw bad('待检批次不存在', 404);
  if (cur.status !== 'pending') throw bad(`当前状态（${cur.status}）不能认领`);
  // V-10 闸门之"认领"：暂停检验的物料不该再进入任何人的手上
  if (strictnessOf(cur) === 'suspended') {
    throw bad('该物料检验已暂停（严格度 suspended），不能认领。请品质主管确认后恢复。', 409);
  }
  const expired = cur.claimed_at && Date.now() - new Date(cur.claimed_at).getTime() > CLAIM_TTL_MS;
  if (cur.claimed_by && !expired) {
    if (Number(cur.claimed_by) === Number(user.id)) return { ok: true, alreadyMine: true };
    throw bad('该批次已被他人认领（4 小时后自动释放）', 409);
  }

  // 先通知 WMS 加锁：WMS 拒绝（例如已在 WMS 开检）就直接失败，不改本地状态
  const r = await wmsCall('claim', '/api/oa/iqc/claim', {
    lotNo: cur.lot_no, by: String(user.real_name || user.username || user.id),
  });

  await query(
    `UPDATE iqc_lot_mirror
        SET claimed_by = $1, claimed_at = now(), status = 'inspecting', updated_at = now()
      WHERE id = $2`,
    [user.id, id]
  );
  return { ok: true, wmsClaimed: !!r?.ok };
}

export async function releaseLot(id, user) {
  const cur = await one(`SELECT * FROM iqc_lot_mirror WHERE id = $1`, [id]);
  if (!cur) throw bad('待检批次不存在', 404);
  if (cur.claimed_by && Number(cur.claimed_by) !== Number(user.id) && !user.isAdmin) {
    throw bad('只能释放自己认领的批次', 403);
  }
  await wmsCall('release', '/api/oa/iqc/release', { lotNo: cur.lot_no });
  await query(
    `UPDATE iqc_lot_mirror SET claimed_by = NULL, claimed_at = NULL,
            status = CASE WHEN status = 'inspecting' THEN 'pending' ELSE status END,
            updated_at = now()
      WHERE id = $1`,
    [id]
  );
  return { ok: true };
}

/* ------------------------------------------------------------
 * 四、录入（草稿）
 * ---------------------------------------------------------- */
/**
 * 保存检验草稿。
 * body: { items:[{ item_id, measured_value, measured_values[], defect_qty, defect_description }],
 *         defectType, remark, templateId }
 *
 * 判定全部在服务端算（§9 V-07：前端传的结论只作参考），逐项 is_pass 与批次结论
 * 都由「快照 spec + 实测值 + Ac」推导，前端只负责显示。
 */
export async function saveRecord(lotId, body = {}, user) {
  const lot = await one(`SELECT * FROM iqc_lot_mirror WHERE id = $1`, [lotId]);
  if (!lot) throw bad('待检批次不存在', 404);
  if (['approved', 'void'].includes(lot.status)) throw bad('该批次已完成，不能再修改检验记录');

  // 归属校验（安全审计 #6）：批次被别人认领时，只有认领人/管理员能写，
  // 否则「谁都能改别人的检验单」，认领就形同虚设。
  if (lot.claimed_by && Number(lot.claimed_by) !== Number(user?.id) && !user?.isAdmin) {
    const owner = await one(`SELECT real_name FROM org_user WHERE id = $1`, [lot.claimed_by]);
    throw bad(`该批次由 ${owner?.real_name || '他人'} 认领，请联系其释放后再录入`, 403);
  }

  const { tpl, items: tplItems } = await resolveTemplate(lot);
  const strictness = strictnessOf(lot);
  const lotSize = Number(lot.qty) || 0;
  const byId = new Map(tplItems.map((it) => [Number(it.id), it]));

  const rec = lot.record_id ? await one(`SELECT * FROM iqc_record WHERE id = $1`, [lot.record_id]) : null;
  if (rec && rec.approval !== 'draft' && rec.approval !== 'returned') {
    throw bad('该记录已提交审批，不能直接修改');
  }

  // 逐项：快照 + 服务端判定
  const input = Array.isArray(body.items) ? body.items : [];
  const built = [];
  let sort = 0;
  for (const row of input) {
    const t = byId.get(Number(row.item_id));
    if (!t) continue; // 模板已删除的行直接丢弃（不污染报告）
    const plan = t.section_type === 'appearance'
      ? planForAppearance(t, lotSize, strictness)
      : planForItem(t, lotSize, strictness);
    const valueType = t.value_type || inferValueType(t.section_type);
    // 规格以本次录入为准（模板只提供框架）；空则回落到模板/上次值
    const spec = row.spec === undefined || row.spec === null
      ? (t.spec || null)
      : (String(row.spec).trim() || null);
    const measuredValues = Array.isArray(row.measured_values) ? row.measured_values : [];
    const measuredValue = row.measured_value === undefined ? null : row.measured_value;
    let defectQty = num(row.defect_qty);

    // 定性项：OK/NG → 0/1（检验员没填不良数时按 NG 计 1 件）
    if (valueType === 'attribute' && defectQty === null) {
      defectQty = String(measuredValue || '').toUpperCase() === 'NG' ? 1 : 0;
    }

    const j = judgeItem(
      { valueType, spec, measuredValue, measuredValues, defectQty },
      plan.ac
    );

    // 外观的重/轻缺陷：两类各自按自己的 Ac 判，任一超就整项 NG。
    // 轻缺陷没录 → 该项视为未判定（提交会被拦），不能用 0 冒充"没有轻缺陷"。
    const minorQty = plan.minor ? num(row.defect_minor) : null;
    let isPass = j.isPass;
    if (plan.minor) {
      isPass = minorQty === null || j.isPass === null
        ? null
        : (j.isPass && minorQty <= Number(plan.minor.ac));
    }

    built.push({
      template_item_id: t.id,
      section_type: t.section_type,
      item_name: t.item_name,
      item_name_vi: t.item_name_vi,
      item_name_en: t.item_name_en,
      standard: t.standard,
      spec,
      spec_min: j.specMin === null ? null : String(j.specMin),
      spec_max: j.specMax === null ? null : String(j.specMax),
      unit: t.unit,
      value_type: valueType,
      measured_value: measuredValue === null ? null : String(measuredValue),
      measured_values: JSON.stringify(measuredValues),
      defect_qty: Number.isFinite(defectQty) ? defectQty : j.defectQty,
      defect_minor: plan.minor ? minorQty : null,
      aql_minor: plan.minor ? plan.minor.aql : null,
      ac_minor: plan.minor ? Number(plan.minor.ac) : null,
      re_minor: plan.minor ? Number(plan.minor.re) : null,
      defect_description: row.defect_description || null,
      is_pass: isPass,
      sampling_plan_text: t.sampling_plan_text || plan.planText || null,
      aql: t.aql || plan.aql || null,
      sample_size: plan.sampleSize,
      ac: plan.ac,
      re: plan.re,
      full_inspection: !!plan.fullInspection,
      // 只在「需要数值判定」或「抽样走兜底」时打 ⚠️：
      // 计数/定性项的标准本来就是文字（如"无划伤"），不能算"规格无法识别"，
      // 否则一份 7 项的报告 6 项都带警告，真正需要人看的警告就被淹没了。
      warned: !!plan.fallback || (valueType === 'measure' && !j.specValid),
      sort_order: ++sort,
    });
  }

  const batch = judgeBatch(built);
  const planWarn = built.some((b) => b.warned);
  const defectType = normalizeDefectType(body.defectType);

  const saved = await transaction(async (client) => {
    let recordId = rec?.id || null;
    if (!recordId) {
      const ins = await client.query(
        `INSERT INTO iqc_record
           (lot_id, lot_no, template_id, template_version, content, result, defect_type, defect_qty,
            items, judge_snapshot, inspector_id, inspector_name, inspected_at, approval, remark)
         VALUES ($1,$2,$3,$4,'',$5,$6,$7,'[]'::jsonb,$8,$9,$10,now(),'draft',$11)
         RETURNING id`,
        [lot.id, lot.lot_no, tpl.id, tpl.version || null, batch.result, defectType,
          batch.ngCount, JSON.stringify({ result: batch.result, ngCount: batch.ngCount, total: built.length, warnings: planWarn ? ['spec-or-sampling'] : [] }),
          lot.claimed_by || user?.id || null, user?.real_name || null, body.remark || null]
      );
      recordId = ins.rows[0].id;
      await client.query(`UPDATE iqc_lot_mirror SET record_id = $1, updated_at = now() WHERE id = $2`, [recordId, lot.id]);
    } else {
      await client.query(
        `UPDATE iqc_record
            SET template_id=$2, template_version=COALESCE($3, template_version), result=$4,
                defect_type=$5, defect_qty=$6, judge_snapshot=$7,
                inspector_id=COALESCE(inspector_id,$8), inspector_name=COALESCE($9,inspector_name),
                inspected_at=now(), remark=$10, updated_at=now()
          WHERE id=$1`,
        [recordId, tpl.id, tpl.version || null, batch.result, defectType, batch.ngCount,
          JSON.stringify({ result: batch.result, ngCount: batch.ngCount, total: built.length, warnings: planWarn ? ['spec-or-sampling'] : [] }),
          lot.claimed_by || user?.id || null, user?.real_name || null, body.remark || null]
      );
      await client.query(`DELETE FROM iqc_record_item WHERE record_id = $1`, [recordId]);
    }

    for (const b of built) {
      await client.query(
        `INSERT INTO iqc_record_item
           (record_id, lot_no, template_item_id, section_type, item_name, item_name_vi, item_name_en,
            standard, spec, spec_min, spec_max, unit, value_type, measured_value, measured_values,
            defect_qty, defect_minor, aql_minor, ac_minor, re_minor,
            defect_description, is_pass, sampling_plan_text, aql, sample_size, ac, re,
            full_inspection, warned, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)`,
        [recordId, lot.lot_no, b.template_item_id, b.section_type, b.item_name, b.item_name_vi,
          b.item_name_en, b.standard, b.spec, b.spec_min, b.spec_max, b.unit, b.value_type,
          b.measured_value, b.measured_values, b.defect_qty, b.defect_minor, b.aql_minor, b.ac_minor, b.re_minor,
          b.defect_description, b.is_pass, b.sampling_plan_text, b.aql, b.sample_size, b.ac, b.re,
          b.full_inspection, b.warned, b.sort_order]
      );
    }
    return recordId;
  });

  return { recordId: saved, result: batch.result, summary: { total: built.length, ng: batch.ngCount }, items: built };
}

/* ------------------------------------------------------------
 * 五、提交 → 推 WMS（不落账）→ 发起审批
 * ---------------------------------------------------------- */
export async function submitRecord(recordId, user) {
  const rec = await one(`SELECT * FROM iqc_record WHERE id = $1`, [recordId]);
  if (!rec) throw bad('检验记录不存在', 404);
  if (rec.approval === 'approved') throw bad('该记录已审批完成');
  if (rec.wms_synced) throw bad('该记录已落账，不能重复提交', 409);

  const lot = await one(`SELECT * FROM iqc_lot_mirror WHERE id = $1`, [rec.lot_id]);
  if (!lot) throw bad('待检批次不存在', 404);

  // V-10（🔒）：暂停检验的物料不允许提交 —— 必须拦在调 WMS 之前
  if (strictnessOf(lot) === 'suspended') {
    throw bad('该物料检验已暂停，不能提交检验。请品质主管确认供应方改进后恢复加严检验。', 409);
  }

  const items = await many(
    `SELECT * FROM iqc_record_item WHERE record_id = $1 ORDER BY sort_order, id`, [rec.id]
  );

  // ---- 提交前校验（规格 §9） ----
  if (items.length === 0) {
    throw bad('检验记录为空，不能提交。若该批次确实无需检验小项，请由 IQC 主管使用「人工判定」并填写原因');
  }
  const unjudged = items.filter((it) => it.is_pass === null || it.is_pass === undefined);
  if (unjudged.length > 0) {
    throw bad(`以下项目尚未录入检验结果，不能提交：${unjudged.slice(0, 5).map((it) => it.item_name).join('、')}${unjudged.length > 5 ? ' 等' : ''}`);
  }

  // 必检项齐全校验：模板里 is_required 的项目必须在记录里出现。
  // 没有这一条，只填 1 项就能提交出一份"看起来合格"的报告（端到端测试踩到）。
  if (rec.template_id) {
    const required = await many(
      `SELECT id, item_name FROM iqc_template_item WHERE template_id = $1 AND is_required = TRUE`,
      [rec.template_id]
    );
    const have = new Set(items.map((it) => Number(it.template_item_id)).filter(Boolean));
    const missing = required.filter((t) => !have.has(Number(t.id)));
    if (missing.length > 0) {
      throw bad(`以下必检项未录入，不能提交：${missing.slice(0, 5).map((t) => t.item_name).join('、')}${missing.length > 5 ? ` 等 ${missing.length} 项` : ''}`);
    }
  }
  // 尺寸项必须录满抽样数：录一半提交上去，报告上的 n 与实际检验数对不上，
  // 而且会把"没检完"伪装成"检完了且合格"（judgeItem 只统计已填的值）。
  const short = [];
  for (const it of items) {
    if (it.value_type !== 'measure') continue;
    const n = Number(it.sample_size) || 0;
    if (!n) continue;
    const vals = safeJson(it.measured_values) || [];
    const filled = vals.filter((v) => String(v ?? '').trim() !== '').length;
    if (filled < n) short.push(`${it.item_name}（已录 ${filled}/${n}）`);
  }
  if (short.length) {
    throw bad(`以下项目实测值未录满抽样数，不能提交：${short.slice(0, 5).join('、')}${short.length > 5 ? ` 等 ${short.length} 项` : ''}`);
  }

  items.forEach((it, i) => {
    if (!String(it.item_name || '').trim()) throw bad(`第 ${i + 1} 行检验项目名称为空`);
    if (it.value_type === 'measure') {
      const vals = Array.isArray(it.measured_values) ? it.measured_values
        : (() => { try { return JSON.parse(it.measured_values || '[]'); } catch { return []; } })();
      for (const v of vals) {
        if (v === null || v === undefined || String(v).trim() === '') continue;
        if (!Number.isFinite(Number.parseFloat(String(v)))) {
          throw bad(`第 ${i + 1} 行「${it.item_name}」存在非数值输入：${v}`);
        }
      }
    }
    const q = Number(it.defect_qty);
    if (!Number.isInteger(q) || q < 0) throw bad(`第 ${i + 1} 行不良数必须为 0 或正整数`);
    if (it.sample_size && q > Number(it.sample_size)) {
      throw bad(`第 ${i + 1} 行不良数（${q}）超过抽样数量（${it.sample_size}）`);
    }
    // 外观分重/轻缺陷时，轻缺陷不良数同样要合法且不超抽样数
    if (it.aql_minor) {
      const m = Number(it.defect_minor);
      if (!Number.isInteger(m) || m < 0) throw bad(`第 ${i + 1} 行轻缺陷不良数必须为 0 或正整数`);
      if (it.sample_size && m > Number(it.sample_size)) {
        throw bad(`第 ${i + 1} 行轻缺陷不良数（${m}）超过抽样数量（${it.sample_size}）`);
      }
    }
  });

  const batch = judgeBatch(items);
  const defectType = normalizeDefectType(rec.defect_type);
  if (batch.result === 'fail' && !defectType) {
    throw bad(`检验判定为不合格时必须选择不合格类型（可选：${DEFECT_TYPES.join('、')}）`);
  }

  // V-09：批次状态守卫（CAS 语义：已完成/已提交的不允许再提交）
  const guard = await query(
    `UPDATE iqc_lot_mirror
        SET status = 'submitted', updated_at = now()
      WHERE id = $1 AND status NOT IN ('approved', 'void')
      RETURNING id`,
    [lot.id]
  );
  if (guard.rowCount === 0) throw bad('该批次已完成检验，不可重复提交', 409);

  // 结论以推导值为准（V-07），落库纠正
  if (rec.result !== batch.result) {
    await query(`UPDATE iqc_record SET result = $2, defect_qty = $3, updated_at = now() WHERE id = $1`,
      [rec.id, batch.result, batch.ngCount]);
  }
  const reportNo = rec.report_no || reportNoOf(lot, rec.id);
  const contentHtml = buildReportHtml({ lot, rec: { ...rec, result: batch.result, defect_type: defectType }, items, batch });

  // 顺序很关键（旧版踩过的坑）：先建审批实例草稿 → 带实例号推 WMS → 再提交审批。
  // 反过来会让 WMS 报告的 oa_instance_id 永远为空，事后无法互查。
  let inst = null;
  let approvalError = null;
  try {
    inst = await ensureApprovalInstance({ ...rec, report_no: reportNo, result: batch.result }, lot, user);
  } catch (err) {
    approvalError = err instanceof Error ? err.message : String(err);
  }

  const r = await wmsCall('result', '/api/oa/iqc/result', {
    lotNo: lot.lot_no,
    reportNo,
    result: batch.result,
    defectType,
    defectQty: batch.ngCount,
    inspector: { name: rec.inspector_name || user?.real_name || null, employeeNo: null },
    oaInstanceId: inst?.id || null,
    items: items.map((it) => ({
      name: it.item_name,
      spec: it.spec,
      measured: it.measured_value || (safeJson(it.measured_values) || []).join(',') || null,
      verdict: it.is_pass === false ? 'ng' : 'ok',
      qty: Number(it.defect_qty) || 0,
      sectionType: it.section_type,
      sampleSize: it.sample_size,
      ac: it.ac,
      re: it.re,
      aql: it.aql,
    })),
    contentHtml,
  });

  await query(
    `UPDATE iqc_record
        SET report_no = $2, result = $3, defect_type = $4, defect_qty = $5,
            content = $6, wms_result_sent = TRUE, approval = 'running', updated_at = now()
      WHERE id = $1`,
    [rec.id, reportNo, batch.result, defectType, batch.ngCount, contentHtml]
  );

  if (inst && !approvalError) {
    try {
      await submitInstance({ instanceId: inst.id, userId: user?.id || 1, comment: 'IQC 检验提交' });
    } catch (err) {
      approvalError = err instanceof Error ? err.message : String(err);
    }
  }
  return { ok: true, reportNo, result: batch.result, wms: r, instanceId: inst?.id || null, approvalError };
}

function safeJson(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v); } catch { return null; }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** 库位归一：WMS 推来的可能是 "003-B-1-1"、["A-01"]、或 JSON 文本，统一成可读串 */
function locTextOf(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Array.isArray(v)) {
    return v.map((x) => (typeof x === 'string' ? x : (x?.code || x?.location_code || x?.name || ''))).filter(Boolean).join(', ');
  }
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.startsWith('[')) {
      try { const a = JSON.parse(t); return Array.isArray(a) ? a.map(String).join(', ') : t; } catch { return t; }
    }
    return t;
  }
  if (typeof v === 'object') return v.code || v.location_code || v.name || '';
  return String(v);
}

/** 报告正文里的「｜地址码 xxx」片段，取不到就不加 */
function locCell(v) {
  const t = locTextOf(v);
  return t ? `｜地址码 ${esc(t)}` : '';
}

/** 生成归档用 HTML（WMS 侧 contentHtml 字段；打印以 OA 生成的结构化报告为准） */
/** 受控文件编号：与前端打印区一致（FM-QA-001）。换版时前端 DOC_NO 与这里同改。 */
const IQC_DOC_NO = 'FM-QA-001';

export function buildReportHtml({ lot, rec, items, batch }) {
  // 数字去尾零（DB numeric 出来是 6.0000），否则报告里会写「重 6.0000 / 轻 5.0000」
  const qtyText = (v) => {
    if (v === null || v === undefined || v === '') return '—';
    const n = Number(v);
    return Number.isFinite(n) ? String(Math.round(n * 10000) / 10000) : String(v);
  };
  const rows = items.map((it) => {
    // 外观分重/轻缺陷：Ac/Re 与不良数都有两组，不能只表现重缺陷（否则读者会以为轻缺陷也用同一阈值）
    const hasMinor = !!it.aql_minor;
    const measured = hasMinor
      ? `重 ${qtyText(it.defect_qty)} / 轻 ${qtyText(it.defect_minor)}`
      : (it.measured_value
        || (safeJson(it.measured_values) || []).filter((v) => String(v ?? '').trim() !== '').join(' / '));
    const acRe = hasMinor
      ? `重 ${esc(it.ac ?? '')}/${esc(it.re ?? '')} · 轻 ${esc(it.ac_minor ?? '')}/${esc(it.re_minor ?? '')}`
      : `${esc(it.ac ?? '')}/${esc(it.re ?? '')}`;
    // 方案名本身不含允收水平，分轻重缺陷时把两个 AQL 一并标出：G-II（0.4, 1.0）
    const planText = hasMinor
      ? `${it.sampling_plan_text || ''}（${it.aql ?? '—'}, ${it.aql_minor}）`
      : (it.sampling_plan_text || '');
    // 都过 qtyText：DB 的 numeric 出来是 0.0000，直接拼进去报告里会出现「不良 0.0000」
    const defectTotal = hasMinor
      ? qtyText(Number(it.defect_qty || 0) + Number(it.defect_minor || 0))
      : qtyText(it.defect_qty);
    const judge = it.is_pass === true ? 'OK' : it.is_pass === false ? 'NG' : '—';
    return `<tr>
      <td>${esc(it.section_type)}</td><td>${esc(it.item_name)}</td><td>${esc(it.spec)}</td>
      <td>${esc(planText)}</td><td>${esc(it.sample_size ?? '')}</td>
      <td>${acRe}</td>
      <td>${esc(measured)}</td><td>${esc(defectTotal)}</td>
      <td>${judge}</td></tr>`;
  }).join('');
  // 检验编号放最前面：WMS 侧以它为准，报告正文缺了它对不上单据
  const inspectionNo = rec.inspection_no || lot.inspection_no || rec.report_no || '';
  // 报告正文只露「检验编号(JY) + 供应商批次号」：lot_no（IQC 流水号）是 OA 调 WMS 的内部句柄，
  // 不对人展示，避免与 JY 号并列造成两个编号的追溯歧义（用户 2026-10-25 定：追溯一律以 JY 为准）。
  return `<h3>来料检验报告 ${esc(rec.report_no || '')}
<span style="float:right;font-size:12px;font-weight:normal">文件编号 ${esc(IQC_DOC_NO)}</span></h3>
<p>检验编号 ${esc(inspectionNo)}｜批次号 ${esc(lot.batch_no || '—')}｜物料 ${esc(lot.material_code)} ${esc(lot.material_name)}｜供应商 ${esc(lot.supplier_name)}｜数量 ${esc(lot.qty)} ${esc(lot.unit || '')}${locCell(lot.locations)}</p>
<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;width:100%">
<thead><tr><th>工段</th><th>项目</th><th>规格</th><th>方案</th><th>n</th><th>Ac/Re</th><th>实测</th><th>不良</th><th>判定</th></tr></thead>
<tbody>${rows}</tbody></table>
<p>结论：<b>${batch.result === 'pass' ? '合格' : '不合格'}</b>（NG ${batch.ngCount}/${batch.total}）</p>`;
}

/** 取（或创建）该记录的审批实例草稿；已有则复用 */
async function ensureApprovalInstance(rec, lot, user) {
  if (rec.instance_id) {
    const cur = await one(`SELECT * FROM flow_instance WHERE id = $1`, [rec.instance_id]);
    if (cur && cur.status === 'draft') return cur;
    if (cur && cur.status === 'running') return cur;
    // 已完成/已终止 → 视为新一轮，重建实例
  }
  const def = await one(
    `SELECT id, code FROM flow_definition
      WHERE code IN ('oa_iqc_report','wms_iqc_report') AND active = TRUE
      ORDER BY CASE code WHEN 'oa_iqc_report' THEN 0 ELSE 1 END
      LIMIT 1`
  );
  if (!def) throw bad('未找到 IQC 审批流程定义（oa_iqc_report / wms_iqc_report）', 500);

  const inst = await createInstance({
    definitionId: def.id,
    userId: user?.id || 1,
    title: `IQC检验报告审批 ${rec.report_no || lot.lot_no}`,
    formData: {
      lot_no: lot.lot_no,
      report_no: rec.report_no,
      result: rec.result,
      material_code: lot.material_code,
      material_name: lot.material_name,
      supplier_name: lot.supplier_name,
      qty: lot.qty,
      unit: lot.unit,
      defect_type: rec.defect_type,
      defect_qty: rec.defect_qty,
      oa_record_id: rec.id,
    },
    bizSystem: 'OA',
    bizType: 'iqc_record',
    bizKey: String(rec.id),
  });
  await query(`UPDATE iqc_record SET instance_id = $2, updated_at = now() WHERE id = $1`, [rec.id, inst.id]);
  rec.instance_id = inst.id;
  return inst;
}

/* ------------------------------------------------------------
 * 六、审批回调与落账
 * ---------------------------------------------------------- */
/**
 * 审批终态回调（flow-engine.runTerminalHooks）：末节点通过 → 回填 WMS 落账。
 *
 * 顺序（评审要求，别改）：**先把审批终态落库，再去 WMS 落账**。
 * 这样"审批通过但落账失败"在库里是 `approval='approved' AND wms_synced=false`，
 * 一眼可查、可由后台任务重试；反过来（先落账再改审批态）在 WMS 失败时
 * 会停在 approval='running'，用户以为没批，重提就会重复推报告。
 */
export async function onIqcApproved(instanceId) {
  const rec = await one(`SELECT * FROM iqc_record WHERE instance_id = $1`, [instanceId]);
  if (!rec) return { skipped: true, reason: 'not-iqc-record' };
  if (rec.wms_synced) return { skipped: true, reason: 'already-synced' };

  await query(
    `UPDATE iqc_record SET approval = 'approved', approved_at = COALESCE(approved_at, now()), updated_at = now()
      WHERE id = $1 AND approval <> 'approved'`,
    [rec.id]
  );

  // 真实审批人：取流程里**最后一个已通过**任务的办理人，而不是"第一个管理员"。
  // 之前用 SELECT ... is_admin LIMIT 1 会把报告批准人永远写成同一个管理员，
  // 报告签核区与回填 WMS 的 approvedBy 都会是错的（评审指出的设计缺口）。
  const lastTask = await one(
    `SELECT t.assignee_id, u.real_name
       FROM flow_task t
       LEFT JOIN org_user u ON u.id = t.assignee_id
      WHERE t.instance_id = $1 AND t.status = 'approved' AND t.assignee_id IS NOT NULL
      ORDER BY t.finished_at DESC NULLS LAST, t.node_index DESC
      LIMIT 1`,
    [instanceId]
  );
  let approver = lastTask?.assignee_id ? { id: lastTask.assignee_id, real_name: lastTask.real_name } : null;
  if (!approver) {
    approver = await one(`SELECT id, real_name FROM org_user WHERE is_admin = TRUE AND active = TRUE ORDER BY id LIMIT 1`);
  }
  if (approver?.id) {
    await query(
      `UPDATE iqc_record SET approved_by = COALESCE(approved_by, $2) WHERE id = $1`,
      [rec.id, approver.id]
    );
  }
  return approveBackfill(rec.id, approver || { real_name: 'OA审批' }, { fromFlow: true });
}

/**
 * 审批被退回（flow-engine.returnToApplicant）：
 * 把 OA 记录置 returned、批次退回「检验中」，让人改完重新提交。
 * 注意：**不动 WMS** —— 批次在 WMS 仍是 review_pending，重新提交时按同 lot 覆盖结果，不会重复落账。
 */
export async function onIqcReturned(instanceId, reason) {
  const rec = await one(`SELECT * FROM iqc_record WHERE instance_id = $1`, [instanceId]);
  if (!rec) return { skipped: true };
  if (rec.wms_synced) return { skipped: true, reason: 'already-posted' };
  await query(
    `UPDATE iqc_record SET approval = 'returned', wms_sync_error = $2, updated_at = now() WHERE id = $1`,
    [rec.id, reason ? String(reason).slice(0, 500) : null]
  );
  await query(
    `UPDATE iqc_lot_mirror
        SET status = 'inspecting',
            claimed_by = COALESCE(claimed_by, $2),
            claimed_at = COALESCE(claimed_at, now()),
            updated_at = now()
      WHERE id = $1`,
    [rec.lot_id, rec.inspector_id || null]
  );
  return { ok: true, recordId: rec.id };
}

/**
 * 审批通过 → 回填 WMS 落账（库存/欠料/自动MRB/严格度全在 WMS 事务内完成）。
 *
 * ⚠️ 手工重试路径必须校验审批已通过（安全审计：旧版任何 ipqc:manage 可绕过审批直接落账）。
 * @param {object} opts { fromFlow: boolean } 流程终态钩子传 true；页面按钮不传
 */
export async function approveBackfill(recordId, user, opts = {}) {
  const rec = await one(`SELECT * FROM iqc_record WHERE id = $1`, [recordId]);
  if (!rec) throw bad('检验记录不存在', 404);
  if (!rec.report_no) throw bad('该记录尚未提交，不能回填');
  if (rec.wms_synced) return { ok: true, alreadySynced: true };

  if (!opts.fromFlow) {
    const inst = rec.instance_id
      ? await one(`SELECT status FROM flow_instance WHERE id = $1`, [rec.instance_id])
      : null;
    const instOk = !!inst && ['completed', 'approved'].includes(inst.status);
    // 流程实例终态是 completed（见 flow-engine L433），兼容历史 approved 值
    if (rec.approval !== 'approved' && !instOk) {
      throw bad('审批尚未通过，不能落账（落账只允许由审批终态触发）', 403);
    }
    if (user?.id && Number(user.id) === Number(rec.inspector_id) && !user.isAdmin) {
      throw bad('检验人不能自行批准自己填写的报告', 403);
    }
  }

  const lot = await one(`SELECT * FROM iqc_lot_mirror WHERE id = $1`, [rec.lot_id]);
  try {
    const r = await wmsCall('approve', '/api/oa/iqc/approve', {
      reportNo: rec.report_no,
      lotNo: lot?.lot_no,
      approvedBy: { name: user?.real_name || user?.username || 'OA' },
    });
    await query(
      // approved_by / approved_at 用 COALESCE：自动补偿重试时传的是系统身份，
      // 不能把首次审批人擦成空（安全审计 #17，曾把审批痕迹清掉）
      `UPDATE iqc_record SET wms_synced = TRUE, approval = 'approved',
              approved_by = COALESCE(approved_by, $2),
              approved_at = COALESCE(approved_at, now()),
              -- 救回后必须复位死信标志，否则 manual_required 这一列会永远虚高
              -- （安全审计 P1-5：标志只置不清，统计与筛选都会骗人）
              manual_required = FALSE, backfill_attempts = 0, next_retry_at = NULL,
              wms_sync_error = NULL, updated_at = now()
        WHERE id = $1`,
      [rec.id, user?.id || null]
    );
    await query(
      `UPDATE iqc_lot_mirror SET status = 'approved', wms_status = $2, updated_at = now() WHERE id = $1`,
      [rec.lot_id, r?.status || 'approved']
    );
    return { ok: true, wms: r };
  } catch (err) {
    await query(
      `UPDATE iqc_record SET wms_sync_error = $2, updated_at = now() WHERE id = $1`,
      [rec.id, String(err.message || err).slice(0, 500)]
    );
    throw err;
  }
}

/**
 * 落账补偿：审批已通过但 WMS 未回执的记录，按**指数退避**重试，超过 10 次转人工。
 *
 * 为什么必须有出口（安全审计 #20）：
 *   固定间隔重试 + 失败时刷新 updated_at ⇒ 记录永远在队头、永不退出，
 *   还会按轮次往 iqc_sync_log 里灌日志（一条卡住的记录 ≈ 288 条/天），
 *   真正的告警会被淹掉。规格 §10.3 也要求"最多 10 次，超过转人工"。
 */
// 退避曲线（秒）：10 档合计 1530s ≈ 25.5 分钟（安全审计 #22 复核后的曲线）。
// 规格 §10.3 的口径是 1s/5s/30s/2min/10min、最多 10 次；这里把"10min"封顶收到 5min，
// 原因是：转人工之前，每多一分钟货物就多一分钟卡在待检区出不了库。
const BACKOFF_SEC = [30, 60, 60, 60, 60, 60, 120, 180, 300, 600];
const MAX_ATTEMPTS = BACKOFF_SEC.length;

export async function retryPendingBackfill(limit = 20) {
  const rows = await many(
    `SELECT id, backfill_attempts FROM iqc_record
      WHERE approval = 'approved' AND wms_synced = FALSE AND manual_required = FALSE
        AND report_no IS NOT NULL
        AND (next_retry_at IS NULL OR next_retry_at <= now())
      ORDER BY next_retry_at NULLS FIRST, updated_at ASC
      LIMIT $1`,
    [limit]
  );
  let ok = 0;
  const failed = [];
  const dead = [];
  for (const r of rows) {
    const attempt = Number(r.backfill_attempts || 0) + 1;
    try {
      await approveBackfill(r.id, { real_name: 'OA自动重试' }, { fromFlow: true });
      await query(
        `UPDATE iqc_record SET backfill_attempts = 0, next_retry_at = NULL, last_backfill_at = now()
          WHERE id = $1`,
        [r.id]
      );
      ok++;
    } catch (e) {
      const err = String(e?.message || e).slice(0, 300);
      if (attempt >= MAX_ATTEMPTS) {
        await query(
          `UPDATE iqc_record
              SET backfill_attempts = $2, next_retry_at = NULL, manual_required = TRUE,
                  last_backfill_at = now(), wms_sync_error = $3
            WHERE id = $1`,
          [r.id, attempt, err]
        );
        dead.push({ id: r.id, error: err });
      } else {
        const delaySec = BACKOFF_SEC[Math.min(attempt - 1, BACKOFF_SEC.length - 1)];
        await query(
          `UPDATE iqc_record
              SET backfill_attempts = $2,
                  next_retry_at = now() + ($3::int * interval '1 second'),
                  last_backfill_at = now(), wms_sync_error = $4
            WHERE id = $1`,
          [r.id, attempt, delaySec, err]
        );
        failed.push({ id: r.id, attempt, error: err });
      }
    }
  }
  return { retried: rows.length, ok, failed, dead };
}

/** 认领超时回收：11 分钟一轮，超过 4 小时未提交的自动释放（同时释放 WMS 锁） */export async function releaseStaleClaims() {
  const rows = await many(
    `SELECT id, lot_no FROM iqc_lot_mirror
      WHERE status = 'inspecting' AND claimed_at IS NOT NULL
        AND claimed_at < now() - interval '4 hours'
      LIMIT 50`
  );
  let released = 0;
  for (const r of rows) {
    try {
      await wmsCall('release', '/api/oa/iqc/release', { lotNo: r.lot_no });
    } catch { /* WMS 释放失败也要回收本地，否则永久占位 */ }
    await query(
      `UPDATE iqc_lot_mirror SET claimed_by = NULL, claimed_at = NULL, status = 'pending', updated_at = now()
        WHERE id = $1`,
      [r.id]
    );
    released++;
  }
  return { released };
}

/* ------------------------------------------------------------
 * 七、报告（打印/PDF）
 * ---------------------------------------------------------- */
export async function getReport(recordId) {
  const rec = await one(`SELECT * FROM iqc_record WHERE id = $1`, [recordId]);
  if (!rec) throw bad('检验记录不存在', 404);
  const lot = await one(`SELECT * FROM iqc_lot_mirror WHERE id = $1`, [rec.lot_id]);
  const items = await many(
    `SELECT * FROM iqc_record_item WHERE record_id = $1 ORDER BY sort_order, id`, [rec.id]
  );
  const batch = judgeBatch(items);
  const sections = SECTION_ORDER.map((type) => ({
    section_type: type,
    label: SECTION_LABEL[type],
    items: items.filter((it) => it.section_type === type),
  })).filter((s) => s.items.length);

  const approver = rec.approved_by
    ? await one(`SELECT real_name FROM org_user WHERE id = $1`, [rec.approved_by])
    : null;

  return {
    header: {
      report_no: rec.report_no,
      lot_no: rec.lot_no,
      inspection_no: lot?.inspection_no,
      receipt_date: lot?.receipt_date,
      supplier_name: lot?.supplier_name,
      supplier_code: lot?.supplier_code,
      material_code: lot?.material_code,
      material_name: lot?.material_name,
      material_type: lot?.material_type,
      qty: lot?.qty,
      unit: lot?.unit,
      batch_no: lot?.batch_no,
      // 物料地址码（WMS 库位）：检验员凭它找货，报告表头必须有
      locations: lot?.locations,
      strictness: strictnessOf(lot),
      template_version: rec.template_version,
      inspector_name: rec.inspector_name,
      inspection_time: rec.inspected_at,
      approved_by: approver?.real_name || null,
      approved_at: rec.approved_at,
      approval: rec.approval,
      wms_synced: rec.wms_synced,
      remark: rec.remark,
    },
    sections,
    conclusion: {
      result: batch.result,
      ng_count: batch.ngCount,
      total: batch.total,
      ng_items: batch.ngNames,
      defect_type: rec.defect_type,
      defect_qty: rec.defect_qty,
      warnings: (items || []).filter((i) => i.warned).map((i) => i.item_name),
      full_inspection: (items || []).some((i) => i.full_inspection),
    },
    signatures: {
      inspector: rec.inspector_name,
      reviewer: approver?.real_name || null,
    },
  };
}

/* ------------------------------------------------------------
 * 八、统计（只统计 OA 接管后的记录；历史仍在 WMS）
 * ---------------------------------------------------------- */
export async function statsIqc({ days = 30 } = {}) {
  const n = Math.min(365, Math.max(1, Number(days) || 30));

  const byDay = await many(
    `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
            COALESCE(s.total, 0)::int AS total,
            COALESCE(s.ok, 0)::int AS ok,
            COALESCE(s.ng, 0)::int AS ng
       FROM generate_series(current_date - ($1::int - 1), current_date, '1 day') AS d(day)
       LEFT JOIN (
         SELECT date(r.inspected_at) AS day,
                count(*)::int AS total,
                count(*) FILTER (WHERE r.result = 'pass')::int AS ok,
                count(*) FILTER (WHERE r.result = 'fail')::int AS ng
           FROM iqc_record r
          WHERE r.inspected_at >= current_date - ($1::int - 1)
          GROUP BY 1
       ) s ON s.day = d.day
      ORDER BY d.day`,
    [n]
  );

  const summary = await one(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE result = 'pass')::int AS ok,
            count(*) FILTER (WHERE result = 'fail')::int AS ng
       FROM iqc_record
      WHERE inspected_at >= current_date - ($1::int - 1)`,
    [n]
  );

  const bySupplier = await many(
    `SELECT COALESCE(m.supplier_name, '（未知）') AS name,
            count(*)::int AS total,
            count(*) FILTER (WHERE r.result = 'fail')::int AS ng
       FROM iqc_record r
       LEFT JOIN iqc_lot_mirror m ON m.lot_no = r.lot_no
      WHERE r.inspected_at >= current_date - ($1::int - 1)
      GROUP BY 1 ORDER BY ng DESC, total DESC LIMIT 10`,
    [n]
  );

  const byMaterial = await many(
    `SELECT COALESCE(m.material_code, '（未知）') AS code,
            COALESCE(m.material_name, '') AS name,
            count(*)::int AS total,
            count(*) FILTER (WHERE r.result = 'fail')::int AS ng
       FROM iqc_record r
       LEFT JOIN iqc_lot_mirror m ON m.lot_no = r.lot_no
      WHERE r.inspected_at >= current_date - ($1::int - 1)
      GROUP BY 1, 2 ORDER BY ng DESC, total DESC LIMIT 10`,
    [n]
  );

  const mrbDisposition = await many(
    `SELECT d->>'dispositionType' AS type,
            count(*)::int AS cnt,
            COALESCE(SUM(NULLIF(d->>'quantity', '')::numeric), 0)::text AS qty
       FROM mrb_mirror m, jsonb_array_elements(m.dispositions) d
      WHERE m.created_at >= current_date - ($1::int - 1)
      GROUP BY 1 ORDER BY cnt DESC`,
    [n]
  );

  const mrbSummary = await one(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status IN ('closed', 'approved'))::int AS closed,
            count(*) FILTER (WHERE status = 'rejected')::int AS rejected
       FROM mrb_mirror
      WHERE created_at >= current_date - ($1::int - 1)`,
    [n]
  );

  const total = Number(summary?.total || 0);
  const ok = Number(summary?.ok || 0);
  return {
    days: n,
    summary: {
      total, ok, ng: Number(summary?.ng || 0),
      passRate: total ? Math.round((ok / total) * 1000) / 10 : null,
      mrb: {
        total: Number(mrbSummary?.total || 0),
        closed: Number(mrbSummary?.closed || 0),
        rejected: Number(mrbSummary?.rejected || 0),
      },
    },
    byDay,
    bySupplier,
    byMaterial,
    mrbDisposition,
  };
}
