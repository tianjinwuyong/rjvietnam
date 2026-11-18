# BOM 审核报告 — rjvn 导入的 3 个 draft BOM（2026-11-18）

## 结论

**不建议把这 3 个 draft BOM 转为 active，也不建议覆盖原有 active BOM。** 原因不是数据质量，而是两套 BOM 使用**完全不同的物料编码体系**，共享物料编码为 0。转 active 前必须先由业务确定编码映射策略。

## 对比数据

| 产品 | 原有 active | 行数 | rjvn 导入 draft | 行数 | 共享物料编码 | 新增编码 |
|---|---|---|---|---|---|---|
| `EPS18R1G` | V1.5 | 76 | V2.0（`rjvn:EPS18R1G-36`） | 67 | 0 | 66 |
| `EPS48R1-36` | V1.8 | 95 | V2.6（`rjvn:EPS48R1-36`） | 187 | 0 | 187 |
| `NBC56B120460VU AF39a` | —（无） | — | V1.3（`rjvn:EPS6 V2`） | 207 | — | 207（新产品） |

源表 `public.rjvn_bom` 中 3 个 BOM 的 status 均为 `active`，导入到正式表时以 `draft` 落地：
`boms` 上有 partial unique index `uq_boms_one_active_per_product`（仅 `status='active'` 生效），
新版本不能与原有 active 版本并存，因此**刻意降级为 draft**，原 active BOM 完全未改动。

## 根因：编码体系不同（0 交集）

```
legacy active : R0304-01003 / R0307-01002 / C-0805-100NF / R-0603-10K-1
rjvn    draft : 0.14.06.02.1071 / 0.14.01.01.0239 / 0.14.02.01.0246
```

- rjvn BOM 明细 461 行中，`rjvn_bom_item.material_id` **全部为 NULL**，只能按 `material_code` 关联。
- 其中 252 个编码在 `rjvn_material` 主数据中存在，209 个不存在 → 导入时补建了 **202 条** `materials`（1 组重复编码）。
- 这 202 条补建物料全部使用 rjvn 编码，与现有物料主数据无交集，所以 3 个 draft BOM 与 legacy BOM 的物料编码交集为 0。
- 换句话说：这不是"同一产品的 BOM 版本升级"，而是**两套物料主数据 + 两套 BOM** 并存。

## 已做 / 未做

**已做**
- `scripts/etl/rjvn-bom-import.sql`：原子事务、幂等；+1 产品、+202 物料、+3 BOM（draft）、+461 `bom_lines`
- 映射：`rjvn_external_id_map` 写入 `entity=bom` 3 条、`entity=bom_item` 461 条
- 状态：导入后 `products` 7→8、`materials` 2749→2951、`boms` 3→6、`bom_lines` 282→743
- 原有 active BOM（V0.5 / V1.5 / V1.8）及其明细**一字未动**

**未做**
- 未把任何 draft BOM 转为 active
- 未做物料编码映射/别名
- 未删除或替换原有 BOM

## 需要业务确认（三选一）

1. **建立编码映射表**（推荐先做）：把 rjvn 编码映射到现有物料编码，再做逐行差异评审；确认无重复实体后择优转 active。
2. **以 rjvn 编码为新主线**：确认 202 条补建物料是有效的独立物料（而非现有物料的重复编码），然后把旧 BOM 置 `obsolete`、新 BOM 转 active。影响面大，需业务签字。
3. **仅作参考保留**：3 个 draft BOM 只用于查询/对照，不进入生产。这是当前默认状态。

## 决策后如何转 active（不要跳过上面的确认）

```sql
-- 单个 BOM：先核对差异，再原子切换（partial index 保证同产品只有一个 active）
BEGIN;
UPDATE public.boms SET status='obsolete' WHERE product_id = :pid AND status='active';
UPDATE public.boms SET status='active'  WHERE id = :draft_bom_id AND status='draft';
COMMIT;
```

切换后必须重跑 `npm run typecheck`、`npm run test`，并在 WMS → 正式表数据 → `boms` 页签核对行数与状态。

## 回滚

```sql
BEGIN;
DELETE FROM public.bom_lines
 WHERE bom_id IN (SELECT canonical_id FROM public.rjvn_external_id_map WHERE entity='bom');
DELETE FROM public.boms
 WHERE id IN (SELECT canonical_id FROM public.rjvn_external_id_map WHERE entity='bom');
DELETE FROM public.rjvn_external_id_map WHERE entity IN ('bom','bom_item');
-- 补建的 202 条物料 / 1 个产品需按 code + 人工确认后删除，避免误删真实主数据
COMMIT;
```
