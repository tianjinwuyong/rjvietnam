import React from 'react';
import { useI18n } from '@client/src/i18n';
import { useAuth } from '@client/src/auth/AuthContext';
import { Card, CardContent } from '@client/src/components/ui/card';
import { User } from 'lucide-react';
import PendingCards from './PendingCards';
import SupplementDashboard from './SupplementDashboard';
import OverviewCards from './OverviewCards';
import DashboardEnhance from './DashboardEnhance';

const DashboardPage: React.FC = () => {
  const { t, lang } = useI18n();
  const { role } = useAuth();

  const getRoleDisplayName = () => {
    if (!role) return '';
    switch (lang) {
      case 'vi': return role.roleNameVi;
      case 'en': return role.roleNameEn;
      default: return role.roleNameZh;
    }
  };

  return (
    <div className="space-y-5">
      {/* 欢迎卡片 */}
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-[12px] bg-primary-soft flex items-center justify-center text-primary">
              <User size={28} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">
                {t('dashboard.welcome')}{getRoleDisplayName()}
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                {t('header.role')}: {getRoleDisplayName()}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 第一行：运营概览 */}
      <OverviewCards />

      {/* 第二行：待检统计 */}
      <PendingCards />

      {/* 快捷入口 + 待检批次 / 库存超期预警摘要 */}
      <DashboardEnhance />

      {/* 超补领料看板 */}
      <SupplementDashboard />
    </div>
  );
};

export default DashboardPage;
