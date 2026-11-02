import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { eq, asc, inArray } from 'drizzle-orm';
import type { IqcStandardItem } from '@shared/api.interface';
import { iqcStandardItem } from '@server/database/schema';

type StandardItemRow = typeof iqcStandardItem.$inferSelect;

function mapStandardItem(row: StandardItemRow): IqcStandardItem {
  return {
    id: row.id,
    sectionType: row.sectionType,
    itemName: row.itemName,
    itemNameVi: row.itemNameVi ?? undefined,
    itemNameEn: row.itemNameEn ?? undefined,
    standard: row.standard ?? undefined,
    standardVi: row.standardVi ?? undefined,
    standardEn: row.standardEn ?? undefined,
    spec: row.spec ?? undefined,
    lsl: row.lsl ?? undefined,
    usl: row.usl ?? undefined,
    unit: row.unit ?? undefined,
    aql: row.aql ?? '0.4',
    samplingPlanText: row.samplingPlanText ?? undefined,
    sampleSize: row.sampleSize ?? undefined,
    ac: row.ac ?? undefined,
    re: row.re ?? undefined,
    sortOrder: row.sortOrder ?? 0,
    isRequired: row.isRequired ?? undefined,
    createdAt: row.createdAt?.toISOString(),
    updatedAt: row.updatedAt?.toISOString(),
  };
}

/** 新增标准项目时，根据分类计算 Ac/Re 与抽样方案默认值（后端兜底） */
export function defaultStandardItemValues(sectionType: string): {
  ac?: number;
  re?: number;
  samplingPlanText?: string;
} {
  switch (sectionType) {
    case 'packaging':
    case 'reliability':
    case 'environmental':
      return { ac: 0, re: 1, samplingPlanText: 'N=1' };
    case 'appearance':
      return { ac: undefined, re: undefined, samplingPlanText: 'G-II' };
    case 'dimension':
      return { ac: undefined, re: undefined, samplingPlanText: 'S-2' };
    default:
      return {};
  }
}

@Injectable()
export class IqcStandardItemService {
  private readonly logger = new Logger(IqcStandardItemService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /** 列出标准项目，可按分类过滤 */
  async list(sectionType?: string): Promise<IqcStandardItem[]> {
    const rows = await this.db
      .select()
      .from(iqcStandardItem)
      .where(sectionType ? eq(iqcStandardItem.sectionType, sectionType) : undefined)
      .orderBy(asc(iqcStandardItem.sectionType), asc(iqcStandardItem.sortOrder));
    return rows.map(mapStandardItem);
  }

  async create(dto: Partial<IqcStandardItem>): Promise<IqcStandardItem> {
    if (!dto.itemName || !dto.itemName.trim()) {
      throw new BadRequestException('检验项目名称不能为空');
    }
    if (!dto.sectionType) {
      throw new BadRequestException('检验分类不能为空');
    }
    // 后端默认值兜底：仅当前端未传 Ac/Re 或抽样方案时
    const defaults = defaultStandardItemValues(dto.sectionType);
    const inserted = await this.db
      .insert(iqcStandardItem)
      .values({
        sectionType: dto.sectionType,
        itemName: dto.itemName.trim(),
        itemNameVi: dto.itemNameVi ?? null,
        itemNameEn: dto.itemNameEn ?? null,
        standard: dto.standard ?? null,
        standardVi: dto.standardVi ?? null,
        standardEn: dto.standardEn ?? null,
        spec: (dto as any).spec ?? null,
        lsl: dto.lsl ?? null,
        usl: dto.usl ?? null,
        unit: dto.unit ?? null,
        aql: dto.aql ?? '0.4',
        samplingPlanText: dto.samplingPlanText ?? defaults.samplingPlanText ?? null,
        sampleSize: dto.sampleSize ?? null,
        ac: dto.ac ?? defaults.ac ?? null,
        re: dto.re ?? defaults.re ?? null,
        sortOrder: dto.sortOrder ?? 0,
        isRequired: dto.isRequired ?? true,
      })
      .returning();
    return mapStandardItem(inserted[0]);
  }

  async update(id: string, dto: Partial<IqcStandardItem>): Promise<IqcStandardItem> {
    const existing = await this.db
      .select({ id: iqcStandardItem.id })
      .from(iqcStandardItem)
      .where(eq(iqcStandardItem.id, id))
      .limit(1);
    if (existing.length === 0) throw new NotFoundException('标准项目不存在');

    const patch: Partial<typeof iqcStandardItem.$inferInsert> = {};
    const fields: (keyof IqcStandardItem)[] = [
      'sectionType', 'itemName', 'itemNameVi', 'itemNameEn',
      'standard', 'standardVi', 'standardEn',
      'spec', 'lsl', 'usl', 'unit', 'aql',
      'samplingPlanText', 'sampleSize', 'ac', 're',
      'sortOrder', 'isRequired',
    ];
    for (const f of fields) {
      if (dto[f] !== undefined) (patch as any)[f] = dto[f] ?? null;
    }
    patch.updatedAt = new Date();
    const updated = await this.db
      .update(iqcStandardItem)
      .set(patch)
      .where(eq(iqcStandardItem.id, id))
      .returning();
    return mapStandardItem(updated[0]);
  }

  async delete(id: string): Promise<void> {
    const deleted = await this.db
      .delete(iqcStandardItem)
      .where(eq(iqcStandardItem.id, id))
      .returning({ id: iqcStandardItem.id });
    if (deleted.length === 0) throw new NotFoundException('标准项目不存在');
  }

  /** 批量获取某几个分类的标准项目（用于模板创建时复制快照） */
  async getBySections(sectionTypes: string[]): Promise<IqcStandardItem[]> {
    if (sectionTypes.length === 0) return [];
    const rows = await this.db
      .select()
      .from(iqcStandardItem)
      .where(inArray(iqcStandardItem.sectionType, sectionTypes))
      .orderBy(asc(iqcStandardItem.sectionType), asc(iqcStandardItem.sortOrder));
    return rows.map(mapStandardItem);
  }
}
