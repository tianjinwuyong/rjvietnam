import { Injectable, Inject, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { eq, and, desc, count, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import * as XLSX from 'xlsx';
import { readWorkbook, isBlankRow } from '../../common/utils/spreadsheet';

import { material, materialSubstitution, inventory } from '@server/database/schema';
import type {
  MaterialSubstitution,
  SubstituteMaterialInfo,
  SubstitutionCheckResult,
  SubstitutionImportResult,
  PaginatedResponse,
} from '@shared/api.interface';

@Injectable()
export class SubstitutionService {
  private readonly logger = new Logger(SubstitutionService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  // ========== Excel Import ==========

  async importSubstitutions(buffer: Buffer, twoWayDefault: boolean = false): Promise<SubstitutionImportResult> {
    const errors: string[] = [];
    let successCount = 0;
    let skippedCount = 0;
    let totalRows = 0;

    // 1. Parse spreadsheet（xlsx / xls / csv，兼容 Excel 另存的 GBK 编码 CSV）
    const workbook = readWorkbook(buffer);
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new BadRequestException('Excel 文件中没有工作表');
    }
    const worksheet = workbook.Sheets[firstSheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
      raw: false,
    });

    if (rows.length === 0) {
      throw new BadRequestException('Excel 文件为空');
    }

    const normalizeHeader = (raw: string): string =>
      raw
        .trim()
        .replace(/[\s\u3000]/g, '')
        .replace(/（/g, '(')
        .replace(/）/g, ')')
        .toLowerCase();

    const headerRow = rows[0];
    if (!Array.isArray(headerRow)) {
      throw new BadRequestException('Excel 表头行格式错误');
    }

    // ── 表头列识别 ────────────────────────────────────────────────
    // 需要同时支持两类文件：
    //   A. 简写模板：料号 / 替代料号 / 替代方式
    //   B. 系统「批量导出」出来的完整表头：
    //      序号 | 原物料编码 | 原物料名称 | 替代物料编码 | 替代物料名称 | 替代方式 | 备注 | 状态
    //      导出文件必须能直接回灌导入，因此不能再用「精确等于别名」的写法
    //      （旧实现识别不到「原物料编码」，会回退到第 0 列，把「序号」当成原物料编码）。
    const isNameCol = (n: string) => n.includes('名称') || n.includes('名字');
    const isNoiseCol = (n: string) =>
      n.includes('序号') || n.includes('状态') || n.includes('备注') ||
      n.includes('数量') || n.includes('单位') || n.includes('日期') || n.includes('时间');
    const isSubWord = (n: string) => n.includes('替代') || n.includes('替换');
    const isCodeWord = (n: string) =>
      n.includes('编码') || n.includes('料号') || n.includes('代码') ||
      n.includes('物料号') || n.includes('编号') || n.includes('品号');

    const headerNames = headerRow.map((cell: unknown) => normalizeHeader(String(cell ?? '')));

    // 1) 替代方式列
    const typeKeywords = ['替代方式', '替代类型', '替代方向', '方向', '类型', '双向'];
    const typeColIdx = headerNames.findIndex((n) => typeKeywords.includes(n));

    // 2) 替代物料列：排除名称/噪声/类型列后，取含「替代 / 替换」的列
    let substituteColIdx = headerNames.findIndex(
      (n, i) => i !== typeColIdx && !isNameCol(n) && !isNoiseCol(n) && isSubWord(n),
    );

    // 3) 原物料列：排除名称/噪声/类型/替代列后，取含「原」或编码类关键词的列
    let originalColIdx = headerNames.findIndex(
      (n, i) =>
        i !== typeColIdx && i !== substituteColIdx &&
        !isNameCol(n) && !isNoiseCol(n) && !isSubWord(n) &&
        (n.includes('原') || isCodeWord(n)),
    );

    // 4) 兜底：按「编码类列」的顺序补齐缺失的一侧
    if (originalColIdx === -1 || substituteColIdx === -1) {
      const codeCols = headerNames
        .map((n, i) => ({ n, i }))
        .filter(({ n, i }) =>
          i !== typeColIdx && i !== originalColIdx && i !== substituteColIdx &&
          !isNameCol(n) && !isNoiseCol(n) && isCodeWord(n),
        );
      if (originalColIdx === -1 && codeCols.length) originalColIdx = codeCols[0].i;
      if (substituteColIdx === -1 && codeCols.length) {
        const rest = codeCols.filter(({ i }) => i !== originalColIdx);
        if (rest.length) substituteColIdx = rest[rest.length - 1].i;
      }
    }

    // 5) 最后兜底：无表头的文件仍按第 0/1 列处理
    if (originalColIdx === -1 || substituteColIdx === -1) {
      originalColIdx = 0;
      substituteColIdx = 1;
    }

    this.logger.log(
      `替代关系导入列识别：原物料=${headerNames[originalColIdx] ?? originalColIdx}` +
      `，替代物料=${headerNames[substituteColIdx] ?? substituteColIdx}` +
      `，替代方式=${typeColIdx >= 0 ? headerNames[typeColIdx] : '(未识别)'}`,
    );

    const dataRows = rows.slice(1);
    totalRows = dataRows.length;

    interface ParsedRow {
      originalCode: string;
      substituteCode: string;
      twoWay: boolean;
    }

    const validRows: ParsedRow[] = [];

    dataRows.forEach((row: unknown[], index: number) => {
      const rowNum = index + 2;
      if (!Array.isArray(row)) {
        errors.push(`第 ${rowNum} 行：格式错误`);
        return;
      }
      // Excel 尾部的幽灵空行（有格式无内容）直接跳过，不报错
      if (isBlankRow(row)) {
        return;
      }
      const originalCode = String(row[originalColIdx] ?? '').trim();
      const substituteCode = String(row[substituteColIdx] ?? '').trim();
      // 第三列替代方式：双向/相互/2/two/two_way 表示双向，其他或空表示单向
      let twoWay = twoWayDefault;
      if (typeColIdx >= 0) {
        const typeVal = String(row[typeColIdx] ?? '').trim().toLowerCase();
        if (typeVal === '双向' || typeVal === '相互' || typeVal === '2' || typeVal === 'two' || typeVal === 'two_way' || typeVal === '是' || typeVal === 'y' || typeVal === 'yes') {
          twoWay = true;
        } else if (typeVal === '单向' || typeVal === '1' || typeVal === 'one' || typeVal === 'one_way' || typeVal === '否' || typeVal === 'n' || typeVal === 'no') {
          twoWay = false;
        }
      }

      if (!originalCode || !substituteCode) {
        errors.push(`第 ${rowNum} 行：料号和替代料号均不能为空`);
        return;
      }

      // Skip self-substitution
      if (originalCode === substituteCode) {
        skippedCount++;
        return;
      }

      validRows.push({ originalCode, substituteCode, twoWay });
    });

    if (validRows.length === 0) {
      return {
        successCount: 0,
        errorCount: errors.length,
        errors,
        totalRows,
        skippedCount,
      };
    }

    // 2. Validate both material codes exist in material table
    const allCodes = new Set<string>();
    for (const r of validRows) {
      allCodes.add(r.originalCode);
      allCodes.add(r.substituteCode);
    }

    const codeList = Array.from(allCodes);
    const existingMaterials = await this.db
      .select({ id: material.id, materialCode: material.materialCode })
      .from(material)
      .where(sql`${material.materialCode} IN (${sql.join(codeList.map((c) => sql`${c}`), sql`, `)})`);

    const materialMap = new Map<string, string>();
    for (const m of existingMaterials) {
      materialMap.set(m.materialCode, m.id);
    }

    // Validate and build insert values
    interface InsertRow {
      materialId: string;
      materialCode: string;
      substituteMaterialId: string;
      substituteMaterialCode: string;
      substitutionType: string;
    }

    const insertRows: InsertRow[] = [];
    const seenPairs = new Set<string>();

    validRows.forEach((r, index) => {
      const rowNum = index + 2;
      const origId = materialMap.get(r.originalCode);
      const subId = materialMap.get(r.substituteCode);

      if (!origId) {
        errors.push(`第 ${rowNum} 行：原物料 ${r.originalCode} 不存在`);
        return;
      }
      if (!subId) {
        errors.push(`第 ${rowNum} 行：替代物料 ${r.substituteCode} 不存在`);
        return;
      }

      const subType = r.twoWay ? 'two_way' : 'one_way';
      const pairKey = `${origId}__${subId}`;
      if (seenPairs.has(pairKey)) {
        skippedCount++;
      } else {
        seenPairs.add(pairKey);
        insertRows.push({
          materialId: origId,
          materialCode: r.originalCode,
          substituteMaterialId: subId,
          substituteMaterialCode: r.substituteCode,
          substitutionType: subType,
        });
      }

      // 双向替代：自动创建反向记录 B→A
      if (r.twoWay) {
        const reverseKey = `${subId}__${origId}`;
        if (!seenPairs.has(reverseKey)) {
          seenPairs.add(reverseKey);
          insertRows.push({
            materialId: subId,
            materialCode: r.substituteCode,
            substituteMaterialId: origId,
            substituteMaterialCode: r.originalCode,
            substitutionType: 'two_way',
          });
        }
      }
    });

    // 3. Transaction: batch insert with onConflictDoNothing
    if (insertRows.length > 0) {
      await this.db.transaction(async (tx) => {
        const result = await tx
          .insert(materialSubstitution)
          .values(
            insertRows.map((r) => ({
              materialId: r.materialId,
              materialCode: r.materialCode,
              substituteMaterialId: r.substituteMaterialId,
              substituteMaterialCode: r.substituteMaterialCode,
              substitutionType: r.substitutionType,
              status: 'active',
            })),
          )
          .onConflictDoNothing()
          .returning({ id: materialSubstitution.id });

        successCount = result.length;
        // Remaining that hit conflict (already existed) count as skipped
        skippedCount += insertRows.length - result.length;
      });
    }

    this.logger.log(
      `替代关系导入完成：总行 ${totalRows}，成功 ${successCount}，跳过 ${skippedCount}，错误 ${errors.length}`,
    );

    // 若失败原因集中在「物料不存在」，追加一条汇总提示，便于判断是主数据缺失
    if (successCount === 0 && errors.some((e) => e.includes('不存在'))) {
      const missing = new Set<string>();
      for (const r of validRows) {
        if (!materialMap.has(r.originalCode)) missing.add(r.originalCode);
        if (!materialMap.has(r.substituteCode)) missing.add(r.substituteCode);
      }
      if (missing.size > 0) {
        const list = Array.from(missing);
        errors.push(
          `提示：以下物料在「物料档案」中不存在，请先在物料管理中导入这些物料，再导入替代关系：` +
          `${list.slice(0, 10).join('、')}${list.length > 10 ? ` 等共 ${list.length} 个` : ''}`,
        );
      }
    }

    return {
      successCount,
      errorCount: errors.length,
      errors,
      totalRows,
      skippedCount,
    };
  }

  // ========== Paginated List ==========

  async getSubstitutionList(params: {
    page: number;
    pageSize: number;
    materialCode?: string;
  }): Promise<PaginatedResponse<MaterialSubstitution>> {
    const { page, pageSize, materialCode } = params;
    const offset = (page - 1) * pageSize;

    const originalMat = alias(material, 'originalMat');
    const substituteMat = alias(material, 'substituteMat');

    const conditions = [eq(materialSubstitution.status, 'active')];
    if (materialCode) {
      conditions.push(
        sql`(${materialSubstitution.materialCode} ILIKE ${`%${materialCode}%`} OR ${materialSubstitution.substituteMaterialCode} ILIKE ${`%${materialCode}%`})`,
      );
    }
    const whereClause = and(...conditions);

    const [itemsResult, countResult] = await Promise.all([
      this.db
        .select({
          id: materialSubstitution.id,
          materialId: materialSubstitution.materialId,
          materialCode: materialSubstitution.materialCode,
          materialName: originalMat.materialName,
          substituteMaterialId: materialSubstitution.substituteMaterialId,
          substituteMaterialCode: materialSubstitution.substituteMaterialCode,
          substituteMaterialName: substituteMat.materialName,
          remark: materialSubstitution.remark,
          status: materialSubstitution.status,
          substitutionType: materialSubstitution.substitutionType,
          createdAt: materialSubstitution.createdAt,
        })
        .from(materialSubstitution)
        .innerJoin(originalMat, eq(materialSubstitution.materialId, originalMat.id))
        .innerJoin(substituteMat, eq(materialSubstitution.substituteMaterialId, substituteMat.id))
        .where(whereClause)
        .orderBy(desc(materialSubstitution.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(materialSubstitution)
        .where(whereClause),
    ]);

    const items: MaterialSubstitution[] = itemsResult.map((row) => ({
      id: row.id,
      materialId: row.materialId,
      materialCode: row.materialCode,
      materialName: row.materialName ?? undefined,
      substituteMaterialId: row.substituteMaterialId,
      substituteMaterialCode: row.substituteMaterialCode,
      substituteMaterialName: row.substituteMaterialName ?? undefined,
      remark: row.remark ?? undefined,
      status: row.status,
      substitutionType: row.substitutionType,
      createdAt: row.createdAt ? row.createdAt.toISOString() : undefined,
    }));

    return {
      items,
      total: Number(countResult[0]?.count ?? 0),
      page,
      pageSize,
    };
  }

  // ========== Soft Delete ==========

  async deleteSubstitution(id: string): Promise<void> {
    const rows = await this.db
      .update(materialSubstitution)
      .set({ status: 'inactive' })
      .where(eq(materialSubstitution.id, id))
      .returning({ id: materialSubstitution.id });
    if (rows.length === 0) throw new NotFoundException('替代关系不存在');
  }

  // ========== Get Substitutes by Material Code ==========

  async getSubstitutesByMaterial(materialCode: string): Promise<SubstituteMaterialInfo[]> {
    // Find material_id by materialCode
    const matRows = await this.db
      .select({ id: material.id, materialCode: material.materialCode })
      .from(material)
      .where(eq(material.materialCode, materialCode))
      .limit(1);

    if (matRows.length === 0) throw new NotFoundException('物料不存在');
    const materialId = matRows[0].id;

    // Query active substitutions
    const subs = await this.db
      .select({
        substituteMaterialId: materialSubstitution.substituteMaterialId,
        substituteMaterialCode: materialSubstitution.substituteMaterialCode,
        substituteMaterialName: material.materialName,
        specification: material.specification,
        unit: material.unit,
      })
      .from(materialSubstitution)
      .innerJoin(material, eq(materialSubstitution.substituteMaterialId, material.id))
      .where(and(
        eq(materialSubstitution.materialId, materialId),
        eq(materialSubstitution.status, 'active'),
      ));

    if (subs.length === 0) return [];

    // Aggregate good stock for each substitute material
    const subIds = subs.map((s) => s.substituteMaterialId);
    const stockRows = await this.db
      .select({
        materialId: inventory.materialId,
        totalQty: sql<string>`COALESCE(SUM(${inventory.quantity}), 0)`.as('total_qty'),
      })
      .from(inventory)
      .where(and(
        sql`${inventory.materialId} IN (${sql.join(subIds.map((id) => sql`${id}`), sql`, `)})`,
        eq(inventory.stockStatus, 'good'),
        eq(inventory.locked, false),
      ))
      .groupBy(inventory.materialId);

    const stockMap = new Map<string, number>();
    for (const s of stockRows) {
      stockMap.set(s.materialId, Number(s.totalQty));
    }

    return subs.map((s) => ({
      materialId: s.substituteMaterialId,
      materialCode: s.substituteMaterialCode,
      materialName: s.substituteMaterialName,
      specification: s.specification ?? undefined,
      unit: s.unit,
      stockQty: stockMap.get(s.substituteMaterialId) ?? 0,
    }));
  }

  // ========== Check Availability ==========

  async checkAvailability(materialCode: string, qty: number): Promise<SubstitutionCheckResult> {
    // Find material
    const matRows = await this.db
      .select({
        id: material.id,
        materialCode: material.materialCode,
        materialName: material.materialName,
      })
      .from(material)
      .where(eq(material.materialCode, materialCode))
      .limit(1);

    if (matRows.length === 0) throw new NotFoundException('物料不存在');
    const mat = matRows[0];

    // Original material good stock total
    const origStockRows = await this.db
      .select({ qty: sql<string>`COALESCE(SUM(${inventory.quantity}), 0)`.as('qty') })
      .from(inventory)
      .where(and(
        eq(inventory.materialId, mat.id),
        eq(inventory.stockStatus, 'good'),
        eq(inventory.locked, false),
      ));

    const originalStockQty = Number(origStockRows[0]?.qty ?? 0);
    const originalSufficient = originalStockQty >= qty;

    // Get all active substitutes with their stock
    const substitutes = await this.getSubstitutesByMaterial(materialCode);

    return {
      originalMaterialCode: mat.materialCode,
      originalMaterialName: mat.materialName,
      originalStockQty,
      requiredQty: qty,
      originalSufficient,
      substitutes,
    };
  }
}
