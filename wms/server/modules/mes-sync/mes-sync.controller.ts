import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';

import { NeedRoles } from '../../common/auth/auth.decorator';
import { MesSyncService } from './mes-sync.service';

/**
 * MES 接入：配置 / 同步 / 待领料 / 生成领料单
 * ------------------------------------------------------------------
 * 权限：
 *   - 平台配置与「立即同步」只给系统管理员（写的是全局集成参数）；
 *   - 待领料看板与开单给计划、仓库、生产主管（现场真正要用的人）。
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

  /** 立即同步工单（full=true 忽略游标重拉） */
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @NeedRoles('admin')
  async sync(@Body() body: { full?: boolean; withMaterials?: boolean }, @Req() req: Request) {
    const actor = this.actor(req);
    const result = await this.service.syncWorkOrders({
      full: !!body?.full,
      withMaterials: body?.withMaterials !== false,
      trigger: 'manual',
    });
    return { ...result, operator: actor.userName };
  }

  /** 同步「待领料」清单（一次拿到所有有缺口的工单及其用料） */
  @Post('sync-pending')
  @HttpCode(HttpStatus.OK)
  @NeedRoles('admin')
  syncPending(@Body() body: { autoPicking?: boolean }) {
    return this.service.syncPending({ trigger: 'manual', autoPicking: body?.autoPicking });
  }

  /** 待领料工单看板 */
  @Get('pending')
  pending(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
    @Query('onlyOpen') onlyOpen?: string,
  ) {
    return this.service.listPendingMos({
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
      keyword: keyword || undefined,
      onlyOpen: onlyOpen !== 'false',
    });
  }

  /** 某张 MES 工单的用料明细（含 WMS 库存可用量与缺口） */
  @Get('materials/:moNo')
  async materials(@Param('moNo') moNo: string) {
    const items = await this.service.getMaterials(moNo);
    return { moNo, items };
  }

  /** 重新从 MES 拉取该工单用料 */
  @Post('materials/:moNo/sync')
  @HttpCode(HttpStatus.OK)
  syncMaterials(@Param('moNo') moNo: string) {
    return this.service.syncMaterials(moNo);
  }

  /** 按 MES 用料生成 WMS 领料单（按工段一张，幂等） */
  @Post('picking/:moNo/generate')
  @HttpCode(HttpStatus.OK)
  generatePicking(
    @Param('moNo') moNo: string,
    @Body() body: { sections?: string[]; includeZero?: boolean },
    @Req() req: Request,
  ) {
    const actor = this.actor(req);
    return this.service.generatePicking(moNo, {
      applicantId: actor.userId,
      sections: body?.sections,
      includeZero: !!body?.includeZero,
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
