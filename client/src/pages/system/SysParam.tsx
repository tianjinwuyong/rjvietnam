import React, { useState, useEffect } from 'react';
import { useI18n } from '@client/src/i18n';
import { Input } from '@client/src/components/ui/input';
import { Button } from '@client/src/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import { Textarea } from '@client/src/components/ui/textarea';
import ResizableTable from '@client/src/components/ui/resizable-table';
import { Table, type TableProps } from '@client/src/compat/antd-table';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';
import {
  getSysParamList,
  createSysParam,
  updateSysParam,
  deleteSysParam,
} from '@client/src/api/system';
import type { SysParam as SysParamRecord } from '@shared/api.interface';
import { showConfirm } from '@client/src/compat';

const SysParam: React.FC = () => {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [data, setData] = useState<SysParamRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const [paramKey, setParamKey] = useState('');

  // 编辑弹窗
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [editId, setEditId] = useState('');
  const [formData, setFormData] = useState({
    paramKey: '',
    paramValue: '',
    paramNameZh: '',
    paramNameVi: '',
    paramNameEn: '',
    description: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const fetchData = async (p: number = page) => {
    setLoading(true);
    try {
      const result = await getSysParamList({
        page: p,
        pageSize,
        paramKey: paramKey || undefined,
      });
      setData(result.data.items);
      setTotal(result.data.total);
      setPage(p);
    } catch (error) {
      logger.error('get sys param list failed', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(1);
  }, []);

  const handleSearch = () => fetchData(1);
  const handleReset = () => {
    setParamKey('');
    fetchData(1);
  };

  const handleAdd = () => {
    setIsEdit(false);
    setEditId('');
    setFormData({
      paramKey: '',
      paramValue: '',
      paramNameZh: '',
      paramNameVi: '',
      paramNameEn: '',
      description: '',
    });
    setDialogOpen(true);
  };

  const handleEdit = (record: SysParamRecord) => {
    setIsEdit(true);
    setEditId(record.id);
    setFormData({
      paramKey: record.paramKey,
      paramValue: record.paramValue,
      paramNameZh: record.paramNameZh || '',
      paramNameVi: record.paramNameVi || '',
      paramNameEn: record.paramNameEn || '',
      description: record.description || '',
    });
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!await showConfirm(t('message.confirmDelete'))) return;
    try {
      await deleteSysParam(id);
      toast.success(t('message.deleteSuccess'));
      fetchData(page);
    } catch (error: any) {
      logger.error('delete sys param failed', error);
      toast.error(error?.response?.data?.message || t('message.deleteFailed'));
    }
  };

  const handleSubmit = async () => {
    if (!formData.paramKey.trim()) {
      toast.error(t('system.paramKey') + ' ' + t('message.requiredField'));
      return;
    }
    if (!formData.paramValue.trim()) {
      toast.error(t('system.paramValue') + ' ' + t('message.requiredField'));
      return;
    }
    setSubmitting(true);
    try {
      if (isEdit) {
        await updateSysParam(editId, {
          paramValue: formData.paramValue,
          paramNameZh: formData.paramNameZh || undefined,
          paramNameVi: formData.paramNameVi || undefined,
          paramNameEn: formData.paramNameEn || undefined,
          description: formData.description || undefined,
        });
        toast.success(t('message.updateSuccess'));
      } else {
        await createSysParam({
          paramKey: formData.paramKey.trim(),
          paramValue: formData.paramValue,
          paramNameZh: formData.paramNameZh || undefined,
          paramNameVi: formData.paramNameVi || undefined,
          paramNameEn: formData.paramNameEn || undefined,
          description: formData.description || undefined,
        });
        toast.success(t('message.createSuccess'));
      }
      setDialogOpen(false);
      fetchData(page);
    } catch (error: any) {
      logger.error('submit sys param failed', error);
      toast.error(error?.response?.data?.message || t('message.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const columns: TableProps<SysParamRecord>['columns'] = [
    {
      title: t('common.serialNo'),
      key: 'index',
      width: 70,
      fixed: 'left',
      render: (_: any, __: any, index: number) => (page - 1) * pageSize + index + 1,
    },
    { title: t('system.paramKey'), dataIndex: 'paramKey', width: 200 },
    { title: t('system.paramValue'), dataIndex: 'paramValue', width: 200, ellipsis: true },
    { title: `${t('system.paramName')}(ZH)`, dataIndex: 'paramNameZh', width: 160 },
    { title: `${t('system.paramName')}(VI)`, dataIndex: 'paramNameVi', width: 160 },
    { title: `${t('system.paramName')}(EN)`, dataIndex: 'paramNameEn', width: 160 },
    { title: t('common.remark'), dataIndex: 'description', width: 200, ellipsis: true },
    {
      title: t('common.operation'),
      key: 'action',
      width: 150,
      fixed: 'right',
      render: (_: any, record: SysParamRecord) => (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => handleEdit(record)}>
            {t('common.edit')}
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(record.id)}>
            {t('common.delete')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-[12px] p-4 border border-border">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('system.paramKey')}
            </label>
            <Input
              value={paramKey}
              onChange={(e) => setParamKey(e.target.value)}
              placeholder={t('system.paramKey')}
            />
          </div>
        </div>
        <div className="flex gap-2 justify-between items-center">
          <Button onClick={handleAdd}>{t('common.add')}</Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={handleReset}>
              {t('common.reset')}
            </Button>
            <Button onClick={handleSearch}>{t('common.search')}</Button>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-[12px] p-4 border border-border">
        <ResizableTable
          columns={columns}
          dataSource={data}
          loading={loading}
          rowKey="id"
          scroll={{ x: 1200, y: 500 }}
          pagination={{
            current: page,
            pageSize,
            total,
            onChange: (p: number) => fetchData(p),
            showSizeChanger: false,
          }}
        />
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {isEdit ? t('common.edit') : t('common.add')}{t('system.paramKey')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('system.paramKey')} <span className="text-destructive">*</span>
              </label>
              <Input
                value={formData.paramKey}
                onChange={(e) => setFormData((p) => ({ ...p, paramKey: e.target.value }))}
                disabled={isEdit}
                placeholder={t('system.paramKey')}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('system.paramValue')} <span className="text-destructive">*</span>
              </label>
              <Textarea
                value={formData.paramValue}
                onChange={(e) => setFormData((p) => ({ ...p, paramValue: e.target.value }))}
                placeholder={t('system.paramValue')}
                rows={3}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                   {t('system.paramName')}(ZH)
                </label>
                <Input
                  value={formData.paramNameZh}
                  onChange={(e) => setFormData((p) => ({ ...p, paramNameZh: e.target.value }))}
                   placeholder={t('system.paramName') + ' (ZH)'}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                   {t('system.paramName')}(VI)
                </label>
                <Input
                  value={formData.paramNameVi}
                  onChange={(e) => setFormData((p) => ({ ...p, paramNameVi: e.target.value }))}
                   placeholder={t('system.paramName') + ' (VI)'}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                   {t('system.paramName')}(EN)
                </label>
                <Input
                  value={formData.paramNameEn}
                  onChange={(e) => setFormData((p) => ({ ...p, paramNameEn: e.target.value }))}
                   placeholder={t('system.paramName') + ' (EN)'}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('common.remark')}
              </label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
                placeholder={t('common.remark')}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
               {submitting ? t('common.submitting') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SysParam;
