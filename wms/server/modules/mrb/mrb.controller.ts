import { Controller, Post, Get, Body, Query, Param, Req } from '@nestjs/common';
import { NeedLogin } from '../../common/auth/need-login.decorator';
import { NeedRoles } from '../../common/auth/auth.decorator';
import { MrbService, type MrbOperator } from './mrb.service';
import { MrbFinalApproveDto } from './dto/final-approve.dto';
import { MrbInitiateDto } from './dto/initiate.dto';
import { MrbPlanDto } from './dto/plan.dto';
import {
  MrbAssignReviewersDto,
  MrbCancelDto,
  MrbDestroyScrapDto,
  MrbPreApproveDto,
  MrbRejectDto,
  MrbReturnBackDto,
  MrbSubmitDto,
  MrbWithdrawDto,
} from './dto/mrb-action.dto';
import type { Request } from 'express';
import type { MrbSlaLevel } from '@shared/api.interface';

/** 写端点角色口径（与设计文档 §4.1 一致） */
const MRB_WRITE_ROLES = ['sqe', 'iqc_manager', 'quality_manager', 'admin'];
const MRB_PRE_APPROVE_ROLES = ['iqc_manager', 'admin'];
const MRB_FINAL_ROLES = ['quality_manager', 'admin'];
/** 审批节点驳回：预审(IQC主管) + 终审(质量经理)，具体按当前状态在 service 内再收敛 */
const MRB_RETURN_ROLES = ['iqc_manager', 'quality_manager', 'admin'];
const MRB_CONFIRM_OUT_ROLES = ['wh_keeper', 'wh_manager', 'admin'];
/** 报废销毁：仓管确认货已进不良品仓后核销；质量经理可代确认 */
const MRB_SCRAP_DESTROY_ROLES = ['wh_keeper', 'wh_manager', 'quality_manager', 'admin'];

@Controller('api/mrb')
@NeedLogin()
export class MrbController {
  constructor(private readonly mrbService: MrbService) {}

  /**
   * 从登录态取操作人。
   * 一律以 JWT 为准，**禁止**从请求体读操作人（可冒名）。
   * 注意：userContext.userName 在现有守卫里取的是 roleName，故姓名字段仅作兜底，
   * 展示用姓名一律由服务端按 user_id 关联 sys_account 现取。
   */
  private operatorOf(req: Request): MrbOperator {
    const ctx = req.userContext;
    return {
      userId: ctx?.userId || '',
      roleCode: ctx?.roleCode || '',
      name: ctx?.userName || ctx?.account || '',
    };
  }

  /**
   * 评审员候选（所有能起草 / 指派 MRB 的角色都可用）。
   * 此前前端复用了管理员专属的 `/api/system/account/list`，导致 SQE 等账号
   * 打开「选定评审人员」时下拉为空，只能手输工号。
   */
  @NeedRoles(...MRB_WRITE_ROLES)
  @Get('reviewer-candidates')
  async getReviewerCandidates() {
    const items = await this.mrbService.getReviewerCandidates();
    return { code: 0, message: 'success', data: { items } };
  }

  @Get('list')
  async getList(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('mrbNo') mrbNo?: string,
    @Query('materialCode') materialCode?: string,
    @Query('batchNo') batchNo?: string,
    @Query('status') status?: string,
    @Query('scope') scope?: 'pending' | 'done',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('onlyTimeout') onlyTimeout?: string,
    @Query('onlyUrgent') onlyUrgent?: string,
    @Query('slaLevel') slaLevel?: MrbSlaLevel,
  ) {
    const result = await this.mrbService.getMrbList({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      mrbNo,
      materialCode,
      batchNo,
      status,
      scope,
      startDate,
      endDate,
      onlyTimeout,
      onlyUrgent,
      slaLevel,
    });
    return { code: 0, message: 'success', data: result };
  }

  /** 巡检汇总：{ warn, overdue, singleApprover } */
  @Get('overdue-summary')
  async getOverdueSummary() {
    const result = await this.mrbService.getOverdueSummary();
    return { code: 0, message: 'success', data: result };
  }

  /** 已处理 MRB —— 按 IQC 批次折叠（同批次多次评审合并为一行） */
  @Get('lot-groups')
  async getLotGroups(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('mrbNo') mrbNo?: string,
    @Query('materialCode') materialCode?: string,
    @Query('batchNo') batchNo?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const result = await this.mrbService.getMrbLotGroups({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      mrbNo,
      materialCode,
      batchNo,
      status,
      startDate,
      endDate,
    });
    return { code: 0, message: 'success', data: result };
  }

  /** 待发起 MRB 的 IQC 批次清单 */
  @Get('pending-lots')
  async getPendingLots(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('materialCode') materialCode?: string,
    @Query('batchNo') batchNo?: string,
    @Query('inspectionNo') inspectionNo?: string,
  ) {
    const result = await this.mrbService.getPendingLots({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      materialCode,
      batchNo,
      inspectionNo,
    });
    return { code: 0, message: 'success', data: result };
  }

  /**
   * 我的评审任务。
   * ⚠️ `reviewerId` 查询参数已**彻底移除**（旧实现允许传别人的 id，可越权查看他人工单）。
   */
  @Get('my-tasks')
  async getMyTasks(
    @Req() req: Request,
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('status') status?: string,
  ) {
    const result = await this.mrbService.getMyTasks({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      reviewerId: req.userContext?.userId || '',
      status,
    });
    return { code: 0, message: 'success', data: result };
  }

  /** 发起 MRB（含「存草稿」与「提交评审」两种落点） */
  @NeedRoles(...MRB_WRITE_ROLES)
  @Post('initiate')
  async initiate(@Req() req: Request, @Body() body: MrbInitiateDto) {
    const result = await this.mrbService.initiateMrb({
      iqcLotId: body.iqcLotId,
      reason: body.reason,
      operator: this.operatorOf(req),
      quantity: body.quantity,
      submit: body.submit,
      isUrgent: body.isUrgent,
      urgentReason: body.urgentReason,
      reviewers: body.reviewers,
    });
    return { code: 0, message: 'success', data: result };
  }

  /**
   * 该批次关联的收货二维码（一箱一码）+ 已分摊量。
   * 供 SQE 方案弹窗使用；传 mrbId 或 lotId 均可。
   */
  @NeedRoles(...MRB_WRITE_ROLES)
  @Get('lot-labels')
  async getLotLabels(@Query('mrbId') mrbId?: string, @Query('lotId') lotId?: string) {
    const items = await this.mrbService.getLotLabels({ mrbId, lotId });
    return { code: 0, message: 'success', data: { items } };
  }

  /** 读方案（处置明细 + 二维码分摊 + 评审员） */
  @NeedRoles(...MRB_WRITE_ROLES)
  @Get('plan/:mrbId')
  async getPlan(@Param('mrbId') mrbId: string) {
    const data = await this.mrbService.getPlan(mrbId);
    return { code: 0, message: 'success', data };
  }

  /** 保存 / 提交方案（SQE）：评审员 + 处置明细 + 二维码分摊 */
  @NeedRoles(...MRB_WRITE_ROLES)
  @Post('plan')
  async savePlan(@Req() req: Request, @Body() body: MrbPlanDto) {
    const result = await this.mrbService.savePlan({
      mrbId: body.mrbId,
      reviewers: body.reviewers,
      dispositions: body.dispositions || [],
      failReason: body.failReason,
      submit: body.submit,
      operator: this.operatorOf(req),
    });
    return { code: 0, message: 'success', data: result };
  }

  @NeedRoles(...MRB_WRITE_ROLES)
  @Post('assign-reviewers')
  async assignReviewers(@Req() req: Request, @Body() body: MrbAssignReviewersDto) {
    const result = await this.mrbService.assignReviewers({
      mrbId: body.mrbId,
      reviewers: body.reviewers,
      operator: this.operatorOf(req),
    });
    return { code: 0, message: 'success', data: result };
  }

  /** 草稿提交（draft → 待指派 / 评审中 / 待预审 / 待终审） */
  @NeedRoles(...MRB_WRITE_ROLES)
  @Post('submit')
  async submit(@Req() req: Request, @Body() body: MrbSubmitDto) {
    const result = await this.mrbService.submitMrb({
      mrbId: body.mrbId,
      operator: this.operatorOf(req),
    });
    return { code: 0, message: 'success', data: result };
  }

  /** 作废（draft / pending_review / reviewing） */
  @NeedRoles(...MRB_WRITE_ROLES)
  @Post('cancel')
  async cancel(@Req() req: Request, @Body() body: MrbCancelDto) {
    const result = await this.mrbService.cancelMrb({
      mrbId: body.mrbId,
      reason: body.reason || '',
      operator: this.operatorOf(req),
    });
    return { code: 0, message: 'success', data: result };
  }

  /**
   * 撤回方案（SQE）：reviewing → pending_review。
   * 与「作废」不同，单据继续存活，方案保留，改完可重新提交评审。
   */
  @NeedRoles(...MRB_WRITE_ROLES)
  @Post('withdraw')
  async withdraw(@Req() req: Request, @Body() body: MrbWithdrawDto) {
    const result = await this.mrbService.withdrawMrb({
      mrbId: body.mrbId,
      reason: body.reason || '',
      operator: this.operatorOf(req),
    });
    return { code: 0, message: 'success', data: result };
  }

  /**
   * 审批驳回（IQC 主管审核 / 质量经理审批）：退回 SQE 修改方案。
   * 与「否决并全批退货」不同，不产生任何库存变动、不生成下游单。
   */
  @NeedRoles(...MRB_RETURN_ROLES)
  @Post('return-back')
  async returnBack(@Req() req: Request, @Body() body: MrbReturnBackDto) {
    const result = await this.mrbService.returnBackMrb({
      mrbId: body.mrbId,
      reason: body.reason || '',
      operator: this.operatorOf(req),
    });
    return { code: 0, message: 'success', data: result };
  }

  /** 资料齐全性预审（iqc_manager / admin） */
  @NeedRoles(...MRB_PRE_APPROVE_ROLES)
  @Post('pre-approve')
  async preApprove(@Req() req: Request, @Body() body: MrbPreApproveDto) {
    const result = await this.mrbService.preApprove({
      mrbId: body.mrbId,
      result: body.result,
      remark: body.remark,
      separationRemark: body.separationRemark,
      operator: this.operatorOf(req),
    });
    return { code: 0, message: 'success', data: result };
  }

  @Post('submit-review')
  async submitReview(
    @Req() req: Request,
    @Body() body: {
      /** @deprecated 评审人一律取登录态，此字段被忽略 */
      reviewerId?: string;
      mrbId: string;
      reviewOpinion: string;
      /** 评审结论：special_admit / return / rework / scrap（兼容 accept / reject / deviation） */
      reviewResult: string;
    },
  ) {
    // 评审人一律以登录身份为准，忽略请求体传入（防冒名）。
    const result = await this.mrbService.submitReview({
      reviewerId: req.userContext?.userId || '',
      mrbId: body.mrbId,
      reviewOpinion: body.reviewOpinion,
      reviewResult: body.reviewResult,
    });
    return { code: 0, message: 'success', data: result };
  }

  @NeedRoles(...MRB_FINAL_ROLES)
  @Post('final-approve')
  async finalApprove(@Req() req: Request, @Body() body: MrbFinalApproveDto) {
    const operator = this.operatorOf(req);
    const result = await this.mrbService.finalApprove({
      mrbId: body.mrbId,
      finalResult: body.finalResult,
      finalRemark: body.finalRemark,
      separationRemark: body.separationRemark,
      approverId: operator.userId,
      approverName: operator.name,
      roleCode: operator.roleCode,
      dispositions: body.dispositions,
    });
    return { code: 0, message: 'success', data: result };
  }

  /** 终审驳回 */
  @NeedRoles(...MRB_FINAL_ROLES)
  @Post('reject')
  async reject(@Req() req: Request, @Body() body: MrbRejectDto) {
    const result = await this.mrbService.rejectMrb({
      mrbId: body.mrbId,
      reason: body.reason || '',
      separationRemark: body.separationRemark,
      operator: this.operatorOf(req),
    });
    return { code: 0, message: 'success', data: result };
  }

  /** 「其他-退回客户」确认已提走（仓管） */
  @NeedRoles(...MRB_CONFIRM_OUT_ROLES)
  @Post('disposition/:id/confirm-out')
  async confirmOut(@Req() req: Request, @Param('id') id: string) {
    const result = await this.mrbService.confirmOut({
      dispositionId: id,
      operator: this.operatorOf(req),
    });
    return { code: 0, message: 'success', data: result };
  }

  /**
   * 报废销毁（MRB v3）：报废量已按调拨任务进入不良品仓后，仓管确认销毁核销。
   * 未入库就点会被 409 拦住 —— 不允许「账上没了、货还在货架上」。
   */
  @NeedRoles(...MRB_SCRAP_DESTROY_ROLES)
  @Post('disposition/:id/destroy')
  async destroyScrap(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: MrbDestroyScrapDto,
  ) {
    const result = await this.mrbService.destroyScrap({
      dispositionId: id,
      operator: this.operatorOf(req),
      remark: body.remark,
    });
    return { code: 0, message: 'success', data: result };
  }

  @Get('detail/:id')
  async getDetail(@Param('id') id: string) {
    const result = await this.mrbService.getMrbDetail(id);
    return { code: 0, message: 'success', data: result };
  }
}
