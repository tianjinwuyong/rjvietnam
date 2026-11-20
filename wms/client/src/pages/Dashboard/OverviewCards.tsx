import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@client/src/components/ui/card';
import { BarChart3 } from 'lucide-react';
import { dashboard as dashboardApi } from '@client/src/api';
import type { DashboardOverview } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';
import { useI18n } from '../../i18n';

const OverviewCards: React.FC = () => {
  const { t } = useI18n();
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dashboardApi
      .getOverview()
      .then((res) => setData(res))
      .catch((err) => {
        logger.error('Failed to load overview', err);
        toast.error(t('ui.运营概览加载失败'));
      })
      .finally(() => setLoading(false));
  }, []);

  const items = [
    { label: t('ui.今日入库批数'), value: data?.todayReceiptLots ?? 0 },
    { label: t('ui.今日入库数量'), value: data?.todayReceiptQty ?? 0 },
    { label: t('ui.今日出库批数'), value: data?.todayIssueLots ?? 0 },
    { label: t('ui.今日出库数量'), value: data?.todayIssueQty ?? 0 },
    { label: t('ui.库存SKU数'), value: data?.stockSkuCount ?? 0 },
    { label: t('ui.库存总数量'), value: data?.stockTotalQty ?? 0 },
  ];

  const fmt = (n: number) => n.toLocaleString('en-US');

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <BarChart3 size={18} className="text-primary" />
          {t('ui.运营概览')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="animate-pulse h-20 rounded-xl bg-muted" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {items.map((item) => (
              <div
                key={item.label}
                className="rounded-xl bg-background p-4"
              >
                <p className="text-xl font-bold text-foreground">{fmt(item.value)}</p>
                <p className="text-xs text-muted-foreground mt-1">{item.label}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default OverviewCards;
