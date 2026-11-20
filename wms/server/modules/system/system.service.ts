import { Inject, Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { eq, and, like, gte, lt, ne, desc, count, inArray, sql, asc } from 'drizzle-orm';
import * as crypto from 'crypto';
import * as XLSX from 'xlsx';
import { readWorkbook, isBlankRow } from '../../common/utils/spreadsheet';
import { setSystemEpoch } from '../../common/auth/system-epoch';
import type {
  SysParam,
  OperationLog,
  RoleUser,
  PaginatedResponse,
  SysRole,
  SysAccount,
  SysAccountImportResult,
  LoginResult,
  BatchCreateLocationResult,
} from '@shared/api.interface';

import {
  sysParam,
  operationLog,
  roleUser,
  sysRole,
  sysAccount,
  warehouseLocation,
  warehouse,
} from '@server/database/schema';

export interface RoleInfo {
  roleCode: string;
  roleNameZh: string;
  roleNameEn: string;
  roleNameVi: string;
}

const ROLE_LIST: RoleInfo[] = [
  { roleCode: 'admin', roleNameZh: '系统管理员', roleNameEn: 'Admin', roleNameVi: 'Quản trị viên' },
  { roleCode: 'wh_manager', roleNameZh: '仓库主管', roleNameEn: 'Warehouse Manager', roleNameVi: 'Trưởng bộ phận kho' },
  { roleCode: 'wh_keeper', roleNameZh: '仓管员', roleNameEn: 'Warehouse Keeper', roleNameVi: 'Nhân viên kho' },
  { roleCode: 'iqc_inspector', roleNameZh: 'IQC检验员', roleNameEn: 'IQC Inspector', roleNameVi: 'Nhân viên kiểm tra IQC' },
  { roleCode: 'iqc_manager', roleNameZh: 'IQC主管', roleNameEn: 'IQC Manager', roleNameVi: 'Trưởng bộ phận IQC' },
  { roleCode: 'sqe', roleNameZh: 'SQE', roleNameEn: 'SQE', roleNameVi: 'SQE' },
  { roleCode: 'planner', roleNameZh: '计划员', roleNameEn: 'Planner', roleNameVi: 'Nhân viên kế hoạch' },
  { roleCode: 'plan_manager', roleNameZh: '计划部主管', roleNameEn: 'Planning Manager', roleNameVi: 'Trưởng bộ phận kế hoạch' },
  { roleCode: 'production_material_smt', roleNameZh: 'SMT物料员', roleNameEn: 'SMT Material Handler', roleNameVi: 'Nhân viên vật tư SMT' },
  { roleCode: 'production_material_dip', roleNameZh: '插件物料员', roleNameEn: 'DIP Material Handler', roleNameVi: 'Nhân viên vật tư DIP' },
  { roleCode: 'production_material_assembly', roleNameZh: '组装物料员', roleNameEn: 'Assembly Material Handler', roleNameVi: 'Nhân viên vật tư Lắp ráp' },
  { roleCode: 'production_material_packing', roleNameZh: '包装物料员', roleNameEn: 'Packing Material Handler', roleNameVi: 'Nhân viên vật tư Đóng gói' },
  { roleCode: 'production_manager', roleNameZh: '生产主管', roleNameEn: 'Production Manager', roleNameVi: 'Trưởng bộ phận sản xuất' },
  { roleCode: 'engineer', roleNameZh: '工程师', roleNameEn: 'Engineer', roleNameVi: 'Kỹ sư' },
  { roleCode: 'quality_manager', roleNameZh: '质量经理', roleNameEn: 'Quality Manager', roleNameVi: 'Trưởng bộ phận chất lượng' },
  { roleCode: 'mrb_reviewer', roleNameZh: 'MRB评审员', roleNameEn: 'MRB Reviewer', roleNameVi: 'Người đánh giá MRB' },
];

/**
 * 新建账号的默认初始密码。
 * 与 `createAccount` / `resetPassword` 保持同一约定；批量导入时模版里
 * 「初始密码」列留空则用它，填了则以填写的为准。
 */
const DEFAULT_ACCOUNT_PASSWORD = '123';

/** 自助改密时新密码的长度下限 */
export const PASSWORD_MIN_LENGTH = 6;
/** 自助改密时新密码的长度上限 */
export const PASSWORD_MAX_LENGTH = 32;

/**
 * 弱口令黑名单。
 *
 * 这些取值在 WMS 现场等同于「没有密码」：默认初始密码、纯重复数字、
 * 纯顺序数字、以及通用字典词。改密时一律拒绝，避免用户把默认密码
 * 换成另一个同样好猜的密码。
 */
const WEAK_PASSWORDS = new Set([
  '123', '1234', '12345', '123456', '1234567', '12345678', '123456789',
  '111111', '000000', '666666', '888888', '999999', '11111111', '88888888',
  'abc123', 'admin', 'admin123', 'password', 'passw0rd', 'qwerty',
  'a123456', '123456a', '123qwe', 'qwe123',
]);

/**
 * 校验新密码是否合规，返回中文错误原因；合规返回 null。
 *
 * 抽成不访问数据库的纯函数，便于逐条验证边界（长度、一致性、
 * 与原密码重复、弱口令），不依赖接口调用。
 */
export function validateNewPassword(
  newPassword: string,
  confirmPassword: string,
  oldPassword: string,
): string | null {
  if (!newPassword.trim()) {
    return '新密码不能全部为空格';
  }
  if (newPassword.length < PASSWORD_MIN_LENGTH || newPassword.length > PASSWORD_MAX_LENGTH) {
    return `新密码长度需为 ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} 位`;
  }
  if (newPassword !== confirmPassword) {
    return '两次输入的新密码不一致';
  }
  if (newPassword === oldPassword) {
    return '新密码不能与原密码相同';
  }
  if (WEAK_PASSWORDS.has(newPassword.toLowerCase())) {
    return '新密码过于简单，请避免使用连续或重复数字';
  }
  return null;
}

/** 允许的所属工段取值（与前端 WORK_SECTION_OPTIONS 一致）；留空 = 不限 */
const WORK_SECTION_ALLOWED = ['smt', 'dip', 'assembly', 'packing'];

/** 工段列的中/英/越别名 → 标准值 */
const WORK_SECTION_ALIASES: Record<string, string> = {
  'smt': 'smt',
  'smt车间': 'smt',
  'smt段': 'smt',
  'dip': 'dip',
  'dip插件': 'dip',
  'dip段': 'dip',
  '插件': 'dip',
  'assembly': 'assembly',
  '组装': 'assembly',
  '组装段': 'assembly',
  'packing': 'packing',
  '包装': 'packing',
  '包装段': 'packing',
  '不限': '',
  '无': '',
  'none': '',
  '-': '',
  '--': '',
};

@Injectable()
export class SystemService {
  private readonly logger = new Logger(SystemService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  // ========== 系统参数 ==========

  async getParamList(params: {
    page: number;
    pageSize: number;
    paramKey?: string;
  }): Promise<PaginatedResponse<SysParam>> {
    const { page, pageSize, paramKey } = params;

    const conditions = [];
    if (paramKey) conditions.push(like(sysParam.paramKey, `%${paramKey}%`));

    const baseQuery = this.db
      .select({
        id: sysParam.id,
        paramKey: sysParam.paramKey,
        paramValue: sysParam.paramValue,
        paramNameZh: sysParam.paramNameZh,
        paramNameVi: sysParam.paramNameVi,
        paramNameEn: sysParam.paramNameEn,
        description: sysParam.description,
      })
      .from(sysParam);

    const whereQuery = conditions.length > 0
      ? baseQuery.where(and(...conditions))
      : baseQuery;

    const countResult = await this.db
      .select({ count: count() })
      .from(sysParam)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const total = Number(countResult[0]?.count || 0);

    const items = await whereQuery
      .orderBy(desc(sysParam.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return {
      items: items as unknown as SysParam[],
      total,
      page,
      pageSize,
    };
  }

  async createParam(params: {
    paramKey: string;
    paramValue: string;
    paramNameZh?: string;
    paramNameVi?: string;
    paramNameEn?: string;
    description?: string;
  }): Promise<SysParam> {
    const { paramKey, paramValue, paramNameZh, paramNameVi, paramNameEn, description } = params;

    if (!paramKey || !paramValue) {
      throw new BadRequestException('参数键和参数值不能为空');
    }

    // 检查是否已存在
    const existing = await this.db
      .select({ id: sysParam.id })
      .from(sysParam)
      .where(eq(sysParam.paramKey, paramKey))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException('参数键已存在');
    }

    const result = await this.db
      .insert(sysParam)
      .values({
        paramKey,
        paramValue,
        paramNameZh,
        paramNameVi,
        paramNameEn,
        description,
      })
      .returning();

    return result[0] as unknown as SysParam;
  }

  async updateParam(id: string, params: Partial<{
    paramValue: string;
    paramNameZh: string;
    paramNameVi: string;
    paramNameEn: string;
    description: string;
  }>): Promise<SysParam> {
    const existing = await this.db
      .select({ id: sysParam.id })
      .from(sysParam)
      .where(eq(sysParam.id, id))
      .limit(1);

    if (existing.length === 0) {
      throw new NotFoundException('系统参数不存在');
    }

    const patch: Partial<typeof sysParam.$inferInsert> = {};
    if (params.paramValue !== undefined) patch.paramValue = params.paramValue;
    if (params.paramNameZh !== undefined) patch.paramNameZh = params.paramNameZh;
    if (params.paramNameVi !== undefined) patch.paramNameVi = params.paramNameVi;
    if (params.paramNameEn !== undefined) patch.paramNameEn = params.paramNameEn;
    if (params.description !== undefined) patch.description = params.description;

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('未提供可更新字段');
    }

    const result = await this.db
      .update(sysParam)
      .set(patch)
      .where(eq(sysParam.id, id))
      .returning();

    return result[0] as unknown as SysParam;
  }

  async deleteParam(id: string): Promise<void> {
    const result = await this.db
      .delete(sysParam)
      .where(eq(sysParam.id, id))
      .returning({ id: sysParam.id });

    if (result.length === 0) {
      throw new NotFoundException('系统参数不存在');
    }
  }

  async getParamByKey(key: string): Promise<SysParam> {
    const result = await this.db
      .select()
      .from(sysParam)
      .where(eq(sysParam.paramKey, key))
      .limit(1);

    if (result.length === 0) {
      throw new NotFoundException('系统参数不存在');
    }

    return result[0] as unknown as SysParam;
  }

  // ========== 操作日志 ==========

  async getOperationLogList(params: {
    page: number;
    pageSize: number;
    module?: string;
    operation?: string;
    operator?: string;
    startDate?: string;
    endDate?: string;
    relatedId?: string;
  }): Promise<PaginatedResponse<OperationLog>> {
    const { page, pageSize, module: bizType, operation: action, operator, startDate, endDate, relatedId: bizId } = params;

    const conditions = [];
    if (bizType) conditions.push(eq(operationLog.bizType, bizType));
    if (action) conditions.push(eq(operationLog.action, action));
    if (operator) conditions.push(like(operationLog.operatorName, `%${operator}%`));
    if (startDate) conditions.push(gte(operationLog.createdAt, new Date(startDate)));
    if (endDate) conditions.push(lt(operationLog.createdAt, new Date(endDate)));
    if (bizId) conditions.push(eq(operationLog.bizId, bizId));

    const baseQuery = this.db
      .select({
        id: operationLog.id,
        bizType: operationLog.bizType,
        bizId: operationLog.bizId,
        bizNo: operationLog.bizNo,
        action: operationLog.action,
        actionDetail: operationLog.actionDetail,
        operatorId: operationLog.operatorId,
        operatorName: operationLog.operatorName,
        ipAddress: operationLog.ipAddress,
        createdAt: operationLog.createdAt,
      })
      .from(operationLog);

    const whereQuery = conditions.length > 0
      ? baseQuery.where(and(...conditions))
      : baseQuery;

    const countResult = await this.db
      .select({ count: count() })
      .from(operationLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const total = Number(countResult[0]?.count || 0);

    const items = await whereQuery
      .orderBy(desc(operationLog.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return {
      items: items.map((item: any) => ({
        ...item,
        createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
        ipAddress: undefined,
      })),
      total,
      page,
      pageSize,
    };
  }

  async createOperationLog(params: {
    module: string;
    operation: string;
    operatorId: string;
    operatorName?: string;
    relatedId?: string;
    detail?: string;
    ip?: string;
  }): Promise<OperationLog> {
    const { module: bizType, operation: action, operatorId, operatorName, relatedId: bizId, detail: actionDetail, ip: ipAddress } = params;

    const result = await this.db
      .insert(operationLog)
      .values({
        bizType,
        action,
        operatorId,
        operatorName,
        bizId,
        actionDetail,
        ipAddress,
      })
      .returning();

    const row = result[0] as any;
    return {
      id: row.id,
      bizType: row.bizType,
      bizId: row.bizId ?? undefined,
      bizNo: row.bizNo ?? undefined,
      action: row.action,
      actionDetail: row.actionDetail ?? undefined,
      operatorId: row.operatorId ?? undefined,
      operatorName: row.operatorName ?? undefined,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    };
  }

  // ========== 角色 ==========

  async getRoleList(): Promise<RoleInfo[]> {
    return ROLE_LIST;
  }

  async getRoleUserList(params: {
    page: number;
    pageSize: number;
    roleCode?: string;
  }): Promise<PaginatedResponse<RoleUser>> {
    const { page, pageSize, roleCode } = params;

    const conditions = [];
    if (roleCode) conditions.push(eq(roleUser.roleCode, roleCode));

    const baseQuery = this.db
      .select({
        id: roleUser.id,
        roleCode: roleUser.roleCode,
        userId: roleUser.userId,
        userName: roleUser.userName,
        workSection: roleUser.workSection,
        status: roleUser.status,
      })
      .from(roleUser);

    const whereQuery = conditions.length > 0
      ? baseQuery.where(and(...conditions))
      : baseQuery;

    const countResult = await this.db
      .select({ count: count() })
      .from(roleUser)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const total = Number(countResult[0]?.count || 0);

    const items = await whereQuery
      .orderBy(roleUser.roleCode, roleUser.userName)
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return {
      items: items as unknown as RoleUser[],
      total,
      page,
      pageSize,
    };
  }

  // ========== 密码工具 ==========

  private hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
    return `pbkdf2:sha256:100000:${salt}:${hash}`;
  }

  private verifyPassword(password: string, passwordHash: string): boolean {
    try {
      const parts = passwordHash.split(':');
      if (parts.length !== 5) return false;
      const iterations = parseInt(parts[2], 10);
      const salt = parts[3];
      const expectedHash = parts[4];
      const actualHash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha256').toString('hex');
      return actualHash === expectedHash;
    } catch {
      return false;
    }
  }

  /**
   * 校验「某个账号的当前登录密码」——供其它模块的危险操作（如主数据清空）做二次确认。
   *
   * 与系统初始化同一口径：身份只按 userId 查库、密码重验哈希，不信任前端传参。
   * 角色码一并返回，便于调用方自行判断（本方法不替调用方做授权决定）。
   * 账号不存在或密码错误一律返回 null。
   */
  async verifyAccountPassword(
    userId: string,
    password: string,
  ): Promise<{ account: string; roleCode: string } | null> {
    if (!userId || !password) return null;
    const rows = await this.db
      .select({
        account: sysAccount.account,
        roleCode: sysAccount.roleCode,
        passwordHash: sysAccount.passwordHash,
      })
      .from(sysAccount)
      .where(eq(sysAccount.id, userId))
      .limit(1);
    if (rows.length === 0) return null;
    if (!this.verifyPassword(password, rows[0].passwordHash || '')) return null;
    return { account: rows[0].account, roleCode: rows[0].roleCode };
  }

  async initRolesIfEmpty(): Promise<void> {
    const existing = await this.db.select({ roleCode: sysRole.roleCode }).from(sysRole).limit(1);
    if (existing.length > 0) return;

    const defaultPermissions = [
      '/',
      '/warehouse', '/warehouse/list', '/warehouse/location',
      '/material', '/material/list', '/material/supplier',
      '/receipt', '/receipt/scan', '/receipt/list',
      '/iqc', '/iqc/pending', '/iqc/record', '/iqc/report', '/iqc/template',
      '/inventory', '/inventory/query', '/inventory/intra-transfer', '/inventory/transfer', '/inventory/expiry',
      '/bom', '/bom/list',
      '/workorder', '/workorder/list', '/workorder/requirement', '/workorder/picking', '/workorder/picking-approval', '/workorder/supplement', '/workorder/supplement-record',
      '/issuing', '/issuing/list',
      '/mrb', '/mrb/list', '/mrb/task',
      '/rework', '/rework/list',
      '/supplier-return', '/supplier-return/list',
      '/system', '/system/param', '/system/role', '/system/account',
    ];

    const rolePermissionsMap: Record<string, string[]> = {
      // 默认权限 = 前端静态表 ∪ 后端默认映射；角色菜单为空时按此初始化（2026-10-20 统一）
      admin: defaultPermissions,
      wh_manager: ['/', '/inventory', '/inventory/defective-move', '/inventory/defective-transfer', '/inventory/expiry', '/inventory/query', '/inventory/stock-take', '/inventory/transfer', '/material', '/material/supplier', '/receipt/list', '/rework', '/rework/list', '/supplier-return', '/supplier-return/list', '/warehouse', '/warehouse/list', '/warehouse/location'],
      wh_keeper: ['/', '/inventory', '/inventory/defective-move', '/inventory/defective-transfer', '/inventory/expiry', '/inventory/intra-transfer', '/inventory/query', '/inventory/stock-take', '/inventory/transfer', '/issuing', '/issuing/list', '/material', '/receipt', '/receipt/list', '/receipt/scan', '/rework', '/rework/list', '/supplier-return', '/supplier-return/list', '/warehouse', '/warehouse/list', '/warehouse/location'],
      iqc_inspector: ['/', '/iqc', '/iqc/pending', '/iqc/production-return-pending', '/iqc/record', '/iqc/report', '/iqc/stats', '/material', '/receipt/list', '/rework', '/rework/list'],
      iqc_manager: ['/', '/inventory', '/inventory/expiry', '/inventory/query', '/iqc', '/iqc/pending', '/iqc/production-return-pending', '/iqc/record', '/iqc/report', '/iqc/standard-library', '/iqc/stats', '/iqc/strictness', '/iqc/supplier-debt', '/iqc/template', '/material', '/material/list', '/material/supplier', '/mrb', '/mrb/list', '/receipt/list', '/rework', '/rework/list', '/supplier-return', '/supplier-return/list'],
      sqe: ['/', '/iqc', '/iqc/report', '/iqc/stats', '/iqc/supplier-debt', '/material', '/material/list', '/material/supplier', '/mrb', '/mrb/list', '/mrb/task', '/rework', '/rework/list', '/supplier-return', '/supplier-return/list'],
      planner: ['/', '/bom', '/bom/list', '/inventory', '/inventory/query', '/material', '/production', '/production/over-supplement-report', '/production/supplement', '/production/supplement-record', '/workorder', '/workorder/list', '/workorder/requirement', '/workorder/supplement', '/workorder/supplement-record'],
      plan_manager: ['/', '/bom', '/bom/list', '/inventory', '/inventory/query', '/material', '/production', '/production/over-supplement-report', '/production/supplement', '/production/supplement-record', '/workorder', '/workorder/list', '/workorder/requirement', '/workorder/supplement', '/workorder/supplement-record'],
      production_material_smt: ['/', '/inventory', '/inventory/query', '/production', '/production/over-picking', '/production/production-return', '/workorder', '/workorder/picking'],
      production_material_dip: ['/', '/inventory', '/inventory/query', '/production', '/production/over-picking', '/production/production-return', '/workorder', '/workorder/picking'],
      production_material_assembly: ['/', '/inventory', '/inventory/query', '/production', '/production/over-picking', '/production/production-return', '/workorder', '/workorder/picking'],
      production_material_packing: ['/', '/inventory', '/inventory/query', '/production', '/production/over-picking', '/production/production-return', '/workorder', '/workorder/picking'],
      production_manager: ['/', '/inventory', '/inventory/query', '/issuing', '/issuing/list', '/production', '/production/over-picking', '/production/over-supplement-report', '/production/picking-approval', '/production/picking-receive', '/production/reel-settlement', '/production/production-return', '/production/supplement', '/production/supplement-record', '/workorder', '/workorder/picking', '/workorder/picking-approval', '/workorder/supplement', '/workorder/supplement-record'],
      engineer: ['/', '/bom', '/bom/list', '/material', '/material/list', '/material/supplier'],
      quality_manager: ['/', '/inventory', '/inventory/expiry', '/inventory/query', '/iqc', '/iqc/pending', '/iqc/production-return-pending', '/iqc/record', '/iqc/report', '/iqc/standard-library', '/iqc/stats', '/iqc/strictness', '/iqc/supplier-debt', '/iqc/template', '/material', '/material/list', '/material/supplier', '/mrb', '/mrb/list', '/mrb/task', '/production/over-supplement-report', '/rework', '/rework/list', '/supplier-return', '/supplier-return/list'],
      mrb_reviewer: ['/', '/iqc', '/iqc/report', '/mrb', '/mrb/task'],
    };

    for (const r of ROLE_LIST) {
      const perms = rolePermissionsMap[r.roleCode] || [];
      await this.db.insert(sysRole).values({
        roleCode: r.roleCode,
        roleName: r.roleNameZh,
        description: r.roleNameEn,
        menuPermissions: perms,
        status: 'active',
      });
    }
  }

  async syncRolePermissions(): Promise<void> {
    const validPermissions = new Set([
      '/',
      '/warehouse', '/warehouse/list', '/warehouse/location',
      '/material', '/material/list', '/material/supplier', '/material/substitution',
      '/receipt', '/receipt/scan', '/receipt/list', '/receipt/production-return',
      '/iqc', '/iqc/pending', '/iqc/record', '/iqc/report', '/iqc/template', '/iqc/standard-library', '/iqc/stats', '/iqc/strictness', '/iqc/production-return-pending', '/iqc/supplier-debt',
      '/inventory', '/inventory/query', '/inventory/intra-transfer', '/inventory/defective-transfer', '/inventory/defective-move', '/inventory/transfer', '/inventory/expiry', '/inventory/stock-take',
      '/bom', '/bom/list',
      '/workorder', '/workorder/list', '/workorder/requirement', '/workorder/picking', '/workorder/picking-approval', '/workorder/supplement', '/workorder/supplement-record',
      '/production', '/production/production-return', '/production/picking-approval', '/production/picking-receive', '/production/reel-settlement', '/production/over-picking', '/production/supplement', '/production/supplement-record', '/production/over-supplement-report',
      '/issuing', '/issuing/list', '/issuing/records',
      '/mrb', '/mrb/list', '/mrb/task',
      '/rework', '/rework/list',
      '/supplier-return', '/supplier-return/list',
      '/system', '/system/param', '/system/role', '/system/account',
    ]);

    const allPerms = Array.from(validPermissions);
    const allRoles = await this.db.select().from(sysRole);
    for (const role of allRoles) {
      const perms = role.menuPermissions || [];
      if (role.roleCode === 'admin') {
        await this.db.update(sysRole)
          .set({ menuPermissions: allPerms })
          .where(eq(sysRole.id, role.id));
      } else {
        const cleaned = perms.filter(p => validPermissions.has(p));
        if (cleaned.length !== perms.length) {
          await this.db.update(sysRole)
            .set({ menuPermissions: cleaned })
            .where(eq(sysRole.id, role.id));
        }
      }
    }
  }

  async syncAccountWorkSections(): Promise<void> {
    const MATERIAL_ROLE_SECTION: Record<string, string> = {
      production_material_smt: 'smt',
      production_material_dip: 'dip',
      production_material_assembly: 'assembly',
      production_material_packing: 'packing',
    };

    for (const [roleCode, section] of Object.entries(MATERIAL_ROLE_SECTION)) {
      await this.db.update(sysAccount)
        .set({ workSection: section })
        .where(and(
          eq(sysAccount.roleCode, roleCode),
          sql`${sysAccount.workSection} IS NULL`,
        ));
    }
  }

  async syncAccountPlatformUserIds(): Promise<void> {
    const ROLE_PLATFORM_IDS: Record<string, string> = {
      admin: '1847292357012580',
      wh_manager: '1847292986161210',
      wh_keeper: '1838411738368010',
      iqc_inspector: '1847292458018820',
      iqc_manager: '1847286122258458',
      sqe: '1846114399229988',
      planner: '1847298549409911',
      plan_manager: '1847291727560708',
      production_material_smt: '1848568929333380',
      production_material_dip: '1847751107397639',
      production_material_assembly: '1847292357012581',
      production_material_packing: '1847292986161211',
      production_manager: '1838411738368011',
      engineer: '1847292458018821',
      quality_manager: '1847286122258459',
      mrb_reviewer: '1846114399229989',
    };

    for (const [roleCode, platformId] of Object.entries(ROLE_PLATFORM_IDS)) {
      const existing = await this.db
        .select({ id: sysAccount.id })
        .from(sysAccount)
        .where(eq(sysAccount.platformUserId, platformId))
        .limit(1);
      if (existing.length > 0) continue;

      const rows = await this.db
        .select({ id: sysAccount.id })
        .from(sysAccount)
        .where(and(
          eq(sysAccount.roleCode, roleCode),
          sql`${sysAccount.platformUserId} IS NULL`,
        ))
        .orderBy(asc(sysAccount.createdAt))
        .limit(1);

      if (rows.length > 0) {
        await this.db.update(sysAccount)
          .set({ platformUserId: platformId })
          .where(eq(sysAccount.id, rows[0].id));
      }
    }
  }

  async initAdminIfEmpty(): Promise<void> {
    const existing = await this.db.select({ id: sysAccount.id }).from(sysAccount).where(eq(sysAccount.account, 'admin')).limit(1);
    if (existing.length > 0) return;
    await this.db.insert(sysAccount).values({
      account: 'admin',
      passwordHash: this.hashPassword('admin'),
      name: '系统管理员',
      roleCode: 'admin',
      status: 'active',
      isFirstLogin: true,
    });
  }

  // ========== 登录 ==========

  async login(account: string, password: string): Promise<LoginResult> {
    if (!account || !password) {
      throw new BadRequestException('账号和密码不能为空');
    }

    const result = await this.db
      .select()
      .from(sysAccount)
      .where(eq(sysAccount.account, account))
      .limit(1);

    if (result.length === 0) {
      throw new BadRequestException('账号或密码错误');
    }

    const row = result[0];
    if (row.status !== 'active') {
      throw new BadRequestException('账号已被停用，请联系管理员');
    }

    if (!this.verifyPassword(password, row.passwordHash || '')) {
      throw new BadRequestException('账号或密码错误');
    }

    const roleResult = await this.db
      .select({ menuPermissions: sysRole.menuPermissions, roleCode: sysRole.roleCode })
      .from(sysRole)
      .where(eq(sysRole.roleCode, row.roleCode || ''))
      .limit(1);

    const menuPermissions = roleResult[0]?.menuPermissions || [];

    await this.db
      .update(sysAccount)
      .set({ lastLoginAt: new Date() })
      .where(eq(sysAccount.id, row.id));

    const { generateToken } = await import('../../common/auth/jwt-auth.guard');
    const token = generateToken({
      userId: row.id,
      username: row.account || '',
      role: row.roleCode || '',
      roleName: row.name || '',
    });

    return {
      id: row.id,
      account: row.account || '',
      name: row.name || '',
      roleCode: row.roleCode || '',
      workSection: row.workSection || undefined,
      isFirstLogin: row.isFirstLogin || false,
      menuPermissions: (menuPermissions as string[]) || [],
      token,
    };
  }

  /**
   * 当前登录账号的最新状态（供前端刷新本地登录态）。
   *
   * 为什么需要这个接口：登录态连同 `isFirstLogin` 一起被缓存在各端 localStorage，
   * 用户在 PC 端完成改密后，PDA 端的缓存仍是改密前的 `true`，于是再次弹出改密框
   * ——「改密状态」是账号级事实，却依赖了端级缓存，跨端就对不上。
   * 前端在启动时用它对齐服务端状态，即可消除这种不一致。
   */
  async getCurrentUser(userId: string) {
    if (!userId) {
      throw new BadRequestException('未获取到登录用户信息，请重新登录');
    }

    const rows = await this.db
      .select()
      .from(sysAccount)
      .where(eq(sysAccount.id, userId))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException('账号不存在');
    }

    const row = rows[0];

    const roleResult = await this.db
      .select({ menuPermissions: sysRole.menuPermissions })
      .from(sysRole)
      .where(eq(sysRole.roleCode, row.roleCode || ''))
      .limit(1);

    return {
      id: row.id,
      account: row.account || '',
      name: row.name || '',
      roleCode: row.roleCode || '',
      workSection: row.workSection || undefined,
      isFirstLogin: row.isFirstLogin || false,
      menuPermissions: (roleResult[0]?.menuPermissions as string[]) || [],
    };
  }

  // ========== 角色管理 ==========

  async getSysRoleList(params: {
    page: number;
    pageSize: number;
    roleName?: string;
    status?: string;
  }): Promise<PaginatedResponse<SysRole>> {
    const { page, pageSize, roleName, status } = params;

    const conditions = [];
    if (roleName) conditions.push(like(sysRole.roleName, `%${roleName}%`));
    if (status) conditions.push(eq(sysRole.status, status));

    const baseQuery = this.db
      .select({
        id: sysRole.id,
        roleCode: sysRole.roleCode,
        roleName: sysRole.roleName,
        description: sysRole.description,
        menuPermissions: sysRole.menuPermissions,
        status: sysRole.status,
        createdAt: sysRole.createdAt,
      })
      .from(sysRole);

    const whereQuery = conditions.length > 0
      ? baseQuery.where(and(...conditions))
      : baseQuery;

    const countResult = await this.db
      .select({ count: count() })
      .from(sysRole)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const total = Number(countResult[0]?.count || 0);

    const items = await whereQuery
      .orderBy(desc(sysRole.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return {
      items: items.map((item: any) => ({
        ...item,
        menuPermissions: (item.menuPermissions as string[]) || [],
        createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  async getAllRoles(): Promise<SysRole[]> {
    const items = await this.db
      .select({
        id: sysRole.id,
        roleCode: sysRole.roleCode,
        roleName: sysRole.roleName,
        status: sysRole.status,
        menuPermissions: sysRole.menuPermissions,
      })
      .from(sysRole)
      .where(eq(sysRole.status, 'active'))
      .orderBy(sysRole.roleCode);

    return items.map((item: any) => ({
      ...item,
      menuPermissions: (item.menuPermissions as string[]) || [],
    }));
  }

  async createRole(params: {
    roleCode: string;
    roleName: string;
    description?: string;
    menuPermissions: string[];
  }): Promise<SysRole> {
    const { roleCode, roleName, description, menuPermissions } = params;

    if (!roleCode || !roleName) {
      throw new BadRequestException('角色编码和名称不能为空');
    }

    const existing = await this.db.select({ id: sysRole.id }).from(sysRole).where(eq(sysRole.roleCode, roleCode)).limit(1);
    if (existing.length > 0) {
      throw new ConflictException('角色编码已存在');
    }

    const result = await this.db
      .insert(sysRole)
      .values({ roleCode, roleName, description, menuPermissions, status: 'active' })
      .returning();

    const row = result[0] as any;
    return {
      id: row.id,
      roleCode: row.roleCode,
      roleName: row.roleName,
      description: row.description ?? undefined,
      menuPermissions: (row.menuPermissions as string[]) || [],
      status: row.status,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    };
  }

  async updateRole(id: string, params: Partial<{
    roleName: string;
    description: string;
    menuPermissions: string[];
    status: string;
  }>): Promise<SysRole> {
    const existing = await this.db.select({ id: sysRole.id }).from(sysRole).where(eq(sysRole.id, id)).limit(1);
    if (existing.length === 0) {
      throw new NotFoundException('角色不存在');
    }

    const patch: Partial<typeof sysRole.$inferInsert> = {};
    if (params.roleName !== undefined) patch.roleName = params.roleName;
    if (params.description !== undefined) patch.description = params.description;
    if (params.menuPermissions !== undefined) patch.menuPermissions = params.menuPermissions;
    if (params.status !== undefined) patch.status = params.status;

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('未提供可更新字段');
    }

    const result = await this.db.update(sysRole).set(patch).where(eq(sysRole.id, id)).returning();
    const row = result[0] as any;
    return {
      id: row.id,
      roleCode: row.roleCode,
      roleName: row.roleName,
      description: row.description ?? undefined,
      menuPermissions: (row.menuPermissions as string[]) || [],
      status: row.status,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    };
  }

  // ========== 账号管理 ==========

  async getAccountList(params: {
    page: number;
    pageSize: number;
    account?: string;
    name?: string;
    roleCode?: string;
    status?: string;
  }): Promise<PaginatedResponse<SysAccount>> {
    const { page, pageSize, account: accountKw, name: nameKw, roleCode, status } = params;

    const conditions = [];
    if (accountKw) conditions.push(like(sysAccount.account, `%${accountKw}%`));
    if (nameKw) conditions.push(like(sysAccount.name, `%${nameKw}%`));
    if (roleCode) conditions.push(eq(sysAccount.roleCode, roleCode));
    if (status) conditions.push(eq(sysAccount.status, status));

    const baseQuery = this.db
      .select({
        id: sysAccount.id,
        account: sysAccount.account,
        name: sysAccount.name,
        roleCode: sysAccount.roleCode,
        workSection: sysAccount.workSection,
        status: sysAccount.status,
        isFirstLogin: sysAccount.isFirstLogin,
        lastLoginAt: sysAccount.lastLoginAt,
        createdAt: sysAccount.createdAt,
      })
      .from(sysAccount);

    const whereQuery = conditions.length > 0
      ? baseQuery.where(and(...conditions))
      : baseQuery;

    const countResult = await this.db
      .select({ count: count() })
      .from(sysAccount)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const total = Number(countResult[0]?.count || 0);

    const items = await whereQuery
      .orderBy(desc(sysAccount.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return {
      items: items.map((item: any) => ({
        ...item,
        lastLoginAt: item.lastLoginAt instanceof Date ? item.lastLoginAt.toISOString() : item.lastLoginAt,
        createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  async createAccount(params: {
    account: string;
    name: string;
    roleCode: string;
    workSection?: string;
  }): Promise<SysAccount> {
    const { account, name, roleCode, workSection } = params;

    if (!account || !name || !roleCode) {
      throw new BadRequestException('账号、姓名、角色不能为空');
    }

    const existing = await this.db.select({ id: sysAccount.id }).from(sysAccount).where(eq(sysAccount.account, account)).limit(1);
    if (existing.length > 0) {
      throw new ConflictException('账号已存在');
    }

    const result = await this.db
      .insert(sysAccount)
      .values({
        account,
        name,
        roleCode,
        workSection,
        passwordHash: this.hashPassword('123'),
        status: 'active',
        isFirstLogin: true,
      })
      .returning();

    const row = result[0] as any;
    return {
      id: row.id,
      account: row.account,
      name: row.name,
      roleCode: row.roleCode,
      workSection: row.workSection ?? undefined,
      status: row.status,
      isFirstLogin: row.isFirstLogin,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    };
  }

  async updateAccount(id: string, params: Partial<{
    name: string;
    roleCode: string;
    workSection: string;
    status: string;
  }>): Promise<SysAccount> {
    const existing = await this.db.select({ id: sysAccount.id }).from(sysAccount).where(eq(sysAccount.id, id)).limit(1);
    if (existing.length === 0) {
      throw new NotFoundException('账号不存在');
    }

    const patch: Partial<typeof sysAccount.$inferInsert> = {};
    if (params.name !== undefined) patch.name = params.name;
    if (params.roleCode !== undefined) patch.roleCode = params.roleCode;
    if (params.workSection !== undefined) patch.workSection = params.workSection;
    if (params.status !== undefined) patch.status = params.status;

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('未提供可更新字段');
    }

    const result = await this.db.update(sysAccount).set(patch).where(eq(sysAccount.id, id)).returning();
    const row = result[0] as any;
    return {
      id: row.id,
      account: row.account,
      name: row.name,
      roleCode: row.roleCode,
      workSection: row.workSection ?? undefined,
      status: row.status,
      isFirstLogin: row.isFirstLogin,
      lastLoginAt: row.lastLoginAt instanceof Date ? row.lastLoginAt.toISOString() : row.lastLoginAt,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    };
  }

  async resetPassword(id: string): Promise<void> {
    const existing = await this.db.select({ id: sysAccount.id, account: sysAccount.account }).from(sysAccount).where(eq(sysAccount.id, id)).limit(1);
    if (existing.length === 0) {
      throw new NotFoundException('账号不存在');
    }
    if (existing[0].account === 'admin') {
      throw new BadRequestException('不能重置管理员密码');
    }
    await this.db
      .update(sysAccount)
      .set({ passwordHash: this.hashPassword('123'), isFirstLogin: true })
      .where(eq(sysAccount.id, id));
  }

  // ========== 自助改密 ==========

  /**
   * 用户修改自己的密码。
   *
   * 身份来自登录态（`req.userContext.userId`），不接受请求体传入账号 id ——
   * 否则任何登录用户都能改他人密码。校验顺序为「账号存在 → 原密码正确 →
   * 新密码合规」，全部通过后写新哈希并清除首次登录标记。
   */
  async changePassword(params: {
    userId: string;
    oldPassword: string;
    newPassword: string;
    confirmPassword: string;
  }): Promise<void> {
    const { userId, oldPassword, newPassword, confirmPassword } = params;

    if (!userId) {
      throw new BadRequestException('未获取到登录用户信息，请重新登录');
    }
    if (!oldPassword || !newPassword || !confirmPassword) {
      throw new BadRequestException('原密码、新密码、确认新密码均不能为空');
    }

    const existing = await this.db
      .select({ id: sysAccount.id, passwordHash: sysAccount.passwordHash })
      .from(sysAccount)
      .where(eq(sysAccount.id, userId))
      .limit(1);

    if (existing.length === 0) {
      throw new NotFoundException('账号不存在');
    }

    if (!this.verifyPassword(oldPassword, existing[0].passwordHash || '')) {
      throw new BadRequestException('原密码不正确');
    }

    const ruleError = validateNewPassword(newPassword, confirmPassword, oldPassword);
    if (ruleError) {
      throw new BadRequestException(ruleError);
    }

    await this.db
      .update(sysAccount)
      .set({ passwordHash: this.hashPassword(newPassword), isFirstLogin: false })
      .where(eq(sysAccount.id, userId));
  }

  // ========== 系统初始化（不可逆的全量清空） ==========

  /**
   * 初始化时保留的表。
   *
   * 为什么是「动态取全部表再排除」而不是硬编码待清清单：
   *   库里除了 WMS 自己的表，还有 45 张遗留 ERP 表（OA/采购/销售/财务等），
   *   硬编码清单一旦漏掉一张就会残留数据，而漏掉的那张往往没人发现。
   *   保留项只有 4 张，写清楚比列举 100 多张待清表可靠得多。
   */
  private static readonly INIT_KEEP_TABLES: string[] = [
    'sys_account',        // 账号：初始化后只保留 admin
    'sys_role',           // 角色定义：菜单权限的载体，清了所有菜单都打不开
    'sys_param',          // 系统参数：IQC 目标值、好坏品仓库等运行配置
    '_drizzle_migrations', // 迁移记录：清了会让迁移工具重复执行建表脚本
  ];

  /** 初始化确认短语（大小写不敏感；中英文都接受，避开输入法差异） */
  private static readonly INIT_CONFIRM_PHRASES: string[] = ['初始化', 'initialize'];

  /** sys_param 中记录「上次初始化时刻」的键，用于作废初始化前签发的登录令牌 */
  private static readonly INIT_EPOCH_PARAM_KEY = 'system.init_epoch';

  /** 初始化后 admin 的出厂口令（同时置「首次登录强制改密」） */
  private static readonly INIT_ADMIN_PASSWORD = 'admin';

  /** db.execute 的返回统一成行数组（postgres-js 直接返回数组） */
  private extractRows<T = Record<string, unknown>>(result: unknown): T[] {
    if (Array.isArray(result)) return result as T[];
    const maybe = result as { rows?: unknown } | null;
    if (maybe && Array.isArray(maybe.rows)) return maybe.rows as T[];
    return [];
  }

  /** SQL 标识符加双引号，避免表名里的特殊字符破坏语句 */
  private quoteIdent(name: string): string {
    return `"${String(name).replace(/"/g, '""')}"`;
  }

  /** 列出本次初始化将被清空的表（public 下除保留项外的全部表） */
  private async listInitializeTargets(): Promise<string[]> {
    const result = await this.db.execute(
      sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const rows = this.extractRows<{ tablename: string }>(result);
    const keep = new Set(SystemService.INIT_KEEP_TABLES);
    return rows.map((r) => r.tablename).filter((name) => Boolean(name) && !keep.has(name));
  }

  /**
   * 统计若干张表的行数合计。
   * 用一条 UNION ALL 语句一次往返取回，避免对上百张表逐张查询。
   */
  private async countRows(
    exec: { execute: (query: unknown) => Promise<unknown> },
    tableNames: string[],
  ): Promise<number> {
    if (tableNames.length === 0) return 0;
    const parts = tableNames.map(
      (name) => `SELECT count(*)::bigint AS n FROM public.${this.quoteIdent(name)}`,
    );
    const result = await exec.execute(
      sql.raw(`SELECT COALESCE(sum(n), 0)::bigint AS total FROM (${parts.join(' UNION ALL ')}) t`),
    );
    const rows = this.extractRows<{ total: string | number }>(result);
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * 清空预览：让界面先把「点下去会没掉什么」摆给用户看。
   * 纯读操作，不产生任何副作用。
   */
  async previewInitialize(): Promise<{
    tableCount: number;
    rowCount: number;
    accountCount: number;
    keepTables: string[];
    targets: string[];
  }> {
    const targets = await this.listInitializeTargets();
    const rowCount = await this.countRows(this.db, targets);
    const accountRows = await this.db.select({ n: count() }).from(sysAccount);
    return {
      tableCount: targets.length,
      rowCount,
      accountCount: Number(accountRows[0]?.n ?? 0),
      keepTables: [...SystemService.INIT_KEEP_TABLES],
      targets,
    };
  }

  /**
   * 把系统初始化到「只有 admin 一个账号」的出厂状态。
   *
   * 顺序与安全约束：
   *  1. 身份只取登录态 userId，并在服务层再查一次库 —— 不能只靠路由装饰器，
   *     否则装饰器一旦被误改就成了任意登录用户可清库。
   *  2. 双因子确认：确认短语 + 当前登录密码（后端重新验哈希，不信任前端）。
   *  3. 全程单事务：TRUNCATE 与账号删除要么全成、要么全不动。
   *  4. 表清单动态生成：新增业务表后无需改动本函数。
   *  5. 单条 TRUNCATE：PostgreSQL 要求某表的所有外键引用方都出现在同一条
   *     TRUNCATE 命令内，拆成多条会报「无法删除关联」并整体失败。
   *     不使用 CASCADE —— 清单不完整时应当报错中止，而不是连带删掉意外数据。
   *  6. 完成后写入初始化时间基点，作废此前签发的全部登录令牌。
   */
  async initializeSystem(params: {
    userId: string;
    password: string;
    confirmText: string;
    clearLogs?: boolean;
  }): Promise<{
    clearedTables: number;
    clearedRows: number;
    deletedAccounts: number;
    resetSequences: number;
    clearedLogs: boolean;
    keepTables: string[];
    adminAccount: string;
  }> {
    const { userId, password, confirmText } = params;
    const clearLogs = params.clearLogs !== false;

    if (!userId) {
      throw new BadRequestException('未获取到登录用户信息，请重新登录');
    }
    if (!password) {
      throw new BadRequestException('请输入当前登录密码');
    }
    const phrase = String(confirmText || '').trim().toLowerCase();
    if (!SystemService.INIT_CONFIRM_PHRASES.includes(phrase)) {
      throw new BadRequestException('确认短语不正确，请输入「初始化」');
    }

    const caller = await this.db
      .select({
        id: sysAccount.id,
        account: sysAccount.account,
        roleCode: sysAccount.roleCode,
        passwordHash: sysAccount.passwordHash,
      })
      .from(sysAccount)
      .where(eq(sysAccount.id, userId))
      .limit(1);

    if (caller.length === 0) {
      throw new BadRequestException('当前账号不存在，请重新登录');
    }
    if (caller[0].roleCode !== 'admin') {
      throw new BadRequestException('只有系统管理员可以执行系统初始化');
    }
    if (!this.verifyPassword(password, caller[0].passwordHash || '')) {
      throw new BadRequestException('当前登录密码不正确');
    }

    const targets = await this.listInitializeTargets();
    if (targets.length === 0) {
      throw new BadRequestException('未找到可清空的业务表，操作已中止');
    }

    const epochSeconds = Math.floor(Date.now() / 1000);
    const adminPasswordHash = this.hashPassword(SystemService.INIT_ADMIN_PASSWORD);
    const truncateSql = `TRUNCATE TABLE ${targets
      .map((t) => `public.${this.quoteIdent(t)}`)
      .join(', ')} RESTART IDENTITY`;

    const summary = await this.db.transaction(async (tx) => {
      const clearedRows = await this.countRows(tx, targets);

      await tx.execute(sql.raw(truncateSql));

      // 账号：仅保留 admin；其余账号及其角色绑定一并清除
      const deleted = await tx
        .delete(sysAccount)
        .where(ne(sysAccount.account, 'admin'))
        .returning({ id: sysAccount.id });
      await tx.delete(roleUser);

      // admin 复位到出厂状态：出厂口令 + 首次登录强制改密 + 解除停用
      const updated = await tx
        .update(sysAccount)
        .set({
          passwordHash: adminPasswordHash,
          isFirstLogin: true,
          status: 'active',
          lastLoginAt: null,
          workSection: null,
        })
        .where(eq(sysAccount.account, 'admin'))
        .returning({ id: sysAccount.id });
      if (updated.length === 0) {
        await tx.insert(sysAccount).values({
          account: 'admin',
          passwordHash: adminPasswordHash,
          name: '系统管理员',
          roleCode: 'admin',
          status: 'active',
          isFirstLogin: true,
        });
      }

      if (clearLogs) {
        await tx.delete(operationLog);
      }

      // 单据号序列复位。TRUNCATE ... RESTART IDENTITY 只覆盖「表自带的自增列」，
      // 而本项目 19 个单据号序列是独立 CREATE SEQUENCE 建的，必须单独 ALTER。
      const seqRows = this.extractRows<{ sequencename: string }>(
        await tx.execute(sql`SELECT sequencename FROM pg_sequences WHERE schemaname = 'public'`),
      );
      for (const s of seqRows) {
        await tx.execute(sql.raw(`ALTER SEQUENCE public.${this.quoteIdent(s.sequencename)} RESTART WITH 1`));
      }

      // 记录初始化时间基点（供鉴权守卫作废旧令牌）
      const epochValue = String(epochSeconds);
      const paramRow = await tx
        .select({ id: sysParam.id })
        .from(sysParam)
        .where(eq(sysParam.paramKey, SystemService.INIT_EPOCH_PARAM_KEY))
        .limit(1);
      if (paramRow.length > 0) {
        await tx
          .update(sysParam)
          .set({ paramValue: epochValue, updatedAt: new Date() })
          .where(eq(sysParam.id, paramRow[0].id));
      } else {
        await tx.insert(sysParam).values({
          paramKey: SystemService.INIT_EPOCH_PARAM_KEY,
          paramValue: epochValue,
          paramNameZh: '系统初始化时间',
          paramNameEn: 'System initialize time',
          paramNameVi: 'Thời gian khởi tạo hệ thống',
          description: 'Unix 秒。初始化之前签发的登录令牌会因此失效。请勿手工修改。',
        });
      }

      return {
        clearedTables: targets.length,
        clearedRows,
        deletedAccounts: deleted.length,
        resetSequences: seqRows.length,
      };
    });

    // 事务提交后再更新内存基点：提交失败不能误伤在线会话
    setSystemEpoch(epochSeconds);
    this.logger.warn(
      `系统初始化完成：清空 ${summary.clearedTables} 张表 / ${summary.clearedRows} 行，` +
        `删除账号 ${summary.deletedAccounts} 个，复位序列 ${summary.resetSequences} 个，操作者=${caller[0].account}`,
    );

    return {
      ...summary,
      clearedLogs: clearLogs,
      keepTables: [...SystemService.INIT_KEEP_TABLES],
      adminAccount: 'admin',
    };
  }

  /** 服务启动时载入初始化时间基点（此后每个请求只做数值比较，不查库） */
  async loadSystemEpoch(): Promise<void> {
    const rows = await this.db
      .select({ paramValue: sysParam.paramValue })
      .from(sysParam)
      .where(eq(sysParam.paramKey, SystemService.INIT_EPOCH_PARAM_KEY))
      .limit(1);
    setSystemEpoch(rows[0]?.paramValue);
  }

  async deleteAccount(id: string): Promise<void> {
    const existing = await this.db.select({ id: sysAccount.id, account: sysAccount.account }).from(sysAccount).where(eq(sysAccount.id, id)).limit(1);
    if (existing.length === 0) {
      throw new NotFoundException('账号不存在');
    }
    if (existing[0].account === 'admin') {
      throw new BadRequestException('不能删除管理员账号');
    }
    await this.db.update(sysAccount).set({ status: 'inactive' }).where(eq(sysAccount.id, id));
  }

  // ========== 账号批量导入（模版 → 人工填写 → 导入） ==========

  /**
   * 表头 / 角色码 / 工段值 的归一化键。
   * 去掉所有空白（含全角空格）、全角括号转半角、转小写，
   * 这样「角色编码」「Role Code」「角色 编码」都能落到同一个键上。
   */
  private normalizeImportKey(raw: unknown): string {
    return String(raw ?? '')
      .trim()
      .replace(/[\s\u3000]/g, '')
      .replace(/（/g, '(')
      .replace(/）/g, ')')
      .toLowerCase();
  }

  /**
   * 批量导入账号。
   *
   * 四条硬规则：
   *  1. **全量校验 + 原子写入**：只要有一行不合法就整体拒绝，一个账号都不建。
   *     若允许「导入一半」，管理员改完错误行再传一次，已成功的行会全部撞
   *     「账号已存在」，反而无从下手。
   *  2. **角色以 `sys_role` 白名单校验**，且允许直接填「角色名称」。
   *     `sys_account.role_code` 在库里没有外键约束，填错能建成功但永远过不了
   *     角色闸门（如 MRB 终审），现场只会看到「没有权限」而查不出原因，
   *     所以必须在入口挡住。
   *  3. **列顺序无关、表头支持中/英/越别名**；尾部幽灵空行静默跳过。
   *  4. 初始密码列留空则用系统约定的 `123`（与 `createAccount` 一致）。
   */
  async importAccounts(buffer: Buffer, operatorId = ''): Promise<SysAccountImportResult> {
    // ---------- 1. 解析文件（xlsx / xls / csv，兼容 Excel 另存的 GBK） ----------
    const workbook = readWorkbook(buffer);
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new BadRequestException('文件中没有工作表');
    }
    const rows: unknown[][] = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
      header: 1,
      defval: '',
      raw: false,
    });
    if (rows.length === 0) {
      throw new BadRequestException('文件为空');
    }
    const headerRow = rows[0];
    if (!Array.isArray(headerRow)) {
      throw new BadRequestException('表头行格式错误');
    }

    // ---------- 2. 表头映射（列顺序无关） ----------
    const headerAliases: Record<string, string[]> = {
      account: [
        '账号', '帐号', '登录账号', '账号(登录名)', '登录名', '用户名',
        'account', 'username', 'login', 'tàikhoản', 'tênđăngnhập',
      ],
      name: ['姓名', '名字', '员工姓名', 'name', 'fullname', 'họtên', 'tênnhânviên'],
      roleCode: ['角色编码', '角色代码', '角色码', '角色', 'rolecode', 'role', 'mãvaitrò', 'vaitrò'],
      workSection: [
        '所属工段', '工段', '部门', '所属部门',
        'worksection', 'section', 'department', 'bộphận', 'côngđoạn',
      ],
      password: ['初始密码', '密码', 'password', 'mậtkhẩu', 'mậtkhẩubanđầu'],
    };

    const headerIndex: Record<string, number> = {};
    headerRow.forEach((cell: unknown, idx: number) => {
      const key = this.normalizeImportKey(cell);
      if (!key) return;
      for (const [field, aliases] of Object.entries(headerAliases)) {
        if (headerIndex[field] !== undefined) continue;
        if (aliases.some((a) => this.normalizeImportKey(a) === key)) {
          headerIndex[field] = idx;
          break;
        }
      }
    });

    const requiredColumns: Array<{ key: string; label: string }> = [
      { key: 'account', label: '账号' },
      { key: 'name', label: '姓名' },
      { key: 'roleCode', label: '角色编码' },
    ];
    for (const col of requiredColumns) {
      if (headerIndex[col.key] === undefined) {
        throw new BadRequestException(`文件缺少必填列：${col.label}`);
      }
    }

    // ---------- 3. 角色白名单（以 sys_role 为准，允许填角色名称） ----------
    const roleRows = await this.db
      .select({ code: sysRole.roleCode, name: sysRole.roleName, status: sysRole.status })
      .from(sysRole);
    const roleByKey = new Map<string, { code: string; name: string; status: string | null }>();
    for (const r of roleRows) {
      const entry = { code: r.code, name: r.name, status: r.status };
      roleByKey.set(this.normalizeImportKey(r.code), entry);
      roleByKey.set(this.normalizeImportKey(r.name), entry);
    }
    const availableRoles = roleRows.map((r) => r.code).join('、');

    // ---------- 4. 工段别名表 ----------
    const wsAliasNorm = new Map<string, string>();
    for (const [alias, value] of Object.entries(WORK_SECTION_ALIASES)) {
      wsAliasNorm.set(this.normalizeImportKey(alias), value);
    }

    // ---------- 5. 逐行解析 + 校验（先全量校验，暂不写库） ----------
    const ACCOUNT_RE = /^[A-Za-z0-9._-]+$/;
    const errors: string[] = [];
    interface ImportRow {
      rowNum: number;
      account: string;
      name: string;
      roleCode: string;
      workSection?: string;
      password: string;
    }
    let validRows: ImportRow[] = [];
    const seenInFile = new Map<string, number>();
    let totalRows = 0;

    rows.slice(1).forEach((raw, idx) => {
      const rowNum = idx + 2;
      if (!Array.isArray(raw) || isBlankRow(raw)) return;
      totalRows++;

      const pick = (field: string): string =>
        headerIndex[field] !== undefined ? String(raw[headerIndex[field]] ?? '').trim() : '';

      const account = pick('account');
      const name = pick('name');
      const roleRaw = pick('roleCode');
      const wsRaw = pick('workSection');
      const password = pick('password');
      const rowErrors: string[] = [];

      // 账号
      if (!account) {
        rowErrors.push('账号不能为空');
      } else if (account.length > 50) {
        rowErrors.push(`账号「${account}」长度不能超过 50 个字符`);
      } else if (!ACCOUNT_RE.test(account)) {
        rowErrors.push(`账号「${account}」只能包含字母、数字、下划线、点、连字符`);
      } else if (account.toLowerCase() === 'admin') {
        rowErrors.push('账号 admin 是内置管理员，不能通过导入创建');
      } else {
        const dupRow = seenInFile.get(account.toLowerCase());
        if (dupRow !== undefined) {
          rowErrors.push(`账号「${account}」与第 ${dupRow} 行重复`);
        }
      }

      // 姓名
      if (!name) {
        rowErrors.push('姓名不能为空');
      } else if (name.length > 100) {
        rowErrors.push(`姓名「${name}」长度不能超过 100 个字符`);
      }

      // 角色
      const role = roleRaw ? roleByKey.get(this.normalizeImportKey(roleRaw)) : undefined;
      if (!roleRaw) {
        rowErrors.push('角色编码不能为空');
      } else if (!role) {
        rowErrors.push(`角色「${roleRaw}」不存在（可用：${availableRoles}）`);
      } else if (role.status && role.status !== 'active') {
        rowErrors.push(`角色「${role.name}」已停用，不能分配给账号`);
      }

      // 工段（可留空）
      let workSection: string | undefined;
      if (wsRaw) {
        const mapped = wsAliasNorm.get(this.normalizeImportKey(wsRaw));
        if (mapped === undefined) {
          rowErrors.push(
            `所属工段「${wsRaw}」不合法（可填：${WORK_SECTION_ALLOWED.join('、')}，留空表示不限）`,
          );
        } else if (mapped !== '') {
          workSection = mapped;
        }
      }

      // 初始密码（可留空）
      if (password && (password.length < 4 || password.length > 32)) {
        rowErrors.push('初始密码长度需在 4-32 位之间（留空则默认使用 123）');
      }

      if (rowErrors.length > 0) {
        for (const msg of rowErrors) errors.push(`第 ${rowNum} 行：${msg}`);
        return;
      }

      seenInFile.set(account.toLowerCase(), rowNum);
      validRows.push({ rowNum, account, name, roleCode: role!.code, workSection, password });
    });

    // ---------- 6. 与库内已有账号比对（含停用账号：登录名唯一，不覆盖） ----------
    if (validRows.length > 0) {
      const existing = await this.db
        .select({ account: sysAccount.account })
        .from(sysAccount)
        .where(inArray(sysAccount.account, validRows.map((r) => r.account)));
      if (existing.length > 0) {
        const taken = new Set(existing.map((e) => e.account.toLowerCase()));
        for (const r of validRows) {
          if (taken.has(r.account.toLowerCase())) {
            errors.push(`第 ${r.rowNum} 行：账号「${r.account}」已存在`);
          }
        }
        validRows = validRows.filter((r) => !taken.has(r.account.toLowerCase()));
      }
    }

    // ---------- 7. 原子性：有任何错误就整体拒绝，一个都不建 ----------
    if (errors.length > 0) {
      const MAX_ERRORS = 100;
      const shown = errors.slice(0, MAX_ERRORS);
      if (errors.length > MAX_ERRORS) {
        shown.push(`…… 另有 ${errors.length - MAX_ERRORS} 处错误未列出，请修正后重新上传`);
      }
      this.logger.warn(
        `账号批量导入被整体拒绝：文件行 ${totalRows}，错误 ${errors.length} 处，操作人：${operatorId || '(未记录)'}`,
      );
      return {
        totalRows,
        successCount: 0,
        errorCount: errors.length,
        errors: shown,
        createdAccounts: [],
        atomicRejected: true,
      };
    }

    if (validRows.length === 0) {
      throw new BadRequestException('文件中没有可导入的数据行');
    }

    // ---------- 8. 单事务写入 ----------
    const created = await this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(sysAccount)
        .values(
          validRows.map((r) => ({
            account: r.account,
            name: r.name,
            roleCode: r.roleCode,
            workSection: r.workSection ?? null,
            passwordHash: this.hashPassword(r.password || DEFAULT_ACCOUNT_PASSWORD),
            status: 'active',
            isFirstLogin: true,
            createdBy: operatorId || null,
          })),
        )
        .returning({ account: sysAccount.account });
      return inserted.map((r) => r.account);
    });

    this.logger.log(
      `账号批量导入完成：文件行 ${totalRows}，新建 ${created.length} 个账号，操作人：${operatorId || '(未记录)'}`,
    );

    return {
      totalRows,
      successCount: created.length,
      errorCount: 0,
      errors: [],
      createdAccounts: created,
      atomicRejected: false,
    };
  }

  async deleteRole(id: string): Promise<void> {
    const existing = await this.db.select({ id: sysRole.id, roleCode: sysRole.roleCode }).from(sysRole).where(eq(sysRole.id, id)).limit(1);
    if (existing.length === 0) {
      throw new NotFoundException('角色不存在');
    }
    const systemRoles = ['admin', 'warehouse_manager', 'picking_operator', 'iqc_inspector', 'mrb_reviewer', 'viewer'];
    if (systemRoles.includes(existing[0].roleCode)) {
      throw new BadRequestException('不能删除系统预置角色');
    }
    const linkedUsers = await this.db.select({ id: sysAccount.id }).from(sysAccount).where(and(eq(sysAccount.roleCode, existing[0].roleCode), eq(sysAccount.status, 'active'))).limit(1);
    if (linkedUsers.length > 0) {
      throw new BadRequestException('该角色下仍有活跃用户，无法删除');
    }
    // 真正删除：先删关联的用户-角色记录，再删角色
    await this.db.delete(roleUser).where(eq(roleUser.roleCode, existing[0].roleCode));
    await this.db.delete(sysRole).where(eq(sysRole.id, id));
  }

  async logout(): Promise<{ success: boolean }> {
    return { success: true };
  }

  // ========== 批量库位生成 ==========

  async batchCreateLocations(params: {
    warehouseId: string;
    areaCode: string;
    shelfCode: string;
    layerCode: string;
    startNo: number;
    endNo: number;
    locationType?: string;
    digitLen?: number;
  }): Promise<BatchCreateLocationResult> {
    const { warehouseId, areaCode, shelfCode, layerCode, startNo, endNo, digitLen = 4 } = params;

    if (!warehouseId || !areaCode || !shelfCode || !layerCode) {
      throw new BadRequestException('仓库、区域、货架、层位不能为空');
    }
    // 校验不能包含汉字
    const chineseRegex = /[\u4e00-\u9fa5]/;
    if (chineseRegex.test(areaCode)) throw new BadRequestException('区域码不能包含汉字');
    if (chineseRegex.test(shelfCode)) throw new BadRequestException('货架码不能包含汉字');
    if (chineseRegex.test(layerCode)) throw new BadRequestException('层码不能包含汉字');
    if (startNo <= 0 || endNo < startNo || endNo - startNo > 500) {
      throw new BadRequestException('序号范围不合法（0 < 起始 <= 结束，且批量不超过500）');
    }

    const whResult = await this.db.select({ whCode: warehouse.whCode, whType: warehouse.whType }).from(warehouse).where(eq(warehouse.id, warehouseId)).limit(1);
    if (whResult.length === 0) {
      throw new BadRequestException('仓库不存在');
    }

    const whCode = whResult[0].whCode;
    const whType = whResult[0].whType;
    const locTypeMap: Record<string, string> = {
      normal: 'good',
      pending: 'pending',
      defective: 'defective',
    };
    const finalLocType = locTypeMap[whType] || 'good';

    const codes: string[] = [];
    for (let i = startNo; i <= endNo; i++) {
      const pos = String(i).padStart(digitLen, '0');
      const code = `${whCode}-${areaCode}-${shelfCode}-${layerCode}-${pos}`;
      codes.push(code);
    }

    const existing = await this.db
      .select({ locationCode: warehouseLocation.locationCode })
      .from(warehouseLocation)
      .where(inArray(warehouseLocation.locationCode, codes));
    const existingSet = new Set(existing.map((e: any) => e.locationCode));

    const toCreate = codes.filter(c => !existingSet.has(c));
    const skippedCodes = codes.filter(c => existingSet.has(c));

    if (toCreate.length > 0) {
      const values = toCreate.map(code => ({
        locationCode: code,
        warehouseId,
        areaCode,
        shelfCode,
        layerCode,
        positionCode: code.split('-').pop() || '',
        locationType: finalLocType,
        status: 'active',
      }));
      await this.db.insert(warehouseLocation).values(values as any);
    }

    return {
      total: codes.length,
      created: toCreate.length,
      skipped: skippedCodes.length,
      skippedCodes,
    };
  }
}
