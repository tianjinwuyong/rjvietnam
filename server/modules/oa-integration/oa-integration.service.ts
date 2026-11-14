import { Inject, Injectable, BadRequestException, Logger, NotFoundException, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { OverPickingService } from '../over-picking/over-picking.service';
import { WorkorderService } from '../workorder/workorder.service';
import { StockTakeService } from '../stock-take/stock-take.service';
import { IqcService } from '../iqc/iqc.service';
import { MrbService } from '../mrb/mrb.service';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { sql } from 'drizzle-orm';
import * as crypto from 'crypto';

type Stage = 'approval' | 'receive' | 'confirm';

/**
 * WMS ↔ OA 集成（领料全链路）
 *
 * 工单下发 → WMS 出领料单 → OA 生产主管审批 → 回 WMS 可发料 → 发料
 *   → OA 物料员确认 → OA 生产主管完成确认 → 回 WMS 结案
 *
 * 实现要点：用「阶段 + 定时推进」代替层层回调嵌套。
 *  - 每次提交记 oa_stage，回调只更新状态；
 *  - 后台每 30s 扫一遍，凡满足下一阶段条件的单据自动提交，链路自然往前走。
 */
@Injectable()
export class OaIntegrationService implements OnModuleInit {
  private readonly logger = new Logger(OaIntegrationService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit() {
    // 轻量轮询：不引入调度依赖，失败不影响主进程
    this.timer = setInterval(() => void this.advancePipeline(), 30_000);
    this.timer.unref?.();
    void this.advancePipeline();
  }

  private get cfg() {
    return {
      baseUrl: (process.env.OA_BASE_URL || '').replace(/\/$/, ''),
      apiKey: process.env.OA_API_KEY || '',
      secret: process.env.OA_WEBHOOK_SECRET || '',
      // 一张领料单 = 一个 OA 实例，三个节点在同一流程里
      flowDef: Number(process.env.OA_PICKING_FLOW_DEF_ID || 0),
    };
  }

  /** 单据快照 + 明细，原封不动带到 OA */
  private async loadSnapshot(pickingNo: string) {
    const rows = (await this.db.execute(sql`
      SELECT to_jsonb(p) AS snapshot, p.id, p.status, p.oa_instance_id, p.oa_stage,
             (p.applicant_id).user_id AS applicant_uid, w.work_order_no
        FROM picking_order p
        LEFT JOIN work_order w ON w.id = p.work_order_id
       WHERE p.picking_no = ${pickingNo} LIMIT 1
    `)) as unknown as any[];
    const order = rows[0];
    if (!order) throw new NotFoundException('领料单不存在');
    const items = (await this.db.execute(sql`
      SELECT material_code, material_name, unit, pick_qty, actual_qty, received_qty
        FROM picking_order_item WHERE picking_id = ${order.id}::uuid ORDER BY material_code
    `)) as unknown as any[];
    const applicant = (await this.db.execute(sql`
      SELECT name, oa_user_id FROM sys_account WHERE id = ${order.applicant_uid}::uuid LIMIT 1
    `)) as unknown as any[];
    return { order, items, applicant: applicant[0] || {} };
  }

  /** 把原始单据作为 .json 附件挂到 OA 实例上（失败不影响主流程） */
  private async attachSnapshot(instanceId: number, bizKey: string, snapshot: any) {
    const cfg = this.cfg;
    if (!cfg.baseUrl || !cfg.apiKey) return;
    const fileName = `${bizKey}-原始单据.json`;
    try {
      const form = new FormData();
      form.append('file', new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }), fileName);
      const up = await fetch(`${cfg.baseUrl}/api/upload`, {
        method: 'POST', headers: { 'X-Api-Key': cfg.apiKey }, body: form,
        signal: AbortSignal.timeout(20000),
      });
      const upJson: any = await up.json().catch(() => ({}));
      if (!up.ok || upJson?.code !== 0) throw new Error(upJson?.msg || `upload ${up.status}`);
      const res = await fetch(`${cfg.baseUrl}/api/instances/${instanceId}/attachments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': cfg.apiKey },
        body: JSON.stringify({
          fileName, filePath: upJson.data.tempRelPath,
          fileSize: upJson.data.fileSize, mimeType: 'application/json',
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`attach ${res.status}`);
    } catch (e: any) {
      this.logger.warn(`原始单据附件上传失败 ${bizKey}: ${e?.message || e}`);
    }
  }

  /** 提交某个阶段到 OA */
  async submitStage(pickingNo: string, stage: Stage = 'approval') {
    const cfg = this.cfg;
    const defId = cfg.flowDef;
    if (!cfg.baseUrl || !cfg.apiKey || !defId) {
      throw new BadRequestException('OA 领料流程未配置（OA_PICKING_FLOW_DEF_ID）');
    }
    const { order, items, applicant } = await this.loadSnapshot(pickingNo);
    if (order.oa_instance_id) {
      return { skipped: true, instanceId: order.oa_instance_id };
    }

    const titleMap: Record<Stage, string> = {
      approval: '领料单流程',
      receive: '领料单流程',
      confirm: '领料单流程',
    };

    const body = {
      definitionId: defId,
      title: `${titleMap[stage]} ${pickingNo}`,
      applicantUserId: Number(applicant.oa_user_id || 1),
      bizSystem: 'WMS',
      bizType: 'picking_flow',
      bizKey: pickingNo,
      submitNow: true,
      formData: {
        wms_biz_no: pickingNo,
        work_order_no: order.work_order_no,
        total_qty: items.reduce((n, i) => n + (Number(i.actual_qty) > 0 ? Number(i.actual_qty) : Number(i.pick_qty || 0)), 0),
        items: items.map((i) => ({
          material_code: i.material_code,
          material_name: i.material_name,
          pick_qty: Number(i.pick_qty || 0),
          actual_qty: Number(i.actual_qty || 0),
          unit: i.unit,
        })),
        items_text: items
          .map((i) => `${i.material_code}  ${i.material_name}  应发 ${Number(i.pick_qty || 0)} ${i.unit}  实发 ${Number(i.actual_qty || 0)} ${i.unit}`)
          .join('\n'),
        // 原封不动的单据快照（全字段 + 明细）
        wms_snapshot: JSON.stringify({ order: order.snapshot, items }),
      },
    };

    let res: Response;
    try {
      res = await fetch(`${cfg.baseUrl}/api/instances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': cfg.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch (e: any) {
      throw new BadRequestException(`调用 OA 失败：${e?.message || e}`);
    }
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.code !== 0) throw new BadRequestException(json?.msg || `OA 返回 ${res.status}`);
    const instance = json.data || {};

    await this.db.execute(sql`
      UPDATE picking_order
         SET oa_instance_id = ${Number(instance.id)},
             oa_status = 'running',
             oa_stage = ${stage},
             oa_synced_at = CURRENT_TIMESTAMP
       WHERE id = ${order.id}::uuid
    `);
    await this.attachSnapshot(Number(instance.id), pickingNo, { order: order.snapshot, items });
    return { instanceId: instance.id, instanceNo: instance.instance_no, stage };
  }

  /** 提交超补单到 OA（整单不含税金额用于分级审批） */
  async submitOverSupplement(orderNo: string) {
    const cfg = this.cfg;
    const defId = Number(process.env.OA_OVER_SUPPLEMENT_DEF_ID || 0);
    if (!cfg.baseUrl || !cfg.apiKey || !defId) throw new BadRequestException('OA 超补流程未配置');

    const rows = (await this.db.execute(sql`
      SELECT to_jsonb(o) AS snapshot, o.id, o.status, o.total_amount, o.work_order_no,
             (o.applicant_id).user_id AS applicant_uid
        FROM over_picking_order o WHERE o.order_no = ${orderNo} LIMIT 1
    `)) as unknown as any[];
    const order = rows[0];
    if (!order) throw new NotFoundException('超补单不存在');
    if (order.status !== 'pending_approval') throw new BadRequestException('仅待审批的超补单可提交');

    const items = (await this.db.execute(sql`
      SELECT material_code, material_name, unit, quantity, unit_price, amount
        FROM over_picking_item WHERE order_id = ${order.id}::uuid ORDER BY material_code
    `)) as unknown as any[];
    const applicant = (await this.db.execute(sql`
      SELECT name, oa_user_id FROM sys_account WHERE id = ${order.applicant_uid}::uuid LIMIT 1
    `)) as unknown as any[];

    const totalAmount = Number(order.total_amount || 0); // 整单合计，不含税
    const body = {
      definitionId: defId,
      title: `超补领料单 ${orderNo}`,
      applicantUserId: Number(applicant[0]?.oa_user_id || 1),
      bizSystem: 'WMS',
      bizType: 'over_supplement',
      bizKey: orderNo,
      submitNow: true,
      formData: {
        wms_biz_no: orderNo,
        work_order_no: order.work_order_no,
        total_qty: items.reduce((n, i) => n + Number(i.quantity || 0), 0),
        total_amount: totalAmount,
        items: items.map((i) => ({
          material_code: i.material_code,
          material_name: i.material_name,
          qty: Number(i.quantity || 0),
          unit: i.unit,
          amount: Number(i.amount || 0),
        })),
        wms_snapshot: JSON.stringify({ order: order.snapshot, items }),
      },
    };

    const res = await fetch(`${cfg.baseUrl}/api/instances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': cfg.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    }).catch((e) => { throw new BadRequestException(`调用 OA 失败：${e?.message || e}`); });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.code !== 0) throw new BadRequestException(json?.msg || `OA 返回 ${res.status}`);
    const instance = json.data || {};

    await this.db.execute(sql`
      UPDATE over_picking_order
         SET oa_instance_id = ${Number(instance.id)}, oa_status = 'running'
       WHERE id = ${order.id}::uuid
    `);
    await this.attachSnapshot(Number(instance.id), orderNo, { order: order.snapshot, items });
    return { instanceId: instance.id, instanceNo: instance.instance_no, totalAmount };
  }

  /** 提交工单超耗审批（>3‰） */
  async submitOverConsume(workOrderNo: string, operatorId?: string) {
    const cfg = this.cfg;
    const defId = Number(process.env.OA_OVER_CONSUME_DEF_ID || 0);
    if (!cfg.baseUrl || !cfg.apiKey || !defId) throw new BadRequestException('OA 超耗流程未配置');

    const woSvc = this.moduleRef.get(WorkorderService, { strict: false });
    const summary = await woSvc.getWorkOrderConsumption(workOrderNo);
    if (!summary.needsApproval) throw new BadRequestException('该工单未超过 3‰，无需审批');
    if (summary.overConsumeStatus === 'approved') return { skipped: true, reason: '已审批' };

    const rows = (await this.db.execute(sql`
      SELECT id, oa_instance_id FROM work_order WHERE work_order_no = ${workOrderNo} LIMIT 1
    `)) as unknown as any[];
    if (!rows[0]) throw new NotFoundException('工单不存在');
    if (rows[0].oa_instance_id) return { skipped: true, instanceId: rows[0].oa_instance_id };

    const body = {
      definitionId: defId,
      title: `工单超耗审批 ${workOrderNo}`,
      applicantUserId: 1,
      bizSystem: 'WMS',
      bizType: 'over_consume',
      bizKey: workOrderNo,
      submitNow: true,
      formData: {
        wms_biz_no: workOrderNo,
        over_rate: summary.overallRate,
        detail: summary.items.filter((i) => i.needsApproval).map((i) =>
          `${i.materialCode} 标准${i.standardQty} 实耗${i.consumedQty} 超${i.overQty}（${(i.overRate * 100).toFixed(3)}%）`).join('\n'),
        wms_snapshot: JSON.stringify(summary),
      },
    };
    const res = await fetch(`${cfg.baseUrl}/api/instances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': cfg.apiKey },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    }).catch((e) => { throw new BadRequestException(`调用 OA 失败：${e?.message || e}`); });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.code !== 0) throw new BadRequestException(json?.msg || `OA 返回 ${res.status}`);
    const inst = json.data || {};
    await this.db.execute(sql`
      UPDATE work_order SET oa_instance_id = ${Number(inst.id)}, oa_status = 'running' WHERE id = ${rows[0].id}::uuid`);
    await this.attachSnapshot(Number(inst.id), workOrderNo, summary);
    return { instanceId: inst.id, instanceNo: inst.instance_no };
  }

  /** 提交盘点单审批 */
  async submitStockTake(takeNo: string) {
    const cfg = this.cfg;
    const defId = Number(process.env.OA_STOCK_TAKE_DEF_ID || 0);
    if (!cfg.baseUrl || !cfg.apiKey || !defId) throw new BadRequestException('OA 盘点流程未配置');
    const rows = (await this.db.execute(sql`
      SELECT to_jsonb(o) AS snapshot, o.id, o.status, o.period_month, o.oa_instance_id
        FROM stock_take_order o WHERE o.take_no = ${takeNo} LIMIT 1
    `)) as unknown as any[];
    const order = rows[0];
    if (!order) throw new NotFoundException('盘点单不存在');
    if (order.oa_instance_id) return { skipped: true, instanceId: order.oa_instance_id };
    const items = (await this.db.execute(sql`
      SELECT material_code, book_qty, actual_qty, diff_qty, unit FROM stock_take_item
       WHERE take_id = ${order.id}::uuid AND COALESCE(diff_qty,0) <> 0 LIMIT 200
    `)) as unknown as any[];
    const body = {
      definitionId: defId, title: `盘点单审批 ${takeNo}`, applicantUserId: 1,
      bizSystem: 'WMS', bizType: 'stock_take', bizKey: takeNo, submitNow: true,
      formData: {
        wms_biz_no: takeNo, period_month: order.period_month,
        diff_summary: items.map((i) => `${i.material_code} 账面${i.book_qty} 实盘${i.actual_qty} 差异${i.diff_qty}`).join('\n'),
        wms_snapshot: JSON.stringify({ order: order.snapshot, items }),
      },
    };
    const res = await fetch(`${cfg.baseUrl}/api/instances`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': cfg.apiKey },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    }).catch((e) => { throw new BadRequestException(`调用 OA 失败：${e?.message || e}`); });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.code !== 0) throw new BadRequestException(json?.msg || `OA 返回 ${res.status}`);
    await this.db.execute(sql`
      UPDATE stock_take_order SET oa_instance_id = ${Number(json.data.id)}, oa_status = 'running' WHERE id = ${order.id}::uuid`);
    await this.attachSnapshot(Number(json.data.id), takeNo, { order: order.snapshot, items });
    return { instanceId: json.data.id, instanceNo: json.data.instance_no };
  }

  /** 提交 IQC 检验报告审批 */
  async submitIqcReport(reportNo: string) {
    const cfg = this.cfg;
    const defId = Number(process.env.OA_IQC_DEF_ID || 0);
    if (!cfg.baseUrl || !cfg.apiKey || !defId) throw new BadRequestException('OA IQC 流程未配置');
    const rows = (await this.db.execute(sql`
      SELECT to_jsonb(r) AS snapshot, r.id, r.report_no, r.final_result, r.review_status, r.oa_instance_id
        FROM iqc_report r WHERE r.report_no = ${reportNo} LIMIT 1
    `)) as unknown as any[];
    const rep = rows[0];
    if (!rep) throw new NotFoundException('检验报告不存在');
    if (rep.oa_instance_id) return { skipped: true, instanceId: rep.oa_instance_id };
    const body = {
      definitionId: defId, title: `IQC检验报告审批 ${reportNo}`, applicantUserId: 1,
      bizSystem: 'WMS', bizType: 'iqc_report', bizKey: reportNo, submitNow: true,
      formData: { wms_biz_no: reportNo, result: rep.final_result, wms_snapshot: JSON.stringify(rep.snapshot) },
    };
    const res = await fetch(`${cfg.baseUrl}/api/instances`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': cfg.apiKey },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    }).catch((e) => { throw new BadRequestException(`调用 OA 失败：${e?.message || e}`); });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.code !== 0) throw new BadRequestException(json?.msg || `OA 返回 ${res.status}`);
    await this.db.execute(sql`
      UPDATE iqc_report SET oa_instance_id = ${Number(json.data.id)}, oa_status = 'running' WHERE id = ${rep.id}::uuid`);
    await this.attachSnapshot(Number(json.data.id), reportNo, rep.snapshot);
    return { instanceId: json.data.id, instanceNo: json.data.instance_no };
  }

  /** 提交 MRB 评审 */
  async submitMrb(mrbNo: string) {
    const cfg = this.cfg;
    const defId = Number(process.env.OA_MRB_DEF_ID || 0);
    if (!cfg.baseUrl || !cfg.apiKey || !defId) throw new BadRequestException('OA MRB 流程未配置');
    const rows = (await this.db.execute(sql`
      SELECT to_jsonb(m) AS snapshot, m.id, m.mrb_no, m.status, m.quantity, m.oa_instance_id,
             mat.material_code
        FROM mrb_review m LEFT JOIN material mat ON mat.id = m.material_id
       WHERE m.mrb_no = ${mrbNo} LIMIT 1
    `)) as unknown as any[];
    const mrb = rows[0];
    if (!mrb) throw new NotFoundException('MRB 不存在');
    if (mrb.oa_instance_id) return { skipped: true, instanceId: mrb.oa_instance_id };

    const body = {
      definitionId: defId, title: `MRB评审 ${mrbNo}`, applicantUserId: 1,
      bizSystem: 'WMS', bizType: 'mrb', bizKey: mrbNo, submitNow: true,
      formData: {
        wms_biz_no: mrbNo, material_code: mrb.material_code,
        qty: Number(mrb.quantity || 0),
        wms_snapshot: JSON.stringify(mrb.snapshot),
      },
    };
    const res = await fetch(`${cfg.baseUrl}/api/instances`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': cfg.apiKey },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    }).catch((e) => { throw new BadRequestException(`调用 OA 失败：${e?.message || e}`); });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.code !== 0) throw new BadRequestException(json?.msg || `OA 返回 ${res.status}`);
    await this.db.execute(sql`
      UPDATE mrb_review SET oa_instance_id = ${Number(json.data.id)}, oa_status = 'running' WHERE id = ${mrb.id}::uuid`);
    await this.attachSnapshot(Number(json.data.id), mrbNo, mrb.snapshot);
    return { instanceId: json.data.id, instanceNo: json.data.instance_no };
  }

  /** 发料完成后，把实际发料数量回写到 OA 表单（OA 里存的是提交时快照） */
  async syncIssuedResult(pickingNo: string) {
    const cfg = this.cfg;
    if (!cfg.baseUrl || !cfg.apiKey) return { skipped: true };
    const rows = (await this.db.execute(sql`
      SELECT id, oa_instance_id FROM picking_order WHERE picking_no = ${pickingNo} LIMIT 1
    `)) as unknown as any[];
    const order = rows[0];
    if (!order?.oa_instance_id) return { skipped: true };
    const items = (await this.db.execute(sql`
      SELECT material_code, material_name, unit, pick_qty, actual_qty, received_qty
        FROM picking_order_item WHERE picking_id = ${order.id}::uuid ORDER BY material_code
    `)) as unknown as any[];
    const actualTotal = items.reduce(
      (n, i) => n + (Number(i.actual_qty) > 0 ? Number(i.actual_qty) : 0), 0);
    const patch = {
      items: items.map((i) => ({
        material_code: i.material_code,
        material_name: i.material_name,
        pick_qty: Number(i.pick_qty || 0),
        actual_qty: Number(i.actual_qty || 0),
        unit: i.unit,
      })),
      items_text: items
        .map((i) => `${i.material_code}  ${i.material_name}  应发 ${Number(i.pick_qty || 0)} ${i.unit}  实发 ${Number(i.actual_qty || 0)} ${i.unit}`)
        .join('\n'),
      total_qty: actualTotal,
    };
    try {
      const res = await fetch(`${cfg.baseUrl}/api/instances/${Number(order.oa_instance_id)}/form-data`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': cfg.apiKey },
        body: JSON.stringify({ patch }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { ok: true };
    } catch (e: any) {
      this.logger.warn(`OA 发料数量回写失败 ${pickingNo}: ${e?.message || e}`);
      return { ok: false };
    }
  }

  /** 兼容旧入口 */
  submitPickingApproval(no: string) { return this.submitStage(no, 'approval'); }
  submitPickingReceive(no: string) { return this.submitStage(no, 'receive'); }
  submitPickingConfirmation(no: string) { return this.submitStage(no, 'confirm'); }

  /** 后台推进：按状态自动提交下一阶段 */
  private async advancePipeline() {
    if (this.running) return;
    this.running = true;
    try {
      const cfg = this.cfg;
      if (!cfg.baseUrl || !cfg.apiKey) return;

      const rows = (await this.db.execute(sql`
        SELECT picking_no FROM picking_order
         WHERE status = 'pending_approval' AND oa_instance_id IS NULL
         ORDER BY _created_at ASC LIMIT 20
      `)) as unknown as any[];

      for (const r of rows) {
        try {
          await this.submitStage(r.picking_no);
          this.logger.log(`OA 提交成功 ${r.picking_no}`);
        } catch (e: any) {
          this.logger.warn(`OA 提交失败 ${r.picking_no}: ${e?.message || e}`);
        }
      }

      // 超补领料单：生成后自动提交 OA
      const overRows = (await this.db.execute(sql`
        SELECT order_no FROM over_picking_order
         WHERE status = 'pending_approval' AND oa_instance_id IS NULL
         ORDER BY _created_at ASC LIMIT 20
      `)) as unknown as any[];
      for (const r of overRows) {
        try {
          await this.submitOverSupplement(r.order_no);
          this.logger.log(`OA 超补提交成功 ${r.order_no}`);
        } catch (e: any) {
          this.logger.warn(`OA 超补提交失败 ${r.order_no}: ${e?.message || e}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** OA 审批结果回调：只更新状态与阶段结果，下一步由 advancePipeline 接管 */
  async handleCallback(raw: any, signature?: string) {
    const cfg = this.cfg;
    // 失败关闭：没配 secret 就不接受回调，避免开天窗
    if (!cfg.secret) throw new UnauthorizedException('回调密钥未配置（OA_WEBHOOK_SECRET）');
    const expect = crypto.createHmac('sha256', cfg.secret).update(JSON.stringify(raw)).digest('hex');
    if (!signature || signature !== expect) throw new UnauthorizedException('回调验签失败');
    const { instanceId, event, bizType, bizKey, status, nodeIndex } = raw || {};
    if (!instanceId || !bizType || !bizKey) throw new BadRequestException('回调缺少必要字段');

    const dup = (await this.db.execute(sql`
      SELECT id FROM oa_callback_log
       WHERE oa_instance_id = ${Number(instanceId)}
         AND event = ${String(event)}
         AND node_index IS NOT DISTINCT FROM ${nodeIndex ?? null}
       LIMIT 1
    `)) as unknown as any[];
    if (dup.length) return { skipped: true };

    const approved = event === 'completed' || status === 'approved';
    const rejected = status === 'rejected';

    if (bizType === 'picking_flow') {
      const idx = nodeIndex ?? 0;
      if (event === 'node_passed') {
        // 节点 1 通过 = 生产主管审批完成；节点 2 通过 = 物料员确认完成
        if (Number(idx) === 1) {
          await this.db.execute(sql`
            UPDATE picking_order SET status = 'approved', oa_status = 'running', oa_stage = 'receive', oa_synced_at = CURRENT_TIMESTAMP
             WHERE picking_no = ${bizKey} AND status = 'pending_approval'`);
        } else if (Number(idx) === 2) {
          await this.db.execute(sql`
            UPDATE picking_order SET status = 'received', oa_status = 'running', oa_stage = 'confirm', oa_synced_at = CURRENT_TIMESTAMP
             WHERE picking_no = ${bizKey} AND status IN ('issued','received')`);
        }
      } else if (event === 'completed' || status === 'approved') {
        // 末节点通过：结案
        await this.db.execute(sql`
          UPDATE picking_order SET status = 'closed', oa_status = 'approved', oa_stage = 'done', oa_synced_at = CURRENT_TIMESTAMP
           WHERE picking_no = ${bizKey} AND status IN ('received','closed')`);
      } else if (status === 'rejected') {
        await this.db.execute(sql`
          UPDATE picking_order SET oa_status = 'rejected', oa_synced_at = CURRENT_TIMESTAMP
           WHERE picking_no = ${bizKey}`);
      }
    }

    if (bizType === 'over_supplement') {
      const idx = Number(nodeIndex ?? 0);
      const rows = (await this.db.execute(sql`
        SELECT id, status, oa_status FROM over_picking_order WHERE order_no = ${bizKey} LIMIT 1
      `)) as unknown as any[];
      const order = rows[0];

      if (event === 'node_passed' && order) {
        // 审批段结束（进入「生产物料员确认」节点）→ 允许发料：按原逻辑生成发料凭据
        if (idx === 4 && order.oa_status !== 'approved') {
          const svc = this.moduleRef.get(OverPickingService, { strict: false });
          const admin = (await this.db.execute(sql`
            SELECT id FROM sys_account WHERE role_code = 'admin' ORDER BY _created_at LIMIT 1
          `)) as unknown as any[];
          await svc.approveOrder({
            id: order.id,
            pass: true,
            approverId: admin[0]?.id || '00000000-0000-0000-0000-000000000000',
            approverName: 'OA',
            approvalRemark: 'OA 审批通过',
          });
          await this.db.execute(sql`
            UPDATE over_picking_order SET oa_status = 'approved' WHERE order_no = ${bizKey}`);
        } else if (idx === 5) {
          await this.db.execute(sql`
            UPDATE over_picking_order SET oa_status = 'received' WHERE order_no = ${bizKey}`);
        }
      } else if (event === 'completed') {
        await this.db.execute(sql`
          UPDATE over_picking_order SET oa_status = 'confirmed' WHERE order_no = ${bizKey}`);
      } else if (status === 'rejected') {
        await this.db.execute(sql`
          UPDATE over_picking_order SET status = 'rejected', oa_status = 'rejected' WHERE order_no = ${bizKey}`);
      }
    }

    if (bizType === 'over_consume') {
      if (approved) {
        await this.db.execute(sql`
          UPDATE work_order SET over_consume_status = 'approved', oa_status = 'approved',
                 over_consume_approved_time = CURRENT_TIMESTAMP
           WHERE work_order_no = ${bizKey}`);
      } else if (status === 'rejected') {
        await this.db.execute(sql`
          UPDATE work_order SET over_consume_status = 'rejected', oa_status = 'rejected'
           WHERE work_order_no = ${bizKey}`);
      }
    }

    if (bizType === 'stock_take' && (event === 'completed' || rejected)) {
      const rows = (await this.db.execute(sql`
        SELECT id FROM stock_take_order WHERE take_no = ${bizKey} AND status = 'pending_approval' LIMIT 1
      `)) as unknown as any[];
      if (rows[0]?.id) {
        const svc = this.moduleRef.get(StockTakeService, { strict: false });
        const admin = (await this.db.execute(sql`
          SELECT id FROM sys_account WHERE role_code = 'admin' ORDER BY _created_at LIMIT 1
        `)) as unknown as any[];
        await svc.approveTake({
          id: rows[0].id,
          pass: approved,
          approverId: admin[0]?.id,
          approverName: 'OA',
          approverRole: 'admin',
          approvalRemark: approved ? 'OA 审批通过' : 'OA 驳回',
        });
        await this.db.execute(sql`
          UPDATE stock_take_order SET oa_status = ${approved ? 'approved' : 'rejected'} WHERE take_no = ${bizKey}`);
      }
    }

    if (bizType === 'iqc_report' && (event === 'completed' || rejected)) {
      const rows = (await this.db.execute(sql`
        SELECT id FROM iqc_report WHERE report_no = ${bizKey} LIMIT 1
      `)) as unknown as any[];
      if (rows[0]?.id && approved) {
        const svc = this.moduleRef.get(IqcService, { strict: false });
        const admin = (await this.db.execute(sql`
          SELECT id FROM sys_account WHERE role_code = 'admin' ORDER BY _created_at LIMIT 1
        `)) as unknown as any[];
        await svc.batchApproveReports([rows[0].id], admin[0]?.id, 'OA');
        await this.db.execute(sql`
          UPDATE iqc_report SET oa_status = 'approved' WHERE report_no = ${bizKey}`);
      } else if (rows[0]?.id && status === 'rejected') {
        await this.db.execute(sql`
          UPDATE iqc_report SET oa_status = 'rejected' WHERE report_no = ${bizKey}`);
      }
    }

    if (bizType === 'mrb') {
      const rows = (await this.db.execute(sql`
        SELECT id FROM mrb_review WHERE mrb_no = ${bizKey} LIMIT 1
      `)) as unknown as any[];
      if (rows[0]?.id) {
        if (event === 'completed' && approved) {
          const finalResult = raw?.finalResult || 'special_admit';
          const svc = this.moduleRef.get(MrbService, { strict: false });
          const admin = (await this.db.execute(sql`
            SELECT id FROM sys_account WHERE role_code = 'admin' ORDER BY _created_at LIMIT 1
          `)) as unknown as any[];
          await svc.finalApprove({
            mrbId: rows[0].id,
            finalResult,
            approverId: admin[0]?.id,
            approverName: 'OA',
            roleCode: 'admin',
            finalRemark: `OA 终审通过（${finalResult}）`,
          });
          await this.db.execute(sql`
            UPDATE mrb_review SET oa_status = 'approved' WHERE mrb_no = ${bizKey}`);
        } else if (status === 'rejected') {
          await this.db.execute(sql`
            UPDATE mrb_review SET oa_status = 'rejected' WHERE mrb_no = ${bizKey}`);
        }
      }
    }

    await this.db.execute(sql`
      INSERT INTO oa_callback_log (oa_instance_id, event, node_index, biz_type, biz_key, payload)
      VALUES (${Number(instanceId)}, ${String(event)}, ${nodeIndex ?? null}, ${bizType}, ${bizKey}, ${JSON.stringify(raw)}::jsonb)
      ON CONFLICT DO NOTHING
    `);

    this.logger.log(`OA callback ${bizType}/${bizKey} -> ${event}/${status}`);
    return { ok: true };
  }
}
