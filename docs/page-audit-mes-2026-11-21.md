# MES 域逐页审计（55 tabs）— 2026-11-21

审计人：MesPageAudit。环境：Vite dev http://127.0.0.1:5178（真实浏览器逐页打开），API :8080，admin/Factory@123 登录。
所有页面均通过 URL `?view=mes&mesTab=<key>`（App.tsx:2039-2054 支持）+ 页内真实点击验证；截图在 `ui-eval/mes/`。
DB 只读对账（pg SELECT）：见 §5。临时脚本已删除。

## 0. 结论速览

- 55 个 tab 全部菜单可见（主题→分组→页签三级导航，App.tsx:2210-2257），无 URL-only 死页签；但 **约一半页面的后端数据链在当前 dev 环境断裂**。
- 三个系统性根因（见 §4）：
  1. **Vite dev 代理只转发 `/api`**（vite.config.ts:63-68），而 `mesApi`/`apiClient` 的全部无前缀路径（`/mes/*`、`/pda/*`、`/wms/*`）在生产由 nginx 正则转发（nginx.conf:53）、dev 下落到 SPA HTML → "返回了网页 HTML 而不是 JSON"/静默空态。**影响 ≥16 页**。
  2. **一批前端 fetch 不带 Authorization**（401）：dispatchBoard / rework / ngRevival / smtExemptions / stationOperator / repair 提交 / manualLine 部分面板。
  3. **后端 `ensureAuthenticated` 把 async 的 authenticateJWT 当同步用**（server.js:13537-13547，注释声称同步、实际 13343 是 async）→ 所有挂在 `app.use(authenticateJWT)`(29539) 之前、靠 requirePermission 懒补鉴权的路由对有效 JWT 一律 401 "Not authenticated"（smtExemptions 后端根因，plant-manager 7090）。
- **NG 闭环治理页 ngClosedLoop 是纯硬编码演示页**（假 KPI 12/3/1、假工单、假时间线，配置只写 localStorage）；ngRouting 自认"没有后端策略 API、只存本地草稿"；ngManagement 有完整审批流 UI 但 bootstrap 读取在 dev 断裂。
- **PDA统一扫码（pdaScan）是纯前端过场动画**：6 步扫码全部不做任何校验、不写后端，最后播"上料完成"语音——防错形同虚设。
- **两套过站引擎并行、账本互不相通**：原生 `mes_product_*`/`mes_station_pass_events`（stationPass 页）与瑞晶 `prd_sn`/`prd_pass`（mesrjExec 页）。两边都实测可提交、真实持久化/拦截；但 DB 里 work_orders 全空 → 原生引擎首站建档永远 HOLD；瑞晶侧只有 ZZ-* 冒烟数据。
- **维修闭环双标**：手动线走 `POST /api/rework/clear-ng` → ng_revival_audit 品质+线长双审批（server.js:27901-27921）；维修站页（repair）直接 `POST /api/mes/events` REPAIR-01 pass → server.js:25973 **立即置 repaired 并解除 NG 拦截，绕过复活审批**。
- materialRollQr 每次打开自动导入静态 Excel 并**自动向后端写主数据**（MaterialRollQrGenerator.tsx:142 → POST /wms/material-label-master/import-sheet1），dev 下 404 静默失败；页面显示的 173 行是本地 Excel 数据，不是台账（台账/导入记录表实际为空）。
- journey 计划履历后端 SQL 引用不存在列 `work_orders.route_id` → 500（station-ops.js:307-308），UI 报"SN未找到或无工艺路线"。

## 1. 导航结构（实测）

- 主题 2：产品主线 / NG闭环（mesThemes, mes/index.ts:203-206）。
- 分组 10（mesGroups, mes/index.ts:190-201）：
  - product：总览与指挥(4)、生产执行(8)、物料与上料(13)、包装与绑定(3)、追溯与核销(4)、数字孪生(4)、工艺与配置(6)
  - ng：发现与防错(3)、维修与复测(7)、处置与结案(3)
- 每个页签带 P/NG 贡献度徽章（getMesContribution, mes/index.ts:223-230）。
- 菜单可见性：55/55 全部在组内可见。manualLine3d/autoLine3d/warehouseStorage 的标签在 App.tsx:2247-2252 硬编码三语；顶部另有 Manual/Auto Line 3D 快捷按钮（App.tsx:2186-2207）。
- 问题：ngManagement 与 ngClosedLoop **共用同一 labelKey** `mes.subnav.ngManagement`（mes/index.ts:153-154），同组出现两个"NG管理中心"，无法区分。
- 缺失 i18n key（页签直接显示原始 key）：`mes.subnav.stationOperator`、`mes.subnav.journey`（i18n.ts 无此二键）。
- 硬编码中文 label（不随语言切换，mes/index.ts:159-165）：pdaDevice"PDA设备管理"、pdaScan"PDA统一扫码"、pdaOnline"PDA在线监控"、materialRollQr"MES料卷二维码"、smtMaterialBindings"SMT物料绑定表"、smtLoading3d"SMT上料3D模拟"、smtLoader"SMT上料监控"。
- 全局事件 `mes:auto-open-smt-loading`（App.tsx:3094-3110）：PDA CYCLE_STARTED 会强制把当前用户跳到 smtMaterialBindings——多人共用控制台时会互相打断。

## 2. 逐页表（55）

状态：正常=真实数据渲染；空态=后端通、数据为空（正确空态）；报错=可见错误/请求失败；死页=纯前端演示/不落库。
"断裂(dev)"指根因 R1（无前缀路径被 Vite 返回 HTML）；生产 nginx 下这些路径可通（nginx.conf:53），但需重新验证。

### 主题 product / 总览与指挥
| 页 | 信息内容 | 逻辑/工作流 | 状态 | 问题/证据 |
|---|---|---|---|---|
| overview | 中央管理器 6/6、待处理报警、全线投入产出平衡、NG维修SLA、业务闭环导览 | fetch /api/mes/managers/status + /api/mes/overall-balance（MesOverview.tsx:36-37，公开路由 server.js:1067）；另读工艺路线做导览 | 报错(部分) | `/mes/process-routes?limit=100` 返回 HTML（R1）；KPI 区正常。截图 stationPass-block-workorder.png 同域 |
| managerConsole | 管理器心跳表、指令下发（REPORT_NOW 等）、投入产出表、SN 血统查询 | /api/mes/managers/{status,instructions} GET/POST（MesManagerConsole.tsx:16,24）+ /api/mes/lineage/:sn（:30）；全部 200 实测 | 正常(空数据) | 指令 POST 不带 token，但后端 5004 无鉴权——能发但**无审计身份**；lineage 返回 ok |
| dashboard(扫码就绪) | 扫码类型识别（PCB/REEL/工单）、产线看板、飞达绑定看板、AI巡检 | mesApi.getLines/getFeederBindings 2s 轮询（App.tsx:2311-2326）；扫码识别是纯前缀字符串判断（App.tsx:2303-2309） | 报错→空态 | R1：/mes/lines、/mes/feeder-bindings HTML→catch 吞掉→"暂无数据"；预填 SN PCB2606160100084172 是硬编码演示值 |
| mesrjHome | 瑞晶中间层 sysinfo：工位3/物料0/产品1/BOM0/不良代码0/设备0/用户6 | GET /api/mesrj/sysinfo（实测200） | 正常 | 计数暴露瑞晶域基本是空库（只有 ZZ 冒烟数据） |

### 主题 product / 生产执行
| 页 | 信息内容 | 逻辑/工作流 | 状态 | 问题/证据 |
|---|---|---|---|---|
| productionLine | 产线列表→展开工位流程 | mesApi.getLines/getLine/getStation/getHeartbeats（ProductionLineDashboard.tsx:609-634） | 报错→近死页 | R1 全断：只剩标题"点击产线展开工位流程"，无产线可点 |
| manualLine | 手动线 3D 厂房+KPI（TOTAL/PASS/NG/YIELD/各工位）、NG追踪、交接/维修/复活面板 | /api/station/{ng-guard,interceptions,handovers,maintenance-handovers,residence-stats,pallets,bucket-snapshots}、/api/quality/special-release-trace 均200；NG清除走 POST /api/rework/clear-ng（ManualLineDashboard.tsx:4245,4369） | 正常(部分401) | KPI 全"—"；/api/mes/manual-line/continuity-gaps 与 /api/rework/revival-board 401（fetch 无 token，:3861）；clear-ng fetch 也无 token→审批链在 UI 上发不出去 |
| autoLine | 自动线 L002 实时：产出/良率/12工站流程 | GET /api/mes/auto-line/dashboard（200，2s轮询） | 正常(空数据) | 今日产出0、良率100%（0/0 显示 100% 有误导） |
| stationOperator | 工位选择→工位操作台（扫码/自动模式） | fetch /api/stations **无 token**（StationOperator.tsx:41）→401；提交走 mesApi（R1） | 报错 | 页签显示原始 key mes.subnav.stationOperator；工位下拉为空。截图 stationOperator-rawkey-401.png |
| stationPass | 过站校验台：工位下拉(80+真实工位)、SN/工单、OK/NG、规则链结果、过站历史、跳站放行单申请/审批 | apiClient /api/mes/station-pass（POST）+ /history + /skip-releases（StationPassConsole.tsx:90-193）→ 原生引擎 src/routes/station-pass.js:217-474 | 正常(引擎工作) | **实测 POST 200**：无工单→HOLD WORK_ORDER_NOT_RELEASED，事件已落 mes_station_pass_events（passId PASS-b03734b7）。DB work_orders 空 → 无法走通全链。截图 stationPass-block-workorder.png |
| processFlow | 工厂产线树（LazyFactoryLinesTree） | mesApi（FactoryLinesTree.tsx，5处） | 报错→近死页 | R1；仅剩壳 |
| stationWorkflow | 工站心跳/运行状态流 | mesApi.getLines 等（StationWorkflow.tsx） | 报错 | "加载失败: 接口 /mes/lines 返回了网页 HTML"。截图 stationWorkflow-html-json.png |
| mesrjExec | 瑞晶执行域全菜单：扫码过站台/DIP过站/物料消耗/SN池/跳站放行单/绑码/返修/报废/SMT管控(上料防错、锡膏回温、钢网、PCB拆封烘烤)/设备 | MesrjModule groups=exec,smt,dev（App.tsx:2101-2102）；菜单来自 /api/mesrj/menu；过站台 POST /api/mesrj/exec/pass（views-w6a.tsx:108）→ mesrj.js:4014 → domain.js doPassInner:3187 | 正常(引擎工作) | **实测提交 400 "SN 首次建档必须带工单号"**——校验链真实执行；md_station 仅 ZZ-DIP/PACK/SMT-01 三个冒烟工位。截图 mesrjExec-pass-guard.png |

### 主题 product / 物料与上料
| 页 | 信息内容 | 逻辑/工作流 | 状态 | 问题/证据 |
|---|---|---|---|---|
| materialVerify | 匹配通过/失败/匹配率 KPI+记录表 | mesApi.getMaterialVerifications→/mes/material-verifications（MaterialVerification.tsx:42） | 报错→空态 | R1；KPI 全0 是失败兜底非真实统计 |
| materialLoad | 上料 KPI+产线选择→上料工作流（飞达绑定/防呆规则/PCB建档） | mesApi.getLines/getFeederBindings/getFoolProofRules + bindFeeder + registerPcbSerial（MaterialLoadingWorkflow.tsx:88-335）；另 POST /api/smt/machine/assign-wo(:115) | 报错→空态 | R1：产线列表空，"选择产线开始上料"无可选项，整条上料工作流进不去 |
| smtMaterialBindings | 当前有效绑定表（工单/产线/实机/站位/飞达/料卷SN/数量/操作员）+PDA实时事件 | apiClient /mes/material-roll-bindings + /wms/material-label-master（SmtMaterialBindingTable.tsx:24-26）；SSE /api/pda/events?node=mes_smt_binding_table | 报错→空态 | R1（10s 轮询 HTML→catch 静默）；SSE 正常连接。表永远"暂无有效绑定记录"。截图 smtMaterialBindings-empty-silent.png |
| materialRollQr | 料卷发码表单+DataMatrix预览+打印配置、Excel批量发码表(173行)、导入记录表、WMS料卷台账表 | **挂载即自动 fetch /material_label_master.xlsx 并 importExcel→POST /wms/material-label-master/import-sheet1**（MaterialRollQrGenerator.tsx:142,140）；台账 /wms/material-roll-labels(:69)；发码/重打/退役 POST(:115-121) | 报错(伪数据) | 173 行来自**静态 Excel**（apps/web/public/material_label_master.xlsx），非台账；台账/导入记录实际 0 行；import-sheet1 在 dev 404（无前缀 POST 不被代理）→打开页面即静默失败。写操作全部 R1 断 |
| smtLoading3d | NPM-D3A 6台三排 3D 上料仿真：REGISTERED ROLLS/PDA PASS/REJECT/SCANNED | SSE /api/pda/events?node=mes_smt_loading_3d（replay=1）驱动；无 REST 拉取 | 空态(依赖PDA) | 无 PDA 事件时全0；canvas 渲染正常；console 1 错误（事件解析） |
| dispatchBoard | 配送会话 KPI+列表+重试 | fetch /api/dispatch/sessions **无 token**（MaterialDispatchBoard.tsx:55-69）→401；SSE mes_dispatch 正常 | 报错 | 错误对象直接渲染成 **[object Object]**+重试按钮。后端带 token 实测 200 {sessions:[]}。截图 dispatchBoard-401-objectObject.png |
| smtLoader | SMT上料控制台：产线切换(L001/L002/L004)、工单/按时任务/绑定数、日计划创建+发布 | GET /api/smt/loading/work-orders(200) + /api/smt/loading/daily-plans(**404**)；POST daily-plans/publish 带 token（SmtMaterialLoadingPage.tsx:60-115） | 报错(部分) | daily-plans GET 在运行中的 server 上不存在（源码 server.js:25857 有定义但 live 404，进程与源码漂移）；日计划区永远加载失败。截图 smtLoader-dailyplans-404.png |
| pdaLoad | PDA上料 KPI（今日WO/完成/进行中/货架占用）+进行中工单+管控台 | /api/wms/loading/{stats,active,history}（200 实测） | 正常(空态) | 无数据但链路通 |
| pdaDevice | 设备台账/领用发放/维修/软件版本/应用管理/审计 6子页 | pdaApi→/pda/devices 等无前缀（api/pda.ts:226+） | 报错 | R1："加载设备列表失败"；后端 handler 只在 modules/pda/index.ts（契约声明，server.js 未挂载 /pda/devices）→**生产也可能 404**。截图 pdaDevice-load-fail.png |
| pdaScan | 线体选择(SMT/自动/手工/激光)→6步扫码(工单/机台/飞达/料盘/操作员/线长)→"上料完成" | **纯前端**：每步只 setState+TTS 播报；唯一网络调用是 getAuditLog({limit:1})"预热"（PdaUnifiedScanning.tsx:157）；完成只 push 本地数组(:160-166) | 死页(假流程) | 不校验料卷/飞达/工单匹配、不写任何绑定；与 smtLoader/materialLoad 的真实防错链完全脱节。截图 pdaScan-local-only-wizard.png |
| pdaOnline | PDA 在线卡片墙 | pdaApi.getHeartbeats(/pda/heartbeats)+getDevices（PdaOnlineMonitor.tsx:68-69） | 报错 | R1；且 /pda/heartbeats 契约在 modules/pda（未挂载），live 只有 /api/pda/heartbeats(server.js:4675)。整页"加载失败"。截图 pdaOnline-load-fail.png |
| smtExemptions | 例外审批 KPI+线长申请→厂长授权列表 | fetch /api/plant-manager/exception-requests **无 token**（SmtMaterialExemptions.tsx:16）→401；后端 requirePermission 又踩 R3（server.js:7090,13538） | 报错(双重) | 带 token 实测仍 401 "Not authenticated"（R3）；页内还显示原始 key **buttons.refresh**。截图 smtExemptions-401.png |
| mesrjMaterial | 瑞晶物料域全菜单：基础数据/物料BOM/排产/订单工单/业务数据(ERP镜像) | /api/mesrj/menu + /api/mesrj/md/customer 等（200 实测） | 正常(近空库) | 物料0/BOM0；业务数据组读 rjvn_* 镜像（见 §5） |

### 主题 product / 包装与绑定
| 页 | 信息内容 | 逻辑/工作流 | 状态 | 问题/证据 |
|---|---|---|---|---|
| packagingBoxes | 栈板表+装箱码表（工单→栈板→箱→SN 守恒） | /api/station/packaging-boxes + /pallets（200，2s轮询） | 正常(空态) | 建栈板/加入栈板按钮可用（未实测写入） |
| qrWorkOrders | 13工站二维码工单绑定记录，2s同步 | /api/station/qr-workorders?stationCode=manu_shellbinding（200） | 正常(空态) | 跨工单重复绑定由后端拒绝（文案）；无数据 |
| oqcAql | Z1.4 抽样计算器（批量/AQL/水平/严格度→样本量 Ac/Re）+批次列表 | /api/qms/oqc-aql/plan + /batches（200 实测，批量500→抽50 代字H） | 正常 | 计算引擎真实工作；批次空 |

### 主题 product / 追溯与核销
| 页 | 信息内容 | 逻辑/工作流 | 状态 | 问题/证据 |
|---|---|---|---|---|
| trace | SN/PCB/工单三口径完整追溯 | mesApi.getFullTrace→/mes/trace/:sn（TraceabilitySearch.tsx:58；后端 server.js:23671 无前缀） | 报错→空态 | R1；实测输 ZZ-GUARD-SN-1 → "Trace not found"（HTML 被当错误吞掉） |
| journey | 计划履历 vs 实际履历（SN/箱），事件图例 | /api/journey/plan/sn/:sn + /api/journey/sn/:sn（JourneySearch.tsx:140-148；station-ops.js:290,307） | 报错 | **计划侧 500：字段 w.route_id 不存在**（station-ops.js:308，work_orders 无 route_id 列）；UI 只显示"SN未找到或无工艺路线"。页签原始 key mes.subnav.journey。截图 journey-plan-500.png |
| bomReconciliation | 工单 BOM 逐项核销门禁（上料→包装全一致才可绑成品） | mesApi.getBomReconciliation→/mes/work-orders/:id/bom-reconciliation（BomReconciliation.tsx:17；server.js:21432 无前缀） | 报错(查询即失败) | R1；且 work_orders 空，无工单可核 |
| mesrjQuality | 瑞晶品质域：SN追溯/过站记录/不良/维修看板/维修作业台/返修/交接/解报废/OQC全套/报表看板 | /api/mesrj/repair/{pending-summary,summary}（实测200）等 | 正常(空态) | 维修看板 0/0/0%；链路通。截图 mesrjQuality-repair-board.png |

### 主题 product / 数字孪生
| 页 | 信息内容 | 逻辑/工作流 | 状态 | 问题/证据 |
|---|---|---|---|---|
| manualLine3d | iframe /manual-line-video-3d.html?ngTrace=20260818 | 3D 页内 /api/station/ng-guard、/api/pda/events/history?stationCode=manu_*（200） | 正常(空数据) | ngTrace=20260818 硬编码在 App.tsx:2140；DEV 免登录旁路（App.tsx:3074） |
| autoLine3d | iframe /auto-line-video-3d.html | /api/pda/events/history?stationCode=auto_*（200） | 正常(空数据) | App.tsx:2144 |
| warehouseStorage | 仓库/线边 3D：198 空库位、热度图、智能查询 | /api/3d/wms-twin-summary + /wms-control-state（200） | 正常 | 有货0/预留0/冻结0——真实空仓渲染 |
| ictMonitor | ICT 工位 3D 监控（canvas） | /api/station/bucket-snapshots + /api/pda/heartbeats（200） | 正常(空态) | 首屏文本泄漏 `<style>` 源码片段（.ict3d-root{...} 出现在 innerText），实现粗糙 |

### 主题 product / 工艺与配置
| 页 | 信息内容 | 逻辑/工作流 | 状态 | 问题/证据 |
|---|---|---|---|---|
| stationType | 工位类型 CRUD 表 | mesApi.getStationTypes→/mes/station-types（StationTypeList.tsx；server.js:22178 无前缀） | 报错 | R1："加载失败"；新建/编辑/停用全部不可用。截图 stationType-load-fail.png |
| stationMaster | 工站 CRUD 表 | mesApi→/mes/stations（server.js:20855 无前缀） | 报错 | 同上。截图 stationMaster-load-fail.png |
| processDoc | MES流程(1).xlsx 的 6 张流程图（PNG 标签页） | 静态图片切换 | 正常(静态) | 第3个标签显示原始 key **trace.title**（ProcessDocumentation.tsx:23，i18n 无此键）。截图 processDoc-i18n-rawkey.png |
| processManagement | SMT全流程/PO流程/MES岗位 图版 | 静态 | 正常(静态) | 无后端 |
| timeControl | PCB开封168H/白胶固化≥4H 规则展示 | **纯静态规则文案**（TimeControl.tsx 无任何 API） | 死页(展示) | 真正的时效强制在瑞晶 dwell.checkOnPass（domain.js:3499-3513）与 mesrjCfg 时间阈值；此页只是说明书，无计时/报警功能 |
| mesrjCfg | 工艺路线(机型路线/工位规则)/配置中心(编码字典/时间阈值/防错规则/SN规则/打印模板/AOI映射/设备密钥)/系统管理(用户/角色/参数/日志) | /api/mesrj/route/process（200）等；重锁工单路线按钮 | 正常(近空库) | 机型路线需选机型查询；md_product 空 |

### 主题 ng / 发现与防错
| 页 | 信息内容 | 逻辑/工作流 | 状态 | 问题/证据 |
|---|---|---|---|---|
| ngTracking | 全工站活动 NG、来源、下游拦截、特放追溯 | mesFetch（带 token）/api/station/ng-guard + interceptions + /api/quality/special-release-trace（200）；**但 /mes/stations?limit=500 无前缀**（NgRealtimeTracking.tsx:199） | 报错(部分) | Promise.all 里 stations HTML→json 解析抛 **SyntaxError: Unexpected token '<'** 直接渲染在页头；NG 数据本身为空(count 0)。截图 ngTracking-syntaxerror.png |
| firstArticle | 首件检验 KPI+记录（每工单上线前必检） | mesApi.getFirstArticleInspections→/mes/first-article-inspections | 报错→空态 | R1；0/0/0 是失败兜底 |
| foolProof | Feeder Preparation Mapping：物料→机台→通道→槽位→飞达 精确绑定注册 | mesApi.getMaterialFeederAssignments→/mes/material-feeder-assignments（FeederPreparationMapping.tsx:20,29） | 报错→空态 | R1；注册按钮提交也断。注意：组内页签叫"防呆规则"，实际组件是 FeederPreparationMapping（App.tsx:2082-2083），FoolProofRules 组件已不被引用 |

### 主题 ng / 维修与复测
| 页 | 信息内容 | 逻辑/工作流 | 状态 | 问题/证据 |
|---|---|---|---|---|
| ngManagement | NG 策略（复测上限/维修路线）草稿→提交→批准→发布 版本表 | mesApi.getNgRouteConfigurationBootstrap→/mes/route-configurations/bootstrap（NgManagementPage.tsx:30；server.js:22440 无前缀，读 packages/station-config/stations.json） | 报错 | R1："操作失败: 接口 /mes/route-configurations/bootstr…"；整页不可用；与 ngClosedLoop 同名页签。截图 ngManagement-bootstrap-fail.png |
| ngClosedLoop | "NG闭环控制中心"：待处理12/待取件3/安灯1/不可覆盖历史100%、6阶段生命周期、取件队列、安灯、案例时间线 | **全部硬编码**：KPI 常量（NgClosedLoopBoard.tsx:61）、工单 WO-20260807-0042/0038/0034（:90）、时间线 10:02 NG_CONFIRMED…（:94）；工站配置只写 localStorage manual-line-ng-station-profiles（:56-74）；"刷新"只 setMessage | 死页(演示) | 无任何 API；假数据冒充实时 KPI，违反"不可覆盖历史/真实事实"的自我宣称。截图 ngClosedLoop-hardcoded-demo.png |
| ngRouting | NG 路由配置器：来源工站/触发条件/目标/处置，DRAFT→APPROVED→PUBLISHED | 页内自述"当前没有 NG 路由策略 API。此页面仅编辑本地未保存草稿"（NgRouteConfigurator.tsx:23）；工站列表 mesApi.getStations（:72，R1 断） | 死页(草稿) | 保存/提交/发布均不落库（诚实标注）；与 ngManagement 功能重叠且后者才有真 API。截图 ngRouting-local-draft-only.png |
| repair | 维修作业(REPAIR-01)/闭环监控/工站流程 3子页；扫码→上游NG核查→维修结论 pass/fail | 上游核查 mesApi.getUpstreamCheck→/mes/events/upstream-check（RepairStation.tsx:124，R1）；指令 repairStationApi.sendCommand→/api/repair-station/commands（200 实测 context）；**结论提交 fetch /api/mes/events 无 token**（RepairStation.tsx:175） | 报错 | 提交必 401（/mes/events 在 api 门内）；即便带 token，REPAIR-01 pass 走 server.js:25973 直接 repaired+解除拦截，**绕过 ng_revival_audit 双审批**（与手动线 clear-ng 流程不一致）。页内原始 key mes.operator.sn / mes.operator.workOrder；"Export work orders"英文硬串。截图 repair-rawkeys.png |
| rework | 回修站 L005 实时：今日返修/已修复/报废/待处理+队列/完成表 | fetch /api/mes/rework/dashboard **无 token**（ReworkDashboard.tsx:127）→401 | 报错 | 带 token 实测 200（line L005 running）；UI 显示"离线"+全0。截图 rework-401.png |
| ngRevival | NG复活：维修申请→品质批准→线长批准→MES全线解除，KPI+审批表 | fetch /api/rework/revival-board **无 token**（NgRevivalManagement.tsx:26）→401；批准 POST 也无 token(:41)；只有 acknowledge-alarm 用了 authHeaders(:47) | 报错 | 带 token 200 {items:[]}；UI "Error: HTTP 401"。后端审批链真实存在（server.js:28014,28031）。截图 ngRevival-401.png |
| retestRules | 13工站 MES 复检授权（一次有效，完成自动取消） | POST /api/station/retest/arm（RetestRules.tsx:275，station-ops.js:235） | 正常(空态) | 无 token 但后端该路由未挂鉴权（station-ops 内联注册）——可用但**无操作者身份约束**；页面其余为静态说明 |

### 主题 ng / 处置与结案
| 页 | 信息内容 | 逻辑/工作流 | 状态 | 问题/证据 |
|---|---|---|---|---|
| stagnation | 呆滞 KPI+事件链+阈值配置+导出 | mesApi.getStagnation→/mes/stagnation（R1 断）；但 export 用 /api/mes/stagnation/export+token（StagnationTracking.tsx:194-195，api 侧 29343 存在） | 报错→空态 | 列表断、导出通——同一页两种口径 |
| passShortage | PASS 短缺（前站出/后站入守恒）+返还手续 | /api/station/pass-shortages + pass-returns（200，2s轮询） | 正常(空态) | 填原因不自动关闭，需补齐/批准核销（文案与后端一致） |
| scrap | 工位报废审批表+现场数据分歧调查（本地 vs MES 双留痕） | /api/station/scrap-requests + /api/station/sync/conflicts（200，2s轮询） | 正常(空态) | 审批后隔离留存；链路通 |

## 3. 核心流程端到端（代码+实测）

### 3.1 工位放行（stationPass，原生引擎）
UI：StationPassConsole.tsx:132 `POST /api/mes/station-pass`（apiClient 带 token）。
后端：server.js:9015 挂 createStationPassRouter → src/routes/station-pass.js:217。
链条（station-pass.js）：
1. 幂等回放：idempotency_key 命中 mes_station_pass_events 直接返回原决定（:238-253）。
2. loadStation/loadPolicy(mes_station_pass_policies)/loadRoute(station_sequences，工位码或类型码双解析 :68-100)。
3. loadProductFacts：visits 重测计数、dependent_sequences NG/REPAIR/RETEST、attendance、上游未修 NG（ng_defect_records :163-171）、跳站放行单（mes_skip_releases APPROVED/PENDING :193-213）。
4. evaluateStationPass（src/station-pass.js）规则链→decision。
5. 接受后：首站建档 mes_product_units/identifiers/attendance（品号必须来自已下达工单 :326-331）→ mes_product_station_visits → OK 推进 expected_station_code（末站 COMPLETED :412-422）/ NG 建 REPAIR 序列并钉在原站（:389-407）→ 消费放行单 CONSUMED（:426-433）。
6. 成败都写 mes_station_pass_events + mes_operating_event_ledger（:437-457）。拦截返回 200+gateState（:460-466）。
**实测**：UI 选 PDA-01 + SN ZZAUDIT-MES-0001 提交 → 200 {accepted:false, gateState:"HOLD", reasonCode:"WORK_ORDER_NOT_RELEASED"}，事件持久化（passId PASS-b03734b7）。**持久化=是**。当前 DB work_orders 0 行 → 全链无法走通（环境缺工单，非代码缺陷）。
跳站放行单：POST /skip-releases（:629）→ approve/reject（:656,673，mes.admin）；UI 申请/审批按钮齐全（StationPassConsole.tsx:169-193）。

### 3.2 瑞晶执行域过站（mesrjExec）
UI：views-w6a.tsx:108 `POST /api/mesrj/exec/pass` → mesrj.js:4014（requireMesrjPerm prod.pass；admin 经 currentUser 映射为超管 mesrj.js:190-220）→ domain.js doPassInner:3187。
校验链：工位停用/NG必填不良代码(3204-3209)→功能站禁人工放行 deny_manual_pass(3211-3226)→SN 建档/预发号工单匹配(3228-3326)→AOI 数据自动补档 adoptFromAoi(3247-3253)→SN 前缀=镭雕机台号校验(3328-3359)→WS-AOI 结果自动判定(3401-3423)→SN_FORMAT/NG_PASS/上游NG兜底(3425-3454)→REPAIR_LIMIT(3456-3463)→DUP_SN 良品禁重测(3465-3483)→SKIP_CHECK 前置必过(3485-3493)→DWELL_TIME 时效拦截/预警(3495-3513)。
落库：prd_pass(3517-3524)+prd_test(3527-3534)；NG→prd_defect_rec 待处理(3540-3545)，关键站 NG_TERMINAL→prd_scrap 报废(3546-3554)，否则 prd_sn.status=待修；OK→在制/完工(3559-3577)；prd_sn.cur_station/cur_seq 更新(3579-3582)；moAfterPass 刷工单产出(3586)。
**实测**：UI 提交 SN ZZAUDIT-MES-RJ-01 @ ZZ-SMT-01 无工单 → 400 "SN 首次建档必须带工单号（mo_no）"（校验链真实执行）。**持久化=是**（拦截路径不落 prd_pass，符合设计）。
跳站：/exec/skip 必填原因+prd_skip_log 去重（mesrj.js:4024-4054）；放行单 /exec/release + approve（:4057-4106，prd_pass_release）。
**与原生引擎账本完全独立**：mes_product_* vs prd_*，无同步桥。同一块板在两边各有一套状态。

### 3.3 NG 闭环（ngTracking→ngRouting→repair→retest）
实现真身分散在三处：
- **发现/拦截**：/api/station/ng-guard（server.js:5027，读 sn_journey_events/ng_pool 活动 NG）+ /api/station/interceptions（:5384，ACTIVE_NG_CAUGHT 下游拦截）+ 过站引擎上游 NG 校验（station-pass.js:163-171；domain.js:3446-3453）。ngTracking 页展示这些（部分断，见 §2）。
- **路由/策略**：ngRouting=本地草稿（无 API）；ngManagement=/mes/route-configurations CRUD+submit/approve/publish（server.js:22440-22503，读 stations.json FILE_DRAFT，版本表 mes_route_configurations）——dev 断（R1），DB mes_route_configurations 0 行=从未发布过策略。ngClosedLoop=硬编码演示。**"MES 审批发布后才可成为生产规则"目前只存在于文案**。
- **维修/复活**：
  - 手动线：POST /api/rework/local-ng（SQLite rework.db 留痕 server.js:27767）→ POST /api/rework/clear-ng（:27901）：repaired 必须先有 ng_revival_audit APPROVED，否则插 PENDING_QUALITY 返回 202（:27908-27921）→ /rework/revival-board/:id/approve QUALITY+LINE_LEADER 双批（:28031）→ 原工位扫码收料确认才解除。
  - 维修站页：POST /api/mes/events REPAIR-01 pass → **直接 UPDATE ng_defect_records.repair_status='repaired' 并清 NG hold**（server.js:25973-25990）——不经过复活审批。两条路径标准不一致。
  - 瑞晶侧：/api/mesrj/repair/handover 建单→accept→item(维修结论)→close/return（mesrj.js:8964-9095，repair-core.js），解报废审批 /repair/scrap/release/*（:9184-9223）。
- **复测**：retestRules POST /api/station/retest/arm（station-ops.js:235，一次授权）；原生引擎 max_retest 策略（mes_station_pass_policies）；瑞晶 REPAIR_LIMIT+DUP_SN。
**实测**：ng-guard count=0、ng_defect_records 0 行、ng_revival_audit 0 行、rework.db 无 live 数据——当前无活动 NG，闭环各环节只能验证到"链路存在+空态"，无法验证一次完整 NG→修→复活→复测流转（缺工单/在制品）。

### 3.4 上料防错（materialLoad / smtLoader / mesrj SMT）
三套并行：
1. **materialLoad（飞达绑定流）**：MaterialLoadingWorkflow.tsx:88-335——选线→getFoolProofRules→bindFeeder（POST /mes/feeder-bindings）→registerPcbSerial；dev 全断（R1），feeder_bindings 表存在。
2. **smtLoader（SMT 日计划流）**：/api/smt/loading/work-orders(200)→daily-plans 创建/发布（POST 带 token，server.js:6490/6510）→PDA bind（/api/smt/loading/bind :7733，校验链在后端）→approval-queue/decision（:7217/7316）→release（:8460）。GET daily-plans live 404（源码 25857 有、进程没有）→控制台计划区断。smt_loading_daily_plans 0 行。
3. **mesrj SMT 管控**：/api/mesrj/smt/material_load 上架（mesrj.js:10632，写 prd_material_load+审计）→ /smt/feeder_slot_match 料号校验(:10663)→ /smt/baseline/learn 首扫建档基准(:10723)→ /smt/baseline/verify 逐扫比对(:10717)→锡膏回温 /smta/paste/warm(:5981)/钢网/PCB拆封烘烤。链路完整、库空。
**pdaScan 与这三套都不连通**（纯前端，见 §2）——"PDA统一扫码"名不副实。
料卷身份：materialRollQr 发码→wms_material_roll_labels（server.js:18476）→PDA 绑定时校验；dev 下读写全断（R1），且打开页面自动写主数据（:142）。

## 4. 系统性根因（file:line）

- **R1 dev 代理缺口**：apps/web/vite.config.ts:63-68 只代理 /supplier-api、/api/pda、/api；nginx.conf:53 生产代理无前缀域。apiClient（apps/web/src/api/client.ts:11-13,118）按生产假设用无前缀路径。受影响页：overview(部分)/dashboard/productionLine/processFlow/stationWorkflow/stationType/stationMaster/materialVerify/materialLoad/smtMaterialBindings/materialRollQr/pdaDevice/pdaOnline/trace/bomReconciliation/firstArticle/foolProof/ngManagement/stagnation(列表)/ngTracking(stations)/repair(上游核查)/RepairLoopDisplay。
- **R2 前端裸 fetch 无 Authorization**：MaterialDispatchBoard.tsx:55-69、ReworkDashboard.tsx:127、NgRevivalManagement.tsx:26,41、SmtMaterialExemptions.tsx:16、StationOperator.tsx:41、RepairStation.tsx:175、ManualLineDashboard.tsx:3861,4245,4369。client.ts:220 已提供 authHeaders，这些页没用。
- **R3 后端懒鉴权 async/sync 错配**：server.js:13537 注释"authenticateJWT 是同步的"，实际 :13343 是 async（await accountStates.get）。ensureAuthenticated(:13538-13547) 用 probe 同步探测 → req.user 永远未设 → 挂在 app.use(authenticateJWT)(:29539) 之前、仅靠 requirePermission 的路由（如 /api/plant-manager/exception-requests :7090、/api/manager/line-assignments）对有效 JWT 一律 401 "Not authenticated"。**带 token 实测复现**。
- **R4 运行进程与源码漂移**：node services/api/server.js（PID 18136，15:53 启动）对源码中已定义的 GET /api/smt/loading/daily-plans（server.js:25857）、/api/pda/app-catalog（src/routes/pda.js:12，12659 注册）返回 404；而 /api/mes/stagnation 等正常。modules/pda/index.ts、modules/mes/index.ts 只是契约声明（app.ts listApiRoutes），server.js 并未按模块挂载——/pda/devices、/mes/process-routes 的 /api 别名在生产也不存在，生产可用性依赖 nginx 无前缀转发 + app.get("/mes/...") 注册。
- **R5 i18n 缺口**：mes/index.ts:159-165 硬编码中文；:153-154 ngClosedLoop 复用 ngManagement 标签；i18n.ts 缺 mes.subnav.stationOperator、mes.subnav.journey、trace.title（ProcessDocumentation.tsx:23）、buttons.refresh（SmtMaterialExemptions.tsx:57）、mes.operator.sn/workOrder（RepairStation.tsx:310）。
- **R6 演示数据冒充实时**：NgClosedLoopBoard.tsx:61,90,94（KPI/工单/时间线全常量）；MaterialRollQrGenerator.tsx:142 静态 Excel 自动导入+自动 POST；App.tsx:2297 扫码页预填演示 SN；manualLine3d ngTrace=20260818 硬编码（App.tsx:2140）。

## 5. 数据源对账（只读 SELECT）

| 表 | 行数 | 说明 |
|---|---|---|
| mes_station_pass_events / mes_product_units | 0 / 0（审计提交后 events=1） | 原生过站引擎从未在生产使用；本次审计留下 1 条 HOLD 事件（ZZAUDIT-MES-0001） |
| prd_pass / prd_sn / prd_defect_rec | 3 / 2 / 0 | 瑞晶侧仅 ZZ-GUARD-SN-1(完工)/ZZAGEPROOF01 冒烟数据 |
| md_station | 3（ZZ-DIP/PACK/SMT-01） | 与 canonical stations(80+) 完全两套 |
| work_orders | **0** | 原生引擎建档/上料/核销全被卡死的环境根因 |
| ng_defect_records / ng_revival_audit / station_events | 0 / 0 / 0 | NG 闭环无历史数据 |
| mes_route_configurations / mes_skip_releases / prd_pass_release | 0 / 0 / 0 | NG 策略从未发布；放行单从未开过 |
| smt_loading_daily_plans | 0 | SMT 日计划空 |
| rjvn_*（镜像） | external_id_map 7058、mes_sync_log 5789、inventory_transaction 777、iqc_lot_receipt 773、material 406、iqc_lot 210 | mesrjMaterial"业务数据"组与库存对账页读镜像；canonical smt 表几乎全空——**当前"真实数据"主要在镜像侧**，与 prior findings 一致 |

镜像 vs canonical：mesrj 域（md_*/prd_*/ord_*）是移植后的 canonical；rjvn_* 是源 WMS 镜像只读；stationPass/ngTracking/manualLine 等读 canonical smt 表。两域之间无 SN/工单桥接。

## 6. 截图清单（ui-eval/mes/）

stationPass-block-workorder / mesrjExec-pass-guard / mesrjQuality-repair-board / journey-plan-500 / stationType-load-fail / stationMaster-load-fail / stationWorkflow-html-json / ngTracking-syntaxerror / ngClosedLoop-hardcoded-demo / ngManagement-bootstrap-fail / ngRouting-local-draft-only / rework-401 / ngRevival-401 / smtExemptions-401 / dispatchBoard-401-objectObject / pdaDevice-load-fail / pdaOnline-load-fail / smtLoader-dailyplans-404 / processDoc-i18n-rawkey / stationOperator-rawkey-401 / repair-rawkeys / smtMaterialBindings-empty-silent / pdaScan-local-only-wizard（.png）

## 7. 修复优先级建议

1. R3（ensureAuthenticated async 错配）——一行级修复，解锁例外审批等整组路由；同时给 R2 各页补 authHeaders。
2. R1——vite.config.ts 增加与 nginx.conf:53 同口径的无前缀代理（或 apiClient 统一 /api 前缀+后端补别名），一次性救活 ~16 页。
3. ngClosedLoop 硬编码演示页下线或接真数据（/api/ng-closed-loop 已存在于 station-ops.js:304）；ngRouting 与 ngManagement 合并，消除同组同名页签。
4. repair 维修结论统一走 clear-ng 复活审批链，堵住 server.js:25973 旁路。
5. pdaScan 接真实 /api/smt/loading/bind 校验链或下线；materialRollQr 去掉挂载即写库的自动导入。
6. journey 计划侧 SQL 改 work_orders 真实列（station-ops.js:308）；补 R5 全部 i18n key。
7. 环境：注入至少一张 released 工单+在制 SN，否则过站/上料/核销/NG 全链永远只能验证到第一个拦截点。
