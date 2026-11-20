import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ResizableTable from '@client/src/components/ui/resizable-table';
import type { TableProps } from '@client/src/compat/antd-table';
import { useI18n, tf, tui } from '@client/src/i18n';
import { useWorkSectionLabel } from '@client/src/utils/work-section';
import { renderDate, formatDate } from '@client/src/utils/datetime';
import { Input } from '@client/src/components/ui/input';
import ScanInput from '@client/src/components/ScanInput';
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
  DialogDescription,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import { workorder as workorderApi, inventory as inventoryApi } from '@client/src/api';
import type { PickingOrder as PickingOrderRecord, PickingOrderItem, TailLabel, PickMaterialResult } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { extractApiError } from '@client/src/utils/apiError';
import { toast } from 'sonner';
import { speakError } from '@client/src/utils/speech';
import { showConfirm } from '@client/src/compat';
import { Search, ScanLine, Package, QrCode, Plus, Minus, Trash2, CheckCircle, MousePointerClick } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import TailLabelPanel from './TailLabelPanel';

const WORK_SECTIONS: Array<{ value: string; labelKey: string }> = [
  { value: 'smt', labelKey: 'bom.smt' },
  { value: 'dip', labelKey: 'bom.dip' },
  { value: 'assembly', labelKey: 'bom.assembly' },
  { value: 'packing', labelKey: 'bom.packing' },
];

const PX_PER_MM = 96 / 25.4;
const QR_SIZE_MM = 30;

interface ScannedMaterial {
  materialCode: string;
  materialName?: string;
  batchNo?: string;
  productionDate?: string;
  qty: number;
  unit?: string;
}

function parseMaterialLabel(raw: string): { materialCode: string; qty: number; batchNo?: string; productionDate?: string; serialNo?: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parts = trimmed.split('*');
  if (parts.length >= 6) {
    // 标准六段码: 供应商代码*料号*生产日期*数量*批次号*流水号
    const materialCode = parts[1]?.trim();
    const productionDate = parts[2]?.trim() || undefined;
    const qty = Number(parts[3]) || 1;
    const batchNo = parts[4]?.trim() || undefined;
    // 第六段是箱子上印的流水号：发料拆箱时两张标签都要沿用它，只改数量
    const serialNo = parts[5]?.trim() || undefined;
    if (materialCode) return { materialCode, qty, batchNo, productionDate, serialNo };
  } else if (parts.length >= 4) {
    const materialCode = parts[1]?.trim();
    const productionDate = parts[2]?.trim() || undefined;
    const qty = Number(parts[3]) || 1;
    const batchNo = parts[4]?.trim() || undefined;
    if (materialCode) return { materialCode, qty, batchNo, productionDate };
  }
  return { materialCode: trimmed, qty: 1, batchNo: undefined, productionDate: undefined };
}

const IssuingManage: React.FC = () => {
  const { t } = useI18n();
  const sectionLabel = useWorkSectionLabel();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PickingOrderRecord[]>([]);
  const [pickingInput, setPickingInput] = useState('');
  const [detailData, setDetailData] = useState<PickingOrderRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [scannedQtys, setScannedQtys] = useState<Record<string, number>>({});
  const [issuing, setIssuing] = useState(false);
  const [materialScanInput, setMaterialScanInput] = useState('');
  const materialScanRef = useRef<HTMLInputElement>(null);
  const [pickingScanInput, setPickingScanInput] = useState('');
  const [scannedMaterials, setScannedMaterials] = useState<ScannedMaterial[]>([]);
  const [fifoOpen, setFifoOpen] = useState(false);
  const [fifoPending, setFifoPending] = useState<ScannedMaterial | null>(null);
  const [fifoEarliest, setFifoEarliest] = useState<{ productionDate?: string; batchNo?: string; qty: number } | null>(null);
  const [fifoChecking, setFifoChecking] = useState(false);
  const [tailLabels, setTailLabels] = useState<TailLabel[]>([]);
  const [itemLocations, setItemLocations] = useState<Record<string, string>>({});

  const [filters, setFilters] = useState({
    pickingNo: '',
    workOrderNo: '',
    workSection: '',
  });

  const qrPx = useMemo(() => Math.round(QR_SIZE_MM * PX_PER_MM), []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await workorderApi.getPickingOrderList({
        page,
        pageSize,
        pickingNo: filters.pickingNo || undefined,
        workOrderNo: filters.workOrderNo || undefined,
        workSection: filters.workSection || undefined,
        status: 'approved',
      });
      setData(res.items);
      setTotal(res.total);
    } catch (error) {
      logger.error('Failed to fetch issuing orders:', String(error));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filters]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /** 最近扫过的标签（去重键 → 时间戳）。同一箱重复扫不该记两次。 */
  const recentScansRef = useRef<Map<string, number>>(new Map());
  const SCAN_DEDUP_MS = 30_000;

  /**
   * 扫码「只进清单」，不落库。
   *
   * 旧实现是扫一张扣一张（扫码即扣账、无确认、无撤销）。现在改为把数量并入
   * `scannedQtys`，由「确认发料」（handleIssue）一次性批量提交 —— 页面本来就有这条通路。
   *
   * 三个收益：
   * 1. 连续扫码不被打断（作业节奏不变，只是"扣账时机"从每张挪到点一次按钮）；
   * 2. 误扫可以从清单里删行再提交 —— 撤销语义变成"删行"，后端不需要新增撤销接口；
   * 3. 焦点可以一直留在扫码框，不会因为每次扣账后的重渲染被抢走。
   *
   * 注意：改为排队之后，服务端那层「剩余量」保护在扫码阶段不生效（还没提交），
   * 所以这里必须按「应领 − 已发 − 已排队」自行卡上限，否则会把清单排超。
   */
  const addScannedMaterial = (parsed: { materialCode: string; qty: number; batchNo?: string; productionDate?: string; serialNo?: string }) => {
    const dedupKey = parsed.serialNo || `${parsed.materialCode}|${parsed.batchNo ?? ''}|${parsed.qty}`;
    const now = Date.now();
    const recent = recentScansRef.current;
    const lastAt = recent.get(dedupKey);
    if (lastAt !== undefined && now - lastAt < SCAN_DEDUP_MS) {
      toast.info(tf('ui.标签 {code} 刚刚已扫过，已忽略', { code: dedupKey }));
      materialScanRef.current?.focus();
      return;
    }
    for (const [k, at] of recent) {
      if (now - at >= SCAN_DEDUP_MS) recent.delete(k);
    }
    recent.set(dedupKey, now);

    if (!detailData) {
      toast.error(tf('ui.请先选择一张领料单再扫码', {}));
      materialScanRef.current?.focus();
      return;
    }
    const item = detailData.items?.find((i) => i.materialCode === parsed.materialCode);
    if (!item) {
      // 之前这里是静默返回，现场只看到「扫了没反应」；必须明确告诉仓管员原因
      toast.error(tf('ui.物料 {code} 不在本领料单明细中，未加入清单', { code: parsed.materialCode }));
      materialScanRef.current?.focus();
      return;
    }

    const queued = scannedQtys[item.id] || 0;
    const remaining = item.pickQty - (item.actualQty || 0) - queued;
    if (remaining <= 0) {
      toast.info(tf('ui.物料 {code} 已发满，无需再发', { code: item.materialCode }));
      materialScanRef.current?.focus();
      return;
    }
    const addQty = Math.min(parsed.qty, remaining);
    if (parsed.qty > remaining) {
      toast.info(tf('ui.标签数量 {scan} 超过剩余需求 {remain}，本次按 {qty} 计入清单', {
        scan: parsed.qty, remain: remaining, qty: addQty,
      }));
    }
    if (addQty <= 0) {
      materialScanRef.current?.focus();
      return;
    }

    setScannedMaterials((prev) => {
      const existing = prev.find((m) => m.materialCode === parsed.materialCode);
      if (existing) {
        return prev.map((m) =>
          m.materialCode === parsed.materialCode ? { ...m, qty: m.qty + addQty } : m,
        );
      }
      return [...prev, {
        materialCode: parsed.materialCode,
        qty: addQty,
        batchNo: parsed.batchNo,
        productionDate: parsed.productionDate,
      }];
    });
    setScannedQtys((prev) => ({ ...prev, [item.id]: (prev[item.id] || 0) + addQty }));

    toast.success(tf('ui.已加入待发清单：{code} {qty}', { code: item.materialCode, qty: addQty }));
    // 焦点常驻扫码框：连续作业的关键，扫码枪是键盘设备，失焦就等于"扫了没反应"
    materialScanRef.current?.focus();
  };

  const checkFifoAndAdd = async (parsed: { materialCode: string; qty: number; batchNo?: string; productionDate?: string; serialNo?: string }) => {
    if (!parsed.productionDate) {
      addScannedMaterial(parsed);
      return;
    }
    setFifoChecking(true);
    try {
      const res = await inventoryApi.getInventoryList({
        page: 1,
        pageSize: 200,
        materialCode: parsed.materialCode,
        stockStatus: 'good',
      });
      const available = (res.items || []).filter((inv) => !inv.locked && inv.quantity > 0);
      if (available.length === 0) {
        addScannedMaterial(parsed);
        return;
      }
      const sorted = [...available].sort((a, b) => {
        const da = a.productionDate || '9999-12-31';
        const db = b.productionDate || '9999-12-31';
        return da.localeCompare(db);
      });
      const earliest = sorted[0];
      const earliestDate = earliest.productionDate || '';
      if (!earliestDate || parsed.productionDate <= earliestDate) {
        addScannedMaterial(parsed);
        return;
      }
      const totalQty = sorted
        .filter((inv) => inv.productionDate === earliestDate)
        .reduce((s, inv) => s + inv.quantity, 0);
      setFifoEarliest({
        productionDate: earliestDate,
        batchNo: earliest.batchNo,
        qty: totalQty,
      });
      setFifoPending({ ...parsed });
      setFifoOpen(true);
      speakError(t('ui.违反先进先出'));
    } catch (error) {
      logger.error('FIFO check failed:', String(error));
      addScannedMaterial(parsed);
    } finally {
      setFifoChecking(false);
    }
  };

  const handleFifoContinue = () => {
    if (fifoPending) {
      addScannedMaterial(fifoPending);
    }
    setFifoOpen(false);
    setFifoPending(null);
    setFifoEarliest(null);
    materialScanRef.current?.focus();
  };

  const handleFifoCancel = () => {
    setFifoOpen(false);
    setFifoPending(null);
    setFifoEarliest(null);
    materialScanRef.current?.focus();
  };

  const removeScannedMaterial = (materialCode: string) => {
    // 删行必须同步扣回「待发数量」，否则清单显示已删、提交时仍按旧数量过账
    const row = scannedMaterials.find((m) => m.materialCode === materialCode);
    setScannedMaterials((prev) => prev.filter((m) => m.materialCode !== materialCode));
    if (!row) return;
    const item = detailData?.items?.find((i) => i.materialCode === materialCode);
    if (!item) return;
    setScannedQtys((prev) => ({
      ...prev,
      [item.id]: Math.max(0, (prev[item.id] || 0) - row.qty),
    }));
  };

  const adjustMaterialQty = (materialCode: string, delta: number) => {
    const item = detailData?.items?.find((i) => i.materialCode === materialCode);
    const row = scannedMaterials.find((m) => m.materialCode === materialCode);
    if (!item || !row) return;
    const cap = item.pickQty - (item.actualQty || 0);
    const nextQty = Math.max(0, Math.min(row.qty + delta, cap));
    const applied = nextQty - row.qty;
    setScannedMaterials((prev) =>
      prev
        .map((m) => (m.materialCode === materialCode ? { ...m, qty: nextQty } : m))
        .filter((m) => m.qty > 0),
    );
    if (applied !== 0) {
      setScannedQtys((prev) => ({
        ...prev,
        [item.id]: Math.max(0, (prev[item.id] || 0) + applied),
      }));
    }
  };

  const handleMaterialScan = async () => {
    const raw = materialScanInput.trim();
    if (!raw) return;
    // 识别领料单号（PK开头）
    if (raw.startsWith('PK')) {
      setPickingInput(raw);
      await loadPickingOrder(raw);
      setMaterialScanInput('');
      materialScanRef.current?.focus();
      return;
    }
    const parsed = parseMaterialLabel(raw);
    if (!parsed) {
      toast(t('workorder.invalidLabel'));
      setMaterialScanInput('');
      return;
    }
    setMaterialScanInput('');
    // 直接自动扣账，不依赖闭包，不先弹FIFO阻塞
    if (!detailData || !detailData.items) {
      toast.warning(t('ui.请先在下方选择领料单，再扫描物料标签'));
      materialScanRef.current?.focus();
      return;
    }
    if (detailData && detailData.items) {
      let item = detailData.items.find((i) => i.materialCode === parsed.materialCode);
      let isSub = false;
      let subItemId = '';
      // 找不到原物料，直接按物料匹配替代料，后续可补充替代料查询接口
      if (!item) {
        for (const origItem of detailData.items) {
          if (parsed.materialCode.includes(origItem.materialCode)) {
            item = origItem;
            isSub = true;
            break;
          }
        }
      }
      if (!item) {
        // 之前静默返回，现场只看到「扫了没反应」；明确提示不在本单
        toast.error(tf('ui.物料 {code} 不在本领料单明细中，未扣账', { code: parsed.materialCode }));
        materialScanRef.current?.focus();
        return;
      }
      if (item) {
        const remaining = item.pickQty - (item.actualQty || 0);
        if (remaining <= 0) {
          toast.info(tf('ui.物料 {code} 已发满，无需再发', { code: item.materialCode }));
          materialScanRef.current?.focus();
          return;
        }
        const addQty = Math.min(parsed.qty, remaining);
        if (parsed.qty > remaining) {
          toast.info(tf('ui.标签数量 {scan} 超过剩余需求 {remain}，本次按 {qty} 发料', {
            scan: parsed.qty, remain: remaining, qty: addQty,
          }));
        }
        if (addQty > 0) {
          try {
            let res;
            if (isSub) {
              res = await workorderApi.pickMaterial(detailData.id, { items: [{ id: item.id, actualQty: addQty, labelNo: parsed.serialNo, labelQty: parsed.qty }] });
              toast.success(tf('ui.已替代发料：{from} → {to} {qty}', { from: item.materialCode, to: parsed.materialCode, qty: addQty }));
            } else {
              res = await workorderApi.pickMaterial(detailData.id, { items: [{ id: item.id, actualQty: addQty, labelNo: parsed.serialNo, labelQty: parsed.qty }] });
              toast.success(tf('ui.已自动扣账：{code} {qty}', { code: item.materialCode, qty: addQty }));
            }
            setDetailData(res.order);
            setTailLabels(res.tailLabels || []);
            // 扫一箱只扣这一箱：若还没满足需求，提示继续扫下一箱
            const after = (res.order.items || []).find((x: any) => x.id === item!.id);
            const stillShort = after ? Number(after.pickQty) - Number(after.actualQty) : 0;
            if (stillShort > 0) {
              toast.info(tf('ui.本箱已发 {qty}，还差 {short}，请继续扫描下一箱', { qty: addQty, short: stillShort }));
            }
            // 清空打印队列，避免旧标签残留
            window.dispatchEvent(new CustomEvent('clearTailPrintQueue'));
            const qtys: Record<string, number> = {};
            for (const it of res.order.items || []) {
              qtys[it.id] = 0;
            }
            setScannedQtys(qtys);
            fetchData();
          } catch (e: any) {
            const info = extractApiError(e, '扣账失败');
            toast.error(info.message || '扣账失败');
            logger.error('pick material failed:', info.message);
          }
        }
      }
    }
    materialScanRef.current?.focus();
  };

  const loadPickingOrder = async (no: string) => {
    const code = no.trim();
    if (!code) return;
    setDetailLoading(true);
    try {
      const res = await workorderApi.getPickingOrderByNo(code);
      if (res.status !== 'approved') {
        toast(t('workorder.pickingOrderNotFound'));
        setDetailData(null);
        setScannedQtys({});
      } else {
        setDetailData(res);
        const qtys: Record<string, number> = {};
        if (res.items) {
          for (const item of res.items) {
            const scanned = scannedMaterials.find((m) => m.materialCode === item.materialCode);
            const remaining = item.pickQty - (item.actualQty || 0);
            const scanQty = scanned ? Math.min(scanned.qty, remaining) : 0;
            qtys[item.id] = scanQty;
            // 查询每个物料的可用库位，存到state
            try {
              const invRes = await inventoryApi.getInventoryList({
                page: 1,
                pageSize: 10,
                materialCode: item.materialCode,
                stockStatus: 'good',
              });
              const available = (invRes.items || []).filter((inv) => !inv.locked && inv.quantity > 0);
              const locs = available.map((inv) => `${inv.locationCode || (inv as any).locationName}(${inv.quantity})`).join('、');
              setItemLocations((prev) => ({ ...prev, [item.materialCode]: locs || t('ui.无库存') }));
            } catch (e) {
              console.error('查库位失败', e);
              setItemLocations((prev) => ({ ...prev, [item.materialCode]: t('ui.查询失败') }));
            }
          }
        }
        setScannedQtys(qtys);
      }
    } catch (error: any) {
      toast(error?.response?.data?.message || t('workorder.pickingOrderNotFound'));
      setDetailData(null);
      setScannedQtys({});
    } finally {
      setDetailLoading(false);
    }
  };

  const handlePickingScan = () => {
    const code = pickingScanInput.trim();
    if (!code) return;
    setPickingInput(code);
    loadPickingOrder(code);
    setPickingScanInput('');
  };

  const handleQueryByNo = (no?: string) => {
    const code = (no || pickingInput).trim();
    if (!code) {
      toast(t('workorder.enterPickingNoOrScan'));
      return;
    }
    setPickingInput(code);
    loadPickingOrder(code);
  };

  const updateScannedQty = (itemId: string, value: string) => {
    const qty = Number(value) || 0;
    const item = detailData?.items?.find((i) => i.id === itemId);
    if (!item) return;
    const remaining = item.pickQty - (item.actualQty || 0);
    const finalQty = Math.max(0, Math.min(qty, remaining));
    setScannedQtys({ ...scannedQtys, [itemId]: finalQty });
  };

  const adjustQty = (itemId: string, delta: number) => {
    const item = detailData?.items?.find((i) => i.id === itemId);
    if (!item) return;
    const current = scannedQtys[itemId] || 0;
    const remaining = item.pickQty - (item.actualQty || 0);
    const next = Math.max(0, Math.min(current + delta, remaining));
    setScannedQtys({ ...scannedQtys, [itemId]: next });
  };

  const handleIssue = async () => {
    if (!detailData) return;
    const itemsToIssue = Object.entries(scannedQtys)
      .filter(([_, qty]) => qty > 0)
      .map(([id, qty]) => ({ id, actualQty: qty }));

    if (itemsToIssue.length === 0) {
      toast(t('workorder.noScannedItems'));
      return;
    }

    // 确认框带范围：扫进清单的物料数 + 总数量，避免"点了才发现扣多了"
    const totalQty = itemsToIssue.reduce((s, it) => s + it.actualQty, 0);
    if (!await showConfirm(tf('ui.将提交 {n} 种物料、共 {qty} 件发料并扣账，提交后不可撤销。确认继续？', {
      n: itemsToIssue.length,
      qty: totalQty,
    }))) return;

    setIssuing(true);
    try {
      const res: PickMaterialResult = await workorderApi.pickMaterial(detailData.id, { items: itemsToIssue });
      setDetailData(res.order);
      setTailLabels(res.tailLabels || []);
      const qtys: Record<string, number> = {};
      if (res.order.items) {
        for (const item of res.order.items) {
          qtys[item.id] = 0;
        }
      }
      setScannedQtys(qtys);
      setScannedMaterials([]);
      toast(t('workorder.issueSuccess'));
      fetchData();
    } catch (error: any) {
      toast(error?.response?.data?.message || t('workorder.issueFailed'));
    } finally {
      setIssuing(false);
    }
  };

  const handleSearch = () => {
    // setPage(1) 是异步的：紧接着调 fetchData() 用的是闭包里的旧 page，
    // 与 useEffect 里那次正确请求形成竞态 —— 旧结果后到就会闪出一张空表。
    // 已在第 1 页时 setPage(1) 不触发重渲染，才需要手动刷新。
    if (page === 1) fetchData();
    else setPage(1);
  };

  const handleReset = () => {
    setFilters({ pickingNo: '', workOrderNo: '', workSection: '' });
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
      completed: 'default',
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
      completed: t('workorder.status_completed'),
    };
    return <Badge variant={variantMap[status] || 'secondary'}>{labelMap[status] || status}</Badge>;
  };

  const unmatchedMaterials = useMemo(() => {
    if (!detailData?.items) return scannedMaterials;
    const itemCodes = new Set(detailData.items.map((i: PickingOrderItem) => i.materialCode));
    return scannedMaterials.filter((m) => !itemCodes.has(m.materialCode));
  }, [scannedMaterials, detailData]);

  const columns: TableProps<PickingOrderRecord>['columns'] = [
    { title: t('workorder.pickingNo'), dataIndex: 'pickingNo', width: 200, fixed: 'left' },
    { title: t('workorder.workOrderNo'), dataIndex: 'workOrderNo', width: 160 },
    {
      title: t('bom.workSection'),
      dataIndex: 'workSection',
      width: 100,
      render: (section: string) => sectionLabel(section),
    },
    { title: t('common.quantity'), dataIndex: 'totalQty', width: 100, align: 'right' },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 100,
      render: (status: string) => statusBadge(status),
    },
    { title: t('workorder.applicant'), dataIndex: 'applicantName', width: 100 },
    { title: t('workorder.approver'), dataIndex: 'approverName', width: 100, render: (v: string) => tui(v) },
  ];

  const itemColumns: TableProps<PickingOrderItem>['columns'] = [
    { title: '#', dataIndex: 'idx', width: 40, render: (_: any, __: PickingOrderItem, index: number) => index + 1 },
    { title: t('material.materialCode'), dataIndex: 'materialCode', width: 120 },
    { title: t('material.materialName'), dataIndex: 'materialName', width: 140 },
    { title: t('common.unit'), dataIndex: 'unit', width: 60 },
    { title: t('workorder.pickQty'), dataIndex: 'pickQty', width: 90, align: 'right' },
    { title: t('workorder.alreadyPicked'), dataIndex: 'actualQty', width: 90, align: 'right' },
    {
      title: t('workorder.scannedQty'),
      key: 'scanned',
      width: 140,
      align: 'center',
      render: (_: any, record: PickingOrderItem) => {
        const remaining = record.pickQty - (record.actualQty || 0);
        const isFull = remaining <= 0;
        if (isFull) {
          return <Badge variant="outline" className="text-green-600">{t('workorder.fullyPicked')}</Badge>;
        }
        return (
          <div className="flex items-center justify-center gap-1">
            <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => adjustQty(record.id, -1)}>
              <Minus className="w-3 h-3" />
            </Button>
            <Input
              type="number"
              value={scannedQtys[record.id] ?? 0}
              onChange={(e) => updateScannedQty(record.id, e.target.value)}
              className="w-16 h-7 text-center"
              min={0}
              max={remaining}
            />
            <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => adjustQty(record.id, 1)}>
              <Plus className="w-3 h-3" />
            </Button>
          </div>
        );
      },
    },
    {
      title: t('workorder.cumulativePicked'),
      key: 'cumulative',
      width: 100,
      align: 'right',
      render: (_: any, record: PickingOrderItem) => (record.actualQty || 0) + (scannedQtys[record.id] || 0),
    },
    {
      title: t('workorder.diff'),
      key: 'diff',
      width: 80,
      align: 'right',
      render: (_: any, record: PickingOrderItem) => {
        const cumulative = (record.actualQty || 0) + (scannedQtys[record.id] || 0);
        const diff = cumulative - record.pickQty;
        const color = diff >= 0 ? 'text-green-600' : 'text-red-500';
        return <span className={color}>{diff >= 0 ? '+' : ''}{diff}</span>;
      },
    },
    {
      title: t('ui.库位/可用库存'),
      dataIndex: 'location',
      width: 180,
      render: (_: any, record: PickingOrderItem) => {
        const loc = itemLocations[record.materialCode] || '加载中...';
        const color = loc === t('ui.无库存') || loc === t('ui.查询失败') ? 'text-red-500' : 'text-green-600';
        return <span className={color}>{loc}</span>;
      },
    },
  ];

  const scannedMatColumns: TableProps<ScannedMaterial>['columns'] = [
    { title: '#', dataIndex: 'idx', width: 40, render: (_: any, __: ScannedMaterial, index: number) => index + 1 },
    { title: t('material.materialCode'), dataIndex: 'materialCode', width: 140 },
    { title: t('common.batch'), dataIndex: 'batchNo', width: 120, render: (val?: string) => val || '-' },
    { title: t('common.productionDate'), dataIndex: 'productionDate', width: 120, render: renderDate },
    { title: t('common.quantity'), dataIndex: 'qty', width: 120, align: 'right',
      render: (_: any, record: ScannedMaterial) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => adjustMaterialQty(record.materialCode, -1)}>
            <Minus className="w-3 h-3" />
          </Button>
          <span className="w-12 text-center font-medium">{record.qty}</span>
          <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => adjustMaterialQty(record.materialCode, 1)}>
            <Plus className="w-3 h-3" />
          </Button>
        </div>
      ),
    },
    {
      title: t('common.operation'),
      key: 'action',
      width: 80,
      align: 'center',
      render: (_: any, record: ScannedMaterial) => (
        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeScannedMaterial(record.materialCode)}>
          <Trash2 className="w-3 h-3" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-[12px] p-4 border border-border">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <ScanLine className="w-5 h-5 text-primary" />
          {t('workorder.scanMaterialLabel')}
        </h3>

        <div className="flex items-start gap-4 mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <ScanInput
                inputRef={materialScanRef}
                value={materialScanInput}
                onChange={setMaterialScanInput}
                onScan={handleMaterialScan}
                onKeyDown={(e) => { if (e.key === 'Enter') handleMaterialScan(); }}
                placeholder={t('workorder.scanMaterialLabel')}
                inputClassName="max-w-md"
                className="flex-1"
              />
              <Button onClick={handleMaterialScan}>
                <ScanLine className="w-4 h-4 mr-1" />
                {t('common.confirm')}
              </Button>
              {scannedMaterials.length > 0 && (
                <Badge variant="secondary">
                  {scannedMaterials.length} {t('material.materialList')} / {scannedMaterials.reduce((s, m) => s + m.qty, 0)} {t('common.items')}
                </Badge>
              )}
            </div>
          </div>
          <div className="shrink-0">
            <TailLabelPanel labels={tailLabels} />
          </div>
        </div>

        {scannedMaterials.length > 0 && (
          <div className="border border-border rounded-lg overflow-hidden mb-4">
            <ResizableTable
              columns={scannedMatColumns}
              dataSource={scannedMaterials}
              rowKey="materialCode"
              pagination={false}
              scroll={{ y: 200 }}
              size="small"
            />
          </div>
        )}

        <div className="flex items-center gap-2 py-2 bg-primary/5 rounded-lg px-3">
          <MousePointerClick className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-primary">{t('ui.从下方领料单列表点击选择，扫描物料标签会先加入待发清单，核对无误后点「确认发料」一次性过账')}</span>
        </div>

        {detailData && (
          <div className="border-t border-border pt-4 mt-4 space-y-3">
            <div className="flex items-start gap-6">
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
                  <span>{tui(detailData.approverName) || '-'}</span>
                </div>
              </div>
            </div>

            {unmatchedMaterials.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm text-amber-800">
                ⚠️ {t('workorder.unmatchedMaterials')}：{unmatchedMaterials.map((m) => m.materialCode).join(', ')}
              </div>
            )}

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
                  scroll={{ x: 1000, y: 320 }}
                  size="small"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setDetailData(null); setScannedQtys({}); }}>
                {t('common.cancel')}
              </Button>
              {detailData.status === 'approved' && (
                <Button onClick={handleIssue} disabled={issuing}>
                  {issuing ? t('common.saving') : t('workorder.confirmIssue')}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="bg-card rounded-[12px] p-4 border border-border">
        <h3 className="text-lg font-semibold mb-4">{t('issuing.pageTitle')}</h3>
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
            <Select value={filters.workSection} onValueChange={(val) => setFilters({ ...filters, workSection: val })}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('common.all')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t('common.all')}</SelectItem>
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
          scroll={{ x: 900, y: 400 }}
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
              loadPickingOrder(record.pickingNo);
            },
            style: { cursor: 'pointer' },
          })}
        />
        <p className="text-xs text-muted-foreground mt-2">
          {t('ui.单击领料单即可加载详情，然后扫描物料标签发货')}
        </p>
      </div>

      <Dialog open={fifoOpen} onOpenChange={setFifoOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-amber-600">{t('workorder.fifoWarning')}</DialogTitle>
            <DialogDescription>
              <div className="space-y-3 pt-2">
                <p className="text-sm text-muted-foreground">
                  {t('workorder.fifoWarningDescPrefix')}{formatDate(fifoEarliest?.productionDate)}{t('workorder.fifoWarningDescSuffix')}
                </p>
                {fifoEarliest && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm space-y-1">
                    <div>
                      <span className="text-muted-foreground">{t('common.productionDate')}：</span>
                      <span className="font-medium text-amber-800">{formatDate(fifoEarliest.productionDate)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t('common.batch')}：</span>
                      <span className="font-medium">{fifoEarliest.batchNo || '-'}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t('common.availableQty')}：</span>
                      <span className="font-medium">{fifoEarliest.qty}</span>
                    </div>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {t('workorder.fifoForceContinueTip')}
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleFifoCancel}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleFifoContinue}>
              {t('workorder.fifoForceContinue')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default IssuingManage;















