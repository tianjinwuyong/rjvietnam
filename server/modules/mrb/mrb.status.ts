/**
 * MRB 状态机 / SLA / 占用量 SQL —— 单一来源。
 *
 * 为什么单独成文件（设计文档 §7 共享知识 1/2/6）：
 *  1. 状态字符串一旦散落在 service / controller 里，新增状态时必然漏改（历史教训：
 *     `reviewCount` 把 rejected/cancelled 也算进「评审次数」，就是字面量数组散落的结果）。
 *  2. `status_since` 是巡检 SLA 的**唯一**时钟基准（`_updated_at` 有数据库触发器，
 *     改个备注也会刷新，会掩盖真实滞留）。
 *  3. 可评审量有三处 SQL（待发起列表 / 发起时上限 M / 终审候选池），不同源是本模块
 *     第一大 bug 源：「其他」处置占用库存后三处若有一处没排除，就会出现
 *     「已留样的量被反复算成可评审量」或「剩余量永久消失」。
 *
 * ⚠️ 本文件只做「常量 + SQL 片段」，不做任何 IO，可被 service / controller / 脚本共用。
 */
import { sql, type SQL } from 'drizzle-orm';

import { mrbReview } from '@server/database/schema';

/** MRB 的 10 个状态（帮助文档口径，不新增第 11 个） */
export const MRB_STATUSES = [
  'draft',
  'pending_review',
  'reviewing',
  'pending_approval',
  'pending_final',
  'pending_execute',
  'approved',
  'closed',
  'rejected',
  'cancelled',
] as const;

export type MrbStatus = (typeof MRB_STATUSES)[number];

/** 终态（已归档）：不计入「进行中」，不阻塞同批次再次发起，SLA 不再计算 */
export const MRB_DONE_STATUSES = ['closed', 'approved', 'rejected', 'cancelled'] as const;

export type MrbDoneStatus = (typeof MRB_DONE_STATUSES)[number];

/** 进行中状态（= 全部状态 - 终态） */
export const MRB_ACTIVE_STATUSES = MRB_STATUSES.filter(
  (s): s is MrbStatus => !(MRB_DONE_STATUSES as readonly string[]).includes(s),
);

/**
 * 「阻塞同批次再次发起」的状态（= 进行中 - `pending_execute`）。
 *
 * 为什么 `pending_execute` 不阻塞：
 *  该状态下的处置数量**已经从可评审池迁出**（报废已核销、「其他」已搬到本单专属保留库位、
 *  退货/返工已转库存），`reviewableDefectiveCond` 也把它们排除在外，此时剩余不良品的
 *  可评审量是精确的，再发起不会双花。
 *  反之若阻塞：一张单的「退回客户」需要等客户实际提货（可能数周），期间整条批次被堵死，
 *  剩下的不良品无法继续评审/处置 —— 这是实打实的业务痛点。
 *  真正需要阻塞的是「还没分配数量」的前五个状态（此时同一批货可能被两张单各算一遍）。
 */
export const MRB_INFLIGHT_BLOCKING_STATUSES: MrbStatus[] = [
  'draft',
  'pending_review',
  'reviewing',
  'pending_approval',
  'pending_final',
];

/** 状态中文名（错误文案「当前状态（{中文状态}）不可执行该操作」直接取这里） */
export const MRB_STATUS_LABELS: Record<MrbStatus, string> = {
  draft: '草稿',
  pending_review: '待制定方案',
  reviewing: '评审中',
  pending_approval: '待IQC主管审核',
  pending_final: '待质量经理审批',
  pending_execute: '待执行',
  approved: '已批准',
  closed: '已结案',
  // 注意：rejected 是终审「否决并全批退货」的终态，不是「驳回退回修改」。
  // 后者会回到 pending_review，单据不会停在 rejected。
  rejected: '已否决（全批退货）',
  cancelled: '已作废',
};

/**
 * 迁移前置表：`from` 状态下允许迁到哪些 `to`。
 * 与设计文档 §1.3 的状态迁移表逐条对应；`transition()` 只做「表内是否允许」的前置校验，
 * 具体的业务前置（比如「终审必须守恒」）仍在各业务方法里判。
 */
export const MRB_TRANSITIONS: Record<MrbStatus, MrbStatus[]> = {
  draft: ['pending_review', 'reviewing', 'pending_approval', 'pending_final', 'cancelled'],
  pending_review: ['reviewing', 'cancelled'],
  // reviewing → pending_review：SQE「撤回方案」，方案与评审员保留、已投意见清空，改完重新提交
  reviewing: ['reviewing', 'pending_approval', 'pending_final', 'pending_review', 'cancelled'],
  // pending_approval → pending_review：IQC 主管预审驳回，退回 SQE 改方案（v3.1 起不再回 draft）
  pending_approval: ['pending_final', 'pending_review'],
  // pending_final → pending_review：质量经理驳回，退回 SQE 改方案；与「否决并全批退货(rerejected)」不同
  pending_final: ['approved', 'pending_execute', 'rejected', 'pending_review'],
  pending_execute: ['closed'],
  approved: [],
  closed: [],
  rejected: [],
  cancelled: [],
};

/** 允许作废的状态：draft / pending_review / reviewing */
export const MRB_CANCELLABLE_STATUSES: MrbStatus[] = ['draft', 'pending_review', 'reviewing'];

/** 「其他」处置的三类去向（本期不做特批流程） */
export const MRB_OTHER_TYPES = ['customer_return', 'sample', 'hold'] as const;

export type MrbOtherType = (typeof MRB_OTHER_TYPES)[number];

export const MRB_OTHER_TYPE_LABELS: Record<MrbOtherType, string> = {
  customer_return: '退回客户',
  sample: '转留样/样品',
  hold: '待定暂存',
};

/**
 * 占用前缀（唯一规范）：`MRB-OTHER:<mrbNo>`（设计 v2.1 §7-5）
 *
 * ⚠️ **不带去向**：一张 MRB 一个保留库位，同 MRB 内多条 other 明细合并成同一行承载，
 *    该行可能同时承载「退回客户 / 留样 / 暂存」，`lock_reason` 无法也不应承载去向。
 *    去向 / 关联单号 / 复核日期 / 数量**只认 `mrb_disposition`**，不要从 lock_reason 反解。
 *    核销按 `mrb_disposition.quantity` 逐条扣减，禁止整行归零/删除。
 *
 * 判断一律用前缀，不要逐个子类型枚举：`LIKE 'MRB-OTHER:%'` / `NOT LIKE 'MRB-OTHER:%'`。
 */
export const MRB_OTHER_LOCK_PREFIX = 'MRB-OTHER:';

/**
 * MRB 执行期占用的统一前缀族：`MRB-<KIND>:<mrbNo>`。
 *
 * 为什么退货 / 报废也要打前缀（v3 新增）：
 *  v3 起「退货」「报废」都**不搬库、不核销**，只把原行改成 `defective + locked`
 *  （等仓库按调拨任务搬走）。而 `reviewableDefectiveCond` 认的是
 *  `stock_status='defective' AND quantity>0`，**不看 locked**（IQC 判不合格的行也是
 *  defective+locked，不能靠 locked 区分）。若不给退货 / 报废行打前缀，
 *  已判退货的 100 件会在下一张 MRB 里被再次算成可评审量 —— 同一批货评审两次。
 *
 * 因此：凡是「已被某张 MRB 判走、等下游执行」的库存行，`lock_reason` 一律以 `MRB-` 开头，
 * 可评审量 / 良品待隔离量两个条件统一排除 `MRB-%`。
 */
export const MRB_LOCK_PREFIX = 'MRB-';
/** `MRB-%` 的 LIKE 模式：排除一切 MRB 执行期占用行 */
export const MRB_LOCK_LIKE_PATTERN = `${MRB_LOCK_PREFIX}%`;

/** 退货占用标记前缀：`MRB-RETURN:<returnNo>`（带退货单号，退货出库按它定位库存） */
export const MRB_RETURN_LOCK_PREFIX = 'MRB-RETURN:';
/** 报废占用标记前缀：`MRB-SCRAP:<mrbNo>`（已冻结待销毁） */
export const MRB_SCRAP_LOCK_PREFIX = 'MRB-SCRAP:';

/** MRB 处置保留库位编码标记：`<不良品仓库编码>-MRB-RSV-<mrbNo>`（一张 MRB 一个） */
export const MRB_RESERVE_LOCATION_MARK = '-MRB-RSV-';

/** 构造占用量 lock_reason（只带 MRB 单号，不带去向） */
export function buildOtherLockReason(mrbNo: string): string {
  return `${MRB_OTHER_LOCK_PREFIX}${mrbNo}`;
}

/** 构造退货占用标记：`MRB-RETURN:<returnNo>` */
export function buildReturnLockReason(returnNo: string): string {
  return `${MRB_RETURN_LOCK_PREFIX}${returnNo}`;
}

/** 构造报废冻结标记：`MRB-SCRAP:<mrbNo>`（调拨到不良品仓前、销毁前都靠它定位） */
export function buildScrapLockReason(mrbNo: string): string {
  return `${MRB_SCRAP_LOCK_PREFIX}${mrbNo}`;
}

/** 构造保留库位编码：`<不良品仓库编码>-MRB-RSV-<mrbNo>` */
export function buildReserveLocationCode(whCode: string, mrbNo: string): string {
  return `${whCode}${MRB_RESERVE_LOCATION_MARK}${mrbNo}`;
}

/** 该 lock_reason 是否是「其他」处置占用 */
export function isOtherLockReason(lockReason?: string | null): boolean {
  return !!lockReason && lockReason.startsWith(MRB_OTHER_LOCK_PREFIX);
}

/** `MRB-OTHER:%` 的 LIKE 模式（供 SQL 直接用） */
export const MRB_OTHER_LIKE_PATTERN = `${MRB_OTHER_LOCK_PREFIX}%`;

/** SLA 等级 */
export type MrbSlaLevel = 'ok' | 'warn' | 'overdue';

/**
 * SLA 阈值表（小时）。设计文档 §7 共享知识 11：
 * 表格「升级线」= warn；overdue 统一 168（急件 72）。
 * `null` = 该状态对急件没有单独阈值（如 pending_approval 急件直接跳过本环节）。
 */
export interface MrbSlaThreshold {
  warn: number;
  warnUrgent: number;
  overdue: number;
  overdueUrgent: number;
}

export const MRB_SLA_THRESHOLDS: Record<MrbStatus, MrbSlaThreshold | null> = {
  draft: { warn: 48, warnUrgent: 8, overdue: 168, overdueUrgent: 72 },
  pending_review: { warn: 72, warnUrgent: 24, overdue: 168, overdueUrgent: 72 },
  reviewing: { warn: 72, warnUrgent: 24, overdue: 168, overdueUrgent: 72 },
  // 待预审：急件跳过本环节，故急件与常规同阈值（不至于让急件单在这一步误报红）
  pending_approval: { warn: 72, warnUrgent: 72, overdue: 168, overdueUrgent: 168 },
  pending_final: { warn: 72, warnUrgent: 24, overdue: 168, overdueUrgent: 72 },
  pending_execute: { warn: 72, warnUrgent: 24, overdue: 168, overdueUrgent: 72 },
  // 终态不计算 SLA
  approved: null,
  closed: null,
  rejected: null,
  cancelled: null,
};

/**
 * 计算某张单的「停留时长 + SLA 等级」。
 * @param status      当前状态
 * @param statusSince 进入当前状态的时间
 * @param isUrgent    是否急件
 * @param now         基准时刻（便于单测注入）
 */
export function computeMrbSla(
  status: string,
  statusSince: Date | string | null | undefined,
  isUrgent: boolean,
  now: Date = new Date(),
): { stuckHours: number | null; slaLevel: MrbSlaLevel } {
  const threshold = MRB_SLA_THRESHOLDS[status as MrbStatus];
  if (!threshold || (MRB_DONE_STATUSES as readonly string[]).includes(status)) {
    return { stuckHours: null, slaLevel: 'ok' };
  }
  if (!statusSince) return { stuckHours: null, slaLevel: 'ok' };

  const since = statusSince instanceof Date ? statusSince : new Date(statusSince);
  const ms = now.getTime() - since.getTime();
  if (!Number.isFinite(ms)) return { stuckHours: null, slaLevel: 'ok' };

  // 保留 1 位小数，避免 79.9999h 这类展示噪声
  const stuckHours = Math.max(0, Math.round((ms / 3600000) * 10) / 10);
  const warn = isUrgent ? threshold.warnUrgent : threshold.warn;
  const overdue = isUrgent ? threshold.overdueUrgent : threshold.overdue;

  if (stuckHours > overdue) return { stuckHours, slaLevel: 'overdue' };
  if (stuckHours > warn) return { stuckHours, slaLevel: 'warn' };
  return { stuckHours, slaLevel: 'ok' };
}

/** 标识符白名单：只允许普通小写别名，防止 SQL 注入（别名全部来自本仓常量） */
function safeAlias(alias: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error(`非法的 SQL 别名：${alias}`);
  }
  return alias;
}

/**
 * 可评审的不良品条件（三处同源的唯一实现）。
 *
 * `stock_status = 'defective' AND quantity > 0 AND lock_reason 不以 MRB- 开头`
 *
 * 「其他」三类处置不改变 stock_status，而是把数量搬到独立保留库位并打 MRB-OTHER 前缀；
 * 「退货」「报废」则原地冻结并打 MRB-RETURN / MRB-SCRAP 前缀。
 * 因此这一条件同时做到三件事：
 *   1. 已留样 / 暂存 / 退回客户 / 已判退货 / 已判报废的量不再被算成可评审量（否则会被反复发起）；
 *   2. 同一批次尚未被任何 MRB 判走的剩余量仍然留在原不良品行，继续可评审；
 *   3. IQC 判不合格留下的 `IQC不合格待MRB(...)` 行仍算可评审（前缀不是 MRB-）。
 *
 * ⚠️ 已知取舍：退货 / 报废是「原地冻结」，标记打在**原库存行**上。
 *    `inventory` 的唯一键是 (物料, 库位, 批次, 状态)，所以「已判走的 100」与
 *    「同批次剩下没判的 50」若在同一库位，只能共用一个 lock_reason（后写覆盖前者）。
 *    此时那 50 也会被这条前缀挡在可评审量之外 —— 宁可少算（安全），不能多算（重复评审）。
 *    正常情况不会出现：方案要求 Σ处置数量 == 本次评审数量，整行都会被判走。
 *
 * @param alias inventory 表在调用处使用的别名（默认 `inv`）
 */
export function reviewableDefectiveCond(alias = 'inv'): SQL {
  const a = sql.raw(safeAlias(alias));
  return sql`${a}.stock_status = 'defective'
    AND ${a}.quantity > 0
    AND (${a}.lock_reason IS NULL OR ${a}.lock_reason NOT LIKE ${MRB_LOCK_LIKE_PATTERN})`;
}

/**
 * 「良品仓待隔离」条件（IQC 判 fail 后尚未调拨到不良品仓，仅首次发起时计入 M）。
 *
 * 同样排除 `MRB-%` 占用：若「其他」处置的分配来源是良品仓锁定行，
 * 搬进保留库位的数量仍是 `good + locked`，不排除就会被下一次发起重复算成可评审量（双花）。
 *
 * @param alias inventory 表别名
 */
export function lockedGoodCond(alias = 'inv'): SQL {
  const a = sql.raw(safeAlias(alias));
  return sql`${a}.stock_status = 'good'
    AND ${a}.locked = true
    AND ${a}.quantity > 0
    AND (${a}.lock_reason IS NULL OR ${a}.lock_reason NOT LIKE ${MRB_LOCK_LIKE_PATTERN})`;
}

/** 终审候选池条件：不良品仓可评审行 + 良品仓锁定行（同样排除 MRB-OTHER 占用） */
export function disposalCandidateCond(alias = 'inv'): SQL {
  return sql`((${reviewableDefectiveCond(alias)}) OR (${lockedGoodCond(alias)}))`;
}

// ---------------------------------------------------------------------------
// 巡检 SQL 片段（直接引用 mrb_review 列，供 list / overdue-summary 复用）
// ---------------------------------------------------------------------------

/** 停留小时数；终态返回 NULL */
export function mrbStuckHoursSql(): SQL {
  return sql`CASE
    WHEN ${mrbReview.status} IN ('approved', 'closed', 'rejected', 'cancelled') THEN NULL
    ELSE EXTRACT(EPOCH FROM (NOW() - ${mrbReview.statusSince})) / 3600.0
  END`;
}

/**
 * 由 `MRB_SLA_THRESHOLDS` **生成**阈值 CASE 表达式（唯一来源，避免 JS 与 SQL 两套数字）。
 * @param field 'warn' | 'overdue'
 * @param urgentField 'warnUrgent' | 'overdueUrgent'
 */
function thresholdCaseSql(field: 'warn' | 'overdue', urgentField: 'warnUrgent' | 'overdueUrgent'): SQL {
  const branches: SQL[] = [];
  for (const status of MRB_STATUSES) {
    const t = MRB_SLA_THRESHOLDS[status];
    if (!t) continue; // 终态不参与（返回 NULL）
    branches.push(
      sql`WHEN ${sql.raw(`'${status}'`)} THEN CASE WHEN ${mrbReview.isUrgent} THEN ${sql.raw(String(t[urgentField]))} ELSE ${sql.raw(String(t[field]))} END`,
    );
  }
  return sql`CASE ${mrbReview.status} ${sql.join(branches, sql` `)} ELSE NULL END`;
}

/** warn 阈值（小时）：按状态 + 是否急件取表 */
export function mrbWarnThresholdSql(): SQL {
  return thresholdCaseSql('warn', 'warnUrgent');
}

/** overdue 阈值（小时）：按状态 + 是否急件取表 */
export function mrbOverdueThresholdSql(): SQL {
  return thresholdCaseSql('overdue', 'overdueUrgent');
}

/** SLA 等级：'ok' | 'warn' | 'overdue'（终态恒为 ok） */
export function mrbSlaLevelSql(): SQL {
  const stuck = mrbStuckHoursSql();
  return sql`CASE
    WHEN ${stuck} IS NULL THEN 'ok'
    WHEN ${stuck} > (${mrbOverdueThresholdSql()}::numeric) THEN 'overdue'
    WHEN ${stuck} > (${mrbWarnThresholdSql()}::numeric) THEN 'warn'
    ELSE 'ok'
  END`;
}

/** 进行中条件（status NOT IN 终态） */
export function mrbActiveCond(): SQL {
  return sql`${mrbReview.status} NOT IN ('approved', 'closed', 'rejected', 'cancelled')`;
}

/**
 * 按下状态推导「当前待办」的责任人描述。
 * 只做纯文本推导，调用方提供各状态需要的补充信息（评审员 / 下游单号）。
 */
export function buildCurrentTodo(params: {
  status: string;
  sqeName?: string | null;
  pendingReviewerNames?: string[];
  downstreamNos?: string[];
}): string {
  const { status, sqeName, pendingReviewerNames, downstreamNos } = params;
  switch (status) {
    case 'draft':
      return sqeName ? `${sqeName}（待提交）` : '发起人（待提交）';
    case 'pending_review':
      return sqeName ? `${sqeName}（待制定方案）` : '发起人（待制定方案）';
    case 'reviewing': {
      const names = (pendingReviewerNames || []).filter(Boolean);
      if (names.length === 0) return '各评审员';
      if (names.length === 1) return names[0];
      return `${names[0]} 等 ${names.length} 人`;
    }
    case 'pending_approval':
      return 'IQC主管（审核方案）';
    case 'pending_final':
      return '质量经理（审批）';
    case 'pending_execute': {
      const nos = (downstreamNos || []).filter(Boolean);
      return nos.length > 0 ? `下游单 ${nos.join('、')}` : '仓管 / 采购（下游执行中）';
    }
    case 'approved':
      return '—';
    case 'closed':
      return '—';
    case 'rejected':
      return '—';
    case 'cancelled':
      return '—';
    default:
      return '—';
  }
}
