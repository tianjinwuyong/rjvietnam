import React, { useState, useEffect, useCallback } from 'react';
import ResizableTable from '@client/src/components/ui/resizable-table';
import type { TableProps } from '@client/src/compat/antd-table';
import { useI18n } from '@client/src/i18n';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
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
  getSubstitutionList,
  importSubstitution,
  deleteSubstitution,
} from '@client/src/api/material';
import type {
  MaterialSubstitution,
  PaginatedResponse,
  SubstitutionImportResult,
} from '@shared/api.interface';
import { toast } from 'sonner';
import { Download } from 'lucide-react';
import { showConfirm } from '@client/src/compat';

const SubstitutionList: React.FC = () => {
  const { t } = useI18n();

  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [list, setList] = useState<MaterialSubstitution[]>([]);
  const [loading, setLoading] = useState(false);

  const [materialCode, setMaterialCode] = useState('');
  const [searchMaterialCode, setSearchMaterialCode] = useState('');

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<SubstitutionImportResult | null>(null);
  const [twoWayImport, setTwoWayImport] = useState(false);

  // 批量导出：按当前筛选条件拉取全部页，导出 CSV（带 BOM，Excel 直开）
  const [exporting, setExporting] = useState(false);
  const handleExportAll = async () => {
    setExporting(true);
    try {
      const all: MaterialSubstitution[] = [];
      const pageSizeEx = 500;
      let pageEx = 1;
      for (;;) {
        const res: PaginatedResponse<MaterialSubstitution> = await getSubstitutionList({
          page: pageEx,
          pageSize: pageSizeEx,
          materialCode: searchMaterialCode || undefined,
        });
        all.push(...(res.items || []));
        if (all.length >= (res.total || 0) || (res.items || []).length === 0) break;
        pageEx += 1;
      }
      if (all.length === 0) {
        toast.error(t('message.noData') || '暂无数据');
        return;
      }
      const typeText = (v?: string) => (v === 'two_way' ? t('ui.双向') : t('ui.单向'));
      const rows = all.map((s, i) => ({
        [t('common.serialNo') || '序号']: i + 1,
        [t('material.originalMaterialCode') || '原物料编码']: s.materialCode || '',
        [t('material.originalMaterialName') || '原物料名称']: s.materialName || '',
        [t('material.substituteMaterialCode') || '替代物料编码']: s.substituteMaterialCode || '',
        [t('material.substituteMaterialName') || '替代物料名称']: s.substituteMaterialName || '',
        [t('material.substitutionType') || '替代方式']: typeText(s.substitutionType),
        [t('common.remark') || '备注']: s.remark || '',
        [t('common.status') || '状态']: s.status === 'active' ? t('common.active') : t('common.inactive'),
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
      a.download = `substitutions_${new Date().toISOString().split('T')[0]}.csv`;
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
      const res: PaginatedResponse<MaterialSubstitution> = await getSubstitutionList({
        page,
        pageSize,
        materialCode: searchMaterialCode || undefined,
      });
      setList(res.items);
      setTotal(res.total);
    } catch (err) {
      toast.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchMaterialCode, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSearch = () => {
    setSearchMaterialCode(materialCode);
    setPage(1);
  };

  const handleReset = () => {
    setMaterialCode('');
    setSearchMaterialCode('');
    setPage(1);
  };

  const handleImport = async () => {
    if (!importFile) {
      toast.error(t('common.required'));
      return;
    }
    setImporting(true);
    setImportResult(null);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          const commaIdx = result.indexOf(',');
          resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(importFile);
      });
      const res = await importSubstitution({ fileBase64: base64, twoWay: twoWayImport });
      setImportResult(res);
      if (res.errorCount === 0) {
        toast.success(t('common.success'));
      }
      fetchData();
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || err?.message || t('common.error');
      toast.error(msg);
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!await showConfirm(t('common.confirm'))) return;
    try {
      await deleteSubstitution(id);
      toast.success(t('common.success'));
      fetchData();
    } catch (err) {
      toast.error(t('common.error'));
    }
  };

  const columns: TableProps<MaterialSubstitution>['columns'] = [
    {
      title: t('material.originalMaterial'),
      dataIndex: 'materialCode',
      width: 160,
      fixed: 'left',
    },
    {
      title: t('material.materialName'),
      dataIndex: 'materialName',
      width: 180,
      render: (val: string | undefined) => val || '-',
    },
    {
      title: t('material.substituteMaterial'),
      dataIndex: 'substituteMaterialCode',
      width: 160,
    },
    {
      title: t('material.materialName'),
      dataIndex: 'substituteMaterialName',
      width: 180,
      render: (val: string | undefined) => val || '-',
    },
    {
      title: t('material.substitutionType'),
      dataIndex: 'substitutionType',
      width: 100,
      render: (val: string | undefined) => (
        <Badge variant={val === 'two_way' ? 'default' : 'secondary'}>
          {val === 'two_way' ? t('ui.双向') : t('ui.单向')}
        </Badge>
      ),
    },
    {
      title: t('common.remark'),
      dataIndex: 'remark',
      width: 160,
      render: (val: string | undefined) => val || '-',
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 100,
      render: (val: string) => (
        <Badge variant={val === 'active' ? 'default' : 'secondary'}>
          {val === 'active' ? t('common.active') : t('common.inactive')}
        </Badge>
      ),
    },
    {
      title: t('common.operation'),
      key: 'action',
      width: 100,
      fixed: 'right',
      render: (_: any, record: MaterialSubstitution) => (
        <Button variant="ghost" size="sm" onClick={() => handleDelete(record.id)}>
          {t('common.delete')}
        </Button>
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
                value={materialCode}
                onChange={(e) => setMaterialCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                className="w-48"
                placeholder={t('material.materialCode')}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSearch}>{t('common.search')}</Button>
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
            <h2 className="text-lg font-semibold text-foreground">{t('material.substitution')}</h2>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleExportAll} disabled={exporting}>
                <Download size={15} className="mr-1" />
                {t('material.substitutionBatchExport') || '批量导出'}
              </Button>
              <Button variant="outline" onClick={() => {
                setImportDialogOpen(true);
                setImportFile(null);
                setImportResult(null);
                setTwoWayImport(false);
              }}>
                {t('material.importSubstitution')}
              </Button>
            </div>
          </div>
          <ResizableTable
            rowKey="id"
            columns={columns}
            dataSource={list}
            loading={loading}
            scroll={{ x: 1200, y: 500 }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: false,
              showTotal: (totalN) => `${t('common.total')} ${totalN} ${t('common.items')}`,
              onChange: (p) => setPage(p),
            }}
          />
        </CardContent>
      </Card>

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('material.importSubstitution')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-[10px] whitespace-pre-line">
              {t('ui.substitutionImportHint')}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="twoWayImport"
                checked={twoWayImport}
                onChange={(e) => setTwoWayImport(e.target.checked)}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
              />
              <label htmlFor="twoWayImport" className="text-sm text-foreground cursor-pointer select-none">
                {t('ui.全部按双向替代导入（相互可替代）')}
              </label>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">{t('material.importSubstitution')}</label>
              <Input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  setImportResult(null);
                  if (file) setImportFile(file);
                }}
              />
              {importFile && (
                <div className="text-sm text-primary">{importFile.name}</div>
              )}
            </div>

            {importResult && (
              <div className="border border-border rounded-[10px] p-3 space-y-2">
                <div className="font-semibold text-sm">{t('material.substitutionImportResult')}</div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div className="bg-green-50 text-green-700 rounded-md p-2 text-center">
                    <div className="text-lg font-bold">{importResult.successCount}</div>
                    <div className="text-xs">{t('material.substitutionSuccessCount')}</div>
                  </div>
                  <div className="bg-amber-50 text-amber-700 rounded-md p-2 text-center">
                    <div className="text-lg font-bold">{importResult.skippedCount}</div>
                    <div className="text-xs">{t('material.substitutionSkippedCount')}</div>
                  </div>
                  <div className="bg-red-50 text-red-700 rounded-md p-2 text-center">
                    <div className="text-lg font-bold">{importResult.errorCount}</div>
                    <div className="text-xs">{t('material.substitutionErrorCount')}</div>
                  </div>
                </div>
                {importResult.errors && importResult.errors.length > 0 && (
                  <div className="max-h-40 overflow-y-auto text-xs space-y-1">
                    {importResult.errors.map((err, idx) => (
                      <div key={idx} className="text-red-600">· {err}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
              {t('common.close')}
            </Button>
            <Button onClick={handleImport} disabled={importing || !importFile}>
              {importing ? t('common.submitting') : t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SubstitutionList;
