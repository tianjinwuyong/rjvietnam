import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@client/src/components/ui/input';
import { Button } from '@client/src/components/ui/button';
import { Card, CardContent } from '@client/src/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import { Table } from '@client/src/compat/antd-table';
import { Badge } from '@client/src/components/ui/badge';
import { toast } from 'sonner';
import { getRecordList } from '@client/src/api/iqc';
import { logger } from '@client/src/utils/logger';
import { renderDate, renderDateTimeMinute } from '@client/src/utils/datetime';
import { useI18n, tf, tui } from '../../i18n';

const IqcRecord: React.FC = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [data, setData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [materialCode, setMaterialCode] = useState('');
  const [supplierCode, setSupplierCode] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [finalResult, setFinalResult] = useState('');

  const fetchData = async (
    p = {
      page,
      materialCode,
      supplierCode,
      batchNo,
      finalResult,
    },
  ) => {
    try {
      setLoading(true);
      // 服务端筛选 + 分页（此前取前 100 条再本地过滤，超过 100 条的记录会漏掉）
      const res: any = await getRecordList({
        page: p.page,
        pageSize: 20,
        reviewStatus: 'approved',
        materialCode: p.materialCode || undefined,
        supplierCode: p.supplierCode || undefined,
        batchNo: p.batchNo || undefined,
        finalResult: p.finalResult || undefined,
      });
      setData(res?.items || []);
      setTotal(Number(res?.total || 0));
      setPage(p.page);
    } catch (e) {
      logger.error('fetch record failed', e);
      toast.error(t('message.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData({ page: 1, materialCode: '', supplierCode: '', batchNo: '', finalResult: '' }); }, []);

  const handleSearch = () => { fetchData({ page: 1, materialCode, supplierCode, batchNo, finalResult }); };
  const handleReset = () => {
    setMaterialCode('');
    setSupplierCode('');
    setBatchNo('');
    setFinalResult('');
    fetchData({ page: 1, materialCode: '', supplierCode: '', batchNo: '', finalResult: '' });
  };

  // 列结构与待检清单保持一致（检验编号/报检时间/批次号/物料/供应商/数量/生产日期/检验员/状态/物料来源），
  // 仅「状态」「操作」按已完成检验场景变化：状态显示检验结果，操作为查看/打印
  const columns = [
    {
      title: t('iqc.reportNo'),
      key: 'inspectionNo',
      width: 148,
      render: (_: any, record: any) => (
        <span className="font-mono text-sm font-medium text-foreground">{record.lot?.inspectionNo || record.reportNo || '-'}</span>
      ),
    },
    {
      title: t('iqc.submittedAt'),
      key: 'submittedAt',
      width: 140,
      render: (_: any, record: any) => <span className="text-foreground">{renderDateTimeMinute(record.lot?.createdAt)}</span>,
    },
    { title: t('iqc.batchNo'), dataIndex: ['lot', 'batchNo'], width: 100, render: (val: string) => <span>{val || '-'}</span> },
    { title: t('iqc.materialCode'), dataIndex: ['lot', 'materialCode'], width: 115 },
    { title: t('iqc.materialName'), dataIndex: ['lot', 'materialName'], width: 120, render: (val: string) => <span className="block truncate" title={val}>{val || '-'}</span> },
    { title: t('print.supplier'), dataIndex: ['lot', 'supplierName'], width: 130, render: (val: string) => <span className="block truncate" title={val}>{val || '-'}</span> },
    { title: t('pda.mrb.qty'), dataIndex: ['lot', 'totalQty'], width: 70 },
    { title: t('common.productionDate'), dataIndex: ['lot', 'productionDate'], width: 105, render: (val: string) => renderDate(val) },
    {
      title: t('iqc.inspector'),
      dataIndex: ['lot', 'inspectorName'],
      // 95px 装不下「系统管理员」这类 5 字姓名，会折成两行；放宽并单行省略
      width: 120,
      render: (val: string) => (
        <span className="block truncate" title={tui(val) || ''}>{tui(val) || '-'}</span>
      ),
    },
    {
      title: t('common.status'),
      dataIndex: 'finalResult',
      width: 92,
      render: (val: string) => {
        const map: Record<string, { text: string; color: string }> = {
          pass: { text: 'Pass', color: 'bg-green-100 text-green-800' },
          fail: { text: 'Fail', color: 'bg-red-100 text-red-800' },
        };
        const item = map[val] || { text: val, color: 'bg-muted text-foreground' };
        return <Badge className={item.color}>{item.text}</Badge>;
      },
    },
    {
      title: t('print.materialSource'),
      key: 'materialSource',
      width: 92,
      render: (_: any, record: any) => {
        const val = record.lot?.materialSource;
        if (val === 'production_return' || val === '产线退料') return <span className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">{t('ui.产线退料')}</span>;
        if (record.lot?.remark === '超期物料报检' || val === 'expiry_reinspect' || val === '超期复检') return <span className="px-1.5 py-0.5 text-xs bg-orange-100 text-orange-700 rounded">{t('ui.超期复检')}</span>;
        return <span className="px-1.5 py-0.5 text-xs bg-muted text-foreground rounded">{t('ui.来料检验')}</span>;
      },
    },
    { title: t('common.action'), width: 160, render: (_: any, record: any) => (
      <div className="flex gap-2">
        <Button size="sm" style={{ backgroundColor: 'var(--primary)' }} onClick={() => navigate(`/iqc/report-view/${record.id}`)}>{t('common.view')}</Button>
        <Button size="sm" style={{ backgroundColor: '#10B981' }} onClick={() => navigate(`/iqc/report-view/${record.id}?print=1`)}>{t('system.print')}</Button>
      </div>
    )},
  ];

  return (
    <div className="space-y-4 p-6">
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-4 gap-4 mb-4">
            <Input placeholder={t('iqc.materialCode')} value={materialCode} onChange={e => setMaterialCode(e.target.value)} />
            <Input placeholder={t('material.supplierCode')} value={supplierCode} onChange={e => setSupplierCode(e.target.value)} />
            <Input placeholder={t('iqc.batchNo')} value={batchNo} onChange={e => setBatchNo(e.target.value)} />
            <Select value={finalResult} onValueChange={setFinalResult}>
              <SelectTrigger>
                <SelectValue placeholder={t('common.all')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t('common.all')}</SelectItem>
                <SelectItem value="pass">{t('iqc.status_pass')}</SelectItem>
                <SelectItem value="fail">{t('iqc.status_fail')}</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-2 col-span-4 justify-end">
              <Button variant="secondary" onClick={handleReset}>{t('common.reset')}</Button>
              <Button onClick={handleSearch}>{t('common.search')}</Button>
            </div>
          </div>
          <Table
            columns={columns}
            dataSource={data}
            rowKey="id"
            loading={loading}
            pagination={{
              current: page,
              pageSize: 20,
              total,
              showSizeChanger: false,
              showTotal: (n: number) => tf('ui.共 {n} 条', { n }),
              onChange: (p: number) => fetchData({ page: p, materialCode, supplierCode, batchNo, finalResult }),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default IqcRecord;
