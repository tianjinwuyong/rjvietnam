import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import {
  bom,
  material,
  mesIssueWriteback,
  mesSyncLog,
  mesSyncState,
  mesWorkOrderMaterial,
  pickingOrder,
  pickingOrderItem,
  sysAccount,
  sysParam,
  workOrder,
} from '@server/database/schema';
import {
  MesApiError,
  MesClient,
  formatMesTime,
  parseMesTime,
  safeMesDate,
  type MesConfig,
  type MesMaterial,
  type MesMoItem,
} from './mes.client';

/**
 * MES → WMS 工单 / 领料单同步
 * ------------------------------------------------------------------
 * 走文档推荐的「拉」通道（WMS 定时调 MES），不需要 MES 改服务端。
 *
 * 三条数据流：
 *   1. /mo            工单清单   → upsert 到 work_order（work_order_no = MES 的 moNo）
 *   2. /mo/{no}/materials 用料   → 落到 mes_work_order_material 快照表
 *   3. /issue/pending 待领料     → 一次拿全所有有缺口的工单，可直接生成领料单
 *
 * 安全边界（很重要，别改坏）：
 *   - 只更新 source='mes' 的工单；同号的手工工单绝不覆盖，只记跳过；
 *   - 已结案(closed)/已取消(cancelled)的工单不会被 MES 状态「拉回」；
 *   - 已发料(issued/received)的领料单不会被重新同步改动数量。
 */

type WorkSection = 'smt' | 'dip' | 'assembly' | 'packing';

const WORK_SECTIONS: WorkSection[] = ['smt', 'dip', 'assembly', 'packing'];

/** MES 工单状态 → WMS 工单状态（文档：已排产/生产中/已完工/已关闭） */
const STATUS_MAP: Record<string, string> = {
  已排产: 'created',
  待排产: 'created',
  待生产: 'created',
  未开工: 'created',
  已开工: 'in_production',
  生产中: 'in_production',
  在制: 'in_production',
  已完工: 'completed',
  完工: 'completed',
  已关闭: 'closed',
  关闭: 'closed',
  已取消: 'cancelled',
  取消: 'cancelled',
};

/** MES 用料段 → WMS 工段（文档：SMT / 插件 / 组装 / 包装 / 辅料） */
const SEGMENT_MAP: Record<string, WorkSection> = {
  smt: 'smt',
  贴片: 'smt',
  dip: 'dip',
  插件: 'dip',
  后焊: 'dip',
  assembly: 'assembly',
  组装: 'assembly',
  装配: 'assembly',
  测试: 'assembly',
  packing: 'packing',
  包装: 'packing',
  打包: 'packing',
  // 文档里的「辅料」在 WMS 四工段里没有独立段位，归到包装段集中发料；
  // 若现场口径不同，改这里一处即可。
  辅料: 'packing',
  包材: 'packing',
};

/**
 * 提取真实错误原因。
 * Drizzle 抛出的错误 message 只有 "Failed query: insert into ..."，真正的原因
 * （列不存在 / 类型不匹配 / 唯一键冲突）在 cause.detail 里，不打出来等于没报错。
 */
function errText(e: any): string {
  if (!e) return '未知错误';
  const parts: string[] = [];
  const push = (v: any) => {
    const s = v == null ? '' : String(v).trim();
    if (s && !parts.includes(s)) parts.push(s);
  };
  push(e.message);
  push(e.cause?.detail);
  push(e.cause?.hint);
  push(e.cause?.code ? `code=${e.cause.code}` : '');
  return parts.join(' | ').slice(0, 600);
}

/** 回写失败重试间隔（分钟）：1 → 2 → 5 → 15 → 30 → 60 */
const RETRY_MINUTES = [1, 2, 5, 15, 30, 60];
/** 超过这次数就不再自动重试，置 failed 等人工处理 */
const WB_MAX_ATTEMPTS = 8;

const PARAM_KEYS = [  'mes.base_url',
  'mes.api_key',
  'mes.auto_sync',
  'mes.interval_min',
  'mes.auto_picking',
  'mes.picking_qty_mode',
  // MES 单默认直接生效（免审批），进发料管理；关掉则回到待审批
  'mes.picking_auto_approve',
  // 对接操作人：MES 不返回下单人/批准人时，用这个账号代签，保证台账有责任人
  'mes.operator_id',
  // 发料结果回写 MES（MES 写接口开放后再打开）
  'mes.writeback_enabled',
] as const;

export interface SyncOptions {
  /** true = 忽略游标，从最早重新拉一遍（用于补历史/修数据） */
  full?: boolean;
  /** 触发来源：manual(界面点按钮) / timer(定时) / api */
  trigger?: 'manual' | 'timer' | 'api';
  /** 同步完是否顺带把用料也拉下来 */
  withMaterials?: boolean;
}

export interface SyncResult {
  ok: boolean;
  pulled: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  cursorFrom: string | null;
  cursorTo: string | null;
  messages: string[];
  requestId?: string;
}

@Injectable()
export class MesSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MesSyncService.name);
  private client = new MesClient({
    baseUrl: '', apiKey: '', autoSync: false, intervalMinutes: 5, autoPicking: false,
    pickingAutoApprove: true, operatorId: '', writebackEnabled: false,
  });
  private timer?: NodeJS.Timeout;
  private wbTimer?: NodeJS.Timeout;
  private running = false;
  private wbRunning = false;
  private cfgCache: MesConfig | null = null;

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async onModuleInit() {
    try {
      const cfg = await this.loadConfig();
      this.client.setConfig(cfg);
      if (cfg.autoSync && cfg.apiKey) {
        this.startTimer(cfg.intervalMinutes);
        this.logger.log(`MES 定时同步已启动：每 ${cfg.intervalMinutes} 分钟`);
      } else {
        this.logger.log('MES 定时同步未启用（未配置密钥或开关关闭）');
      }
      // 回写队列独立于同步开关：只要回写开关打开就跑，空队列时只查一次库
      this.startWritebackTimer();
    } catch (e: any) {
      // 数据库没就绪也不该拖垮启动
      this.logger.warn(`MES 同步初始化跳过：${e?.message || e}`);
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.wbTimer) clearInterval(this.wbTimer);
  }

  /** 回写队列：每 60 秒扫一次，退避时间由 next_retry_at 控制 */
  private startWritebackTimer() {
    if (this.wbTimer) clearInterval(this.wbTimer);
    this.wbTimer = setInterval(() => void this.runWriteback(), 60_000);
    this.wbTimer.unref?.();
  }

  private async runWriteback() {
    try {
      const r = await this.pushWritebacks();
      if (!r.skipped && (r.sent > 0 || r.failed > 0)) {
        this.logger.log(`MES 回写：成功 ${r.sent}，失败 ${r.failed}`);
      }
    } catch (e: any) {
      this.logger.warn(`MES 回写任务异常：${errText(e)}`);
    }
  }

  private startTimer(minutes: number) {
    if (this.timer) clearInterval(this.timer);
    const ms = Math.max(1, minutes) * 60_000;
    this.timer = setInterval(() => void this.runScheduled(), ms);
    this.timer.unref?.();
  }

  /**
   * 定时任务只跑「待领料 → 开单」这一条链。
   * 不再定时拉 /mo 全量工单清单：仓库要的是能直接发料的领料单，
   * 没缺口的工单既不开单也用不上，白白往库里灌一批没人看的记录。
   */
  private async runScheduled() {
    if (this.running) return;
    try {
      await this.syncPending({ trigger: 'timer' });
    } catch (e: any) {
      this.logger.warn(`MES 定时同步失败：${errText(e)}`);
    }
  }

  // ------------------------------------------------------------ 配置
  async loadConfig(force = false): Promise<MesConfig> {
    if (this.cfgCache && !force) return this.cfgCache;

    const rows = await this.db
      .select({ key: sysParam.paramKey, value: sysParam.paramValue })
      .from(sysParam)
      .where(inArray(sysParam.paramKey, PARAM_KEYS as unknown as string[]));
    const map = new Map(rows.map((r) => [r.key, r.value]));

    const cfg: MesConfig = {
      baseUrl: (map.get('mes.base_url') || process.env.MES_BASE_URL || 'http://192.168.6.27:8080').replace(/\/+$/, ''),
      apiKey: map.get('mes.api_key') || process.env.MES_API_KEY || '',
      autoSync: (map.get('mes.auto_sync') ?? process.env.MES_SYNC_ENABLED ?? 'false') === 'true',
      intervalMinutes: Math.min(1440, Math.max(1, Number(map.get('mes.interval_min') || process.env.MES_SYNC_INTERVAL_MIN || 5) || 5)),
      autoPicking: (map.get('mes.auto_picking') ?? process.env.MES_AUTO_PICKING ?? 'false') === 'true',
      // 没配过就是 true：MES 是已排产的正式指令，仓库不需要再点一次审批
      pickingAutoApprove: (map.get('mes.picking_auto_approve') ?? 'true') !== 'false',
      operatorId: map.get('mes.operator_id') || '',
      // 默认关闭：MES 的写接口还没开放，开着只会刷一堆 404
      writebackEnabled: (map.get('mes.writeback_enabled') ?? 'false') === 'true',
    };
    this.cfgCache = cfg;
    this.client.setConfig(cfg);
    return cfg;
  }

  async getConfigForUi() {
    const cfg = await this.loadConfig(true);
    return {
      baseUrl: cfg.baseUrl,
      // 密钥不明文回显，只告诉前端「配没配」
      hasApiKey: !!cfg.apiKey,
      apiKeyMasked: cfg.apiKey ? `${cfg.apiKey.slice(0, 6)}****${cfg.apiKey.slice(-4)}` : '',
      autoSync: cfg.autoSync,
      intervalMinutes: cfg.intervalMinutes,
      autoPicking: cfg.autoPicking,
      pickingAutoApprove: cfg.pickingAutoApprove,
      pickingQtyMode: await this.getPickingQtyMode(),
      operatorId: cfg.operatorId,
      operatorName: await this.accountName(cfg.operatorId),
      writebackEnabled: cfg.writebackEnabled,
    };
  }

  /** 账号 id → 显示名（账号被删/没配时返回空串，不报错） */
  private async accountName(id: string): Promise<string> {
    if (!id) return '';
    try {
      const rows = await this.db
        .select({ name: sysAccount.name, account: sysAccount.account })
        .from(sysAccount)
        .where(eq(sysAccount.id, id))
        .limit(1);
      const r = rows[0];
      return r ? (r.name ? `${r.name}（${r.account}）` : r.account) : '';
    } catch {
      return '';
    }
  }

  private async getPickingQtyMode(): Promise<'suggest' | 'open'> {
    const rows = await this.db
      .select({ v: sysParam.paramValue })
      .from(sysParam)
      .where(eq(sysParam.paramKey, 'mes.picking_qty_mode'))
      .limit(1);
    return rows[0]?.v === 'open' ? 'open' : 'suggest';
  }

  private async upsertParam(key: string, value: string, nameZh: string, desc: string) {
    await this.db
      .insert(sysParam)
      .values({ paramKey: key, paramValue: value, paramNameZh: nameZh, description: desc })
      .onConflictDoUpdate({
        target: sysParam.paramKey,
        set: { paramValue: value, updatedAt: new Date() },
      });
  }

  async saveConfig(body: {
    baseUrl?: string;
    apiKey?: string;
    autoSync?: boolean;
    intervalMinutes?: number;
    autoPicking?: boolean;
    pickingQtyMode?: 'suggest' | 'open';
    pickingAutoApprove?: boolean;
    operatorId?: string;
    writebackEnabled?: boolean;
  }) {
    if (body.baseUrl !== undefined) {
      const url = String(body.baseUrl).trim().replace(/\/+$/, '');
      if (url && !/^https?:\/\//i.test(url)) throw new BadRequestException('接口地址需以 http:// 或 https:// 开头');
      await this.upsertParam('mes.base_url', url, 'MES 接口地址', 'MES 工单下发接口 Base URL');
    }
    // 空字符串 = 不改（前端不回显密钥，避免误清空）
    if (body.apiKey !== undefined && String(body.apiKey).trim() !== '') {
      await this.upsertParam('mes.api_key', String(body.apiKey).trim(), 'MES 接口密钥', 'X-Api-Key，MES 页面可复制；重置后需同步更新');
    }
    if (body.autoSync !== undefined) {
      await this.upsertParam('mes.auto_sync', body.autoSync ? 'true' : 'false', 'MES 自动同步', '定时拉取 MES 工单');
    }
    if (body.intervalMinutes !== undefined) {
      const m = Math.min(1440, Math.max(1, Number(body.intervalMinutes) || 5));
      await this.upsertParam('mes.interval_min', String(m), 'MES 同步间隔(分钟)', '定时同步的间隔，最小 1 分钟');
    }
    if (body.autoPicking !== undefined) {
      await this.upsertParam('mes.auto_picking', body.autoPicking ? 'true' : 'false', 'MES 自动开领料单', '同步到有缺口的工单后自动生成领料单');
    }
    if (body.pickingAutoApprove !== undefined) {
      await this.upsertParam(
        'mes.picking_auto_approve',
        body.pickingAutoApprove ? 'true' : 'false',
        'MES 领料单自动生效',
        '开启后 MES 生成的领料单直接置为已生效，进入发料管理；关闭则需生产主管在「领料审批」通过',
      );
    }
    if (body.pickingQtyMode !== undefined) {
      await this.upsertParam('mes.picking_qty_mode', body.pickingQtyMode, 'MES 领料数量口径', 'suggest=按 MPQ 取整的建议发料量；open=按缺口');
    }
    // 传空串 = 清空（和 apiKey 的「空=不改」不同：这里允许取消代签账号）
    if (body.operatorId !== undefined) {
      const oid = String(body.operatorId).trim();
      if (oid) {
        const exists = await this.db
          .select({ id: sysAccount.id })
          .from(sysAccount)
          .where(eq(sysAccount.id, oid))
          .limit(1);
        if (exists.length === 0) throw new BadRequestException('对接操作人账号不存在，请重新选择');
      }
      await this.upsertParam(
        'mes.operator_id',
        oid,
        'MES 对接操作人',
        'MES 不返回下单人/批准人时，同步生成的领料单由该账号代签（申请人=审批人）',
      );
    }
    if (body.writebackEnabled !== undefined) {
      await this.upsertParam(
        'mes.writeback_enabled',
        body.writebackEnabled ? 'true' : 'false',
        'MES 发料回写',
        '开启后 WMS 发料完成会把实发明细推给 MES，用于 MES 工单结案',
      );
    }

    this.cfgCache = null;
    const cfg = await this.loadConfig(true);
    if (cfg.autoSync && cfg.apiKey) this.startTimer(cfg.intervalMinutes);
    else if (this.timer) { clearInterval(this.timer); this.timer = undefined; }

    return this.getConfigForUi();
  }

  async testConnection() {
    const cfg = await this.loadConfig(true);
    if (!cfg.apiKey) throw new BadRequestException('尚未配置 MES 接口密钥（X-Api-Key）');
    const started = Date.now();
    try {
      const res = await this.client.ping();
      return {
        ok: true,
        baseUrl: cfg.baseUrl,
        service: res.service ?? '',
        serverTime: res.serverTime ?? '',
        utcOffset: res.utcOffset ?? '',
        latencyMs: Date.now() - started,
        requestId: (res as any).requestId ?? null,
      };
    } catch (e: any) {
      if (e instanceof MesApiError) {
        throw new BadRequestException(e.toDisplay());
      }
      throw new BadRequestException(`连接 MES 失败：${errText(e)}`);
    }
  }

  // ------------------------------------------------------------ 工单同步
  private async getState(syncKey: string) {
    const rows = await this.db.select().from(mesSyncState).where(eq(mesSyncState.syncKey, syncKey)).limit(1);
    return rows[0] ?? null;
  }

  private async saveState(syncKey: string, cursor: Date | null, status: string, message: string, requestId?: string) {
    await this.db
      .insert(mesSyncState)
      .values({
        syncKey,
        cursorUpdated: cursor ?? null,
        lastRunAt: new Date(),
        lastOkAt: status === 'success' ? new Date() : null,
        lastStatus: status,
        lastMessage: message.slice(0, 2000),
        lastRequestId: requestId ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: mesSyncState.syncKey,
        set: {
          cursorUpdated: cursor ?? null,
          lastRunAt: new Date(),
          lastOkAt: status === 'success' ? new Date() : sql`mes_sync_state.last_ok_at`,
          lastStatus: status,
          lastMessage: message.slice(0, 2000),
          lastRequestId: requestId ?? null,
          updatedAt: new Date(),
        },
      });
  }

  async syncWorkOrders(opts: SyncOptions = {}): Promise<SyncResult> {
    if (this.running) throw new BadRequestException('已有同步任务在执行，请稍后再试');
    const cfg = await this.loadConfig(true);
    if (!cfg.baseUrl) throw new BadRequestException('尚未配置 MES 接口地址');
    if (!cfg.apiKey) throw new BadRequestException('尚未配置 MES 接口密钥（X-Api-Key）');

    this.running = true;
    const startedAt = new Date();
    const result: SyncResult = {
      ok: false, pulled: 0, created: 0, updated: 0, skipped: 0, failed: 0,
      cursorFrom: null, cursorTo: null, messages: [],
    };

    try {
      const state = await this.getState('work_order');
      const since = opts.full ? null : (state?.cursorUpdated ? new Date(state.cursorUpdated) : null);
      result.cursorFrom = since ? formatMesTime(since) : null;

      let maxUpdated: Date | null = since;
      let page = 1;
      let requestId: string | undefined;

      // 兜底：最多翻 100 页（2 万条），防止异常情况死循环
      for (let guard = 0; guard < 100; guard += 1) {
        const res = await this.client.listMo({
          updatedSince: since ? formatMesTime(since) : undefined,
          page,
          pageSize: 200,
          onlyOpen: false,
        });
        requestId = res.requestId;
        const items = res.items ?? [];
        if (items.length === 0) break;

        for (const item of items) {
          result.pulled += 1;
          try {
            const outcome = await this.upsertWorkOrder(item, result.messages);
            if (outcome === 'created') result.created += 1;
            else if (outcome === 'updated') result.updated += 1;
            else result.skipped += 1;
          } catch (e: any) {
            result.failed += 1;
            if (result.messages.length < 20) {
              result.messages.push(`工单 ${item.moNo} 落库失败：${errText(e)}`);
            }
          }
          const t = parseMesTime(item.updatedAt);
          if (t && (!maxUpdated || t > maxUpdated)) maxUpdated = t;
        }

        if (!res.hasMore || items.length < 200) break;
        page += 1;
      }

      // 游标回退 60 秒：MES 侧同一秒内的多次修改不会漏（重复拉取由 upsert 吸收）
      if (maxUpdated) {
        const cursor = new Date(maxUpdated.getTime() - 60_000);
        result.cursorTo = formatMesTime(cursor);
        await this.saveState('work_order', cursor, 'success', `拉取 ${result.pulled} 条，新建 ${result.created}，更新 ${result.updated}，跳过 ${result.skipped}`, requestId);
      } else {
        await this.saveState('work_order', null, 'success', '本轮无数据', requestId);
      }

      // 顺带预热用料（只拉本轮有变化的工单，避免一次性打爆 MES）
      if (opts.withMaterials) {
        const targets = (await this.db.execute(sql`
          SELECT work_order_no FROM work_order
           WHERE source = 'mes'
             AND mes_synced_at > now() - interval '10 minutes'
           ORDER BY mes_synced_at DESC LIMIT 50
        `)) as unknown as any[];
        for (const t of targets) {
          try {
            await this.syncMaterials(t.work_order_no);
          } catch (e: any) {
            result.messages.push(`用料拉取失败 ${t.work_order_no}：${e?.message || e}`);
          }
        }
      }

      result.ok = true;
      await this.writeLog('work_order', 'success', result, requestId, startedAt);
      return result;
    } catch (e: any) {
      const msg = e instanceof MesApiError ? e.toDisplay() : (e?.message || String(e));
      result.messages.push(msg);
      await this.saveState('work_order', null, 'failed', msg).catch(() => undefined);
      await this.writeLog('work_order', 'failed', result, undefined, startedAt).catch(() => undefined);
      throw new BadRequestException(`同步失败：${msg}`);
    } finally {
      this.running = false;
    }
  }

  private mapStatus(mesStatus: string, current?: string | null): string {
    const mapped = STATUS_MAP[String(mesStatus || '').trim()] ?? 'created';
    // 已结案/已取消不被 MES 拉回（WMS 侧可能已经走完超耗审批等流程）
    if ((current === 'closed' || current === 'cancelled') && mapped !== 'closed' && mapped !== 'cancelled') {
      return current;
    }
    // 已开过领料单（WMS 侧 released）不因 MES 仍显示「已排产」而退回 created，
    // 否则每轮同步状态都会来回翻转
    if (current === 'released' && mapped === 'created') {
      return 'released';
    }
    return mapped;
  }

  private mapSection(segment: string | null | undefined): WorkSection {
    const key = String(segment || '').trim().toLowerCase();
    return SEGMENT_MAP[key] ?? SEGMENT_MAP[String(segment || '').trim()] ?? 'smt';
  }

  /** 按 productCode 找 WMS 里现成的 BOM（找不到就留空，工单照样能建） */
  private async matchBomId(productCode: string): Promise<string | null> {
    if (!productCode) return null;
    const rows = await this.db
      .select({ id: bom.id })
      .from(bom)
      .where(and(eq(bom.productCode, productCode), eq(bom.status, 'active')))
      .orderBy(sql`${bom.createdAt} DESC`)
      .limit(1);
    return rows[0]?.id ?? null;
  }

  private async upsertWorkOrder(item: MesMoItem, messages: string[]): Promise<'created' | 'updated' | 'skipped'> {
    const moNo = String(item.moNo || '').trim();
    if (!moNo) {
      messages.push('跳过一条没有工单号的数据');
      return 'skipped';
    }

    const existing = await this.db
      .select({ id: workOrder.id, status: workOrder.status, source: workOrder.source, planQty: workOrder.planQty })
      .from(workOrder)
      .where(eq(workOrder.workOrderNo, moNo))
      .limit(1);

    const planQtyNum = Number(item.planQty);
    const planQty = Number.isFinite(planQtyNum) ? String(planQtyNum) : '0';
    const woDate = safeMesDate(item.planStart) ?? safeMesDate(item.createdAt) ?? new Date().toISOString().slice(0, 10);
    const mesUpdated = parseMesTime(item.updatedAt);
    const productName = String(item.productName || item.productModel || item.productCode || moNo).slice(0, 200);
    const productModel = String(item.productModel || '').slice(0, 200) || null;
    const remark = [item.remark, item.woType ? `MES工单类型：${item.woType}` : '', item.lineCode ? `产线：${item.lineCode}` : '']
      .filter(Boolean).join('；').slice(0, 1000) || null;

    const base = {
      productCode: String(item.productCode || '').slice(0, 100) || moNo,
      productName,
      planQty,
      workOrderDate: woDate,
      productModel,
      woType: String(item.woType || '').slice(0, 20) || null,
      lineCode: String(item.lineCode || '').slice(0, 50) || null,
      poNo: String(item.poNo || '').slice(0, 50) || null,
      custCode: String(item.custCode || '').slice(0, 50) || null,
      planStart: safeMesDate(item.planStart),
      planEnd: safeMesDate(item.planEnd),
      panelCount: Number.isFinite(Number(item.panelCount)) ? Number(item.panelCount) : null,
      mesStatus: String(item.status || '').slice(0, 20) || null,
      mesUpdatedAt: mesUpdated,
      mesSyncedAt: new Date(),
      mesIssueNo: String(item.issueNo || '').slice(0, 100) || null,
      mesIssueStatus: String(item.issueStatus || '').slice(0, 20) || null,
      mesIssueCount: Number.isFinite(Number(item.issueCount)) ? Number(item.issueCount) : 0,
    };

    if (existing.length === 0) {
      await this.db.insert(workOrder).values({
        workOrderNo: moNo,
        bomId: await this.matchBomId(base.productCode),
        ...base,
        isSupplement: false,
        status: this.mapStatus(item.status),
        source: 'mes',
        mesMoNo: moNo,
        remark,
      });
      return 'created';
    }

    const current = existing[0];
    if (current.source !== 'mes') {
      // 手工建的工单号与 MES 撞车：不覆盖，交给人工处理
      messages.push(`工单号 ${moNo} 已存在且为手工创建，已跳过（不会覆盖）`);
      return 'skipped';
    }

    const nextStatus = this.mapStatus(item.status, current.status);
    await this.db
      .update(workOrder)
      .set({ ...base, status: nextStatus, remark })
      .where(eq(workOrder.id, current.id));
    return 'updated';
  }

  // ------------------------------------------------------------ 用料明细
  /** 拉取并覆盖某张 MES 工单的用料快照，返回落库后的行 */
  async syncMaterials(moNo: string) {
    const cfg = await this.loadConfig(true);
    if (!cfg.apiKey) throw new BadRequestException('尚未配置 MES 接口密钥（X-Api-Key）');
    const res = await this.client.getMaterials(moNo);
    const list = res.materials ?? [];

    const codes = Array.from(new Set(list.map((m) => String(m.materialCode || '').trim()).filter(Boolean)));
    const matMap = new Map<string, string>();
    if (codes.length) {
      const rows = await this.db
        .select({ id: material.id, code: material.materialCode })
        .from(material)
        .where(inArray(material.materialCode, codes));
      for (const r of rows) matMap.set(r.code, r.id);
    }

    const values = list
      .filter((m) => String(m.materialCode || '').trim())
      .map((m: MesMaterial) => {
        const code = String(m.materialCode).trim();
        const section = this.mapSection(m.segment);
        const openQty = Number(m.openQty) || 0;
        const suggest = Number(m.suggestIssueQty) || 0;
        return {
          moNo,
          workSection: section,
          materialCode: code,
          materialName: String(m.materialName || '').slice(0, 200) || code,
          specification: m.spec || null,
          unit: String(m.unit || 'PCS').slice(0, 20),
          qtyPer: String(Number(m.qtyPer) || 0),
          needQty: String(Number(m.needQty) || 0),
          issueQty: String(Number(m.issueQty) || 0),
          openQty: String(openQty),
          mpq: String(Number(m.mpq) || 1),
          suggestQty: String(suggest || openQty),
          posRef: m.posRef ? String(m.posRef).slice(0, 200) : null,
          altList: m.altList || null,
          isAlt: Number(m.isAlt) === 1,
          srcType: m.source === 'issue' ? 'issue' : 'bom',
          segmentRaw: m.segment ? String(m.segment).slice(0, 20) : null,
          materialId: matMap.get(code) ?? null,
          syncedAt: new Date(),
        };
      });

    // 快照语义：先清后插，避免 MES 侧删行后 WMS 残留
    await this.db.transaction(async (tx) => {
      await tx.delete(mesWorkOrderMaterial).where(eq(mesWorkOrderMaterial.moNo, moNo));
      if (values.length) {
        for (let i = 0; i < values.length; i += 200) {
          await tx.insert(mesWorkOrderMaterial).values(values.slice(i, i + 200));
        }
      }
    });

    return {
      moNo,
      source: res.source ?? '',
      bomVersionUsed: res.bomVersionUsed ?? '',
      materialCount: values.length,
      missingMaterialCount: values.filter((v) => !v.materialId).length,
      requestId: res.requestId ?? null,
    };
  }

  /** 用料 + 库存可用量（齐套判断用），供界面预览 */
  async getMaterials(moNo: string) {
    const rows = await this.db.execute(sql`
      SELECT m.material_code, m.material_name, m.specification, m.unit,
             m.qty_per::float8   AS qty_per,
             m.need_qty::float8  AS need_qty,
             m.issue_qty::float8 AS issue_qty,
             m.open_qty::float8  AS open_qty,
             m.mpq::float8       AS mpq,
             m.suggest_qty::float8 AS suggest_qty,
             m.pos_ref, m.alt_list, m.is_alt, m.src_type, m.segment_raw,
             m.work_section,
             COALESCE(s.available, 0)::float8 AS available_qty
        FROM mes_work_order_material m
        LEFT JOIN (
          SELECT i.material_id, sum(i.quantity) AS available
            FROM inventory i
           WHERE i.quantity > 0 AND i.locked = false AND i.stock_status = 'qualified'
           GROUP BY i.material_id
        ) s ON s.material_id = m.material_id
       WHERE m.mo_no = ${moNo}
       ORDER BY m.work_section, m.material_code
    `) as unknown as any[];

    return rows.map((r) => {
      const openQty = Number(r.open_qty) || 0;
      const available = Number(r.available_qty) || 0;
      return {
        materialCode: r.material_code,
        materialName: r.material_name,
        specification: r.specification,
        unit: r.unit,
        workSection: r.work_section,
        qtyPer: Number(r.qty_per) || 0,
        needQty: Number(r.need_qty) || 0,
        issueQty: Number(r.issue_qty) || 0,
        openQty,
        mpq: Number(r.mpq) || 1,
        suggestQty: Number(r.suggest_qty) || 0,
        posRef: r.pos_ref,
        altList: r.alt_list,
        isAlt: !!r.is_alt,
        srcType: r.src_type,
        segmentRaw: r.segment_raw,
        availableQty: available,
        shortageQty: Math.max(0, Math.round((openQty - available) * 1000) / 1000),
      };
    });
  }

  // ------------------------------------------------------------ 待领料
  async syncPending(opts: SyncOptions & { autoPicking?: boolean } = {}) {
    if (this.running) throw new BadRequestException('已有同步任务在执行，请稍后再试');
    const cfg = await this.loadConfig(true);
    if (!cfg.apiKey) throw new BadRequestException('尚未配置 MES 接口密钥（X-Api-Key）');

    this.running = true;
    const startedAt = new Date();
    const result: SyncResult = {
      ok: false, pulled: 0, created: 0, updated: 0, skipped: 0, failed: 0,
      cursorFrom: null, cursorTo: null, messages: [],
    };

    try {
      /**
       * 这是本系统唯一的数据入口：MES「待领料清单」一次返回
       * 「有缺口的工单 + 该单每个工段的用料」，仓库据此直接开领料单。
       * 不走 /mo 全量清单，也不再单独跑工单同步。
       */
      const res = await this.client.listPending(200);
      const items: any[] = res.items ?? [];
      result.pulled = items.length;

      for (const mo of items) {
        try {
          // pending 正常会带完整的工单字段；万一 MES 只回了工单号，
          // 单张补一次详情（不是拉全量清单），否则领料单抬头会缺产品/数量
          let moFull: any = mo;
          if (!mo.productCode || !mo.planQty) {
            try {
              moFull = { ...mo, ...(await this.client.getMo(String(mo.moNo))) };
            } catch {
              // 补不到就用原数据，upsertWorkOrder 内部有兜底
            }
          }

          // 领料单必须挂在工单上（picking_order.work_order_id 非空且有外键），
          // 所以这里顺手补一行「抬头工单」：只承载工单号/产品/数量，
          // 不做 BOM 展开、不生成需求单，业务上不需要人维护。
          const outcome = await this.upsertWorkOrder(moFull as MesMoItem, result.messages);
          if (outcome === 'created') result.created += 1;
          else if (outcome === 'updated') result.updated += 1;
          else result.skipped += 1;

          const materials = (mo.materials ?? moFull.materials ?? []) as MesMaterial[];
          if (materials.length) await this.replaceMaterials(mo.moNo, materials);
        } catch (e: any) {
          result.failed += 1;
          if (result.messages.length < 20) result.messages.push(`待领料 ${mo.moNo} 处理失败：${errText(e)}`);
        }
      }

      const autoPicking = opts.autoPicking ?? cfg.autoPicking;
      if (autoPicking) {
        for (const mo of items) {
          try {
            const r = await this.generatePicking(mo.moNo, { applicantId: null, refresh: true });
            if (r.created > 0) result.messages.push(`工单 ${mo.moNo} 自动生成 ${r.created} 张领料单`);
          } catch (e: any) {
            result.messages.push(`工单 ${mo.moNo} 自动开单失败：${errText(e)}`);
          }
        }
      }

      result.ok = true;
      const brief = `待领料 ${result.pulled} 张，新建 ${result.created}，更新 ${result.updated}`
        + (result.failed ? `，失败 ${result.failed}` : '');
      await this.saveState('pending', null, 'success', result.messages.length ? result.messages.slice(0, 5).join('；') : brief, res.requestId);
      await this.writeLog('pending', 'success', result, res.requestId, startedAt);
      return result;
    } catch (e: any) {
      const msg = e instanceof MesApiError ? e.toDisplay() : errText(e);
      await this.saveState('pending', null, 'failed', msg).catch(() => undefined);
      await this.writeLog('pending', 'failed', result, undefined, startedAt).catch(() => undefined);
      throw new BadRequestException(`同步失败：${msg}`);
    } finally {
      this.running = false;
    }
  }

  /** 用 /issue/pending 直接给出的 materials 覆盖快照（省一次请求） */
  private async replaceMaterials(moNo: string, list: MesMaterial[]) {
    const codes = Array.from(new Set(list.map((m) => String(m.materialCode || '').trim()).filter(Boolean)));
    const matMap = new Map<string, string>();
    if (codes.length) {
      const rows = await this.db
        .select({ id: material.id, code: material.materialCode })
        .from(material)
        .where(inArray(material.materialCode, codes));
      for (const r of rows) matMap.set(r.code, r.id);
    }
    const values = list
      .filter((m) => String(m.materialCode || '').trim())
      .map((m) => {
        const code = String(m.materialCode).trim();
        const openQty = Number(m.openQty) || 0;
        const suggest = Number(m.suggestIssueQty) || 0;
        return {
          moNo,
          workSection: this.mapSection(m.segment),
          materialCode: code,
          materialName: String(m.materialName || '').slice(0, 200) || code,
          specification: m.spec || null,
          unit: String(m.unit || 'PCS').slice(0, 20),
          qtyPer: String(Number(m.qtyPer) || 0),
          needQty: String(Number(m.needQty) || 0),
          issueQty: String(Number(m.issueQty) || 0),
          openQty: String(openQty),
          mpq: String(Number(m.mpq) || 1),
          suggestQty: String(suggest || openQty),
          posRef: m.posRef ? String(m.posRef).slice(0, 200) : null,
          altList: m.altList || null,
          isAlt: Number(m.isAlt) === 1,
          srcType: m.source === 'issue' ? 'issue' : 'bom',
          segmentRaw: m.segment ? String(m.segment).slice(0, 20) : null,
          materialId: matMap.get(code) ?? null,
          syncedAt: new Date(),
        };
      });

    await this.db.transaction(async (tx) => {
      await tx.delete(mesWorkOrderMaterial).where(eq(mesWorkOrderMaterial.moNo, moNo));
      if (values.length) {
        for (let i = 0; i < values.length; i += 200) {
          await tx.insert(mesWorkOrderMaterial).values(values.slice(i, i + 200));
        }
      }
    });
  }

  // ------------------------------------------------------------ 生成领料单
  /**
   * 按 MES 用料生成领料单：一个工段一张，数量取「建议发料量」或「缺口」。
   * 幂等：已存在同工单同工段的 MES 领料单 → 只刷新未发料的数量；已发料的一律不动。
   */
  async generatePicking(
    moNo: string,
    opts: { applicantId?: string | null; refresh?: boolean; sections?: string[]; includeZero?: boolean } = {},
  ) {
    const cfg = await this.loadConfig(true);
    const mode = await this.getPickingQtyMode();
    // MES 是已排产的正式指令：默认生成即生效（approved），直接进「发料管理」。
    // 想保留审批环节，在「接口配置」里关掉「领料单自动生效」。
    const autoApprove = cfg.pickingAutoApprove;

    /**
     * 责任人：MES 接口不返回下单人/批准人，优先用配置的「对接操作人」代签，
     * 没配就退回触发这次生成的人（界面上点按钮的账号）。审批人跟申请人同一人，
     * 备注里写明是系统同步，审计能看到"谁签的、为什么是他"。
     */
    const signerId = (cfg.operatorId || opts.applicantId || '') || null;
    const signerRemark = signerId
      ? 'MES 同步生成，由对接操作人代签生效'
      : 'MES 自动生效（免审批）';

    const woRows = await this.db.select().from(workOrder).where(eq(workOrder.workOrderNo, moNo)).limit(1);
    if (woRows.length === 0) throw new NotFoundException(`MES 工单 ${moNo} 尚未同步到 WMS，请先执行同步`);
    const wo = woRows[0];
    if (wo.source !== 'mes') throw new BadRequestException(`工单 ${moNo} 不是 MES 来源，不能用此入口开单`);
    if (wo.status === 'closed' || wo.status === 'cancelled') {
      throw new BadRequestException(`工单 ${moNo} 当前状态（${wo.status}）不允许开领料单`);
    }

    let mats = (await this.db
      .select()
      .from(mesWorkOrderMaterial)
      .where(eq(mesWorkOrderMaterial.moNo, moNo))) ?? [];

    // 没有缓存就现场拉一次
    if (mats.length === 0) {
      await this.syncMaterials(moNo);
      mats = await this.db.select().from(mesWorkOrderMaterial).where(eq(mesWorkOrderMaterial.moNo, moNo));
    }
    if (mats.length === 0) throw new BadRequestException(`MES 工单 ${moNo} 没有用料明细`);

    const usable = mats.filter((m) => (opts.includeZero ? true : Number(m.openQty) > 0));
    // WMS 未建档的物料照样进单（保证与 MES 需求一致），但要明确提示，否则发料时会卡住
    const unmatched = usable.filter((m) => !m.materialId).length;
    if (usable.length === 0) {
      throw new BadRequestException(`MES 工单 ${moNo} 当前没有缺口（openQty 全为 0），无需开单`);
    }

    const bySection = new Map<string, typeof usable>();
    for (const m of usable) {
      const s = WORK_SECTIONS.includes(m.workSection as WorkSection) ? m.workSection : 'smt';
      if (opts.sections?.length && !opts.sections.includes(s)) continue;
      if (!bySection.has(s)) bySection.set(s, [] as any);
      bySection.get(s)!.push(m);
    }
    if (bySection.size === 0) throw new BadRequestException('没有可开单的工段');

    const qtyOf = (m: typeof usable[number]) => {
      const open = Number(m.openQty) || 0;
      const suggest = Number(m.suggestQty) || 0;
      const v = mode === 'open' ? open : (suggest > 0 ? suggest : open);
      return Math.round(v * 1000) / 1000;
    };

    let created = 0;
    let refreshed = 0;
    let skipped = 0;
    const pickingNos: string[] = [];

    await this.db.transaction(async (tx) => {
      // 单号串行化，避免并发同步撞号
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('wms:picking_order:no'))`);
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const prefix = `PK${dateStr}`;
      const last = (await tx.execute(sql`
        SELECT picking_no FROM picking_order WHERE picking_no LIKE ${prefix + '%'}
         ORDER BY picking_no DESC LIMIT 1
      `)) as unknown as any[];
      let seq = 1;
      if (last.length) {
        const n = parseInt(String(last[0].picking_no).slice(prefix.length), 10);
        if (!Number.isNaN(n)) seq = n + 1;
      }

      for (const section of WORK_SECTIONS) {
        const sectionMats = bySection.get(section);
        if (!sectionMats || sectionMats.length === 0) continue;

        const existing = (await tx.execute(sql`
          SELECT id, picking_no, status FROM picking_order
           WHERE work_order_id = ${wo.id}::uuid AND work_section = ${section}
             AND source = 'mes' AND status <> 'cancelled'
           LIMIT 1
        `)) as unknown as any[];

        const totalQty = sectionMats.reduce((s, m) => s + qtyOf(m), 0);

        if (existing.length) {
          const cur = existing[0];
          const editable = ['pending_approval', 'approved', 'draft'].includes(String(cur.status));
          if (!editable || opts.refresh === false) {
            skipped += 1;
            continue;
          }
          // 只刷新还没发料的数量
          await tx.update(pickingOrder).set({
            totalQty: String(Math.round(totalQty * 1000) / 1000),
            // 之前按待审批开出来的单，配置切到「自动生效」后一并补生效，
            // 免得仓库里还压着一批没人审的历史 MES 单
            ...(autoApprove && String(cur.status) === 'pending_approval'
              ? {
                status: 'approved',
                // 历史 MES 单当初没写申请/审批人，补生效时一并补上
                applicantId: signerId,
                approverId: signerId,
                approvalTime: new Date(),
                approvalRemark: signerRemark,
              }
              : {}),
            updatedAt: new Date(),
          }).where(eq(pickingOrder.id, cur.id));

          for (const m of sectionMats) {
            await tx.update(pickingOrderItem)
              .set({ pickQty: String(qtyOf(m)), updatedAt: new Date() })
              .where(and(
                eq(pickingOrderItem.pickingId, cur.id),
                eq(pickingOrderItem.materialCode, m.materialCode),
              ));
          }
          refreshed += 1;
          pickingNos.push(String(cur.picking_no));
          continue;
        }

        const pickingNo = `${prefix}${(seq++).toString().padStart(4, '0')}`;
        const [newPicking] = await tx.insert(pickingOrder).values({
          pickingNo,
          workOrderId: wo.id,
          reqId: null,
          workSection: section,
          isSupplement: false,
          totalQty: String(Math.round(totalQty * 1000) / 1000),
          status: autoApprove ? 'approved' : 'pending_approval',
          applicantId: signerId,
          approverId: autoApprove ? signerId : null,
          approvalTime: autoApprove ? new Date() : null,
          approvalRemark: autoApprove ? signerRemark : null,
          source: 'mes',
          mesIssueNo: wo.mesIssueNo || null,
          remark: `MES 工单 ${moNo}${wo.mesIssueNo ? ` / MES 领料单 ${wo.mesIssueNo}` : ''} 按用料自动生成（${mode === 'open' ? '按缺口' : '按建议发料量'}）`,
        }).returning({ id: pickingOrder.id });

        await tx.insert(pickingOrderItem).values(sectionMats.map((m) => ({
          pickingId: newPicking.id,
          // 注意：material_id 是 uuid 列，未匹配到主数据时必须写 null，
          // 写成 '' 会触发 22P02（invalid input syntax for type uuid）
          materialId: m.materialId ?? null,
          materialCode: m.materialCode,
          materialName: m.materialName || m.materialCode,
          unit: m.unit || 'PCS',
          pickQty: String(qtyOf(m)),
          actualQty: '0',
        })));
        created += 1;
        pickingNos.push(pickingNo);
      }

      // 开过单的工单标记为已下发（没结案的才改）
      if ((created > 0 || refreshed > 0) && ['created', 'draft'].includes(String(wo.status))) {
        await tx.update(workOrder).set({ status: 'released', updatedAt: new Date() }).where(eq(workOrder.id, wo.id));
      }
    });

    await this.writeLog('picking', created > 0 ? 'success' : (refreshed > 0 ? 'success' : 'skipped'), {
      ok: true, pulled: usable.length, created, updated: refreshed, skipped, failed: 0,
      cursorFrom: null, cursorTo: null, messages: [],
    }, undefined, new Date(), `工单 ${moNo}`);

    const warnings: string[] = [];
    if (unmatched > 0) {
      warnings.push(`有 ${unmatched} 条物料在 WMS 未建档（物料编码在 MES 有、WMS 没有），已按单录入但无法发料，请先在「物料主数据」补建`);
    }
    if (skipped > 0) {
      warnings.push(`${skipped} 个工段已有发料中的领料单，未做改动`);
    }

    return {
      moNo,
      mode,
      created,
      refreshed,
      skipped,
      unmatched,
      pickingNos,
      warnings,
      autoApprove,
      autoSyncEnabled: cfg.autoSync,
    };
  }

  // ------------------------------------------------------------ 状态 / 日志
  private async writeLog(
    task: string,
    status: string,
    r: SyncResult,
    requestId: string | undefined,
    startedAt: Date,
    note?: string,
  ) {
    const msg = [note, ...r.messages].filter(Boolean).join(' | ');
    await this.db.insert(mesSyncLog).values({
      task,
      status,
      pulled: r.pulled,
      created: r.created,
      updated: r.updated,
      skipped: r.skipped,
      failed: r.failed,
      message: msg.slice(0, 4000) || null,
      requestId: requestId ?? null,
      startedAt,
      finishedAt: new Date(),
    });
  }

  // ------------------------------------------------------------ 发料回写 MES
  /**
   * 把待回写的发料事件推给 MES，用于 MES 工单结案。
   *
   * 设计约束（都是血泪）：
   *  1. 至少一次投递 —— 网络超时/5xx 一律按失败重试，绝不 fire-and-forget，
   *     结案数据丢一次就是账实不符；
   *  2. 只有一个开关（mes.writeback_enabled），MES 写接口没开时整体静默，
   *     不会刷一堆 404；
   *  3. 一张 MES 领料单可能对应多张 WMS 单（按工段拆），MES 那边按
   *     (issueNo, wmsPickingNo) 各记一片，结案时按物料求和 —— 所以这里
   *     每次只推「本张 WMS 单」的实发，不替 MES 做汇总；
   *  4. 幂等键带版本（v + 单据更新时间），补发/重发后再推一次不会被 MES 吞掉。
   */
  async pushWritebacks(limit = 20) {
    const cfg = await this.loadConfig(true);
    if (this.wbRunning) return { skipped: true, reason: '上一轮还在推送', pulled: 0, sent: 0, failed: 0, messages: [] as string[] };
    if (!cfg.writebackEnabled) return { skipped: true, reason: '回写开关未开启', pulled: 0, sent: 0, failed: 0, messages: [] as string[] };
    if (!cfg.apiKey) return { skipped: true, reason: '未配置 MES 密钥', pulled: 0, sent: 0, failed: 0, messages: [] as string[] };

    this.wbRunning = true;
    const messages: string[] = [];
    let sent = 0;
    let failed = 0;
    let notApplicable = 0;
    try {
      const rows = (await this.db.execute(sql`
        SELECT id, picking_id, picking_no, event_type, attempts
          FROM mes_issue_writeback
         WHERE status = 'pending' AND next_retry_at <= now()
         ORDER BY _created_at ASC
         LIMIT ${limit}
      `)) as unknown as any[];

      for (const r of rows) {
        const attempt = Number(r.attempts) + 1;
        try {
          const built = await this.buildIssuedPayload(String(r.picking_id));
          if (!built) {
            // 不是 MES 来源 / 没有 MES 单号：跳过而不是报错，避免刷失败告警
            await this.db.execute(sql`
              UPDATE mes_issue_writeback
                 SET status='skipped', attempts=${attempt},
                     last_error='领料单不是 MES 来源或缺少 MES 单号，无需回写',
                     _updated_at=now()
               WHERE id=${r.id}::uuid`);
            notApplicable += 1;
            continue;
          }

          const res = await this.client.postIssued(built.issueNo, built.payload);
          await this.db.execute(sql`
            UPDATE mes_issue_writeback
               SET status='sent', payload=${JSON.stringify(built.payload)}::jsonb,
                   request_id=${res?.requestId ?? null}, sent_at=now(),
                   attempts=${attempt}, last_error=NULL, _updated_at=now()
             WHERE id=${r.id}::uuid`);
          sent += 1;
        } catch (e: any) {
          const text = errText(e).slice(0, 500);
          const delay = RETRY_MINUTES[Math.min(attempt - 1, RETRY_MINUTES.length - 1)];
          const next = new Date(Date.now() + delay * 60_000);
          const dead = attempt >= WB_MAX_ATTEMPTS;
          await this.db.execute(sql`
            UPDATE mes_issue_writeback
               SET attempts=${attempt}, last_error=${text},
                   status=${dead ? 'failed' : 'pending'},
                   next_retry_at=${next.toISOString()}::timestamptz, _updated_at=now()
             WHERE id=${r.id}::uuid`);
          failed += 1;
          messages.push(`${r.picking_no} 第 ${attempt} 次失败${dead ? '（已停止重试）' : `，${delay} 分钟后重试`}：${text}`);
        }
      }

      if (rows.length > 0) {
        await this.writeLog('writeback', failed === 0 ? 'success' : (sent > 0 ? 'partial' : 'failed'), {
          ok: failed === 0, pulled: rows.length, created: sent, updated: notApplicable, skipped: 0,
          failed, cursorFrom: null, cursorTo: null, messages: messages.slice(0, 5),
        }, undefined, new Date(), `回写 MES ${sent} 成功 / ${failed} 失败`);
      }

      return { skipped: false, pulled: rows.length, sent, failed, notApplicable, messages };
    } finally {
      this.wbRunning = false;
    }
  }

  /**
   * 组装某张 WMS 领料单的「实发」快照。
   * 批次来自发料时写的库存出库流水（tx_type='issue'），无流水时批次留空、
   * 按明细实发数量推，不阻断 —— 现场确实存在不带批次的物料。
   */
  private async buildIssuedPayload(pickingId: string): Promise<{ issueNo: string; payload: any } | null> {
    const rows = (await this.db.execute(sql`
      SELECT p.picking_no, p.work_section, p.pick_time, p.mes_issue_no, p.source, p._updated_at,
             w.work_order_no AS mo_no,
             a.account AS picker_account, a.name AS picker_name
        FROM picking_order p
        LEFT JOIN work_order w ON w.id = p.work_order_id
        LEFT JOIN sys_account a ON a.id = ((p.picker_id).user_id)::uuid
       WHERE p.id = ${pickingId}::uuid
       LIMIT 1
    `)) as unknown as any[];
    const po = rows[0];
    if (!po || po.source !== 'mes' || !po.mes_issue_no) return null;

    // 库存出库流水 = 实际发了哪些批次、各多少
    const lots = (await this.db.execute(sql`
      SELECT material_id, batch_no, label_no, SUM(-qty) AS qty
        FROM inventory_transaction
       WHERE reference_no = ${po.picking_no} AND tx_type = 'issue'
       GROUP BY material_id, batch_no, label_no
    `)) as unknown as any[];

    const items = (await this.db.execute(sql`
      SELECT material_id, material_code, material_name, unit, actual_qty
        FROM picking_order_item
       WHERE picking_id = ${pickingId}::uuid
       ORDER BY material_code
    `)) as unknown as any[];

    const lotsByMat = new Map<string, Array<{ batchNo: string | null; reelNo: string | null; qty: number }>>();
    for (const l of lots) {
      const key = String(l.material_id || '');
      if (!lotsByMat.has(key)) lotsByMat.set(key, []);
      lotsByMat.get(key)!.push({
        batchNo: l.batch_no || null,
        reelNo: l.label_no || null,
        qty: Number(l.qty) || 0,
      });
    }

    const round3 = (n: number) => Math.round(n * 1000) / 1000;
    const payloadItems: any[] = [];
    for (const it of items) {
      const actual = round3(Number(it.actual_qty) || 0);
      if (actual <= 0) continue;
      const matLots = lotsByMat.get(String(it.material_id || '')) || [];
      const base = {
        materialCode: it.material_code,
        materialName: it.material_name,
        unit: it.unit,
      };

      if (matLots.length === 0) {
        payloadItems.push({ ...base, actualQty: actual, batchNo: null, reelNo: null });
        continue;
      }

      // 多批次时按各批次出库量占比把实发量摊开，最后一行补差保证总和精确
      const lotTotal = matLots.reduce((s, l) => s + l.qty, 0) || 0;
      if (lotTotal <= 0) {
        payloadItems.push({ ...base, actualQty: actual, batchNo: null, reelNo: null });
        continue;
      }
      let assigned = 0;
      matLots.forEach((l, idx) => {
        const isLast = idx === matLots.length - 1;
        const qty = isLast ? round3(actual - assigned) : round3((l.qty / lotTotal) * actual);
        if (qty <= 0) return;
        assigned = round3(assigned + qty);
        payloadItems.push({ ...base, actualQty: qty, batchNo: l.batchNo, reelNo: l.reelNo });
      });
    }

    if (payloadItems.length === 0) return null;

    const version = new Date(po._updated_at).getTime();
    return {
      issueNo: String(po.mes_issue_no),
      payload: {
        issueNo: String(po.mes_issue_no),
        moNo: po.mo_no || null,
        wmsPickingNo: po.picking_no,
        workSection: po.work_section,
        eventType: 'issued',
        issuedAt: po.pick_time ? formatMesTime(new Date(po.pick_time)) : formatMesTime(new Date()),
        issuedBy: po.picker_account
          ? { code: po.picker_account, name: po.picker_name || po.picker_account }
          : null,
        // 幂等键带版本：补发/重发后 key 变化，MES 不会当成重复请求吞掉
        idempotencyKey: `wms:${po.picking_no}:issued:v${version}`,
        items: payloadItems,
      },
    };
  }

  /** 回写队列（界面展示用） */
  async listWritebacks(params: { status?: string; keyword?: string; limit?: number } = {}) {
    const limit = Math.min(500, Math.max(1, Number(params.limit) || 100));
    const status = params.status || '';
    const kw = (params.keyword || '').trim();

    const rows = (await this.db.execute(sql`
      SELECT w.id, w.picking_no, w.event_type, w.status, w.attempts, w.next_retry_at,
             w.last_error, w.sent_at, w.request_id, w._created_at,
             p.mes_issue_no, w2.work_order_no AS mo_no, p.work_section, p.total_qty
        FROM mes_issue_writeback w
        LEFT JOIN picking_order p ON p.id = w.picking_id
        LEFT JOIN work_order w2 ON w2.id = p.work_order_id
       WHERE (${status} = '' OR w.status = ${status})
         AND (${kw} = '' OR w.picking_no ILIKE ${'%' + kw + '%'} OR p.mes_issue_no ILIKE ${'%' + kw + '%'})
       ORDER BY w._created_at DESC
       LIMIT ${limit}
    `)) as unknown as any[];

    const counts = (await this.db.execute(sql`
      SELECT
        count(*) FILTER (WHERE status = 'pending')::int AS pending,
        count(*) FILTER (WHERE status = 'sent')::int AS sent,
        count(*) FILTER (WHERE status = 'failed')::int AS failed,
        count(*) FILTER (WHERE status = 'skipped')::int AS skipped
        FROM mes_issue_writeback
    `)) as unknown as any[];
    const c = counts[0] ?? {};

    return {
      items: rows.map((r) => ({
        id: r.id,
        pickingNo: r.picking_no,
        mesIssueNo: r.mes_issue_no,
        moNo: r.mo_no,
        workSection: r.work_section,
        totalQty: Number(r.total_qty) || 0,
        eventType: r.event_type,
        status: r.status,
        attempts: Number(r.attempts) || 0,
        nextRetryAt: r.next_retry_at,
        lastError: r.last_error,
        sentAt: r.sent_at,
        requestId: r.request_id,
        createdAt: r._created_at,
      })),
      counts: {
        pending: Number(c.pending) || 0,
        sent: Number(c.sent) || 0,
        failed: Number(c.failed) || 0,
        skipped: Number(c.skipped) || 0,
      },
    };
  }

  /** 手动重推一条（运维用：MES 修好后不必等退避时间） */
  async retryWriteback(id: string) {
    await this.db.execute(sql`
      UPDATE mes_issue_writeback
         SET status='pending', next_retry_at=now(), attempts=0, last_error=NULL, _updated_at=now()
       WHERE id=${id}::uuid`);
    return this.pushWritebacks(1);
  }

  async getStatus() {    const cfg = await this.loadConfig(true);
    // 主同步键是 pending（待领料→开单）；work_order 只有早期跑过全量工单时才有记录
    const [pendingState, woState] = await Promise.all([this.getState('pending'), this.getState('work_order')]);
    const state = pendingState ?? woState;
    const counts = (await this.db.execute(sql`
      SELECT
        (SELECT count(*) FROM work_order WHERE source = 'mes')::int AS mes_wo,
        (SELECT count(*) FROM work_order WHERE source = 'mes' AND status IN ('created','draft'))::int AS mes_wo_pending,
        (SELECT count(*) FROM mes_work_order_material WHERE open_qty > 0)::int AS open_materials,
        (SELECT count(DISTINCT mo_no) FROM mes_work_order_material WHERE open_qty > 0)::int AS open_mos,
        (SELECT count(*) FROM picking_order WHERE source = 'mes')::int AS mes_picking,
        (SELECT count(*) FROM picking_order WHERE source = 'mes' AND status = 'approved')::int AS mes_picking_to_issue,
        (SELECT count(*) FROM mes_issue_writeback WHERE status = 'pending')::int AS wb_pending,
        (SELECT count(*) FROM mes_issue_writeback WHERE status = 'failed')::int AS wb_failed
    `)) as unknown as any[];
    const c = counts[0] ?? {};
    return {
      configured: !!cfg.apiKey,
      baseUrl: cfg.baseUrl,
      autoSync: cfg.autoSync,
      intervalMinutes: cfg.intervalMinutes,
      autoPicking: cfg.autoPicking,
      pickingQtyMode: await this.getPickingQtyMode(),
      lastRunAt: state?.lastRunAt ?? null,
      lastOkAt: state?.lastOkAt ?? null,
      lastStatus: state?.lastStatus ?? null,
      lastMessage: state?.lastMessage ?? null,
      lastRequestId: state?.lastRequestId ?? null,
      cursor: state?.cursorUpdated ? formatMesTime(new Date(state.cursorUpdated)) : null,
      counts: {
        mesWorkOrders: Number(c.mes_wo) || 0,
        mesWorkOrdersPending: Number(c.mes_wo_pending) || 0,
        openMaterials: Number(c.open_materials) || 0,
        openMos: Number(c.open_mos) || 0,
        mesPickingOrders: Number(c.mes_picking) || 0,
        mesPickingToIssue: Number(c.mes_picking_to_issue) || 0,
        writebackPending: Number(c.wb_pending) || 0,
        writebackFailed: Number(c.wb_failed) || 0,
      },
    };
  }

  async getLogs(limit = 50) {
    const rows = await this.db.execute(sql`
      SELECT id, task, status, pulled, created, updated, skipped, failed,
             message, request_id, started_at, finished_at
        FROM mes_sync_log ORDER BY started_at DESC LIMIT ${Math.min(200, Math.max(1, limit))}
    `) as unknown as any[];
    return rows.map((r) => ({
      id: r.id,
      task: r.task,
      status: r.status,
      pulled: r.pulled,
      created: r.created,
      updated: r.updated,
      skipped: r.skipped,
      failed: r.failed,
      message: r.message,
      requestId: r.request_id,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
    }));
  }

  /** 待领料工单看板：直接从 WMS 缓存读，不每次打 MES */
  async listPendingMos(params: { keyword?: string; onlyOpen?: boolean; page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 20));
    const offset = (page - 1) * pageSize;
    const kw = params.keyword ? `%${params.keyword}%` : null;
    const onlyOpen = params.onlyOpen !== false;

    const rows = await this.db.execute(sql`
      WITH gap AS (
        SELECT mo_no,
               count(*)::int AS material_count,
               sum(open_qty)::float8 AS open_qty,
               count(*) FILTER (WHERE material_id IS NULL)::int AS unmatched_count
          FROM mes_work_order_material
         WHERE ${onlyOpen ? sql`open_qty > 0` : sql`TRUE`}
         GROUP BY mo_no
      ), pick AS (
        SELECT work_order_id, count(*)::int AS picking_count,
               count(*) FILTER (WHERE status = 'pending_approval')::int AS pending_count
          FROM picking_order WHERE source = 'mes' AND status <> 'cancelled'
         GROUP BY work_order_id
      )
      SELECT w.id, w.work_order_no, w.product_code, w.product_name, w.product_model,
             w.plan_qty::float8 AS plan_qty, w.wo_type, w.line_code, w.po_no, w.cust_code,
             w.plan_start, w.plan_end, w.mes_status, w.status, w.mes_issue_no, w.mes_issue_status,
             w.bom_id, w.mes_synced_at,
             COALESCE(g.material_count, 0) AS material_count,
             COALESCE(g.open_qty, 0) AS open_qty,
             COALESCE(g.unmatched_count, 0) AS unmatched_count,
             COALESCE(p.picking_count, 0) AS picking_count,
             COALESCE(p.pending_count, 0) AS pending_count,
             count(*) OVER()::int AS total
        FROM work_order w
        LEFT JOIN gap g  ON g.mo_no = w.work_order_no
        LEFT JOIN pick p ON p.work_order_id = w.id
       WHERE w.source = 'mes'
         AND (${kw}::text IS NULL OR w.work_order_no ILIKE ${kw} OR w.product_code ILIKE ${kw} OR w.product_name ILIKE ${kw})
       ORDER BY w.plan_start NULLS LAST, w.work_order_no DESC
       LIMIT ${pageSize} OFFSET ${offset}
    `) as unknown as any[];

    return {
      items: rows.map((r) => ({
        id: r.id,
        workOrderNo: r.work_order_no,
        productCode: r.product_code,
        productName: r.product_name,
        productModel: r.product_model,
        planQty: Number(r.plan_qty) || 0,
        woType: r.wo_type,
        lineCode: r.line_code,
        poNo: r.po_no,
        custCode: r.cust_code,
        planStart: r.plan_start,
        planEnd: r.plan_end,
        mesStatus: r.mes_status,
        status: r.status,
        mesIssueNo: r.mes_issue_no,
        mesIssueStatus: r.mes_issue_status,
        hasBom: !!r.bom_id,
        materialCount: Number(r.material_count) || 0,
        openQty: Number(r.open_qty) || 0,
        unmatchedCount: Number(r.unmatched_count) || 0,
        pickingCount: Number(r.picking_count) || 0,
        pickingPending: Number(r.pending_count) || 0,
        mesSyncedAt: r.mes_synced_at,
      })),
      page,
      pageSize,
      total: rows.length ? Number(rows[0].total) || 0 : 0,
    };
  }
}
