import { Controller, Post, Get, Body, Query, Param, Req } from '@nestjs/common';
import { NeedLogin } from '../../common/auth/need-login.decorator';
import { NeedRoles } from '../../common/auth/auth.decorator';
import { ReworkService } from './rework.service';
import { ReworkIdDto, ReworkReinspectDto } from './dto/rework-action.dto';
import type { Request } from 'express';

/**
 * 返工三角色分工（业务定稿）：
 *  - 开工：仓库把货转到返工区，SQE 也可代开（供应商已拉走返工时由 SQE 起单）
 *  - 确认返工完成：**SQE**。这是「供应商真的做完了」的签认动作，不是仓管点一下，
 *    确认后系统才通知 IQC 复检；质量经理保留兜底权限（SQE 休假时不至于卡单）
 *  - 复检确认：**IQC**。确认合格即解锁发料，确认不合格即退回不良锁定
 *
 * 注意：这里的角色码是**权限边界**，不是提示。服务端必须拦，
 * 否则任何登录账号都能把货从返工状态放行到可发料状态。
 */
const REWORK_START_ROLES = ['wh_keeper', 'wh_manager', 'sqe', 'admin'];
const REWORK_FINISH_ROLES = ['sqe', 'quality_manager', 'admin'];
const REWORK_REINSPECT_ROLES = ['iqc_inspector', 'iqc_manager', 'quality_manager', 'admin'];

@Controller('api/rework')
@NeedLogin()
export class ReworkController {
  constructor(private readonly service: ReworkService) {}

  @Get('list')
  async getList(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('reworkNo') reworkNo?: string,
    @Query('status') status?: string,
    @Query('materialCode') materialCode?: string,
  ) {
    const data = await this.service.listOrders({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      reworkNo,
      status,
      materialCode,
    });
    return { code: 0, message: 'success', data };
  }

  @Get('pending-count')
  async getPendingCount() {
    const data = await this.service.getPendingCount();
    return { code: 0, message: 'success', data };
  }

  @Get('detail/:id')
  async getDetail(@Param('id') id: string) {
    const data = await this.service.getOrderDetail(id);
    return { code: 0, message: 'success', data };
  }

  @NeedRoles(...REWORK_START_ROLES)
  @Post('start')
  async start(@Body() body: ReworkIdDto, @Req() req: Request) {
    const data = await this.service.startRework({
      id: body.id,
      // 审计人一律以登录身份为准，忽略请求体传入（防冒名）
      operatorId: req.userContext?.userId || '',
      remark: body.remark,
    });
    return { code: 0, message: 'success', data };
  }

  @NeedRoles(...REWORK_FINISH_ROLES)
  @Post('finish')
  async finish(@Body() body: ReworkIdDto, @Req() req: Request) {
    const data = await this.service.finishRework({
      id: body.id,
      // 审计人一律以登录身份为准，忽略请求体传入（防冒名）
      operatorId: req.userContext?.userId || '',
      remark: body.remark,
    });
    return { code: 0, message: 'success', data };
  }

  @NeedRoles(...REWORK_REINSPECT_ROLES)
  @Post('reinspect')
  async reinspect(
    @Body() body: ReworkReinspectDto,
    @Req() req: Request,
  ) {
    const data = await this.service.reinspect({
      id: body.id,
      // 审计人一律以登录身份为准，忽略请求体传入（防冒名）
      operatorId: req.userContext?.userId || '',
      result: body.result,
      remark: body.remark,
    });
    return { code: 0, message: 'success', data };
  }
}
