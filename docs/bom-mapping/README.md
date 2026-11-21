# BOM 物料编码映射草案（只读，未写库）

生成脚本：`scripts/etl/rjvn-bom-mapping-proposal.mjs`
结果：`docs/bom-mapping/proposal.csv`（410 个 draft BOM 物料，对应 248 个 legacy active BOM 物料）

## 方法

1. 从 `boms` + `bom_lines` 取 `status='draft'`（rjvn 导入）与 `status='active'`（原有）各自引用的物料。
2. rjvn 侧左连 `public.rjvn_material` 取完整 `specification`（`materials.name_zh` 只有简称，如"贴片电阻"）。
3. 评分取三者最大值：
   - 共享**厂商料号 / 规格 token**（≥6 位字母数字，如 `0805W8F0000T5E`）→ 0.90 + 0.03×命中数；
   - 中文+规格全文 Dice 系数；
   - 中文简称 Dice 系数。
4. 决策：`AUTO` ≥0.9 且有共享料号；`REVIEW` ≥0.55；其余 `NEW`。
5. 同一 legacy 编码被多个 rjvn 编码命中时，全部降为 `CONFLICT`（不自动采用）。

## 结果

| 决策 | 数量 | 含义 |
|---|---|---|
| `AUTO` | 101 | 共享厂商料号，可直接确认（例：`0.00.00.00.0000B-HF` → `R0210-01022`，共同料号 `0805W8F0000T5E`） |
| `REVIEW` | 251 | 仅有名称/规格相似度，需人工核对规格值（例：`0.00.00.00.0011B-HF` → `R0210-01001`，0.833） |
| `CONFLICT` | 13 | 一个 legacy 编码被多个 rjvn 编码命中，必须人工裁决 |
| `NEW` | 45 | 无对应 legacy 物料，确认后需新建或作为新增料号 |

## 重要说明

- **本草案未写入数据库**。BOM 仍是 `draft`，原有 active BOM 未改动。
- `AUTO` 只是"料号相同"的强证据，仍需确认包装/电压/精度等规格差异；同名不同规格的情况在 `REVIEW` 里很常见。
- 业务在 CSV 的 `decision` 列改为 `ACCEPT` / `REJECT` / `NEW` 并补充正确 `legacy_code` 后，才能据此生成正式映射并评审 BOM 差异。
- 之后是否把 3 个 BOM 转 `active`，仍按 `docs/BOM-REVIEW.md` 的流程单独审批。
