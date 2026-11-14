import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Link2, RefreshCw, Play, Settings2, PackageSearch, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';

import ResizableTable from '@client/src/components/ui/resizable-table';
import type { TableProps } from '@client/src/compat/antd-table';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Badge } from '@client/src/components/ui/badge';
import { Switch } from '@client/src/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@client/src/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@client/src/components/ui/select';
import { useI18n } from '@client/src/i18n';
import { usePermission } from '@client/src/auth/usePermission';
import { extractApiError } from '@client/src/utils/apiError';
import { logger } from '@client/src/utils/logger';
import { mesSync as api } from '@client/src/api';
import { getAccountList } from '@client/src/api/system';
import type {
  MesIssueRow,
  MesSyncConfig,
  MesSyncLogRow,
  MesSyncStatus,
  MesWritebackRow,
} from '@client/src/api/mes-sync';

/**
 * MES 接入页
 * ------------------------------------------------------------------
 * 2026-11-13 起**工单对接下线**，改为直接接 MES 领料单：
 *  1. 领料单：拉 MES 已经拆好工段、审好批的领料单，落成 WMS 领料单（照单发料）
 *  2. 发料回写：WMS 实发数量推回 MES，供 MES 工单结案
 *  3. 同步日志 / 接口配置
 *
 * 不再有「待领料工单」「按用料开单」这些概念 —— 单子由 MES 出，WMS 只负责发。
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
  aux: '辅料',
};

/** WMS 领料单状态（MES 同步过来的只有待发料这一种） */
const PICKING_STATUS: Record<string, { label: string; variant: any }> = {
  pending_approval: { label: '待审批', variant: 'secondary' },
  approved: { label: '待发料', variant: 'default' },
  issued: { label: '已发料', variant: 'outline' },
  completed: { label: '已发完', variant: 'outline' },
  cancelled: { label: '已取消', variant: 'destructive' },
};

const MesSync: React.FC = () => {
  const { t } = useI18n();
  const { role } = usePermission();
  const navigate = useNavigate();
  const isAdmin = role?.roleCode === 'admin';

  const [status, setStatus] = useState<MesSyncStatus | null>(null);
  const [config, setConfig] = useState<MesSyncConfig | null>(null);
  const [tab, setTab] = useState('issues');

  // 领料单列表
  const [rows, setRows] = useState<MesIssueRow[]>([]);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [logs, setLogs] = useState<MesSyncLogRow[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const [form, setForm] = useState({
    baseUrl: '',
    apiKey: '',
    autoSync: false,
    intervalMinutes: 5,
    operatorId: '',
    writebackEnabled: false,
  });

  const [accounts, setAccounts] = useState<{ id: string; name: string; account: string }[]>([]);

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

  const fetchIssues = useCallback(async () => {
    setLoading(true);
    try {
      // 只列待发料的单：MES 已发完的不接入 WMS
      const list = await api.getMesIssues({
        status: 'approved',
        keyword: keyword || undefined,
        limit: 300,
      });
      setRows(list);
    } catch (e) {
      fail(e, t('mes.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [keyword, t]);

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
    void fetchIssues();
    void fetchLogs();
    void fetchConfig();
    void fetchAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSyncIssues = async (full = false) => {
    setSyncing(true);
    try {
      const r = await api.syncMesIssues({ full });
      toast.success(
        `拉取 ${r.pulled} 张，新建 ${r.created}，更新 ${r.updated}，跳过 ${r.skipped}，失败 ${r.failed}`,
      );
      if (r.messages?.length) toast.warning(r.messages.slice(0, 3).join('；'));
      await Promise.all([fetchStatus(), fetchIssues(), fetchLogs()]);
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

  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      const c = await api.saveMesConfig({
        baseUrl: form.baseUrl,
        apiKey: form.apiKey || undefined,
        autoSync: form.autoSync,
        intervalMinutes: form.intervalMinutes,
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

  // 列按「仓库对单要看的东西」排：MES 单号 → 工单 → WMS 单号 → 工段 → 状态 → 进度
  const issueColumns: TableProps<MesIssueRow>['columns'] = [
    {
      title: t('workorder.mesIssueNo'), dataIndex: 'mesIssueNo', width: 170, fixed: 'left',
      render: (v: string) => <span className="font-mono text-xs">{v}</span>,
    },
    { title: t('workorder.workOrderNo'), dataIndex: 'moNo', width: 130 },
    {
      title: t('workorder.pickingNo'), dataIndex: 'pickingNo', width: 170,
      render: (v: string) => <span className="font-mono text-xs">{v}</span>,
    },
    {
      title: t('bom.workSection'), dataIndex: 'workSection', width: 80,
      render: (v: string) => <Badge variant="outline">{SECTION_LABEL[v] || v || '-'}</Badge>,
    },
    {
      title: t('common.status'), dataIndex: 'status', width: 100,
      render: (v: string) => {
        const s = PICKING_STATUS[v] || { label: v, variant: 'secondary' as const };
        return <Badge variant={s.variant}>{s.label}</Badge>;
      },
    },
    {
      title: '明细行数', dataIndex: 'lineCount', width: 90, align: 'right',
      render: (v: number) => (v > 0 ? v : '-'),
    },
    {
      title: '已发行数', dataIndex: 'issuedLines', width: 90, align: 'right',
      render: (v: number, r: MesIssueRow) => (
        <span className={v >= r.lineCount && r.lineCount > 0 ? 'text-[color:var(--primary)] font-medium' : 'text-muted-foreground'}>
          {v}/{r.lineCount}
        </span>
      ),
    },
    {
      title: '应领合计', dataIndex: 'totalQty', width: 100, align: 'right',
      render: (v: number) => fmt(v),
    },
    {
      title: t('mes.logMessage'), dataIndex: 'remark', width: 260,
      render: (v: string) => <span className="block truncate text-xs" title={v || ''}>{v || '-'}</span>,
    },
    {
      title: '接入时间', dataIndex: 'createdAt', width: 165,
      render: (v: string) => (v ? new Date(v).toLocaleString() : '-'),
    },
    {
      // 待发料的单直接推到发料管理去执行领料：仓库不用记 WMS 单号，
      // 也不用在两个页面之间来回找单，点一下就带着单号过去自动打开。
      title: '操作', key: 'action', width: 110, fixed: 'right',
      render: (_: any, r: MesIssueRow) => {
        if (r.status !== 'approved') {
          return <span className="text-xs text-muted-foreground">-</span>;
        }
        return (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => navigate(`/issuing/list?pickingNo=${encodeURIComponent(r.pickingNo || r.mesIssueNo)}`)}
          >
            去发料<ArrowRight size={12} className="ml-1" />
          </Button>
        );
      },
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
        <Badge variant="outline">{v === 'issue' ? 'MES 领料单' : v}</Badge>
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
      render: (v: string) => <span className="block truncate" title={v || ''}>{v || '-'}</span>,
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
                <span className="text-xs font-normal text-muted-foreground">MES 领料单接入</span>
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
                <span>游标：{status?.cursor || '-'}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => { void fetchStatus(); void fetchIssues(); void fetchLogs(); }}>
              <RefreshCw size={14} className="mr-1" />{t('common.refresh')}
            </Button>
            <Button disabled={syncing || !status?.configured} onClick={() => void handleSyncIssues(false)}>
              <PackageSearch size={14} className="mr-1" />
              {syncing ? t('mes.syncing') : '同步 MES 领料单'}
            </Button>
          </div>
        </div>

        {/* 计数卡 */}
        <div className="grid grid-cols-2 md:grid-cols-2 xl:grid-cols-4 gap-3 mt-4">
          {[
            { label: '待发料', value: status?.counts.mesIssuesOpen ?? 0, warn: false },
            { label: 'WMS 已发料', value: status?.counts.mesIssuesIssued ?? 0, warn: false },
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
          <TabsTrigger value="issues">
            MES 待发料领料单{rows.length > 0 ? ` (${rows.length})` : ''}
          </TabsTrigger>
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
          <TabsTrigger value="logs">{t('mes.tabLogs')}</TabsTrigger>
          {isAdmin && <TabsTrigger value="config">{t('mes.tabConfig')}</TabsTrigger>}
        </TabsList>

        <TabsContent value="issues" className="mt-3">
          <div className="bg-card rounded-[12px] p-4 border border-border">
            <div className="flex flex-wrap items-end gap-3 mb-3">
              <div className="w-[280px]">
                <label className="text-sm text-muted-foreground mb-1 block">MES 单号 / 工单号 / WMS 单号</label>
                <Input
                  value={keyword}
                  placeholder="输入关键字回车查询"
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void fetchIssues(); }}
                />
              </div>
              <Button variant="outline" onClick={() => void fetchIssues()}>{t('common.search')}</Button>
            </div>

            <div className="mb-2 text-xs text-muted-foreground">
              只接入 MES 的待发料领料单，已发完的单不再拉取。单号、明细、工段全部以 MES 为准，WMS 只负责按单发料，发完把实发数量推回 MES。
            </div>

            <ResizableTable
              columns={issueColumns}
              dataSource={rows}
              loading={loading}
              rowKey="id"
              scroll={{ x: 1550, y: 460 }}
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
                </div>

                {/* MES 领料单不返回审批人（实测全为 null），指定账号代签，台账上才有责任人 */}
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

                {/* 发料结果回写 MES：工单结案按实际发料量算 */}
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

                <div className="flex flex-wrap gap-2 pt-2">
                  <Button onClick={handleSaveConfig} disabled={saving}>
                    {saving ? t('common.loading') : t('common.save')}
                  </Button>
                  <Button variant="outline" onClick={handleTest} disabled={testing}>
                    <Play size={14} className="mr-1" />
                    {testing ? t('common.loading') : t('mes.testConnection')}
                  </Button>
                  <Button variant="outline" disabled={syncing || !status?.configured} onClick={() => void handleSyncIssues(true)}>
                    <PackageSearch size={14} className="mr-1" />
                    全量重拉（忽略游标）
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
};

export default MesSync;
