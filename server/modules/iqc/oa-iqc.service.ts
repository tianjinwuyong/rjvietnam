/**
 * OA 接管 IQC 检验 —— WMS 侧入站服务（P1）
 * ------------------------------------------------------------------
 * 职责边界（见 deliverables/IQC搬OA-P1详细设计-2026-10-22.md）：
 *   · OA 负责：待检任务、检验录入、判定、报告、审批
 *   · WMS 负责：批次状态、库存迁移、欠料冲减、MRB 自动建单、严格度
 *
 * 因此本服务**只做两件事**：
 *   1) 把 OA 提交的检验结果落成 WMS 的报告 + 检验记录（review_status='pending'）
 *   2) OA 审批通过时，直接调用**现有的** reviewReport —— 它在一个事务里完成
 *      库存迁移 / 欠料冲减 / 自动 MRB / 严格度更新，本服务不重复实现任何一步
 *
 * 为什么复用 reviewReport 而不是抽公共函数：
 *   它内部没有权限校验（权限在 controller 层），且所有副作用都在同一个
 *   this.db.transaction 内、以 CAS 保证幂等。复制或拆分它会引入"审批了但没隔离"
 *   的历史 bug 类型（BUG-002）。保持不变是最安全的选择。
 * ------------------------------------------------------------------
 */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';

import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { iqcInspectionRecord, iqcLot, iqcReport } from '../../database/schema';
import { IqcService } from './iqc.service';
import { MRB_LOCK_LIKE_PATTERN } from '../mrb/mrb.status';

/** 认领后 4 小时未提交自动失效（防止有人占着批次不干活） */
const CLAIM_TTL_MS = 4 * 60 * 60 * 1000;

export interface OaInspectionItem {
  name?: string;
  spec?: string;
  measured?: number | string | null;
  verdict?: 'ok' | 'ng' | string | null;
  qty?: number | string | null;
}

export interface OaResultDto {
  lotNo: string;
  reportNo: string;
  result: 'pass' | 'fail';
  defectType?: string | null;
  defectQty?: number | string | null;
  inspector?: { employeeNo?: string; name?: string } | null;
  oaInstanceId?: number | string | null;
  items?: OaInspectionItem[];
  /** 富文本报告原件（P1 先存 remark，避免新增列；P2 再落专门字段） */
  contentHtml?: string | null;
}

@Injectable()
export class OaIqcService {
  private readonly logger = new Logger(OaIqcService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly iqcService: IqcService,
  ) {}

  /**
   * 接收 OA 提交的检验结果：写报告（待审）+ 检验记录，批次置 review_pending。
   * 幂等：按 report_no / lot_id 唯一键 upsert；已审批的报告一律 409。
   */
  async receiveResult(dto: OaResultDto) {
    if (!dto?.lotNo || !dto?.reportNo) {
      throw new BadRequestException('lotNo / reportNo 必填');
    }
    const result = dto.result === 'pass' ? 'pass' : dto.result === 'fail' ? 'fail' : null;
    if (!result) throw new BadRequestException('result 必须是 pass 或 fail');

    const lotRows = await this.db.select().from(iqcLot).where(eq(iqcLot.lotNo, dto.lotNo)).limit(1);
    const lot = lotRows[0];
    if (!lot) throw new NotFoundException(`检验批次不存在：${dto.lotNo}`);
    if (lot.status === 'pass' || lot.status === 'fail') {
      throw new ConflictException(`该批次已完成判定（${lot.status}），不能再次提交结果`);
    }

    const repRows = await this.db
      .select()
      .from(iqcReport)
      .where(eq(iqcReport.lotId, lot.id))
      .limit(1);
    const existing = repRows[0];
    if (existing?.reviewStatus === 'approved') {
      throw new ConflictException('该批次报告已审批，不能覆盖结果');
    }

    const now = new Date();
    const instanceId = dto.oaInstanceId ? Number(dto.oaInstanceId) : null;

    let reportId: string;
    if (existing) {
      reportId = existing.id;
      await this.db
        .update(iqcReport)
        .set({
          reportNo: dto.reportNo,
          finalResult: result,
          inspectionTime: now,
          reviewStatus: 'pending',
          oaInstanceId: instanceId,
          oaStatus: 'running',
        })
        .where(eq(iqcReport.id, existing.id));
    } else {
      const inserted = await this.db
        .insert(iqcReport)
        .values({
          lotId: lot.id,
          reportNo: dto.reportNo,
          finalResult: result,
          inspectionTime: now,
          reviewStatus: 'pending',
          remark: 'OA 检验提交',
          oaInstanceId: instanceId,
          oaStatus: 'running',
        })
        .returning({ id: iqcReport.id });
      reportId = inserted[0].id;
    }

    // 批次：进入待审；来源标记为 oa；认领信息清空（已提交即释放锁）
    await this.db
      .update(iqcLot)
      .set({
        status: 'review_pending',
        inspectionResult: result,
        defectType: dto.defectType ?? null,
        inspectionTime: now,
        oaSource: 'oa',
        oaClaimedBy: null,
        oaClaimedAt: null,
      })
      .where(eq(iqcLot.id, lot.id));

    // 检验记录：先清后插（与 WMS 提交口径一致，避免驳回重检后记录翻倍）
    await this.db.delete(iqcInspectionRecord).where(eq(iqcInspectionRecord.lotId, lot.id));
    const items = Array.isArray(dto.items) ? dto.items : [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      await this.db.insert(iqcInspectionRecord).values({
        lotId: lot.id,
        itemName: (it.name || `项目${i + 1}`).slice(0, 200),
        standard: it.spec ?? null,
        measuredValue: it.measured === null || it.measured === undefined ? null : String(it.measured),
        isPass: it.verdict === 'ok' ? true : it.verdict === 'ng' ? false : null,
        defectQty: it.qty === null || it.qty === undefined ? '0' : String(it.qty),
        sortOrder: i,
      });
    }

    this.logger.log(
      `OA 检验结果已接收: lot=${dto.lotNo} report=${dto.reportNo} result=${result} items=${items.length}`,
    );
    return { ok: true, reportId, lotNo: dto.lotNo, status: 'review_pending' };
  }

  /**
   * OA 审批通过 → 复用 reviewReport 完成落账。
   * reviewReport 内部 CAS：重复调用返回 409（双入口冲突的兜底防线）。
   */
  async approve(dto: { reportNo?: string; lotNo?: string; approvedBy?: { name?: string; employeeNo?: string } | null }) {
    const reportNo = String(dto?.reportNo || '').trim();
    if (!reportNo) throw new BadRequestException('reportNo 必填');

    const rows = await this.db
      .select()
      .from(iqcReport)
      .where(eq(iqcReport.reportNo, reportNo))
      .limit(1);
    const rep = rows[0];
    if (!rep) throw new NotFoundException(`检验报告不存在：${reportNo}`);
    if (rep.reviewStatus === 'approved') {
      throw new ConflictException('该报告已审批（可能已在 WMS 完成），请勿重复调用');
    }

    // 审计留痕：审批人用 OA 侧身份字符串（WMS 用户表没有 OA 账号映射，P2 再做映射）
    const who = dto?.approvedBy?.name || dto?.approvedBy?.employeeNo || 'OA';
    const out = await this.iqcService.reviewReport(
      rep.id,
      '',
      `OA:${who}`,
      'OA 审批通过（回填落账）',
    );

    await this.db
      .update(iqcReport)
      .set({ oaStatus: 'approved' })
      .where(eq(iqcReport.id, rep.id));

    this.logger.log(`OA 审批回填成功: report=${reportNo} reviewer=${who}`);
    return { ok: true, reportNo, lotId: rep.lotId, status: 'approved', reviewStatus: out?.reviewStatus };
  }

  /** OA 认领批次（防双入口：认领后 WMS 录入页只读；4h 过期可被再认领） */
  async claim(dto: { lotNo?: string; by?: string }) {
    const lotNo = String(dto?.lotNo || '').trim();
    const by = String(dto?.by || '').trim();
    if (!lotNo || !by) throw new BadRequestException('lotNo / by 必填');

    const expireBefore = new Date(Date.now() - CLAIM_TTL_MS);
    const rows = await this.db
      .update(iqcLot)
      .set({ oaClaimedBy: by.slice(0, 100), oaClaimedAt: new Date() })
      .where(
        and(
          eq(iqcLot.lotNo, lotNo),
          or(isNull(iqcLot.oaClaimedAt), lt(iqcLot.oaClaimedAt, expireBefore)),
        ),
      )
      .returning({ id: iqcLot.id, status: iqcLot.status });

    if (rows.length === 0) {
      const cur = await this.db
        .select({ claimedBy: iqcLot.oaClaimedBy, claimedAt: iqcLot.oaClaimedAt })
        .from(iqcLot)
        .where(eq(iqcLot.lotNo, lotNo))
        .limit(1);
      if (!cur.length) throw new NotFoundException(`检验批次不存在：${lotNo}`);
      throw new ConflictException(
        `该批次已被认领：${cur[0].claimedBy || '他人'}`,
      );
    }
    return { ok: true, lotNo, claimedBy: by };
  }

  /** 释放认领（OA 放弃检验 / 超时回收） */
  async release(dto: { lotNo?: string }) {
    const lotNo = String(dto?.lotNo || '').trim();
    if (!lotNo) throw new BadRequestException('lotNo 必填');
    await this.db
      .update(iqcLot)
      .set({ oaClaimedBy: null, oaClaimedAt: null })
      .where(eq(iqcLot.lotNo, lotNo));
    return { ok: true, lotNo };
  }

  /**
   * 可评审量查询（供 OA 的 MRB 页面显示这批还能评多少）。
   * ⚠️ 口径必须与 WMS 内部一致：复用 mrb.status.ts 的锁定前缀 MRB-%，
   *    否则已判退货/报废的量会被重复算成可评审（双花）。
   */
  async reviewable(dto: { materialCode?: string; batchNo?: string }) {
    const code = String(dto?.materialCode || '').trim();
    if (!code) throw new BadRequestException('materialCode 必填');
    const batch = String(dto?.batchNo || '').trim();
    const rows = (await this.db.execute(sql`
      SELECT COALESCE(SUM(inv.quantity), 0)::text AS qty, COUNT(*)::int AS lines
        FROM inventory inv
        JOIN material m ON m.id = inv.material_id
       WHERE m.material_code = ${code}
         ${batch ? sql`AND inv.batch_no = ${batch}` : sql``}
         AND inv.quantity > 0
         AND (
           (inv.stock_status = 'defective'
            AND (inv.lock_reason IS NULL OR inv.lock_reason NOT LIKE ${MRB_LOCK_LIKE_PATTERN}))
           OR
           (inv.stock_status = 'good' AND inv.locked = true
            AND (inv.lock_reason IS NULL OR inv.lock_reason NOT LIKE ${MRB_LOCK_LIKE_PATTERN}))
         )
    `)) as unknown as Array<{ qty: string; lines: number }>;
    const q = rows && rows[0];
    return {
      materialCode: code,
      batchNo: batch || null,
      reviewableQty: Number(q?.qty || 0),
      lines: Number(q?.lines || 0),
    };
  }
}
