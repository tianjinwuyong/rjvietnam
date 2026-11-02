# MRB 部分特采（拆分处置）设计方案

> 场景：IQC 来料检验判 fail，但不良程度轻微；MRB 评审时可**特采接收其中一部分数量，另一部分退货**（可能还伴随报废/返工）。  
> 目标：让 MRB 终审支持"一次评审、按数量拆分多种处置"，并让库存与后续单据正确落地。  
> 状态：**方案待决策，暂未改动任何代码**。

---

## 一、现状盘点（已逐行核对代码）

### 1.1 现有链路

| 环节     | 位置                                                       | 现状                                                                                              |
| ------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 发起 MRB | `server/modules/iqc/iqc.service.ts:1612`                 | IQC 报告主管审批 `fail` 后**自动**调用 `initiateMrb()`                                                     |
| MRB 主表 | `server/database/schema.ts:404` `mrb_review`             | 单表，字段 `quantity`（待处置总量）、`final_decision`（**单个枚举**）                                              |
| 评审员    | `schema.ts:378` `mrb_reviewer`                           | 多评审员，全部提交后才进入 `pending_final`                                                                   |
| 终审执行   | `server/modules/mrb/mrb.service.ts:557` `finalApprove()` | **一次性全量处置**：`special_admit`→全量移良品仓解锁；`return`→全量置 `returned`；`rework`→全量置 `rework`；`scrap`→全量清零 |
| 状态机    | 同上                                                       | `pending_review → reviewing → pending_final → approved`（仅特采）/ `closed`（其余）                      |
| PDA 入口 | `client/src/pages/pda/PdaMrb.tsx:104`                    | 同样调用 `finalApprove`，也是单选一个结论                                                                    |

### 1.2 结构性差距（不改就做不了部分特采）

1. **`final_decision` 是单值枚举** —— 一次 MRB 只能有一个结论，物理上无法表达"60 特采 + 30 退货 + 10 报废"。
2. **执行是"整批一个动作"** —— `finalApprove()` 里对查出的所有库存记录套用同一处置，没有按数量分摊的逻辑。
3. **库存表是数量汇总记录** —— 唯一键 `(material_id, location_id, batch_no, stock_status)`（`schema.ts:734`），同批次同库位同状态只有一条记录存总量。要拆处置，**必须拆记录**。
4. **没有退货单/报废单实体** —— 全库检索无 `supplier_return` / `scrap_order`。现在的"退货"只是把库存状态改成 `returned`，**没有出库动作、没有单据、供应商拿不到凭证**。
5. **MRB 不写库存流水** —— `inventory_transaction` 只有发料/收货/工单/调整在用（`txType` 现有：`issue` `split_remain` `adjust` `production_return_in` `defective_transfer_in`）。MRB 处置**无流水可追溯**。
6. **不回收 IQC 结论** —— 特采后 `iqc_lot.status` 仍是 `fail`，收货单仍是 `iqc_fail`。批次"有条件合格"这一事实在 IQC 侧看不见。

> 第 1、2、3 条是**必须解决**的（否则功能不存在）；4、5、6 条是**要不要做闭环**的取舍，见第五节决策点。

---

## 二、方案总览

|      | 方案 A 轻量拆分               | **方案 B 拆分 + 下游单据（推荐）**            | 方案 C 完整闭环           |
| ---- | ----------------------- | --------------------------------- | ------------------- |
| 核心   | 加处置明细表，终审按明细拆库存         | A + 退货出库单 + 流水 + 批次特采标记 + IQC 回写  | B + 特采件使用管控 + 供应商绩效 |
| 退货动作 | 仅置 `returned`，仓库线下退货    | 生成退货单，仓库扫码出库后才扣减                  | 同 B                 |
| 追溯   | 有明细，无流水*                | 明细 + 库存流水 + 单据                    | 全部 + 特采件发料管控        |
| 新增实体 | 1 张表（`mrb_disposition`） | +2 张表（退货单、可选报废单）                  | +3~4 张表             |
| 改动面  | 后端 3 文件 / 前端 3 文件       | 后端 7~~9 文件 / 前端 6 文件 / 新页面 1~~2 个 | 再 +2~3 个页面          |
| 适合   | 只想先让 MRB 能拆量            | 退货要真的能出库、能对账                      | 质量体系成熟、要管控特采料       |
| 建议   | 过渡方案                    | **建议本期**                          | 后续迭代                |

\* 方案 A 也可以顺带补上流水，成本很低，建议一并做。

---

## 三、推荐方案（B）详解

### 3.1 数据模型

```sql
-- ① 处置明细（A/B/C 共有，核心）
CREATE TABLE IF NOT EXISTS mrb_disposition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mrb_id uuid NOT NULL REFERENCES mrb_review(id) ON DELETE CASCADE,
  seq integer NOT NULL DEFAULT 0,
  disposition_type varchar(20) NOT NULL,          -- special_admit|return|rework|scrap|other
  qty numeric(18,4) NOT NULL DEFAULT 0,
  unit varchar(20) NOT NULL DEFAULT 'PCS',
  from_location_id uuid,                          -- 空=按记录自动分摊
  to_warehouse_id uuid,
  to_location_id uuid,
  exec_status varchar(20) NOT NULL DEFAULT 'pending',  -- pending|done|cancelled
  exec_time timestamptz(3),
  operator_id user_profile,
  remark text,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile, _updated_by user_profile
);
CREATE INDEX IF NOT EXISTS idx_mrb_disp_mrb ON mrb_disposition(mrb_id);

-- ② mrb_review 扩展
ALTER TABLE mrb_review ADD COLUMN IF NOT EXISTS exec_status varchar(20) NOT NULL DEFAULT 'none';
-- none | pending | partial | done
ALTER TABLE mrb_review ADD COLUMN IF NOT EXISTS disposition_summary varchar(200);
-- 冗余展示用，例："特采 60 / 退货 30 / 报废 10"

-- ③ inventory 增加特采标记（B/C 需要，用于追溯"这批是特采件"）
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS disposition varchar(20);     -- special_admit
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS disposition_no varchar(50);  -- MRB 单号
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS disposition_time timestamptz(3);

-- ④ 退货出库单（B）
CREATE TABLE IF NOT EXISTS supplier_return_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_no varchar(50) NOT NULL UNIQUE,
  mrb_id uuid REFERENCES mrb_review(id),
  lot_id uuid,
  supplier_id uuid NOT NULL, supplier_code varchar(50), supplier_name varchar(200),
  material_id uuid NOT NULL, material_code varchar(100), material_name varchar(200),
  batch_no varchar(100), qty numeric(18,4) NOT NULL DEFAULT 0, unit varchar(20) DEFAULT 'PCS',
  warehouse_id uuid, location_id uuid,
  status varchar(20) NOT NULL DEFAULT 'pending',   -- pending|shipped|cancelled
  shipped_time timestamptz(3), shipped_by user_profile,
  remark text,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- 编号：新增序列 seq_supplier_return_no，格式 TH+yyyyMMdd+4位（沿用 MRB 的 nextval 写法）

-- ⑤（可选）报废单，若不建则报废只走库存状态 + 流水
```

### 3.2 状态机

```
pending_review ──选定评审员──> reviewing ──全部提交──> pending_final
                                                          │
                       ┌──────────────────────────────────┤
                       │ 终审通过（含需仓库执行的动作）      │ 终审通过（全部特采，可即时放行）
                       v                                  v
                 pending_execute ──执行完成──> closed    approved
                       │
                       └─ 终审驳回 ──> reviewing（退回重评）/ rejected
```

- `approved` 语义保持"已放行、无待执行动作"；`closed` = 全部处置执行完毕。
- 若全部为特采且即时解锁，仍可直接进 `approved`，兼容旧的列表筛选。

### 3.3 拆量算法（核心逻辑）

```
finalApprove(mrbId, dispositions[]):
  0) 校验 status === 'pending_final'（CAS 更新，防重复提交）
     校验 Σdisposition.qty === mrb.quantity（不一致直接拒绝，提示差额）

  1) 取待处置库存（条件同现有逻辑，去掉 -R 后缀匹配批次号）：
       A = stock_status='defective'（不良品仓，含锁定）
       B = stock_status='good' AND locked=true（仍在良品仓锁定的兼容分支）
     排序：location_code, _created_at

  2) 对每条 disposition（按 seq 顺序）：
       need = qty
       遍历 sourceList（A 优先，再 B）：
         take = min(src.quantity, need)
         src.quantity -= take;  need -= take
         src.quantity == 0 → 删除该记录
         按 disposition_type 落目标：
           special_admit → 良品仓良品库位，stock_status='good', locked=false,
                           disposition='special_admit', disposition_no=mrbNo
           return        → stock_status='returned'（暂存区），并生成退货单一行
           rework        → stock_status='rework'
           scrap         → quantity=0, stock_status='scrapped'
         写 inventory_transaction：
           txType='mrb_'+type, txNo=mrbNo, referenceNo=mrbNo,
           qty=±take, stockStatus=<目标状态>, balanceAfter=<目标记录余额>
       need > 0 → 抛错回滚（库存不足）

  3) 回写 mrb_review：final_decision（取数量最大的类型，或 'mixed'）、
     disposition_summary、exec_status、qualityManagerId、finalApprovalTime、finalRemark
     回写 iqc_lot / receipt（见决策点 ⑤）
```

**要点**：整个流程必须在**单个事务**内完成；数量用 numeric 字符串运算，不要用 `Number()` 做加减（现有代码有 `Number()` 用法，拆量时叠加容易出浮点尾差），建议整数化处理或显式 scale=4。

### 3.4 接口

```http
POST /api/mrb/final-approve
{
  "mrbId": "...",
  "approverId": "...", "approverName": "...",
  "finalRemark": "...",
  "dispositions": [
    { "dispositionType": "special_admit", "qty": 60, "toLocationId": null, "remark": "轻微色差，可接受" },
    { "dispositionType": "return",        "qty": 30, "remark": "外观划伤超规" },
    { "dispositionType": "scrap",         "qty": 10, "remark": "破损" }
  ]
}
→ { mrb, dispositions[] }     // 兼容旧入参：只有 finalResult 时按全量处置（向后兼容）

GET  /api/mrb/detail/:id                        // 返回体增加 dispositions[]
POST /api/mrb/execute-disposition               // B：执行某条待执行明细（退货出库）
GET  /api/supplier-return/list | /detail/:id    // B
POST /api/supplier-return/:id/ship              // B：确认出库，扣减库存 + 写流水
```

### 3.5 前端交互

- **`MrbList.tsx` 终审弹窗**（现在是一个下拉选结论）→ 改为**处置明细表格**：
  - 列：处置方式 / 数量 / 目标库位（特采时选良品库位）/ 备注 / 删除
  - 「添加明细行」「全量特采」「全量退货」三个快捷动作
  - 实时显示 `已分配 90 / 总量 100，剩余 10`，**剩余不为 0 时禁止提交**
  - 提交前二次确认："特采 60、退货 30、报废 10，确认提交？"
- **详情弹窗**（`MrbList` / `MrbTask`）→ 增加处置明细表 + 执行状态徽标
- **PDA `PdaMrb.tsx`** → 同步改为可填多条（数字输入 + 合计校验），否则 PDA 提交会被新校验拒绝
- **i18n** → 新增词条走现有 `ui`/`mrb` 命名空间，三语言同步（沿用 650 键的 `_build_ui_ns.cjs` 流程）
- **打印**（若需要）→ MRB 评审/处置单模板，可参照 `client/src/pages/iqc/print/` 现有实现

### 3.6 权限

| 动作          | 角色                         | 现有权限位置                                 |
| ----------- | -------------------------- | -------------------------------------- |
| 填写处置明细 + 终审 | `quality_manager`          | `usePermission.ts:42` `/mrb/list`      |
| 退货出库执行      | `wh_keeper`                | 需新增 `/mrb/return` 或 `/supplier-return` |
| 报废执行（若独立成单） | `wh_keeper` / `wh_manager` | 需新增                                    |

---

## 四、需要你决策的关键问题

| # | 决策点               | 选项                                                        | 我的建议                            |
| - | ----------------- | --------------------------------------------------------- | ------------------------------- |
| ① | **方案范围**          | A 轻量 / **B 推荐** / C 完整                                    | B。理由：退货没有单据，仓库实际发货时无凭据，供应商对账会扯皮 |
| ② | **退货数量何时扣减库存**    | (a) 终审即可标记 `returned` 并移到退货暂存区 / (b) 保持不良品仓，仓库实际出库时扣减     | (b) 更严谨；(a) 更简单                 |
| ③ | **拆分粒度**          | 自动按库存记录分摊 / 人工指定来源库位                                      | 自动分摊（第一版），预留 `from_location_id` |
| ④ | **特采件是否管控后续发料**   | 不加限制 / 批次打标可查 / 限定工单与数量                                   | 先做"批次打标 + 发料时可见特采标识"            |
| ⑤ | **IQC 侧要不要回写结论**  | 不回写 / `iqc_lot` 增加处置结论字段并在记录列表展示                          | 建议回写，否则 IQC 记录里这批永远显示"不合格"      |
| ⑥ | **收货单状态**         | 保持 `iqc_fail` / 增加"部分合格"状态                                | 需要你从业务上定                        |
| ⑦ | **是否联动供应商欠料/扣款**  | 不联动 / 复用现有 `supplier_debt`（`source_type` 增加 `mrb_return`） | 若管理供应商就来料质量，建议联动                |
| ⑧ | **报废是否要独立单据与审批**  | 只走库存状态 / 独立报废单审批                                          | 小额报废不必，大额建议独立                   |
| ⑨ | **是否要打印 MRB 处置单** | 要 / 不要                                                    | 特采件通常需要纸质凭证给产线                  |
| ⑩ | **PDA 是否同步改造**    | 同步 / 暂不同步                                                 | 必须同步，否则 PDA 提交失败                |

---

## 五、影响面与实施顺序

**改动清单（方案 B）**

| 层    | 文件                                                             | 改动                                           |
| ---- | -------------------------------------------------------------- | -------------------------------------------- |
| DB   | `server/database/schema.ts`、新增 `mrb_disposition_tables.sql`    | 3 张表 + 3 处 ALTER                             |
| 后端   | `server/modules/mrb/mrb.service.ts`（767 行，主要工作量）               | `finalApprove` 重写为按明细执行；新增 `getDispositions` |
| 后端   | `server/modules/mrb/mrb.controller.ts`、`client/src/api/mrb.ts` | 入参结构扩展（保持向后兼容）                               |
| 后端   | `server/modules/supplier-return/*`（新增）                         | 退货单 CRUD + 出库执行                              |
| 共享   | `shared/api.interface.ts`                                      | `MrbDisposition` 类型、`MrbReview.dispositions` |
| 前端   | `MrbList.tsx`、`MrbTask.tsx`、`PdaMrb.tsx`                       | 终审明细表格 + 详情明细                                |
| 前端   | `usePermission.ts`、`Layout.tsx`                                | 退货单菜单与权限                                     |
| i18n | `zh.ts`/`vi.ts`/`en.ts` + `_ui_extra.json`                     | 约 25~35 条新词条 × 3 语言                          |

**建议实施顺序**（每步可独立验证，不会中途留半成品）

1. 建表 + 明细读取接口 + 详情页展示（先只读，不动执行逻辑）——零风险
2. 终审接口支持 `dispositions[]`，重写拆量算法 + 补库存流水（保留旧入参兼容）——核心
3. PC 终审弹窗改明细表格 + 合计校验；PDA 同步
4. 退货出库单（表/服务/页面/权限）
5. IQC 回写 + 供应商欠料联动（决策点 ⑤⑦）
6. i18n 三语补齐 + 打印（决策点 ⑨）

**风险与注意事项**

- **并发/幂等**：终审必须单事务 + 状态 CAS，防止重复提交导致二次拆量。
- **数量精度**：`numeric(18,4)` 用字符串运算，避免 `Number()` 浮点尾差。
- **唯一键冲突**：目标记录累加前必须先查后写（现有代码已如此处理，拆量时同样适用）。
- **历史数据**：已有 MRB 记录 `mrb_disposition` 为空，详情页需兼容（无明细时展示原 `final_decision`）。
- **无 git 仓库**：改前先备份（项目已有 `backups/` 目录）。
- **双入口**：PC 与 PDA 必须同批改完，否则一侧提交报错。

---

## 六、一句话总结

方案 B = **加一张处置明细表 + 把终审从"选一个结论"改成"填一张数量分配表" + 按明细拆库存并写流水 + 退货生成出库单**。核心难点不在界面，而在**按明细拆分库存记录并保证数量守恒**（合计必须等于批次数量、事务内完成、写流水留痕）。

---


## 七、改造建议（复核版 · 2026-10-05）

> 本节基于对 `finalApprove()`、发料出库骨架、`warehouse` 库位维护能力、`inventory_transaction` 表结构的再次核对给出，按优先级排序。**建议先做 P0**——不然拆量逻辑写得再对，一提交就报错。

### 7.1 病根判断

MRB 现在被实现成「决策终点」，而不是「处置起点」。`finalApprove()` 是一条 `if/else` 链（`mrb.service.ts:557`），把查到的整批不良库存套用同一个动作后即结束；四个处置里**没有一个有下游执行**——`returned` / `rework` / `scrapped` 三个状态值在全库范围内**只被写入、从未被读取**。

所以修法不是「给终审加一个数量参数」，而是把 MRB 改成**处置派发中心**：终审只负责校验与生成明细，实际库存动作由各处置的执行器在同一个事务里完成。

### 7.2 建议清单

| 优先级 | 建议 | 为什么 | 落点 |
| --- | --- | --- | --- |
| **P0** | 修正仓库参数并补建库位 | 现值 `good_warehouse_code=001` / `defective_warehouse_code=NG001`，而仓库表里实际是 `WL001` / `NG01`；解析逻辑读到参数值就按编码查、**不会走类型兜底**，查不到直接抛「仓库不存在」。后果：**特采终审 100% 失败**；IQC 判 fail 的库存流转也被容错吞掉，导致不良品从未真正进过不良品仓 | `sys_param` 改两个值；`NG01` 用 `POST /warehouse/location` 补建库位（warehouse 模块已有完整库位 CRUD），不必手写 SQL |
| **P0** | MRB 全流程补写 `inventory_transaction` | 四种处置现在一条流水都不写，账面无法追溯；表结构（`txType` / `txNo` / `balanceAfter` / `referenceNo`）已完全够用 | `mrb.service.ts` 各分支 |
| **P0** | IQC 侧静默 `catch` 改为告警 | 进不良品仓失败被吞成日志，数据长期是错的（库存里一直躺着「良品仓 + locked」的假良品） | `iqc.service.ts` |
| **P1** | 处置执行用「明细表 + 策略函数」，不要扩 `if` 链 | 现有 `if/else` 每加一种处置就再长一段且四路重复；抽成 `executeDisposition(type, items, tx)` 后，特采/退货/返工/报废共用同一条「扣减 → 拆批 → 写流水」流水线 | 新增 `mrb_disposition` + 4 个 handler |
| **P1** | 退货**不要另建出库引擎**，复用发料骨架 | 发料已是成熟出库实现（`workorder.service.ts:1799/1807`：查库存 → `tx.update(inventory)` 扣减 → 写 `txType='issue'` 与 `split_remain` 拆批）。退货出库只是换 `txType='mrb_return'` 并挂单号 | 新增 `supplier-return`，内部调用同一扣减函数 |
| **P1** | 退货在**实际出库时**才扣库存 | 终审即扣会让账面先少、实物没走；终审只做「标记 `returned` + 冻结数量 + 生成待出库单」 | 状态机 `pending_execute → closed` |
| **P1** | 返工必须加「完成 → 重检」环节 | 现在 `rework` 是死库存（无任何读取方）。若做成「返工完成直接置 `good`」，等于返工后无质量把关就进可发料库存；建议**返工单完成 → 生成重检任务 → 合格才入良品仓** | 返工单 + 简易重检 |
| **P1** | 数量守恒做成**硬约束** | 服务层强校验 `Σ处置数量 == 批次数量`（为 0 不允许提交）+ 状态 CAS 防重复提交 + `select ... for update` 行锁。三件缺一都会出现二次拆量 / 超拆 | `finalApprove` 事务内 |
| **P2** | 特采件从「批次打标」起步 | 特采最大风险是被当普通良品发到任意工单。第一步只做 `is_special_admit` 标记 + 发料界面可见 + 可查；工单级数量管控留到下一迭代 | `inventory` / `iqc_lot` 加字段 |
| **P2** | 库存状态补 `returned` / `rework` / `scrapped` 的显示与三语词条 | 库存查询的状态筛选下拉只有四项，这三个状态筛不出、徽标直接显示英文原码；i18n 也只覆盖了 `good` / `defective` | `InventoryQuery.tsx` + 三语 |

### 7.3 实施路径建议

**先花半天修掉 3 个 P0（参数 + 流水 + 告警），再做 P1 的「明细表 + 统一执行层 + 退货单 + 返工重检」**——特采拆分不需要单独写一套逻辑，它只是四路处置里的一路，做完统一执行层就顺带完成了。
