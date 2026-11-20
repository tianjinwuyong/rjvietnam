# MRB 三种处置的落地现状调查

> 调查范围：`D:\WMS-standalone-migrate\WMS-standalone`（server + client + 实际数据库 wms）
> 问题：①退货有退料单吗 ②返工后怎么回良品仓 ③特采怎么回良品仓
> 结论：**三个处置里，只有"特采"写了回良品仓的代码，但当前配置下会直接报错；退货和返工都是死路。**

---

## 一、MRB 终审四种处置的执行代码（`server/modules/mrb/mrb.service.ts:557 finalApprove`）

| 处置 | 代码位置 | 实际动作 | 有无单据 | 有无库存流水 |
| --- | --- | --- | --- | --- |
| 特采 `special_admit` | 624-668 | 良品仓锁定→原地解锁；不良品仓→移到良品仓库位、置 `good`、解锁 | 无 | **无** |
| 退货 `return` | 669-676 | 仅把 `stock_status` 改成 `returned`、解锁 | **无** | **无** |
| 返工 `rework` | 677-684 | 仅把 `stock_status` 改成 `rework`、解锁 | **无** | **无** |
| 报废 `scrap` | 685-698 | 数量清零 + `stock_status='scrapped'` | **无** | **无** |
| 其他 `other` | — | 什么都不做（保持锁定在原库位） | — | — |

---

## 二、Q1：MRB 决策退货的，有退料单吗？

### 结论：没有。退货只是改了一个状态字段。

**证据**

1. `stock_status='returned'` 这个值**全库只出现一次**，就是写它的地方：
   ```
   server/modules/mrb/mrb.service.ts:674   .set({ stockStatus: 'returned', locked: false, lockReason: null })
   ```
   没有任何地方**读取/消费**这个状态——没有"待退货"列表、没有出库流程、没有结转。

2. 全库检索 `supplierReturn` / `supplier_return` / `returnOrder` / `return_order` / `ReturnOrder` → **0 结果**。系统里**不存在**退货单实体。

3. 系统里确实有"退料"字样，但方向不对，**不是** MRB 退货：
   - `receipt/production-return-receipt.service.ts`、`workorder/production-return.service.ts` → **产线退料入库**（产线 → 仓库）
   - `supplier-debt/supplier-debt.service.ts` → **供应商欠料**，数据来源是产线退料（`source_type='production_return'`）
   - MRB 的退货是「仓库 → 供应商」，这两者完全不同。

4. 系统里**没有任何出库模块**（模块清单：bom / dashboard / defective-move / inventory / iqc / material / mrb / over-picking / receipt / stock-take / supplier-debt / system / view / warehouse / workorder —— 只有"发料到产线"，没有"出货/退供应商"）。

5. MRB 全程**不写 `inventory_transaction`**，所以退货连一条库存流水都没有。

**实际后果**

- 终审点"退货"之后：库存记录还挂在不良品仓，只是状态变成 `returned`，**数量没减、没有出库、没有凭证**。仓库要真退货只能线下操作。
- 这批记录会永久滞留。好消息是发料/工单**只认 `stock_status='good'`**（工单模块里 65 处 `eq(inventory.stockStatus,'good')`），所以不会被误用。
- 坏消息是**看不见**：库存查询的状态筛选下拉只有 良品/待检/锁定/不良品 四项（`InventoryQuery.tsx:180-184`），`returned` 筛不出来；状态徽标映射表（`InventoryQuery.tsx:77-89`）也没有这个状态，会直接显示英文原码 `returned`。
- i18n 的 `inventory` 命名空间只有 `status_good / status_defective / status_blocked / status_pending`，缺 `returned`。

---

## 三、Q2：MRB 决策返工，返工完成后怎么回良品仓？

### 结论：**没有任何路径能回去。这批货会变成死库存。**

**证据**

1. `stock_status='rework'` 全库只有一处写入：`mrb.service.ts:682`。写入之后**没有任何代码再处理它**。

2. "返工"这个词在全库（server 端、排除 .bak）只出现两次：
   - `mrb.service.ts:678` 注释「返工：库存状态改为 rework」
   - `workorder.service.ts:3093` 追溯报表里的标签映射 `WHEN 'rework' THEN '返工'`
   → **没有返工单、没有返工执行、没有返工完成确认、没有返工重检**。

3. 逐条排查所有"可能把库存搬回去"的入口，全部堵死：

   | 可能的入口 | 检查结果 |
   | --- | --- |
   | 发料 / 工单消耗 | 只查 `stockStatus='good'` → rework 永远取不到 |
   | 库存移库（库内移库 / 不良品调拨 / 库存调拨） | 全部按 `good` 或 `good+locked` 匹配 |
   | 盘点 | `stock-take.service.ts:29` 有 `rework: ['rework']` 范围，**能给 rework 开盘点单**，但 `approveTake()`（`stock-take.service.ts:931`）**只更新单据状态，一行 inventory 都不写** → 搬不动 |
   | 库存调整 `adjustInventory`（`inventory.service.ts:1371`） | 只改**数量**（`.set({ quantity: ... })`），**不碰 stockStatus** |
   | 通用"改库存状态"接口 | 全库不存在 |

4. 结论：**终审一旦选"返工"，这批库存既不能发料、也回不到良品仓，界面上的任何操作都救不回来，只能直接改数据库。** 这是当前设计里最严重的漏洞。

---

## 四、Q3：MRB 决策特采，怎么回良品仓？

### 结论：**代码上会自动回，但当前环境配置是错的，一调用就抛异常，实际跑不通。**

### 4.1 代码逻辑（`mrb.service.ts:624-668`）

```
if (finalResult === 'special_admit') {
  const goodLoc = await this.getGoodWarehouseLocation();   // ← 无条件先取良品仓库位
  // a) 仍在良品仓且锁定的记录：原地解锁（不换库位）
  for (const inv of lockedGoodInvs) → set { locked:false, lockReason:null }
  // b) 在不良品仓的记录：改到良品仓库位 + stockStatus='good' + 解锁
  for (const inv of defectiveInvs) {
      若目标库位已有同批次良品记录 → 数量累加、删除旧记录
      否则 → set { locationId: goodLoc.id, stockStatus:'good', locked:false, lockReason:null }
  }
}
```

仓库解析链路：`getGoodWarehouseLocation()`（`mrb.service.ts:212`）→ `findWarehouseByParamOrType('good_warehouse_code', 'normal', '良品仓库')`（`mrb.service.ts:177`）→ 读 `sys_param.good_warehouse_code`。

**关键**：读到了参数值就按该编码查仓库，**查不到直接抛 `NotFoundException`，不会走类型兜底**（兜底只在参数缺失时生效）。

### 4.2 实测当前数据库 → 必然报错

```
sys_param:  good_warehouse_code      = 001       ← 仓库表里不存在这个编码
            defective_warehouse_code = NG001     ← 同样不存在

warehouse 实际数据：
  WL001  物料1仓    normal     200 个库位
  WL002  物料2仓    normal      20 个库位
  NG01   不良品仓   defective    0 个库位   ← 一个库位都没有
```

三个问题串在一起：

1. **特采终审 100% 失败** —— `getGoodWarehouseLocation()` 解析 `001` 查不到仓库 → 抛「良品仓库 001 不存在」。而且它在 `special_admit` 分支**开头无条件调用**，所以哪怕不良品仓一条记录都没有，也会先炸。
2. **IQC 判 fail 的库存流转也必然失败** —— 走 `getDefectiveWarehouseLocation()`，参数 `NG001` 不存在 → 抛错；就算参数修对了，`NG01` 下面 **0 个库位**，还是会抛「不良品仓库下无可用库位」。
   好在 IQC 那边包了容错：`iqc.service.ts:1588-1593` 是 `try { finalizeLotInventory() } catch { logger.error }`，**只记日志、不阻断审批**。
   副作用：IQC fail 后库存实际上**仍留在良品仓且 locked=true**（`lockReason='IQC检验不合格'`），**从来没进过不良品仓**。
3. 这反过来解释了 MRB 为什么还能发起 —— `initiateMrb` 兼容了"仍在良品仓锁定"的分支（`mrb.service.ts:291-304` 分支 b），否则早就发起不了了。

### 4.3 另一个业务细节

特采**不是回到原库位**，而是丢到良品仓里**库位编码最小**的那个库位（`order by location_code limit 1`）。当前 `WL001` 有 200 个库位，意味着所有特采件都会被塞进 `WL001-A-01-00-0001`。生产上会造成库位堆积、找不到货。

---

## 五、附带发现

1. **MRB 处置全程无库存流水**：特采/退货/返工/报废四种处置，`inventory_transaction` 一条都不写。全库只有 `issue`（发料）、`split_remain`（拆零）、`adjust`（盘点调整）、`production_return_in`、`defective_transfer_in` 五种流水类型。
2. **唯一能看 MRB 结果的地方是追溯报表**：「物料追溯管理」`workorder.service.ts:3019 getTraceRecords` 聚合了 发料记录 / 不良品调拨记录 / 不良品处理记录(MRB)，其中 MRB 部分是**直接读 `mrb_review.final_decision` 拼接**的（`workorder.service.ts:3086-3093`），所以它只反映"评审结论"，**不反映库存实际变化**——退货、返工这两种"结论写了但库存没动/动不了"的情况，报表上看起来是正常的。
3. **库存状态字面量全集**：`good / defective / returned / rework / scrapped`（另有 `pending`/`blocked` 仅用于界面显示）。i18n 只覆盖前两个（`inventory` 命名空间缺 `status_returned / status_rework / status_scrapped`）。
4. `warehouse` 表已经有多语言字段 `wh_name_zh / wh_name_vi / wh_name_en`，但 `NG01 不良品仓` 目前没有库位。

---

## 六、修复建议（按优先级）

| 优先级 | 问题 | 建议动作 | 影响 |
| --- | --- | --- | --- |
| **P0** | `good_warehouse_code='001'`、`defective_warehouse_code='NG001'` 与仓库主数据不一致，特采必报错 | 改为 `WL001` / `NG01`（或按业务实际指定）；并给 `NG01` 建库位 | 1 条 SQL 改参数 + 批量建库位 |
| **P0** | `NG01` 无库位 → IQC fail 流转静默失败，不良品从没真正进不良品仓 | 补库位；同时把 IQC 侧的 `catch` 改为**失败时告警/回滚**，不要只记日志 | 否则不良品数据一直是错的 |
| **P1** | 返工无回路，死库存 | 需要新增"返工完成"动作（返工入库/返工后重检），可复用 IQC 重检或直接移回良品仓 | 属本次 MRB 拆分方案要一起考虑 |
| **P1** | 退货无单据、无出库 | 建 `supplier_return_order` + 出库执行（见《MRB部分特采方案.md》方案 B） | 退货必须能真正出库 |
| **P2** | MRB 不写库存流水 | 四种处置都补 `inventory_transaction`，`txType='mrb_*'`，`referenceNo=mrbNo` | 账面可追溯 |
| **P2** | 库存查询看不到 returned/rework/scrapped | 补状态下拉选项 + 徽标映射 + 三语词条 | 否则这些货在界面上是"不可见状态" |
| **P3** | 特采固定落最小库位编码 | 允许指定目标库位，或落回原库位 | 库位管理 |

---

## 七、一句话总结

- **退货**：没有退料单，只把库存状态改成 `returned` 就结束了，无单据无流水。
- **返工**：**没有回良品仓的路**，写进去就是死库存，界面无解。
- **特采**：代码有自动回良品仓的逻辑（且不落回原库位），但 `sys_param.good_warehouse_code='001'` 这个仓库不存在，**调用即抛异常**；连 IQC fail 进不良品仓的流转也是错的（参数不存在 + `NG01` 无库位），只是被 try/catch 吞掉了。
