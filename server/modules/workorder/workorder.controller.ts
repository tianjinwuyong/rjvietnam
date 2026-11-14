import { Controller, Get, Post, Body, Query, Param, Req, Inject, HttpCode, HttpStatus } from '@nestjs/common';
import { NeedLogin } from '../../common/auth/need-login.decorator';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { WorkorderService } from './workorder.service';
import { OaIntegrationService } from '../oa-integration/oa-integration.service';
import { GeneratePickingDto, WorkOrderNoDto } from './dto/workorder-action.dto';
import { sysAccount } from '@server/database/schema';
import type {
  WorkOrder,
  MaterialRequirement,
  PickingOrder,
  PaginatedResponse,
  MaterialRequirementItem,
  PickMaterialResult,
} from '@shared/api.interface';

const MATERIAL_ROLE_TO_SECTION: Record<string, string> = {
  production_material_smt: 'smt',
  production_material_dip: 'dip',
  production_material_assembly: 'assembly',
  production_material_packing: 'packing',
};

@Controller('api/workorder')
@NeedLogin()
export class WorkorderController {
  constructor(
    private readonly workorderService: WorkorderService,
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly oaIntegration: OaIntegrationService,
  ) {}

  private async getCurrentUserInfo(userId: string): Promise<{ roleCode: string; workSection: string | undefined }> {
    if (!userId) return { roleCode: '', workSection: undefined };
    try {
      const rows = await this.db
        .select({ roleCode: sysAccount.roleCode, workSection: sysAccount.workSection })
        .from(sysAccount)
        .where(eq(sysAccount.platformUserId, userId))
        .limit(1);
      if (rows.length === 0) return { roleCode: '', workSection: undefined };
      const { roleCode, workSection } = rows[0];
      if (workSection) return { roleCode, workSection };
      return { roleCode, workSection: MATERIAL_ROLE_TO_SECTION[roleCode] };
    } catch (e: any) {
      console.error('=== getCurrentUserInfo error ===');
      console.error('userId:', userId);
      console.error('Message:', e?.message);
      console.error('Detail:', e?.detail);
      return { roleCode: '', workSection: undefined };
    }
  }

  // ========== Work Order ==========

  @Get('list')
  async getWorkOrderList(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('workOrderNo') workOrderNo?: string,
    @Query('productCode') productCode?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('isSupplement') isSupplement?: string,
  ): Promise<PaginatedResponse<WorkOrder>> {
    return this.workorderService.getWorkOrderList({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      workOrderNo,
      productCode,
      status,
      startDate,
      endDate,
      isSupplement: isSupplement ? isSupplement === 'true' : undefined,
    });
  }

  /**
   * 创建工单：标准 RESTful 入口 POST /api/workorder
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createWorkOrder(
    @Req() req: Request,
    @Body() body: {
      bomId: string;
      planQty?: number;
      quantity?: number;
      workOrderDate?: string;
      plannedDate?: string;
      plannerId?: string;
      plannerName?: string;
      remark?: string;
      workOrderNo?: string;
    },
  ): Promise<WorkOrder> {
    return this.doCreateWorkOrder(req, body);
  }

  /**
   * 兼容旧入口 POST /api/workorder/list，保留以避免前端旧版调用断裂
   */
  @Post('list')
  @HttpCode(HttpStatus.CREATED)
  async createWorkOrderLegacy(
    @Req() req: Request,
    @Body() body: {
      bomId: string;
      planQty?: number;
      quantity?: number;
      workOrderDate?: string;
      plannedDate?: string;
      plannerId?: string;
      plannerName?: string;
      remark?: string;
      workOrderNo?: string;
    },
  ): Promise<WorkOrder> {
    return this.doCreateWorkOrder(req, body);
  }

  private async doCreateWorkOrder(
    req: Request,
    body: {
      bomId: string;
      planQty?: number;
      quantity?: number;
      workOrderDate?: string;
      plannedDate?: string;
      plannerId?: string;
      plannerName?: string;
      remark?: string;
      workOrderNo?: string;
    },
  ): Promise<WorkOrder> {
    const userId = req.userContext?.userId;
    const planQty = Number(body.planQty ?? body.quantity ?? 0);
    const workOrderDate = body.workOrderDate || body.plannedDate || '';
    return this.workorderService.createWorkOrder({
      bomId: body.bomId,
      planQty,
      workOrderDate,
      plannerId: body.plannerId || userId || '',
      plannerName: body.plannerName || req.userContext?.userName || '',
      remark: body.remark,
      workOrderNo: body.workOrderNo,
    });
  }

  @Get('list/:id')
  async getWorkOrderDetail(@Param('id') id: string): Promise<WorkOrder> {
    return this.workorderService.getWorkOrderDetail(id);
  }

  // ========== Work Order Issue (下发) ==========

  @Post('issue')
  async issueWorkOrder(
    @Req() req: Request,
    @Body() body: WorkOrderNoDto,
  ): Promise<PickingOrder[]> {
    const userId = req.userContext?.userId;
    return this.workorderService.issueWorkOrder({
      workOrderNo: body.workOrderNo,
      applicantId: userId || '',
      applicantName: req.userContext?.userName || '',
    });
  }

  // ========== Work Order Recall/Close/Cancel (撤回/结案/取消) ==========

  @Post('recall')
  async recallWorkOrder(
    @Req() req: Request,
    @Body() body: {
      workOrderNo: string;
    },
  ): Promise<void> {
    return this.workorderService.recallWorkOrder(body.workOrderNo, req.userContext?.userId);
  }

  @Post('close')
  async closeWorkOrder(
    @Body() body: WorkOrderNoDto,
  ): Promise<void> {
    return this.workorderService.closeWorkOrder(body.workOrderNo);
  }

  @Post('cancel')
  async cancelWorkOrder(
    @Body() body: WorkOrderNoDto,
  ): Promise<void> {
    return this.workorderService.cancelWorkOrder(body.workOrderNo);
  }

  // ========== Material Requirement ==========

  @Post('requirement/preview')
  async previewMaterialRequirement(
    @Body() body: {
      workOrderNo: string;
    },
  ): Promise<{ items: MaterialRequirementItem[]; workOrderNo: string; sections: string[] }> {
    return this.workorderService.previewMaterialRequirement(body);
  }

  @Post('requirement/generate')
  async generateMaterialRequirement(
    @Req() req: Request,
    @Body() body: {
      workOrderNo: string;
      applicantId?: string;
      applicantName?: string;
    },
  ): Promise<MaterialRequirement[]> {
    const userId = req.userContext?.userId;
    return this.workorderService.generateMaterialRequirement({
      ...body,
      // 申请人一律以登录身份为准，忽略请求体传入（防冒名）
      applicantId: userId || '',
      applicantName: req.userContext?.userName || '',
    });
  }

  @Get('requirement/list')
  async getRequirementList(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('reqNo') reqNo?: string,
    @Query('workOrderNo') workOrderNo?: string,
    @Query('workSection') workSection?: string,
    @Query('status') status?: string,
  ): Promise<PaginatedResponse<MaterialRequirement>> {
    return this.workorderService.getRequirementList({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      reqNo,
      workOrderNo,
      workSection,
      status,
    });
  }

  @Get('requirement/over-supplement-report')
  async getOverSupplementReport(
    @Query('workOrderNo') workOrderNo?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
  ) {
    return this.workorderService.getOverSupplementReport({
      workOrderNo,
      startDate,
      endDate,
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
    });
  }

  @Get('requirement/over-supplement-amount-report')
  async getOverSupplementAmountReport(
    @Query('workOrderNo') workOrderNo?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
  ) {
    return this.workorderService.getOverSupplementAmountReport({
      workOrderNo,
      startDate,
      endDate,
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
    });
  }

  @Post('requirement/:id/submit')
  async submitRequirement(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<MaterialRequirement> {
    const userId = req.userContext?.userId;
    return this.workorderService.submitRequirement(id, {
      submitterId: userId || '',
      submitterName: req.userContext?.userName || '',
    });
  }

  @Post('requirement/submit-by-workorder')
  async submitRequirementsByWorkOrder(
    @Req() req: Request,
    @Body() body: {
      workOrderId: string;
    },
  ): Promise<MaterialRequirement[]> {
    const userId = req.userContext?.userId;
    return this.workorderService.submitRequirementsByWorkOrder(body.workOrderId, {
      submitterId: userId || '',
      submitterName: req.userContext?.userName || '',
    });
  }

  @Post('requirement/batch-submit')
  async batchSubmitRequirements(
    @Req() req: Request,
    @Body() body: {
      ids: string[];
    },
  ): Promise<MaterialRequirement[]> {
    const userId = req.userContext?.userId;
    return this.workorderService.batchSubmitRequirements(body.ids || [], {
      submitterId: userId || '',
      submitterName: req.userContext?.userName || '',
    });
  }

  @Post('requirement/:id/approve')
  async approveRequirement(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: {
      approverId?: string;
      approverName?: string;
      approvalRemark?: string;
      pass: boolean;
    },
  ): Promise<MaterialRequirement> {
    // 审批人一律以登录身份为准，忽略请求体传入的 approverId / approverName（防冒名）
    const userId = req.userContext?.userId || '';
    return this.workorderService.approveRequirement(id, {
      ...body,
      approverId: userId,
      approverName: req.userContext?.userName || req.userContext?.account || '',
    });
  }

  // ========== Picking Order ==========

  @Get('picking/by-no/:pickingNo')
  async getPickingOrderByNo(
    @Param('pickingNo') pickingNo: string,
  ): Promise<PickingOrder> {
    return this.workorderService.getPickingOrderByNo(pickingNo);
  }

  @Get('picking/list')
  async getPickingOrderList(
    @Req() req: Request,
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('pickingNo') pickingNo?: string,
    @Query('workOrderNo') workOrderNo?: string,
    @Query('workSection') workSection?: string,
    @Query('status') status?: string,
  ): Promise<PaginatedResponse<PickingOrder>> {
    const userId = req.userContext?.userId || '';
    const userInfo = await this.getCurrentUserInfo(userId);
    return this.workorderService.getPickingOrderList({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      pickingNo,
      workOrderNo,
      workSection,
      status,
      userRole: userInfo.roleCode,
      userWorkSection: userInfo.workSection,
    });
  }

  @Get('picking/by-workorder/:workOrderId')
  async getPickingOrdersByWorkOrder(
    @Param('workOrderId') workOrderId: string,
  ): Promise<PickingOrder[]> {
    return this.workorderService.getPickingOrdersByWorkOrder(workOrderId);
  }

  @Post('picking/batch-approve')
  async batchApprovePickingOrders(
    @Req() req: Request,
    @Body() body: {
      ids: string[];
      approverId?: string;
      approverName?: string;
      approvalRemark?: string;
      pass: boolean;
    },
  ): Promise<PickingOrder[]> {
    // 审批人一律以登录身份为准，忽略请求体传入的 approverId / approverName（防冒名）
    const userId = req.userContext?.userId || '';
    return this.workorderService.batchApprovePickingOrders({
      ...body,
      approverId: userId,
      approverName: req.userContext?.userName || req.userContext?.account || '',
    });
  }

  @Post('picking/generate')
  async generatePickingOrder(
    @Req() req: Request,
    @Body() body: GeneratePickingDto,
  ): Promise<PickingOrder> {
    const userId = req.userContext?.userId;
    return this.workorderService.generatePickingOrder({
      ...body,
      // 申请人一律以登录身份为准，忽略请求体传入（防冒名）
      applicantId: userId || '',
      applicantName: req.userContext?.userName || '',
    });
  }

  @Post('picking/:id/approve')
  async approvePickingOrder(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: {
      approverId?: string;
      approverName?: string;
      approvalRemark?: string;
      pass: boolean;
    },
  ): Promise<PickingOrder> {
    // 审批人一律以登录身份为准，忽略请求体传入的 approverId / approverName（防冒名）
    const userId = req.userContext?.userId || '';
    return this.workorderService.approvePickingOrder(id, {
      ...body,
      approverId: userId,
      approverName: req.userContext?.userName || req.userContext?.account || '',
    });
  }

  @Post('picking/:id/pick')
  async pickMaterial(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: {
      pickerId?: string;
      pickerName?: string;
      items: Array<{ id: string; actualQty: number; labelNo?: string; labelQty?: number }>;
    },
    ): Promise<PickMaterialResult> {
    const userId = req.userContext?.userId || '';
    const userInfo = await this.getCurrentUserInfo(userId);
    const result = await this.workorderService.pickMaterialIncremental(id, {
      pickerId: body.pickerId || userId || '',
      pickerName: body.pickerName || req.userContext?.userName || '',
      items: body.items,
      userRole: userInfo.roleCode,
      userWorkSection: userInfo.workSection,
    });

    // 发料完成后把实发数量回写 OA（OA 存的是提交时快照），失败不影响发料
    if (result?.order?.status === 'issued' && result.order.pickingNo) {
      void this.oaIntegration.syncIssuedResult(result.order.pickingNo).catch(() => undefined);
    }

    return result;
  }

  // ==================== SMT 盘装料台账 ====================

  @Get('reel/list')
  async listReels(
    @Query('workOrderNo') workOrderNo?: string,
    @Query('reelNo') reelNo?: string,
    @Query('status') status?: string,
  ) {
    return this.workorderService.listPickingReels({ workOrderNo, reelNo, status });
  }

  @Post('reel/return')
  async returnReel(
    @Req() req: Request,
    @Body() body: {
      reelNo?: string;
      materialCode?: string;
      batchNo?: string;
      quantity: number;
      locationCode?: string;
      remark?: string;
    },
  ) {
    const userId = req.userContext?.userId || '';
    return this.workorderService.returnReel({
      ...body,
      operatorId: userId,
      operatorName: req.userContext?.userName || req.userContext?.account || '',
    });
  }

  @Get('consumption/:workOrderNo')
  async getConsumption(@Param('workOrderNo') workOrderNo: string) {
    return this.workorderService.getWorkOrderConsumption(workOrderNo);
  }

  @Post('over-consume/approve')
  async approveOverConsume(
    @Req() req: Request,
    @Body() body: { workOrderNo: string; approved: boolean; remark?: string },
  ) {
    const userId = req.userContext?.userId || '';
    return this.workorderService.approveOverConsume(body.workOrderNo, {
      approved: !!body.approved,
      remark: body.remark,
      operatorId: userId,
      operatorName: req.userContext?.userName || req.userContext?.account || '',
    });
  }

  /** 领料签收：发料完成后由领料方物料员确认实收数量 */
  @Post('picking/:id/receive')
  async receivePicking(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: {
      items?: Array<{ id: string; receivedQty: number; remark?: string }>;
      remark?: string;
    },
  ): Promise<PickingOrder> {
    const userId = req.userContext?.userId || '';
    const userInfo = await this.getCurrentUserInfo(userId);
    return this.workorderService.receivePickingOrder(id, {
      items: body.items,
      remark: body.remark,
      operatorId: userId,
      operatorName: req.userContext?.userName || req.userContext?.account || '',
      operatorRole: userInfo.roleCode,
      operatorWorkSection: userInfo.workSection,
    });
  }

  @Post('picking/:id/pick-with-substitution')
  async pickWithSubstitution(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: {
      pickerId?: string;
      pickerName?: string;
      items: Array<{ id: string; actualQty: number; labelNo?: string; labelQty?: number }>;
      substitutionMap: Record<string, string>;
    },
  ): Promise<PickMaterialResult> {
    const userId = req.userContext?.userId || '';
    const userInfo = await this.getCurrentUserInfo(userId);
    return this.workorderService.pickWithSubstitution(id, {
      pickerId: body.pickerId || userId || '',
      pickerName: body.pickerName || req.userContext?.userName || '',
      items: body.items,
      substitutionMap: body.substitutionMap || {},
      userRole: userInfo.roleCode,
      userWorkSection: userInfo.workSection,
    });
  }

  // ========== Supplement ==========

  @Get('supplement/list')
  async getSupplementList(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('parentOrderNo') parentOrderNo?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<PaginatedResponse<WorkOrder>> {
    return this.workorderService.getSupplementList({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      parentOrderNo,
      startDate,
      endDate,
    });
  }

  @Post('supplement/create')
  async createSupplement(
    @Req() req: Request,
    @Body() body: {
      parentOrderNo: string;
      supplementItems: Array<{ materialId: string; materialCode?: string; materialName?: string; unit?: string; quantity: number; workSection: string }>;
      reason: string;
      applicantId?: string;
      applicantName?: string;
    },
  ): Promise<{ workOrder: WorkOrder; pickingOrders: PickingOrder[] }> {
    const userId = req.userContext?.userId;
    return this.workorderService.createSupplement({
      ...body,
      // 申请人一律以登录身份为准，忽略请求体传入（防冒名）
      applicantId: userId || '',
      applicantName: req.userContext?.userName || '',
    });
  }

  @Get('issue-records')
  async getIssueRecords(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('materialCode') materialCode?: string,
    @Query('batchNo') batchNo?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.workorderService.getIssueRecords({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      materialCode,
      batchNo,
      startDate,
      endDate,
    });
  }

  /** 物料追溯管理：仓库全部主要业务异动流水聚合查询 */
  @Get('trace-records')
  async getTraceRecords(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('materialCode') materialCode?: string,
    @Query('batchNo') batchNo?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('productionDate') productionDate?: string,
    @Query('supplier') supplier?: string,
    @Query('txType') txType?: string,
  ) {
    return this.workorderService.getTraceRecords({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      materialCode,
      batchNo,
      startDate,
      endDate,
      productionDate,
      supplier,
      txType,
    });
  }
}