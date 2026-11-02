import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Card, CardContent } from '@client/src/components/ui/card';
import { useI18n } from '../../i18n';

interface TraceRecord {
  id: string;
  recordType: string;
  recordTypeLabel: string;
  txTime: string;
  materialCode: string;
  materialName: string;
  batchNo: string;
  qty: number;
  unit: string;
  docNo: string;
  remark: string;
  productionDate: string;
  supplierName: string;
  supplierCode: string;
}

const buildTypeBadge = (
  t: (key: string) => string,
): Record<string, { text: string; cls: string }> => ({
  issue: { text: t('ui.发料'), cls: 'bg-blue-100 text-blue-700' },
  defective_transfer: { text: t('ui.不良品调拨'), cls: 'bg-orange-100 text-orange-700' },
  mrb: { text: t('ui.不良品处理'), cls: 'bg-red-100 text-red-700' },
});

const MaterialTraceQuery: React.FC = () => {
  const { t } = useI18n();
  const TYPE_BADGE = buildTypeBadge(t);
  const [materialCode, setMaterialCode] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [productionDate, setProductionDate] = useState('');
  const [supplier, setSupplier] = useState('');
  const [records, setRecords] = useState<TraceRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (materialCode) params.set('materialCode', materialCode);
      if (batchNo) params.set('batchNo', batchNo);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      if (productionDate) params.set('productionDate', productionDate);
      if (supplier) params.set('supplier', supplier);
      const wmsUser = JSON.parse(localStorage.getItem('wms-user') || '{}');
      const res = await fetch(`/api/workorder/trace-records?${params.toString()}`, {
        headers: { Authorization: `Bearer ${wmsUser.token}` }
      });
      const data = await res.json();
      setRecords(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total) || 0);
      setSearched(true);
    } catch (e) {
      alert(t('pda.inventory.queryFailed'));
    } finally {
      setLoading(false);
    }
  };

  const resetFilters = () => {
    setMaterialCode('');
    setBatchNo('');
    setStartDate('');
    setEndDate('');
    setProductionDate('');
    setSupplier('');
    setRecords([]);
    setTotal(0);
    setSearched(false);
  };

  return (
    <div className="p-6 space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-4 mb-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t('iqc.materialCode')}</label>
              <Input placeholder={t('iqc.materialCode')} value={materialCode} onChange={e => setMaterialCode(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t('iqc.batchNo')}</label>
              <Input placeholder={t('iqc.batchNo')} value={batchNo} onChange={e => setBatchNo(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t('common.startDate')}</label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t('common.endDate')}</label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t('common.productionDate')}</label>
              <Input type="date" value={productionDate} onChange={e => setProductionDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t('stockTake.supplierSearch')}</label>
              <Input placeholder={t('ui.名称或代码')} value={supplier} onChange={e => setSupplier(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button className="gap-2" onClick={fetchRecords} disabled={loading}>
              <Search className="w-4 h-4" />
              {loading ? t('ui.查询中') : t('common.search')}
            </Button>
            <Button variant="outline" onClick={resetFilters}>{t('common.reset')}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-3 text-sm text-muted-foreground border-b">
            {t('ui.共')} <span className="font-bold text-foreground">{total}</span> {t('ui.条追溯记录')}
            <span className="ml-3 text-xs">
              {t('ui.类型：')}<span className="inline-block px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">{t('ui.发料')}</span>
              <span className="inline-block px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 ml-1">{t('nav.defectiveTransfer')}</span>
              <span className="inline-block px-1.5 py-0.5 rounded bg-red-100 text-red-700 ml-1">{t('ui.不良品处理')}</span>
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted border-b">
                <tr>
                  <th className="text-left p-3 font-medium">{t('common.time')}</th>
                  <th className="text-left p-3 font-medium">{t('common.type')}</th>
                  <th className="text-left p-3 font-medium">{t('iqc.materialCode')}</th>
                  <th className="text-left p-3 font-medium">{t('iqc.materialName')}</th>
                  <th className="text-left p-3 font-medium">{t('iqc.batchNo')}</th>
                  <th className="text-right p-3 font-medium">{t('pda.mrb.qty')}</th>
                  <th className="text-left p-3 font-medium">{t('iqc.unit')}</th>
                  <th className="text-left p-3 font-medium">{t('common.productionDate')}</th>
                  <th className="text-left p-3 font-medium">{t('print.supplier')}</th>
                  <th className="text-left p-3 font-medium">{t('ui.单据号')}</th>
                  <th className="text-left p-3 font-medium">{t('iqc.remark')}</th>
                </tr>
              </thead>
              <tbody>
                {records.length === 0 ? (
                  <tr><td colSpan={11} className="p-8 text-center text-muted-foreground">
                    {searched ? t('ui.没有符合条件的追溯记录') : t('ui.请输入条件后点击查询')}
                  </td></tr>
                ) : records.map(r => {
                  const badge = TYPE_BADGE[r.recordType] || { text: r.recordTypeLabel, cls: 'bg-muted text-foreground' };
                  return (
                    <tr key={r.id} className="border-b hover:bg-muted">
                      <td className="p-3 text-xs whitespace-nowrap">{r.txTime}</td>
                      <td className="p-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs ${badge.cls}`}>{badge.text}</span>
                      </td>
                      <td className="p-3 font-mono text-xs">{r.materialCode}</td>
                      <td className="p-3">{r.materialName}</td>
                      <td className="p-3 font-mono text-xs">{r.batchNo}</td>
                      <td className="p-3 text-right font-bold text-red-600">{r.qty}</td>
                      <td className="p-3">{r.unit}</td>
                      <td className="p-3 text-xs">{r.productionDate || '-'}</td>
                      <td className="p-3 text-xs">{r.supplierName || '-'}</td>
                      <td className="p-3 font-mono text-xs">{r.docNo || '-'}</td>
                      <td className="p-3 text-xs max-w-[240px] truncate" title={r.remark}>{r.remark || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default MaterialTraceQuery;
