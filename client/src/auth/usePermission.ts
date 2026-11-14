import { useAuth, type RoleCode } from './AuthContext';

const MENU_PERMISSIONS: Record<string, RoleCode[]> = {
  '/': ['admin', 'wh_manager', 'wh_keeper', 'iqc_inspector', 'iqc_manager', 'sqe', 'planner', 'plan_manager', 'production_material_smt', 'production_material_dip', 'production_material_assembly', 'production_material_packing', 'production_manager', 'engineer', 'quality_manager', 'mrb_reviewer'],
  '/warehouse': ['admin', 'wh_manager', 'wh_keeper'],
  '/warehouse/list': ['admin', 'wh_manager', 'wh_keeper'],
  '/warehouse/location': ['admin', 'wh_manager', 'wh_keeper'],
  '/warehouse/clear-warehouses': ['admin'],
  '/warehouse/clear-locations': ['admin'],
  '/material': ['admin', 'engineer', 'wh_keeper', 'iqc_inspector', 'iqc_manager', 'planner', 'plan_manager', 'quality_manager', 'sqe'],
  '/material/list': ['admin', 'engineer', 'quality_manager', 'sqe', 'iqc_manager'],
  '/material/supplier': ['admin', 'engineer', 'wh_manager', 'quality_manager', 'sqe', 'iqc_manager'],
  '/material/clear-materials': ['admin'],
  '/material/clear-suppliers': ['admin'],
  '/material/clear-substitutions': ['admin'],
  '/receipt': ['admin', 'wh_keeper'],
  '/receipt/scan': ['admin', 'wh_keeper'],
  '/receipt/list': ['admin', 'wh_keeper', 'wh_manager', 'iqc_inspector', 'iqc_manager'],
  '/iqc': ['admin', 'iqc_inspector', 'iqc_manager', 'quality_manager'],
  '/iqc/pending': ['admin', 'iqc_inspector', 'iqc_manager', 'quality_manager'],
  '/iqc/record': ['admin', 'iqc_inspector', 'iqc_manager', 'quality_manager'],
  '/iqc/report': ['admin', 'iqc_manager', 'iqc_inspector', 'quality_manager'],
  // 质量经理需要维护/查看检验模板与检验严格度（2026-10-20 反馈：模板页被拦后提示成“网络错误”）
  '/iqc/template': ['admin', 'iqc_manager', 'quality_manager'],
  '/iqc/standard-library': ['admin', 'iqc_manager', 'quality_manager'],
  '/iqc/strictness': ['admin', 'iqc_manager', 'quality_manager'],
  '/iqc/production-return-pending': ['admin', 'iqc_inspector', 'iqc_manager', 'quality_manager'],
  '/iqc/supplier-debt': ['admin', 'iqc_manager', 'quality_manager', 'sqe'],
  '/iqc/stats': ['admin', 'iqc_inspector', 'iqc_manager', 'quality_manager', 'sqe'],
  '/inventory': ['admin', 'wh_manager', 'wh_keeper', 'iqc_manager', 'production_manager', 'planner', 'plan_manager'],
  '/inventory/query': ['admin', 'wh_manager', 'wh_keeper', 'iqc_manager', 'production_manager', 'planner', 'plan_manager'],
  '/inventory/intra-transfer': ['admin', 'wh_keeper'],
  '/inventory/defective-transfer': ['admin', 'wh_manager', 'wh_keeper'],
  // 不良品调拨单：MRB 判退货/报废后由仓库执行实物调拨，只有仓库岗位需要看
  '/inventory/defective-move': ['admin', 'wh_manager', 'wh_keeper'],
  '/inventory/transfer': ['admin', 'wh_manager', 'wh_keeper'],
  '/inventory/expiry': ['admin', 'wh_manager', 'wh_keeper', 'iqc_manager', 'quality_manager'],
  '/inventory/stock-take': ['admin', 'wh_manager', 'wh_keeper'],
  '/bom': ['admin', 'engineer', 'planner', 'plan_manager'],
  '/bom/list': ['admin', 'engineer'],
  '/workorder': ['admin', 'planner', 'plan_manager', 'production_manager', 'production_material_smt', 'production_material_dip', 'production_material_assembly', 'production_material_packing'],
  '/workorder/list': ['admin', 'planner', 'plan_manager'],
  '/workorder/requirement': ['admin', 'planner', 'plan_manager'],
  '/workorder/picking': ['admin', 'production_manager', 'production_material_smt', 'production_material_dip', 'production_material_assembly', 'production_material_packing'],
  // MES 工单/领料接入：计划看排产、仓库看要备什么料、生产主管看进度
  '/mes': ['admin', 'wh_manager', 'wh_keeper', 'planner', 'plan_manager', 'production_manager'],
  '/mes/sync': ['admin', 'wh_manager', 'wh_keeper', 'planner', 'plan_manager', 'production_manager'],
  '/production': ['admin', 'planner', 'plan_manager', 'production_manager', 'production_material_smt', 'production_material_dip', 'production_material_assembly', 'production_material_packing'],
  '/production/production-return': ['admin', 'production_manager', 'production_material_smt', 'production_material_dip', 'production_material_assembly', 'production_material_packing'],
  '/production/over-picking': ['admin', 'production_manager', 'production_material_smt', 'production_material_dip', 'production_material_assembly', 'production_material_packing'],
  '/production/picking-approval': ['admin', 'production_manager'],
  '/production/picking-receive': ['admin', 'production_manager', 'wh_manager', 'production_material_smt', 'production_material_dip', 'production_material_assembly', 'production_material_packing'],
  '/production/reel-settlement': ['admin', 'production_manager', 'wh_manager', 'production_material_smt', 'production_material_dip', 'production_material_assembly', 'production_material_packing'],
  '/production/supplement': ['admin', 'planner', 'plan_manager', 'production_manager'],
  '/production/supplement-record': ['admin', 'planner', 'plan_manager', 'production_manager'],
  '/production/over-supplement-report': ['admin', 'planner', 'plan_manager', 'production_manager', 'quality_manager'],
  '/issuing': ['admin', 'wh_keeper', 'production_manager'],
  '/issuing/list': ['admin', 'wh_keeper', 'production_manager'],
  '/mrb': ['admin', 'sqe', 'quality_manager', 'mrb_reviewer', 'iqc_manager'],
  '/mrb/list': ['admin', 'sqe', 'quality_manager', 'iqc_manager'],
  '/mrb/task': ['admin', 'mrb_reviewer', 'quality_manager'],
  '/supplier-return': ['admin', 'wh_manager', 'wh_keeper', 'quality_manager', 'sqe', 'iqc_manager'],
  '/supplier-return/list': ['admin', 'wh_manager', 'wh_keeper', 'quality_manager', 'sqe', 'iqc_manager'],
  '/rework': ['admin', 'wh_manager', 'wh_keeper', 'quality_manager', 'sqe', 'iqc_manager', 'iqc_inspector'],
  '/rework/list': ['admin', 'wh_manager', 'wh_keeper', 'quality_manager', 'sqe', 'iqc_manager', 'iqc_inspector'],
  '/system': ['admin'],
  '/system/param': ['admin'],
  '/system/role': ['admin'],
  '/system/account': ['admin'],
};

export function usePermission() {
  const { role, user } = useAuth();

  const hasPermission = (path: string): boolean => {
    if (!role) return false;
    // If user has dynamic menu permissions from login, use those
    if (user && user.menuPermissions && user.menuPermissions.length > 0) {
      // Admin check: if user role is admin, always allow
      if (role.roleCode === 'admin') return true;
      return user.menuPermissions.includes(path);
    }
    // Fallback to static MENU_PERMISSIONS
    if (role.roleCode === 'admin') return true;
    const allowedRoles = MENU_PERMISSIONS[path];
    if (!allowedRoles) return false;
    return allowedRoles.includes(role.roleCode);
  };

  return { hasPermission, role };
}
