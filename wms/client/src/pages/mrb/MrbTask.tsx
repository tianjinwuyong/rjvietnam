import React, { useState, useEffect } from 'react';
import { useI18n, tui } from '@client/src/i18n';
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
import { Textarea } from '@client/src/components/ui/textarea';
import ResizableTable from '@client/src/components/ui/resizable-table';
import { Table, type TableProps } from '@client/src/compat/antd-table';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';
import { getMyTasks, submitReview, getMrbDetail, getMrbPlan, type MrbPlanDetail } from '@client/src/api/mrb';
import {
  MRB_REVIEW_RESULTS,
  MRB_REVIEW_RESULT_LABEL_KEYS,
  MRB_STATUS_LABEL_KEYS,
  MRB_STATUS_BADGE_VARIANT,
  MRB_DISPOSITION_LABEL_KEYS,
} from '@client/src/constants/business-enums';
import type { MrbReview, MrbReviewer } from '@shared/api.interface';

/** 从后端统一错误体 { error: { code, message } } 中取出可读文案 */
const pickErrMsg = (error: any): string =>
  error?.response?.data?.error?.message || error?.response?.data?.message || '';

/** 停留时长展示：<24h 用小时，否则用天 */
const fmtStuck = (hours: number | null | undefined, t: (k: string) => string): string => {
  if (hours === null || hours === undefined || Number.isNaN(Number(hours))) return '-';
  const h = Number(hours);
  if (h < 24) return `${h.toFixed(h < 10 ? 1 : 0)} ${t('mrb.stuckHourUnit')}`;
  return `${(h / 24).toFixed(1)} ${t('mrb.stuckDayUnit')}`;
};

const MrbTask: React.FC = () => {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [data, setData] = useState<(MrbReview & { myReview?: MrbReviewer })[]>([]);
  const [loading, setLoading] = useState(false);

  const [status, setStatus] = useState('');

  // 提交评审弹窗
  const [reviewDialog, setReviewDialog] = useState(false);
  const [currentMrb, setCurrentMrb] = useState<MrbReview | null>(null);
  const [reviewOpinion, setReviewOpinion] = useState('');
  /** MRB v3：只有 agree / disagree 两种表态 */
  const [reviewResult, setReviewResult] = useState<string>('agree');
  const [submitting, setSubmitting] = useState(false);
  /** 待评审的 SQE 方案（评审员要看着方案才有意见可提） */
  const [plan, setPlan] = useState<MrbPlanDetail | null>(null);
  const [planLoading, setPlanLoading] = useState(false);

  // 详情弹窗
  const [detailDialog, setDetailDialog] = useState(false);
  const [detailData, setDetailData] = useState<MrbReview | null>(null);

  const fetchData = async (p: number = page) => {
    setLoading(true);
    try {
      // 不传 reviewerId：服务端一律按登录身份过滤（旧版手填工号，
      // 而库里 reviewer_id.user_id 是账号 UUID，永远匹配不上，导致列表空白/提交失败）
      const result = await getMyTasks({
        page: p,
        pageSize,
        status: status || undefined,
      });
      setData(result.data.items);
      setTotal(result.data.total);
      setPage(p);
    } catch (error) {
      logger.error('get my tasks failed', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = () => fetchData(1);
  const handleReset = () => {
    setStatus('');
    fetchData(1);
  };

  /** 状态 Badge（统一走 business-enums 映射，页面不再各写一份） */
  const getStatusBadge = (s: string) => {
    const key = MRB_STATUS_LABEL_KEYS[s];
    const variant = (MRB_STATUS_BADGE_VARIANT[s] || 'outline') as any;
    return <Badge variant={variant}>{key ? t(key) : s}</Badge>;
  };

  const resultLabel = (r?: string): string => {
    if (!r) return '-';
    const key = MRB_REVIEW_RESULT_LABEL_KEYS[r];
    if (key) return t(key);
    // 旧数据兜底：老流程把「处置方式」存进 review_result
    const legacy = MRB_DISPOSITION_LABEL_KEYS[r];
    return legacy ? t(legacy) : r;
  };

  const dispoLabel = (d?: string | null): string => {
    if (!d) return '-';
    const key = MRB_DISPOSITION_LABEL_KEYS[d];
    return key ? t(key) : d;
  };

  /**
   * 打开评审弹窗。
   * MRB v3 起评审员评审的对象是「SQE 制定的方案」，所以必须先把方案拉出来展示，
   * 否则评审员看到的只有一个物料名和数量，只能凭感觉点「同意」。
   */
  const handleOpenReview = async (record: MrbReview & { myReview?: MrbReviewer }) => {
    setCurrentMrb(record);
    setReviewOpinion(record.myReview?.reviewOpinion || '');
    // 历史值（special_admit 之类）在 v3 里没有对应表态，一律回到「同意」
    const prev = record.myReview?.reviewResult;
    setReviewResult(prev === 'disagree' ? 'disagree' : 'agree');
    setPlan(null);
    setPlanLoading(true);
    setReviewDialog(true);
    try {
      const res = await getMrbPlan(record.id);
      setPlan(res.data);
    } catch (error) {
      // 方案拉不到不阻断提交意见，但要留痕
      logger.error('load mrb plan failed', error);
    } finally {
      setPlanLoading(false);
    }
  };

  const handleSubmitReview = async () => {
    if (!currentMrb) return;
    if (!reviewOpinion.trim()) {
      toast.error(t('mrb.reviewOpinion') + ' ' + t('message.requiredField'));
      return;
    }
    // 有异议必须说清理由（服务端同样校验 ≥5 字，这里提前拦住避免白跑一趟）
    if (reviewResult === 'disagree' && reviewOpinion.trim().length < 5) {
      toast.error(t('mrb.disagreeOpinionRequired'));
      return;
    }
    setSubmitting(true);
    try {
      // 评审人由服务端按登录身份判定，前端不再传 reviewerId（防冒名，也避免工号/UUID 错配）
      await submitReview({
        mrbId: currentMrb.id,
        reviewOpinion,
        reviewResult,
      });
      toast.success(t('mrb.submitSuccess'));
      setReviewDialog(false);
      fetchData(page);
    } catch (error: any) {
      logger.error('submit review failed', error);
      toast.error(pickErrMsg(error) || t('mrb.submitFailed'));
    } finally {
      setSubmitting(false);
    }
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

  const columns: TableProps<MrbReview & { myReview?: MrbReviewer }>['columns'] = [
    {
      title: t('common.serialNo'),
      key: 'index',
      width: 66,
      fixed: 'left',
      render: (_: any, __: any, index: number) => (page - 1) * pageSize + index + 1,
    },
    { title: t('mrb.mrbNo'), dataIndex: 'mrbNo', width: 160 },
    {
      title: t('mrb.urgentShort'),
      key: 'urgent',
      width: 76,
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
    { title: t('receipt.batchNo'), dataIndex: 'batchNo', width: 140 },
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
          <span
            className={cls}
            title={record.statusSince ? new Date(record.statusSince).toLocaleString('zh-CN') : undefined}
          >
            {fmtStuck(record.stuckHours, t)}
          </span>
        );
      },
    },
    {
      title: t('mrb.myReviewStatus'),
      key: 'myStatus',
      width: 120,
      render: (_: any, record: MrbReview & { myReview?: MrbReviewer }) => {
        if (!record.myReview?.reviewResult) {
          return <Badge variant="secondary">{t('mrb.pendingMyReview')}</Badge>;
        }
        return <Badge variant="default">{resultLabel(record.myReview.reviewResult)}</Badge>;
      },
    },
    {
      title: t('common.operation'),
      key: 'action',
      width: 190,
      fixed: 'right',
      render: (_: any, record: MrbReview & { myReview?: MrbReviewer }) => (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => handleViewDetail(record.id)}>
            {t('common.detail')}
          </Button>
          {record.status === 'reviewing' && (
            <Button size="sm" onClick={() => handleOpenReview(record)}>
              {record.myReview?.reviewResult ? t('mrb.modifyOpinion') : t('mrb.submitReview')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  /** 行底色：超时红、预警黄，急件淡玫瑰底 */
  const rowClassName = (record: MrbReview): string => {
    if (record.slaLevel === 'overdue') return 'bg-red-50';
    if (record.slaLevel === 'warn') return 'bg-amber-50';
    if (record.isUrgent) return 'bg-rose-50/50';
    return '';
  };

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-[12px] p-4 border border-border">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
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
                <SelectItem value="reviewing">{t('mrb.status_reviewing')}</SelectItem>
                <SelectItem value="pending_final">{t('mrb.status_pending_final')}</SelectItem>
                <SelectItem value="approved">{t('mrb.status_approved')}</SelectItem>
                <SelectItem value="closed">{t('mrb.status_closed')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={handleReset}>
            {t('common.reset')}
          </Button>
          <Button onClick={handleSearch}>{t('common.search')}</Button>
        </div>
      </div>

      <div className="bg-card rounded-[12px] p-4 border border-border">
        <ResizableTable
          columns={columns}
          dataSource={data}
          loading={loading}
          rowKey="id"
          rowClassName={(record) => rowClassName(record as MrbReview)}
          scroll={{ x: 1300, y: 500 }}
          pagination={{
            current: page,
            pageSize,
            total,
            onChange: (p: number) => fetchData(p),
            showSizeChanger: false,
          }}
        />
      </div>

      {/* 提交评审弹窗 */}
      <Dialog open={reviewDialog} onOpenChange={setReviewDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('mrb.submitReviewTitle')} - {currentMrb?.mrbNo}
            </DialogTitle>
          </DialogHeader>
          {currentMrb && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 bg-muted p-3 rounded-md text-sm">
                <div>
                  <span className="text-muted-foreground">{t('material.materialName')}：</span>
                  <span className="font-medium">{currentMrb.materialName}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('common.quantity')}：</span>
                  <span className="font-medium">
                    {currentMrb.quantity} {currentMrb.unit}
                  </span>
                </div>
              </div>
              {/* SQE 制定的处置方案（只读）—— 评审员评审的就是它 */}
              <div className="rounded-md border border-border">
                <div className="flex items-center justify-between border-b border-border bg-muted/50 px-3 py-2">
                  <span className="text-sm font-medium text-foreground">{t('mrb.planToReview')}</span>
                  <span className="text-xs text-muted-foreground">{t('mrb.finalReadonlyTip')}</span>
                </div>
                <div className="space-y-1 px-3 py-2 text-sm">
                  {planLoading ? (
                    <div className="text-muted-foreground">{t('common.loading')}</div>
                  ) : (plan?.dispositions?.length ?? 0) === 0 ? (
                    <div className="text-destructive">{t('mrb.planMissingShort')}</div>
                  ) : (
                    (plan?.dispositions ?? []).map((d) => (
                      <div key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="w-16 shrink-0 font-medium text-foreground">
                          {dispoLabel(d.dispositionType)}
                        </span>
                        <span className="w-24 shrink-0 tabular-nums text-foreground">
                          {d.quantity} {currentMrb.unit}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {d.labels?.length
                            ? `${d.labels.length} ${t('mrb.qrCount')}`
                            : t('mrb.noQrBound')}
                          {d.remark ? ` ｜ ${d.remark}` : ''}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  {t('mrb.reviewResult')} <span className="text-destructive">*</span>
                </label>
                {/*
                  只有两种表态。评审员不掌握收货箱二维码，让他选「退多少/返多少」
                  只能凭感觉；处置数量由 SQE 定、由质量经理终审。
                */}
                <div className="flex gap-2">
                  {MRB_REVIEW_RESULTS.map((r) => {
                    const active = reviewResult === r;
                    const danger = r === 'disagree';
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setReviewResult(r)}
                        className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                          active
                            ? danger
                              ? 'border-destructive bg-destructive/5 font-medium text-destructive'
                              : 'border-primary bg-primary/5 font-medium text-primary'
                            : 'border-border text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        {resultLabel(r)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  {t('mrb.reviewOpinion')} <span className="text-destructive">*</span>
                </label>
                <Textarea
                  value={reviewOpinion}
                  onChange={(e) => setReviewOpinion(e.target.value)}
                  placeholder={
                    reviewResult === 'disagree'
                      ? t('mrb.disagreeOpinionRequired')
                      : t('mrb.reviewOpinion')
                  }
                  rows={4}
                />
                {reviewResult === 'disagree' && reviewOpinion.trim().length < 5 && (
                  <div className="mt-1 text-xs text-destructive">
                    {t('mrb.disagreeOpinionRequired')}（{reviewOpinion.trim().length}/5）
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setReviewDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSubmitReview} disabled={submitting}>
              {submitting ? t('common.submitting') : t('common.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 详情弹窗 */}
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
                  <span className="text-muted-foreground">{t('common.status')}：</span>
                  {getStatusBadge(detailData.status)}
                </div>
                <div>
                  <span className="text-muted-foreground">{t('mrb.stuck')}：</span>
                  <span className="font-medium">{fmtStuck(detailData.stuckHours, t)}</span>
                </div>
              </div>

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
                                <Badge variant="default">{resultLabel(r.reviewResult)}</Badge>
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

              {detailData.finalDecision && (
                <div className="grid grid-cols-1 gap-2 bg-primary-soft p-3 rounded-md text-sm">
                  <div>
                    <span className="text-muted-foreground">{t('mrb.finalDecision')}：</span>
                    <span className="font-medium">{resultLabel(detailData.finalDecision)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t('common.remark')}：</span>
                    <span>{detailData.finalRemark || '-'}</span>
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
    </div>
  );
};

export default MrbTask;
