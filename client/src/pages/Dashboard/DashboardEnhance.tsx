import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { Card, CardContent } from '@client/src/components/ui/card';
import { Button } from '@client/src/components/ui/button';
import { ArrowRight, Target } from 'lucide-react';
import ReactECharts from 'echarts-for-react';
import { iqc as iqcApi, dashboard as dashboardApi } from '@client/src/api';
import { getExpiryInventory } from '@client/src/api/inventory';
import type { ExpiryInventoryItem } from '@client/src/api/inventory';
import type { IqcSummary, IqcTrendPoint } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { renderDateTimeMinute } from '@client/src/utils/datetime';
import { useI18n, tf, translate as t } from '../../i18n';
import { useChartInk, CHART } from '@client/src/theme/ThemeProvider';
import { toast } from 'sonner';


const fmt = (n: number) => (n == null ? '-' : Number(n).toLocaleString());

const statusBadge = (status: string) => {
  const map: Record<string, { text: string; cls: string }> = {
    pending: { text: t('ui.待检验'), cls: 'bg-yellow-100 text-yellow-800' },
    inspecting: { text: t('ui.检验中'), cls: 'bg-blue-100 text-blue-800' },
    rejected: { text: t('ui.被驳回'), cls: 'bg-orange-100 text-orange-800' },
  };
  const item = map[status] || { text: status, cls: 'bg-muted text-foreground' };
  return <span className={`px-1.5 py-0.5 text-xs rounded ${item.cls}`}>{item.text}</span>;
};

const sourceBadge = (val?: string | null) => {
  if (val === 'production_return' || val === '产线退料')
    return <span className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">{t('ui.产线退料')}</span>;
  if (val === 'expiry_reinspect' || val === '超期复检')
    return <span className="px-1.5 py-0.5 text-xs bg-orange-100 text-orange-700 rounded">{t('ui.超期复检')}</span>;
  return <span className="px-1.5 py-0.5 text-xs bg-muted text-foreground rounded">{t('ui.来料检验')}</span>;
};

/** 首页：待检批次摘要（最近报检的 5 条） */
const PendingSummary: React.FC = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    iqcApi
      .getPendingList({ page: 1, pageSize: 5, statuses: 'pending,rejected' })
      .then((res) => {
        setItems(res.items || []);
        setTotal(res.total || 0);
      })
      .catch((err) => { logger.error('dashboard pending summary failed', err); toast.error(t('message.loadFailed')); })
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">{tf('ui.待检批次（共 {n} 条）', { n: total })}</h3>
          <Button size="sm" variant="ghost" onClick={() => navigate('/iqc/pending')}>
            {t('ui.进入待检清单')} <ArrowRight size={14} className="ml-1" />
          </Button>
        </div>
        {loading ? (
          <div className="animate-pulse h-24 rounded-xl bg-muted" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">{t('ui.当前没有待检批次')}</p>
        ) : (
          <div className="divide-y divide-border">
            {items.map((it: any) => (
              <div
                key={it.id}
                className="flex items-center justify-between gap-3 py-2 cursor-pointer hover:bg-muted/40 rounded px-1"
                onClick={() => navigate(`/iqc/inspect/${it.id}`)}
              >
                <span className="font-mono text-sm font-medium text-foreground w-[130px] shrink-0">
                  {it.inspectionNo || '-'}
                </span>
                <span className="flex-1 truncate text-sm text-foreground" title={it.materialName}>
                  {it.materialName || '-'}
                </span>
                <span className="text-xs text-muted-foreground w-[70px] shrink-0 text-right">{it.batchNo || '-'}</span>
                <span className="text-xs text-muted-foreground w-[110px] shrink-0 text-right hidden md:inline">
                  {renderDateTimeMinute(it.submittedAt)}
                </span>
                {sourceBadge(it.materialSource)}
                {statusBadge(it.status)}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

/** 首页：库存超期 / 预警摘要（各取前 3 条） */
const ExpirySummary: React.FC = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [items, setItems] = useState<ExpiryInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getExpiryInventory({ type: 'expired', page: 1, pageSize: 3 }).catch(() => null),
      getExpiryInventory({ type: 'warning', page: 1, pageSize: 3 }).catch(() => null),
    ])
      .then(([expired, warning]) => {
        const list = [
          ...(expired?.items || []),
          ...(warning?.items || []),
        ];
        setItems(list.slice(0, 6));
      })
      .catch((err) => { logger.error('dashboard expiry summary failed', err); toast.error(t('message.loadFailed')); })
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">{t('ui.库存超期 / 预警')}</h3>
          <Button size="sm" variant="ghost" onClick={() => navigate('/inventory/query')}>
            {t('ui.查看库存')} <ArrowRight size={14} className="ml-1" />
          </Button>
        </div>
        {loading ? (
          <div className="animate-pulse h-24 rounded-xl bg-muted" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">{t('ui.没有超期或预警库存')}</p>
        ) : (
          <div className="divide-y divide-border">
            {items.map((it) => {
              const expired = it.remainingDays <= 0;
              return (
                <div key={it.id} className="flex items-center justify-between gap-3 py-2 px-1">
                  <span className="text-xs text-muted-foreground w-[95px] shrink-0">{it.materialCode || '-'}</span>
                  <span className="flex-1 truncate text-sm text-foreground" title={it.materialName}>
                    {it.materialName || '-'}
                  </span>
                  <span className="text-xs text-muted-foreground w-[70px] shrink-0 text-right">{it.batchNo || '-'}</span>
                  <span className="text-xs text-muted-foreground w-[60px] shrink-0 text-right">{it.quantity}</span>
                  <span
                    className={`px-1.5 py-0.5 text-xs rounded shrink-0 ${
                      expired ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-800'
                    }`}
                  >
                    {expired ? t('ui.已超期') : tf('ui.剩 {n} 天', { n: it.remainingDays })}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

/** 首页：IQC 检验 LOT 合格率（汇总卡片 + 近30天趋势） */
const IqcLotRate: React.FC = () => {
  const { t } = useI18n();
  const ink = useChartInk();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<IqcSummary | null>(null);
  const [trend, setTrend] = useState<IqcTrendPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const start = dayjs().subtract(30, 'day').format('YYYY-MM-DD');
    const end = dayjs().format('YYYY-MM-DD');
    Promise.all([
      dashboardApi.getIqcSummary({ startDate: start, endDate: end }),
      dashboardApi
        .getIqcTrend({ startDate: start, endDate: end, granularity: 'day', groupBy: 'overall' })
        .catch(() => [] as IqcTrendPoint[]),
    ])
      .then(([s, tr]) => {
        setSummary(s);
        setTrend(tr);
      })
      .catch((err) => logger.error('dashboard iqc lot rate failed', err))
      .finally(() => setLoading(false));
  }, []);

  const targetRate = summary?.targetPassRate ?? 0;
  const passRate = summary?.passRate ?? 0;
  const passRateColor = passRate >= targetRate ? CHART.green : CHART.red;

  const option = {
    grid: { left: 42, right: 16, top: 24, bottom: 26 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: trend.map((p) => p.date),
      axisLabel: { fontSize: 10, color: ink.sub },
      axisLine: { lineStyle: { color: ink.grid } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLabel: { formatter: '{value}%', fontSize: 10, color: ink.sub },
      splitLine: { lineStyle: { color: ink.grid } },
    },
    series: [
      {
        name: t('ui.LOT合格率'),
        type: 'line',
        data: trend.map((p) => Number(p.passRate.toFixed(1))),
        symbolSize: 6,
        lineStyle: { color: CHART.blue, width: 2 },
        itemStyle: { color: CHART.blue },
        markLine: {
          silent: true,
          symbol: 'none',
          label: { formatter: `${t('ui.目标合格率')} ${targetRate}%`, color: CHART.red, fontSize: 10 },
          lineStyle: { color: CHART.red, type: 'dashed' },
          data: [{ yAxis: targetRate }],
        },
      },
    ],
  };

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">{t('ui.IQC检验LOT合格率')}</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t('ui.近30天')}</span>
            <Button size="sm" variant="ghost" onClick={() => navigate('/iqc/stats')}>
              {t('ui.查看完整看板')} <ArrowRight size={14} className="ml-1" />
            </Button>
          </div>
        </div>

        {loading ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="animate-pulse h-20 rounded-xl bg-muted" />
              ))}
            </div>
            <div className="animate-pulse h-48 rounded-xl bg-muted" />
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="rounded-xl bg-background p-4">
                <p className="text-2xl font-bold text-foreground">{fmt(summary?.totalLots ?? 0)}</p>
                <p className="text-xs text-muted-foreground mt-1">{t('ui.检验总批数')}</p>
              </div>
              <div className="rounded-xl bg-background p-4">
                <p className="text-2xl font-bold" style={{ color: CHART.green }}>
                  {fmt(summary?.passedLots ?? 0)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{t('ui.合格批数')}</p>
              </div>
              <div className="rounded-xl bg-background p-4">
                <p className="text-2xl font-bold" style={{ color: passRateColor }}>
                  {(summary?.passRate ?? 0).toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">{t('ui.LOT合格率')}</p>
              </div>
              <div className="rounded-xl bg-background p-4">
                <p className="text-2xl font-bold flex items-center gap-1" style={{ color: CHART.blue }}>
                  <Target size={18} />
                  {(summary?.targetPassRate ?? 0).toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">{t('ui.目标合格率')}</p>
              </div>
            </div>
            {trend.length > 0 ? (
              <div className="mt-4">
                <ReactECharts option={option} notMerge style={{ height: 220, width: '100%' }} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center mt-2">{t('ui.合格率趋势加载失败')}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

const DashboardEnhance: React.FC = () => (
  <>
    <IqcLotRate />
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <PendingSummary />
      <ExpirySummary />
    </div>
  </>
);

export default DashboardEnhance;
