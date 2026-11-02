import React, { useState, useCallback, useEffect } from 'react';
import ResizableTable from '@client/src/components/ui/resizable-table';
import { Table, type TableProps } from '@client/src/compat/antd-table';
import { Input } from '@client/src/components/ui/input';
import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import { Textarea } from '@client/src/components/ui/textarea';
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
import { OVER_PICKING_STATUS, statusMeta } from '@client/src/constants/business-enums';
import { useI18n } from '@client/src/i18n';
import { workorder as workorderApi, material as materialApi, overPicking as overPickingApi } from '@client/src/api';
import type { OverPickingOrder as OverPickingOrderType } from '@client/src/api/overPicking';
import { logger } from '@client/src/utils/logger';
import { renderDateTime } from '@client/src/utils/datetime';
import { toast } from 'sonner';
import { Plus, Trash2, Check, X, Ban } from 'lucide-react';

interface NewItem {
  materialCode: string;
  materialName: string;
  materialId: string;
  unit: string;
  quantity: number;
  workSection: string;
  reason: string;
}

const EMPTY_ITEM: NewItem = {
  materialCode: '',
  materialName: '',
  materialId: '',
  unit: 'PCS',
  quantity: 1,
  workSection: 'smt',
  reason: '',
};


const OverPickingOrderPage: React.FC = () => {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<OverPickingOrderType[]>([]);
  const [filters, setFilters] = useState({ orderNo: '', workOrderNo: '', status: '' });

  // 创建弹窗
  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [workOrderNo, setWorkOrderNo] = useState('');
  const [remark, setRemark] = useState('');
  const [items, setItems] = useState<NewItem[]>([{ ...EMPTY_ITEM }]);

  // 工单号下拉搜索：直接选择正常工单（无需先创建超补工单）
  const [woOptions, setWoOptions] = useState<Array<{ workOrderNo: string; productCode?: string; productName?: string; planQty?: number; status?: string }>>([]);
  const [woDropdownOpen, setWoDropdownOpen] = useState(false);
  const [woSearching, setWoSearching] = useState(false);

  // 详情弹窗
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<OverPickingOrderType | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // 统计
  const [stats, setStats] = useState<{ orderCount: number; totalQty: number; totalAmount: number } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await overPickingApi.getOverPickingList({
        page,
        pageSize,
        orderNo: filters.orderNo || undefined,
        workOrderNo: filters.workOrderNo || undefined,
        status: filters.status || undefined,
      });
      const d = (res as any).data ?? res;
      setData(d.items);
      setTotal(d.total);
    } catch (error) {
      logger.error('Failed to fetch over picking list:', String(error));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filters]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await overPickingApi.getOverPickingStats({});
      const d = (res as any).data ?? res;
      setStats({
        orderCount: Number(d.orderCount ?? 0),
        totalQty: Number(d.totalQty ?? 0),
        totalAmount: Number(d.totalAmount ?? 0),
      });
    } catch {
      /* 统计失败不阻塞列表 */
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleSearch = () => {
    // setPage(1) 是异步的：紧接着调 fetchData() 用的是闭包里的旧 page，
    // 与 useEffect 里那次正确请求形成竞态 —— 旧结果后到就会闪出一张空表。
    // 已在第 1 页时 setPage(1) 不触发重渲染，才需要手动刷新。
    if (page === 1) fetchData();
    else setPage(1);
  };

  const handleReset = () => {
    setFilters({ orderNo: '', workOrderNo: '', status: '' });
    setPage(1);
  };

  // 明细行：物料编码失焦后自动带出物料信息
  // 搜索可超补的正常工单（排除超补生成的子工单与已完结工单）
  const searchWorkOrders = useCallback(async (keyword: string) => {
    setWoSearching(true);
    try {
      const res = await workorderApi.getWorkOrderList({
        page: 1,
        pageSize: 20,
        workOrderNo: keyword || undefined,
        isSupplement: false,
      });
      const d = (res as any).data ?? res;
      const list: any[] = d.items || [];
      // 排除不可超补的状态（与后端 createOrder 校验一致）
      setWoOptions(list.filter(w => !['cancelled', 'closed', 'completed'].includes(w.status)));
    } catch {
      setWoOptions([]);
    } finally {
      setWoSearching(false);
    }
  }, []);

  const handleMaterialCodeBlur = async (idx: number, code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    try {
      const res = await materialApi.getMaterialList({ page: 1, pageSize: 1, materialCode: trimmed });
      const mat = res.items?.[0];
      if (mat && mat.materialCode === trimmed) {
        setItems(prev => prev.map((it, i) => i === idx ? {
          ...it,
          materialId: mat.id,
          materialName: mat.materialName || '',
          unit: mat.unit || 'PCS',
        } : it));
      } else {
        toast.error(t('overPicking.materialNotFound') || '未找到该物料编码');
      }
    } catch (error) {
      logger.error('Look up material failed:', String(error));
    }
  };

  const handleCreate = async () => {
    if (!workOrderNo.trim()) {
      toast.error(t('overPicking.workOrderNoRequired') || '请输入工单号');
      return;
    }
    const validItems = items.filter(it => it.materialId && it.quantity > 0);
    if (validItems.length === 0) {
      toast.error(t('overPicking.itemsRequired') || '请至少录入一行有效的超补物料明细');
      return;
    }
    setCreateLoading(true);
    try {
      await overPickingApi.createOverPickingOrder({
        workOrderNo: workOrderNo.trim(),
        items: validItems.map(it => ({
          materialId: it.materialId,
          quantity: it.quantity,
          workSection: it.workSection,
          reason: it.reason || undefined,
        })),
        remark: remark || undefined,
      });
      toast.success(t('overPicking.createSuccess') || '超补领料单创建成功，等待生产主管审批');
      setCreateOpen(false);
      setWorkOrderNo('');
      setRemark('');
      setItems([{ ...EMPTY_ITEM }]);
    // setPage(1) 是异步的：紧接着调 fetchData() 用的是闭包里的旧 page，
    // 与 useEffect 里那次正确请求形成竞态 —— 旧结果后到就会闪出一张空表。
    // 已在第 1 页时 setPage(1) 不触发重渲染，才需要手动刷新。
    if (page === 1) fetchData();
    else setPage(1);
      fetchStats();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || t('overPicking.createFailed') || '创建失败');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleViewDetail = async (record: OverPickingOrderType) => {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const res = await overPickingApi.getOverPickingDetail(record.id);
      setDetail((res as any).data ?? res);
    } catch (error) {
      logger.error('Failed to fetch over picking detail:', String(error));
    } finally {
      setDetailLoading(false);
    }
  };

  const handleApprove = async (record: OverPickingOrderType, pass: boolean) => {
    try {
      await overPickingApi.approveOverPickingOrder(record.id, { pass });
      toast.success(pass
        ? (t('overPicking.approveSuccess') || '审批通过，已生效并生成领料单')
        : (t('overPicking.rejectSuccess') || '已驳回'));
      fetchData();
      fetchStats();
      if (detailOpen) handleViewDetail(record);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || '操作失败');
    }
  };

  const handleCancel = async (record: OverPickingOrderType) => {
    try {
      await overPickingApi.cancelOverPickingOrder(record.id);
      toast.success(t('overPicking.cancelSuccess') || '已取消');
      fetchData();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || '取消失败');
    }
  };

  const columns: TableProps<OverPickingOrderType>['columns'] = [
    { title: t('overPicking.orderNo') || '超补单号', dataIndex: 'orderNo', width: 180, fixed: 'left' },
    { title: t('workorder.workOrderNo') || '工单号', dataIndex: 'workOrderNo', width: 180 },
    {
      title: t('overPicking.status') || '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => {
        const s = statusMeta(OVER_PICKING_STATUS, v, t);
        return <Badge variant={s.variant}>{s.label}</Badge>;
      },
    },
    {
      title: 'OA确认状态',
      dataIndex: 'oaStatus',
      width: 130,
      render: (v: string | undefined, r: any) => {
        if (!r.oaInstanceId) return <span className="text-muted-foreground">-</span>;
        const map: Record<string, { label: string; variant: any }> = {
          running: { label: '审批中', variant: 'default' },
          approved: { label: '已通过', variant: 'outline' },
          received: { label: '物料员已确认', variant: 'outline' },
          confirmed: { label: '已完成', variant: 'outline' },
          rejected: { label: '已驳回', variant: 'destructive' },
        };
        const m = map[v || ''] || { label: v || '-', variant: 'secondary' };
        return <Badge variant={m.variant}>{m.label}</Badge>;
      },
    },
    { title: t('overPicking.totalQty') || '超补数量', dataIndex: 'totalQty', width: 110, render: (v: number) => Number(v || 0).toLocaleString() },
    { title: t('overPicking.totalAmount') || '超补金额(¥)', dataIndex: 'totalAmount', width: 130, render: (v: number) => `¥${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}` },
    { title: t('overPicking.applicant') || '创建人(物料员)', dataIndex: 'applicantName', width: 130 },
    { title: t('overPicking.approver') || '审批人(主管)', dataIndex: 'approverName', width: 130 },
    { title: t('overPicking.approvalTime') || '审批时间', dataIndex: 'approvalTime', width: 170, render: (v: string) => renderDateTime(v) },
    { title: t('workorder.pickingNo') || '生成领料单号', dataIndex: 'pickingNo', width: 170 },
    {
      title: t('common.action') || '操作',
      key: 'action',
      width: 220,
      fixed: 'right',
      render: (_: unknown, record: OverPickingOrderType) => (
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={() => handleViewDetail(record)}>
            {t('common.detail') || '详情'}
          </Button>
          {record.oaInstanceId && (
            <a className="text-blue-600 hover:underline text-sm self-center"
               href={`http://${window.location.hostname}:8080/flow/detail/${record.oaInstanceId}`}
               target="_blank" rel="noreferrer">去OA审批</a>
          )}
          {record.status === 'pending_approval' && !record.oaInstanceId && (
            <>
              <Button variant="default" size="sm" onClick={() => handleApprove(record, true)}>
                <Check size={14} className="mr-1" />{t('overPicking.approve') || '通过'}
              </Button>
              <Button variant="destructive" size="sm" onClick={() => handleApprove(record, false)}>
                <X size={14} className="mr-1" />{t('overPicking.reject') || '驳回'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => handleCancel(record)}>
                <Ban size={14} className="mr-1" />{t('overPicking.cancel') || '取消'}
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('overPicking.title') || '超补领料单'}</h1>
        <Button onClick={() => { setCreateOpen(true); searchWorkOrders(''); }}>
          <Plus size={16} className="mr-1" />{t('overPicking.create') || '创建超补领料单'}
        </Button>
      </div>

      {stats && (
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>{t('overPicking.statsOrders') || '已生效单数'}: <b className="text-foreground">{stats.orderCount}</b></span>
          <span>{t('overPicking.statsQty') || '累计超补数量'}: <b className="text-foreground">{stats.totalQty.toLocaleString()}</b></span>
          <span>{t('overPicking.statsAmount') || '累计超补金额'}: <b className="text-foreground">¥{stats.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</b></span>
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="text-sm text-muted-foreground block mb-1">{t('overPicking.orderNo') || '超补单号'}</label>
          <Input className="w-44" value={filters.orderNo} onChange={e => setFilters({ ...filters, orderNo: e.target.value })} placeholder={t('overPicking.orderNo') || ''} />
        </div>
        <div>
          <label className="text-sm text-muted-foreground block mb-1">{t('workorder.workOrderNo') || '工单号'}</label>
          <Input className="w-44" value={filters.workOrderNo} onChange={e => setFilters({ ...filters, workOrderNo: e.target.value })} placeholder={t('workorder.workOrderNo') || ''} />
        </div>
        <div>
          <label className="text-sm text-muted-foreground block mb-1">{t('overPicking.status') || '状态'}</label>
          <Select value={filters.status || 'all'} onValueChange={v => setFilters({ ...filters, status: v === 'all' ? '' : v })}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('common.all') || '全部'}</SelectItem>
              <SelectItem value="pending_approval">{t('iqc.reviewStatus.pending')}</SelectItem>
              <SelectItem value="approved">{t('ui.已生效')}</SelectItem>
              <SelectItem value="rejected">{t('workorder.rejected')}</SelectItem>
              <SelectItem value="cancelled">{t('workorder.cancelled')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleSearch}>{t('common.search') || '查询'}</Button>
        <Button variant="outline" onClick={handleReset}>{t('common.reset') || '重置'}</Button>
      </div>

      <ResizableTable<OverPickingOrderType>
        columns={columns}
        dataSource={data}
        loading={loading}
        rowKey="id"
        scroll={{ x: 1400 }}
        pagination={{
          current: page,
          pageSize,
          total,
          onChange: (p: number) => setPage(p),
          showTotal: (t2: number) => `${t('common.total')} ${t2} ${t('common.recordUnit')}`,
        }}
      />

      {/* 创建弹窗 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('overPicking.create') || '创建超补领料单'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <label className="text-sm text-muted-foreground block mb-1">{t('workorder.workOrderNo') || '工单号'} *</label>
                <Input
                  value={workOrderNo}
                  onChange={e => { setWorkOrderNo(e.target.value); setWoDropdownOpen(true); searchWorkOrders(e.target.value); }}
                  onFocus={() => { setWoDropdownOpen(true); if (woOptions.length === 0) searchWorkOrders(''); }}
                  onBlur={() => setTimeout(() => setWoDropdownOpen(false), 200)}
                  placeholder={t('overPicking.workOrderNoPlaceholder') || '点击或输入关键词选择正常工单'}
                  autoComplete="off"
                />
                {woDropdownOpen && (
                  <div className="absolute z-30 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-card border border-border rounded-md shadow-lg">
                    {woSearching && <div className="px-3 py-2 text-sm text-muted-foreground">{t('ui.搜索中')}</div>}
                    {!woSearching && woOptions.length === 0 && (
                      <div className="px-3 py-2 text-sm text-muted-foreground">{t('ui.无可超补的正常工单（已排除超补工单/已取消/已结案/已完成）')}</div>
                    )}
                    {woOptions.map(w => (
                      <button
                        key={w.workOrderNo}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-muted transition-colors"
                        onClick={() => { setWorkOrderNo(w.workOrderNo); setWoDropdownOpen(false); }}
                      >
                        <span className="text-sm font-medium">{w.workOrderNo}</span>
                        <span className="text-xs text-muted-foreground ml-2">{w.productCode || '-'}</span>
                        <span className="text-xs text-muted-foreground ml-2">{t('ui.计划')} {w.planQty ?? '-'} </span>
                        <span className="text-xs text-muted-foreground ml-2">{w.status}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="border rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t('overPicking.items') || '超补物料明细'}</span>
                <Button variant="outline" size="sm" onClick={() => setItems(prev => [...prev, { ...EMPTY_ITEM }])}>
                  <Plus size={14} className="mr-1" />{t('common.addRow') || '添加一行'}
                </Button>
              </div>
              {items.map((it, idx) => (
                <div key={idx} className="flex flex-wrap gap-2 items-center">
                  <Input className="w-40" placeholder={t('material.materialCode') || '物料编码 *'} value={it.materialCode}
                    onChange={e => setItems(prev => prev.map((p, i) => i === idx ? { ...p, materialCode: e.target.value, materialId: '', materialName: '' } : p))}
                    onBlur={e => handleMaterialCodeBlur(idx, e.target.value)} />
                  <span className="text-sm text-muted-foreground w-36 truncate">{it.materialName || '-'}</span>
                  <Input className="w-24" type="number" min={0} placeholder={t('overPicking.quantity') || '数量 *'} value={it.quantity || ''}
                    onChange={e => setItems(prev => prev.map((p, i) => i === idx ? { ...p, quantity: Number(e.target.value) } : p))} />
                  <Select value={it.workSection} onValueChange={v => setItems(prev => prev.map((p, i) => i === idx ? { ...p, workSection: v } : p))}>
                    <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="smt">SMT</SelectItem>
                      <SelectItem value="dip">{t('ui.插件')}</SelectItem>
                      <SelectItem value="assembly">{t('bom.assembly')}</SelectItem>
                      <SelectItem value="packing">{t('bom.packing')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input className="flex-1 min-w-32" placeholder={t('overPicking.reason') || '超补原因'} value={it.reason}
                    onChange={e => setItems(prev => prev.map((p, i) => i === idx ? { ...p, reason: e.target.value } : p))} />
                  <Button variant="ghost" size="sm" disabled={items.length <= 1}
                    onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
            </div>

            <div>
              <label className="text-sm text-muted-foreground block mb-1">{t('common.remark') || '备注'}</label>
              <Textarea rows={2} value={remark} onChange={e => setRemark(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('common.cancel') || '取消'}</Button>
            <Button onClick={handleCreate} disabled={createLoading}>{t('common.submit') || '提交'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 详情弹窗 */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detail?.orderNo || t('common.detail') || '详情'}</DialogTitle>
          </DialogHeader>
          {detailLoading || !detail ? (
            <div className="py-8 text-center text-muted-foreground">...</div>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>{t('workorder.workOrderNo') || '工单号'}: <b>{detail.workOrderNo}</b></div>
                <div>{t('overPicking.status') || '状态'}: <b>{statusMeta(OVER_PICKING_STATUS, detail.status, t).label}</b></div>
                <div>{t('overPicking.totalQty') || '超补数量'}: <b>{detail.totalQty}</b></div>
                <div>{t('overPicking.totalAmount') || '超补金额'}: <b>¥{detail.totalAmount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</b></div>
                <div>{t('overPicking.applicant') || '创建人'}: {detail.applicantName || '-'}</div>
                <div>{t('overPicking.approver') || '审批人'}: {detail.approverName || '-'}</div>
                <div>{t('workorder.pickingNo') || '领料单号'}: {detail.pickingNo || '-'}</div>
                <div>{t('overPicking.approvalTime') || '审批时间'}: {renderDateTime(detail.approvalTime) || '-'}</div>
              </div>
              {detail.remark && <div>{t('common.remark') || '备注'}: {detail.remark}</div>}
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                columns={[
                  { title: t('material.materialCode') || '物料编码', dataIndex: 'materialCode', width: 140 },
                  { title: t('material.materialName') || '物料名称', dataIndex: 'materialName', width: 160 },
                  { title: t('overPicking.quantity') || '数量', dataIndex: 'quantity', width: 80 },
                  { title: t('overPicking.unitPrice') || '单价(¥)', dataIndex: 'unitPrice', width: 90 },
                  { title: t('overPicking.amount') || '金额(¥)', dataIndex: 'amount', width: 100 },
                  { title: t('overPicking.reason') || '超补原因', dataIndex: 'reason', ellipsis: true },
                ]}
                dataSource={detail.items || []}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default OverPickingOrderPage;
