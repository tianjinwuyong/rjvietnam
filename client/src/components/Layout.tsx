import React, { useState, useEffect, useMemo } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useI18n, tui } from '@client/src/i18n';
import { useAuth, type RoleCode } from '@client/src/auth/AuthContext';
import { usePermission } from '@client/src/auth/usePermission';
import { Badge } from '@client/src/components/ui/badge';
import CompanyLogo from '@client/src/components/CompanyLogo';
import {
  Warehouse, Package, ClipboardList, ClipboardCheck,
  Boxes, FileSpreadsheet, Factory, FileSearch, Settings,
  Globe, LogOut, User, Home, PackageCheck,
  PanelLeftClose, PanelLeftOpen, HelpCircle, KeyRound
} from 'lucide-react';
import ChangePasswordDialog from '@client/src/components/ChangePasswordDialog';
import NoticeBell from '@client/src/components/NoticeBell';
import ThemeSwitcher from '@client/src/theme/ThemeSwitcher';

interface MenuItem {
  key: string;
  path?: string;
  icon?: React.ReactNode;
  labelKey: string;
  /** 仅这些角色可见；留空 = 沿用现有行为（所有可见）。用于把高危操作收口给管理员 */
  roles?: RoleCode[];
  children?: MenuItem[];
}

const menuConfig: MenuItem[] = [
  {
    key: 'dashboard',
    path: '/',
    icon: <Home size={18} />,
    labelKey: 'nav.dashboard',
  },
  {
    key: 'receipt',
    path: '/receipt',
    icon: <ClipboardList size={18} />,
    labelKey: 'nav.receipt',
    children: [
      { key: 'receiptScan', path: '/receipt/scan', labelKey: 'nav.receiptScan' },
      { key: 'receiptOrder', path: '/receipt/list', labelKey: 'nav.receiptOrder' },
      { key: 'productionReturnReceipt', path: '/receipt/production-return', labelKey: 'nav.productionReturnReceipt' },
    ],
  },
  {
    key: 'issuing',
    path: '/issuing',
    icon: <PackageCheck size={18} />,
    labelKey: 'nav.issuing',
    children: [
      { key: 'issuingList', path: '/issuing/list', labelKey: 'nav.issuingList' },
      { key: 'issuingRecords', path: '/issuing/records', labelKey: 'nav.issuingRecords' },
    ],
  },
  {
    key: 'inventory',
    path: '/inventory',
    icon: <Boxes size={18} />,
    labelKey: 'nav.inventory',
    children: [
      { key: 'inventoryQuery', path: '/inventory/query', labelKey: 'nav.inventoryQuery' },
      { key: 'stockTake', path: '/inventory/stock-take', labelKey: 'nav.stockTake' },
      { key: 'intraTransfer', path: '/inventory/intra-transfer', labelKey: 'nav.intraTransfer' },
      { key: 'defectiveMoveOrder', path: '/inventory/defective-move', labelKey: 'nav.defectiveMoveOrder' },
      { key: 'defectiveTransfer', path: '/inventory/defective-transfer', labelKey: 'nav.defectiveTransfer' },
      { key: 'stockTransfer', path: '/inventory/transfer', labelKey: 'nav.stockTransfer' },
    ],
  },
  {
    key: 'iqc',
    path: '/iqc',
    icon: <ClipboardCheck size={18} />,
    labelKey: 'nav.iqc',
    children: [
      { key: 'iqcStats', path: '/iqc/stats', labelKey: 'nav.iqcStats' },
      { key: 'iqcPending', path: '/iqc/pending', labelKey: 'nav.iqcPending' },
      { key: 'iqcRecord', path: '/iqc/record', labelKey: 'nav.iqcRecord' },
      { key: 'iqcReport', path: '/iqc/report', labelKey: 'nav.iqcReport' },
      { key: 'iqcTemplate', path: '/iqc/template', labelKey: 'nav.iqcTemplate' },
      { key: 'iqcStrictness', path: '/iqc/strictness', labelKey: 'nav.iqcStrictness' },
      { key: 'productionReturnPending', path: '/iqc/production-return-pending', labelKey: 'nav.productionReturnPending' },
      { key: 'supplierDebt', path: '/iqc/supplier-debt', labelKey: 'nav.supplierDebt' },
    ],
  },
  {
    key: 'workorder',
    path: '/workorder',
    icon: <Factory size={18} />,
    labelKey: 'nav.workorder',
    children: [
      { key: 'workOrderList', path: '/workorder/list', labelKey: 'nav.workOrderList' },
      { key: 'pickingOrder', path: '/workorder/picking', labelKey: 'nav.pickingOrder' },
      // MES 工单/领料接入：计划、仓库、生产主管都要看「哪张单要备什么料」
      { key: 'mesSync', path: '/mes/sync', labelKey: 'nav.mesSync' },
    ],
  },
  {
    key: 'production',
    path: '/production',
    icon: <PackageCheck size={18} />,
    labelKey: 'nav.production',
    children: [
      { key: 'productionReturn', path: '/production/production-return', labelKey: 'nav.productionReturn' },
      { key: 'pickingApproval', path: '/production/picking-approval', labelKey: 'nav.pickingApproval' },
      { key: 'pickingReceive', path: '/production/picking-receive', labelKey: 'nav.pickingReceive' },
      { key: 'reelSettlement', path: '/production/reel-settlement', labelKey: 'nav.reelSettlement' },
      { key: 'overPickingOrder', path: '/production/over-picking', labelKey: 'nav.overPickingOrder' },
      { key: 'supplementRecord', path: '/production/supplement-record', labelKey: 'nav.supplementRecord' },
      { key: 'overSupplementReport', path: '/production/over-supplement-report', labelKey: 'nav.overSupplementReport' },
    ],
  },
  {
    key: 'bom',
    path: '/bom',
    icon: <FileSpreadsheet size={18} />,
    labelKey: 'nav.bom',
    children: [
      { key: 'bomList', path: '/bom/list', labelKey: 'nav.bomList' },
    ],
  },
  {
    key: 'mrb',
    path: '/mrb',
    icon: <FileSearch size={18} />,
    labelKey: 'nav.mrb',
    children: [
      { key: 'mrbList', path: '/mrb/list', labelKey: 'nav.mrbList' },
      { key: 'mrbTask', path: '/mrb/task', labelKey: 'nav.mrbTask' },
      { key: 'supplierReturn', path: '/supplier-return/list', labelKey: 'nav.supplierReturn' },
      { key: 'rework', path: '/rework/list', labelKey: 'nav.rework' },
    ],
  },
  {
    key: 'warehouse',
    path: '/warehouse',
    icon: <Warehouse size={18} />,
    labelKey: 'nav.warehouse',
    children: [
      { key: 'warehouseList', path: '/warehouse/list', labelKey: 'nav.warehouseList' },
      { key: 'locationList', path: '/warehouse/location', labelKey: 'nav.locationList' },
      // 主数据清空（不可逆的物理删除）：仅系统管理员可见
      { key: 'clearWarehouses', path: '/warehouse/clear-warehouses', labelKey: 'nav.clearWarehouses', roles: ['admin'] },
      { key: 'clearLocations', path: '/warehouse/clear-locations', labelKey: 'nav.clearLocations', roles: ['admin'] },
    ],
  },
  {
    key: 'material',
    path: '/material',
    icon: <Package size={18} />,
    labelKey: 'nav.material',
    children: [
      { key: 'materialList', path: '/material/list', labelKey: 'nav.materialList' },
      { key: 'supplierList', path: '/material/supplier', labelKey: 'nav.supplierList' },
      { key: 'substitutionList', path: '/material/substitution', labelKey: 'nav.substitutionList' },
      // 主数据清空（不可逆的物理删除）：仅系统管理员可见
      { key: 'clearMaterials', path: '/material/clear-materials', labelKey: 'nav.clearMaterials', roles: ['admin'] },
      { key: 'clearSuppliers', path: '/material/clear-suppliers', labelKey: 'nav.clearSuppliers', roles: ['admin'] },
      { key: 'clearSubstitutions', path: '/material/clear-substitutions', labelKey: 'nav.clearSubstitutions', roles: ['admin'] },
    ],
  },
  {
    key: 'system',
    path: '/system',
    icon: <Settings size={18} />,
    labelKey: 'nav.system',
    children: [
      { key: 'sysParam', path: '/system/param', labelKey: 'nav.sysParam' },
      { key: 'roleMgmt', path: '/system/role', labelKey: 'system.roleManagement' },
      { key: 'accountMgmt', path: '/system/account', labelKey: 'system.accountManagement' },
      { key: 'systemInit', path: '/system/init', labelKey: 'system.initTitle' },
    ],
  },
];

const Layout: React.FC = () => {
  const { t, lang, setLang } = useI18n();
  const { user, role, logout, updateUser } = useAuth();
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  const location = useLocation();
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showChangePwd, setShowChangePwd] = useState(false);
  /**
   * 首次登录或被管理员重置密码后，强制弹改密框。
   * 标记存于登录态（服务端 login 返回、改密成功后清除），
   * 因此刷新页面或直接访问任意路由都会被拦截。
   */
  const forceChangePwd = !!user?.isFirstLogin;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('wms-sidebar-collapsed');
    return saved === 'true';
  });
  const [sidebarHover, setSidebarHover] = useState(false);

  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('wms-sidebar-collapsed', String(next));
      return next;
    });
  };

  // 打开「配色」面板时，顺手收起语言/用户下拉，避免浮层互压
  useEffect(() => {
    const closeMenus = () => {
      setShowLangMenu(false);
      setShowUserMenu(false);
    };
    window.addEventListener('wms:theme-panel-open', closeMenus);
    return () => window.removeEventListener('wms:theme-panel-open', closeMenus);
  }, []);

  // 根据当前路径确定激活的主模块
  const activeMainKey = useMemo(() => {
    if (location.pathname === '/' || location.pathname === '') return 'dashboard';
    // 先尝试按路径第一段匹配
    const firstSegment = location.pathname.split('/').filter(Boolean)[0];
    const foundByFirstSegment = menuConfig.find(m => m.key === firstSegment);
    if (foundByFirstSegment) return foundByFirstSegment.key;
    // 如果没匹配到，遍历所有主菜单的子菜单，找路径匹配的
    for (const main of menuConfig) {
      if (main.children) {
        const childFound = main.children.find(c => c.path === location.pathname);
        if (childFound) return main.key;
      }
    }
    return 'dashboard';
  }, [location.pathname]);

  // 当前主模块的可见子菜单
  const activeChildren = useMemo(() => {
    const main = menuConfig.find(m => m.key === activeMainKey);
    if (!main?.children) return [];
    // 带 roles 的子项按当前角色过滤；不带 roles 的沿用现有行为（始终可见）
    return main.children.filter(
      child => !child.roles || (role != null && child.roles.includes(role.roleCode)),
    );
  }, [activeMainKey, role]);

  // 侧边栏可见的主模块
  const visibleMainMenus = useMemo(() => {
    return menuConfig;
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const getRoleDisplayName = () => {
    if (!role) return '';
    switch (lang) {
      case 'zh': return role.roleNameZh;
      case 'vi': return role.roleNameVi;
      case 'en': return role.roleNameEn;
      default: return role.roleNameZh;
    }
  };

  if (!role) {
    return <Outlet />;
  }

  const sidebarEffective = sidebarCollapsed && !sidebarHover ? 'w-14' : 'w-52';
  const activeMain = menuConfig.find(m => m.key === activeMainKey);

  return (
    <div data-wms-layout className="h-screen bg-background flex overflow-hidden">
      {/* 左侧主模块导航 */}
      <aside
        data-sidebar
        onMouseEnter={() => sidebarCollapsed && setSidebarHover(true)}
        onMouseLeave={() => { setSidebarHover(false); }}
        className={`${sidebarEffective} bg-sidebar border-r border-sidebar-border flex-shrink-0 flex flex-col transition-all duration-200 ease-in-out relative z-30 shadow-sm`}
      >
        <div className="h-14 flex items-center px-3 flex-shrink-0 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5 min-w-0">
            <CompanyLogo size={36} className="flex-shrink-0 shadow-md rounded-full" />
            {(sidebarEffective === 'w-52') && (
              <div className="min-w-0 flex-1">
                {/* 公司名与系统名属于品牌标识，三语下固定显示中文 */}
                <h1 className="text-xs font-bold text-sidebar-foreground leading-tight whitespace-normal break-words">深圳市瑞晶实业有限公司</h1>
                <p className="text-xs text-sidebar-foreground/60 mt-0.5 truncate">仓库管理系统 WMS</p>
              </div>
            )}
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2 px-1.5">
          {visibleMainMenus.map(item => {
            const isActive = activeMainKey === item.key;
            const label = item.labelKey.startsWith('nav.') ? t(item.labelKey) : item.labelKey;
            return (
              <NavLink
                key={item.key}
                to={item.children && item.children[0]?.path ? item.children[0].path : (item.path || '/')}
                className={({ isActive: navActive }) =>
                  `flex items-center gap-2.5 px-2.5 py-2 text-sm rounded-lg transition-colors duration-150 mb-0.5 ${
                    isActive || navActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm'
                      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'
                  }`
                }
                title={sidebarEffective === 'w-14' ? label : undefined}
              >
                {item.icon && <span className="flex-shrink-0">{item.icon}</span>}
                {(sidebarEffective === 'w-52') && <span className="truncate">{label}</span>}
              </NavLink>
            );
          })}
        </nav>
      </aside>

      {/* 右侧内容区 */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* 顶部固定区域（sticky，像Excel冻结首行） */}
        <div className="sticky top-0 z-20 flex-shrink-0 bg-card/80 backdrop-blur-xl border-b border-border/60 shadow-sm">
          {/* 第一行：模块标题 + 操作区 */}
          <div className="h-11 flex items-center justify-between px-4">
            <div className="flex items-center gap-3">
              <button
                onClick={toggleSidebar}
                className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary-soft rounded-md transition-colors duration-150"
                title={sidebarCollapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
              >
                {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
              </button>
              {location.pathname.startsWith('/help') ? (
                <div className="flex items-center gap-2">
                  <span className="text-primary"><HelpCircle size={18} /></span>
                  <span className="text-base font-semibold text-foreground">{t('header.helpTitle')}</span>
                </div>
              ) : activeMain && (
                <div className="flex items-center gap-2">
                  <span className="text-primary">{activeMain.icon}</span>
                  <span className="text-base font-semibold text-foreground">
                    {activeMain.labelKey.startsWith('nav.') ? t(activeMain.labelKey) : activeMain.labelKey}
                  </span>
                </div>
              )}
              <Badge variant={role.roleCode === 'admin' ? 'warning' : 'default'} className="text-xs font-bold ml-1">
                {getRoleDisplayName()}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              {/* 站内消息：MRB 终审抄送（IQC / 仓库 / 计划 / 生产）落在这里 */}
              <NoticeBell />
              {/* 界面配色：顶部栏一键换肤（浅色/深色共 7 套，选择后本地记住） */}
              <ThemeSwitcher />
              {/* 使用帮助：跳转独立帮助页（作业指导书），三语内容随全局语言切换 */}
              <button
                onClick={() => {
                  setShowLangMenu(false);
                  setShowUserMenu(false);
                  navigate('/help');
                }}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md transition-colors duration-150 ${
                  location.pathname.startsWith('/help')
                    ? 'text-primary bg-primary-soft font-medium'
                    : 'text-muted-foreground hover:text-primary hover:bg-primary-soft'
                }`}
                title={t('header.helpTitle')}
              >
                <HelpCircle size={14} />
                <span>{t('header.help')}</span>
              </button>
              {/* 语言切换 */}
              <div className="relative">
                <button
                  onClick={() => { setShowLangMenu(!showLangMenu); setShowUserMenu(false); }}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-primary hover:bg-primary-soft rounded-md transition-colors duration-150"
                >
                  <Globe size={14} />
                  <span>{lang === 'zh' ? '中文' : lang === 'vi' ? 'Tiếng Việt' : 'English'}</span>
                </button>
                {showLangMenu && (
                  <div className="absolute right-0 top-full mt-1.5 w-28 bg-popover/95 backdrop-blur-xl border border-border/60 rounded-lg shadow-xl z-50 overflow-hidden">
                    <button onClick={() => { setLang('zh'); setShowLangMenu(false); }}
                      className={`w-full px-3 py-1.5 text-left text-xs hover:bg-muted transition-colors ${lang === 'zh' ? 'text-primary font-medium bg-primary-soft' : 'text-foreground'}`}>
                      中文
                    </button>
                    <button onClick={() => { setLang('vi'); setShowLangMenu(false); }}
                      className={`w-full px-3 py-1.5 text-left text-xs hover:bg-muted transition-colors ${lang === 'vi' ? 'text-primary font-medium bg-primary-soft' : 'text-foreground'}`}>
                      Tiếng Việt
                    </button>
                    <button onClick={() => { setLang('en'); setShowLangMenu(false); }}
                      className={`w-full px-3 py-1.5 text-left text-xs hover:bg-muted transition-colors ${lang === 'en' ? 'text-primary font-medium bg-primary-soft' : 'text-foreground'}`}>
                      English
                    </button>
                  </div>
                )}
              </div>
              {/* 用户信息 */}
              <div className="relative">
                <button
                  data-wms-user-menu
                  onClick={() => { setShowUserMenu(!showUserMenu); setShowLangMenu(false); }}
                  className="flex items-center gap-1.5 px-2 py-1 hover:bg-muted rounded-md transition-colors duration-150"
                >
                  <div className="w-6 h-6 rounded-full bg-primary-soft flex items-center justify-center text-primary text-xs font-bold">
                    {getRoleDisplayName().charAt(0)}
                  </div>
                  <span className="text-xs text-foreground">{getRoleDisplayName()}</span>
                </button>
                {showUserMenu && (
                  <div className="absolute right-0 top-full mt-1.5 w-36 bg-popover/95 backdrop-blur-xl border border-border/60 rounded-lg shadow-xl z-50 overflow-hidden">
                    <button
                      onClick={() => { setShowUserMenu(false); setShowChangePwd(true); }}
                      className="w-full px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted transition-colors flex items-center gap-2"
                    >
                      <KeyRound size={13} />
                      {t('system.changePassword')}
                    </button>
                    <button onClick={handleLogout}
                      className="w-full px-3 py-1.5 text-left text-xs text-destructive hover:bg-destructive-soft/50 transition-colors flex items-center gap-2">
                      <LogOut size={13} />
                      {t('header.logout')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          {/* 第二行：子模块横向标签 */}
          {activeChildren.length > 0 && (
            <div className="h-10 flex items-center px-4 gap-1 border-t border-border/40 overflow-x-auto scrollbar-thin">
              {activeChildren.map(child => {
                const label = child.labelKey.startsWith('nav.') || child.labelKey.startsWith('system.') || child.labelKey.startsWith('header.')
                  ? t(child.labelKey)
                  : child.labelKey;
                return (
                  // 注意：横标签刻意保留 13px，不并入 text-sm(14px)。
                  // 越南语标签条的可容纳宽度是按 13px 计算的（可用 1,680px / 内容约 1,564px），
                  // 抬到 14px 会让内容增长约 7%，逼近溢出边界 —— 这是唯一需要保留硬编码的字号。
                  <NavLink
                    key={child.key}
                    to={child.path || '#'}
                    className={({ isActive }) =>
                      `flex items-center px-3 py-1.5 text-[13px] rounded-md whitespace-nowrap transition-all duration-150 flex-shrink-0 ${
                        isActive
                          ? 'bg-primary text-primary-foreground font-medium shadow-sm'
                          : 'text-foreground/65 hover:bg-muted hover:text-foreground'
                      }`
                    }
                  >
                    {label}
                  </NavLink>
                );
              })}
            </div>
          )}
        </div>

        {/* 主内容区（可滚动） */}
        <main className="flex-1 p-4 overflow-y-auto overflow-x-hidden">
          <Outlet />
        </main>
      </div>

      {/* 修改密码：强制模式下无法关闭，改完才放行 */}
      <ChangePasswordDialog
        open={forceChangePwd || showChangePwd}
        onOpenChange={(v) => { if (!forceChangePwd) setShowChangePwd(v); }}
        forced={forceChangePwd}
        onSuccess={() => updateUser({ isFirstLogin: false })}
      />
    </div>
  );
};

export default Layout;







