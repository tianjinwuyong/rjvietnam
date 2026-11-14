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
import { getRecordList, reviewReport, rejectReport, batchApproveReports } from '@client/src/api/iqc';
import { useAuth } from '@client/src/auth/AuthContext';
import { logger } from '@client/src/utils/logger';
import { renderDate, renderDateTimeMinute } from '@client/src/utils/datetime';
import { IQC_REVIEW_STATUS } from '@client/src/constants/business-enums';
import { useI18n, tf, tui } from '../../i18n';

const IqcReport: React.FC = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [rejectDialog, setRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectTarget, setRejectTarget] = useState<any>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      // 服务端按待审批状态过滤（此前取前 100 条再本地过滤，超过 100 条会漏单）
      const res: any = await getRecordList({ page: 1, pageSize: 200, reviewStatus: 'pending' });
      setData(res?.items || []);
    } catch (e) {
      logger.error('fetch report failed', e);
      toast.error(t('message.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  /** 审批人信息：不再用 'admin' 之类的兜底值（会写脏库），id 缺失时交给服务端按登录态补全 */
  const reviewerPayload = () => ({
    reviewerId: (user as any)?.id || '',
    reviewerName: (user as any)?.name || (user as any)?.account || '',
  });

  /** 提取后端返回的真实错误信息，避免一律提示「失败」看不出原因 */
  const resolveError = (e: any, fallback: string) =>
    e?.response?.data?.error?.message || e?.response?.data?.message || e?.message || fallback;

  const [approving, setApproving] = useState(false);

  const handleApprove = async (record: any) => {
    if (approving) return;
    setApproving(true);
    try {
      await reviewReport(record.id, reviewerPayload());
      toast.success(tf('ui.检验编号 {no} 审批通过', { no: record.reportNo || '' }));
      await fetchData();
    } catch (e: any) {
      toast.error(tf('ui.审批失败：{msg}', { msg: resolveError(e, t('ui.请稍后重试')) }));
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    try {
      await rejectReport(rejectTarget.id, {
        rejectorId: (user as any)?.id || '',
        rejectorName: (user as any)?.name || (user as any)?.account || '',
        rejectReason,
      });
      toast.success(t('workorder.rejected'));
      setRejectDialog(false);
      fetchData();
    } catch (e: any) {
      toast.error(tf('ui.驳回失败：{msg}', { msg: resolveError(e, t('ui.请稍后重试')) }));
    }
  };

  const handleBatchApprove = async () => {
    if (selected.length === 0) { toast.error(t('ui.请先勾选')); return; }
    if (approving) return;
    setApproving(true);
    try {
      const res = await batchApproveReports({ ids: selected, ...reviewerPayload() });
      // 批量审批以前不看成败就提示「成功」，失败会被悄悄吞掉（用户看到的是假成功）
      const successCount = res?.success ?? 0;
      const failedCount = res?.failed ?? 0;
      if (failedCount === 0) {
        toast.success(tf('ui.批量审批完成，共 {n} 份', { n: successCount }));
      } else if (successCount === 0) {
        const first = res?.failedDetails?.[0];
        toast.error(tf('ui.批量审批全部失败（{n} 份）：{msg}', { n: failedCount, msg: first?.reason || t('ui.未知错误') }));
      } else {
        const names = (res?.failedDetails || [])
          .slice(0, 3)
          .map((d) => d.reportNo || d.id)
          .join('、');
        toast.warning(tf('ui.成功 {ok} 份，失败 {fail} 份（{names}{more}）', { ok: successCount, fail: failedCount, names, more: failedCount > 3 ? t('ui.等') : '' }));
      }
      setSelected([]);
      await fetchData();
    } catch (e: any) {
      toast.error(tf('ui.批量审批失败：{msg}', { msg: resolveError(e, t('ui.请稍后重试')) }));
    } finally {
      setApproving(false);
    }
  };

  // 列结构与待检清单保持一致（检验编号/报检时间/批次号/物料/供应商/数量/生产日期/检验员/状态/物料来源），
  // 仅「状态」「操作」按审批场景变化
  const columns = [
    { title: <input type="checkbox" checked={selected.length === data.length && data.length > 0} onChange={e => { if (e.target.checked) setSelected(data.map(item => item.id)); else setSelected([]); }} />, dataIndex: 'checkbox', width: 50, render: (_: any, record: any) => <input type="checkbox" checked={selected.includes(record.id)} onChange={e => { if (e.target.checked) setSelected([...selected, record.id]); else setSelected(selected.filter(id => id !== record.id)); }} /> },
    {
      title: t('iqc.reportNo'),
      key: 'inspectionNo',
      width: 140,
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
    { title: t('iqc.batchNo'), dataIndex: ['lot', 'batchNo'], width: 96, render: (val: string) => <span>{val || '-'}</span> },
    { title: t('iqc.materialCode'), dataIndex: ['lot', 'materialCode'], width: 110 },
    { title: t('iqc.materialName'), dataIndex: ['lot', 'materialName'], width: 112, render: (val: string) => <span className="block truncate" title={val}>{val || '-'}</span> },
    { title: t('print.supplier'), dataIndex: ['lot', 'supplierName'], width: 122, render: (val: string) => <span className="block truncate" title={val}>{val || '-'}</span> },
    { title: t('pda.mrb.qty'), dataIndex: ['lot', 'totalQty'], width: 64 },
    { title: t('common.productionDate'), dataIndex: ['lot', 'productionDate'], width: 100, render: (val: string) => renderDate(val) },
    {
      title: t('iqc.inspector'),
      dataIndex: ['lot', 'inspectorName'],
      // 90px 装不下「系统管理员」这类 5 字姓名，会折成两行；放宽并单行省略
      width: 120,
      render: (val: string) => (
        <span className="block truncate" title={tui(val) || ''}>{tui(val) || '-'}</span>
      ),
    },
    {
      title: t('common.status'),
      dataIndex: 'reviewStatus',
      width: 92,
      render: (val: string) => {
        const meta = IQC_REVIEW_STATUS[val];
        const text = meta ? t(meta.labelKey) : val;
        const color = meta?.colorClass ?? 'bg-muted text-muted-foreground';
        return <Badge className={color}>{text}</Badge>;
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
    { title: t('common.action'), width: 190, render: (_: any, record: any) => (
      <div className="flex gap-2">
        <Button size="sm" style={{ backgroundColor: 'var(--primary)' }} onClick={() => navigate(`/iqc/report-view/${record.id}`)}>{t('common.view')}</Button>
        <Button size="sm" style={{ backgroundColor: '#10B981' }} disabled={approving} onClick={() => handleApprove(record)}>{t('overPicking.approve')}</Button>
        <Button size="sm" variant="destructive" onClick={() => { setRejectTarget(record); setRejectDialog(true); }}>{t('common.reject')}</Button>
      </div>
    )},
  ];

  return (
    <div className="space-y-4 p-6">
      <Card>
        <CardContent className="pt-6">
          <div className="flex justify-between items-center mb-4">
            <div className="text-sm">{tf('ui.待审批：{n}份，已勾选{m}份', { n: data.length, m: selected.length })}</div>
            <Button onClick={handleBatchApprove} disabled={selected.length === 0 || approving}>{t('ui.批量审批通过')}</Button>
          </div>
          <Table columns={columns} dataSource={data} rowKey="id" loading={loading} />
        </CardContent>
      </Card>
      {rejectDialog && rejectTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card text-card-foreground p-6 rounded-lg w-[500px] space-y-4">
            <h3>{t('iqc.rejectReason')}</h3>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} className="border rounded p-2 w-full h-20" placeholder={t('workorder.rejectRequired')} />
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" onClick={() => setRejectDialog(false)}>{t('pda.cancel')}</Button>
              <Button variant="destructive" onClick={handleReject}>{t('workorder.confirmReject')}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default IqcReport;
