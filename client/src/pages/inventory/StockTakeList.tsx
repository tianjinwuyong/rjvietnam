import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import ResizableTable from '@client/src/components/ui/resizable-table';
import { Input } from '@client/src/components/ui/input';
import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import { Textarea } from '@client/src/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import { useI18n, tf, tui } from '@client/src/i18n';
import { stockTake as stockTakeApi } from '@client/src/api';
import type { StockTakeOrder, StockTakeWarehouseOption } from '@client/src/api/stockTake';
import { usePermission } from '@client/src/auth/usePermission';
import { logger } from '@client/src/utils/logger';
import { renderDateTime } from '@client/src/utils/datetime';
import { toast } from 'sonner';
import { Plus, Play, Download, Check, X, LockOpen, Ban, RefreshCw, Trash2 } from 'lucide-react';

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  draft: 'secondary',
  pending_approval: 'default',
  approved: 'default',
  rejected: 'destructive',
  cancelled: 'outline',
};

const StockTakeList: React.FC = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { role } = usePermission();
  const roleCode = role?.roleCode || '';

  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<StockTakeOrder[]>([]);
  const [filters, setFilters] = useState({ takeNo: '', status: '', periodMonth: '', warehouseCode: '' });
  // 仓库选项（按仓库代码建立盘点清单）
  const [warehouses, setWarehouses] = useState<StockTakeWarehouseOption[]>([]);

  // 新建盘点单
  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createForm, setCreateForm] = useState({
    warehouseCode: '',
    periodMonth: new Date().toISOString().slice(0, 7),
    remark: '',
    /** standalone=单张盘点单；main=主盘点单（后续按库位范围拆子单） */
    orderType: 'standalone' as 'standalone' | 'main',
    /** monthly=月度盘点；spot=临时抽盘（同月可多次） */
    takeType: 'monthly' as 'monthly' | 'spot',
    title: '',
  });

  // 审批
  const [approveOpen, setApproveOpen] = useState(false);
  const [approveTarget, setApproveTarget] = useState<StockTakeOrder | null>(null);
  const [approvePass, setApprovePass] = useState(true);
  const [approveRemark, setApproveRemark] = useState('');

  // 授权修改
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockTarget, setUnlockTarget] = useState<StockTakeOrder | null>(null);
  const [unlockReason, setUnlockReason] = useState('');

  const canOperate = ['admin', 'wh_keeper', 'wh_manager'].includes(roleCode);
  const canApprove = ['admin', 'wh_manager'].includes(roleCode);
  const isAdmin = roleCode === 'admin';

  /** 当前选择的仓库（用于展示该仓库库存行数） */
  const selectedWarehouse = warehouses.find((w) => w.code === createForm.warehouseCode);

  /** 查询筛选下拉：系统全部仓库（含停用），与列表数据范围一致 */
  const warehouseFilterOptions = warehouses;
  /** 新建盘点单：只允许启用仓库 */
  const activeWarehouses = useMemo(
    () => warehouses.filter((w) => w.status !== 'inactive'),
    [warehouses],
  );

  const statusLabel = (s: string) =>
    t(`stockTake.status_${s}`) || ({
      draft: '盘点中', pending_approval: '待审批', approved: '已批准',
      rejected: '已驳回', cancelled: '已取消',
    } as Record<string, string>)[s] || s;

  /** 仓库展示：代码 + 名称 */
  const warehouseLabel = (code?: string, name?: string) => {
    if (!code && !name) return '-';
    if (code && name) return `${code} · ${name}`;
    return code || name || '-';
  };

  // 仓库选项：按仓库代码建立盘点清单
  const fetchWarehouses = useCallback(async () => {
    try {
      const list = await stockTakeApi.getStockTakeWarehouseOptions();
      setWarehouses(list || []);
      // 新建盘点单只允许启用仓库；默认取第一个有库存行的启用仓库
      const active = (list || []).filter((w) => w.status !== 'inactive');
      setCreateForm((prev) => {
        if (prev.warehouseCode) return prev;
        const first = active.find((w) => w.stockLines > 0) || active[0];
        return first ? { ...prev, warehouseCode: first.code } : prev;
      });
    } catch (error) {
      logger.error('Failed to fetch stock take warehouses:', String(error));
      setWarehouses([]);
    }
  }, []);

  useEffect(() => { fetchWarehouses(); }, [fetchWarehouses]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await stockTakeApi.getStockTakeList({
        page,
        pageSize,
        takeNo: filters.takeNo || undefined,
        status: filters.status || undefined,
        periodMonth: filters.periodMonth || undefined,
        warehouseCode: filters.warehouseCode || undefined,
      });
      setData(res.items || []);
      setTotal(res.total || 0);
    } catch (error) {
      logger.error('Failed to fetch stock take list:', String(error));
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filters]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreate = async () => {
    if (!createForm.periodMonth) {
      toast.error(t('stockTake.periodRequired') || '请选择盘点期间');
      return;
    }
    if (!createForm.warehouseCode) {
      toast.error(t('stockTake.warehouseRequired') || '请选择盘点仓库');
      return;
    }
    setCreateLoading(true);
    try {
      const res = await stockTakeApi.createStockTake({
        scope: 'all',
        warehouseCode: createForm.warehouseCode,
        periodMonth: createForm.periodMonth,
        remark: createForm.remark,
        orderType: createForm.orderType,
        takeType: createForm.takeType,
        title: createForm.title.trim() || undefined,
      });
      const orders = res?.orders || [];
      if (orders.length === 1) {
        const order = orders[0];
        if (createForm.orderType === 'main') {
          toast.success(
            `${t('stockTake.createMainSuccess') || '主盘点单已创建'}：${order.takeNo}，${t('stockTake.createMainNext') || '请进入后按区域 / 地址码范围拆分子盘点单'}`,
          );
        } else {
          toast.success(
            `${t('stockTake.createSuccess') || '盘点单已创建'}：${order.takeNo}（${warehouseLabel(order.warehouseCode, order.warehouseName)}，${order.totalLines} ${t('stockTake.lines') || '行'}）`,
          );
        }
      } else {
        toast.success(
          `${t('stockTake.createMultiSuccess') || '批量建单完成'}：${orders.length} ${t('stockTake.orders') || '张'}（${orders.map((o) => o.warehouseCode || '-').join('、')}）`,
        );
      }
      if (res?.skipped?.length) {
        toast.warning(
          `${t('stockTake.createSkipped') || '以下仓库无库存未建单'}：${res.skipped.map((s) => s.warehouseCode).join('、')}`,
        );
      }
      setCreateOpen(false);
      setCreateForm((prev) => ({
        warehouseCode: prev.warehouseCode,
        periodMonth: new Date().toISOString().slice(0, 7),
        remark: '',
        orderType: prev.orderType,
        takeType: prev.takeType,
        title: '',
      }));
      fetchData();
      fetchWarehouses();
      // 单仓建单直接进入盘点作业；多仓建单留在列表，便于按仓库分别管理
      if (orders.length === 1 && orders[0]?.id) navigate(`/inventory/stock-take/${orders[0].id}`);
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || t('stockTake.createFailed') || '创建失败');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleSubmit = async (record: StockTakeOrder) => {
    if (!window.confirm(t('stockTake.submitConfirm') || '提交后将交由仓库主管审批，提交期间不可修改。确定提交？')) return;
    try {
      await stockTakeApi.submitStockTake(record.id);
      toast.success(t('stockTake.submitSuccess') || '已提交审批');
      fetchData();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || t('stockTake.submitFailed') || '提交失败');
    }
  };

  const handleCancel = async (record: StockTakeOrder) => {
    if (!window.confirm(t('stockTake.cancelConfirm') || '确定取消该盘点单？')) return;
    try {
      await stockTakeApi.cancelStockTake(record.id);
      toast.success(t('stockTake.cancelSuccess') || '已取消');
      fetchData();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || '取消失败');
    }
  };

  const handleDelete = async (record: StockTakeOrder) => {
    if (!window.confirm(t('stockTake.deleteConfirm') || '删除后该盘点单及其明细、操作日志将一并清除，且不可恢复。确定删除？')) return;
    try {
      await stockTakeApi.deleteStockTake(record.id);
      toast.success(t('stockTake.deleteSuccess') || '已删除');
      if (total > (page - 1) * pageSize + 1 && page > 1) setPage(page - 1);
      else fetchData();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || t('stockTake.deleteFailed') || '删除失败');
    }
  };

  const openApprove = (record: StockTakeOrder, pass: boolean) => {
    setApproveTarget(record);
    setApprovePass(pass);
    setApproveRemark('');
    setApproveOpen(true);
  };

  const handleApprove = async () => {
    if (!approveTarget) return;
    if (!approvePass && !approveRemark.trim()) {
      toast.error(t('stockTake.rejectReasonRequired') || '驳回请填写原因');
      return;
    }
    try {
      await stockTakeApi.approveStockTake(approveTarget.id, approvePass, approveRemark || undefined);
      toast.success(approvePass ? (t('stockTake.approveSuccess') || '已批准') : (t('stockTake.rejectSuccess') || '已驳回'));
      setApproveOpen(false);
      fetchData();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || '审批失败');
    }
  };

  const handleUnlock = async () => {
    if (!unlockTarget) return;
    if (!unlockReason.trim()) {
      toast.error(t('stockTake.unlockReasonRequired') || '请填写授权修改原因（留痕可追溯）');
      return;
    }
    try {
      await stockTakeApi.unlockStockTake(unlockTarget.id, unlockReason.trim());
      toast.success(t('stockTake.unlockSuccess') || '已授权修改，盘点单已退回盘点中');
      setUnlockOpen(false);
      fetchData();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || '授权失败');
    }
  };

  const handleExport = async () => {
    let list = data;
    try {
      // 按当前查询条件（含仓库代码）导出全部匹配记录，而非仅当前页
      if (total > data.length) {
        const res = await stockTakeApi.getStockTakeList({
          page: 1,
          pageSize: Math.min(Math.max(total, 1), 5000),
          takeNo: filters.takeNo || undefined,
          status: filters.status || undefined,
          periodMonth: filters.periodMonth || undefined,
          warehouseCode: filters.warehouseCode || undefined,
        });
        list = res.items || [];
      }
    } catch (error) {
      logger.error('Export fallback to current page:', String(error));
    }
    if (list.length === 0) {
      toast.error(t('message.noData') || '暂无数据');
      return;
    }
    const rows = list.map((r, i) => ({
      [t('common.serialNo') || '序号']: i + 1,
      [t('stockTake.takeNo') || '盘点单号']: r.takeNo,
      [t('stockTake.warehouseCode') || '仓库代码']: r.warehouseCode || '',
      [t('stockTake.warehouse') || '仓库']: r.warehouseName || '',
      [t('stockTake.period') || '盘点期间']: r.periodMonth,
      [t('common.status') || '状态']: statusLabel(r.status),
      [t('stockTake.totalLines') || '应盘行数']: r.totalLines,
      [t('stockTake.checkedLines') || '已盘行数']: r.checkedLines,
      [t('stockTake.matchLines') || '账实一致']: r.matchLines,
      [t('stockTake.profitLines') || '盘盈行数']: r.profitLines,
      [t('stockTake.lossLines') || '盘亏行数']: r.lossLines,
      [t('stockTake.bookQtyTotal') || '账面数量']: r.bookQtyTotal,
      [t('stockTake.actualQtyTotal') || '实盘数量']: r.actualQtyTotal,
      [t('stockTake.diffQtyTotal') || '差异数量']: r.diffQtyTotal,
      [t('stockTake.operator') || '盘点人']: r.operatorName || '',
      [t('stockTake.approver') || '审批人']: r.approverName || '',
      [t('stockTake.approvalTime') || '审批时间']: r.approvalTime ? renderDateTime(r.approvalTime) : '',
      [t('common.remark') || '备注']: r.remark || '',
    }));
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(','), ...rows.map((row) =>
      headers.map((h) => `"${String((row as any)[h] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const whPart = filters.warehouseCode ? `_${filters.warehouseCode}` : '';
    a.download = `stock_take${whPart}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${t('message.exportSuccess') || '导出成功'}：${list.length} ${t('common.recordUnit') || '条'}`);
  };

  const columns: any[] = [
    {
      title: t('stockTake.takeNo') || '盘点单号', dataIndex: 'takeNo', width: 150, fixed: 'left',
      render: (v: string, r: StockTakeOrder) => (
        <div className="flex flex-col">
          <button className="text-primary hover:underline" onClick={() => navigate(`/inventory/stock-take/${r.id}`)}>{v}</button>
          <span className="text-xs text-muted-foreground">
            {r.takeType === 'spot' ? (t('stockTake.typeSpot') || '临时抽盘') : (t('stockTake.typeMonthly') || '月度盘点')}
            {r.title ? ` · ${r.title}` : ''}
          </span>
        </div>
      ),
    },
    {
      title: t('stockTake.orderType') || '单据类型', dataIndex: 'orderType', width: 105,
      render: (v: string, r: StockTakeOrder) => {
        if (v === 'main') {
          return (
            <Badge variant="default" className="whitespace-nowrap">
              {t('stockTake.typeMain') || '主盘点单'}{r.childCount ? ` (${r.childCount})` : ''}
            </Badge>
          );
        }
        if (v === 'sub') {
          return <Badge variant="outline" className="whitespace-nowrap">{t('stockTake.typeSub') || '子盘点单'}</Badge>;
        }
        return <span className="text-xs text-muted-foreground">{t('stockTake.typeStandalone') || '单张'}</span>;
      },
    },
    {
      title: t('stockTake.warehouseCode') || '仓库代码', dataIndex: 'warehouseCode', width: 160, fixed: 'left',
      render: (v: string, r: StockTakeOrder) => (
        <span className="inline-flex items-center gap-1">
          <span className="font-medium">{v || '-'}</span>
          {r.warehouseName && <span className="text-muted-foreground text-xs">{r.warehouseName}</span>}
        </span>
      ),
    },
    { title: t('stockTake.period') || '盘点期间', dataIndex: 'periodMonth', width: 100 },
    {
      title: t('common.status') || '状态', dataIndex: 'status', width: 100,
      render: (v: string, r: StockTakeOrder) => (
        <div className="flex items-center gap-1">
          <Badge variant={statusVariant[v] || 'secondary'}>{statusLabel(v)}</Badge>
          {['draft', 'pending_approval'].includes(v) && (
            <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-50">
              {t('stockTake.frozen') || '库存冻结中'}
            </Badge>
          )}
          {r.revisionCount > 0 && <Badge variant="outline">{tf('ui.修订{n}', { n: r.revisionCount })}</Badge>}
        </div>
      ),
    },
    {
      title: t('stockTake.progress') || '盘点进度', key: 'progress', width: 110,
      render: (_: any, r: StockTakeOrder) => `${r.checkedLines}/${r.totalLines}`,
    },
    {
      title: t('stockTake.matchLines') || '账实一致', dataIndex: 'matchLines', width: 90, align: 'right',
      render: (v: number) => <span className="text-muted-foreground">{v}</span>,
    },
    {
      title: t('stockTake.profitLines') || '盘盈', dataIndex: 'profitLines', width: 80, align: 'right',
      render: (v: number) => v > 0
        ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200">{tf('ui.盘盈 {n}', { n: v })}</span>
        : <span className="text-muted-foreground">0</span>,
    },
    {
      title: t('stockTake.lossLines') || '盘亏', dataIndex: 'lossLines', width: 80, align: 'right',
      render: (v: number) => v > 0
        ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">{tf('ui.盘亏 {n}', { n: v })}</span>
        : <span className="text-muted-foreground">0</span>,
    },
    {
      title: t('stockTake.diffQtyTotal') || '差异数量', dataIndex: 'diffQtyTotal', width: 110, align: 'right',
      render: (v: number) => (
        <span className={v > 0 ? 'text-red-600 font-semibold' : v < 0 ? 'text-amber-600 font-semibold' : 'text-muted-foreground'}>
          {v > 0 ? '+' : ''}{v}
        </span>
      ),
    },
    { title: t('stockTake.operator') || '盘点人', dataIndex: 'operatorName', width: 100, render: (v: string) => v || '-' },
    { title: t('stockTake.approver') || '审批人', dataIndex: 'approverName', width: 100, render: (v: string) => tui(v) || '-' },
    { title: t('stockTake.createdAt') || '创建时间', dataIndex: 'createdAt', width: 160, render: (v: string) => renderDateTime(v) },
    {
      title: t('common.operation') || '操作', key: 'action', width: 250, fixed: 'right',
      render: (_: any, r: StockTakeOrder) => (
        <div className="flex flex-wrap gap-1">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/inventory/stock-take/${r.id}`)}>
            <Play size={14} className="mr-1" />
            {r.orderType === 'main'
              ? (t('stockTake.manageSubOrders') || '子单 / 汇总')
              : r.status === 'draft' || r.status === 'rejected'
                ? (t('stockTake.doTake') || '盘点')
                : (t('stockTake.viewReport') || '查看报表')}
          </Button>
          {canOperate && r.orderType !== 'main' && ['draft', 'rejected'].includes(r.status) && (
            <Button variant="ghost" size="sm" onClick={() => handleSubmit(r)}>{t('stockTake.submit') || '提交审批'}</Button>
          )}
          {canApprove && r.status === 'pending_approval' && (
            <>
              <Button variant="ghost" size="sm" className="text-green-600" onClick={() => openApprove(r, true)}>
                <Check size={14} className="mr-1" />{t('stockTake.approve') || '批准'}
              </Button>
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => openApprove(r, false)}>
                <X size={14} className="mr-1" />{t('stockTake.reject') || '驳回'}
              </Button>
            </>
          )}
          {isAdmin && r.status === 'approved' && (
            <Button variant="ghost" size="sm" className="text-amber-600"
              onClick={() => { setUnlockTarget(r); setUnlockReason(''); setUnlockOpen(true); }}>
              <LockOpen size={14} className="mr-1" />{t('stockTake.unlock') || '授权修改'}
            </Button>
          )}
          {canOperate && ['draft', 'rejected'].includes(r.status) && (
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleCancel(r)}>
              <Ban size={14} className="mr-1" />{t('common.cancel') || '取消'}
            </Button>
          )}
          {canOperate && r.status === 'cancelled' && (
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDelete(r)}>
              <Trash2 size={14} className="mr-1" />{t('common.delete') || '删除'}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t('nav.stockTake') || '库存盘点'}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('stockTake.listHint') || '按库存物料清单逐箱扫描物料标签，系统自动核算账实差异；盘盈盘亏重点标识，仓库主管批准后归档追溯（同一月份可多次盘点）。'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchData}><RefreshCw size={15} className="mr-1" />{t('common.refresh') || '刷新'}</Button>
          <Button variant="outline" onClick={handleExport}><Download size={15} className="mr-1" />{t('common.export') || '导出'}</Button>
          {canOperate && (
            <Button onClick={() => { fetchWarehouses(); setCreateOpen(true); }}><Plus size={15} className="mr-1" />{t('stockTake.create') || '新建盘点单'}</Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-end p-3 border rounded-lg bg-muted/30">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">{t('stockTake.takeNo') || '盘点单号'}</label>
          <Input className="w-44" value={filters.takeNo}
            onChange={(e) => setFilters({ ...filters, takeNo: e.target.value })}
            placeholder="PD2026..." />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">{t('stockTake.period') || '盘点期间'}</label>
          <Input className="w-40" type="month" value={filters.periodMonth}
            onChange={(e) => setFilters({ ...filters, periodMonth: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">{t('stockTake.warehouseCode') || '仓库代码'}</label>
          <Select
            value={filters.warehouseCode || 'all'}
            onValueChange={(v) => setFilters({ ...filters, warehouseCode: v === 'all' ? '' : v })}
          >
            <SelectTrigger className="w-52"><SelectValue placeholder={t('common.all') || '全部'} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('common.all') || '全部'}</SelectItem>
              {warehouseFilterOptions.map((w) => (
                <SelectItem key={w.id} value={w.code}>
                  {w.code} · {w.name}
                  {w.status === 'inactive' ? ` · ${t('common.inactive') || '停用'}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">{t('common.status') || '状态'}</label>
          <Select value={filters.status || 'all'} onValueChange={(v) => setFilters({ ...filters, status: v === 'all' ? '' : v })}>
            <SelectTrigger className="w-36"><SelectValue placeholder={t('common.all') || '全部'} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('common.all') || '全部'}</SelectItem>
              <SelectItem value="draft">{statusLabel('draft')}</SelectItem>
              <SelectItem value="pending_approval">{statusLabel('pending_approval')}</SelectItem>
              <SelectItem value="approved">{statusLabel('approved')}</SelectItem>
              <SelectItem value="rejected">{statusLabel('rejected')}</SelectItem>
              <SelectItem value="cancelled">{statusLabel('cancelled')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => { setPage(1); fetchData(); }}>{t('common.search') || '查询'}</Button>
        <Button variant="outline" onClick={() => { setFilters({ takeNo: '', status: '', periodMonth: '', warehouseCode: '' }); setPage(1); }}>
          {t('common.reset') || '重置'}
        </Button>
      </div>

      <ResizableTable<StockTakeOrder>
        columns={columns}
        dataSource={data}
        loading={loading}
        rowKey="id"
        scroll={{ x: 1600 }}
        pagination={{
          current: page,
          pageSize,
          total,
          onChange: (p: number) => setPage(p),
          showTotal: (t2: number) => `${t('common.total') || '共'} ${t2} ${t('common.recordUnit') || '条'}`,
        }}
      />

      {/* 新建盘点单 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t('stockTake.create') || '新建盘点单'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('stockTake.createMode') || '建单方式'} *</label>
              <Select
                value={createForm.orderType}
                onValueChange={(v) => setCreateForm({ ...createForm, orderType: v as 'standalone' | 'main' })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="standalone">{t('stockTake.modeStandalone') || '单张盘点单（整仓一次盘完）'}</SelectItem>
                  <SelectItem value="main">{t('stockTake.modeMain') || '主盘点单（按区域 / 地址码拆子单）'}</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                {createForm.orderType === 'main'
                  ? (t('stockTake.modeMainHint') || '物料较多时建议：先建主盘点单，再按区域或地址码范围拆成多张子盘点单，多人同时盘点，最后在主单汇总确认盈亏。')
                  : (t('stockTake.modeStandaloneHint') || '单张盘点单：整仓生成账面快照，适合物料量不大、一次盘完的仓库。')}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('stockTake.selectWarehouse') || '选择仓库'} *</label>
              <Select
                value={createForm.warehouseCode || undefined}
                onValueChange={(v) => setCreateForm({ ...createForm, warehouseCode: v })}
              >
                <SelectTrigger><SelectValue placeholder={t('stockTake.selectWarehouse') || '选择仓库'} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={stockTakeApi.ALL_WAREHOUSES}>
                    {t('stockTake.allWarehouses') || '全部仓库（各建一单）'}
                  </SelectItem>
                  {activeWarehouses.map((w) => (
                    <SelectItem key={w.id} value={w.code}>
                      {w.code} · {w.name}（{w.stockLines} {t('stockTake.lines') || '行'}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedWarehouse && (
                <span className="text-xs text-muted-foreground">
                  {t('stockTake.stock_good') || '良品仓'} {selectedWarehouse.goodLines} · {t('stockTake.stock_defective') || '不良品仓'} {selectedWarehouse.defectiveLines} · {t('stockTake.stock_rework') || '返工仓'} {selectedWarehouse.reworkLines}
                  （{t('stockTake.stockLinesCount') || '库存行数'}）
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {t('stockTake.warehouseHint') || '按仓库代码建立盘点清单：选择某个仓库即只为该仓库建单；选择「全部仓库」则为每个有库存的仓库各建一单，便于按仓库分别查询与导出追溯。'}
              </span>
              <span className="text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-md px-2 py-1.5 leading-relaxed">
                {t('stockTake.freezeHint') || '创建盘点单后，系统将立即冻结所选仓库的所有库存异动，以保证盘点期间账面快照与实时库存一致；盘点单审批通过、驳回或取消后自动解冻。'}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('stockTake.period') || '盘点期间'} *</label>
              <Input type="month" value={createForm.periodMonth}
                onChange={(e) => setCreateForm({ ...createForm, periodMonth: e.target.value })} />
              <span className="text-xs text-muted-foreground">
                {t('stockTake.monthlyHint') || '同一月份可以建多张盘点单（月度盘点、临时抽盘、复盘各自独立）'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-sm text-muted-foreground">{t('stockTake.takeType') || '盘点类型'}</label>
                <Select
                  value={createForm.takeType}
                  onValueChange={(v) => setCreateForm({ ...createForm, takeType: v as 'monthly' | 'spot' })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">{t('stockTake.typeMonthly') || '月度盘点'}</SelectItem>
                    <SelectItem value="spot">{t('stockTake.typeSpot') || '临时抽盘'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-muted-foreground">{t('stockTake.title') || '盘点名称'}</label>
                <Input value={createForm.title}
                  placeholder={t('stockTake.titlePlaceholder') || '如：10月第二次复盘（可留空）'}
                  onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('common.remark') || '备注'}</label>
              <Textarea rows={2} value={createForm.remark}
                onChange={(e) => setCreateForm({ ...createForm, remark: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('common.cancel') || '取消'}</Button>
            <Button onClick={handleCreate} disabled={createLoading}>
              {createLoading ? (t('common.processing') || '处理中...') : (t('common.confirm') || '确定')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 审批 */}
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {approvePass ? (t('stockTake.approveTitle') || '批准盘点单') : (t('stockTake.rejectTitle') || '驳回盘点单')}
              {approveTarget ? ` - ${approveTarget.takeNo}` : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {approveTarget && (
              <div className="text-sm bg-muted/40 rounded-md p-3 space-y-1">
                <div>{t('stockTake.totalLines') || '应盘行数'}：{approveTarget.totalLines}　
                  {t('stockTake.profitLines') || '盘盈'}：<span className="text-red-600 font-semibold">{approveTarget.profitLines}</span>　
                  {t('stockTake.lossLines') || '盘亏'}：<span className="text-amber-600 font-semibold">{approveTarget.lossLines}</span></div>
                <div>{t('stockTake.bookQtyTotal') || '账面数量'}：{approveTarget.bookQtyTotal}　
                  {t('stockTake.actualQtyTotal') || '实盘数量'}：{approveTarget.actualQtyTotal}　
                  {t('stockTake.diffQtyTotal') || '差异数量'}：
                  <span className={approveTarget.diffQtyTotal > 0 ? 'text-red-600 font-semibold' : 'text-amber-600 font-semibold'}>
                    {approveTarget.diffQtyTotal > 0 ? '+' : ''}{approveTarget.diffQtyTotal}
                  </span>
                </div>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">
                {t('stockTake.approvalRemark') || '审批意见'}{!approvePass && ' *'}
              </label>
              <Textarea rows={3} value={approveRemark} onChange={(e) => setApproveRemark(e.target.value)}
                placeholder={approvePass ? (t('stockTake.approvalRemarkPlaceholder') || '可选') : (t('stockTake.rejectReasonRequired') || '请填写驳回原因')} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)}>{t('common.cancel') || '取消'}</Button>
            <Button onClick={handleApprove} className={approvePass ? '' : 'bg-destructive hover:bg-destructive/90'}>
              {approvePass ? (t('stockTake.confirmApprove') || '确认批准') : (t('stockTake.confirmReject') || '确认驳回')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 授权修改 */}
      <Dialog open={unlockOpen} onOpenChange={setUnlockOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t('stockTake.unlockTitle') || '系统管理员授权修改'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t('stockTake.unlockHint') || '已批准的盘点单为归档数据，如需更新必须由系统管理员授权；授权后盘点单退回「盘点中」，可重新盘点并再次提交审批，全过程留痕可追溯。'}
            </p>
            {unlockTarget && (
              <div className="text-sm bg-muted/40 rounded-md p-3">
                {unlockTarget.takeNo}　{statusLabel(unlockTarget.status)}　
                {t('stockTake.revision') || '已修订'}：{unlockTarget.revisionCount} {t('stockTake.times') || '次'}
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('stockTake.unlockReason') || '授权修改原因'} *</label>
              <Textarea rows={3} value={unlockReason} onChange={(e) => setUnlockReason(e.target.value)}
                placeholder={t('stockTake.unlockReasonPlaceholder') || '请填写修改原因，将记入操作日志供追溯'} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnlockOpen(false)}>{t('common.cancel') || '取消'}</Button>
            <Button onClick={handleUnlock}>{t('stockTake.confirmUnlock') || '确认授权'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default StockTakeList;
