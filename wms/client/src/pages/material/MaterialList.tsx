import React, { useState, useEffect, useCallback } from 'react';
import ResizableTable from '@client/src/components/ui/resizable-table';
import { Table, type TableProps } from '@client/src/compat/antd-table';
import { useI18n, tui } from '@client/src/i18n';
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
  getMaterialList,
  createMaterial,
  updateMaterial,
  deleteMaterial,
  importMaterial,
  previewMaterialImport,
} from '@client/src/api/material';
import type { Material, PaginatedResponse, MaterialImportPreviewResult } from '@shared/api.interface';
import { ImportPreviewPanel } from './ImportPreviewPanel';
import { toast } from 'sonner';
import { showConfirm } from '@client/src/compat';
import { useSearchPagination } from '@client/src/hooks/useSearchPagination';
import { MATERIAL_TYPES } from '@client/src/constants/materialTypes';
import { Download } from 'lucide-react';

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

const MaterialList: React.FC = () => {
  const { t } = useI18n();

  /**
   * 筛选 + 分页统一管理（修复：翻页后筛选查不到 / 查询按钮失灵 / 边打字边请求）
   * 见 client/src/hooks/useSearchPagination.ts
   */
  const query = useSearchPagination<{
    materialCode: string;
    materialName: string;
    materialType: string;
    packagingType: string;
    status: string;
  }>({ materialCode: '', materialName: '', materialType: '', packagingType: '', status: '' });
  const {
    page, pageSize, params, draft, setDraft, search, reset: resetQuery,
    setPage, refresh, tick, list, total, loading, setList, setTotal, setLoading, onEnterSearch,
  } = query;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  /** 导入校对结果（null = 还没校对，展示文件选择步骤） */
  const [importPreview, setImportPreview] = useState<MaterialImportPreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applySupplierNameChanges, setApplySupplierNameChanges] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<Material>>({
    materialCode: '',
    materialName: '',
    specification: '',
    unit: 'PCS',
    materialType: '',
    packagingType: 'normal',
    mslLevel: '不管控',
    vietnamCode: '',
    inspectionStandard: '',
    status: 'active',
    description: '',
    expiryDays: undefined,
    forceScrapDays: undefined,
    unitPrice: 0,
  });

  /**
   * MSL 等级选项（2026-10-18 用户口径：统一成 MSL1~MSL6 这种写法）。
   * 之前「不管控」用的是英文值 no_control，与库里 2476 条「不管控」对不上，
   * 在界面里编辑一次就会把中文值改成英文值，现已统一为中文值。
   */
  const mslOptions = [
    '不管控', 'MSL1', 'MSL2', 'MSL2a', 'MSL3', 'MSL4', 'MSL5', 'MSL5a', 'MSL6',
  ];

  // 物料类型：统一用标准 9 类（与看板/导入口径一致），不再提供 外箱/中箱/中箱蜂巢 等历史细分
  const materialTypeOptions = [...MATERIAL_TYPES];
  // 编辑时确保当前物料类型出现在选项中（避免历史数据类型丢失）
  const typeOptions = Array.from(
    new Set([...materialTypeOptions, ...(formData.materialType ? [formData.materialType] : [])]),
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res: PaginatedResponse<Material> = await getMaterialList({
        page,
        pageSize,
        materialCode: params.materialCode || undefined,
        materialName: params.materialName || undefined,
        materialType: params.materialType || undefined,
        packagingType: params.packagingType || undefined,
        status: params.status || undefined,
      });
      setList(res.items);
      setTotal(res.total);
    } catch (err) {
      toast.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, params, tick, t, setList, setTotal, setLoading]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 批量导出：按当前筛选条件拉取全部页，导出 CSV（含 BOM，Excel 直开）
  const [exporting, setExporting] = useState(false);
  const handleExportAll = async () => {
    setExporting(true);
    try {
      const all: Material[] = [];
      const pageSizeEx = 500;
      let pageEx = 1;
      // 循环拉取，直到取满 total
      for (;;) {
        const res: PaginatedResponse<Material> = await getMaterialList({
          page: pageEx,
          pageSize: pageSizeEx,
          materialCode: params.materialCode || undefined,
          materialName: params.materialName || undefined,
          materialType: params.materialType || undefined,
          packagingType: params.packagingType || undefined,
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
      // 导出即「导入模板」：表头必须与导入别名完全对得上，否则导回去认不出列。
      // 2026-10-23 修复：原来少了「包装类型」，且「效期(天)」不在导入别名里（导回会丢列）。
      const HEADERS = [
        '序号', '物料编码', '物料名称', '规格型号', '物料类型', '包装类型',
        '单位', 'MSL等级', '等级', '有效期天数', '强制报废天数',
        '供应商代码', '供应商名称', '越南编码', '单价', '状态', '描述',
      ];
      const packagingText = (v?: string) => (v === 'reel' ? '盘装料(Reel)' : '普通');
      const statusText = (v: string) => (v === 'active' ? '启用' : '停用');
      const dataRows = all.map((m, i) => [
        i + 1,
        m.materialCode || '',
        m.materialName || '',
        m.specification || '',
        m.materialType || '',
        packagingText((m as any).packagingType),
        m.unit || '',
        m.mslLevel || '',
        (m as any).grade || '',
        m.expiryDays ?? '',
        m.forceScrapDays ?? '',
        m.supplierCode || '',
        m.supplierName || '',
        m.vietnamCode || '',
        Number(m.unitPrice) || 0,
        statusText(m.status),
        m.description || '',
      ]);

      const XLSX = await import('xlsx');
      const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...dataRows]);
      ws['!cols'] = [
        { wch: 6 }, { wch: 20 }, { wch: 22 }, { wch: 32 }, { wch: 12 }, { wch: 14 },
        { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 14 },
        { wch: 12 }, { wch: 28 }, { wch: 16 }, { wch: 10 }, { wch: 8 }, { wch: 30 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '物料主数据');
      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `物料主数据_${new Date().toISOString().split('T')[0]}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${t('message.exportSuccess') || '导出成功'}（${all.length}）`);
    } catch (err) {
      toast.error(t('common.error') || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const handleReset = () => {
    resetQuery();
  };

  const openAddDialog = () => {
    setEditingId(null);
    setFormData({
      materialCode: '',
      materialName: '',
      specification: '',
      unit: 'PCS',
      materialType: '',
      mslLevel: '不管控',
      supplierCode: '',
      vietnamCode: '',
      status: 'active',
      description: '',
      expiryDays: undefined,
      forceScrapDays: undefined,
      unitPrice: 0,
    });
    setDialogOpen(true);
  };

  const openEditDialog = (record: Material) => {
    setEditingId(record.id);
    setFormData({
      materialCode: record.materialCode,
      materialName: record.materialName,
      specification: record.specification,
      unit: record.unit,
      materialType: record.materialType,
      packagingType: (record as any).packagingType || 'normal',
      mslLevel: record.mslLevel,
      supplierCode: record.supplierCode,
      vietnamCode: record.vietnamCode,
      inspectionStandard: record.inspectionStandard,
      status: record.status,
      description: record.description,
      expiryDays: record.expiryDays ?? undefined,
      forceScrapDays: record.forceScrapDays ?? undefined,
      unitPrice: record.unitPrice,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.materialCode || !formData.materialName) {
      toast.error(t('common.required'));
      return;
    }
    // 效期相关天数：留空 = 不做效期管控；填了必须是正整数，且有效期不能长于强制报废期
    const expDays = formData.expiryDays;
    const scrapDays = formData.forceScrapDays;
    const isBadDays = (v: unknown) => v !== undefined && v !== null && !(Number.isInteger(Number(v)) && Number(v) > 0);
    if (isBadDays(expDays)) {
      toast.error(t('ui.有效期天数必须是大于 0 的整数（留空表示不做效期管控）'));
      return;
    }
    if (isBadDays(scrapDays)) {
      toast.error(t('ui.强制报废期必须是大于 0 的整数（留空表示不设报废期）'));
      return;
    }
    if (expDays && scrapDays && Number(expDays) > Number(scrapDays)) {
      toast.error(t('ui.有效期天数不能大于强制报废期'));
      return;
    }
    try {
      if (editingId) {
        await updateMaterial(editingId, formData);
      } else {
        await createMaterial(formData as Omit<Material, 'id'>);
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
      await deleteMaterial(id);
      toast.success(t('common.success'));
      refresh();
    } catch (err) {
      toast.error(t('common.error'));
    }
  };

  const columns: TableProps<Material>['columns'] = [
    {
      title: t('material.materialCode'),
      dataIndex: 'materialCode',
      width: 140,
      fixed: 'left',
    },
    { title: t('material.materialName'), dataIndex: 'materialName', width: 180 },
    { title: t('material.specification'), dataIndex: 'specification', width: 160 },
    { title: t('material.materialType'), dataIndex: 'materialType', width: 110, render: (v: string) => tui(v) },
    {
      title: t('ui.包装类型'), dataIndex: 'packagingType', width: 110,
      render: (v: string) => (v === 'reel'
        ? <Badge variant="default">{t('ui.盘装料')}</Badge>
        : <span className="text-muted-foreground">{t('ui.普通')}</span>),
    },
    { title: t('common.unit'), dataIndex: 'unit', width: 80 },
    { title: t('material.mslLevel'), dataIndex: 'mslLevel', width: 110, render: (v: string) => tui(v) },
    { title: t('material.expiryDays'), dataIndex: 'expiryDays', width: 110 },
    {
      title: t('ui.强制报废期'),
      dataIndex: 'forceScrapDays',
      width: 110,
      render: (val: number | undefined) => (val === null || val === undefined || (val as any) === '' ? '-' : val),
    },
    { title: t('material.supplierCode'), dataIndex: 'supplierCode', width: 140 },
    { title: t('material.supplierName'), dataIndex: 'supplierName', width: 180 },
    { title: t('material.vietnamCode'), dataIndex: 'vietnamCode', width: 140 },
    {
      title: t('overPicking.unitPrice'),
      dataIndex: 'unitPrice',
      width: 100,
      align: 'right',
      render: (val: number | undefined) => {
        const n = Number(val);
        return !isFinite(n) || n === 0 ? '0.00' : n.toFixed(2);
      },
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 100,
        render: (val: string) => (
          <Badge variant={val === 'active' ? 'default' : 'secondary'}>
            {val === 'active' ? t('material.status_active') : t('material.status_inactive')}
          </Badge>
        ),
    },
    {
      title: t('common.operation'),
      key: 'action',
      width: 150,
      fixed: 'right',
      render: (_: any, record: Material) => (
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
              <label className="text-sm text-muted-foreground">{t('material.materialCode')}</label>
              <Input
                value={draft.materialCode}
                onChange={(e) => setDraft('materialCode', e.target.value)}
                onKeyDown={onEnterSearch}
                className="w-44"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('material.materialName')}</label>
              <Input
                value={draft.materialName}
                onChange={(e) => setDraft('materialName', e.target.value)}
                onKeyDown={onEnterSearch}
                className="w-44"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('material.materialType')}</label>
              <Select value={draft.materialType} onValueChange={(v) => setDraft('materialType', v)}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder={t('common.all')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('common.all')}</SelectItem>
                  {materialTypeOptions.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {tui(opt)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('ui.包装类型')}</label>
              <Select value={draft.packagingType || ''} onValueChange={(v) => setDraft('packagingType', v)}>
                <SelectTrigger className="w-44"><SelectValue placeholder={t('common.all')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('common.all')}</SelectItem>
                  <SelectItem value="normal">{t('ui.普通（按数量收发）')}</SelectItem>
                  <SelectItem value="reel">{t('ui.盘装料（Reel，按盘管理）')}</SelectItem>
                </SelectContent>
              </Select>
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
            <div className="flex gap-2">
              <Button onClick={search}>{t('common.search')}</Button>
              <Button variant="outline" onClick={handleReset}>
                {t('common.reset')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-foreground">{t('nav.materialList')}</h2>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleExportAll} disabled={exporting}>
                  <Download size={15} className="mr-1" />
                  {t('material.batchExport') || '批量导出'}
                </Button>
                <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
                  {t('material.batchImport')}
                </Button>
                <Button onClick={openAddDialog}>+ {t('common.add')}</Button>
              </div>
            </div>
          <ResizableTable
            rowKey="id"
            columns={columns}
            dataSource={list}
            loading={loading}
            scroll={{ x: 1900, y: 500 }}
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
              {importPreview ? '导入校对 · 请确认后再导入' : t('material.batchImport')}
            </DialogTitle>
          </DialogHeader>

          {!importPreview ? (
            <div className="space-y-4 py-2">
              <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
                {t('material.importTip')}
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">{t('material.batchImport')}</label>
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
                下一步会先把文件与系统现有数据做一次校对，列出「新增 / 更新 / 名称冲突 /
                将被归档」，确认无误后才真正写入。
              </div>
            </div>
          ) : (
            <div className="max-h-[65vh] overflow-y-auto py-2 pr-1">
              <ImportPreviewPanel
                kind="material"
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
                      const preview = await previewMaterialImport({ fileBase64: base64 });
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
                      const res = await importMaterial({
                        fileBase64: base64,
                        applySupplierNameChanges,
                      });
                      const changed = res.nameChanges?.length ?? 0;
                      toast.success(
                        `${t('material.importSuccessCount').replace('{count}', String(res.successCount))}` +
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
                  disabled={importing || (importPreview?.missingColumns?.length ?? 0) > 0}
                >
                  {importing ? t('common.submitting') : '确认导入'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingId ? t('common.edit') : t('common.add')} {t('nav.materialList')}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2 max-h-[70vh] overflow-y-auto">
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">
                {t('material.materialCode')} <span className="text-destructive">*</span>
              </label>
              <Input
                value={formData.materialCode || ''}
                onChange={(e) =>
                  setFormData({ ...formData, materialCode: e.target.value })
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">
                {t('material.materialName')} <span className="text-destructive">*</span>
              </label>
              <Input
                value={formData.materialName || ''}
                onChange={(e) =>
                  setFormData({ ...formData, materialName: e.target.value })
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('material.specification')}</label>
              <Input
                value={formData.specification || ''}
                onChange={(e) =>
                  setFormData({ ...formData, specification: e.target.value })
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('common.unit')}</label>
              <Input
                value={formData.unit || ''}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('material.materialType')}</label>
              <Select
                value={formData.materialType || ''}
                onValueChange={(val) => setFormData({ ...formData, materialType: val })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('common.pleaseSelect')} />
                </SelectTrigger>
                <SelectContent>
                  {typeOptions.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {tui(opt)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* 包装类型：主数据必填项，决定收发方式（普通按数量、盘装按盘台账） */}
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('ui.包装类型')}</label>
              <Select
                value={formData.packagingType || 'normal'}
                onValueChange={(val) => setFormData({ ...formData, packagingType: val })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">{t('ui.普通（按数量收发）')}</SelectItem>
                  <SelectItem value="reel">{t('ui.盘装料（Reel，按盘管理）')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('material.mslLevel')}</label>
              <Select
                 value={formData.mslLevel || '不管控'}
                onValueChange={(val) => setFormData({ ...formData, mslLevel: val })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {mslOptions.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {tui(opt)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('material.supplierCode')}</label>
              <Input
                value={formData.supplierCode || ''}
                onChange={(e) =>
                  setFormData({ ...formData, supplierCode: e.target.value })
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('material.vietnamCode')}</label>
              <Input
                value={formData.vietnamCode || ''}
                onChange={(e) =>
                  setFormData({ ...formData, vietnamCode: e.target.value })
                }
              />
            </div>
            {/* 有效期天数：收货/入库时按「生产日期 + 有效期天数」算有效期，超期由系统自动推 IQC 复检 */}
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('material.expiryDays')}</label>
              <Input
                type="number"
                min={1}
                step={1}
                placeholder={t('ui.如 365')}
                value={formData.expiryDays ?? ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    expiryDays: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('ui.强制报废期(天)')}</label>
              <Input
                type="number"
                min={1}
                step={1}
                placeholder={t('ui.如 730')}
                value={formData.forceScrapDays ?? ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    forceScrapDays: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('overPicking.unitPrice')}</label>
              <Input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={formData.unitPrice ?? 0}
                onChange={(e) =>
                  setFormData({ ...formData, unitPrice: Number(e.target.value) || 0 })
                }
              />
            </div>
            <div className="flex flex-col gap-1 col-span-2">
              <label className="text-sm text-muted-foreground">{t('material.inspectionStandard')}</label>
              <Input
                value={formData.inspectionStandard || ''}
                onChange={(e) =>
                  setFormData({ ...formData, inspectionStandard: e.target.value })
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
            <div className="flex flex-col gap-1 col-span-2">
              <label className="text-sm text-muted-foreground">{t('common.remark')}</label>
              <Input
                value={formData.description || ''}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
              />
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
    </div>
  );
};

export default MaterialList;
