import React, { useState, useCallback, useEffect } from 'react';
import ResizableTable from '@client/src/components/ui/resizable-table';
import { Table, type TableProps } from '@client/src/compat/antd-table';
import { useI18n } from '@client/src/i18n';
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
import { workorder as workorderApi } from '@client/src/api';
import type { WorkOrder, PickingOrder } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { renderDate, renderDateTime } from '@client/src/utils/datetime';
import { toast } from 'sonner';

const SupplementRecord: React.FC = () => {
  const { t } = useI18n();
  const sectionLabel = useWorkSectionLabel();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<WorkOrder[]>([]);
  const [filters, setFilters] = useState({
    parentOrderNo: '',
    startDate: '',
    endDate: '',
  });

  const [detailOpen, setDetailOpen] = useState(false);
  const [currentRecord, setCurrentRecord] = useState<WorkOrder | null>(null);
  const [pickingOrders, setPickingOrders] = useState<PickingOrder[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await workorderApi.getSupplementList({
        page,
        pageSize,
        parentOrderNo: filters.parentOrderNo || undefined,
        startDate: filters.startDate || undefined,
        endDate: filters.endDate || undefined,
      });
      setData(res.items);
      setTotal(res.total);
    } catch (error) {
      logger.error('Failed to fetch supplement records:', String(error));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filters.parentOrderNo, filters.startDate, filters.endDate]);

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
    setFilters({ parentOrderNo: '', startDate: '', endDate: '' });
    setPage(1);
  };

  const handleViewDetail = async (record: WorkOrder) => {
    setCurrentRecord(record);
    setDetailOpen(true);
    try {
      const res = await workorderApi.getPickingOrderList({
        workOrderNo: record.workOrderNo,
        pageSize: 100,
      });
      setPickingOrders(res.items);
    } catch (error) {
      logger.error('Failed to fetch picking orders:', String(error));
      setPickingOrders([]);
    }
  };

  const handleExport = () => {
    if (data.length === 0) {
      toast(t('message.noData'));
      return;
    }
    const rows = data.map((item, index) => ({
      [t('common.serialNo')]: index + 1,
      [t('workorder.parentWorkOrderNo')]: item.parentOrderNo || '',
      [t('workorder.supplementWorkOrderNo')]: item.workOrderNo,
      [t('bom.productCode')]: item.productCode || '',
      [t('bom.productName')]: item.productName || '',
      [t('common.remark')]: item.remark || '',
      [t('workorder.workOrderDate')]: item.workOrderDate || '',
    }));
    const headers = Object.keys(rows[0]);
    const csvContent = [
      headers.join(','),
      ...rows.map((row) =>
        headers.map((h) => `"${String((row as any)[h] ?? '').replace(/"/g, '""')}"`).join(','),
      ),
    ].join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `supplement_records_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(t('message.exportSuccess'));
  };

  const statusBadge = (status: string) => {
    const variantMap: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      draft: 'secondary',
      pending_approval: 'default',
      approved: 'default',
      rejected: 'destructive',
      picking: 'default',
      issued: 'default',
      received: 'default',
      cancelled: 'destructive',
    };
    const labelMap: Record<string, string> = {
      draft: t('workorder.status_draft'),
      pending_approval: t('workorder.status_pending_approval'),
      approved: t('workorder.status_approved'),
      rejected: t('workorder.status_rejected'),
      picking: t('workorder.status_picking'),
      issued: t('workorder.status_issued'),
      received: t('workorder.status_received'),
      cancelled: t('workorder.status_cancelled'),
    };
    const variant = variantMap[status] || 'secondary';
    const label = labelMap[status] || status;
    return <Badge variant={variant}>{label}</Badge>;
  };

  const woStatusBadge = (status: string) => {
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
    const variant = variantMap[status] || 'secondary';
    const label = labelMap[status] || status;
    return <Badge variant={variant}>{label}</Badge>;
  };

  const columns: TableProps<WorkOrder>['columns'] = [
    { title: t('common.serialNo'), dataIndex: 'index', width: 60, fixed: 'left', render: (_: any, __: any, index: number) => (page - 1) * pageSize + index + 1 },
    { title: t('workorder.parentWorkOrderNo'), dataIndex: 'parentOrderNo', width: 180 },
    { title: t('workorder.supplementWorkOrderNo'), dataIndex: 'workOrderNo', width: 200 },
    { title: t('bom.productCode'), dataIndex: 'productCode', width: 140 },
    { title: t('bom.productName'), dataIndex: 'productName', width: 160 },
    { title: t('workorder.workOrderDate'), dataIndex: 'workOrderDate', width: 120, render: renderDate },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 100,
      render: (status: string) => woStatusBadge(status),
    },
    { title: t('common.remark'), dataIndex: 'remark', width: 150 },
    {
      title: t('common.operation'),
      key: 'action',
      width: 100,
      fixed: 'right',
      render: (_: any, record: WorkOrder) => (
        <Button variant="ghost" size="sm" onClick={() => handleViewDetail(record)}>
          {t('common.detail')}
        </Button>
      ),
    },
  ];

  const pickingColumns: TableProps<PickingOrder>['columns'] = [
    { title: t('workorder.pickingNo'), dataIndex: 'pickingNo', width: 160 },
    { title: t('bom.workSection'), dataIndex: 'workSection', width: 100, render: (s: string) => sectionLabel(s) },
    { title: t('workorder.totalQty'), dataIndex: 'totalQty', width: 100, align: 'right' },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 120,
      render: (status: string) => {
        const vmap: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
          draft: 'secondary',
          pending_approval: 'default',
          approved: 'default',
          rejected: 'destructive',
          picking: 'default',
          picked: 'default',
          issued: 'default',
          received: 'default',
          cancelled: 'destructive',
          completed: 'default',
        };
        const lmap: Record<string, string> = {
          draft: t('workorder.status_draft'),
          pending_approval: t('workorder.status_pending_approval'),
          approved: t('workorder.status_approved'),
          rejected: t('workorder.status_rejected'),
          picking: t('workorder.status_picking'),
          picked: t('workorder.status_picked'),
          issued: t('workorder.status_issued'),
          received: t('workorder.status_received'),
          cancelled: t('workorder.status_cancelled'),
          completed: t('workorder.status_completed'),
        };
        const v = vmap[status] || 'secondary';
        const lb = lmap[status] || status;
        return <Badge variant={v}>{lb}</Badge>;
      },
    },
    { title: t('workorder.applicant'), dataIndex: 'applicantName', width: 100 },
    { title: t('workorder.pickTime'), dataIndex: 'pickTime', width: 160, render: renderDateTime },
    { title: t('common.remark'), dataIndex: 'remark', width: 150 },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-[12px] p-4 border border-border">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">{t('workorder.supplementRecord')}</h3>
          <Button variant="outline" onClick={handleExport}>
            {t('common.export')}
          </Button>
        </div>

        <div className="flex items-center gap-4 mb-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground whitespace-nowrap">
              {t('workorder.parentWorkOrderNo')}:
            </label>
            <Input
              value={filters.parentOrderNo}
              onChange={(e) => setFilters({ ...filters, parentOrderNo: e.target.value })}
              placeholder="WO202609110002"
              className="w-48"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground whitespace-nowrap">
              {t('common.startDate')}:
            </label>
            <Input
              type="date"
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              className="w-40"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground whitespace-nowrap">
              {t('common.endDate')}:
            </label>
            <Input
              type="date"
              value={filters.endDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              className="w-40"
            />
          </div>
          <div className="flex items-end gap-2">
            <Button onClick={handleSearch}>{t('common.search')}</Button>
            <Button variant="outline" onClick={handleReset}>{t('common.reset')}</Button>
          </div>
        </div>

        <ResizableTable
          columns={columns}
          dataSource={data}
          loading={loading}
          rowKey="id"
          scroll={{ x: 1100, y: 500 }}
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

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('workorder.supplementRecord')} - {currentRecord?.workOrderNo}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">{t('workorder.parentWorkOrderNo')}:</span>
                <span className="ml-2 font-medium">{currentRecord?.parentOrderNo}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('bom.productCode')}:</span>
                <span className="ml-2 font-medium">{currentRecord?.productCode}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('bom.productName')}:</span>
                <span className="ml-2 font-medium">{currentRecord?.productName}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('common.status')}:</span>
                <span className="ml-2">{currentRecord && woStatusBadge(currentRecord.status)}</span>
              </div>
            </div>
            <div className="border-t pt-4">
              <h4 className="font-semibold mb-3">{t('workorder.pickingList')}</h4>
              <ResizableTable
                columns={pickingColumns}
                dataSource={pickingOrders}
                rowKey="id"
                scroll={{ x: 900, y: 300 }}
                pagination={false}
                size="small"
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setDetailOpen(false)}>{t('common.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SupplementRecord;
