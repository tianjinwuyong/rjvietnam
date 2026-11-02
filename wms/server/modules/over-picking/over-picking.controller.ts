import { Controller, Post, Get, Body, Query, Param, Req, ForbiddenException } from '@nestjs/common';
import { NeedLogin } from '../../common/auth/need-login.decorator';
import { OverPickingService, type OverPickingItemInput } from './over-picking.service';
import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import { sysAccount } from '@server/database/schema';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { Inject } from '@nestjs/common';

@Controller('api/over-picking')
@NeedLogin()
export class OverPickingController {
  constructor(
    private readonly overPickingService: OverPickingService,
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  private async getUserRole(userId: string): Promise<string> {
    if (!userId) return '';
    try {
      const rows = await this.db
        .select({ roleCode: sysAccount.roleCode })
        .from(sysAccount)
        .where(eq(sysAccount.platformUserId, userId))
        .limit(1);
      return rows[0]?.roleCode || '';
    } catch {
      return '';
    }
  }

  /** 创建超补领料单（生产物料员） */
  @Post()
  async createOrder(
    @Req() req: Request,
    @Body() body: {
      workOrderNo: string;
      items: OverPickingItemInput[];
      remark?: string;
      applicantId?: string;
      applicantName?: string;
    },
  ) {
    // 申请人一律以登录身份为准，忽略请求体传入（防冒名）
    const userId = req.userContext?.userId || '';
    const role = await this.getUserRole(userId);
    const result = await this.overPickingService.createOrder({
      workOrderNo: body.workOrderNo,
      items: body.items,
      remark: body.remark,
      applicantId: userId,
      applicantName: req.userContext?.userName || req.userContext?.account || '',
      applicantRole: role,
    });
    return { code: 0, message: 'success', data: result };
  }

  /** 超补领料单列表 */
  @Get('list')
  async getList(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('orderNo') orderNo?: string,
    @Query('workOrderNo') workOrderNo?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const result = await this.overPickingService.getList({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      orderNo,
      workOrderNo,
      status,
      startDate,
      endDate,
    });
    return { code: 0, message: 'success', data: result };
  }

  /** 超补金额/数量统计 */
  @Get('stats')
  async getStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const result = await this.overPickingService.getStats({ startDate, endDate });
    return { code: 0, message: 'success', data: result };
  }

  /** 超补领料单详情 */
  @Get('detail/:id')
  async getDetail(@Param('id') id: string) {
    const result = await this.overPickingService.getDetail(id);
    return { code: 0, message: 'success', data: result };
  }

  /** 审批（生产主管）：pass=true 生效并生成领料单；pass=false 驳回 */
  @Post(':id/approve')
  async approve(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: {
      pass: boolean;
      approvalRemark?: string;
      /** @deprecated 一律取登录态，此字段被忽略（仅为兼容老前端保留） */
      approverId?: string;
      /** @deprecated 一律取登录态，此字段被忽略（仅为兼容老前端保留） */
      approverName?: string;
    },
  ) {
    // 审批人一律以登录身份为准，忽略请求体传入（防冒名）
    const userId = req.userContext?.userId || '';
    const role = await this.getUserRole(userId);
    const result = await this.overPickingService.approveOrder({
      id,
      pass: !!body.pass,
      approverId: userId,
      approverName: req.userContext?.userName || req.userContext?.account || '',
      approvalRemark: body.approvalRemark,
      approverRole: role,
    });
    return { code: 0, message: 'success', data: result };
  }

  /** 取消（创建人，仅待审批） */
  @Post(':id/cancel')
  async cancel(@Req() req: Request, @Param('id') id: string) {
    const userId = req.userContext?.userId || '';
    const role = await this.getUserRole(userId);
    const result = await this.overPickingService.cancelOrder({ id, userId, userRole: role });
    return { code: 0, message: 'success', data: result };
  }
}
