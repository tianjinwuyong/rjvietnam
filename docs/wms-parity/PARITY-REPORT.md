# WMS 差分一致性报告

生成时间：2026-11-18T03:03:01.947Z

Oracle = 原版 rjvn WMS（:8082，DB wms）；SMT = 克隆实例（:8084，DB smt_factory_sim）。两侧均用真实 JWT 调用真实接口。

## 后端逻辑一致性

匹配 **1/14**（7.1%）

| 场景 | 判定 | Oracle 总数 | SMT 总数 | 字段重合 | 标量匹配 |
|---|---|---:|---:|---:|---:|
| IQC 待检 | COUNT-DIFF | 502 | 501 | 67.6% | 0/5 |
| IQC 统计 | VALUE-DIFF | 0 | 0 | -% | 0/5 |
| 抽样计算 | VALUE-DIFF | 0 | 0 | -% | 0/10 |
| 严格度当前 | NO-SCALARS | 0 | 49 | -% | 0/0 |
| 严格度列表 | COUNT-DIFF | 84 | 49 | 88.9% | 0/3 |
| 收料单列表 | FIELD-DIFF | 164 | 164 | 72% | 1/5 |
| 仓库列表 | COUNT-DIFF | 1 | 2 | 85.7% | 0/0 |
| 库存汇总 | MATCH | 49 | 49 | 83.3% | 0/0 |
| 库存明细 | FIELD-DIFF | 505 | 505 | 64% | 1/5 |
| 库存调拨 | EMPTY/NO-DATA | 0 | 0 | -% | 1/5 |
| 盘点单 | EMPTY/NO-DATA | 0 | 0 | -% | 1/5 |
| MRB | EMPTY/NO-DATA | 0 | 0 | -% | 1/5 |
| 供应商退货 | EMPTY/NO-DATA | 0 | 0 | -% | 1/5 |
| 超领 | EMPTY/NO-DATA | 0 | 0 | -% | 1/5 |

## 前端一致性

- 原版中文标签 2180 / 越文 2335；SMT 全量标签 6329
- 标签字面重合：中文 3.6% / 越文 3.4%
- 截图见 shots/（oracle-home/iqc/receipt、smt-home/iqc/receipt）

## 判定说明

- MATCH：list 总数一致且字段重合 ≥80%；stats/scalar 标量匹配 ≥60%。
- COUNT-DIFF / FIELD-DIFF / VALUE-DIFF：对应维度存在实质差异，需回改移植代码。
- 前端标签重合是字面相似度；两套 UI 技术栈不同，100% 像素一致不现实，重点看字段与流程覆盖。

## 差距清单（按优先级）

1. **前端标签仅重合 3.4%** — 当前 SMT WMS 是自建页签，未移植原版的菜单/字段标签体系；这是「前端相似度」的最大缺口。
2. **API 字段覆盖 64–89%** — 我们的 rjvn-* 端点普遍缺少 supplier_code、keeper_name、location_code 等原版字段。
3. **统计/抽样/严格度契约不同** — 原版 IQC stats 返回 summary/topMaterials/topSuppliers，我们返回 lots/passRate/byStrictness；需对齐响应结构。
4. **严格度列表 84 vs 49** — 原版把 transfer log 并入列表，我们只返回严格度主表。
5. **iqc_lot 少 1 条源数据** — 镜像表 501 vs 源库 502；其余表行数已一致。

已修复并复测：收料单默认状态过滤（164=164）、IQC 待检默认状态过滤（501，原 165）。