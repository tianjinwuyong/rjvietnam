/**
 * OA → WMS：MRB 决策回填（P2）
 * ------------------------------------------------------------------
 * 职责边界（与 IQC 一致）：
 *   · OA 负责评审意见与审批结论
 *   · WMS 负责单据状态机、处置执行、库存与欠料
 *
 * 为什么由本服务按状态"自动推进"而不是让 OA 关心 WMS 内部阶段：
 *   WMS 的 MRB 是「预审(pending_approval) → 终审(pending_final)」两段，
 *   OA 只有一次「审批通过」。若让 OA 分两次调用，任何一个节点失败都会让两边
 *   状态错位。这里做一次幂等的"推进到终审"，OA 只需说"通过了"。
 */
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';

import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { mrbReview, sysAccount } from '../../database/schema';
import { MrbService } from '../mrb/mrb.service';
import { OaOutboxService } from './oa-outbox.service';

type FinalDecision = 'special_admit' | 'return' | 'rework' | 'scrap' | 'other';

export interface OaMrbDecisionDto {
  mrbNo?: string;
  finalDecision?: FinalDecision | 'reject';
  comment?: string;
  approvedBy?: { name?: string; employeeNo?: string } | null;
  /**
   * OA 流程逐人评审记录（可选）：[{ node, name, action, comment, at }]
   * 只作为**审计留痕**追加到 mrb_review.remark，不驱动 WMS 的评审状态机
   * （WMS 的 submitReview 要求评审员已分配且全部提交，硬接会让 OA 审批反过来卡住 WMS）
   */
  reviews?: Array<{ node?: string; name?: string; action?: string; comment?: string; at?: string }> | null;
}

@Injectable()
export class OaMrbService {
  private readonly logger = new Logger(OaMrbService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly mrbService: MrbService,
    private readonly outbox: OaOutboxService,
  ) {}

  /**
   * 把新建的 MRB 入队推给 OA（由 IqcService 在 fail 落账后调用）。
   * 走 outbox 而不是直接 fetch：MRB 创建发生在审批事务外，但仍不应被网络抖动影响。
   */
  async enqueueCreated(mrbNo: string) {
    const rows = (await this.db.execute(sql`
      SELECT m.mrb_no, m.status, m.quantity::text AS quantity, m.unit, m.fail_reason,
             m.is_urgent, m.plan_time, m.batch_no, m.created_at,
             l.lot_no, mat.material_code, mat.material_name, sup.supplier_name,
             COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                        'dispositionType', d.disposition_type,
                        'otherType', d.other_type,
                        'quantity', d.quantity::text,
                        'unit', d.unit,
                        'execStatus', d.exec_status,
                        'remark', d.remark) ORDER BY d.sort_order)
                 FROM mrb_disposition d WHERE d.mrb_id = m.id
             ), '[]'::jsonb) AS dispositions
        FROM mrb_review m
        LEFT JOIN iqc_lot l ON l.id = m.lot_id
        LEFT JOIN material mat ON mat.id = m.material_id
        LEFT JOIN supplier sup ON sup.id = m.supplier_id
       WHERE m.mrb_no = ${mrbNo}
       LIMIT 1
    `)) as unknown as Array<Record<string, any>>;
    const m = rows?.[0];
    if (!m) return { skipped: true, reason: 'not-found' };

    const payload = {
      event: 'mrb.created',
      bizKey: m.mrb_no,
      occurredAt: new Date().toISOString(),
      mrb: {
        mrbNo: m.mrb_no,
        lotNo: m.lot_no,
        materialCode: m.material_code,
        materialName: m.material_name,
        supplierName: m.supplier_name,
        batchNo: m.batch_no,
        quantity: m.quantity === null ? null : Number(m.quantity),
        unit: m.unit,
        failReason: m.fail_reason,
        isUrgent: !!m.is_urgent,
        status: m.status,
        planTime: m.plan_time,
      },
      dispositions: Array.isArray(m.dispositions) ? m.dispositions : [],
    };
    await this.outbox.enqueue('mrb.created', m.mrb_no, payload);
    this.logger.log(`MRB ${m.mrb_no} 已入队待推送 OA（处置 ${payload.dispositions.length} 条）`);
    return { ok: true, queued: true };
  }

  /** 取一个 admin 账号作为"系统经办人"（WMS 的审批方法按 roleCode 校验，admin 可越过） */
  private async adminOperator(): Promise<{ userId: string; name: string }> {
    const rows = await this.db
      .select({ id: sysAccount.id, account: sysAccount.account, roleCode: sysAccount.roleCode })
      .from(sysAccount)
      .where(eq(sysAccount.roleCode, 'admin'))
      .limit(1);
    const acc = rows[0];
    if (!acc) throw new BadRequestException('WMS 未配置 admin 账号，无法代 OA 执行审批');
    return { userId: acc.id, name: acc.account || 'OA' };
  }

  private async loadByNo(mrbNo: string) {
    const rows = await this.db.select().from(mrbReview).where(eq(mrbReview.mrbNo, mrbNo)).limit(1);
    const mrb = rows[0];
    if (!mrb) throw new NotFoundException(`MRB 不存在：${mrbNo}`);
    return mrb;
  }

  /**
   * 把 OA 的逐人评审意见追加到 mrb_review.remark（审计留痕）。
   * 幂等：同一份内容只追加一次（按 `${mrbNo}#review-trail` 标记判断）。
   */
  private async appendReviewTrail(mrbId: string, mrbNo: string, reviews?: OaMrbDecisionDto['reviews']) {
    const list = Array.isArray(reviews) ? reviews.filter((r) => r && (r.comment || r.name)) : [];
    if (!list.length) return;

    const marker = `[OA评审留痕 ${mrbNo}]`;
    const rows = (await this.db.execute(sql`
      SELECT COALESCE(remark, '') AS remark FROM mrb_review WHERE id = ${mrbId} LIMIT 1
    `)) as unknown as Array<{ remark: string }>;
    const prev = rows?.[0]?.remark || '';
    if (prev.includes(marker)) return;                 // 已写过

    const body = list
      .map((r) => `· ${r.node || '评审'} / ${r.name || '-'} / ${r.action || '同意'} / ${(r.at || '').slice(0, 16)}${r.comment ? `：${r.comment}` : ''}`)
      .join('\n');

    await this.db.execute(sql`
      UPDATE mrb_review
         SET remark = ${`${prev ? `${prev}\n` : ''}${marker}\n${body}`.slice(0, 4000)}
       WHERE id = ${mrbId}
    `);
  }

  /**
   * OA 审批结果回填。
   * @param dto.finalDecision 终审处置；传 'reject' 表示否决（全批退货）
   */
  async applyDecision(dto: OaMrbDecisionDto) {
    const mrbNo = String(dto?.mrbNo || '').trim();
    if (!mrbNo) throw new BadRequestException('mrbNo 必填');

    let mrb = await this.loadByNo(mrbNo);

    // 已是终态 → 幂等返回（重复点击 / OA 重试）
    if (['approved', 'closed', 'rejected', 'cancelled'].includes(mrb.status)) {
      return { ok: true, mrbNo, status: mrb.status, alreadyDecided: true };
    }

    const op = await this.adminOperator();
    const who = dto?.approvedBy?.name || dto?.approvedBy?.employeeNo || 'OA';
    const comment = (dto?.comment || '').trim() || 'OA 审批通过';

    // 1) 预审未过 → 先过预审（资料齐全）
    if (mrb.status === 'pending_approval') {
      await this.mrbService.preApprove({
        mrbId: mrb.id,
        result: 'complete',
        remark: comment,
        operator: { userId: op.userId, roleCode: 'admin', name: `${op.name}(OA:${who})` },
      });
      mrb = await this.loadByNo(mrbNo);
    }

    // 2) 终审
    if (mrb.status === 'pending_final') {
      const isReject = dto?.finalDecision === 'reject';
      await this.mrbService.finalApprove({
        mrbId: mrb.id,
        // 否决走 rejectMode（内部按全批退货处理，终态 rejected）
        ...(isReject
          ? { rejectMode: true, finalRemark: comment }
          : {
              finalResult: (dto?.finalDecision as FinalDecision) || (mrb.finalDecision as FinalDecision) || 'special_admit',
              finalRemark: comment,
            }),
        approverId: op.userId,
        approverName: `${op.name}(OA:${who})`,
        roleCode: 'admin',
      });
      mrb = await this.loadByNo(mrbNo);
    }

    // 逐人评审留痕必须在状态推进**之后**写：
    // finalApprove / preApprove 内部会 set remark（终审备注），先写会被覆盖（实测踩到）
    await this.appendReviewTrail(mrb.id, mrbNo, dto?.reviews);

    this.logger.log(`OA 回填 MRB ${mrbNo} → ${mrb.status}（处置 ${mrb.finalDecision || '-'}）`);
    return { ok: true, mrbNo, status: mrb.status, finalDecision: mrb.finalDecision || null };
  }
}
