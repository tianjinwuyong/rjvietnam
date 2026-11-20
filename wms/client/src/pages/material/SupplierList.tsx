import React, { useState, useEffect, useCallback } from 'react';
import ResizableTable from '@client/src/components/ui/resizable-table';
import { Table, type TableProps } from '@client/src/compat/antd-table';
import { useI18n } from '@client/src/i18n';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
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
import { Badge } from '@client/src/components/ui/badge';
import { Card, CardContent } from '@client/src/components/ui/card';
import {
  getSupplierList,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  importSuppliers,
  previewSupplierImport,
} from '@client/src/api/material';
import type { Supplier, PaginatedResponse, SupplierImportPreviewResult } from '@shared/api.interface';
import { ImportPreviewPanel } from './ImportPreviewPanel';
import { toast } from 'sonner';
import { Download } from 'lucide-react';
import { showConfirm } from '@client/src/compat';
import { useSearchPagination } from '@client/src/hooks/useSearchPagination';

/** 把选中的文件读成 base64（去掉 dataURL 前缀） */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const SupplierList: React.FC = () => {
  const { t } = useI18n();

  /**
   * 筛选 + 分页统一管理（修复：翻页后筛选查不到 / 查询按钮失灵 / 边打字边请求）
   * 见 client/src/hooks/useSearchPagination.ts
   */
  const query = useSearchPagination<{
    supplierCode: string;
    supplierName: string;
    status: string;
  }>({ supplierCode: '', supplierName: '', status: '' });
  const {
    page, pageSize, params, draft, setDraft, search, reset: resetQuery,
    setPage, refresh, tick, list, total, loading, setList, setTotal, setLoading, onEnterSearch,
  } = query;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<Supplier>>({
    supplierCode: '',
    supplierName: '',
    contactPerson: '',
    contactPhone: '',
    contactEmail: '',
    address: '',
    status: 'active',
  });

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  /** 导入校对结果（null = 还没校对，展示文件选择步骤） */
  const [importPreview, setImportPreview] = useState<SupplierImportPreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applySupplierNameChanges, setApplySupplierNameChanges] = useState(false);
  /** 是否显示已归档供应商（默认隐藏，避免导入不全后以为数据"消失"） */
  const [showArchived, setShowArchived] = useState(false);

  // 批量导出：按当前筛选条件拉取全部页，导出 CSV（带 BOM，Excel 直开）
  const [exporting, setExporting] = useState(false);
  const handleExportAll = async () => {
    setExporting(true);
    try {
      const all: Supplier[] = [];
      const pageSizeEx = 500;
      let pageEx = 1;
      for (;;) {
        const res: PaginatedResponse<Supplier> = await getSupplierList({
          page: pageEx,
          pageSize: pageSizeEx,
          supplierCode: params.supplierCode || undefined,
          supplierName: params.supplierName || undefined,
          status: params.status || undefined,
        });
        all.push(...(res.items || []));
        if (all.length >= (res.total || 0) || (res.items || []).length === 0) break;
        pageEx += 1;
      }
      if (all.length === 0) {
        toast.error(t('message.noData') || '暂无数据');
        return;
      }
      const statusText = (v: string) =>
        v === 'active' ? t('supplier.status_active') : t('supplier.status_inactive');
      const rows = all.map((s, i) => ({
        [t('common.serialNo') || '序号']: i + 1,
        [t('material.supplierCode') || '供应商代码']: s.supplierCode || '',
        [t('material.supplierName') || '供应商名称']: s.supplierName || '',
        [t('material.contactPerson') || '联系人']: s.contactPerson || '',
        [t('material.contactPhone') || '联系电话']: s.contactPhone || '',
        [t('material.contactEmail') || '联系邮箱']: s.contactEmail || '',
        [t('common.status') || '状态']: statusText(s.status),
      }));
      const headers = Object.keys(rows[0]);
      const csv = [
        headers.join(','),
        ...rows.map((r) => headers.map((h) => `"${String((r as any)[h] ?? '').replace(/"/g, '""')}"`).join(',')),
      ].join('\n');
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `suppliers_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${t('message.exportSuccess') || '导出成功'}（${all.length}）`);
    } catch (err) {
      toast.error(t('common.error') || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res: PaginatedResponse<Supplier> = await getSupplierList({
        page,
        pageSize,
        supplierCode: params.supplierCode || undefined,
        supplierName: params.supplierName || undefined,
        status: params.status || undefined,
        includeArchived: showArchived,
      });
      setList(res.items);
      setTotal(res.total);
    } catch (err) {
      toast.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, params, tick, showArchived, t, setList, setTotal, setLoading]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleReset = () => {
    resetQuery();
  };

  const openAddDialog = () => {
    setEditingId(null);
    setFormData({
      supplierCode: '',
      supplierName: '',
      contactPerson: '',
      contactPhone: '',
      contactEmail: '',
      address: '',
      status: 'active',
    });
    setDialogOpen(true);
  };

  const openEditDialog = (record: Supplier) => {
    setEditingId(record.id);
    setFormData({
      supplierCode: record.supplierCode,
      supplierName: record.supplierName,
      contactPerson: record.contactPerson,
      contactPhone: record.contactPhone,
      contactEmail: record.contactEmail,
      address: record.address,
      status: record.status,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.supplierCode || !formData.supplierName) {
      toast.error(t('common.required'));
      return;
    }
    try {
      if (editingId) {
        await updateSupplier(editingId, formData);
      } else {
        await createSupplier(formData as Omit<Supplier, 'id'>);
      }
      toast.success(t('common.success'));
      setDialogOpen(false);
      refresh();
    } catch (err) {
      toast.error(t('common.error'));
    }
  };

  const handleDelete = async (id: string) => {
    if (!await showConfirm(t('common.confirm'))) return;
    try {
      await deleteSupplier(id);
      toast.success(t('common.success'));
      refresh();
    } catch (err) {
      toast.error(t('common.error'));
    }
  };

  const columns: TableProps<Supplier>['columns'] = [
    {
      title: t('material.supplierCode'),
      dataIndex: 'supplierCode',
      width: 140,
      fixed: 'left',
    },
    { title: t('material.supplierName'), dataIndex: 'supplierName', width: 200 },
    { title: t('material.contactPerson'), dataIndex: 'contactPerson', width: 120 },
    { title: t('material.contactPhone'), dataIndex: 'contactPhone', width: 140 },
    { title: t('material.contactEmail'), dataIndex: 'contactEmail', width: 180 },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 100,
        render: (val: string) => (
          <Badge variant={val === 'active' ? 'default' : 'secondary'}>
            {val === 'archived'
              ? '已归档'
              : val === 'active'
                ? t('supplier.status_active')
                : t('supplier.status_inactive')}
          </Badge>
        ),
    },
    {
      title: t('common.operation'),
      key: 'action',
      width: 150,
      fixed: 'right',
      render: (_: any, record: Supplier) => (
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => openEditDialog(record)}>
            {t('common.edit')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => handleDelete(record.id)}>
            {t('common.delete')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-4">
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('material.supplierCode')}</label>
              <Input
                value={draft.supplierCode}
                onChange={(e) => setDraft('supplierCode', e.target.value)}
                onKeyDown={onEnterSearch}
                className="w-44"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('material.supplierName')}</label>
              <Input
                value={draft.supplierName}
                onChange={(e) => setDraft('supplierName', e.target.value)}
                onKeyDown={onEnterSearch}
                className="w-44"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('common.status')}</label>
              <Select value={draft.status} onValueChange={(v) => setDraft('status', v)}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder={t('common.all')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('common.all')}</SelectItem>
                  <SelectItem value="active">{t('common.active')}</SelectItem>
                  <SelectItem value="inactive">{t('common.inactive')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 items-center">
              <Button onClick={search}>{t('common.search')}</Button>
              <Button variant="outline" onClick={handleReset}>
                {t('common.reset')}
              </Button>
              <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer select-none whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                />
                显示已归档
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-foreground">{t('nav.supplierList')}</h2>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleExportAll} disabled={exporting}>
                  <Download size={15} className="mr-1" />
                  {t('material.supplierBatchExport') || '批量导出'}
                </Button>
                <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
                  {t('material.supplierBatchImport')}
                </Button>
                <Button onClick={openAddDialog}>+ {t('common.add')}</Button>
              </div>
            </div>
          <ResizableTable
            rowKey="id"
            columns={columns}
            dataSource={list}
            loading={loading}
            scroll={{ x: 1000, y: 500 }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: false,
              onChange: (p) => setPage(p),
            }}
          />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingId ? t('common.edit') : t('common.add')} {t('nav.supplierList')}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">
                {t('material.supplierCode')} <span className="text-destructive">*</span>
              </label>
              <Input
                value={formData.supplierCode || ''}
                onChange={(e) =>
                  setFormData({ ...formData, supplierCode: e.target.value })
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">
                {t('material.supplierName')} <span className="text-destructive">*</span>
              </label>
              <Input
                value={formData.supplierName || ''}
                onChange={(e) =>
                  setFormData({ ...formData, supplierName: e.target.value })
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('material.contactPerson')}</label>
              <Input
                value={formData.contactPerson || ''}
                onChange={(e) =>
                  setFormData({ ...formData, contactPerson: e.target.value })
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('material.contactPhone')}</label>
              <Input
                value={formData.contactPhone || ''}
                onChange={(e) =>
                  setFormData({ ...formData, contactPhone: e.target.value })
                }
              />
            </div>
            <div className="flex flex-col gap-1 col-span-2">
              <label className="text-sm text-muted-foreground">{t('material.contactEmail')}</label>
              <Input
                value={formData.contactEmail || ''}
                onChange={(e) =>
                  setFormData({ ...formData, contactEmail: e.target.value })
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('common.status')}</label>
              <Select
                value={formData.status || 'active'}
                onValueChange={(val) => setFormData({ ...formData, status: val })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t('common.active')}</SelectItem>
                  <SelectItem value="inactive">{t('common.inactive')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSave}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importDialogOpen}
        onOpenChange={(open) => {
          setImportDialogOpen(open);
          if (!open) {
            setImportPreview(null);
            setImportFile(null);
            setApplySupplierNameChanges(false);
          }
        }}
      >
        <DialogContent className={importPreview ? 'max-w-4xl' : 'max-w-lg'}>
          <DialogHeader>
            <DialogTitle>
              {importPreview ? '导入校对 · 请确认后再导入' : t('material.supplierBatchImport')}
            </DialogTitle>
          </DialogHeader>

          {!importPreview ? (
            <div className="space-y-4 py-2">
              <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md whitespace-pre-line">
                {t('material.supplierImportTip')}
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">
                  {t('material.supplierBatchImport')} Excel / CSV
                </label>
                <Input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setImportFile(file);
                  }}
                />
              </div>
              <div className="text-xs text-muted-foreground">
                供应商代码与供应商名称均为必填。下一步会先与系统现有档案做校对，
                列出「新增 / 更新 / 名称冲突 / 将被归档」，确认无误后才真正写入。
              </div>
            </div>
          ) : (
            <div className="max-h-[65vh] overflow-y-auto py-2 pr-1">
              <ImportPreviewPanel
                kind="supplier"
                preview={importPreview}
                applyNameChanges={applySupplierNameChanges}
                onApplyNameChangesChange={setApplySupplierNameChanges}
              />
            </div>
          )}

          <DialogFooter>
            {!importPreview ? (
              <>
                <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  onClick={async () => {
                    if (!importFile) {
                      toast.error(t('common.required'));
                      return;
                    }
                    setPreviewing(true);
                    try {
                      const base64 = await readFileAsBase64(importFile);
                      const preview = await previewSupplierImport({ fileBase64: base64 });
                      setImportPreview(preview);
                    } catch (err: any) {
                      const msg =
                        err?.response?.data?.error?.message || err?.message || t('common.error');
                      toast.error(msg);
                    } finally {
                      setPreviewing(false);
                    }
                  }}
                  disabled={previewing}
                >
                  {previewing ? '正在校对…' : '开始校对'}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setImportPreview(null)}>
                  返回上一步
                </Button>
                <Button
                  onClick={async () => {
                    if (!importFile) return;
                    setImporting(true);
                    try {
                      const base64 = await readFileAsBase64(importFile);
                      const res = await importSuppliers({
                        fileBase64: base64,
                        applySupplierNameChanges,
                      });
                      const changed = res.nameChanges?.length ?? 0;
                      toast.success(
                        t('material.importSuccess').replace('{count}', String(res.successCount)) +
                          (changed > 0 ? `，其中改名 ${changed} 个供应商` : ''),
                      );
                      setImportDialogOpen(false);
                      setImportPreview(null);
                      setImportFile(null);
                      setApplySupplierNameChanges(false);
                      refresh();
                    } catch (err: any) {
                      const msg =
                        err?.response?.data?.error?.message || err?.message || t('common.error');
                      toast.error(msg);
                    } finally {
                      setImporting(false);
                    }
                  }}
                  disabled={importing}
                >
                  {importing ? t('common.submitting') : '确认导入'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SupplierList;
