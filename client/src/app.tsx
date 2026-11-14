import React from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import { ConfigProvider, theme as antdTheme, type ThemeConfig } from 'antd';
import antdZhCN from 'antd/locale/zh_CN';
import antdViVN from 'antd/locale/vi_VN';
import antdEnUS from 'antd/locale/en_US';
import { I18nProvider, useI18n } from './i18n';
import { AuthProvider } from './auth/AuthContext';
import { useAuth } from './auth/AuthContext';
import { shouldUsePda } from './utils/device';
import { ThemeProvider, useTheme } from './theme/ThemeProvider';

import Layout from './components/Layout';
import NotFound from './pages/NotFound/NotFound';
import LoginPage from './pages/Login/Login';
// 首页含 ECharts 图表（echarts-for-react 体量大），改为按需加载，
// 首屏 JS 因此不再包含图表库；Suspense 兜底见下方 Routes 外层。
const DashboardPage = React.lazy(() => import('./pages/Dashboard/Dashboard'));
import WarehouseListPage from './pages/warehouse/WarehouseList';
import LocationListPage from './pages/warehouse/LocationList';
import IntraTransferPage from './pages/inventory/IntraTransfer';
import DefectiveMoveWorkbench from './pages/inventory/DefectiveMoveWorkbench';
import DefectiveMoveListPage from './pages/inventory/DefectiveMoveList';
import MaterialListPage from './pages/material/MaterialList';
import SupplierListPage from './pages/material/SupplierList';
import SubstitutionListPage from './pages/material/SubstitutionList';
import MasterDataClearPage from './pages/material/MasterDataClear';
import ReceiptScanPage from './pages/receipt/ReceiptScan';
import ReceiptListPage from './pages/receipt/ReceiptList';
import IqcPendingPage from './pages/iqc/IqcPending';
import IqcInspectPage from './pages/iqc/IqcInspectPage';
import IqcRecordPage from './pages/iqc/IqcRecord';
import IqcReportDetailPage from './pages/iqc/IqcReportDetail';
import IqcReportPage from './pages/iqc/IqcReport';
import IqcTemplatePage from './pages/iqc/IqcTemplate';
import IqcStandardLibraryPage from './pages/iqc/IqcStandardLibraryPage';
import IqcTemplatePreviewPage from './pages/iqc/IqcTemplatePreviewPage';
// 该页复用 IqcDashboard，同样依赖 ECharts，按需加载避免图表库进首屏
const IqcStatsPage = React.lazy(() => import('./pages/iqc/IqcStats'));
import IqcStrictnessPage from './pages/iqc/IqcStrictness';
import InventoryQueryPage from './pages/inventory/InventoryQuery';
import StockTakeListPage from './pages/inventory/StockTakeList';
import StockTakeDetailPage from './pages/inventory/StockTakeDetail';
import StockTransferPage from './pages/inventory/StockTransfer';
import BomListPage from './pages/bom/BomList';
import WorkOrderListPage from './pages/workorder/WorkOrderList';
import MesSyncPage from './pages/mes/MesSync';
import MaterialRequirementPage from './pages/workorder/MaterialRequirement';
import PickingOrderPage from './pages/workorder/PickingOrder';
import PickingApprovalPage from './pages/workorder/PickingApproval';
import PickingReceivePage from './pages/production/PickingReceive';
import ReelSettlementPage from './pages/production/ReelSettlement';
import PdaReelReturn from './pages/pda/PdaReelReturn';
import SupplementPage from './pages/workorder/Supplement';
import SupplementRecordPage from './pages/workorder/SupplementRecord';
import OverSupplementReportPage from './pages/workorder/OverSupplementReport';
import ProductionReturnPage from './pages/workorder/ProductionReturn';
import OverPickingOrderPage from './pages/workorder/OverPickingOrder';
import ProductionReturnPendingPage from './pages/iqc/ProductionReturnPending';
import SupplierDebtListPage from './pages/iqc/SupplierDebtList';
import ProductionReturnReceiptPage from './pages/receipt/ProductionReturnReceipt';
import IssuingManagePage from './pages/issuing/IssuingManage';
import IssueRecordQueryPage from './pages/issuing/IssueRecordQuery';
import MrbListPage from './pages/mrb/MrbList';
import MrbTaskPage from './pages/mrb/MrbTask';
import SupplierReturnListPage from './pages/supplier-return/SupplierReturnList';
import ReworkListPage from './pages/rework/ReworkList';
import SysParamPage from './pages/system/SysParam';
import RoleListPage from './pages/system/RoleList';
import AccountListPage from './pages/system/AccountList';
import SystemInitPage from './pages/system/SystemInit';
import HelpPage from './pages/help/HelpPage';

// ===== PDA 移动端页面（独立布局，不使用 PC Layout）=====
import PdaLogin from './pages/pda/PdaLogin';
import PdaHome from './pages/pda/PdaHome';
import PdaReceiptScan from './pages/pda/PdaReceiptScan';
import PdaReceiptList from './pages/pda/PdaReceiptList';
import PdaTransfer from './pages/pda/PdaTransfer';
import PdaStockTransfer from './pages/pda/PdaStockTransfer';
import PdaDefectiveMove from './pages/pda/PdaDefectiveMove';
import PdaInventory from './pages/pda/PdaInventory';
import PdaPicking from './pages/pda/PdaPicking';
import PdaIssuing from './pages/pda/PdaIssuing';
import PdaPutaway from './pages/pda/PdaPutaway';
import PdaSupplement from './pages/pda/PdaSupplement';
import PdaMrb from './pages/pda/PdaMrb';
import PdaHelp from './pages/pda/PdaHelp';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { role } = useAuth();
  if (!role) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

/**
 * 前端路由级权限守卫：除登录校验外，按角色码限制敏感路由。
 * 无权限时跳转回首页（后端仍会做最终鉴权，此处仅为前端二次拦截）。
 */
function RequireRole({ children, allow }: { children: React.ReactNode; allow: string[] }) {
  const { role } = useAuth();
  if (!role) {
    return <Navigate to="/login" replace />;
  }
  if (!allow.includes(role.roleCode)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function PdaRequireAuth({ children }: { children: React.ReactNode }) {
  const { role } = useAuth();
  if (!role) {
    return <Navigate to="/pda/login" replace />;
  }
  return <>{children}</>;
}

/**
 * PC 端路由守卫：当检测到是移动设备（且未强制桌面版）时，
 * 自动跳转到 PDA 端（已登录跳 /pda/home，未登录跳 /pda/login）。
 * 桌面浏览器 shouldUsePda() 返回 false，行为不变。
 */
function PcRouteGuard({ children }: { children: React.ReactNode }) {
  const { role } = useAuth();
  if (shouldUsePda()) {
    return <Navigate to={role ? '/pda/home' : '/pda/login'} replace />;
  }
  return <>{children}</>;
}

/** antd 组件内置文案（表格空状态/分页、Modal 按钮、Select 无选项…）跟随界面语言 */
const ANTD_LOCALES: Record<string, typeof antdZhCN> = {
  zh: antdZhCN,
  vi: antdViVN,
  en: antdEnUS,
};

/**
 * antd 组件（表格 / 弹窗 / 选择器 / 日期 / 分页…）跟随界面配色：
 * 浅色主题用 defaultAlgorithm，深色主题切 darkAlgorithm，
 * 主色、容器底色、边框、字号全部取自当前调色板，避免 antd 与 Tailwind 两套皮肤打架。
 */
const AntdThemeBridge: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { lang } = useI18n();
  const { theme, isDark } = useTheme();

  const config = React.useMemo<ThemeConfig>(() => {
    const v = theme.vars;
    return {
      algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      token: {
        colorPrimary: v.primary,
        colorInfo: v.info,
        colorSuccess: v.success,
        colorWarning: v.warning,
        colorError: v.destructive,
        colorLink: v.primary,
        colorTextBase: v.foreground,
        colorText: v.foreground,
        colorTextSecondary: v['muted-foreground'],
        colorBgBase: v.background,
        colorBgContainer: v.card,
        colorBgElevated: v.popover,
        colorBgLayout: v.background,
        colorBorder: v.border,
        colorBorderSecondary: v.border,
        colorFillSecondary: v.muted,
        colorFillTertiary: v.muted,
        colorFillAlter: v.muted,
        borderRadius: 8,
      },
      components: {
        Table: {
          headerBg: v.muted,
          headerColor: v['muted-foreground'],
          rowHoverBg: v['primary-soft'],
          borderColor: v.border,
        },
        Modal: { contentBg: v.card, headerBg: v.card, titleColor: v.foreground },
        Card: { colorBgContainer: v.card },
        Select: { optionSelectedBg: v['primary-soft'], selectorBg: v.card, optionActiveBg: v.muted },
        Input: { colorBgContainer: v['input-bg'], activeBorderColor: v.primary, hoverBorderColor: v.input },
        InputNumber: { colorBgContainer: v['input-bg'] },
        DatePicker: { colorBgContainer: v.card, cellActiveWithRangeBg: v['primary-soft'] },
        Tabs: { itemSelectedColor: v.primary, inkBarColor: v.primary },
        Tooltip: {
          colorBgSpotlight: isDark ? v.popover : v.foreground,
          colorTextLightSolid: isDark ? v.foreground : '#ffffff',
        },
        Dropdown: { controlItemBgHover: v.muted },
        Drawer: { colorBgElevated: v.card },
        Popover: { colorBgElevated: v.popover },
        Pagination: { itemActiveBg: v['primary-soft'] },
      },
    };
  }, [theme, isDark]);

  return (
    <ConfigProvider locale={ANTD_LOCALES[lang] ?? antdZhCN} theme={config}>
      {children}
    </ConfigProvider>
  );
};

const RoutesComponent = () => {
  return (
    <ThemeProvider>
      <I18nProvider>
        <AntdThemeBridge>
          <AuthProvider>
          <React.Suspense fallback={<div className="p-8 text-sm text-muted-foreground">加载中…</div>}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
  
            {/* ===== PDA 移动端路由组（独立布局，位于 PC Layout 之外）===== */}
            <Route path="/pda/login" element={<PdaLogin />} />
            <Route path="/pda/home" element={<PdaRequireAuth><PdaHome /></PdaRequireAuth>} />
            <Route path="/pda/receipt/scan" element={<PdaRequireAuth><PdaReceiptScan /></PdaRequireAuth>} />
            <Route path="/pda/receipt/list" element={<PdaRequireAuth><PdaReceiptList /></PdaRequireAuth>} />
            <Route path="/pda/defective-move" element={<PdaRequireAuth><PdaDefectiveMove /></PdaRequireAuth>} />
            <Route path="/pda/transfer" element={<PdaRequireAuth><PdaTransfer /></PdaRequireAuth>} />
            <Route path="/pda/stock-transfer" element={<PdaRequireAuth><PdaStockTransfer /></PdaRequireAuth>} />
            <Route path="/pda/inventory" element={<PdaRequireAuth><PdaInventory /></PdaRequireAuth>} />
            <Route path="/pda/picking" element={<PdaRequireAuth><PdaPicking /></PdaRequireAuth>} />
            <Route path="/pda/putaway" element={<PdaRequireAuth><PdaPutaway /></PdaRequireAuth>} />
            <Route path="/pda/issuing" element={<PdaRequireAuth><PdaIssuing /></PdaRequireAuth>} />
            <Route path="/pda/reel-return" element={<PdaRequireAuth><PdaReelReturn /></PdaRequireAuth>} />
            <Route path="/pda/supplement" element={<PdaRequireAuth><PdaSupplement /></PdaRequireAuth>} />
            <Route path="/pda/mrb" element={<PdaRequireAuth><PdaMrb /></PdaRequireAuth>} />
            <Route path="/pda/help" element={<PdaRequireAuth><PdaHelp /></PdaRequireAuth>} />
            // print route removed
  
            <Route element={<PcRouteGuard><Layout /></PcRouteGuard>}>
              <Route
                index
                element={
                  <RequireAuth>
                    <DashboardPage />
                  </RequireAuth>
                }
              />
              <Route path="warehouse" element={<Navigate to="/warehouse/list" replace />} />
              <Route path="warehouse/list" element={<RequireAuth><WarehouseListPage /></RequireAuth>} />
              <Route path="warehouse/location" element={<RequireAuth><LocationListPage /></RequireAuth>} />
              {/* 主数据清空：不可逆的物理删除，只开给系统管理员 */}
              <Route path="warehouse/clear-warehouses" element={<RequireRole allow={['admin']}><MasterDataClearPage target="warehouse" /></RequireRole>} />
              <Route path="warehouse/clear-locations" element={<RequireRole allow={['admin']}><MasterDataClearPage target="location" /></RequireRole>} />
              <Route path="material" element={<Navigate to="/material/list" replace />} />
              <Route path="material/list" element={<RequireAuth><MaterialListPage /></RequireAuth>} />
              <Route path="material/supplier" element={<RequireAuth><SupplierListPage /></RequireAuth>} />
              <Route path="material/substitution" element={<RequireAuth><SubstitutionListPage /></RequireAuth>} />
              {/* 主数据清空：不可逆的物理删除，只开给系统管理员 */}
              <Route path="material/clear-materials" element={<RequireRole allow={['admin']}><MasterDataClearPage target="material" /></RequireRole>} />
              <Route path="material/clear-suppliers" element={<RequireRole allow={['admin']}><MasterDataClearPage target="supplier" /></RequireRole>} />
              <Route path="material/clear-substitutions" element={<RequireRole allow={['admin']}><MasterDataClearPage target="substitution" /></RequireRole>} />
              <Route path="receipt" element={<Navigate to="/receipt/scan" replace />} />
              <Route path="receipt/scan" element={<RequireAuth><ReceiptScanPage /></RequireAuth>} />
              <Route path="receipt/list" element={<RequireAuth><ReceiptListPage /></RequireAuth>} />
              <Route path="receipt/production-return" element={<RequireAuth><ProductionReturnReceiptPage /></RequireAuth>} />
              <Route path="iqc" element={<Navigate to="/iqc/pending" replace />} />
              <Route path="iqc/pending" element={<RequireAuth><IqcPendingPage /></RequireAuth>} />
              <Route path="iqc/inspect/:lotId" element={<RequireAuth><IqcInspectPage /></RequireAuth>} />
              <Route path="iqc/record" element={<RequireAuth><IqcRecordPage /></RequireAuth>} />
              <Route path="iqc/report" element={<RequireAuth><IqcReportPage /></RequireAuth>} />
              <Route path="iqc/report/:id" element={<RequireAuth><IqcReportDetailPage /></RequireAuth>} />
              <Route path="iqc/report-view/:id" element={<RequireAuth><IqcReportDetailPage /></RequireAuth>} />
  
              <Route path="iqc/template" element={<RequireAuth><IqcTemplatePage /></RequireAuth>} />
              <Route path="iqc/standard-library" element={<RequireAuth><IqcStandardLibraryPage /></RequireAuth>} />
              <Route path="iqc/template-preview/:id" element={<RequireAuth><IqcTemplatePreviewPage /></RequireAuth>} />
              <Route path="iqc/stats" element={<RequireAuth><IqcStatsPage /></RequireAuth>} />
              <Route path="iqc/strictness" element={<RequireAuth><IqcStrictnessPage /></RequireAuth>} />
              <Route path="iqc/production-return-pending" element={<RequireAuth><ProductionReturnPendingPage /></RequireAuth>} />
              <Route path="iqc/supplier-debt" element={<RequireAuth><SupplierDebtListPage /></RequireAuth>} />
              <Route path="inventory" element={<Navigate to="/inventory/query" replace />} />
              <Route path="inventory/query" element={<RequireAuth><InventoryQueryPage /></RequireAuth>} />
              <Route path="inventory/intra-transfer" element={<RequireAuth><IntraTransferPage /></RequireAuth>} />
              <Route path="inventory/defective-transfer" element={<RequireAuth><DefectiveMoveWorkbench /></RequireAuth>} />
              <Route path="inventory/defective-move" element={<RequireAuth><DefectiveMoveListPage /></RequireAuth>} />
              <Route path="inventory/transfer" element={<RequireAuth><StockTransferPage /></RequireAuth>} />
              <Route path="inventory/stock-take" element={<RequireAuth><StockTakeListPage /></RequireAuth>} />
              <Route path="inventory/stock-take/:id" element={<RequireAuth><StockTakeDetailPage /></RequireAuth>} />
              <Route path="bom" element={<Navigate to="/bom/list" replace />} />
              <Route path="bom/list" element={<RequireAuth><BomListPage /></RequireAuth>} />
              <Route path="workorder" element={<Navigate to="/workorder/list" replace />} />
              <Route path="workorder/list" element={<RequireAuth><WorkOrderListPage /></RequireAuth>} />
              <Route path="workorder/requirement" element={<RequireAuth><MaterialRequirementPage /></RequireAuth>} />
              <Route path="workorder/picking" element={<RequireAuth><PickingOrderPage /></RequireAuth>} />
              {/* MES 工单/领料接入：待领料看板、同步日志、接口配置 */}
              <Route path="mes/sync" element={<RequireAuth><MesSyncPage /></RequireAuth>} />
              <Route path="production/picking-approval" element={<RequireAuth><PickingApprovalPage /></RequireAuth>} />
              <Route path="production/picking-receive" element={<RequireAuth><PickingReceivePage /></RequireAuth>} />
              <Route path="production/reel-settlement" element={<RequireAuth><ReelSettlementPage /></RequireAuth>} />
              <Route path="production/supplement" element={<RequireAuth><SupplementPage /></RequireAuth>} />
              <Route path="production/supplement-record" element={<RequireAuth><SupplementRecordPage /></RequireAuth>} />
              <Route path="production/over-supplement-report" element={<RequireAuth><OverSupplementReportPage /></RequireAuth>} />
              <Route path="production/production-return" element={<RequireAuth><ProductionReturnPage /></RequireAuth>} />
              <Route path="production/over-picking" element={<RequireAuth><OverPickingOrderPage /></RequireAuth>} />
              <Route path="mrb" element={<Navigate to="/mrb/list" replace />} />
              <Route path="mrb/list" element={<RequireAuth><MrbListPage /></RequireAuth>} />
              <Route path="mrb/task" element={<RequireAuth><MrbTaskPage /></RequireAuth>} />
              <Route path="supplier-return" element={<Navigate to="/supplier-return/list" replace />} />
              <Route path="supplier-return/list" element={<RequireAuth><SupplierReturnListPage /></RequireAuth>} />
              <Route path="rework" element={<Navigate to="/rework/list" replace />} />
              <Route path="rework/list" element={<RequireAuth><ReworkListPage /></RequireAuth>} />
              <Route path="issuing" element={<Navigate to="/issuing/list" replace />} />
              <Route path="issuing/list" element={<RequireAuth><IssuingManagePage /></RequireAuth>} />
              <Route path="issuing/records" element={<RequireAuth><IssueRecordQueryPage /></RequireAuth>} />
              <Route path="system" element={<Navigate to="/system/param" replace />} />
              <Route path="system/param" element={<RequireRole allow={['admin']}><SysParamPage /></RequireRole>} />
              <Route path="system/role" element={<RequireRole allow={['admin']}><RoleListPage /></RequireRole>} />
              <Route path="system/account" element={<RequireRole allow={['admin']}><AccountListPage /></RequireRole>} />
              {/* 系统初始化：不可逆的清库入口，只开给系统管理员 */}
              <Route path="system/init" element={<RequireRole allow={['admin']}><SystemInitPage /></RequireRole>} />
              {/* 使用帮助（作业指导书）：三语，登录后可见 */}
              <Route path="help" element={<RequireAuth><HelpPage /></RequireAuth>} />
            </Route>
            {/* 生产管理模块旧路径兼容重定向（2026-09-30 从 /workorder/* 迁移） */}
            <Route path="workorder/production-return" element={<Navigate to="/production/production-return" replace />} />
            <Route path="workorder/picking-approval" element={<Navigate to="/production/picking-approval" replace />} />
            <Route path="workorder/supplement-record" element={<Navigate to="/production/supplement-record" replace />} />
            <Route path="workorder/supplement" element={<Navigate to="/production/supplement" replace />} />
            <Route path="workorder/over-picking" element={<Navigate to="/production/over-picking" replace />} />
            <Route path="workorder/over-supplement-report" element={<Navigate to="/production/over-supplement-report" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </React.Suspense>
          </AuthProvider>
        </AntdThemeBridge>
      </I18nProvider>
    </ThemeProvider>
  );
};

export default RoutesComponent;




