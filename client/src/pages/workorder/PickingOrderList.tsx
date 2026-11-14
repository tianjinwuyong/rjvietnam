import React, { useCallback, useEffect, useState } from 'react';
import ResizableTable from '@client/src/components/ui/resizable-table';
import type { TableProps } from '@client/src/compat/antd-table';
import { useI18n } from '@client/src/i18n';
import { useWorkSectionLabel } from '@client/src/utils/work-section';
import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import { workorder as workorderApi } from '@client/src/api';
import type { MaterialRequirement as MaterialRequirementRecord, PickingOrder } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { renderDateTime } from '@client/src/utils/datetime';
import { toast } from 'sonner';
import { FileText } from 'lucide-react';

interface PickingOrderListProps {
  workOrderId: string | null;
  workOrderNo: string;
  onUpdated?: () => void;
}

const PickingOrderList: React.FC<PickingOrderListProps> = ({ workOrderId, workOrderNo }) => {
  const { t } = useI18n();
  const sectionLabel = useWorkSectionLabel();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PickingOrder[]>([]);

  const fetchData = useCallback(async () => {
    if (!workOrderId) {
      setData([]);
      return;
    }
    setLoading(true);
    try {
      const res = await workorderApi.getPickingOrdersByWorkOrder(workOrderId);
      setData(res);
    } catch (error) {
      logger.error('Failed to fetch picking orders:', String(error));
    } finally {
      setLoading(false);
    }
  }, [workOrderId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
    { title: t('workorder.pickingNo'), dataIndex: 'pickingNo', width: 160 },
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
    { title: t('workorder.applicant'), dataIndex: 'applicantName', width: 100 },
    { title: t('workorder.approver'), dataIndex: 'approverName', width: 100 },
    { title: t('workorder.approvalTime'), dataIndex: 'approvalTime', width: 160, render: renderDateTime },
    { title: t('workorder.picker'), dataIndex: 'pickerName', width: 100 },
  ];

  return (
    <div className="bg-card rounded-[12px] p-4 border border-border">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <FileText className="w-4 h-4 text-blue-500" />
          {t('workorder.pickingOrderList')}
          <Badge variant="outline">{data.length}</Badge>
        </h3>
        <Button variant="outline" size="sm" onClick={fetchData} disabled={!workOrderId || loading}>
          {t('common.refresh')}
        </Button>
      </div>
      {workOrderNo ? (
        <div className="text-sm text-muted-foreground mb-2">
          {t('workorder.workOrderNo')}: <span className="font-medium text-foreground">{workOrderNo}</span>
        </div>
      ) : null}
      <ResizableTable
        columns={columns}
        dataSource={data}
        loading={loading}
        rowKey="id"
        pagination={false}
        scroll={{ x: 900, y: 300 }}
        size="small"
        locale={{ emptyText: workOrderNo ? t('workorder.noPickingOrders') : t('workorder.selectWorkOrderFirst') }}
      />
    </div>
  );
};

export default PickingOrderList;
