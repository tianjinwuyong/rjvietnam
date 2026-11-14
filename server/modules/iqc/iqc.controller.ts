import {
  Controller,
  Post,
  Get,
  Put,
  Patch,
  Delete,
  Body,
  Query,
  Param,
  Req,
  Res,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { NeedLogin } from '../../common/auth/need-login.decorator';
import { readWorkbook } from '../../common/utils/spreadsheet';
import { NeedRoles } from '../../common/auth/auth.decorator';
import { IqcService, type IqcInspectionRecordInput } from './iqc.service';
import { IqcTemplateService } from './iqc-template.service';
import { IqcStandardItemService } from './iqc-standard-item.service';
import type { BoundMaterial } from './iqc-template.service';
import { SamplingPlanService } from './sampling-plan.service';
import { StrictnessService } from './strictness.service';
import { ExpiryScanService } from './expiry-scan.service';
import type { Request, Response } from 'express';
import type {
  IqcTemplateItem,
  IqcStandardItem,
  IqcTemplateImportResult,
  IqcRawTemplate,
  SamplingPlanResult,
} from '@shared/api.interface';

@Controller('api/iqc')
@NeedLogin()
export class IqcController {
  constructor(
    private readonly iqcService: IqcService,
    private readonly templateService: IqcTemplateService,
    private readonly standardItemService: IqcStandardItemService,
    private readonly samplingPlanService: SamplingPlanService,
    private readonly strictnessService: StrictnessService,
    private readonly expiryScanService: ExpiryScanService,
  ) {}

  /**
   * 手动触发一次「超期 / 预警物料推送待检清单」扫描。
   *
   * 正常由 `ExpiryScanService` 每天 08:30 自动执行；本接口用于：
   *   - 运维补推（服务当天没开机 / 调整过物料有效期后想立刻生效）；
   *   - 有效期管理页面的「立即扫描」按钮；
   *   - 上线验证。
   * 幂等：已推送过的批次（EXP 前缀）或已有进行中检验批次不会重复生成。
   */
  @NeedRoles('admin', 'iqc_manager', 'quality_manager', 'wh_manager')
  @Post('expiry/scan')
  async scanExpiryStock(): Promise<{ code: number; message: string; data: { created: number; skipped: boolean } }> {
    const result = await this.expiryScanService.triggerManually();
    return {
      code: 0,
      message: result.skipped ? '上一次扫描仍在执行' : 'success',
      data: result,
    };
  }

  /** 超期扫描调度状态（下次执行时间 / 是否正在执行），排查用 */
  @NeedRoles('admin', 'iqc_manager', 'quality_manager', 'wh_manager')
  @Get('expiry/scan/status')
  getExpiryScanStatus() {
    return { code: 0, message: 'success', data: this.expiryScanService.getStatus() };
  }

  @Get('pending')
  async getPending(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('materialCode') materialCode?: string,
    @Query('supplierCode') supplierCode?: string,
    @Query('batchNo') batchNo?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('status') status?: string,
    @Query('statuses') statuses?: string,
  ) {
    const result = await this.iqcService.getPendingList({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      materialCode,
      supplierCode,
      batchNo,
      startDate,
      endDate,
      status,
      statuses,
    });
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  /**
   * 漏提报告异常清单（三类）：
   *  待检超期 / 草稿超时 / 已出结论但零小项。
   * 所有登录用户可看（检验员也能看到自己积压的批次）。
   */
  @Get('anomalies')
  async getAnomalies(
    @Query('pendingDays') pendingDays?: string,
    @Query('draftHours') draftHours?: string,
  ) {
    const result = await this.iqcService.getIqcAnomalies({
      pendingDays: pendingDays !== undefined ? Number(pendingDays) : undefined,
      draftHours: draftHours !== undefined ? Number(draftHours) : undefined,
    });
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  /** 人工判定台账（仅 IQC 主管 / 质量经理 / 管理员可查） */
  @NeedRoles('iqc_manager', 'quality_manager', 'admin')
  @Get('manual-judgments')
  async getManualJudgments(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('keyword') keyword?: string,
  ) {
    const result = await this.iqcService.getManualJudgments({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      startDate,
      endDate,
      keyword,
    });
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @Get('lot/:id')
  async getLotDetail(@Param('id') id: string) {
    const result = await this.iqcService.getLotDetail(id);
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @Get('inspection-items/:materialId')
  async getInspectionItems(@Param('materialId') materialId: string) {
    const result = await this.iqcService.getInspectionItems(materialId);
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @Get('last-specs/:materialCode')
  async getLastSpecs(@Param('materialCode') materialCode: string) {
    const result = await this.iqcService.getLastSpecsByMaterialCode(materialCode);
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @NeedLogin()
  @Post('inspect/:lotId')
  async inspect(
    @Param('lotId') lotId: string,
    @Req() req: Request,
    @Body() body: {
      records: IqcInspectionRecordInput[];
      finalResult: 'pass' | 'fail';
      /** @deprecated 检验员一律取登录态，此字段被忽略（仅为兼容老前端保留） */
      inspectorId?: string;
      /** @deprecated 检验员一律取登录态，此字段被忽略（仅为兼容老前端保留） */
      inspectorName?: string;
      remark?: string;
      /** 不合格类型：判定为 fail 时必填，取值为 iqc.defect_type_* 八项之一 */
      defectType?: string;
    },
  ) {
    // 检验员一律以登录身份为准，忽略请求体传入（防冒名）
    const result = await this.iqcService.submitInspection(
      lotId,
      body.records,
      body.finalResult,
      req.userContext?.userId || '',
      req.userContext?.userName || req.userContext?.account || '',
      body.remark,
      body.defectType,
    );
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @Post('lot/:id/save-records')
  async saveRecords(
    @Param('id') lotId: string,
    @Req() req: Request,
    @Body() body: {
      records: IqcInspectionRecordInput[];
      /** @deprecated 检验员一律取登录态，此字段被忽略（仅为兼容老前端保留） */
      inspectorId?: string;
      /** @deprecated 检验员一律取登录态，此字段被忽略（仅为兼容老前端保留） */
      inspectorName?: string;
      remark?: string;
    },
  ) {
    // 检验员一律以登录身份为准，忽略请求体传入（防冒名）
    const result = await this.iqcService.saveInspectionRecords(
      lotId,
      body.records,
      req.userContext?.userId || '',
      req.userContext?.userName || req.userContext?.account || '',
      body.remark,
    );
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  /**
   * 人工判定：仅 IQC 主管 / 质量经理 / 管理员可用（2026-10-18 收紧）。
   *
   * 背景：此前本接口只要求登录，任何角色都能把整批直接判成 pass/fail 且不留痕，
   * 库里因此出现 5 份「零小项却判合格」的报告，无法追溯判定人与依据。
   * 现在：
   *  - 角色由 @NeedRoles 限制；
   *  - 原因必填（质量体系审核必查项）；
   *  - 批次已有检验小项时服务层直接拒绝，结论只能由小项推导。
   */
  @NeedRoles('iqc_manager', 'quality_manager', 'admin')
  @Post('lot/:id/judge')
  async judgeLot(
    @Param('id') id: string,
    @Req() req: Request,
    @Body() body: { finalResult: 'pass' | 'fail'; defectType?: string; reason?: string },
  ) {
    const result = await this.iqcService.judgeLot(id, body.finalResult, body.defectType, {
      reason: body.reason,
      operatorId: req.userContext?.userId || '',
      operatorName: req.userContext?.userName || req.userContext?.account || '',
    });
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  /**
   * 免检确认：检验属性（外观 + 尺寸功能）均为免检的批次，
   * IQC 核对物料编号、供应商等信息后直接维护为合格并放行，不生成检验报告与检验记录。
   */
  @Post('lot/:id/exempt-confirm')
  async exemptConfirmLot(
    @Param('id') id: string,
    @Body() body: { operatorId?: string; operatorName?: string; remark?: string },
    @Req() req: Request,
  ) {
    // 确认人身份以登录态为准，避免前端可伪造
    const ctx = (req as any).userContext || {};
    const result = await this.iqcService.exemptConfirmLot(
      id,
      ctx.userId || body.operatorId || '',
      ctx.userName || body.operatorName || '',
      body.remark,
    );
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @Put('lot/:id/template')
  async setLotTemplate(
    @Param('id') id: string,
    @Body() body: { templateId: string },
  ) {
    const result = await this.iqcService.setLotTemplate(id, body.templateId);
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  // ===== 检验草稿：检验员填写过程中自动暂存，退出后可恢复 =====

  @Get('lot/:id/draft')
  async getInspectionDraft(@Param('id') id: string) {
    const result = await this.iqcService.getInspectionDraft(id);
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @Put('lot/:id/draft')
  async saveInspectionDraft(
    @Param('id') id: string,
    @Req() req: Request,
    @Body() body: Record<string, any>,
  ) {
    // 检验员一律以登录身份为准，忽略请求体传入的 inspectorId（防冒名）
    const result = await this.iqcService.saveInspectionDraft(
      id,
      body,
      req.userContext?.userId || '',
    );
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @Delete('lot/:id/draft')
  async clearInspectionDraft(@Param('id') id: string) {
    const result = await this.iqcService.clearInspectionDraft(id);
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @Get('lot/:id/records')
  async getLotRecords(@Param('id') id: string) {
    const result = await this.iqcService.getLotRecords(id);
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @Get('records')
  async getRecords(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('batchNo') batchNo?: string,
    @Query('materialCode') materialCode?: string,
    @Query('supplierCode') supplierCode?: string,
    @Query('inspectorId') inspectorId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('reviewStatus') reviewStatus?: string,
    @Query('finalResult') finalResult?: string,
    @Query('reportNo') reportNo?: string,
  ) {
    const result = await this.iqcService.getRecordList({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      batchNo,
      materialCode,
      supplierCode,
      inspectorId,
      startDate,
      endDate,
      reviewStatus,
      finalResult,
      reportNo,
    });
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @Get('stats/pass-rate')
  async getPassRateStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('materialCode') materialCode?: string,
    @Query('materialType') materialType?: string,
    @Query('supplierCode') supplierCode?: string,
    @Query('groupBy') groupBy: 'day' | 'week' | 'month' = 'day',
  ) {
    const result = await this.iqcService.getPassRateStats({
      startDate,
      endDate,
      materialCode,
      materialType,
      supplierCode,
      groupBy,
    });
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @Get('report/:id')
  async getReport(@Param('id') id: string) {
    const result = await this.iqcService.getReportDetail(id);
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @NeedRoles('iqc_manager', 'admin', 'quality_manager')
  @Post('report/:id/review')
  async reviewReport(
    @Param('id') id: string,
    @Body() body: { reviewerId: string; reviewerName: string; reviewRemark?: string },
    @Req() req: Request,
  ) {
    // 审批人身份以登录态为准（前端本地缓存的用户信息可能缺 id，
    // 之前会退化成字符串 "admin" 写库，导致报告查询 ::uuid 报 500）
    const ctx = (req as any).userContext || {};
    const result = await this.iqcService.reviewReport(
      id,
      ctx.userId || body.reviewerId,
      ctx.userName || body.reviewerName,
      body.reviewRemark,
    );
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @NeedRoles('iqc_manager', 'admin', 'quality_manager')
  @Post('report/:id/reject')
  async rejectReport(
    @Param('id') id: string,
    @Body() body: { rejectorId: string; rejectorName: string; rejectReason: string },
    @Req() req: Request,
  ) {
    const ctx = (req as any).userContext || {};
    const result = await this.iqcService.rejectReport(
      id,
      ctx.userId || body.rejectorId,
      ctx.userName || body.rejectorName,
      body.rejectReason,
    );
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @NeedRoles('iqc_manager', 'admin', 'quality_manager')
  @Post('report/batch-approve')
  async batchApproveReports(
    @Body() body: { ids: string[]; reviewerId: string; reviewerName: string },
    @Req() req: Request,
  ) {
    const ctx = (req as any).userContext || {};
    const result = await this.iqcService.batchApproveReports(
      body.ids,
      ctx.userId || body.reviewerId,
      ctx.userName || body.reviewerName,
    );
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  // ===== Template endpoints =====

  @Get('templates')
  async getTemplates(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('keyword') keyword?: string,
    @Query('status') status?: string,
  ) {
    const result = await this.templateService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      keyword,
      status,
    });
    return { code: 0, message: 'success', data: result };
  }

  @Get('templates/by-material/:materialId')
  async getTemplateByMaterial(@Param('materialId') materialId: string) {
    const result = await this.templateService.getTemplateByMaterial(materialId);
    return { code: 0, message: 'success', data: result };
  }

  @Get('templates/last-used/:materialId')
  async getLastUsedTemplateId(@Param('materialId') materialId: string) {
    const result = await this.iqcService.getLastUsedTemplateId(materialId);
    return { code: 0, message: 'success', data: result };
  }

  @Get('templates/raw/:id')
  async getRawTemplate(@Param('id') id: string): Promise<{ code: number; message: string; data: IqcRawTemplate | null }> {
    const result = await this.templateService.getRawTemplate(id);
    return { code: 0, message: 'success', data: result };
  }

  @Get('templates/export/:id')
  async exportTemplate(@Param('id') id: string, @Res() res: Response) {
    const raw = await this.templateService.getRawTemplate(id);
    if (!raw) {
      throw new NotFoundException('模板不存在');
    }

    let xlsxModule: any;
    try {
      xlsxModule = await import('xlsx');
    } catch {
      throw new NotImplementedException('导出功能不可用（xlsx 库未安装）');
    }

    const XLSX = xlsxModule.default ?? xlsxModule;
    const worksheet: any = {};

    // 写入单元格
    for (const cell of raw.cells) {
      const addr = XLSX.utils.encode_cell({ r: cell.r, c: cell.c });
      worksheet[addr] = { t: 's', v: String(cell.v) };
    }

    // 设置范围
    const maxR = Math.max(...raw.cells.map((c: any) => c.r), 0);
    const maxC = Math.max(...raw.cells.map((c: any) => c.c), 0);
    worksheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });

    // 设置合并单元格
    if (raw.merges && raw.merges.length > 0) {
      worksheet['!merges'] = raw.merges.map((m: any) => ({
        s: { r: m.s.r, c: m.s.c },
        e: { r: m.e.r, c: m.e.c },
      }));
    }

    // 设置列宽
    if (raw.colWidths && raw.colWidths.length > 0) {
      worksheet['!cols'] = raw.colWidths.map((w: number) => ({ wch: w }));
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, raw.sheetName || 'Sheet1');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const fileName = encodeURIComponent(`${raw.templateName || 'template'}.xlsx`);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);
    res.send(buffer);
  }

  @Get('templates/:id')
  async getTemplate(@Param('id') id: string) {
    const result = await this.templateService.getById(id);
    return { code: 0, message: 'success', data: result };
  }

  @Post('templates')
  async createTemplate(@Body() body: Record<string, any>) {
    const result = await this.templateService.create(body);
    return { code: 0, message: 'success', data: result };
  }

  @Patch('templates/:id')
  async updateTemplate(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    const result = await this.templateService.update(id, body);
    return { code: 0, message: 'success', data: result };
  }

  @Delete('templates/:id')
  async deleteTemplate(@Param('id') id: string) {
    await this.templateService.delete(id);
    return { code: 0, message: 'success', data: null };
  }

  @Get('templates/:id/items')
  async getTemplateItems(@Param('id') id: string) {
    const tpl = await this.templateService.getById(id);
    return { code: 0, message: 'success', data: tpl?.items ?? [] };
  }

  @Put('templates/:id/items')
  async saveTemplateItems(
    @Param('id') id: string,
    @Body() body: { items: IqcTemplateItem[] },
  ) {
    const result = await this.templateService.saveItems(id, body.items ?? []);
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @Get('templates/:id/materials')
  async getTemplateMaterials(@Param('id') id: string): Promise<{ code: number; message: string; data: BoundMaterial[] }> {
    const result = await this.templateService.getBoundMaterials(id);
    return { code: 0, message: 'success', data: result };
  }

  @Put('templates/:id/materials')
  async bindTemplateMaterials(
    @Param('id') id: string,
    @Body() body: { materialIds: string[] },
  ) {
    await this.templateService.bindMaterials(id, body.materialIds ?? []);
    return { code: 0, message: 'success', data: null };
  }

  // ===== Standard item library (iqc_standard_item) =====

  @Get('standard-items')
  async listStandardItems(@Query('sectionType') sectionType?: string) {
    const result = await this.standardItemService.list(sectionType);
    return { code: 0, message: 'success', data: result };
  }

  @Post('standard-items')
  async createStandardItem(@Body() body: Partial<IqcStandardItem>) {
    const result = await this.standardItemService.create(body);
    return { code: 0, message: 'success', data: result };
  }

  @Put('standard-items/:id')
  async updateStandardItem(
    @Param('id') id: string,
    @Body() body: Partial<IqcStandardItem>,
  ) {
    const result = await this.standardItemService.update(id, body);
    return { code: 0, message: 'success', data: result };
  }

  @Delete('standard-items/:id')
  async deleteStandardItem(@Param('id') id: string) {
    await this.standardItemService.delete(id);
    return { code: 0, message: 'success', data: null };
  }

  // Re-import one section's items from the standard library into a template
  @Post('templates/:id/import-section')
  async importTemplateSection(
    @Param('id') id: string,
    @Body() body: { sectionType: string },
  ) {
    if (!body.sectionType) throw new BadRequestException('sectionType 不能为空');
    const count = await this.templateService.importSectionFromStandard(id, body.sectionType);
    return { code: 0, message: 'success', data: { count } };
  }

  // ===== Sampling plan =====

  @Get('sampling/calculate')
  async calculateSampling(
    @Query('lotSize') lotSize: string,
    @Query('level') level: string = 'II',
    @Query('aql') aql: string = '0.4',
    @Query('strictness') strictness: string = 'normal',
  ): Promise<{ code: number; message: string; data: SamplingPlanResult }> {
    const lotSizeNum = parseInt(lotSize, 10);
    if (isNaN(lotSizeNum) || lotSizeNum < 2) {
      throw new BadRequestException('批量必须大于等于2');
    }
    const result = this.samplingPlanService.calculateSamplingPlan(
      strictness as 'normal' | 'tightened' | 'reduced',
      level,
      aql,
      lotSizeNum,
    );
    return { code: 0, message: 'success', data: result };
  }

  /**
   * 批量抽样计算：把物料当前严格度套到每个检验项目上。
   * 检验单打开时一次算完，避免前端逐项请求；服务端是唯一口径来源。
   */
  @Post('sampling/plans')
  async calculateSamplingPlans(@Body() body: {
    materialId?: string;
    lotSize: number;
    items: Array<{
      sectionType?: string;
      samplingPlanText?: string;
      aql?: string;
      sampleSize?: number;
      ac?: number;
      re?: number;
    }>;
  }) {
    const lotSize = Number(body?.lotSize);
    if (!Number.isFinite(lotSize) || lotSize < 2) {
      throw new BadRequestException('批量必须大于等于2');
    }
    const items = Array.isArray(body?.items) ? body.items : [];
    if (items.length === 0) {
      return { code: 0, message: 'success', data: { items: [], strictness: { appearance: 'normal', dimensional: 'normal' } } };
    }

    // 严格度已按物料维护一条：外观类与尺寸类工段共用同一档，不再分工段取值
    const state = body.materialId
      ? (await this.strictnessService.getCurrentStrictness(body.materialId))?.strictness
      : undefined;
    const strictness = state || 'normal';

    const results = this.samplingPlanService.planForItems({
      lotSize,
      items,
      strictness: { appearance: strictness, dimensional: strictness },
    });

    return {
      code: 0,
      message: 'success',
      data: {
        items: results,
        strictness,
      },
    };
  }

  // ===== Strictness management =====

  @Get('strictness/list')
  async getStrictnessList(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('materialCode') materialCode?: string,
    @Query('materialName') materialName?: string,
    @Query('strictness') strictness?: string,
  ) {
    const result = await this.strictnessService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      materialCode,
      materialName,
      strictness,
    });
    return { code: 0, message: 'success', data: result };
  }

  @Get('strictness/transfer-logs')
  async getTransferLogs(
    @Query('materialId') materialId?: string,
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '50',
  ) {
    const result = await this.strictnessService.getTransferLogs({
      materialId,
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
    });
    return { code: 0, message: 'success', data: result };
  }

  @Post('strictness/configure')
  @NeedRoles('quality_manager', 'iqc_manager', 'admin')
  async configureStrictness(
    @Body() body: {
      materialId: string;
      inspectionLevel: string;
      aql: string;
      operatorId?: string;
    },
  ) {
    const result = await this.strictnessService.configure(
      body.materialId,
      body.inspectionLevel,
      body.aql,
      body.operatorId,
    );
    return { code: 0, message: 'success', data: result };
  }

  @Post('strictness/manual-action')
  @NeedRoles('quality_manager', 'iqc_manager', 'admin')
  async manualStrictnessAction(
    @Req() req: Request,
    @Body() body: {
      materialId: string;
      action:
        | 'to_normal'
        | 'to_tightened'
        | 'to_exempt'
        | 'to_reduced_from_exempt'
        | 'to_normal_from_exempt'
        | 'to_tightened_from_exempt'
        | 'to_tightened_from_suspended';
      /** @deprecated 一律取登录态，此字段被忽略（仅为兼容老前端保留） */
      operatorId?: string;
      /** @deprecated 一律取登录态，此字段被忽略（仅为兼容老前端保留） */
      operatorName?: string;
      reason?: string;
      exceptionSource?: string;
    },
  ) {
    // 操作人一律以登录身份为准，忽略请求体传入（防冒名；同时把口径从「账号串」统一为 uuid）
    const operatorId = req.userContext?.userId || '';
    const operatorName = req.userContext?.userName || req.userContext?.account || '';

    let result;
    if (body.action === 'to_normal') {
      result = await this.strictnessService.manualToNormal(
        body.materialId, operatorId, operatorName, body.reason,
      );
    } else if (body.action === 'to_tightened') {
      result = await this.strictnessService.manualToTightened(
        body.materialId, operatorId, operatorName, body.reason,
      );
    } else if (body.action === 'to_exempt') {
      result = await this.strictnessService.manualToExempt(
        body.materialId, operatorId, operatorName, body.reason,
      );
    } else if (body.action === 'to_reduced_from_exempt') {
      result = await this.strictnessService.manualToReducedFromExempt(
        body.materialId, operatorId, operatorName, body.reason,
      );
    } else if (body.action === 'to_normal_from_exempt') {
      result = await this.strictnessService.manualToNormalFromExempt(
        body.materialId, operatorId, operatorName,
        body.exceptionSource || 'unknown', body.reason,
      );
    } else if (body.action === 'to_tightened_from_exempt') {
      result = await this.strictnessService.manualToTightenedFromExempt(
        body.materialId, operatorId, operatorName,
        body.reason, body.exceptionSource,
      );
    } else if (body.action === 'to_tightened_from_suspended') {
      result = await this.strictnessService.manualToTightenedFromSuspended(
        body.materialId, operatorId, operatorName, body.reason,
      );
    }
    return { code: 0, message: 'success', data: result };
  }

  @Get('strictness/current')
  async getCurrentStrictness(@Query('materialId') materialId: string) {
    // 缺参数时直接 400，避免把 undefined 传进 SQL 触发 500
    if (!materialId || materialId === 'undefined' || materialId === 'null') {
      throw new BadRequestException('缺少参数 materialId');
    }
    const result = await this.strictnessService.getCurrentStrictness(materialId);
    return { code: 0, message: 'success', data: result };
  }

  // ===== Import =====

  @Post('templates/import')
  @UseInterceptors(FileInterceptor('file'))
  async importTemplate(
    @UploadedFile() file: any,
    @Req() req: Request,
  ): Promise<{ code: number; message: string; data: IqcTemplateImportResult }> {
    if (!file) throw new BadRequestException('请上传文件');
    if (file.size > 5 * 1024 * 1024) throw new BadRequestException('文件大小不能超过5MB');

    let xlsxModule: any;
    try {
      xlsxModule = await import('xlsx');
    } catch {
      throw new NotImplementedException('导入功能不可用（xlsx 库未安装）');
    }

    const XLSX = xlsxModule.default ?? xlsxModule;
    const workbook = readWorkbook(file.buffer);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    // Extract dimensions
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    const rowCount = range.e.r + 1;
    const colCount = range.e.c + 1;

    // Extract all cells with row/col index and string value
    const cells: { r: number; c: number; v: string }[] = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cellAddress = XLSX.utils.encode_cell({ r, c });
        const cell = worksheet[cellAddress];
        if (cell && cell.v !== undefined && cell.v !== null && cell.v !== '') {
          let v: string;
          if (cell.t === 's') {
            v = cell.v;
          } else if (cell.t === 'n' || cell.t === 'b') {
            v = String(cell.v);
          } else if (cell.t === 'd') {
            v = new Date(cell.v).toISOString();
          } else {
            v = cell.w !== undefined ? cell.w : String(cell.v);
          }
          cells.push({ r, c, v });
        }
      }
    }

    // Extract merges
    const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
    if (worksheet['!merges'] && worksheet['!merges'].length > 0) {
      for (const m of worksheet['!merges']) {
        merges.push({
          s: { r: m.s.r, c: m.s.c },
          e: { r: m.e.r, c: m.e.c },
        });
      }
    }

    // Extract column widths if available
    const colWidths: number[] = [];
    if (worksheet['!cols'] && worksheet['!cols'].length > 0) {
      for (let i = 0; i < colCount; i++) {
        const col = worksheet['!cols'][i];
        colWidths.push(col?.wch ?? col?.width ?? 80);
      }
    }

    const rawData = { cells, merges, colWidths };

    const created = await this.templateService.createFromExcel({
      fileName: file.originalname,
      sheetName: firstSheetName,
      rowCount,
      colCount,
      rawData,
    });

    return {
      code: 0,
      message: 'success',
      data: {
        templateId: created.id,
        templateName: created.templateName,
        rowCount: created.rowCount ?? 0,
        colCount: created.colCount ?? 0,
        sheetName: firstSheetName,
      },
    };
  }
}
