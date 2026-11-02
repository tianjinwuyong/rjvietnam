import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ScanLine, Plus, CheckCircle2, XCircle, RotateCcw } from 'lucide-react';
import { useI18n, tui, tf } from '@client/src/i18n';
import { Input } from '@client/src/components/ui/input';
import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import ResizableTable from '@client/src/components/ui/resizable-table';
import { Table, type TableProps } from '@client/src/compat/antd-table';
import { logger } from '@client/src/utils/logger';
import { useAuth } from '@client/src/auth/AuthContext';
import { toast } from 'sonner';
import {
  getDefectiveMoveList,
  getDefectiveLocations,
  getDefectiveSourceStock,
  getDefectiveMovePendingCount,
  createDefectiveMove,
  confirmDefectiveMove,
  cancelDefectiveMove,
  scanDefectiveMoveCode,
  completeDefectiveMove,
  type DefectiveMoveTask,
  type DefectiveLocation,
  type DefectiveSourceStock,
} from '@client/src/api/defective-move';

const CREATE_ROLES = ['wh_keeper', 'wh_manager', 'admin'];
const CONFIRM_ROLES = ['wh_manager', 'admin'];

const pickErrMsg = (error: any): string =>
  error?.response?.data?.error?.message || error?.response?.data?.message || '';

const fmtTime = (v?: string | null) => (v ? new Date(v).toLocaleString('zh-CN') : '-');

interface ScannedBox {
  code: string;
  materialCode: string;
  materialName: any;
  batchNo: string;
  qty: number | null;
  unit: string;
}

/**
 * 不良品调拨（扫码作业台）。
 *
 * 两张来源：
 *  1. MRB 判退货 / 报废 / 否决后终审自动生成（待执行）；
 *  2. 良品仓在生产过程中发现不良 → 仓管员制单（待确认）→ 仓库主管确认生效（待执行）。
 *
 * 执行必须扫码：
 *  - 先扫货物标签，服务端校验物料 + 批次是否与本单一致（扫错立刻报错）；
 *  - 再扫不良品仓的库位地址码，服务端校验库位确实属不良品仓且启用。
 * 原来的「下拉选一个库位点完成」已经下线 —— 没有任何实物校验，搬错也看不出来。
 */
const DefectiveMoveWorkbench: React.FC = () => {
  const { t } = useI18n();
  const { role } = useAuth();
  const roleCode = role?.roleCode || '';
  const canCreate = CREATE_ROLES.includes(roleCode);
  const canConfirm = CONFIRM_ROLES.includes(roleCode);
  const canMove = CREATE_ROLES.includes(roleCode);

  const [searchParams, setSearchParams] = useSearchParams();

  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [data, setData] = useState<DefectiveMoveTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState({ pending: 0, pendingConfirm: 0 });

  const [tab, setTab] = useState<'todo' | 'pending_confirm' | 'pending' | 'done'>('todo');
  const [keyword, setKeyword] = useState('');

  // 制单
  const [createOpen, setCreateOpen] = useState(false);
  const [stockKeyword, setStockKeyword] = useState('');
  const [stockList, setStockList] = useState<DefectiveSourceStock[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [pickedStock, setPickedStock] = useState<DefectiveSourceStock | null>(null);
  const [createQty, setCreateQty] = useState('');
  const [createReason, setCreateReason] = useState('');
  const [createRemark, setCreateRemark] = useState('');
  const [creating, setCreating] = useState(false);

  // 主管确认 / 驳回
  const [confirmTask, setConfirmTask] = useState<DefectiveMoveTask | null>(null);
  const [confirmRemark, setConfirmRemark] = useState('');
  const [confirming, setConfirming] = useState(false);

  // 扫码执行
  const [actionTask, setActionTask] = useState<DefectiveMoveTask | null>(null);
  const [locations, setLocations] = useState<DefectiveLocation[]>([]);
  const [scannedBoxes, setScannedBoxes] = useState<ScannedBox[]>([]);
  const [scanInput, setScanInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [locationInput, setLocationInput] = useState('');
  const [verifiedLocation, setVerifiedLocation] = useState<DefectiveLocation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const locRef = useRef<HTMLInputElement>(null);

  // 详情
  const [detailTask, setDetailTask] = useState<DefectiveMoveTask | null>(null);

  const statusParam = (() => {
    if (tab === 'todo') return 'pending_confirm,pending';
    if (tab === 'done') return 'completed,cancelled';
    return tab;
  })();

  const fetchData = useCallback(
    async (p: number = page) => {
      setLoading(true);
      try {
        const res = await getDefectiveMoveList({
          page: p,
          pageSize,
          status: statusParam || undefined,
          keyword: keyword || undefined,
        });
        setData(res.items || []);
        setTotal(Number(res.total || 0));
        setPage(p);
      } catch (error) {
        logger.error('get defective move list failed', error);
        toast.error(t('defectiveMove.loadFailed'));
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize, statusParam, keyword, t],
  );

  const refreshCounts = async () => {
    try {
      const res = await getDefectiveMovePendingCount();
      setCounts({ pending: res.pending || 0, pendingConfirm: res.pendingConfirm || 0 });
    } catch (error) {
      logger.error('get defective move pending count failed', error);
    }
  };

  useEffect(() => {
    fetchData(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    refreshCounts();
  }, []);

  // 从台账 / 站内消息跳进来时带 ?task=<id>，直接打开扫码作业
  useEffect(() => {
    const taskId = searchParams.get('task');
    if (!taskId) return;
    (async () => {
      try {
        const res = await getDefectiveMoveList({ page: 1, pageSize: 200, status: 'pending_confirm,pending' });
        const hit = (res.items || []).find((x) => x.id === taskId);
        if (hit) {
          if (hit.status === 'pending') openAction(hit);
          else setConfirmTask(hit);
        }
      } catch (e) {
        logger.error('open task from query failed', e);
      } finally {
        const next = new URLSearchParams(searchParams);
        next.delete('task');
        setSearchParams(next, { replace: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // ---------------- 制单 ----------------

  const openCreate = async () => {
    setCreateOpen(true);
    setPickedStock(null);
    setCreateQty('');
    setCreateReason('');
    setCreateRemark('');
    setStockKeyword('');
    await searchStock('');
  };

  const searchStock = async (kw: string) => {
    setStockLoading(true);
    try {
      const res = await getDefectiveSourceStock({ keyword: kw, page: 1, pageSize: 50 });
      setStockList(res.items || []);
    } catch (error) {
      logger.error('get source stock failed', error);
      toast.error(t('defectiveMove.stockLoadFailed'));
    } finally {
      setStockLoading(false);
    }
  };

  const pickStock = (row: DefectiveSourceStock) => {
    setPickedStock(row);
    setCreateQty(String(row.availableQty));
  };

  const handleCreate = async () => {
    if (!pickedStock) {
      toast.error(t('defectiveMove.selectStockFirst'));
      return;
    }
    const qty = Number(createQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error(t('defectiveMove.qtyInvalid'));
      return;
    }
    if (qty > Number(pickedStock.availableQty) + 1e-9) {
      toast.error(tf('defectiveMove.qtyOverStock', { qty: pickedStock.availableQty }));
      return;
    }
    if (!createReason.trim()) {
      toast.error(t('defectiveMove.reasonRequired'));
      return;
    }
    setCreating(true);
    try {
      const res = await createDefectiveMove({
        inventoryId: pickedStock.inventoryId,
        quantity: qty,
        reason: createReason.trim(),
        remark: createRemark.trim() || undefined,
      });
      toast.success(tf('defectiveMove.createSuccess', { no: res.moveNo }));
      setCreateOpen(false);
      setTab('pending_confirm');
      fetchData(1);
      refreshCounts();
    } catch (error: any) {
      logger.error('create defective move failed', error);
      toast.error(pickErrMsg(error) || t('defectiveMove.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  // ---------------- 主管确认 ----------------

  const handleConfirm = async (approve: boolean) => {
    if (!confirmTask) return;
    if (!approve && !confirmRemark.trim()) {
      toast.error(t('defectiveMove.rejectReasonRequired'));
      return;
    }
    setConfirming(true);
    try {
      await confirmDefectiveMove(confirmTask.id, approve, confirmRemark.trim() || undefined);
      toast.success(
        approve
          ? tf('defectiveMove.approveSuccess', { no: confirmTask.moveNo || '' })
          : t('defectiveMove.rejectSuccess'),
      );
      setConfirmTask(null);
      setConfirmRemark('');
      fetchData(page);
      refreshCounts();
    } catch (error: any) {
      logger.error('confirm defective move failed', error);
      toast.error(pickErrMsg(error) || t('defectiveMove.confirmFailed'));
    } finally {
      setConfirming(false);
    }
  };

  const handleCancel = async (task: DefectiveMoveTask) => {
    const reason = window.prompt(t('defectiveMove.cancelReasonPrompt'), '');
    if (reason === null) return;
    try {
      await cancelDefectiveMove(task.id, reason || undefined);
      toast.success(t('defectiveMove.cancelSuccess'));
      setConfirmTask(null);
      fetchData(page);
      refreshCounts();
    } catch (error: any) {
      logger.error('cancel defective move failed', error);
      toast.error(pickErrMsg(error) || t('defectiveMove.cancelFailed'));
    }
  };

  // ---------------- 扫码执行 ----------------

  const openAction = async (task: DefectiveMoveTask) => {
    setActionTask(task);
    setScannedBoxes([]);
    setScanInput('');
    setLocationInput(task.toLocationCode || '');
    setVerifiedLocation(null);
    try {
      const rows = await getDefectiveLocations();
      setLocations(rows || []);
    } catch (error) {
      logger.error('get defective locations failed', error);
      toast.error(t('defectiveMove.locationLoadFailed'));
    }
    setTimeout(() => scanRef.current?.focus(), 100);
  };

  /** 扫一箱：服务端校验物料 + 批次，错一箱立即报错，不允许「先扫了再说」 */
  const handleScan = async () => {
    const code = scanInput.trim();
    if (!code || !actionTask) return;
    if (scannedBoxes.some((b) => b.code === code)) {
      toast.error(t('defectiveMove.duplicateScan'));
      setScanInput('');
      return;
    }
    setScanning(true);
    try {
      const res = await scanDefectiveMoveCode(actionTask.id, code);
      setScannedBoxes((prev) => [
        ...prev,
        {
          code,
          materialCode: res.materialCode,
          materialName: res.materialName,
          batchNo: res.batchNo,
          qty: res.qty,
          unit: res.unit,
        },
      ]);
      setScanInput('');
      // 扫完货物自动把焦点切到库位码，减少一次点击
      if (!verifiedLocation) setTimeout(() => locRef.current?.focus(), 50);
    } catch (error: any) {
      logger.error('scan defective move code failed', error);
      toast.error(pickErrMsg(error) || t('defectiveMove.scanFailed'));
      setScanInput('');
    } finally {
      setScanning(false);
    }
  };

  /** 扫库位：精确匹配不良品仓库位 */
  const handleLocationScan = () => {
    const code = locationInput.trim();
    if (!code) return;
    const hit = locations.find((l) => l.locationCode === code);
    if (!hit) {
      setVerifiedLocation(null);
      toast.error(t('defectiveMove.locationNotInDefective'));
      return;
    }
    setVerifiedLocation(hit);
    toast.success(tf('defectiveMove.locationVerified', { code: hit.locationCode }));
  };

  const scannedQty = scannedBoxes.reduce((s, b) => s + Number(b.qty || 0), 0);

  const handleSubmitMove = async () => {
    if (!actionTask) return;
    if (scannedBoxes.length === 0) {
      toast.error(t('defectiveMove.scanFirst'));
      scanRef.current?.focus();
      return;
    }
    if (!verifiedLocation) {
      toast.error(t('defectiveMove.locationScanFirst'));
      locRef.current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const res = await completeDefectiveMove(actionTask.id, {
        scannedCodes: scannedBoxes.map((b) => b.code),
        toLocationCode: verifiedLocation.locationCode,
      });
      toast.success(
        tf('defectiveMove.completeSuccess', {
          qty: res.quantity,
          location: res.toLocationCode || '',
        }),
      );
      setActionTask(null);
      fetchData(page);
      refreshCounts();
    } catch (error: any) {
      logger.error('complete defective move failed', error);
      toast.error(pickErrMsg(error) || t('defectiveMove.completeFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------- 渲染辅助 ----------------

  const statusBadge = (s: string) => {
    if (s === 'pending_confirm') {
      return <Badge variant="outline">{t('defectiveMove.status_pending_confirm')}</Badge>;
    }
    if (s === 'pending') {
      return <Badge variant="outline">{t('defectiveMove.status_pending')}</Badge>;
    }
    if (s === 'completed') {
      return <Badge variant="default">{t('defectiveMove.status_completed')}</Badge>;
    }
    if (s === 'cancelled') {
      return <Badge variant="secondary">{t('defectiveMove.status_cancelled')}</Badge>;
    }
    return <Badge variant="secondary">{s}</Badge>;
  };

  const sourceLabel = (s?: string | null) => {
    const map: Record<string, string> = {
      mrb_return: t('defectiveMove.source_mrb_return'),
      mrb_scrap: t('defectiveMove.source_mrb_scrap'),
      mrb_reject: t('defectiveMove.source_mrb_reject'),
      manual: t('defectiveMove.source_manual'),
    };
    return s ? map[s] || s : '-';
  };

  const columns: TableProps<DefectiveMoveTask>['columns'] = [
    {
      title: t('common.serialNo'),
      key: 'index',
      width: 64,
      fixed: 'left',
      render: (_: any, __: any, index: number) => (page - 1) * pageSize + index + 1,
    },
    {
      title: t('defectiveMove.moveNo'),
      dataIndex: 'moveNo',
      width: 175,
      render: (v: string, r: DefectiveMoveTask) => (
        <div className="flex flex-col">
          <span className="font-mono text-xs">{v || '-'}</span>
          {r.mrbNo && <span className="text-xs text-muted-foreground">{r.mrbNo}</span>}
        </div>
      ),
    },
    {
      title: t('defectiveMove.source'),
      dataIndex: 'source',
      width: 130,
      render: (v: string) => sourceLabel(v),
    },
    {
      title: t('defectiveMove.material'),
      dataIndex: 'materialCode',
      width: 230,
      render: (v: string, r: DefectiveMoveTask) => (
        <div className="flex flex-col">
          <span className="font-mono text-xs">{v || '-'}</span>
          <span className="text-xs text-muted-foreground">{tui(r.materialName) || ''}</span>
        </div>
      ),
    },
    {
      title: t('defectiveMove.batchNo'),
      dataIndex: 'batchNo',
      width: 130,
      render: (v: string) => v || '-',
    },
    {
      title: t('defectiveMove.qty'),
      dataIndex: 'quantity',
      width: 110,
      align: 'right',
      render: (v: number, r: DefectiveMoveTask) => `${v} ${r.unit || ''}`,
    },
    {
      title: t('defectiveMove.fromLocation'),
      dataIndex: 'fromLocationCode',
      width: 150,
      render: (v: string) => v || '-',
    },
    {
      title: t('defectiveMove.status'),
      dataIndex: 'status',
      width: 120,
      render: (s: string) => statusBadge(s),
    },
    {
      title: t('defectiveMove.createdBy'),
      dataIndex: 'createdByName',
      width: 140,
      render: (v: string, r: DefectiveMoveTask) => (
        <div className="flex flex-col">
          <span>{v || '-'}</span>
          <span className="text-xs text-muted-foreground">{fmtTime(r.createdAt)}</span>
        </div>
      ),
    },
    {
      title: t('common.operation'),
      key: 'action',
      width: 230,
      fixed: 'right',
      render: (_: any, record: DefectiveMoveTask) => (
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="ghost" onClick={() => setDetailTask(record)}>
            {t('common.detail')}
          </Button>
          {record.status === 'pending_confirm' && canConfirm && (
            <Button size="sm" onClick={() => { setConfirmTask(record); setConfirmRemark(''); }}>
              {t('defectiveMove.confirmEffective')}
            </Button>
          )}
          {record.status === 'pending_confirm' && !canConfirm && (
            <Button size="sm" variant="secondary" onClick={() => handleCancel(record)}>
              {t('defectiveMove.cancelOrder')}
            </Button>
          )}
          {record.status === 'pending' && canMove && (
            <Button size="sm" onClick={() => openAction(record)}>
              {t('defectiveMove.goScan')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  const tabs: Array<{ key: typeof tab; label: string; count?: number }> = [
    { key: 'todo', label: t('defectiveMove.tabTodo'), count: counts.pending + counts.pendingConfirm },
    { key: 'pending_confirm', label: t('defectiveMove.tabPendingConfirm'), count: counts.pendingConfirm },
    { key: 'pending', label: t('defectiveMove.tabPending'), count: counts.pending },
    { key: 'done', label: t('defectiveMove.tabDone') },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-[12px] p-4 border border-border">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{t('defectiveMove.workbenchTitle')}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t('defectiveMove.workbenchSubtitle')}
            </p>
          </div>
          {canCreate && (
            <Button onClick={openCreate} className="shrink-0">
              <Plus className="w-4 h-4 mr-1" />
              {t('defectiveMove.createOrder')}
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-4">
          <div className="flex rounded-md border border-border overflow-hidden">
            {tabs.map((x) => (
              <button
                key={x.key}
                type="button"
                onClick={() => setTab(x.key)}
                className={`px-3 py-1.5 text-sm transition-colors ${
                  tab === x.key
                    ? 'bg-primary text-white'
                    : 'bg-card text-foreground hover:bg-muted'
                }`}
              >
                {x.label}
                {typeof x.count === 'number' && x.count > 0 && (
                  <span className="ml-1 text-xs font-semibold">({x.count})</span>
                )}
              </button>
            ))}
          </div>
          <div className="flex gap-2 ml-auto">
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={t('defectiveMove.keywordPlaceholder')}
              className="w-64"
              onKeyDown={(e) => e.key === 'Enter' && fetchData(1)}
            />
            <Button variant="secondary" onClick={() => { setKeyword(''); }}>
              {t('common.reset')}
            </Button>
            <Button onClick={() => fetchData(1)}>{t('common.search')}</Button>
          </div>
        </div>

        <div className="mt-3 p-3 rounded-md bg-blue-50 text-blue-700 text-sm flex items-start gap-2">
          <ScanLine className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{t('defectiveMove.scanRuleTip')}</span>
        </div>
      </div>

      <div className="bg-card rounded-[12px] p-4 border border-border">
        <ResizableTable
          columns={columns}
          dataSource={data}
          loading={loading}
          rowKey="id"
          scroll={{ x: 1700, y: 500 }}
          pagination={{
            current: page,
            pageSize,
            total,
            onChange: (p: number) => fetchData(p),
            showSizeChanger: false,
          }}
        />
      </div>

      {/* 制单 */}
      <Dialog open={createOpen} onOpenChange={(open) => !open && setCreateOpen(false)}>
        <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('defectiveMove.createTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={stockKeyword}
                onChange={(e) => setStockKeyword(e.target.value)}
                placeholder={t('defectiveMove.stockKeywordPlaceholder')}
                onKeyDown={(e) => e.key === 'Enter' && searchStock(stockKeyword)}
              />
              <Button onClick={() => searchStock(stockKeyword)}>{t('common.search')}</Button>
            </div>

            <div className="border rounded-md">
              <Table
                size="small"
                rowKey="inventoryId"
                loading={stockLoading}
                dataSource={stockList}
                pagination={false}
                scroll={{ y: 260 }}
                onRow={(record: DefectiveSourceStock) => ({
                  onClick: () => pickStock(record),
                  style: { cursor: 'pointer' },
                })}
                rowClassName={(record: DefectiveSourceStock) =>
                  pickedStock?.inventoryId === record.inventoryId ? 'bg-blue-50' : ''
                }
                columns={[
                  {
                    title: t('defectiveMove.material'),
                    key: 'material',
                    render: (_: any, r: DefectiveSourceStock) => (
                      <div className="flex flex-col">
                        <span className="font-mono text-xs">{r.materialCode}</span>
                        <span className="text-xs text-muted-foreground">{tui(r.materialName)}</span>
                      </div>
                    ),
                  },
                  { title: t('defectiveMove.batchNo'), dataIndex: 'batchNo', width: 130 },
                  {
                    title: t('defectiveMove.fromLocation'),
                    dataIndex: 'locationCode',
                    width: 150,
                  },
                  {
                    title: t('defectiveMove.availableQty'),
                    dataIndex: 'availableQty',
                    width: 120,
                    align: 'right',
                    render: (v: number, r: DefectiveSourceStock) => `${v} ${r.unit || ''}`,
                  },
                ]}
              />
            </div>

            {pickedStock && (
              <div className="grid grid-cols-2 gap-3 text-sm bg-muted p-3 rounded-md">
                <div className="col-span-2">
                  <span className="text-muted-foreground">{t('defectiveMove.selectedStock')}：</span>
                  <span className="font-medium">
                    {pickedStock.materialCode} / {pickedStock.batchNo || '-'} /{' '}
                    {pickedStock.locationCode}
                  </span>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    {t('defectiveMove.createQty')}
                  </label>
                  <Input
                    type="number"
                    value={createQty}
                    onChange={(e) => setCreateQty(e.target.value)}
                    min={0}
                    max={pickedStock.availableQty}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    {t('defectiveMove.createReason')} *
                  </label>
                  <Input
                    value={createReason}
                    onChange={(e) => setCreateReason(e.target.value)}
                    placeholder={t('defectiveMove.createReasonPlaceholder')}
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium mb-1">
                    {t('defectiveMove.remark')}
                  </label>
                  <Input
                    value={createRemark}
                    onChange={(e) => setCreateRemark(e.target.value)}
                    placeholder={t('defectiveMove.createRemarkPlaceholder')}
                  />
                </div>
              </div>
            )}

            <div className="p-3 rounded-md bg-amber-50 text-amber-700 text-sm">
              {t('defectiveMove.createTip')}
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={creating}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={creating || !pickedStock}>
              {creating ? t('defectiveMove.submitting') : t('common.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 主管确认 / 驳回 */}
      <Dialog open={!!confirmTask} onOpenChange={(open) => !open && setConfirmTask(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t('defectiveMove.confirmTitle')}
              {confirmTask?.moveNo ? ` - ${confirmTask.moveNo}` : ''}
            </DialogTitle>
          </DialogHeader>
          {confirmTask && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm bg-muted p-3 rounded-md">
                <div className="col-span-2">
                  <span className="text-muted-foreground">{t('defectiveMove.material')}：</span>
                  <span className="font-medium">
                    {confirmTask.materialCode} {tui(confirmTask.materialName) || ''}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('defectiveMove.batchNo')}：</span>
                  <span className="font-medium">{confirmTask.batchNo || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('defectiveMove.qty')}：</span>
                  <span className="font-medium">
                    {confirmTask.quantity} {confirmTask.unit || ''}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('defectiveMove.fromLocation')}：</span>
                  <span className="font-medium">{confirmTask.fromLocationCode || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('defectiveMove.createdBy')}：</span>
                  <span className="font-medium">{confirmTask.createdByName || '-'}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">{t('defectiveMove.reason')}：</span>
                  <span className="font-medium">{confirmTask.reason || '-'}</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  {t('defectiveMove.confirmRemark')}
                </label>
                <Input
                  value={confirmRemark}
                  onChange={(e) => setConfirmRemark(e.target.value)}
                  placeholder={t('defectiveMove.confirmRemarkPlaceholder')}
                />
              </div>

              <div className="p-3 rounded-md bg-amber-50 text-amber-700 text-sm">
                {t('defectiveMove.confirmTip')}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => confirmTask && handleCancel(confirmTask)}
              disabled={confirming}
            >
              <RotateCcw className="w-4 h-4 mr-1" />
              {t('defectiveMove.cancelOrder')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleConfirm(false)}
              disabled={confirming}
            >
              <XCircle className="w-4 h-4 mr-1" />
              {t('defectiveMove.reject')}
            </Button>
            <Button onClick={() => handleConfirm(true)} disabled={confirming}>
              <CheckCircle2 className="w-4 h-4 mr-1" />
              {confirming ? t('defectiveMove.submitting') : t('defectiveMove.approve')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 扫码执行 */}
      <Dialog open={!!actionTask} onOpenChange={(open) => !open && setActionTask(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t('defectiveMove.scanTitle')}
              {actionTask?.moveNo ? ` - ${actionTask.moveNo}` : ''}
            </DialogTitle>
          </DialogHeader>

          {actionTask && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 bg-muted p-3 rounded-md text-sm">
                <div className="col-span-2">
                  <span className="text-muted-foreground">{t('defectiveMove.material')}：</span>
                  <span className="font-medium">
                    {actionTask.materialCode} {tui(actionTask.materialName) || ''}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('defectiveMove.batchNo')}：</span>
                  <span className="font-medium">{actionTask.batchNo || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('defectiveMove.qty')}：</span>
                  <span className="font-medium">
                    {actionTask.quantity} {actionTask.unit || ''}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('defectiveMove.fromLocation')}：</span>
                  <span className="font-medium">{actionTask.fromLocationCode || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('defectiveMove.source')}：</span>
                  <span className="font-medium">{sourceLabel(actionTask.source)}</span>
                </div>
              </div>

              {/* 第一步：扫货物 */}
              <div className="border rounded-md p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-white text-xs">
                    1
                  </span>
                  <span className="font-medium text-sm">{t('defectiveMove.scanStep1')}</span>
                </div>
                <Input
                  ref={scanRef}
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                  placeholder={t('defectiveMove.scanCodePlaceholder')}
                  disabled={scanning}
                  autoFocus
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t('defectiveMove.scanCodeHint')}
                </p>

                {scannedBoxes.length > 0 && (
                  <div className="mt-3 border rounded">
                    <table className="w-full text-sm">
                      <thead className="bg-muted">
                        <tr>
                          <th className="text-left p-2">#</th>
                          <th className="text-left p-2">{t('defectiveMove.materialCode')}</th>
                          <th className="text-left p-2">{t('defectiveMove.batchNo')}</th>
                          <th className="text-right p-2">{t('defectiveMove.qty')}</th>
                          <th className="p-2">{t('common.action')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scannedBoxes.map((box, idx) => (
                          <tr key={box.code} className="border-t">
                            <td className="p-2">{idx + 1}</td>
                            <td className="p-2 font-mono text-xs">{box.materialCode}</td>
                            <td className="p-2 font-mono text-xs">{box.batchNo || '-'}</td>
                            <td className="p-2 text-right">
                              {box.qty == null ? '-' : `${box.qty} ${box.unit || ''}`}
                            </td>
                            <td className="p-2 text-center">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  setScannedBoxes((prev) => prev.filter((x) => x.code !== box.code))
                                }
                              >
                                <XCircle className="w-4 h-4 text-red-500" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="p-2 text-xs text-muted-foreground border-t">
                      {tf('defectiveMove.scannedSummary', {
                        n: scannedBoxes.length,
                        qty: scannedQty,
                        unit: actionTask.unit || '',
                        expect: actionTask.quantity,
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* 第二步：扫库位 */}
              <div className="border rounded-md p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-white text-xs">
                    2
                  </span>
                  <span className="font-medium text-sm">{t('defectiveMove.scanStep2')}</span>
                </div>
                <Input
                  ref={locRef}
                  value={locationInput}
                  onChange={(e) => {
                    setLocationInput(e.target.value);
                    setVerifiedLocation(null);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleLocationScan()}
                  onBlur={handleLocationScan}
                  placeholder={t('defectiveMove.scanLocationPlaceholder')}
                  disabled={scannedBoxes.length === 0}
                />
                {verifiedLocation ? (
                  <div className="mt-2 p-2 rounded bg-green-50 text-green-700 text-sm">
                    <CheckCircle2 className="w-4 h-4 inline mr-1" />
                    {verifiedLocation.locationCode}（{verifiedLocation.whNameZh}）
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('defectiveMove.scanLocationHint')}
                  </p>
                )}
                {locations.length === 0 && (
                  <p className="text-xs text-amber-600 mt-1">
                    {t('defectiveMove.noDefectiveLocation')}
                  </p>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="secondary" onClick={() => setActionTask(null)} disabled={submitting}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleSubmitMove}
              disabled={submitting || scannedBoxes.length === 0 || !verifiedLocation}
            >
              {submitting ? t('defectiveMove.submitting') : t('defectiveMove.confirmMove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 详情 */}
      <Dialog open={!!detailTask} onOpenChange={(open) => !open && setDetailTask(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t('defectiveMove.detailTitle')}
              {detailTask?.moveNo ? ` - ${detailTask.moveNo}` : ''}
            </DialogTitle>
          </DialogHeader>
          {detailTask && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">{t('defectiveMove.source')}：</span>
                <span className="font-medium">{sourceLabel(detailTask.source)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('defectiveMove.status')}：</span>
                {statusBadge(detailTask.status)}
              </div>
              <div>
                <span className="text-muted-foreground">{t('defectiveMove.sourceInspectionNo')}：</span>
                <span className="font-mono font-medium">{detailTask.sourceInspectionNo || '-'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('defectiveMove.mrbNo')}：</span>
                <span className="font-mono font-medium">{detailTask.mrbNo || '-'}</span>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">{t('defectiveMove.material')}：</span>
                <span className="font-medium">
                  {detailTask.materialCode} {tui(detailTask.materialName) || ''}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('defectiveMove.batchNo')}：</span>
                <span className="font-medium">{detailTask.batchNo || '-'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('defectiveMove.qty')}：</span>
                <span className="font-medium">
                  {detailTask.quantity} {detailTask.unit || ''}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('defectiveMove.fromLocation')}：</span>
                <span className="font-medium">{detailTask.fromLocationCode || '-'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('defectiveMove.toLocation')}：</span>
                <span className="font-medium">
                  {detailTask.toLocationCode || t('defectiveMove.emptyLocation')}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('defectiveMove.createdBy')}：</span>
                <span className="font-medium">{detailTask.createdByName || '-'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('defectiveMove.createdAt')}：</span>
                <span className="font-medium">{fmtTime(detailTask.createdAt)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('defectiveMove.confirmedByName')}：</span>
                <span className="font-medium">{detailTask.confirmedByName || '-'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('defectiveMove.confirmedAt')}：</span>
                <span className="font-medium">{fmtTime(detailTask.confirmedAt)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('defectiveMove.operator')}：</span>
                <span className="font-medium">{detailTask.operatorName || '-'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('defectiveMove.scanToCode')}：</span>
                <span className="font-medium">{detailTask.scanToCode || '-'}</span>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">{t('defectiveMove.reason')}：</span>
                <span className="font-medium">{detailTask.reason || '-'}</span>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">{t('defectiveMove.remark')}：</span>
                <span className="font-medium">{detailTask.remark || '-'}</span>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">{t('defectiveMove.confirmRemarkLabel')}：</span>
                <span className="font-medium">{detailTask.confirmRemark || '-'}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DefectiveMoveWorkbench;
