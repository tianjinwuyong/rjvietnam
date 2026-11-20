import { createContext, useContext, useState, useCallback, useEffect, ReactNode, useMemo } from 'react';
import type { LoginResult } from '@shared/api.interface';
import { getMe } from '../api/system';

export type RoleCode =
  | 'admin'
  | 'wh_manager'
  | 'wh_keeper'
  | 'iqc_inspector'
  | 'iqc_manager'
  | 'sqe'
  | 'planner'
  | 'plan_manager'
  | 'production_material_smt'
  | 'production_material_dip'
  | 'production_material_assembly'
  | 'production_material_packing'
  | 'production_manager'
  | 'engineer'
  | 'quality_manager'
  | 'mrb_reviewer';

export interface RoleInfo {
  roleCode: RoleCode;
  roleNameZh: string;
  roleNameVi: string;
  roleNameEn: string;
  userId: string;
  userName: string;
  workSection?: string;
}

export interface LoginUserInfo {
  id?: string;
  account: string;
  name: string;
  roleCode: RoleCode;
  workSection?: string;
  isFirstLogin: boolean;
  menuPermissions: string[];
  token: string;
}

const ROLE_MAP: Record<RoleCode, { zh: string; vi: string; en: string; userId: string; userName: string; workSection?: string }> = {
  admin: { zh: '系统管理员', vi: 'Quản trị viên hệ thống', en: 'System Admin', userId: '1847292357012580', userName: '系统管理员' },
  wh_manager: { zh: '仓库主管', vi: 'Trưởng bộ phận kho', en: 'Warehouse Manager', userId: '1847292986161210', userName: '仓库主管' },
  wh_keeper: { zh: '仓管员', vi: 'Nhân viên kho', en: 'Warehouse Keeper', userId: '1838411738368010', userName: '仓管员' },
  iqc_inspector: { zh: 'IQC检验员', vi: 'Nhân viên kiểm tra IQC', en: 'IQC Inspector', userId: '1847292458018820', userName: 'IQC检验员' },
  iqc_manager: { zh: 'IQC主管', vi: 'Trưởng IQC', en: 'IQC Manager', userId: '1847286122258458', userName: 'IQC主管' },
  sqe: { zh: 'SQE工程师', vi: 'Kỹ sư SQE', en: 'SQE Engineer', userId: '1846114399229988', userName: 'SQE工程师' },
  planner: { zh: '计划员', vi: 'Nhân viên kế hoạch', en: 'Planner', userId: '1847298549409911', userName: '计划员' },
  plan_manager: { zh: '计划部主管', vi: 'Trưởng bộ phận kế hoạch', en: 'Planning Manager', userId: '1847291727560708', userName: '计划部主管' },
  production_material_smt: { zh: 'SMT物料员', vi: 'Nhân viên vật tư SMT', en: 'SMT Material Handler', userId: '1848568929333380', userName: 'SMT物料员', workSection: 'smt' },
  production_material_dip: { zh: '插件物料员', vi: 'Nhân viên vật tư DIP', en: 'DIP Material Handler', userId: '1847751107397639', userName: '插件物料员', workSection: 'dip' },
  production_material_assembly: { zh: '组装物料员', vi: 'Nhân viên vật tư Lắp ráp', en: 'Assembly Material Handler', userId: '1847292357012581', userName: '组装物料员', workSection: 'assembly' },
  production_material_packing: { zh: '包装物料员', vi: 'Nhân viên vật tư Đóng gói', en: 'Packing Material Handler', userId: '1847292986161211', userName: '包装物料员', workSection: 'packing' },
  production_manager: { zh: '生产主管', vi: 'Trưởng sản xuất', en: 'Production Manager', userId: '1838411738368011', userName: '生产主管' },
  engineer: { zh: '工程师', vi: 'Kỹ sư', en: 'Engineer', userId: '1847292458018821', userName: '工程师' },
  quality_manager: { zh: '质量经理', vi: 'Trưởng bộ phận chất lượng', en: 'Quality Manager', userId: '1847286122258459', userName: '质量经理' },
  mrb_reviewer: { zh: 'MRB评审员', vi: 'Người đánh giá MRB', en: 'MRB Reviewer', userId: '1846114399229989', userName: 'MRB评审员' },
};

function buildRoleInfo(userInfo: LoginUserInfo): RoleInfo {
  const code = userInfo.roleCode as RoleCode;
  const mapped = ROLE_MAP[code];
  if (mapped) {
    return {
      roleCode: code,
      roleNameZh: mapped.zh,
      roleNameVi: mapped.vi,
      roleNameEn: mapped.en,
      userId: userInfo.id || mapped.userId,
      userName: userInfo.name || mapped.userName,
      workSection: userInfo.workSection || mapped.workSection,
    };
  }
  // Fallback for unknown roles
  return {
    roleCode: code,
    roleNameZh: userInfo.name,
    roleNameVi: userInfo.name,
    roleNameEn: userInfo.name,
    userId: '',
    userName: userInfo.name,
    workSection: userInfo.workSection,
  };
}

interface AuthContextType {
  user: LoginUserInfo | null;
  role: RoleInfo | null;
  login: (roleCode: RoleCode) => void;
  loginByAccount: (userInfo: LoginResult) => void;
  /**
   * 局部更新当前登录用户信息（不改动 token）。
   *
   * 目前用于改密成功后清除 `isFirstLogin`：强制改密弹窗据此放行，
   * 否则同一会话内每次进入布局都会再次拦截。
   */
  updateUser: (patch: Partial<LoginUserInfo>) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: null,
  login: () => {},
  loginByAccount: () => {},
  updateUser: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<LoginUserInfo | null>(() => {
    const saved = localStorage.getItem('wms-user');
    if (saved) {
      try {
        return JSON.parse(saved) as LoginUserInfo;
      } catch {
        return null;
      }
    }
    // Fallback: migrate from old wms-role
    const oldRole = localStorage.getItem('wms-role');
    if (oldRole && ROLE_MAP[oldRole as RoleCode]) {
      const r = ROLE_MAP[oldRole as RoleCode];
      return {
        account: oldRole,
        name: r.userName,
        roleCode: oldRole as RoleCode,
        workSection: r.workSection,
        isFirstLogin: false,
        menuPermissions: [],
        token: '',
      };
    }
    return null;
  });

  const role: RoleInfo | null = useMemo(() => {
    if (!user) return null;
    return buildRoleInfo(user);
  }, [user]);

  const login = useCallback((roleCode: RoleCode) => {
    const r = ROLE_MAP[roleCode];
    const userInfo: LoginUserInfo = {
      account: roleCode,
      name: r.userName,
      roleCode,
      workSection: r.workSection,
      isFirstLogin: false,
      menuPermissions: [],
      token: '',
    };
    setUser(userInfo);
    localStorage.setItem('wms-user', JSON.stringify(userInfo));
    localStorage.removeItem('wms-role');
  }, []);

  const loginByAccount = useCallback((result: LoginResult) => {
    const userInfo: LoginUserInfo = {
      id: result.id,
      account: result.account,
      name: result.name,
      roleCode: result.roleCode as RoleCode,
      workSection: result.workSection,
      isFirstLogin: result.isFirstLogin,
      menuPermissions: result.menuPermissions || [],
      token: result.token,
    };
    setUser(userInfo);
    localStorage.setItem('wms-user', JSON.stringify(userInfo));
    localStorage.removeItem('wms-role');
  }, []);

  const updateUser = useCallback((patch: Partial<LoginUserInfo>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      localStorage.setItem('wms-user', JSON.stringify(next));
      return next;
    });
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem('wms-user');
    localStorage.removeItem('wms-role');
  }, []);

  /**
   * 启动时用服务端状态校正本地缓存的登录态。
   *
   * 为什么需要：`isFirstLogin` 随登录态一起存在 localStorage，是**端级缓存**，
   * 但「是否已修改初始密码」是**账号级事实**。用户在 PC 端改完密码后，
   * PDA 端缓存里仍是改密前的 true，于是换个设备又弹一次改密框。
   * 这里在应用启动时拉取一次账号真实状态并回写缓存，使跨端一致。
   *
   * 失败安全：请求失败不影响登录态（可能是离线或令牌刚好过期），
   * 仅在明确 401 时清理本地缓存让用户重新登录。
   */
  useEffect(() => {
    if (!user?.token) return;
    let cancelled = false;
    getMe()
      .then((res) => {
        if (cancelled || !res?.data) return;
        setUser((prev) => {
          if (!prev) return prev;
          const next = {
            ...prev,
            id: res.data.id ?? prev.id,
            account: res.data.account ?? prev.account,
            name: res.data.name ?? prev.name,
            roleCode: (res.data.roleCode ?? prev.roleCode) as RoleCode,
            workSection: res.data.workSection ?? prev.workSection,
            isFirstLogin: !!res.data.isFirstLogin,
            menuPermissions: res.data.menuPermissions ?? prev.menuPermissions,
          };
          localStorage.setItem('wms-user', JSON.stringify(next));
          return next;
        });
      })
      .catch((e: any) => {
        const status = e?.response?.status ?? e?.status;
        if (status === 401) logout();
      });
    return () => {
      cancelled = true;
    };
    // 仅在挂载时对齐一次；后续状态变化由 login / updateUser 维护
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthContext.Provider value={{ user, role, login, loginByAccount, updateUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export { ROLE_MAP };
