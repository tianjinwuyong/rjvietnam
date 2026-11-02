import React, { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { useAuth } from '../../auth/AuthContext';
import PdaLayout from './components/PdaLayout';
import PdaCard from './components/PdaCard';
import PdaButton from './components/PdaButton';
import StatusBadge from './components/StatusBadge';
import ResultOverlay from './components/ResultOverlay';
import { getMyTasks, getMrbDetail, finalApprove, submitReview } from '../../api/pda';
import { errMsg } from './utils';
import { speakError } from '../../utils/speech';
import type { MrbReview, MrbReviewer, PaginatedResponse } from '@shared/api.interface';

/** 终审处置（PDA 仅支持四项常规处置；「其他」需填去向/关联单号，须在 PC 端完成） */
type FinalResult = 'special_admit' | 'return' | 'rework' | 'scrap';
/** 评审结论四项（旧 accept/reject/deviation 已废弃，服务端仍兼容映射但不接受前端再发旧值） */
type ReviewResult = 'special_admit' | 'return' | 'rework' | 'scrap';

type MrbTask = MrbReview & { myReview?: MrbReviewer };

/** 停留时长展示：<24h 用小时，否则用天 */
const fmtStuck = (hours: number | null | undefined, unitH: string, unitD: string): string => {
  if (hours === null || hours === undefined || Number.isNaN(Number(hours))) return '-';
  const h = Number(hours);
  if (h < 24) return `${h.toFixed(h < 10 ? 1 : 0)} ${unitH}`;
  return `${(h / 24).toFixed(1)} ${unitD}`;
};

/** P10: 不良品 / MRB 流程评审（评审员提交意见 + 终审） */
const PdaMrb: React.FC = () => {
  const { t } = useI18n();
  const { role } = useAuth();
  const [list, setList] = useState<MrbTask[]>([]);
  const [current, setCurrent] = useState<MrbReview | null>(null);
  const [myReview, setMyReview] = useState<MrbReviewer | undefined>(undefined);
  const [reviewResult, setReviewResult] = useState<ReviewResult>('special_admit');
  const [reviewOpinion, setReviewOpinion] = useState('');
  const [finalResult, setFinalResult] = useState<FinalResult>('special_admit');
  const [remark, setRemark] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState({ visible: false, success: true, msg: '' });

  const userId = role?.userId || '';

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    try {
      // 待评审（评审中）+ 待终审 两类任务合并
      const [reviewing, pendingFinal] = await Promise.all([
        getMyTasks({ page: 1, pageSize: 50, status: 'reviewing' }),
        getMyTasks({ page: 1, pageSize: 50, status: 'pending_final' }),
      ]);
      const pick = (res: any): MrbTask[] =>
        ((res?.data || res) as PaginatedResponse<MrbTask>)?.items || [];
      const merged = [...pick(reviewing), ...pick(pendingFinal)];
      merged.sort((a, b) => (a.createdAt && b.createdAt ? b.createdAt.localeCompare(a.createdAt) : 0));
      setList(merged);
    } catch (e: any) {
      const msg = errMsg(e, t('pda.mrb.loadFailed'));
      speakError(msg);
      setResult({ visible: true, success: false, msg });
    }
  };

  const open = async (task: MrbTask) => {
    try {
      const res: any = await getMrbDetail(task.id);
      const detail: MrbReview = res?.data || res;
      setCurrent(detail);
      // 从评审员列表中定位"我的"评审记录
      const mine = (detail.reviewers || []).find(
        (rv) => rv.reviewerId === userId || (rv.reviewerName && rv.reviewerName === role?.userName),
      );
      setMyReview(mine);
      setReviewResult((mine?.reviewResult as ReviewResult) || 'special_admit');
      setReviewOpinion(mine?.reviewOpinion || '');
      setFinalResult('special_admit');
      setRemark('');
    } catch (e: any) {
      const msg = errMsg(e, t('pda.mrb.detailFailed'));
      speakError(msg);
      setResult({ visible: true, success: false, msg });
    }
  };

  const submitReviewOpinion = async () => {
    if (!current) return;
    if (!reviewOpinion.trim()) {
      speakError(t('pda.mrb.opinionRequired'));
      setResult({ visible: true, success: false, msg: t('pda.mrb.opinionRequired') });
      return;
    }
    setSubmitting(true);
    try {
      // 评审人由服务端按登录身份判定，PDA 不再传 reviewerId
      await submitReview({
        mrbId: current.id,
        reviewOpinion: reviewOpinion.trim(),
        reviewResult,
      });
      setResult({ visible: true, success: true, msg: t('pda.mrb.submitReviewSuccess') });
      setCurrent(null);
      setMyReview(undefined);
      load();
    } catch (e: any) {
      const msg = errMsg(e, t('pda.mrb.failed'));
      speakError(msg);
      setResult({ visible: true, success: false, msg });
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * PDA 终审：走 `dispositions` 单行、全量处置。
   * 服务端要求 Σ处置数量 == 本单数量，单行全量天然满足；
   * 「混合处置」「其他处置」需多条明细/二级字段，一律引导到 PC 端。
   */
  const submitFinal = async () => {
    if (!current) return;
    setSubmitting(true);
    try {
      await finalApprove({
        mrbId: current.id,
        finalRemark: remark || undefined,
        dispositions: [
          {
            dispositionType: finalResult,
            quantity: Number(current.quantity) || 0,
          },
        ],
      });
      setResult({ visible: true, success: true, msg: t('pda.mrb.success') });
      setCurrent(null);
      setMyReview(undefined);
      load();
    } catch (e: any) {
      const msg = errMsg(e, t('pda.mrb.failed'));
      speakError(msg);
      setResult({ visible: true, success: false, msg });
    } finally {
      setSubmitting(false);
    }
  };

  const statusText = (s: string) =>
    ({
      draft: t('mrb.status_draft'),
      pending_review: t('mrb.status_pending_review'),
      reviewing: t('mrb.status_reviewing'),
      pending_approval: t('mrb.status_pending_approval'),
      pending_final: t('mrb.status_pending_final'),
      pending_execute: t('mrb.status_pending_execute'),
      approved: t('mrb.status_approved'),
      rejected: t('mrb.status_rejected'),
      cancelled: t('mrb.status_cancelled'),
      closed: t('mrb.status_closed'),
    } as Record<string, string>)[s] || s;

  const reviewResultText = (r?: string) =>
    !r
      ? t('pda.mrb.pendingMyReview')
      : ((({
          special_admit: t('pda.mrb.specialAdmit'),
          return: t('pda.mrb.return'),
          rework: t('pda.mrb.rework'),
          scrap: t('pda.mrb.scrap'),
          // 兼容历史数据里的旧三项
          accept: t('pda.mrb.specialAdmit'),
          reject: t('pda.mrb.return'),
          deviation: t('pda.mrb.rework'),
        } as Record<string, string>)[r]) || r);

  if (current) {
    const isReviewing = current.status === 'reviewing';
    const canReview = isReviewing && !!myReview;
    const alreadySubmitted = !!myReview?.reviewResult;
    const isFinalStage = current.status === 'pending_final';
    /** 预审人 == 终审人：必须填代审说明，PDA 无该输入位，只能去 PC 端 */
    const needSeparation = !!current.isSingleApprover;
    const reviewOptions: { v: ReviewResult; label: string }[] = [
      { v: 'special_admit', label: t('pda.mrb.specialAdmit') },
      { v: 'return', label: t('pda.mrb.return') },
      { v: 'rework', label: t('pda.mrb.rework') },
      { v: 'scrap', label: t('pda.mrb.scrap') },
    ];
    const finalOptions: { v: FinalResult; label: string }[] = [
      { v: 'special_admit', label: t('pda.mrb.specialAdmit') },
      { v: 'return', label: t('pda.mrb.return') },
      { v: 'rework', label: t('pda.mrb.rework') },
      { v: 'scrap', label: t('pda.mrb.scrap') },
    ];
    return (
      <PdaLayout title={`${t('pda.menu.mrb')} - ${current.mrbNo}`}>
        <PdaCard>
          <div className="pda-desc-grid">
            <span>{t('pda.mrb.mrbNo')}</span><b>{current.mrbNo}</b>
            <span>{t('common.status')}</span><b><StatusBadge status={current.status} /> {statusText(current.status)}</b>
            <span>{t('pda.mrb.material')}</span><b>{current.materialCode} {current.materialName}</b>
            <span>{t('pda.mrb.batch')}</span><b>{current.batchNo || '-'}</b>
            <span>{t('pda.mrb.qty')}</span><b>{current.quantity} {current.unit}</b>
            <span>{t('pda.mrb.reason')}</span><b>{current.failReason || '-'}</b>
            <span>{t('pda.mrb.stuck')}</span>
            <b>
              {fmtStuck(current.stuckHours, t('mrb.stuckHourUnit'), t('mrb.stuckDayUnit'))}
              {current.isUrgent ? ` · ${t('pda.mrb.urgent')}` : ''}
            </b>
          </div>
        </PdaCard>

        {current.isUrgent && current.urgentReason && (
          <PdaCard>
            <div className="pda-list-sub">{t('mrb.urgent')}：{current.urgentReason}</div>
          </PdaCard>
        )}

        {current.status === 'pending_review' && (
          <PdaCard>
            <div className="pda-empty">{t('pda.mrb.pendingAssign')}</div>
          </PdaCard>
        )}

        <PdaCard title={t('pda.mrb.reviewSection')}>
          {(current.reviewers || []).map((rv) => (
            <div key={rv.id} className="pda-list-item">
              <div className="pda-list-main">
                <div className="pda-list-title">
                  {rv.reviewerName || rv.reviewerId}
                  {rv.reviewerId === userId ? ` (${t('pda.mrb.me')})` : ''}
                </div>
                <div className="pda-list-sub">{rv.reviewOpinion || '-'}</div>
              </div>
              <div className="pda-list-side">
                <span>{reviewResultText(rv.reviewResult)}</span>
              </div>
            </div>
          ))}
          {(current.reviewers || []).length === 0 && (
            <div className="pda-empty">{t('pda.mrb.pendingAssign')}</div>
          )}
        </PdaCard>

        {canReview && (
          <PdaCard title={alreadySubmitted ? t('pda.mrb.modifyOpinion') : t('pda.mrb.submitReviewOpinion')}>
            <div className="pda-list-sub" style={{ marginBottom: 8 }}>
              {t('pda.mrb.myReviewStatus')}：{reviewResultText(alreadySubmitted ? myReview?.reviewResult : undefined)}
            </div>
            <div className="pda-chip-group">
              {reviewOptions.map((o) => (
                <button
                  key={o.v}
                  type="button"
                  className={`pda-chip ${reviewResult === o.v ? 'active' : ''}`}
                  onClick={() => setReviewResult(o.v)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <textarea
              className="pda-input"
              rows={3}
              placeholder={t('pda.mrb.opinionPh')}
              value={reviewOpinion}
              onChange={(e) => setReviewOpinion(e.target.value)}
            />
            <div style={{ height: 12 }} />
            <PdaButton fullWidth variant="success" disabled={submitting} onClick={submitReviewOpinion}>
              {submitting ? t('pda.submitting') : t('pda.mrb.submitReviewOpinion')}
            </PdaButton>
          </PdaCard>
        )}

        {isReviewing && !myReview && (
          <PdaCard>
            <div className="pda-empty">{t('pda.mrb.notReviewer')}</div>
          </PdaCard>
        )}

        {isFinalStage && needSeparation && (
          <PdaCard>
            <div className="pda-empty" style={{ color: '#b91c1c' }}>{t('pda.mrb.pcOnlyFinal')}</div>
          </PdaCard>
        )}

        {isFinalStage && !needSeparation && (
          <PdaCard title={t('pda.mrb.finalDecision')}>
            <div className="pda-chip-group">
              {finalOptions.map((o) => (
                <button
                  key={o.v}
                  type="button"
                  className={`pda-chip ${finalResult === o.v ? 'active' : ''}`}
                  onClick={() => setFinalResult(o.v)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <div className="pda-list-sub" style={{ marginTop: 8 }}>{t('pda.mrb.otherOnPc')}</div>
            <textarea
              className="pda-input"
              rows={3}
              placeholder={t('pda.mrb.remarkPh')}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
            />
            <div style={{ height: 12 }} />
            <PdaButton fullWidth variant="success" disabled={submitting} onClick={submitFinal}>
              {submitting ? t('pda.submitting') : t('pda.mrb.submit')}
            </PdaButton>
          </PdaCard>
        )}

        <ResultOverlay visible={result.visible} success={result.success} message={result.msg} onClose={() => setResult((r) => ({ ...r, visible: false }))} />
      </PdaLayout>
    );
  }

  return (
    <PdaLayout title={t('pda.menu.mrb')}>
      <PdaCard title={`${t('pda.menu.mrb')} (${list.length})`}>
        {list.length === 0 ? (
          <div className="pda-empty">{t('pda.mrb.empty')}</div>
        ) : (
          <div className="pda-list">
            {list.map((m) => (
              <div key={`${m.id}-${m.myReview?.id || 'x'}`} className="pda-list-item" onClick={() => open(m)}>
                <div className="pda-list-main">
                  <div className="pda-list-title">
                    {m.isUrgent && (
                      <span style={{ color: '#dc2626', fontWeight: 700, marginRight: 6 }}>
                        [{t('pda.mrb.urgent')}]
                      </span>
                    )}
                    {m.mrbNo}
                  </div>
                  <div className="pda-list-sub">{m.materialCode} {m.materialName}</div>
                  <div className="pda-list-sub">{m.batchNo || ''} · {m.failReason || '-'}</div>
                </div>
                <div className="pda-list-side">
                  <b>{m.quantity} {m.unit}</b>
                  <StatusBadge status={m.status} />
                  <span className="pda-list-sub">{m.status === 'reviewing' ? reviewResultText(m.myReview?.reviewResult) : statusText(m.status)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </PdaCard>
      <ResultOverlay visible={result.visible} success={result.success} message={result.msg} onClose={() => setResult((r) => ({ ...r, visible: false }))} />
    </PdaLayout>
  );
};

export default PdaMrb;
