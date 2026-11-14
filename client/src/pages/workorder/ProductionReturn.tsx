import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ResizableTable from '@client/src/components/ui/resizable-table';
import { Table, type TableProps } from '@client/src/compat/antd-table';
import { Input } from '@client/src/components/ui/input';
import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import { Card, CardContent } from '@client/src/components/ui/card';
import { Textarea } from '@client/src/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import {
  getProductionReturnList,
  createProductionReturnBatch,
  updateProductionReturn,
  submitProductionReturn,
  deleteProductionReturn,
  previewMaterialRequirement,
  type ProductionReturnItem,
} from '@client/src/api/workorder';
import { getAllMaterials } from '@client/src/api/material';
import MaterialSelect, { type MaterialOption } from '@client/src/components/MaterialSelect';
import type { Material } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { renderDate, formatDateTime } from '@client/src/utils/datetime';
import { toast } from 'sonner';
import { showConfirm } from '@client/src/compat';
import { PRODUCTION_RETURN_STATUS, statusMeta } from '@client/src/constants/business-enums';
import { useI18n, tf, tui } from '../../i18n';

const RETURN_REASONS = ['来料不良', '作业不良', '超期', '其他'];

/** 批量制单的一行：工单号共用，退料原因与物料信息逐行独立 */
interface BatchRow {
  key: string;
  materialId: string;
  /** 用字符串存，允许输入过程中为空（提交时再校验） */
  quantity: string;
  batchNo: string;
  productionDate: string;
  supplierCode: string;
  /** 逐行退料原因（不同料号可能是不同原因）；选「其他」时用 returnReasonCustom */
  returnReason: string;
  returnReasonCustom: string;
}

const todayStr = () => new Date().toISOString().split('T')[0];

const newBatchRow = (productionDate = todayStr(), returnReason = ''): BatchRow => ({
  key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  materialId: '',
  quantity: '',
  batchNo: '',
  productionDate,
  supplierCode: '',
  returnReason,
  returnReasonCustom: '',
});

/** 一行的最终退料原因：选「其他」时取手填文本 */
const resolveRowReason = (row: BatchRow): string =>
  (row.returnReason === '其他' ? row.returnReasonCustom : row.returnReason).trim();


const ProductionReturn: React.FC = () => {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ProductionReturnItem[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);

  const [filters, setFilters] = useState({
    returnNo: '',
    materialCode: '',
    status: '',
    startDate: '',
    endDate: '',
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 工单物料：输入工单号后，物料下拉收窄为该工单 BOM 内的物料
  const [woMaterials, setWoMaterials] = useState<Material[] | null>(null);
  const [woHint, setWoHint] = useState<'idle' | 'loading' | 'ok' | 'empty'>('idle');
  const [woCount, setWoCount] = useState(0);
  const [formData, setFormData] = useState({
    materialId: '',
    quantity: 0 as number,
    productionDate: new Date().toISOString().split('T')[0],
    batchNo: '',
    returnReason: '',
    returnReasonCustom: '',
    workOrderNo: '',
    supplierCode: '',
  });

  // ===== 批量制单（新增时）：工单号共用 + 多行明细（退料原因逐行选） =====
  const [batchWorkOrderNo, setBatchWorkOrderNo] = useState('');
  /** 「一键统一原因」的快捷值：选中后立即套用到所有行，并作为新增行的默认值 */
  const [batchQuickReason, setBatchQuickReason] = useState('');
  const [batchRows, setBatchRows] = useState<BatchRow[]>([newBatchRow()]);

  /** 当前对话框生效的工单号（编辑走单行表单，新增走批量表格） */
  const activeWorkOrderNo = editingId ? formData.workOrderNo : batchWorkOrderNo;

  const fetchData = useCallback(async (p: number = page) => {
    setLoading(true);
    try {
      const res = await getProductionReturnList({
        page: p,
        pageSize,
        returnNo: filters.returnNo || undefined,
        materialCode: filters.materialCode || undefined,
        status: filters.status || undefined,
        startDate: filters.startDate || undefined,
        endDate: filters.endDate || undefined,
      });
      setData(res.items);
      setTotal(res.total);
      setPage(p);
    } catch (error) {
      logger.error('Failed to fetch production return list:', String(error));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filters]);

  useEffect(() => {
    fetchData(1);
  }, []);

  useEffect(() => {
    getAllMaterials().then((list) => setMaterials(list)).catch(() => {});
  }, []);

  // 工单号变化 → 防抖查询该工单的物料清单（按 BOM 带出），据此收窄物料下拉范围
  useEffect(() => {
    const no = activeWorkOrderNo.trim();
    if (!dialogOpen || !no) {
      setWoMaterials(null);
      setWoHint('idle');
      setWoCount(0);
      return;
    }
    setWoHint('loading');
    const timer = setTimeout(async () => {
      try {
        const res = await previewMaterialRequirement({ workOrderNo: no });
        const ids = new Set(res.items.map((i) => i.materialId));
        const picked = materials.filter((m) => ids.has(m.id));
        // 该接口会为 BOM 中缺失的物料自动补建主数据，这些尚未出现在本地列表中，一并补上
        const extra = res.items
          .filter((i) => !picked.some((m) => m.id === i.materialId))
          .map((i) => ({
            id: i.materialId,
            materialCode: i.materialCode,
            materialName: i.materialName,
            unit: i.unit,
          } as Material));
        const merged = [...picked, ...extra];
        setWoMaterials(merged);
        setWoCount(merged.length);
        setWoHint(merged.length ? 'ok' : 'empty');
        // 已选物料若不属于该工单，自动清空，避免把退料记到错误物料上
        setFormData((prev) => (prev.materialId && !ids.has(prev.materialId) ? { ...prev, materialId: '' } : prev));
        setBatchRows((prev) => {
          if (!prev.some((r) => r.materialId && !ids.has(r.materialId))) return prev;
          return prev.map((r) => (r.materialId && !ids.has(r.materialId) ? { ...r, materialId: '' } : r));
        });
      } catch {
        // 工单不存在 / BOM 为空等：回退为全部物料，不打断填写
        setWoMaterials(null);
        setWoHint('empty');
        setWoCount(0);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [activeWorkOrderNo, dialogOpen, materials]);

  const handleSearch = () => fetchData(1);

  const handleReset = () => {
    setFilters({ returnNo: '', materialCode: '', status: '', startDate: '', endDate: '' });
    fetchData(1);
  };

  const resetBatchForm = () => {
    setBatchWorkOrderNo('');
    setBatchQuickReason('');
    setBatchRows([newBatchRow()]);
  };

  const resetForm = () => {
    setFormData({
      materialId: '',
      quantity: 0,
      productionDate: new Date().toISOString().split('T')[0],
      batchNo: '',
      returnReason: '',
      returnReasonCustom: '',
      workOrderNo: '',
      supplierCode: '',
    });
    setEditingId(null);
    resetBatchForm();
  };

  const handleOpenAdd = () => {
    resetForm();
    setDialogOpen(true);
  };

  const handleOpenEdit = (record: ProductionReturnItem) => {
    setEditingId(record.id || null);
    setFormData({
      materialId: record.materialId || '',
      quantity: record.quantity || 0,
      productionDate: record.productionDate || new Date().toISOString().split('T')[0],
      batchNo: record.batchNo || '',
      returnReason: RETURN_REASONS.includes(record.returnReason || '') ? (record.returnReason || '') : '',
      returnReasonCustom: RETURN_REASONS.includes(record.returnReason || '') ? '' : (record.returnReason || ''),
      workOrderNo: record.workOrderNo || '',
      supplierCode: record.supplierCode || '',
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    // 编辑：仍是单行表单（一张单只对应一个料号）
    if (editingId) {
      if (!formData.workOrderNo) {
        toast(t('ui.请输入工单号'));
        return;
      }
      if (!formData.materialId) {
        toast(t('ui.请选择物料'));
        return;
      }
      if (!formData.quantity || formData.quantity <= 0) {
        toast(t('ui.请输入有效数量'));
        return;
      }
      const reason = formData.returnReason === '其他' ? formData.returnReasonCustom : formData.returnReason;
      if (!reason) {
        toast(t('ui.请选择或输入退料原因'));
        return;
      }
      setSubmitting(true);
      try {
        await updateProductionReturn(editingId, {
          materialId: formData.materialId,
          quantity: formData.quantity,
          productionDate: formData.productionDate,
          batchNo: formData.batchNo,
          returnReason: reason,
          workOrderNo: formData.workOrderNo,
          supplierCode: formData.supplierCode.trim() || undefined,
        });
        toast.success(t('message.updateSuccess'));
        setDialogOpen(false);
        resetForm();
        fetchData(page);
      } catch (error: any) {
        toast.error(error?.response?.data?.message || '操作失败');
      } finally {
        setSubmitting(false);
      }
      return;
    }
    await handleBatchSubmit();
  };

  /** 批量制单：工单号共用，退料原因逐行选；逐行校验后一次性提交 */
  const handleBatchSubmit = async () => {
    if (!batchWorkOrderNo.trim()) {
      toast(t('ui.请输入工单号'));
      return;
    }
    // 空行（没选物料也没填数量）直接忽略，避免只加了一行忘了删就卡住提交
    const filled = batchRows.filter((r) => r.materialId || String(r.quantity).trim());
    if (filled.length === 0) {
      toast(t('ui.请至少填写一行退料物料'));
      return;
    }
    for (let i = 0; i < filled.length; i += 1) {
      const row = filled[i];
      if (!row.materialId) {
        toast(tf('ui.第 {n} 行：请选择物料', { n: i + 1 }));
        return;
      }
      const qty = Number(row.quantity);
      if (!qty || qty <= 0) {
        toast(tf('ui.第 {n} 行：请输入有效数量', { n: i + 1 }));
        return;
      }
      if (!resolveRowReason(row)) {
        toast(tf('ui.第 {n} 行：请选择退料原因', { n: i + 1 }));
        return;
      }
    }
    // 同一物料重复行拦在前端，省一次往返（服务端同样会拦）
    const seen = new Set<string>();
    for (let i = 0; i < filled.length; i += 1) {
      if (seen.has(filled[i].materialId)) {
        toast(tf('ui.第 {n} 行：物料重复，请合并为一行', { n: i + 1 }));
        return;
      }
      seen.add(filled[i].materialId);
    }

    setSubmitting(true);
    try {
      const created = await createProductionReturnBatch({
        workOrderNo: batchWorkOrderNo.trim(),
        items: filled.map((r) => ({
          materialId: r.materialId,
          quantity: Number(r.quantity),
          productionDate: r.productionDate || undefined,
          batchNo: r.batchNo.trim() || undefined,
          supplierCode: r.supplierCode.trim() || undefined,
          returnReason: resolveRowReason(r),
        })),
      });
      const nos = (created || []).map((c) => c.returnNo).filter(Boolean);
      toast.success(
        tf('ui.已生成 {n} 张退料单：{nos}', { n: created?.length ?? 0, nos: nos.join('、') }),
      );
      setDialogOpen(false);
      resetForm();
      fetchData(page);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitIqc = async (record: ProductionReturnItem) => {
    const ok = await showConfirm(tf('ui.确认提交退料单 {no} 至IQC检验？', { no: record.returnNo }));
    if (!ok) return;
    try {
      await submitProductionReturn(record.id!);
      toast.success(t('ui.已提交IQC'));
      fetchData(page);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || '提交失败');
    }
  };

  const handleDelete = async (record: ProductionReturnItem) => {
    const ok = await showConfirm(tf('ui.确认删除退料单 {no}？删除后不可恢复。', { no: record.returnNo }));
    if (!ok) return;
    try {
      await deleteProductionReturn(record.id!);
      toast.success(t('message.deleteSuccess'));
      fetchData(page);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || '删除失败');
    }
  };

  const statusBadge = (status: string) => {
    const cfg = statusMeta(PRODUCTION_RETURN_STATUS, status, t);
    return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
  };

  const columns: TableProps<ProductionReturnItem>['columns'] = [
    { title: t('ui.退料单号'), dataIndex: 'returnNo', width: 140, fixed: 'left' },
    { title: t('iqc.materialCode'), dataIndex: 'materialCode', width: 110 },
    { title: t('iqc.materialName'), dataIndex: 'materialName', width: 105 },
    { title: t('print.supplier'), dataIndex: 'supplierName', width: 90, render: (v: string) => v || '-' },
    { title: t('pda.mrb.qty'), dataIndex: 'quantity', width: 65, align: 'right' },
    { title: t('iqc.unit'), dataIndex: 'unit', width: 45 },
    { title: t('common.productionDate'), dataIndex: 'productionDate', width: 95, render: renderDate },
    { title: t('iqc.batchNo'), dataIndex: 'batchNo', width: 100 },
    { title: t('ui.退料原因'), dataIndex: 'returnReason', width: 78, render: (v: string) => tui(v) },
    { title: t('common.status'), dataIndex: 'status', width: 78, render: (s: string) => statusBadge(s) },
    { title: t('bom.createTime'), dataIndex: 'createdAt', width: 135, render: (v: string) => formatDateTime(v) },
    {
      title: t('common.action'),
      key: 'action',
      fixed: 'right',
      width: 150,
      render: (_: any, record: ProductionReturnItem) => {
        if (record.status === 'draft') {
          return (
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={() => handleOpenEdit(record)}>{t('common.edit')}</Button>
              <Button size="sm" style={{ backgroundColor: 'var(--primary)' }} onClick={() => handleSubmitIqc(record)}>{t('ui.提交IQC')}</Button>
              <Button size="sm" variant="destructive" onClick={() => handleDelete(record)}>{t('common.delete')}</Button>
            </div>
          );
        }
        return (
          <Button size="sm" variant="outline" onClick={() => handleOpenEdit(record)} disabled>{t('common.view')}</Button>
        );
      },
    },
  ];

  // 物料候选范围：工单号成功带出时用该工单物料，否则用全部物料
  const materialPool = useMemo(() => woMaterials ?? materials, [woMaterials, materials]);

  const materialOptions: MaterialOption[] = useMemo(
    () => materialPool.map((m) => ({ id: m.id, code: m.materialCode, name: m.materialName })),
    [materialPool],
  );

  const selectedMaterial = useMemo(
    () => materialPool.find((m) => m.id === formData.materialId),
    [materialPool, formData.materialId],
  );

  const updateBatchRow = (key: string, patch: Partial<BatchRow>) =>
    setBatchRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  /** 删除一行；只剩一行时改为清空，避免表格消失无法再录入 */
  const removeBatchRow = (key: string) =>
    setBatchRows((prev) => (prev.length <= 1 ? [newBatchRow(prev[0]?.productionDate)] : prev.filter((r) => r.key !== key)));

  /** 有内容待提交的行数（只选了物料或填了数量才算，用于按钮上的张数提示） */
  const filledRowCount = useMemo(
    () => batchRows.filter((r) => r.materialId || String(r.quantity).trim()).length,
    [batchRows],
  );

  /** 一键统一原因：套用到现有所有行，并作为之后新增行的默认值 */
  const applyReasonToAll = (reason: string) => {
    setBatchQuickReason(reason);
    setBatchRows((prev) =>
      prev.map((r) => ({
        ...r,
        returnReason: reason,
        returnReasonCustom: reason === '其他' ? r.returnReasonCustom : '',
      })),
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('ui.退料单号')}</label>
              <Input
                value={filters.returnNo}
                onChange={(e) => setFilters({ ...filters, returnNo: e.target.value })}
                placeholder={t('ui.退料单号')}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('iqc.materialCode')}</label>
              <Input
                value={filters.materialCode}
                onChange={(e) => setFilters({ ...filters, materialCode: e.target.value })}
                placeholder={t('iqc.materialCode')}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('common.status')}</label>
              <Select value={filters.status} onValueChange={(val) => setFilters({ ...filters, status: val })}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('common.all')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('common.all')}</SelectItem>
                  <SelectItem value="draft">{t('workorder.draft')}</SelectItem>
                  <SelectItem value="submitted_iqc">{t('ui.已提交IQC')}</SelectItem>
                  <SelectItem value="iqc_completed">{t('ui.检验完成')}</SelectItem>
                  <SelectItem value="received">{t('ui.已入库')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('common.startDate')}</label>
              <Input type="date" value={filters.startDate} onChange={(e) => setFilters({ ...filters, startDate: e.target.value })} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('common.endDate')}</label>
              <Input type="date" value={filters.endDate} onChange={(e) => setFilters({ ...filters, endDate: e.target.value })} />
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={handleSearch}>{t('common.search')}</Button>
              <Button variant="outline" onClick={handleReset}>{t('common.reset')}</Button>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleOpenAdd}>{t('ui.新增退料单')}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <ResizableTable
            columns={columns}
            dataSource={data}
            loading={loading}
            rowKey="id"
            scroll={{ y: 500 }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: false,
              onChange: (p: number) => setPage(p),
            }}
          />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
        <DialogContent className={editingId ? 'max-w-lg' : 'max-w-6xl'}>
          <DialogHeader>
            <DialogTitle>
              {editingId ? t('ui.编辑退料单') : t('ui.新增退料单（可批量制单）')}
            </DialogTitle>
          </DialogHeader>
          {editingId ? (
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('ui.工单号 *')}</label>
              <Input
                value={formData.workOrderNo}
                onChange={(e) => setFormData({ ...formData, workOrderNo: e.target.value })}
                placeholder={t('overPicking.workOrderNoRequired')}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('ui.物料编码 *')}</label>
              <MaterialSelect
                value={formData.materialId}
                options={materialOptions}
                placeholder={t('ui.选择物料')}
                onChange={(val) => {
                  const mat = materialPool.find((m) => m.id === val);
                  setFormData({
                    ...formData,
                    materialId: val,
                    supplierCode: formData.supplierCode.trim() || mat?.supplierCode || '',
                  });
                }}
              />
              {woHint === 'loading' && (
                <p className="text-xs text-muted-foreground mt-1">{t('common.loading')}</p>
              )}
              {woHint === 'ok' && (
                <p className="text-xs text-muted-foreground mt-1">
                  {tf('ui.已带出该工单物料 {n} 项', { n: woCount })}
                </p>
              )}
              {woHint === 'empty' && (
                <p className="text-xs text-amber-600 mt-1">{t('ui.未匹配到该工单物料，显示全部物料')}</p>
              )}
              {selectedMaterial && (
                <p className="text-xs text-muted-foreground mt-1">
                  {t('material.unit')}: {selectedMaterial.unit}
                </p>
              )}
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('iqc.batchNo')}</label>
              <Input
                value={formData.batchNo}
                onChange={(e) => setFormData({ ...formData, batchNo: e.target.value })}
                placeholder={t('ui.请输入批次号')}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('common.productionDate')}</label>
              <Input
                type="date"
                value={formData.productionDate}
                onChange={(e) => setFormData({ ...formData, productionDate: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('material.supplierCode')}</label>
              <Input
                value={formData.supplierCode}
                onChange={(e) => setFormData({ ...formData, supplierCode: e.target.value })}
                placeholder={t('ui.请输入供应商代码（选物料后自动带出，可修改）')}
              />
              {formData.supplierCode && selectedMaterial?.supplierName && (
                <p className="text-xs text-muted-foreground mt-1">{t('ui.供应商：')}{selectedMaterial.supplierName}</p>
              )}
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('ui.数量 *')}</label>
              <Input
                type="number"
                value={formData.quantity || ''}
                onChange={(e) => setFormData({ ...formData, quantity: Number(e.target.value) })}
                placeholder={t('ui.请输入数量')}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('ui.退料原因 *')}</label>
              <Select value={formData.returnReason} onValueChange={(val) => setFormData({ ...formData, returnReason: val })}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('ui.选择退料原因')} />
                </SelectTrigger>
                <SelectContent>
                  {RETURN_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>{t(`ui.${r}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {formData.returnReason === '其他' && (
                <Input
                  className="mt-2"
                  value={formData.returnReasonCustom}
                  onChange={(e) => setFormData({ ...formData, returnReasonCustom: e.target.value })}
                  placeholder={t('ui.请输入其他原因')}
                />
              )}
            </div>
          </div>
          ) : (
          /* ===== 批量制单：工单号共用，退料原因与物料逐行填，每行生成一张退料单 ===== */
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">{t('ui.工单号 *')}</label>
                <Input
                  value={batchWorkOrderNo}
                  onChange={(e) => setBatchWorkOrderNo(e.target.value)}
                  placeholder={t('overPicking.workOrderNoRequired')}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">{t('ui.一键统一原因')}</label>
                <Select value={batchQuickReason} onValueChange={applyReasonToAll}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t('ui.选一个原因，套用到所有行')} />
                  </SelectTrigger>
                  <SelectContent>
                    {RETURN_REASONS.map((r) => (
                      <SelectItem key={r} value={r}>{t(`ui.${r}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {t('ui.工单号对本批所有行生效；退料原因可逐行选择。每行生成一张退料单，全部成功或全部不生成。')}
              {woHint === 'loading' && <span className="ml-2">{t('common.loading')}</span>}
              {woHint === 'ok' && (
                <span className="ml-2">{tf('ui.已带出该工单物料 {n} 项', { n: woCount })}</span>
              )}
              {woHint === 'empty' && (
                <span className="ml-2 text-amber-600">{t('ui.未匹配到该工单物料，显示全部物料')}</span>
              )}
            </div>
            <div className="rounded-[10px] border border-border overflow-x-auto">
              <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                <thead className="bg-muted/60">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium w-8">#</th>
                    <th className="px-2 py-2 text-left font-medium min-w-[230px]">{t('ui.物料编码 *')}</th>
                    <th className="px-2 py-2 text-left font-medium min-w-[130px]">{t('iqc.batchNo')}</th>
                    <th className="px-2 py-2 text-left font-medium min-w-[145px]">{t('common.productionDate')}</th>
                    <th className="px-2 py-2 text-left font-medium min-w-[125px]">{t('material.supplierCode')}</th>
                    <th className="px-2 py-2 text-left font-medium min-w-[100px]">{t('ui.数量 *')}</th>
                    <th className="px-2 py-2 text-left font-medium min-w-[150px]">{t('ui.退料原因 *')}</th>
                    <th className="px-2 py-2 text-left font-medium w-16">{t('common.operation')}</th>
                  </tr>
                </thead>
                <tbody>
                  {batchRows.map((row, idx) => {
                    const mat = materialPool.find((m) => m.id === row.materialId);
                    return (
                      <tr key={row.key} className="border-t border-border">
                        <td className="px-2 py-2 text-muted-foreground">{idx + 1}</td>
                        <td className="px-2 py-2">
                          <MaterialSelect
                            value={row.materialId}
                            options={materialOptions}
                            placeholder={t('ui.选择物料')}
                            onChange={(val) => {
                              const picked = materialPool.find((m) => m.id === val);
                              updateBatchRow(row.key, {
                                materialId: val,
                                supplierCode: row.supplierCode.trim() || picked?.supplierCode || '',
                              });
                            }}
                          />
                          {mat && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {t('material.unit')}: {mat.unit}
                            </p>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            value={row.batchNo}
                            onChange={(e) => updateBatchRow(row.key, { batchNo: e.target.value })}
                            placeholder={t('ui.请输入批次号')}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            type="date"
                            value={row.productionDate}
                            onChange={(e) => updateBatchRow(row.key, { productionDate: e.target.value })}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            value={row.supplierCode}
                            onChange={(e) => updateBatchRow(row.key, { supplierCode: e.target.value })}
                            placeholder={t('ui.选物料后自动带出')}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            type="number"
                            min={0}
                            value={row.quantity}
                            onChange={(e) => updateBatchRow(row.key, { quantity: e.target.value })}
                            placeholder={t('ui.请输入数量')}
                          />
                        </td>
                        <td className="px-2 py-2">
                          {/* 退料原因逐行选：不同料号可能是不同原因（来料不良 / 作业不良 / 超期…） */}
                          <Select
                            value={row.returnReason}
                            onValueChange={(val) =>
                              updateBatchRow(row.key, {
                                returnReason: val,
                                returnReasonCustom: val === '其他' ? row.returnReasonCustom : '',
                              })
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder={t('ui.选择退料原因')} />
                            </SelectTrigger>
                            <SelectContent>
                              {RETURN_REASONS.map((r) => (
                                <SelectItem key={r} value={r}>{t(`ui.${r}`)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {row.returnReason === '其他' && (
                            <Input
                              className="mt-1"
                              value={row.returnReasonCustom}
                              onChange={(e) => updateBatchRow(row.key, { returnReasonCustom: e.target.value })}
                              placeholder={t('ui.请输入其他原因')}
                            />
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600"
                            onClick={() => removeBatchRow(row.key)}
                          >
                            {t('common.delete')}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                onClick={() =>
                  setBatchRows((prev) => [
                    ...prev,
                    newBatchRow(prev[prev.length - 1]?.productionDate || todayStr(), batchQuickReason),
                  ])
                }
              >
                + {t('ui.添加一行')}
              </Button>
              <span className="text-xs text-muted-foreground">
                {tf('ui.共 {n} 行待生成', { n: filledRowCount })}
              </span>
            </div>
          </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t('pda.cancel')}</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting
                ? t('pda.submitting')
                : editingId
                  ? t('common.save')
                  : tf('ui.保存并生成 {n} 张退料单', { n: filledRowCount })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProductionReturn;
