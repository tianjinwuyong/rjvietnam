import React, { useState, useEffect, useCallback } from 'react';
import ResizableTable from '@client/src/components/ui/resizable-table';
import { Table, type TableProps } from '@client/src/compat/antd-table';
import { useI18n, tf, tui } from '@client/src/i18n';
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
import { workorder as workorderApi, bom as bomApi } from '@client/src/api';
import type { WorkOrder, Bom } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { renderDate } from '@client/src/utils/datetime';
import { toast } from 'sonner';
import { showConfirm } from '@client/src/compat';

const WorkOrderList: React.FC = () => {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<WorkOrder[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [bomList, setBomList] = useState<Bom[]>([]);

  const [filters, setFilters] = useState({
    workOrderNo: '',
    productCode: '',
    status: '',
    startDate: '',
    endDate: '',
    isSupplement: '',
  });

  const [formData, setFormData] = useState({
    workOrderNo: '',
    bomId: '',
    planQty: 0,
    workOrderDate: new Date().toISOString().split('T')[0],
    remark: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await workorderApi.getWorkOrderList({
        page,
        pageSize,
        workOrderNo: filters.workOrderNo || undefined,
        productCode: filters.productCode || undefined,
        status: filters.status || undefined,
        startDate: filters.startDate || undefined,
        endDate: filters.endDate || undefined,
        isSupplement: filters.isSupplement === '' ? undefined : filters.isSupplement === 'true',
      });
      setData(res.items);
      setTotal(res.total);
    } catch (error) {
      logger.error('Failed to fetch work orders:', String(error));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filters]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    bomApi.getAllActiveBoms().then((res) => setBomList(res)).catch(() => {});
  }, []);

  const handleSearch = () => {
    setPage(1);
    fetchData();
  };

  const handleReset = () => {
    setFilters({ workOrderNo: '', productCode: '', status: '', startDate: '', endDate: '', isSupplement: '' });
    setPage(1);
  };

  /** 取后端错误信息（可能是中文本地化词条、字符串或字符串数组） */
  const resolveError = (e: any, fallback: string): string => {
    const raw = e?.response?.data?.message ?? e?.response?.data?.error?.message;
    const msg = Array.isArray(raw) ? raw[0] : raw;
    return (typeof msg === 'string' && msg ? tui(msg) : '') || fallback;
  };

  const handleSubmit = async () => {
    if (!formData.bomId || formData.planQty <= 0 || !formData.workOrderDate) {
      toast(t('message.requiredField'));
      return;
    }
    const customNo = formData.workOrderNo.trim();
    if (customNo) {
      if (customNo.length > 50) { toast(t('ui.工单号长度不能超过50个字符')); return; }
      if (!/^[A-Za-z0-9_-]+$/.test(customNo)) { toast(t('ui.工单号只能包含字母、数字、中划线或下划线')); return; }
    }
    setSubmitting(true);
    try {
      await workorderApi.createWorkOrder({ ...formData, workOrderNo: customNo || undefined });
      setDialogOpen(false);
      setFormData({ workOrderNo: '', bomId: '', planQty: 0, workOrderDate: new Date().toISOString().split('T')[0], remark: '' });
      fetchData();
    } catch (error: any) {
      toast(resolveError(error, t('message.createFailed')));
    } finally {
      setSubmitting(false);
    }
  };

  const handleIssueWorkOrder = async (record: WorkOrder) => {
    if (!await showConfirm(tf('ui.woIssueConfirmMsg', { no: record.workOrderNo }))) return;
    try {
      const result = await workorderApi.issueWorkOrder({ workOrderNo: record.workOrderNo });
      toast(tf('ui.woIssuedOkMsg', { n: result.length }));
      fetchData();
    } catch (error: any) {
      toast(resolveError(error, t('message.createFailed')));
    }
  };

  const handleRecallWorkOrder = async (record: WorkOrder) => {
    if (!await showConfirm(tf('ui.woWithdrawConfirmMsg', { no: record.workOrderNo }))) return;
    try {
      await workorderApi.recallWorkOrder({ workOrderNo: record.workOrderNo });
      toast(t('ui.撤回成功'));
      fetchData();
    } catch (error: any) {
      toast(resolveError(error, t('ui.撤回失败')));
    }
  };

  const handleCloseWorkOrder = async (record: WorkOrder) => {
    if (!await showConfirm(tf('ui.woCloseConfirmMsg', { no: record.workOrderNo }))) return;
    try {
      await workorderApi.closeWorkOrder({ workOrderNo: record.workOrderNo });
      toast(t('ui.结案成功'));
      fetchData();
    } catch (error: any) {
      toast(resolveError(error, t('ui.结案失败')));
    }
  };

  const handleCancelWorkOrder = async (record: WorkOrder) => {
    if (!await showConfirm(tf('ui.woCancelConfirmMsg', { no: record.workOrderNo }))) return;
    try {
      await workorderApi.cancelWorkOrder({ workOrderNo: record.workOrderNo });
      toast(t('ui.取消成功'));
      fetchData();
    } catch (error: any) {
      toast(resolveError(error, t('ui.取消失败')));
    }
  };

  const statusBadge = (status: string) => {
    const variantMap: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      draft: 'secondary',
      released: 'default',
      in_production: 'default',
      completed: 'default',
      closed: 'secondary',
      cancelled: 'destructive',
      created: 'secondary',
    };
    const labelMap: Record<string, string> = {
      draft: t('workorder.status_draft'),
      released: t('workorder.status_released'),
      in_production: t('workorder.status_in_production'),
      completed: t('workorder.status_completed'),
      closed: t('workorder.status_closed'),
      cancelled: t('workorder.status_cancelled'),
      created: t('workorder.status_created'),
    };
    return <Badge variant={variantMap[status] || 'secondary'}>{labelMap[status] || status}</Badge>;
  };

  const columns: TableProps<WorkOrder>['columns'] = [
    {
      title: t('workorder.workOrderNo'),
      dataIndex: 'workOrderNo',
      width: 180,
      fixed: 'left',
      render: (v: string, record: WorkOrder) => (
        <div className="flex items-center gap-1">
          <span>{v}</span>
          {record.mesControlled && (
            <Badge variant="outline" className="text-[10px] px-1 py-0 leading-4">
              {t('workorder.sourceMes')}
            </Badge>
          )}
        </div>
      ),
    },
    { title: t('bom.productCode'), dataIndex: 'productCode', width: 140 },
    { title: t('bom.productName'), dataIndex: 'productName', width: 160 },
    { title: t('workorder.planQty'), dataIndex: 'planQty', width: 100, align: 'right' },
    { title: t('workorder.workOrderDate'), dataIndex: 'workOrderDate', width: 120, render: renderDate },
    {
      title: t('workorder.isSupplement'),
      dataIndex: 'isSupplement',
      width: 100,
      render: (isSup: boolean) =>
         isSup ? <Badge variant="destructive">{t('common.yes')}</Badge> : <Badge variant="secondary">{t('common.no')}</Badge>,
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 100,
      render: (status: string) => statusBadge(status),
    },
    { title: t('workorder.planner'), dataIndex: 'plannerName', width: 100 },
    { title: t('common.remark'), dataIndex: 'remark', width: 120 },
    {
      title: t('common.operation'),
      key: 'action',
      fixed: 'right',
      width: 220,
      render: (_: any, record: WorkOrder) => {
        // 领料单来自 MES 的工单：结案在 MES，WMS 不提供下发/撤回/结案/取消；
        // 领料单由 WMS 工单自己开出来的，功能完全不变
        if (record.mesControlled) {
          return (
            <span className="text-xs text-muted-foreground" title={t('workorder.mesManagedTip')}>
              {t('workorder.mesManagedBy')}
            </span>
          );
        }
        return (
        <div className="flex gap-1 flex-wrap">
          {(record.status === 'draft' || record.status === 'created') && (
            <>
              <Button variant="default" size="sm" onClick={() => handleIssueWorkOrder(record)}>
                {t('ui.下发')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleCancelWorkOrder(record)}>
                {t('pda.cancel')}
              </Button>
            </>
          )}
          {record.status === 'released' && (
            <>
              <Button variant="secondary" size="sm" onClick={() => handleRecallWorkOrder(record)}>
                {t('ui.撤回')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleCloseWorkOrder(record)}>
                {t('ui.结案')}
              </Button>
            </>
          )}
          {record.status === 'in_production' && (
            <Button variant="outline" size="sm" onClick={() => handleCloseWorkOrder(record)}>
              {t('ui.结案')}
            </Button>
          )}
          {record.status === 'completed' && (
            <Button variant="outline" size="sm" onClick={() => handleCloseWorkOrder(record)}>
              {t('ui.结案')}
            </Button>
          )}
          {(record.status === 'closed' || record.status === 'cancelled') && (
            <Badge variant="secondary">{record.status === 'closed' ? t('mrb.closed') : t('workorder.cancelled')}</Badge>
          )}
        </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-[12px] p-4 border border-border">
        <div className="flex justify-between items-start mb-4">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3 flex-1">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('workorder.workOrderNo')}</label>
              <Input
                value={filters.workOrderNo}
                onChange={(e) => setFilters({ ...filters, workOrderNo: e.target.value })}
                placeholder={t('workorder.workOrderNo')}
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
                   <SelectItem value="draft">{t('workorder.status_draft')}</SelectItem>
                   <SelectItem value="released">{t('workorder.status_released')}</SelectItem>
                   <SelectItem value="in_production">{t('workorder.status_in_production')}</SelectItem>
                   <SelectItem value="completed">{t('workorder.status_completed')}</SelectItem>
                   <SelectItem value="closed">{t('workorder.status_closed')}</SelectItem>
                   <SelectItem value="cancelled">{t('workorder.status_cancelled')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('workorder.isSupplement')}</label>
              <Select value={filters.isSupplement} onValueChange={(val) => setFilters({ ...filters, isSupplement: val })}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('common.all')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('common.all')}</SelectItem>
                   <SelectItem value="false">{t('common.no')}</SelectItem>
                   <SelectItem value="true">{t('common.yes')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2 col-span-2">
              <Button onClick={handleSearch}>{t('common.search')}</Button>
              <Button variant="outline" onClick={handleReset}>{t('common.reset')}</Button>
            </div>
          </div>
          <Button onClick={() => setDialogOpen(true)} className="ml-4">{t('ui.创建工单')}</Button>
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
            showTotal: (totalN) => `${t('common.total')} ${totalN} ${t('common.items')}`,
            onChange: (p) => setPage(p),
          }}
        />
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('ui.创建工单')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">
                {t('workorder.workOrderNo')}
                <span className="text-xs font-normal">{t('ui.可选括号')}</span>
              </label>
              <Input
                value={formData.workOrderNo}
                maxLength={50}
                placeholder={t('ui.留空则由系统自动生成')}
                onChange={(e) => setFormData({ ...formData, workOrderNo: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">BOM *</label>
              <Select value={formData.bomId} onValueChange={(val) => setFormData({ ...formData, bomId: val })}>
                <SelectTrigger className="w-full">
                   <SelectValue placeholder={t('bom.bomCode')} />
                </SelectTrigger>
                <SelectContent>
                  {bomList.map((bom) => (
                    <SelectItem key={bom.id} value={bom.id}>
                      {bom.bomCode} - {bom.productName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('workorder.planQty')} *</label>
              <Input
                type="number"
                value={formData.planQty || ''}
                onChange={(e) => setFormData({ ...formData, planQty: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('workorder.workOrderDate')} *</label>
              <Input
                type="date"
                value={formData.workOrderDate}
                onChange={(e) => setFormData({ ...formData, workOrderDate: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('common.remark')}</label>
              <Input
                value={formData.remark}
                onChange={(e) => setFormData({ ...formData, remark: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? t('common.loading') : t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default WorkOrderList;
