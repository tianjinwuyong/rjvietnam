import React, { useState, useEffect, useCallback } from 'react';
import ResizableTable from '@client/src/components/ui/resizable-table';
import { Table, type TableProps } from '@client/src/compat/antd-table';
import { useI18n } from '@client/src/i18n';
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
import { inventory as inventoryApi } from '@client/src/api';
import type { StockTransfer as StockTransferRecord } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { renderDate } from '@client/src/utils/datetime';
import { toast } from 'sonner';

const StockTransfer: React.FC = () => {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<StockTransferRecord[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  const [filters, setFilters] = useState({
    transferNo: '',
    materialCode: '',
    startDate: '',
    endDate: '',
  });

  const [formData, setFormData] = useState({
    fromLocationId: '',
    toLocationId: '',
    materialId: '',
    batchNo: '',
    quantity: 0,
    remark: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await inventoryApi.getTransferList({
        page,
        pageSize,
        transferNo: filters.transferNo || undefined,
        materialCode: filters.materialCode || undefined,
        startDate: filters.startDate || undefined,
        endDate: filters.endDate || undefined,
      });
      setData(res.items);
      setTotal(res.total);
    } catch (error) {
      logger.error('Failed to fetch transfers:', String(error));
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
    setFilters({ transferNo: '', materialCode: '', startDate: '', endDate: '' });
    setPage(1);
  };

  const handleSubmit = async () => {
    if (!formData.fromLocationId || !formData.toLocationId || !formData.materialId || formData.quantity <= 0) {
       toast(t('message.requiredField'));
      return;
    }
    setSubmitting(true);
    try {
      await inventoryApi.transferStock({
        fromLocationId: formData.fromLocationId,
        toLocationId: formData.toLocationId,
        materialId: formData.materialId,
        batchNo: formData.batchNo || undefined,
        quantity: formData.quantity,
        remark: formData.remark || undefined,
      });
      setDialogOpen(false);
      setFormData({ fromLocationId: '', toLocationId: '', materialId: '', batchNo: '', quantity: 0, remark: '' });
      fetchData();
    } catch (error: any) {
       toast(error?.response?.data?.message || t('message.updateFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const columns: TableProps<StockTransferRecord>['columns'] = [
    { title: t('inventory.transferNo'), dataIndex: 'transferNo', width: 160, fixed: 'left' },
    { title: t('inventory.transferDate'), dataIndex: 'transferDate', width: 120, render: renderDate },
    { title: t('material.materialCode'), dataIndex: 'materialCode', width: 140 },
    { title: t('material.materialName'), dataIndex: 'materialName', width: 160 },
    { title: t('common.batch'), dataIndex: 'batchNo', width: 120 },
    { title: t('inventory.fromLocation'), dataIndex: 'fromLocationCode', width: 140 },
    { title: t('inventory.toLocation'), dataIndex: 'toLocationCode', width: 140 },
    { title: t('common.quantity'), dataIndex: 'quantity', width: 100, align: 'right' },
    { title: t('common.unit'), dataIndex: 'unit', width: 80 },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 100,
      render: (status: string) => statusBadge(status),
    },
    { title: t('common.remark'), dataIndex: 'remark', width: 150 },
  ];

  const statusBadge = (status: string) => {
    const variantMap: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      draft: 'secondary',
      pending: 'default',
      approved: 'default',
      rejected: 'destructive',
      in_transit: 'default',
      completed: 'default',
      cancelled: 'destructive',
    };
    const labelMap: Record<string, string> = {
      draft: t('inventory.transfer_status_draft'),
      pending: t('inventory.transfer_status_pending'),
      approved: t('inventory.transfer_status_approved'),
      rejected: t('inventory.transfer_status_rejected'),
      in_transit: t('inventory.transfer_status_in_transit'),
      completed: t('inventory.transfer_status_completed'),
      cancelled: t('inventory.transfer_status_cancelled'),
    };
    return <Badge variant={variantMap[status] || 'secondary'}>{labelMap[status] || status}</Badge>;
  };

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-[12px] p-4 border border-border">
        <div className="flex justify-between items-center mb-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('inventory.transferNo')}</label>
              <Input
                value={filters.transferNo}
                onChange={(e) => setFilters({ ...filters, transferNo: e.target.value })}
                placeholder={t('inventory.transferNo')}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('material.materialCode')}</label>
              <Input
                value={filters.materialCode}
                onChange={(e) => setFilters({ ...filters, materialCode: e.target.value })}
                placeholder={t('material.materialCode')}
              />
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={handleSearch}>{t('common.search')}</Button>
              <Button variant="outline" onClick={handleReset}>{t('common.reset')}</Button>
            </div>
          </div>
          <Button onClick={() => setDialogOpen(true)} className="ml-4">{t('common.add')}</Button>
        </div>
      </div>

      <div className="bg-card rounded-[12px] p-4 border border-border">
        <ResizableTable
          columns={columns}
          dataSource={data}
          loading={loading}
          rowKey="id"
          scroll={{ x: 1300, y: 500 }}
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('nav.stockTransfer')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('inventory.fromLocation')} *</label>
              <Input
                value={formData.fromLocationId}
                onChange={(e) => setFormData({ ...formData, fromLocationId: e.target.value })}
                 placeholder={t('warehouse.sourceLocationId')}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('inventory.toLocation')} *</label>
              <Input
                value={formData.toLocationId}
                onChange={(e) => setFormData({ ...formData, toLocationId: e.target.value })}
                 placeholder={t('warehouse.targetLocationId')}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('material.materialCode')} *</label>
              <Input
                value={formData.materialId}
                onChange={(e) => setFormData({ ...formData, materialId: e.target.value })}
                 placeholder={t('material.materialId')}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('common.batch')}</label>
              <Input
                value={formData.batchNo}
                onChange={(e) => setFormData({ ...formData, batchNo: e.target.value })}
                placeholder={t('common.batch')}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('common.quantity')} *</label>
              <Input
                type="number"
                value={formData.quantity || ''}
                onChange={(e) => setFormData({ ...formData, quantity: Number(e.target.value) })}
                placeholder={t('common.quantity')}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('common.remark')}</label>
              <Input
                value={formData.remark}
                onChange={(e) => setFormData({ ...formData, remark: e.target.value })}
                placeholder={t('common.remark')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleSubmit} disabled={submitting}>{submitting ? t('common.loading') : t('common.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default StockTransfer;
