import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Link2, RefreshCw, Play, Settings2, PackageSearch } from 'lucide-react';
import { toast } from 'sonner';

import ResizableTable from '@client/src/components/ui/resizable-table';
import { Table, type TableProps } from '@client/src/compat/antd-table';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Badge } from '@client/src/components/ui/badge';
import { Switch } from '@client/src/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@client/src/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@client/src/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@client/src/components/ui/select';
import { useI18n } from '@client/src/i18n';
import { usePermission } from '@client/src/auth/usePermission';
import { extractApiError } from '@client/src/utils/apiError';
import { renderDate } from '@client/src/utils/datetime';
import { logger } from '@client/src/utils/logger';
import { mesSync as api } from '@client/src/api';
import { getAccountList } from '@client/src/api/system';
import type {
  MesMaterialRow,
  MesPendingMo,
  MesSyncConfig,
  MesSyncLogRow,
  MesSyncStatus,
  MesWritebackRow,
} from '@client/src/api/mes-sync';

/**
 * MES 接入页
 * ------------------------------------------------------------------
 * 三块内容：
 *  1. 待领料工单：MES 有缺口、仓库要备料的工单，可一键生成 WMS 领料单
 *  2. 同步日志：每轮拉了多少、失败原因、MES 的 requestId（拿去找 MES 查日志）
 *  3. 接口配置：地址 / 密钥 / 自动同步开关（仅管理员可见）
 */
const fmt = (n: number | null | undefined) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  return String(Math.round(v * 1000) / 1000);
};

const SECTION_LABEL: Record<string, string> = {
  smt: 'SMT',
  dip: 'DIP',
  assembly: '组装',
  packing: '包装',
};

const MesSync: React.FC = () => {
  const { t } = useI18n();
  const { role } = usePermission();
  const isAdmin = role?.roleCode === 'admin';

  const [status, setStatus] = useState<MesSyncStatus | null>(null);
  const [config, setConfig] = useState<MesSyncConfig | null>(null);
  const [tab, setTab] = useState('pending');

  const [rows, setRows] = useState<MesPendingMo[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [loading, setLoading] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [generating, setGenerating] = useState<string>('');

  const [logs, setLogs] = useState<MesSyncLogRow[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailMo, setDetailMo] = useState<string>('');
  const [detailRows, setDetailRows] = useState<MesMaterialRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [form, setForm] = useState({
    baseUrl: '',
    apiKey: '',
    autoSync: false,
    intervalMinutes: 5,
    autoPicking: false,
    pickingAutoApprove: true,
    pickingQtyMode: 'suggest' as 'suggest' | 'open',
    operatorId: '',
    writebackEnabled: false,
  });
  /** 对接操作人可选账号（MES 不返回人员时，由谁代签申请/审批） */
  const [accounts, setAccounts] = useState<{ id: string; name: string; account: string }[]>([]);

  // 发料回写队列
  const [wbRows, setWbRows] = useState<MesWritebackRow[]>([]);
  const [wbCounts, setWbCounts] = useState({ pending: 0, sent: 0, failed: 0, skipped: 0 });
  const [wbLoading, setWbLoading] = useState(false);
  const [wbStatus, setWbStatus] = useState('');
  const [wbRunning, setWbRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const fail = (e: any, fallback: string) => {
    const msg = extractApiError(e).message || fallback;
    toast.error(msg);
    logger.error(fallback, String(msg));
  };

  const fetchStatus = useCallback(async () => {
    try {
      setStatus(await api.getMesStatus());
    } catch (e) {
      logger.error('MES status failed', String(e));
    }
  }, []);

  const fetchPending = useCallback(async (p = page) => {
    setLoading(true);
    try {
      const res = await api.getMesPending({ page: p, pageSize, keyword: keyword || undefined, onlyOpen });
      setRows(res.items);
      setTotal(res.total);
      setPage(p);
    } catch (e) {
      fail(e, t('mes.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, onlyOpen, t]);

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      setLogs(await api.getMesLogs(50));
    } catch (e) {
      logger.error('MES logs failed', String(e));
    } finally {
      setLogsLoading(false);
    }
  }, []);

  const fetchWriteback = useCallback(async () => {
    setWbLoading(true);
    try {
      const r = await api.getMesWriteback({ status: wbStatus || undefined, limit: 200 });
      setWbRows(r.items);
      setWbCounts(r.counts);
    } catch (e) {
      logger.error('MES writeback failed', String(e));
    } finally {
      setWbLoading(false);
    }
  }, [wbStatus]);

  // 切到回写页签时再拉，避免首屏多打一次接口
  useEffect(() => {
    if (tab === 'writeback') void fetchWriteback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, wbStatus]);

  const fetchConfig = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const c = await api.getMesConfig();
      setConfig(c);
      setForm((f) => ({
        ...f,
        baseUrl: c.baseUrl,
        autoSync: c.autoSync,
        intervalMinutes: c.intervalMinutes,
        autoPicking: c.autoPicking,
        pickingAutoApprove: c.pickingAutoApprove !== false,
        pickingQtyMode: c.pickingQtyMode,
        operatorId: c.operatorId || '',
        writebackEnabled: c.writebackEnabled === true,
      }));
    } catch (e) {
      logger.error('MES config failed', String(e));
    }
  }, [isAdmin]);

  const fetchAccounts = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await getAccountList({ page: 1, pageSize: 200, status: 'active' });
      setAccounts((res.data?.items ?? []).map((a: any) => ({
        id: a.id, name: a.name || '', account: a.account || '',
      })));
    } catch (e) {
      logger.error('account list failed', String(e));
    }
  }, [isAdmin]);

  useEffect(() => {
    void fetchStatus();
    void fetchPending(1);
    void fetchLogs();
    void fetchConfig();
    void fetchAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSyncPending = async () => {
    setSyncing(true);
    try {
      const r = await api.syncMesPending({});
      toast.success(
        t('mes.syncDone')
          .replace('{pulled}', String(r.pulled))
          .replace('{created}', String(r.created))
          .replace('{updated}', String(r.updated)),
      );
      if (r.messages?.length) toast.warning(r.messages.slice(0, 3).join('；'));
      await Promise.all([fetchStatus(), fetchPending(1), fetchLogs()]);
    } catch (e) {
      fail(e, t('mes.syncFailed'));
    } finally {
      setSyncing(false);
    }
  };

  const handleRunWriteback = async () => {
    setWbRunning(true);
    try {
      const r = await api.runMesWriteback(50);
      if (r.skipped) {
        toast.warning(r.reason || t('mes.wbSwitchOff'));
      } else {
        toast.success(
          t('mes.wbRunDone')
            .replace('{sent}', String(r.sent))
            .replace('{failed}', String(r.failed)),
        );
      }
      if (r.messages?.length) toast.warning(r.messages.slice(0, 2).join('；'));
      await Promise.all([fetchWriteback(), fetchStatus()]);
    } catch (e) {
      fail(e, t('mes.wbRunFailed'));
    } finally {
      setWbRunning(false);
    }
  };

  const handleRetryWriteback = async (id: string) => {
    try {
      await api.retryMesWriteback(id);
      toast.success(t('mes.wbRetried'));
      await Promise.all([fetchWriteback(), fetchStatus()]);
    } catch (e) {
      fail(e, t('mes.wbRunFailed'));
    }
  };

  const openDetail = async (moNo: string) => {
    setDetailOpen(true);
    setDetailMo(moNo);
    setDetailLoading(true);
    try {
      const res = await api.getMesMaterials(moNo);
      setDetailRows(res.items);
    } catch (e) {
      fail(e, t('mes.loadFailed'));
      setDetailRows([]);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleRefreshMaterials = async () => {
    if (!detailMo) return;
    setDetailLoading(true);
    try {
      const r = await api.syncMesMaterials(detailMo);
      toast.success(
        t('mes.materialsRefreshed')
          .replace('{n}', String(r.materialCount))
          .replace('{missing}', String(r.missingMaterialCount)),
      );
      const res = await api.getMesMaterials(detailMo);
      setDetailRows(res.items);
      await fetchPending(page);
    } catch (e) {
      fail(e, t('mes.loadFailed'));
    } finally {
      setDetailLoading(false);
    }
  };

  const handleGenerate = async (moNo: string) => {
    setGenerating(moNo);
    try {
      const r = await api.generateMesPicking(moNo, {});
      if (r.created > 0) {
        toast.success(`${t('mes.pickingCreated').replace('{n}', String(r.created))} ${r.pickingNos.join('、')}`);
      } else if (r.refreshed > 0) {
        toast.success(`${t('mes.pickingRefreshed').replace('{n}', String(r.refreshed))}`);
      } else {
        toast.info(t('mes.pickingNothing'));
      }
      await Promise.all([fetchPending(page), fetchStatus(), fetchLogs()]);
    } catch (e) {
      fail(e, t('mes.pickingFailed'));
    } finally {
      setGenerating('');
    }
  };

  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      const c = await api.saveMesConfig({
        baseUrl: form.baseUrl,
        apiKey: form.apiKey || undefined,
        autoSync: form.autoSync,
        intervalMinutes: form.intervalMinutes,
        autoPicking: form.autoPicking,
        pickingAutoApprove: form.pickingAutoApprove,
        pickingQtyMode: form.pickingQtyMode,
        operatorId: form.operatorId,
        writebackEnabled: form.writebackEnabled,
      });
      setConfig(c);
      setForm((f) => ({ ...f, apiKey: '' }));
      toast.success(t('mes.configSaved'));
      await fetchStatus();
    } catch (e) {
      fail(e, t('mes.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const r = await api.testMesConnection();
      toast.success(
        t('mes.testOk')
          .replace('{service}', r.service || 'MES')
          .replace('{ms}', String(r.latencyMs))
          .replace('{time}', r.serverTime),
      );
    } catch (e) {
      fail(e, t('mes.testFailed'));
    } finally {
      setTesting(false);
    }
  };

  const detailSummary = useMemo(() => {
    const lines = detailRows.length;
    const openSum = detailRows.reduce((s, r) => s + (Number(r.openQty) || 0), 0);
    const shortageLines = detailRows.filter((r) => r.shortageQty > 0).length;
    return { lines, openSum, shortageLines };
  }, [detailRows]);

  // 列顺序按「仓库实际要看的东西」排：工单 → 产品 → 数量 → 缺口 → 未匹配 → 其他
  const pendingColumns: TableProps<MesPendingMo>['columns'] = [
    { title: t('mes.moNo'), dataIndex: 'workOrderNo', width: 130, fixed: 'left' },
    { title: t('mes.productCode'), dataIndex: 'productCode', width: 140 },
    { title: t('mes.productName'), dataIndex: 'productName', width: 140 },
    { title: t('mes.planQty'), dataIndex: 'planQty', width: 90, align: 'right', render: (v: number) => fmt(v) },
    {
      title: t('mes.openQty'), dataIndex: 'openQty', width: 100, align: 'right',
      render: (v: number) => (
        <span className={v > 0 ? 'text-[color:var(--destructive)] font-medium' : 'text-muted-foreground'}>
          {fmt(v)}
        </span>
      ),
    },
    {
      title: t('mes.unmatched'), dataIndex: 'unmatchedCount', width: 110, align: 'right',
      render: (v: number) =>
        v > 0 ? <Badge variant="destructive">{v}</Badge> : <span className="text-muted-foreground">0</span>,
    },
    { title: t('mes.lineCode'), dataIndex: 'lineCode', width: 105 },
    {
      title: t('mes.planStart'), dataIndex: 'planStart', width: 110,
      render: (v: string) => (v ? renderDate(v) : '-'),
    },
    {
      title: t('mes.mesStatus'), dataIndex: 'mesStatus', width: 90,
      render: (v: string) => (v ? <Badge variant="outline">{v}</Badge> : '-'),
    },
    {
      title: t('mes.pickingCount'), dataIndex: 'pickingCount', width: 90, align: 'right',
      render: (v: number, r: MesPendingMo) =>
        v > 0 ? <Badge variant={r.pickingPending > 0 ? 'secondary' : 'default'}>{v}</Badge> : '-',
    },
    {
      title: t('common.operation'), key: 'action', width: 190, fixed: 'right',
      render: (_: any, r: MesPendingMo) => (
        <div className="flex gap-1 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => openDetail(r.workOrderNo)}>
            {t('mes.viewMaterials')}
          </Button>
          <Button
            size="sm"
            disabled={generating === r.workOrderNo}
            onClick={() => handleGenerate(r.workOrderNo)}
          >
            {generating === r.workOrderNo ? t('common.loading') : t('mes.generatePicking')}
          </Button>
        </div>
      ),
    },
  ];

  const materialColumns: TableProps<MesMaterialRow>['columns'] = [
    {
      title: t('mes.workSection'), dataIndex: 'workSection', width: 70,
      render: (v: string) => <Badge variant="outline">{SECTION_LABEL[v] || v || '-'}</Badge>,
    },
    { title: t('mes.materialCode'), dataIndex: 'materialCode', width: 130 },
    { title: t('mes.materialName'), dataIndex: 'materialName', width: 130 },
    {
      title: t('mes.spec'), dataIndex: 'specification', width: 150,
      render: (v: string) => <span className="block truncate" title={v || ''}>{v || '-'}</span>,
    },
    { title: t('mes.unit'), dataIndex: 'unit', width: 55 },
    { title: t('mes.qtyPer'), dataIndex: 'qtyPer', width: 80, align: 'right', render: (v: number) => fmt(v) },
    { title: t('mes.needQty'), dataIndex: 'needQty', width: 80, align: 'right', render: (v: number) => fmt(v) },
    { title: t('mes.issueQty'), dataIndex: 'issueQty', width: 80, align: 'right', render: (v: number) => fmt(v) },
    {
      title: t('mes.openQty'), dataIndex: 'openQty', width: 80, align: 'right',
      render: (v: number) => <strong>{fmt(v)}</strong>,
    },
    { title: t('mes.availableQty'), dataIndex: 'availableQty', width: 90, align: 'right', render: (v: number) => fmt(v) },
    {
      title: t('mes.shortageQty'), dataIndex: 'shortageQty', width: 80, align: 'right',
      render: (v: number) =>
        v > 0
          ? <span className="text-[color:var(--destructive)] font-medium">{fmt(v)}</span>
          : <span className="text-muted-foreground">0</span>,
    },
    { title: t('mes.mpq'), dataIndex: 'mpq', width: 80, align: 'right', render: (v: number) => fmt(v) },
    { title: t('mes.suggestQty'), dataIndex: 'suggestQty', width: 90, align: 'right', render: (v: number) => fmt(v) },
    {
      title: t('mes.posRef'), dataIndex: 'posRef', width: 100,
      render: (v: string) => <span className="block truncate" title={v || ''}>{v || '-'}</span>,
    },
    {
      title: t('mes.srcType'), dataIndex: 'srcType', width: 80,
      render: (v: string) => (
        <Badge variant={v === 'issue' ? 'default' : 'secondary'}>
          {v === 'issue' ? t('mes.srcIssue') : t('mes.srcBom')}
        </Badge>
      ),
    },
  ];

  const logColumns: TableProps<MesSyncLogRow>['columns'] = [
    {
      title: t('mes.logTime'), dataIndex: 'startedAt', width: 165,
      render: (v: string) => (v ? new Date(v).toLocaleString() : '-'),
    },
    {
      title: t('mes.logTask'), dataIndex: 'task', width: 130,
      render: (v: string) => (
        <Badge variant="outline">
          {v === 'work_order' ? t('mes.taskWo') : v === 'pending' ? t('mes.taskPending') : t('mes.taskPicking')}
        </Badge>
      ),
    },
    {
      title: t('common.status'), dataIndex: 'status', width: 90,
      render: (v: string) => (
        <Badge variant={v === 'success' ? 'default' : v === 'failed' ? 'destructive' : 'secondary'}>
          {v === 'success' ? t('mes.logSuccess') : v === 'failed' ? t('mes.logFailed') : t('mes.logSkipped')}
        </Badge>
      ),
    },
    { title: t('mes.logPulled'), dataIndex: 'pulled', width: 80, align: 'right' },
    { title: t('mes.logCreated'), dataIndex: 'created', width: 80, align: 'right' },
    { title: t('mes.logUpdated'), dataIndex: 'updated', width: 80, align: 'right' },
    { title: t('mes.logSkippedCol'), dataIndex: 'skipped', width: 80, align: 'right' },
    {
      title: t('mes.logFailedCol'), dataIndex: 'failed', width: 80, align: 'right',
      render: (v: number) => (v > 0 ? <Badge variant="destructive">{v}</Badge> : 0),
    },
    {
      title: t('mes.logMessage'), dataIndex: 'message', width: 380,
      render: (v: string) => (
        <span className="block truncate" title={v || ''}>{v || '-'}</span>
      ),
    },
    {
      title: 'requestId', dataIndex: 'requestId', width: 260,
      render: (v: string) => (
        <span className="font-mono text-xs block truncate" title={v || ''}>{v || '-'}</span>
      ),
    },
  ];

  const WB_STATUS: Record<string, { label: string; variant: any }> = {
    pending: { label: t('mes.wbStPending'), variant: 'secondary' },
    sent: { label: t('mes.wbStSent'), variant: 'default' },
    failed: { label: t('mes.wbStFailed'), variant: 'destructive' },
    skipped: { label: t('mes.wbStSkipped'), variant: 'outline' },
  };

  const wbColumns: TableProps<MesWritebackRow>['columns'] = [
    { title: t('workorder.pickingNo'), dataIndex: 'pickingNo', width: 190, fixed: 'left' },
    {
      title: t('workorder.mesIssueNo'), dataIndex: 'mesIssueNo', width: 150,
      render: (v: string) => v || <span className="text-muted-foreground">{t('mes.wbNoIssueNo')}</span>,
    },
    { title: t('workorder.workOrderNo'), dataIndex: 'moNo', width: 140 },
    {
      title: t('bom.workSection'), dataIndex: 'workSection', width: 90,
      render: (v: string) => SECTION_LABEL[v] || v || '-',
    },
    {
      title: t('common.status'), dataIndex: 'status', width: 110,
      render: (v: string) => {
        const s = WB_STATUS[v] || { label: v, variant: 'secondary' as const };
        return <Badge variant={s.variant}>{s.label}</Badge>;
      },
    },
    {
      title: t('mes.wbAttempts'), dataIndex: 'attempts', width: 80, align: 'right',
      render: (v: number) => (v > 0 ? v : '-'),
    },
    {
      title: t('mes.wbNextRetry'), dataIndex: 'nextRetryAt', width: 165,
      render: (v: string, r: MesWritebackRow) =>
        r.status === 'pending' && v ? new Date(v).toLocaleString() : '-',
    },
    {
      title: t('mes.wbSentAt'), dataIndex: 'sentAt', width: 165,
      render: (v: string) => (v ? new Date(v).toLocaleString() : '-'),
    },
    {
      title: t('mes.wbLastError'), dataIndex: 'lastError', width: 320,
      render: (v: string) => (
        <span className="block truncate text-xs" title={v || ''}>{v || '-'}</span>
      ),
    },
    {
      title: t('common.operation'), key: 'action', width: 110,
      render: (_: any, r: MesWritebackRow) => (
        isAdmin && r.status !== 'sent' ? (
          <Button size="sm" variant="outline" onClick={() => void handleRetryWriteback(r.id)}>
            {t('mes.wbRetry')}
          </Button>
        ) : '-'
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* 顶部：状态 + 主要动作 */}
      <div className="bg-card rounded-[12px] p-4 border border-border">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-[10px] bg-[color:var(--primary-soft)] p-2">
              <Link2 size={20} className="text-[color:var(--primary)]" />
            </div>
            <div>
              <div className="text-base font-semibold flex items-center gap-2">
                {t('mes.title')}
                {status?.configured
                  ? <Badge variant="default">{t('mes.connected')}</Badge>
                  : <Badge variant="destructive">{t('mes.notConfigured')}</Badge>}
                {status?.autoSync && <Badge variant="secondary">{t('mes.autoOn')}</Badge>}
              </div>
              <div className="text-xs text-muted-foreground mt-1 space-x-3">
                <span>{status?.baseUrl || '-'}</span>
                <span>
                  {t('mes.lastRun')}：{status?.lastRunAt ? new Date(status.lastRunAt).toLocaleString() : '-'}
                </span>
                <span>{t('mes.pickingQtyMode')}：{status?.pickingQtyMode === 'open' ? t('mes.qtyModeOpen') : t('mes.qtyModeSuggest')}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => { void fetchStatus(); void fetchPending(page); void fetchLogs(); }}>
              <RefreshCw size={14} className="mr-1" />{t('common.refresh')}
            </Button>
            <Button disabled={syncing || !status?.configured} onClick={handleSyncPending}>
              <PackageSearch size={14} className="mr-1" />
              {syncing ? t('mes.syncing') : t('mes.syncPending')}
            </Button>
          </div>
        </div>

        {/* 计数卡 */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mt-4">
          {[
            { label: t('mes.statOpenMos'), value: status?.counts.openMos ?? 0, warn: false },
            { label: t('mes.statOpenMaterials'), value: status?.counts.openMaterials ?? 0, warn: false },
            { label: t('mes.statMesPicking'), value: status?.counts.mesPickingOrders ?? 0, warn: false },
            { label: t('mes.statPickingToIssue'), value: status?.counts.mesPickingToIssue ?? 0, warn: false },
            { label: t('mes.statWbPending'), value: status?.counts.writebackPending ?? 0, warn: false },
            { label: t('mes.statWbFailed'), value: status?.counts.writebackFailed ?? 0, warn: (status?.counts.writebackFailed ?? 0) > 0 },
          ].map((s) => (
            <div key={s.label} className="rounded-[10px] border border-border px-3 py-2 bg-[color:var(--muted)]/40">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className={`text-xl font-semibold ${s.warn ? 'text-[color:var(--destructive)]' : ''}`}>{s.value}</div>
            </div>
          ))}
        </div>

        {status?.lastStatus === 'failed' && status?.lastMessage && (
          <div className="mt-3 flex items-start gap-2 rounded-[10px] border border-[color:var(--destructive)]/40 bg-[color:var(--destructive)]/5 px-3 py-2 text-xs text-[color:var(--destructive)]">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span className="break-all">{status.lastMessage}</span>
          </div>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pending">
            {t('mes.tabPending')}{total > 0 ? ` (${total})` : ''}
          </TabsTrigger>
          <TabsTrigger value="logs">{t('mes.tabLogs')}</TabsTrigger>
          <TabsTrigger value="writeback">
            {t('mes.tabWriteback')}
            {(wbCounts.failed > 0 || wbCounts.pending > 0) && (
              <Badge
                variant={wbCounts.failed > 0 ? 'destructive' : 'secondary'}
                className="ml-1 px-1.5 py-0 text-[10px]"
              >
                {wbCounts.failed > 0 ? wbCounts.failed : wbCounts.pending}
              </Badge>
            )}
          </TabsTrigger>
          {isAdmin && <TabsTrigger value="config">{t('mes.tabConfig')}</TabsTrigger>}
        </TabsList>

        <TabsContent value="pending" className="mt-3">
          <div className="bg-card rounded-[12px] p-4 border border-border">
            <div className="flex flex-wrap items-end gap-3 mb-3">
              <div className="w-[260px]">
                <label className="text-sm text-muted-foreground mb-1 block">{t('mes.searchPlaceholder')}</label>
                <Input
                  value={keyword}
                  placeholder={t('mes.searchPlaceholder')}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void fetchPending(1); }}
                />
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Switch checked={onlyOpen} onCheckedChange={(v: boolean) => setOnlyOpen(v)} />
                <span className="text-sm text-muted-foreground">{t('mes.onlyOpen')}</span>
              </div>
              <Button variant="outline" onClick={() => fetchPending(1)}>{t('common.search')}</Button>
            </div>

            <ResizableTable
              columns={pendingColumns}
              dataSource={rows}
              loading={loading}
              rowKey="id"
              scroll={{ x: 1300, y: 460 }}
              pagination={{
                current: page,
                pageSize,
                total,
                showSizeChanger: false,
                showTotal: (n) => `${t('common.total')} ${n} ${t('common.items')}`,
                onChange: (p) => setPage(p),
              }}
            />
          </div>
        </TabsContent>

        <TabsContent value="logs" className="mt-3">
          <div className="bg-card rounded-[12px] p-4 border border-border">
            <div className="flex justify-end mb-3">
              <Button variant="outline" onClick={fetchLogs}>
                <RefreshCw size={14} className="mr-1" />{t('common.refresh')}
              </Button>
            </div>
            <ResizableTable
              columns={logColumns}
              dataSource={logs}
              loading={logsLoading}
              rowKey="id"
              scroll={{ x: 1500, y: 480 }}
              pagination={false}
            />
          </div>
        </TabsContent>

        <TabsContent value="writeback" className="mt-3">
          <div className="bg-card rounded-[12px] p-4 border border-border">
            <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-[180px]">
                  <label className="text-sm text-muted-foreground mb-1 block">{t('common.status')}</label>
                  <Select value={wbStatus || '__all__'} onValueChange={(v) => setWbStatus(v === '__all__' ? '' : v)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">{t('common.all')}</SelectItem>
                      <SelectItem value="pending">{t('mes.wbStPending')}</SelectItem>
                      <SelectItem value="sent">{t('mes.wbStSent')}</SelectItem>
                      <SelectItem value="failed">{t('mes.wbStFailed')}</SelectItem>
                      <SelectItem value="skipped">{t('mes.wbStSkipped')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="text-xs text-muted-foreground pb-2">
                  {t('mes.wbCounts')
                    .replace('{pending}', String(wbCounts.pending))
                    .replace('{sent}', String(wbCounts.sent))
                    .replace('{failed}', String(wbCounts.failed))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => void fetchWriteback()}>
                  <RefreshCw size={14} className="mr-1" />{t('common.refresh')}
                </Button>
                {isAdmin && (
                  <Button disabled={wbRunning} onClick={() => void handleRunWriteback()}>
                    <Play size={14} className="mr-1" />
                    {wbRunning ? t('common.loading') : t('mes.wbRunNow')}
                  </Button>
                )}
              </div>
            </div>

            <div className="mb-2 text-xs text-muted-foreground">{t('mes.wbHint')}</div>

            <ResizableTable
              columns={wbColumns}
              dataSource={wbRows}
              loading={wbLoading}
              rowKey="id"
              scroll={{ x: 1500, y: 440 }}
              pagination={false}
            />
          </div>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="config" className="mt-3">
            <div className="bg-card rounded-[12px] p-4 border border-border max-w-[860px]">
              <div className="flex items-center gap-2 mb-4">
                <Settings2 size={16} className="text-muted-foreground" />
                <span className="font-medium">{t('mes.tabConfig')}</span>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">{t('mes.baseUrl')}</label>
                  <Input
                    value={form.baseUrl}
                    placeholder="http://192.168.6.27:8080"
                    onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                  />
                  <div className="text-xs text-muted-foreground mt-1">{t('mes.baseUrlHint')}</div>
                </div>

                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">{t('mes.apiKey')}</label>
                  <Input
                    value={form.apiKey}
                    type="password"
                    autoComplete="new-password"
                    placeholder={config?.hasApiKey ? `${config.apiKeyMasked}（${t('mes.apiKeyKeep')}）` : t('mes.apiKeyPlaceholder')}
                    onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  />
                  <div className="text-xs text-muted-foreground mt-1">{t('mes.apiKeyHint')}</div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center justify-between rounded-[10px] border border-border px-3 py-2">
                    <div>
                      <div className="text-sm">{t('mes.autoSync')}</div>
                      <div className="text-xs text-muted-foreground">{t('mes.autoSyncHint')}</div>
                    </div>
                    <Switch checked={form.autoSync} onCheckedChange={(v: boolean) => setForm({ ...form, autoSync: v })} />
                  </div>
                  <div className="flex items-center justify-between rounded-[10px] border border-border px-3 py-2">
                    <div>
                      <div className="text-sm">{t('mes.autoPicking')}</div>
                      <div className="text-xs text-muted-foreground">{t('mes.autoPickingHint')}</div>
                    </div>
                    <Switch checked={form.autoPicking} onCheckedChange={(v: boolean) => setForm({ ...form, autoPicking: v })} />
                  </div>
                </div>

                {/* MES 单默认直接生效：仓库不用再等生产主管审批，开完就能发料 */}
                <div className="flex items-center justify-between rounded-[10px] border border-border px-3 py-2">
                  <div>
                    <div className="text-sm">{t('mes.autoApprove')}</div>
                    <div className="text-xs text-muted-foreground">{t('mes.autoApproveHint')}</div>
                  </div>
                  <Switch
                    checked={form.pickingAutoApprove}
                    onCheckedChange={(v: boolean) => setForm({ ...form, pickingAutoApprove: v })}
                  />
                </div>

                {/* MES 接口不返回下单人/批准人，指定一个账号代签，台账上才有责任人 */}
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">{t('mes.operator')}</label>
                  <Select
                    value={form.operatorId || '__none__'}
                    onValueChange={(v) => setForm({ ...form, operatorId: v === '__none__' ? '' : v })}
                  >
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{t('mes.operatorNone')}</SelectItem>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name ? `${a.name}（${a.account}）` : a.account}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="text-xs text-muted-foreground mt-1">{t('mes.operatorHint')}</div>
                </div>

                {/* 发料结果回写 MES：工单结案要按实际发料量算，MES 写接口开放后再打开 */}
                <div className="flex items-center justify-between rounded-[10px] border border-border px-3 py-2">
                  <div>
                    <div className="text-sm">{t('mes.writebackEnabled')}</div>
                    <div className="text-xs text-muted-foreground">{t('mes.writebackHint')}</div>
                  </div>
                  <Switch
                    checked={form.writebackEnabled}
                    onCheckedChange={(v: boolean) => setForm({ ...form, writebackEnabled: v })}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">{t('mes.interval')}</label>
                    <Input
                      type="number"
                      min={1}
                      max={1440}
                      value={form.intervalMinutes}
                      onChange={(e) => setForm({ ...form, intervalMinutes: Number(e.target.value) || 5 })}
                    />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">{t('mes.pickingQtyMode')}</label>
                    <Select
                      value={form.pickingQtyMode}
                      onValueChange={(v) => setForm({ ...form, pickingQtyMode: v as 'suggest' | 'open' })}
                    >
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="suggest">{t('mes.qtyModeSuggest')}</SelectItem>
                        <SelectItem value="open">{t('mes.qtyModeOpen')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button onClick={handleSaveConfig} disabled={saving}>
                    {saving ? t('common.loading') : t('common.save')}
                  </Button>
                  <Button variant="outline" onClick={handleTest} disabled={testing}>
                    <Play size={14} className="mr-1" />
                    {testing ? t('common.loading') : t('mes.testConnection')}
                  </Button>
                  <Button variant="outline" disabled={syncing || !status?.configured} onClick={handleSyncPending}>
                    <PackageSearch size={14} className="mr-1" />
                    {t('mes.syncPending')}
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>
        )}
      </Tabs>

      {/* 用料明细 */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-[1280px] max-h-[92vh] overflow-y-auto grid-cols-[minmax(0,1fr)]">
          <DialogHeader>
            <DialogTitle>
              {t('mes.materialsTitle')} · {detailMo}
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground mb-2">
            <span>{t('mes.materialLines').replace('{n}', String(detailSummary.lines))}</span>
            <span>{t('mes.openSum').replace('{n}', fmt(detailSummary.openSum))}</span>
            <span>
              {t('mes.shortageLines').replace('{n}', String(detailSummary.shortageLines))}
            </span>
          </div>

          {/* min-w-0 必须有：否则宽表格会把 grid 栅格撑开，底部按钮会被推到弹窗外 */}
          <div className="w-full min-w-0">
          <Table
            columns={materialColumns}
            dataSource={detailRows}
            loading={detailLoading}
            rowKey={(r: MesMaterialRow) => `${r.workSection}-${r.materialCode}-${r.posRef || ''}`}
            size="small"
            scroll={{ x: 1260, y: 420 }}
            pagination={false}
          />
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDetailOpen(false)}>{t('common.close')}</Button>
            <Button variant="outline" onClick={handleRefreshMaterials} disabled={detailLoading}>
              {t('mes.refreshMaterials')}
            </Button>
            <Button disabled={!!generating} onClick={() => handleGenerate(detailMo)}>
              {t('mes.generatePicking')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MesSync;
