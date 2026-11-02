# IQC 接管配合改造 —— WMS 侧补丁说明

> 提交对象：WMS 系统维护方
> 提出方：OA 项目组
> 计划生效日：**2026-11-10（周一）**
> 预计改动量：新增 1 个文件（约 25 行）+ 4 处调用（每处 1–3 行），不改任何现有业务逻辑

---

## 一、背景

2026-11-10 起，来料检验（IQC）的**检验执行与判定统一在 OA 完成**，WMS 只保留批次、库存、报表与查询。

两边并行期间必须保证：**同一批次不会在 WMS 和 OA 各检一次**。否则会出现两次放行、库存被冲减两次、报告重复。

---

## 二、现状问题（需要修的地方）

OA 认领批次时会调用 WMS 的 `POST /api/oa/iqc/claim`，WMS 会把认领人写进 `iqc_lot.oa_claimed_by` / `oa_claimed_at`（见 `server/modules/iqc/oa-iqc.service.ts` 第 203–232 行）。

但这把「锁」目前只落库、不拦截：

| 检查点 | 现状 |
|---|---|
| `server/modules/iqc/iqc.service.ts` | 全文**未引用** `oaClaimedBy`，检验提交时不校验认领人 |
| `client/src`（前端） | 全文**未引用** `oaClaimedBy`，页面不显示、不拦截 |
| `POST /api/iqc/inspect/:lotId` | 守卫只有 `@NeedLogin()`，任何登录用户都能提交 |

结论：当前 OA 认领了某批次，WMS 检验员仍可正常提交检验结果，系统不会拦。**这是本次唯一需要 WMS 侧配合改造的点。**

---

## 三、改造内容

### 3.1 新增文件 `server/modules/iqc/oa-takeover.guard.ts`

```ts
import { ConflictException } from '@nestjs/common';

/** 与 OA 侧 CLAIM_TTL_MS 保持一致：认领 4 小时后自动失效 */
export const OA_CLAIM_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * OA 接管期互斥校验：
 * 批次已被 OA 认领（且未超时）时，禁止在 WMS 侧继续检验 / 判定 / 审批。
 * 未认领的批次不受任何影响，行为与改造前完全一致。
 */
export function assertNotOaClaimed(
  lot?: { oaClaimedBy?: string | null; oaClaimedAt?: Date | string | null } | null,
): void {
  if (!lot?.oaClaimedBy || !lot?.oaClaimedAt) return;
  const at = new Date(lot.oaClaimedAt as any).getTime();
  if (!Number.isFinite(at) || Date.now() - at > OA_CLAIM_TTL_MS) return;
  throw new ConflictException(
    `该批次已由 OA 接管检验（${lot.oaClaimedBy}），请在 OA 完成；如需在 WMS 继续，请先在 OA 释放认领`,
  );
}
```

### 3.2 `submitInspection`（`iqc.service.ts` 约第 1290 行）—— **必须**

原代码（约 1301–1307 行）：

```ts
const lotForStrictness = await this.db
  .select({ id: iqcLot.id, materialId: iqcLot.materialId, batchNo: iqcLot.batchNo })
  .from(iqcLot)
  .where(eq(iqcLot.id, lotId))
  .limit(1);
if (lotForStrictness.length === 0) {
  throw new NotFoundException('检验批次不存在');
}
```

改为（多选两列 + 加一行守卫）：

```ts
const lotForStrictness = await this.db
  .select({
    id: iqcLot.id,
    materialId: iqcLot.materialId,
    batchNo: iqcLot.batchNo,
    oaClaimedBy: iqcLot.oaClaimedBy,      // ← 新增
    oaClaimedAt: iqcLot.oaClaimedAt,      // ← 新增
  })
  .from(iqcLot)
  .where(eq(iqcLot.id, lotId))
  .limit(1);
if (lotForStrictness.length === 0) {
  throw new NotFoundException('检验批次不存在');
}
assertNotOaClaimed(lotForStrictness[0]);   // ← 新增
```

文件顶部 import：

```ts
import { assertNotOaClaimed } from './oa-takeover.guard';
```

### 3.3 `judgeLot`（约第 1716 行）—— **必须**（人工判定会直接放行库存）

在 `const lot = lotResult[0];` 之后加一行：

```ts
const lot = lotResult[0];
assertNotOaClaimed(lot);   // ← 新增
if (lot.status === 'pass' || lot.status === 'fail') {
```

### 3.4 `exemptConfirmLot`（约第 1870 行）—— **必须**（免检确认同样直接放行）

同样在 `const lot = lotResult[0];` 之后加一行：

```ts
const lot = lotResult[0];
assertNotOaClaimed(lot);   // ← 新增
if (lot.status === 'pass' || lot.status === 'fail') {
```

### 3.5 `reviewReport`（约第 2218 行）—— 建议加

OA 提交的检验报告由 OA 自己的审批流审批，WMS 侧不应再审一次（会重复放行）。
在 `const lot = lotResult[0];` 之后加：

```ts
const lot = lotResult[0];
assertNotOaClaimed(lot);   // ← 新增
const finalResult = report.finalResult as 'pass' | 'fail';
```

`rejectReport`、`batchApproveReports` 按同样思路处理。

---

## 四、不需要改的部分（勿动）

| 接口 | 说明 |
|---|---|
| `POST /api/oa/iqc/claim` | OA 认领，写标记，保持原样 |
| `POST /api/oa/iqc/release` | OA 释放，清标记，保持原样 |
| `POST /api/oa/iqc/result` | OA 提交检验结果，**必须保持可用** |
| `POST /api/oa/iqc/approve` | OA 审批通过触发落账，**必须保持可用** |
| `GET /api/oa/iqc/reviewable` | MRB 可评审量，保持原样 |

> 这一组接口用 `X-Api-Key`（= WMS 的 `OA_API_KEY`）鉴权，**不经过 `iqc.service.ts`**，
> 所以上面新增的守卫不会影响 OA 自己的写入。这一点请务必确认：改造后 OA 提交检验结果、
> 审批放行必须仍然成功（见验收用例 5）。

---

## 五、验收用例

| # | 步骤 | 期望结果 |
|---|---|---|
| 1 | OA 认领批次 A（WMS 端 `oa_claimed_by` 有值）→ 在 WMS 提交批次 A 的检验 | **409**，提示「该批次已由 OA 接管检验（…），请在 OA 完成」 |
| 2 | OA 释放批次 A 认领 → 在 WMS 提交检验 | **成功**（恢复原行为） |
| 3 | 认领后等待超过 4 小时 → 在 WMS 提交检验 | **成功**（TTL 失效，与 OA 侧一致） |
| 4 | 未认领的批次 B → 在 WMS 正常检验、判定、审批 | **全部成功**，与改造前无差异 |
| 5 | OA 侧完整走一遍：认领 → 提交结果 → 审批通过 | WMS 收到报告、库存放行，**不报 409** |
| 6 | 已被 OA 认领的批次 → WMS 人工判定 / 免检确认 / 报告审批 | 均返回 **409** |

用例 3 与 4 是回归保护：确保这个守卫只在「确实被 OA 认领且未超时」时生效，不影响日常作业。

---

## 六、部署与生效

1. 修改上述文件；
2. 构建 server（`npm run build`，产物在 `dist/`）；
3. 重启 WMS 服务；
4. 按第五节用例逐条验收，第 5 条尤其不能跳过。

**前置确认**：数据库 `iqc_lot` 表需已有 `oa_claimed_by` / `oa_claimed_at` 两列
（见 WMS 仓库的 `db_migration_oa_iqc.sql`）。若 OA 认领接口目前调用能成功，
说明这两列已存在，无需额外迁移。

---

## 七、附：为什么用 4 小时

`oa_claimed_by` 的失效时间必须与 OA 侧一致。OA 的 `CLAIM_TTL_MS = 4 * 60 * 60 * 1000`
（`oa-iqc-service.js`），OA 有一个 11 分钟一轮的「认领超时回收」任务，超过 4 小时未提交会自动释放
并调 `release`。WMS 侧用同样的 4 小时，保证即使 release 调用丢失，锁也不会永久卡住批次。
