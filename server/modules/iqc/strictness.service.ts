import { Inject, Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { eq, and, like, desc, gte, sql, count, inArray } from 'drizzle-orm';
import {
  iqcInspectionStrictness,
  iqcStrictnessTransferLog,
  iqcLotStrictnessCount,
  material,
  sysAccount,
} from '../../database/schema';
import type {
  IqcInspectionStrictness,
  IqcStrictnessTransferLog,
  StrictnessState,
  PaginatedResponse,
} from '@shared/api.interface';

/**
 * 判断 IQC 批次是否属于「来料报检合并批次」——接收批数的计数单位。
 * 仓库提交报检清单时，会按「物料 + 供应商 + 生产日期 + 批次号 + 收货日期」把多张收货单
 * 合并成 1 个 IQC 批次（lot_no 前缀 IQC）。超期复检批次前缀为 EXP，不属于来料报检合并批次，
 * 不参与「接收批数」统计。
 */
export const isMergedIncomingLot = (lotNo?: string | null): boolean =>
  !!lotNo && lotNo.startsWith('IQC');

/**
 * 严格度账本维度：按**物料**维护一条，不再区分「外观 / 尺寸功能」。
 *
 * 业务口径（2026-10-19 定稿）：不良批数只看每份检验报告的最终判定，
 * 不按 NG 出在哪个工段拆分。一份报告要么整批接收、要么整批不接收，只计一次。
 * 表里仍保留 inspection_type 列以兼容历史数据，新数据统一写 'material'。
 */
export const STRICTNESS_TYPE = 'material' as const;

@Injectable()
export class StrictnessService {
  private readonly logger = new Logger(StrictnessService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /**
   * 获取或创建物料+检验类型的严格度状态
   * 首次检验时调用，如不存在则创建默认normal状态
   */
  async getOrCreate(
    materialId: string,
    config?: { inspectionLevel?: string; aql?: string },
  ): Promise<IqcInspectionStrictness> {
    const existing = await this.db
      .select()
      .from(iqcInspectionStrictness)
      .where(
        and(
          eq(iqcInspectionStrictness.materialId, materialId),
          eq(iqcInspectionStrictness.inspectionType, STRICTNESS_TYPE),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      return this.mapToDto(existing[0]);
    }

    // 首次创建
    const inserted = await this.db
      .insert(iqcInspectionStrictness)
      .values({
        materialId,
        inspectionType: STRICTNESS_TYPE,
        strictness: 'normal',
        inspectionLevel: config?.inspectionLevel || 'II',
        aql: config?.aql || '0.4',
      })
      .returning();

    return this.mapToDto(inserted[0]);
  }

  /**
   * 首次检验配置：人工设置检验水平和AQL
   */
  async configure(
    materialId: string,
    inspectionLevel: string,
    aql: string,
    operatorId?: string,
  ): Promise<IqcInspectionStrictness> {
    const existing = await this.db
      .select()
      .from(iqcInspectionStrictness)
      .where(
        and(
          eq(iqcInspectionStrictness.materialId, materialId),
          eq(iqcInspectionStrictness.inspectionType, STRICTNESS_TYPE),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      // 已存在则更新配置
      const updated = await this.db
        .update(iqcInspectionStrictness)
        .set({ inspectionLevel, aql, ...(operatorId ? { updatedBy: operatorId } : {}) })
        .where(eq(iqcInspectionStrictness.id, existing[0].id))
        .returning();
      return this.mapToDto(updated[0]);
    }

    // 新建
    const inserted = await this.db
      .insert(iqcInspectionStrictness)
      .values({
        materialId,
        inspectionType: STRICTNESS_TYPE,
        strictness: 'normal',
        inspectionLevel,
        aql,
        ...(operatorId ? { createdBy: operatorId } : {}),
      })
      .returning();

    return this.mapToDto(inserted[0]);
  }

  /**
   * 检验审批通过后调用：根据批次接收/不接收更新严格度状态机
   *
   * 计数口径（重要）：
   * - 「接收批数」以**提交到 IQC 后合并成的批次**（iqc_lot）为单位，与收货单张数无关；
   * - 仅「来料报检合并批次」（lot_no 前缀 IQC）参与计数，超期复检（EXP）等批次不计；
   * - 同一批次 + 同一检验类型只计一次（iqc_lot_strictness_count 唯一键保证），
   *   同一批次被重复审批时不会重复累加计数。
   *
   * @param materialId 物料ID
   * @param accepted 批次是否接收（true=pass, false=fail）——整份报告的最终判定，不分工段
   * @param reportId 关联报告ID
   * @param lotId 关联批次ID
   * @param lotNo 关联批次号（用于判断是否属于来料报检合并批次）
   */
  async onInspectionResult(
    materialId: string,
    accepted: boolean,
    reportId?: string,
    lotId?: string,
    lotNo?: string,
  ): Promise<{ strictness: StrictnessState; transferred: boolean; transferReason?: string; counted: boolean }> {
    const record = await this.getOrCreate(materialId);

    // 如果是免检或暂停状态，不参与自动计数
    if (record.strictness === 'exempt' || record.strictness === 'suspended') {
      return { strictness: record.strictness, transferred: false, counted: false };
    }

    // 计数单位限定为「来料报检合并批次」；超期复检等批次不参与接收批数统计
    if (lotNo && !isMergedIncomingLot(lotNo)) {
      this.logger.log(`严格度计数跳过（非来料报检合并批次）: lotNo=${lotNo}, material=${materialId}`);
      return { strictness: record.strictness, transferred: false, counted: false };
    }

    // 更新数据库：计数台账 + 状态 + 转移日志在同一事务内完成，
    // 台账唯一键冲突即代表「该批次已计过数」，直接跳过（幂等，避免重复审批重复累加）
    return await this.db.transaction(async (tx) => {
      if (lotId) {
        const counted = await tx
          .insert(iqcLotStrictnessCount)
          .values({
            lotId,
            materialId,
            inspectionType: STRICTNESS_TYPE,
            accepted,
            strictnessAtCount: record.strictness,
          })
          .onConflictDoNothing()
          .returning({ id: iqcLotStrictnessCount.id });

        if (counted.length === 0) {
          this.logger.log(
            `严格度计数跳过（该批次已计过数，幂等）: lotId=${lotId}`,
          );
          return { strictness: record.strictness, transferred: false, counted: false };
        }
      }

      // ===== 真·滑动窗口：取最近 10 批（含本批）的最终判定 =====
      // 旧实现用「接收就减 1」的衰减计数表示「近 5 批拒收数」，一批合格会把
      // 前一笔拒收冲掉：R A A R 时计数为 1→0→0→1，永远触发不了「5 批内 2 批拒收」。
      // 这里直接从计数台账取最近 5 / 10 批的真实结果序列，窗口随批次滚动，
      // 不做任何加减衰减；口径仍是「每份报告的最终判定」，不按 NG 工段拆分。
      const recentRows = await tx
        .select({ accepted: iqcLotStrictnessCount.accepted })
        .from(iqcLotStrictnessCount)
        .where(
          and(
            eq(iqcLotStrictnessCount.materialId, materialId),
            eq(iqcLotStrictnessCount.inspectionType, STRICTNESS_TYPE),
          ),
        )
        .orderBy(desc(iqcLotStrictnessCount.createdAt), desc(iqcLotStrictnessCount.id))
        .limit(10);

      const flags = recentRows.map((r) => !!r.accepted); // index 0 = 最新一批
      const rejectedIn5 = flags.slice(0, 5).filter((v) => !v).length;
      // 连续接收批数（从最新一批往前数，遇到不接收即停）
      let acceptedStreak = 0;
      for (const f of flags) {
        if (!f) break;
        acceptedStreak += 1;
      }
      const allAcceptedIn10 = flags.length >= 10 && flags.slice(0, 10).every(Boolean);

      let newStrictness = record.strictness;
      let transferReason: string | undefined;
      const updates: Record<string, any> = {};

      if (record.strictness === 'normal') {
        if (rejectedIn5 >= 2) {
          // 正常→加严：连续 5 批或少于 5 批中有 2 批不接收
          newStrictness = 'tightened';
          transferReason = `近5批中有${rejectedIn5}批不接收，转为加严检验`;
          updates.consecutiveAccepted = 0;
          updates.recentRejectedIn5 = 0;
          updates.tightenedRejectedTotal = 0;
          updates.tightenedConsecutiveAccepted = 0;
        } else if (allAcceptedIn10) {
          // 正常→放宽：连续 10 批全部接收
          newStrictness = 'reduced';
          transferReason = '正常检验连续10批接收，转为放宽检验';
          updates.consecutiveAccepted = 0;
          updates.recentRejectedIn5 = 0;
        } else {
          updates.consecutiveAccepted = acceptedStreak;
          updates.recentRejectedIn5 = rejectedIn5;
        }
      } else if (record.strictness === 'tightened') {
        if (accepted) {
          // 加严→正常：连续 5 批接收
          if (acceptedStreak >= 5) {
            newStrictness = 'normal';
            transferReason = `加严检验连续${acceptedStreak}批接收，恢复正常检验`;
            updates.tightenedConsecutiveAccepted = 0;
            updates.tightenedRejectedTotal = 0;
            // 转入正常时保留当前连续接收进度，避免第 6 批合格才从 0 重新数
            updates.consecutiveAccepted = acceptedStreak;
            updates.recentRejectedIn5 = rejectedIn5;
          } else {
            updates.tightenedConsecutiveAccepted = acceptedStreak;
          }
        } else {
          const tightenedRejectedTotal = record.tightenedRejectedTotal + 1;
          updates.tightenedRejectedTotal = tightenedRejectedTotal;
          updates.tightenedConsecutiveAccepted = 0;

          // 加严→暂停：累计 5 批不接收
          if (tightenedRejectedTotal >= 5) {
            newStrictness = 'suspended';
            transferReason = `加严检验累计${tightenedRejectedTotal}批不接收，暂停检验`;
          }
        }
      } else if (record.strictness === 'reduced') {
        if (!accepted) {
          // 放宽→正常：出现 1 批不接收
          newStrictness = 'normal';
          transferReason = '放宽检验出现1批不接收，恢复正常检验';
          updates.consecutiveAccepted = 0;
          updates.recentRejectedIn5 = rejectedIn5;
        } else {
          // 放宽期连续接收计数：满 10 批后在页面上标绿，允许人工转免检
          updates.consecutiveAccepted = record.consecutiveAccepted + 1;
          updates.recentRejectedIn5 = rejectedIn5;
        }
      }

      await tx
        .update(iqcInspectionStrictness)
        .set({ ...updates, strictness: newStrictness })
        .where(eq(iqcInspectionStrictness.id, record.id));

      if (newStrictness !== record.strictness) {
        await tx.insert(iqcStrictnessTransferLog).values({
          materialId,
          inspectionType: STRICTNESS_TYPE,
          fromStrictness: record.strictness,
          toStrictness: newStrictness,
          transferType: 'auto',
          reportId: reportId || null,
          lotId: lotId || null,
          reason: transferReason || '自动转移',
        });
        this.logger.log(`严格度自动转移: material=${materialId}, ${record.strictness}→${newStrictness}`);
      }

      return {
        strictness: newStrictness,
        transferred: newStrictness !== record.strictness,
        transferReason,
        counted: true,
      };
    });
  }

  /**
   * 人工操作：放宽 → 免检（品质主管审批）
   *
   * 前置条件：当前必须为放宽检验，且放宽期内**连续 10 批接收**。
   * 不足 10 批时页面会显示进度但禁止提交，服务端同样拦截。
   */
  async manualToExempt(
    materialId: string,
    operatorId: string,
    operatorName: string,
    reason?: string,
  ): Promise<IqcInspectionStrictness> {
    const record = await this.getOrCreate(materialId);
    if (record.strictness !== 'reduced') {
      throw new BadRequestException(`当前严格度为 ${record.strictness}，仅放宽检验可转为免检`);
    }
    if (record.consecutiveAccepted < 10) {
      throw new BadRequestException(
        `放宽检验需连续10批接收才能转免检，当前已连续 ${record.consecutiveAccepted} 批`,
      );
    }

    await this.db
      .update(iqcInspectionStrictness)
      .set({ strictness: 'exempt', remark: reason || null, updatedBy: operatorId })
      .where(eq(iqcInspectionStrictness.id, record.id));

    await this.db.insert(iqcStrictnessTransferLog).values({
      materialId,
      inspectionType: STRICTNESS_TYPE,
      fromStrictness: 'reduced',
      toStrictness: 'exempt',
      transferType: 'manual',
      reason: reason || '品质主管审批免检',
      operatorId,
      operatorName,
    });

    return this.getOrCreate(materialId);
  }

  /**
   * 人工调整：把物料改为**正常检验**（任意状态均可，理由必填）。
   *
   * 场景：产线出现质量波动需要临时收紧，处置完成后由品质主管恢复正常。
   */
  async manualToNormal(
    materialId: string,
    operatorId: string,
    operatorName: string,
    reason?: string,
  ): Promise<IqcInspectionStrictness> {
    const record = await this.getOrCreate(materialId);
    if (record.strictness === 'normal') {
      throw new BadRequestException('该物料当前已是正常检验，无需调整');
    }
    const why = this.requireReason(reason);

    await this.db
      .update(iqcInspectionStrictness)
      .set({
        strictness: 'normal',
        consecutiveAccepted: 0,
        recentRejectedIn5: 0,
        tightenedRejectedTotal: 0,
        tightenedConsecutiveAccepted: 0,
        remark: why,
        updatedBy: operatorId,
      })
      .where(eq(iqcInspectionStrictness.id, record.id));

    await this.db.insert(iqcStrictnessTransferLog).values({
      materialId,
      inspectionType: STRICTNESS_TYPE,
      fromStrictness: record.strictness,
      toStrictness: 'normal',
      transferType: 'manual',
      reason: `人工调整为正常检验：${why}`,
      operatorId,
      operatorName,
    });

    return this.getOrCreate(materialId);
  }

  /**
   * 人工调整：把物料改为**加严检验**（任意状态均可，理由必填）。
   *
   * 场景：产线或客户反馈质量问题，需要立即收紧来料检验，遏制不良扩大。
   * 加严期计数从零开始重新累积（累计 5 批不接收 → 暂停）。
   */
  async manualToTightened(
    materialId: string,
    operatorId: string,
    operatorName: string,
    reason?: string,
  ): Promise<IqcInspectionStrictness> {
    const record = await this.getOrCreate(materialId);
    if (record.strictness === 'tightened') {
      throw new BadRequestException('该物料当前已是加严检验，无需调整');
    }
    const why = this.requireReason(reason);

    await this.db
      .update(iqcInspectionStrictness)
      .set({
        strictness: 'tightened',
        consecutiveAccepted: 0,
        recentRejectedIn5: 0,
        tightenedRejectedTotal: 0,
        tightenedConsecutiveAccepted: 0,
        remark: why,
        updatedBy: operatorId,
      })
      .where(eq(iqcInspectionStrictness.id, record.id));

    await this.db.insert(iqcStrictnessTransferLog).values({
      materialId,
      inspectionType: STRICTNESS_TYPE,
      fromStrictness: record.strictness,
      toStrictness: 'tightened',
      transferType: 'manual',
      reason: `人工调整为加严检验：${why}`,
      operatorId,
      operatorName,
    });

    return this.getOrCreate(materialId);
  }

  /** 人工调整必须留痕：理由不能为空 */
  private requireReason(reason?: string): string {
    const value = (reason || '').trim();
    if (!value) {
      throw new BadRequestException('人工调整严格度必须填写理由');
    }
    return value;
  }

  /**
   * 人工操作：免检 → 放宽（退出免检，但仍保留较松的抽样力度）
   *
   * 白名单：质量经理 / IQC 主管 / 系统管理员（见 controller 的角色守卫）。
   */
  async manualToReducedFromExempt(
    materialId: string,
    operatorId: string,
    operatorName: string,
    reason?: string,
  ): Promise<IqcInspectionStrictness> {
    const record = await this.getOrCreate(materialId);
    if (record.strictness !== 'exempt') {
      throw new BadRequestException(`当前严格度为 ${record.strictness}，仅免检状态可转为放宽检验`);
    }

    await this.db
      .update(iqcInspectionStrictness)
      .set({
        strictness: 'reduced',
        consecutiveAccepted: 0,
        recentRejectedIn5: 0,
        remark: reason || null,
        updatedBy: operatorId,
      })
      .where(eq(iqcInspectionStrictness.id, record.id));

    await this.db.insert(iqcStrictnessTransferLog).values({
      materialId,
      inspectionType: STRICTNESS_TYPE,
      fromStrictness: 'exempt',
      toStrictness: 'reduced',
      transferType: 'manual',
      reason: reason || '免检退出，转为放宽检验',
      operatorId,
      operatorName,
    });

    return this.getOrCreate(materialId);
  }

  /**
   * 人工操作：免检→正常（物料异常登记）
   */
  async manualToNormalFromExempt(
    materialId: string,
    operatorId: string,
    operatorName: string,
    exceptionSource: string,
    reason?: string,
  ): Promise<IqcInspectionStrictness> {
    const record = await this.getOrCreate(materialId);
    if (record.strictness !== 'exempt') {
      throw new BadRequestException(`当前严格度为 ${record.strictness}，仅免检状态可恢复正常检验`);
    }

    await this.db
      .update(iqcInspectionStrictness)
      .set({
        strictness: 'normal',
        exceptionSource,
        remark: reason || null,
        consecutiveAccepted: 0,
        recentRejectedIn5: 0,
        updatedBy: operatorId,
      })
      .where(eq(iqcInspectionStrictness.id, record.id));

    await this.db.insert(iqcStrictnessTransferLog).values({
      materialId,
      inspectionType: STRICTNESS_TYPE,
      fromStrictness: 'exempt',
      toStrictness: 'normal',
      transferType: 'manual',
      reason: `物料异常登记（来源:${exceptionSource}）${reason ? '：' + reason : ''}`,
      operatorId,
      operatorName,
    });

    return this.getOrCreate(materialId);
  }

  /**
   * 人工操作：免检→加严（免检物料出现质量问题，人工收紧为加严检验）
   */
  async manualToTightenedFromExempt(
    materialId: string,
    operatorId: string,
    operatorName: string,
    reason?: string,
    exceptionSource?: string,
  ): Promise<IqcInspectionStrictness> {
    const record = await this.getOrCreate(materialId);
    if (record.strictness !== 'exempt') {
      throw new BadRequestException(`当前严格度为 ${record.strictness}，仅免检状态可转为加严检验`);
    }

    await this.db
      .update(iqcInspectionStrictness)
      .set({
        strictness: 'tightened',
        // 从免检直接收紧，加严期计数从零开始重新累积
        consecutiveAccepted: 0,
        recentRejectedIn5: 0,
        tightenedRejectedTotal: 0,
        tightenedConsecutiveAccepted: 0,
        ...(exceptionSource ? { exceptionSource } : {}),
        remark: reason || null,
        updatedBy: operatorId,
      })
      .where(eq(iqcInspectionStrictness.id, record.id));

    await this.db.insert(iqcStrictnessTransferLog).values({
      materialId,
      inspectionType: STRICTNESS_TYPE,
      fromStrictness: 'exempt',
      toStrictness: 'tightened',
      transferType: 'manual',
      reason: `${exceptionSource ? `物料异常登记（来源:${exceptionSource}）` : '免检物料收紧'}${reason ? '：' + reason : ''}`,
      operatorId,
      operatorName,
    });

    return this.getOrCreate(materialId);
  }

  /**
   * 人工操作：暂停→加严（供应方改进质量确认）
   */
  async manualToTightenedFromSuspended(
    materialId: string,
    operatorId: string,
    operatorName: string,
    reason?: string,
  ): Promise<IqcInspectionStrictness> {
    const record = await this.getOrCreate(materialId);
    if (record.strictness !== 'suspended') {
      throw new BadRequestException(`当前严格度为 ${record.strictness}，仅暂停状态可恢复加严检验`);
    }

    await this.db
      .update(iqcInspectionStrictness)
      .set({
        strictness: 'tightened',
        tightenedRejectedTotal: 0,
        tightenedConsecutiveAccepted: 0,
        remark: reason || null,
        updatedBy: operatorId,
      })
      .where(eq(iqcInspectionStrictness.id, record.id));

    await this.db.insert(iqcStrictnessTransferLog).values({
      materialId,
      inspectionType: STRICTNESS_TYPE,
      fromStrictness: 'suspended',
      toStrictness: 'tightened',
      transferType: 'manual',
      reason: reason || '供应方改进质量确认，恢复加严检验',
      operatorId,
      operatorName,
    });

    return this.getOrCreate(materialId);
  }

  /**
   * 严格度列表查询
   */
  async list(params: {
    page: number;
    pageSize: number;
    materialCode?: string;
    materialName?: string;
    strictness?: string;
  }): Promise<PaginatedResponse<IqcInspectionStrictness>> {
    const { page, pageSize, materialCode, materialName, strictness } = params;

    // 列表范围 = 仓库实际收到过货的物料（有收货单或库存）∪ 已有严格度账本的物料。
    // 只从严格度表出发会漏掉「刚收货、还没检验」的物料，品质主管就没法提前把它调成加严。
    // 没有账本的物料按正常检验展示（虚拟行），人工调整时 getOrCreate 会落账。
    const receivedCondition = sql`(
      EXISTS (SELECT 1 FROM receipt_order ro WHERE ro.material_id = ${material.id})
      OR EXISTS (SELECT 1 FROM inventory inv WHERE inv.material_id = ${material.id})
      OR ${iqcInspectionStrictness.id} IS NOT NULL
    )`;

    const strictnessExpr = sql<string>`COALESCE(${iqcInspectionStrictness.strictness}, 'normal')`;

    const conditions = [receivedCondition];
    if (materialCode) conditions.push(like(material.materialCode, `%${materialCode}%`));
    if (materialName) conditions.push(like(material.materialName, `%${materialName}%`));
    if (strictness) conditions.push(sql`${strictnessExpr} = ${strictness}`);

    const joined = this.db
      .select({
        id: sql<string>`COALESCE(${iqcInspectionStrictness.id}::text, ${material.id}::text)`,
        materialId: material.id,
        materialCode: material.materialCode,
        materialName: material.materialName,
        inspectionType: sql<string>`'material'`,
        strictness: strictnessExpr,
        inspectionLevel: sql<string>`COALESCE(${iqcInspectionStrictness.inspectionLevel}, 'II')`,
        aql: sql<string>`COALESCE(${iqcInspectionStrictness.aql}, '0.40')`,
        consecutiveAccepted: sql<number>`COALESCE(${iqcInspectionStrictness.consecutiveAccepted}, 0)`,
        recentRejectedIn5: sql<number>`COALESCE(${iqcInspectionStrictness.recentRejectedIn5}, 0)`,
        tightenedRejectedTotal: sql<number>`COALESCE(${iqcInspectionStrictness.tightenedRejectedTotal}, 0)`,
        tightenedConsecutiveAccepted: sql<number>`COALESCE(${iqcInspectionStrictness.tightenedConsecutiveAccepted}, 0)`,
        exceptionSource: iqcInspectionStrictness.exceptionSource,
        remark: iqcInspectionStrictness.remark,
        createdAt: iqcInspectionStrictness.createdAt,
        updatedAt: iqcInspectionStrictness.updatedAt,
      })
      .from(material)
      .leftJoin(
        iqcInspectionStrictness,
        and(
          eq(iqcInspectionStrictness.materialId, material.id),
          eq(iqcInspectionStrictness.inspectionType, STRICTNESS_TYPE),
        ),
      );

    const countResult = await this.db
      .select({ count: count() })
      .from(material)
      .leftJoin(
        iqcInspectionStrictness,
        and(
          eq(iqcInspectionStrictness.materialId, material.id),
          eq(iqcInspectionStrictness.inspectionType, STRICTNESS_TYPE),
        ),
      )
      .where(and(...conditions));

    const total = Number(countResult[0]?.count || 0);

    const items = await joined
      .where(and(...conditions))
      .orderBy(
        desc(sql`COALESCE(${iqcInspectionStrictness.updatedAt}, ${material.createdAt})`),
        desc(material.materialCode),
      )
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const mapped = items.map((row: any) => ({
      ...row,
      inspectionType: 'material',
      strictness: row.strictness || 'normal',
      inspectionLevel: row.inspectionLevel || 'II',
      aql: row.aql || '0.40',
      consecutiveAccepted: Number(row.consecutiveAccepted || 0),
      recentRejectedIn5: Number(row.recentRejectedIn5 || 0),
      tightenedRejectedTotal: Number(row.tightenedRejectedTotal || 0),
      tightenedConsecutiveAccepted: Number(row.tightenedConsecutiveAccepted || 0),
      createdAt: row.createdAt ? (row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt) : undefined,
      updatedAt: row.updatedAt ? (row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt) : undefined,
    }));

    return { items: mapped, total, page, pageSize };
  }

  /**
   * 转移历史
   */
  async getTransferLogs(params: {
    materialId?: string;
    page: number;
    pageSize: number;
  }): Promise<PaginatedResponse<IqcStrictnessTransferLog>> {
    const { materialId, page, pageSize } = params;

    const conditions = [];
    if (materialId) conditions.push(eq(iqcStrictnessTransferLog.materialId, materialId));
    // 历史日志里可能还留着 appearance / dimensional，统一按物料查全部，避免漏记录

    const baseQuery = this.db
      .select({
        id: iqcStrictnessTransferLog.id,
        materialId: iqcStrictnessTransferLog.materialId,
        materialCode: material.materialCode,
        materialName: material.materialName,
        inspectionType: iqcStrictnessTransferLog.inspectionType,
        fromStrictness: iqcStrictnessTransferLog.fromStrictness,
        toStrictness: iqcStrictnessTransferLog.toStrictness,
        transferType: iqcStrictnessTransferLog.transferType,
        reportId: iqcStrictnessTransferLog.reportId,
        lotId: iqcStrictnessTransferLog.lotId,
        reason: iqcStrictnessTransferLog.reason,
        operatorId: iqcStrictnessTransferLog.operatorId,
        operatorName: iqcStrictnessTransferLog.operatorName,
        createdAt: iqcStrictnessTransferLog.createdAt,
      })
      .from(iqcStrictnessTransferLog)
      .leftJoin(material, eq(iqcStrictnessTransferLog.materialId, material.id));

    const whereQuery = conditions.length > 0 ? baseQuery.where(and(...conditions)) : baseQuery;

    const countResult = await this.db
      .select({ count: count() })
      .from(iqcStrictnessTransferLog)
      .leftJoin(material, eq(iqcStrictnessTransferLog.materialId, material.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const total = Number(countResult[0]?.count || 0);

    const items = await whereQuery
      .orderBy(desc(iqcStrictnessTransferLog.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const mapped = items.map((row: any) => ({
      ...row,
      createdAt: row.createdAt ? (row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt) : '',
    }));

    return { items: mapped, total, page, pageSize };
  }

  /**
   * 获取指定物料+检验类型的当前严格度（供检验流程调用）
   */
  async getCurrentStrictness(
    materialId: string,
  ): Promise<{
    strictness: StrictnessState;
    inspectionLevel: string;
    aql: string;
    isExempt: boolean;
    isSuspended: boolean;
  } | null> {
    const rows = await this.db
      .select()
      .from(iqcInspectionStrictness)
      .where(
        and(
          eq(iqcInspectionStrictness.materialId, materialId),
          eq(iqcInspectionStrictness.inspectionType, STRICTNESS_TYPE),
        ),
      )
      .limit(1);

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      strictness: row.strictness as StrictnessState,
      inspectionLevel: row.inspectionLevel,
      aql: row.aql,
      isExempt: row.strictness === 'exempt',
      isSuspended: row.strictness === 'suspended',
    };
  }

  private mapToDto(row: any): IqcInspectionStrictness {
    return {
      id: row.id,
      materialId: row.materialId,
      inspectionType: row.inspectionType,
      strictness: row.strictness,
      inspectionLevel: row.inspectionLevel,
      aql: row.aql,
      consecutiveAccepted: row.consecutiveAccepted,
      recentRejectedIn5: row.recentRejectedIn5,
      tightenedRejectedTotal: row.tightenedRejectedTotal,
      tightenedConsecutiveAccepted: row.tightenedConsecutiveAccepted,
      exceptionSource: row.exceptionSource || undefined,
      remark: row.remark || undefined,
      createdAt: row.createdAt ? (row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt) : undefined,
      updatedAt: row.updatedAt ? (row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt) : undefined,
    };
  }
}
