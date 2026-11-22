# WMS 页面逐页审计报告（page-audit-wms）

审计日期：2026-11-21 · 审计人：WmsPageAudit · 环境：http://127.0.0.1:5178/（Vite dev）+ API :8080 · 登录 admin / Factory@123
方法：真实浏览器逐 tab 驱动（`?view=wms&wmsTab=` SPA 导航 + factory:navigate），记录 requests()/errors()/DOM 表格与文案；核心流程用只读 SELECT 对账；后端写路径逐行核对。截图存 `ui-eval/wms/`（11 张）。逐页原始证据见 `local://wms-audit-raw.md`（109 条）。

## 0. 总体结论

**WMS 104 个 tab 中约 70 个在当前运行环境下拿不到任何真实数据。** 根因不是单页 bug，而是三层系统性断裂：

1. **API 前缀断裂（最大根因，~60 页）**：`apps/web/src/api/wms.ts` 的绝大多数调用走裸路径 `/wms/*`（apiClient base=""，client.ts:11-13 注释声称"wms 挂在 app 根路径无需 /api"）。但运行中的 Vite 只代理 `/api` 与 `/api/pda`（vite.config.ts:63-68，**无 rewrite**），裸 `/wms/*` 落进 Vite 的 SPA fallback，返回 **HTTP 200 + index.html**。前端于是显示"接口 … 返回了网页 HTML，而不是 JSON"横幅，或更糟——**静默空态**（catch 吞掉解析错误）。实测：`:5178/wms/receiving-queue` → 200 text/html（Vite index）；`:8080/api/wms/receiving-queue` → 404（后端也没有 /api 孪生路由，仅 mes-sync/graft/ops/counting 等少数模块注册了双路径）。生产 nginx 同样只代理 /api → **这不是 dev 独有故障**。
2. **权限命名分裂（admin 也 403）**：登录 JWT 权限来自 DB `role_permissions⋈permissions`（server.js:13248 getPermissionsForRole）。admin 实际只有 `wms.view / wms.execute / wms.write / wms.sync.manage`（DB 实测），而大量路由要求 `wms.read`（8 处）、`wms.iqc`（server.js:21288）、`wms.receive`、`production.view` 等——**这些权限码存在于 permissions 表但没有授予 admin**。结果：来料登记 incoming、锡膏 solderPaste、有效期 openings、生产入/出库、IQC 提交等对管理员一律 403。auth/index.ts:96 的 ROLE_DEFAULT_PERMISSIONS 与 DB 授权表是两套口径。
3. **写路径假闭环**：发料页"全部发料/扫码发料"只改 React state，不发任何请求（WmsIssue.tsx handleScan:144 / handleIssueAll:191，txLog 纯本地）；盘点提交走 ADJUST 且 `Math.abs(variance)` 把盘亏变成盘盈（WmsCycleCount.tsx:133 + server.js:19627-19630）；退料/退供应商/上架按钮的后端路由真实存在（server.js:20035/20119/20209），但页面读不到批次列表，按钮无从触发。

另有：rjvn 镜像与 canonical 口径分歧 **24 批**（DB 实测）；整页崩溃 6 个（ErrorBoundary 误标"3D组件崩溃"）；i18n 缺键在 zh-CN 下直接渲染原始 key（iqcReport/supplierKpi/qualityTrend/qms.* 等）。

## 1. 核心流程工作流地图（按实际实现，非设计意图）

```
供应商Portal标签 ──(materialReceiving/pdaReceiving: 读 pre-receiving-manifests ✗HTML)
      │  页面显示 3 条 PO-TEST-RECV-001 演示数据（demo fallback，非真实库存）
      ▼
收料 receiving ──POST /api/receiving (server.js:29047, wms.receive)──► material_lots(iqc_status=pending)
      │  读 /wms/receiving-queue (server.js:20366) ✗HTML → 队列空
      │  DB 实测：210 批 / 2,153,385 件，其中 pending 182
      ▼
IQC iqcInspect ──GET /wms/material-lots?iqcStatus=pending ✗HTML → "暂无数据"（DB 有 182 待检！）
      │  提交 POST /wms/iqc/inspections (server.js:21288, 需 wms.iqc → admin 403)
      │  替代通道：graftOps 移植作业台 ✅ 唯一真实可判定的 IQC 入口
      │    GET /api/wms/iqc/pending (wms-graft.js:56, rjvn_iqc_lot 100 批 pending)
      │    POST /api/wms/iqc/lot/:id/judge (wms-graft.js:114, uuid 校验，写 rjvn 镜像)
      │    ⚠ 判定写的是 rjvn_iqc_lot，不是 material_lots → 镜像/canonical 进一步分叉
      ▼
上架 putaway ──GET released lots ✗HTML → 空（DB 有 27 批 released 无库位）
      │  写 POST /wms/put-away (server.js:20209, wms.execute) 真实存在但页面无法触发
      ▼
备料 picking ──GET /wms/pick-orders (server.js:19235, 无鉴权!) ✗HTML
      │  数据源=work_orders(released/running)+wms_collect_orders(COLLECTED 行)
      │  DB 实测 released/running 工单=0 → 修好前缀后也是正确空态
      │  写 POST /wms/transactions action=PICK (server.js:19475/19585, reserved_qty+=)
      ▼
发料 issue ──读 collect-order/pick-orders（wmsApi，裸路径 ✗）
      │  ⚠ handleScan/handleIssueAll 纯前端 state，0 请求 → 假闭环
      │  真实写路径 ISSUE_TO_LINE 在 server.js IQC_ALLOW_MAP(19455) 有定义，前端未接
      ▼
交接 woHandover ──POST /wms/work-orders/:wo/handover (server.js:19803/19913 读, wms.view) ✅路径正确
      ▼
闭环 closure ──GET /wms/closure/dashboard (server.js:39731, v_wms_closed_loop_dashboard) ✗HTML
```

**对账结论**：页面显示 0 批 / 0 件 vs DB 210 批 / 2,153,385 件 / 27 released / 182 pending / 795 open 盘点会话 / 5 超领单 / 2 欠款单 / 3 返工单 / 1 MRB / 7 不良移库。凡是走 `/api/*` 新模块的页面（defectiveMove 7r、overPicking 5r、rework 3r、supplierDebt 2r、mrb 1r、supplierReturnOrder 1r、lifecycle 200r、graftOps 100 待检）数字与 DB 一致；凡走裸 `/wms/*` 的页面全部为 0。近 24h inventory_transactions = 0 条（所有写按钮要么断要么假）。

## 2. 逐页明细表（104 tab）

状态图例：✅正常(真实数据) / ⭕正确空态 / 🟡静默空态(有数据却显示空,无报错) / 🔴报错(HTML横幅/403/404/500) / 💀崩溃 / ⚫死页(静态/无API) / 🎭演示数据

### 2.1 首页与看板（overview 组）
| 页面 | 信息内容 | 逻辑/工作流 | 状态 | 问题/证据 |
|---|---|---|---|---|
| dashboard | 11 组导航卡+采购闭环流程图 | WmsMenuPage 菜单枢纽(App.tsx:1856)，无数据请求 | ⚫菜单页 | 设计如此；"首页"无 KPI 数字 |
| closure | 异常/审批/冻结/交接/超时监管 3 表 | GET /wms/closure/dashboard→v_wms_closed_loop_dashboard(server.js:39731) | 🔴HTML | ui-eval/wms/（closure 横幅）；Pending/Overdue 全 0 |
| rjvnClassic | 旧版 WMS 全菜单复刻(收料单列表) | /rjvn-receipt/pending ✗HTML；POST submit-iqc/preview 404 | 🔴 | 与 canonical 双轨并存 |
| rjvnData | 源库只读镜像浏览(物料/供应商计数) | /rjvn-wms/summary,tables,data/:table(server.js:29564-29586) ✗HTML | 🔴 | rjvndata-html-error.webp；计数全 0 |
| rjvnCanonical | 导入后正式表只读视图 | /canonical-data/summary(rjvn-canonical-api.js:46) ✗HTML | 🔴 | 永久"加载中…" |
| notices | MRB/返工/退供/盘点消息 | /api/notices/list ✅ | ⭕ | "暂无消息"为真实空态 |
| finishedGoods | 成品库存/出货单/SN追溯 | /api/wms/finished-goods ✅ | ⭕ | No finished goods 真实空 |
| shelfApi | 15 个货架接口逐个测试台 | 手动触发 /api/shelf/* | ⚫工具页 | 15 Idle 待手动运行 |
| shelfSim | 货架模拟 | 3D 组件 | 💀崩溃 | "3D组件崩溃"ErrorBoundary |
| shelfSim3d | 3D 货架入口说明 | 静态占位(App.tsx:1918) | ⚫占位页 | 指引去主厂房→视图 |
| sqlConsole | GM_WareHouse SQL Server 任意 SQL 控制台 | /api/sql/tables 401；后端已删除该路由(server.js:33860 注释) | ⚫死页 | 页面还在宣传"可执行任意 SELECT/INSERT/UPDATE/DELETE"——应下架 |

### 2.2 收料管理（receivingManagement 组）
| 页面 | 信息内容 | 逻辑/工作流 | 状态 | 问题/证据 |
|---|---|---|---|---|
| receiving | 扫码收料+待检队列+QR绑定清单 | 读 /wms/receiving-queue(server.js:20366) ✗HTML；写 POST /api/receiving(server.js:29047,wms.receive) | 🔴HTML | receiving-html-error.webp；"0 待检" vs DB 182 pending |
| materialReceiving | 待收 PO 清单+箱QR绑定+PDA设备表 | /wms/receiving/pre-receiving-manifests 等 6 端点全 ✗HTML；xlsx 静态导入 | 🎭演示 | materialreceiving-demo-fallback.webp：PO-TEST-RECV-001/测试供应商A 3 条为前端兜底演示数据，冒充"3 项待收" |
| pdaReceiving | 同 materialReceiving（PDA 收货视图） | 同上 | 🎭演示 | 同一组件复用(App.tsx:1932 注释) |
| pdaReceivingMobile | 手机版箱码收料 3 步 | fetch("/api/wms/receiving/pre-receiving-manifests") 404（该路由只注册裸路径）；pda-devices ✅ | 🔴404 | WmsPdaReceivingMobile.tsx:348 前缀用反了；仍显示 3 条 PO-TEST 演示 |
| returnReceive | 产线退料表单 | 读 material-lots ✗HTML；写 POST /wms/return-from-line(server.js:20035,wms.execute) | 🟡静默空 | 无批次可选，按钮不可达 |
| supplierReturn | 退供应商（rejected/hold 批次） | 读 ✗HTML；写 POST /wms/supplier-returns(server.js:20119) | 🟡静默空 | "无不合格批次" vs DB 1 rejected |
| salesReturn | 销售退货记录表 | 无任何 API；useState([]) | ⚫死页 | WmsSalesReturn.tsx:45 渲染原始键 wms.newReturn |
| inboundOrders | 入库单列表(7状态过滤) | /wms/inbound(_document_apis.mjs:80) ✗HTML | 🔴HTML | 共 0 条 |
| poReceipt | PO到货→QR→待检仓 | /wms/receiving/qr-bindings,pre-iqc,/qms/iqc/guidance-documents ✗HTML | 🔴HTML | WmsIqcFlowPages 复用组件 |
| putaway | 推荐库位+上架动作+最近PUT_AWAY | 读 released lots ✗HTML；写 POST /wms/put-away(server.js:20209) | 🔴HTML | DB 27 批 released 待上架，页面"暂无数据" |
| qrBinding | 系统QR收货单绑定待检仓位 | /wms/receiving/qr-bindings ✗HTML | 🔴HTML | 表头 1 行占位 |
| materialLoading | PDA上料追溯(MES权威) | /api/smt/loading/records ✅ | ⭕ | 0 绑定为真实空态 |
| syncHealth | 多PDA收料设备+MES交换事件/冲突 | /wms/mes-exchange/events(server.js:22154) ✗HTML；DB mes_wms_exchange_events=0 行 | 🔴HTML | PDA-RECV-01 ONLINE 为前端模拟状态 |
| mesSync | MES-WMS 同步中心(状态/配置/待同步/回写/日志) | /wms/mes-sync/* 5 端点全 ✗HTML（/api/wms/mes-sync/* 孪生存在且 200！） | 🔴HTML | messync-html-error.webp；**唯一修前缀即活的同步页**，14 条后端路由就绪 |

### 2.3 IQC 检验（iqcManagement 组）
| 页面 | 信息内容 | 逻辑/工作流 | 状态 | 问题/证据 |
|---|---|---|---|---|
| iqc | IQC虚拟员工工作台+待检队列 | /qms/iqc/virtual-employee/tasks 等 ✗HTML；/api/wms/incoming 403 | 🔴 | "IQC 正在重新连接"永久转圈 |
| iqcInspect | 待检批次→抽样→PASS/FAIL/HOLD | 读 pending/hold ✗HTML；写 POST /wms/iqc/inspections(server.js:21288,**wms.iqc→admin 403**) | 🟡静默空 | "暂无数据" vs DB 182 待检；WmsIqcInspection.tsx:144 原始键 wms.selectLot |
| iqcClosedLoop | 收货建批→抽样→判定→分流→整改→关单 | /quality/iqc-loop/dashboard ✗HTML | 🔴HTML | 3 表全占位行 |
| iqcDefectLoop | 不良闭环(收货todo→QR→移除) | /wms/receiving/qr-bindings ✗HTML | 🔴HTML | |
| iqcInspectionLevels | 严格度等级+人工判定事件 | /qms/iqc/inspection-levels 等 4 端点 ✗HTML | 🔴HTML | |
| iqcReport | 供应商合格率报表 | useState([])，无 API(WmsIqcReport.tsx:20) | ⚫死页 | iqcreport-raw-keys.webp：表头直接渲染 wms.totalInspections/wms.passCount |
| iqcStandards | IQC 标准(编码/物料/版本/检验项) | /wms/iqc/plans(server.js:21126) ✗HTML | 🔴HTML | 表头 common.version/wms.testItem 原始键 |
| iqcTemplates | 检验模板库(包装/外观/尺寸AQL) | /wms/iqc-templates(wms-parity.js:36) ✗HTML | 🔴HTML | |
| iqcPassMaintenance | 合格结果维护→解绑QR转良品仓 | /wms/receiving/qr-bindings ✗HTML | 🔴HTML | |
| defectArchive | 不良品档案+栈板移除 | /quality/iqc-defect-cases ✗HTML | 🔴HTML | |
| iqcReinspection | 复检档案 PASS/FAIL+重建有效期 | /quality/iqc-reinspections ✗HTML | 🔴HTML | |
| pdaIqc | PDA IQC 检查(设备1/5台) | /wms/pda-inspection-records ✗HTML | 🔴HTML | |
| rjvnIqc | 源WMS待检+严格度转移+抽样判定 | /rjvn-iqc/stats(rjvn-iqc.js:731) 等 ✗HTML | 🔴HTML | 可写判定→只写镜像表 |
| qualityTrend | 周质量趋势 | useState([])(WmsQualityTrend.tsx:14)，无 API | ⚫死页 | 全原始键 wms.qualityTrendDesc 等 |
| graftOps | **移植作业台**：IQC判定/拣料审批/盘点确认/库存导出/有效期延期 | /api/wms/iqc/pending(wms-graft.js:56)✅100批；judge(:114)写 rjvn_iqc_lot；count/open(wms-ops.js:207)✅795会话 | ✅正常 | graftops-working.webp；**当前唯一能真实判定 IQC 的页面**，但写镜像不写 canonical（口径分歧源头） |

### 2.4 仓库管理（warehouse 组）
| 页面 | 信息内容 | 逻辑/工作流 | 状态 | 问题/证据 |
|---|---|---|---|---|
| inventory | 库存批次+库位双表+Roll QR校验 | /wms/material-lots,storage-locations ✗HTML | 🟡静默空 | inventory-silent-empty.webp：0 行无报错 vs DB 210 批/2,153,385 件 |
| inventoryControl | 库存控制中心(数量/位置/台账/时限) | 3 端点 ✗HTML | 🟡静默空 | 0批次/0可用/0库位/0超时 |
| cycleCount | 按库位盘点 | 读 material-lots ✗HTML；提交 postTransaction("ADJUST",{qty:Math.abs(variance)})(WmsCycleCount.tsx:133) | 🟡静默空+逻辑bug | **盘亏被 abs 变成盘盈**：server.js:19627-19630 ADJUST=received_qty+qty；且 catch 吞错继续；不写 count_sessions（DB 795 open 会话无人消费） |
| transferAdjust | 移库/调整+最近事务 | /wms/inventory-transactions ✗HTML | 🔴HTML | 表头 wms.txNo 等原始键 |
| expiryControl | 超期管控(≤7d/≤30d/OK) | /wms/inventory-expiry(wms-parity.js:129) ✗HTML | 🔴HTML | wms.expired 原始键 |
| lifecycle | 有效期台账5Sheet(台账/预警/复检/开封/报废) | /api/lifecycle/lots ✅200行；**opensings 需 wms.read→admin 403**(lifecycle.js:152) | ✅部分 | lifecycle-working.webp；台账真实，开封/烘焙子页 403；API base 自行拼 :8080(WmsLifecycleDashboard.tsx:25-34)绕过代理——第三套 base 约定 |
| fifoMonitor | FIFO 违规监控 | material-lots ✗HTML | 🟡静默空 | "合规率100%"是 0 数据算出来的假指标；wms.checkFifo 原始键 |
| fifoSimulation | 按接收日期 FIFO 分配模拟 | material-lots ✗HTML | 🟡静默空 | 物料下拉空 |
| defectiveMove | 不良品移库(新建/确认/完成) | /api/defective-move/list✅7行+pending-count+locations；写 server.js:43132/43170 | ✅正常 | 7r 与 DB 一致 |
| transactions | 库存事务履历 | /wms/inventory-transactions ✗HTML | 🔴报错 | transactions-error.webp：整页只剩错误行 |
| batchManagement | 批次/SN 管理+IQC状态过滤 | material-lots ✗HTML | 🟡静默空 | "0 / 0 lots" |
| locationManagement | 库位精细化+3D布局+QR打印 | /api/3d/wms-layout✅ + /wms/storage-locations✗HTML + /wms/stock✗ | 🔴混合 | 3D 有布局，库位表 0/0 |
| rjvnInventory | 源WMS库存查询/移库/锁定 | /rjvn-inventory/* 5端点 ✗HTML | 🔴HTML | |

### 2.5 领料与发料（issuingManagement 组）
| 页面 | 信息内容 | 逻辑/工作流 | 状态 | 问题/证据 |
|---|---|---|---|---|
| picking | 待领取物料清单(按工单) | GET /wms/pick-orders(server.js:19235,**无鉴权中间件**) ✗HTML；写 PICK(server.js:19585) | 🔴HTML | DB released/running WO=0→修好也是空态；pick-orders 裸路由无 requirePermission 是安全口径不一致 |
| issue | 扫码料卷发料+全部发料 | 读 collect-order ✗；**handleScan(:144)/handleIssueAll(:191) 纯 setState，0 API** | ⚫假闭环 | 点"全部发料"显示"Issue complete"但 DB 无任何写入；operator 硬编码 VN_WH_010 |
| requisitions | 领料单(7状态) | /wms/requisition ✗HTML | 🔴HTML | |
| slips | 发料/收料单据留痕+流程总览 | /wms/slips(server.js:23459),picking-status,shortages,collect-activity ✗HTML | 🔴HTML | |
| materialDistribution | 配送电子单控制台 | /wms/fetch-packages ✗HTML | 🔴HTML | |
| woHandover | 工单物料交接(仓库→产线签收) | 输入工单后 GET handover-pending/history(server.js:19803/19913,wms.view)；POST handover 写 wms_wo_handover | ⭕待输入 | 路径与权限正确，未输入工单前不发请求（设计如此） |
| outboundOrders | 出库单 | /wms/outbound ✗HTML | 🔴HTML | |
| returnSlips | 退库单 | /wms/return ✗HTML | 🔴HTML | |
| replenishments | 补料对账(引用原领料单) | /wms/replenishment ✗HTML | 🔴HTML | 需求/可用表为占位行 |
| overPicking | 超量领料审批 | /api/over-picking/list✅5行；写 server.js:42616/42710(requireRole admin等) | ✅正常 | 5r=DB 5 |
| pdaConsumption | 物料实时状态与位置(输入SN查) | 无初始请求 | ⭕待输入 | 流程引导页 |
| rjvnPicking | 源WMS拣货审批/FIFO扣库存/签收 | /rjvn-picking/* ✗HTML | 🔴HTML | |
| rjvnDocFlow | 盘点/MRB/退供/超领镜像单据 | /rjvn-doc/stock-take/list ✗HTML | 🔴HTML | 自述"镜像表源数据为空，导入后可用" |
| productionInbound | 成品入库+QC确认 | /api/production/orders,fg **403**(admin 缺 production.view) | 🔴403 | 0/0 工单 |
| productionOutbound | 工单发料 | /api/production/orders **403** | 🔴403 | |
| materialConsumption | 消耗实时看板(15s刷新) | /wms/material-consumption-summary ✗HTML | 🔴HTML | |
| smtClosedLoop | WMS库存→PDA上料→NPM消耗→BOM核销 | /api/wms/smt-loop/dashboard ✅ | ✅正常 | 异常/事件表真实(当前少量行) |
| nonSmtClosedLoop | 逐件SN/批次计量/包装绑定闭环 | /api/wms/non-smt/dashboard ✅ | ⭕ | 已分类物料0为真实空 |
| nonIqcClosedLoop | 非IQC收货验证/领用/借还/关单 | /api/wms/non-iqc/dashboard ✅ | ⭕ | 真实空 |
| mesSync(同组复用) | 见 2.2 | | 🔴 | |

### 2.6 退货·返工·MRB（returnsRework 组）
| 页面 | 信息内容 | 逻辑/工作流 | 状态 | 问题/证据 |
|---|---|---|---|---|
| supplierReturnOrder | MRB退供出库单 | /api/supplier-return/list✅1行；写 supplier-return.js | ✅正常 | SR2026112000x 真实 |
| lineReturn | 产线退料回仓→QR→IQC复检 | /wms/receiving/qr-bindings ✗HTML | 🔴HTML | |
| rework | 返工修复管理(6状态) | /api/rework/list✅3行；写 server.js rework 路由 | ✅正常 | 3r 真实 RW20261x |
| reworkComplete | 返工完成回仓→新QR→复检 | qr-bindings ✗HTML | 🔴HTML | |
| mrb | MRB评审(草稿→预审→终审) | /api/mrb/list✅1行；**/api/mrb/reviewer-candidates 500**；写 mrb.js:167+ | ✅部分 | 评审人候选接口 500→发起MRB时选不了评审人 |
| mrbApproval | MRB/OA审批 | /quality/iqc-mrb-tasks ✗HTML | 🔴HTML | 与 mrb 页双轨 |
| mrbReworkReturn | MRB返工回仓 | qr-bindings ✗HTML | 🔴HTML | |
| subcontractReturn | 外协完工回厂 | qr-bindings ✗HTML（复用组件缓存banner） | 🔴HTML | |
| scrapFinanceApproval | 报废财务审批→仓库执行 | /quality/iqc-scrap-finance-approvals ✗HTML | 🔴HTML | |
| supplierDebt | 供应商欠款(待处理/结算/作废) | /api/supplier-debt/list✅2行；写 supplier-debt-hooks.js:117/128(settle/create) | ✅正常 | 2r 真实 SD202x |

### 2.7 辅料与特殊物料（specialMaterials 组）
| 页面 | 信息内容 | 逻辑/工作流 | 状态 | 问题/证据 |
|---|---|---|---|---|
| msd | MSD 开封/烘焙/移库 | fetch("/api/lifecycle/openings") 需 wms.read→403；组件对 undefined .toFixed 崩溃 | 💀崩溃 | ErrorBoundary 误标"3D组件崩溃"；WmsMsd.tsx:194 |
| solderPaste | 锡膏批次/回温/搅拌/报废 | fetch("/api/solder-paste/*") **401**(裸fetch无token,WmsSolderPaste.tsx:132)；带token也403(wms.read,server.js:20411) | 💀崩溃 | solderpaste-crash.webp：TypeError undefined.toFixed |
| auxiliary | 辅料管理 | 同类崩溃 | 💀崩溃 | 同 ErrorBoundary |
| pdaMsd | PDA MSD | 同类崩溃 | 💀崩溃 | |

### 2.8 追溯（traceability 组）
| 页面 | 信息内容 | 逻辑/工作流 | 状态 | 问题/证据 |
|---|---|---|---|---|
| traceability | 批次履历搜索 | 输入后查询 | ⭕待输入 | |
| materialTrace | 物料流程追踪(批次/QR/栈板) | 输入后查询 | ⭕待输入 | |
| wms3dFlow | 3D WMS流程模拟(节点跳转) | troika 字体从 jsdelivr CDN 加载✅ | ✅正常 | 依赖外网 CDN，工厂内网断网则 3D 文字失效 |

### 2.9 基础数据（basicData 组）
| 页面 | 信息内容 | 逻辑/工作流 | 状态 | 问题/证据 |
|---|---|---|---|---|
| basicData | 子模块选择_hub | 无 API | ⚫菜单页 | |
| materialMaster | 物料主数据(编码/越南料号/库存/IQC) | material-lots ✗HTML；写 setLowStockLevel | 🟡静默空 | "0 lots" |
| materialBarcodeLoop | 供应商标签→入库标签→打印履历 | xlsx 静态文件✅173行；/wms/material-roll-labels✗；POST resolve-bom-fields/import-sheet1 **404** | 🔴混合 | 173 行来自 public/material_label_master.xlsx 静态文件，非 DB；两个导入按钮 404 死按钮 |
| substitution | 主料→替代料放行表 | /wms/material-substitutions(wms-parity.js:101) ✗HTML | 🔴HTML | |
| supplierManagement | 供应商全生命周期SRM+Excel导入导出 | /wms/suppliers ✗HTML | 🔴HTML | |
| supplierKpi | 供应商KPI(不良率/交期/拒收) | suppliers=[]硬编码(WmsSupplierKpi.tsx:26)，无 API | ⚫死页 | 全原始键 wms.supplierKpiDesc 等 |
| incoming | 来料登记(新建/免检/提交) | /api/wms/incoming **403**(wms.read) | 🔴403 | 表头 wms.incoming.all 等原始键 |

### 2.10 质量管理（quality 组，复用 QMS 组件）
| 页面 | 信息内容 | 逻辑/工作流 | 状态 | 问题/证据 |
|---|---|---|---|---|
| qualityDashboard | 质量KPI总览 | /qms/kpi/summary ✗HTML | 🔴 | 渲染 qms.loadError 原始键 |
| oqc | 出货检验批次 | /qms/oqc/batches ✗HTML | 🔴 | 表头全 qms.* 原始键（QMS 组件用 useTranslation/react-i18next，WMS 壳用 t()/i18n.ts，两套字典没接通） |
| ngManagement | 不良品案例 | /qms/ng/cases ✗HTML | 🔴 | 同上 |
| eightD | 8D报告 | /qms/8d ✗HTML | 🔴 | 同上 |

### 2.11 料架与协同（devices/collaboration 组）
| 页面 | 信息内容 | 逻辑/工作流 | 状态 | 问题/证据 |
|---|---|---|---|---|
| smartShelf | 4接口联调测试台(Mock可选) | 手动触发 | ⚫工具页 | Mock state 4 shelves |
| shelfOps | 货架控制器 LightOn/ShelfIn/ShelfOut | SHELF_CONTROLLER_URL=192.168.6.118:8093(server.js:27436)；页面显示 10.100.29.151:8093 | ⚫工具页 | 前后端控制器地址不一致；内网硬件不可达 |
| rackSim | 料架槽位监控 | 等待实时数据(无请求) | 🟡静默空 | "离线/总槽位0" |
| smartRack | 料架库存/入出库/LED引导 | /wms/shelf/rack-cells/RAW-A,rack-status ✗HTML | 🔴HTML | 预警计数全 0 |
| smartRackWorkflow | 上料流程演示(角色/步骤) | 静态流程 | ⚫演示页 | |
| pdaCycleCount | PDA 盘点 | material-lots ✗HTML | 🟡静默空 | "暂无处盘点" |
| pdaHistory | PDA 检查记录统计 | /wms/pda-inspection-records ✗HTML | 🟡静默空 | button.refresh 原始键；通过率"—" |
| collaboration | 协同看板(急料/MSD/IQC/有效期) | useState(emptyCards)(WmsCollaborationDashboard.tsx:28,37)，无 API | ⚫死页 | 4 卡全 0 |

## 3. 口径分歧（rjvn 镜像 vs canonical，DB 实测）

`rjvn_iqc_lot ⋈ material_lots ON lot_no`：
| 镜像状态 | 镜像结果 | canonical | 批数 |
|---|---|---|---|
| pending | pending | pending | 182 ✓一致 |
| **rejected** | **pass** | **released** | **15** ⚠ |
| **review_pending** | pass | released | 8 ⚠ |
| pass | pass | released | 4（状态名不同，语义一致） |
| **pending** | pending | **rejected** | **1** ⚠ |

**24 批实质性分歧**（15 批镜像拒收但正式表已放行——若仓库按 rjvnIqc/graftOps 页面操作会拒发已放行物料；1 批镜像待检但正式表已拒收——可能被误发）。graftOps 的 judge 只写 rjvn_iqc_lot（wms-graft.js:141-148），不回写 material_lots，分歧会持续扩大。rjvnData 页自述"只读镜像仅参考"，但 graftOps/rjvnIqc 是**可写**镜像——同一系统里"参考数据"和"作业数据"边界已破。

## 4. 问题清单（按严重度）

**P0 系统性**
1. 裸 `/wms/*` 前缀 vs 只代理 `/api` → ~60 页 200-HTML/静默空。修法二选一：wms.ts 全量加 `/api` 前缀 + 后端补孪生路由；或 vite/nginx 增加裸路径代理。client.ts:11-13 的注释与 vite.config.ts:63 现实矛盾。证据：receiving-html-error.webp、inventory-silent-empty.webp、messync-html-error.webp、transactions-error.webp。
2. 权限码分裂：admin 缺 wms.read/wms.iqc/wms.receive/production.view（DB role_permissions 实测）→ incoming/iqcInspect提交/solderPaste/lifecycle开封/生产入出库 403。auth/index.ts:96 默认表与 DB 授权两套口径。
3. issue 页假闭环（WmsIssue.tsx:144,191 零请求）；cycleCount 盘亏变盘盈（WmsCycleCount.tsx:133 Math.abs + server.js:19627）。
4. 6 页整页崩溃（msd/solderPaste/auxiliary/pdaMsd/shelfSim + solderPaste 401 裸 fetch 无 token WmsSolderPaste.tsx:132），ErrorBoundary 文案误标"3D组件崩溃"。

**P1 数据可信度**
5. materialReceiving/pdaReceiving/pdaReceivingMobile 用 PO-TEST-RECV-001 演示数据冒充待收清单（materialreceiving-demo-fallback.webp）。
6. 24 批镜像/canonical 分歧；graftOps 判定只写镜像。
7. fifoMonitor 0 数据算出"合规率100%"假指标。
8. materialBarcodeLoop 173 行来自静态 xlsx 而非 DB；两个导入 POST 404 死按钮。
9. mrb reviewer-candidates 500 → MRB 发起流程断。
10. sqlConsole 死页仍宣传任意 SQL（后端已删路由 server.js:33860）；pick-orders GET 无鉴权（server.js:19235）。

**P2 i18n/体验**
11. zh-CN 下渲染原始键：wms.selectLot(WmsIqcInspection.tsx:144)、wms.newReturn(WmsSalesReturn.tsx:45)、iqcReport 全表头、supplierKpi 全页、qualityTrend 全页、transferAdjust/expiryControl/fifoMonitor/pdaHistory(button.refresh)/incoming 表头、qms.* 全部（QMS 组件 react-i18next 字典未接入 WMS 壳）。
12. 静默空态无报错：inventory/inventoryControl/cycleCount/batchManagement/materialMaster/fifoMonitor/fifoSimulation/pdaCycleCount/pdaHistory/rackSim/returnReceive/supplierReturn/iqcInspect——用户无法区分"没数据"和"接口坏了"。
13. 三套 API base 约定并存：apiClient("")、WmsMsd/SolderPaste("/api")、WmsLifecycleDashboard(自拼 :8080)。
14. shelfOps 控制器地址前后端不一致（10.100.29.151 vs 192.168.6.118）。
15. operator 硬编码 VN_WH_010（issue/picking/cycleCount/putaway），不取登录用户。

## 5. 正常页清单（真实数据对账通过）
graftOps(100待检)、lifecycle台账(200行)、defectiveMove(7)、overPicking(5)、rework(3)、supplierDebt(2)、mrb列表(1)、supplierReturnOrder(1)、smtClosedLoop、nonSmt/nonIqcClosedLoop(真实空)、notices(真实空)、finishedGoods(真实空)、materialLoading(真实空)、wms3dFlow、woHandover(待输入,路径正确)、dashboard/basicData(菜单枢纽)。

截图证据：ui-eval/wms/{receiving-html-error, inventory-silent-empty, messync-html-error, transactions-error, iqcreport-raw-keys, rjvndata-html-error, materialreceiving-demo-fallback, solderpaste-crash, crash-solderPaste, graftops-working, lifecycle-working}.webp