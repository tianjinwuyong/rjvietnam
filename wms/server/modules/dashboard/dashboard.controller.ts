import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { NeedLogin } from '../../common/auth/need-login.decorator';

import { DashboardService, PdaTasksStats } from './dashboard.service';
import type {
  DashboardStats,
  DashboardOverview,
  IqcSummary,
  IqcTrendPoint,
  IqcStatsBundle,
  IqcDefectTypeItem,
  IqcDefectMaterialTypeItem,
  IqcDefectDetailResult,
  IqcOverdueStats,
  PendingStats,
  SupplementSummary,
} from '@shared/api.interface';

@Controller('api/dashboard')
@NeedLogin()
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  async getStats(): Promise<DashboardStats> {
    return this.dashboardService.getStats();
  }

  @Get('pda-tasks')
  async getPdaTasks(): Promise<PdaTasksStats> {
    return this.dashboardService.getPdaTasks();
  }

  // ========== 1. 核心运营概览 ==========
  @Get('overview')
  async getOverview(): Promise<DashboardOverview> {
    return this.dashboardService.getOverview();
  }

  // ========== 2. IQC 汇总 ==========
  @Get('iqc-summary')
  async getIqcSummary(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ): Promise<IqcSummary> {
    return this.dashboardService.getIqcSummary(startDate, endDate);
  }

  // ========== 3. IQC 合格率趋势 ==========
  @Get('iqc-trend')
  async getIqcTrend(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('granularity') granularity: 'month' | 'week' | 'day' = 'month',
    @Query('groupBy') groupBy: 'overall' | 'supplier' | 'materialType' = 'overall',
    @Query('supplier') supplier?: string,
    @Query('materialType') materialType?: string,
  ): Promise<IqcTrendPoint[]> {
    return this.dashboardService.getIqcTrend({
      startDate,
      endDate,
      granularity,
      groupBy,
      supplier,
      materialType,
    });
  }

  // ========== 3b. IQC 统计聚合（汇总 + 趋势 + 排行，单一口径） ==========
  @Get('iqc-stats')
  async getIqcStats(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('granularity') granularity: 'month' | 'week' | 'day' = 'day',
    @Query('groupBy') groupBy: 'overall' | 'supplier' | 'materialType' = 'overall',
    @Query('dimensionValue') dimensionValue?: string,
    @Query('materialCode') materialCode?: string,
  ): Promise<IqcStatsBundle> {
    return this.dashboardService.getIqcStats({
      startDate,
      endDate,
      granularity,
      groupBy,
      dimensionValue,
      materialCode,
    });
  }

  // ========== 4. 不良类型分布 ==========
  @Get('iqc-defect-by-type')
  async getIqcDefectByType(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ): Promise<IqcDefectTypeItem[]> {
    return this.dashboardService.getIqcDefectByType(startDate, endDate);
  }

  // ========== 5. 不良按物料类型分布 ==========
  @Get('iqc-defect-by-material-type')
  async getIqcDefectByMaterialType(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ): Promise<IqcDefectMaterialTypeItem[]> {
    return this.dashboardService.getIqcDefectByMaterialType(startDate, endDate);
  }

  // ========== 5b. 不合格明细下钻（饼图点击后的台账） ==========
  @Get('iqc-defect-detail')
  async getIqcDefectDetail(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('dimension') dimension: 'type' | 'materialType',
    @Query('value') value: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<IqcDefectDetailResult> {
    return this.dashboardService.getIqcDefectDetail({
      startDate,
      endDate,
      dimension,
      value,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  // ========== 6. IQC 待检超期 ==========
  @Get('iqc-overdue')
  async getIqcOverdue(): Promise<IqcOverdueStats> {
    return this.dashboardService.getIqcOverdue();
  }

  // ========== 7. 待检状态 ==========
  @Get('pending-stats')
  async getPendingStats(): Promise<PendingStats> {
    return this.dashboardService.getPendingStats();
  }

  // ========== 8. 超补汇总 ==========
  @Get('supplement-summary')
  async getSupplementSummary(): Promise<SupplementSummary> {
    return this.dashboardService.getSupplementSummary();
  }

  // ========== 9. 目标合格率配置 ==========

  @Get('target-config')
  async getTargetConfig(): Promise<{ overall: number; byType: Record<string, number | null> }> {
    return this.dashboardService.getTargetConfig();
  }

  @Post('verify-admin')
  async verifyAdmin(@Body() body: { account: string; password: string }): Promise<{ success: boolean; name?: string }> {
    return this.dashboardService.verifyAdmin(body.account, body.password);
  }

  @Put('target-config')
  async updateTargetConfig(
    @Body() body: { account: string; password: string; overall: number; byType: Record<string, number | null> },
  ): Promise<{ success: boolean }> {
    return this.dashboardService.updateTargetConfig(body.account, body.password, {
      overall: Number(body.overall),
      byType: body.byType || {},
    });
  }
}
