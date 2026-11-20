import { apiGet, apiPost } from './request';

/**
 * 主数据清空（危险操作，仅系统管理员）。
 *
 * 目标是通用的：物料主数据 / 供应商档案 / 替代关系（material 模块）
 * 与 仓库档案 / 仓库地址码档案（warehouse 模块）共用同一套接口与页面。
 */
export type MasterDataClearTarget =
  | 'material'
  | 'supplier'
  | 'substitution'
  | 'warehouse'
  | 'location';

export interface MasterDataClearPreview {
  target: MasterDataClearTarget;
  table: string;
  /** 需逐字输入的确认短语 */
  confirmPhrase: string;
  /** 目标表当前行数（将被删除） */
  rowCount: number;
  /** 连带清空的子表及其行数 */
  cascaded: { table: string; rowCount: number }[];
  /** 外键引用目标表（含连带子表）的表 */
  referencingTables: string[];
  /** 有数据的引用表——会阻止清空 */
  blockers: { table: string; rowCount: number }[];
  /** 是否会被拦截 */
  blocked: boolean;
}

export interface MasterDataClearResult {
  target: MasterDataClearTarget;
  table: string;
  /** 目标表被删除的行数 */
  deletedRows: number;
  /** 连带清空的子表行数（合计） */
  cascadedRows: number;
}

/** 预览接口按目标所属模块分流（只读，无副作用） */
const PREVIEW_PATH: Record<MasterDataClearTarget, string> = {
  material: '/api/material/clear/preview',
  supplier: '/api/material/clear/preview',
  substitution: '/api/material/clear/preview',
  warehouse: '/api/warehouse/clear/preview',
  location: '/api/warehouse/clear/preview',
};

/** 执行接口逐目标独立，便于审计按「路由」区分具体动作 */
const CLEAR_PATH: Record<MasterDataClearTarget, string> = {
  material: '/api/material/clear-materials',
  supplier: '/api/material/clear-suppliers',
  substitution: '/api/material/clear-substitutions',
  warehouse: '/api/warehouse/clear-warehouses',
  location: '/api/warehouse/clear-locations',
};

/** 清空预览（只读） */
export function getMasterDataClearPreview(target: MasterDataClearTarget) {
  return apiGet<MasterDataClearPreview>(PREVIEW_PATH[target], { target });
}

/**
 * 执行主数据清空。
 * 服务端会重新校验当前登录密码与确认短语 —— 前端校验只是防误触，不是安全边界。
 */
export function clearMasterData(
  target: MasterDataClearTarget,
  params: { password: string; confirmText: string },
) {
  return apiPost<MasterDataClearResult>(CLEAR_PATH[target], params);
}
