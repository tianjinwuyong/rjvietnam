import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ResizableTable from '@client/src/components/ui/resizable-table';
import { Input } from '@client/src/components/ui/input';
import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import { Textarea } from '@client/src/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@client/src/components/ui/tabs';
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
import { useI18n, tui } from '@client/src/i18n';
import { stockTake as stockTakeApi } from '@client/src/api';
import type { StockTakeOrder, StockTakeItem, StockTakeReport, StockTakeLog, ScanResult } from '@client/src/api/stockTake';
import { usePermission } from '@client/src/auth/usePermission';
import { logger } from '@client/src/utils/logger';
import { renderDateTime, renderDate } from '@client/src/utils/datetime';
import { toast } from 'sonner';
import { ArrowLeft, ScanLine, Download, Check, X, LockOpen, Ban, RefreshCw, Send, ClipboardList, Plus, GitBranch, ExternalLink } from 'lucide-react';

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  draft: 'secondary',
  pending_approval: 'default',
  approved: 'default',
  rejected: 'destructive',
  cancelled: 'outline',
};

const StockTakeDetail: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useI18n();
  const { role } = usePermission();
  const roleCode = role?.roleCode || '';

  const [order, setOrder] = useState<StockTakeOrder | null>(null);
  const [items, setItems] = useState<StockTakeItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('items');

  const [filters, setFilters] = useState({
    materialCode: '', materialName: '', supplier: '', diffType: '', locationCode: '', batchNo: '',
  });
  const [onlyDiff, setOnlyDiff] = useState(false);

  const [scanInput, setScanInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const [report, setReport] = useState<StockTakeReport | null>(null);
  const [logs, setLogs] = useState<StockTakeLog[]>([]);

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustItem, setAdjustItem] = useState<StockTakeItem | null>(null);
  const [adjustQty, setAdjustQty] = useState<string>('');
  const [adjustRemark, setAdjustRemark] = useState('');

  const [labelOpen, setLabelOpen] = useState(false);
  const [labelItem, setLabelItem] = useState<StockTakeItem | null>(null);

  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitRemark, setSubmitRemark] = useState('');

  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockReason, setUnlockReason] = useState('');

  // 主盘点单：拆分子单
  const [subOpen, setSubOpen] = useState(false);
  const [subLoading, setSubLoading] = useState(false);
  const [subForm, setSubForm] = useState({
    areaCode: '', shelfCode: '', layerCode: '', locationFrom: '', locationTo: '', remark: '',
  });
  const [subPreview, setSubPreview] = useState<{ lines: number; locations: number; bookQty: number } | null>(null);

  // 主盘点单：确认盈亏
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmRemark, setConfirmRemark] = useState('');

  const canOperate = ['admin', 'wh_keeper', 'wh_manager'].includes(roleCode);
  const canApprove = ['admin', 'wh_manager'].includes(roleCode);
  const isAdmin = roleCode === 'admin';
  /** 主盘点单：只做子单汇总与盈亏确认，本身不产生明细 */
  const isMain = order?.orderType === 'main';
  const editable = canOperate && !isMain && ['draft', 'rejected'].includes(order?.status || '');
  const canAddSub = canOperate && isMain && ['draft', 'rejected'].includes(order?.status || '');

  const statusLabel = (s: string) =>
    t(`stockTake.status_${s}`) || ({ draft: '盘点中', pending_approval: '待审批', approved: '已批准', rejected: '已驳回', cancelled: '已取消' } as Record<string, string>)[s] || s;
  const diffLabel = (s: string) =>
    t(`stockTake.diff_${s}`) || ({ pending: '未盘点', match: '账实一致', profit: '盘盈', loss: '盘亏' } as Record<string, string>)[s] || s;
  const stockStatusLabel = (s: string) =>
    t(`stockTake.stock_${s}`) || ({ good: '良品仓', defective: '不良品仓', rework: '返工仓' } as Record<string, string>)[s] || s;

  const fetchOrder = useCallback(async () => {
    try {
      const res = await stockTakeApi.getStockTakeDetail(id);
      setOrder(res);
      // 主盘点单默认落在「子盘点单」页签；用户已切到报表/日志时不打断
      if (res.orderType === 'main') setActiveTab((prev) => (prev === 'items' ? 'children' : prev));
    } catch (error: any) {
      logger.error('Failed to fetch stock take detail:', String(error));
      toast.error(error?.response?.data?.error?.message || '盘点单不存在');
      navigate('/inventory/stock-take');
    }
  }, [id, navigate]);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await stockTakeApi.getStockTakeItems(id, {
        page, pageSize,
        materialCode: filters.materialCode || undefined,
        materialName: filters.materialName || undefined,
        supplier: filters.supplier || undefined,
        diffType: filters.diffType || undefined,
        locationCode: filters.locationCode || undefined,
        batchNo: filters.batchNo || undefined,
        onlyDiff: onlyDiff ? 'true' : undefined,
      });
      setItems(res.items || []);
      setTotal(res.total || 0);
    } catch (error) {
      logger.error('Failed to fetch stock take items:', String(error));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [id, page, pageSize, filters, onlyDiff]);

  const fetchReport = useCallback(async () => {
    try { setReport(await stockTakeApi.getStockTakeReport(id)); } catch { /* ignore */ }
  }, [id]);

  const fetchLogs = useCallback(async () => {
    try { setLogs(await stockTakeApi.getStockTakeLogs(id)); } catch { /* ignore */ }
  }, [id]);

  useEffect(() => { fetchOrder(); }, [fetchOrder]);
  useEffect(() => { if (id) fetchItems(); }, [fetchItems, id]);
  useEffect(() => { if (id && (activeTab === 'report' || activeTab === 'logs')) { fetchReport(); fetchLogs(); } }, [activeTab, id, fetchReport, fetchLogs]);

  const refreshAll = () => { fetchOrder(); fetchItems(); if (activeTab === 'report') fetchReport(); if (activeTab === 'logs') fetchLogs(); };

  const handleScan = async () => {
    const code = scanInput.trim();
    if (!code || scanning) return;
    setScanning(true);
    try {
      const res = await stockTakeApi.scanStockTakeLabel(id, code);
      setScanResult(res);
      if (res.success) {
        toast.success(res.message || '扫码成功');
      } else {
        toast.error(res.errorMessage || '扫码失败');
      }
      setScanInput('');
      fetchOrder();
      fetchItems();
    } catch (error: any) {
      const msg = error?.response?.data?.error?.message || '扫码失败';
      setScanResult({ success: false, errorMessage: msg });
      toast.error(msg);
      setScanInput('');
    } finally {
      setScanning(false);
      scanRef.current?.focus();
    }
  };

  const handleAdjust = async () => {
    if (!adjustItem) return;
    const qty = Number(adjustQty);
    if (!Number.isFinite(qty) || qty < 0) {
      toast.error(t('stockTake.qtyInvalid') || '实盘数量必须为不小于 0 的数字');
      return;
    }
    try {
      await stockTakeApi.adjustStockTakeItem(id, adjustItem.id, qty, adjustRemark || undefined);
      toast.success(t('stockTake.adjustSuccess') || '实盘数量已更新');
      setAdjustOpen(false);
      refreshAll();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || '录入失败');
    }
  };

  const handleConfirmMissing = async (record: StockTakeItem) => {
    if (!window.confirm(t('stockTake.confirmMissingHint') || '确认该行实物数量与录入一致？确认后将计入账实差异并标记为已盘点。')) return;
    try {
      await stockTakeApi.confirmStockTakeItem(id, record.id);
      toast.success(t('stockTake.confirmSuccess') || '已确认');
      refreshAll();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || '确认失败');
    }
  };

  const handleSubmit = async () => {
    try {
      const res = await stockTakeApi.submitStockTake(id, submitRemark || undefined);
      toast.success(`${t('stockTake.submitSuccess') || '已提交审批'}（${t('stockTake.profitLines') || '盘盈'} ${res.profitLines} / ${t('stockTake.lossLines') || '盘亏'} ${res.lossLines}）`);
      setSubmitOpen(false);
      refreshAll();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || '提交失败');
    }
  };

  const handleApprove = async (pass: boolean) => {
    const remark = pass
      ? window.prompt(t('stockTake.approvalRemarkPlaceholder') || '审批意见（可选）') || undefined
      : window.prompt(t('stockTake.rejectReasonRequired') || '请填写驳回原因') || undefined;
    if (!pass && !remark) return;
    try {
      await stockTakeApi.approveStockTake(id, pass, remark);
      toast.success(pass ? (t('stockTake.approveSuccess') || '已批准归档') : (t('stockTake.rejectSuccess') || '已驳回'));
      refreshAll();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || '审批失败');
    }
  };

  const handleUnlock = async () => {
    if (!unlockReason.trim()) {
      toast.error(t('stockTake.unlockReasonRequired') || '请填写授权修改原因（留痕可追溯）');
      return;
    }
    try {
      await stockTakeApi.unlockStockTake(id, unlockReason.trim());
      toast.success(t('stockTake.unlockSuccess') || '已授权修改，可重新盘点');
      setUnlockOpen(false);
      refreshAll();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || '授权失败');
    }
  };

  /** 预览子盘点单范围（建单前确认会生成多少行） */
  const handlePreviewScope = async () => {
    if (!order?.warehouseCode) return;
    try {
      const res = await stockTakeApi.previewSubStockTakeScope({
        warehouseCode: order.warehouseCode,
        scope: order.scope,
        areaCode: subForm.areaCode || undefined,
        shelfCode: subForm.shelfCode || undefined,
        layerCode: subForm.layerCode || undefined,
        locationFrom: subForm.locationFrom || undefined,
        locationTo: subForm.locationTo || undefined,
      });
      setSubPreview(res);
    } catch (error: any) {
      setSubPreview(null);
      toast.error(error?.response?.data?.error?.message || '范围预览失败');
    }
  };

  /** 在主盘点单下创建子盘点单 */
  const handleCreateSub = async () => {
    if (!subForm.areaCode && !subForm.shelfCode && !subForm.layerCode && !subForm.locationFrom && !subForm.locationTo) {
      toast.error(t('stockTake.scopeRequired') || '请至少填写区域、货架、层或地址码范围');
      return;
    }
    setSubLoading(true);
    try {
      const created = await stockTakeApi.createSubStockTake(id, {
        areaCode: subForm.areaCode || undefined,
        shelfCode: subForm.shelfCode || undefined,
        layerCode: subForm.layerCode || undefined,
        locationFrom: subForm.locationFrom || undefined,
        locationTo: subForm.locationTo || undefined,
        remark: subForm.remark || undefined,
      });
      toast.success(`${t('stockTake.subCreateSuccess') || '子盘点单已创建'}：${created.takeNo}（${created.totalLines} ${t('stockTake.lines') || '行'}）`);
      setSubOpen(false);
      setSubForm({ areaCode: '', shelfCode: '', layerCode: '', locationFrom: '', locationTo: '', remark: '' });
      setSubPreview(null);
      refreshAll();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || '创建子盘点单失败');
    } finally {
      setSubLoading(false);
    }
  };

  /** 主盘点单确认盈亏 */
  const handleConfirmResult = async () => {
    try {
      await stockTakeApi.confirmStockTakeResult(id, confirmRemark || undefined);
      toast.success(t('stockTake.confirmResultSuccess') || '已确认盈亏，主盘点单归档');
      setConfirmOpen(false);
      setConfirmRemark('');
      refreshAll();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || '确认失败');
    }
  };

  const handleCancel = async () => {
    if (!window.confirm(t('stockTake.cancelConfirm') || '确定取消该盘点单？')) return;
    try {
      await stockTakeApi.cancelStockTake(id);
      toast.success(t('stockTake.cancelSuccess') || '已取消');
      refreshAll();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || '取消失败');
    }
  };

  const exportCsv = (filename: string, rows: Array<Record<string, any>>) => {
    if (!rows.length) { toast.error(t('message.noData') || '暂无数据'); return; }
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(','), ...rows.map((row) =>
      headers.map((h) => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${t('message.exportSuccess') || '导出成功'}：${rows.length} ${t('common.recordUnit') || '条'}`);
  };

  const handleExportItems = async () => {
    // 按当前筛选条件分页拉取全部明细后导出（而非仅当前页）
    const baseParams = {
      materialCode: filters.materialCode || undefined,
      materialName: filters.materialName || undefined,
      supplier: filters.supplier || undefined,
      diffType: filters.diffType || undefined,
      locationCode: filters.locationCode || undefined,
      batchNo: filters.batchNo || undefined,
      onlyDiff: onlyDiff ? 'true' : undefined,
    };
    const all: StockTakeItem[] = [];
    const pageSize = 500;
    let page = 1;
    let expectedTotal = 0;
    try {
      setLoading(true);
      while (true) {
        const res = await stockTakeApi.getStockTakeItems(id, { ...baseParams, page, pageSize });
        const batch = res.items || [];
        all.push(...batch);
        expectedTotal = res.total || 0;
        if (batch.length < pageSize || all.length >= expectedTotal) break;
        page += 1;
      }
    } catch (error) {
      logger.error('Failed to export stock take items:', String(error));
      toast.error(t('stockTake.exportFailed') || '导出失败');
      return;
    } finally {
      setLoading(false);
    }
    if (all.length === 0) { toast.error(t('message.noData') || '暂无数据'); return; }
    exportCsv(`stock_take_${order?.takeNo || 'items'}_${new Date().toISOString().split('T')[0]}.csv`, all.map((r, i) => ({
      [t('common.serialNo') || '序号']: i + 1,
      [t('stockTake.materialCode') || '物料编码']: r.materialCode,
      [t('stockTake.materialName') || '物料名称']: r.materialName || '',
      [t('material.specification') || '规格型号']: r.specification || '',
      [t('stockTake.warehouseCode') || '仓库代码']: r.warehouseCode || '',
      [t('stockTake.supplierCode') || '供应商代码']: r.supplierCode || '',
      [t('stockTake.supplierName') || '供应商名称']: r.supplierName || '',
      [t('stockTake.stockStatus') || '库存状态']: stockStatusLabel(r.stockStatus),
      [t('stockTake.location') || '库位']: r.locationCode || '',
      [t('stockTake.batchNo') || '批次']: r.batchNo || '',
      [t('stockTake.unit') || '单位']: r.unit,
      [t('stockTake.bookQty') || '账面数量']: r.bookQty,
      [t('stockTake.actualQty') || '实盘数量']: r.actualQty,
      [t('stockTake.diffQty') || '差异数量']: r.diffQty,
      [t('stockTake.diffType') || '差异类型']: diffLabel(r.diffType),
      [t('stockTake.scanCount') || '扫描次数']: r.scanCount,
      [t('common.remark') || '备注']: r.remark || '',
    })));
  };

  const handleExportReport = () => {
    if (!report) { toast.error(t('message.noData') || '暂无数据'); return; }
    exportCsv(`stock_take_report_${order?.takeNo || ''}_${new Date().toISOString().split('T')[0]}.csv`,
      (report.diffItems || []).map((r, i) => ({
        [t('common.serialNo') || '序号']: i + 1,
        [t('stockTake.materialCode') || '物料编码']: r.materialCode,
        [t('stockTake.materialName') || '物料名称']: r.materialName || '',
        [t('stockTake.warehouseCode') || '仓库代码']: r.warehouseCode || '',
        [t('stockTake.supplierName') || '供应商名称']: r.supplierName || '',
        [t('stockTake.supplierCode') || '供应商代码']: r.supplierCode || '',
        [t('stockTake.stockStatus') || '库存状态']: stockStatusLabel(r.stockStatus),
        [t('stockTake.location') || '库位']: r.locationCode || '',
        [t('stockTake.batchNo') || '批次']: r.batchNo || '',
        [t('stockTake.bookQty') || '账面数量']: r.bookQty,
        [t('stockTake.actualQty') || '实盘数量']: r.actualQty,
        [t('stockTake.diffQty') || '差异数量']: r.diffQty,
        [t('stockTake.diffType') || '差异类型']: diffLabel(r.diffType),
      })));
  };

  const itemColumns: any[] = [
    // 主盘点单汇总视图：标注该行来自哪张子盘点单
    ...(isMain ? [{
      title: t('stockTake.childOrders') || '子盘点单', dataIndex: 'childTakeNo', width: 140,
      fixed: 'left' as const,
      render: (v: string) => <span className="font-mono text-xs">{v || '-'}</span>,
    }] : []),
    { title: t('stockTake.materialCode') || '物料编码', dataIndex: 'materialCode', width: 135, fixed: 'left' },
    { title: t('stockTake.materialName') || '物料名称', dataIndex: 'materialName', width: 110, render: (v: string) => v || '-' },
    { title: t('material.specification') || '规格型号', dataIndex: 'specification', width: 110, render: (v: string) => v || '-' },
    {
      title: t('stockTake.supplierName') || '供应商', key: 'supplier', width: 100,
      render: (_: any, r: StockTakeItem) => r.supplierName || r.supplierCode || '-',
    },
    { title: t('stockTake.supplierCode') || '供应商代码', dataIndex: 'supplierCode', width: 75, render: (v: string) => v || '-' },
    {
      title: t('stockTake.stockStatus') || '库存状态', dataIndex: 'stockStatus', width: 75,
      render: (v: string) => (
        <Badge variant={v === 'defective' ? 'destructive' : v === 'rework' ? 'secondary' : 'outline'}>
          {stockStatusLabel(v)}
        </Badge>
      ),
    },
    { title: t('stockTake.location') || '库位', dataIndex: 'locationCode', width: 115, render: (v: string) => v || '-' },
    { title: t('stockTake.batchNo') || '批次', dataIndex: 'batchNo', width: 75, render: (v: string) => v || '-' },
    { title: t('stockTake.unit') || '单位', dataIndex: 'unit', width: 60 },
    { title: t('stockTake.bookQty') || '账面数量', dataIndex: 'bookQty', width: 70, align: 'right' },
    {
      title: t('stockTake.actualQty') || '实盘数量', dataIndex: 'actualQty', width: 70, align: 'right',
      render: (v: number, r: StockTakeItem) => r.checked ? v : <span className="text-muted-foreground">-</span>,
    },
    {
      title: t('stockTake.diffQty') || '差异数量', dataIndex: 'diffQty', width: 70, align: 'right',
      render: (v: number, r: StockTakeItem) => {
        if (!r.checked) return <span className="text-muted-foreground">-</span>;
        if (v === 0) return <span className="text-muted-foreground">0</span>;
        return <span className={v > 0 ? 'text-red-600 font-bold' : 'text-amber-600 font-bold'}>{v > 0 ? '+' : ''}{v}</span>;
      },
    },
    {
      title: t('stockTake.diffType') || '差异类型', dataIndex: 'diffType', width: 85,
      render: (v: string) => {
        if (v === 'profit') return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200">{t('stockTake.diff_profit') || '盘盈'}</span>;
        if (v === 'loss') return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">{t('stockTake.diff_loss') || '盘亏'}</span>;
        if (v === 'match') return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">{t('stockTake.diff_match') || '账实一致'}</span>;
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">{t('stockTake.diff_pending') || '未盘点'}</span>;
      },
    },
    {
      title: t('stockTake.scanCount') || '扫描次数', dataIndex: 'scanCount', width: 50, align: 'right',
      render: (v: number, r: StockTakeItem) => (
        <button className="text-primary hover:underline" onClick={() => { setLabelItem(r); setLabelOpen(true); }}>
          {v}{r.scannedLabels?.length ? ` / ${t('stockTake.viewLabels') || '查看标签'}` : ''}
        </button>
      ),
    },
    {
      title: t('common.operation') || '操作', key: 'action', width: 120, fixed: 'right',
      render: (_: any, r: StockTakeItem) => (
        <div className="flex gap-1">
          {editable && (
            <>
              <Button variant="ghost" size="sm" onClick={() => {
                setAdjustItem(r); setAdjustQty(String(r.actualQty)); setAdjustRemark(r.remark || ''); setAdjustOpen(true);
              }}>{t('stockTake.adjust') || '录入实盘'}</Button>
              <Button variant="ghost" size="sm" onClick={() => handleConfirmMissing(r)}>{t('stockTake.confirm') || '确认'}</Button>
            </>
          )}
          {!editable && (
            <Button variant="ghost" size="sm" onClick={() => { setLabelItem(r); setLabelOpen(true); }}>
              {t('stockTake.detail') || '明细'}
            </Button>
          )}
        </div>
      ),
    },
  ];

  const rowClass = (r: StockTakeItem) => {
    if (r.diffType === 'profit') return 'bg-red-50/70';
    if (r.diffType === 'loss') return 'bg-amber-50/70';
    return '';
  };

  return (
    <div className="p-4 space-y-4">
      {/* 头部 */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/inventory/stock-take')}><ArrowLeft size={16} /></Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{order?.takeNo || '-'}</h1>
              {order?.orderType === 'main' && (
                <Badge variant="default">{t('stockTake.typeMain') || '主盘点单'}</Badge>
              )}
              {order?.orderType === 'sub' && (
                <Badge variant="outline">{t('stockTake.typeSub') || '子盘点单'}</Badge>
              )}
              {order && <Badge variant={statusVariant[order.status] || 'secondary'}>{statusLabel(order.status)}</Badge>}
              {order && order.revisionCount > 0 && <Badge variant="outline">{t('stockTake.revision') || '修订'} {order.revisionCount} {t('stockTake.times') || '次'}</Badge>}
              {order?.status === 'approved' && <Badge variant="outline" className="text-green-700 border-green-300">{t('stockTake.archived') || '已归档 · 可追溯'}</Badge>}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {t('stockTake.period') || '盘点期间'}：{order?.periodMonth}　
              {t('stockTake.warehouse') || '仓库'}：
              <span className="text-foreground font-medium">
                {order?.warehouseCode
                  ? `${order.warehouseCode}${order.warehouseName ? ` · ${order.warehouseName}` : ''}`
                  : '-'}
              </span>　
              {t('stockTake.operator') || '盘点人'}：{order?.operatorName || '-'}　
              {t('stockTake.approver') || '审批人'}：{tui(order?.approverName) || '-'}
              {order?.approvalTime ? `（${renderDateTime(order.approvalTime)}）` : ''}
            </p>
            {order?.unlockReason && (
              <p className="text-xs text-amber-700 mt-1">
                {t('stockTake.unlockAuthorized') || '管理员授权修改'}：{order.unlockAuthorizedName} · {renderDateTime(order.unlockAuthorizedAt)} · {order.unlockReason}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <Button variant="outline" onClick={refreshAll}><RefreshCw size={15} className="mr-1" />{t('common.refresh') || '刷新'}</Button>
          {order?.parentId && (
            <Button variant="outline" onClick={() => navigate(`/inventory/stock-take/${order.parentId}`)}>
              <ArrowLeft size={15} className="mr-1" />{t('stockTake.backToMain') || '主盘点单'}
            </Button>
          )}
          {canAddSub && (
            <Button onClick={() => { setSubPreview(null); setSubOpen(true); }}>
              <Plus size={15} className="mr-1" />{t('stockTake.newSubOrder') || '新建子盘点单'}
            </Button>
          )}
          {isMain && order?.status === 'draft' && canApprove && (
            <Button className="bg-green-600 hover:bg-green-700"
              onClick={() => { setConfirmRemark(''); setConfirmOpen(true); }}>
              <Check size={15} className="mr-1" />{t('stockTake.confirmResult') || '确认盈亏'}
            </Button>
          )}
          {editable && (
            <Button onClick={() => { setSubmitRemark(''); setSubmitOpen(true); }}>
              <Send size={15} className="mr-1" />{t('stockTake.submit') || '提交审批'}
            </Button>
          )}
          {canApprove && order?.status === 'pending_approval' && (
            <>
              <Button className="bg-green-600 hover:bg-green-700" onClick={() => handleApprove(true)}>
                <Check size={15} className="mr-1" />{t('stockTake.approve') || '批准'}
              </Button>
              <Button variant="outline" className="text-destructive" onClick={() => handleApprove(false)}>
                <X size={15} className="mr-1" />{t('stockTake.reject') || '驳回'}
              </Button>
            </>
          )}
          {isAdmin && order?.status === 'approved' && (
            <Button variant="outline" className="text-amber-600 border-amber-300"
              onClick={() => { setUnlockReason(''); setUnlockOpen(true); }}>
              <LockOpen size={15} className="mr-1" />{t('stockTake.unlock') || '授权修改'}
            </Button>
          )}
          {(editable || (isMain && canOperate && order?.status === 'draft')) && (
            <Button variant="outline" className="text-destructive" onClick={handleCancel}>
              <Ban size={15} className="mr-1" />{t('common.cancel') || '取消'}
            </Button>
          )}
        </div>
      </div>

      {/* 汇总卡片 */}
      {order && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {[
            { label: t('stockTake.totalLines') || '应盘行数', value: order.totalLines, color: '' },
            { label: t('stockTake.checkedLines') || '已盘行数', value: `${order.checkedLines}`, color: '' },
            { label: t('stockTake.matchLines') || '账实一致', value: order.matchLines, color: 'text-green-600' },
            { label: t('stockTake.profitLines') || '盘盈行数', value: order.profitLines, color: 'text-red-600' },
            { label: t('stockTake.lossLines') || '盘亏行数', value: order.lossLines, color: 'text-amber-600' },
            {
              label: t('stockTake.diffQtyTotal') || '差异数量合计',
              value: `${order.diffQtyTotal > 0 ? '+' : ''}${order.diffQtyTotal}`,
              color: order.diffQtyTotal > 0 ? 'text-red-600' : order.diffQtyTotal < 0 ? 'text-amber-600' : '',
            },
          ].map((c) => (
            <div key={c.label} className="border rounded-lg p-3 bg-card">
              <div className="text-xs text-muted-foreground">{c.label}</div>
              <div className={`text-xl font-semibold mt-1 ${c.color}`}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* 扫码区 */}
      {editable && (
        <div className="border rounded-lg p-4 bg-muted/20 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ScanLine size={16} />{t('stockTake.scanTitle') || '逐箱扫描物料标签'}
            <span className="text-xs text-muted-foreground font-normal">
              {t('stockTake.scanHint') || '标签格式：供应商*料号*生产日期*数量*批次*流水号；扫描后系统自动核算账实是否一致'}
              {order?.warehouseCode
                ? `　|　${t('stockTake.scanWhHint') || '本盘点单仅限以下仓库'}：${order.warehouseCode} ${order.warehouseName || ''}`
                : ''}
            </span>
          </div>
          <div className="flex gap-2">
            <Input
              ref={scanRef}
              autoFocus
              className="max-w-xl font-mono"
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleScan(); } }}
              placeholder={t('stockTake.scanPlaceholder') || '请扫描或手工输入物料标签（回车确认）'}
            />
            <Button onClick={handleScan} disabled={scanning || !scanInput.trim()}>
              <ScanLine size={15} className="mr-1" />{scanning ? (t('common.processing') || '处理中...') : (t('stockTake.scan') || '扫码')}
            </Button>
          </div>
          {scanResult && (
            <div className={`text-sm rounded-md px-3 py-2 ${scanResult.success
              ? (scanResult.isProfit || (scanResult.item?.diffQty ?? 0) !== 0 ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-green-50 text-green-800 border border-green-200')
              : 'bg-red-50 text-red-700 border border-red-200'}`}>
              {scanResult.success ? (
                <span>
                  {scanResult.message}
                  {scanResult.item && (
                    <span className="ml-2 text-xs">
                      {scanResult.item.materialCode} / {scanResult.item.batchNo} / {t('stockTake.bookQty') || '账面'} {scanResult.item.bookQty} → {t('stockTake.actualQty') || '实盘'} {scanResult.item.actualQty}
                    </span>
                  )}
                </span>
              ) : scanResult.errorMessage}
            </div>
          )}
        </div>
      )}

      {/* 明细 / 报表 / 日志 */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          {isMain && (
            <TabsTrigger value="children">
              <GitBranch size={14} className="mr-1" />{t('stockTake.childOrders') || '子盘点单'}
              {order?.children?.length ? ` (${order.children.length})` : ''}
            </TabsTrigger>
          )}
          <TabsTrigger value="items"><ClipboardList size={14} className="mr-1" />{isMain ? (t('stockTake.summaryCompare') || '汇总对比') : (t('stockTake.tabItems') || '盘点明细')}</TabsTrigger>
          <TabsTrigger value="report">{t('stockTake.tabReport') || '盘点报表'}</TabsTrigger>
          <TabsTrigger value="logs">{t('stockTake.tabLogs') || '操作日志'}</TabsTrigger>
        </TabsList>

        {isMain && (
          <TabsContent value="children" className="space-y-3 mt-3">
            <div className="text-xs text-muted-foreground">
              {t('stockTake.subOrderHint')
                || '主盘点单不直接盘点：按区域 / 地址码范围拆分成子盘点单，仓管员或主管在子单扫码或录入实盘数，全部子单提交后回到本页确认盈亏。'}
            </div>
            {(!order?.children || order.children.length === 0) ? (
              <div className="border rounded-lg p-8 text-center text-sm text-muted-foreground">
                {t('stockTake.noChildOrders') || '还没有子盘点单，点击右上角「新建子盘点单」按库位范围拆分'}
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-2">{t('stockTake.takeNo') || '盘点单号'}</th>
                      <th className="text-left px-3 py-2">{t('stockTake.subScope') || '盘点范围'}</th>
                      <th className="text-center px-3 py-2">{t('stockTake.status') || '状态'}</th>
                      <th className="text-right px-3 py-2">{t('stockTake.progress') || '进度'}</th>
                      <th className="text-right px-3 py-2">{t('stockTake.profitLines') || '盘盈'}</th>
                      <th className="text-right px-3 py-2">{t('stockTake.lossLines') || '盘亏'}</th>
                      <th className="text-right px-3 py-2">{t('stockTake.diffQtyTotal') || '差异数量'}</th>
                      <th className="text-center px-3 py-2">{t('common.action') || '操作'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.children.map((c) => (
                      <tr key={c.id} className="border-t hover:bg-muted/30">
                        <td className="px-3 py-2 font-mono text-xs">{c.takeNo}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {[c.scopeArea ? `${t('stockTake.area') || '区域'} ${c.scopeArea}` : '',
                            c.scopeShelf ? `${t('stockTake.shelf') || '货架'} ${c.scopeShelf}` : '',
                            c.scopeLayer ? `${t('stockTake.layer') || '层'} ${c.scopeLayer}` : '',
                            (c.scopeLocFrom || c.scopeLocTo)
                              ? `${c.scopeLocFrom || '*'} ~ ${c.scopeLocTo || '*'}` : '']
                            .filter(Boolean).join(' / ') || '-'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Badge variant={statusVariant[c.status] || 'secondary'}>{statusLabel(c.status)}</Badge>
                        </td>
                        <td className="px-3 py-2 text-right">{c.checkedLines}/{c.totalLines}</td>
                        <td className="px-3 py-2 text-right text-red-600">{c.profitLines}</td>
                        <td className="px-3 py-2 text-right text-amber-600">{c.lossLines}</td>
                        <td className="px-3 py-2 text-right">{c.diffQtyTotal > 0 ? '+' : ''}{c.diffQtyTotal}</td>
                        <td className="px-3 py-2 text-center">
                          <Button variant="link" size="sm" className="h-auto p-0"
                            onClick={() => navigate(`/inventory/stock-take/${c.id}`)}>
                            {t('stockTake.openCount') || '进入盘点'}<ExternalLink size={12} className="ml-1" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        )}

        <TabsContent value="items" className="space-y-3 mt-3">
          <div className="flex flex-wrap gap-3 items-end p-3 border rounded-lg bg-muted/30">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t('stockTake.materialCode') || '物料编码'}</label>
              <Input className="w-44" value={filters.materialCode}
                onChange={(e) => setFilters({ ...filters, materialCode: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t('stockTake.materialName') || '物料名称'}</label>
              <Input className="w-40" value={filters.materialName}
                onChange={(e) => setFilters({ ...filters, materialName: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t('stockTake.supplierSearch') || '供应商名称/代码'}</label>
              <Input className="w-48" value={filters.supplier}
                onChange={(e) => setFilters({ ...filters, supplier: e.target.value })}
                placeholder={t('stockTake.supplierPlaceholder') || '如：华港 / E.017'} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t('stockTake.diffType') || '差异类型'}</label>
              <Select value={filters.diffType || 'all'}
                onValueChange={(v) => setFilters({ ...filters, diffType: v === 'all' ? '' : v })}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('common.all') || '全部'}</SelectItem>
                  <SelectItem value="profit">{t('stockTake.diff_profit') || '盘盈'}</SelectItem>
                  <SelectItem value="loss">{t('stockTake.diff_loss') || '盘亏'}</SelectItem>
                  <SelectItem value="match">{t('stockTake.diff_match') || '账实一致'}</SelectItem>
                  <SelectItem value="pending">{t('stockTake.diff_pending') || '未盘点'}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t('stockTake.location') || '库位'}</label>
              <Input className="w-40" value={filters.locationCode}
                onChange={(e) => setFilters({ ...filters, locationCode: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t('stockTake.batchNo') || '批次'}</label>
              <Input className="w-28" value={filters.batchNo}
                onChange={(e) => setFilters({ ...filters, batchNo: e.target.value })} />
            </div>
            <Button variant={onlyDiff ? 'default' : 'outline'} onClick={() => { setOnlyDiff(!onlyDiff); setPage(1); }}>
              {onlyDiff ? (t('stockTake.showAll') || '显示全部') : (t('stockTake.onlyDiff') || '只看盘盈盘亏')}
            </Button>
            <Button onClick={() => { setPage(1); fetchItems(); }}>{t('common.search') || '查询'}</Button>
            <Button variant="outline" onClick={() => {
              setFilters({ materialCode: '', materialName: '', supplier: '', diffType: '', locationCode: '', batchNo: '' });
              setOnlyDiff(false); setPage(1);
            }}>{t('common.reset') || '重置'}</Button>
            <Button variant="outline" onClick={handleExportItems}><Download size={15} className="mr-1" />{t('stockTake.exportItems') || '导出明细'}</Button>
          </div>

          <ResizableTable<StockTakeItem>
            columns={itemColumns}
            dataSource={items}
            loading={loading}
            rowKey="id"
            rowClassName={rowClass}
            pagination={{
              current: page,
              pageSize,
              total,
              onChange: (p: number) => setPage(p),
              showTotal: (t2: number) => `${t('common.total') || '共'} ${t2} ${t('common.recordUnit') || '条'}`,
            }}
          />
        </TabsContent>

        <TabsContent value="report" className="space-y-4 mt-3">
          <div className="flex justify-between items-center">
            <div className="text-sm text-muted-foreground">
              {t('stockTake.reportHint') || '报表按仓库、供应商汇总账实差异；盘盈（实物多于账面）与盘亏（账有实无）重点标识。'}
            </div>
            <Button variant="outline" onClick={handleExportReport}><Download size={15} className="mr-1" />{t('stockTake.exportReport') || '导出报表'}</Button>
          </div>

          {order && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="border rounded-lg p-3 bg-card">
                <div className="text-xs text-muted-foreground">{t('stockTake.bookQtyTotal') || '账面数量'}</div>
                <div className="text-lg font-semibold mt-1">{order.bookQtyTotal}</div>
              </div>
              <div className="border rounded-lg p-3 bg-card">
                <div className="text-xs text-muted-foreground">{t('stockTake.actualQtyTotal') || '实盘数量'}</div>
                <div className="text-lg font-semibold mt-1">{order.actualQtyTotal}</div>
              </div>
              <div className="border rounded-lg p-3 bg-card">
                <div className="text-xs text-muted-foreground">{t('stockTake.diffQtyTotal') || '差异数量'}</div>
                <div className={`text-lg font-semibold mt-1 ${order.diffQtyTotal > 0 ? 'text-red-600' : order.diffQtyTotal < 0 ? 'text-amber-600' : ''}`}>
                  {order.diffQtyTotal > 0 ? '+' : ''}{order.diffQtyTotal}
                </div>
              </div>
              <div className="border rounded-lg p-3 bg-card">
                <div className="text-xs text-muted-foreground">{t('stockTake.diffRate') || '差异率'}</div>
                <div className="text-lg font-semibold mt-1">
                  {order.bookQtyTotal > 0 ? `${((order.diffQtyTotal / order.bookQtyTotal) * 100).toFixed(2)}%` : '--'}
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="border rounded-lg p-3">
              <div className="font-medium mb-2">{t('stockTake.byWarehouse') || '按仓库/库存状态汇总'}</div>
              <ResizableTable
                columns={[
                  { title: t('stockTake.warehouseCode') || '仓库代码', dataIndex: 'warehouseCode', render: (v: string) => v || '-' },
                  { title: t('stockTake.stockStatus') || '库存状态', dataIndex: 'stockStatus', render: (v: string) => stockStatusLabel(v) },
                  { title: t('stockTake.warehouse') || '仓库', dataIndex: 'warehouseName', render: (v: string) => v || '-' },
                  { title: t('stockTake.lines') || '行数', dataIndex: 'lines', align: 'right' },
                  { title: t('stockTake.profitLines') || '盘盈', dataIndex: 'profitLines', align: 'right', render: (v: number) => v > 0 ? <span className="text-red-600 font-semibold">{v}</span> : 0 },
                  { title: t('stockTake.lossLines') || '盘亏', dataIndex: 'lossLines', align: 'right', render: (v: number) => v > 0 ? <span className="text-amber-600 font-semibold">{v}</span> : 0 },
                  { title: t('stockTake.diffQty') || '差异数量', dataIndex: 'diffQty', align: 'right', render: (v: number) => <span className={v > 0 ? 'text-red-600 font-semibold' : v < 0 ? 'text-amber-600 font-semibold' : ''}>{v > 0 ? '+' : ''}{v}</span> },
                ]}
                dataSource={report?.byWarehouse || []}
                rowKey={(r: any) => `${r.stockStatus}-${r.warehouseCode || ''}-${r.warehouseName || ''}`}
                size="small"
                pagination={false}
              />
            </div>
            <div className="border rounded-lg p-3">
              <div className="font-medium mb-2">{t('stockTake.bySupplier') || '按供应商汇总'}</div>
              <ResizableTable
                columns={[
                  { title: t('stockTake.supplierCode') || '供应商代码', dataIndex: 'supplierCode', render: (v: string) => v || '-' },
                  { title: t('stockTake.supplierName') || '供应商名称', dataIndex: 'supplierName', render: (v: string) => v || '-' },
                  { title: t('stockTake.lines') || '行数', dataIndex: 'lines', align: 'right' },
                  { title: t('stockTake.profitLines') || '盘盈', dataIndex: 'profitLines', align: 'right', render: (v: number) => v > 0 ? <span className="text-red-600 font-semibold">{v}</span> : 0 },
                  { title: t('stockTake.lossLines') || '盘亏', dataIndex: 'lossLines', align: 'right', render: (v: number) => v > 0 ? <span className="text-amber-600 font-semibold">{v}</span> : 0 },
                  { title: t('stockTake.diffQty') || '差异数量', dataIndex: 'diffQty', align: 'right', render: (v: number) => <span className={v > 0 ? 'text-red-600 font-semibold' : v < 0 ? 'text-amber-600 font-semibold' : ''}>{v > 0 ? '+' : ''}{v}</span> },
                ]}
                dataSource={report?.bySupplier || []}
                rowKey={(r: any) => `${r.supplierCode || r.supplierName || Math.random()}`}
                size="small"
                pagination={{ pageSize: 8, showTotal: (t2: number) => `${t('common.total') || '共'} ${t2} ${t('common.recordUnit') || '条'}` }}
              />
            </div>
          </div>

          <div className="border-2 border-red-200 rounded-lg p-3 bg-red-50/30">
            <div className="font-medium mb-2 text-red-700">
              {t('stockTake.diffFocus') || '盘点差异重点清单（盘盈 / 盘亏）'}（{report?.diffItems?.length || 0}）
            </div>
            <ResizableTable
              columns={[
                {
                  title: t('stockTake.diffType') || '差异类型', dataIndex: 'diffType', width: 100,
                  render: (v: string) => v === 'profit'
                    ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700 border border-red-300">{t('stockTake.diff_profit') || '盘盈'}</span>
                    : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">{t('stockTake.diff_loss') || '盘亏'}</span>,
                },
                { title: t('stockTake.materialCode') || '物料编码', dataIndex: 'materialCode', width: 160 },
                { title: t('stockTake.materialName') || '物料名称', dataIndex: 'materialName', width: 150, render: (v: string) => v || '-' },
                { title: t('stockTake.supplierName') || '供应商', key: 'sup', width: 160, render: (_: any, r: StockTakeItem) => r.supplierName || r.supplierCode || '-' },
                { title: t('stockTake.stockStatus') || '库存状态', dataIndex: 'stockStatus', width: 100, render: (v: string) => stockStatusLabel(v) },
                { title: t('stockTake.location') || '库位', dataIndex: 'locationCode', width: 140, render: (v: string) => v || '-' },
                { title: t('stockTake.batchNo') || '批次', dataIndex: 'batchNo', width: 90, render: (v: string) => v || '-' },
                { title: t('stockTake.bookQty') || '账面数量', dataIndex: 'bookQty', width: 100, align: 'right' },
                { title: t('stockTake.actualQty') || '实盘数量', dataIndex: 'actualQty', width: 100, align: 'right' },
                {
                  title: t('stockTake.diffQty') || '差异数量', dataIndex: 'diffQty', width: 120, align: 'right',
                  render: (v: number) => <span className={`font-bold ${v > 0 ? 'text-red-600' : 'text-amber-600'}`}>{v > 0 ? '+' : ''}{v}</span>,
                },
                { title: t('stockTake.scanCount') || '扫描次数', dataIndex: 'scanCount', width: 90, align: 'right' },
              ]}
              dataSource={report?.diffItems || []}
              rowKey="id"
              size="small"
              rowClassName={(r: any) => r.diffType === 'profit' ? 'bg-red-50/70' : 'bg-amber-50/70'}
              scroll={{ x: 1400 }}
              pagination={{ pageSize: 10, showTotal: (t2: number) => `${t('common.total') || '共'} ${t2} ${t('common.recordUnit') || '条'}` }}
            />
          </div>

          {order?.status === 'approved' && (
            <div className="border rounded-lg p-3 bg-green-50/40 text-sm space-y-1">
              <div className="font-medium text-green-800">{t('stockTake.archiveInfo') || '归档与追溯信息'}</div>
              <div>{t('stockTake.approver') || '审批人'}：{tui(order.approverName) || '-'} · {renderDateTime(order.approvalTime)}</div>
              <div>{t('stockTake.approvalRemark') || '审批意见'}：{order.approvalRemark || '-'}</div>
              {order.revisionCount > 0 && (
                <div className="text-amber-700">
                  {t('stockTake.unlockAuthorized') || '管理员授权修改'}：{order.unlockAuthorizedName} · {renderDateTime(order.unlockAuthorizedAt)} · {order.unlockReason}（{t('stockTake.revision') || '修订'} {order.revisionCount} {t('stockTake.times') || '次'}）
                </div>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="logs" className="mt-3">
          <ResizableTable<StockTakeLog>
            columns={[
              { title: t('stockTake.logTime') || '时间', dataIndex: 'createdAt', width: 170, render: (v: string) => renderDateTime(v) },
              {
                title: t('stockTake.logAction') || '操作', dataIndex: 'action', width: 130,
                render: (v: string) => ({
                  create: t('stockTake.action_create') || '创建盘点单',
                  scan: t('stockTake.action_scan') || '扫码盘点',
                  adjust: t('stockTake.action_adjust') || '手工录入',
                  confirm_missing: t('stockTake.action_confirm_missing') || '确认数量',
                  submit: t('stockTake.action_submit') || '提交审批',
                  approve: t('stockTake.action_approve') || '批准',
                  reject: t('stockTake.action_reject') || '驳回',
                  unlock: t('stockTake.action_unlock') || '授权修改',
                  cancel: t('stockTake.action_cancel') || '取消',
                } as Record<string, string>)[v] || v,
              },
              { title: t('stockTake.logDetail') || '详情', dataIndex: 'detail', render: (v: string) => v || '-' },
              { title: t('stockTake.logOperator') || '操作人', dataIndex: 'operatorName', width: 120, render: (v: string) => v || '-' },
            ]}
            dataSource={logs}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 20, showTotal: (t2: number) => `${t('common.total') || '共'} ${t2} ${t('common.recordUnit') || '条'}` }}
          />
        </TabsContent>
      </Tabs>

      {/* 手工录入实盘 */}
      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t('stockTake.adjustTitle') || '录入实盘数量'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {adjustItem && (
              <div className="text-sm bg-muted/40 rounded-md p-3 space-y-1">
                <div>{adjustItem.materialCode} {adjustItem.materialName}</div>
                <div className="text-muted-foreground">
                  {t('stockTake.supplierName') || '供应商'}：{adjustItem.supplierName || '-'}　
                  {t('stockTake.location') || '库位'}：{adjustItem.locationCode || '-'}　
                  {t('stockTake.batchNo') || '批次'}：{adjustItem.batchNo || '-'}
                </div>
                <div>{t('stockTake.bookQty') || '账面数量'}：<span className="font-semibold">{adjustItem.bookQty}</span> {adjustItem.unit}</div>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('stockTake.actualQty') || '实盘数量'} *</label>
              <Input type="number" min={0} value={adjustQty} onChange={(e) => setAdjustQty(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('common.remark') || '备注'}</label>
              <Textarea rows={2} value={adjustRemark} onChange={(e) => setAdjustRemark(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustOpen(false)}>{t('common.cancel') || '取消'}</Button>
            <Button onClick={handleAdjust}>{t('common.confirm') || '确定'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 标签明细 */}
      <Dialog open={labelOpen} onOpenChange={setLabelOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t('stockTake.scannedLabels') || '已扫描标签明细'}</DialogTitle></DialogHeader>
          {labelItem && (
            <div className="space-y-3 text-sm">
              <div className="bg-muted/40 rounded-md p-3">
                <div>{labelItem.materialCode} {labelItem.materialName}</div>
                <div className="text-muted-foreground">
                  {t('stockTake.supplierName') || '供应商'}：{labelItem.supplierName || '-'}　
                  {t('stockTake.location') || '库位'}：{labelItem.locationCode || '-'}　
                  {t('stockTake.batchNo') || '批次'}：{labelItem.batchNo || '-'}
                </div>
                <div className="mt-1">
                  {t('stockTake.bookQty') || '账面'} {labelItem.bookQty} / {t('stockTake.actualQty') || '实盘'} {labelItem.actualQty} / {t('stockTake.diffQty') || '差异'}
                  <span className={labelItem.diffQty > 0 ? 'text-red-600 font-semibold' : labelItem.diffQty < 0 ? 'text-amber-600 font-semibold' : ''}>
                    {' '}{labelItem.diffQty > 0 ? '+' : ''}{labelItem.diffQty}
                  </span>
                </div>
              </div>
              <ResizableTable
                columns={[
                  { title: t('stockTake.label') || '标签（六段码）', dataIndex: 'labelNo', width: 320 },
                  { title: t('stockTake.qty') || '数量', dataIndex: 'qty', width: 80, align: 'right' },
                  { title: t('stockTake.scanTime') || '扫描时间', dataIndex: 'scanTime', width: 160, render: (v: string) => renderDateTime(v) },
                  { title: t('stockTake.logOperator') || '操作人', dataIndex: 'operatorName', width: 100, render: (v: string) => v || '-' },
                ]}
                dataSource={labelItem.scannedLabels || []}
                rowKey={(r: any, i?: number) => `${r.labelNo}-${i}`}
                size="small"
                pagination={false}
              />
              {(!labelItem.scannedLabels || labelItem.scannedLabels.length === 0) && (
                <div className="text-muted-foreground text-center py-4">{t('stockTake.noScannedLabels') || '该行由手工录入/确认，无扫描标签'}</div>
              )}
              <div className="text-xs text-muted-foreground">
                {t('stockTake.productionDate') || '生产日期'}：{labelItem.productionDate ? renderDate(labelItem.productionDate) : '-'}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 提交审批 */}
      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t('stockTake.submit') || '提交审批'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t('stockTake.submitHint') || '提交后交仓库主管审批；未扫描的账面行将按「盘亏（账有实无）」计入差异。提交后不可修改，如需修改须由系统管理员授权。'}
            </p>
            {order && (
              <div className="text-sm bg-muted/40 rounded-md p-3">
                {t('stockTake.totalLines') || '应盘行数'}：{order.totalLines}　
                {t('stockTake.checkedLines') || '已盘'}：{order.checkedLines}　
                {t('stockTake.profitLines') || '盘盈'}：<span className="text-red-600 font-semibold">{order.profitLines}</span>　
                {t('stockTake.lossLines') || '盘亏'}：<span className="text-amber-600 font-semibold">{order.lossLines}</span>
                {order.checkedLines < order.totalLines && (
                  <div className="text-amber-700 mt-1">
                    {t('stockTake.notAllChecked') || '尚有未盘点行'}：{order.totalLines - order.checkedLines} {t('stockTake.lines') || '行'}（提交后按盘亏处理）
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('common.remark') || '备注'}</label>
              <Textarea rows={2} value={submitRemark} onChange={(e) => setSubmitRemark(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubmitOpen(false)}>{t('common.cancel') || '取消'}</Button>
            <Button onClick={handleSubmit}>{t('stockTake.confirmSubmit') || '确认提交'}</Button>
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

      {/* 新建子盘点单（按库位范围拆分） */}
      <Dialog open={subOpen} onOpenChange={setSubOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('stockTake.newSubOrder') || '新建子盘点单'}{order ? ` - ${order.takeNo}` : ''}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t('stockTake.subOrderDialogHint')
                || '按「区域 + 地址码范围」拆分：子单只包含落在该范围内的库存行，同一库存行不会被两张子单重复盘点。留空的项表示不限制。'}
            </p>
            <div className="text-xs bg-muted/40 rounded-md px-3 py-2">
              {t('stockTake.warehouseCode') || '仓库代码'}：
              <span className="font-medium ml-1">{order?.warehouseCode} {order?.warehouseName || ''}</span>
              <span className="text-muted-foreground ml-3">
                {t('stockTake.period') || '盘点期间'}：{order?.periodMonth}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-sm text-muted-foreground">{t('stockTake.area') || '区域编码'}</label>
                <Input value={subForm.areaCode}
                  placeholder={t('stockTake.areaPlaceholder') || '如：A（留空=不限）'}
                  onChange={(e) => { setSubForm({ ...subForm, areaCode: e.target.value }); setSubPreview(null); }} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-muted-foreground">{t('stockTake.shelf') || '货架编码'}</label>
                <Input value={subForm.shelfCode}
                  placeholder={t('stockTake.optional') || '留空=不限'}
                  onChange={(e) => { setSubForm({ ...subForm, shelfCode: e.target.value }); setSubPreview(null); }} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-muted-foreground">{t('stockTake.layer') || '层编码'}</label>
                <Input value={subForm.layerCode}
                  placeholder={t('stockTake.optional') || '留空=不限'}
                  onChange={(e) => { setSubForm({ ...subForm, layerCode: e.target.value }); setSubPreview(null); }} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-muted-foreground">{t('stockTake.locFrom') || '起始地址码'}</label>
                <Input value={subForm.locationFrom}
                  placeholder="如：002-A-0-1"
                  onChange={(e) => { setSubForm({ ...subForm, locationFrom: e.target.value }); setSubPreview(null); }} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-muted-foreground">{t('stockTake.locTo') || '结束地址码'}</label>
                <Input value={subForm.locationTo}
                  placeholder="如：002-A-9-99"
                  onChange={(e) => { setSubForm({ ...subForm, locationTo: e.target.value }); setSubPreview(null); }} />
              </div>
              <div className="flex items-end">
                <Button variant="outline" className="w-full" onClick={handlePreviewScope}>
                  {t('stockTake.previewScope') || '预览范围'}
                </Button>
              </div>
            </div>
            {subPreview && (
              <div className={`text-sm rounded-md px-3 py-2 border ${subPreview.lines > 0
                ? 'bg-blue-50 text-blue-800 border-blue-200'
                : 'bg-red-50 text-red-700 border-red-200'}`}>
                {subPreview.lines > 0
                  ? `${t('stockTake.willGenerate') || '该范围将生成'} ${subPreview.lines} ${t('stockTake.lines') || '行'}，`
                    + `${t('stockTake.coverLocations') || '覆盖库位'} ${subPreview.locations} ${t('stockTake.locationsUnit') || '个'}`
                    + `（${t('stockTake.bookQty') || '账面数量'} ${subPreview.bookQty}）`
                  : (t('stockTake.scopeEmpty') || '该范围没有库存明细，请调整条件')}
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('common.remark') || '备注'}</label>
              <Textarea rows={2} value={subForm.remark} onChange={(e) => setSubForm({ ...subForm, remark: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubOpen(false)}>{t('common.cancel') || '取消'}</Button>
            <Button onClick={handleCreateSub} disabled={subLoading}>
              {subLoading ? (t('common.processing') || '处理中...') : (t('stockTake.createSubOrder') || '创建子盘点单')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 主盘点单确认盈亏 */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t('stockTake.confirmResult') || '确认盈亏'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t('stockTake.confirmResultHint')
                || '确认后主盘点单归档，本期间盘点结论以子单汇总为准：盘盈盘亏行数与差异数量如下，请核对后再确认。'}
            </p>
            {order && (
              <div className="text-sm bg-muted/40 rounded-md p-3 space-y-1">
                <div>{t('stockTake.childOrders') || '子盘点单'}：{order.childCount ?? 0}</div>
                <div>
                  {t('stockTake.totalLines') || '应盘行数'}：{order.totalLines}　
                  {t('stockTake.checkedLines') || '已盘'}：{order.checkedLines}
                </div>
                <div>
                  {t('stockTake.profitLines') || '盘盈'}：<span className="text-red-600 font-semibold">{order.profitLines}</span>　
                  {t('stockTake.lossLines') || '盘亏'}：<span className="text-amber-600 font-semibold">{order.lossLines}</span>　
                  {t('stockTake.diffQtyTotal') || '差异数量'}：{order.diffQtyTotal > 0 ? '+' : ''}{order.diffQtyTotal}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('common.remark') || '备注'}</label>
              <Textarea rows={2} value={confirmRemark} onChange={(e) => setConfirmRemark(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>{t('common.cancel') || '取消'}</Button>
            <Button className="bg-green-600 hover:bg-green-700" onClick={handleConfirmResult}>
              {t('stockTake.confirmResult') || '确认盈亏'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default StockTakeDetail;
