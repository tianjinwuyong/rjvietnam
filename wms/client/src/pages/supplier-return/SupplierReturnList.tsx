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
import {
  getSupplierReturnList,
  getSupplierReturnDetail,
  confirmSupplierReturnOutbound,
  cancelSupplierReturn,
} from '@client/src/api/supplier-return';
import type { SupplierReturnOrder } from '@shared/api.interface';

const SupplierReturnList: React.FC = () => {
  const { t } = useI18n();
  const { role } = useAuth();

  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [data, setData] = useState<SupplierReturnOrder[]>([]);
  const [loading, setLoading] = useState(false);

  const [returnNo, setReturnNo] = useState('');
  const [status, setStatus] = useState('');
  const [supplierCode, setSupplierCode] = useState('');

  // 详情
  const [detailDialog, setDetailDialog] = useState(false);
  const [detailData, setDetailData] = useState<SupplierReturnOrder | null>(null);

  // 出库 / 取消
  const [actionDialog, setActionDialog] = useState<false | 'outbound' | 'cancel'>(false);
  const [actionOrder, setActionOrder] = useState<SupplierReturnOrder | null>(null);
  const [actionRemark, setActionRemark] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchData = async (p: number = page) => {
    setLoading(true);
    try {
      const result = await getSupplierReturnList({
        page: p,
        pageSize,
        returnNo: returnNo || undefined,
        status: status || undefined,
        supplierCode: supplierCode || undefined,
      });
      setData(result.data.items);
      setTotal(result.data.total);
      setPage(p);
    } catch (error) {
      logger.error('get supplier return list failed', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(1);
  }, []);

  const handleSearch = () => fetchData(1);

  const handleReset = () => {
    setReturnNo('');
    setStatus('');
    setSupplierCode('');
    fetchData(1);
  };

  const getStatusBadge = (s: string) => {
    const map: Record<string, { variant: string; label: string }> = {
      pending_out: { variant: 'outline', label: t('supplierReturn.status_pending_out') },
      out: { variant: 'default', label: t('supplierReturn.status_out') },
      cancelled: { variant: 'destructive', label: t('supplierReturn.status_cancelled') },
    };
    const cfg = map[s] || { variant: 'outline', label: s };
    return <Badge variant={cfg.variant as any}>{cfg.label}</Badge>;
  };

  const handleViewDetail = async (id: string) => {
    try {
      const result = await getSupplierReturnDetail(id);
      setDetailData(result.data);
      setDetailDialog(true);
    } catch (error) {
      logger.error('get supplier return detail failed', error);
      toast.error(t('supplierReturn.getDetailFailed'));
    }
  };

  const openAction = (order: SupplierReturnOrder, type: 'outbound' | 'cancel') => {
    setActionOrder(order);
    setActionRemark('');
    setActionDialog(type);
  };

  const handleSubmitAction = async () => {
    if (!actionOrder || !actionDialog) return;
    setSubmitting(true);
    try {
      const payload = {
        orderId: actionOrder.id,
        operatorId: role?.userId || undefined,
        remark: actionRemark || undefined,
      };
      if (actionDialog === 'outbound') {
        await confirmSupplierReturnOutbound(payload);
        toast.success(t('supplierReturn.outboundSuccess'));
      } else {
        await cancelSupplierReturn(payload);
        toast.success(t('supplierReturn.cancelSuccess'));
      }
      setActionDialog(false);
      fetchData(page);
    } catch (error: any) {
      logger.error('supplier return action failed', error);
      toast.error(error?.response?.data?.message || t('supplierReturn.actionFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const columns: TableProps<SupplierReturnOrder>['columns'] = [
    {
      title: t('common.serialNo'),
      key: 'index',
      width: 70,
      fixed: 'left',
      render: (_: any, __: any, index: number) => (page - 1) * pageSize + index + 1,
    },
    { title: t('supplierReturn.returnNo'), dataIndex: 'returnNo', width: 170 },
    { title: t('supplierReturn.mrbNo'), dataIndex: 'mrbNo', width: 170, render: (v: string) => v || '-' },
    {
      title: t('supplierReturn.supplier'),
      dataIndex: 'supplierName',
      width: 200,
      render: (v: string, r: SupplierReturnOrder) => v || r.supplierCode || '-',
    },
    { title: t('common.batch'), dataIndex: 'batchNo', width: 140, render: (v: string) => v || '-' },
    { title: t('supplierReturn.totalQty'), dataIndex: 'totalQty', width: 110, align: 'right' },
    { title: t('supplierReturn.outQty'), dataIndex: 'outQty', width: 110, align: 'right' },
    { title: t('common.unit'), dataIndex: 'unit', width: 80 },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 120,
      render: (s: string) => getStatusBadge(s),
    },
    {
      title: t('supplierReturn.outTime'),
      dataIndex: 'outTime',
      width: 165,
      render: (v: string) => (v ? new Date(v).toLocaleString('zh-CN') : '-'),
    },
    {
      title: t('common.operation'),
      key: 'action',
      width: 220,
      fixed: 'right',
      render: (_: any, record: SupplierReturnOrder) => (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => handleViewDetail(record.id)}>
            {t('common.detail')}
          </Button>
          {record.status === 'pending_out' && (
            <>
              <Button size="sm" onClick={() => openAction(record, 'outbound')}>
                {t('supplierReturn.confirmOutbound')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => openAction(record, 'cancel')}>
                {t('common.cancel')}
              </Button>
            </>
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
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('supplierReturn.returnNo')}
            </label>
            <Input value={returnNo} onChange={(e) => setReturnNo(e.target.value)} placeholder={t('supplierReturn.returnNo')} />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('supplierReturn.supplierCode')}
            </label>
            <Input
              value={supplierCode}
              onChange={(e) => setSupplierCode(e.target.value)}
              placeholder={t('supplierReturn.supplierCode')}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('common.status')}
            </label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('common.all')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t('common.all')}</SelectItem>
                <SelectItem value="pending_out">{t('supplierReturn.status_pending_out')}</SelectItem>
                <SelectItem value="out">{t('supplierReturn.status_out')}</SelectItem>
                <SelectItem value="cancelled">{t('supplierReturn.status_cancelled')}</SelectItem>
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
          scroll={{ x: 1500, y: 500 }}
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
              {t('supplierReturn.detailTitle')} - {detailData?.returnNo}
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
                  <span className="text-muted-foreground">{t('supplierReturn.supplier')}：</span>
                  <span className="font-medium">
                    {detailData.supplierName || detailData.supplierCode || '-'}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('common.batch')}：</span>
                  <span className="font-medium">{detailData.batchNo || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('common.status')}：</span>
                  {getStatusBadge(detailData.status)}
                </div>
                <div>
                  <span className="text-muted-foreground">{t('supplierReturn.totalQty')}：</span>
                  <span className="font-medium">
                    {detailData.totalQty} {detailData.unit}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('supplierReturn.outQty')}：</span>
                  <span className="font-medium">
                    {detailData.outQty} {detailData.unit}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('supplierReturn.outTime')}：</span>
                  <span className="font-medium">
                    {detailData.outTime ? new Date(detailData.outTime).toLocaleString('zh-CN') : '-'}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">{t('common.remark')}：</span>
                  <span className="font-medium">{detailData.remark || '-'}</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t('supplierReturn.itemDetail')}
                </label>
                <div className="border rounded-md overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-foreground w-10">{t('common.serialNo')}</th>
                        <th className="px-3 py-2 text-left font-medium text-foreground">{t('material.materialCode')}</th>
                        <th className="px-3 py-2 text-left font-medium text-foreground">{t('material.materialName')}</th>
                        <th className="px-3 py-2 text-left font-medium text-foreground">{t('common.batch')}</th>
                        <th className="px-3 py-2 text-left font-medium text-foreground">{t('supplierReturn.location')}</th>
                        <th className="px-3 py-2 text-right font-medium text-foreground">{t('supplierReturn.returnQty')}</th>
                        <th className="px-3 py-2 text-right font-medium text-foreground">{t('supplierReturn.outQty')}</th>
                        <th className="px-3 py-2 text-left font-medium text-foreground">{t('common.unit')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detailData.items || []).length === 0 ? (
                        <tr>
                          <td className="px-3 py-4 text-center text-muted-foreground" colSpan={8}>
                            {t('common.noData')}
                          </td>
                        </tr>
                      ) : (
                        (detailData.items || []).map((it, idx) => (
                          <tr key={it.id} className="border-t">
                            <td className="px-3 py-2">{idx + 1}</td>
                            <td className="px-3 py-2">{it.materialCode || '-'}</td>
                            <td className="px-3 py-2">{tui(it.materialName) || '-'}</td>
                            <td className="px-3 py-2">{it.batchNo || '-'}</td>
                            <td className="px-3 py-2">{it.locationCode || '-'}</td>
                            <td className="px-3 py-2 text-right">{it.quantity}</td>
                            <td className="px-3 py-2 text-right">{it.outQty}</td>
                            <td className="px-3 py-2">{it.unit}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 出库 / 取消 弹窗 */}
      <Dialog open={!!actionDialog} onOpenChange={(open) => !open && setActionDialog(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {actionDialog === 'outbound' ? t('supplierReturn.confirmOutbound') : t('supplierReturn.cancelOrder')}
              {actionOrder ? ` - ${actionOrder.returnNo}` : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-foreground">
              {actionDialog === 'outbound'
                ? t('supplierReturn.outboundTip')
                : t('supplierReturn.cancelTip')}
            </div>
            {actionOrder && (
              <div className="text-sm text-muted-foreground">
                {t('supplierReturn.totalQty')}：{actionOrder.totalQty} {actionOrder.unit}
              </div>
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
            <Button
              variant={actionDialog === 'cancel' ? 'destructive' : 'default'}
              onClick={handleSubmitAction}
              disabled={submitting}
            >
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SupplierReturnList;
