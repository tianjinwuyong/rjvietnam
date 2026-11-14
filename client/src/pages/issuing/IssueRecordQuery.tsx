import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Card, CardContent } from '@client/src/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
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
  stockStatus?: string;
}

/** 仓库异动类型清单（tx_type → 中文标签），与后端 TRACE_TYPE_LABEL 保持一致 */
const TRACE_TYPES: { value: string; label: string }[] = [
  { value: 'receipt_in', label: '收货入库' },
  { value: 'iqc_release_in', label: 'IQC放行入库' },
  { value: 'production_return_in', label: '生产退料入库' },
  { value: 'rework_in', label: '返工入库' },
  { value: 'issue', label: '发料' },
  { value: 'split_remain', label: '分拆余料' },
  { value: 'mrb_return_out', label: '退货出库' },
  { value: 'mrb_other_customer_out', label: '客供出库' },
  { value: 'defective_transfer_out', label: '不良品调拨(出)' },
  { value: 'defective_transfer_in', label: '不良品调拨(入)' },
  { value: 'defective_move_out', label: '不良品移库(出)' },
  { value: 'defective_move_in', label: '不良品移库(入)' },
  { value: 'adjust', label: '盘点调整' },
  { value: 'manual_merge', label: '手动合并' },
  { value: 'mrb_special_admit', label: '让步接收' },
  { value: 'mrb_rework', label: '返工' },
  { value: 'mrb_scrap', label: '报废' },
  { value: 'mrb_return_cancel', label: '退货取消' },
  { value: 'rework_fail', label: '返工失败' },
];

/** 类型 → 徽章颜色（按业务分组配色） */
const TYPE_BADGE_COLORS: Record<string, string> = {
  // 入库类（绿色）
  receipt_in: 'bg-green-100 text-green-700',
  iqc_release_in: 'bg-green-100 text-green-700',
  production_return_in: 'bg-green-100 text-green-700',
  rework_in: 'bg-green-100 text-green-700',
  // 出库类（蓝色）
  issue: 'bg-blue-100 text-blue-700',
  split_remain: 'bg-blue-100 text-blue-700',
  mrb_return_out: 'bg-blue-100 text-blue-700',
  mrb_other_customer_out: 'bg-blue-100 text-blue-700',
  // 调拨/移库类（紫色）
  defective_transfer_out: 'bg-purple-100 text-purple-700',
  defective_transfer_in: 'bg-purple-100 text-purple-700',
  defective_move_out: 'bg-purple-100 text-purple-700',
  defective_move_in: 'bg-purple-100 text-purple-700',
  // 盘点类（青色）
  adjust: 'bg-cyan-100 text-cyan-700',
  manual_merge: 'bg-cyan-100 text-cyan-700',
  // MRB 处置类（橙/红）
  mrb_special_admit: 'bg-orange-100 text-orange-700',
  mrb_rework: 'bg-orange-100 text-orange-700',
  mrb_scrap: 'bg-red-100 text-red-700',
  mrb_return_cancel: 'bg-orange-100 text-orange-700',
  rework_fail: 'bg-red-100 text-red-700',
};

const MaterialTraceQuery: React.FC = () => {
  const { t } = useI18n();
  const [materialCode, setMaterialCode] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [productionDate, setProductionDate] = useState('');
  const [supplier, setSupplier] = useState('');
  const [txType, setTxType] = useState('');
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
      if (txType) params.set('txType', txType);
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
    setTxType('');
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
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t('ui.异动类型')}</label>
              <Select value={txType} onValueChange={(val) => setTxType(val)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('common.all')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('common.all')}</SelectItem>
                  {TRACE_TYPES.map((tp) => (
                    <SelectItem key={tp.value} value={tp.value}>{tp.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                  const badgeCls = TYPE_BADGE_COLORS[r.recordType] || 'bg-muted text-foreground';
                  return (
                    <tr key={r.id} className="border-b hover:bg-muted">
                      <td className="p-3 text-xs whitespace-nowrap">{r.txTime}</td>
                      <td className="p-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs ${badgeCls}`}>{r.recordTypeLabel}</span>
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
