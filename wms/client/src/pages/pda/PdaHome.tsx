import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ScanLine,
  ClipboardList,
  ArrowLeftRight,
  Repeat,
  Search,
  ClipboardCheck,
  PackagePlus,
  ShieldAlert,
  Undo2,
  LogOut,
  Volume2,
  HelpCircle,
  KeyRound,
  type LucideIcon,
} from 'lucide-react';
import { useI18n, tui } from '../../i18n';
import { useAuth } from '../../auth/AuthContext';
import { getPdaTasks, type PdaTasks } from '../../api/pda';
import PdaLayout from './components/PdaLayout';
import ChangePasswordDialog from '../../components/ChangePasswordDialog';
import { speakSuccess } from '../../utils/speech';

interface MenuItem {
  key: string;
  labelKey: string;
  icon: LucideIcon;
  to: string;
  external?: boolean;
  badgeKey?: keyof PdaTasks;
  roles: string[];
}

const ALL_ROLES = ['admin'];

const MENU: MenuItem[] = [
  {
    key: 'receiptScan',
    labelKey: 'receiptScan',
    icon: ScanLine,
    to: '/pda/receipt/scan',
    badgeKey: 'pendingReceipt',
    roles: ['wh_keeper', 'wh_manager', ...ALL_ROLES],
  },
  {
    key: 'receiptList',
    labelKey: 'receiptList',
    icon: ClipboardList,
    to: '/pda/receipt/list',
    roles: ['wh_keeper', 'wh_manager', ...ALL_ROLES],
  },
  {
    key: 'transfer',
    labelKey: 'transfer',
    icon: ArrowLeftRight,
    to: '/pda/transfer',
    roles: ['wh_keeper', 'wh_manager', ...ALL_ROLES],
  },
  {
    key: 'stockTransfer',
    labelKey: 'stockTransfer',
    icon: Repeat,
    to: '/pda/stock-transfer',
    roles: ['wh_keeper', 'wh_manager', ...ALL_ROLES],
  },
  {
    key: 'defectiveMove',
    labelKey: 'defectiveMove',
    icon: ShieldAlert,
    to: '/pda/defective-move',
    roles: ['wh_keeper', 'wh_manager', ...ALL_ROLES],
  },
  {
    key: 'inventory',
    labelKey: 'inventory',
    icon: Search,
    to: '/pda/inventory',
    roles: ['wh_keeper', 'wh_manager', ...ALL_ROLES],
  },
  {
    key: 'picking',
    labelKey: 'picking',
    icon: ClipboardCheck,
    to: '/pda/picking',
    badgeKey: 'pendingPicking',
    roles: ['production_material_smt', 'production_material_dip', 'production_material_assembly', 'production_material_packing', 'production_manager', ...ALL_ROLES],
  },
  {
    // 上架页面早已写好，但既没注册路由也没有首页入口，等于不存在（UX-04 断头路之一）
    key: 'putaway',
    labelKey: 'putaway',
    icon: PackagePlus,
    to: '/pda/putaway',
    roles: ['wh_keeper', 'wh_manager', ...ALL_ROLES],
  },
  {
    // 发料页有路由但首页无入口，一线到不了（UX-04 断头路之二）
    key: 'issuing',
    labelKey: 'issuing',
    icon: ClipboardCheck,
    to: '/pda/issuing',
    roles: ['production_material_smt', 'production_material_dip', 'production_material_assembly', 'production_material_packing', 'production_manager', ...ALL_ROLES],
  },
  {
    key: 'reelReturn',
    labelKey: 'reelReturn',
    icon: Undo2,
    to: '/pda/reel-return',
    roles: ['production_material_smt', 'production_material_dip', 'production_material_assembly', 'production_material_packing', 'production_manager', ...ALL_ROLES],
  },
  {
    key: 'supplement',
    labelKey: 'supplement',
    icon: PackagePlus,
    to: '/pda/supplement',
    roles: ['production_material_smt', 'production_material_dip', 'production_material_assembly', 'production_material_packing', 'production_manager', ...ALL_ROLES],
  },
  {
    key: 'mrb',
    labelKey: 'mrb',
    icon: ShieldAlert,
    to: '/pda/mrb',
    badgeKey: 'pendingMrb',
    roles: ['mrb_reviewer', 'quality_manager', 'sqe', ...ALL_ROLES],
  },
];

/** P1-b: PDA 任务首页 */
const PdaHome: React.FC = () => {
  const { t } = useI18n();
  const { user, role, logout, updateUser } = useAuth();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<PdaTasks | null>(null);
  const [showChangePwd, setShowChangePwd] = useState(false);

  useEffect(() => {
    getPdaTasks()
      .then(setTasks)
      .catch(() => setTasks(null));
  }, []);

  const roleCode = role?.roleCode || user?.roleCode || '';
  const visibleMenu = MENU.filter((m) => m.roles.includes(roleCode));

  const badgeFor = (item: MenuItem): number => {
    if (!tasks || !item.badgeKey) return 0;
    return tasks[item.badgeKey] || 0;
  };

  const handleLogout = () => {
    logout();
    navigate('/pda/login', { replace: true });
  };

  // 音频测试：speakSuccess 内部已同时给出蜂鸣音与语音，一次调用即可验证两条通道
  const handleTestAudio = () => {
    speakSuccess(t('ui.音频测试正常'));
  };

  return (
    <PdaLayout title={t('pda.homeTitle')} showBack={false}>
      <div className="pda-user-card">
        <div className="pda-user-name">{tui(user?.name || '-')}</div>
        <div className="pda-user-meta">
          <span>{tui(role?.roleNameZh || '') || roleCode}</span>
          {role?.workSection && <span> · {role.workSection.toUpperCase()}</span>}
        </div>
      </div>

      <div className="pda-menu-grid">
        {visibleMenu.map((item) => {
          const Icon = item.icon;
          const badge = badgeFor(item);
          return (
            <button
              key={item.key}
              type="button"
              className="pda-menu-item"
              onClick={() => navigate(item.to)}
            >
              {badge > 0 && <span className="pda-menu-badge">{badge > 99 ? '99+' : badge}</span>}
              <Icon size={30} className="pda-menu-icon" />
              <span className="pda-menu-label">{t(`pda.menu.${item.labelKey}`)}</span>
            </button>
          );
        })}
      </div>

      <div style={{ height: 16 }} />
      <button type="button" className="pda-btn pda-btn-ghost pda-btn-block" onClick={() => navigate('/pda/help')}>
        <HelpCircle size={18} style={{ marginRight: 8 }} />
        {t('pda.help')}
      </button>

      <div style={{ height: 10 }} />
      <button type="button" className="pda-btn pda-btn-primary pda-btn-block" onClick={handleTestAudio}>
        <Volume2 size={18} style={{ marginRight: 8 }} />
        {t('ui.音频测试')}
      </button>

      <div style={{ height: 10 }} />
      <button type="button" className="pda-btn pda-btn-ghost pda-btn-block" onClick={() => setShowChangePwd(true)}>
        <KeyRound size={18} style={{ marginRight: 8 }} />
        {t('system.changePassword')}
      </button>

      <div style={{ height: 10 }} />
      <button type="button" className="pda-btn pda-btn-danger pda-btn-block" onClick={handleLogout}>
        <LogOut size={18} style={{ marginRight: 8 }} />
        {t('pda.logout')}
      </button>

      {/* 主动改密：可取消、可关闭。强制改密的兜底在 PdaLayout 中 */}
      <ChangePasswordDialog
        open={showChangePwd}
        onOpenChange={setShowChangePwd}
        onSuccess={() => updateUser({ isFirstLogin: false })}
      />
    </PdaLayout>
  );
};

export default PdaHome;
