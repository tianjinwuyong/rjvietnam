import React, { useState, useEffect, useCallback } from 'react';
import ResizableTable from '@client/src/components/ui/resizable-table';
import { Table, type TableProps } from '@client/src/compat/antd-table';
import { useI18n, tf } from '@client/src/i18n';
import { useWorkSectionLabel } from '@client/src/utils/work-section';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import { bom as bomApi } from '@client/src/api';
import type { Bom, BomItem } from '@shared/api.interface';
import type { BomItemInput } from '@client/src/api/bom';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';
import { showConfirm } from '@client/src/compat';
import BomImportPanel from './BomImportPanel';

const BomList: React.FC = () => {
  const { t } = useI18n();
  const sectionLabel = useWorkSectionLabel();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Bom[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editingBom, setEditingBom] = useState<Bom | null>(null);
  const [detailData, setDetailData] = useState<Bom & { items: BomItem[] } | null>(null);

  const [filters, setFilters] = useState({
    bomCode: '',
    productCode: '',
    productName: '',
    status: '',
  });

  const [formData, setFormData] = useState({
    bomCode: '',
    productCode: '',
    productName: '',
    version: 'V1.0',
    description: '',
    items: [] as BomItemInput[],
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await bomApi.getBomList({
        page,
        pageSize,
        bomCode: filters.bomCode || undefined,
        productCode: filters.productCode || undefined,
        productName: filters.productName || undefined,
        status: filters.status || undefined,
      });
      setData(res.items);
      setTotal(res.total);
    } catch (error) {
      logger.error('Failed to fetch BOM list:', String(error));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filters]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSearch = () => {
    // setPage(1) 是异步的：紧接着调 fetchData() 用的是闭包里的旧 page，
    // 与 useEffect 里那次正确请求形成竞态 —— 旧结果后到就会闪出一张空表。
    // 已在第 1 页时 setPage(1) 不触发重渲染，才需要手动刷新。
    if (page === 1) fetchData();
    else setPage(1);
  };

  const handleReset = () => {
    setFilters({ bomCode: '', productCode: '', productName: '', status: '' });
    setPage(1);
  };

  const handleAdd = () => {
    setEditingBom(null);
    setFormData({
      bomCode: '',
      productCode: '',
      productName: '',
      version: 'V1.0',
      description: '',
      items: [],
    });
    setDialogOpen(true);
  };

  const handleEdit = async (record: Bom) => {
    setEditingBom(record);
    try {
      const detail = await bomApi.getBomDetail(record.id);
      setFormData({
        bomCode: detail.bomCode,
        productCode: detail.productCode,
        productName: detail.productName,
        version: detail.version,
        description: detail.description || '',
        items: detail.items.map((item) => ({
          materialId: item.materialId,
          materialCode: item.materialCode,
          vietnamCode: item.vietnamCode,
          materialName: item.materialName,
          specification: item.specification,
          unit: item.unit,
          quantity: item.quantity,
          workSection: item.workSection,
          sortOrder: item.sortOrder,
          remark: item.remark,
        })),
      });
      setDialogOpen(true);
    } catch (error) {
      logger.error('Failed to fetch BOM detail:', String(error));
    }
  };

  const handleViewDetail = async (record: Bom) => {
    try {
      const detail = await bomApi.getBomDetail(record.id);
      setDetailData(detail);
      setDetailOpen(true);
    } catch (error) {
      logger.error('Failed to fetch BOM detail:', String(error));
    }
  };

  const handleDelete = async (record: Bom) => {
    if (!await showConfirm(t('message.confirmDelete') + t('ui.删除后不可恢复，被工单引用的BOM将无法删除'))) return;
    try {
      await bomApi.deleteBom(record.id);
      toast(t('message.deleteSuccess'));
      fetchData();
    } catch (error: any) {
      const msg = error?.response?.data?.error?.message || error?.response?.data?.message || error?.message;
      toast(msg || '删除失败');
      logger.error('Failed to delete BOM:', String(error));
    }
  };

  const handleToggleStatus = async (record: Bom) => {
    const next: 'active' | 'inactive' = record.status === 'active' ? 'inactive' : 'active';
    const confirmMsg = next === 'inactive'
      ? t('ui.确定要停用该BOM吗？停用后不可被新工单使用。')
      : t('ui.确定要启用该BOM吗？');
    if (!await showConfirm(confirmMsg)) return;
    try {
      await bomApi.updateBomStatus(record.id, next);
      toast(next === 'active' ? t('ui.启用成功') : t('ui.停用成功'));
      fetchData();
    } catch (error: any) {
      const msg = error?.response?.data?.error?.message || error?.response?.data?.message || error?.message;
      toast(msg || '操作失败');
      logger.error('Failed to toggle BOM status:', String(error));
    }
  };

  const handleImportItems = (items: BomItemInput[]) => {
    setFormData({ ...formData, items });
  };

  const handleRemoveItem = (index: number) => {
    const newItems = [...formData.items];
    newItems.splice(index, 1);
    setFormData({ ...formData, items: newItems });
  };

  const handleSubmit = async () => {
    if (!formData.bomCode || !formData.productCode || !formData.productName) {
       toast(t('message.requiredField'));
      return;
    }
    if (formData.items.length === 0) {
       toast(t('message.requiredField'));
      return;
    }

    // 保存前先做行级校验：用量必须是大于 0 的数字
    // （Excel 的「用量」列混入位号 RS5/R25 这类文本时，以前会直接把数据库报错甩给用户）
    const badRows = formData.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        const qty = Number((item as any).quantity);
        return !Number.isFinite(qty) || qty <= 0;
      });
    if (badRows.length > 0) {
      const lines = badRows
        .slice(0, 5)
        .map(({ item, index }) =>
          tf('ui.第 {n} 行：{msgs}', {
            n: index + 1,
            msgs: `${(item as any).materialCode || ''} ${t('ui.用量必须是数字')}`,
          }),
        )
        .join('\n');
      const more = badRows.length > 5 ? `\n... ${tf('ui.还有 {n} 条错误', { n: badRows.length - 5 })}` : '';
      toast.error(`${t('bom.importValidationFailed') || '导入校验失败'}:\n${lines}${more}`);
      return;
    }
     try {
      if (editingBom) {
        await bomApi.updateBom(editingBom.id, formData);
        toast(t('message.updateSuccess'));
      } else {
        await bomApi.createBom(formData);
        toast(t('message.createSuccess'));
      }
      setDialogOpen(false);
      fetchData();
    } catch (error: any) {
       toast(error?.response?.data?.error?.message || error?.response?.data?.message || error?.message || t('message.saveFailed'));
    }
  };

  const columns: TableProps<Bom>['columns'] = [
    { title: t('bom.bomCode'), dataIndex: 'bomCode', width: 140, fixed: 'left' },
    { title: t('bom.productCode'), dataIndex: 'productCode', width: 140 },
    { title: t('bom.productName'), dataIndex: 'productName', width: 180 },
    { title: t('bom.version'), dataIndex: 'version', width: 100 },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 100,
      render: (status: string) => (
        <Badge variant={status === 'active' ? 'default' : 'secondary'}>
          {status === 'active' ? t('common.active') : t('common.inactive')}
        </Badge>
      ),
    },
    { title: t('common.remark'), dataIndex: 'description', width: 150 },
    {
      title: t('common.operation'),
      key: 'action',
      fixed: 'right',
      width: 260,
      render: (_: any, record: Bom) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => handleViewDetail(record)}>{t('common.detail')}</Button>
          <Button variant="ghost" size="sm" onClick={() => handleEdit(record)}>{t('common.edit')}</Button>
          <Button variant="ghost" size="sm" onClick={() => handleToggleStatus(record)}>
            {record.status === 'active' ? t('common.inactive') : t('common.active')}
          </Button>
          <Button variant="ghost" size="sm" className="text-red-600" onClick={() => handleDelete(record)}>{t('common.delete')}</Button>
        </div>
      ),
    },
  ];

  const detailColumns: TableProps<BomItem>['columns'] = [
    { title: t('common.serialNo'), dataIndex: 'sortOrder', width: 60, render: (_: any, __: any, index: number) => index + 1 },
    { title: t('material.materialCode'), dataIndex: 'materialCode', width: 130 },
    { title: t('material.vietnamCode'), dataIndex: 'vietnamCode', width: 120 },
    { title: t('material.materialName'), dataIndex: 'materialName', width: 100 },
    { title: t('material.specification'), dataIndex: 'specification', width: 280 },
    { title: t('common.unit'), dataIndex: 'unit', width: 60 },
    { title: t('bom.usage'), dataIndex: 'quantity', width: 70, align: 'right' },
    {
      title: t('bom.workSection'),
      dataIndex: 'workSection',
      width: 90,
      render: (section: string) => sectionLabel(section),
    },
    { title: t('common.remark'), dataIndex: 'remark', width: 120 },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-[12px] p-4 border border-border">
        <div className="flex justify-between items-start mb-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 flex-1">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('bom.bomCode')}</label>
              <Input
                value={filters.bomCode}
                onChange={(e) => setFilters({ ...filters, bomCode: e.target.value })}
                placeholder={t('bom.bomCode')}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('bom.productCode')}</label>
              <Input
                value={filters.productCode}
                onChange={(e) => setFilters({ ...filters, productCode: e.target.value })}
                placeholder={t('bom.productCode')}
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
                  <SelectItem value="active">{t('common.active')}</SelectItem>
                  <SelectItem value="inactive">{t('common.inactive')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={handleSearch}>{t('common.search')}</Button>
              <Button variant="outline" onClick={handleReset}>{t('common.reset')}</Button>
            </div>
          </div>
          <Button onClick={handleAdd} className="ml-4">{t('common.add')}</Button>
        </div>

        <ResizableTable
          columns={columns}
          dataSource={data}
          loading={loading}
          rowKey="id"
          scroll={{ x: 1000, y: 500 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: false,
            showTotal: (total) => `${t('common.total')} ${total} ${t('common.items')}`,
            onChange: (p) => setPage(p),
          }}
        />
      </div>

      {/* Edit/Add Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{editingBom ? t('common.edit') : t('common.add')} BOM</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-1">
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">{t('bom.bomCode')} *</label>
                  <Input
                    value={formData.bomCode}
                    onChange={(e) => setFormData({ ...formData, bomCode: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">{t('bom.version')}</label>
                  <Input
                    value={formData.version}
                    onChange={(e) => setFormData({ ...formData, version: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">{t('bom.productCode')} *</label>
                  <Input
                    value={formData.productCode}
                    onChange={(e) => setFormData({ ...formData, productCode: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">{t('bom.productName')} *</label>
                  <Input
                    value={formData.productName}
                    onChange={(e) => setFormData({ ...formData, productName: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">{t('common.remark')}</label>
                <Input
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>

              <div className="border-t pt-4">
                <h4 className="font-semibold mb-3">BOM {t('common.detail')}</h4>
                <BomImportPanel
                  onImported={handleImportItems}
                  currentCount={formData.items.length}
                />
                <div className="mt-3 border rounded overflow-hidden">
                  <ResizableTable
                    columns={[
                      ...detailColumns,
                      {
                        title: t('common.operation'),
                        key: 'action',
                        width: 80,
                        fixed: 'right' as const,
                        render: (_: any, __: any, index: number) => (
                          <Button variant="ghost" size="sm" onClick={() => handleRemoveItem(index)}>
                            {t('common.delete')}
                          </Button>
                        ),
                      },
                    ] as TableProps<BomItem>['columns']}
                    dataSource={formData.items as any[]}
                    rowKey={(record: any, index: number) => index.toString()}
                    pagination={false}
                    size="small"
                    scroll={{ x: 1100, y: 280 }}
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="border-t pt-3 mt-2 flex-shrink-0">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleSubmit}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>BOM {t('common.detail')} - {detailData?.bomCode}</DialogTitle>
          </DialogHeader>
          {detailData && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div><span className="text-muted-foreground">{t('bom.productCode')}：</span>{detailData.productCode}</div>
                <div><span className="text-muted-foreground">{t('bom.productName')}：</span>{detailData.productName}</div>
                <div><span className="text-muted-foreground">{t('bom.version')}：</span>{detailData.version}</div>
              </div>
              <div>
                <h4 className="font-semibold mb-2">BOM {t('common.detail')}</h4>
                <ResizableTable
                  columns={detailColumns}
                  dataSource={detailData.items}
                  rowKey="id"
                  pagination={false}
                  scroll={{ x: 1000, y: 400 }}
                  size="small"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>{t('common.back')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BomList;
