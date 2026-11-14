import React, { useState, useEffect, useCallback } from 'react';
import ResizableTable from '@client/src/components/ui/resizable-table';
import type { TableProps } from '@client/src/compat/antd-table';
import { useI18n } from '@client/src/i18n';
import { useWorkSectionLabel } from '@client/src/utils/work-section';
import { renderDateTime } from '@client/src/utils/datetime';
import { Input } from '@client/src/components/ui/input';
import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
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
import { Textarea } from '@client/src/components/ui/textarea';
import { workorder as workorderApi } from '@client/src/api';
import type { PickingOrder } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';
import { showConfirm } from '@client/src/compat';
import { CheckCircle, XCircle } from 'lucide-react';

const WORK_SECTIONS: Array<{ value: string; labelKey: string }> = [
  { value: 'smt', labelKey: 'bom.smt' },
  { value: 'dip', labelKey: 'bom.dip' },
  { value: 'assembly', labelKey: 'bom.assembly' },
  { value: 'packing', labelKey: 'bom.packing' },
  { value: 'auxiliary', labelKey: 'bom.auxiliary' },
];

const PickingApproval: React.FC = () => {
  const { t } = useI18n();
  const sectionLabel = useWorkSectionLabel();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PickingOrder[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectRemark, setRejectRemark] = useState('');
  const [processing, setProcessing] = useState(false);

  const [filters, setFilters] = useState({
    pickingNo: '',
    workOrderNo: '',
    workSection: '',
    status: 'pending_approval',
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await workorderApi.getPickingOrderList({
        page,
        pageSize,
        pickingNo: filters.pickingNo || undefined,
        workOrderNo: filters.workOrderNo || undefined,
        workSection: filters.workSection || undefined,
        status: filters.status || undefined,
      });
      setData(res.items);
      setTotal(res.total);
      setSelectedRowKeys([]);
    } catch (error) {
      logger.error('Failed to fetch picking orders:', String(error));
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
    setFilters({ pickingNo: '', workOrderNo: '', workSection: '', status: 'pending_approval' });
    setPage(1);
  };

  const handleSelectionChange = (keys: string[]) => {
    setSelectedRowKeys(keys);
  };

  const handleApprove = async () => {
    if (selectedRowKeys.length === 0) {
      toast(t('workorder.pleaseSelectPickingOrders'));
      return;
    }
    if (!await showConfirm(t('workorder.confirmApprovePicking'))) return;
    setProcessing(true);
    try {
      await workorderApi.batchApprovePickingOrders({
        ids: selectedRowKeys,
        pass: true,
      });
      toast(t('message.operationSuccess'));
      fetchData();
    } catch (error: any) {
      toast(error?.response?.data?.message || t('message.operationFailed'));
    } finally {
      setProcessing(false);
    }
  };

  const handleOpenReject = () => {
    if (selectedRowKeys.length === 0) {
      toast(t('workorder.pleaseSelectPickingOrders'));
      return;
    }
    setRejectRemark('');
    setRejectOpen(true);
  };

  const handleConfirmReject = async () => {
    setProcessing(true);
    try {
      await workorderApi.batchApprovePickingOrders({
        ids: selectedRowKeys,
        pass: false,
        approvalRemark: rejectRemark || undefined,
      });
      toast(t('message.operationSuccess'));
      setRejectOpen(false);
      fetchData();
    } catch (error: any) {
      toast(error?.response?.data?.message || t('message.operationFailed'));
    } finally {
      setProcessing(false);
    }
  };

  const statusBadge = (status: string) => {
    const variantMap: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      pending_approval: 'default',
      approved: 'default',
      rejected: 'destructive',
      completed: 'default',
    };
    const labelMap: Record<string, string> = {
      pending_approval: t('workorder.status_pending_approval'),
      approved: t('workorder.status_approved'),
      rejected: t('workorder.status_rejected'),
      completed: t('workorder.status_completed'),
    };
    return <Badge variant={variantMap[status] || 'secondary'}>{labelMap[status] || status}</Badge>;
  };

  const columns: TableProps<PickingOrder>['columns'] = [
    { title: t('workorder.pickingNo'), dataIndex: 'pickingNo', width: 160, fixed: 'left' },
    { title: t('workorder.workOrderNo'), dataIndex: 'workOrderNo', width: 160 },
    { title: t('workorder.productCode'), dataIndex: 'productCode', width: 150 },
    {
      title: t('bom.workSection'),
      dataIndex: 'workSection',
      width: 100,
      render: (s: string) => sectionLabel(s),
    },
    { title: t('common.quantity'), dataIndex: 'totalQty', width: 100, align: 'right' },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 100,
      render: (status: string) => statusBadge(status),
    },
    {
      title: t('workorder.applicant'), dataIndex: 'applicantName', width: 100,
      // MES 自动开单没有人工申请人，标出来源，审批人一眼知道这批单从哪来
      render: (v: string, r: PickingOrder) =>
        v || (r.source === 'mes' ? <Badge variant="outline">MES</Badge> : '-'),
    },
    { title: t('workorder.approver'), dataIndex: 'approverName', width: 100 },
    { title: t('workorder.approvalTime'), dataIndex: 'approvalTime', width: 160, render: renderDateTime },
    {
      title: t('ui.OA确认状态'),
      dataIndex: 'oaStatus',
      width: 120,
      render: (v: string | undefined, r: PickingOrder) => {
        if (!r.oaInstanceId) return <span className="text-muted-foreground">-</span>;
        const map: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
          running: { label: t('ui.待确认'), variant: 'default' },
          approved: { label: t('ui.已确认'), variant: 'outline' },
          rejected: { label: t('ui.OA驳回'), variant: 'destructive' },
        };
        const m = map[v || ''] || { label: v || '-', variant: 'secondary' as const };
        return <Badge variant={m.variant}>{m.label}</Badge>;
      },
    },
    {
      title: t('common.operation'),
      key: 'oaAction',
      width: 120,
      fixed: 'right',
      render: (_: any, r: PickingOrder) => (
        r.oaInstanceId ? (
          <a
            className="text-blue-600 hover:underline text-sm"
            href={`http://${window.location.hostname}:8080/flow/detail/${r.oaInstanceId}`}
            target="_blank"
            rel="noreferrer"
          >
            {t('ui.去OA确认')}
          </a>
        ) : <span className="text-muted-foreground text-sm">-</span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-[12px] p-4 border border-border">
        <div className="flex justify-between items-center mb-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 flex-1">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('workorder.pickingNo')}</label>
              <Input
                value={filters.pickingNo}
                onChange={(e) => setFilters({ ...filters, pickingNo: e.target.value })}
                placeholder={t('workorder.pickingNo')}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('workorder.workOrderNo')}</label>
              <Input
                value={filters.workOrderNo}
                onChange={(e) => setFilters({ ...filters, workOrderNo: e.target.value })}
                placeholder={t('workorder.workOrderNo')}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('bom.workSection')}</label>
              <Select value={filters.workSection} onValueChange={(val) => setFilters({ ...filters, workSection: val })}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('common.all')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('common.all')}</SelectItem>
                  {WORK_SECTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{t(s.labelKey)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={handleSearch}>{t('common.search')}</Button>
              <Button variant="outline" onClick={handleReset}>{t('common.reset')}</Button>
            </div>
          </div>
          <div className="ml-4 flex gap-2">
            <Button
              onClick={handleApprove}
              disabled={selectedRowKeys.length === 0 || processing}
              className="bg-green-600 hover:bg-green-700"
            >
              <CheckCircle className="w-4 h-4 mr-1" />
              {t('workorder.approveSelected')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleOpenReject}
              disabled={selectedRowKeys.length === 0 || processing}
            >
              <XCircle className="w-4 h-4 mr-1" />
              {t('workorder.rejectSelected')}
            </Button>
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
          rowSelection={{
            type: 'checkbox',
            selectedRowKeys,
            onChange: handleSelectionChange as any,
            getCheckboxProps: (record: PickingOrder) => ({
              disabled: record.status !== 'pending_approval',
            }),
          }}
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

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('workorder.rejectPicking')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t('workorder.selectedCount')} {selectedRowKeys.length}
            </p>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">
                {t('workorder.rejectionReason')}
              </label>
              <Textarea
                value={rejectRemark}
                onChange={(e) => setRejectRemark(e.target.value)}
                placeholder={t('workorder.enterRejectionReason')}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={handleConfirmReject} disabled={processing}>
              {processing ? t('common.saving') : t('workorder.confirmReject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PickingApproval;
