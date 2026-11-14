import { Injectable, Inject, NotFoundException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { eq, and, ilike, desc, count, sql, inArray } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { readWorkbook, isBlankRow } from '../../common/utils/spreadsheet';
import { normalizeMaterialType } from '../../common/constants/material-types';

import { material, supplier } from '@server/database/schema';
import type {
  Material,
  Supplier,
  PaginatedResponse,
  MaterialImportPreviewResult,
  SupplierImportPreviewResult,
  ImportPreviewItem,
  ImportFieldChange,
  SupplierNameConflict,
  ImportNameChange,
} from '@shared/api.interface';

function extractPostgresErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === 'string') return code;
    current = cause;
  }
  return undefined;
}

interface MaterialQuery {
  page: number;
  pageSize: number;
  materialCode?: string;
  materialName?: string;
  materialType?: string;
  packagingType?: string;
  status?: string;
}

interface SupplierQuery {
  page: number;
  pageSize: number;
  supplierCode?: string;
  supplierName?: string;
  status?: string;
  /** 是否包含已归档（status='archived'）的供应商 */
  includeArchived?: boolean;
}

/** 导入结果（含 dryRun 预检分支与名称变更回报） */
export interface MaterialImportOutcome {
  successCount: number;
  errorCount: number;
  errors: string[];
  totalRows: number;
  removedCount: number;
  /** 被改名的供应商（仅在勾选「同时更新供应商名称」时可能有值） */
  nameChanges: ImportNameChange[];
  /** 导入前自动快照的文件路径 */
  backupFile?: string;
  /** dryRun=true 时返回的校对结果 */
  preview?: MaterialImportPreviewResult;
}

export interface SupplierImportOutcome {
  successCount: number;
  errorCount: number;
  errors: string[];
  totalRows: number;
  removedCount: number;
  nameChanges: ImportNameChange[];
  backupFile?: string;
  preview?: SupplierImportPreviewResult;
}

/** 物料导入解析出的一行（提取到类外，供预检与写入复用） */
interface ParsedMaterialRow {
  supplierName: string;
  materialCode: string;
  materialName: string;
  specification: string;
  unit: string;
  supplierCode: string;
  mslLevel: string;
  grade: string;
  expiryDays: number | null;
  vietnamCode: string;
  status: string;
  forceScrapDays: number | null;
  unitPrice: number;
  materialType: string;
  /** normal | reel；'' = 该行没提供（导入时不覆盖库中值） */
  packagingType: '' | 'normal' | 'reel';
}

/** 供应商导入解析出的一行 */
interface ParsedSupplierRow {
  supplierCode: string;
  supplierName: string;
  contactPerson: string;
  contactPhone: string;
  contactEmail: string;
  address: string;
  status: string;
}

/**
 * MSL 等级归一化（2026-10-18 用户口径：「不管是写的 3 还是 2，统一归成 MSL3 / MSL2」）。
 * 目的：Excel 里写成 3 / "3" / MSL3 / msl3 / ３ / 三级 / 3a 都落成同一个值，
 * 避免同一等级在库里出现多种写法、下拉框选不中、统计分不成组。
 * 规则：数字 1~6（含 a 后缀）→ MSL1~MSL6；不管控/无/无需管控/N/A/no_control → 不管控；
 *      其它无法识别的值原样保留（不猜）。
 */
/**
 * 包装类型归一化：Excel 里写法五花八门（普通 / 盘装 / Reel / 卷装…），
 * 统一落到 normal | reel 两个值。空串返回 ''，表示「该行未提供」，不覆盖库中已有值。
 */
export function normalizePackagingType(raw: unknown): '' | 'normal' | 'reel' {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return '';
  if (/reel|盘|卷|轴|绕|tape\s*&\s*reel/i.test(s)) return 'reel';
  if (/普通|散装|袋装|箱装|normal|bulk|bag|box|按数量|pcs/i.test(s)) return 'normal';
  return '';
}

function normalizeMslLevel(raw: unknown): string {
  const shown = String(raw ?? '').trim();
  if (!shown) return '不管控';
  // 全角数字转半角，去空格
  const s = shown
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\s\u3000]/g, '')
    .toLowerCase();
  if (
    ['不管控', '无需管控', '无需', '无', '-', '--', '/', 'n/a', 'na', 'no', 'none', 'no_control', 'nocontrol', 'null'].includes(s)
  ) {
    return '不管控';
  }
  // 3 / 3a / msl3 / msl-3 / level3 / 3级（后缀 a 保持小写，与下拉选项 MSL2a/MSL5a 一致）
  const m = s.match(/^(?:msl|level)?[-_]?([1-6])([a-z]?)(?:级|等)?$/);
  if (m) return `MSL${m[1]}${m[2] || ''}`;
  // 一~六级
  const cn: Record<string, string> = { 一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6' };
  const cnMatch = s.match(/^(?:msl|level)?([一二三四五六])(?:级)?$/);
  if (cnMatch) return `MSL${cn[cnMatch[1]]}`;
  return shown;
}

/** 字段值统一成可比较的字符串 */
function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value).trim();
  return s === 'null' || s === 'undefined' ? '' : s;
}

/**
 * 表头归一化：去空白/全角空格、全角括号转半角、去掉必填星号和末尾冒号，统一小写。
 * 用户的 Excel 表头常带 *、换行、全角空格，之前会因此认不出列。
 */
function normalizeHeader(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/[\s\u3000]/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/[*＊]/g, '')
    .replace(/[:：]$/, '')
    .toLowerCase();
}

/**
 * 表头 → 字段索引匹配（两轮）：
 *   第一轮 精确匹配：归一化后完全相等（「MSL等级」只命中 mslLevel，不会命中 grade）。
 *   第二轮 包含匹配：处理「MSL等级(Level)」「规格型号/描述」这类带后缀的表头；
 *          先占位的列不会被第二轮二次分配，避免「MSL等级」又被当成「等级」。
 * avoid：给某字段加排除规则，例如 grade 不得命中含 msl/防潮 的列。
 */
function matchHeaderColumns(
  headerRow: unknown[],
  aliases: Record<string, string[]>,
  avoid?: Record<string, RegExp>,
): { headerIndex: Record<string, number>; detectedHeaders: string[] } {
  const headerIndex: Record<string, number> = {};
  const normAliases: Record<string, string[]> = {};
  for (const [key, list] of Object.entries(aliases)) {
    normAliases[key] = list.map((a) => normalizeHeader(a));
  }

  const cells: Array<{ idx: number; name: string }> = [];
  headerRow.forEach((cell, idx) => {
    const name = normalizeHeader(String(cell ?? ''));
    if (name) cells.push({ idx, name });
  });

  const claimed = new Set<number>();
  // 第一轮：精确匹配
  for (const c of cells) {
    for (const [key, list] of Object.entries(normAliases)) {
      if (headerIndex[key] !== undefined) continue;
      if (list.includes(c.name)) {
        headerIndex[key] = c.idx;
        claimed.add(c.idx);
        break;
      }
    }
  }
  // 第二轮：包含匹配（最长别名优先）
  for (const c of cells) {
    if (claimed.has(c.idx)) continue;
    const candidates: Array<{ key: string; len: number }> = [];
    for (const [key, list] of Object.entries(normAliases)) {
      if (headerIndex[key] !== undefined) continue;
      if (avoid?.[key]?.test(c.name)) continue;
      for (const a of list) {
        if (a.length >= 2 && c.name.includes(a)) {
          candidates.push({ key, len: a.length });
          break;
        }
      }
    }
    candidates.sort((a, b) => b.len - a.len);
    if (candidates.length > 0) {
      headerIndex[candidates[0].key] = c.idx;
      claimed.add(c.idx);
    }
  }

  const detectedHeaders = cells.map((c) => String(headerRow[c.idx] ?? '').trim());
  return { headerIndex, detectedHeaders };
}

/**
 * 供应商名称保护 SQL（ON CONFLICT DO UPDATE 的 SET 子句用）。
 * 只有在「系统里名称为空」或「系统里名称等于代码（等于没维护）」时才允许被 Excel 覆盖，
 * 其余情况一律保留系统现有名称。这是 2026-10-18 供应商名称被整批覆写事故的根治方案。
 */
const SUPPLIER_NAME_PRESERVE_SQL =
  "CASE WHEN BTRIM(COALESCE(supplier.supplier_name, '')) = '' " +
  "OR BTRIM(COALESCE(supplier.supplier_name, '')) = BTRIM(COALESCE(supplier.supplier_code, '')) " +
  'THEN excluded.supplier_name ELSE supplier.supplier_name END';

@Injectable()
export class MaterialService {
  private readonly logger = new Logger(MaterialService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  // ========== Material ==========

  async getMaterialList(query: MaterialQuery): Promise<PaginatedResponse<Material>> {
    const { page, pageSize, materialCode, materialName, materialType, packagingType, status } = query;
    const conditions = [];
    if (materialCode) conditions.push(ilike(material.materialCode, `%${materialCode}%`));
    if (materialName) conditions.push(ilike(material.materialName, `%${materialName}%`));
    if (materialType) conditions.push(eq(material.materialType, materialType));
    if (packagingType) conditions.push(eq(material.packagingType, packagingType));
    if (status) conditions.push(eq(material.status, status));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;

    // 供应商名称不在 material 表里（只存 supplier_code），必须 join supplier 才有名字。
    // 2026-10-23 修复：此前只 select material，接口从不返回 supplierName，
    // 前端「供应商名称」列因此恒为空（用户误以为导入把名称弄丢了）。
    const [itemsResult, countResult] = await Promise.all([
      this.db
        .select({ row: material, supplierName: supplier.supplierName })
        .from(material)
        .leftJoin(supplier, eq(material.supplierCode, supplier.supplierCode))
        .where(whereClause)
        .orderBy(desc(material.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(material)
        .where(whereClause),
    ]);

    return {
      items: itemsResult.map((r) => this.toMaterialDto(r.row, r.supplierName)),
      total: Number(countResult[0]?.count ?? 0),
      page,
      pageSize,
    };
  }

  async getAllActiveMaterials(): Promise<Material[]> {
    const rows = await this.db
      .select({ row: material, supplierName: supplier.supplierName })
      .from(material)
      .leftJoin(supplier, eq(material.supplierCode, supplier.supplierCode))
      .where(eq(material.status, 'active'))
      .orderBy(material.materialCode);
    return rows.map((r) => this.toMaterialDto(r.row, r.supplierName));
  }

  async getMaterialById(id: string): Promise<Material> {
    const rows = await this.db
      .select({ row: material, supplierName: supplier.supplierName })
      .from(material)
      .leftJoin(supplier, eq(material.supplierCode, supplier.supplierCode))
      .where(eq(material.id, id))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('物料不存在');
    return this.toMaterialDto(rows[0].row, rows[0].supplierName);
  }

  /**
   * 把 material 行映射为对外 DTO。
   * 供应商名称必须由调用方提供（join 出来的 supplier_name 或按编码二次查询）。
   * 2026-10-23：补齐 packagingType / grade —— 此前映射里漏了这两个字段，
   * 前端「包装类型」列永远显示"普通"，编辑弹窗读不到真实值，
   * 保存时会把盘装料(reel)静默改回普通(normal)。
   */
  private toMaterialDto(row: typeof material.$inferSelect, supplierName?: string | null): Material {
    return {
      id: row.id,
      materialCode: row.materialCode,
      materialName: row.materialName,
      specification: row.specification ?? undefined,
      unit: row.unit,
      materialType: row.materialType ?? undefined,
      packagingType: row.packagingType ?? 'normal',
      grade: row.grade ?? undefined,
      mslLevel: row.mslLevel,
      vietnamCode: row.vietnamCode ?? undefined,
      inspectionStandard: row.inspectionStandard ?? undefined,
      status: row.status,
      description: row.description ?? undefined,
      expiryDays: row.expiryDays ?? undefined,
      supplierCode: row.supplierCode ?? undefined,
      supplierName: supplierName ?? undefined,
      materialSource: row.materialSource ?? undefined,
      forceScrapDays: row.forceScrapDays ?? undefined,
      unitPrice: row.unitPrice != null ? Number(row.unitPrice) : undefined,
      overIssueRatio: row.overIssueRatio ?? undefined,
      supplementRatio: row.supplementRatio ?? undefined,
    };
  }

  /** 按供应商编码批量解析名称（新建/修改物料后返回 DTO 时用，避免再写一次 join） */
  private async resolveSupplierNames(codes: Array<string | null | undefined>): Promise<Map<string, string>> {
    const list = [...new Set(codes.filter((c): c is string => !!c && c.trim() !== ''))];
    if (list.length === 0) return new Map();
    const rows = await this.db
      .select({ code: supplier.supplierCode, name: supplier.supplierName })
      .from(supplier)
      .where(inArray(supplier.supplierCode, list));
    return new Map(rows.map((r) => [r.code, r.name]));
  }

  async createMaterial(data: Omit<Material, 'id'>): Promise<Material> {
    const rows = await this.db
      .insert(material)
      .values({
        materialCode: data.materialCode,
        materialName: data.materialName,
        specification: data.specification,
        unit: data.unit,
        materialType: normalizeMaterialType(data.materialType) || undefined,
        packagingType: (data as any).packagingType || 'normal',
        grade: (data as any).grade,
        mslLevel: normalizeMslLevel(data.mslLevel),
        vietnamCode: data.vietnamCode,
        inspectionStandard: data.inspectionStandard,
        status: data.status,
        description: data.description,
        expiryDays: data.expiryDays,
        supplierCode: data.supplierCode,
        materialSource: data.materialSource,
        forceScrapDays: data.forceScrapDays,
        unitPrice: data.unitPrice != null ? String(data.unitPrice) : undefined,
        overIssueRatio: data.overIssueRatio,
        supplementRatio: data.supplementRatio,
      })
      .returning();
    const row = rows[0];
    const nameMap = await this.resolveSupplierNames([row.supplierCode]);
    return this.toMaterialDto(row, row.supplierCode ? nameMap.get(row.supplierCode) : undefined);
  }

  async updateMaterial(id: string, data: Partial<Omit<Material, 'id'>>): Promise<Material> {
    const patch: Partial<typeof material.$inferInsert> = {};
    if (data.materialCode !== undefined) patch.materialCode = data.materialCode;
    if (data.materialName !== undefined) patch.materialName = data.materialName;
    if (data.specification !== undefined) patch.specification = data.specification;
    if (data.unit !== undefined) patch.unit = data.unit;
    if (data.materialType !== undefined) patch.materialType = normalizeMaterialType(data.materialType) || undefined;
    if ((data as any).packagingType !== undefined) patch.packagingType = (data as any).packagingType;
    if ((data as any).grade !== undefined) patch.grade = (data as any).grade;
    if (data.mslLevel !== undefined) patch.mslLevel = normalizeMslLevel(data.mslLevel);
    if (data.vietnamCode !== undefined) patch.vietnamCode = data.vietnamCode;
    if (data.inspectionStandard !== undefined) patch.inspectionStandard = data.inspectionStandard;
    if (data.status !== undefined) patch.status = data.status;
    if (data.description !== undefined) patch.description = data.description;
    if (data.expiryDays !== undefined) patch.expiryDays = data.expiryDays;
    if (data.supplierCode !== undefined) patch.supplierCode = data.supplierCode;
    if (data.materialSource !== undefined) patch.materialSource = data.materialSource;
    if (data.forceScrapDays !== undefined) patch.forceScrapDays = data.forceScrapDays;
    if (data.unitPrice !== undefined) patch.unitPrice = data.unitPrice != null ? String(data.unitPrice) : undefined;
    if (data.overIssueRatio !== undefined) patch.overIssueRatio = data.overIssueRatio;
    if (data.supplementRatio !== undefined) patch.supplementRatio = data.supplementRatio;

    // 空更新体兜底：drizzle 的 `.set({})` 抛普通 `Error: No values to set`
    // → 会被全局过滤器当未处理异常报 500。属调用方问题，应为 400。
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('没有需要更新的字段');
    }

    const rows = await this.db
      .update(material)
      .set(patch)
      .where(eq(material.id, id))
      .returning();
    if (rows.length === 0) throw new NotFoundException('物料不存在');
    const row = rows[0];
    const nameMap = await this.resolveSupplierNames([row.supplierCode]);
    return this.toMaterialDto(row, row.supplierCode ? nameMap.get(row.supplierCode) : undefined);
  }

  async deleteMaterial(id: string): Promise<void> {
    const rows = await this.db
      .update(material)
      .set({ status: 'inactive' })
      .where(eq(material.id, id))
      .returning({ id: material.id });
    if (rows.length === 0) throw new NotFoundException('物料不存在');
  }

  // ========== Supplier ==========

  async getSupplierList(query: SupplierQuery): Promise<PaginatedResponse<Supplier>> {
    const { page, pageSize, supplierCode, supplierName, status, includeArchived } = query;
    const conditions = [];
    if (supplierCode) conditions.push(ilike(supplier.supplierCode, `%${supplierCode}%`));
    if (supplierName) conditions.push(ilike(supplier.supplierName, `%${supplierName}%`));
    if (status) {
      conditions.push(eq(supplier.status, status));
    } else if (!includeArchived) {
      // 默认不显示已归档，但前端可显式要求包含（避免导入不全后供应商"凭空消失"）
      conditions.push(sql`${supplier.status} <> 'archived'`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;

    const [itemsResult, countResult] = await Promise.all([
      this.db
        .select()
        .from(supplier)
        .where(whereClause)
        .orderBy(desc(supplier.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(supplier)
        .where(whereClause),
    ]);

    const items: Supplier[] = itemsResult.map((row) => ({
      id: row.id,
      supplierCode: row.supplierCode,
      supplierName: row.supplierName,
      supplierNameZh: row.supplierName,
      supplierNameVi: '',
      supplierNameEn: '',
      contactPerson: row.contactPerson ?? undefined,
      contactPhone: row.contactPhone ?? undefined,
      contactEmail: row.contactEmail ?? undefined,
      address: row.address ?? undefined,
      status: row.status,
      description: row.description ?? undefined,
    }));

    return { items, total: Number(countResult[0]?.count ?? 0), page, pageSize };
  }

  async getAllActiveSuppliers(includeArchived = false): Promise<Supplier[]> {
    const rows = await this.db
      .select()
      .from(supplier)
      .where(includeArchived ? sql`${supplier.status} <> 'inactive'` : eq(supplier.status, 'active'))
      .orderBy(supplier.supplierCode);
    return rows.map((row) => ({
      id: row.id,
      supplierCode: row.supplierCode,
      supplierName: row.supplierName,
      supplierNameZh: row.supplierName,
      supplierNameVi: '',
      supplierNameEn: '',
      contactPerson: row.contactPerson ?? undefined,
      contactPhone: row.contactPhone ?? undefined,
      contactEmail: row.contactEmail ?? undefined,
      address: row.address ?? undefined,
      status: row.status,
      description: row.description ?? undefined,
    }));
  }

  async getSupplierById(id: string): Promise<Supplier> {
    const rows = await this.db.select().from(supplier).where(eq(supplier.id, id)).limit(1);
    if (rows.length === 0) throw new NotFoundException('供应商不存在');
    const row = rows[0];
    return {
      id: row.id,
      supplierCode: row.supplierCode,
      supplierName: row.supplierName,
      supplierNameZh: row.supplierName,
      supplierNameVi: '',
      supplierNameEn: '',
      contactPerson: row.contactPerson ?? undefined,
      contactPhone: row.contactPhone ?? undefined,
      contactEmail: row.contactEmail ?? undefined,
      address: row.address ?? undefined,
      status: row.status,
      description: row.description ?? undefined,
    };
  }

  async createSupplier(data: Omit<Supplier, 'id'> & {
    supplierNameZh?: string;
    supplierNameVi?: string;
    supplierNameEn?: string;
  }): Promise<Supplier> {
    const nameZh = data.supplierNameZh || data.supplierName || '';
    let rows;
    try {
      rows = await this.db
        .insert(supplier)
        .values({
          supplierCode: data.supplierCode,
          supplierName: nameZh,
          contactPerson: data.contactPerson,
          contactPhone: data.contactPhone,
          contactEmail: data.contactEmail,
          address: data.address,
          status: data.status,
          description: data.description,
        })
        .returning();
    } catch (err: unknown) {
      const code = extractPostgresErrorCode(err);
      if (code === '23505') {
        throw new ConflictException('供应商编码已存在');
      }
      throw err;
    }
    const row = rows[0];
    return {
      id: row.id,
      supplierCode: row.supplierCode,
      supplierName: row.supplierName,
      supplierNameZh: row.supplierName,
      supplierNameVi: '',
      supplierNameEn: '',
      contactPerson: row.contactPerson ?? undefined,
      contactPhone: row.contactPhone ?? undefined,
      contactEmail: row.contactEmail ?? undefined,
      address: row.address ?? undefined,
      status: row.status,
      description: row.description ?? undefined,
    };
  }

  async updateSupplier(id: string, data: Partial<Omit<Supplier, 'id'>> & {
    supplierNameZh?: string;
    supplierNameVi?: string;
    supplierNameEn?: string;
  }): Promise<Supplier> {
    const patch: Partial<typeof supplier.$inferInsert> = {};
    if (data.supplierCode !== undefined) patch.supplierCode = data.supplierCode;
    if (data.supplierNameZh !== undefined) {
      patch.supplierName = data.supplierNameZh;
    } else if (data.supplierName !== undefined) {
      patch.supplierName = data.supplierName;
    }
    if (data.contactPerson !== undefined) patch.contactPerson = data.contactPerson;
    if (data.contactPhone !== undefined) patch.contactPhone = data.contactPhone;
    if (data.contactEmail !== undefined) patch.contactEmail = data.contactEmail;
    if (data.address !== undefined) patch.address = data.address;
    if (data.status !== undefined) patch.status = data.status;
    if (data.description !== undefined) patch.description = data.description;

    // 空更新体兜底：drizzle 的 `.set({})` 抛普通 `Error: No values to set`
    // → 会被全局过滤器当未处理异常报 500。属调用方问题，应为 400。
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('没有需要更新的字段');
    }

    let rows;
    try {
      rows = await this.db
        .update(supplier)
        .set(patch)
        .where(eq(supplier.id, id))
        .returning();
    } catch (err: unknown) {
      const code = extractPostgresErrorCode(err);
      if (code === '23505') {
        throw new ConflictException('供应商编码已存在');
      }
      throw err;
    }
    if (rows.length === 0) throw new NotFoundException('供应商不存在');
    const row = rows[0];
    return {
      id: row.id,
      supplierCode: row.supplierCode,
      supplierName: row.supplierName,
      supplierNameZh: row.supplierName,
      supplierNameVi: '',
      supplierNameEn: '',
      contactPerson: row.contactPerson ?? undefined,
      contactPhone: row.contactPhone ?? undefined,
      contactEmail: row.contactEmail ?? undefined,
      address: row.address ?? undefined,
      status: row.status,
      description: row.description ?? undefined,
    };
  }

  async deleteSupplier(id: string): Promise<void> {
    const rows = await this.db
      .update(supplier)
      .set({ status: 'inactive' })
      .where(eq(supplier.id, id))
      .returning({ id: supplier.id });
    if (rows.length === 0) throw new NotFoundException('供应商不存在');
  }

  // ========== Batch Import ==========

  async batchImportExcel(
    buffer: Buffer,
    operatorId: string,
    operatorName: string,
    options?: { dryRun?: boolean; applySupplierNameChanges?: boolean },
  ): Promise<MaterialImportOutcome> {
    const errors: string[] = [];
    let successCount = 0;
    let removedCount = 0;
    let totalRows = 0;
    const nameChanges: ImportNameChange[] = [];

    // 1. 解析 Excel / CSV（兼容 Excel 另存的 GBK 编码）
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

    const headerAliases: Record<string, string[]> = {
      supplierName: ['供应商', '供应商名称', '供货商', '供应商名', '供货商名称'],
      materialCode: ['物料长代码', '物料编码', '物料代码', '料号', '物料编号'],
      materialName: ['物料名称', '物料名', '品名'],
      specification: ['规格型号', '规格', '型号'],
      unit: ['单位', '计量单位'],
      supplierCode: ['供应商代码', '供货商代码', '供应商编号', '供应商编码'],
      mslLevel: ['msl', 'msl等级', '防潮等级', 'msl级别', 'msl level'],
      grade: ['等级', '物料等级', '品级', 'grade'],
      expiryDays: ['有效期天数', '有效期(天)', '有效期', '保质期天数', '保质期(天)', '保质期'],
      vietnamCode: ['越南编码', '越语编码', '越南料号', '越南物料编码'],
      status: ['状态', '启用状态', '物料状态'],
      forceScrapDays: ['强制报废期天数', '强制报废期', '强制报废天数'],
      unitPrice: ['单价', '价格', '物料单价'],
      materialType: ['物料类型', '类型', '物料分类'],
      packagingType: ['包装类型', '包装方式', '包装形式', '盘装类型', '包装'],
    };

    const headerAvoid: Record<string, RegExp> = {
      // 「MSL等级」「防潮等级」属于 MSL，不能被同时当成「等级」
      grade: /msl|防潮|level/,
      // 「供应商代码」不能被「物料长代码」抢走
      materialCode: /供应商|供货商/,
      // 「包装类型」不能被「物料类型」的包含匹配（别名含「类型」）抢走
      materialType: /包装|盘装|reel|pkg|packag/i,
      // 「物料类型」也不能被「包装」相关别名反向抢走
      packagingType: /物料类型|物料分类/,
    };

    // 表头探测：有些 Excel 第一行是「物料主数据表」这类大标题（或合并单元格），
    // 真正的表头在第 2~10 行。取「命中别名最多」的那一行当表头，
    // 命中数相同时仍以靠前的行为准（即第一行本来就是表头时行为不变）。
    let headerRowNo = 0;
    let bestScore = -1;
    for (let i = 0; i < Math.min(rows.length, 10); i += 1) {
      const candidate = rows[i];
      if (!Array.isArray(candidate)) continue;
      const score = Object.keys(matchHeaderColumns(candidate, headerAliases, headerAvoid).headerIndex).length;
      if (score > bestScore) {
        bestScore = score;
        headerRowNo = i;
      }
    }

    const headerRow = rows[headerRowNo];
    if (!Array.isArray(headerRow)) {
      throw new BadRequestException('Excel 表头行格式错误');
    }

    const matched = matchHeaderColumns(headerRow, headerAliases, headerAvoid);
    const headerIndex = matched.headerIndex;
    const detectedHeaders = matched.detectedHeaders;

    // 2026-10-18 用户口径：主数据导入的必填字段缺列整批拒绝、缺值逐行拒绝。
    // 2026-10-18 晚修正：「等级」（grade）从必填里移除 —— 该字段在物料列表和编辑表单里
    // 都没有出现，全库 2497 条一直为空，用户的 Excel 也就没有这一列；
    // 之前把它算必填，导致「MSL等级明明填了却报缺少等级」而整批导不进去。
    // 该列存在时仍会读取并入库，只是不再强制。
    const requiredFields: Array<{ key: string; label: string }> = [
      { key: 'materialCode', label: '物料长代码' },
      { key: 'materialName', label: '物料名称' },
      { key: 'specification', label: '规格型号' },
      { key: 'materialType', label: '物料类型' },
      { key: 'unit', label: '单位' },
      { key: 'mslLevel', label: 'MSL等级' },
      { key: 'expiryDays', label: '有效期天数' },
      { key: 'forceScrapDays', label: '强制报废期' },
      { key: 'supplierCode', label: '供应商代码' },
      { key: 'supplierName', label: '供应商名称' },
    ];
    const missingColumns = requiredFields.filter((f) => headerIndex[f.key] === undefined).map((f) => f.label);
    if (missingColumns.length > 0) {
      // 一次性把所有缺失列和识别到的表头都报出来，避免用户猜、也避免报错被截断
      const detail =
        `Excel 缺少必填列：${missingColumns.join('、')}。` +
        `系统识别到的表头（第 ${headerRowNo + 1} 行）：` +
        (detectedHeaders.length > 0 ? detectedHeaders.join(' | ') : '（空）');
      if (!options?.dryRun) throw new BadRequestException(detail);
      return {
        successCount: 0,
        errorCount: 1,
        errors: [detail],
        totalRows: 0,
        removedCount: 0,
        nameChanges: [],
        preview: {
          totalRows: 0,
          validRows: 0,
          errorRows: 1,
          errors: [detail],
          created: [],
          updated: [],
          unchangedCount: 0,
          supplierNameConflicts: [],
          newSuppliers: [],
          archivedMaterials: [],
          detectedHeaders,
          missingColumns,
        },
      };
    }

    const dataRows = rows.slice(headerRowNo + 1);
    totalRows = dataRows.length;

    type ParsedRow = ParsedMaterialRow;

    const validRows: ParsedRow[] = [];

    dataRows.forEach((row: unknown[], index: number) => {
      const rowNum = headerRowNo + index + 2;
      if (!Array.isArray(row)) {
        errors.push(`第 ${rowNum} 行：格式错误`);
        return;
      }
      // Excel 尾部的幽灵空行（有格式无内容）直接跳过，不报错
      if (isBlankRow(row)) {
        return;
      }
      const supplierName = headerIndex.supplierName !== undefined ? String(row[headerIndex.supplierName] ?? '').trim() : '';
      const materialCode = headerIndex.materialCode !== undefined ? String(row[headerIndex.materialCode] ?? '').trim() : '';
      const materialName = headerIndex.materialName !== undefined ? String(row[headerIndex.materialName] ?? '').trim() : '';
      const specification = headerIndex.specification !== undefined ? String(row[headerIndex.specification] ?? '').trim() : '';
      const unit = headerIndex.unit !== undefined ? String(row[headerIndex.unit] ?? '').trim() : '';
      const supplierCode = headerIndex.supplierCode !== undefined ? String(row[headerIndex.supplierCode] ?? '').trim() : '';
      // MSL 等级统一归一：3 / msl3 / ３ / 三级 → MSL3，2a → MSL2a，'-' → 不管控
      const rawMslLevel = headerIndex.mslLevel !== undefined ? String(row[headerIndex.mslLevel] ?? '').trim() : '';
      const mslLevel = rawMslLevel ? normalizeMslLevel(rawMslLevel) : '';
      const grade = headerIndex.grade !== undefined ? String(row[headerIndex.grade] ?? '').trim() : '';
      const expiryRaw = headerIndex.expiryDays !== undefined ? row[headerIndex.expiryDays] : '';
      const rawVietnamCode = headerIndex.vietnamCode !== undefined ? String(row[headerIndex.vietnamCode] ?? '').trim() : '';
      // 越南编码列可能含 VLOOKUP 公式结果 #N/A，视为空
      const vietnamCode = (rawVietnamCode.includes('#N/A') || rawVietnamCode.includes('#n/a')) ? '' : rawVietnamCode;
      const rawStatus = headerIndex.status !== undefined ? String(row[headerIndex.status] ?? '').trim() : '';
      const forceScrapRaw = headerIndex.forceScrapDays !== undefined ? row[headerIndex.forceScrapDays] : '';
      const unitPriceRaw = headerIndex.unitPrice !== undefined ? row[headerIndex.unitPrice] : '';
      // 物料类型归一：other→其他、electronic→电子通用件、塑胶→塑胶件 等，
      // 保证看板下拉框/饼图里不会冒出没定义过的分类；认不出来的原样保留
      const materialTypeRaw = headerIndex.materialType !== undefined ? String(row[headerIndex.materialType] ?? '').trim() : '';
      const materialType = normalizeMaterialType(materialTypeRaw);
      // 包装类型（普通 / 盘装 Reel）：新增列，老模板没有该列时为空 → 不覆盖库中值
      const packagingTypeRaw = headerIndex.packagingType !== undefined
        ? String(row[headerIndex.packagingType] ?? '').trim()
        : '';
      const packagingType = normalizePackagingType(packagingTypeRaw);

      // 行级必填校验：11 个必要字段，任一为空则该行拒绝导入。
      // 一次性把该行所有缺失项报出来，避免用户反复试错。
      const rowValues: Record<string, string> = {
        materialCode,
        materialName,
        specification,
        materialType,
        unit,
        mslLevel,
        grade,
        expiryDays: expiryRaw === null || expiryRaw === undefined ? '' : String(expiryRaw).trim(),
        forceScrapDays: forceScrapRaw === null || forceScrapRaw === undefined ? '' : String(forceScrapRaw).trim(),
        supplierCode,
        supplierName,
      };
      const missing = requiredFields
        .filter((f) => !rowValues[f.key])
        .map((f) => f.label);
      if (missing.length > 0) {
        errors.push(`第 ${rowNum} 行：${missing.join('、')} 不能为空`);
        return;
      }

      let expiryDays: number | null = null;
      if (expiryRaw !== '' && expiryRaw !== null && expiryRaw !== undefined) {
        const num = Number(expiryRaw);
        if (Number.isNaN(num) || !Number.isInteger(num)) {
          errors.push(`第 ${rowNum} 行：有效期天数必须是整数`);
          return;
        }
        expiryDays = num;
      }

      // 强制报废期天数：解析为整数，空则 null
      let forceScrapDays: number | null = null;
      if (forceScrapRaw !== '' && forceScrapRaw !== null && forceScrapRaw !== undefined) {
        const num = Number(forceScrapRaw);
        if (Number.isNaN(num) || !Number.isInteger(num)) {
          errors.push(`第 ${rowNum} 行：强制报废期天数必须是整数`);
          return;
        }
        forceScrapDays = num;
      }

      // 单价：解析为数字，空则 0
      let unitPrice = 0;
      if (unitPriceRaw !== '' && unitPriceRaw !== null && unitPriceRaw !== undefined) {
        const num = Number(unitPriceRaw);
        if (Number.isNaN(num)) {
          errors.push(`第 ${rowNum} 行：单价必须是数字`);
          return;
        }
        unitPrice = num;
      }

      let status = 'active';
      if (rawStatus) {
        const s = rawStatus.replace(/\s/g, '').toLowerCase();
        if (s === '启用' || s === 'active' || s === '正常' || s === '1' || s === '在用') {
          status = 'active';
        } else if (s === '停用' || s === 'inactive' || s === '禁用' || s === '0' || s === '已停用') {
          status = 'inactive';
        } else {
          errors.push(`第 ${rowNum} 行：状态值 "${rawStatus}" 无效，应为「启用」或「停用」`);
          return;
        }
      }

      validRows.push({
        supplierName,
        materialCode,
        materialName,
        specification,
        unit: unit || 'PCS',
        supplierCode,
        mslLevel: mslLevel || '不管控',
        grade,
        expiryDays,
        vietnamCode,
        status,
        forceScrapDays,
        unitPrice,
        materialType,
        packagingType,
      });
    });

    if (validRows.length === 0) {
      if (options?.dryRun) {
        return {
          successCount: 0,
          errorCount: errors.length,
          errors,
          totalRows,
          removedCount: 0,
          nameChanges: [],
          preview: {
            totalRows,
            validRows: 0,
            errorRows: errors.length,
            errors,
            created: [],
            updated: [],
            unchangedCount: 0,
            supplierNameConflicts: [],
            newSuppliers: [],
            archivedMaterials: [],
          },
        };
      }
      return { successCount: 0, errorCount: errors.length, errors, totalRows, removedCount: 0, nameChanges: [] };
    }

    // 2. 物料按 material_code 去重（取第一条）
    const materialMap = new Map<string, ParsedRow & { firstRow: ParsedRow }>();
    for (const r of validRows) {
      if (!materialMap.has(r.materialCode)) {
        materialMap.set(r.materialCode, { ...r, firstRow: r });
      }
    }

    // 3. 供应商按 supplier_code 去重（取第一条）
    const supplierMap = new Map<string, { supplierCode: string; supplierName: string }>();
    for (const r of validRows) {
      if (!supplierMap.has(r.supplierCode)) {
        supplierMap.set(r.supplierCode, {
          supplierCode: r.supplierCode,
          supplierName: r.supplierName,
        });
      }
    }

    // 4. 预检（dryRun）：只比对、不写库，供前端「校对 → 确认 → 导入」两步流程使用
    if (options?.dryRun) {
      const preview = await this.buildMaterialPreview(validRows, materialMap, supplierMap, totalRows, errors);
      return {
        successCount: 0,
        errorCount: errors.length,
        errors,
        totalRows,
        removedCount: 0,
        nameChanges: [],
        preview,
      };
    }

    // 5. 导入前自动快照，出问题可回滚
    const backupFile = await this.snapshotMasterData('material');

    // 6. 事务：全量覆盖。Excel 内的物料/供应商 upsert；Excel 外的旧物料置 archived
    //    （因历史单据有外键引用，不能直接 delete，用 archived 状态让主数据列表不可见）
    await this.db.transaction(async (tx) => {
      const supplierValues = Array.from(supplierMap.values());
      if (supplierValues.length > 0) {
        // 供应商名称保护（2026-10-18 用户口径）：
        //   默认**不覆盖**系统里已有的供应商名称，只有库中名称为空时才补写；
        //   仅当用户在校对弹窗里主动勾选「同时更新供应商名称」时，才以 Excel 为准覆盖。
        // 此前的写法是无条件 `excluded.supplier_name`，导致导物料时把供应商档案
        // 的名称整批改成了 Excel 里的代码/简称（本次事故根因）。
        const supplierNameSet = options?.applySupplierNameChanges
          ? sql.raw('excluded.supplier_name')
          : sql.raw(SUPPLIER_NAME_PRESERVE_SQL);

        if (options?.applySupplierNameChanges) {
          const existing = await tx.select().from(supplier);
          const byCode = new Map(existing.map((s) => [s.supplierCode, s]));
          for (const s of supplierValues) {
            const cur = byCode.get(s.supplierCode);
            const oldName = normalizeCell(cur?.supplierName);
            const newName = normalizeCell(s.supplierName);
            if (cur && oldName && newName && oldName !== newName) {
              nameChanges.push({ supplierCode: s.supplierCode, oldName, newName });
            }
          }
        }

        await tx
          .insert(supplier)
          .values(
            supplierValues.map((s) => ({
              supplierCode: s.supplierCode,
              supplierName: s.supplierName,
              status: 'active',
            })),
          )
          .onConflictDoUpdate({
            target: supplier.supplierCode,
            set: {
              supplierName: supplierNameSet,
              status: 'active',
            },
          });
      }

      const materialValues = Array.from(materialMap.values());
      if (materialValues.length > 0) {
        await tx
          .insert(material)
          .values(
             materialValues.map((m) => ({
              materialCode: m.materialCode,
              materialName: m.materialName,
              specification: m.specification || null,
              unit: m.unit,
              mslLevel: m.mslLevel,
              grade: m.grade || null,
              status: m.status,
              expiryDays: m.expiryDays,
              supplierCode: m.supplierCode,
              vietnamCode: m.vietnamCode || null,
              forceScrapDays: m.forceScrapDays,
              unitPrice: String(m.unitPrice || 0),
              overIssueRatio: 0,
              supplementRatio: 0,
              materialType: m.materialType || null,
              packagingType: m.packagingType || 'normal',
            })),
          )
          .onConflictDoUpdate({
            target: material.materialCode,
            set: {
              materialName: sql.raw('excluded.material_name'),
              specification: sql.raw('excluded.specification'),
              unit: sql.raw('excluded.unit'),
                mslLevel: sql.raw('excluded.msl_level'),
                // 「等级」列在 Excel 里可能没有（历史数据全空）：空值不覆盖库里已有等级
                grade: sql.raw(
                  "CASE WHEN BTRIM(COALESCE(excluded.grade, '')) = '' THEN material.grade ELSE excluded.grade END",
                ),
                status: sql.raw('excluded.status'),
                expiryDays: sql.raw('excluded.expiry_days'),
                supplierCode: sql.raw('excluded.supplier_code'),
                vietnamCode: sql.raw('excluded.vietnam_code'),
                forceScrapDays: sql.raw('excluded.force_scrap_days'),
                unitPrice: sql.raw('excluded.unit_price'),
                materialType: sql.raw('excluded.material_type'),
                // 「包装类型」列可能没写：空值保留库中现有值，避免一次导入把盘装料刷回普通
                packagingType: sql.raw(
                  "CASE WHEN BTRIM(COALESCE(excluded.packaging_type, '')) = '' THEN material.packaging_type ELSE excluded.packaging_type END",
                ),
              },
          });
      }

      // Excel 外的旧物料标记为 archived（主数据列表不再显示，历史单据外键不断链）
      if (materialValues.length > 0) {
        const materialCodes = materialValues.map((m) => m.materialCode);
        const updated = await tx
          .update(material)
          .set({ status: 'archived' })
          .where(sql`${material.materialCode} NOT IN (${sql.join(materialCodes.map((c: string) => sql`${c}`), sql`, `)})`)
          .returning({ id: material.id });
        removedCount = updated.length;
      } else {
        // Excel 为空时把所有物料置 archived
        const updated = await tx
          .update(material)
          .set({ status: 'archived' })
          .returning({ id: material.id });
        removedCount = updated.length;
      }

      successCount = materialValues.length;
    });

    this.logger.log(
      `物料批量导入完成：总行 ${totalRows}，成功 ${successCount} 条，移除 ${removedCount} 条，错误 ${errors.length} 条，` +
        `改名 ${nameChanges.length} 条，快照 ${backupFile}，操作人：${operatorName} (${operatorId})`,
    );

    return {
      successCount,
      errorCount: errors.length,
      errors,
      totalRows,
      removedCount,
      nameChanges,
      backupFile,
    };
  }

  // ========== Supplier Batch Import ==========

  async batchImportSuppliers(
    buffer: Buffer,
    operatorId: string,
    operatorName: string,
    options?: { dryRun?: boolean; applySupplierNameChanges?: boolean },
  ): Promise<SupplierImportOutcome> {
    const errors: string[] = [];
    let successCount = 0;
    let removedCount = 0;
    let totalRows = 0;
    const nameChanges: ImportNameChange[] = [];

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

    const supplierHeaderAliases: Record<string, string[]> = {
      supplierCode: ['供应商代码', '供货商代码', '供应商编号', '供应商编码'],
      supplierName: ['供应商名称', '供应商', '供货商名称', '供货商', '供应商名'],
      contactPerson: ['联系人', '对接人', '负责人'],
      contactPhone: ['联系电话', '电话', '手机号', '手机号码', '联系电话/微信'],
      contactEmail: ['联系邮箱', '邮箱', 'email', 'e-mail', '电子邮箱'],
      status: ['状态', '启用状态', '供应商状态'],
      address: ['地址', '公司地址', '详细地址'],
    };

    // 与物料导入一致：表头可能不在第一行（标题行/合并单元格），取命中最多的一行
    let supHeaderRowNo = 0;
    let supBestScore = -1;
    for (let i = 0; i < Math.min(rows.length, 10); i += 1) {
      const candidate = rows[i];
      if (!Array.isArray(candidate)) continue;
      const score = Object.keys(matchHeaderColumns(candidate, supplierHeaderAliases).headerIndex).length;
      if (score > supBestScore) {
        supBestScore = score;
        supHeaderRowNo = i;
      }
    }

    const headerRow = rows[supHeaderRowNo];
    if (!Array.isArray(headerRow)) {
      throw new BadRequestException('Excel 表头行格式错误');
    }

    const supMatched = matchHeaderColumns(headerRow, supplierHeaderAliases);
    const headerIndex = supMatched.headerIndex;
    const supDetectedHeaders = supMatched.detectedHeaders;

    if (headerIndex.supplierCode === undefined) {
      throw new BadRequestException(
        `Excel 缺少必填列：供应商代码。系统识别到的表头（第 ${supHeaderRowNo + 1} 行）：` +
          (supDetectedHeaders.length > 0 ? supDetectedHeaders.join(' | ') : '（空）'),
      );
    }
    if (headerIndex.supplierName === undefined) {
      throw new BadRequestException(
        `Excel 缺少必填列：供应商名称。系统识别到的表头（第 ${supHeaderRowNo + 1} 行）：` +
          (supDetectedHeaders.length > 0 ? supDetectedHeaders.join(' | ') : '（空）'),
      );
    }

    const dataRows = rows.slice(supHeaderRowNo + 1);
    totalRows = dataRows.length;

    type ParsedSupplier = ParsedSupplierRow;

    const validRows: ParsedSupplier[] = [];

    dataRows.forEach((row: unknown[], index: number) => {
      const rowNum = supHeaderRowNo + index + 2;
      if (!Array.isArray(row)) {
        errors.push(`第 ${rowNum} 行：格式错误`);
        return;
      }
      // Excel 尾部的幽灵空行（有格式无内容）直接跳过，不报错
      if (isBlankRow(row)) {
        return;
      }
      const supplierCode = headerIndex.supplierCode !== undefined ? String(row[headerIndex.supplierCode] ?? '').trim() : '';
      const supplierName = headerIndex.supplierName !== undefined ? String(row[headerIndex.supplierName] ?? '').trim() : '';
      const contactPerson = headerIndex.contactPerson !== undefined ? String(row[headerIndex.contactPerson] ?? '').trim() : '';
      const contactPhone = headerIndex.contactPhone !== undefined ? String(row[headerIndex.contactPhone] ?? '').trim() : '';
      const contactEmail = headerIndex.contactEmail !== undefined ? String(row[headerIndex.contactEmail] ?? '').trim() : '';
      const address = headerIndex.address !== undefined ? String(row[headerIndex.address] ?? '').trim() : '';
      const rawStatus = headerIndex.status !== undefined ? String(row[headerIndex.status] ?? '').trim() : '';
      let status = 'active';
      if (rawStatus) {
        const s = rawStatus.replace(/\s/g, '').toLowerCase();
        if (s === '启用' || s === 'active' || s === '正常' || s === '1') {
          status = 'active';
        } else if (s === '停用' || s === 'inactive' || s === '禁用' || s === '0' || s === '已停用') {
          status = 'inactive';
        } else {
          errors.push(`第 ${rowNum} 行：状态值 "${rawStatus}" 无效，应为「启用」或「停用」`);
          return;
        }
      }

      if (!supplierCode) {
        errors.push(`第 ${rowNum} 行：供应商代码不能为空`);
        return;
      }
      if (!supplierName) {
        errors.push(`第 ${rowNum} 行：供应商名称不能为空`);
        return;
      }

      validRows.push({ supplierCode, supplierName, contactPerson, contactPhone, contactEmail, address, status });
    });

    if (validRows.length === 0) {
      if (options?.dryRun) {
        return {
          successCount: 0,
          errorCount: errors.length,
          errors,
          totalRows,
          removedCount: 0,
          nameChanges: [],
          preview: {
            totalRows,
            validRows: 0,
            errorRows: errors.length,
            errors,
            created: [],
            updated: [],
            unchangedCount: 0,
            nameConflicts: [],
            archivedSuppliers: [],
          },
        };
      }
      return { successCount: 0, errorCount: errors.length, errors, totalRows, removedCount: 0, nameChanges: [] };
    }

    // 按 supplier_code 去重（取第一条）
    const supplierMap = new Map<string, ParsedSupplier>();
    for (const r of validRows) {
      if (!supplierMap.has(r.supplierCode)) {
        supplierMap.set(r.supplierCode, r);
      }
    }

    const supplierValues = Array.from(supplierMap.values());

    // 预检（dryRun）：只比对、不写库
    if (options?.dryRun) {
      const preview = await this.buildSupplierPreview(validRows, supplierMap, totalRows, errors);
      return {
        successCount: 0,
        errorCount: errors.length,
        errors,
        totalRows,
        removedCount: 0,
        nameChanges: [],
        preview,
      };
    }

    // 导入前自动快照，出问题可回滚
    const backupFile = await this.snapshotMasterData('supplier');

    await this.db.transaction(async (tx) => {
      // 供应商名称保护：默认不覆盖已有名称，只在库中名称为空/等于代码时补写；
      // 用户在校对弹窗勾选「同时更新供应商名称」后才以 Excel 为准。
      const nameSet = options?.applySupplierNameChanges
        ? sql.raw('excluded.supplier_name')
        : sql.raw(SUPPLIER_NAME_PRESERVE_SQL);

      if (options?.applySupplierNameChanges) {
        const existing = await tx.select().from(supplier);
        const byCode = new Map(existing.map((s) => [s.supplierCode, s]));
        for (const s of supplierValues) {
          const cur = byCode.get(s.supplierCode);
          const oldName = normalizeCell(cur?.supplierName);
          const newName = normalizeCell(s.supplierName);
          if (cur && oldName && newName && oldName !== newName) {
            nameChanges.push({ supplierCode: s.supplierCode, oldName, newName });
          }
        }
      }

      // upsert 供应商：Excel 内的插入或更新为 active
      await tx
        .insert(supplier)
        .values(
           supplierValues.map((s) => ({
             supplierCode: s.supplierCode,
             supplierName: s.supplierName,
             contactPerson: s.contactPerson || null,
             contactPhone: s.contactPhone || null,
             contactEmail: s.contactEmail || null,
             address: s.address || null,
             status: s.status,
           })),
        )
        .onConflictDoUpdate({
          target: supplier.supplierCode,
          set: {
            supplierName: nameSet,
            contactPerson: sql.raw('excluded.contact_person'),
            contactPhone: sql.raw('excluded.contact_phone'),
             contactEmail: sql.raw('excluded.contact_email'),
             address: sql.raw('excluded.address'),
             status: sql.raw('excluded.status'),
          },
        });

      // Excel 外的旧供应商标记为 archived（主数据列表默认不显示，历史单据外键不断链）
      // 只统计本次真正发生状态变化的，避免把历史已归档的重复计入「移除」数
      const updated = await tx
        .update(supplier)
        .set({ status: 'archived' })
        .where(
          sql`${supplier.supplierCode} NOT IN (${sql.join(supplierValues.map((s: ParsedSupplier) => sql`${s.supplierCode}`), sql`, `)})
              AND ${supplier.status} = 'active'`,
        )
        .returning({ id: supplier.id });
      removedCount = updated.length;

      successCount = supplierValues.length;
    });

    this.logger.log(
      `供应商批量导入完成：总行 ${totalRows}，成功 ${successCount} 条，移除 ${removedCount} 条，错误 ${errors.length} 条，` +
        `改名 ${nameChanges.length} 条，快照 ${backupFile}，操作人：${operatorName} (${operatorId})`,
    );

    return {
      successCount,
      errorCount: errors.length,
      errors,
      totalRows,
      removedCount,
      nameChanges,
      backupFile,
    };
  }

  // ==================== 导入校对（只读） ====================

  /**
   * 物料导入预检：拿 Excel 解析结果与系统现有主数据逐字段比对，**不写任何数据**。
   * 前端先展示这份报告，用户确认后才真正调用导入。
   */
  private async buildMaterialPreview(
    validRows: ParsedMaterialRow[],
    materialMap: Map<string, ParsedMaterialRow & { firstRow: ParsedMaterialRow }>,
    supplierMap: Map<string, { supplierCode: string; supplierName: string }>,
    totalRows: number,
    errors: string[],
  ): Promise<MaterialImportPreviewResult> {
    const [existingMats, existingSups] = await Promise.all([
      this.db.select().from(material),
      this.db.select().from(supplier),
    ]);
    const matByCode = new Map(existingMats.map((m) => [m.materialCode, m]));
    const supByCode = new Map(existingSups.map((s) => [s.supplierCode, s]));

    const created: ImportPreviewItem[] = [];
    const updated: ImportPreviewItem[] = [];
    let unchangedCount = 0;

    for (const [code, r] of materialMap) {
      const cur = matByCode.get(code);
      if (!cur) {
        created.push({ code, name: r.materialName, action: 'create', changes: [] });
        continue;
      }
      const changes: ImportFieldChange[] = [];
      const cmp = (field: string, oldV: unknown, newV: unknown): void => {
        const a = normalizeCell(oldV);
        const b = normalizeCell(newV);
        if (a !== b) changes.push({ field, oldValue: a, newValue: b });
      };
      cmp('物料名称', cur.materialName, r.materialName);
      cmp('规格型号', cur.specification, r.specification);
      cmp('物料类型', cur.materialType, r.materialType);
      cmp('单位', cur.unit, r.unit);
      cmp('MSL', cur.mslLevel, r.mslLevel);
      // 等级为选填列：文件里没写就不参与比对，避免显示成「等级：A → 空」
      if (normalizeCell(r.grade)) cmp('等级', cur.grade, r.grade);
      cmp('有效期天数', cur.expiryDays, r.expiryDays);
      cmp('强制报废期', cur.forceScrapDays, r.forceScrapDays);
      cmp('供应商代码', cur.supplierCode, r.supplierCode);
      cmp('越南编码', cur.vietnamCode, r.vietnamCode);
      cmp('状态', cur.status, r.status);
      cmp('单价', cur.unitPrice, r.unitPrice);
      // 包装类型为选填列：文件里没写就不参与比对
      if (r.packagingType) {
        const pkLabel = (v: unknown) => (String(v) === 'reel' ? '盘装料(Reel)' : '普通');
        if (pkLabel(cur.packagingType) !== pkLabel(r.packagingType)) {
          changes.push({
            field: '包装类型',
            oldValue: pkLabel(cur.packagingType),
            newValue: pkLabel(r.packagingType),
          });
        }
      }

      if (changes.length > 0) {
        updated.push({ code, name: r.materialName, action: 'update', changes });
      } else {
        unchangedCount += 1;
      }
    }

    // 供应商名称冲突：系统里已有名称，且与 Excel 不一致（导入默认不会改它）
    const supplierNameConflicts: SupplierNameConflict[] = [];
    const newSuppliers: { code: string; name: string }[] = [];
    for (const [code, s] of supplierMap) {
      const cur = supByCode.get(code);
      const incoming = normalizeCell(s.supplierName);
      if (!cur) {
        newSuppliers.push({ code, name: incoming });
        continue;
      }
      const existingName = normalizeCell(cur.supplierName);
      const isPlaceholder =
        !existingName || existingName === normalizeCell(cur.supplierCode);
      if (!isPlaceholder && incoming && existingName !== incoming) {
        supplierNameConflicts.push({
          supplierCode: code,
          existingName,
          incomingName: incoming,
          affectedRows: validRows.filter((x) => x.supplierCode === code).length,
        });
      }
    }
    supplierNameConflicts.sort((a, b) => b.affectedRows - a.affectedRows);

    // 不在 Excel 中、当前仍为 active 的物料将被归档
    const incomingCodes = new Set(materialMap.keys());
    const archivedMaterials = existingMats
      .filter((m) => m.status === 'active' && !incomingCodes.has(m.materialCode))
      .map((m) => ({ code: m.materialCode, name: m.materialName }));

    return {
      totalRows,
      validRows: materialMap.size,
      errorRows: errors.length,
      errors,
      created,
      updated,
      unchangedCount,
      supplierNameConflicts,
      newSuppliers,
      archivedMaterials,
    };
  }

  /**
   * 供应商导入预检：与系统现有供应商档案比对，**不写任何数据**。
   */
  private async buildSupplierPreview(
    validRows: ParsedSupplierRow[],
    supplierMap: Map<string, ParsedSupplierRow>,
    totalRows: number,
    errors: string[],
  ): Promise<SupplierImportPreviewResult> {
    const existingSups = await this.db.select().from(supplier);
    const supByCode = new Map(existingSups.map((s) => [s.supplierCode, s]));

    const created: ImportPreviewItem[] = [];
    const updated: ImportPreviewItem[] = [];
    const nameConflicts: SupplierNameConflict[] = [];
    let unchangedCount = 0;

    for (const [code, r] of supplierMap) {
      const cur = supByCode.get(code);
      if (!cur) {
        created.push({ code, name: r.supplierName, action: 'create', changes: [] });
        continue;
      }

      const changes: ImportFieldChange[] = [];
      const cmp = (field: string, oldV: unknown, newV: unknown): void => {
        const a = normalizeCell(oldV);
        const b = normalizeCell(newV);
        if (a !== b) changes.push({ field, oldValue: a, newValue: b });
      };
      cmp('联系人', cur.contactPerson, r.contactPerson);
      cmp('联系电话', cur.contactPhone, r.contactPhone);
      cmp('联系邮箱', cur.contactEmail, r.contactEmail);
      cmp('地址', cur.address, r.address);
      cmp('状态', cur.status, r.status);

      const existingName = normalizeCell(cur.supplierName);
      const incoming = normalizeCell(r.supplierName);
      const isPlaceholder = !existingName || existingName === normalizeCell(cur.supplierCode);
      if (!isPlaceholder && incoming && existingName !== incoming) {
        nameConflicts.push({
          supplierCode: code,
          existingName,
          incomingName: incoming,
          affectedRows: validRows.filter((x) => x.supplierCode === code).length,
        });
      }

      if (changes.length > 0) {
        updated.push({ code, name: r.supplierName, action: 'update', changes });
      } else {
        unchangedCount += 1;
      }
    }
    nameConflicts.sort((a, b) => a.supplierCode.localeCompare(b.supplierCode));

    const incomingCodes = new Set(supplierMap.keys());
    const archivedSuppliers = existingSups
      .filter((s) => s.status === 'active' && !incomingCodes.has(s.supplierCode))
      .map((s) => ({ code: s.supplierCode, name: normalizeCell(s.supplierName) }));

    return {
      totalRows,
      validRows: supplierMap.size,
      errorRows: errors.length,
      errors,
      created,
      updated,
      unchangedCount,
      nameConflicts,
      archivedSuppliers,
    };
  }

  /**
   * 导入前把主数据导出成 CSV 快照，落到 backups/import-snapshots/。
   * 快照失败不阻断导入，只记警告（不能因为备份影响业务）。
   */
  private async snapshotMasterData(kind: 'material' | 'supplier'): Promise<string> {
    try {
      const dir = path.join(process.cwd(), 'backups', 'import-snapshots');
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date()
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\..+$/, '')
        .replace('T', '-');
      const file = path.join(dir, `${kind}-${stamp}.csv`);

      const esc = (v: unknown): string => {
        const s = v === null || v === undefined ? '' : String(v);
        return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };

      const lines: string[] = [];
      if (kind === 'supplier') {
        const rows = await this.db.select().from(supplier);
        lines.push('supplier_code,supplier_name,contact_person,contact_phone,contact_email,address,status');
        for (const r of rows) {
          lines.push(
            [r.supplierCode, r.supplierName, r.contactPerson, r.contactPhone, r.contactEmail, r.address, r.status]
              .map(esc)
              .join(','),
          );
        }
      } else {
        const rows = await this.db.select().from(material);
        lines.push(
          'material_code,material_name,specification,material_type,unit,msl_level,grade,supplier_code,status',
        );
        for (const r of rows) {
          lines.push(
            [r.materialCode, r.materialName, r.specification, r.materialType, r.unit, r.mslLevel, r.grade, r.supplierCode, r.status]
              .map(esc)
              .join(','),
          );
        }
      }

      // 带 BOM，Excel 直接打开不乱码
      fs.writeFileSync(file, '\uFEFF' + lines.join('\r\n'), 'utf8');
      this.logger.log(`导入前快照已保存：${file}`);
      return file;
    } catch (err) {
      this.logger.warn(`导入前快照失败（${kind}）：${(err as Error)?.message ?? String(err)}`);
      return '';
    }
  }
}
