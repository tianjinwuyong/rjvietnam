import React, { useState } from 'react';
import ResizableTable from '@client/src/components/ui/resizable-table';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Badge } from '@client/src/components/ui/badge';
import { Textarea } from '@client/src/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@client/src/components/ui/dialog';
import { useI18n, tf } from '@client/src/i18n';
import { workorder as workorderApi } from '@client/src/api';
import type { ConsumptionItem, PickingReelRow } from '@client/src/api/workorder';
import { extractApiError } from '@client/src/utils/apiError';
import { toast } from 'sonner';
import { Search, Undo2, ShieldCheck } from 'lucide-react';

/** SMT 盘装料核销：工单用料 vs BOM 标准、盘台账、余料退回、超耗审批 */
const ReelSettlement: React.FC = () => {
  const { t } = useI18n();
  const [woNo, setWoNo] = useState('');
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof workorderApi.getWorkOrderConsumption>> | null>(null);
  const [reels, setReels] = useState<PickingReelRow[]>([]);

  const [returnOpen, setReturnOpen] = useState(false);
  const [target, setTarget] = useState<PickingReelRow | null>(null);
  const [qty, setQty] = useState('');
  const [loc, setLoc] = useState('');
  const [remark, setRemark] = useState('');
  const [manual, setManual] = useState(false);
  const [mCode, setMCode] = useState('');
  const [mBatch, setMBatch] = useState('');

  const [approveOpen, setApproveOpen] = useState(false);
  const [approveRemark, setApproveRemark] = useState('');

  const load = async () => {
    const no = woNo.trim();
    if (!no) { toast.error(t('ui.请输入工单号')); return; }
    setLoading(true);
    try {
      const [s, r] = await Promise.all([
        workorderApi.getWorkOrderConsumption(no),
        workorderApi.listPickingReels({ workOrderNo: no }),
      ]);
      setSummary(s);
      setReels(r || []);
    } catch (e: any) {
      toast.error(extractApiError(e, t('ui.加载失败')).message);
      setSummary(null);
      setReels([]);
    } finally {
      setLoading(false);
    }
  };

  const openReturn = (row: PickingReelRow) => {
    setManual(false);
    setTarget(row);
    setQty(String(Math.max(0, row.issuedQty - row.returnedQty)));
    setLoc('');
    setRemark('');
    setReturnOpen(true);
  };

  const openManualReturn = () => {
    setManual(true);
    setTarget(null);
    setQty('');
    setLoc('');
    setRemark('');
    setMCode('');
    setMBatch('');
    setReturnOpen(true);
  };

  const submitReturn = async () => {
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) { toast.error(t('ui.退回数量必须大于 0')); return; }
    try {
      await workorderApi.returnReel({
        reelNo: manual ? undefined : target?.reelNo,
        materialCode: manual ? mCode.trim() : undefined,
        batchNo: manual ? mBatch.trim() : undefined,
        quantity: n,
        locationCode: loc.trim() || undefined,
        remark: remark.trim() || undefined,
      });
      toast.success(t('ui.退回成功'));
      setReturnOpen(false);
      load();
    } catch (e: any) {
      toast.error(extractApiError(e, t('ui.退回失败')).message);
    }
  };

  const submitApprove = async (approved: boolean) => {
    if (!summary) return;
    if (!approved && !approveRemark.trim()) { toast.error(t('ui.驳回必须填写原因')); return; }
    try {
      await workorderApi.approveOverConsume({ workOrderNo: summary.workOrderNo, approved, remark: approveRemark.trim() || undefined });
      toast.success(approved ? t('ui.审批通过') : t('ui.已驳回'));
      setApproveOpen(false);
      load();
    } catch (e: any) {
      toast.error(extractApiError(e, t('ui.审批失败')).message);
    }
  };

  const itemColumns: any[] = [
    { title: t('material.materialCode'), dataIndex: 'materialCode', width: 160 },
    { title: t('material.materialName'), dataIndex: 'materialName', width: 150 },
    { title: t('ui.BOM标准'), dataIndex: 'standardQty', width: 110, align: 'right' },
    { title: t('ui.已发'), dataIndex: 'issuedQty', width: 100, align: 'right' },
    { title: t('ui.已退'), dataIndex: 'returnedQty', width: 100, align: 'right' },
    { title: t('ui.实耗'), dataIndex: 'consumedQty', width: 100, align: 'right' },
    {
      title: t('ui.超耗'), dataIndex: 'overQty', width: 110, align: 'right',
      render: (v: number) => <span className={v > 0 ? 'text-red-600 font-semibold' : 'text-muted-foreground'}>{v > 0 ? `+${v}` : v}</span>,
    },
    {
      title: t('ui.超耗率'), dataIndex: 'overRate', width: 110, align: 'right',
      render: (v: number, r: ConsumptionItem) => (
        <span className={r.needsApproval ? 'text-red-600 font-semibold' : ''}>{(v * 100).toFixed(3)}%</span>
      ),
    },
    {
      title: t('ui.状态'), dataIndex: 'needsApproval', width: 90, align: 'center',
      render: (v: boolean) => v ? <Badge variant="destructive">{t('ui.需审批')}</Badge> : <Badge variant="outline">{t('ui.正常')}</Badge>,
    },
  ];

  const reelColumns: any[] = [
    { title: t('ui.盘号'), dataIndex: 'reelNo', width: 170 },
    { title: t('material.materialCode'), dataIndex: 'materialCode', width: 160 },
    { title: t('ui.批次'), dataIndex: 'batchNo', width: 120 },
    { title: t('ui.已发'), dataIndex: 'issuedQty', width: 90, align: 'right' },
    { title: t('ui.已退'), dataIndex: 'returnedQty', width: 90, align: 'right' },
    { title: t('ui.实耗'), dataIndex: 'consumedQty', width: 90, align: 'right' },
    {
      title: t('common.status'), dataIndex: 'status', width: 110,
      render: (v: string) => <Badge variant={v === 'closed' ? 'outline' : 'default'}>{v === 'closed' ? t('ui.已结清') : v === 'partial_returned' ? t('ui.部分退回') : t('ui.在产线')}</Badge>,
    },
    {
      title: t('common.operation'), key: 'op', width: 100, fixed: 'right',
      render: (_: any, r: PickingReelRow) => (
        <Button size="sm" variant="outline" disabled={r.status === 'closed'} onClick={() => openReturn(r)}>
          <Undo2 size={14} className="mr-1" />{t('ui.退回')}
        </Button>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t('ui.盘装料核销')}</h1>
          <div className="text-xs text-muted-foreground mt-1">
            {t('ui.按工单核销盘装料：BOM 标准量与盘实耗对比，超千分之三需审批')}
          </div>
        </div>
        <div className="flex gap-2">
          <Input className="w-64" value={woNo} placeholder={t('ui.输入工单号')}
            onChange={(e) => setWoNo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') load(); }} />
          <Button onClick={load} disabled={loading}><Search size={15} className="mr-1" />{t('ui.查询')}</Button>
          <Button variant="outline" onClick={openManualReturn}><Undo2 size={15} className="mr-1" />{t('ui.无码退回')}</Button>
        </div>
      </div>

      {summary && (
        <>
          <div className="border rounded-lg p-4 flex flex-wrap items-center gap-6 bg-muted/20">
            <div><span className="text-xs text-muted-foreground">{t('ui.工单')}</span><div className="font-medium">{summary.workOrderNo}</div></div>
            <div><span className="text-xs text-muted-foreground">{t('ui.计划数量')}</span><div className="font-medium">{summary.planQty}</div></div>
            <div><span className="text-xs text-muted-foreground">{t('ui.整体超耗率')}</span>
              <div className={`font-medium ${summary.overallRate > 0.003 ? 'text-red-600' : ''}`}>{(summary.overallRate * 100).toFixed(3)}%</div>
            </div>
            <div><span className="text-xs text-muted-foreground">{t('ui.审批状态')}</span>
              <div>{summary.overConsumeStatus === 'approved'
                ? <Badge>{t('ui.已审批')}</Badge>
                : summary.needsApproval ? <Badge variant="destructive">{t('ui.待审批')}</Badge> : <Badge variant="outline">{t('ui.无需审批')}</Badge>}</div>
            </div>
            {summary.needsApproval && summary.overConsumeStatus !== 'approved' && (
              <Button className="ml-auto" onClick={() => { setApproveRemark(''); setApproveOpen(true); }}>
                <ShieldCheck size={15} className="mr-1" />{t('ui.超耗审批')}
              </Button>
            )}
          </div>

          <div className="bg-card rounded-lg border p-4">
            <div className="font-medium mb-2">{t('ui.工单用料核销')}</div>
            <ResizableTable columns={itemColumns} dataSource={summary.items} rowKey="materialCode"
              pagination={false} scroll={{ x: 1000, y: 320 }}
              rowClassName={(r: ConsumptionItem) => (r.needsApproval ? 'bg-red-50' : '')} />
          </div>
        </>
      )}

      <div className="bg-card rounded-lg border p-4">
        <div className="font-medium mb-2">{t('ui.盘台账')}{reels.length ? ` (${reels.length})` : ''}</div>
        <ResizableTable columns={reelColumns} dataSource={reels} rowKey="id"
          pagination={false} scroll={{ x: 1000, y: 320 }} />
      </div>

      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{manual ? t('ui.无码退回') : t('ui.余料退回')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {manual ? (
              <>
                <div><label className="text-sm text-muted-foreground">{t('material.materialCode')}</label>
                  <Input value={mCode} onChange={(e) => setMCode(e.target.value)} /></div>
                <div><label className="text-sm text-muted-foreground">{t('ui.批次')}</label>
                  <Input value={mBatch} onChange={(e) => setMBatch(e.target.value)} /></div>
              </>
            ) : (
              <div className="text-sm bg-muted/40 rounded p-3 space-y-1">
                <div>{t('ui.盘号')}：<span className="font-mono">{target?.reelNo}</span></div>
                <div>{target?.materialCode} {target?.materialName}</div>
                <div>{t('ui.可退')}：{target ? target.issuedQty - target.returnedQty : 0}</div>
              </div>
            )}
            <div><label className="text-sm text-muted-foreground">{t('ui.退回数量')}</label>
              <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
            <div><label className="text-sm text-muted-foreground">{t('ui.退回库位（留空回原库位）')}</label>
              <Input value={loc} onChange={(e) => setLoc(e.target.value)} /></div>
            <div><label className="text-sm text-muted-foreground">{t('common.remark')}</label>
              <Textarea rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={submitReturn}>{t('ui.确认退回')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t('ui.超耗审批')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              {tf('ui.整体超耗率 {rate}，超过千分之三，需审批后才能结案', {
                rate: `${((summary?.overallRate || 0) * 100).toFixed(3)}%`,
              })}
            </div>
            <Textarea rows={3} value={approveRemark} onChange={(e) => setApproveRemark(e.target.value)}
              placeholder={t('ui.审批意见（驳回必填）')} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={() => submitApprove(false)}>{t('ui.驳回')}</Button>
            <Button onClick={() => submitApprove(true)}>{t('ui.通过')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ReelSettlement;
