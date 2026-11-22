# 移植前端模块审查报告（WMS / OA / MES）
日期：2026-11-21 · 只读审查 · 无任何改动

## 0. 总体结论
- WMS：62 项参考菜单在 `docs/wms-menu-map-2026-11-20.md` 中声称全量落点，**但其中 4 项为"概念替换"（⚠），3 项落点为不可达/恒空（❌），1 项页面恒空（❌）**；导航有重复标签键与重复屏。
- OA：8 组菜单近乎 1:1 落地，**但存在 9 个孤儿 HTML 页面无任何入口**，且薪资域被降级为只读列表（功能缺失）。
- MES：菜单逐字移植，**但 6 个参考叶子被删，新增 ~19 项，且 `exec.snpool` 重复、`cfg.skill` 改键**；WipView 兜底掩盖缺失。
- 逻辑：3 处信封形状/字段不匹配导致**列表/详情恒空**；多处吞错、无分页、无 loading/empty。
- i18n：新屏抽查三语齐全；但大量屏内硬编码中文/英文（领料单、追溯、IQC、3D 占位、OA 部分）。

---

## 1. WMS 屏幕级 1:1 对应矩阵

参考源：`D:/rj/repos/extract/WMS-20261019/client/src/components/Layout.tsx`（菜单，~:26-190）、`client/src/app.tsx:216-233`（路由）。
目标：`apps/web/src/wms/index.ts`（`wmsMenuGroups` ~:96-175）、`App.tsx:1856-1980`（switch）、`docs/wms-menu-map-2026-11-20.md`（官方映射）。
判定：✅独立页 / ⚠部分（概念替换或同表筛选）/ ❌缺失或不可达 / ➕本系统新增。

| # | 参考菜单 | 目标 tab / 组件 | 判定 | 证据 |
|---|---|---|---|---|
| 1 | `/` 首页看板 | `dashboard`→`WmsDashboard` | ❌不可达 | `App.tsx:1856` case 存在，但 `:1981` `isMenuPage==="dashboard"`、`:1986` 渲染 `WmsMenuPage`、`:2033` `{!isMenuPage && renderActiveView()}` → 看板代码永远不执行 |
| 2 | `/warehouse` 仓库组 | `locationManagement` | ✅ | `App.tsx:1912` `case "locationManagement"` |
| 3 | `/warehouse/list` 仓库档案 | `rjvnCanonical`→`WmsCanonicalData` | ⚠ | `App.tsx:1863`；`apps/web/src/wms` 内除 `WmsRjvnReceipt` 外**无 `warehouses` 匹配** → 仓库档案 CRUD 未核实 |
| 4 | `/warehouse/location` 库位 | `locationManagement` | ✅ | `App.tsx:1912` |
| 5 | `/material` 物料组 | `materialMaster` | ✅ | `App.tsx:1909` |
| 6 | `/material/list` 物料列表 | `rjvnData`→`WmsRjvnData` | ✅ | `App.tsx:1857` |
| 7 | `/material/supplier` 供应商 | `supplierManagement` | ✅ | `App.tsx:1888` |
| 8 | `/material/substitution` 替代料 | `substitution` | ➕ | `App.tsx:1901`（`GET /wms/material-substitutions`） |
| 9 | `/receipt` 收货组 | `receiving` | ✅ | `App.tsx:1865` |
| 10 | `/receipt/scan` 扫码收货 | `pdaReceiving`→`WmsMaterialReceiving` | ⚠重复屏 | `App.tsx:1934` 与 `:1948` `materialReceiving` 渲染**同一组件** |
| 11 | `/receipt/list` 收料单列表 | `rjvnReceipt`/`inboundOrders` | ✅ | `App.tsx:1859`、`:1918` 邻近 |
| 12 | `/receipt/production-return` 生产退料 | `returnReceive` | ✅ | `App.tsx:1866` |
| 13 | `/iqc` IQC 组 | `iqc`/`iqcInspect` | ✅ | `App.tsx:1869,1884` |
| 14 | `/iqc/pending` 待检清单 | `rjvnIqc` | ✅ | `App.tsx:1858` |
| 15 | `/iqc/record` 检验记录 | `iqcReport` | ✅ | `App.tsx:1885` |
| 16 | `/iqc/report` 检验报告 | `iqcReport` | ✅ | `App.tsx:1885` |
| 17 | `/iqc/template` 检验模板 | `iqcTemplates` | ❌详情恒空 | `App.tsx:1899`；`WmsIqcTemplates.tsx:78` `setDetail(r.data)` 而 `routes/wms-parity.js:93` 返回 `{data:{...}}` → 详情永远空 |
| 18 | `/iqc/standard-library` 标准库 | `iqcStandards` | ✅ | `App.tsx:1886` |
| 19 | `/iqc/stats` 检验统计 | `qualityTrend` | ⚠概念替换 | `App.tsx:1889`；`WmsRjvnClassic.tsx:60-140` 映射（统计→质量趋势），功能深度未验证 |
| 20 | `/iqc/strictness` 检验严格度 | `iqcInspectionLevels` | ✅ | `App.tsx:1872` |
| 21 | `/iqc/production-return-pending` 退料待检 | `lineReturn` | ✅ | `App.tsx:1874` |
| 22 | `/iqc/supplier-debt` 供应商欠料 | `supplierDebt` | ✅ | `App.tsx:1919` 附近 |
| 23 | `/inventory` 库存组 | `inventory` | ✅ | `App.tsx:1891` |
| 24 | `/inventory/query` 库存查询 | `rjvnInventory` | ✅ | `App.tsx:1860` |
| 25 | `/inventory/intra-transfer` 库内移库 | `transferAdjust` | ✅ | `App.tsx:1897` |
| 26 | `/inventory/transfer` 仓库间调拨 | `transferAdjust` | ✅复用 | `App.tsx:1897`（同表筛选） |
| 27 | `/inventory/defective-transfer` 不良品转移 | `defectiveMove` | ✅ | `App.tsx:1919` 附近 |
| 28 | `/inventory/defective-move` 不良品移库 | `defectiveMove` | ✅复用 | 同上（同表筛选） |
| 29 | `/inventory/expiry` 有效期 | `expiryControl` | ❌列表恒空 | `App.tsx:1898`；`WmsExpiryControl.tsx:43-46` 读 `r.data`，而 `routes/wms-parity.js:154-157` 返回 `{data:rows, meta}` → 列表永远空 |
| 30 | `/inventory/stock-take` 盘点 | `cycleCount` | ✅ | `App.tsx:1896` |
| 31 | `/bom` BOM 组 | 顶部「BOM」模块 | ⚠未核实 | 映射文档称在顶部模块；WMS 侧无 BOM 屏，需另行核实 |
| 32 | `/bom/list` BOM 清单 | 顶部「BOM」模块 | ⚠未核实 | 同上 |
| 33 | `/workorder` 工单组 | `requisitions` | ⚠概念替换 | `App.tsx:1924` 附近；`WmsRjvnClassic.tsx` 映射（workorder→requisitions） |
| 34 | `/workorder/list` 工单列表 | `requisitions` | ⚠概念替换 | 同上 |
| 35 | `/workorder/requirement` 工单需求 | `requisitions`+BOM 需求 | ⚠ | 同上；需求评审未验证 |
| 36 | `/workorder/picking` 领料 | `rjvnPicking`/`picking` | ✅ | `App.tsx:1861,1892` |
| 37 | `/workorder/picking-approval` 领料审批 | `picking` | ⚠复用 | `App.tsx:1892`（备料审批为同表筛选） |
| 38 | `/workorder/supplement` 补料 | `replenishments` | ✅ | `App.tsx:1930` 附近 |
| 39 | `/workorder/supplement-record` 补料记录 | `slips` | ⚠复用 | `App.tsx:1895` |
| 40 | `/production` 生产组 | `materialLoading` | ✅ | `App.tsx:1940` 附近 |
| 41 | `/production/production-return` 生产退料 | `lineReturn` | ✅复用 | `App.tsx:1874` |
| 42 | `/production/picking-approval` 领料审批 | `picking` | ⚠复用 | `App.tsx:1892` |
| 43 | `/production/picking-receive` 领料接收 | `issue` | ⚠复用+标签冲突 | `App.tsx:1893`；`index.ts:187` `pdaConsumption` 与 `:198` `issue` **同用 `wms.subnav.issue`** |
| 44 | `/production/reel-settlement` 料盘结算 | `materialConsumption` | ⚠概念替换 | `App.tsx:1904`；映射（reel-settlement→物料消耗看板） |
| 45 | `/production/over-picking` 超领 | `overPicking` | ✅ | `App.tsx:1930` 附近 |
| 46 | `/production/supplement` 补料 | `replenishments` | ✅复用 | `App.tsx:1930` 附近 |
| 47 | `/production/supplement-record` 补料记录 | `slips` | ⚠复用 | `App.tsx:1895` |
| 48 | `/production/over-supplement-report` 超补领料单 | `rjvnDocFlow` | ❌页面恒空 | `App.tsx:1862`；`WmsRjvnDocFlow.tsx:4` 自述镜像表 0 行、页面恒空 |
| 49 | `/issuing` 发料组 | `issue` | ✅ | `App.tsx:1893` |
| 50 | `/issuing/list` 发料单 | `outboundOrders` | ⚠复用 | `App.tsx:1920` 附近 |
| 51 | `/issuing/records` 发料记录 | `transactions` | ⚠复用 | `App.tsx:1903` |
| 52 | `/mrb` MRB 组 | `mrb` | ✅合并 | `App.tsx:1927` 附近；`WmsMrb.tsx` 合并 list+task+审批 |
| 53 | `/mrb/list` MRB 清单 | `mrb`/`mrbApproval` | ✅ | 同上 + `App.tsx:1880` |
| 54 | `/mrb/task` MRB 任务 | `mrb` | ✅合并 | `WmsMrb.tsx` |
| 55 | `/rework` 返工组 | `rework` | ✅ | `App.tsx:1919` 附近 |
| 56 | `/rework/list` 返工单 | `reworkComplete` | ⚠概念替换 | `App.tsx:1882`（返工回仓） |
| 57 | `/supplier-return` 退供应商组 | `supplierReturn` | ✅ | `App.tsx:1867` |
| 58 | `/supplier-return/list` 退货单 | `supplierReturnOrder` | ✅ | `App.tsx:1929` 附近 |
| 59 | `/system` 系统组 | 顶部「管理」模块 | ⚠未核实 | `WmsBasicData.tsx:13-37` 仅 3 子模块（物料/库位/批次）→ 无 sysParam/role/account/init |
| 60 | `/system/param` 参数 | 管理→系统参数 | ⚠未核实 | 同上 |
| 61 | `/system/role` 角色 | 管理→角色权限 | ⚠未核实 | 同上 |
| 62 | `/system/account` 账号 | 管理→用户账号 | ⚠未核实 | 同上 |

### 参考侧菜单外路由（`client/src/app.tsx:216-233`，不在 62 项内）
- 13 个 PDA 路由：`/pda/login|home|receipt/scan|receipt/list|defective-move|transfer|stock-transfer|inventory|picking|putaway|issuing|reel-return|supplement|mrb|help`（:219-233）。
- 目标侧仅 7 个 PDA 页签：`pdaReceiving/pdaReceivingMobile/pdaConsumption/pdaMsd/pdaCycleCount/pdaIqc/pdaHistory`（`index.ts:60` 附近）。**缺**：`/pda/defective-move`、`/pda/transfer`、`/pda/stock-transfer`、`/pda/picking`、`/pda/putaway`、`/pda/reel-return`、`/pda/supplement`、`/pda/mrb`、`/pda/help`（约 9 个）。且 `pdaIqc`/`pdaHistory`/`pdaMsd`/`pdaReceivingMobile`/`pdaCycleCount` 为**本系统新增**（参考无）。

### 布局缺陷
- **重复列**：`wms/index.ts:64` 与 `:70-72` 重复 `"rework"/"supplierDebt"/"defectiveMove"`（tab 数组重复登记）。
- **标签键冲突**：`wms/index.ts:160 incoming` 与 `:161 materialReceiving` 同用 `wms.subnav.incoming`；`:187 pdaConsumption` 与 `:198 issue` 同用 `wms.subnav.issue`；`:188 pdaMsd` 与 `:213 msd` 同用 `wms.subnav.msd` → 侧栏两个不同 tab 显示同一文案。
- **重复屏**：`App.tsx:1934 pdaReceiving` 与 `:1948 materialReceiving` 渲染同一 `WmsMaterialReceiving`（两 tab 完全同屏）。
- **硬编码占位**：`App.tsx:1918` `shelfSim3d` 返回硬编码中文 `<p>`（含中文文案）。
- **不可达看板**：`App.tsx:1981/1986/2033` 使 `dashboard` 分支永不可达（见 #1）。

---

## 2. OA 屏幕级对应

参考源：`services/api/oa-web/assets/BasicLayout-BfNiJr1b.js:1`（压缩 `ae` 数组，8 组：workbench/docSystem/drive/knowledge/qualityMgr/equipmentMgr/hr/sysMgr）。
目标：`apps/web/src/oa/menu.ts:100-265`、`oa/index.tsx:250-523`、`oa/HANDOFF.md`。

- **菜单近乎 1:1**：`menu.ts:100-265` 与参考数组逐组对齐；`index.tsx:250-523` 全部叶子有视图，无「建设中」兜底；`HANDOFF.md` 称全量实现 → ✅。
- **缺口（❌）**：
  - `/equipment/stats`（EquipStats）组首页缺失（`menu.ts:171-179`）。
  - HR `/stats` 首页缺失。
  - `/help`、`/m/*` 移动页（MScanPanel/MStocktake/MEquipTask）、Onboarding、DocDrafts 无对应。
  - quality 5 个模板路由被合并为单个 `qcTemplates`（⚠ 功能聚合）。
- **薪资降级（❌ 严重）**：`oa/HrView.tsx`（~:335-372）salary/salaryTemplate 为**只读 GenericList**（`/api/salary/records`、`/api/salary/structures`）；参考 `salary-console.html`/`payroll-console.html` 含核算/试算/工资单/个税，本端口全部只读 → **核心业务功能缺失**。
- **孤儿页（❌）**：`services/api/oa-web` 下 9 个独立 HTML（integration-console、my-payslip、payroll-console、salary-console、tax-console、work-calendar、schedule-plan、permission-console、payroll-trial），由 `services/api/server.js:8965-9010` 挂载 `/oa` 与 `/next`，但 `apps/web/src` 内**无任何链接**（grep 无匹配）→ 仅靠手输 URL，正常用户不可达。
- **三套 OA 并存**：另见 `docs/frontend-structure-evaluation-2026-11-21.md:45`（OA 站点 + oa-web-next + console 内嵌）。

---

## 3. MES 屏幕级对应

参考源：`D:/rj/repos/MES-ruijing/api/sys.py:515-700`（MENU）、`web/pages.js`（`A.register`）、`web/app.js:1438`（`/api/menu`）。
目标：`services/api/src/mesrj/menu.js`（770 行，自称逐字移植）、`apps/web/src/mesrj/index.tsx`、`resources.tsx`（`crudViews`，`code` 清单 :24-664）。

- **顶层模块不可达**：`App.tsx:157`（ModuleKey）、`:432`（FULL_MODULES）、`:3203`（moduleContent）有 mesrj，但不在 `modules`/`moduleGroups` → **用户只能经 MES 的 5 个桥接页签进入**（`mes/index.ts:191`、`App.tsx:2097-2106`）。这是结构性问题：mesrj 作为模块名存在但无法直接导航。
- **菜单差异（menu.js）**：
  - 键改：`md.employee→emp.employee`（:34）、`cfg.skill→emp.skill`（~:644）。
  - **`exec.snpool` 重复**（:181 与 :207）→ 两个菜单项同一屏。
  - 删除参考项：`exec.ultra`、`exec.ultraparam`、`cfg.calib`、`md.fixture`、`sys.dept`（❌ 5 项无对应屏）。
  - 新增 ~19 项：`exec.snrule/snbatch/snvoid/sndetail/sntest/stationnext/stationpending/passlist/panelpreview/passpanel`、`dev.deviceconfig/stationpass/machinedata/packing/itflog`、`report.tpl`（➕ 本系统新增，需验证是否有真实后端）。
- **视图路由**：`mesrj/index.tsx` 菜单来自 `/mesrj/menu`，视图 if 链 + `crudViews`（`resources.tsx`，48 个 `code` 配置 :24-664）+ `WipView` 兜底（`index.tsx:203`）→ 未知菜单静默落 WipView，**掩盖缺失**（❌ 风险：用户看到 WipView 但无对应功能）。
- **crudViews 覆盖**：md.customer/material/product/line/station/track/equipment/defect/rootcause/shift/calendar、sys.user/role、bom.header/item、po、mo、replenish、issueitem、plan.schedule/capacity、route.rule、cfg.dict/threshold/pokayoke/snrule/packrule/printtpl/pcbcode/aoi*、dev.machinesource、emp.employee/skill/stask/cert/exam（48 项）。`cfg.snrule`（:386）与 `exec.snrule`（:401）**同 basePath cfg/res snrule → 同一后端表注册两次**。
- 参考 PDA 页（`pda.html/pda-hub/pda-ship/pda-ultra/pda-supply/board/index.html`）→ 目标无对应 `pda-*` 屏（❌）。

---

## 4. 逻辑问题（按严重度）

1. **信封形状不匹配 → 恒空**（3 处）：
   - `WmsExpiryControl.tsx:43-46` 读 `r.data`，而 `routes/wms-parity.js:154-157` 返回 `{data: rows, meta}` → 列表恒空。
   - `WmsIqcTemplates.tsx:78` `setDetail(r.data)`，而 `routes/wms-parity.js:93` 返回 `{data:{...}}` → 详情恒空。
   - `WmsLifecycleDashboard.tsx:111-117` 读 `sr.data.expired/red_l3/...`，而 `routes/lifecycle.js:66-92` 返回裸 `{byAlert,pendingReinspection,pendingScrapping}` → **形状+字段双重不符**，整屏不可用。
2. **吞错**：`WmsBatchManagement.tsx` ~:50-57 `catch(()=>setLoading(false))` 静默吞错；`openLot` 事务查询同样吞错（~:61-68）→ 用户无任何错误提示。
3. **无分页/无轮询**：`WmsBatchManagement.tsx` `limit:500` 一次性拉全量、无分页、无轮询（无清理问题但大表性能风险）。
4. **WmsMesSync**：`load` useCallback 依赖 keyword/wbStatus/wbKeyword（~:111，effect :120）→ **每次按键触发 5 个请求**（无防抖）；无 interval（无清理问题）。配置面板**无 admin 门控**，参考 `pages/mes/MesSync.tsx:616-634` 为 isAdmin 限定。
5. **冻结列缺「谁冻结」**：`services/api/server.js:18863-18865` 返回 `locked/lockReason/lockedAt`，**不返回 `locked_by_name`**；仅 `/wms/inventory/locks`（`routes/wms-ops.js:512-527`，LOCK_COLS ~:426）返回 `lockedByName` → 冻结列无法显示冻结人。
6. **争议 IQC 批次**：`WmsPutAway`/`WmsReturnReceiving.tsx:30`/`WmsFifoSimulation` 均按 `released` 过滤；`WmsInventory.tsx:161`、`WmsInventoryControlCenter.tsx:43` 未知状态回落 PENDING → **未发现把争议批次直呈「可用」的屏幕**（✅ 无此风险），但 `WmsInventoryControlCenter` 用 `lot.iqcStatus || "PENDING"` 兜底会把未知状态伪装成 PENDING（⚠ 掩盖数据问题）。
7. **loading/empty 缺失**：多屏无 loading/empty 态（如 WmsBatchManagement、WmsMesSync 配置面板、WmsExpiryControl 恒空无空态提示）。

---

## 5. 规范符合度

- **i18n 三语**：`wms.batch.*`、`wms.mesSync.*` 抽查 key 三语齐全 ✅；`oa/i18n/index.ts:2` zh 3430 / en、vi 各 3428（差 2 键，微差）。
- **硬编码**（❌ 违规）：
  - `WmsRequisitions.tsx:73` "全部状态"、`:76` "共 N 条"、`:80` "加载中..."、表头 "单据号/工单号/状态/创建时间"（:83 附近）、`:66` `confirm("Delete this DRAFT document?")`、`:56`/`:67` `alert("...failed")` 英文。
  - `WmsMaterialTraceRoute.tsx:27`（硬编码文案）；`WmsIqc.tsx:442`；`WmsIqcFlowPages.tsx:224`；`App.tsx:1918` 中文占位。
- **状态色语义**：`WmsRequisitions.tsx` STATUS_COLORS 中 `EXECUTING:"#f39c12"`（orange=warning✅）、`REJECTED:"#e74c3c"`（danger✅）、`CANCELLED:"#7f8c8d"`（gray）。**整体符合 warning/danger 语义**，无反向用色。
- **tooltip**：多数控制有 `title`（如导航按钮 `App.tsx:1993` 等）；但 WmsBatchManagement 筛选下拉/表头、WmsMesSync 配置面板部分控件缺 tooltip（⚠ 部分不达标）。
- **barcode-first**：`WmsIssue`/`WmsPdaConsumption`/`WmsCycleCount` 有 autoFocus ✅；`WmsMaterialReceiving`/`WmsMsd` 缺（⚠）。

---

## 6. 风险排序（Top 消费者可见问题）

| 优先级 | 问题 | 证据 |
|---|---|---|
| P0 | OA 薪资域只读（核算/试算/工资单/个税缺失） | `oa/HrView.tsx:335-372`；参考 `salary-console.html` |
| P0 | WMS 3 处恒空屏（有效期/检验模板详情/生命周期看板） | `WmsExpiryControl.tsx:43-46`、`WmsIqcTemplates.tsx:78`、`WmsLifecycleDashboard.tsx:111-117` |
| P0 | OA 9 个孤儿 HTML 无入口（payroll/salary/tax 等） | `server.js:8965-9010`；`apps/web/src` grep 无匹配 |
| P1 | WMS 首页看板不可达（dashboard 死代码） | `App.tsx:1981,1986,2033` |
| P1 | MES 顶层模块不可导航（只能经桥接页签） | `App.tsx:157,432,3203`；`mes/index.ts:191` |
| P1 | MES WipView 兜底掩盖缺失 + 菜单增删 24 项 | `mesrj/index.tsx:203`；`menu.js:181,207` 等 |
| P1 | WMS `rjvnDocFlow` 恒空（超补领料单） | `WmsRjvnDocFlow.tsx:4` |
| P1 | 重复屏/重复标签/重复列（pdaReceiving≡materialReceiving；incoming/issue/msd 标签冲突；rework/supplierDebt/defectiveMove 重复） | `App.tsx:1934,1948`；`index.ts:64,70-72,160-161,187-188,198,213` |
| P2 | 吞错 + 无分页（BatchManagement） | `WmsBatchManagement.tsx:50-68,limit:500` |
| P2 | 冻结列缺冻结人 | `server.js:18863-18865` vs `wms-ops.js:512-527` |
| P2 | MesSync 每次按键 5 请求 + 配置无 admin 门控 | `WmsMesSync.tsx:111,120`；参考 `MesSync.tsx:616-634` |
| P2 | 硬编码中/英文（≥8 处） | `WmsRequisitions.tsx:56,66,67,73,76,80,83`；`WmsIqc.tsx:442`；`App.tsx:1918` |
| P3 | PDA 参考 13 路由仅 7 页签落地 | `client/src/app.tsx:219-233`；`index.ts:60` |
| P3 | 未知 IQC 状态兜底 PENDING（掩盖） | `WmsInventoryControlCenter.tsx:43` |

---

## 7. 未核实/推断项（如实标注）
- #31/#32 BOM 顶部模块落点：未读顶部模块代码，仅依据映射文档 → ⚠。
- #59-62 system/* 顶部「管理」模块：未逐项核实 → ⚠。
- WMS 概念替换类（#19/#33-35/#44/#56）：依据 `WmsRjvnClassic.tsx` 映射 + 屏头注，**功能深度未验证** → ⚠。
- MES `exec.*`/`dev.*`/`report.tpl` 新增项是否有真实后端：未核实 → 推断。
- `WmsPdaConsumption.tsx:39` `setTrace(r.data)` 对应 `getMaterialTrace` 后端形状：`api/wms.ts:835` 返回 `{data: MaterialTrace}`，后端未找到 `getMaterialTrace` 定义（grep 无匹配）→ **推断：可能又是信封错配，需核实**。
