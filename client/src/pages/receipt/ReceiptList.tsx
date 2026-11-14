import React, { useState, useEffect } from 'react';
import { useI18n, tf, tui } from '@client/src/i18n';
import { Input } from '@client/src/components/ui/input';
import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import { Card, CardContent } from '@client/src/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import ResizableTable from '@client/src/components/ui/resizable-table';
import { Table, type TableProps } from '@client/src/compat/antd-table';
import { logger } from '@client/src/utils/logger';
import { renderDate } from '@client/src/utils/datetime';
import { toast } from 'sonner';
import { getReceiptList, previewSubmitIqc, submitIqc } from '@client/src/api/receipt';
import { showConfirm } from '@client/src/compat';
import type { ReceiptOrder } from '@shared/api.interface';

const ReceiptList: React.FC = () => {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [data, setData] = useState<ReceiptOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [iqcSubmitting, setIqcSubmitting] = useState(false);

  const [receiptNo, setReceiptNo] = useState('');
  const [supplierCode, setSupplierCode] = useState('');
  const [materialCode, setMaterialCode] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [status, setStatus] = useState('');

  const fetchData = async (p: number = page) => {
    setLoading(true);
    try {
      const result = await getReceiptList({
        page: p,
        pageSize,
        receiptNo: receiptNo || undefined,
        supplierCode: supplierCode || undefined,
        materialCode: materialCode || undefined,
        batchNo: batchNo || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        status: status || undefined,
      });
      setData(result.items);
      setTotal(result.total);
      setPage(p);
    } catch (error) {
      logger.error('get receipt list failed', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(1);
  }, []);

  const handleSearch = () => {
    fetchData(1);
  };

  const handleSubmitIqc = async () => {
    setIqcSubmitting(true);
    try {
      // UX-05：这个按钮的作用域是**全库**的待检收料单，不受当前筛选条件影响。
      // 原来点一下就直接提交、数量是事后 toast 才告知，且无反向接口。
      // 现在先取只读预览，把真实范围写进确认框再提交。
      const preview = await previewSubmitIqc();
      if (preview.receiptCount === 0) {
        toast.info(tf('ui.当前没有待提交检验的收料单'));
        return;
      }
      const ok = await showConfirm({
        title: t('ui.提交 IQC 检验'),
        content: tf(
          'ui.本次将提交【全部】待检收料单（不受当前筛选条件影响）：共 {n} 张收料单，合并为 {m} 个检验批次。提交后不可撤销。',
          { n: preview.receiptCount, m: preview.lotCount },
        ),
        okText: tf('ui.确认提交 {n} 张', { n: preview.receiptCount }),
        cancelText: t('common.cancel'),
      });
      if (!ok) return;

      const result = await submitIqc();
      const nos = result.inspectionNos || [];
      toast.success(
        tf('ui.已提交 {n} 条收料单，生成 {m} 个检验批次', {
          n: result.submittedReceiptCount,
          m: result.createdLotCount,
        }) + (nos.length > 0 ? tf('ui.，检验编号：{nos}', { nos: nos.join('、') }) : ''),
      );
      fetchData(page);
    } catch (error: any) {
      logger.error('submit iqc failed', error);
      toast.error(error?.response?.data?.message || t('ui.提交IQC检验失败'));
    } finally {
      setIqcSubmitting(false);
    }
  };

  const handleReset = () => {
    setReceiptNo('');
    setSupplierCode('');
    setMaterialCode('');
    setBatchNo('');
    setStartDate('');
    setEndDate('');
    setStatus('');
    fetchData(1);
  };

  const rawColumns: TableProps<ReceiptOrder>['columns'] = [
    {
      title: t('common.serialNo'),
      key: 'index',
      width: 70,
      fixed: 'left',
      render: (_: any, __: any, index: number) => (page - 1) * pageSize + index + 1,
    },
    { title: t('receipt.receiptDate'), dataIndex: 'receiptDate', width: 120, render: renderDate },
    { title: t('material.supplierName'), dataIndex: 'supplierName', width: 160 },
    { title: t('material.materialCode'), dataIndex: 'materialCode', width: 140 },
    {
      title: t('common.quantity'),
      dataIndex: 'quantity',
      width: 100,
      align: 'right',
    },
    { title: t('common.unit'), dataIndex: 'unit', width: 80 },
    { title: t('receipt.productionDate'), dataIndex: 'productionDate', width: 120, render: renderDate },
    { title: t('receipt.batchNo'), dataIndex: 'batchNo', width: 120 },
    { title: t('receipt.serialNumber'), dataIndex: 'serialNo', width: 100 },
    { title: t('receipt.keeper'), dataIndex: 'keeperName', width: 120, render: (v: string) => tui(v) || '-' },
    { title: t('receipt.locationCode'), dataIndex: 'locationCode', width: 140 },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 100,
      render: (status: string) => statusBadge(status),
    },
  ];

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
      pending: { variant: 'secondary', label: t('receipt.status_pending') },
      received: { variant: 'default', label: t('receipt.status_received') },
      cancelled: { variant: 'destructive', label: t('receipt.status_cancelled') },
      pending_iqc: { variant: 'default', label: t('receipt.status_pending_iqc') },
      iqc_pass: { variant: 'default', label: t('receipt.status_iqc_pass') },
      iqc_fail: { variant: 'destructive', label: t('receipt.status_iqc_fail') },
    };
    const cfg = map[status] || { variant: 'outline' as const, label: status };
    return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('receipt.receiptNo')}
              </label>
              <Input
                value={receiptNo}
                onChange={(e) => setReceiptNo(e.target.value)}
                placeholder={t('receipt.receiptNo')}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('material.supplierCode')}
              </label>
              <Input
                value={supplierCode}
                onChange={(e) => setSupplierCode(e.target.value)}
                placeholder={t('material.supplierCode')}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('material.materialCode')}
              </label>
              <Input
                value={materialCode}
                onChange={(e) => setMaterialCode(e.target.value)}
                placeholder={t('material.materialCode')}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('receipt.batchNo')}
              </label>
              <Input
                value={batchNo}
                onChange={(e) => setBatchNo(e.target.value)}
                placeholder={t('receipt.batchNo')}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                 {t('common.startDate')}
              </label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                 {t('common.endDate')}
              </label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
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
                  <SelectItem value="pending_iqc">{t('receipt.pendingIqc')}</SelectItem>
                   <SelectItem value="iqc_pass">{t('iqc.passed')}</SelectItem>
                   <SelectItem value="iqc_fail">{t('iqc.failed')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2 justify-between items-center">
            <div>
              <Button onClick={handleSubmitIqc} disabled={iqcSubmitting}>
                {iqcSubmitting ? t('pda.submitting') : t('ui.提交IQC检验')}
              </Button>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={handleReset}>
                {t('common.reset')}
              </Button>
              <Button onClick={handleSearch}>{t('common.search')}</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          {/* 列表只留「还没交给 IQC」的单据，交出去的由 IQC 模块负责，避免仓库重复看到 */}
          <p className="mb-3 text-xs text-muted-foreground">
            {t('ui.已提交 IQC 检验的收料单不再显示，可在上方「状态」筛选查看历史')}
          </p>
          <ResizableTable
            columns={rawColumns}
            dataSource={data}
            loading={loading}
            rowKey="id"
            scroll={{ x: 1400, y: 500 }}
            pagination={{
              current: page,
              pageSize,
              total,
              onChange: (p: number) => fetchData(p),
              showSizeChanger: false,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default ReceiptList;
