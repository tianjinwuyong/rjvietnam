import React, { useEffect, useState } from 'react';
import { useI18n, tf } from '@client/src/i18n';
import { Button } from '@client/src/components/ui/button';
import { Textarea } from '@client/src/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import { toast } from 'sonner';
import { logger } from '@client/src/utils/logger';
import { extractApiError } from '@client/src/utils/apiError';
import {
  getMrbLotLabels,
  getMrbPlan,
  saveMrbPlan,
  getReviewerCandidates,
  type MrbLotLabel,
  type MrbReviewerCandidate,
} from '@client/src/api/mrb';
import MrbDispositionEditor, { buildDispositions, validateAlloc } from './MrbDispositionEditor';

/**
 * MRB 方案制定弹窗（MRB v3）
 *
 * SQE 在这里一次性定死：评审人员 + 四类处置 + 每类处置从哪些收货箱分走多少。
 * 质量经理审批时只做「通过 / 驳回退回修改 / 否决并全批退货」，不再现场录处置。
 *
 * 表格已抽到 `MrbDispositionEditor`，与「发起 MRB」弹窗共用同一份算法。
 */
export interface MrbPlanDialogProps {
  open: boolean;
  mrbId: string | null;
  /** 本单评审数量 N（处置分摊合计必须等于它） */
  mrbQuantity: number | string;
  onClose: () => void;
  onSaved: () => void;
}

const MrbPlanDialog: React.FC<MrbPlanDialogProps> = ({
  open,
  mrbId,
  mrbQuantity,
  onClose,
  onSaved,
}) => {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [boxes, setBoxes] = useState<MrbLotLabel[]>([]);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [reviewers, setReviewers] = useState<MrbReviewerCandidate[]>([]);
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  /** 不合格原因（提交必填，覆盖系统自动文案） */
  const [failReason, setFailReason] = useState('');
  /** 单据当前状态：reviewing 时只读（需先撤回） */
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    if (!open || !mrbId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [labelRes, planRes, candRes] = await Promise.all([
          getMrbLotLabels({ mrbId }),
          getMrbPlan(mrbId),
          getReviewerCandidates(),
        ]);
        if (cancelled) return;

        setBoxes(labelRes.data?.items || []);
        setReviewers(candRes.data?.items || []);
        setStatus(planRes.data?.status || '');
        // 自动触发写的是模板说明，不能作为原因预填，强制 SQE 填写真实原因
        const savedReason = String((planRes.data as any)?.failReason || '');
        setFailReason(savedReason.includes('自动触发') ? '' : savedReason);

        // 回填已保存的方案（草稿重进不丢数据）
        const init: Record<string, string> = {};
        for (const d of planRes.data?.dispositions || []) {
          for (const l of d.labels || []) {
            init[`${l.receiptId}::${d.dispositionType}`] = String(l.quantity);
          }
        }
        setAlloc(init);
        setReviewerIds((planRes.data?.reviewers || []).map((r) => r.reviewerId));
      } catch (error: any) {
        logger.error('load mrb plan failed', error);
        toast.error(t('mrb.planLoadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, mrbId]);

  const handleSave = async (submit: boolean) => {
    if (!mrbId) return;

    if (submit) {
      if (failReason.trim().length < 2) {
        toast.error(t('mrb.planFailReasonRequired'));
        return;
      }
      if (reviewerIds.length === 0) {
        toast.error(t('mrb.planNeedReviewer'));
        return;
      }
      const invalid = validateAlloc(boxes, alloc, mrbQuantity);
      if (invalid) {
        if (invalid.type === 'box') toast.error(tf('mrb.planBoxOver', { box: invalid.box }));
        else
          toast.error(
            tf('mrb.planSumMismatch', { done: invalid.done, total: invalid.total }),
          );
        return;
      }
    }

    const dispositions = buildDispositions(boxes, alloc);

    setSubmitting(true);
    try {
      await saveMrbPlan({
        mrbId,
        dispositions,
        reviewers: reviewerIds.map((id) => {
          const cand = reviewers.find((r) => r.id === id);
          return { reviewerId: id, reviewerName: cand?.name, reviewerRole: cand?.roleCode };
        }),
        failReason: failReason.trim() || undefined,
        submit,
      });
      toast.success(submit ? t('mrb.planSubmitted') : t('mrb.planSaved'));
      onSaved();
      onClose();
    } catch (error: any) {
      logger.error('save mrb plan failed', error);
      // 后端 403/400 的真实原因在 error.message，直接取 axios message 只会显示
      // 「Request failed with status code 403」，现场无法判断是权限还是数据问题。
      const info = extractApiError(error, t('mrb.planSaveFailed'));
      toast.error(info.message || t('mrb.planSaveFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-6xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('mrb.planTitle')}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">{t('common.loading')}</div>
        ) : (
          <div className="space-y-5">
            {/* 不合格原因：系统自动触发时写的是模板文案，必须由 SQE 填写真实原因 */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium">
                  {t('mrb.planFailReason')} <span className="text-red-500">*</span>
                </h3>
                <span className="text-xs text-muted-foreground">{t('mrb.planFailReasonHint')}</span>
              </div>
              <Textarea
                rows={2}
                value={failReason}
                onChange={(e) => setFailReason(e.target.value)}
                placeholder={t('mrb.planFailReasonPh')}
              />
            </section>

            {/* 评审人员 */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium">{t('mrb.planReviewers')}</h3>
                <span className="text-xs text-muted-foreground">{t('mrb.planReviewersHint')}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {reviewers.map((r) => {
                  const on = reviewerIds.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() =>
                        setReviewerIds((prev) =>
                          on ? prev.filter((x) => x !== r.id) : [...prev, r.id],
                        )
                      }
                      className={`rounded-md border px-3 py-1.5 text-xs transition ${
                        on
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background hover:bg-muted'
                      }`}
                    >
                      {r.name}
                      <span className="ml-1 opacity-70">{r.roleName || r.roleCode}</span>
                    </button>
                  );
                })}
                {reviewers.length === 0 && (
                  <span className="text-xs text-muted-foreground">
                    {t('mrb.planNoReviewerCandidate')}
                  </span>
                )}
              </div>
            </section>

            {/* 二维码分摊 */}
            <section>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">{t('mrb.planDispositionSection')}</h3>
                {status === 'reviewing' && (
                  <span className="text-xs text-amber-600">{t('mrb.planLockedTip')}</span>
                )}
              </div>
              <MrbDispositionEditor
                boxes={boxes}
                alloc={alloc}
                onChange={setAlloc}
                targetQty={mrbQuantity}
              />
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button variant="outline" onClick={() => handleSave(false)} disabled={submitting || loading}>
            {t('mrb.planSaveDraft')}
          </Button>
          <Button onClick={() => handleSave(true)} disabled={submitting || loading}>
            {t('mrb.planSubmit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MrbPlanDialog;
