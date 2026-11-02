import { Inject, Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { eq, and, like, ilike, desc, count, gt } from 'drizzle-orm';

import { warehouse, warehouseLocation, inventory } from '@server/database/schema';
import type { Warehouse, WarehouseLocation, PaginatedResponse } from '@shared/api.interface';

interface WarehouseQuery {
  page: number;
  pageSize: number;
  whCode?: string;
  whName?: string;
  status?: string;
}

interface LocationQuery {
  page: number;
  pageSize: number;
  locationCode?: string;
  warehouseId?: string;
  locationType?: string;
  status?: string;
}

@Injectable()
export class WarehouseService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  // ========== Warehouse ==========

  async getWarehouseList(query: WarehouseQuery): Promise<PaginatedResponse<Warehouse>> {
    const { page, pageSize, whCode, whName, status } = query;
    const conditions = [];
    if (whCode) conditions.push(ilike(warehouse.whCode, `%${whCode}%`));
    if (whName) conditions.push(ilike(warehouse.whNameZh, `%${whName}%`));
    if (status) conditions.push(eq(warehouse.status, status));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;

    const [itemsResult, countResult] = await Promise.all([
      this.db
        .select()
        .from(warehouse)
        .where(whereClause)
        .orderBy(desc(warehouse.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(warehouse)
        .where(whereClause),
    ]);

    const items: Warehouse[] = itemsResult.map((row) => ({
      id: row.id,
      whCode: row.whCode,
      whNameZh: row.whNameZh,
      whNameVi: row.whNameVi ?? undefined,
      whNameEn: row.whNameEn ?? undefined,
      whType: row.whType,
      status: row.status,
      address: row.address ?? undefined,
      description: row.description ?? undefined,
    }));

    return {
      items,
      total: Number(countResult[0]?.count ?? 0),
      page,
      pageSize,
    };
  }

  /**
   * 仓库列表。
   * @param includeInactive 传 true 时返回系统全部仓库（含已停用），供「查询筛选」类下拉使用，
   *   避免列表里出现了停用仓库的数据却无法按该仓库筛选；默认 false 只返回启用仓库，
   *   供「业务录入」类下拉使用（不允许把业务单据录到已停用的仓库上）。
   */
  async getAllActiveWarehouses(includeInactive = false): Promise<Warehouse[]> {
    const rows = await this.db
      .select()
      .from(warehouse)
      .where(includeInactive ? undefined : eq(warehouse.status, 'active'))
      .orderBy(warehouse.whCode);
    return rows.map((row) => ({
      id: row.id,
      whCode: row.whCode,
      whNameZh: row.whNameZh,
      whNameVi: row.whNameVi ?? undefined,
      whNameEn: row.whNameEn ?? undefined,
      whType: row.whType,
      status: row.status,
      address: row.address ?? undefined,
      description: row.description ?? undefined,
    }));
  }

  async getWarehouseById(id: string): Promise<Warehouse> {
    const rows = await this.db.select().from(warehouse).where(eq(warehouse.id, id)).limit(1);
    if (rows.length === 0) {
      throw new NotFoundException('仓库不存在');
    }
    const row = rows[0];
    return {
      id: row.id,
      whCode: row.whCode,
      whNameZh: row.whNameZh,
      whNameVi: row.whNameVi ?? undefined,
      whNameEn: row.whNameEn ?? undefined,
      whType: row.whType,
      status: row.status,
      address: row.address ?? undefined,
      description: row.description ?? undefined,
    };
  }

  // 校验仓库代码不能包含汉字
  private validateWhCode(whCode?: string) {
    if (whCode && /[\u4e00-\u9fa5]/.test(whCode)) {
      throw new BadRequestException('仓库代码不能包含汉字，只能使用字母、数字或符号');
    }
  }

  async createWarehouse(data: Omit<Warehouse, 'id'>): Promise<Warehouse> {
    this.validateWhCode(data.whCode);
    const rows = await this.db
      .insert(warehouse)
      .values({
        whCode: data.whCode,
        whNameZh: data.whNameZh,
        whNameVi: data.whNameVi,
        whNameEn: data.whNameEn,
        whType: data.whType,
        status: data.status,
        address: data.address,
        description: data.description,
      })
      .returning();
    const row = rows[0];
    return {
      id: row.id,
      whCode: row.whCode,
      whNameZh: row.whNameZh,
      whNameVi: row.whNameVi ?? undefined,
      whNameEn: row.whNameEn ?? undefined,
      whType: row.whType,
      status: row.status,
      address: row.address ?? undefined,
      description: row.description ?? undefined,
    };
  }

  async updateWarehouse(id: string, data: Partial<Omit<Warehouse, 'id'>>): Promise<Warehouse> {
    this.validateWhCode(data.whCode);
    const patch: Partial<typeof warehouse.$inferInsert> = {};
    if (data.whCode !== undefined) patch.whCode = data.whCode;
    if (data.whNameZh !== undefined) patch.whNameZh = data.whNameZh;
    if (data.whNameVi !== undefined) patch.whNameVi = data.whNameVi;
    if (data.whNameEn !== undefined) patch.whNameEn = data.whNameEn;
    if (data.whType !== undefined) patch.whType = data.whType;
    if (data.status !== undefined) patch.status = data.status;
    if (data.address !== undefined) patch.address = data.address;
    if (data.description !== undefined) patch.description = data.description;

    // 空更新体兜底：drizzle 的 `.set({})` 会抛 `Error: No values to set`（普通 Error），
    // 被全局过滤器当成未处理异常 → 500。语义上「没有任何待更新字段」属调用方问题，应为 400。
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('没有需要更新的字段');
    }

    const rows = await this.db
      .update(warehouse)
      .set(patch)
      .where(eq(warehouse.id, id))
      .returning();
    if (rows.length === 0) {
      throw new NotFoundException('仓库不存在');
    }
    const row = rows[0];
    return {
      id: row.id,
      whCode: row.whCode,
      whNameZh: row.whNameZh,
      whNameVi: row.whNameVi ?? undefined,
      whNameEn: row.whNameEn ?? undefined,
      whType: row.whType,
      status: row.status,
      address: row.address ?? undefined,
      description: row.description ?? undefined,
    };
  }

  async deleteWarehouse(id: string): Promise<void> {
    const existing = await this.db.select().from(warehouse).where(eq(warehouse.id, id)).limit(1);
    if (existing.length === 0) {
      throw new NotFoundException('仓库不存在');
    }
    await this.db.transaction(async (tx) => {
      const stockResult = await tx
        .select({ count: count() })
        .from(inventory)
        .innerJoin(warehouseLocation, eq(inventory.locationId, warehouseLocation.id))
        .where(and(eq(warehouseLocation.warehouseId, id), gt(inventory.quantity, '0')));
      if (Number(stockResult[0]?.count ?? 0) > 0) {
        throw new ConflictException('该仓库还有物料库存，请先清空库存后再删除');
      }
      await tx.delete(warehouseLocation).where(eq(warehouseLocation.warehouseId, id));
      await tx.delete(warehouse).where(eq(warehouse.id, id));
    });
  }

  // ========== Warehouse Location ==========

  async getLocationList(query: LocationQuery): Promise<PaginatedResponse<WarehouseLocation>> {
    const { page, pageSize, locationCode, warehouseId, locationType, status } = query;
    const conditions = [];
    if (locationCode) conditions.push(ilike(warehouseLocation.locationCode, `%${locationCode}%`));
    if (warehouseId) conditions.push(eq(warehouseLocation.warehouseId, warehouseId));
    if (locationType) conditions.push(eq(warehouseLocation.locationType, locationType));
    if (status) conditions.push(eq(warehouseLocation.status, status));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;

    const [itemsResult, countResult] = await Promise.all([
      this.db
        .select({
          id: warehouseLocation.id,
          locationCode: warehouseLocation.locationCode,
          warehouseId: warehouseLocation.warehouseId,
          areaCode: warehouseLocation.areaCode,
          shelfCode: warehouseLocation.shelfCode,
          layerCode: warehouseLocation.layerCode,
          positionCode: warehouseLocation.positionCode,
          locationType: warehouseLocation.locationType,
          status: warehouseLocation.status,
          warehouseName: warehouse.whNameZh,
        })
        .from(warehouseLocation)
        .leftJoin(warehouse, eq(warehouseLocation.warehouseId, warehouse.id))
        .where(whereClause)
        .orderBy(desc(warehouseLocation.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(warehouseLocation)
        .where(whereClause),
    ]);

    const items: WarehouseLocation[] = itemsResult.map((row) => ({
      id: row.id,
      locationCode: row.locationCode,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName ?? undefined,
      areaCode: row.areaCode ?? undefined,
      shelfCode: row.shelfCode ?? undefined,
      layerCode: row.layerCode ?? undefined,
      positionCode: row.positionCode ?? undefined,
      locationType: row.locationType,
      status: row.status,
    }));

    return {
      items,
      total: Number(countResult[0]?.count ?? 0),
      page,
      pageSize,
    };
  }

  async getAllActiveLocations(): Promise<WarehouseLocation[]> {
    const rows = await this.db
      .select({
        id: warehouseLocation.id,
        locationCode: warehouseLocation.locationCode,
        warehouseId: warehouseLocation.warehouseId,
        areaCode: warehouseLocation.areaCode,
        shelfCode: warehouseLocation.shelfCode,
        layerCode: warehouseLocation.layerCode,
        positionCode: warehouseLocation.positionCode,
        locationType: warehouseLocation.locationType,
        status: warehouseLocation.status,
        warehouseName: warehouse.whNameZh,
      })
      .from(warehouseLocation)
      .leftJoin(warehouse, eq(warehouseLocation.warehouseId, warehouse.id))
      .where(eq(warehouseLocation.status, 'active'))
      .orderBy(warehouseLocation.locationCode);

    return rows.map((row) => ({
      id: row.id,
      locationCode: row.locationCode,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName ?? undefined,
      areaCode: row.areaCode ?? undefined,
      shelfCode: row.shelfCode ?? undefined,
      layerCode: row.layerCode ?? undefined,
      positionCode: row.positionCode ?? undefined,
      locationType: row.locationType,
      status: row.status,
    }));
  }

  async getLocationById(id: string): Promise<WarehouseLocation> {
    const rows = await this.db
      .select({
        id: warehouseLocation.id,
        locationCode: warehouseLocation.locationCode,
        warehouseId: warehouseLocation.warehouseId,
        areaCode: warehouseLocation.areaCode,
        shelfCode: warehouseLocation.shelfCode,
        layerCode: warehouseLocation.layerCode,
        positionCode: warehouseLocation.positionCode,
        locationType: warehouseLocation.locationType,
        status: warehouseLocation.status,
        description: warehouseLocation.description,
        warehouseName: warehouse.whNameZh,
      })
      .from(warehouseLocation)
      .leftJoin(warehouse, eq(warehouseLocation.warehouseId, warehouse.id))
      .where(eq(warehouseLocation.id, id))
      .limit(1);
    if (rows.length === 0) {
      throw new NotFoundException('库位不存在');
    }
    const row = rows[0];
    return {
      id: row.id,
      locationCode: row.locationCode,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName ?? undefined,
      areaCode: row.areaCode ?? undefined,
      shelfCode: row.shelfCode ?? undefined,
      layerCode: row.layerCode ?? undefined,
      positionCode: row.positionCode ?? undefined,
      locationType: row.locationType,
      status: row.status,
      description: row.description ?? undefined,
    };
  }

  // 校验地址码相关字段不能包含汉字
  private validateLocationCodes(data: Partial<{ locationCode: string; areaCode: string; shelfCode: string; layerCode: string; positionCode: string }>) {
    const chineseRegex = /[\u4e00-\u9fa5]/;
    const fields: [string, string][] = [
      ['locationCode', '库位编码'],
      ['areaCode', '区域码'],
      ['shelfCode', '货架码'],
      ['layerCode', '层码'],
      ['positionCode', '位码'],
    ];
    for (const [key, label] of fields) {
      const val = data[key as keyof typeof data];
      if (val && chineseRegex.test(val)) {
        throw new BadRequestException(`${label}不能包含汉字，只能使用字母、数字或符号`);
      }
    }
  }

  async createLocation(data: Omit<WarehouseLocation, 'id' | 'warehouseName'>): Promise<WarehouseLocation> {
    this.validateLocationCodes(data);
    const rows = await this.db
      .insert(warehouseLocation)
      .values({
        locationCode: data.locationCode,
        warehouseId: data.warehouseId,
        areaCode: data.areaCode,
        shelfCode: data.shelfCode,
        layerCode: data.layerCode,
        positionCode: data.positionCode,
        locationType: data.locationType,
        status: data.status,
      })
      .returning();
    const row = rows[0];
    return this.getLocationById(row.id);
  }

  async updateLocation(
    id: string,
    data: Partial<Omit<WarehouseLocation, 'id' | 'warehouseName'>>,
  ): Promise<WarehouseLocation> {
    this.validateLocationCodes(data);
    const patch: Partial<typeof warehouseLocation.$inferInsert> = {};
    if (data.locationCode !== undefined) patch.locationCode = data.locationCode;
    if (data.warehouseId !== undefined) patch.warehouseId = data.warehouseId;
    if (data.areaCode !== undefined) patch.areaCode = data.areaCode;
    if (data.shelfCode !== undefined) patch.shelfCode = data.shelfCode;
    if (data.layerCode !== undefined) patch.layerCode = data.layerCode;
    if (data.positionCode !== undefined) patch.positionCode = data.positionCode;
    if (data.locationType !== undefined) patch.locationType = data.locationType;
    if (data.status !== undefined) patch.status = data.status;
    if (data.description !== undefined) patch.description = data.description;

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('没有需要更新的字段');
    }

    const rows = await this.db
      .update(warehouseLocation)
      .set(patch)
      .where(eq(warehouseLocation.id, id))
      .returning({ id: warehouseLocation.id });
    if (rows.length === 0) {
      throw new NotFoundException('库位不存在');
    }
    return this.getLocationById(id);
  }

  async deleteLocation(id: string): Promise<void> {
    const rows = await this.db
      .delete(warehouseLocation)
      .where(eq(warehouseLocation.id, id))
      .returning({ id: warehouseLocation.id });
    if (rows.length === 0) {
      throw new NotFoundException('库位不存在');
    }
  }
}
