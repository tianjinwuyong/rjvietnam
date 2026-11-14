/**
 * 超期 / 预警物料的每日定时扫描
 * ------------------------------------------------------------------
 * 背景：`IqcService.syncExpiryStockToPending()` 原先只在「打开 IQC 待检清单」
 * （getPendingList）时被动触发 —— 没人打开页面，超期批次就不会被推送、
 * 库存也不会被锁，带病物料仍可发料。这与「超期必须拦」的质量口径相悖。
 *
 * 本服务把触发方式改为**每天固定时刻自动执行**（默认 08:30，上班前跑完，
 * 检验员一上班就能看到待检清单），并提供：
 *   - 启动补跑：服务在计划时刻之后才启动（如 09:00 重启）时，延时 30s 补跑一次；
 *   - 手动触发：`triggerManually()` 供运维补推 / 页面「立即扫描」按钮调用；
 *   - 并发保护 + 失败不退出（定时器仍会重排下一次）。
 *
 * 幂等由 `syncExpiryStockToPending` 自身保证：同一物料 + 同一物理批次
 * 已推送过（EXP 前缀）或已有进行中检验批次时不会重复生成。
 *
 * 配置（.env，均可选）：
 *   EXPIRY_SCAN_TIME=08:30   每日执行时刻（HH:mm，服务器本地时区）
 *   EXPIRY_SCAN_DISABLED=1   置 1 可临时关闭（不影响手动触发）
 * ------------------------------------------------------------------
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { IqcService } from './iqc.service';

/** 默认执行时刻：每天 08:30（本地时区） */
const DEFAULT_SCAN_TIME = '08:30';
/** 启动补跑延时：等数据库连接池等初始化稳定，避免启动瞬间抢资源 */
const CATCH_UP_DELAY_MS = 30_000;

@Injectable()
export class ExpiryScanService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExpiryScanService.name);
  private timer?: NodeJS.Timeout;
  /** 并发保护：上一次扫描未结束时不重复进入 */
  private running = false;
  /** 最近一次成功执行的本地日期（yyyy-MM-dd），仅用于启动补跑去重 */
  private lastRunDate = '';
  private scanTime = { hour: 8, minute: 30 };

  constructor(private readonly iqc: IqcService) {}

  onModuleInit(): void {
    this.scanTime = this.parseScanTime();

    if (process.env.EXPIRY_SCAN_DISABLED === '1') {
      this.logger.warn('EXPIRY_SCAN_DISABLED=1，超期自动扫描已停用（仍可手动触发）');
      return;
    }

    const label = `${pad(this.scanTime.hour)}:${pad(this.scanTime.minute)}`;
    this.logger.log(`超期自动扫描已启用：每天 ${label}（服务器本地时区）`);
    this.scheduleNext();
    this.maybeCatchUp();
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /**
   * 手动触发一次扫描（页面「立即扫描」/ 运维补推）。
   * 与定时任务共用同一把并发锁：正在跑时直接返回 running=true，不排队。
   */
  async triggerManually(): Promise<{ created: number; skipped: boolean }> {
    if (this.running) {
      return { created: 0, skipped: true };
    }
    const created = await this.run('手动触发');
    return { created, skipped: false };
  }

  /** 当前调度状态（供排查/运维接口读取） */
  getStatus() {
    const next = this.timer ? this.nextRunAt() : null;
    return {
      enabled: !!this.timer,
      scanTime: `${pad(this.scanTime.hour)}:${pad(this.scanTime.minute)}`,
      nextRunAt: next ? formatLocal(next) : null,
      running: this.running,
      lastRunDate: this.lastRunDate || null,
    };
  }

  // ---------------------------------------------------------------- 调度

  private scheduleNext(): void {
    const next = this.nextRunAt();
    const delay = Math.max(0, next.getTime() - Date.now());
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.run('定时任务').finally(() => {
        // 无论成功失败都要排下一次，否则一次异常就永久停摆
        this.scheduleNext();
      });
    }, delay);
    // 不要因为定时器把进程钉住（与 OaOutboxService 保持一致）
    this.timer.unref?.();
    this.logger.log(`下次超期扫描：${formatLocal(next)}（${Math.ceil(delay / 60_000)} 分钟后）`);
  }

  /** 下一次执行时刻：今天未到点则今天，否则明天 */
  private nextRunAt(from: Date = new Date()): Date {
    const next = new Date(from);
    next.setHours(this.scanTime.hour, this.scanTime.minute, 0, 0);
    if (next.getTime() <= from.getTime()) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  /**
   * 启动补跑：服务在今日计划时刻之后才启动时，补一次。
   * 只做内存级去重（当天已跑过就不再跑）；跨重启重复补跑是安全的 ——
   * 推送逻辑本身幂等，最多多一次全表查询。
   */
  private maybeCatchUp(): void {
    const now = new Date();
    const todayAt = new Date(now);
    todayAt.setHours(this.scanTime.hour, this.scanTime.minute, 0, 0);
    if (now.getTime() <= todayAt.getTime()) return;
    if (this.lastRunDate === dateKey(now)) return;

    const timer = setTimeout(() => {
      void this.run('启动补跑');
    }, CATCH_UP_DELAY_MS);
    timer.unref?.();
    this.logger.log(`今日 ${pad(this.scanTime.hour)}:${pad(this.scanTime.minute)} 已过且未执行，${CATCH_UP_DELAY_MS / 1000}s 后补跑一次（幂等）`);
  }

  private parseScanTime(): { hour: number; minute: number } {
    const raw = String(process.env.EXPIRY_SCAN_TIME || DEFAULT_SCAN_TIME).trim();
    const matched = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(raw);
    if (!matched) {
      this.logger.warn(`EXPIRY_SCAN_TIME=${raw} 格式非法（应为 HH:mm），回退默认 ${DEFAULT_SCAN_TIME}`);
      return { hour: 8, minute: 30 };
    }
    return { hour: Number(matched[1]), minute: Number(matched[2]) };
  }

  // ---------------------------------------------------------------- 执行

  private async run(source: string): Promise<number> {
    if (this.running) {
      this.logger.warn(`超期扫描（${source}）跳过：上一次仍在执行`);
      return 0;
    }
    this.running = true;
    const startedAt = Date.now();
    try {
      const created = await this.iqc.syncExpiryStockToPending();
      this.lastRunDate = dateKey(new Date());
      const cost = Date.now() - startedAt;
      if (created > 0) {
        this.logger.log(`超期扫描完成（${source}）：新增 ${created} 个待检批次，耗时 ${cost}ms`);
      } else {
        this.logger.log(`超期扫描完成（${source}）：无新增（全部已在待检或未到预警期），耗时 ${cost}ms`);
      }
      return created;
    } catch (err) {
      this.logger.error(
        `超期扫描失败（${source}）：${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      return 0;
    } finally {
      this.running = false;
    }
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatLocal(d: Date): string {
  return `${dateKey(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
