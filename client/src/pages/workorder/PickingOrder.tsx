import React, { useState, useEffect, useCallback } from 'react';
import ResizableTable from '@client/src/components/ui/resizable-table';
import type { TableProps } from '@client/src/compat/antd-table';
import { useI18n } from '@client/src/i18n';
import { useWorkSectionLabel } from '@client/src/utils/work-section';
import { renderDateTime } from '@client/src/utils/datetime';
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
import { workorder as workorderApi } from '@client/src/api';
import { checkSubstitutionAvailability } from '@client/src/api/material';
import type {
  PickingOrder as PickingOrderRecord,
  PickingOrderItem,
  SubstituteMaterialInfo,
  SubstitutionCheckResult,
} from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';
import { showConfirm } from '@client/src/compat';
import { Search, ScanLine, Package, QrCode } from 'lucide-react';
import { usePermission } from '@client/src/auth/usePermission';
import { QRCodeCanvas } from 'qrcode.react';

const PX_PER_MM = 96 / 25.4;
const QR_SIZE_MM = 30;

const WORK_SECTIONS: Array<{ value: string; labelKey: string }> = [
  { value: 'smt', labelKey: 'bom.smt' },
  { value: 'dip', labelKey: 'bom.dip' },
  { value: 'assembly', labelKey: 'bom.assembly' },
  { value: 'packing', labelKey: 'bom.packing' },
];

const PickingOrder: React.FC = () => {
  const { t } = useI18n();
  const sectionLabel = useWorkSectionLabel();
  const { role } = usePermission();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PickingOrderRecord[]>([]);
  const [pickingInput, setPickingInput] = useState('');
  const [detailData, setDetailData] = useState<PickingOrderRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pickQtys, setPickQtys] = useState<Record<string, number>>({});
  const [picking, setPicking] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<PickingOrderRecord | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [approving, setApproving] = useState(false);
  const [substitutionMap, setSubstitutionMap] = useState<Record<string, string>>({});
  const [useSubstituteMap, setUseSubstituteMap] = useState<Record<string, boolean>>({});
  const [substituteOptionsMap, setSubstituteOptionsMap] = useState<Record<string, SubstituteMaterialInfo[]>>({});
  const [substitutionCheckMap, setSubstitutionCheckMap] = useState<Record<string, SubstitutionCheckResult>>({});
  const qrPx = Math.round(QR_SIZE_MM * PX_PER_MM);

  const MATERIAL_ROLES = ['production_material_smt', 'production_material_dip', 'production_material_assembly', 'production_material_packing'];
  const isMaterialHandler = role?.roleCode ? MATERIAL_ROLES.includes(role.roleCode) : false;

  const [filters, setFilters] = useState({
    pickingNo: '',
    workOrderNo: '',
    workSection: '',
    status: 'approved',
  });

  const canApprove = role?.roleCode === 'admin' || role?.roleCode === 'production_manager';

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await workorderApi.getPickingOrderList({
        page,
        pageSize,
        pickingNo: filters.pickingNo || undefined,
        workOrderNo: filters.workOrderNo || undefined,
        workSection: filters.workSection || undefined,
        status: filters.status || undefined,
      });
      setData(res.items);
      setTotal(res.total);
    } catch (error) {
      logger.error('Failed to fetch picking orders:', String(error));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filters]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const runSubstitutionChecks = useCallback(async (order: PickingOrderRecord) => {
    const checks: Record<string, SubstitutionCheckResult> = {};
    const options: Record<string, SubstituteMaterialInfo[]> = {};
    if (order.status !== 'approved') {
      setSubstitutionCheckMap(checks);
      setSubstituteOptionsMap(options);
      return;
    }
    for (const item of order.items || []) {
      const remaining = item.pickQty - (item.actualQty || 0);
      if (remaining <= 0) continue;
      try {
        const check = await checkSubstitutionAvailability(item.materialCode, remaining);
        checks[item.id] = check;
        options[item.id] = check.substitutes || [];
      } catch {
        // ignore check errors
      }
    }
    setSubstitutionCheckMap(checks);
    setSubstituteOptionsMap(options);
  }, []);

  const handleQueryByNo = async () => {
    const no = pickingInput.trim();
    if (!no) {
      toast(t('workorder.pleaseEnterPickingNo'));
      return;
    }
    setDetailLoading(true);
    try {
      const res = await workorderApi.getPickingOrderByNo(no);
      setDetailData(res);
      const qtys: Record<string, number> = {};
      if (res.items) {
        for (const item of res.items) {
          const remaining = item.pickQty - (item.actualQty || 0);
          qtys[item.id] = remaining > 0 ? remaining : 0;
        }
      }
      setPickQtys(qtys);
      setSubstitutionMap({});
      setUseSubstituteMap({});
      await runSubstitutionChecks(res);
    } catch (error: any) {
      toast(error?.response?.data?.message || t('workorder.pickingOrderNotFound'));
      setDetailData(null);
      setSubstitutionCheckMap({});
      setSubstituteOptionsMap({});
      setSubstitutionMap({});
      setUseSubstituteMap({});
    } finally {
      setDetailLoading(false);
    }
  };

  const handlePick = async () => {
    if (!detailData) return;
    const itemsToPick = Object.entries(pickQtys)
      .filter(([_, qty]) => qty > 0)
      .map(([id, qty]) => ({ id, actualQty: qty }));

    if (itemsToPick.length === 0) {
      toast(t('workorder.noPickItems'));
      return;
    }

    // Collect active substitutions for items being picked
    const activeSubstitutionMap: Record<string, string> = {};
    for (const item of itemsToPick) {
      if (useSubstituteMap[item.id] && substitutionMap[item.id]) {
        activeSubstitutionMap[item.id] = substitutionMap[item.id];
      }
    }

    if (!await showConfirm(t('workorder.confirmPickQuestion'))) return;

    setPicking(true);
    try {
      const res = Object.keys(activeSubstitutionMap).length > 0
        ? await workorderApi.pickWithSubstitution(detailData.id, {
            items: itemsToPick,
            substitutionMap: activeSubstitutionMap,
          })
        : await workorderApi.pickMaterial(detailData.id, { items: itemsToPick });
      setDetailData(res.order);
      const qtys: Record<string, number> = {};
      if (res.order.items) {
        for (const item of res.order.items) {
          const remaining = item.pickQty - (item.actualQty || 0);
          qtys[item.id] = remaining > 0 ? remaining : 0;
        }
      }
      setPickQtys(qtys);
      setSubstitutionMap({});
      setUseSubstituteMap({});
      await runSubstitutionChecks(res.order);
      toast(t('workorder.pickSuccess'));
      fetchData();
    } catch (error: any) {
      toast(error?.response?.data?.message || t('workorder.pickFailed'));
    } finally {
      setPicking(false);
    }
  };

  const handleApprove = async (record: PickingOrderRecord, pass: boolean, remark?: string) => {
    setApproving(true);
    try {
      const res = await workorderApi.approvePickingOrder(record.id, { pass, approvalRemark: remark });
      toast(t('workorder.approveSuccess'));
      setDetailData(res);
      fetchData();
    } catch (error: any) {
      toast(error?.response?.data?.message || t('workorder.approveFailed'));
    } finally {
      setApproving(false);
    }
  };

  const handleRejectSubmit = () => {
    if (!rejectReason.trim()) {
      toast(t('workorder.rejectRequired'));
      return;
    }
    if (rejectTarget) {
      handleApprove(rejectTarget, false, rejectReason.trim());
    }
    setRejectOpen(false);
    setRejectTarget(null);
    setRejectReason('');
  };

  const updatePickQty = (itemId: string, value: string) => {
    const qty = Number(value) || 0;
    const item = detailData?.items?.find((i) => i.id === itemId);
    if (!item) return;
    const remaining = item.pickQty - (item.actualQty || 0);
    const finalQty = Math.max(0, Math.min(qty, remaining));
    setPickQtys({ ...pickQtys, [itemId]: finalQty });
  };

  const handleSearch = () => {
    // setPage(1) 是异步的：紧接着调 fetchData() 用的是闭包里的旧 page，
    // 与 useEffect 里那次正确请求形成竞态 —— 旧结果后到就会闪出一张空表。
    // 已在第 1 页时 setPage(1) 不触发重渲染，才需要手动刷新。
    if (page === 1) fetchData();
    else setPage(1);
  };

  const handleReset = () => {
    setFilters({
      pickingNo: '',
      workOrderNo: '',
      workSection: isMaterialHandler ? (role?.workSection || '') : '',
      status: 'approved',
    });
    setPage(1);
  };

  const statusBadge = (status: string) => {
    const variantMap: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      draft: 'secondary',
      pending_approval: 'default',
      approved: 'default',
      rejected: 'destructive',
      picking: 'default',
      picked: 'default',
      issued: 'default',
      received: 'default',
      cancelled: 'destructive',
    };
    const labelMap: Record<string, string> = {
      draft: t('workorder.status_draft'),
      pending_approval: t('workorder.status_pending_approval'),
      approved: t('workorder.status_approved'),
      rejected: t('workorder.status_rejected'),
      picking: t('workorder.status_picking'),
      picked: t('workorder.status_picked'),
      issued: t('workorder.status_issued'),
      received: t('workorder.status_received'),
      cancelled: t('workorder.status_cancelled'),
    };
    return <Badge variant={variantMap[status] || 'secondary'}>{labelMap[status] || status}</Badge>;
  };

  const columns: TableProps<PickingOrderRecord>['columns'] = [
    { title: t('workorder.pickingNo'), dataIndex: 'pickingNo', width: 200, fixed: 'left' },
    { title: t('workorder.workOrderNo'), dataIndex: 'workOrderNo', width: 160 },
    // MES 来源的单有对方单号，仓库拿它对单；手工单显示 -
    {
      title: t('workorder.mesIssueNo'), dataIndex: 'mesIssueNo', width: 150,
      render: (v: string) => v || '-',
    },
    { title: t('workorder.productCode'), dataIndex: 'productCode', width: 150 },
    {
      title: t('bom.workSection'),
      dataIndex: 'workSection',
      width: 100,
      render: (section: string) => sectionLabel(section),
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 100,
      render: (status: string) => statusBadge(status),
    },
    {
      title: t('workorder.applicant'), dataIndex: 'applicantName', width: 100,
      // MES 自动开单没有人工申请人，标出来源，避免看起来像数据缺失
      render: (v: string, r: PickingOrderRecord) =>
        v || (r.source === 'mes' ? <Badge variant="outline">MES</Badge> : '-'),
    },
    { title: t('workorder.approver'), dataIndex: 'approverName', width: 100 },
    { title: t('workorder.approvalTime'), dataIndex: 'approvalTime', width: 160, render: renderDateTime },
  ];

  if (canApprove) {
    columns.push({
      title: t('common.operation'),
      key: 'action',
      width: 160,
      fixed: 'right',
      render: (_: any, record: PickingOrderRecord) => {
        if (record.status !== 'pending_approval') {
          return <span className="text-muted-foreground">-</span>;
        }
        return (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="default"
              onClick={() => handleApprove(record, true)}
              disabled={approving}
            >
              {t('workorder.approvePass')}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                setRejectTarget(record);
                setRejectReason('');
                setRejectOpen(true);
              }}
              disabled={approving}
            >
              {t('workorder.approveReject')}
            </Button>
          </div>
        );
      },
    });
  }

  const itemColumns: TableProps<PickingOrderItem>['columns'] = [
    { title: '#', dataIndex: 'idx', width: 40, render: (_: any, __: PickingOrderItem, index: number) => index + 1 },
    {
      title: t('material.materialCode'),
      dataIndex: 'materialCode',
      width: 150,
      render: (_: any, record: PickingOrderItem) => (
        <div>
          <div>{record.materialCode}</div>
          {record.actualMaterialCode && record.actualMaterialCode !== record.materialCode && (
            <div className="text-xs text-amber-600">
              {t('material.actualSubstitutePrefix')} {record.materialCode}{' '}
              {t('material.actualSubstituteArrow')} {record.actualMaterialCode}
            </div>
          )}
        </div>
      ),
    },
    { title: t('material.materialName'), dataIndex: 'materialName', width: 140 },
    { title: t('common.unit'), dataIndex: 'unit', width: 60 },
    { title: t('workorder.pickQty'), dataIndex: 'pickQty', width: 90, align: 'right' },
    { title: t('workorder.alreadyPicked'), dataIndex: 'actualQty', width: 90, align: 'right' },
    {
      title: t('workorder.cumulativePicked'),
      dataIndex: 'cumulativeQty',
      width: 100,
      align: 'right',
      render: (_: any, record: PickingOrderItem) => record.actualQty || 0,
    },
    {
      title: t('workorder.diff'),
      dataIndex: 'diffQty',
      width: 80,
      align: 'right',
      render: (_: any, record: PickingOrderItem) => {
        const diff = (record.actualQty || 0) - record.pickQty;
        const color = diff >= 0 ? 'text-green-600' : 'text-red-500';
        return <span className={color}>{diff >= 0 ? '+' : ''}{diff}</span>;
      },
    },
    {
      title: t('material.useSubstitute'),
      key: 'substitute',
      width: 220,
      render: (_: any, record: PickingOrderItem) => {
        const remaining = record.pickQty - (record.actualQty || 0);
        if (remaining <= 0) {
          if (record.actualMaterialCode && record.actualMaterialCode !== record.materialCode) {
            return (
              <Badge variant="outline" className="text-amber-600">
                {t('material.substituteAvailable')}
              </Badge>
            );
          }
          return <span className="text-muted-foreground">-</span>;
        }
        if (detailData?.status !== 'approved') {
          return <span className="text-muted-foreground">-</span>;
        }

        const options = substituteOptionsMap[record.id] || [];
        const check = substitutionCheckMap[record.id];
        const hasSubstitutes = options.length > 0;
        const isStockInsufficient = !!check && !check.originalSufficient && hasSubstitutes;
        const usingSub = !!useSubstituteMap[record.id];

        if (!hasSubstitutes) {
          return <span className="text-muted-foreground text-xs">-</span>;
        }

        return (
          <div className="space-y-1">
            {isStockInsufficient && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
                {t('material.substituteWarning')}
              </div>
            )}
            <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={usingSub}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setUseSubstituteMap({ ...useSubstituteMap, [record.id]: checked });
                  if (!checked) {
                    const next = { ...substitutionMap };
                    delete next[record.id];
                    setSubstitutionMap(next);
                  }
                }}
              />
              {t('material.useSubstitute')}
            </label>
            {usingSub && (
              <Select
                value={substitutionMap[record.id] || ''}
                onValueChange={(val) => setSubstitutionMap({ ...substitutionMap, [record.id]: val })}
              >
                <SelectTrigger className="w-full h-7 text-xs">
                  <SelectValue placeholder={t('material.selectSubstituteMaterial')} />
                </SelectTrigger>
                <SelectContent>
                  {options.map((sub) => (
                    <SelectItem key={sub.materialId} value={sub.materialId}>
                      {sub.materialCode}-{sub.materialName}（{t('material.substituteStock')}:{sub.stockQty}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        );
      },
    },
    {
      title: t('workorder.thisPickQty'),
      key: 'thisPick',
      width: 110,
      fixed: 'right',
      render: (_: any, record: PickingOrderItem) => {
        const remaining = record.pickQty - (record.actualQty || 0);
        const isFull = remaining <= 0;
        if (isFull) {
          return <Badge variant="outline" className="text-green-600">{t('workorder.fullyPicked')}</Badge>;
        }
        if (detailData?.status !== 'approved') {
          return <span className="text-muted-foreground">-</span>;
        }
        return (
          <Input
            type="number"
            size={1}
            value={pickQtys[record.id] ?? 0}
            onChange={(e) => updatePickQty(record.id, e.target.value)}
            className="w-20"
            min={0}
            max={remaining}
          />
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-[12px] p-4 border border-border">
        <div className="flex items-center gap-4 mb-4">
          <div className="flex-1 flex items-center gap-2">
            <ScanLine className="w-5 h-5 text-muted-foreground" />
            <Input
              value={pickingInput}
              onChange={(e) => setPickingInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleQueryByNo(); }}
              placeholder={t('workorder.enterPickingNoOrScan')}
              className="flex-1"
            />
            <Button onClick={handleQueryByNo}>
              <Search className="w-4 h-4 mr-1" />
              {t('common.search')}
            </Button>
          </div>
        </div>

        {detailData && (
          <div className="border-t border-border pt-4 space-y-3">
            <div className="flex items-start gap-6">
              <div className="flex flex-col items-center gap-2">
                <div className="border border-border rounded-lg p-3 bg-card">
                  <QRCodeCanvas value={detailData.pickingNo} size={qrPx} level="M" />
                </div>
                <div className="text-xs text-muted-foreground text-center">
                  <QrCode className="w-3 h-3 inline mr-1" />
                  {t('workorder.pickingQrCode')}
                  <div className="font-mono font-semibold text-foreground">{detailData.pickingNo}</div>
                </div>
              </div>

              <div className="flex-1 grid grid-cols-3 gap-4">
                <div>
                  <span className="text-sm text-muted-foreground">{t('workorder.pickingNo')}：</span>
                  <span className="font-semibold">{detailData.pickingNo}</span>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">{t('workorder.workOrderNo')}：</span>
                  <span>{detailData.workOrderNo}</span>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">{t('workorder.productCode')}：</span>
                  <span>{detailData.productCode || '-'}{detailData.productName ? `（${detailData.productName}）` : ''}</span>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">{t('bom.workSection')}：</span>
                  <span>{sectionLabel(detailData.workSection)}</span>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">{t('common.status')}：</span>
                  {statusBadge(detailData.status)}
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">{t('workorder.applicant')}：</span>
                  <span>{detailData.applicantName || '-'}</span>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">{t('workorder.approver')}：</span>
                  <span>{detailData.approverName || '-'}</span>
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                <Package className="w-4 h-4" />
                {t('workorder.pickDetail')}
              </h4>
              <div className="border border-border rounded-lg overflow-hidden">
                <ResizableTable
                  columns={itemColumns}
                  dataSource={detailData.items || []}
                  loading={detailLoading}
                  rowKey="id"
                  pagination={false}
                  scroll={{ x: 1120, y: 320 }}
                  size="small"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              {detailData.status === 'approved' && (
                <Button onClick={handlePick} disabled={picking}>
                  {picking ? t('common.saving') : t('workorder.confirmPick')}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="bg-card rounded-[12px] p-4 border border-border">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">{t('workorder.pickingNo')}</label>
            <Input
              value={filters.pickingNo}
              onChange={(e) => setFilters({ ...filters, pickingNo: e.target.value })}
              placeholder={t('workorder.pickingNo')}
            />
          </div>
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">{t('workorder.workOrderNo')}</label>
            <Input
              value={filters.workOrderNo}
              onChange={(e) => setFilters({ ...filters, workOrderNo: e.target.value })}
              placeholder={t('workorder.workOrderNo')}
            />
          </div>
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">{t('bom.workSection')}</label>
            <Select
              value={isMaterialHandler ? (role?.workSection || '') : filters.workSection}
              disabled={isMaterialHandler}
              onValueChange={(val) => setFilters({ ...filters, workSection: val })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('common.all')} />
              </SelectTrigger>
              <SelectContent>
                {!isMaterialHandler && <SelectItem value="">{t('common.all')}</SelectItem>}
                {WORK_SECTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{t(s.labelKey)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <Button onClick={handleSearch}>{t('common.search')}</Button>
            <Button variant="outline" onClick={handleReset}>{t('common.reset')}</Button>
          </div>
        </div>

        <ResizableTable
          columns={columns}
          dataSource={data}
          loading={loading}
          rowKey="id"
          scroll={{ x: canApprove ? 1200 : 1000, y: 400 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: false,
            showTotal: (totalN) => `${t('common.total')} ${totalN} ${t('common.items')}`,
            onChange: (p) => setPage(p),
          }}
          onRow={(record) => ({
            onClick: () => {
              setPickingInput(record.pickingNo);
              handleQueryByNo();
            },
            style: { cursor: 'pointer' },
          })}
        />
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('workorder.approveReject')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">
                {t('workorder.rejectReason')} *
              </label>
              <textarea
                className="w-full border border-input rounded-md px-3 py-2 text-sm min-h-[100px] resize-none focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder={t('workorder.rejectRequired')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={handleRejectSubmit} disabled={approving}>
              {t('workorder.approveReject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PickingOrder;
