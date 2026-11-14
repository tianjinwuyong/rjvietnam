import React, { useState, useEffect, useCallback } from 'react';
import ResizableTable from '@client/src/components/ui/resizable-table';
import { Table, type TableProps } from '@client/src/compat/antd-table';
import { Input } from '@client/src/components/ui/input';
import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import { Card, CardContent } from '@client/src/components/ui/card';
import { Textarea } from '@client/src/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import {
  getProductionReturnPendingList,
  inspectProductionReturn,
  type ProductionReturnPendingItem,
} from '@client/src/api/iqc';
import { logger } from '@client/src/utils/logger';
import { renderDate, formatDateTime } from '@client/src/utils/datetime';
import { toast } from 'sonner';
import { useI18n, tf } from '../../i18n';

const ProductionReturnPending: React.FC = () => {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ProductionReturnPendingItem[]>([]);

  const [returnNo, setReturnNo] = useState('');
  const [materialCode, setMaterialCode] = useState('');
  const [supplierCode, setSupplierCode] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [inspectOpen, setInspectOpen] = useState(false);
  const [current, setCurrent] = useState<ProductionReturnPendingItem | null>(null);
  const [goodQty, setGoodQty] = useState(0);
  const [incomingDefectQty, setIncomingDefectQty] = useState(0);
  const [operationDefectQty, setOperationDefectQty] = useState(0);
  const [remark, setRemark] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(async (p: number = page) => {
    setLoading(true);
    try {
      const res = await getProductionReturnPendingList({
        page: p,
        pageSize,
        returnNo: returnNo || undefined,
        materialCode: materialCode || undefined,
        supplierCode: supplierCode || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setData(res.items);
      setTotal(res.total);
      setPage(p);
    } catch (error) {
      logger.error('Failed to fetch production return pending list:', String(error));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, returnNo, materialCode, supplierCode, startDate, endDate]);

  useEffect(() => {
    fetchData(1);
  }, []);

  const handleSearch = () => fetchData(1);
  const handleReset = () => {
    setReturnNo('');
    setMaterialCode('');
    setSupplierCode('');
    setStartDate('');
    setEndDate('');
    fetchData(1);
  };

  const openInspect = (record: ProductionReturnPendingItem) => {
    setCurrent(record);
    setGoodQty(record.quantity || 0);
    setIncomingDefectQty(0);
    setOperationDefectQty(0);
    setRemark('');
    setInspectOpen(true);
  };

  const returnQty = current?.quantity || 0;
  const sumQty = goodQty + incomingDefectQty + operationDefectQty;
  const sumValid = sumQty === returnQty && returnQty > 0;

  const handleSubmit = async () => {
    if (!current) return;
    if (!sumValid) {
      toast.error(t('ui.三种数量之和必须等于退料数量'));
      return;
    }
    setSubmitting(true);
    try {
      await inspectProductionReturn(current.id, {
        goodQty,
        incomingDefectQty,
        operationDefectQty,
        remark: remark || undefined,
      });
      toast.success(t('ui.检验提交成功'));
      setInspectOpen(false);
      fetchData(page);
    } catch (error: any) {
      const msg = error?.response?.data?.error?.message || error?.response?.data?.message || '检验提交失败';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const columns: TableProps<ProductionReturnPendingItem>['columns'] = [
    { title: t('ui.退料单号'), dataIndex: 'returnNo', width: 160, fixed: 'left' },
    { title: t('iqc.materialCode'), dataIndex: 'materialCode', width: 130 },
    { title: t('iqc.materialName'), dataIndex: 'materialName', width: 160 },
    { title: t('print.supplier'), dataIndex: 'supplierName', width: 140, render: (v: string) => v || '-' },
    { title: t('ui.退料数量'), dataIndex: 'quantity', width: 100, align: 'right' },
    { title: t('iqc.unit'), dataIndex: 'unit', width: 70 },
    { title: t('common.productionDate'), dataIndex: 'productionDate', width: 110, render: renderDate },
    { title: t('ui.退料原因'), dataIndex: 'returnReason', width: 100 },
    { title: t('ui.提交时间'), dataIndex: 'submittedAt', width: 160, render: (v: string) => formatDateTime(v) },
    {
      title: t('common.action'),
      key: 'action',
      fixed: 'right',
      width: 100,
      render: (_: any, record: ProductionReturnPendingItem) => (
        <Button size="sm" style={{ backgroundColor: 'var(--primary)' }} onClick={() => openInspect(record)}>
          {t('ui.检验')}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('ui.退料单号')}</label>
              <Input value={returnNo} onChange={(e) => setReturnNo(e.target.value)} placeholder={t('ui.退料单号')} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('iqc.materialCode')}</label>
              <Input value={materialCode} onChange={(e) => setMaterialCode(e.target.value)} placeholder={t('iqc.materialCode')} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('receipt.supplierCode')}</label>
              <Input value={supplierCode} onChange={(e) => setSupplierCode(e.target.value)} placeholder={t('receipt.supplierCode')} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('common.startDate')}</label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('common.endDate')}</label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={handleSearch}>{t('common.search')}</Button>
              <Button variant="outline" onClick={handleReset}>{t('common.reset')}</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <ResizableTable
            columns={columns}
            dataSource={data}
            loading={loading}
            rowKey="id"
            scroll={{ x: 1400, y: 500 }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: false,
              onChange: (p: number) => fetchData(p),
            }}
          />
        </CardContent>
      </Card>

      <Dialog open={inspectOpen} onOpenChange={setInspectOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{tf('ui.产线退料检验 - {no}', { no: current?.returnNo ?? '' })}</DialogTitle>
          </DialogHeader>
          {current && (
            <div className="space-y-4">
              <div className="bg-muted rounded-md p-3 text-sm space-y-1">
                <div className="grid grid-cols-2 gap-2">
                  <div><span className="text-muted-foreground">{t('ui.物料编码：')}</span>{current.materialCode}</div>
                  <div><span className="text-muted-foreground">{t('ui.物料名称：')}</span>{current.materialName}</div>
                  <div><span className="text-muted-foreground">{t('ui.供应商：')}</span>{current.supplierName || '-'}</div>
                  <div><span className="text-muted-foreground">{t('ui.退料数量：')}</span>{current.quantity} {current.unit}</div>
                  <div><span className="text-muted-foreground">{t('ui.生产日期：')}</span>{renderDate(current.productionDate)}</div>
                  <div><span className="text-muted-foreground">{t('ui.批次号：')}</span>{current.batchNo || '-'}</div>
                  <div><span className="text-muted-foreground">{t('ui.退料原因：')}</span>{current.returnReason || '-'}</div>
                  <div><span className="text-muted-foreground">{t('ui.工单号：')}</span>{current.workOrderNo || '-'}</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">{t('ui.良品数量')}</label>
                  <Input
                    type="number"
                    value={goodQty || ''}
                    onChange={(e) => setGoodQty(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">{t('ui.来料不良数量')}</label>
                  <Input
                    type="number"
                    value={incomingDefectQty || ''}
                    onChange={(e) => setIncomingDefectQty(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">{t('ui.作业不良数量')}</label>
                  <Input
                    type="number"
                    value={operationDefectQty || ''}
                    onChange={(e) => setOperationDefectQty(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className={`flex items-center gap-2 text-sm font-medium ${sumValid ? 'text-green-600' : 'text-red-600'}`}>
                <span>{tf('ui.合计：{n} / 退料数量：{m}', { n: sumQty, m: returnQty })}</span>
                {!sumValid && <span>{t('ui.（数量不匹配）')}</span>}
              </div>

              <div>
                <label className="text-sm text-muted-foreground mb-1 block">{t('iqc.remark')}</label>
                <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} placeholder={t('ui.检验备注')} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setInspectOpen(false)}>{t('pda.cancel')}</Button>
            <Button onClick={handleSubmit} disabled={!sumValid || submitting}>
              {submitting ? t('pda.submitting') : t('ui.提交检验')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProductionReturnPending;
