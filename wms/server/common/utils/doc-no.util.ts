import { sql } from 'drizzle-orm';

/**
 * 单号生成：MRB / 不良品调拨单均挂靠来源 IQC 检验单号。
 *
 * 为什么不直接把检验单号当业务单号用：
 *   - 一张检验单可以重开多张 MRB（作废 / 否决后重新发起）；
 *   - 一张 MRB 可能派生两张调拨单（退货 + 报废）；
 *   - 调拨单未来还可能分批执行。
 * 直接复用必然重号：同表撞唯一索引，跨表同号则「一单三号、谁也说不清是哪张」。
 *
 * 因此采用「母号 + 类型后缀 + 序号」：
 *   JY202610190001-MRB        第一张 MRB
 *   JY202610190001-MRB-02     同批次重新发起的第二张
 *   JY202610190001-NGDB       该 MRB 的第一张调拨单
 *   JY202610190001-NGDB-02    同 MRB 的第二张（报废行）
 *
 * 解析规则（前端/报表/AI 都用这一条）：
 *   取第一个 `-` 之前 = 来源检验单号；之后 = 单据类型；末尾两位数 = 同类型第 N 张。
 *   反解用 `extractInspectionNo()`，不要各自写正则。
 */

const DOC_TYPE_MRB = 'MRB';
const DOC_TYPE_DEFECTIVE_MOVE = 'NGDB';

/** 检验单号只保留可见字符，避免扫码/复制带进来空白导致单号裂开 */
export function normalizeInspectionNo(no?: string | null): string | null {
  const v = (no || '').replace(/\s+/g, '').trim();
  return v || null;
}

/** 组派生单号：首张不带序号，第 2 张起 -02、-03 */
export function composeDerivedNo(base: string, type: string, seq: number): string {
  const n = Math.max(1, Math.floor(seq));
  return n === 1 ? `${base}-${type}` : `${base}-${type}-${String(n).padStart(2, '0')}`;
}

/** 从任意单号反解来源检验单号（无后缀时返回自身） */
export function extractInspectionNo(no?: string | null): string | null {
  const v = (no || '').trim();
  if (!v) return null;
  // 不能按第一个 `-` 切：部分客编检验单号自身带 `-`
  const m = v.match(/^(.*?)-(?:MRB|NGDB)(?:-\d{2,})?$/i);
  return (m ? m[1] : v) || null;
}

function datePart(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * MRB 单号。
 *
 * 有检验单号 → `<检验单号>-MRB[-NN]`，序号按该批次已有 MRB 数递增；
 * 检验单号缺失（历史导入批次）→ 退回 `MRB+日期+4 位流水`，保证仍能出单。
 */
export async function nextMrbNo(
  db: any,
  params: { lotId: string; inspectionNo?: string | null },
): Promise<string> {
  const base = normalizeInspectionNo(params.inspectionNo);

  if (!base) {
    const rows = (await db.execute(sql`SELECT nextval('seq_mrb_no') AS seq`)) as unknown as Array<{
      seq: string | number;
    }>;
    const seq = Number(rows[0]?.seq ?? 1);
    return `MRB${datePart()}${seq.toString().padStart(4, '0')}`;
  }

  // 同一批次的并发发起必须串行取号：advisory lock 跟着当前事务释放
  await db.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${'MRB:' + params.lotId}, 0))`,
  );
  const counted = (await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM mrb_review WHERE lot_id = ${params.lotId}::uuid`,
  )) as unknown as Array<{ n: number | string }>;
  const used = Number(counted[0]?.n ?? 0);
  return composeDerivedNo(base, DOC_TYPE_MRB, used + 1);
}

/**
 * 不良品调拨单号。
 *
 * - MRB 派生（传了 mrbId + 检验单号）→ `<检验单号>-NGDB[-NN]`，序号按该 MRB 已生成张数递增；
 * - 手工制单（良品仓发现不良）→ `NGDB<YYYYMMDD>-<6 位全局流水>`。
 *
 * 手工单为什么仍用日期+流水：现场不良可能是没有来料检验的成品 / 半成品，
 * 没有检验单号可挂；此时用独立序列即可，不必伪造一个母号。
 */
export async function nextDefectiveMoveNo(
  db: any,
  opts?: { inspectionNo?: string | null; mrbId?: string | null },
): Promise<string> {
  const base = normalizeInspectionNo(opts?.inspectionNo);
  const mrbId = opts?.mrbId;

  if (base && mrbId) {
    await db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${'NGDB:' + mrbId}, 0))`,
    );
    const counted = (await db.execute(
      sql`SELECT COUNT(*)::int AS n FROM defective_move_task WHERE mrb_id = ${mrbId}::uuid`,
    )) as unknown as Array<{ n: number | string }>;
    const used = Number(counted[0]?.n ?? 0);
    return composeDerivedNo(base, DOC_TYPE_DEFECTIVE_MOVE, used + 1);
  }

  const raw = (await db.execute(
    sql`SELECT nextval('seq_adjust_tx_no') AS seq`,
  )) as unknown as Array<{ seq: string | number }>;
  const seq = Number(raw[0]?.seq ?? Date.now() % 1000000);
  return `NGDB${datePart()}-${seq.toString().padStart(6, '0')}`;
}
