import React, { useCallback, useEffect, useState } from 'react';
import ResizableTable from '@client/src/components/ui/resizable-table';
import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import { Input } from '@client/src/components/ui/input';
import { Textarea } from '@client/src/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import { useI18n, tf } from '@client/src/i18n';
import { workorder as workorderApi } from '@client/src/api';
import type { PickingOrder, PickingOrderItem } from '@shared/api.interface';
import { usePermission } from '@client/src/auth/usePermission';
import { renderDateTime } from '@client/src/utils/datetime';
import { extractApiError } from '@client/src/utils/apiError';
import { toast } from 'sonner';
import { PackageCheck, RefreshCw } from 'lucide-react';

/**
 * 领料签收：发料完成后由领料方（生产线物料员 / 生产主管）确认实收数量。
 * 短收需填差异原因，差额由业务决定走补料或退料。
 */
const PickingReceive: React.FC = () => {
  const { t } = useI18n();
  const { role } = usePermission();
  const roleCode = role?.roleCode || '';

  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PickingOrder[]>([]);
  const [keyword, setKeyword] = useState('');

  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<PickingOrder | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [remark, setRemark] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canReceive = ['admin', 'production_manager', 'wh_manager', 'production_material_smt', 'production_material_dip', 'production_material_assembly', 'production_material_packing'].includes(roleCode);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await workorderApi.getPickingOrderList({ page, pageSize, status: 'issued' });
      const items = (res.items || []).filter((o) =>
        !keyword.trim()
          || o.pickingNo.toLowerCase().includes(keyword.trim().toLowerCase())
          || (o.workOrderNo || '').toLowerCase().includes(keyword.trim().toLowerCase()),
      );
      setData(items);
      setTotal(keyword.trim() ? items.length : res.total);
    } catch (e: any) {
      toast.error(extractApiError(e, t('ui.加载待签收领料单失败')).message);
      setData([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, t]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openReceive = async (row: PickingOrder) => {
    setOpen(true);
    setDetailLoading(true);
    setDetail(null);
    setRemark('');
    try {
      const d = await workorderApi.getPickingOrderByNo(row.pickingNo);
      setDetail(d);
      const q: Record<string, number> = {};
      const r: Record<string, string> = {};
      for (const it of d.items || []) {
        q[it.id] = Number(it.actualQty || 0);
        r[it.id] = '';
      }
      setQtys(q);
      setRemarks(r);
    } catch (e: any) {
      toast.error(extractApiError(e, t('ui.加载领料单详情失败')).message);
      setOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const submitReceive = async () => {
    if (!detail) return;
    const items = (detail.items || []).map((it) => ({
      id: it.id,
      receivedQty: Number(qtys[it.id] ?? it.actualQty ?? 0),
      remark: remarks[it.id] || undefined,
    }));
    const shortage = (detail.items || []).some(
      (it) => Number(qtys[it.id] ?? 0) < Number(it.actualQty || 0) && !remarks[it.id]?.trim(),
    );
    if (shortage) {
      toast.error(t('ui.短收的行必须填写差异原因'));
      return;
    }
    setSubmitting(true);
    try {
      await workorderApi.receivePicking(detail.id, { items, remark: remark || undefined });
      toast.success(t('ui.签收成功'));
      setOpen(false);
      fetchData();
    } catch (e: any) {
      toast.error(extractApiError(e, t('ui.签收失败')).message);
    } finally {
      setSubmitting(false);
    }
  };

  const columns: any[] = [
    { title: t('workorder.pickingNo'), dataIndex: 'pickingNo', width: 160, fixed: 'left' as const },
    { title: t('workorder.workOrderNo'), dataIndex: 'workOrderNo', width: 160 },
    { title: t('bom.workSection'), dataIndex: 'workSection', width: 100, render: (v: string) => v?.toUpperCase() || '-' },
    { title: t('workorder.picker'), dataIndex: 'pickerName', width: 110, render: (v: string) => v || '-' },
    { title: t('ui.发料时间'), dataIndex: 'pickTime', width: 160, render: (v: string) => renderDateTime(v) },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 100,
      render: (v: string) => <Badge variant="default">{t('workorder.status_issued')}</Badge>,
    },
    {
      title: t('common.operation'),
      key: 'action',
      width: 120,
      fixed: 'right' as const,
      render: (_: any, r: PickingOrder) => (
        <Button size="sm" disabled={!canReceive} onClick={() => openReceive(r)}>
          <PackageCheck size={14} className="mr-1" />
          {t('ui.签收')}
        </Button>
      ),
    },
  ];

  const itemRows: Array<PickingOrderItem & { receivedQty?: number; receiveRemark?: string }> = detail?.items || [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t('ui.领料签收')}</h1>
          <div className="text-xs text-muted-foreground mt-1">
            {t('ui.发料完成后由领料方核对实收数量；短收需填写原因，差异由业务决定补料或退料')}
          </div>
        </div>
        <div className="flex gap-2">
          <Input
            className="w-64"
            value={keyword}
            placeholder={t('ui.搜索领料单号 / 工单号')}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); fetchData(); } }}
          />
          <Button variant="outline" onClick={() => { setPage(1); fetchData(); }}>
            <RefreshCw size={15} className="mr-1" />
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      <div className="bg-card rounded-[12px] border p-4">
        <ResizableTable
          columns={columns}
          dataSource={data}
          loading={loading}
          rowKey="id"
          scroll={{ x: 980, y: 480 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: false,
            showTotal: (n: number) => `${t('common.total')} ${n} ${t('common.items')}`,
            onChange: (p: number) => setPage(p),
          }}
        />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {t('ui.领料签收')}{detail ? ` - ${detail.pickingNo}` : ''}
            </DialogTitle>
            {detail && (
              <div className="text-xs text-muted-foreground">
                {tf('ui.工单 {wo} · 工段 {section} · 发料人 {picker}', {
                  wo: detail.workOrderNo || '-',
                  section: detail.workSection?.toUpperCase() || '-',
                  picker: detail.pickerName || '-',
                })}
              </div>
            )}
          </DialogHeader>

          {detailLoading || !detail ? (
            <div className="py-10 text-center text-muted-foreground">{t('pda.loading')}</div>
          ) : (
            <div className="space-y-3">
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-2">{t('material.materialCode')}</th>
                      <th className="text-left px-3 py-2">{t('material.materialName')}</th>
                      <th className="text-right px-3 py-2">{t('ui.应发')}</th>
                      <th className="text-right px-3 py-2">{t('ui.实发')}</th>
                      <th className="text-right px-3 py-2">{t('ui.实收')}</th>
                      <th className="text-right px-3 py-2">{t('ui.差异')}</th>
                      <th className="text-left px-3 py-2">{t('ui.差异原因')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemRows.map((it) => {
                      const issued = Number(it.actualQty || 0);
                      const recv = Number(qtys[it.id] ?? issued);
                      const diff = recv - issued;
                      return (
                        <tr key={it.id} className="border-t">
                          <td className="px-3 py-2 font-mono text-xs">{it.materialCode}</td>
                          <td className="px-3 py-2">{it.materialName}</td>
                          <td className="px-3 py-2 text-right">{it.pickQty}</td>
                          <td className="px-3 py-2 text-right">{issued}</td>
                          <td className="px-3 py-2 text-right">
                            <Input
                              className="w-24 ml-auto text-right"
                              type="number"
                              min={0}
                              max={issued}
                              value={recv}
                              onChange={(e) => {
                                const v = Math.max(0, Math.min(issued, Number(e.target.value) || 0));
                                setQtys((q) => ({ ...q, [it.id]: v }));
                              }}
                            />
                          </td>
                          <td className={`px-3 py-2 text-right ${diff < 0 ? 'text-amber-600' : diff > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                            {diff === 0 ? '0' : `${diff > 0 ? '+' : ''}${diff}`}
                          </td>
                          <td className="px-3 py-2">
                            {diff !== 0 ? (
                              <Input
                                className="w-full"
                                placeholder={t('ui.必填')}
                                value={remarks[it.id] || ''}
                                onChange={(e) => setRemarks((r) => ({ ...r, [it.id]: e.target.value }))}
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-sm text-muted-foreground">{t('common.remark')}</label>
                <Textarea rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={submitReceive} disabled={submitting || !detail}>
              {submitting ? t('common.processing') : t('ui.确认签收')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PickingReceive;
