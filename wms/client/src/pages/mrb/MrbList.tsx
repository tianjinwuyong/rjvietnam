import React, { useState, useEffect, useCallback } from 'react';
import { useI18n, tui, tf, translate } from '@client/src/i18n';
import { Input } from '@client/src/components/ui/input';
import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import { Switch } from '@client/src/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@client/src/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import { Textarea } from '@client/src/components/ui/textarea';
import ResizableTable from '@client/src/components/ui/resizable-table';
import { Table, type TableProps } from '@client/src/compat/antd-table';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';
import {
  getMrbList,
  getMrbLotGroups,
  getPendingLots,
  getMrbOverdueSummary,
  initiateMrb,
  assignReviewers,
  submitMrb,
  cancelMrb,
  withdrawMrb,
  returnBackMrb,
  preApproveMrb,
  finalApprove,
  rejectMrb,
  confirmMrbOut,
  destroyMrbScrap,
  getMrbDetail,
  getMrbLotLabels,
  getReviewerCandidates,
  getMrbPlan,
  saveMrbPlan,
  type MrbOverdueSummary,
  type MrbReviewerInput,
  type MrbReviewerCandidate,
  type MrbPlanDetail,
  type MrbLotLabel,
} from '@client/src/api/mrb';
import { useAuth } from '@client/src/auth/AuthContext';
import MrbPlanDialog from './MrbPlanDialog';
import MrbDispositionEditor, { buildDispositions, validateAlloc } from './MrbDispositionEditor';
import type {
  MrbReview,
  MrbReviewer,
  MrbPendingLot,
  MrbLotGroup,
} from '@shared/api.interface';
import {
  MRB_STATUS_LABEL_KEYS,
  MRB_STATUS_BADGE_VARIANT,
  MRB_DISPOSITION_LABEL_KEYS,
  MRB_OTHER_TYPE_LABEL_KEYS,
  MRB_EXEC_STATUS_LABEL_KEYS,
  MRB_PRE_APPROVE_ROLES,
  MRB_FINAL_ROLES,
  MRB_WRITE_ROLES,
  MRB_CONFIRM_OUT_ROLES,
  MRB_SCRAP_DESTROY_ROLES,
} from '@client/src/constants/business-enums';

/** 从后端统一错误体 { error: { code, message } } 中取出可读文案 */
const pickErrMsg = (error: any): string =>
  error?.response?.data?.error?.message || error?.response?.data?.message || '';

/** 数量按 4 位小数缩放成整数比较，避免浮点误差（与后端 toScaled 同口径） */
const QTY_SCALE = 10000;
const toScaled = (n: number | string): number => Math.round((Number(n) || 0) * QTY_SCALE);
const fromScaled = (n: number): number => n / QTY_SCALE;

/** 停留时长展示：<24h 用小时，否则用天 */
const fmtStuck = (hours: number | null | undefined, t: (k: string) => string): string => {
  if (hours === null || hours === undefined || Number.isNaN(Number(hours))) return '-';
  const h = Number(hours);
  if (h < 24) return `${h.toFixed(h < 10 ? 1 : 0)} ${t('mrb.stuckHourUnit')}`;
  return `${(h / 24).toFixed(1)} ${t('mrb.stuckDayUnit')}`;
};

/**
 * 评审人选择器：按「姓名（工号）」展示，支持姓名/工号模糊筛选。
 *
 * 员工的账号是工号（RJ037 之类），互相记不住，但对同事姓名有印象，
 * 所以列表以姓名为主、工号附在括号里便于核对。选中后回填的是账号 UUID，
 * 与 mrb_reviewer.reviewer_id 的 user_profile 类型一致
 * （此前手输工号会因类型不匹配报错，表现为「提交 MRB 失败」）。
 */
const ReviewerCombobox: React.FC<{
  accounts: Array<{ id: string; account: string; name: string }>;
  value: string;
  onChange: (id: string, name: string) => void;
  placeholder?: string;
  /** 候选名单加载失败时的原因（HTTP 状态码 / network），用于现场定位 */
  loadError?: string;
}> = ({ accounts, value, onChange, placeholder, loadError }) => {
  const [open, setOpen] = useState(false);
  const [kw, setKw] = useState('');
  const selected = accounts.find((a) => a.id === value);
  const key = kw.trim().toLowerCase();
  const filtered = accounts.filter((a) =>
    !key || (a.name || '').toLowerCase().includes(key) || (a.account || '').toLowerCase().includes(key),
  );
  const display = selected ? `${selected.name}（${selected.account}）` : value || '';
  return (
    <div className="relative">
      <Input
        value={open ? kw : display}
        placeholder={placeholder || translate('mrb.reviewerSearchPh')}
        className="h-8"
        onFocus={() => {
          setOpen(true);
          setKw('');
        }}
        onChange={(e) => {
          setKw(e.target.value);
          setOpen(true);
        }}
        onBlur={() => {
          setTimeout(() => setOpen(false), 150);
        }}
      />
      {open && (
        <div className="absolute z-50 mt-1 max-h-52 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
          {filtered.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              {accounts.length === 0
                ? `${translate('mrb.noCandidates')}${loadError ? `（${loadError}）` : ''}`
                : translate('mrb.noMatchedUser')}
            </div>
          ) : (
            filtered.slice(0, 60).map((a) => (
              <div
                key={a.id}
                className="cursor-pointer rounded px-2 py-1.5 text-sm hover:bg-accent"
                onMouseDown={(e) => {
                  // 用 mousedown + preventDefault：避免 input 先失焦把点击吞掉
                  e.preventDefault();
                  onChange(a.id, a.name);
                  setOpen(false);
                  setKw('');
                }}
              >
                {a.name}（{a.account}）
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

const MrbList: React.FC = () => {
  const { t } = useI18n();
  /** 当前登录人：所有写操作的操作人一律以登录身份为准（后端也会强制覆盖请求体传入值） */
  const { user: loginUser, role: loginRole } = useAuth();
  const operatorUserId = loginUser?.id || loginRole?.userId || '';
  const operatorName = loginUser?.name || loginRole?.userName || loginUser?.account || '';
  const roleCode = (loginUser?.roleCode || loginRole?.roleCode || '') as string;

  /** 角色 → 按钮可见性（与后端 @NeedRoles 一致；最终以后端 403 为准） */
  const canWrite = (MRB_WRITE_ROLES as readonly string[]).includes(roleCode);
  const canPreApprove = (MRB_PRE_APPROVE_ROLES as readonly string[]).includes(roleCode);
  const canFinalApprove = (MRB_FINAL_ROLES as readonly string[]).includes(roleCode);
  const canConfirmOut = (MRB_CONFIRM_OUT_ROLES as readonly string[]).includes(roleCode);
  /** 报废销毁：仓管点「已销毁」才真正减账（货必须先调拨进不良品仓） */
  const canDestroyScrap = (MRB_SCRAP_DESTROY_ROLES as readonly string[]).includes(roleCode);

  /** 待处理 / 已处理 两个列表 */
  const [activeTab, setActiveTab] = useState<'pending' | 'done'>('pending');

  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [data, setData] = useState<MrbReview[]>([]);
  /** 已处理列表：按 IQC 批次折叠后的分组数据 */
  const [doneGroups, setDoneGroups] = useState<MrbLotGroup[]>([]);
  const [loading, setLoading] = useState(false);

  /** 巡检汇总（Tab 角标 / 顶部提示） */
  const [overdueSummary, setOverdueSummary] = useState<MrbOverdueSummary>({
    warn: 0,
    overdue: 0,
    singleApprover: 0,
  });

  /** 快速筛选：仅看超时 / 仅看急件 */
  const [onlyTimeout, setOnlyTimeout] = useState(false);
  const [onlyUrgent, setOnlyUrgent] = useState(false);

  /** MRB v3 方案制定弹窗 */
  const [planDialog, setPlanDialog] = useState(false);
  const [planMrb, setPlanMrb] = useState<MrbReview | null>(null);

  // 待发起评审的 IQC 批次（判定 fail 且未发起 MRB）
  const [pendingLots, setPendingLots] = useState<MrbPendingLot[]>([]);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [pendingPage, setPendingPage] = useState(1);
  const [pendingLoading, setPendingLoading] = useState(false);

  const [mrbNo, setMrbNo] = useState('');
  const [materialCode, setMaterialCode] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [status, setStatus] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // 详情弹窗
  const [detailDialog, setDetailDialog] = useState(false);
  const [detailData, setDetailData] = useState<MrbReview | null>(null);

  // 发起评审弹窗：从待处理批次行进入，批次信息只读
  const [initiateDialog, setInitiateDialog] = useState(false);
  const [initiateLot, setInitiateLot] = useState<MrbPendingLot | null>(null);
  const [initiateReason, setInitiateReason] = useState('');
  /** 本次评审数量（1 ≤ N ≤ 可评审量） */
  const [initiateQty, setInitiateQty] = useState('');
  const [initiateUrgent, setInitiateUrgent] = useState(false);
  const [initiateUrgentReason, setInitiateUrgentReason] = useState('');
  /** 一步到位的评审人员 */
  const [initiateReviewers, setInitiateReviewers] = useState<MrbReviewerInput[]>([
    { reviewerId: '', reviewerName: '', reviewerRole: '' },
  ]);
  /** 发起时就地维护四类处置：该批次关联的收货箱 + 「箱 × 处置」分配 */
  const [initiateBoxes, setInitiateBoxes] = useState<MrbLotLabel[]>([]);
  const [initiateAlloc, setInitiateAlloc] = useState<Record<string, string>>({});
  const [initiateBoxesLoading, setInitiateBoxesLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  /** 撤回 / 驳回弹窗（v3.1） */
  const [withdrawDialog, setWithdrawDialog] = useState(false);
  const [withdrawTarget, setWithdrawTarget] = useState<MrbReview | null>(null);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [returnDialog, setReturnDialog] = useState(false);
  const [returnTarget, setReturnTarget] = useState<MrbReview | null>(null);
  const [returnReason, setReturnReason] = useState('');

  // 选定评审人员弹窗
  const [reviewerDialog, setReviewerDialog] = useState(false);
  const [currentMrbId, setCurrentMrbId] = useState('');
  const [reviewerList, setReviewerList] = useState<MrbReviewerInput[]>([
    { reviewerId: '', reviewerName: '', reviewerRole: '' },
  ]);

  /**
   * 评审人候选（账号档案）。
   * 为什么改成下拉选择：员工的账号是工号（如 RJ037），彼此记不住工号，
   * 但对同事姓名有印象。原先是手输工号，而 mrb_reviewer.reviewer_id
   * 存的是账号 UUID（user_profile 复合类型），手工输入工号会因类型不匹配直接报错。
   */
  const [accountOptions, setAccountOptions] = useState<MrbReviewerCandidate[]>([]);
  const [candidateError, setCandidateError] = useState('');
  useEffect(() => {
    let cancelled = false;
    // 走 MRB 专用候选接口：账号管理接口挂了 @NeedRoles('admin')，
    // 非管理员（SQE/质量主管）调用会被 403，下拉会是空的。
    getReviewerCandidates()
      .then((res) => {
        if (cancelled) return;
        setAccountOptions((res?.data?.items ?? []) as MrbReviewerCandidate[]);
        setCandidateError('');
      })
      .catch((err) => {
        /* 候选加载失败不影响页面，可退回手输；但原因必须留痕，否则线上只能看到“空名单” */
        const status = err?.response?.status;
        console.error('[MRB] 评审员候选加载失败', status, err?.message);
        if (!cancelled) setCandidateError(status ? `HTTP ${status}` : 'NETWORK');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 选中候选人后把角色名一并回填（仅在角色为空时，避免覆盖手工填写的值） */
  const roleNameOf = (id: string): string => accountOptions.find((a) => a.id === id)?.roleName || '';

  // 资料齐全性预审弹窗
  const [preDialog, setPreDialog] = useState(false);
  const [preMrbId, setPreMrbId] = useState('');
  const [preResult, setPreResult] = useState<'complete' | 'incomplete' | 'skip'>('complete');
  const [preRemark, setPreRemark] = useState('');

  // 作废弹窗
  const [cancelDialog, setCancelDialog] = useState(false);
  const [cancelTargetId, setCancelTargetId] = useState('');
  const [cancelReason, setCancelReason] = useState('');

  // 终审驳回弹窗（= 否决并全批退货）
  const [rejectDialog, setRejectDialog] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [rejectSeparationRemark, setRejectSeparationRemark] = useState('');
  const [rejectNeedSeparation, setRejectNeedSeparation] = useState(false);
  /** 二次确认里要明示的整批数量（「将生成退货单 N 件并记供应商欠料」） */
  const [rejectQty, setRejectQty] = useState(0);
  const [rejectUnit, setRejectUnit] = useState('PCS');

  // 终审弹窗（只读展示 SQE 方案 + 评审意见）
  const [finalDialog, setFinalDialog] = useState(false);
  const [finalMrbId, setFinalMrbId] = useState('');
  const [finalMrbQty, setFinalMrbQty] = useState(0);
  const [finalUnit, setFinalUnit] = useState('PCS');
  const [finalRemark, setFinalRemark] = useState('');
  const [finalSeparationRemark, setFinalSeparationRemark] = useState('');
  const [finalNeedSeparation, setFinalNeedSeparation] = useState(false);
  /** SQE 制定的方案（终审只读，不再现场录处置） */
  const [finalPlan, setFinalPlan] = useState<MrbPlanDetail | null>(null);
  const [finalPlanLoading, setFinalPlanLoading] = useState(false);
  /** 展开二维码明细的处置行 */
  const [expandedDispo, setExpandedDispo] = useState<Record<string, boolean>>({});


  const fetchOverdueSummary = useCallback(async () => {
    try {
      const res = await getMrbOverdueSummary();
      setOverdueSummary({
        warn: Number(res?.data?.warn ?? 0),
        overdue: Number(res?.data?.overdue ?? 0),
        singleApprover: Number(res?.data?.singleApprover ?? 0),
      });
    } catch (error) {
      // 汇总只是角标，失败不阻塞主流程
      logger.error('get mrb overdue summary failed', error);
    }
  }, []);

  /**
   * 拉取列表。
   * `override` 用于「点了某个筛选立刻按新值取数」——setState 是异步的，
   * 直接依赖闭包里的旧 state 会拿到上一次的筛选值。
   */
  const fetchMrbList = async (
    p: number = page,
    scope: 'pending' | 'done' = activeTab,
    override?: { onlyTimeout?: boolean; onlyUrgent?: boolean },
  ) => {
    const ot = override?.onlyTimeout ?? onlyTimeout;
    const ou = override?.onlyUrgent ?? onlyUrgent;
    setLoading(true);
    try {
      const common = {
        page: p,
        pageSize,
        mrbNo: mrbNo || undefined,
        materialCode: materialCode || undefined,
        batchNo: batchNo || undefined,
        status: status || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      };
      if (scope === 'done') {
        // 已处理：按 IQC 批次折叠，同批次多次评审合并为一行
        const result = await getMrbLotGroups(common);
        setDoneGroups(result.data.items);
        setTotal(result.data.total);
      } else {
        const result = await getMrbList({
          ...common,
          scope,
          onlyTimeout: ot ? '1' : undefined,
          onlyUrgent: ou ? '1' : undefined,
        });
        setData(result.data.items);
        setTotal(result.data.total);
      }
      setPage(p);
    } catch (error) {
      logger.error('get mrb list failed', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPendingLotList = async (p: number = pendingPage) => {
    setPendingLoading(true);
    try {
      const result = await getPendingLots({
        page: p,
        pageSize,
        materialCode: materialCode || undefined,
        batchNo: batchNo || undefined,
      });
      setPendingLots(result.data.items);
      setPendingTotal(result.data.total);
      setPendingPage(p);
    } catch (error) {
      logger.error('get mrb pending lots failed', error);
    } finally {
      setPendingLoading(false);
    }
  };

  useEffect(() => {
    fetchOverdueSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchPendingLotList(1);
    fetchMrbList(1, activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const handleSearch = () => {
    fetchPendingLotList(1);
    fetchMrbList(1);
  };

  const handleReset = () => {
    setMrbNo('');
    setMaterialCode('');
    setBatchNo('');
    setStatus('');
    setStartDate('');
    setEndDate('');
    setOnlyTimeout(false);
    setOnlyUrgent(false);
    fetchPendingLotList(1);
    // fetch 内部读的是 state 快照，这里显式传 override 保证清空后立刻生效
    fetchMrbList(1, activeTab, { onlyTimeout: false, onlyUrgent: false });
  };

  /** 状态 Badge（统一走 business-enums 的映射，页面不再自建一份） */
  const getStatusBadge = (s: string) => {
    const key = MRB_STATUS_LABEL_KEYS[s];
    const variant = (MRB_STATUS_BADGE_VARIANT[s] || 'outline') as any;
    return <Badge variant={variant}>{key ? t(key) : s}</Badge>;
  };

  const getExecStatusBadge = (s: string) => {
    const key = MRB_EXEC_STATUS_LABEL_KEYS[s];
    const variant = (s === 'done' ? 'default' : s === 'cancelled' ? 'destructive' : 'outline') as any;
    return <Badge variant={variant}>{key ? t(key) : s}</Badge>;
  };

  const dispositionLabel = (d: string): string => {
    const key = MRB_DISPOSITION_LABEL_KEYS[d];
    return key ? t(key) : d;
  };

  /**
   * 评审结论文案。
   *
   * MRB v3 起评审员只有两种表态：同意 / 有异议（旧流程是直接选处置方式）。
   * 老数据里 review_result 仍可能是 special_admit / return 之类的处置值，
   * 这里兜底按处置文案展示，免得历史单据显示成裸英文。
   */
  const reviewResultLabel = (v?: string | null): string => {
    if (!v) return t('mrb.pendingMyReview');
    if (v === 'agree') return t('mrb.reviewAgree');
    if (v === 'disagree') return t('mrb.reviewDisagree');
    return dispositionLabel(v);
  };

  const otherTypeLabel = (o?: string): string => {
    if (!o) return '-';
    const key = MRB_OTHER_TYPE_LABEL_KEYS[o];
    return key ? t(key) : o;
  };

  const completenessLabel = (r?: string): string => {
    if (!r) return '-';
    const map: Record<string, string> = {
      complete: t('mrb.completeness_complete'),
      incomplete: t('mrb.completeness_incomplete'),
      skipped: t('mrb.completeness_skipped'),
    };
    return map[r] || r;
  };

  /** 行底色：超时红、预警黄，急件再加一层淡玫瑰底色 */
  const rowClassName = (record: MrbReview): string => {
    if (record.slaLevel === 'overdue') return 'bg-red-50';
    if (record.slaLevel === 'warn') return 'bg-amber-50';
    if (record.isUrgent) return 'bg-rose-50/50';
    return '';
  };

  const handleViewDetail = async (id: string) => {
    try {
      const result = await getMrbDetail(id);
      setDetailData(result.data);
      setDetailDialog(true);
    } catch (error) {
      logger.error('get mrb detail failed', error);
      toast.error(t('mrb.getDetailFailed'));
    }
  };

  // ==========================================================================
  // 方案制定（MRB v3）
  // ==========================================================================

  const handleOpenPlan = (record: MrbReview) => {
    setPlanMrb(record);
    setPlanDialog(true);
  };

  // ==========================================================================
  // 发起评审
  // ==========================================================================

  const handleOpenInitiate = (lot: MrbPendingLot) => {
    const max = Number(lot.reviewableQty) || 0;
    setInitiateLot(lot);
    setInitiateReason('');
    setInitiateQty(String(max));
    setInitiateUrgent(false);
    setInitiateUrgentReason('');
    setInitiateReviewers([{ reviewerId: '', reviewerName: '', reviewerRole: '' }]);
    setInitiateAlloc({});
    setInitiateBoxes([]);
    setInitiateDialog(true);

    // 发起即定方案：先把该批次的收货二维码拉出来，SQE 才能按箱分配四类数量
    setInitiateBoxesLoading(true);
    getMrbLotLabels({ lotId: lot.lotId })
      .then((res) => setInitiateBoxes(res.data?.items || []))
      .catch((err) => {
        logger.error('load lot labels failed', err);
        toast.error(t('mrb.planLoadFailed'));
      })
      .finally(() => setInitiateBoxesLoading(false));
  };

  /** 本次评审数量是否合法（1 ≤ N ≤ 可评审量，按 4 位小数比较） */
  const initiateQtyScaled = toScaled(initiateQty);
  const initiateMaxScaled = toScaled(initiateLot?.reviewableQty ?? 0);
  const initiateQtyValid = initiateQtyScaled > 0 && initiateQtyScaled <= initiateMaxScaled;
  /** 预计剩余 = 可评审量 - 本次评审数量 */
  const initiateRemain = fromScaled(initiateMaxScaled - (initiateQtyValid ? initiateQtyScaled : 0));

  const handleInitiateReviewerChange = (index: number, field: keyof MrbReviewerInput, value: string) => {
    setInitiateReviewers((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  /**
   * 提交发起。
   *
   * v3.1 起「发起」与「定方案」合并为同一弹窗，落库分两步（同一次点击内完成）：
   *   1) initiate(submit=false) 先建单（落 draft），拿到 mrbId；
   *   2) saveMrbPlan 写入四类处置数量，submit=true 才进评审。
   * 两步而非一个接口，是因为方案必须按「该单关联的收货箱」分摊，需要先有单号。
   *
   * @param submit false=存草稿（方案一并保存），true=提交评审
   */
  const handleSubmitInitiate = async (submit: boolean) => {
    if (!initiateLot) return;
    if (!initiateReason.trim()) {
      toast.error(t('mrb.failReason') + ' ' + t('message.requiredField'));
      return;
    }
    if (!initiateQtyValid) {
      toast.error(t('mrb.reviewQtyOutOfRange'));
      return;
    }
    if (initiateUrgent && !initiateUrgentReason.trim()) {
      toast.error(t('mrb.urgentReasonRequired'));
      return;
    }

    const validReviewers = initiateReviewers.filter((r) => r.reviewerId.trim() !== '');

    if (submit) {
      if (validReviewers.length === 0) {
        toast.error(t('mrb.planNeedReviewer'));
        return;
      }
      const invalid = validateAlloc(initiateBoxes, initiateAlloc, fromScaled(initiateQtyScaled));
      if (invalid) {
        if (invalid.type === 'box') toast.error(tf('mrb.planBoxOver', { box: invalid.box }));
        else toast.error(tf('mrb.planSumMismatch', { done: invalid.done, total: invalid.total }));
        return;
      }
    }

    const dispositions = buildDispositions(initiateBoxes, initiateAlloc);
    const reviewers = validReviewers.map((r) => ({
      reviewerId: r.reviewerId.trim(),
      reviewerName: r.reviewerName?.trim() || undefined,
      reviewerRole: r.reviewerRole?.trim() || undefined,
    }));

    setSubmitting(true);
    let mrbId = '';
    try {
      const created = await initiateMrb({
        iqcLotId: initiateLot.lotId,
        reason: initiateReason.trim(),
        quantity: fromScaled(initiateQtyScaled),
        // 先落草稿，方案写进去之后再决定是否提交评审
        submit: false,
        isUrgent: initiateUrgent,
        urgentReason: initiateUrgent ? initiateUrgentReason.trim() : undefined,
        reviewers: reviewers.length > 0 ? reviewers : undefined,
      });
      mrbId = created.data?.id || '';

      if (mrbId && dispositions.length > 0) {
        await saveMrbPlan({ mrbId, dispositions, reviewers, submit });
      } else if (mrbId && submit) {
        // 没有填任何处置：后端会拒绝，这里直接提示（不会产生半成品评审单）
        throw new Error(t('mrb.planNeedDisposition'));
      }

      toast.success(submit ? t('mrb.initiateSuccess') : t('mrb.draftSaved'));
      setInitiateDialog(false);
      setInitiateLot(null);
      fetchPendingLotList(pendingPage);
      fetchMrbList(1, activeTab);
      fetchOverdueSummary();
    } catch (error: any) {
      logger.error('initiate mrb failed', error);
      // 单据已经建出来了：提示已存草稿，避免用户以为没成功又点一次
      if (mrbId) {
        toast.error(`${t('mrb.initiateSavedDraft')}：${pickErrMsg(error) || error?.message || ''}`);
        setInitiateDialog(false);
        setInitiateLot(null);
        fetchPendingLotList(pendingPage);
        fetchMrbList(1, activeTab);
      } else {
        toast.error(pickErrMsg(error) || t('mrb.initiateFailed'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ==========================================================================
  // 草稿提交 / 作废 / 指派评审员
  // ==========================================================================

  const handleSubmitDraft = async (record: MrbReview) => {
    setSubmitting(true);
    try {
      await submitMrb({ mrbId: record.id });
      toast.success(t('mrb.initiateSuccess'));
      fetchMrbList(page, activeTab);
      fetchOverdueSummary();
    } catch (error: any) {
      logger.error('submit mrb draft failed', error);
      toast.error(pickErrMsg(error) || t('mrb.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenCancel = (record: MrbReview) => {
    setCancelTargetId(record.id);
    setCancelReason('');
    setCancelDialog(true);
  };

  const handleSubmitCancel = async () => {
    if (cancelReason.trim().length < 5) {
      toast.error(t('mrb.cancelReasonRequired'));
      return;
    }
    setSubmitting(true);
    try {
      await cancelMrb({ mrbId: cancelTargetId, reason: cancelReason.trim() });
      toast.success(t('mrb.cancelSuccess'));
      setCancelDialog(false);
      fetchMrbList(page, activeTab);
      fetchPendingLotList(pendingPage);
      fetchOverdueSummary();
    } catch (error: any) {
      logger.error('cancel mrb failed', error);
      toast.error(pickErrMsg(error) || t('mrb.finalFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  // ==========================================================================
  // 撤回（SQE） / 审批驳回（IQC主管 / 质量经理）
  // ==========================================================================

  const handleOpenWithdraw = (record: MrbReview) => {
    setWithdrawTarget(record);
    setWithdrawReason('');
    setWithdrawDialog(true);
  };

  const handleSubmitWithdraw = async () => {
    if (!withdrawTarget) return;
    if (withdrawReason.trim().length < 5) {
      toast.error(t('mrb.withdrawReasonRequired'));
      return;
    }
    setSubmitting(true);
    try {
      await withdrawMrb({ mrbId: withdrawTarget.id, reason: withdrawReason.trim() });
      toast.success(t('mrb.withdrawSuccess'));
      setWithdrawDialog(false);
      setWithdrawTarget(null);
      fetchMrbList(page, activeTab);
      fetchOverdueSummary();
    } catch (error: any) {
      logger.error('withdraw mrb failed', error);
      toast.error(pickErrMsg(error) || t('mrb.withdrawFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenReturn = (record: MrbReview) => {
    setReturnTarget(record);
    setReturnReason('');
    setReturnDialog(true);
  };

  const handleSubmitReturn = async () => {
    if (!returnTarget) return;
    if (returnReason.trim().length < 5) {
      toast.error(t('mrb.returnReasonRequired'));
      return;
    }
    setSubmitting(true);
    try {
      await returnBackMrb({ mrbId: returnTarget.id, reason: returnReason.trim() });
      toast.success(t('mrb.returnSuccess'));
      setReturnDialog(false);
      setReturnTarget(null);
      fetchMrbList(page, activeTab);
      fetchOverdueSummary();
    } catch (error: any) {
      logger.error('return back mrb failed', error);
      toast.error(pickErrMsg(error) || t('mrb.returnFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenAssign = (record: MrbReview) => {
    setCurrentMrbId(record.id);
    setReviewerList([{ reviewerId: '', reviewerName: '', reviewerRole: '' }]);
    setReviewerDialog(true);
  };

  const handleReviewerChange = (index: number, field: keyof MrbReviewerInput, value: string) => {
    setReviewerList((prev) => {
      const newList = [...prev];
      newList[index] = { ...newList[index], [field]: value };
      return newList;
    });
  };

  const handleAddReviewer = () => {
    setReviewerList((prev) => [...prev, { reviewerId: '', reviewerName: '', reviewerRole: '' }]);
  };

  const handleRemoveReviewer = (index: number) => {
    if (reviewerList.length <= 1) return;
    setReviewerList((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmitReviewers = async () => {
    const validReviewers = reviewerList.filter((r) => r.reviewerId.trim() !== '');
    if (validReviewers.length === 0) {
      toast.error(t('message.requiredField'));
      return;
    }
    setSubmitting(true);
    try {
      await assignReviewers({
        mrbId: currentMrbId,
        reviewers: validReviewers.map((r) => ({
          reviewerId: r.reviewerId.trim(),
          reviewerName: r.reviewerName?.trim() || undefined,
          reviewerRole: r.reviewerRole?.trim() || undefined,
        })),
      });
      toast.success(t('mrb.assignSuccess'));
      setReviewerDialog(false);
      fetchMrbList(page, activeTab);
      fetchOverdueSummary();
    } catch (error: any) {
      logger.error('assign reviewers failed', error);
      toast.error(pickErrMsg(error) || t('mrb.assignFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  // ==========================================================================
  // 资料齐全性预审
  // ==========================================================================

  const handleOpenPreApprove = (record: MrbReview) => {
    setPreMrbId(record.id);
    setPreResult('complete');
    setPreRemark('');
    setPreDialog(true);
  };

  const handleSubmitPreApprove = async () => {
    // incomplete / skip 必须写说明（≥5 字）
    if (preResult !== 'complete' && preRemark.trim().length < 5) {
      toast.error(t('mrb.preApproveRemarkRequired'));
      return;
    }
    setSubmitting(true);
    try {
      await preApproveMrb({
        mrbId: preMrbId,
        result: preResult,
        remark: preRemark.trim() || undefined,
      });
      toast.success(t('mrb.preApproveSuccess'));
      setPreDialog(false);
      fetchMrbList(page, activeTab);
      fetchOverdueSummary();
    } catch (error: any) {
      logger.error('pre approve mrb failed', error);
      toast.error(pickErrMsg(error) || t('mrb.finalFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  // ==========================================================================
  // 终审否决 == 否决并全批退货
  // ==========================================================================

  /**
   * 打开「否决并全批退货」确认框。
   *
   * MRB v3 语义变化：否决不再只是「盖一个否决章」，而等价于「整批 N 件退货」——
   * 后端 rejectMrb 内部转调 finalApprove(rejectMode=true)，会一次性生成
   * 退货单 + 记供应商欠料 + 建不良品调拨任务。一次点击就产生三张下游单据，
   * 所以必须先把后果明示给质量经理，再让他确认。
   */
  const handleOpenReject = (record: MrbReview) => {
    setRejectTargetId(record.id);
    setRejectQty(Number(record.quantity) || 0);
    setRejectUnit(record.unit || 'PCS');
    setRejectReason('');
    setRejectSeparationRemark('');
    // 预审人 == 当前登录人时，需填代审说明（与后端 assertSeparationRemark 同口径）
    setRejectNeedSeparation(!!record.completeness?.by && record.completeness.by === operatorUserId);
    setRejectDialog(true);
  };

  const handleSubmitReject = async () => {
    if (rejectReason.trim().length < 5) {
      toast.error(t('mrb.rejectReasonRequired'));
      return;
    }
    if (rejectNeedSeparation && rejectSeparationRemark.trim().length < 2) {
      toast.error(t('mrb.separationRemarkRequired'));
      return;
    }
    setSubmitting(true);
    try {
      await rejectMrb({
        mrbId: rejectTargetId,
        reason: rejectReason.trim(),
        separationRemark: rejectSeparationRemark.trim() || undefined,
      });
      toast.success(t('mrb.rejectSuccess'));
      setRejectDialog(false);
      // 否决是从终审弹窗发起的，成功后终审弹窗也要一起关掉
      setFinalDialog(false);
      fetchMrbList(page, activeTab);
      fetchPendingLotList(pendingPage);
      fetchOverdueSummary();
    } catch (error: any) {
      logger.error('reject mrb failed', error);
      toast.error(pickErrMsg(error) || t('mrb.finalFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  // ==========================================================================
  // 终审（MRB v3：只读确认 SQE 方案）
  //
  // 为什么不再让质量经理现场录处置：
  //   ① 处置数量必须落在「哪一箱 / 哪个二维码」上，否则仓库执行时不知道该动哪批货；
  //      而二维码分摊只有 SQE 手上有全部收货单，质量经理在终审那一刻拿不到。
  //   ② 原先终审录处置 + SQE 另录一份，两套数字天然会打架（对不上就以谁为准？）。
  //   ③ 责任要分清：处置方案是 SQE 的专业判断，质量经理只做「认 / 不认」。
  // 所以终审弹窗改成纯只读：展示方案明细 + 评审意见 + 下游单预览，只留两个按钮。
  // ==========================================================================

  /** 方案按处置方式分组（同一类处置可能被拆成多行，展示时合并） */
  const finalPlanGroups = React.useMemo(() => {
    const rows = finalPlan?.dispositions ?? [];
    const order: string[] = ['special_admit', 'rework', 'return', 'scrap', 'other'];
    const map = new Map<string, { type: string; qty: number; labels: any[]; rows: typeof rows }>();
    for (const d of rows) {
      const key = String(d.dispositionType);
      const cur = map.get(key) || { type: key, qty: 0, labels: [], rows: [] as typeof rows };
      cur.qty += toScaled(d.quantity);
      cur.labels.push(...(d.labels || []));
      cur.rows.push(d);
      map.set(key, cur);
    }
    return [...map.values()]
      .map((g) => ({ ...g, qtyNum: fromScaled(g.qty) }))
      .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  }, [finalPlan]);

  const finalPlanSumScaled = finalPlanGroups.reduce((s, g) => s + g.qty, 0);
  const finalPlanTotalScaled = toScaled(finalMrbQty);
  /** 分摊合计必须严格等于评审数量，否则后端终审会直接报错 */
  const finalPlanMatched = finalPlanSumScaled === finalPlanTotalScaled;
  const finalPlanDiff = fromScaled(finalPlanSumScaled - finalPlanTotalScaled);

  const finalHasPlan = (finalPlan?.dispositions?.length ?? 0) > 0;
  /** 有异议的评审意见要标红顶到最上面，让质量经理一眼看到反对声音 */
  const finalDisagree = (finalPlan?.reviewers ?? []).filter((r) => r.reviewResult === 'disagree');

  const qtyOfType = (type: string): number => {
    const g = finalPlanGroups.find((x) => x.type === type);
    return g ? g.qtyNum : 0;
  };

  /**
   * 打开终审弹窗：**先拉方案再开**。
   * 顺序很重要 —— 若先开窗再拉，质量经理会看到一屏空白，误以为 SQE 没填。
   */
  const handleOpenFinal = async (record: MrbReview) => {
    const qty = Number(record.quantity) || 0;
    setFinalMrbId(record.id);
    setFinalMrbQty(qty);
    setFinalUnit(record.unit || 'PCS');
    setFinalRemark('');
    setFinalSeparationRemark('');
    // 预审人 == 当前登录人 → 必须填代审说明
    setFinalNeedSeparation(!!record.completeness?.by && record.completeness.by === operatorUserId);
    setFinalPlan(null);
    setExpandedDispo({});
    setFinalPlanLoading(true);
    try {
      const res = await getMrbPlan(record.id);
      setFinalPlan(res.data);
    } catch (error: any) {
      logger.error('load mrb plan failed', error);
      toast.error(pickErrMsg(error) || t('mrb.planLoadFailed'));
      return;
    } finally {
      setFinalPlanLoading(false);
    }
    setFinalDialog(true);
  };

  const handleSubmitFinal = async () => {
    if (!operatorUserId) {
      toast.error(t('login.loginFirst'));
      return;
    }
    if (!finalHasPlan) {
      toast.error(t('mrb.planMissing'));
      return;
    }
    if (!finalPlanMatched) {
      toast.error(`${t('mrb.quantityMismatch')}（${t('mrb.qtyDiff')} ${finalPlanDiff}）`);
      return;
    }
    if (finalNeedSeparation && finalSeparationRemark.trim().length < 2) {
      toast.error(t('mrb.separationRemarkRequired'));
      return;
    }

    setSubmitting(true);
    try {
      // 不再传 dispositions：服务端直接读 SQE 的 planned 行执行，
      // 传了也会被忽略，反而会让人误以为「终审还能改数量」。
      await finalApprove({
        mrbId: finalMrbId,
        finalRemark: finalRemark.trim() || undefined,
        separationRemark: finalSeparationRemark.trim() || undefined,
      });
      toast.success(t('mrb.finalSuccess'));
      setFinalDialog(false);
      fetchMrbList(page, activeTab);
      fetchPendingLotList(pendingPage);
      fetchOverdueSummary();
    } catch (error: any) {
      logger.error('final approve failed', error);
      toast.error(pickErrMsg(error) || t('mrb.finalFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  /** 终审弹窗内的「否决并全批退货」：复用驳回弹窗做二次确认 */
  const handleFinalReject = () => {
    setRejectTargetId(finalMrbId);
    setRejectQty(finalMrbQty);
    setRejectUnit(finalUnit);
    setRejectReason('');
    setRejectSeparationRemark(finalSeparationRemark);
    setRejectNeedSeparation(finalNeedSeparation);
    setRejectDialog(true);
  };

  /** 「其他-退回客户」确认已提走（仓管） */
  const handleConfirmOut = async (dispositionId: string) => {
    setSubmitting(true);
    try {
      await confirmMrbOut(dispositionId);
      toast.success(t('mrb.confirmOutSuccess'));
      // 重新拉详情，让明细执行状态刷新
      if (detailData) {
        const res = await getMrbDetail(detailData.id);
        setDetailData(res.data);
      }
      fetchMrbList(page, activeTab);
      fetchOverdueSummary();
    } catch (error: any) {
      logger.error('confirm out failed', error);
      toast.error(pickErrMsg(error) || t('mrb.finalFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * 报废销毁（MRB v3）：报废货必须先进不良品仓，这里才允许核销。
   * 二次确认里写清「不可撤销」，因为减账后只能靠反向单据补回。
   */
  const handleDestroyScrap = async (
    dispositionId: string,
    qty: string | number,
    unit?: string,
  ) => {
    const ok = window.confirm(
      `${t('mrb.destroyScrapConfirm')}\n\n${t('mrb.destroyScrapQty')} ${qty} ${unit || ''}`.trim(),
    );
    if (!ok) return;
    setSubmitting(true);
    try {
      await destroyMrbScrap(dispositionId);
      toast.success(t('mrb.destroyScrapSuccess'));
      if (detailData) {
        const res = await getMrbDetail(detailData.id);
        setDetailData(res.data);
      }
      fetchMrbList(page, activeTab);
      fetchOverdueSummary();
    } catch (error: any) {
      logger.error('destroy scrap failed', error);
      toast.error(pickErrMsg(error) || t('mrb.destroyScrapFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  // ==========================================================================
  // 列定义
  // ==========================================================================

  // 待发起评审的 IQC 批次
  const pendingLotColumns: TableProps<MrbPendingLot>['columns'] = [
    {
      title: t('common.serialNo'),
      key: 'index',
      width: 70,
      fixed: 'left',
      render: (_: any, __: any, index: number) => (pendingPage - 1) * pageSize + index + 1,
    },
    { title: t('mrb.inspectionNo'), dataIndex: 'inspectionNo', width: 170 },
    { title: t('receipt.batchNo'), dataIndex: 'batchNo', width: 130 },
    { title: t('material.materialCode'), dataIndex: 'materialCode', width: 140 },
    { title: t('material.materialName'), dataIndex: 'materialName', width: 170 },
    { title: t('material.supplierName'), dataIndex: 'supplierName', width: 170 },
    {
      title: t('mrb.reportQty'),
      dataIndex: 'quantity',
      width: 120,
      align: 'right',
      render: (v: number, record: MrbPendingLot) => `${v ?? 0} ${record.unit || ''}`.trim(),
    },
    {
      title: t('mrb.reviewableQty'),
      dataIndex: 'reviewableQty',
      width: 130,
      align: 'right',
      render: (v: number, record: MrbPendingLot) => (
        <div className="leading-tight">
          <div className={Number(v) > 0 ? 'font-medium text-foreground' : 'text-destructive'}>
            {`${v ?? 0} ${record.unit || ''}`.trim()}
          </div>
          {Number(record.remainingDefectiveQty ?? record.defectiveQty) > 0 &&
            Number(record.remainingDefectiveQty ?? record.defectiveQty) !== Number(v) && (
              <div className="text-xs text-muted-foreground">
                {t('mrb.defectiveQty')} {record.remainingDefectiveQty ?? record.defectiveQty}
              </div>
            )}
        </div>
      ),
    },
    {
      title: t('mrb.reviewHistory'),
      key: 'reviewHistory',
      width: 130,
      render: (_: any, record: MrbPendingLot) =>
        Number(record.mrbCount) > 0 ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            {t('mrb.reopenBadge')} ×{record.mrbCount}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{t('mrb.firstReview')}</span>
        ),
    },
    {
      title: t('mrb.inspectionTime'),
      dataIndex: 'inspectionTime',
      width: 170,
      render: (v: string) => (v ? new Date(v).toLocaleString('zh-CN') : '-'),
    },
    {
      title: t('common.operation'),
      key: 'action',
      width: 150,
      fixed: 'right',
      render: (_: any, record: MrbPendingLot) => {
        const canInitiate = Number(record.reviewableQty) > 0;
        return (
          <Button
            size="sm"
            disabled={!canInitiate || !canWrite}
            title={
              !canInitiate
                ? t('mrb.noReviewableStock')
                : !canWrite
                  ? t('mrb.noPermission')
                  : undefined
            }
            onClick={() => handleOpenInitiate(record)}
          >
            {record.isReopen ? t('mrb.reopenReview') : t('mrb.initiateReview')}
          </Button>
        );
      },
    },
  ];

  /** 进行中的 MRB 列表列（已处理列表走按批次折叠的 renderDoneGroupTable） */
  const buildMrbColumns = (): TableProps<MrbReview>['columns'] => [
    {
      title: t('common.serialNo'),
      key: 'index',
      width: 66,
      fixed: 'left',
      render: (_: any, __: any, index: number) => (page - 1) * pageSize + index + 1,
    },
    { title: t('mrb.mrbNo'), dataIndex: 'mrbNo', width: 170 },
    {
      title: t('mrb.sourceInspectionNo'),
      dataIndex: 'inspectionNo',
      width: 150,
      render: (v: string) => v || '-',
    },
    {
      title: t('mrb.urgentShort'),
      key: 'urgent',
      width: 74,
      align: 'center',
      render: (_: any, record: MrbReview) =>
        record.isUrgent ? (
          <span
            className="inline-flex items-center rounded bg-red-600 px-1.5 py-0.5 text-xs font-bold text-white"
            title={record.urgentReason || t('mrb.urgent')}
          >
            {t('mrb.urgentShort')}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        ),
    },
    { title: t('material.materialCode'), dataIndex: 'materialCode', width: 140 },
    { title: t('material.materialName'), dataIndex: 'materialName', width: 160 },
    { title: t('receipt.batchNo'), dataIndex: 'batchNo', width: 130 },
    { title: t('common.quantity'), dataIndex: 'quantity', width: 100, align: 'right' },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 150,
      render: (s: string, record: MrbReview) => (
        <div className="flex flex-wrap items-center gap-1">
          {getStatusBadge(s)}
          {record.isSingleApprover && (
            <span
              className="inline-flex items-center rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-700"
              title={record.separationRemark || t('mrb.separationRemarkTip')}
            >
              {t('mrb.singleApprover')}
            </span>
          )}
        </div>
      ),
    },
    {
      title: t('mrb.stuck'),
      key: 'stuck',
      width: 110,
      align: 'right',
      render: (_: any, record: MrbReview) => {
        const cls =
          record.slaLevel === 'overdue'
            ? 'font-semibold text-red-600'
            : record.slaLevel === 'warn'
              ? 'font-semibold text-amber-600'
              : 'text-muted-foreground';
        return (
          <span className={cls} title={record.statusSince ? new Date(record.statusSince).toLocaleString('zh-CN') : undefined}>
            {fmtStuck(record.stuckHours, t)}
          </span>
        );
      },
    },
    { title: t('mrb.failReason'), dataIndex: 'failReason', width: 170, ellipsis: true },
    {
      title: t('mrb.createdTime'),
      dataIndex: 'createdAt',
      width: 165,
      render: (v: any) => (v ? new Date(v).toLocaleString('zh-CN') : '-'),
    },
    {
      title: t('common.operation'),
      key: 'action',
      width: 300,
      fixed: 'right',
      render: (_: any, record: MrbReview) => (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => handleViewDetail(record.id)}>
            {t('common.detail')}
          </Button>
          {/* 草稿：制定方案 / 提交 / 作废 */}
          {record.status === 'draft' && canWrite && (
            <>
              <Button size="sm" onClick={() => handleOpenPlan(record)}>
                制定方案
              </Button>
              <Button size="sm" variant="outline" disabled={submitting} onClick={() => handleSubmitDraft(record)}>
                {t('mrb.submitReviewFlow')}
              </Button>
            </>
          )}
          {/* 待制定方案（MRB v3 的主战场） */}
          {record.status === 'pending_review' && canWrite && (
            <>
              <Button size="sm" onClick={() => handleOpenPlan(record)}>
                制定方案
              </Button>
              <Button size="sm" variant="ghost" onClick={() => handleOpenAssign(record)}>
                {t('mrb.selectReviewers')}
              </Button>
            </>
          )}
          {/* 待预审（IQC主管审核）：审核通过 / 驳回退回修改 */}
          {record.status === 'pending_approval' && canPreApprove && (
            <>
              <Button size="sm" onClick={() => handleOpenPreApprove(record)}>
                {t('mrb.preApproveSection')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => handleOpenReturn(record)}
              >
                {t('mrb.returnBack')}
              </Button>
            </>
          )}
          {/* 待终审（质量经理审批）：审批 / 驳回退回修改 / 否决并全批退货 */}
          {record.status === 'pending_final' && canFinalApprove && (
            <>
              <Button size="sm" onClick={() => handleOpenFinal(record)}>
                {t('mrb.finalApproval')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleOpenReturn(record)}>
                {t('mrb.returnBack')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => handleOpenReject(record)}
              >
                {t('mrb.rejectAndReturn')}
              </Button>
            </>
          )}
          {/* 评审中：撤回方案（不是作废，单子继续存活） */}
          {record.status === 'reviewing' && canWrite && (
            <Button size="sm" variant="outline" onClick={() => handleOpenWithdraw(record)}>
              {t('mrb.withdraw')}
            </Button>
          )}
          {/* 可作废：draft / pending_review / reviewing */}
          {['draft', 'pending_review', 'reviewing'].includes(record.status) && canWrite && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => handleOpenCancel(record)}
            >
              {t('mrb.cancelTitle')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  const renderMrbTable = () => (
    <ResizableTable
      columns={buildMrbColumns()}
      dataSource={data}
      loading={loading}
      rowKey="id"
      rowClassName={(record) => rowClassName(record as MrbReview)}
      scroll={{ x: 1750, y: 420 }}
      pagination={{
        current: page,
        pageSize,
        total,
        onChange: (p: number) => fetchMrbList(p, 'pending'),
        showSizeChanger: false,
      }}
    />
  );

  // ===== 已处理列表：同一 IQC 批次的多张单折叠为一行 =====

  const buildDoneGroupColumns = (): TableProps<MrbLotGroup>['columns'] => [
    {
      title: t('common.serialNo'),
      key: 'index',
      width: 70,
      render: (_: any, __: any, index: number) => (page - 1) * pageSize + index + 1,
    },
    { title: t('receipt.batchNo'), dataIndex: 'batchNo', width: 140 },
    { title: t('material.materialCode'), dataIndex: 'materialCode', width: 140 },
    { title: t('material.materialName'), dataIndex: 'materialName', width: 170 },
    { title: t('material.supplierName'), dataIndex: 'supplierName', width: 170 },
    {
      title: t('common.quantity'),
      key: 'quantity',
      width: 110,
      align: 'right',
      render: (_: any, record: MrbLotGroup) =>
        `${record.latest?.quantity ?? 0} ${record.unit || ''}`.trim(),
    },
    {
      title: t('mrb.reviewTimes'),
      key: 'reviewCount',
      width: 130,
      render: (_: any, record: MrbLotGroup) => (
        <div className="flex items-center gap-1">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-sky-50 text-sky-700 border border-sky-200">
            ×{record.reviewCount}
          </span>
          {Number(record.totalCount ?? 0) > Number(record.reviewCount ?? 0) && (
            <span className="text-xs text-muted-foreground">
              +{Number(record.totalCount) - Number(record.reviewCount)}
            </span>
          )}
        </div>
      ),
    },
    {
      title: t('mrb.latestMrbNo'),
      key: 'latestMrbNo',
      width: 165,
      render: (_: any, record: MrbLotGroup) => record.latest?.mrbNo || '-',
    },
    {
      title: t('mrb.latestDecision'),
      key: 'latestDecision',
      width: 130,
      render: (_: any, record: MrbLotGroup) =>
        record.latest?.finalDecision ? dispositionLabel(String(record.latest.finalDecision)) : '-',
    },
    {
      title: t('common.status'),
      key: 'status',
      width: 120,
      render: (_: any, record: MrbLotGroup) => getStatusBadge(record.latest?.status || ''),
    },
    {
      title: t('mrb.latestAt'),
      key: 'latestAt',
      width: 175,
      render: (_: any, record: MrbLotGroup) => {
        const v = record.latest?.finalApprovalTime || record.latest?.createdAt;
        return v ? new Date(v).toLocaleString('zh-CN') : '-';
      },
    },
    {
      title: t('common.operation'),
      key: 'action',
      width: 110,
      render: (_: any, record: MrbLotGroup) => (
        <Button size="sm" variant="ghost" onClick={() => handleViewDetail(record.latest.id)}>
          {t('common.detail')}
        </Button>
      ),
    },
  ];

  /** 展开行：该批次全部已归档单据（最近一次排最前） */
  const renderGroupHistory = (group: MrbLotGroup) => {
    const list = [group.latest, ...(group.history || [])];
    return (
      <div className="px-3 py-2" style={{ background: 'var(--muted, #fafafa)' }}>
        <div className="text-xs font-medium text-muted-foreground mb-2">
          {t('mrb.historyTitle')}（{group.reviewCount}）
        </div>
        <table className="w-full text-sm bg-card border border-border">
          <thead className="bg-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-foreground w-12">
                {t('common.serialNo')}
              </th>
              <th className="px-3 py-2 text-left font-medium text-foreground">{t('mrb.mrbNo')}</th>
              <th className="px-3 py-2 text-left font-medium text-foreground">{t('common.status')}</th>
              <th className="px-3 py-2 text-left font-medium text-foreground">
                {t('mrb.finalDecision')}
              </th>
              <th className="px-3 py-2 text-right font-medium text-foreground">
                {t('common.quantity')}
              </th>
              <th className="px-3 py-2 text-left font-medium text-foreground">{t('mrb.failReason')}</th>
              <th className="px-3 py-2 text-left font-medium text-foreground">{t('mrb.createdTime')}</th>
              <th className="px-3 py-2 text-left font-medium text-foreground">
                {t('common.operation')}
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((m, idx) => (
              <tr key={m.id} className="border-t border-border">
                <td className="px-3 py-2">{idx + 1}</td>
                <td className="px-3 py-2 font-medium">{m.mrbNo}</td>
                <td className="px-3 py-2">{getStatusBadge(m.status)}</td>
                <td className="px-3 py-2">
                  {m.finalDecision ? dispositionLabel(String(m.finalDecision)) : '-'}
                </td>
                <td className="px-3 py-2 text-right">{`${m.quantity ?? 0} ${m.unit || ''}`.trim()}</td>
                <td className="px-3 py-2">{m.failReason || '-'}</td>
                <td className="px-3 py-2">
                  {m.createdAt ? new Date(m.createdAt).toLocaleString('zh-CN') : '-'}
                </td>
                <td className="px-3 py-2">
                  <Button size="sm" variant="ghost" onClick={() => handleViewDetail(m.id)}>
                    {t('common.detail')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderDoneGroupTable = () => (
    <ResizableTable
      columns={buildDoneGroupColumns()}
      dataSource={doneGroups}
      loading={loading}
      rowKey="lotId"
      scroll={{ x: 1500, y: 420 }}
      expandable={{
        // 仅多次评审的批次可展开查看历次单据
        rowExpandable: (record: MrbLotGroup) => Number(record.reviewCount) > 1,
        expandedRowRender: (record: MrbLotGroup) => renderGroupHistory(record),
        columnWidth: 46,
      }}
      pagination={{
        current: page,
        pageSize,
        total,
        onChange: (p: number) => fetchMrbList(p, 'done'),
        showSizeChanger: false,
      }}
    />
  );

  /** Tab 角标数 = 预警 + 超时（点角标直接勾「仅看超时」） */
  const timeoutTotal = Number(overdueSummary.warn || 0) + Number(overdueSummary.overdue || 0);

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-[12px] p-4 border border-border">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('mrb.mrbNo')}
            </label>
            <Input
              value={mrbNo}
              onChange={(e) => setMrbNo(e.target.value)}
              placeholder={t('mrb.mrbNoSearchHint')}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('material.materialCode')}
            </label>
            <Input
              value={materialCode}
              onChange={(e) => setMaterialCode(e.target.value)}
              placeholder={t('material.materialCode')}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('receipt.batchNo')}
            </label>
            <Input
              value={batchNo}
              onChange={(e) => setBatchNo(e.target.value)}
              placeholder={t('receipt.batchNo')}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('common.status')}
            </label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('common.all')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t('common.all')}</SelectItem>
                <SelectItem value="draft">{t('mrb.status_draft')}</SelectItem>
                <SelectItem value="pending_review">{t('mrb.status_pending_review')}</SelectItem>
                <SelectItem value="reviewing">{t('mrb.status_reviewing')}</SelectItem>
                <SelectItem value="pending_approval">{t('mrb.status_pending_approval')}</SelectItem>
                <SelectItem value="pending_final">{t('mrb.status_pending_final')}</SelectItem>
                <SelectItem value="pending_execute">{t('mrb.status_pending_execute')}</SelectItem>
                <SelectItem value="approved">{t('mrb.status_approved')}</SelectItem>
                <SelectItem value="rejected">{t('mrb.status_rejected')}</SelectItem>
                <SelectItem value="closed">{t('mrb.status_closed')}</SelectItem>
                <SelectItem value="cancelled">{t('mrb.status_cancelled')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('common.startDate')}
            </label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('common.endDate')}
            </label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2 justify-end items-center">
          <Button variant="secondary" onClick={handleReset}>
            {t('common.reset')}
          </Button>
          <Button onClick={handleSearch}>{t('common.search')}</Button>
        </div>
      </div>

      <div className="bg-card rounded-[12px] p-4 border border-border">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'pending' | 'done')}>
          <TabsList>
            <TabsTrigger value="pending">
              <span className="inline-flex items-center gap-1.5">
                {t('mrb.tabPending')}
                {timeoutTotal > 0 && (
                  <span
                    role="button"
                    tabIndex={0}
                    title={tf('mrb.overdueTip', {
                      warn: overdueSummary.warn,
                      overdue: overdueSummary.overdue,
                    })}
                    className={`rounded-full px-1.5 py-0.5 text-xs font-semibold leading-none text-white ${
                      Number(overdueSummary.overdue) > 0 ? 'bg-red-600' : 'bg-amber-500'
                    }`}
                    onClick={(e) => {
                      // 点角标 = 勾「仅看超时」，不改变当前 Tab
                      e.preventDefault();
                      e.stopPropagation();
                      setActiveTab('pending');
                      setOnlyTimeout(true);
                      setOnlyUrgent(false);
                      fetchMrbList(1, 'pending', { onlyTimeout: true, onlyUrgent: false });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setActiveTab('pending');
                        setOnlyTimeout(true);
                        fetchMrbList(1, 'pending', { onlyTimeout: true });
                      }
                    }}
                  >
                    {timeoutTotal}
                  </span>
                )}
              </span>
            </TabsTrigger>
            <TabsTrigger value="done">{t('mrb.tabDone')}</TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="space-y-5 mt-4">
            <div className="flex flex-wrap items-center gap-5">
              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <Switch
                  checked={onlyTimeout}
                  onCheckedChange={(v: boolean) => {
                    setOnlyTimeout(v);
                    fetchMrbList(1, 'pending', { onlyTimeout: v });
                  }}
                />
                {t('mrb.onlyTimeout')}
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <Switch
                  checked={onlyUrgent}
                  onCheckedChange={(v: boolean) => {
                    setOnlyUrgent(v);
                    fetchMrbList(1, 'pending', { onlyUrgent: v });
                  }}
                />
                {t('mrb.onlyUrgent')}
              </label>
              {Number(overdueSummary.singleApprover) > 0 && (
                <span className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                  {t('mrb.singleApprover')} {overdueSummary.singleApprover}
                </span>
              )}
            </div>

            <div>
              <div className="flex items-baseline gap-2 mb-2">
                <h3 className="text-sm font-medium text-foreground">
                  {t('mrb.pendingLots')}
                </h3>
                <span className="text-xs text-muted-foreground">{t('mrb.pendingLotsHint')}</span>
              </div>
              <ResizableTable
                columns={pendingLotColumns}
                dataSource={pendingLots}
                loading={pendingLoading}
                rowKey="lotId"
                scroll={{ x: 1600, y: 320 }}
                pagination={{
                  current: pendingPage,
                  pageSize,
                  total: pendingTotal,
                  onChange: (p: number) => fetchPendingLotList(p),
                  showSizeChanger: false,
                }}
              />
            </div>

            <div>
              <h3 className="text-sm font-medium text-foreground mb-2">{t('mrb.inProgress')}</h3>
              {renderMrbTable()}
            </div>
          </TabsContent>

          <TabsContent value="done" className="mt-4">
            <div className="flex items-baseline gap-2 mb-2">
              <h3 className="text-sm font-medium text-foreground">{t('mrb.doneGroupsHint')}</h3>
            </div>
            {renderDoneGroupTable()}
          </TabsContent>
        </Tabs>
      </div>

      {/* ===================== 详情弹窗 ===================== */}
      <Dialog open={detailDialog} onOpenChange={setDetailDialog}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t('mrb.mrbDetailTitle')} - {detailData?.mrbNo}
            </DialogTitle>
          </DialogHeader>
          {detailData && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-muted p-3 rounded-md text-sm">
                <div>
                  <span className="text-muted-foreground">{t('material.materialName')}：</span>
                  <span className="font-medium">{detailData.materialName}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('common.quantity')}：</span>
                  <span className="font-medium">
                    {detailData.quantity} {detailData.unit}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('receipt.batchNo')}：</span>
                  <span className="font-medium">{detailData.batchNo || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('material.supplierName')}：</span>
                  <span className="font-medium">{detailData.supplierName}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('mrb.sourceInspectionNo')}：</span>
                  <span className="font-medium">{detailData.inspectionNo || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('common.status')}：</span>
                  {getStatusBadge(detailData.status)}
                </div>
                <div>
                  <span className="text-muted-foreground">{t('mrb.finalDecision')}：</span>
                  <span className="font-medium">
                    {detailData.finalDecision ? dispositionLabel(detailData.finalDecision) : '-'}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('mrb.stuck')}：</span>
                  <span className="font-medium">{fmtStuck(detailData.stuckHours, t)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('mrb.currentTodo')}：</span>
                  <span className="font-medium">{detailData.currentTodo || '-'}</span>
                </div>
              </div>

              {/* 急件 / 单人审批 / 急件直送 三个醒目标签 */}
              <div className="flex flex-wrap gap-2">
                {detailData.isUrgent && (
                  <span className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                    {t('mrb.urgent')}
                    {detailData.urgentReason ? `：${detailData.urgentReason}` : ''}
                  </span>
                )}
                {detailData.isSingleApprover && (
                  <span className="inline-flex items-center gap-1 rounded border border-red-400 bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
                    {t('mrb.singleApprover')}
                    {detailData.separationRemark ? `：${detailData.separationRemark}` : ''}
                  </span>
                )}
                {detailData.skippedApproval && (
                  <span className="inline-flex items-center gap-1 rounded border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">
                    {t('mrb.skippedApprovalTip')}
                  </span>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t('mrb.failReason')}
                </label>
                <div className="text-sm text-foreground bg-muted p-3 rounded-md">
                  {detailData.failReason || '-'}
                </div>
              </div>

              {/* ===== 资料齐全性预审 ===== */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t('mrb.preApproveSection')}
                </label>
                {detailData.status === 'pending_approval' ? (
                  <div className="text-sm rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                    {t('mrb.pendingPreApprove')}
                  </div>
                ) : detailData.completeness?.result ||
                  detailData.completeness?.by ||
                  detailData.completeness?.time ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 bg-muted p-3 rounded-md text-sm">
                    <div>
                      <span className="text-muted-foreground">{t('mrb.preApproveResult')}：</span>
                      <span className="font-medium">{completenessLabel(detailData.completeness?.result)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t('mrb.preApproveBy')}：</span>
                      <span className="font-medium">
                        {detailData.completeness?.byName || detailData.completeness?.by || '-'}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t('mrb.preApproveTime')}：</span>
                      <span className="font-medium">
                        {detailData.completeness?.time
                          ? new Date(detailData.completeness.time).toLocaleString('zh-CN')
                          : '-'}
                      </span>
                    </div>
                    <div className="md:col-span-2">
                      <span className="text-muted-foreground">{t('mrb.preApproveRemark')}：</span>
                      <span>{detailData.completeness?.remark || '-'}</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground bg-muted p-3 rounded-md">-</div>
                )}
              </div>

              {/* ===== 作废信息 ===== */}
              {detailData.cancel &&
                (detailData.cancel.reason || detailData.cancel.time || detailData.cancel.by) && (
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      {t('mrb.cancelInfo')}
                    </label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                      <div className="md:col-span-2">
                        <span className="text-muted-foreground">{t('mrb.cancelReason')}：</span>
                        <span className="font-medium">{detailData.cancel.reason || '-'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">{t('mrb.cancelBy')}：</span>
                        <span>{detailData.cancel.byName || detailData.cancel.by || '-'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">{t('mrb.cancelTime')}：</span>
                        <span>
                          {detailData.cancel.time
                            ? new Date(detailData.cancel.time).toLocaleString('zh-CN')
                            : '-'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

              {/* ===== 撤回 / 驳回信息（v3.1） ===== */}
              {detailData.returnBack?.reason && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    {t('mrb.returnInfo')}
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
                    <div className="md:col-span-2">
                      <span className="text-muted-foreground">{t('mrb.returnReason')}：</span>
                      <span className="font-medium">{detailData.returnBack.reason}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t('mrb.returnBy')}：</span>
                      <span>{detailData.returnBack.byName || detailData.returnBack.by || '-'}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t('mrb.returnNode')}：</span>
                      <span>
                        {detailData.returnBack.from === 'pending_final'
                          ? t('mrb.returnFromFinal')
                          : t('mrb.returnFromPre')}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t('mrb.returnTime')}：</span>
                      <span>
                        {detailData.returnBack.time
                          ? new Date(detailData.returnBack.time).toLocaleString('zh-CN')
                          : '-'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {detailData.withdraw?.reason && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    {t('mrb.withdrawInfo')}
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 rounded-md border border-border bg-muted p-3 text-sm">
                    <div className="md:col-span-2">
                      <span className="text-muted-foreground">{t('mrb.withdrawReason')}：</span>
                      <span className="font-medium">{detailData.withdraw.reason}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t('mrb.cancelBy')}：</span>
                      <span>{detailData.withdraw.byName || detailData.withdraw.by || '-'}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t('mrb.cancelTime')}：</span>
                      <span>
                        {detailData.withdraw.time
                          ? new Date(detailData.withdraw.time).toLocaleString('zh-CN')
                          : '-'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t('mrb.reviewer')}
                </label>
                {detailData.reviewers && detailData.reviewers.length > 0 ? (
                  <div className="border rounded-md overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-foreground w-10">
                            {t('common.serialNo')}
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-foreground">{t('mrb.reviewer')}</th>
                          <th className="px-3 py-2 text-left font-medium text-foreground">{t('mrb.reviewerRole')}</th>
                          <th className="px-3 py-2 text-left font-medium text-foreground">{t('mrb.reviewOpinion')}</th>
                          <th className="px-3 py-2 text-left font-medium text-foreground">{t('mrb.reviewResult')}</th>
                          <th className="px-3 py-2 text-left font-medium text-foreground">{t('common.reviewTime')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailData.reviewers.map((r: MrbReviewer, idx: number) => (
                          <tr key={r.id} className="border-t">
                            <td className="px-3 py-2">{idx + 1}</td>
                            <td className="px-3 py-2">{tui(r.reviewerName) || r.reviewerId}</td>
                            <td className="px-3 py-2">{r.reviewerRole || '-'}</td>
                            <td className="px-3 py-2">{r.reviewOpinion || '-'}</td>
                            <td className="px-3 py-2">
                              {r.reviewResult ? (
                                <Badge variant="default">{dispositionLabel(r.reviewResult)}</Badge>
                              ) : (
                                '-'
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {r.reviewTime ? new Date(r.reviewTime).toLocaleString('zh-CN') : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground bg-muted p-4 rounded-md text-center">
                    {t('mrb.noReviewers')}
                  </div>
                )}
              </div>

              {detailData.dispositions && detailData.dispositions.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    {t('mrb.dispositionDetail')}
                  </label>
                  <div className="border rounded-md overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-foreground w-10">
                            {t('common.serialNo')}
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-foreground">{t('mrb.dispositionType')}</th>
                          <th className="px-3 py-2 text-right font-medium text-foreground">{t('common.quantity')}</th>
                          <th className="px-3 py-2 text-left font-medium text-foreground">{t('mrb.execStatus')}</th>
                          <th className="px-3 py-2 text-left font-medium text-foreground">{t('mrb.refNo')}</th>
                          <th className="px-3 py-2 text-left font-medium text-foreground">{t('common.remark')}</th>
                          <th className="px-3 py-2 text-left font-medium text-foreground">{t('common.operation')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailData.dispositions.map((d, idx) => (
                          <tr key={d.id} className="border-t">
                            <td className="px-3 py-2">{idx + 1}</td>
                            <td className="px-3 py-2">
                              <div className="leading-tight">
                                <div>{dispositionLabel(d.dispositionType)}</div>
                                {d.dispositionType === 'other' && (
                                  <div className="text-xs text-muted-foreground">
                                    {otherTypeLabel(d.otherType)}
                                    {d.holdUntil ? ` · ${t('mrb.holdUntil')} ${d.holdUntil}` : ''}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right">
                              {d.quantity} {d.unit}
                            </td>
                            <td className="px-3 py-2">{getExecStatusBadge(d.execStatus)}</td>
                            <td className="px-3 py-2">{d.otherRefNo || d.refNo || '-'}</td>
                            <td className="px-3 py-2">{d.remark || '-'}</td>
                            <td className="px-3 py-2">
                              {d.otherType === 'customer_return' &&
                              d.execStatus === 'pending' &&
                              canConfirmOut ? (
                                <Button
                                  size="sm"
                                  disabled={submitting}
                                  onClick={() => handleConfirmOut(d.id)}
                                >
                                  {t('mrb.confirmOut')}
                                </Button>
                              ) : d.dispositionType === 'scrap' &&
                                d.execStatus === 'pending' &&
                                canDestroyScrap ? (
                                // 报废：货没进不良品仓前点会被服务端 409 拦住，这里不禁用，
                                // 好让仓管看到「先去调拨」的明确报错，而不是一个灰按钮干瞪眼。
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  disabled={submitting}
                                  onClick={() => handleDestroyScrap(d.id, d.quantity, d.unit)}
                                >
                                  {t('mrb.destroyScrap')}
                                </Button>
                              ) : d.dispositionType === 'scrap' && d.execStatus === 'pending' ? (
                                <span className="text-xs text-muted-foreground">
                                  {t('mrb.execWaitDestroy')}
                                </span>
                              ) : d.otherType === 'customer_return' &&
                                d.execStatus === 'pending' ? (
                                <span className="text-xs text-muted-foreground">{t('mrb.execWaitOut')}</span>
                              ) : (
                                '-'
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {detailData.finalDecision && (
                <div className="grid grid-cols-1 gap-3 bg-primary-soft p-3 rounded-md text-sm">
                  <div>
                    <span className="text-muted-foreground">{t('mrb.qualityManager')}：</span>
                    <span className="font-medium">
                      {detailData.qualityManagerName || detailData.qualityManagerId || '-'}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t('mrb.finalDecision')}：</span>
                    <span className="font-medium">{dispositionLabel(detailData.finalDecision)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t('common.remark')}：</span>
                    <span>{detailData.finalRemark || '-'}</span>
                  </div>
                  {detailData.separationRemark && (
                    <div>
                      <span className="text-muted-foreground">{t('mrb.separationRemark')}：</span>
                      <span className="text-red-700">{detailData.separationRemark}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">{t('common.finalApprovalTime')}：</span>
                    <span>
                      {detailData.finalApprovalTime
                        ? new Date(detailData.finalApprovalTime).toLocaleString('zh-CN')
                        : '-'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDetailDialog(false)}>
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===================== 发起评审弹窗 ===================== */}
      <Dialog
        open={initiateDialog}
        onOpenChange={(open) => {
          setInitiateDialog(open);
          if (!open) setInitiateLot(null);
        }}
      >
        <DialogContent className="max-w-6xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {initiateLot?.isReopen ? t('mrb.reopenReview') : t('mrb.initiateMrb')}
            </DialogTitle>
          </DialogHeader>
          {initiateLot && (
            <div className="space-y-3">
              {initiateLot.isReopen && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <div className="font-medium">{t('mrb.reopenTitle')}</div>
                  <div className="mt-1 space-y-0.5 text-xs">
                    <div>
                      {t('mrb.lastMrbNo')}：{initiateLot.lastMrbNo || '-'}
                      {initiateLot.lastDecision
                        ? ` ｜ ${t('mrb.finalDecision')}：${dispositionLabel(initiateLot.lastDecision)}`
                        : ''}
                    </div>
                    <div>
                      {t('mrb.defectiveQty')}：
                      {initiateLot.remainingDefectiveQty ?? initiateLot.defectiveQty ?? initiateLot.reviewableQty}{' '}
                      {initiateLot.unit}
                    </div>
                    <div>{t('mrb.reopenTip')}</div>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 bg-muted p-3 rounded-md text-sm">
                <div>
                  <span className="text-muted-foreground">{t('mrb.inspectionNo')}：</span>
                  <span className="font-medium">{initiateLot.inspectionNo || initiateLot.lotNo}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('receipt.batchNo')}：</span>
                  <span className="font-medium">{initiateLot.batchNo || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('material.materialCode')}：</span>
                  <span className="font-medium">{initiateLot.materialCode || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('material.materialName')}：</span>
                  <span className="font-medium">{initiateLot.materialName || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('material.supplierName')}：</span>
                  <span className="font-medium">{initiateLot.supplierName || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('mrb.reviewableQty')}：</span>
                  <span className="font-medium">
                    {initiateLot.reviewableQty} {initiateLot.unit}
                  </span>
                </div>
              </div>

              {/* 本次评审数量 */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  {t('mrb.reviewQty')} <span className="text-destructive">*</span>
                </label>
                <div className="flex items-center gap-3">
                  <Input
                    type="number"
                    step="0.0001"
                    min="0"
                    className={`w-[180px] ${initiateQtyValid ? '' : 'border-destructive'}`}
                    value={initiateQty}
                    onChange={(e) => setInitiateQty(e.target.value)}
                  />
                  <span className="text-xs text-muted-foreground">
                    {t('mrb.reviewQtyHint')} {initiateLot.reviewableQty} {initiateLot.unit}
                  </span>
                  <span className={`text-xs ${initiateQtyValid ? 'text-muted-foreground' : 'text-destructive'}`}>
                    {t('mrb.remainingAfter')} {initiateRemain} {initiateLot.unit}
                  </span>
                </div>
                {!initiateQtyValid && (
                  <div className="mt-1 text-xs text-destructive">{t('mrb.reviewQtyOutOfRange')}</div>
                )}
              </div>

              {/* 四类处置数量：发起即定方案（v3.1） */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="block text-sm font-medium text-foreground">
                    {t('mrb.planDispositionSection')} <span className="text-destructive">*</span>
                  </label>
                  <span className="text-xs text-muted-foreground">{t('mrb.planInitiateHint')}</span>
                </div>
                {initiateBoxesLoading ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    {t('common.loading')}
                  </div>
                ) : (
                  <MrbDispositionEditor
                    boxes={initiateBoxes}
                    alloc={initiateAlloc}
                    onChange={setInitiateAlloc}
                    targetQty={fromScaled(initiateQtyScaled)}
                  />
                )}
              </div>

              {/* 急件 */}
              <div className="rounded-md border border-border px-3 py-2 space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-foreground cursor-pointer">
                  <Switch checked={initiateUrgent} onCheckedChange={setInitiateUrgent} />
                  {t('mrb.urgent')}
                  <span className="text-xs font-normal text-muted-foreground">
                    {t('mrb.skippedApprovalTip')}
                  </span>
                </label>
                {initiateUrgent && (
                  <div>
                    <Textarea
                      value={initiateUrgentReason}
                      onChange={(e) => setInitiateUrgentReason(e.target.value)}
                      placeholder={t('mrb.urgentReasonPh')}
                      rows={2}
                    />
                    <div className="mt-1 text-xs text-muted-foreground">{t('mrb.urgentReasonRequired')}</div>
                  </div>
                )}
              </div>

              {/* 评审人员（一步到位，可不选） */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  {t('mrb.reviewersOptional')}
                </label>
                <div className="text-xs text-muted-foreground mb-2">{t('mrb.reviewersOptionalHint')}</div>
                <div className="space-y-2">
                  {initiateReviewers.map((r, idx) => (
                    <div key={idx} className="flex gap-2 items-start">
                      <div className="flex-1">
                        <ReviewerCombobox
                          accounts={accountOptions}
                          loadError={candidateError}
                          value={r.reviewerId}
                          onChange={(id, name) => {
                            handleInitiateReviewerChange(idx, 'reviewerId', id);
                            handleInitiateReviewerChange(idx, 'reviewerName', name);
                            if (!r.reviewerRole) {
                              handleInitiateReviewerChange(idx, 'reviewerRole', roleNameOf(id));
                            }
                          }}
                          placeholder={t('mrb.reviewerSearchPh')}
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-0.5"
                        onClick={() =>
                          setInitiateReviewers((prev) =>
                            prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx),
                          )
                        }
                        disabled={initiateReviewers.length <= 1}
                      >
                        {t('common.delete')}
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() =>
                    setInitiateReviewers((prev) => [
                      ...prev,
                      { reviewerId: '', reviewerName: '', reviewerRole: '' },
                    ])
                  }
                >
                  + {t('mrb.addReviewer')}
                </Button>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  {t('mrb.failReason')} <span className="text-destructive">*</span>
                </label>
                <Textarea
                  value={initiateReason}
                  onChange={(e) => setInitiateReason(e.target.value)}
                  placeholder={t('mrb.failReason')}
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setInitiateDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="outline"
              disabled={submitting}
              onClick={() => handleSubmitInitiate(false)}
            >
              {t('mrb.saveDraft')}
            </Button>
            <Button disabled={submitting} onClick={() => handleSubmitInitiate(true)}>
              {submitting ? t('common.submitting') : t('mrb.submitReviewFlow')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===================== 选定评审人员弹窗 ===================== */}
      <Dialog open={reviewerDialog} onOpenChange={setReviewerDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('mrb.selectReviewers')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {reviewerList.map((r, idx) => (
              <div key={idx} className="flex gap-2 items-start">
                <div className="flex-1 grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">{t('mrb.reviewerId')}</label>
                    <ReviewerCombobox
                      accounts={accountOptions}
                          loadError={candidateError}
                      value={r.reviewerId}
                      onChange={(id, name) => {
                        handleReviewerChange(idx, 'reviewerId', id);
                        handleReviewerChange(idx, 'reviewerName', name);
                        if (!r.reviewerRole) {
                          handleReviewerChange(idx, 'reviewerRole', roleNameOf(id));
                        }
                      }}
                      placeholder={t('mrb.reviewerSearchPh')}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">{t('common.name')}</label>
                    <Input
                      value={r.reviewerName || ''}
                      onChange={(e) => handleReviewerChange(idx, 'reviewerName', e.target.value)}
                      placeholder={t('common.name')}
                      className="h-8"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">{t('common.role')}</label>
                    <Input
                      value={r.reviewerRole || ''}
                      onChange={(e) => handleReviewerChange(idx, 'reviewerRole', e.target.value)}
                      placeholder={t('common.role')}
                      className="h-8"
                    />
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-5"
                  onClick={() => handleRemoveReviewer(idx)}
                  disabled={reviewerList.length <= 1}
                >
                  {t('common.delete')}
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={handleAddReviewer}>
              + {t('mrb.addReviewer')}
            </Button>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setReviewerDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSubmitReviewers} disabled={submitting}>
              {submitting ? t('common.submitting') : t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===================== 资料齐全性预审弹窗 ===================== */}
      <Dialog open={preDialog} onOpenChange={setPreDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('mrb.preApproveTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  className="mt-1"
                  checked={preResult === 'complete'}
                  onChange={() => setPreResult('complete')}
                />
                <span>{t('mrb.preApproveComplete')}</span>
              </label>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  className="mt-1"
                  checked={preResult === 'incomplete'}
                  onChange={() => setPreResult('incomplete')}
                />
                <span>{t('mrb.preApproveIncomplete')}</span>
              </label>
              {roleCode === 'admin' && (
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    className="mt-1"
                    checked={preResult === 'skip'}
                    onChange={() => setPreResult('skip')}
                  />
                  <span>{t('mrb.preApproveSkip')}</span>
                </label>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('mrb.preApproveRemark')}
                {preResult !== 'complete' && <span className="text-destructive"> *</span>}
              </label>
              <Textarea
                value={preRemark}
                onChange={(e) => setPreRemark(e.target.value)}
                rows={3}
                placeholder={t('mrb.preApproveRemarkRequired')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPreDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSubmitPreApprove} disabled={submitting}>
              {submitting ? t('common.submitting') : t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===================== 撤回方案弹窗（SQE） ===================== */}
      <Dialog open={withdrawDialog} onOpenChange={setWithdrawDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('mrb.withdrawTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t('mrb.withdrawTip')}
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('mrb.withdrawReason')} <span className="text-destructive">*</span>
              </label>
              <Textarea
                value={withdrawReason}
                onChange={(e) => setWithdrawReason(e.target.value)}
                rows={3}
                placeholder={t('mrb.withdrawReasonRequired')}
              />
              <div className="mt-1 text-xs text-muted-foreground">
                {t('mrb.withdrawReasonRequired')}（{withdrawReason.trim().length}/5）
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setWithdrawDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleSubmitWithdraw}
              disabled={submitting || withdrawReason.trim().length < 5}
            >
              {submitting ? t('common.submitting') : t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===================== 审批驳回弹窗（IQC主管 / 质量经理） ===================== */}
      <Dialog open={returnDialog} onOpenChange={setReturnDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('mrb.returnTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
              {t('mrb.returnTip')}
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('mrb.returnReason')} <span className="text-destructive">*</span>
              </label>
              <Textarea
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                rows={3}
                placeholder={t('mrb.returnReasonRequired')}
              />
              <div className="mt-1 text-xs text-muted-foreground">
                {t('mrb.returnReasonRequired')}（{returnReason.trim().length}/5）
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setReturnDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleSubmitReturn}
              disabled={submitting || returnReason.trim().length < 5}
            >
              {submitting ? t('common.submitting') : t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===================== 作废弹窗 ===================== */}
      <Dialog open={cancelDialog} onOpenChange={setCancelDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('mrb.cancelTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('mrb.cancelReason')} <span className="text-destructive">*</span>
              </label>
              <Textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={3}
                placeholder={t('mrb.cancelReasonRequired')}
              />
              <div className="mt-1 text-xs text-muted-foreground">
                {t('mrb.cancelReasonRequired')}（{cancelReason.trim().length}/5）
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCancelDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleSubmitCancel}
              disabled={submitting || cancelReason.trim().length < 5}
            >
              {submitting ? t('common.submitting') : t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ 终审否决弹窗（= 否决并全批退货） ============ */}
      <Dialog open={rejectDialog} onOpenChange={setRejectDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('mrb.rejectTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/*
              必须先说清后果再让填理由。
              否决在 v3 里不是「不通过」这么轻 —— 它等价于整批退货，
              一次点击就会生成退货单 + 供应商欠料 + 不良品调拨任务，
              这三张单都会真实流到仓库和采购手上，事后撤回代价极大。
            */}
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 space-y-1">
              <div className="text-sm font-medium text-destructive">
                {t('mrb.rejectReturnWarn')}
              </div>
              <div className="text-sm text-foreground">
                {t('mrb.rejectReturnQty')}：
                <span className="font-medium tabular-nums">
                  {rejectQty} {rejectUnit}
                </span>
                （{t('mrb.rejectWholeBatch')}）
              </div>
              <div className="text-xs text-muted-foreground">{t('mrb.rejectReturnEffects')}</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('mrb.rejectReason')} <span className="text-destructive">*</span>
              </label>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                placeholder={t('mrb.rejectReasonRequired')}
              />
              <div className="mt-1 text-xs text-muted-foreground">
                {t('mrb.rejectReasonRequired')}（{rejectReason.trim().length}/5）
              </div>
            </div>
            {rejectNeedSeparation && (
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  {t('mrb.separationRemark')} <span className="text-destructive">*</span>
                </label>
                <div className="mb-1 text-xs text-red-600">{t('mrb.separationRemarkTip')}</div>
                <Textarea
                  value={rejectSeparationRemark}
                  onChange={(e) => setRejectSeparationRemark(e.target.value)}
                  rows={2}
                  placeholder={t('mrb.separationRemarkRequired')}
                />
                <div className="mt-1 text-xs text-muted-foreground">
                  {t('mrb.separationRemarkRequired')}（{rejectSeparationRemark.trim().length}/2）
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRejectDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleSubmitReject}
              disabled={
                submitting ||
                rejectReason.trim().length < 5 ||
                (rejectNeedSeparation && rejectSeparationRemark.trim().length < 2)
              }
            >
              {submitting ? t('common.submitting') : t('mrb.rejectAndReturnConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ 终审弹窗（MRB v3：只读确认 SQE 方案） ============ */}
      <Dialog open={finalDialog} onOpenChange={setFinalDialog}>
        <DialogContent className="max-w-5xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('mrb.finalApproval')}</DialogTitle>
          </DialogHeader>

          {finalPlanLoading ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              {t('common.loading')}
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {/* ---------- 汇总条 ---------- */}
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm bg-muted px-3 py-2 rounded-md">
                  <span>
                    <span className="text-muted-foreground">{t('mrb.batchQuantity')}：</span>
                    <span className="font-medium text-foreground">
                      {finalMrbQty} {finalUnit}
                    </span>
                  </span>
                  <span>
                    <span className="text-muted-foreground">{t('mrb.dispositionTotal')}：</span>
                    <span
                      className={
                        finalPlanMatched
                          ? 'font-medium text-foreground'
                          : 'font-medium text-destructive'
                      }
                    >
                      {fromScaled(finalPlanSumScaled)} {finalUnit}
                    </span>
                  </span>
                  {!finalPlanMatched && (
                    <span className="text-destructive font-medium">
                      {t('mrb.qtyDiff')}：{finalPlanDiff > 0 ? '+' : ''}
                      {finalPlanDiff} {finalUnit}
                    </span>
                  )}
                  {finalPlan?.planTime && (
                    <span className="text-muted-foreground">
                      {t('mrb.planMadeBy')}：{finalPlan.planBy || '-'} ｜{' '}
                      {String(finalPlan.planTime).slice(0, 16).replace('T', ' ')}
                    </span>
                  )}
                </div>

                {/* ---------- 没有方案：直接拦住，不允许「凭感觉通过」 ---------- */}
                {!finalHasPlan && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    {t('mrb.planMissing')}
                  </div>
                )}

                {/* ---------- 处置方案（只读） ---------- */}
                {finalHasPlan && (
                  <div>
                    <div className="mb-1 flex flex-wrap items-baseline gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {t('mrb.dispositionDetail')}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t('mrb.finalReadonlyTip')}
                      </span>
                    </div>
                    <div className="overflow-hidden rounded-md border border-border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium">
                              {t('mrb.dispositionType')}
                            </th>
                            <th className="px-3 py-2 text-right font-medium">
                              {t('common.quantity')}
                            </th>
                            <th className="px-3 py-2 text-left font-medium">{t('mrb.qrCount')}</th>
                            <th className="px-3 py-2 text-left font-medium">{t('common.remark')}</th>
                            <th className="px-3 py-2 text-left font-medium">{t('mrb.execStatus')}</th>
                            <th className="px-3 py-2" />
                          </tr>
                        </thead>
                        <tbody>
                          {finalPlanGroups.map((g) => {
                            const expanded = !!expandedDispo[g.type];
                            const remarks = g.rows
                              .map((r) => (r.remark || '').trim())
                              .filter(Boolean)
                              .join('；');
                            return (
                              <React.Fragment key={g.type}>
                                <tr className="border-t border-border">
                                  <td className="px-3 py-2 font-medium text-foreground">
                                    {dispositionLabel(g.type)}
                                  </td>
                                  <td className="px-3 py-2 text-right tabular-nums text-foreground">
                                    {g.qtyNum} {finalUnit}
                                  </td>
                                  <td className="px-3 py-2 text-muted-foreground">{g.labels.length}</td>
                                  <td className="px-3 py-2 text-muted-foreground">
                                    {remarks || '-'}
                                  </td>
                                  <td className="px-3 py-2">{getExecStatusBadge(g.rows[0]?.execStatus || '')}</td>
                                  <td className="px-3 py-2 text-right">
                                    {g.labels.length > 0 && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() =>
                                          setExpandedDispo((p) => ({ ...p, [g.type]: !p[g.type] }))
                                        }
                                      >
                                        {expanded ? t('mrb.collapseQr') : t('mrb.expandQr')}
                                      </Button>
                                    )}
                                  </td>
                                </tr>
                                {expanded && g.labels.length > 0 && (
                                  <tr className="border-t border-border bg-muted/30">
                                    <td colSpan={6} className="px-3 py-2">
                                      <div className="space-y-1">
                                        <div className="text-xs font-medium text-muted-foreground">
                                          {t('mrb.qrDetail')}
                                        </div>
                                        {g.labels.map((l, i) => (
                                          <div
                                            key={`${l.receiptId}-${i}`}
                                            className="flex flex-wrap items-center gap-x-5 text-xs"
                                          >
                                            <span className="font-medium text-foreground">
                                              {l.receiptNo}
                                            </span>
                                            <span className="text-muted-foreground">
                                              {t('mrb.qrContent')}：{l.qrContent || '-'}
                                            </span>
                                            <span className="tabular-nums text-foreground">
                                              {l.quantity} {finalUnit}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                        <tfoot className="bg-muted/50">
                          <tr className="border-t border-border">
                            <td className="px-3 py-2 font-medium text-foreground">
                              {t('mrb.sumLabel')}
                            </td>
                            <td className="px-3 py-2 text-right font-medium tabular-nums text-foreground">
                              {fromScaled(finalPlanSumScaled)} {finalUnit}
                            </td>
                            <td className="px-3 py-2" colSpan={4} />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}

                {/* ---------- 下游单预览：让质量经理在点「通过」前就知道会生成什么 ---------- */}
                {finalHasPlan && (
                  <div className="rounded-md border border-border px-3 py-2">
                    <div className="mb-1 text-sm font-medium text-foreground">
                      {t('mrb.downstreamPreview')}
                    </div>
                    <div className="space-y-1 text-sm">
                      {qtyOfType('special_admit') > 0 && (
                        <div className="flex gap-2">
                          <span className="w-20 shrink-0 text-muted-foreground">
                            {dispositionLabel('special_admit')}
                          </span>
                          <span className="w-24 shrink-0 tabular-nums text-foreground">
                            {qtyOfType('special_admit')} {finalUnit}
                          </span>
                          <span className="text-muted-foreground">{t('mrb.previewAdmit')}</span>
                        </div>
                      )}
                      {qtyOfType('rework') > 0 && (
                        <div className="flex gap-2">
                          <span className="w-20 shrink-0 text-muted-foreground">
                            {dispositionLabel('rework')}
                          </span>
                          <span className="w-24 shrink-0 tabular-nums text-foreground">
                            {qtyOfType('rework')} {finalUnit}
                          </span>
                          <span className="text-muted-foreground">{t('mrb.previewRework')}</span>
                        </div>
                      )}
                      {qtyOfType('return') > 0 && (
                        <div className="flex gap-2">
                          <span className="w-20 shrink-0 text-muted-foreground">
                            {dispositionLabel('return')}
                          </span>
                          <span className="w-24 shrink-0 tabular-nums text-foreground">
                            {qtyOfType('return')} {finalUnit}
                          </span>
                          <span className="text-muted-foreground">{t('mrb.previewReturn')}</span>
                        </div>
                      )}
                      {qtyOfType('scrap') > 0 && (
                        <div className="flex gap-2">
                          <span className="w-20 shrink-0 text-muted-foreground">
                            {dispositionLabel('scrap')}
                          </span>
                          <span className="w-24 shrink-0 tabular-nums text-foreground">
                            {qtyOfType('scrap')} {finalUnit}
                          </span>
                          <span className="text-muted-foreground">{t('mrb.previewScrap')}</span>
                        </div>
                      )}
                      {qtyOfType('other') > 0 && (
                        <div className="flex gap-2">
                          <span className="w-20 shrink-0 text-muted-foreground">
                            {dispositionLabel('other')}
                          </span>
                          <span className="w-24 shrink-0 tabular-nums text-foreground">
                            {qtyOfType('other')} {finalUnit}
                          </span>
                          <span className="text-muted-foreground">{t('mrb.previewOther')}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ---------- 评审意见汇总：有异议的标红置顶 ---------- */}
                <div className="rounded-md border border-border px-3 py-2">
                  <div className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground">
                    {t('mrb.reviewerOpinions')}
                    {finalDisagree.length > 0 && (
                      <Badge variant="destructive">
                        {t('mrb.reviewDisagree')} {finalDisagree.length}
                      </Badge>
                    )}
                  </div>
                  {(finalPlan?.reviewers ?? []).length === 0 ? (
                    <div className="text-sm text-muted-foreground">{t('mrb.noReviewerOpinion')}</div>
                  ) : (
                    <div className="space-y-1">
                      {[...(finalPlan?.reviewers ?? [])]
                        .sort(
                          (a, b) =>
                            Number(b.reviewResult === 'disagree') -
                            Number(a.reviewResult === 'disagree'),
                        )
                        .map((r) => (
                          <div
                            key={r.id}
                            className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-sm ${
                              r.reviewResult === 'disagree' ? 'text-destructive' : 'text-foreground'
                            }`}
                          >
                            <span className="font-medium">{r.reviewerName || '-'}</span>
                            <span className="text-xs text-muted-foreground">
                              {r.reviewerRole || ''}
                            </span>
                            <Badge
                              variant={
                                r.reviewResult === 'disagree'
                                  ? 'destructive'
                                  : r.reviewResult === 'agree'
                                    ? 'default'
                                    : 'outline'
                              }
                            >
                              {reviewResultLabel(r.reviewResult)}
                            </Badge>
                            <span className="flex-1 min-w-[160px]">
                              {r.reviewOpinion || '-'}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {r.reviewTime ? String(r.reviewTime).slice(0, 16).replace('T', ' ') : ''}
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>

                {/* 审批人一律取登录身份，不可编辑（后端亦会强制覆盖请求体传入值，防冒名） */}
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                  <div className="text-sm text-muted-foreground mb-1">
                    {t('mrb.qualityManagerName')}
                  </div>
                  <div className="text-sm font-medium text-foreground">
                    {operatorName || '-'}
                    {loginUser?.account ? `（${loginUser.account}）` : ''}
                  </div>
                </div>

                {finalNeedSeparation && (
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      {t('mrb.separationRemark')} <span className="text-destructive">*</span>
                    </label>
                    <div className="mb-1 text-xs text-red-600">{t('mrb.separationRemarkTip')}</div>
                    <Textarea
                      value={finalSeparationRemark}
                      onChange={(e) => setFinalSeparationRemark(e.target.value)}
                      rows={2}
                      placeholder={t('mrb.separationRemarkRequired')}
                    />
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    {t('common.remark')}
                  </label>
                  <Textarea
                    value={finalRemark}
                    onChange={(e) => setFinalRemark(e.target.value)}
                    placeholder={t('common.remark')}
                    rows={2}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="secondary" onClick={() => setFinalDialog(false)}>
                  {t('common.cancel')}
                </Button>
                <Button variant="destructive" onClick={handleFinalReject} disabled={submitting}>
                  {t('mrb.rejectAndReturn')}
                </Button>
                <Button
                  onClick={handleSubmitFinal}
                  disabled={
                    submitting ||
                    !finalHasPlan ||
                    !finalPlanMatched ||
                    (finalNeedSeparation && finalSeparationRemark.trim().length < 2)
                  }
                >
                  {submitting ? t('common.submitting') : t('mrb.passApprove')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* MRB v3：方案制定（评审员 + 处置明细 + 二维码分摊） */}
      <MrbPlanDialog
        open={planDialog}
        mrbId={planMrb?.id || null}
        mrbQuantity={planMrb?.quantity ?? 0}
        onClose={() => {
          setPlanDialog(false);
          setPlanMrb(null);
        }}
        onSaved={() => {
          fetchMrbList(1, activeTab);
          fetchOverdueSummary();
        }}
      />
    </div>
  );
};

export default MrbList;
