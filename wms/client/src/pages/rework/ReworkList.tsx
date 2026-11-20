import React, { useState, useEffect } from 'react';
import { useI18n, tui } from '@client/src/i18n';
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
import ResizableTable from '@client/src/components/ui/resizable-table';
import { Table, type TableProps } from '@client/src/compat/antd-table';
import { logger } from '@client/src/utils/logger';
import { useAuth } from '@client/src/auth/AuthContext';
import { toast } from 'sonner';
import { getReworkList, getReworkDetail, startRework, finishRework, reinspectRework } from '@client/src/api/rework';
import type { ReworkOrder } from '@shared/api.interface';

const ReworkList: React.FC = () => {
  const { t } = useI18n();
  const { role } = useAuth();
  const roleCode = role?.roleCode || '';

  // 与后端 `rework.controller.ts` 的角色常量保持一致：
  // 开工=仓库/SQE；确认返工完成=SQE（质量经理兜底）；复检确认=IQC。
  const canStart = ['admin', 'wh_keeper', 'wh_manager', 'sqe'].includes(roleCode);
  const canFinish = ['admin', 'sqe', 'quality_manager'].includes(roleCode);
  const canReinspect = ['admin', 'iqc_inspector', 'iqc_manager', 'quality_manager'].includes(roleCode);

  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [data, setData] = useState<ReworkOrder[]>([]);
  const [loading, setLoading] = useState(false);

  const [reworkNo, setReworkNo] = useState('');
  const [status, setStatus] = useState('');
  const [materialCode, setMaterialCode] = useState('');

  // 详情
  const [detailDialog, setDetailDialog] = useState(false);
  const [detailData, setDetailData] = useState<ReworkOrder | null>(null);

  // 操作弹窗（开始 / 完成 / 重检）
  const [actionDialog, setActionDialog] = useState<false | 'start' | 'finish' | 'reinspect'>(false);
  const [actionOrder, setActionOrder] = useState<ReworkOrder | null>(null);
  const [actionRemark, setActionRemark] = useState('');
  const [reinspectResult, setReinspectResult] = useState<'pass' | 'fail'>('pass');
  const [submitting, setSubmitting] = useState(false);

  const fetchData = async (p: number = page) => {
    setLoading(true);
    try {
      const result = await getReworkList({
        page: p,
        pageSize,
        reworkNo: reworkNo || undefined,
        status: status || undefined,
        materialCode: materialCode || undefined,
      });
      setData(result.data.items);
      setTotal(result.data.total);
      setPage(p);
    } catch (error) {
      logger.error('get rework list failed', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(1);
  }, []);

  const handleSearch = () => fetchData(1);

  const handleReset = () => {
    setReworkNo('');
    setStatus('');
    setMaterialCode('');
    fetchData(1);
  };

  const getStatusBadge = (s: string) => {
    const map: Record<string, { variant: string; label: string }> = {
      pending: { variant: 'outline', label: t('rework.status_pending') },
      reworking: { variant: 'default', label: t('rework.status_reworking') },
      pending_reinspect: { variant: 'secondary', label: t('rework.status_pending_reinspect') },
      passed: { variant: 'default', label: t('rework.status_passed') },
      failed: { variant: 'destructive', label: t('rework.status_failed') },
      closed: { variant: 'secondary', label: t('rework.status_closed') },
    };
    const cfg = map[s] || { variant: 'outline', label: s };
    return <Badge variant={cfg.variant as any}>{cfg.label}</Badge>;
  };

  const handleViewDetail = async (id: string) => {
    try {
      const result = await getReworkDetail(id);
      setDetailData(result.data);
      setDetailDialog(true);
    } catch (error) {
      logger.error('get rework detail failed', error);
      toast.error(t('rework.getDetailFailed'));
    }
  };

  const openAction = (order: ReworkOrder, type: 'start' | 'finish' | 'reinspect') => {
    setActionOrder(order);
    setActionRemark('');
    setReinspectResult('pass');
    setActionDialog(type);
  };

  const handleSubmitAction = async () => {
    if (!actionOrder || !actionDialog) return;
    setSubmitting(true);
    try {
      const base = { id: actionOrder.id, operatorId: role?.userId || undefined, remark: actionRemark || undefined };
      if (actionDialog === 'start') {
        await startRework(base);
        toast.success(t('rework.startSuccess'));
      } else if (actionDialog === 'finish') {
        await finishRework(base);
        toast.success(t('rework.finishSuccess'));
      } else {
        await reinspectRework({ ...base, result: reinspectResult });
        toast.success(t('rework.reinspectSuccess'));
      }
      setActionDialog(false);
      fetchData(page);
    } catch (error: any) {
      logger.error('rework action failed', error);
      toast.error(error?.response?.data?.message || t('rework.actionFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const columns: TableProps<ReworkOrder>['columns'] = [
    {
      title: t('common.serialNo'),
      key: 'index',
      width: 70,
      fixed: 'left',
      render: (_: any, __: any, index: number) => (page - 1) * pageSize + index + 1,
    },
    { title: t('rework.reworkNo'), dataIndex: 'reworkNo', width: 170 },
    { title: t('supplierReturn.mrbNo'), dataIndex: 'mrbNo', width: 170, render: (v: string) => v || '-' },
    { title: t('material.materialCode'), dataIndex: 'materialCode', width: 140 },
    { title: t('material.materialName'), dataIndex: 'materialName', width: 170, render: (v: string) => tui(v) || '-' },
    { title: t('common.batch'), dataIndex: 'batchNo', width: 140, render: (v: string) => v || '-' },
    { title: t('common.quantity'), dataIndex: 'quantity', width: 100, align: 'right' },
    { title: t('common.unit'), dataIndex: 'unit', width: 80 },
    { title: t('rework.sourceLocation'), dataIndex: 'sourceLocationCode', width: 160, render: (v: string) => v || '-' },
    { title: t('rework.targetLocation'), dataIndex: 'targetLocationCode', width: 160, render: (v: string) => v || '-' },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 130,
      render: (s: string) => getStatusBadge(s),
    },
    {
      title: t('common.operation'),
      key: 'action',
      width: 260,
      fixed: 'right',
      render: (_: any, record: ReworkOrder) => (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => handleViewDetail(record.id)}>
            {t('common.detail')}
          </Button>
          {/* 开工：仓库把货转到返工区；SQE 也可代开（供应商已拉走返工时） */}
          {record.status === 'pending' && canStart && (
            <Button size="sm" variant={canFinish ? 'secondary' : 'default'} onClick={() => openAction(record, 'start')}>
              {t('rework.startRework')}
            </Button>
          )}
          {/* 确认返工完成：SQE 签认，确认后才通知 IQC 复检；pending 也允许直接签认 */}
          {(record.status === 'reworking' || record.status === 'pending') && canFinish && (
            <Button size="sm" onClick={() => openAction(record, 'finish')}>
              {t('rework.finishRework')}
            </Button>
          )}
          {record.status === 'pending_reinspect' && canReinspect && (
            <Button size="sm" onClick={() => openAction(record, 'reinspect')}>
              {t('rework.reinspect')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-[12px] p-4 border border-border">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">{t('rework.reworkNo')}</label>
            <Input value={reworkNo} onChange={(e) => setReworkNo(e.target.value)} placeholder={t('rework.reworkNo')} />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">{t('material.materialCode')}</label>
            <Input
              value={materialCode}
              onChange={(e) => setMaterialCode(e.target.value)}
              placeholder={t('material.materialCode')}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">{t('common.status')}</label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('common.all')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t('common.all')}</SelectItem>
                <SelectItem value="pending">{t('rework.status_pending')}</SelectItem>
                <SelectItem value="reworking">{t('rework.status_reworking')}</SelectItem>
                <SelectItem value="pending_reinspect">{t('rework.status_pending_reinspect')}</SelectItem>
                <SelectItem value="passed">{t('rework.status_passed')}</SelectItem>
                <SelectItem value="failed">{t('rework.status_failed')}</SelectItem>
                <SelectItem value="closed">{t('rework.status_closed')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={handleReset}>
            {t('common.reset')}
          </Button>
          <Button onClick={handleSearch}>{t('common.search')}</Button>
        </div>
      </div>

      <div className="bg-card rounded-[12px] p-4 border border-border">
        <ResizableTable
          columns={columns}
          dataSource={data}
          loading={loading}
          rowKey="id"
          scroll={{ x: 1700, y: 500 }}
          pagination={{
            current: page,
            pageSize,
            total,
            onChange: (p: number) => fetchData(p),
            showSizeChanger: false,
          }}
        />
      </div>

      {/* 详情弹窗 */}
      <Dialog open={detailDialog} onOpenChange={setDetailDialog}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t('rework.detailTitle')} - {detailData?.reworkNo}
            </DialogTitle>
          </DialogHeader>
          {detailData && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 bg-muted p-3 rounded-md text-sm">
                <div>
                  <span className="text-muted-foreground">{t('supplierReturn.mrbNo')}：</span>
                  <span className="font-medium">{detailData.mrbNo || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('material.materialCode')}：</span>
                  <span className="font-medium">{detailData.materialCode || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('material.materialName')}：</span>
                  <span className="font-medium">{tui(detailData.materialName) || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('common.batch')}：</span>
                  <span className="font-medium">{detailData.batchNo || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('common.quantity')}：</span>
                  <span className="font-medium">
                    {detailData.quantity} {detailData.unit}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('common.status')}：</span>
                  {getStatusBadge(detailData.status)}
                </div>
                <div>
                  <span className="text-muted-foreground">{t('rework.sourceLocation')}：</span>
                  <span className="font-medium">{detailData.sourceLocationCode || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('rework.targetLocation')}：</span>
                  <span className="font-medium">{detailData.targetLocationCode || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('rework.finishTime')}：</span>
                  <span className="font-medium">
                    {detailData.finishTime ? new Date(detailData.finishTime).toLocaleString('zh-CN') : '-'}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('rework.reinspectTime')}：</span>
                  <span className="font-medium">
                    {detailData.reinspectTime ? new Date(detailData.reinspectTime).toLocaleString('zh-CN') : '-'}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('rework.reinspectResult')}：</span>
                  <span className="font-medium">
                    {detailData.reinspectResult
                      ? detailData.reinspectResult === 'pass'
                        ? t('common.pass')
                        : t('common.fail')
                      : '-'}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('rework.finishRemark')}：</span>
                  <span className="font-medium">{detailData.finishRemark || '-'}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">{t('rework.reinspectRemark')}：</span>
                  <span className="font-medium">{detailData.reinspectRemark || '-'}</span>
                </div>
                <div className="col-span-2 md:col-span-3">
                  <span className="text-muted-foreground">{t('common.remark')}：</span>
                  <span className="font-medium">{detailData.remark || '-'}</span>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 操作弹窗 */}
      <Dialog open={!!actionDialog} onOpenChange={(open) => !open && setActionDialog(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {actionDialog === 'start'
                ? t('rework.startRework')
                : actionDialog === 'finish'
                  ? t('rework.finishRework')
                  : t('rework.reinspect')}
              {actionOrder ? ` - ${actionOrder.reworkNo}` : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-foreground">
              {actionDialog === 'start'
                ? t('rework.startTip')
                : actionDialog === 'finish'
                  ? t('rework.finishTip')
                  : t('rework.reinspectTip')}
            </div>

            {/* 确认类动作先把「确认的是哪批货」摆出来，避免看错行点错单 */}
            {actionOrder && actionDialog !== 'start' && (
              <div className="rounded-md bg-muted p-3 text-xs space-y-1">
                <div>
                  <span className="text-muted-foreground">{t('material.materialCode')}：</span>
                  <span className="font-medium">
                    {[actionOrder.materialCode, tui(actionOrder.materialName)].filter(Boolean).join(' ') || '-'}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('common.batch')}：</span>
                  <span className="font-medium">{actionOrder.batchNo || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('common.quantity')}：</span>
                  <span className="font-medium">
                    {actionOrder.quantity} {actionOrder.unit}
                  </span>
                </div>
                {actionOrder.mrbNo && (
                  <div>
                    <span className="text-muted-foreground">{t('supplierReturn.mrbNo')}：</span>
                    <span className="font-medium">{actionOrder.mrbNo}</span>
                  </div>
                )}
              </div>
            )}

            {actionDialog === 'finish' && (
              <div className="rounded-md border border-primary/30 bg-primary-soft px-3 py-2 text-xs text-foreground">
                {t('rework.iqcNotifyHint')}
              </div>
            )}

            {actionDialog === 'reinspect' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    {t('rework.reinspectResult')}
                  </label>
                  <Select value={reinspectResult} onValueChange={(v) => setReinspectResult(v as 'pass' | 'fail')}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pass">{t('rework.reinspectPass')}</SelectItem>
                      <SelectItem value="fail">{t('rework.reinspectFail')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div
                  className={`rounded-md px-3 py-2 text-xs border ${
                    reinspectResult === 'pass'
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                      : 'border-destructive/40 bg-destructive/10 text-destructive'
                  }`}
                >
                  {reinspectResult === 'pass'
                    ? t('rework.reinspectPassEffect')
                    : t('rework.reinspectFailEffect')}
                </div>
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">{t('common.remark')}</label>
              <Textarea value={actionRemark} onChange={(e) => setActionRemark(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setActionDialog(false)} disabled={submitting}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSubmitAction} disabled={submitting}>
              {actionDialog === 'finish'
                ? t('rework.confirmFinishBtn')
                : actionDialog === 'reinspect'
                  ? reinspectResult === 'pass'
                    ? t('rework.confirmPassBtn')
                    : t('rework.confirmFailBtn')
                  : t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ReworkList;
