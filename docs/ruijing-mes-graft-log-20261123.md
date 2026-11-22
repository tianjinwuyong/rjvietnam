# 瑞晶 MES 嫁接工作日志（中文）

**日期**：2026-11-22 ~ 2026-11-23
**作者**：opencode
**源**：`github.com/tianjinwuyong/ruijing-mes` @ `b374884`（独立 Python/Flask + SQLite 版，已部署 rjms:8088 实跑）
**目标**：`smt-factory-system` 的 `mesrj` 域（React + Express + PostgreSQL）
**标准**：`docs/grafting-standards.md`（七步流程）+ `docs/integration/grafting-protocol.md`（嫁接 vs 上层集成裁决）

> 本文件是我**单独撰写**的日志，可独立提交；`docs/WMS_GRAFT_LOG.md` 是多 lane 共用的追加式台账，我的同内容条目已写入其 2026-11-22 / 2026-11-23 段落。

---

## 一、任务与结论

用户要求：把工作 MES 嫁接进 SMT 系统，做到「按 SMT 结构嵌进去、接口一个不少」。

**最终结论（实测，非推断）**：

| 层 | 结果 | 证据 |
|---|---|---|
| 数据库 | **184/184 全部有归属**（147 同名 + 35 改名/合并 + 2 手工备份） | 逐张表在 live PG 定位，0 张未定位 |
| 逻辑（接口） | **759/759 全部落地**（499 条 `@bp.route` 字面路由 + 260 条 `_crud.Res` 生成的 CRUD 路由；其中 9 条为改名等价） | 源逐条比对目标全部注册路由 + `registerCrud` 资源表 |
| 前端（Web 控制台） | W17/W18 后 **82 屏已接视图 / 54 显示「建设中」**；W19 再补 5 屏 → **87 已接 / 余 7** | 浏览器实跑逐叶点开计数，非静态 diff |

> ⚠ **分母更正（2026-11-23 W19）**：本文早先写的「499/499」**分母错了**。源 `api/exec.py`、`api/cfg.py`、`api/md.py` 等用 `_crud.Res` + `_crud.register()` **动态生成**路由（每资源 5 条：list/get/create/update/delete，readonly 2 条），只匹配 `@bp.route` 会整段漏掉。实测：58 个资源 → 260 条生成路由，源真实总数 **759** 而非 499。结论方向没错（覆盖仍完整），但分母说小了 260 条——而且正是这批漏数里藏着 `exec/defect`（不良记录）等 3 个资源在目标侧没有对应 CRUD 挂载，W19 已补。

**重要更正**：我一度口头报过「137/137 = 100%」，**该结论错误并已作废**。原因：静态按 code 对账会把 `exec.pass`≙`exec.passlist` 这类改名重复计；且「菜单有叶子」≠「视图能解析」——未接线的叶子会静默落到 `WipView`（「🚧 建设中」），这正是台账 §9 记录的掩盖陷阱。以浏览器实跑为准后，真实基线是 **105 已接线 / 54 显示建设中**。

---

## 二、数据库对账（无迁移）

源 184 张 SQLite 表，逐张在目标 PG 定位：

- **147 张同名存在**：直接可用。
- **35 张改名 / 合并**（不是缺失）：
  - `erp_*`（24 张）→ SMT canonical 表：`erp_customer`→`customers`、`erp_supplier`→`suppliers`、`erp_material`→`materials`、`erp_warehouse`→`wms_warehouses`、`erp_location`→`storage_locations`、`erp_purchase_order`→`purchase_orders`、`erp_sales_order`→`sales_orders`、`erp_shipment`→`shipments`、`erp_goods_receipt`→`goods_receipts`、`erp_material_issue`→`material_issues`、`erp_inv_movement`→`inventory_transactions`、`erp_stock_count`→`stock_counts`、`erp_stock_transfer`→`stock_transfers`、`erp_equipment`→`equipment_assets`、`erp_maint_plan/record`→`maintenance_plans/records`、`erp_bom(_item)`→`bom_header/bom_item`、`erp_inventory`→**视图**（迁移 390）、`erp_ar/ap`→`oa` schema、`erp_contract`→`procurement_contracts`。
  - `sys_dept` → `departments`（SMT 唯一部门主数据，迁移 334 明确「不建」）。
  - `itf_wms_mo_log` → `itf_api_log`（迁移 272 已并入）。
  - `cfg_load_baseline` → `prd_smt_baseline`；`cfg_station_type` → `md_station.type_code`；`itf_ultrasonic` → `prd_ultra_weld_raw`；`pln_import_log` → `prd_import_log`。
- **2 张 `_bak_20261110`**：手工备份，不迁移。
- **0 张未定位**。

**教训复用**（台账已记过一次）：断言「缺表」前必须查 **live DB 全部 schema**，不能只 `ls database/migrations`。只看迁移文件会误报 47 张「缺」，实跑后 40 张在库里，其余是合并/未引用。

---

## 三、逻辑嫁接（后端 10 条路由）

前几轮 lane 已把源 499 条路由中的 489 条落进 `mesrj`。本轮对账（折叠分隔符 / 参数归一 / 后缀匹配 + **读两侧函数体**）确认 10 条真缺口，全落 `services/api/src/mesrj/gap-routes.js`：

- **JWT 侧**（mesrj 域信封 `{success,msg,data}`）：`GET /smt/mo_variants`、`POST /smt/mo_variant`（写 `ord_mo.feeder_model`）、`POST /smt/load_recommend`（扫料盘→候选站位，机型非前置 + 替代料校准 + 基准兜底）、`GET /plan/kitting`（多阶 BOM 递归展开 + 替代组归并 + 需求/已领/库存三口径）、`GET /report/station-board`（多工位×日期→投入/产出/FPY/NDF）、`POST /md/machine-source/point-to-mo`（路线快照→批量刷 `cfg_machine_source.mo_hint`）、`POST /bind/teardown`（拆壳记 `action='拆壳'`，与「换标=作废」严格区分，否则新铭牌继承旧板履历跳过重测）。
- **设备侧**（X-Api-Key，注册在 JWT 之前）：`GET /DeviceConfig/OpenMo`（PascalCase 契约）、`POST /Device/UltraScan`（校验 + 写 `prd_ultra_scan` + 入队，不写过站）、`GET /Device/UltraScan/recent`。

**改名等价（已存在，不动，避免重复实现）**：`/oqc/po/<id>/gap`≙`/oqc/po_gap`、`/oqc/po/gap-list`≙`/oqc/po_gap_list`、`/oqc/po/ship-check`≙`/oqc/can_ship`、`/exec/panel_preview`≙`/exec/panel/preview`、`/exec/device_health`≙`/exec/device/health`、`/exec/repair/ai_stations`≙`/exec/ai/stations`、`/panel/layouts|layout`≙`/panel/layout/list|save`、`/smt/load_confirm`≙`/smt/load_check`。

**挂载**（§4 硬规则）：全挂 mesrj Router 不写 app 级；`mesrj.js` 仅追加（1 import + 2 register）；`server.js` 仅追加 `DEVICE_OPEN_PATHS` 一个元素 `/mesrj/Device/UltraScan`。

---

## 四、前端嵌入

### W17：源菜单缺落点的 10 屏（`views-w17.tsx`）
超声工位看板 / 超声参数维护 / 拆壳返工 / 老化时效 / 镭雕回读核对 / 成品库龄 / 仪器校准台账 / 治具台账 / 工位质量看板 / 组织架构。
后端零新增（接口早已存在），本轮是 §7 前端镜像：`menu.js` 按源 `api/sys.py` 逐字位置插 10 叶子 + 迁移 396 补 10 条 `menu.<code>` 权限码 + `labels.ts` 206 条三语。

### W18：把 54 个「建设中」叶子降到 12
三种机制，**全部浏览器实跑验证**：

1. **别名 6 个**（源 code → 本仓同一屏的既有视图，不新写组件）：`exec.pass`→`exec.passlist`、`exec.trace`→`exec.tracesn`、`exec.momaterial`→`exec.momaterials`、`report.yield`→`exec.yield`、`qlt.oqcreport`→`report.tpl`、`exec.empcert`→`emp.cert`。
2. **登记式通用列表屏 12 个**：新增 `GenericScreen.tsx`（引擎）+ `screens.ts`（登记表）。信封形状**运行时判别**（array / rows / list / items / data），列缺省按首行键自动出列——不猜列名。覆盖 上岗登记 / 设备接入状态 / 操作日志 / 锡膏回温 / PCB拆封烘烤 / 钢网管控 / 设备上报数据 / AOI·SPI / 机型维护 / 物料消耗 / OQC看板。
3. **ERP 叶子 24 个 → 决策 (b) 跳转，不复制 UI**（`erpJump.ts` + `JumpCard`）：SMT 已有 procurement/sales/finance/wms/maintenance 规范屏渲染**同一批 canonical 表**（实测有真实数据），再套一层 ERP 皮 = 两套界面同一数据迟早漂移，与协议禁止影子表同理。落地零风险：模块选择本就 hash 驱动（`App.tsx:3120`），卡片只写 `<a href="#procurement">`，**未动共享 `App.tsx` 一行**。

### 仍余 12 屏（如实分级，未做）
- **7 个真·交互工作流**（需专用组件，且会写库 confirm/judge/scrap，须造 scratch 行验证后删净）：上料防错 `exec.loading`、DIP 过站 `exec.dippass`、首件与点检 `exec.fa`、SN 绑定追溯 `exec.tracebind`、OQC 出货抽检 `qlt.oqc`、OQC 逐项检验录入 `qlt.oqccheck`、基础数据维护 `cfg.basic`（14 页签）。
- **4 个便宜**（后端已返回真实数据，只是我没登记）：上料基准 `smt.baseline`（`/smt/baseline/list`）、OQC 检验记录 `qlt.oqclist`（`/oqc/list`）、系统参数 `sys.param`（`/sys/param/list`，`{group,items[]}` 需小定制视图）、AQL 标准 `qlt.aqlstd`（`/oqc/aql/std`，对象映射）。
- **1 个缺后端**：不良记录 `exec.defect`——`/exec/defect` 实测 404。数据可派生（`prd_pass WHERE result='NG'` + `md_defect` + 维修队列出 handle 状态），约 40 行 SQL 即可补。**不做假界面**：对着不存在的端点渲染永远空的表没有意义；把它指到 `/exec/repair/list` 是语义错误（那是「已被维修台接走的板」，不是「全部 NG 过站事件」）。

> 另更正：上一版把剩余写成「9 工作流 + 1 defect + 2 未匹配」，其中「2 未匹配（机型维护 / 工单物料反追溯）」是误判——两者其实已接线（`md.model` 在 `screens.ts`、`exec.momaterial` 在别名表）。

---

## 五、验证

**闸门（§8 全绿，对当前 worktree）**：`node --check` 0 · `check:syntax` 394 · `check:register-deps` OK · `check:route-census` 2883(+157) · `check:auth-order` stranded=0 · `check:route-shadowing` dead_guards 10=10 · `check:migrations` 366 · `typecheck` 0 错 · `check:i18n` 6082 三语齐 · `test:unit` 507 过/2 跳 · `check-db-ownership` 全合规。

**实时调用证据**：
- 后端：临时 API :8093 + JWT 逐条实调 10 条新路由；`kitting` 递归展开 demand_total=600=3×2×100 且 SFG 段 excluded_cnt=1；`point-to-mo` 实改 `mo_hint` OLD→MO + 审计；设备侧无 key/错 key 401（fail-closed），正确 key 200。探针数据与临时密钥 `finally` 删净（left=0）。
- 前端：headless Chromium 实跑，重启 API 后 `/menu` 叶子 166→176；逐屏点开，W17 10/10 渲染真实视图（无「建设中」、无 `[object Object]`）；W18 抽检的登记屏与跳转卡全部 `wip:false`。

**自己写出并修掉的 4 个问题**（按「怎么被抓到」分：2 个静态检查抓到、1 个实跑截图抓到、1 个复核抓到）：
1. 【实跑/截图抓到，静态检查抓不到】共享 `Table` 对每格 `String(v)`，把 React 元素渲染成 `[object Object]`（组织架构页暴露）→ 加 `cellVal`（`isValidElement` 直接渲染，否则 String）。
2. 【tsc 抓到】`GenericScreen` 对可选 `def.columns` 直接 `.filter`（TS18048 possibly undefined）→ 与表格同一处解析列（显式优先，留空 autoCols）。
3. 【tsc 抓到】用了 `Promise.withResolvers`，本仓 tsconfig lib < ES2024（TS2550）→ 回 executor 形式并注明原因。
4. 【复核抓到，非代码 bug】台账条目一度插错位（在 W17 之前）且含乱码片段 → 已按时间序移到末尾并修正。
> 更正：上一版把这 4 条一律写成「静态检查抓不到」，不准确——#2/#3 正是 `npm run typecheck` 报出来的。只有 #1 是静态检查的盲区（React 元素被 String 化，类型合法）。

---

## 五b、W19（2026-11-23）：Tier-1 补齐，建设中 12 → 7

- **发现分母错误**：源用 `_crud.Res` 动态生成 260 条路由，此前对账只匹配 `@bp.route`，整段漏数。真实源路由 **759**。重跑对账：499 字面（hit 490 / miss 9，9 条均为已验证改名等价）+ 260 CRUD（**58/58 资源全命中**）。
- **补 3 个缺失 CRUD 资源**（`mesrj.js` 新增 `EXEC_RES` + `router.use("/exec", execCrud)`，权限照源 `prod.trace`/`prod.pass`，两把键本仓已有）：`exec/defect`（不良记录，5 条）、`exec/mroute`（工单路线快照，5 条）、`exec/routechg`（路线变更，5 条）。共 15 条端点从 404 → 200。注册位置在所有显式 `/exec/*` 之后，`/:name` 只吃两段，抢不走 `/exec/trace/material`（实测仍按其原契约返 400）。
- **前端 5 屏**：`exec.defect`（表格 + 按状态分支的两个行内动作：待处理/维修→去维修、非报废→报废）、`smt.baseline`（+固化/清除）、`qlt.oqclist`（登记式）；`sys.param`（分组参数编辑器）、`qlt.aqlstd`（5 参数 + 批量→抽样方案速查）走新 `views-w19.tsx`。`去维修` 用 `goto` 动作把 SN 带进维修作业台并自动查上下文（`RepairDeskView` 加 `initialSn`）。
- **自己写出并当场抓到的 2 个 bug**：
  1. **裸 i18n 键**：`GenericScreen` 直接渲染 `f.label`/`c.label`，而这些是键名不是文案 → 界面显示 `w18.c.station`、`w19.c.defectCode`。**这是我 W18 那轮就带病提交的东西**：当时只断言了 `wip:false`/`hasTable` 这类布尔，没检查渲染出的文字，所以没发现。修法：统一过 `L()`（`t()` 查不到原样返回，故键名与 `"SN"` 这类字面量都安全）；并对**全部 16 个登记屏**扫一遍裸键（`problems: []`）。
  2. **差点改错**：我以为 `GenericScreen` 会自动加 `f_` 前缀，把 `key: "f_station_code"` 改成 `"station_code"`。核对后端 `registerCrud`（`if (!k.startsWith("f_")) continue`）后确认原写法才对，已回滚——改错会让筛选静默失效（不报错、只是不过滤）。
- **实跑证据**：种 1 条 scratch 不良记录 → 表格出真行（时间/SN/工单/工序/工位/不良码/根因/处理/次数）、动作按状态正确显隐、点「去维修」落到维修作业台且 SN 已带入并自动加载上下文；随后 `DELETE` 清干净（表回到 0 行）。
- **闸门**：typecheck 0 · test:unit 507 过/2 跳 · check:i18n 6082 · register-deps OK · route-census 2883（CRUD 是参数化挂载，计数不变，符合预期）· auth-order stranded=0 · shadowing 10=10。

---

## 六、推送与边界

**共享分支不可安全单独提交我的改动**：`deploy/wms-oa-sync-20261120` 上 `mesrj.js`(+223)、`server.js`(+587)、`labels.ts`(+293)、`index.tsx`、`menu.js`、本台账，都是**多 lane 未提交工作逐行交错**；且提交期间 HEAD 被其他 agent 连续推进（`41f3750`→`ba8ddaf`→`940ee18`）。用 `commit` 工具按行归属核对后确认：只提交我的行会让分支起不来（`gap-routes.js` import 的 `ultra.js`/`device-key.js` 是其他 lane 未跟踪文件），提交整片则等于替别人认领其未完成工作。

**做法**：只提交**我单独撰写的 9 个文件**，推到独立分支 `wip/mesrj-graft-snapshot-20261123`（提交 `13abcfdc7`），**不碰 `origin/deploy/…`**。该快照是**归档，非可独立启动的功能**——提交信息里已写明。完整功能在全量 worktree 里验证通过，待各 lane 收敛后作为一个可评审批次落地。

**红线遵守**：未动活体 WMS/OA、未动 `harness/END-TO-END.md`、未 `git add -A`（仓库根有 750+ 临时文件）、`.env` 未入库（已 gitignore）、`server.js` 只追加 1 个数组元素、`mesrj.js` 只追加 import + register。

---

## 七、下一步

1. 补 `GET /exec/defect`（约 40 行，无新表），不良记录进通用引擎。
2. 登记 4 个便宜屏（`smt.baseline`、`qlt.oqclist` 进 `screens.ts`；`sys.param`、`qlt.aqlstd` 各一个小定制视图）。
3. 7 个真工作流按现场实际是否使用排优先级——不做没人开的界面。
4. 各 lane 收敛后，把整片 mesrj 嫁接作为一个可评审批次提交到 `deploy/…`。
5. 源 6 张 PDA 独立页 + `board.html` 大屏属另一套界面，按需另开。

**续做入口**：`.factory/W18-frontend-embedding-state.md`（已验证端点、响应形状、已完成/待办清单）。
