import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';

import { NeedRoles } from '../../common/auth/auth.decorator';
import { MesSyncService } from './mes-sync.service';

/**
 * MES 接入：配置 / 拉领料单 / 发料回写
 * ------------------------------------------------------------------
 * 2026-11-13 起**工单对接下线**：
 *   - 不再拉 MES 工单清单（/mo）、不再拉待领料工单（/issue/pending）
 *   - 不再按 MES 用料在 WMS 侧自动开领料单
 *   MES 已经把领料单按工段拆好、审好批，WMS 照单发料即可。
 *
 * 现在的三个入口：
 *   - POST issues/sync    立即拉一次 MES 领料单
 *   - GET  issues         看已接入的领料单
 *   - POST writeback/run  把发料结果推回 MES
 *
 * 权限：平台配置与同步动作只给系统管理员；看单与回写队列给仓库、计划、生产。
 */
@Controller('api/mes-sync')
@NeedRoles('admin', 'wh_manager', 'wh_keeper', 'planner', 'plan_manager', 'production_manager')
export class MesSyncController {
  constructor(private readonly service: MesSyncService) {}

  private actor(req: Request) {
    const ctx = (req as any).userContext || {};
    return { userId: ctx.userId || null, userName: ctx.userName || '' };
  }

  /** 概览：配置状态 + 游标 + 各类计数 */
  @Get('status')
  status() {
    return this.service.getStatus();
  }

  @Get('config')
  @NeedRoles('admin')
  getConfig() {
    return this.service.getConfigForUi();
  }

  @Put('config')
  @NeedRoles('admin')
  saveConfig(@Body() body: {
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
    return this.service.saveConfig(body);
  }

  /** 连通性测试：只打 /ping，不写库，联调第一步 */
  @Post('test')
  @HttpCode(HttpStatus.OK)
  @NeedRoles('admin')
  test() {
    return this.service.testConnection();
  }

  /**
   * 立即拉取 MES 领料单（full=true 忽略游标，从最早重新拉一遍）
   * 这是现在唯一的数据入口。
   */
  @Post('issues/sync')
  @HttpCode(HttpStatus.OK)
  @NeedRoles('admin')
  async syncIssues(@Body() body: { full?: boolean }, @Req() req: Request) {
    const actor = this.actor(req);
    const result = await this.service.syncIssues({ full: !!body?.full, trigger: 'manual' });
    return { ...result, operator: actor.userName };
  }

  /** 已接入 WMS 的 MES 领料单（按 mes_issue_no 落库的那批） */
  @Get('issues')
  issues(
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listSyncedIssues({
      status: status || undefined,
      keyword: keyword || undefined,
      limit: Number(limit) || 100,
    });
  }

  /** 同步运行日志（最近 N 条） */
  @Get('logs')
  logs(@Query('limit') limit?: string) {
    return this.service.getLogs(Number(limit) || 50);
  }

  // ------------------------------------------------------------ 发料回写 MES

  /** 回写队列：哪些发料还没推成功、失败原因 */
  @Get('writeback/list')
  writebackList(
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listWritebacks({
      status: status || undefined,
      keyword: keyword || undefined,
      limit: Number(limit) || 100,
    });
  }

  /** 立即推一轮（不用等定时器） */
  @Post('writeback/run')
  @HttpCode(HttpStatus.OK)
  @NeedRoles('admin')
  writebackRun(@Body() body: { limit?: number }) {
    return this.service.pushWritebacks(Number(body?.limit) || 20);
  }

  /** 手动重推某一条（MES 修好后不必等退避） */
  @Post('writeback/:id/retry')
  @HttpCode(HttpStatus.OK)
  @NeedRoles('admin')
  writebackRetry(@Param('id') id: string) {
    return this.service.retryWriteback(id);
  }
}
