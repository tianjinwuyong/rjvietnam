/**
 * 主数据「清空」服务（物料主数据 / 供应商档案 / 替代关系 / 仓库档案 / 仓库地址码档案）。
 *
 * 与「系统初始化」是同一套安全思路，但作用域收窄到指定主数据表：
 *   1. 身份只取登录态 userId，再由 SystemService 查库重验密码哈希（不信任前端）；
 *   2. 双因子确认：确认短语必须逐字匹配 + 当前登录密码正确；
 *   3. 全程单事务：DELETE 与依赖检查要么全成、要么全不动；
 *   4. 安全拦截：若目标表（或其连带子表）被其它表以外键引用且**有数据**，中止并列出阻挡表。
 *      绝不做 CASCADE —— 不允许「清物料顺手把库存/收货/IQC 一起删掉」这种事发生。
 *   5. 连带子表（cascade）：仅用于「子表在语义上从属于目标表」的情形，
 *      目前只有 仓库档案 → 仓库地址码档案（地址码本就属于仓库，清仓库时一并清）。
 *      连带清空仍受第 4 条约束：库存/收货/移库引用了地址码时，同样会被拦住。
 *
 * 注意：本项目的列表「删除」按钮多为软删除（改 status），本服务是真正的物理删除，
 * 二者语义不同，不要互相替代。
 */
import { Injectable, Inject, BadRequestException, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { SystemService } from './system.service';

/** 支持清空的目标 */
export type MasterDataTarget =
  | 'material'
  | 'supplier'
  | 'substitution'
  | 'warehouse'
  | 'location';

interface TargetDef {
  /** 物理表名 */
  table: string;
  /** 确认短语（须逐字输入） */
  confirmPhrase: string;
  /**
   * 连带清空的子表（在事务内先删子表、再删目标表）。
   * 仅当子表在语义上从属于目标表时使用；业务数据（库存/单据等）永远不在此列。
   */
  cascade?: string[];
}

const TARGETS: Record<MasterDataTarget, TargetDef> = {
  material: { table: 'material', confirmPhrase: '清空物料' },
  supplier: { table: 'supplier', confirmPhrase: '清空供应商' },
  substitution: { table: 'material_substitution', confirmPhrase: '清空替代关系' },
  // 地址码从属于仓库：清仓库时连带清地址码（但库存/收货/移库仍会拦住）
  warehouse: { table: 'warehouse', confirmPhrase: '清空仓库', cascade: ['warehouse_location'] },
  location: { table: 'warehouse_location', confirmPhrase: '清空地址码' },
};

/** 永远不允许清空的系统保留表 */
const PROTECTED_TABLES = ['sys_account', 'sys_role', 'sys_param', '_drizzle_migrations'];

export interface MasterDataClearPreview {
  target: MasterDataTarget;
  table: string;
  confirmPhrase: string;
  /** 目标表当前行数（将被删除） */
  rowCount: number;
  /** 连带清空的子表及其行数 */
  cascaded: { table: string; rowCount: number }[];
  /** 外键引用「目标表 + 连带子表」的表 */
  referencingTables: string[];
  /** 有数据的引用表——它们会阻止清空 */
  blockers: { table: string; rowCount: number }[];
  /** 是否会被拦截 */
  blocked: boolean;
}

export interface MasterDataClearResult {
  target: MasterDataTarget;
  table: string;
  /** 目标表被删除的行数 */
  deletedRows: number;
  /** 连带清空的子表行数（合计） */
  cascadedRows: number;
}

interface DbExec {
  execute: (query: unknown) => Promise<unknown>;
}

@Injectable()
export class MasterDataClearService {
  private readonly logger = new Logger(MasterDataClearService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly systemService: SystemService,
  ) {}

  // ========== 工具 ==========

  private resolveTarget(target: string): TargetDef {
    const def = TARGETS[target as MasterDataTarget];
    if (!def) {
      throw new BadRequestException(`不支持清空的目标：${target}`);
    }
    return def;
  }

  /** 目标表 + 连带子表（本次操作涉及的全部物理表） */
  private involvedTables(def: TargetDef): string[] {
    return [def.table, ...(def.cascade || [])];
  }

  /** db.execute 的返回统一成行数组（postgres-js 直接返回数组） */
  private extractRows<T = Record<string, unknown>>(result: unknown): T[] {
    if (Array.isArray(result)) return result as T[];
    const maybe = result as { rows?: unknown } | null;
    if (maybe && Array.isArray(maybe.rows)) return maybe.rows as T[];
    return [];
  }

  private quoteIdent(name: string): string {
    return `"${String(name).replace(/"/g, '""')}"`;
  }

  /** 统计单张表的行数 */
  private async countTable(exec: DbExec, table: string): Promise<number> {
    const result = await exec.execute(
      sql.raw(`SELECT count(*)::bigint AS n FROM public.${this.quoteIdent(table)}`),
    );
    const rows = this.extractRows<{ n: string | number }>(result);
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * 查「哪些表通过外键引用了这张表」。
   * 动态取自 information_schema，而不是硬编码清单 —— 日后新增业务表无需改动本服务。
   */
  private async listReferencingTables(table: string): Promise<string[]> {
    const result = await this.db.execute(sql`
      SELECT DISTINCT tc.table_name AS table_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND ccu.table_name = ${table}
      ORDER BY tc.table_name
    `);
    return this.extractRows<{ table_name: string }>(result)
      .map((r) => r.table_name)
      .filter((n): n is string => Boolean(n));
  }

  /**
   * 计算「引用目标表或其子表的其它表」及其中「有数据、会阻止清空」的那些。
   * 本次操作自身涉及的表（目标表 + 连带子表）不计入阻挡。
   */
  private async findBlockers(
    exec: DbExec,
    def: TargetDef,
  ): Promise<{ referencingTables: string[]; blockers: { table: string; rowCount: number }[] }> {
    const involved = this.involvedTables(def);
    const involvedSet = new Set(involved);

    const refSet = new Set<string>();
    for (const t of involved) {
      for (const r of await this.listReferencingTables(t)) {
        if (!involvedSet.has(r)) refSet.add(r);
      }
    }

    const referencingTables = [...refSet].sort();
    const counts = await Promise.all(
      referencingTables.map(async (t) => ({ table: t, rowCount: await this.countTable(exec, t) })),
    );
    return { referencingTables, blockers: counts.filter((c) => c.rowCount > 0) };
  }

  /** 连带子表各自的行数（用于预览展示） */
  private async countCascade(
    exec: DbExec,
    def: TargetDef,
  ): Promise<{ table: string; rowCount: number }[]> {
    const tables = def.cascade || [];
    return Promise.all(
      tables.map(async (t) => ({ table: t, rowCount: await this.countTable(exec, t) })),
    );
  }

  // ========== 预览 ==========

  /**
   * 清空预览：只读，返回目标表与连带子表的行数、以及被依赖情况。
   * 让界面在点按钮之前就把「会删掉什么 / 会不会被拦住」摆出来。
   */
  async preview(target: string): Promise<MasterDataClearPreview> {
    const def = this.resolveTarget(target);
    const rowCount = await this.countTable(this.db, def.table);
    const cascaded = await this.countCascade(this.db, def);
    const { referencingTables, blockers } = await this.findBlockers(this.db, def);
    return {
      target: target as MasterDataTarget,
      table: def.table,
      confirmPhrase: def.confirmPhrase,
      rowCount,
      cascaded,
      referencingTables,
      blockers,
      blocked: blockers.length > 0,
    };
  }

  // ========== 执行清空 ==========

  /**
   * 清空目标主数据表（含连带子表）。
   *
   * 顺序与安全约束：
   *  1. 短语逐字校验 + 密码查库重验（SystemService.verifyAccountPassword）
   *  2. 服务层再确认一次 roleCode=admin（不依赖路由装饰器单一防线）
   *  3. 事务内再查一次依赖，有阻挡直接中止（避免预览与执行之间的竞态）
   *  4. 先删连带子表、再删目标表；均为单条 DELETE，不做 CASCADE
   */
  async clear(
    target: string,
    params: { userId: string; password: string; confirmText: string },
  ): Promise<MasterDataClearResult> {
    const def = this.resolveTarget(target);
    const { userId, password, confirmText } = params;

    if (!userId) {
      throw new BadRequestException('未获取到登录用户信息，请重新登录');
    }
    if (!password) {
      throw new BadRequestException('请输入当前登录密码');
    }
    const phrase = String(confirmText || '').trim();
    if (phrase !== def.confirmPhrase) {
      throw new BadRequestException(`确认短语不正确，请输入「${def.confirmPhrase}」`);
    }

    const caller = await this.systemService.verifyAccountPassword(userId, password);
    if (!caller) {
      throw new BadRequestException('当前登录密码不正确');
    }
    if (caller.roleCode !== 'admin') {
      throw new BadRequestException('只有系统管理员可以清空主数据');
    }

    // 兜底防护：涉及的表绝不能包含系统保留表
    for (const t of this.involvedTables(def)) {
      if (PROTECTED_TABLES.includes(t)) {
        throw new BadRequestException('该表为系统保留表，不允许清空');
      }
    }

    let deletedRows = 0;
    let cascadedRows = 0;
    try {
      const summary = await this.db.transaction(async (tx) => {
        const { blockers } = await this.findBlockers(tx, def);
        if (blockers.length > 0) {
          const detail = blockers.map((b) => `${b.table}(${b.rowCount} 行)`).join('、');
          throw new BadRequestException(
            `存在依赖数据，无法清空 ${def.table}：${detail}。请先清理这些数据。`,
          );
        }

        // 先删连带子表（它们是目标表的引用方），再删目标表
        let cascaded = 0;
        for (const child of def.cascade || []) {
          cascaded += await this.countTable(tx, child);
          await tx.execute(sql.raw(`DELETE FROM public.${this.quoteIdent(child)}`));
        }

        const before = await this.countTable(tx, def.table);
        await tx.execute(sql.raw(`DELETE FROM public.${this.quoteIdent(def.table)}`));
        return { deletedRows: before, cascadedRows: cascaded };
      });
      deletedRows = summary.deletedRows;
      cascadedRows = summary.cascadedRows;
    } catch (error) {
      // 外键兜底：理论上上面已拦截，这里防止并发写入造成的漏网
      if (this.extractPgCode(error) === '23503') {
        throw new BadRequestException(
          `存在依赖数据，无法清空 ${def.table}。请先清理引用它的业务数据。`,
        );
      }
      throw error;
    }

    this.logger.warn(
      `主数据清空：${def.table} 删除 ${deletedRows} 行` +
        (cascadedRows ? `，连带删除 ${cascadedRows} 行` : '') +
        `，操作者=${caller.account}`,
    );

    return {
      target: target as MasterDataTarget,
      table: def.table,
      deletedRows,
      cascadedRows,
    };
  }

  /** 从异常链里取 PostgreSQL 错误码（drizzle 会把 code 裹在 cause 里） */
  private extractPgCode(error: unknown): string | undefined {
    let current: unknown = error;
    for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
      const { code, cause } = current as { code?: unknown; cause?: unknown };
      if (typeof code === 'string') return code;
      current = cause;
    }
    return undefined;
  }
}
