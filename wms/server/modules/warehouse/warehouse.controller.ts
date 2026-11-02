import { Controller, Get, Post, Put, Delete, Param, Query, Body, Req } from '@nestjs/common';
import { NeedLogin } from '../../common/auth/need-login.decorator';
import { NeedRoles } from '../../common/auth/auth.decorator';
import type { Request } from 'express';

import { WarehouseService } from './warehouse.service';
import {
  MasterDataClearService,
  type MasterDataClearPreview,
  type MasterDataClearResult,
} from '../system/master-data-clear.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { CreateLocationDto } from './dto/create-location.dto';
import type {
  Warehouse,
  WarehouseLocation,
  PaginatedResponse,
} from '@shared/api.interface';

@Controller('api/warehouse')
@NeedLogin()
export class WarehouseController {
  constructor(
    private readonly warehouseService: WarehouseService,
    private readonly masterDataClearService: MasterDataClearService,
  ) {}

  // ========== 主数据清空（危险操作，仅系统管理员） ==========

  /**
   * 清空预览：目标表当前行数 + 连带子表 + 是否被其它表引用。
   * 纯读操作，无副作用。
   */
  @NeedRoles('admin')
  @Get('clear/preview')
  async previewClear(@Query('target') target: string): Promise<MasterDataClearPreview> {
    return this.masterDataClearService.preview(target);
  }

  /**
   * 清空仓库档案：连带清空它下级的「仓库地址码档案」。
   * 若地址码已被库存/收货/移库引用，则中止并列出阻挡表。
   */
  @NeedRoles('admin')
  @Post('clear-warehouses')
  async clearWarehouses(
    @Req() req: Request,
    @Body() body: { password?: string; confirmText?: string },
  ): Promise<MasterDataClearResult> {
    return this.masterDataClearService.clear('warehouse', {
      userId: req.userContext?.userId || '',
      password: body.password || '',
      confirmText: body.confirmText || '',
    });
  }

  /** 清空仓库地址码档案 */
  @NeedRoles('admin')
  @Post('clear-locations')
  async clearLocations(
    @Req() req: Request,
    @Body() body: { password?: string; confirmText?: string },
  ): Promise<MasterDataClearResult> {
    return this.masterDataClearService.clear('location', {
      userId: req.userContext?.userId || '',
      password: body.password || '',
      confirmText: body.confirmText || '',
    });
  }

  // ========== Warehouse ==========

  // includeInactive=1 时返回系统全部仓库（含停用），供查询筛选类下拉使用
  @Get('all')
  async getAllWarehouses(
    @Query('includeInactive') includeInactive?: string,
  ): Promise<Warehouse[]> {
    return this.warehouseService.getAllActiveWarehouses(
      includeInactive === '1' || includeInactive === 'true',
    );
  }

  // 专用 list 路由必须注册在动态 :id 路由之前，
  // 否则 GET /api/warehouse/list 会被 :id 捕获并按 UUID 查询导致 500
  @Get('list')
  async listWarehouses(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('whCode') whCode?: string,
    @Query('whName') whName?: string,
    @Query('status') status?: string,
  ): Promise<PaginatedResponse<Warehouse>> {
    return this.warehouseService.getWarehouseList({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      whCode,
      whName,
      status,
    });
  }

  @Get()
  async getWarehouseList(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('whCode') whCode?: string,
    @Query('whName') whName?: string,
    @Query('status') status?: string,
  ): Promise<PaginatedResponse<Warehouse>> {
    return this.warehouseService.getWarehouseList({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      whCode,
      whName,
      status,
    });
  }

  @NeedRoles('wh_manager', 'admin')
  @Post()
  async createWarehouse(@Body() body: CreateWarehouseDto): Promise<Warehouse> {
    // BUG-001 修复：走 DTO 做必填校验，缺 whCode/whNameZh 时由全局 ValidationPipe
    // 直接返回 400 + 中文字段级提示，不再穿透到数据库撞非空约束抛 500。
    // 断言仅用于抹平「DTO 只声明必填字段」与领域接口可选性之间的类型差异，运行时不变。
    return this.warehouseService.createWarehouse(body as unknown as Omit<Warehouse, 'id'>);
  }

  // ========== Warehouse Location ==========

  @Get('location/all')
  async getAllLocations(): Promise<WarehouseLocation[]> {
    return this.warehouseService.getAllActiveLocations();
  }

  @Get('location')
  async getLocationList(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('locationCode') locationCode?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('locationType') locationType?: string,
    @Query('status') status?: string,
  ): Promise<PaginatedResponse<WarehouseLocation>> {
    return this.warehouseService.getLocationList({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      locationCode,
      warehouseId,
      locationType,
      status,
    });
  }

  @Get('location/:id')
  async getLocation(@Param('id') id: string): Promise<WarehouseLocation> {
    return this.warehouseService.getLocationById(id);
  }

  @NeedRoles('wh_manager', 'admin')
  @Post('location')
  async createLocation(
    @Body() body: CreateLocationDto,
  ): Promise<WarehouseLocation> {
    // 同 BUG-001：缺 locationCode / warehouseId 时返回 400 而不是 500
    return this.warehouseService.createLocation(
      body as unknown as Omit<WarehouseLocation, 'id' | 'warehouseName'>,
    );
  }

  @NeedRoles('wh_manager', 'admin')
  @Put('location/:id')
  async updateLocation(
    @Param('id') id: string,
    @Body() body: Partial<Omit<WarehouseLocation, 'id' | 'warehouseName'>>,
  ): Promise<WarehouseLocation> {
    return this.warehouseService.updateLocation(id, body);
  }

  @NeedRoles('wh_manager', 'admin')
  @Delete('location/:id')
  async deleteLocation(@Param('id') id: string): Promise<void> {
    return this.warehouseService.deleteLocation(id);
  }

  // ========== Warehouse detail (dynamic route must be last) ==========

  @Get(':id')
  async getWarehouse(@Param('id') id: string): Promise<Warehouse> {
    return this.warehouseService.getWarehouseById(id);
  }

  @NeedRoles('wh_manager', 'admin')
  @Put(':id')
  async updateWarehouse(
    @Param('id') id: string,
    @Body() body: Partial<Omit<Warehouse, 'id'>>,
  ): Promise<Warehouse> {
    return this.warehouseService.updateWarehouse(id, body);
  }

  @NeedRoles('wh_manager', 'admin')
  @Delete(':id')
  async deleteWarehouse(@Param('id') id: string): Promise<void> {
    return this.warehouseService.deleteWarehouse(id);
  }
}
