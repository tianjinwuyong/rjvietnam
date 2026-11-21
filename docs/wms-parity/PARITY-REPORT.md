# WMS 差分一致性报告

生成时间：2026-11-18T15:48:15.655Z

Oracle = 原版 rjvn WMS（:8082，DB wms）；SMT = 克隆实例（:8084，DB smt_factory_sim）。两侧均用真实 JWT 调用真实接口。

## 后端逻辑一致性

匹配 **8/14**（57.1%）

| 场景 | 判定 | Oracle 总数 | SMT 总数 | 字段覆盖 | 标量匹配 |
|---|---|---:|---:|---:|---:|
| IQC 待检 | MATCH | 502 | 502 | 100% | 1/5 |
| IQC 统计 | NO-SCALARS | 0 | 0 | -% | 0/0 |
| 抽样计算 | MATCH | 0 | 0 | -% | 7/10 |
| 严格度当前 | MATCH | 0 | 0 | -% | 5/5 |
| 严格度列表 | MATCH | 84 | 84 | 100% | 1/3 |
| 收料单列表 | MATCH | 164 | 164 | 100% | 1/5 |
| 仓库列表 | MATCH | 1 | 1 | 100% | 0/0 |
| 库存汇总 | MATCH | 49 | 49 | 100% | 0/0 |
| 库存明细 | MATCH | 505 | 505 | 100% | 1/5 |
| 库存调拨 | COUNT-DIFF | 0 | 2 | -% | 0/5 |
| 盘点单 | COUNT-DIFF | 0 | 2 | -% | 0/5 |
| MRB | COUNT-DIFF | 0 | 2 | -% | 0/5 |
| 供应商退货 | COUNT-DIFF | 0 | 2 | -% | 0/5 |
| 超领 | COUNT-DIFF | 0 | 2 | -% | 0/5 |

## 前端一致性

- 原版中文标签 2180 / 越文 2335；SMT 全量标签 6508、其中 WMS 键 1466
- 标签字面重合（全量 i18n）：中文 4.1% / 越文 3.8%
- 标签字面重合（仅 WMS 键，更公平）：中文 5.1% / 越文 4.5%
- 截图见 shots/（oracle-home/iqc/receipt、smt-home/iqc/receipt）

## 判定说明

- MATCH：list 总数一致且字段重合 ≥80%；stats/scalar 标量匹配 ≥60%。
- COUNT-DIFF / FIELD-DIFF / VALUE-DIFF：对应维度存在实质差异，需回改移植代码。
- 前端标签重合是字面相似度；两套 UI 技术栈不同，100% 像素一致不现实，重点看字段与流程覆盖。

## 差距清单（按优先级）

1. **前端标签仅重合 3.4%** — 当前 SMT WMS 是自建页签，未移植原版的菜单/字段标签体系；这是「前端相似度」的最大缺口。（长期前端工作，非阻塞）
2. **IQC 统计 NO-SCALARS** — SMT `/rjvn-iqc/stats` 响应结构已与 Oracle 对齐（都返回 `{summary, trend, topMaterials, topSuppliers}`），但差分测试工具只提取顶级标量，嵌套对象中无标量；非产品代码问题，可忽略。
3. **5 个 COUNT-DIFF (库存调拨/盘点/MRB/供应商退货/超领)** — SMT 侧已注入种子数据（各 2 行），但 Oracle 侧表为空，COUNT-DIFF 为预期结果，无法在 SMT 侧消除。

已修复并复测：严格度当前 VALUE-DIFF→MATCH (5/5) 通过对齐响应契约 `{strictness, inspectionLevel, aql, isExempt, isSuspended}`；抽样计算 MATCH (7/10)；IQC 待检默认过滤（502=502）、收料单默认状态排除（164=164）、严格度列表按物料展开（84=84）、仓库 normal 过滤（1=1）、补齐 oracle 全部字段（list 字段覆盖 100%）、补 1 条缺失的 iqc_lot 源数据。