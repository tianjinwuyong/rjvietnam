import React from 'react';
import { translate } from '../../../i18n';

interface StatusBadgeProps {
  status: string;
  text?: string;
}

/** 状态值 → 中文显示文本映射 */
const STATUS_TEXT_MAP: Record<string, string> = {
  // 收货单状态
  pending: 'ui.待收货',
  received: 'ui.已收货',
  pending_iqc: 'ui.待检',
  iqc_pass: 'ui.检验合格',
  good: 'ui.合格',
  rejected: 'ui.不合格',
  cancelled: 'ui.已取消',
  // IQC批次状态
  inspecting: 'ui.检验中',
  review_pending: 'ui.待审核',
  approved: 'ui.已批准',
  pass: 'Pass',
  fail: 'Fail',
  // 领料单状态
  draft: 'ui.草稿',
  submitted: 'ui.已提交',
  approved_wo: 'ui.已审批',
  picking: 'ui.拣货中',
  picked: 'ui.已拣货',
  issued: 'ui.已发料',
  partial_issued: 'ui.部分发料',
  closed: 'ui.已关闭',
  // 库存状态
  normal: 'ui.正常',
  locked: 'ui.已锁定',
  frozen: 'ui.已冻结',
  // MRB状态
  mrb_pending: 'ui.待评审',
  mrb_reviewing: 'ui.评审中',
  mrb_closed: 'ui.已结案',
  // 通用
  success: 'ui.成功',
  warning: 'ui.警告',
  error: 'ui.错误',
  active: 'ui.启用',
  inactive: 'ui.停用',
  complete: 'ui.已完成',
  waiting: 'ui.等待中',
  partial: 'ui.部分',
  expired: 'ui.已过期',
  scrap: 'ui.报废',
  rework: 'ui.返工',
  return: 'ui.退货',
  special_admit: 'ui.特采',
  // 方向
  in: 'ui.入库',
  out: 'ui.出库',
  supplement: 'ui.补料',
};

/**
 * 状态标签：根据 status 显示不同颜色和中文文本。
 */
const StatusBadge: React.FC<StatusBadgeProps> = ({ status, text }) => {
  const s = (status || '').toLowerCase();
  let cls = 'pda-badge-default';

  if (
    s.includes('pass') ||
    s.includes('approve') ||
    s.includes('picked') ||
    s.includes('done') ||
    s === 'good' ||
    s === 'success' ||
    s === 'complete' ||
    s === 'closed' ||
    s === 'issued' ||
    s === 'normal' ||
    s === 'active'
  ) {
    cls = 'pda-badge-success';
  } else if (
    s.includes('pending') ||
    s.includes('wait') ||
    s.includes('warning') ||
    s.includes('partial') ||
    s.includes('inspect') ||
    s.includes('review') ||
    s.includes('submitted') ||
    s.includes('mrb')
  ) {
    cls = 'pda-badge-warning';
  } else if (
    s.includes('fail') ||
    s.includes('reject') ||
    s.includes('scrap') ||
    s.includes('expired') ||
    s.includes('lock') ||
    s.includes('return') ||
    s.includes('rework') ||
    s.includes('error') ||
    s.includes('inactive') ||
    s.includes('frozen') ||
    s.includes('cancelled')
  ) {
    cls = 'pda-badge-danger';
  }

  const displayText = text || (STATUS_TEXT_MAP[s] ? translate(STATUS_TEXT_MAP[s]) : '') || status || '-';

  return <span className={`pda-badge ${cls}`}>{displayText}</span>;
};

export default StatusBadge;
