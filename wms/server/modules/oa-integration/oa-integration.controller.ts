import { Controller, Post, Body, Headers, Param } from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator';
import type { Request } from 'express';
import { OaIntegrationService } from './oa-integration.service';

@Controller('api/integration/oa')
export class OaIntegrationController {
  constructor(private readonly svc: OaIntegrationService) {}

  /** 手工触发：把指定领料单提交 OA（后续可由业务动作自动触发） */
  @Post('submit-picking/:pickingNo')
  async submitPicking(@Param('pickingNo') pickingNo: string) {
    return this.svc.submitPickingApproval(pickingNo);
  }

  /** 提交超补单到 OA */
  @Post('submit-over-supplement/:orderNo')
  async submitOverSupplement(@Param('orderNo') orderNo: string) {
    return this.svc.submitOverSupplement(orderNo);
  }

  /** 提交工单超耗审批 */
  @Post('submit-over-consume/:workOrderNo')
  async submitOverConsume(@Param('workOrderNo') workOrderNo: string) {
    return this.svc.submitOverConsume(workOrderNo);
  }

  /** 提交盘点单审批 */
  @Post('submit-stock-take/:takeNo')
  async submitStockTake(@Param('takeNo') takeNo: string) {
    return this.svc.submitStockTake(takeNo);
  }

  /** 提交 IQC 检验报告审批 */
  @Post('submit-iqc/:reportNo')
  async submitIqc(@Param('reportNo') reportNo: string) {
    return this.svc.submitIqcReport(reportNo);
  }

  /** 提交 MRB 评审 */
  @Post('submit-mrb/:mrbNo')
  async submitMrb(@Param('mrbNo') mrbNo: string) {
    return this.svc.submitMrb(mrbNo);
  }

  /** 发料完成后提交 OA 物料员确认 */
  @Post('submit-receive/:pickingNo')
  async submitReceive(@Param('pickingNo') pickingNo: string) {
    return this.svc.submitPickingReceive(pickingNo);
  }

  /** 发料完成后提交 OA 生产主管确认 */
  @Post('submit-confirm/:pickingNo')
  async submitConfirm(@Param('pickingNo') pickingNo: string) {
    return this.svc.submitPickingConfirmation(pickingNo);
  }

  /** OA 审批结果回调（HMAC 验签 + 幂等；外网调用需跳过登录守卫） */
  @Public()
  @Post('callback')
  async callback(@Body() body: any, @Headers('x-oa-signature') signature?: string) {
    return this.svc.handleCallback(body, signature);
  }
}
