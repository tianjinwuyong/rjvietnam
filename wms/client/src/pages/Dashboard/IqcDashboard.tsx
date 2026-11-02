import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { Card, CardContent, CardHeader, CardTitle } from '@client/src/components/ui/card';
import { Button } from '@client/src/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import {
  FileSearch,
  Target,
  AlertTriangle,
  XCircle,
  Settings2,
  Search,
  RotateCcw,
} from 'lucide-react';
import ReactECharts from 'echarts-for-react';
import DefectDetailDialog, { type DefectDimension } from './DefectDetailDialog';
import { dashboard as dashboardApi } from '@client/src/api';
import type { TargetConfig } from '@client/src/api/dashboard';
import type {
  IqcTrendPoint,
  IqcRankItem,
  IqcDefectTypeItem,
  IqcDefectMaterialTypeItem,
  IqcOverdueStats,
} from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';
import { useI18n, tf } from '../../i18n';
import { useChartInk, CHART } from '@client/src/theme/ThemeProvider';
import { IQC_DEFECT_TYPES } from '@client/src/constants/business-enums';

type Granularity = 'month' | 'week' | 'day';
type GroupBy = 'overall' | 'supplier' | 'materialType';

interface FilterState {
  startDate: string;
  endDate: string;
  granularity: Granularity;
  groupBy: GroupBy;
  /** 维度筛选值：按供应商时为供应商编码/名称（模糊），按物料类型时为物料类型 */
  dimensionValue: string;
  /** 物料编码（模糊） */
  materialCode: string;
}

/** 多线模式下最多展示的分组数，超出合并为「其他（合并）」 */
const MAX_LINES = 8;
const MERGED_KEY = '其他（合并）';

/** 物料类型目标配置的键（与目标设置弹窗保持一致） */
const MATERIAL_TYPES = [
  { key: 'plastic', labelKey: 'ui.塑胶件' },
  { key: 'metal', labelKey: 'ui.五金件' },
  { key: 'magnetic', labelKey: 'ui.磁性器件' },
  { key: 'electronic', labelKey: 'ui.电子通用件' },
  { key: 'auxiliary', labelKey: 'ui.辅料' },
  { key: 'packaging', labelKey: 'ui.包材' },
  { key: 'pcb', labelKey: '' },
  { key: 'wire', labelKey: 'ui.线材' },
  { key: 'other', labelKey: 'ui.其他' },
];

const inputCls = 'h-9 rounded-[10px] border border-border bg-card px-2 text-sm';

function rateColor(rate: number, target: number): string {
  if (rate >= target) return CHART.green;
  if (rate >= target * 0.9) return CHART.orange;
  return CHART.red;
}

const IqcDashboard: React.FC = () => {
  const { t } = useI18n();
  const ink = useChartInk();

  const defaultFilter = useCallback((): FilterState => {
    return {
      startDate: dayjs().subtract(30, 'day').format('YYYY-MM-DD'),
      endDate: dayjs().format('YYYY-MM-DD'),
      granularity: 'day',
      groupBy: 'overall',
      dimensionValue: '',
      materialCode: '',
    };
  }, []);

  // 已应用的筛选（驱动请求）与草稿（界面输入）
  const [filter, setFilter] = useState<FilterState>(defaultFilter);
  const [draft, setDraft] = useState<FilterState>(defaultFilter);

  // 聚合数据：汇总 + 趋势 + 排行 + 物料类型选项
  const [stats, setStats] = useState<{
    summary: { totalLots: number; passedLots: number; failedLots: number; passRate: number; targetPassRate: number };
    trend: IqcTrendPoint[];
    topMaterials: IqcRankItem[];
    topSuppliers: IqcRankItem[];
    materialTypes: string[];
  } | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // 不良分布 + 超期预警（全局指标，不随维度切换）
  const [defectByType, setDefectByType] = useState<IqcDefectTypeItem[]>([]);
  const [defectByMaterialType, setDefectByMaterialType] = useState<IqcDefectMaterialTypeItem[]>([]);
  const [overdue, setOverdue] = useState<IqcOverdueStats | null>(null);
  const [defectLoading, setDefectLoading] = useState(true);
  const [overdueLoading, setOverdueLoading] = useState(true);

  /** 饼图下钻：点击某个扇区后弹出该分类的不合格批次台账 */
  const [drill, setDrill] = useState<{ dimension: DefectDimension; value: string } | null>(null);

  // 目标设置弹窗
  const [targetOpen, setTargetOpen] = useState(false);
  const [targetStep, setTargetStep] = useState<'verify' | 'config'>('verify');
  const [adminAccount, setAdminAccount] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [targetOverall, setTargetOverall] = useState('');
  const [targetByType, setTargetByType] = useState<Record<string, string>>({});
  const [savingTarget, setSavingTarget] = useState(false);

  const loadStats = useCallback((f: FilterState) => {
    setStatsLoading(true);
    dashboardApi
      .getIqcStats({
        startDate: f.startDate,
        endDate: f.endDate,
        granularity: f.granularity,
        groupBy: f.groupBy,
        dimensionValue: f.dimensionValue.trim() || undefined,
        materialCode: f.materialCode.trim() || undefined,
      })
      .then((res) => setStats(res))
      .catch((err) => {
        logger.error('Failed to load iqc stats', err);
        toast.error(t('ui.IQC统计数据加载失败'));
        setStats(null);
      })
      .finally(() => setStatsLoading(false));
  }, []);

  const loadDefect = useCallback((startDate: string, endDate: string) => {
    setDefectLoading(true);
    Promise.all([
      dashboardApi.getIqcDefectByType({ startDate, endDate }),
      dashboardApi.getIqcDefectByMaterialType({ startDate, endDate }),
    ])
      .then(([byType, byMaterialType]) => {
        setDefectByType(byType || []);
        setDefectByMaterialType(byMaterialType || []);
      })
      .catch((err) => {
        logger.error('Failed to load defect distribution', err);
        toast.error(t('ui.不合格分布加载失败'));
      })
      .finally(() => setDefectLoading(false));
  }, []);

  const loadOverdue = useCallback(() => {
    setOverdueLoading(true);
    dashboardApi
      .getIqcOverdue()
      .then((res) => setOverdue(res))
      .catch((err) => {
        logger.error('Failed to load iqc overdue', err);
        toast.error(t('ui.超期预警加载失败'));
      })
      .finally(() => setOverdueLoading(false));
  }, []);

  useEffect(() => {
    loadStats(filter);
    loadDefect(filter.startDate, filter.endDate);
    loadOverdue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleQuery = () => {
    const next = { ...draft };
    setFilter(next);
    loadStats(next);
    loadDefect(next.startDate, next.endDate);
  };

  const handleReset = () => {
    const next = defaultFilter();
    setDraft(next);
    setFilter(next);
    loadStats(next);
    loadDefect(next.startDate, next.endDate);
  };

  /** 切换分析维度时清空旧的维度筛选值（供应商名 / 物料类型语义不同） */
  const handleGroupByChange = (v: GroupBy) => {
    setDraft((prev) => ({ ...prev, groupBy: v, dimensionValue: '' }));
  };

  // ---- 目标设置 ----
  const openTargetModal = async () => {
    setTargetStep('verify');
    setAdminAccount('');
    setAdminPassword('');
    setTargetOpen(true);
    try {
      const config = await dashboardApi.getTargetConfig();
      setTargetOverall(String(config.overall));
      const byType: Record<string, string> = {};
      for (const mt of MATERIAL_TYPES) {
        const val = config.byType[mt.key];
        byType[mt.key] = val != null ? String(val) : '';
      }
      setTargetByType(byType);
    } catch {
      setTargetOverall(stats?.summary.targetPassRate != null ? String(stats.summary.targetPassRate) : '95');
    }
  };

  const handleVerifyAdmin = async () => {
    if (!adminAccount.trim() || !adminPassword) {
      toast.error(t('ui.请输入管理员账号和密码'));
      return;
    }
    setVerifying(true);
    try {
      await dashboardApi.verifyAdmin(adminAccount.trim(), adminPassword);
      setTargetStep('config');
      toast.success(t('ui.验证通过，请设置目标'));
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || '验证失败');
    } finally {
      setVerifying(false);
    }
  };

  const saveTarget = async () => {
    const overall = Number(targetOverall);
    if (Number.isNaN(overall) || overall < 0 || overall > 100) {
      toast.error(t('ui.总目标合格率必须在0-100之间'));
      return;
    }
    const byType: Record<string, number | null> = {};
    for (const mt of MATERIAL_TYPES) {
      const val = targetByType[mt.key];
      if (val && val.trim() !== '') {
        const num = Number(val);
        if (Number.isNaN(num) || num < 0 || num > 100) {
          toast.error(`${mt.labelKey ? t(mt.labelKey) + ': ' : ''}${t('ui.目标合格率必须在0-100之间')}`);
          return;
        }
        byType[mt.key] = num;
      } else {
        byType[mt.key] = null;
      }
    }
    setSavingTarget(true);
    try {
      const payload: TargetConfig = { overall, byType };
      await dashboardApi.updateTargetConfig(adminAccount.trim(), adminPassword, payload);
      toast.success(t('ui.目标合格率已保存'));
      setTargetOpen(false);
      loadStats(filter);
      loadDefect(filter.startDate, filter.endDate);
    } catch (err: any) {
      logger.error('Failed to save target config', err);
      toast.error(err?.response?.data?.message || err?.message || '保存失败');
    } finally {
      setSavingTarget(false);
    }
  };

  const summary = stats?.summary;
  const targetRate = summary?.targetPassRate ?? 0;
  const passRate = summary?.passRate ?? 0;

  // ---- 趋势图配置：整体单线；按供应商/物料类型多线（超 8 组合并） ----
  const trendOption = useMemo(() => {
    const trend = stats?.trend ?? [];
    if (trend.length === 0) return null;

    const dateSet = Array.from(new Set(trend.map((p) => p.date))).sort();

    if (filter.groupBy === 'overall') {
      const byDate = new Map(trend.map((p) => [p.date, p]));
      return {
        textStyle: { color: ink.sub },
        tooltip: { trigger: 'axis' },
        grid: { left: 10, right: 24, top: 34, bottom: 34, containLabel: true },
        xAxis: { type: 'category', data: dateSet, boundaryGap: false },
        yAxis: { type: 'value', min: 0, max: 100, name: '%' },
        series: [
          {
            name: t('ui.LOT合格率'),
            type: 'line',
            data: dateSet.map((d) => {
              const p = byDate.get(d);
              return p ? Number(p.passRate.toFixed(1)) : null;
            }),
            smooth: true,
            symbol: 'circle',
            symbolSize: 6,
            connectNulls: false,
            lineStyle: { color: CHART.blue, width: 2 },
            itemStyle: { color: CHART.blue },
            markLine: {
              silent: true,
              symbol: 'none',
              lineStyle: { color: CHART.red, type: 'dashed', width: 1.5 },
              label: { formatter: tf('ui.目标 {n}%', { n: targetRate }), color: CHART.red, fontSize: 11 },
              data: [{ yAxis: targetRate }],
            },
          },
        ],
      };
    }

    // 多线：先按总量排序，取前 8 组，其余合并
    const groupTotal = new Map<string, number>();
    for (const p of trend) {
      const key = p.groupKey || '未分组';
      groupTotal.set(key, (groupTotal.get(key) || 0) + p.totalLots);
    }
    const allKeys = Array.from(groupTotal.keys());
    const keep = new Set(
      allKeys.sort((a, b) => (groupTotal.get(b) || 0) - (groupTotal.get(a) || 0)).slice(0, MAX_LINES),
    );

    // 合并后的 {group, date} -> {total, passed}
    const agg = new Map<string, Map<string, { total: number; passed: number }>>();
    for (const p of trend) {
      const rawKey = p.groupKey || '未分组';
      const key = allKeys.length > MAX_LINES && !keep.has(rawKey) ? MERGED_KEY : rawKey;
      if (!agg.has(key)) agg.set(key, new Map());
      const dateMap = agg.get(key)!;
      const cur = dateMap.get(p.date) || { total: 0, passed: 0 };
      dateMap.set(p.date, { total: cur.total + p.totalLots, passed: cur.passed + p.passedLots });
    }

    const seriesKeys = Array.from(agg.keys());

    return {
      textStyle: { color: ink.sub },
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, type: 'scroll', textStyle: { color: ink.sub } },
      grid: { left: 10, right: 24, top: 34, bottom: 54, containLabel: true },
      xAxis: { type: 'category', data: dateSet, boundaryGap: false },
      yAxis: { type: 'value', min: 0, max: 100, name: '%' },
      series: seriesKeys.map((key, gi) => {
        const dateMap = agg.get(key)!;
        const isMerged = key === MERGED_KEY;
        const color = isMerged ? '#8E8E93' : CHART.palette[gi % CHART.palette.length];
        return {
          name: key,
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 5,
          connectNulls: false,
          data: dateSet.map((d) => {
            const v = dateMap.get(d);
            if (!v || v.total === 0) return null;
            return Number(((v.passed / v.total) * 100).toFixed(1));
          }),
          lineStyle: { color, width: 2, type: isMerged ? 'dashed' : 'solid' },
          itemStyle: { color },
          markLine:
            gi === 0
              ? {
                  silent: true,
                  symbol: 'none',
                  lineStyle: { color: CHART.red, type: 'dashed', width: 1.5 },
                  label: { formatter: tf('ui.目标 {n}%', { n: targetRate }), color: CHART.red, fontSize: 11 },
                  data: [{ yAxis: targetRate }],
                }
              : undefined,
        };
      }),
    };
  }, [stats, filter.groupBy, targetRate, t, ink]);

  /** 不良类型文案：库里存的是八项中文口径，英文/越南语界面按词条翻译；非标准值原样显示 */
  const defectTypeLabel = useCallback(
    (name: string) => {
      if (!name) return name;
      if (name === '未分类') return t('ui.未分类');
      return (IQC_DEFECT_TYPES as readonly string[]).includes(name)
        ? t(`iqc.defect_type_${name}` as any)
        : name;
    },
    [t],
  );

  // 两个饼图统一按「合并后的 IQC 检验批数」统计，一个批次只计一次，
  // 因此各扇区数值之和 = 上方卡片的「不合格批数」，可逐块对账。
  // 不良类型取自检验报告底部选择的 defect_type（一批准一个类型），不再按逐项不良描述分类。
  const typePieOption = useMemo(
    () =>
      defectByType.length > 0
        ? {
            textStyle: { color: ink.sub },
            tooltip: {
              trigger: 'item',
              formatter: (p: any) =>
                `${defectTypeLabel(p.name)}: ${p.value} ${t('ui.批')} (${p.percent}%)`,
            },
            legend: {
              bottom: 0,
              type: 'scroll',
              textStyle: { color: ink.sub },
              formatter: (name: string) => defectTypeLabel(name),
            },
            series: [
              {
                type: 'pie',
                radius: ['40%', '65%'],
                center: ['50%', '45%'],
                // name 保留库里的原值（点击下钻按原值查明细），展示文案由 formatter 翻译
                data: defectByType.map((d) => ({ name: d.type, value: d.count })),
                label: {
                  fontSize: 11,
                  formatter: (p: any) => `${defectTypeLabel(p.name)}\n${p.value}`,
                },
                cursor: 'pointer',
                emphasis: {
                  scale: true,
                  scaleSize: 6,
                  itemStyle: { shadowBlur: 12, shadowColor: 'rgba(0,0,0,0.18)' },
                },
              },
            ],
          }
        : null,
    [defectByType, t, ink, defectTypeLabel],
  );

  const materialPieOption = useMemo(
    () =>
      defectByMaterialType.length > 0
        ? {
            textStyle: { color: ink.sub },
            tooltip: {
              trigger: 'item',
              formatter: `{b}: {c} ${t('ui.批')} ({d}%)`,
            },
            legend: { bottom: 0, type: 'scroll', textStyle: { color: ink.sub } },
            series: [
              {
                type: 'pie',
                radius: ['40%', '65%'],
                center: ['50%', '45%'],
                data: defectByMaterialType.map((d) => ({ name: d.materialType, value: d.count })),
                label: { fontSize: 11, formatter: '{b}\n{c}' },
                cursor: 'pointer',
                emphasis: {
                  scale: true,
                  scaleSize: 6,
                  itemStyle: { shadowBlur: 12, shadowColor: 'rgba(0,0,0,0.18)' },
                },
              },
            ],
          }
        : null,
    [defectByMaterialType, t, ink],
  );

  /** 物料类型合计批数（= 各扇区相加 = 卡片的不合格批数） */
  const materialPieTotal = useMemo(
    () => defectByMaterialType.reduce((s, d) => s + d.count, 0),
    [defectByMaterialType],
  );

  const fmt = (n: number) => n.toLocaleString('en-US');

  const statCards = [
    { label: t('ui.检验总批数'), value: fmt(summary?.totalLots ?? 0), color: 'var(--color-text-primary)', hint: '' },
    { label: t('ui.合格批数'), value: fmt(summary?.passedLots ?? 0), color: CHART.green, hint: '' },
    { label: t('ui.不合格批数'), value: fmt(summary?.failedLots ?? 0), color: CHART.red, hint: t('ui.含驳回批次') },
    {
      label: t('ui.LOT合格率'),
      value: `${Number(passRate).toFixed(1)}%`,
      color: rateColor(passRate, targetRate),
      hint: tf('ui.目标 {n}%', { n: targetRate }),
    },
  ];

  const renderRankTable = (title: string, rows: IqcRankItem[], keyLabel: string, nameLabel: string) => (
    <Card>
      <CardContent className="pt-4">
        <h3 className="text-base font-semibold text-foreground mb-3">{title}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b">
                <th className="py-2 px-2 text-left font-medium w-12">{t('ui.排名')}</th>
                <th className="py-2 px-2 text-left font-medium">{keyLabel}</th>
                <th className="py-2 px-2 text-left font-medium">{nameLabel}</th>
                <th className="py-2 px-2 text-right font-medium">{t('ui.总批次')}</th>
                <th className="py-2 px-2 text-right font-medium">{t('iqc.passed')}</th>
                <th className="py-2 px-2 text-left font-medium w-32">{t('ui.合格率')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted-foreground">
                    {t('common.noData')}
                  </td>
                </tr>
              )}
              {rows.map((r, idx) => {
                const rate = Number(r.passRate) || 0;
                const color = rateColor(rate, targetRate);
                // 主数据里名称为空时后端会回落成编码，这里标记出来，
                // 避免看起来像「名称列显示的还是代码」的 Bug
                const nameMissing = !r.name || r.name === '-' || r.name === r.key;
                return (
                  <tr key={`${r.key}-${idx}`} className="border-b border-border/60">
                    <td className="py-2 px-2">{idx + 1}</td>
                    <td className="py-2 px-2">{r.key || '-'}</td>
                    <td className="py-2 px-2">
                      {nameMissing ? (
                        <span className="text-muted-foreground">
                          {t('ui.名称未维护')}
                        </span>
                      ) : (
                        r.name
                      )}
                    </td>
                    <td className="py-2 px-2 text-right">{r.totalLots}</td>
                    <td className="py-2 px-2 text-right">{r.passedLots}</td>
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.min(rate, 100)}%`, backgroundColor: color }} />
                        </div>
                        <span className="text-xs w-14 text-right" style={{ color }}>
                          {rate.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <FileSearch size={18} className="text-primary" />
            {t('ui.IQC来料检验看板')}
          </CardTitle>
          <Button variant="outline" size="sm" onClick={openTargetModal}>
            <Settings2 size={14} />
            {t('ui.目标设置')}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* ===== 统一筛选区：一套筛选驱动全部数据 ===== */}
        <div className="rounded-xl bg-background p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t('common.startDate')}</label>
              <input
                type="date"
                value={draft.startDate}
                onChange={(e) => setDraft((p) => ({ ...p, startDate: e.target.value }))}
                className={inputCls}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t('common.endDate')}</label>
              <input
                type="date"
                value={draft.endDate}
                onChange={(e) => setDraft((p) => ({ ...p, endDate: e.target.value }))}
                className={inputCls}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t('ui.分析维度')}</label>
              <select
                value={draft.groupBy}
                onChange={(e) => handleGroupByChange(e.target.value as GroupBy)}
                className={inputCls}
              >
                <option value="overall">{t('ui.整体')}</option>
                <option value="supplier">{t('ui.按供应商')}</option>
                <option value="materialType">{t('ui.按物料类型')}</option>
              </select>
            </div>

            {draft.groupBy === 'supplier' && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">{t('ui.供应商（编码/名称模糊）')}</label>
                <input
                  type="text"
                  placeholder={t('ui.输入编码或名称片段')}
                  value={draft.dimensionValue}
                  onChange={(e) => setDraft((p) => ({ ...p, dimensionValue: e.target.value }))}
                  className={`${inputCls} w-44`}
                />
              </div>
            )}

            {draft.groupBy === 'materialType' && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">{t('material.materialType')}</label>
                <select
                  value={draft.dimensionValue}
                  onChange={(e) => setDraft((p) => ({ ...p, dimensionValue: e.target.value }))}
                  className={inputCls}
                >
                  <option value="">{t('common.all')}</option>
                  {(stats?.materialTypes ?? []).map((mt) => (
                    <option key={mt} value={mt}>
                      {mt}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t('iqc.materialCode')}</label>
              <input
                type="text"
                placeholder={t('ui.物料编码模糊')}
                value={draft.materialCode}
                onChange={(e) => setDraft((p) => ({ ...p, materialCode: e.target.value }))}
                className={`${inputCls} w-40`}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t('ui.汇总粒度')}</label>
              <select
                value={draft.granularity}
                onChange={(e) => setDraft((p) => ({ ...p, granularity: e.target.value as Granularity }))}
                className={inputCls}
              >
                <option value="day">{t('ui.日')}</option>
                <option value="week">{t('ui.周')}</option>
                <option value="month">{t('ui.月')}</option>
              </select>
            </div>

            <div className="flex gap-2 pb-0.5">
              <Button size="sm" onClick={handleQuery}>
                <Search size={14} />
                {t('common.search')}
              </Button>
              <Button size="sm" variant="outline" onClick={handleReset}>
                <RotateCcw size={14} />
                {t('common.reset')}
              </Button>
            </div>
          </div>
        </div>

        {/* ===== 4 张统计卡 ===== */}
        {statsLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="animate-pulse h-24 rounded-xl bg-muted" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {statCards.map((c) => (
              <div key={c.label} className="rounded-xl bg-background p-4">
                <p className="text-2xl font-bold" style={{ color: c.color }}>
                  {c.value}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{c.label}</p>
                {c.hint ? <p className="text-xs text-muted-foreground mt-0.5">{c.hint}</p> : null}
              </div>
            ))}
          </div>
        )}

        {/* ===== 合格率趋势（唯一一张） ===== */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-foreground">
              {t('ui.合格率趋势')}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {filter.groupBy === 'overall'
                  ? t('ui.整体合格率')
                  : filter.groupBy === 'supplier'
                    ? t('ui.按供应商对比')
                    : t('ui.按物料类型对比')}
              </span>
            </p>
            <span className="text-xs text-muted-foreground">
              {filter.startDate} ~ {filter.endDate}
            </span>
          </div>
          {statsLoading ? (
            <div className="animate-pulse h-[300px] rounded-xl bg-muted" />
          ) : trendOption ? (
            <ReactECharts option={trendOption} style={{ height: 300 }} notMerge />
          ) : (
            <div className="h-[300px] rounded-xl bg-background flex items-center justify-center text-sm text-muted-foreground">
              {t('common.noData')}
            </div>
          )}
        </div>

        {/* ===== 不合格分布（按合并批数统计，点击扇区下钻台账） ===== */}
        {defectLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="animate-pulse h-[260px] rounded-xl bg-muted" />
            <div className="animate-pulse h-[260px] rounded-xl bg-muted" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-baseline justify-between mb-2">
                <p className="text-sm font-semibold text-foreground">
                  {t('ui.不合格按不良类型分布')}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {t('ui.按批数')} · {t('ui.按报告不良类型')}
                  </span>
                </p>
                <span className="text-xs text-muted-foreground">{t('ui.点击扇区查看明细')}</span>
              </div>
              {typePieOption ? (
                <ReactECharts
                  option={typePieOption}
                  style={{ height: 260 }}
                  notMerge
                  onEvents={{
                    click: (params: any) =>
                      params?.name && setDrill({ dimension: 'type', value: params.name }),
                  }}
                />
              ) : (
                <div className="h-[260px] rounded-xl bg-background flex items-center justify-center text-sm text-muted-foreground">
                  {t('common.noData')}
                </div>
              )}
            </div>
            <div>
              <div className="flex items-baseline justify-between mb-2">
                <p className="text-sm font-semibold text-foreground">
                  {t('ui.不合格按物料类型分布')}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {t('ui.按批数')}
                    {materialPieTotal > 0 ? ` · ${materialPieTotal} ${t('ui.批')}` : ''}
                  </span>
                </p>
                <span className="text-xs text-muted-foreground">{t('ui.点击扇区查看明细')}</span>
              </div>
              {materialPieOption ? (
                <ReactECharts
                  option={materialPieOption}
                  style={{ height: 260 }}
                  notMerge
                  onEvents={{
                    click: (params: any) =>
                      params?.name && setDrill({ dimension: 'materialType', value: params.name }),
                  }}
                />
              ) : (
                <div className="h-[260px] rounded-xl bg-background flex items-center justify-center text-sm text-muted-foreground">
                  {t('common.noData')}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== TOP10 排行 ===== */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {renderRankTable(t('ui.物料合格率 TOP10'), stats?.topMaterials ?? [], t('iqc.materialCode'), t('iqc.materialName'))}
          {renderRankTable(t('ui.供应商合格率 TOP10'), stats?.topSuppliers ?? [], t('receipt.supplierCode'), t('iqc.supplierName'))}
        </div>

        {/* ===== 超期预警（全局指标，不随筛选联动） ===== */}
        {overdueLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="animate-pulse h-20 rounded-xl bg-muted" />
            <div className="animate-pulse h-20 rounded-xl bg-muted" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl p-4 flex items-center gap-3" style={{ backgroundColor: '#FFF8E6' }}>
              <div className="w-11 h-11 rounded-xl bg-[#FF9500]/15 text-[#FF9500] flex items-center justify-center">
                <AlertTriangle size={22} />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{fmt(overdue?.warningCount ?? 0)}</p>
                <p className="text-xs text-muted-foreground">{t('ui.超期预警批数')}</p>
              </div>
            </div>
            <div className="rounded-xl p-4 flex items-center gap-3" style={{ backgroundColor: '#FFEBE9' }}>
              <div className="w-11 h-11 rounded-xl bg-[#FF3B30]/15 text-[#FF3B30] flex items-center justify-center">
                <XCircle size={22} />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{fmt(overdue?.overdueCount ?? 0)}</p>
                <p className="text-xs text-muted-foreground">{t('ui.超期批数')}</p>
              </div>
            </div>
          </div>
        )}
      </CardContent>

      {/* 饼图下钻：不合格明细台账（含导出） */}
      <DefectDetailDialog
        open={!!drill}
        onClose={() => setDrill(null)}
        startDate={filter.startDate}
        endDate={filter.endDate}
        dimension={drill?.dimension ?? 'type'}
        value={drill?.value ?? ''}
      />

      {/* 目标设置弹窗 */}
      <Dialog open={targetOpen} onOpenChange={setTargetOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('ui.LOT合格率目标设置')}</DialogTitle>
          </DialogHeader>

          {targetStep === 'verify' ? (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                {t('ui.修改目标合格率需要系统管理员权限，请输入管理员账号和密码验证。')}
              </p>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('ui.管理员账号')}</label>
                <input
                  type="text"
                  value={adminAccount}
                  onChange={(e) => setAdminAccount(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleVerifyAdmin()}
                  className="w-full h-10 rounded-[10px] border border-border bg-card px-3 text-sm"
                  placeholder={t('ui.例如 admin')}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('ui.管理员密码')}</label>
                <input
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleVerifyAdmin()}
                  className="w-full h-10 rounded-[10px] border border-border bg-card px-3 text-sm"
                  placeholder={t('pda.passwordPlaceholder')}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setTargetOpen(false)}>
                  {t('pda.cancel')}
                </Button>
                <Button onClick={handleVerifyAdmin} disabled={verifying}>
                  {verifying ? t('ui.验证中') : t('ui.验证并继续')}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-5 py-2">
              <div className="space-y-2">
                <div>
                  <label className="text-sm font-medium">{t('ui.LOT合格率总目标（%）')}</label>
                  <p className="text-xs text-muted-foreground mt-0.5">{t('ui.仅按时间筛选时使用的整体目标')}</p>
                </div>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={targetOverall}
                  onChange={(e) => setTargetOverall(e.target.value)}
                  className="w-full h-10 rounded-[10px] border border-border bg-card px-3 text-sm"
                  placeholder={t('ui.例如 95')}
                />
              </div>

              <div className="border-t border-border pt-4">
                <div className="mb-3">
                  <label className="text-sm font-medium">{t('ui.物料类型LOT合格率目标')}</label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t('ui.按供应商或物料类型筛选时，检验数据按所属物料类型的目标考核；留空则跟随整体目标')}
                  </p>
                </div>
                <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                  {MATERIAL_TYPES.map((mt) => (
                    <div key={mt.key} className="flex items-center justify-between gap-3">
                      <span className="text-sm flex-shrink-0 w-24">{mt.labelKey ? t(mt.labelKey) : 'PCB'}</span>
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.1}
                          value={targetByType[mt.key] || ''}
                          onChange={(e) => setTargetByType((prev) => ({ ...prev, [mt.key]: e.target.value }))}
                          placeholder={t('ui.跟随整体')}
                          className="flex-1 h-9 rounded-[8px] border border-border bg-card px-3 text-sm text-center"
                        />
                        <span className="text-xs text-muted-foreground w-6">%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setTargetOpen(false)}>
                  {t('pda.cancel')}
                </Button>
                <Button onClick={saveTarget} disabled={savingTarget}>
                  {savingTarget ? t('common.saving') : t('common.save')}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default IqcDashboard;
