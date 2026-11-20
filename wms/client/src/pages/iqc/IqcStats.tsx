import React from 'react';
import IqcDashboard from '@client/src/pages/Dashboard/IqcDashboard';
import { useI18n } from '../../i18n';

/**
 * IQC 检验看板
 *
 * 说明：原页面下半部分曾有一套独立的"筛选栏 + 统计卡 + 柱状趋势 + TOP10"，
 * 与 IqcDashboard 的"统计卡 + 趋势图"重复，且两者口径不同（结束日右开区间、
 * 合格判定不一致），导致同一时间段数字对不上。
 * 现统一由 IqcDashboard 承载：一套筛选、一套统计卡、一张趋势图，TOP10 并入其中。
 * 后端统一走 /api/dashboard/iqc-stats。
 */
const IqcStats: React.FC = () => {
  const { t } = useI18n();

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-lg font-semibold text-foreground">{t('ui.IQC 检验看板')}</h2>
      <IqcDashboard />
    </div>
  );
};

export default IqcStats;
