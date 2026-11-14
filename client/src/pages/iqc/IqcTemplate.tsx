import React, { useState, useEffect, useRef } from 'react';
import { useI18n, tf } from '@client/src/i18n';
import { useNavigate } from 'react-router-dom';
import { usePermission } from '@client/src/auth/usePermission';
import { Input } from '@client/src/components/ui/input';
import { Button } from '@client/src/components/ui/button';
import { Card, CardContent } from '@client/src/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import { FileUp, Plus, Download, Trash2, Eye, Edit3, Settings, Link2, LibraryBig } from 'lucide-react';
import { logger } from '@client/src/utils/logger';
import { formatDateTime } from '@client/src/utils/datetime';
import { toast } from 'sonner';
import { showConfirm } from '@client/src/compat';
import {
  getTemplateList,
  deleteTemplate,
  importTemplate,
  updateTemplate,
  exportTemplate,
} from '@client/src/api/iqc';
import type { IqcTemplate as IqcTemplateEntity } from '@shared/api.interface';
import TemplatePreviewDialog from './IqcTemplatePreview';
import TemplateItemsDialog from './IqcTemplateItemsDialog';
import TemplateBindDialog from './IqcTemplateBindDialog';
import TemplateCreateDialog from './IqcTemplateCreateDialog';
import StandardLibraryDialog, { SECTION_LIST } from './IqcStandardLibraryDialog';

const IqcTemplatePage: React.FC = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { hasPermission } = usePermission();

  // ——— Top list state ———
  const [data, setData] = useState<IqcTemplateEntity[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');

  // ——— Single import ———
  const singleFileRef = useRef<HTMLInputElement>(null);

  const handleSingleImportClick = () => {
    singleFileRef.current?.click();
  };

  const handleSingleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await importTemplate(file);
      toast.success(result.templateName ? tf('ui.导入成功：{name}', { name: result.templateName }) : t('iqc.importSuccess'));
      fetchList(1);
    } catch (error) {
      logger.error('single import template failed', error);
      const msg = error instanceof Error ? error.message : t('message.operationFailed');
      toast.error(msg);
    } finally {
      if (singleFileRef.current) singleFileRef.current.value = '';
    }
  };

  // ——— Preview dialog ———
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState('');

  // ——— Items editor dialog ———
  const [itemsOpen, setItemsOpen] = useState(false);
  const [itemsTemplateId, setItemsTemplateId] = useState<string | null>(null);

  // ——— Material bind dialog ———
  const [bindOpen, setBindOpen] = useState(false);
  const [bindTemplateId, setBindTemplateId] = useState<string | null>(null);

  // ——— New template dialog ———
  const [createOpen, setCreateOpen] = useState(false);

  // ——— Standard library dialog ———
  const [libraryOpen, setLibraryOpen] = useState(false);

  const openPreview = (record: IqcTemplateEntity) => {
    setPreviewId(record.id);
    setPreviewName(record.templateName);
    setPreviewOpen(true);
  };

  // ——— Rename dialog ———
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameSubmitting, setRenameSubmitting] = useState(false);

  const openRename = (record: IqcTemplateEntity) => {
    setRenameId(record.id);
    setRenameValue(record.templateName);
    setRenameOpen(true);
  };

  const handleRenameSubmit = async () => {
    if (!renameId || !renameValue.trim()) {
      toast.error(t('iqc.templateName') + (t('message.requiredField') || '不能为空'));
      return;
    }
    setRenameSubmitting(true);
    try {
      await updateTemplate(renameId, { templateName: renameValue.trim() });
      toast.success(t('message.updateSuccess'));
      setRenameOpen(false);
      fetchList(page);
    } catch (error) {
      logger.error('rename template failed', error);
      toast.error(t('message.updateFailed') || t('message.saveFailed'));
    } finally {
      setRenameSubmitting(false);
    }
  };

  // ——— Delete ———
  const handleDelete = async (record: IqcTemplateEntity) => {
    const ok = await showConfirm(t('iqc.deleteTemplateConfirm') || t('message.confirmDelete'));
    if (!ok) return;
    try {
      await deleteTemplate(record.id);
      toast.success(t('message.deleteSuccess'));
      fetchList(page);
    } catch (error) {
      logger.error('delete template failed', error);
      toast.error(t('message.deleteFailed'));
    }
  };

  // ——— Export ———
  const handleExport = async (record: IqcTemplateEntity) => {
    try {
      const blob = await exportTemplate(record.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${record.templateName}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      logger.error('export template failed', error);
      toast.error(t('message.operationFailed') || '导出失败');
    }
  };

  // ——— Fetch list ———
  const fetchList = async (p: number = page) => {
    setLoading(true);
    try {
      const result = await getTemplateList({
        page: p,
        pageSize,
        keyword: keyword || undefined,
      });
      setData(result.items);
      setTotal(result.total);
      setPage(p);
    } catch (error) {
      logger.error('get template list failed', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchList(1); }, []);

  // ——— Permission guard ———
  // 这里原本复用「网络错误」文案，导致真正的权限不足被误报成网络故障（2026-10-20 反馈）。
  if (!hasPermission('/iqc/template')) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">{t('message.noPermission')}</div>
      </div>
    );
  }

  const sectionLabel = (key: string) => {
    const found = SECTION_LIST.find(s => s.key === key);
    return found ? t(found.labelI18n) : key;
  };

  const renderSections = (record: IqcTemplateEntity) => {
    const sections = record.selectedSections || [];
    if (sections.length === 0) {
      return <span className="text-xs text-muted-foreground">{t('iqc.noSectionsSelected')}</span>;
    }
    return (
      <div className="flex flex-wrap gap-1">
        {sections.map(s => (
          <span
            key={s}
            className="inline-block px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-xs border border-blue-100"
          >
            {sectionLabel(s)}
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            {t('nav.iqcTemplate')}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('ui.从标准库选择分类创建模板，或导入Excel检验报告模板')}
          </p>
        </div>
      </div>

      {/* Top section: template list */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium text-foreground">
              {t('ui.检验报告模板')}
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setCreateOpen(true)}>
                <Plus size={16} className="mr-1" />
                {t('iqc.newTemplate')}
              </Button>
              <Button variant="secondary" onClick={() => navigate("/iqc/standard-library")}>
                <LibraryBig size={16} className="mr-1" />
                {t('iqc.standardLibrary')}
              </Button>

            </div>
          </div>

          {/* Search */}
          <div className="flex gap-2 mb-3 items-center">
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={t('ui.搜索模板名称')}
              className="max-w-xs"
              onKeyDown={(e) => { if (e.key === 'Enter') fetchList(1); }}
            />
            <Button variant="secondary" size="sm" onClick={() => fetchList(1)}>
              {t('common.search')}
            </Button>
          </div>

          {/* Table */}
          <div className="border border-border rounded-md overflow-hidden">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left px-3 py-2 font-medium text-foreground border-b border-border w-12">#</th>
                  <th className="text-left px-3 py-2 font-medium text-foreground border-b border-border">{t('iqc.templateName')}</th>
                  <th className="text-left px-3 py-2 font-medium text-foreground border-b border-border w-16">{t('iqc.templateVersion')}</th>
                  <th className="text-left px-3 py-2 font-medium text-foreground border-b border-border min-w-[180px]">{t('iqc.includedSections')}</th>
                  <th className="text-left px-3 py-2 font-medium text-foreground border-b border-border w-20">{t('iqc.itemName')}</th>
                  <th className="text-left px-3 py-2 font-medium text-foreground border-b border-border w-20">{t('ui.关联物料')}</th>
                  <th className="text-left px-3 py-2 font-medium text-foreground border-b border-border w-36">{t('ui.表格尺寸')}</th>
                  <th className="text-left px-3 py-2 font-medium text-foreground border-b border-border w-44">{t('bom.createTime')}</th>
                  <th className="text-left px-3 py-2 font-medium text-foreground border-b border-border w-[26rem]">{t('common.action')}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                      {t('common.loading')}
                    </td>
                  </tr>
                ) : data.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                      {t('message.noData')}
                    </td>
                  </tr>
                ) : (
                  data.map((record, index) => (
                    <tr key={record.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 border-b border-border text-muted-foreground">
                        {(page - 1) * pageSize + index + 1}
                      </td>
                      <td className="px-3 py-2 border-b border-border">
                        <button
                          className="text-blue-600 hover:underline text-left"
                          onClick={() => navigate('/iqc/template-preview/' + record.id)}
                        >
                          {record.templateName}
                        </button>
                      </td>
                      <td className="px-3 py-2 border-b border-border">
                        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          v{record.version || '1.0'}
                        </span>
                      </td>
                      <td className="px-3 py-2 border-b border-border">
                        {renderSections(record)}
                      </td>
                      <td className="px-3 py-2 border-b border-border">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${record.itemCount > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {record.itemCount || 0} {t('ui.项')}
                        </span>
                      </td>
                      <td className="px-3 py-2 border-b border-border">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${record.materialCount > 0 ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                          {record.materialCount || 0} {t('ui.个')}
                        </span>
                      </td>
                      <td className="px-3 py-2 border-b border-border text-muted-foreground">
                        {record.rowCount && record.colCount
                          ? tf('ui.{rows} 行 × {cols} 列', { rows: record.rowCount, cols: record.colCount })
                          : '-'}
                      </td>
                      <td className="px-3 py-2 border-b border-border text-muted-foreground">
                        {formatDateTime(record.createdAt)}
                      </td>
                      <td className="px-3 py-2 border-b border-border">
                        <div className="flex gap-1 items-center">
                          <Button
                            variant="link"
                            size="sm"
                            className="h-6 px-1 text-xs"
                            onClick={() => handleExport(record)}
                          >
                            <Download size={13} className="mr-0.5" />
                            {t('common.export')}
                          </Button>
                          <Button
                            variant="link"
                            size="sm"
                            className="h-6 px-1 text-xs"
                            onClick={() => openRename(record)}
                          >
                            <Edit3 size={13} className="mr-0.5" />
                            {t('ui.重命名')}
                          </Button>
                          <Button
                            variant="link"
                            size="sm"
                            className="h-6 px-1 text-xs"
                            onClick={() => { setItemsTemplateId(record.id); setItemsOpen(true); }}
                          >
                            <Settings size={13} className="mr-0.5" />
                            {t('iqc.editItems')}
                          </Button>
                          <Button
                            variant="link"
                            size="sm"
                            className="h-6 px-1 text-xs"
                            onClick={() => { setBindTemplateId(record.id); setBindOpen(true); }}
                          >
                            <Link2 size={13} className="mr-0.5" />
                            {t('ui.关联物料')}
                          </Button>
                          <Button
                            variant="link"
                            size="sm"
                            className="h-6 px-1 text-xs"
                            onClick={() => navigate('/iqc/template-preview/' + record.id)}
                          >
                            <Eye size={13} className="mr-0.5" />
                            {t('ui.预览')}
                          </Button>
                          <Button
                            variant="link"
                            size="sm"
                            className="h-6 px-1 text-xs text-destructive"
                            onClick={() => handleDelete(record)}
                          >
                            <Trash2 size={13} className="mr-0.5" />
                            {t('common.delete')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > pageSize && (
            <div className="flex items-center justify-end gap-2 mt-3">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => fetchList(page - 1)}
              >
                {t('pda.prev')}
              </Button>
              <span className="text-sm text-muted-foreground">
                {tf('ui.第 {page} 页 / 共 {total} 页', { page, total: Math.ceil(total / pageSize) })}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= Math.ceil(total / pageSize)}
                onClick={() => fetchList(page + 1)}
              >
                {t('pda.next')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview dialog */}
      <TemplatePreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        templateId={previewId}
        templateName={previewName}
      />

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('ui.重命名模板')}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('ui.模板名称')} <span className="text-destructive">*</span>
            </label>
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleRenameSubmit(); }}
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRenameOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleRenameSubmit} disabled={renameSubmitting}>
              {renameSubmitting ? t('common.saving') : t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Items editor dialog */}
      <TemplateItemsDialog
        open={itemsOpen}
        onOpenChange={setItemsOpen}
        templateId={itemsTemplateId}
        onSaved={() => { setItemsOpen(false); fetchList(page); }}
      />

      {/* Material bind dialog */}
      <TemplateBindDialog
        open={bindOpen}
        onOpenChange={setBindOpen}
        templateId={bindTemplateId}
        onSaved={() => { setBindOpen(false); fetchList(page); }}
      />

      {/* New template dialog */}
      <TemplateCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => fetchList(1)}
      />


    </div>
  );
};

export default IqcTemplatePage;
