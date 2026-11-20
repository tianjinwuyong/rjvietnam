import { Controller, Get, Post, Body, Query, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { NeedLogin } from '../../common/auth/need-login.decorator';
import { NeedRoles } from '../../common/auth/auth.decorator';
import { DefectiveMoveService } from './defective-move.service';

/**
 * 不良品调拨单（统一单据：MRB 派生 + 良品手工制单）。
 *
 * 平台端（PC「不良品调拨」作业台）与 PDA 共用这组接口：
 *  - 列表：待确认 / 待执行单据（MRB 终审后自动推送）+ 历史查询；
 *  - 制单：仓管员从良品仓选库存制单（良品仓 → 不良品仓）；
 *  - 确认：仓库主管确认生效（锁库存）或驳回；
 *  - 执行：**必须扫码**（货物标签 + 目标库位码），服务端复核后才搬库。
 *
 * 权限：
 *  - 制单 / 执行：仓管员、仓库主管、管理员；
 *  - 确认生效 / 驳回 / 作废已生效单：仓库主管、管理员（岗位分离，制单人不能自己批）。
 */
const CREATE_ROLES = ['wh_keeper', 'wh_manager', 'admin'];
const CONFIRM_ROLES = ['wh_manager', 'admin'];
const MOVE_ROLES = ['wh_keeper', 'wh_manager', 'admin'];

@NeedLogin()
@Controller('api/defective-move')
export class DefectiveMoveController {
  constructor(private readonly defectiveMoveService: DefectiveMoveService) {}

  /** 单据列表（status 支持逗号分隔，如 pending_confirm,pending） */
  @Get('list')
  getTaskList(
    @Query('page') page: number = 1,
    @Query('pageSize') pageSize: number = 20,
    @Query('status') status?: string,
    @Query('materialCode') materialCode?: string,
    @Query('mrbNo') mrbNo?: string,
    @Query('source') source?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.defectiveMoveService.getTaskList({
      page: Number(page),
      pageSize: Number(pageSize),
      status,
      materialCode,
      mrbNo,
      source,
      keyword,
    });
  }

  /** 待办数量（待执行 / 待确认分开返回，菜单角标用） */
  @Get('pending-count')
  async getPendingCount() {
    return this.defectiveMoveService.getPendingCount();
  }

  /** 不良品仓可选库位（仅用于扫码后回显，不作为可选项直传） */
  @Get('locations')
  getLocations() {
    return this.defectiveMoveService.getDefectiveLocations();
  }

  /** 制单可选的来源库存（良品仓、未锁定、可用量 > 0） */
  @Get('source-stock')
  getSourceStock(
    @Query('keyword') keyword?: string,
    @Query('page') page: number = 1,
    @Query('pageSize') pageSize: number = 20,
  ) {
    return this.defectiveMoveService.getSourceStock({
      keyword,
      page: Number(page),
      pageSize: Number(pageSize),
    });
  }

  /** 单据详情 */
  @Get('detail/:id')
  getTaskDetail(@Param('id') id: string) {
    return this.defectiveMoveService.getTaskDetail(id);
  }

  /** 制单：良品仓库存 → 不良品仓（待主管确认） */
  @NeedRoles(...CREATE_ROLES)
  @Post('create')
  createOrder(
    @Body()
    body: {
      inventoryId: string;
      quantity: number;
      reason: string;
      remark?: string;
      toLocationId?: string;
    },
    @Req() req: Request,
  ) {
    return this.defectiveMoveService.createOrder(body, req.userContext?.userId || '');
  }

  /** 仓库主管确认生效 / 驳回 */
  @NeedRoles(...CONFIRM_ROLES)
  @Post(':id/confirm')
  confirmOrder(
    @Param('id') id: string,
    @Body() body: { approve: boolean; remark?: string },
    @Req() req: Request,
  ) {
    return this.defectiveMoveService.confirmOrder(id, body, {
      userId: req.userContext?.userId || '',
      name: req.userContext?.userName,
    });
  }

  /** 作废 / 撤销 */
  @NeedRoles(...MOVE_ROLES)
  @Post(':id/cancel')
  cancelOrder(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Req() req: Request,
  ) {
    return this.defectiveMoveService.cancelOrder(id, body, {
      userId: req.userContext?.userId || '',
      roleCode: req.userContext?.roleCode,
    });
  }

  /** 扫描货物标签，校验是否属于本单（逐箱预校验） */
  @NeedRoles(...MOVE_ROLES)
  @Post(':id/scan')
  scanCode(@Param('id') id: string, @Body() body: { code: string }) {
    return this.defectiveMoveService.scanCode(id, body?.code);
  }

  /**
   * 执行调拨：必须带「扫描到的货物标签」与「扫描到的目标库位码」。
   * 不再接受 toLocationId 直传 —— 选一下库位就完成，等于没有校验。
   */
  @NeedRoles(...MOVE_ROLES)
  @Post(':id/complete')
  completeTask(
    @Param('id') id: string,
    @Body() body: { scannedCodes?: string[]; toLocationCode?: string },
    @Req() req: Request,
  ) {
    // 操作人以登录身份为准，忽略请求体传入的 operatorId，避免审计归属被伪造
    const operatorId = req.userContext?.userId || '';
    return this.defectiveMoveService.completeTask(
      id,
      { scannedCodes: body?.scannedCodes, toLocationCode: body?.toLocationCode },
      operatorId,
    );
  }
}
