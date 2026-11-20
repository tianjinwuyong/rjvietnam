import { Inject, Injectable, BadRequestException, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { eq, and, ilike, desc, count } from 'drizzle-orm';
import {
  bom,
  bomItem,
  workOrder,
} from '@server/database/schema';
import type { Bom, BomItem, PaginatedResponse } from '@shared/api.interface';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(value: string | undefined | null): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

interface BomItemInput {
  materialId?: string;
  materialCode: string;
  vietnamCode?: string;
  materialName: string;
  specification?: string;
  unit: string;
  quantity: number;
  workSection: string;
  sortOrder: number;
  remark?: string;
}

/** 列宽上限（与数据库 varchar 长度保持一致，提前拦截避免数据库报 22P01/22001） */
const UNIT_MAX = 20;
const WORK_SECTION_MAX = 20;
const MATERIAL_CODE_MAX = 100;
const MATERIAL_NAME_MAX = 200;

@Injectable()
export class BomService {
  private readonly logger = new Logger(BomService.name);

  /**
   * 校验并规范化 BOM 明细
   * ---------------------------------------------------------------------------
   * 之前这里直接把前端传来的值拼进 insert：Excel 里「用量」列混入位号（RS5、R25…）
   * 这类文本时，数据库会抛 `invalid input syntax for type numeric`，
   * 前端只显示一大段 SQL，用户完全看不出是哪一行的问题。
   *
   * 现在统一在写库前逐行校验，把问题定位到「第 N 行 + 物料编码 + 实际值」，
   * 一次把所有错误返回，避免用户改一个保存一次。
   */
  private normalizeItems(items: BomItemInput[]): Array<BomItemInput & { quantity: number }> {
    const errors: string[] = [];

    const normalized = items.map((item, idx) => {
      const line = idx + 1;
      const code = String(item?.materialCode ?? '').trim();
      const label = code ? `第 ${line} 行（物料 ${code}）` : `第 ${line} 行`;

      if (!code) {
        errors.push(`第 ${line} 行：物料编码不能为空`);
      } else if (code.length > MATERIAL_CODE_MAX) {
        errors.push(`${label}：物料编码超过 ${MATERIAL_CODE_MAX} 个字符`);
      }

      const rawQty: any = (item as any)?.quantity;
      const qty = typeof rawQty === 'string' ? Number(rawQty.trim()) : Number(rawQty);
      if (rawQty === null || rawQty === undefined || rawQty === '' || !Number.isFinite(qty)) {
        errors.push(`${label}：用量必须是数字，当前值「${rawQty ?? ''}」`);
      } else if (qty <= 0) {
        errors.push(`${label}：用量必须大于 0，当前值「${rawQty}」`);
      }

      const name = String(item?.materialName ?? '').trim() || code;
      if (name.length > MATERIAL_NAME_MAX) {
        errors.push(`${label}：物料名称超过 ${MATERIAL_NAME_MAX} 个字符`);
      }

      const unit = String(item?.unit ?? '').trim() || 'PCS';
      if (unit.length > UNIT_MAX) {
        errors.push(`${label}：单位「${unit}」超过 ${UNIT_MAX} 个字符（该列可能串到了规格/位号）`);
      }

      const workSection = String(item?.workSection ?? '').trim() || 'smt';
      if (workSection.length > WORK_SECTION_MAX) {
        errors.push(
          `${label}：工段「${workSection.slice(0, 24)}…」超过 ${WORK_SECTION_MAX} 个字符` +
            `（该列可能填成了位号/规格）`,
        );
      }

      return {
        ...item,
        materialCode: code,
        materialName: name,
        unit,
        workSection,
        quantity: Number.isFinite(qty) ? qty : NaN,
        sortOrder: Number(item?.sortOrder),
      };
    });

    if (errors.length > 0) {
      const head = errors.slice(0, 5).join('；');
      const more = errors.length > 5 ? `；另有 ${errors.length - 5} 处问题` : '';
      throw new BadRequestException(`BOM 明细校验失败：${head}${more}`);
    }

    return normalized as Array<BomItemInput & { quantity: number }>;
  }

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async getBomList(params: {
    page: number;
    pageSize: number;
    bomCode?: string;
    productCode?: string;
    productName?: string;
    status?: string;
  }): Promise<PaginatedResponse<Bom>> {
    const { page, pageSize, bomCode, productCode, productName, status } = params;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (bomCode) conditions.push(ilike(bom.bomCode, `%${bomCode}%`));
    if (productCode) conditions.push(ilike(bom.productCode, `%${productCode}%`));
    if (productName) conditions.push(ilike(bom.productName, `%${productName}%`));
    if (status) conditions.push(eq(bom.status, status));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, items] = await Promise.all([
      this.db.select({ count: count() }).from(bom).where(whereClause),
      this.db
        .select()
        .from(bom)
        .where(whereClause)
        .orderBy(desc(bom.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      items: items.map((item) => ({
        id: item.id,
        bomCode: item.bomCode,
        productCode: item.productCode,
        productName: item.productName,
        version: item.version || 'V1.0',
        status: item.status,
        description: item.description ?? undefined,
      })),
      total,
      page,
      pageSize,
    };
  }

  async getBomDetail(id: string): Promise<Bom & { items: BomItem[] }> {
    const bomResult = await this.db.select().from(bom).where(eq(bom.id, id)).limit(1);
    if (bomResult.length === 0) throw new NotFoundException('BOM不存在');

    const items = await this.db
      .select()
      .from(bomItem)
      .where(eq(bomItem.bomId, id))
      .orderBy(bomItem.sortOrder, bomItem.createdAt);

    const b = bomResult[0];
    return {
      id: b.id,
      bomCode: b.bomCode,
      productCode: b.productCode,
      productName: b.productName,
      version: b.version || 'V1.0',
      status: b.status,
      description: b.description ?? undefined,
      items: items.map((item) => ({
        id: item.id,
        bomId: item.bomId,
        materialId: item.materialId ?? undefined,
        materialCode: item.materialCode,
        vietnamCode: item.vietnamCode ?? undefined,
        materialName: item.materialName,
        specification: item.specification ?? undefined,
        unit: item.unit,
        quantity: Number(item.quantity),
        workSection: item.workSection,
        sortOrder: item.sortOrder ?? 0,
        remark: item.remark ?? undefined,
      })),
    };
  }

  async createBom(body: {
    bomCode: string;
    productCode: string;
    productName: string;
    version?: string;
    description?: string;
    items: BomItemInput[];
  }): Promise<Bom & { items: BomItem[] }> {
    const { bomCode, productCode, productName, version, description, items } = body;

    if (!items || items.length === 0) {
      throw new BadRequestException('BOM子项不能为空');
    }

    // 写库前逐行校验（用量必须是数字、单位/工段不超长等），避免数据库原始报错直接抛给用户
    const safeItems = this.normalizeItems(items);

    const existing = await this.db.select().from(bom).where(eq(bom.bomCode, bomCode)).limit(1);
    if (existing.length > 0) {
      throw new ConflictException('BOM编码已存在');
    }

    const created = await this.db.transaction(async (tx) => {
      const [newBom] = await tx.insert(bom).values({
        bomCode,
        productCode,
        productName,
        version: version || 'V1.0',
        description,
        status: 'active',
      }).returning();

       const bomItems = safeItems.map((item, idx: number) => ({
         bomId: newBom.id,
         materialId: isValidUuid(item.materialId) ? item.materialId : undefined,
         materialCode: item.materialCode,
        vietnamCode: item.vietnamCode,
        materialName: item.materialName,
        specification: item.specification,
        unit: item.unit,
        quantity: String(item.quantity),
        workSection: item.workSection,
        sortOrder: Number.isFinite(item.sortOrder) ? item.sortOrder : idx,
        remark: item.remark,
      }));

      await tx.insert(bomItem).values(bomItems);

      return newBom;
    });

    return this.getBomDetail(created.id);
  }

  async updateBom(id: string, body: {
    bomCode?: string;
    productCode?: string;
    productName?: string;
    version?: string;
    description?: string;
    status?: string;
    items?: BomItemInput[];
  }): Promise<Bom & { items: BomItem[] }> {
    const existing = await this.db.select().from(bom).where(eq(bom.id, id)).limit(1);
    if (existing.length === 0) throw new NotFoundException('BOM不存在');

    const patch: Partial<typeof bom.$inferInsert> = {};
    if (body.bomCode !== undefined) patch.bomCode = body.bomCode;
    if (body.productCode !== undefined) patch.productCode = body.productCode;
    if (body.productName !== undefined) patch.productName = body.productName;
    if (body.version !== undefined) patch.version = body.version;
    if (body.description !== undefined) patch.description = body.description;
    if (body.status !== undefined) patch.status = body.status;

    if (body.bomCode && body.bomCode !== existing[0].bomCode) {
      const dup = await this.db.select().from(bom).where(and(
        eq(bom.bomCode, body.bomCode),
      )).limit(1);
      if (dup.length > 0) throw new ConflictException('BOM编码已存在');
    }

    // 明细整体替换前同样逐行校验，避免半途数据库报错
    const safeItems = body.items && body.items.length > 0 ? this.normalizeItems(body.items) : [];

    await this.db.transaction(async (tx) => {
      if (Object.keys(patch).length > 0) {
        await tx.update(bom).set(patch).where(eq(bom.id, id));
      }

      if (body.items !== undefined) {
        await tx.delete(bomItem).where(eq(bomItem.bomId, id));
        if (body.items.length > 0) {
           const bomItems = safeItems.map((item, idx: number) => ({
             bomId: id,
             materialId: isValidUuid(item.materialId) ? item.materialId : undefined,
             materialCode: item.materialCode,
            vietnamCode: item.vietnamCode,
            materialName: item.materialName,
            specification: item.specification,
            unit: item.unit,
            quantity: String(item.quantity),
            workSection: item.workSection,
            sortOrder: Number.isFinite(item.sortOrder) ? item.sortOrder : idx,
            remark: item.remark,
          }));
          await tx.insert(bomItem).values(bomItems);
        }
      }
    });

    return this.getBomDetail(id);
  }

  async deleteBom(id: string): Promise<{ success: boolean }> {
    // 硬删除：被工单引用的 BOM 不允许删除，提示改用停用
    const [ref] = await this.db
      .select({ cnt: count() })
      .from(workOrder)
      .where(eq(workOrder.bomId, id));
    if (Number(ref?.cnt ?? 0) > 0) {
      throw new ConflictException('该BOM已被工单引用，不可删除；如需保留历史数据请使用停用');
    }

    const deleted = await this.db.delete(bom)
      .where(eq(bom.id, id))
      .returning({ id: bom.id });

    if (deleted.length === 0) throw new NotFoundException('BOM不存在');
    return { success: true };
  }

  /** 启用/停用 BOM（软开关，不删数据） */
  async updateBomStatus(id: string, status: 'active' | 'inactive'): Promise<{ success: boolean }> {
    if (status !== 'active' && status !== 'inactive') {
      throw new BadRequestException('无效的状态值');
    }
    const updated = await this.db.update(bom)
      .set({ status })
      .where(eq(bom.id, id))
      .returning({ id: bom.id });

    if (updated.length === 0) throw new NotFoundException('BOM不存在');
    return { success: true };
  }

  async getAllActiveBoms(): Promise<Bom[]> {
    const items = await this.db
      .select()
      .from(bom)
      .orderBy(bom.bomCode);

    return items.map((item) => ({
      id: item.id,
      bomCode: item.bomCode,
      productCode: item.productCode,
      productName: item.productName,
      version: item.version || 'V1.0',
      status: item.status,
      description: item.description ?? undefined,
    }));
  }
}
