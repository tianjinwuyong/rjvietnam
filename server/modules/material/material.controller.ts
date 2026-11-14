import { Controller, Get, Post, Put, Delete, Param, Query, Body, Req, BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { NeedLogin } from '../../common/auth/need-login.decorator';
import { NeedRoles } from '../../common/auth/auth.decorator';

import { MaterialService } from './material.service';
import {
  MasterDataClearService,
  type MasterDataClearPreview,
  type MasterDataClearResult,
} from '../system/master-data-clear.service';
import { CreateMaterialDto } from './dto/create-material.dto';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import type {
  Material,
  Supplier,
  PaginatedResponse,
  MaterialImportPreviewResult,
  SupplierImportPreviewResult,
} from '@shared/api.interface';

@Controller('api/material')
@NeedLogin()
export class MaterialController {
  constructor(
    private readonly materialService: MaterialService,
    private readonly masterDataClearService: MasterDataClearService,
  ) {}

  // ========== 主数据清空（危险操作，仅系统管理员） ==========

  /**
   * 清空预览：目标表当前行数 + 是否被其它表引用。
   * 纯读操作，无副作用；界面据此展示「将清空多少 / 会不会被拦住」。
   */
  @NeedRoles('admin')
  @Get('clear/preview')
  async previewClear(@Query('target') target: string): Promise<MasterDataClearPreview> {
    return this.masterDataClearService.preview(target);
  }

  /**
   * 清空物料主数据 / 供应商档案 / 替代关系。
   * 身份取登录态，服务层重验密码哈希；被外键引用时中止并列出阻挡表。
   */
  @NeedRoles('admin')
  @Post('clear-materials')
  async clearMaterials(
    @Req() req: Request,
    @Body() body: { password?: string; confirmText?: string },
  ): Promise<MasterDataClearResult> {
    return this.masterDataClearService.clear('material', {
      userId: req.userContext?.userId || '',
      password: body.password || '',
      confirmText: body.confirmText || '',
    });
  }

  @NeedRoles('admin')
  @Post('clear-suppliers')
  async clearSuppliers(
    @Req() req: Request,
    @Body() body: { password?: string; confirmText?: string },
  ): Promise<MasterDataClearResult> {
    return this.masterDataClearService.clear('supplier', {
      userId: req.userContext?.userId || '',
      password: body.password || '',
      confirmText: body.confirmText || '',
    });
  }

  @NeedRoles('admin')
  @Post('clear-substitutions')
  async clearSubstitutions(
    @Req() req: Request,
    @Body() body: { password?: string; confirmText?: string },
  ): Promise<MasterDataClearResult> {
    return this.masterDataClearService.clear('substitution', {
      userId: req.userContext?.userId || '',
      password: body.password || '',
      confirmText: body.confirmText || '',
    });
  }

  // ========== Material ==========

  /**
   * 物料导入**预检**：只解析并比对，不写库。
   * 前端先展示「新增 / 更新 / 名称冲突 / 将归档」，用户确认后再调 POST import。
   */
  @Post('import/preview')
  async previewImport(@Body() body: { fileBase64: string }): Promise<MaterialImportPreviewResult> {
    if (!body?.fileBase64) {
      throw new BadRequestException('未接收到上传的文件数据');
    }
    const buffer = Buffer.from(body.fileBase64, 'base64');
    const outcome = await this.materialService.batchImportExcel(buffer, '', '', { dryRun: true });
    return (
      outcome.preview ?? {
        totalRows: 0,
        validRows: 0,
        errorRows: 0,
        errors: outcome.errors,
        created: [],
        updated: [],
        unchangedCount: 0,
        supplierNameConflicts: [],
        newSuppliers: [],
        archivedMaterials: [],
      }
    );
  }

  @Post('import')
  async batchImport(
    @Req() req: Request,
    @Body() body: { fileBase64: string; applySupplierNameChanges?: boolean },
  ): Promise<{
    successCount: number;
    errorCount: number;
    errors: string[];
    totalRows: number;
    removedCount: number;
    nameChanges: { supplierCode: string; oldName: string; newName: string }[];
    backupFile?: string;
  }> {
    if (!body?.fileBase64) {
      throw new BadRequestException('未接收到上传的文件数据');
    }
    const buffer = Buffer.from(body.fileBase64, 'base64');
    return this.materialService.batchImportExcel(
      buffer,
      req.userContext?.userId || '',
      req.userContext?.account || '',
      {
        applySupplierNameChanges: body.applySupplierNameChanges === true,
      },
    );
  }

  @Get('all')
  async getAllMaterials(): Promise<Material[]> {
    return this.materialService.getAllActiveMaterials();
  }

  @Get()
  async getMaterialList(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('materialCode') materialCode?: string,
    @Query('materialName') materialName?: string,
    @Query('materialType') materialType?: string,
    @Query('packagingType') packagingType?: string,
    @Query('status') status?: string,
  ): Promise<PaginatedResponse<Material>> {
    return this.materialService.getMaterialList({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      materialCode,
      materialName,
      materialType,
      packagingType,
      status,
    });
  }

  // ========== Supplier ==========

  /**
   * 供应商列表（下拉选择用）。includeArchived=true 时连已归档的一起返回，
   * 避免导入一份不完整的 Excel 后，其余供应商在界面上"凭空消失"。
   */
  @Get('supplier/all')
  async getAllSuppliers(@Query('includeArchived') includeArchived?: string): Promise<Supplier[]> {
    return this.materialService.getAllActiveSuppliers(includeArchived === 'true');
  }

  /**
   * 供应商导入**预检**：只解析并比对，不写库。
   */
  @Post('supplier/import/preview')
  async previewSupplierImport(
    @Body() body: { fileBase64: string },
  ): Promise<SupplierImportPreviewResult> {
    if (!body?.fileBase64) {
      throw new BadRequestException('未接收到上传的文件数据');
    }
    const buffer = Buffer.from(body.fileBase64, 'base64');
    const outcome = await this.materialService.batchImportSuppliers(buffer, '', '', { dryRun: true });
    return (
      outcome.preview ?? {
        totalRows: 0,
        validRows: 0,
        errorRows: 0,
        errors: outcome.errors,
        created: [],
        updated: [],
        unchangedCount: 0,
        nameConflicts: [],
        archivedSuppliers: [],
      }
    );
  }

  @Post('supplier/import')
  async batchImportSuppliers(
    @Req() req: Request,
    @Body() body: { fileBase64: string; applySupplierNameChanges?: boolean },
  ): Promise<{
    successCount: number;
    errorCount: number;
    errors: string[];
    totalRows: number;
    removedCount: number;
    nameChanges: { supplierCode: string; oldName: string; newName: string }[];
    backupFile?: string;
  }> {
    if (!body?.fileBase64) {
      throw new BadRequestException('未接收到上传的文件数据');
    }
    const buffer = Buffer.from(body.fileBase64, 'base64');
    return this.materialService.batchImportSuppliers(
      buffer,
      req.userContext?.userId || '',
      req.userContext?.account || '',
      {
        applySupplierNameChanges: body.applySupplierNameChanges === true,
      },
    );
  }

  @Get('supplier')
  async getSupplierList(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('supplierCode') supplierCode?: string,
    @Query('supplierName') supplierName?: string,
    @Query('status') status?: string,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<PaginatedResponse<Supplier>> {
    return this.materialService.getSupplierList({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      supplierCode,
      supplierName,
      status,
      includeArchived: includeArchived === 'true',
    });
  }

  @Get('supplier/:id')
  async getSupplier(@Param('id') id: string): Promise<Supplier> {
    return this.materialService.getSupplierById(id);
  }

  @Post('supplier')
  async createSupplier(@Body() body: CreateSupplierDto): Promise<Supplier> {
    // BUG-002 同类：缺 supplierCode / supplierName 时返回 400，不再 500
    return this.materialService.createSupplier(body as unknown as Omit<Supplier, 'id'>);
  }

  @Put('supplier/:id')
  async updateSupplier(
    @Param('id') id: string,
    @Body() body: Partial<Omit<Supplier, 'id'>>,
  ): Promise<Supplier> {
    return this.materialService.updateSupplier(id, body);
  }

  @Delete('supplier/:id')
  async deleteSupplier(@Param('id') id: string): Promise<void> {
    return this.materialService.deleteSupplier(id);
  }

  @Get(':id')
  async getMaterial(@Param('id') id: string): Promise<Material> {
    return this.materialService.getMaterialById(id);
  }

  @Post()
  async createMaterial(@Body() body: CreateMaterialDto): Promise<Material> {
    // BUG-002 修复：走 DTO 做必填校验，缺 materialCode / materialName 时由全局 ValidationPipe
    // 返回 400 + 中文字段级提示；重复 materialCode 由唯一约束兜底映射为 409。
    return this.materialService.createMaterial(body as unknown as Omit<Material, 'id'>);
  }

  @Put(':id')
  async updateMaterial(
    @Param('id') id: string,
    @Body() body: Partial<Omit<Material, 'id'>>,
  ): Promise<Material> {
    return this.materialService.updateMaterial(id, body);
  }

  @Delete(':id')
  async deleteMaterial(@Param('id') id: string): Promise<void> {
    return this.materialService.deleteMaterial(id);
  }
}
