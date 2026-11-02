/**
 * WMS → OA 事件队列（outbox 模式）
 * ------------------------------------------------------------------
 * 用途：把「待检批次已生成」这类事实可靠地送到 OA（OA 据此建检验任务）。
 *
 * 为什么不在收货事务里直接调 OA：
 *   收货是高频关键事务，外部 HTTP 抖动会直接变成"收货失败"。改成
 *   「与业务同事务写 outbox + 独立任务投递」，与 WMS 既有的
 *   flow_webhook_outbox 保持同一套模式。
 *
 * 关键设计：
 *   1) **扫描式入队**：定时扫描 status='pending' 且尚未入队的 iqc_lot，
 *      不侵入收货/批次生成代码；漏推的批次下一轮会被自动补上（自愈）。
 *   2) **幂等**：UNIQUE(event, biz_key)，重复扫描只会入队一次。
 *   3) **指数退避**：30s × 2^n，上限 30min，8 次后置 failed（人工介入）。
 *   4) OA 未配置（OA_BASE_URL / OA_API_KEY 为空）时**完全静默**，
 *      不影响 WMS 自身运行。
 * ------------------------------------------------------------------
 */
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { SamplingPlanService } from './sampling-plan.service';

/** 投递间隔：60s 一次（待检不是秒级业务，频率低对两边都友好） */
const TICK_MS = 60_000;
/** 单次投递上限 */
const BATCH = 20;
const MAX_ATTEMPTS = 8;

@Injectable()
export class OaOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OaOutboxService.name);
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    // 抽样参数由 WMS 计算（决策①：抽样留 WMS），OA 只展示
    private readonly sampling: SamplingPlanService,
  ) {}

  onModuleInit(): void {
    if (!this.enabled()) {
      this.logger.warn('OA 未配置（OA_BASE_URL / OA_API_KEY），待检推送已停用');
      return;
    }
    // 联调前的保险丝：OA 侧接收接口尚未上线时，把 OA_IQC_PUSH_DISABLED 置 1，
    // 避免事件堆积成 failed（不影响 WMS 运行，只是不推送）
    if (process.env.OA_IQC_PUSH_DISABLED === '1') {
      this.logger.warn('OA_IQC_PUSH_DISABLED=1，待检推送暂停（联调时去掉该变量）');
      return;
    }
    this.timer = setInterval(() => { void this.tick(); }, TICK_MS);
    // 不要因为定时器把进程钉住（避免影响优雅退出）
    this.timer.unref?.();
    this.logger.log(`OA 待检推送已启动（每 ${TICK_MS / 1000}s 扫描一次）`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private cfg() {
    return {
      base: String(process.env.OA_BASE_URL || '').replace(/\/+$/, ''),
      key: String(process.env.OA_API_KEY || ''),
      path: process.env.OA_IQC_PUSH_PATH || '/api/integration/iqc/lots',
    };
  }

  private enabled(): boolean {
    const c = this.cfg();
    return !!c.base && !!c.key;
  }

  /** 一轮：先补入队，再投递 */
  async tick(): Promise<void> {
    if (this.busy || !this.enabled()) return;
    this.busy = true;
    try {
      const queued = await this.scanPendingLots();
      const filled = await this.fillSampling();
      const sent = await this.dispatch(BATCH);
      if (queued || filled || sent) {
        this.logger.log(`OA outbox: 入队 ${queued} 条 / 补抽样 ${filled} 条 / 投递成功 ${sent} 条`);
      }
    } catch (err: unknown) {
      this.logger.error(`OA outbox 轮询异常: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.busy = false;
    }
  }

  /**
   * 扫描待检批次并入队（幂等）。
   * 只推 status='pending' 的批次：已开检/已判定的不推，避免 OA 建出无用任务。
   */
  async scanPendingLots(limit = 200): Promise<number> {
    const res = (await this.db.execute(sql`
      INSERT INTO oa_event_outbox (event, biz_key, payload)
      SELECT 'lot.created', l.lot_no,
             jsonb_build_object(
               'event', 'lot.created',
               'bizKey', l.lot_no,
               'occurredAt', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'),
               'lot', jsonb_build_object(
                 'lotNo', l.lot_no,
                 'inspectionNo', l.inspection_no,
                 'receiptDate', l.receipt_date,
                 'supplier', jsonb_build_object('code', s.supplier_code, 'name', s.supplier_name),
                 'material', jsonb_build_object(
                   'code', m.material_code, 'name', m.material_name, 'type', m.material_type,
                   'spec', m.specification),
                 'qty', l.total_qty,
                 'unit', l.unit,
                 'batchNo', l.batch_no,
                 'locations', l.location_codes
               ),
               'sampling', CASE WHEN st.material_id IS NULL THEN NULL ELSE jsonb_build_object(
                 'strictness', st.strictness,
                 'aql', st.aql,
                 'inspectionLevel', st.inspection_level
               ) END
             )
        FROM iqc_lot l
        LEFT JOIN material m ON m.id = l.material_id
        LEFT JOIN supplier s ON s.id = l.supplier_id
        LEFT JOIN LATERAL (
          SELECT t.material_id, t.strictness, t.aql, t.inspection_level
            FROM iqc_inspection_strictness t
           WHERE t.material_id = l.material_id
           ORDER BY t._updated_at DESC NULLS LAST
           LIMIT 1
        ) st ON true
       WHERE l.status = 'pending'
         AND NOT EXISTS (
           SELECT 1 FROM oa_event_outbox o
            WHERE o.event = 'lot.created' AND o.biz_key = l.lot_no
         )
       LIMIT ${limit}
      ON CONFLICT DO NOTHING
    `)) as unknown as Array<Record<string, unknown>>;
    // postgres-js 的 INSERT ... SELECT 不返回行，只有 rowCount；两种形态都兼容
    const anyRes = res as unknown as { count?: number };
    if (typeof anyRes?.count === 'number') return anyRes.count;
    return Array.isArray(res) ? res.length : 0;
  }

  /**
   * 补算抽样参数（sampleSize / ac / re）。
   *
   * 为什么单独一步而不是写进入队 SQL：抽样要按「批量 × 检验水平 × AQL」查国标表，
   * 逻辑在 SamplingPlanService 里（含 S-1~S-4/G-Ⅰ~G-Ⅲ 与严格度影响），SQL 里复刻一份必然漂移。
   * 所以：SQL 只负责带出 qty/level/aql，样本量在这里算完再回填 payload。
   */
  async fillSampling(limit = 200): Promise<number> {
    const rows = (await this.db.execute(sql`
      SELECT o.id, l.total_qty::text AS qty, st.inspection_level, st.aql, st.strictness,
             st.consecutive_accepted, st.recent_rejected_in_5,
             st.tightened_rejected_total, st.tightened_consecutive_accepted
        FROM oa_event_outbox o
        JOIN iqc_lot l ON l.lot_no = o.biz_key
        LEFT JOIN LATERAL (
          SELECT t.inspection_level, t.aql, t.strictness, t.consecutive_accepted,
                 t.recent_rejected_in_5, t.tightened_rejected_total, t.tightened_consecutive_accepted
            FROM iqc_inspection_strictness t
           WHERE t.material_id = l.material_id
           ORDER BY t._updated_at DESC NULLS LAST LIMIT 1
        ) st ON true
       WHERE o.event = 'lot.created' AND o.status = 'pending'
         AND (o.payload -> 'sampling' ->> 'sampleSize') IS NULL
       LIMIT ${limit}
    `)) as unknown as Array<{
      id: number; qty: string; inspection_level: string | null; aql: string | null; strictness: string | null;
      consecutive_accepted: number | null; recent_rejected_in_5: number | null;
      tightened_rejected_total: number | null; tightened_consecutive_accepted: number | null;
    }>;

    let n = 0;
    for (const r of rows || []) {
      const lotSize = Math.trunc(Number(r.qty) || 0);
      const info = this.sampling.getSamplingInfo(r.inspection_level || 'II', lotSize, r.aql || undefined);
      try {
        await this.db.execute(sql`
          UPDATE oa_event_outbox
             SET payload = jsonb_set(payload, '{sampling}', ${JSON.stringify({
               strictness: r.strictness || 'normal',
               aql: r.aql ? Number(r.aql) : null,
               inspectionLevel: r.inspection_level || 'II',
               sampleSize: info.sampleSize,
               ac: info.ac,
               re: info.re,
               // 严格度依据（OA 只展示，用于解释"为什么这批是加严"）
               consecutiveAccepted: r.consecutive_accepted ?? null,
               recentRejectedIn5: r.recent_rejected_in_5 ?? null,
               tightenedRejectedTotal: r.tightened_rejected_total ?? null,
               tightenedConsecutiveAccepted: r.tightened_consecutive_accepted ?? null,
             })}::jsonb, true)
           WHERE id = ${r.id}
        `);
        n++;
      } catch {
        /* 单条失败不影响其它 */
      }
    }
    return n;
  }

  /** 投递地址：按事件类型分流（待检批次 / MRB） */
  private pathFor(event: string): string {
    const c = this.cfg();
    if (event === 'mrb.created') return process.env.OA_MRB_PUSH_PATH || '/api/integration/mrb';
    return c.path;
  }

  /** 投递到期事件；成功置 sent，失败退避 */
  async dispatch(limit = BATCH): Promise<number> {
    const c = this.cfg();
    const rows = (await this.db.execute(sql`
      SELECT id, event, biz_key, payload, attempts
        FROM oa_event_outbox
       WHERE status = 'pending' AND next_attempt_at <= now()
       ORDER BY id
       LIMIT ${limit}
    `)) as unknown as Array<{ id: number; event: string; biz_key: string; payload: any; attempts: number }>;

    let ok = 0;
    for (const row of rows || []) {
      const url = `${c.base}${this.pathFor(row.event)}`;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Api-Key': c.key },
          body: JSON.stringify(row.payload),
          signal: AbortSignal.timeout(15000),
        });
        const text = await res.text().catch(() => '');
        if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
        await this.db.execute(sql`
          UPDATE oa_event_outbox
             SET status='sent', sent_at=now(), attempts=attempts+1, last_error=NULL
           WHERE id = ${row.id}
        `);
        ok++;
      } catch (err: unknown) {
        const attempts = Number(row.attempts || 0) + 1;
        const backoffSec = Math.min(1800, 30 * Math.pow(2, attempts - 1));
        const msg = err instanceof Error ? err.message : String(err);
        await this.db.execute(sql`
          UPDATE oa_event_outbox
             SET attempts = ${attempts},
                 status = ${attempts >= MAX_ATTEMPTS ? 'failed' : 'pending'},
                 next_attempt_at = now() + (${backoffSec} || ' seconds')::interval,
                 last_error = ${msg.slice(0, 500)}
           WHERE id = ${row.id}
        `);
        this.logger.warn(`投递失败 #${row.id} ${row.biz_key}（第 ${attempts} 次，${backoffSec}s 后重试）：${msg}`);
      }
    }
    return ok;
  }

  /** 供业务直接入队（后续可替代扫描，改为收货后即时入队） */
  async enqueue(event: string, bizKey: string, payload: Record<string, unknown>): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO oa_event_outbox (event, biz_key, payload)
      VALUES (${event}, ${bizKey}, ${JSON.stringify(payload)}::jsonb)
      ON CONFLICT DO NOTHING
    `);
  }
}
