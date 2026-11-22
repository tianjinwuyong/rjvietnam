# UI/结构合并修改计划（2026-11-22）

输入（均已归档 docs/，证据带 file:line 与截图）：
- `frontend-structure-evaluation-2026-11-21.md` — 导航骨架/三域移植保真度/同步锚
- `graft-parity-report-2026-11-21.md` — WMS 62 项/OA/MES 屏幕级 1:1 矩阵
- `page-audit-wms-2026-11-21.md`（+ `wms-audit-raw-2026-11-21.md` 109 条原始证据）— 104 tab 逐页
- `page-audit-mes-2026-11-21.md` — 55 tab 逐页 + 过站/NG/上料三流程端到端
- `page-audit-oa-misc-2026-11-21.md` — OA 59 叶 + 16 管理模块
- `ui-design-report-2026-11-21.md` — 视觉/UX 层 + 重设计草图

红线（沿用 `refactor-plan-2026-11-21.md`）：**活体 WMS/OA 不可改；SMT 单向同步；同步适配器（live-sync/mes-sync/itf/oa shim）冻结契约，只搬不改语义。** 本计划所有条目只动 SMT 仓。

---

## 0. 已落地（2026-11-21/22，本计划不再列）

后端缺口批次（OA 回调幂等+失败关闭、mes-api v1 七路由、wms-mo panel_count、pmc 冻结批次过滤、392/393/394 迁移、IQC 分歧报告+隔离+第 11 闸门）与侧边栏重组（7 业务域组、删 mesrj 死入口、quality 单入口、resolveModuleAccess 接线、heartbeat 同源 /health、wms/mes tab 去重与三语修复）。验证与证据见 `WMS_GRAFT_LOG.md` 2026-11-22 条目。

## 1. 跨域系统性根因（一次修，救百页）

| # | 根因 | 证据 | 修法 | 影响面 |
|---|---|---|---|---|
| R1 | dev vite 只代理 `/api`，裸 `/wms|mes|hr|pmc|qms|reports|finance|admin|pda|quality|traceability|boms` 落 SPA HTML | vite.config.ts:63-68 vs nginx.conf:53；wms 审计 ~60 页、mes ≥16、misc ≈40 | **vite dev/preview 增加与 nginx.conf:53 同口径的裸路径代理**（不动 apiClient 约定，生产已验证）。不选「全量加 /api+补孪生」：那是几百路由的双注册，route-shadowing 基线会炸 | 三域 ~110 页签 |
| R2 | 前端裸 fetch 无 Authorization | StationOperator.tsx:41、MaterialDispatchBoard.tsx:55、ReworkDashboard.tsx:127、NgRevivalManagement.tsx:26,41、SmtMaterialExemptions.tsx:16、RepairStation.tsx:175、ManualLineDashboard.tsx:3861,4245,4369、WmsSolderPaste.tsx:132、PmcPatrolDashboard.tsx:229（还硬编码绝对地址） | 统一改走 apiClient/authHeaders（client.ts:220 已提供）；删绝对地址 | ~12 页 |
| R3 | 后端 `ensureAuthenticated` 把 async `authenticateJWT` 当同步 probe → 懒鉴权路由对有效 JWT 401 | server.js:13537-13547（注释声称同步，13343 实为 async）；/api/plant-manager/exception-requests:7090 带 token 实测 401 | probe 改 await（或路由显式挂 authenticateJWT）；**auth 变更：先枚举 authenticateJWT 内公开路径，跑 check:auth-order** | 例外审批等整组 |
| R4 | 权限种子分裂：admin 缺 wms.read/wms.iqc/wms.receive/production.view/finance.view/reports.view → 菜单可见接口 403 | DB role_permissions 实测；auth/index.ts:96 默认表与 DB 两套口径 | **种子收敛 migration**：把 ROLE_DEFAULT_PERMISSIONS 与 DB 授权对齐（admin 全量、角色按矩阵），前端 roleModuleAccess 已对齐矩阵不动 | incoming/iqc 提交/finance/reports/生产入出库 |
| R5 | HR 全 API 500：`api.use("/hr")` 同步 UPSERT 违反 hr_employees_department_id_fkey；pda-domains 查不存在列 employee_name | server.js:13466-13530、6758；employees.department_id 无孤儿→映射错表 | 部门映射改 hr_departments 系（或 FK 改指 departments，二选一以 hr 模块现有读法为准）；补列或改查询 | HR 21 页签+employee |
| R6 | QMS react-i18next 从未 init → 整域裸键、不随语言切换、三语堆叠 | QmsApp.tsx:2,22,34；全仓无 init() | **QMS 翻译接回自研 t()**（删 useTranslation 或注入资源），随结构评估 P1-5 并入 quality 主入口做 tab | QMS 17 页签 |
| R7 | 运行进程与源码漂移（:8080 旧进程缺 daily-plans 等已定义路由） | mes 审计 R4：GET /api/smt/loading/daily-plans 源码 25857 有、live 404 | 重启 dev API 即可；**部署纪律：改 server.js 后必须重启验证**，写进 lane 规则 | smtLoader 等 |

## 2. 数据可信度/假闭环（P0，逐条修）

| # | 问题 | 证据 | 修法 |
|---|---|---|---|
| D1 | issue 页「全部发料/扫码发料」纯 setState，0 请求 | WmsIssue.tsx:144,191 | 接真实 ISSUE_TO_LINE 事务（server.js IQC_ALLOW_MAP:19455 已定义）；operator 取登录用户（同删 VN_WH_010 硬编码，波及 picking/cycleCount/putaway） |
| D2 | cycleCount 盘亏被 Math.abs 变盘盈；不消费 count_sessions | WmsCycleCount.tsx:133 + server.js:19627-19630 | 带符号差异走 ADJUST 语义或独立 COUNT_GAIN/COUNT_LOSS；提交写 count_sessions 闭环 |
| D3 | repair 维修结论 REPAIR-01 pass 直接 repaired+解拦截，绕过 ng_revival_audit 双审批 | server.js:25973-25990 vs 27901-27921 | 统一走 clear-ng 复活审批链（手动线标准），堵旁路 |
| D4 | pdaScan 六步扫码纯前端过场+TTS，不校验不写库 | PdaUnifiedScanning.tsx:157-166 | 接 /api/smt/loading/bind 真实校验链，或下线该入口（二选一，倾向接真链——名实相符） |
| D5 | ngClosedLoop 全硬编码 KPI/工单/时间线 | NgClosedLoopBoard.tsx:61,90,94 | 接 /api/ng-closed-loop（station-ops.js:304 已存在）；ngRouting 本地草稿与 ngManagement 合并（同组同名页签已随标签修复消歧，功能仍重叠） |
| D6 | materialRollQr 挂载即自动导入静态 Excel 并自动 POST 写主数据 | MaterialRollQrGenerator.tsx:142,140 | 删自动导入；173 行展示改读台账 wms_material_roll_labels；导入改显式按钮 |
| D7 | materialReceiving/pdaReceiving(Mobile) 演示数据冒充待收 | materialreceiving-demo-fallback.webp；WmsPdaReceivingMobile.tsx:348 前缀用反 | R1 修后读真 manifests；删 PO-TEST 兜底或显式标「演示」 |
| D8 | projectMgmt 内存 SEED_PROJECTS 假台账；service 硬编码空数组+SLA 基准日硬编码 | api/projectMgmt.ts:70-289；App.tsx:1593-1687 | 要么接后端（projects 路由真 404，需建表+路由），要么显式标「演示/规划中」——**不允许假台账样式**；service 同 |
| D9 | fifoMonitor 0 数据算「合规率100%」；autoLine 0/0 良率 100% | WmsFifo*、autoLine dashboard | 分母 0 显示「—」而非 100% |
| D10 | journey 计划侧 SQL 引用不存在列 work_orders.route_id → 500 | station-ops.js:307-308 | 改真实列（station_sequences 系） |
| D11 | OA oqcInspect 双重契约错（batch vs lotSize；单对象 vs 数组）；iqc 无分页+裸标签；meetingSeries cadence/status 列不存在 | QualityView.tsx:72,95-108,35-53；HrView.tsx:436-437；oqc-service.js:28-46 | 前端对齐后端契约（lotSize、单方案渲染、cycle_type/enabled）；iqc 加分页 |
| D12 | mrb reviewer-candidates 500；einvoice_config 表不存在 500；customer-pos/erp-customers/projects/qms-kpi/finance-dashboard-summary 真 404 | wms 审计 P1-9；misc R1 | 逐条补路由/表或前端下线入口（projects 见 D8） |
| D13 | sqlConsole 死页仍宣传任意 SQL；pick-orders GET 无鉴权；retest/arm 无操作者约束 | server.js:33860 注释、19235；station-ops.js:235 | sqlConsole 下架；pick-orders/retest 补 requirePermission（auth 变更走 R3 同流程） |
| D14 | employee 自助 employeeId 由用户名数字猜测（admin→1 错人） | App.tsx:3199 | 登录态带 employeeId（auth profile 已有映射则用之），不猜 |
| D15 | 6 页整页崩溃（msd/solderPaste/auxiliary/pdaMsd/shelfSim），ErrorBoundary 误标「3D组件崩溃」；undefined.toFixed | WmsMsd.tsx:194、WmsSolderPaste.tsx:132 | R2+空值守卫；ErrorBoundary 文案按域区分 |

## 3. 结构/同步锚（结构评估 P0，利于持续同步）

1. 三域各建 `apps/web/src/<域>/source-menu-map.json`（sourceKey→targetTab→status），WMS 转 62 行对照表、OA 导出 menu.ts 对齐、MES 补建。
2. `scripts/check-menu-parity.mjs` 挂 harness：清单每项有落点或显式 dropped；targetTab 存在于 tabKeys；运营组覆盖 ported 项。**源菜单一变，跑脚本即知缺口**。
3. rjvn 镜像页收进「原系统对照（开发者）」折叠组（adminOnly），运营菜单只留 canonical——与后端 one-WMS 收敛同步；**不删镜像页/表**（分歧待现场拍板，IQC 闸门已兜底）。
4. mesrj 五 tab 标签收敛后改业务名（保留 sourceKey 映射）。

## 4. 视觉/UX（ui-design 提案，容器统一、域边界不动）

1. 侧边栏：`height:100vh; sticky`+`.nav-groups overflow-y:auto`（独立滚动）；组可折叠、当前域自动展开；active≠hover（左 3px 语义条）；图标去重（Activity×4/ClipboardCheck×3）；**Ctrl+K 全局跳转**（索引派生自现有 menuGroups/mesGroups/OA_MENU，零新增契约）。
2. 二级导航统一 `DomainNav`「左组右页」单容器：组点击=展开不跳页（修 App.tsx:2008）；chrome ≤110px（现 370）；MES 删 P/NG 徽章（移 tooltip）；OA 保留 OA_MENU 数据与「建设中」策略、渲染换容器消灭第二竖栏；WMS 菜单页降级为域首页（删深色门户/硬编码流程图，文案进词典）。
3. 顶栏吸顶单行面包屑，删模块名×4 重复；健康灯全系统唯一语义色。
4. 悬浮虚拟员工停靠化：默认 48px 圆钮，展开右抽屉推挤布局，不遮表；文案行动化。
5. 空态三件套（图标+原因+行动）覆盖 WMS 双表/MES 监控/工位下拉；加载 10s 超时→错误+重试（OA 首屏 171s 无限加载）。
6. 三语破窗清零：WmsInventory 硬编码英文、WmsMenuPage 中文流程图、报表英文 slug、mes.subnav.stationOperator/journey、trace.title、buttons.refresh、mes.operator.*、pmc.subnav.mobile、hr.subnav.*、procurement/einvoice/quality 裸键；dev 模式裸键回退 console.error。
7. quality 模块 fct/autoLine 死页签（工具条只渲染 dashboard+aoi）补入口。

## 5. 顺序与验收

- **波 1（根因）**：R1→R2→R3→R4→R5→R7。验收：admin 下 WMS inventory/receiving/iqcInspect 见真实 DB 数（210 批/182 待检）、MES stationType/productionLine 活、HR 看板 200、例外审批带 token 200。每波跑全闸门+浏览器三语抽查。
- **波 2（假闭环/可信度）**：D1-D15。验收：发料/盘点/维修/复活各走一次真实写路径并 DB 对账（需注入 released 工单+在制 SN 环境，mes 审计 §7）；演示数据全部显式标记或下线。
- **波 3（同步锚+视觉）**：§3+§4。验收：check-menu-parity 绿；1366×768 首屏全组可见；Ctrl+K 一击杀「盘点」；组件展开不遮表；QMS 随语言切换。
- 每波独立可停；不动活体上游；auth/权限变更先枚举公开路径+check:auth-order；迁移 append-only。

## 6. 不做

- 不合并三域菜单数据源（同步边界）；不删 rjvn 镜像/「建设中」占位；不把 maintenance 死组件复活为大工程（导航「设备维护」现指 3D，要么改指真实维护路由要么显式命名「3D 厂房」，小改）。