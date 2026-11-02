import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@client/src/components/ui/card';
import { PackagePlus } from 'lucide-react';
import ReactECharts from 'echarts-for-react';
import { dashboard as dashboardApi } from '@client/src/api';
import type { SupplementSummary } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';
import { useI18n } from '../../i18n';
import { useChartInk } from '@client/src/theme/ThemeProvider';

const SupplementDashboard: React.FC = () => {
  const { t } = useI18n();
  const ink = useChartInk();
  const [data, setData] = useState<SupplementSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = () => {
    setLoading(true);
    dashboardApi
      .getSupplementSummary()
      .then((res) => setData(res))
      .catch((err) => {
        logger.error('Failed to load supplement summary', err);
        toast.error(t('ui.超补领料看板加载失败'));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
  }, []);

  const fmt = (n: number) => n.toLocaleString('en-US');

  const topMaterials = data?.topMaterials ?? [];
  // 过滤掉超补数量为0的记录
  const recentRecords = (data?.recentRecords ?? []).filter((r) => Number(r.supplementQty) > 0);
  // 如果没有任何超补数据，整个看板不显示
  const hasSupplementData =
    (data?.supplementTotalQty ?? 0) > 0 ||
    (data?.supplementWorkOrderCount ?? 0) > 0 ||
    (data?.supplementPickingCount ?? 0) > 0 ||
    topMaterials.length > 0 ||
    recentRecords.length > 0;

  if (!loading && !hasSupplementData) {
    return null;
  }

  const barOption =
    topMaterials.length > 0
      ? {
          tooltip: { trigger: 'axis' as const },
          textStyle: { color: ink.sub },
          grid: { left: 10, right: 20, top: 20, bottom: 40, containLabel: true },
          xAxis: {
            type: 'category' as const,
            data: topMaterials.map((m) => m.materialName || m.materialCode),
            axisLabel: { rotate: topMaterials.length > 3 ? 20 : 0, fontSize: 11, color: ink.sub },
          },
          yAxis: { type: 'value' as const, name: t('ui.超补数量'), axisLabel: { color: ink.sub }, splitLine: { lineStyle: { color: ink.grid } } },
          series: [
            {
              type: 'bar' as const,
              data: topMaterials.map((m) => m.supplementQty),
              itemStyle: { color: ink.primary, borderRadius: [6, 6, 0, 0] },
              barMaxWidth: 40,
            },
          ],
        }
      : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <PackagePlus size={18} className="text-primary" />
          {t('ui.超补领料看板')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="animate-pulse h-40 rounded-xl bg-muted" />
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-xl bg-[#FFF8E6] p-4">
                <p className="text-xl font-bold text-foreground">
                  {fmt(data?.supplementWorkOrderCount ?? 0)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{t('ui.超补工单数')}</p>
              </div>
              <div className="rounded-xl bg-[#FFF8E6] p-4">
                <p className="text-xl font-bold text-foreground">
                  {fmt(data?.supplementPickingCount ?? 0)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{t('ui.超补领料单数')}</p>
              </div>
              <div className="rounded-xl bg-[#FFF8E6] p-4">
                <p className="text-xl font-bold text-foreground">
                  {fmt(data?.supplementTotalQty ?? 0)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{t('ui.超补总数量')}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div>
                <p className="text-sm font-semibold text-foreground mb-2">{t('ui.超补物料 TOP5')}</p>
                {topMaterials.length > 0 ? (
                  <ReactECharts option={barOption!} style={{ height: 300 }} notMerge />
                ) : (
                  <div className="h-[300px] rounded-xl bg-background flex items-center justify-center text-sm text-muted-foreground">
                    {t('ui.暂无超补数据')}
                  </div>
                )}
              </div>

              <div>
                <p className="text-sm font-semibold text-foreground mb-2">{t('ui.近期超补记录')}</p>
                {recentRecords.length > 0 ? (
                  <div className="overflow-x-auto rounded-xl border border-border h-[300px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0">
                        <tr className="bg-background text-muted-foreground">
                          <th className="text-left px-3 py-2 font-medium">{t('pda.picking.wo')}</th>
                          <th className="text-left px-3 py-2 font-medium">{t('workorder.pickingNo')}</th>
                          <th className="text-left px-3 py-2 font-medium">{t('iqc.materialCode')}</th>
                          <th className="text-left px-3 py-2 font-medium">{t('iqc.materialName')}</th>
                          <th className="text-right px-3 py-2 font-medium">{t('overPicking.totalQty')}</th>
                          <th className="text-left px-3 py-2 font-medium">{t('common.time')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentRecords.map((r, i) => (
                          <tr key={i} className="border-t border-border">
                            <td className="px-3 py-2">{r.workOrderNo}</td>
                            <td className="px-3 py-2">{r.pickingNo}</td>
                            <td className="px-3 py-2">{r.materialCode}</td>
                            <td className="px-3 py-2">{r.materialName}</td>
                            <td className="px-3 py-2 text-right font-medium text-[#FF3B30]">
                              {fmt(r.supplementQty)}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {r.createdAt ? new Date(r.createdAt).toLocaleString('zh-CN') : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="h-[300px] rounded-xl bg-background flex items-center justify-center text-sm text-muted-foreground">
                    {t('ui.暂无超补数据')}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default SupplementDashboard;
