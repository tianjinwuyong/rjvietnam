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
import { workorder as workorderApi } from '@client/src/api';
import type { MaterialRequirement as MaterialRequirementRecord, WorkOrder, MaterialRequirementItem } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';
import { showConfirm } from '@client/src/compat';
import { Plus, FileText, Send } from 'lucide-react';
import PickingOrderList from './PickingOrderList';

const WORK_SECTIONS: Array<{ value: string; labelKey: string }> = [
  { value: 'smt', labelKey: 'bom.smt' },
  { value: 'dip', labelKey: 'bom.dip' },
  { value: 'assembly', labelKey: 'bom.assembly' },
  { value: 'packing', labelKey: 'bom.packing' },
  { value: 'auxiliary', labelKey: 'bom.auxiliary' },
];

const MaterialRequirement: React.FC = () => {
  const { t } = useI18n();
  const sectionLabel = useWorkSectionLabel();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<MaterialRequirementRecord[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [workOrderNo, setWorkOrderNo] = useState('');
  const [previewItems, setPreviewItems] = useState<MaterialRequirementItem[]>([]);
  const [previewSections, setPreviewSections] = useState<string[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [filters, setFilters] = useState({
    workOrderNo: '',
    workSection: '',
    status: '',
  });
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await workorderApi.getRequirementList({
        page,
        pageSize,
        workOrderNo: filters.workOrderNo || undefined,
        workSection: filters.workSection || undefined,
        status: filters.status || undefined,
      });
      setData(res.items);
      setTotal(res.total);
      setSelectedRowKeys([]);
    } catch (error) {
      logger.error('Failed to fetch requirements:', String(error));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filters]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleOpenCreate = () => {
    setCreateOpen(true);
    setWorkOrderNo('');
    setPreviewItems([]);
    setPreviewSections([]);
  };

  const handleWorkOrderNoChange = (val: string) => {
    setWorkOrderNo(val);
    if (!val) {
      setPreviewItems([]);
      setPreviewSections([]);
    }
  };

  const handleLoadPreview = async () => {
    if (!workOrderNo.trim()) {
      setPreviewItems([]);
      setPreviewSections([]);
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await workorderApi.previewMaterialRequirement({
        workOrderNo: workOrderNo.trim(),
      });
      setPreviewItems(res.items);
      setPreviewSections(res.sections || []);
    } catch (error: any) {
      toast(error?.response?.data?.message || t('message.loadFailed'));
      setPreviewItems([]);
      setPreviewSections([]);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSubmitRequirement = async () => {
    if (!workOrderNo.trim()) {
      toast(t('workorder.pleaseSelectWorkOrder'));
      return;
    }
    if (previewItems.length === 0) {
      toast(t('workorder.noRequirementItems'));
      return;
    }
    if (!await showConfirm(t('workorder.confirmGenerateRequirement'))) return;

    setSubmitting(true);
    try {
      await workorderApi.generateMaterialRequirement({
        workOrderNo: workOrderNo.trim(),
      });
      toast(t('message.saveSuccess'));
      setCreateOpen(false);
      fetchData();
    } catch (error: any) {
      toast(error?.response?.data?.message || t('message.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSearch = () => {
    // setPage(1) 是异步的：紧接着调 fetchData() 用的是闭包里的旧 page，
    // 与 useEffect 里那次正确请求形成竞态 —— 旧结果后到就会闪出一张空表。
    // 已在第 1 页时 setPage(1) 不触发重渲染，才需要手动刷新。
    if (page === 1) fetchData();
    else setPage(1);
  };

  const handleReset = () => {
    setFilters({ workOrderNo: '', workSection: '', status: '' });
    setPage(1);
  };

  const handleSubmitApproval = async () => {
    if (selectedRowKeys.length === 0) {
      toast(t('workorder.pleaseSelectRequirements'));
      return;
    }
    const draftCount = data.filter(
      (r) => selectedRowKeys.includes(r.id) && r.status === 'draft',
    ).length;
    if (draftCount === 0) {
      toast(t('workorder.noDraftSelected'));
      return;
    }
    if (!await showConfirm(t('workorder.confirmSubmitApproval'))) return;

    try {
      await workorderApi.batchSubmitRequirements(selectedRowKeys);
      toast(t('message.operationSuccess'));
      fetchData();
    } catch (error: any) {
      toast(error?.response?.data?.message || t('message.operationFailed'));
    }
  };

  const statusBadge = (status: string) => {
    const variantMap: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      draft: 'secondary',
      pending_approval: 'default',
      approved: 'default',
      rejected: 'destructive',
      issued: 'default',
      cancelled: 'destructive',
      submitted: 'secondary',
    };
    const labelMap: Record<string, string> = {
      draft: t('workorder.status_draft'),
      pending_approval: t('workorder.status_pending_approval'),
      approved: t('workorder.status_approved'),
      rejected: t('workorder.status_rejected'),
      issued: t('workorder.status_issued'),
      cancelled: t('workorder.status_cancelled'),
      submitted: t('workorder.status_submitted'),
    };
    return <Badge variant={variantMap[status] || 'secondary'}>{labelMap[status] || status}</Badge>;
  };

  const filteredWorkOrderId =
    data.length > 0 && filters.workOrderNo
      ? data.find((r) => r.workOrderNo === filters.workOrderNo.trim())?.workOrderId || null
      : null;

  const columns: TableProps<MaterialRequirementRecord>['columns'] = [
    { title: t('workorder.workOrderNo'), dataIndex: 'workOrderNo', width: 160, fixed: 'left' },
    {
      title: t('bom.workSection'),
      dataIndex: 'workSection',
      width: 100,
      render: (section: string) => sectionLabel(section),
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
  ];

  const previewColumns: TableProps<MaterialRequirementItem>['columns'] = [
    { title: t('material.materialCode'), dataIndex: 'materialCode', width: 140 },
    { title: t('material.materialName'), dataIndex: 'materialName', width: 160 },
    { title: t('material.specification'), dataIndex: 'specification', width: 200 },
    { title: t('common.unit'), dataIndex: 'unit', width: 60 },
    { title: t('bom.workSection'), dataIndex: 'workSection', width: 100, render: (s: string) => sectionLabel(s) },
    { title: t('bom.unitUsage'), dataIndex: 'unitUsage', width: 100, align: 'right' },
    { title: t('workorder.requiredQty'), dataIndex: 'requiredQty', width: 100, align: 'right' },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-[12px] p-4 border border-border">
        <div className="flex justify-between items-center mb-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1">
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
          <div className="ml-4 flex flex-col gap-2">
            <Button onClick={handleOpenCreate}>
              <Plus className="w-4 h-4 mr-1" />
              {t('workorder.createRequirement')}
            </Button>
            <Button
              variant="default"
              onClick={handleSubmitApproval}
              disabled={selectedRowKeys.length === 0}
            >
              <Send className="w-4 h-4 mr-1" />
              {t('workorder.submitPickingApproval')}
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
            onChange: (keys) => setSelectedRowKeys(keys as string[]),
            getCheckboxProps: (record: MaterialRequirementRecord) => ({
              disabled: record.status !== 'draft',
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

      <PickingOrderList
        workOrderId={filteredWorkOrderId}
        workOrderNo={filters.workOrderNo.trim()}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              <FileText className="w-5 h-5 inline mr-2" />
              {t('workorder.createRequirement')}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">
                  {t('workorder.workOrderNo')} <span className="text-red-500">*</span>
                </label>
                <Input
                  value={workOrderNo}
                  onChange={(e) => handleWorkOrderNoChange(e.target.value)}
                  onBlur={handleLoadPreview}
                  placeholder={t('workorder.workOrderNo')}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">
                  {t('workorder.includedSections')}
                </label>
                <div className="flex flex-wrap gap-2 h-9 items-center">
                  {previewSections.length > 0 ? (
                    previewSections.map((s) => (
                      <Badge key={s} variant="outline">{sectionLabel(s)}</Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">{t('workorder.previewHint')}</span>
                  )}
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                {t('workorder.requirementList')}
                <Badge variant="outline">{previewItems.length}</Badge>
              </h4>
              <div className="border border-border rounded-lg overflow-hidden">
                <ResizableTable
                  columns={previewColumns}
                  dataSource={previewItems}
                  loading={previewLoading}
                  rowKey="id"
                  pagination={false}
                  scroll={{ x: 800, y: 300 }}
                  size="small"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleSubmitRequirement} disabled={!workOrderNo || previewItems.length === 0 || submitting}>
              {submitting ? t('common.saving') : t('workorder.generateRequirement')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MaterialRequirement;
