import React, { useState, useEffect, useCallback, useRef } from 'react';
import ResizableTable from '@client/src/components/ui/resizable-table';
import { Table, type TableProps } from '@client/src/compat/antd-table';
import { useI18n } from '@client/src/i18n';
import { useWorkSectionLabel } from '@client/src/utils/work-section';
import { renderDate } from '@client/src/utils/datetime';
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
import { workorder as workorderApi, material as materialApi } from '@client/src/api';
import type { WorkOrder, Material } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';

interface SupplementItemInput {
  materialId: string;
  materialCode: string;
  materialName: string;
  unit: string;
  quantity: number;
  workSection: string;
}

const Supplement: React.FC = () => {
  const { t } = useI18n();
  const sectionLabel = useWorkSectionLabel();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<WorkOrder[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  const [formData, setFormData] = useState({
    parentOrderNo: '',
    reason: '',
    supplementItems: [] as SupplementItemInput[],
  });

  const [newItem, setNewItem] = useState<SupplementItemInput>({
    materialId: '',
    materialCode: '',
    materialName: '',
    unit: 'PCS',
    quantity: 1,
    workSection: 'smt',
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await workorderApi.getSupplementList({ page, pageSize });
      setData(res.items);
      setTotal(res.total);
    } catch (error) {
      logger.error('Failed to fetch supplement orders:', String(error));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const lookUpTimer = useRef<number | null>(null);

  const handleMaterialCodeChange = (code: string) => {
    setNewItem({ ...newItem, materialCode: code, materialId: '', materialName: '', unit: 'PCS' });
    if (lookUpTimer.current) window.clearTimeout(lookUpTimer.current);
    if (!code.trim()) return;
    lookUpTimer.current = window.setTimeout(async () => {
      try {
        const res = await materialApi.getMaterialList({
          page: 1,
          pageSize: 1,
          materialCode: code.trim(),
        });
        if (res.items.length > 0) {
          const mat: Material = res.items[0];
          setNewItem((prev) => ({
            ...prev,
            materialId: mat.id,
            materialName: mat.materialName || '',
            unit: mat.unit || 'PCS',
          }));
        }
      } catch (error) {
        logger.warn('Look up material failed:', String(error));
      }
    }, 300);
  };

  const handleAddItem = () => {
    if (!newItem.materialCode.trim() || newItem.quantity <= 0) return;
    const item: SupplementItemInput = {
      ...newItem,
      materialId: newItem.materialId || '00000000-0000-0000-0000-000000000000',
    };
    setFormData({ ...formData, supplementItems: [...formData.supplementItems, item] });
    setNewItem({ materialId: '', materialCode: '', materialName: '', unit: 'PCS', quantity: 1, workSection: 'smt' });
  };

  const handleRemoveItem = (index: number) => {
    const newItems = [...formData.supplementItems];
    newItems.splice(index, 1);
    setFormData({ ...formData, supplementItems: newItems });
  };

  const handleSubmit = async () => {
    if (!formData.parentOrderNo.trim()) {
      toast(t('workorder.workOrderNo') + ' ' + t('message.requiredField'));
      return;
    }
    if (formData.supplementItems.length === 0) {
      toast(t('message.requiredField'));
      return;
    }
    if (!formData.reason) {
      toast(t('workorder.supplementReason') + ' ' + t('message.requiredField'));
      return;
    }
    try {
      await workorderApi.createSupplement({
        parentOrderNo: formData.parentOrderNo.trim(),
        supplementItems: formData.supplementItems,
        reason: formData.reason,
      });
      toast(t('message.createSuccess'));
      setDialogOpen(false);
      setFormData({ parentOrderNo: '', reason: '', supplementItems: [] });
      fetchData();
    } catch (error: any) {
      toast(error?.response?.data?.message || t('message.createFailed'));
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
    const variant = variantMap[status] || 'secondary';
    const label = labelMap[status] || status;
    return <Badge variant={variant}>{label}</Badge>;
  };

  const columns: TableProps<WorkOrder>['columns'] = [
    { title: t('workorder.workOrderNo'), dataIndex: 'workOrderNo', width: 180, fixed: 'left' },
    { title: t('workorder.parentWorkOrderNo'), dataIndex: 'parentOrderNo', width: 160 },
    { title: t('bom.productCode'), dataIndex: 'productCode', width: 140 },
    { title: t('bom.productName'), dataIndex: 'productName', width: 160 },
    { title: t('workorder.workOrderDate'), dataIndex: 'workOrderDate', width: 120, render: renderDate },
    { title: t('common.status'), dataIndex: 'status', width: 100, render: (s: string) => statusBadge(s) },
    { title: t('common.remark'), dataIndex: 'remark', width: 150 },
  ];

  const itemColumns: TableProps<SupplementItemInput>['columns'] = [
    { title: t('material.materialCode'), dataIndex: 'materialCode', width: 160 },
    { title: t('material.materialName'), dataIndex: 'materialName', width: 180 },
    { title: t('common.unit'), dataIndex: 'unit', width: 80 },
    { title: t('common.quantity'), dataIndex: 'quantity', width: 100, align: 'right' },
    {
      title: t('bom.workSection'),
      dataIndex: 'workSection',
      width: 100,
      render: (section: string) => sectionLabel(section),
    },
    {
      title: t('common.operation'),
      key: 'action',
      width: 80,
      render: (_: any, __: any, index: number) => (
        <Button variant="ghost" size="sm" onClick={() => handleRemoveItem(index)}>
          {t('common.delete')}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-[12px] p-4 border border-border">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">{t('nav.supplement')}</h3>
          <Button onClick={() => setDialogOpen(true)}>{t('ui.创建工单')}</Button>
        </div>

        <ResizableTable
          columns={columns}
          dataSource={data}
          loading={loading}
          rowKey="id"
          scroll={{ x: 1050, y: 500 }}
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
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
             <DialogTitle>{t('workorder.createSupplement')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                 <label className="text-sm text-muted-foreground mb-1 block">{t('workorder.workOrderNo')} *</label>
                <Input
                  value={formData.parentOrderNo}
                  onChange={(e) => setFormData({ ...formData, parentOrderNo: e.target.value })}
                  placeholder="WO202609110002"
                />
              </div>
              <div>
                 <label className="text-sm text-muted-foreground mb-1 block">{t('workorder.supplementReason')} *</label>
                <Input
                  value={formData.reason}
                  onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                   placeholder={t('workorder.supplementReason')}
                />
              </div>
            </div>

            <div className="border-t pt-4">
               <h4 className="font-semibold mb-3">{t('workorder.supplementItem')}</h4>
              <div className="grid grid-cols-5 gap-2 mb-3">
                <Input
                  placeholder={t('material.materialCode') + ' *'}
                  value={newItem.materialCode}
                  onChange={(e) => handleMaterialCodeChange(e.target.value)}
                />
                <Input
                  placeholder={t('material.materialName')}
                  value={newItem.materialName}
                  disabled
                />
                <Input
                  placeholder={t('common.quantity') + ' *'}
                  type="number"
                  value={newItem.quantity || ''}
                  onChange={(e) => setNewItem({ ...newItem, quantity: Number(e.target.value) })}
                />
                <Select value={newItem.workSection} onValueChange={(val) => setNewItem({ ...newItem, workSection: val })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="smt">{t('bom.smt')}</SelectItem>
                    <SelectItem value="dip">{t('bom.dip')}</SelectItem>
                    <SelectItem value="assembly">{t('bom.assembly')}</SelectItem>
                    <SelectItem value="packing">{t('bom.packing')}</SelectItem>
                  </SelectContent>
                </Select>
                 <Button onClick={handleAddItem} size="sm">{t('ui.+ 添加物料')}</Button>
              </div>
              <div className="border rounded">
                <ResizableTable
                  columns={itemColumns}
                  dataSource={formData.supplementItems}
                  rowKey={(record: any, index: number) => index.toString()}
                  pagination={false}
                  size="small"
                  scroll={{ x: 700, y: 200 }}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleSubmit}>{t('common.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Supplement;
