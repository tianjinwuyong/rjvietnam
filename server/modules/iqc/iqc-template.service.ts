import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { eq, and, like, desc, count, inArray, asc, ne, isNull } from 'drizzle-orm';
import type {
  IqcTemplate,
  IqcTemplateItem,
  IqcTemplateWithItems,
  IqcRawTemplate,
  PaginatedResponse,
} from '@shared/api.interface';
import {
  iqcTemplate,
  iqcTemplateItem,
  iqcTemplateMaterial,
  iqcStandardItem,
  iqcLot,
  material,
} from '@server/database/schema';

type TemplateRow = typeof iqcTemplate.$inferSelect;
type TemplateItemRow = typeof iqcTemplateItem.$inferSelect;

/** 仍生效（未归档）的模板项目条件 */
const activeItem = isNull(iqcTemplateItem.deletedAt);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 递增模板版本号：1.0 → 2 → 3 …（只取主版本号的整数部分）
 * 前端展示为 v{version}，旧版本行已归档但保留给历史报告引用。
 */
function bumpVersion(cur?: string | null): string {
  const n = parseInt(String(cur ?? '1').split('.')[0], 10);
  return String((Number.isFinite(n) && n > 0 ? n : 1) + 1);
}

function mapTemplate(row: TemplateRow): IqcTemplate {
  return {
    id: row.id,
    templateName: row.templateName,
    templateCode: row.templateCode ?? undefined,
    version: row.version ?? '1.0',
    status: row.status,
    description: row.description ?? undefined,
    packagingAql: row.packagingAql ?? undefined,
    appearanceLevel: row.appearanceLevel ?? undefined,
    appearanceAql: row.appearanceAql ?? undefined,
    dimensionLevel: row.dimensionLevel ?? undefined,
    dimensionAql: row.dimensionAql ?? undefined,
    reliabilitySampleSize: row.reliabilitySampleSize ?? undefined,
    environmentalSampleSize: row.environmentalSampleSize ?? undefined,
    rowCount: row.rowCount ?? undefined,
    colCount: row.colCount ?? undefined,
    fileName: row.fileName ?? undefined,
    sheetName: row.sheetName ?? undefined,
    selectedSections: row.selectedSections ?? [],
    createdAt: row.createdAt?.toISOString(),
    updatedAt: row.updatedAt?.toISOString(),
  };
}

function mapItem(row: TemplateItemRow): IqcTemplateItem {
  return {
    id: row.id,
    templateId: row.templateId,
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
  };
}

interface TemplateListParams {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: string;
}

export interface BoundMaterial {
  id: string;
  materialCode: string;
  materialName: string;
}

@Injectable()
export class IqcTemplateService {
  private readonly logger = new Logger(IqcTemplateService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async list(params: TemplateListParams): Promise<PaginatedResponse<IqcTemplate>> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const { keyword, status } = params;

    const conditions = [];
    if (keyword) conditions.push(like(iqcTemplate.templateName, `%${keyword}%`));
    // 默认不显示已删除的模板
    if (status) {
      conditions.push(eq(iqcTemplate.status, status));
    } else {
      conditions.push(ne(iqcTemplate.status, 'deleted'));
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ count: totalCount }] = await this.db
      .select({ count: count() })
      .from(iqcTemplate)
      .where(whereClause);
    const total = Number(totalCount || 0);

    const rows = await this.db
      .select()
      .from(iqcTemplate)
      .where(whereClause)
      .orderBy(desc(iqcTemplate.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const templateIds = rows.map((r: TemplateRow) => r.id);

    let itemCounts: Record<string, number> = {};
    let materialCounts: Record<string, number> = {};

    if (templateIds.length > 0) {
      const itemRows = await this.db
        .select({ templateId: iqcTemplateItem.templateId, count: count() })
        .from(iqcTemplateItem)
        .where(and(inArray(iqcTemplateItem.templateId, templateIds), activeItem))
        .groupBy(iqcTemplateItem.templateId);
      itemCounts = itemRows.reduce(
        (acc: Record<string, number>, r: { templateId: string; count: string | number }) => {
          acc[r.templateId] = Number(r.count);
          return acc;
        },
        {},
      );

      const matRows = await this.db
        .select({ templateId: iqcTemplateMaterial.templateId, count: count() })
        .from(iqcTemplateMaterial)
        .where(inArray(iqcTemplateMaterial.templateId, templateIds))
        .groupBy(iqcTemplateMaterial.templateId);
      materialCounts = matRows.reduce(
        (acc: Record<string, number>, r: { templateId: string; count: string | number }) => {
          acc[r.templateId] = Number(r.count);
          return acc;
        },
        {},
      );
    }

    const items: IqcTemplate[] = rows.map((row: TemplateRow) => ({
      ...mapTemplate(row),
      materialCount: materialCounts[row.id] ?? 0,
      itemCount: itemCounts[row.id] ?? 0,
    }));

    return { items, total, page, pageSize };
  }

  async getById(id: string): Promise<IqcTemplateWithItems | null> {
    const rows = await this.db.select().from(iqcTemplate).where(eq(iqcTemplate.id, id)).limit(1);
    if (rows.length === 0) return null;

    const itemRows = await this.db
      .select()
      .from(iqcTemplateItem)
      .where(and(eq(iqcTemplateItem.templateId, id), activeItem))
      .orderBy(asc(iqcTemplateItem.sectionType), asc(iqcTemplateItem.sortOrder));

    return {
      ...mapTemplate(rows[0]),
      items: itemRows.map((r: TemplateItemRow) => mapItem(r)),
    };
  }

  async create(dto: Partial<IqcTemplate> & { selectedSections?: string[]; copyFromStandard?: boolean }): Promise<IqcTemplate> {
    if (!dto.templateName) throw new BadRequestException('模板名称不能为空');

    const selectedSections = Array.isArray(dto.selectedSections) ? dto.selectedSections : [];

    const inserted = await this.db
      .insert(iqcTemplate)
      .values({
        templateName: dto.templateName,
        templateCode: dto.templateCode ?? null,
        version: dto.version ?? '1.0',
        status: dto.status ?? 'active',
        description: dto.description ?? null,
        packagingAql: dto.packagingAql ?? null,
        appearanceLevel: dto.appearanceLevel ?? null,
        appearanceAql: dto.appearanceAql ?? null,
        dimensionLevel: dto.dimensionLevel ?? null,
        dimensionAql: dto.dimensionAql ?? null,
        reliabilitySampleSize: dto.reliabilitySampleSize ?? null,
        environmentalSampleSize: dto.environmentalSampleSize ?? null,
        selectedSections,
      })
      .returning();

    const templateId = inserted[0].id;

    // 从标准库复制所选分类的项目作为快照（与库解耦）
    if (selectedSections.length > 0 && dto.copyFromStandard !== false) {
      const stdRows = await this.db
        .select()
        .from(iqcStandardItem)
        .where(inArray(iqcStandardItem.sectionType, selectedSections))
        .orderBy(asc(iqcStandardItem.sectionType), asc(iqcStandardItem.sortOrder));

      if (stdRows.length > 0) {
        const values = stdRows.map((r) => ({
          templateId,
          sectionType: r.sectionType,
          itemName: r.itemName,
          itemNameVi: r.itemNameVi,
          itemNameEn: r.itemNameEn,
          standard: r.standard,
          standardVi: r.standardVi,
          standardEn: r.standardEn,
          spec: r.spec,
          lsl: r.lsl,
          usl: r.usl,
          unit: r.unit,
          aql: r.aql ?? '0.4',
          samplingPlanText: r.samplingPlanText,
          sampleSize: r.sampleSize,
          ac: r.ac,
          re: r.re,
          sortOrder: r.sortOrder ?? 0,
          isRequired: r.isRequired ?? true,
        }));
        await this.db.insert(iqcTemplateItem).values(values);
        this.logger.log(`模板 ${templateId} 已从标准库复制 ${values.length} 个项目`);
      }
    }

    return mapTemplate(inserted[0]);
  }

  async createFromExcel(params: {
    fileName: string;
    sheetName: string;
    rowCount: number;
    colCount: number;
    rawData: { cells: { r: number; c: number; v: string }[]; merges: { s: { r: number; c: number }; e: { r: number; c: number } }[]; colWidths: number[] };
  }): Promise<IqcTemplate> {
    const templateName = params.fileName.replace(/\.xlsx?$/i, '');

    const inserted = await this.db
      .insert(iqcTemplate)
      .values({
        templateName,
        version: '1.0',
        status: 'active',
        rawData: params.rawData as any,
        rowCount: params.rowCount,
        colCount: params.colCount,
        fileName: params.fileName,
        sheetName: params.sheetName,
      })
      .returning();

    this.logger.log(`Excel模板导入成功: ${params.fileName} (${params.rowCount}行 × ${params.colCount}列)`);
    return mapTemplate(inserted[0]);
  }

  async getRawTemplate(id: string): Promise<IqcRawTemplate | null> {
    const rows = await this.db
      .select({
        id: iqcTemplate.id,
        templateName: iqcTemplate.templateName,
        rawData: iqcTemplate.rawData,
        rowCount: iqcTemplate.rowCount,
        colCount: iqcTemplate.colCount,
      })
      .from(iqcTemplate)
      .where(eq(iqcTemplate.id, id))
      .limit(1);

    if (rows.length === 0) return null;
    const row = rows[0];
    const raw = row.rawData as any;

    // 如果有原始Excel数据（旧模板/Excel导入），直接返回
    if (raw && raw.cells && raw.cells.length > 0) {
      return {
        id: row.id,
        templateName: row.templateName,
        rowCount: row.rowCount ?? 0,
        colCount: row.colCount ?? 0,
        cells: raw.cells,
        merges: raw.merges ?? [],
        colWidths: raw.colWidths ?? [],
      };
    }

    // 新架构模板：从检验项目表动态生成预览表格
    return this.generatePreviewFromItems(row.id, row.templateName);
  }

  /** 从 iqc_template_item 动态生成Excel格式预览数据 */
  private async generatePreviewFromItems(
    templateId: string,
    templateName: string,
  ): Promise<IqcRawTemplate> {
    const items = await this.db
      .select()
      .from(iqcTemplateItem)
      .where(and(eq(iqcTemplateItem.templateId, templateId), activeItem))
      .orderBy(asc(iqcTemplateItem.sortOrder));

    const sectionLabels: Record<string, string> = {
      packaging: '一、包装检查',
      appearance: '二、外观检查',
      dimension: '三、尺寸&功能检查',
      reliability: '四、可靠性&安规测试',
      environmental: '五、环保测试',
    };
    const sectionOrder = ['packaging', 'appearance', 'dimension', 'reliability', 'environmental'];

    // 11列：序号、检验项目、检验标准、规格值、下限、上限、抽样方案、抽样数、Ac、Re、单位
    const COL_COUNT = 11;
    const colWidths = [6, 22, 30, 12, 10, 10, 14, 8, 6, 6, 8];
    const headers = ['序号', '检验项目', '检验标准', '规格值(Spec)', '下限(LSL)', '上限(USL)', '抽样方案', '抽样数', 'Ac', 'Re', '单位'];

    const cells: { r: number; c: number; v: string }[] = [];
    const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];

    let r = 0;

    // 第0行：模板名称（合并所有列）
    cells.push({ r, c: 0, v: templateName });
    merges.push({ s: { r, c: 0 }, e: { r, c: COL_COUNT - 1 } });
    r++;

    // 第1行：空行
    r++;

    // 按分类分组
    for (const section of sectionOrder) {
      const sectionItems = items.filter((it) => it.sectionType === section);
      if (sectionItems.length === 0) continue;

      // 分类标题行（合并所有列）
      cells.push({ r, c: 0, v: sectionLabels[section] || section });
      merges.push({ s: { r, c: 0 }, e: { r, c: COL_COUNT - 1 } });
      r++;

      // 表头行
      headers.forEach((h, c) => cells.push({ r, c, v: h }));
      r++;

      // 项目行
      sectionItems.forEach((item, idx) => {
        cells.push({ r, c: 0, v: String(idx + 1) });
        cells.push({ r, c: 1, v: item.itemName || '' });
        cells.push({ r, c: 2, v: item.standard || '' });
        cells.push({ r, c: 3, v: item.spec || '' });
        cells.push({ r, c: 4, v: item.lsl != null ? String(item.lsl) : '' });
        cells.push({ r, c: 5, v: item.usl != null ? String(item.usl) : '' });
        cells.push({ r, c: 6, v: item.samplingPlanText || '' });
        cells.push({ r, c: 7, v: item.sampleSize != null ? String(item.sampleSize) : '' });
        cells.push({ r, c: 8, v: item.ac != null ? String(item.ac) : '' });
        cells.push({ r, c: 9, v: item.re != null ? String(item.re) : '' });
        cells.push({ r, c: 10, v: item.unit || '' });
        r++;
      });

      // 分类间空行
      r++;
    }

    if (items.length === 0) {
      cells.push({ r, c: 0, v: '（暂无检验项目，请在"编辑项目"中添加）' });
      merges.push({ s: { r, c: 0 }, e: { r, c: COL_COUNT - 1 } });
      r++;
    }

    return {
      id: templateId,
      templateName,
      rowCount: r,
      colCount: COL_COUNT,
      cells,
      merges,
      colWidths,
    };
  }

  async update(id: string, dto: Partial<IqcTemplate>): Promise<IqcTemplate> {
    const existing = await this.db.select({ id: iqcTemplate.id }).from(iqcTemplate).where(eq(iqcTemplate.id, id)).limit(1);
    if (existing.length === 0) throw new NotFoundException('模板不存在');

    const patch: Partial<typeof iqcTemplate.$inferInsert> = {};
    const fields: (keyof IqcTemplate)[] = [
      'templateName', 'templateCode', 'version', 'status', 'description',
      'packagingAql', 'appearanceLevel', 'appearanceAql',
      'dimensionLevel', 'dimensionAql', 'reliabilitySampleSize', 'environmentalSampleSize',
      'selectedSections',
    ];
    for (const f of fields) {
      if (dto[f] !== undefined) (patch as any)[f] = dto[f];
    }
    if (Object.keys(patch).length === 0) throw new BadRequestException('未提供可更新字段');
    patch.updatedAt = new Date();

    const updated = await this.db.update(iqcTemplate).set(patch).where(eq(iqcTemplate.id, id)).returning();
    return mapTemplate(updated[0]);
  }

  async delete(id: string): Promise<void> {
    // 先检查模板是否存在
    const existing = await this.db.select({ id: iqcTemplate.id }).from(iqcTemplate).where(eq(iqcTemplate.id, id)).limit(1);
    if (existing.length === 0) throw new NotFoundException('模板不存在');

    // 改成逻辑删除：把状态改成"deleted"，而不是物理删除
    // 因为模板可能被历史检验记录引用，物理删除会导致外键约束错误
    await this.db.update(iqcTemplate)
      .set({ status: 'deleted', updatedAt: new Date() })
      .where(eq(iqcTemplate.id, id));

    this.logger.log(`模板 ${id} 已标记为删除`);
  }

  /**
   * 保存模板项目（版本化 diff 保存）。
   *
   * 原实现是「delete 全部 → 重新 insert」，一旦 iqc_inspection_record 引用了旧项目行，
   * 删除就会被外键拒绝（23503），界面只显示「保存失败」。
   *
   * 现在：带 id 的既有行原地 update（id 不变，历史报告继续可追溯）；提交中没有的旧行置
   * deleted_at 归档（界面隐藏、行保留）；新增行 insert；模板 version 递增，界面显示 v{n}。
   */
  async saveItems(
    templateId: string,
    items: IqcTemplateItem[],
  ): Promise<{ version: string; updated: number; created: number; archived: number }> {
    const existing = await this.db
      .select({ id: iqcTemplate.id, version: iqcTemplate.version })
      .from(iqcTemplate)
      .where(eq(iqcTemplate.id, templateId))
      .limit(1);
    if (existing.length === 0) throw new NotFoundException('模板不存在');

    try {
      return await this.db.transaction(async (tx) => {
        const current = await tx
          .select()
          .from(iqcTemplateItem)
          .where(and(eq(iqcTemplateItem.templateId, templateId), isNull(iqcTemplateItem.deletedAt)))
          .orderBy(asc(iqcTemplateItem.sortOrder));

        const currentById = new Map(current.map((r) => [r.id, r]));
        const keptIds = new Set<string>();
        let created = 0;
        let updated = 0;

        for (let idx = 0; idx < items.length; idx++) {
          const item = items[idx];
          const payload = {
            sectionType: item.sectionType,
            itemName: item.itemName,
            itemNameVi: item.itemNameVi ?? null,
            itemNameEn: item.itemNameEn ?? null,
            standard: item.standard ?? null,
            standardVi: item.standardVi ?? null,
            standardEn: item.standardEn ?? null,
            spec: (item as any).spec ?? null,
            lsl: item.lsl ?? null,
            usl: item.usl ?? null,
            unit: item.unit ?? null,
            aql: item.aql ?? '0.4',
            samplingPlanText: item.samplingPlanText ?? null,
            sampleSize: item.sampleSize ?? null,
            ac: item.ac ?? null,
            re: item.re ?? null,
            sortOrder: item.sortOrder ?? idx,
            isRequired: item.isRequired ?? true,
          };

          // 只有真正的 uuid 且属于本模板、仍在生效的行才走 update（前端新增行带的是 new_xxx 临时 id）
          const existingRow = item.id && UUID_RE.test(String(item.id)) ? currentById.get(String(item.id)) : undefined;

          if (existingRow) {
            await tx.update(iqcTemplateItem)
              .set({ ...payload, updatedAt: new Date() })
              .where(eq(iqcTemplateItem.id, existingRow.id));
            keptIds.add(existingRow.id);
            updated++;
          } else {
            await tx.insert(iqcTemplateItem).values({ templateId, ...payload });
            created++;
          }
        }

        // 被移除的项目行：逻辑归档，保留 id 供 iqc_inspection_record 外键引用
        const archivedIds = current.filter((r) => !keptIds.has(r.id)).map((r) => r.id);
        if (archivedIds.length > 0) {
          await tx.update(iqcTemplateItem)
            .set({ deletedAt: new Date() })
            .where(inArray(iqcTemplateItem.id, archivedIds));
        }

        const nextVersion = bumpVersion(existing[0].version);
        await tx.update(iqcTemplate)
          .set({ version: nextVersion, updatedAt: new Date() })
          .where(eq(iqcTemplate.id, templateId));

        this.logger.log(
          `模板 ${templateId} 已保存为 v${nextVersion}：更新 ${updated} / 新增 ${created} / 归档 ${archivedIds.length}`,
        );

        return { version: nextVersion, updated, created, archived: archivedIds.length };
      });
    } catch (e) {
      console.error('saveItems error:', e);
      throw e;
    }
  }

  /**
   * 从标准库重新导入某个分类的项目到模板（覆盖该分类下已有的模板项目）。
   * 同时把该分类加入模板的 selected_sections。
   */
  async importSectionFromStandard(templateId: string, sectionType: string): Promise<number> {
    const existing = await this.db.select({ id: iqcTemplate.id }).from(iqcTemplate).where(eq(iqcTemplate.id, templateId)).limit(1);
    if (existing.length === 0) throw new NotFoundException('模板不存在');

    const stdRows = await this.db
      .select()
      .from(iqcStandardItem)
      .where(eq(iqcStandardItem.sectionType, sectionType))
      .orderBy(asc(iqcStandardItem.sortOrder));

    await this.db.transaction(async (tx) => {
      // 归档该分类下模板已有的项目（不能物理删除：可能已被历史检验记录引用）
      await tx.update(iqcTemplateItem)
        .set({ deletedAt: new Date() })
        .where(and(
          eq(iqcTemplateItem.templateId, templateId),
          eq(iqcTemplateItem.sectionType, sectionType),
          isNull(iqcTemplateItem.deletedAt),
        ));

      if (stdRows.length > 0) {
        const values = stdRows.map((r) => ({
          templateId,
          sectionType: r.sectionType,
          itemName: r.itemName,
          itemNameVi: r.itemNameVi,
          itemNameEn: r.itemNameEn,
          standard: r.standard,
          standardVi: r.standardVi,
          standardEn: r.standardEn,
          spec: r.spec,
          lsl: r.lsl,
          usl: r.usl,
          unit: r.unit,
          aql: r.aql ?? '0.4',
          samplingPlanText: r.samplingPlanText,
          sampleSize: r.sampleSize,
          ac: r.ac,
          re: r.re,
          sortOrder: r.sortOrder ?? 0,
          isRequired: r.isRequired ?? true,
        }));
        await tx.insert(iqcTemplateItem).values(values);
      }

      // 把该分类加入 selected_sections（去重），同时版本号递增
      const tplRows = await tx.select({ selectedSections: iqcTemplate.selectedSections, version: iqcTemplate.version })
        .from(iqcTemplate).where(eq(iqcTemplate.id, templateId)).limit(1);
      const cur = tplRows[0]?.selectedSections ?? [];
      await tx.update(iqcTemplate)
        .set({
          selectedSections: cur.includes(sectionType) ? cur : [...cur, sectionType],
          version: bumpVersion(tplRows[0]?.version),
          updatedAt: new Date(),
        })
        .where(eq(iqcTemplate.id, templateId));
    });

    this.logger.log(`模板 ${templateId} 已从标准库导入分类 ${sectionType}，共 ${stdRows.length} 个项目`);
    return stdRows.length;
  }

  async getTemplateByMaterial(materialId: string): Promise<IqcTemplateWithItems | null> {
    const rows = await this.db
      .select({ templateId: iqcTemplateMaterial.templateId })
      .from(iqcTemplateMaterial)
      .where(eq(iqcTemplateMaterial.materialId, materialId))
      .limit(1);
    if (rows.length === 0) return null;
    return this.getById(rows[0].templateId);
  }

  async bindMaterials(templateId: string, materialIds: string[]): Promise<void> {
    const existing = await this.db.select({ id: iqcTemplate.id }).from(iqcTemplate).where(eq(iqcTemplate.id, templateId)).limit(1);
    if (existing.length === 0) throw new NotFoundException('模板不存在');

    await this.db.transaction(async (tx) => {
      await tx.delete(iqcTemplateMaterial).where(eq(iqcTemplateMaterial.templateId, templateId));
      if (materialIds.length === 0) return;
      await tx.insert(iqcTemplateMaterial).values(materialIds.map((mid: string) => ({ templateId, materialId: mid })));
    });
  }

  async getBoundMaterials(templateId: string): Promise<BoundMaterial[]> {
    const rows = await this.db
      .select({ id: material.id, materialCode: material.materialCode, materialName: material.materialName })
      .from(iqcTemplateMaterial)
      .leftJoin(material, eq(iqcTemplateMaterial.materialId, material.id))
      .where(eq(iqcTemplateMaterial.templateId, templateId))
      .orderBy(material.materialCode);

    return rows.filter((r) => r.id !== null) as BoundMaterial[];
  }
}
