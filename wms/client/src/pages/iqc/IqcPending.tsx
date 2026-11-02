import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n, tf } from '@client/src/i18n';
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
import { Table, type TableProps } from '@client/src/compat/antd-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import { logger } from '@client/src/utils/logger';
import { renderDate, renderDateTimeMinute } from '@client/src/utils/datetime';
import { Textarea } from '@client/src/components/ui/textarea';
import { toast } from 'sonner';
import {
  getPendingList,
  judgeLot,
  exemptConfirmLot,
  getIqcAnomalies,
  getManualJudgments,
} from '@client/src/api/iqc';
import {
  extendExpiryByBatch,
  getMaterialExpiryStock,
} from '@client/src/api/inventory';
import { useAuth } from '@client/src/auth/AuthContext';
import type {
  IqcLot,
  IqcAnomalyResult,
  IqcManualJudgmentItem,
} from '@shared/api.interface';

/**
 * 人工判定原因（质量体系审核必查项）。
 * 选「其他」时必须补文字说明，服务端还会校验原因非空。
 */
const MANUAL_JUDGE_REASON_OPTIONS = [
  { code: 'exempt_material', label: '免检物料' },
  { code: 'urgent_release', label: '急料放行' },
  { code: 'customer_approval', label: '客户特批' },
  { code: 'equipment_failure', label: '检验设备故障' },
  { code: 'supplier_8d_closed', label: '供应商 8D 已闭环' },
  { code: 'other', label: '其他' },
] as const;

/** 允许人工判定（直接维护 pass/fail）的角色 */
const MANUAL_JUDGE_ROLES = ['iqc_manager', 'quality_manager', 'admin'];

/** 本地 CSV 导出（UTF-8 BOM，Excel 打开不乱码） */
function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number>>) {
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const content = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');
  const blob = new Blob([`\ufeff${content}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const IqcPending: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { user } = useAuth();
  // 人工判定权限：仅 IQC 主管 / 质量经理 / 管理员（服务端同样有 @NeedRoles 兜底）
  const canManualJudge = MANUAL_JUDGE_ROLES.includes(String(user?.roleCode || ''));
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [data, setData] = useState<IqcLot[]>([]);
  const [loading, setLoading] = useState(false);

  const [materialCode, setMaterialCode] = useState('');
  const [supplierCode, setSupplierCode] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [status, setStatus] = useState('');
  const [judging, setJudging] = useState<string | null>(null);
  // 快捷判定确认弹窗：防止误触直接判定整批
  const [judgeTarget, setJudgeTarget] = useState<{ record: IqcLot; result: 'pass' | 'fail' } | null>(null);
  // 人工判定原因（服务端强制必填）
  const [judgeReasonCode, setJudgeReasonCode] = useState('');
  const [judgeReasonNote, setJudgeReasonNote] = useState('');
  // 漏提报告异常（待检超期 / 草稿超时 / 零小项判定）
  const [anomaly, setAnomaly] = useState<IqcAnomalyResult | null>(null);
  const [anomalyDialog, setAnomalyDialog] = useState<'pendingOverdue' | 'draftStale' | 'zeroRecordJudged' | null>(null);
  // 人工判定台账
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [ledger, setLedger] = useState<{ items: IqcManualJudgmentItem[]; total: number }>({ items: [], total: 0 });
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  // 免检确认弹窗：检验属性为免检（外观+尺寸功能都免检）的批次，核对信息后直接维护合格
  const [exemptTarget, setExemptTarget] = useState<IqcLot | null>(null);
  const [exemptRemark, setExemptRemark] = useState('');
  const [exemptSubmitting, setExemptSubmitting] = useState(false);

  // 维护有效期（延期）弹窗：超期 / 预警物料在判定合格前必须先维护新有效期。
  // 原先这一步放在「库存管理 → 有效期管理」页面，该页面已下线，统一收敛到这里。
  const [expiryTarget, setExpiryTarget] = useState<IqcLot | null>(null);
  /** 检验员只填延长天数，截止日由系统按「当前有效期 + 天数」算，且不得超过强制报废期 */
  const [expiryExtendDays, setExpiryExtendDays] = useState('');
  const [expiryRemark, setExpiryRemark] = useState('');
  const [expirySaving, setExpirySaving] = useState(false);
  const [expiryInfo, setExpiryInfo] = useState<{
    loading: boolean;
    expiryDate: string | null;
    remainingDays: number | null;
    rows: number;
    scrapDate: string | null;
    maxExtendDays: number | null;
  }>({ loading: false, expiryDate: null, remainingDays: null, rows: 0, scrapDate: null, maxExtendDays: null });

  /** 物理批次：检验批次号带 -R01 复检后缀，库存表里存的是原批次 */
  const physicalBatch = (batchNo?: string | null) => String(batchNo || '').replace(/-R\d+$/i, '');

  /** 是否为超期 / 预警自动推送的批次（这批才需要先维护有效期） */
  const isExpiryLot = (record: IqcLot) =>
    /-R\d+$/i.test(String(record.batchNo || ''))
    || record.materialSource === '超期复检'
    || String(record.remark || '').includes('超期复检')
    || String(record.remark || '').includes('超期物料报检');

  /** 纯日期 + 天数（走 UTC，避开本地时区把日期推差一天），用于预览新截止日 */
  const addDays = (dateStr: string, days: number) => {
    const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
    const dt = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1) + days * 86400000);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  };

  /** 两个纯日期相差天数（to - from） */
  const diffDays = (from: string, to: string) => {
    const toUtc = (s: string) => {
      const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
      return Date.UTC(y || 1970, (m || 1) - 1, d || 1);
    };
    return Math.round((toUtc(to) - toUtc(from)) / 86400000);
  };

  /** 漏提报告异常：拉取失败不影响待检清单展示 */
  const fetchAnomaly = async () => {
    try {
      const res = await getIqcAnomalies();
      setAnomaly(res);
    } catch (error) {
      logger.error('fetch iqc anomalies failed', error);
    }
  };

  /** 人工判定台账（仅主管角色可查） */
  const fetchLedger = async (targetPage = ledgerPage) => {
    if (!canManualJudge) return;
    try {
      setLedgerLoading(true);
      const res = await getManualJudgments({ page: targetPage, pageSize: 20 });
      setLedger({ items: res.items || [], total: res.total || 0 });
      setLedgerPage(targetPage);
    } catch (error) {
      logger.error('fetch manual judgments failed', error);
      toast.error(t('workorder.operationFailed'));
    } finally {
      setLedgerLoading(false);
    }
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await getPendingList({
        page,
        pageSize,
        materialCode,
        supplierCode,
        batchNo,
        startDate,
        endDate,
        status: status || undefined,
        // 未指定状态时只看待检验 + 被驳回；筛选交给服务端，保证「按报检时间升序」在分页后依然成立
        statuses: status ? undefined : 'pending,rejected',
      });
      setData(res.items || []);
      setTotal(res.total || 0);
    } catch (error) {
      logger.error('fetch pending iqc list failed', error);
      toast.error(t('ui.加载待检清单失败'));
    } finally {
      setLoading(false);
    }
    // 异常统计与清单解耦：即便清单接口失败也照常提示漏提
    void fetchAnomaly();
  };

  useEffect(() => {
    fetchData();
  }, [page, status]);

  const handleSearch = () => {
    // setPage(1) 是异步的：紧接着调 fetchData() 用的是闭包里的旧 page，
    // 与 useEffect 里那次正确请求形成竞态 —— 旧结果后到就会闪出一张空表。
    // 已在第 1 页时 setPage(1) 不触发重渲染，才需要手动刷新。
    if (page === 1) fetchData();
    else setPage(1);
  };

  const handleReset = () => {
    setMaterialCode('');
    setSupplierCode('');
    setBatchNo('');
    setStartDate('');
    setEndDate('');
    setStatus('');
    setPage(1);
  };

  const handleJudge = async (record: IqcLot, result: 'pass' | 'fail') => {
    // 原因必填（服务端同样校验）：选「其他」还必须补文字说明
    const option = MANUAL_JUDGE_REASON_OPTIONS.find((o) => o.code === judgeReasonCode);
    if (!option) {
      toast.error(t('ui.请选择原因'));
      return;
    }
    const note = judgeReasonNote.trim();
    if (option.code === 'other' && note.length < 2) {
      toast.error(t('ui.选其他时必须填写说明'));
      return;
    }
    const reason = note ? `${option.label}：${note}` : option.label;
    try {
      // 判合格前先自查该批次在良品仓是否还有已超期行：超期必须先维护延期天数（服务端同样会拦）。
      // 这里提前拦是为了把操作员直接送到「维护有效期」弹窗，而不是先吃一个 400 再自己找入口。
      if (result === 'pass') {
        try {
          const stock = await getMaterialExpiryStock(record.materialId, record.batchNo || undefined);
          const overdue = (stock || []).filter((it) => Number(it.remainingDays) <= 0);
          if (overdue.length > 0) {
            toast.error(
              tf('ui.该批次在良品仓仍有 {n} 行已超期，请先维护延期天数后再判定合格', { n: overdue.length }),
            );
            setJudgeTarget(null);
            void openExpiryDialog(record);
            return;
          }
        } catch (e) {
          // 查询失败不阻断：交给服务端兜底校验
          logger.error('pre-check expiry before judge failed', e);
        }
      }
      setJudging(record.id);
      await judgeLot(record.id, result, { reason });
      toast.success(result === 'pass' ? t('ui.已判定合格') : t('ui.已判定不合格'));
      setJudgeTarget(null);
      setJudgeReasonCode('');
      setJudgeReasonNote('');
      fetchData();
    } catch (error: any) {
      logger.error('judge lot failed', error);
      // 透出服务端业务提示，例如「该批次已录入 N 条检验小项，不能人工判定」
      toast.error(error?.message || t('workorder.operationFailed'));
    } finally {
      setJudging(null);
    }
  };

  /** 打开「维护有效期」弹窗：先按物料查出该批次在良品仓的超期 / 预警库存，给出当前有效期、剩余天数与报废上限 */
  const openExpiryDialog = async (record: IqcLot) => {
    setExpiryTarget(record);
    setExpiryExtendDays('');
    setExpiryRemark('');
    setExpiryInfo({ loading: true, expiryDate: null, remainingDays: null, rows: 0, scrapDate: null, maxExtendDays: null });
    try {
      const items = await getMaterialExpiryStock(record.materialId, record.batchNo || undefined);
      const target = physicalBatch(record.batchNo);
      const matched = (items || []).filter((it) => String(it.batchNo || '') === target);
      const earliest = matched
        .slice()
        .sort((a, b) => String(a.expiryDate || '').localeCompare(String(b.expiryDate || '')))[0];
      // 报废上限取该批次多行里最早的一个（最严口径），与后端一致
      const scrapDate = matched
        .map((it) => (it.scrapDate ? String(it.scrapDate).slice(0, 10) : ''))
        .filter(Boolean)
        .sort()[0] || null;
      const expiryDate = earliest?.expiryDate ? String(earliest.expiryDate).slice(0, 10) : null;
      setExpiryInfo({
        loading: false,
        expiryDate,
        remainingDays: earliest?.remainingDays ?? null,
        rows: matched.length,
        scrapDate,
        maxExtendDays: scrapDate && expiryDate ? diffDays(expiryDate, scrapDate) : null,
      });
    } catch (error) {
      logger.error('query material expiry stock failed', error);
      setExpiryInfo({ loading: false, expiryDate: null, remainingDays: null, rows: 0, scrapDate: null, maxExtendDays: null });
    }
  };

  /** 提交延期：一次覆盖该批次全部库位行，库存锁定保留到 IQC 判定合格才解除 */
  const handleSaveExpiry = async () => {
    if (!expiryTarget) return;
    const raw = expiryExtendDays.trim();
    const days = Number(raw);
    if (!raw || !Number.isInteger(days) || days <= 0) {
      toast.error(t('ui.延长天数必须是大于 0 的整数'));
      return;
    }
    if (expiryInfo.maxExtendDays !== null && days > expiryInfo.maxExtendDays) {
      toast.error(
        tf('ui.超出强制报废期，最多只能延长 {n} 天（至 {date}）', {
          n: expiryInfo.maxExtendDays,
          date: expiryInfo.scrapDate || '-',
        }),
      );
      return;
    }
    try {
      setExpirySaving(true);
      const res = await extendExpiryByBatch({
        materialId: expiryTarget.materialId,
        batchNo: physicalBatch(expiryTarget.batchNo),
        extendDays: days,
        remark: expiryRemark.trim() || `IQC待检清单维护有效期（${expiryTarget.lotNo}）`,
      });
      toast.success(
        tf('ui.已延长 {days} 天，新有效期 {date}（覆盖 {n} 行库存）', {
          days: res?.extendedDays ?? days,
          date: res?.newExpiryDate || '-',
          n: res?.affected ?? 0,
        }),
      );
      setExpiryTarget(null);
      fetchData();
    } catch (error: any) {
      logger.error('extend expiry by batch failed', error);
      toast.error(error?.response?.data?.message || error?.message || t('ui.维护有效期失败'));
    } finally {
      setExpirySaving(false);
    }
  };

  const handleExemptConfirm = async () => {
    if (!exemptTarget) return;
    try {
      setExemptSubmitting(true);
      await exemptConfirmLot(exemptTarget.id, { remark: exemptRemark || undefined });
      toast.success(t('ui.免检批次确认成功'));
      setExemptTarget(null);
      setExemptRemark('');
      fetchData();
    } catch (error: any) {
      logger.error('exempt confirm lot failed', error);
      toast.error(error?.message || t('workorder.operationFailed'));
    } finally {
      setExemptSubmitting(false);
    }
  };

  /** 免检确认弹窗中展示的报检信息（供 IQC 核对） */
  const buildExemptCheckRows = (lot: IqcLot): { label: string; value: string }[] => [
    { label: t('iqc.reportNo'), value: lot.inspectionNo || lot.lotNo || '-' },
    { label: t('iqc.materialCode'), value: lot.materialCode || '-' },
    { label: t('iqc.materialName'), value: lot.materialName || '-' },
    { label: t('print.supplier'), value: lot.supplierName || '-' },
    { label: t('iqc.batchNo'), value: lot.batchNo || '-' },
    { label: t('pda.mrb.qty'), value: `${lot.totalQty ?? '-'} ${lot.unit || ''}`.trim() },
    { label: t('common.productionDate'), value: renderDate(lot.productionDate) || '-' },
    { label: t('iqc.submittedAt'), value: renderDateTimeMinute(lot.submittedAt) || '-' },
    { label: t('system.locationCode'), value: lot.locationCodes || '-' },
  ];

  const columns: TableProps<IqcLot>['columns'] = [
    {
      // 检验编号：仓库提交待检清单时生成，IQC 检验报告的报告编号就是它
      title: t('iqc.reportNo'),
      dataIndex: 'inspectionNo',
      key: 'inspectionNo',
      width: 140,
      render: (val: string) => (
        <span className="font-mono text-sm font-medium text-foreground">{val || '-'}</span>
      ),
    },
    {
      // 报检时间：仓库提交待检清单的时间，格式 2026-10-02 20:39
      title: t('iqc.submittedAt'),
      dataIndex: 'submittedAt',
      key: 'submittedAt',
      width: 140,
      render: (val: string) => <span className="text-foreground">{renderDateTimeMinute(val)}</span>,
    },
    {
      title: t('iqc.batchNo'),
      dataIndex: 'batchNo',
      key: 'batchNo',
      width: 96,
      render: (val: string) => <span>{val || '-'}</span>,
    },
    {
      title: t('iqc.materialCode'),
      dataIndex: 'materialCode',
      key: 'materialCode',
      width: 110,
      render: (val: string, record: IqcLot) => (
        <div className="flex items-center gap-1 flex-wrap">
          <span>{val || '-'}</span>
          {record.isExempt && (
            <span className="px-1.5 py-0.5 text-xs bg-muted text-foreground rounded">
              {t('ui.免检')}
            </span>
          )}
        </div>
      ),
    },
    {
      title: t('iqc.materialName'),
      dataIndex: 'materialName',
      key: 'materialName',
      width: 112,
      render: (val: string) => (
        <span className="block truncate" title={val}>{val || '-'}</span>
      ),
    },
    {
      title: t('print.supplier'),
      dataIndex: 'supplierName',
      key: 'supplierName',
      width: 122,
      render: (val: string) => (
        <span className="block truncate" title={val}>{val || '-'}</span>
      ),
    },
    {
      title: t('pda.mrb.qty'),
      dataIndex: 'totalQty',
      key: 'totalQty',
      width: 64,
    },
    {
      title: t('common.productionDate'),
      dataIndex: 'productionDate',
      key: 'productionDate',
      width: 100,
      render: (val: string) => renderDate(val),
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      key: 'status',
      width: 92,
      render: (val: string) => {
        const map: Record<string, { text: string; color: string }> = {
          pending: { text: t('ui.待检验'), color: 'bg-yellow-100 text-yellow-800' },
          inspecting: { text: t('iqc.inspecting'), color: 'bg-blue-100 text-blue-800' },
          pending_review: { text: t('iqc.reviewStatus.pending'), color: 'bg-purple-100 text-purple-800' },
          review_pending: { text: t('iqc.reviewStatus.pending'), color: 'bg-purple-100 text-purple-800' },
          pass: { text: t('ui.检验通过'), color: 'bg-green-100 text-green-800' },
          fail: { text: t('ui.检验不通过'), color: 'bg-red-100 text-red-800' },
          rejected: { text: t('ui.被驳回'), color: 'bg-orange-100 text-orange-800' },
          approved: { text: t('ui.已审批'), color: 'bg-green-100 text-green-800' },
        };
        const item = map[val] || { text: val, color: 'bg-muted text-foreground' };
        return <Badge className={item.color}>{item.text}</Badge>;
      },
    },
    {
      title: t('print.materialSource'),
      dataIndex: 'materialSource',
      key: 'materialSource',
      width: 92,
      render: (val: string, record: any) => {
        if (val === 'production_return' || val === '产线退料') return <span className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">{t('ui.产线退料')}</span>;
        if (record.remark === '超期物料报检' || val === 'expiry_reinspect' || val === '超期复检') return <span className="px-1.5 py-0.5 text-xs bg-orange-100 text-orange-700 rounded">{t('ui.超期复检')}</span>;
        return <span className="px-1.5 py-0.5 text-xs bg-muted text-foreground rounded">{t('ui.来料检验')}</span>;
      },
    },
    {
      title: t('common.action'),
      key: 'action',
      width: 320,
      render: (_, record) => (
        <div className="flex gap-2 items-center flex-wrap">
          {/*
            超期 / 预警自动推送的批次：判定合格前必须先维护新有效期。
            「有效期管理」页面已下线，延期入口统一收在这里（判定合格时服务端会强制校验）。
          */}
          {isExpiryLot(record) && (
            <Button
              size="sm"
              variant="secondary"
              style={{ borderColor: '#F97316', color: '#C2410C' }}
              disabled={expirySaving}
              onClick={(e) => {
                e.stopPropagation();
                void openExpiryDialog(record);
              }}
            >
              {t('ui.维护有效期')}
            </Button>
          )}
          {record.isExempt ? (
            /* 检验属性为免检：只做信息核对后维护合格，不做检验记录 */
            <Button
              size="sm"
              style={{ backgroundColor: '#10B981' }}
              disabled={judging === record.id}
              onClick={(e) => {
                e.stopPropagation();
                setExemptTarget(record);
                setExemptRemark('');
              }}
            >
              {t('ui.免检确认')}
            </Button>
          ) : (
            <Button
              size="sm"
              style={{ backgroundColor: 'var(--primary)' }}
              disabled={judging === record.id}
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/iqc/inspect/${record.id}`);
              }}
            >
              {t('ui.检验')}
            </Button>
          )}
          {/*
            人工判定（整批直接维护 pass/fail）：仅 IQC 主管 / 质量经理 / 管理员可见。
            检验员只能走「检验」填报告，从根上堵住「不填报告直接放行」。
            服务端 @NeedRoles 同样限制，前端隐藏只是体验层。
          */}
          {canManualJudge && (
            <>
              <Button
                size="sm"
                variant="default"
                style={{ backgroundColor: '#10B981' }}
                disabled={judging === record.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setJudgeReasonCode('');
                  setJudgeReasonNote('');
                  setJudgeTarget({ record, result: 'pass' });
                }}
              >
                {t('iqc.passed')}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={judging === record.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setJudgeReasonCode('');
                  setJudgeReasonNote('');
                  setJudgeTarget({ record, result: 'fail' });
                }}
              >
                {t('iqc.failed')}
              </Button>
            </>
          )}
        </div>
      ),
    },
    {
      title: t('iqc.remark'),
      dataIndex: 'remark',
      key: 'remark',
      width: 130,
      render: (val: string, record: any) => {
        if (record.status === 'rejected') {
          return <span className="text-xs text-red-600">{val || ''}</span>;
        }
        if (val === '超期物料报检' || val === '超期复检') {
          return <span className="px-1.5 py-0.5 text-xs bg-orange-100 text-orange-700 rounded">{t('ui.超期复检')}</span>;
        }
        return <span className="block truncate text-muted-foreground" title={val}>{val || '-'}</span>;
      },
    },
  ];

  const anomalyTotal = anomaly
    ? anomaly.counts.pendingOverdue + anomaly.counts.draftStale + anomaly.counts.zeroRecordJudged
    : 0;

  /** 台账导出：按 200 条/页拉全量，避免只导出当前页 */
  const handleExportLedger = async () => {
    try {
      const pageSize = 200;
      const all: IqcManualJudgmentItem[] = [];
      let p = 1;
      // 最多 50 页（1 万条），防止异常数据把浏览器拖死
      while (p <= 50) {
        const res = await getManualJudgments({ page: p, pageSize });
        const items = res.items || [];
        all.push(...items);
        if (all.length >= (res.total || 0) || items.length < pageSize) break;
        p += 1;
      }
      downloadCsv(
        `iqc_manual_judgments_${new Date().toISOString().slice(0, 10)}.csv`,
        [
          t('iqc.reportNo'),
          t('iqc.inspectionNo'),
          t('iqc.materialCode'),
          t('iqc.materialName'),
          t('print.supplier'),
          t('common.result'),
          t('ui.原因'),
          t('ui.判定人'),
          t('ui.判定时间'),
          t('common.status'),
        ],
        all.map((r) => [
          r.reportNo || '',
          r.inspectionNo || '',
          r.materialCode || '',
          r.materialName || '',
          r.supplierName || '',
          r.finalResult === 'pass' ? t('iqc.passed') : t('iqc.failed'),
          r.judgeReason || '',
          r.judgedByName || '',
          r.judgedAt ? renderDateTimeMinute(r.judgedAt) : '',
          r.reviewStatus || '',
        ]),
      );
      toast.success(t('ui.导出成功'));
    } catch (error) {
      logger.error('export manual judgments failed', error);
      toast.error(t('workorder.operationFailed'));
    }
  };

  // 延期弹窗的即时校验：天数是否合法、是否超过强制报废期、当前有效期是否已到报废期
  const expiryDaysNum = Number(String(expiryExtendDays).trim());
  const expiryDaysValid = Number.isInteger(expiryDaysNum) && expiryDaysNum > 0;
  const expiryReachScrap = expiryInfo.maxExtendDays !== null && expiryInfo.maxExtendDays <= 0;
  const expiryOverLimit =
    expiryInfo.maxExtendDays !== null && expiryDaysValid && expiryDaysNum > expiryInfo.maxExtendDays;
  const expiryPreviewDate =
    expiryDaysValid && expiryInfo.expiryDate ? addDays(expiryInfo.expiryDate, expiryDaysNum) : null;

  return (
    <div className="space-y-4 p-6">
      {/* 漏提报告异常横幅：待检超期 / 草稿超时 / 零小项判定 */}
      {anomaly && (
        <div
          className={`rounded-lg border px-4 py-3 ${
            anomalyTotal > 0 ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-emerald-50'
          }`}
        >
          <div className="flex items-center gap-3 flex-wrap text-sm">
            <span className={`font-semibold ${anomalyTotal > 0 ? 'text-amber-900' : 'text-emerald-800'}`}>
              {anomalyTotal > 0 ? `⚠ ${t('ui.漏提报告提醒')}` : t('ui.无漏提报告')}
            </span>
            <button
              type="button"
              className={`px-2 py-0.5 rounded border ${
                anomaly.counts.pendingOverdue > 0
                  ? 'border-red-300 bg-card text-red-700 font-medium'
                  : 'border-border bg-card/60 text-muted-foreground'
              }`}
              onClick={() => setAnomalyDialog('pendingOverdue')}
            >
              {tf('ui.待检超期 {n}', { n: anomaly.counts.pendingOverdue })}
              <span className="text-xs ml-1">({anomaly.thresholds.pendingDays}{t('ui.天')})</span>
            </button>
            <button
              type="button"
              className={`px-2 py-0.5 rounded border ${
                anomaly.counts.draftStale > 0
                  ? 'border-amber-300 bg-card text-amber-800 font-medium'
                  : 'border-border bg-card/60 text-muted-foreground'
              }`}
              onClick={() => setAnomalyDialog('draftStale')}
            >
              {tf('ui.草稿超时 {n}', { n: anomaly.counts.draftStale })}
              <span className="text-xs ml-1">({anomaly.thresholds.draftHours}{t('ui.小时')})</span>
            </button>
            <button
              type="button"
              className={`px-2 py-0.5 rounded border ${
                anomaly.counts.zeroRecordJudged > 0
                  ? 'border-orange-300 bg-card text-orange-800 font-medium'
                  : 'border-border bg-card/60 text-muted-foreground'
              }`}
              onClick={() => setAnomalyDialog('zeroRecordJudged')}
            >
              {tf('ui.零小项判定 {n}', { n: anomaly.counts.zeroRecordJudged })}
            </button>
            {canManualJudge && (
              <button
                type="button"
                className="ml-auto px-2 py-0.5 rounded border border-blue-300 bg-card text-blue-700"
                onClick={() => {
                  setLedgerOpen(true);
                  void fetchLedger(1);
                }}
              >
                {t('ui.人工判定台账')}
              </button>
            )}
          </div>
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-4 gap-4 mb-4">
            <Input
              placeholder={t('iqc.materialCode')}
              value={materialCode}
              onChange={(e) => setMaterialCode(e.target.value)}
            />
            <Input
              placeholder={t('material.supplierCode')}
              value={supplierCode}
              onChange={(e) => setSupplierCode(e.target.value)}
            />
            <Input
              placeholder={t('iqc.batchNo')}
              value={batchNo}
              onChange={(e) => setBatchNo(e.target.value)}
            />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue placeholder={t('common.all')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t('common.all')}</SelectItem>
                <SelectItem value="pending">{t('ui.待检验')}</SelectItem>
                <SelectItem value="inspecting">{t('iqc.inspecting')}</SelectItem>
                <SelectItem value="pending_review">{t('iqc.reviewStatus.pending')}</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
            <div className="flex gap-2 col-span-2">
              <Button variant="secondary" onClick={handleReset}>
                {t('common.reset')}
              </Button>
              <Button onClick={handleSearch}>
                {t('common.search')}
              </Button>
            </div>
          </div>

          <Table
            columns={columns}
            dataSource={data}
            rowKey="id"
            loading={loading}
            /* 操作列新增「维护有效期」后按钮变多，不给最小宽度会被压缩换行/裁掉
               （列宽全部生效需要横向滚动，与收料单等其它列表一致） */
            scroll={{ x: 1900 }}
            /* fixed 布局：否则浏览器会把「操作」列压到 106px，4 个按钮被迫换行/被裁 */
            tableLayout="fixed"
            pagination={{
              current: page,
              pageSize,
              total,
              onChange: setPage,
            }}
          />
        </CardContent>
      </Card>

      {/* 免检确认弹窗：核对报检信息后直接维护合格并放行 */}
      <Dialog open={!!exemptTarget} onOpenChange={(open) => { if (!open) setExemptTarget(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('ui.免检确认合格')}</DialogTitle>
            <DialogDescription>
              {t('ui.请核对以下报检信息，确认无误后维护为合格并放行（不生成检验记录）')}
            </DialogDescription>
          </DialogHeader>
          {exemptTarget && (
            <div className="space-y-3">
              <div className="border border-border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <tbody>
                    {buildExemptCheckRows(exemptTarget).map((row) => (
                      <tr key={row.label} className="border-b border-border last:border-b-0">
                        <td className="px-3 py-2 bg-muted text-muted-foreground w-32 whitespace-nowrap">
                          {row.label}
                        </td>
                        <td className="px-3 py-2 break-all">{row.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  {t('ui.备注（选填）')}
                </label>
                <Textarea
                  value={exemptRemark}
                  onChange={(e) => setExemptRemark(e.target.value)}
                  rows={2}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setExemptTarget(null)}>{t('pda.cancel')}</Button>
            <Button
              style={{ backgroundColor: '#10B981' }}
              disabled={exemptSubmitting}
              onClick={handleExemptConfirm}
            >
              {exemptSubmitting ? t('pda.submitting') : t('ui.确认合格并放行')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 人工判定确认弹窗：仅主管可见，必须填写原因（服务端二次校验） */}
      <Dialog open={!!judgeTarget} onOpenChange={(open) => { if (!open) { setJudgeTarget(null); setJudgeReasonCode(''); setJudgeReasonNote(''); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {judgeTarget?.result === 'pass' ? t('ui.确认判定合格？') : t('ui.确认判定不合格？')}
            </DialogTitle>
            <DialogDescription>
              {tf('ui.批次 {batch}（{material}）将被整批标记为', { batch: judgeTarget?.record.batchNo || '-', material: judgeTarget?.record.materialName || '-' })}
              <span className={judgeTarget?.result === 'pass' ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                {judgeTarget?.result === 'pass' ? t('iqc.passed') : t('iqc.failed')}
              </span>
              {t('ui.人工判定仅用于无检验小项的批次，操作将记录判定人与原因')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('ui.人工判定原因')} <span className="text-red-500">*</span>
              </label>
              <Select value={judgeReasonCode} onValueChange={setJudgeReasonCode}>
                <SelectTrigger>
                  <SelectValue placeholder={t('ui.请选择原因')} />
                </SelectTrigger>
                <SelectContent>
                  {MANUAL_JUDGE_REASON_OPTIONS.map((o) => (
                    <SelectItem key={o.code} value={o.code}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('ui.补充说明')}
                {judgeReasonCode === 'other' && <span className="text-red-500 ml-1">*</span>}
              </label>
              <Textarea
                value={judgeReasonNote}
                onChange={(e) => setJudgeReasonNote(e.target.value)}
                rows={3}
                placeholder={judgeReasonCode === 'other' ? t('ui.选其他时必须填写说明') : t('ui.可填写单据号、客户要求等依据')}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {t('ui.该批次若已录入检验小项，系统会拒绝人工判定，请改用驳回重检')}
            </p>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setJudgeTarget(null)}>{t('pda.cancel')}</Button>
            <Button
              variant={judgeTarget?.result === 'pass' ? 'default' : 'destructive'}
              style={judgeTarget?.result === 'pass' ? { backgroundColor: '#10B981' } : undefined}
              disabled={judging === judgeTarget?.record.id || !judgeReasonCode}
              onClick={() => judgeTarget && handleJudge(judgeTarget.record, judgeTarget.result)}
            >
              {t('ui.确认')}{judgeTarget?.result === 'pass' ? t('iqc.passed') : t('iqc.failed')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 维护有效期（延期）：超期物料在判定合格前必须先做这一步 */}
      <Dialog open={!!expiryTarget} onOpenChange={(open) => { if (!open) setExpiryTarget(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('ui.维护有效期（延期）')}</DialogTitle>
            <DialogDescription>
              {tf('ui.批次 {batch}｜物料 {code} {name}', {
                batch: expiryTarget?.batchNo || '-',
                code: expiryTarget?.materialCode || '-',
                name: expiryTarget?.materialName || '',
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded border border-orange-300 bg-orange-50 px-3 py-2 text-sm">
              {expiryInfo.loading ? (
                <span className="text-muted-foreground">{t('pda.loading')}</span>
              ) : expiryInfo.expiryDate ? (
                <span className="text-orange-800">
                  {tf('ui.当前有效期 {date}', { date: expiryInfo.expiryDate })}
                  {' · '}
                  {expiryInfo.remainingDays !== null && expiryInfo.remainingDays <= 0
                    ? <span className="font-medium text-red-600">{tf('ui.已超期 {n} 天', { n: Math.abs(expiryInfo.remainingDays) })}</span>
                    : <span className="font-medium text-yellow-700">{tf('ui.剩 {n} 天', { n: expiryInfo.remainingDays ?? 0 })}</span>}
                  {' · '}
                  {tf('ui.涉及 {n} 行库存', { n: expiryInfo.rows })}
                </span>
              ) : (
                <span className="text-muted-foreground">{t('ui.未查到该批次的超期 / 预警库存，可能已维护过有效期')}</span>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('ui.延长天数')} <span className="text-red-500">*</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  step={1}
                  className="w-full border border-border rounded px-2 py-2 bg-card"
                  value={expiryExtendDays}
                  onChange={(e) => setExpiryExtendDays(e.target.value)}
                  placeholder={t('ui.如 90')}
                />
                <span className="text-sm text-muted-foreground shrink-0">{t('ui.天')}</span>
              </div>
              {/* 系统按「当前有效期 + 天数」算出新截止日，检验员不用自己算日期 */}
              {expiryPreviewDate && expiryInfo.expiryDate && (
                <p className="mt-1 text-xs text-foreground">
                  {tf('ui.新有效期 {date}（{base} + {n} 天）', {
                    date: expiryPreviewDate,
                    base: expiryInfo.expiryDate,
                    n: expiryDaysNum,
                  })}
                </p>
              )}
              {expiryInfo.scrapDate && expiryInfo.maxExtendDays !== null && (
                <p
                  className={`mt-1 text-xs ${
                    expiryReachScrap || expiryOverLimit ? 'text-red-600 font-medium' : 'text-muted-foreground'
                  }`}
                >
                  {expiryReachScrap
                    ? tf('ui.当前有效期已达强制报废期 {date}，不能再延期，请按不合格 / 报废处理', {
                        date: expiryInfo.scrapDate,
                      })
                    : expiryOverLimit
                      ? tf('ui.超出强制报废期，最多只能延长 {n} 天（至 {date}）', {
                          n: expiryInfo.maxExtendDays,
                          date: expiryInfo.scrapDate,
                        })
                      : tf('ui.强制报废期 {date}，最多可延长 {n} 天', {
                          n: expiryInfo.maxExtendDays,
                          date: expiryInfo.scrapDate,
                        })}
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">{t('common.remark')}</label>
              <Textarea
                value={expiryRemark}
                onChange={(e) => setExpiryRemark(e.target.value)}
                rows={2}
                placeholder={t('ui.可填写延期依据，如供应商复检报告编号')}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {t('ui.维护有效期后库存仍保持锁定，判定合格时才放行；判定不合格则转不良品仓。')}
            </p>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setExpiryTarget(null)}>{t('pda.cancel')}</Button>
            <Button
              style={{ backgroundColor: '#F97316' }}
              disabled={expirySaving || !expiryDaysValid || expiryOverLimit || expiryReachScrap}
              onClick={handleSaveExpiry}
            >
              {expirySaving ? t('pda.submitting') : t('ui.确认延长')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 漏提异常清单：待检超期 / 草稿超时 / 零小项判定 */}
      <Dialog open={!!anomalyDialog} onOpenChange={(open) => { if (!open) setAnomalyDialog(null); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {anomalyDialog === 'pendingOverdue'
                ? t('ui.待检超期未检验')
                : anomalyDialog === 'draftStale'
                  ? t('ui.草稿超时未提交')
                  : t('ui.已出结论但无检验小项')}
            </DialogTitle>
            <DialogDescription>
              {anomalyDialog === 'pendingOverdue'
                ? tf('ui.报检后超过 {n} 天仍未检验的批次', { n: anomaly?.thresholds.pendingDays ?? 3 })
                : anomalyDialog === 'draftStale'
                  ? tf('ui.检验草稿超过 {n} 小时未提交的批次', { n: anomaly?.thresholds.draftHours ?? 8 })
                  : t('ui.这些报告没有任何检验数据就给出了结论，请核对判定依据')}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto">
            {anomalyDialog === 'zeroRecordJudged' ? (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="px-2 py-1.5 text-left">{t('iqc.reportNo')}</th>
                    <th className="px-2 py-1.5 text-left">{t('iqc.materialCode')}</th>
                    <th className="px-2 py-1.5 text-left">{t('iqc.materialName')}</th>
                    <th className="px-2 py-1.5 text-left">{t('common.result')}</th>
                    <th className="px-2 py-1.5 text-left">{t('ui.原因')}</th>
                    <th className="px-2 py-1.5 text-left">{t('ui.判定时间')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(anomaly?.zeroRecordJudged || []).map((r) => (
                    <tr key={r.reportId} className="border-b border-border last:border-b-0">
                      <td className="px-2 py-1.5 font-mono text-xs">{r.reportNo}</td>
                      <td className="px-2 py-1.5">{r.materialCode || '-'}</td>
                      <td className="px-2 py-1.5 max-w-[180px] truncate" title={r.materialName}>{r.materialName || '-'}</td>
                      <td className={`px-2 py-1.5 font-medium ${r.finalResult === 'pass' ? 'text-green-600' : 'text-red-600'}`}>
                        {r.finalResult === 'pass' ? t('iqc.passed') : t('iqc.failed')}
                      </td>
                      <td className="px-2 py-1.5 max-w-[260px] truncate" title={r.judgeReason || ''}>{r.judgeReason || '-'}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{r.judgedAt ? renderDateTimeMinute(r.judgedAt) : '-'}</td>
                    </tr>
                  ))}
                  {(anomaly?.zeroRecordJudged || []).length === 0 && (
                    <tr><td colSpan={6} className="px-2 py-6 text-center text-muted-foreground">{t('common.noData')}</td></tr>
                  )}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="px-2 py-1.5 text-left">{t('iqc.reportNo')}</th>
                    <th className="px-2 py-1.5 text-left">{t('iqc.batchNo')}</th>
                    <th className="px-2 py-1.5 text-left">{t('iqc.materialCode')}</th>
                    <th className="px-2 py-1.5 text-left">{t('iqc.materialName')}</th>
                    <th className="px-2 py-1.5 text-left">{t('print.supplier')}</th>
                    <th className="px-2 py-1.5 text-left">{t('iqc.submittedAt')}</th>
                    <th className="px-2 py-1.5 text-right">{t('ui.已等待')}</th>
                  </tr>
                </thead>
                <tbody>
                  {((anomalyDialog === 'pendingOverdue' ? anomaly?.pendingOverdue : anomaly?.draftStale) || []).map((r) => (
                    <tr key={r.lotId} className="border-b border-border last:border-b-0">
                      <td className="px-2 py-1.5 font-mono text-xs">{r.inspectionNo || '-'}</td>
                      <td className="px-2 py-1.5">{r.batchNo || '-'}</td>
                      <td className="px-2 py-1.5">{r.materialCode || '-'}</td>
                      <td className="px-2 py-1.5 max-w-[180px] truncate" title={r.materialName}>{r.materialName || '-'}</td>
                      <td className="px-2 py-1.5 max-w-[160px] truncate" title={r.supplierName}>{r.supplierName || '-'}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{r.submittedAt ? renderDateTimeMinute(r.submittedAt) : '-'}</td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap text-red-600 font-medium">
                        {r.days !== undefined && r.days !== null
                          ? `${r.days}${t('ui.天')}`
                          : `${r.hours ?? 0}${t('ui.小时')}`}
                      </td>
                    </tr>
                  ))}
                  {(anomalyDialog === 'pendingOverdue' ? anomaly?.pendingOverdue : anomaly?.draftStale || [])?.length === 0 && (
                    <tr><td colSpan={7} className="px-2 py-6 text-center text-muted-foreground">{t('common.noData')}</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 人工判定台账（仅主管）：可导出 CSV 供质量体系审核 */}
      <Dialog open={ledgerOpen} onOpenChange={(open) => { if (!open) setLedgerOpen(false); }}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{t('ui.人工判定台账')}</DialogTitle>
            <DialogDescription>{t('ui.所有跳过检验小项直接判定的记录，含原因与判定人')}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th className="px-2 py-1.5 text-left">{t('iqc.reportNo')}</th>
                  <th className="px-2 py-1.5 text-left">{t('iqc.materialCode')}</th>
                  <th className="px-2 py-1.5 text-left">{t('iqc.materialName')}</th>
                  <th className="px-2 py-1.5 text-left">{t('common.result')}</th>
                  <th className="px-2 py-1.5 text-left">{t('ui.原因')}</th>
                  <th className="px-2 py-1.5 text-left">{t('ui.判定人')}</th>
                  <th className="px-2 py-1.5 text-left">{t('ui.判定时间')}</th>
                  <th className="px-2 py-1.5 text-left">{t('common.status')}</th>
                </tr>
              </thead>
              <tbody>
                {ledger.items.map((r) => (
                  <tr key={r.reportId} className="border-b border-border last:border-b-0">
                    <td className="px-2 py-1.5 font-mono text-xs">{r.reportNo}</td>
                    <td className="px-2 py-1.5">{r.materialCode || '-'}</td>
                    <td className="px-2 py-1.5 max-w-[170px] truncate" title={r.materialName}>{r.materialName || '-'}</td>
                    <td className={`px-2 py-1.5 font-medium ${r.finalResult === 'pass' ? 'text-green-600' : 'text-red-600'}`}>
                      {r.finalResult === 'pass' ? t('iqc.passed') : t('iqc.failed')}
                    </td>
                    <td className="px-2 py-1.5 max-w-[220px] truncate" title={r.judgeReason || ''}>{r.judgeReason || '-'}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.judgedByName || '-'}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.judgedAt ? renderDateTimeMinute(r.judgedAt) : '-'}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.reviewStatus || '-'}</td>
                  </tr>
                ))}
                {ledger.items.length === 0 && (
                  <tr><td colSpan={8} className="px-2 py-6 text-center text-muted-foreground">{t('common.noData')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <DialogFooter className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {tf('common.total')} {ledger.total}
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={ledgerPage <= 1 || ledgerLoading}
                onClick={() => fetchLedger(ledgerPage - 1)}
              >
                {t('pda.prev')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={ledgerPage * 20 >= ledger.total || ledgerLoading}
                onClick={() => fetchLedger(ledgerPage + 1)}
              >
                {t('pda.next')}
              </Button>
              <Button size="sm" onClick={handleExportLedger} disabled={ledger.total === 0}>
                {t('ui.导出')}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default IqcPending;
