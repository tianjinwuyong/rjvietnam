# 页面审计：OA + 管理模块（pmc/hr/finance/procurement/reports/admin/qms/quality/trace/sales/service/einvoice/maintenance/projects/projectMgmt/workflow/employee）

审计日期：2026-11-21 ｜ 环境：http://127.0.0.1:5178（Vite dev）+ API :8080 ｜ 账号 admin（OA isAdmin=true）
方法：真实浏览器逐页打开（自有 tab `oaMiscAudit`），记录渲染/网络/控制台；DB 只读 SELECT 对账（oa schema 187 表 + public）。
截图：`ui-eval/oa/`（4 张）、`ui-eval/misc/`（12 张）。写操作一律未提交（untested-write）。

---

## 0. 全局根因（影响几乎所有管理模块，先读这段）

### R1. Vite 代理只转发 `/api`，大量模块请求非 `/api` 前缀 → dev 下拿到 index.html
`apps/web/vite.config.ts:51-69` 只代理 `/api`、`/api/pda`、`/supplier-api`。
`apps/web/src/api/client.ts:11-28` API_BASE=""（同源），注释假设 nginx 会代理所有后端路径，但 dev 只有 `/api`。
后果：凡调用 `/reports/*`、`/finance/*`、`/quality/*`、`/traceability/*`、`/mes/lines`、`/mes/heartbeats`、`/admin/*`、`/pda/app-catalog`、`/hr/employees/:id`、`/pmc/patrol-state`、`/qms/*` 的页面，在 5178 上收到 **200 text/html**：
- 走 apiClient 的抛 `ApiClientError: 接口 X 返回了网页 HTML`（页面红字）；
- `.catch(()=>{})` 静默吞掉的 → **假空态**（"暂无数据"，看似正常实则没取到数）。
直连 8080 验证：`/quality/records`、`/traceability/events`、`/admin/users`、`/mes/lines`、`/mes/heartbeats`、`/pmc/work-orders`、`/pmc/patrol-state` 均返回正常 JSON → **这些是代理缺口，不是后端缺路由**。
但下列在 8080 上也缺/坏（真后端问题）：`/api/pmc/customer-pos` 404、`/api/erp/customers` 404、`/api/projects` 404、`/qms/kpi/summary` HTML（路由不存在）、`/finance/reports/dashboard-summary` HTML（不存在）、`/api/einvoice/config` 500（表 einvoice_config 不存在）。

### R2. HR 全量 API 被同步中间件的外键错误打死
`services/api/server.js:13466-13530`：`api.use("/hr", …)` 每次请求先把 `employees` UPSERT 进 `hr_employees`，违反 `hr_employees_department_id_fkey` → **所有 `/api/hr/*` 500**（governance/payroll/profile-update/performance reviews/training videos/grievance/employees/pda-domains…）。
DB：`employees`=39、`departments`=11、`hr_employees`=0；employees.department_id 无孤儿 → FK 指向的是另一张部门表（hr_departments 系），同步语句部门映射错。
另：`/api/hr/pda-domains` 500 `字段 "employee_name" 不存在`（server.js:6758 查询列与表结构不符）。
前端 HR 子页又多调用无 `/api` 前缀路径（R1），双重坏。

### R3. admin 的 SMT JWT 缺业务权限 → 即使修好代理仍 403
`requirePermission`（server.js:13549-13560）只认 `permissions` 含 `"*"` 或逐条匹配；admin 令牌无 `finance.view`、`reports.view` 等 → `/api/finance/*`、`/api/reports/*` 403。
前端角色矩阵（App.tsx roleModuleAccess）给 admin 全模块可见 → **菜单可见但接口拒绝**，权限种子与前端矩阵不一致。

### R4. react-i18next 从未初始化 → QMS 全模块裸键
全仓无 `i18n.use(initReactI18next)`/`init()`；`apps/web/src/qms/*` 17 个组件用 `useTranslation()`，`t("qms.x")` 返回键本身（truthy），`|| "仪表盘"` 兜底永不生效 → 页签/标题/卡片全显示 `qms.dashboard`、`qms.loadError` 等裸键。

### R5. 假数据/死代码
- `apps/web/src/api/projectMgmt.ts:70-289`：项目管理整个模块是**内存 SEED_PROJECTS（5 条假项目）+ 内存 CRUD**，无后端、刷新即失，却以真实台账样式展示。
- `App.tsx:1758-1825` `Maintenance` 组件（25 页签）从未被渲染：内容映射 `maintenance: <LazyFactory3D/>`（App.tsx:3188）→ "设备维护"导航只打开 3D 工厂；整块维护管理 UI 死代码。
- Service 模块 tickets/rma 硬编码空数组（App.tsx:1593-1594,1665,1709），SLA 基准日硬编码 `"2026-06-19"`（1598,1687）。
- 死按钮（无 onClick）：新建收付款 App.tsx:1041；新建报价单 1233、1269。
- 侧边栏状态硬编码 VN-01 / Day / A / 06:14（App.tsx:594-602）。
- Trace 查询框不过滤（App.tsx:2681-2698 固定拉全量 events，默认串 PCB2606160100084172 仅展示）；铃铛按钮死（2707）。

---

## 1. OA 模块（59 个侧边栏叶子，逐页实测）

结构：`apps/web/src/oa/menu.ts` OA_MENU 8 组；路由 `oa/index.tsx:290-425`；API `oa/oaApi.ts`（/api 前缀，信封已剥）。
**建设中清单：当前 OA_MENU 中 0 个未实现叶子**（所有 item 均带 view；HANDOFF.md:20 "建设中项已全部清零" 属实）。
- 占位机制仍在：`oa/index.tsx:274-294`（无 view 的叶子显示 wip.title），但菜单已无此类叶子 → 死路径。
- **过期注释**（声称建设中但已实现）：menu.ts:71、76；HrView.tsx:11；QualityView.tsx:10；SysView.tsx:8。
- 代码缺陷：`menu.ts:100-101` OaViewId 联合类型重复成员 `"inspectRecords"`。
- 非 OA 的"占位/建设中" surface：sales.营销活动（App.tsx:1560-1569 占位文案）、service.质量关联（1747-1756 占位）、maintenance 整模块死（R5）。

| 页面 | 信息内容 | 逻辑/工作流 | 状态 | 问题 file:line / 截图 |
|---|---|---|---|---|
| 首页 overview | 4 统计卡(待办0/审批中0/完成260/未读0)+最新单据8行+各流程单量33行 | GET /api/stats/overview；与 DB 完全对账 | 正常 | — |
| 发起申请 start | 33 流程按业务分类分组，含节点链说明 | FlowPicker→FlowForm；GET /api/flows?forApply=1 | 正常 | 提交=untested-write |
| 待我审批 todo | 空态 | /api/instances?tab=todo；admin(id=1) 无 assigned 任务（DB flow_task 972 全 approved 且 assignee 均 RJ 用户） | 空态(正确) | — |
| 我的申请 mine | 空态 | tab=mine applicant_id=1 → 0 | 空态(正确) | — |
| 已办 done | 空态 | tab=done；admin 0 条已办任务 | 空态(正确) | 冷启动首次点击 >76s 停留"加载中"（dev 按需编译 OA ~30 模块所致；直连 API 3ms；复测 500ms） |
| 抄送我的 cc | 空态 | flow_cc=0 | 空态(正确) | — |
| 消息通知 | 12 行(未读8)+全部已读按钮 | /api/notifications；与 profile.counts.notifications=8 对账 | 正常 | 全部已读=untested-write |
| 通知通告 | 空态+新建通告+状态/分类筛选 | /api/announcements；DB announcement=0 | 空态(正确) | CRUD=untested-write |
| 体系文件 docs | 20 行/页(共260)+级别/状态筛选+台账/新建入口 | /api/docs；DB doc_system=260 | 正常 | — |
| 发放回收记录 | 20 行/页(260) | /api/docs/ledger/issue；DB=260 | 正常 | — |
| 作废清单 | 空态 | DB doc_obsolete_record=0 | 空态(正确) | — |
| 外来文件 | 空态 | DB doc_external_record=0 | 空态(正确) | — |
| 公共盘 drive | 4 文件夹+浏览/回收站/审计日志三页签+新建文件夹 | /api/drive；DB drive_folder=4, drive_file=0 | 正常 | 上传/ACL=untested-write |
| 知识共享 | 1 行 IPC-A-610H(已开放 v1)+打开/下载/新版本/历史 | /api/knowledge；DB knowledge_doc=1 | 正常 | — |
| IQC 检验 | 统计卡 total0/OK0/NG0/passRate— + 20 行 lot | /api/iqc/lots(分页20/共232) + /api/iqc/stats | 正常但误导 | ① 统计卡与列表口径不一：iqc_record=0 故 stats=0，而 mirror 232 pending 批在列；② **无分页控件，232 批只见前 20**；③ 裸英文标签 total/OK/NG/passRate/lot/material/supplier（QualityView.tsx:35-53，statsExtra.total 键缺失回退）→ ui-eval/oa/oa-iqc-raw-labels.png |
| MRB 评审 | 空态 | /api/mrb/list；mrb_mirror=0 | 空态(正确) | 裸标签 MRB/material/qty（QualityView.tsx:248-250） |
| 巡线提报 ipqcFill | 表单(模板/产线/班次/日期/逐项) | QcFillForm；POST /api/ipqc/records | 空态/不可用 | ipqc_template=0 → 无模板可选，表单无法真实提交 |
| 巡线记录 | 空态 | ipqc_record=0 | 空态(正确) | — |
| 首件提报 faiFill | 表单 | POST /api/fai/records；abnormal 自动开品质异常单 | 空态/不可用 | fai_template=0 |
| 首件记录 | 空态 | fai_record=0 | 空态(正确) | — |
| 点检填写 | 空态 | /api/equipment/tasks pending=0 | 空态(正确) | — |
| 点检记录 | 空态 | equipment_task=0 | 空态(正确) | — |
| 出货检验 oqcInspect | **报错+永久加载中** | 前端传 `batch=50`，后端要 `lotSize` → 400「批量必须为大于1的整数」；且后端返回单个抽样方案对象{sampleSize,ac,re,note}，前端按工单数组渲染 → 双重契约错 | 报错 | QualityView.tsx:72,95-108 vs services/api/src/oa/services/oqc-service.js:28-46 → ui-eval/oa/oa-oqc-batch400.png |
| 检验模板库 qcTemplates(5 菜单叶共用) | 空态 | /api/qc/templates；5 类模板表全 0 | 空态(正确) | menu.ts:156-160 五个叶(IQC/IPQC/OQC/FAI/点检)指向同一 view 且无 scope 过滤 → 重复入口 |
| 设备台账/盘点/保养任务/校准/预警(5页) | 全空态 | /api/equipment*；oa.equipment*=0 | 空态(正确) | public.equipment_assets=60 未同步进 OA 设备表 → 同步缺口 |
| 组织与人员 org | 41 人/10 部门 | /api/users+/api/departments；DB 对账✓ | 正常 | — |
| 组织与岗位管理 orgImport | 模板下载/导出/岗位字典15行/导入向导 | /api/org/import/template、/api/org/positions | 正常 | 导入=untested-write |
| 考勤管理 | 空态 | attendance_summary=0 | 空态(正确) | — |
| 打卡规则 | 2 行 | attendance_rule=2 ✓ | 正常 | — |
| 工作日历 | 月历网格(rule:6day) | attendance_work_calendar=4 ✓ | 正常 | 表头裸串 "rule: 6day" |
| 排班与卡点 | 空态 | attendance_schedule=0 | 空态(正确) | — |
| 薪资管理 | 空态 | salary_record=0 | 空态(正确) | — |
| 职类与薪资模板 | 空态 | salary_structure=0（salary_class=18 存在但未用） | 空态 | 职类数据未接入 |
| 月度绩效考核 | 空态 | performance_record=0 | 空态(正确) | — |
| 培训考证 | 空态 | training_plan=0（oa.training=1 孤儿行未用） | 空态 | — |
| 我的考试/工作交接 | 空态 | exam_attempt=0 / work_handover=0 | 空态(正确) | — |
| 休假/签卡/调休/增员(4 快捷叶) | FlowForm 正确预选 def(id 9/10/1166/17)，字段+附件+存草稿/提交审批 | menu flowCode→start 自动选流程 | 正常 | 提交=untested-write |
| 会议列表 | 空态 | meeting=0 | 空态(正确) | — |
| 会议发起 | 完整表单+双语议程编辑器 | POST /api/meeting | 正常 | untested-write |
| 会议系列 | 4 行(DB 7 含软删3) | /api/meeting/series | 正常但列坏 | **cadence/status 列恒为 "-"**：DB 列是 cycle_type/enabled，前端键 cadence/status 不存在；表头裸串 "cadence"（HrView.tsx:436-437）→ ui-eval/oa/oa-meeting-series-raw-cols.png |
| 决议与待办/会议纪要 | 空态 | meeting_action=0 / org_minutes=0 | 空态(正确) | — |
| 流程台账 ledger | 选流程+日期/关键词+查询+导出Excel；wms_picking→暂无台账数据(0 实例,正确) | /api/instances?tab=flow&definitionId | 正常 | ui-eval/oa/oa-ledger-doc-issue.png |
| 电子流版本 flowVersions | 选流程后列版本+发布/回滚说明 | flow_definition_version=42/24 defs | 正常 | 发布/回滚=untested-write |
| 模板自定义字段 | inspect scope 3 行+增删改 | template_custom_field=43(全 scope) ✓ | 正常 | untested-write |
| 流程配置 flowDesign(admin) | 33 流程列表+新建流程+节点/字段/高级三页签 | /api/flows?includeInactive=1 + /api/roles | 正常 | 保存=untested-write |
| 系统设置 settings | 改密码+语言偏好 | /api/auth/profile | 正常 | untested-write |

### OA 审批工作流地图（实测 + DB）
- 定义：33 个 flow_definition；唯一有实例的是 `doc_controlled_issue`（260 单，全部 completed）。
- 标准节点链（9）：部门负责人及副总 会签 → 部门负责人 会签 → 管理者代表审核 → 总经理审批 → 管理者代表批准 → 归口部门负责人确认 → 体系工程师批准上线 → 发行执行回复(execute) → 发行确认闭环(verify)。
- 实际路由：四级表单走 `issue_route=l4_form` 捷径 → 仅 1 个评审任务（submit 日志注明"1 个评审环节"）。
- 实例 15978（DOC-260810-052）只读追踪：submit 2026-08-10 10:36（阮氏商）→ approve 17:01（孙杨明，"同意，按此版本发行"）→ completed、closed_loop=true；详情含表单数据/时间轴/操作日志/抄送/附件区。
- UI 闭环：start(FlowForm 存草稿/提交) → todo(InstanceDetail canApprove→approve/reject) → done/mine/cc + notifications(【办理完成】等)。
- **审批写路径 untested-write**：DB 无 running 实例、admin 无待办，无法只读证明 approve/reject；需发起新单才能验证（未做）。
- 对账：flow_instance 260=overview 260 ✓；flow_task 972 全 approved ✓；flow_cc 0 ✓；notification 124( admin 12/未读8 ) ✓；attachment 260 ✓。

---

## 2. 管理模块逐页签

### PMC（24 页签，App.tsx:880-936）
| 页签 | 状态 | 问题 |
|---|---|---|
| PMC 看板/工单列表/工单详情/工单预警/甘特图/物料齐套/补料管理/交付盯控 | 假空态 | /pmc/work-orders 等无 /api 前缀 → dev HTML（R1）；8080 直连有 JSON（work_orders=0 真亦空） |
| 生产报工/领料发料/在制品跟踪/工单质量报告/预警历史 | **死页(永久加载中)** | PmcProductionReporting.tsx:17-24 `.then` 无 `.catch` → HTML 抛错后 loading 永不复位 |
| 安灯看板 | 报错 | /mes/heartbeats HTML + /mes/heartbeats/stream 404 → "Unexpected token '<'"（PmcAndonBoard.tsx:166,180）→ ui-eval/misc/pmc-andon-404.png |
| 巡逻看板 | 报错/降级 | **硬编码绝对地址且不带令牌** fetch("http://127.0.0.1:8080/pmc/patrol-state") → 401（PmcPatrolDashboard.tsx:229）；回退同源又 HTML |
| PO 管理 | 报错 | /pmc/customer-pos 真 404（8080 亦无）→ ui-eval/misc/pmc-po-html-error.png |
| 客户/产品管理 | 报错 | /erp/customers 真 404 |
| 工位报到/工单冻结/NG 评审/补料审批/全过程闭环 | 空态/表单 | 依赖同 R1 路径 |
| BOM 物料清单 | 空态 | /boms 路径 R1 |
| 末页签 | 裸键 | 标签显示 `pmc.subnav.mobile`（i18n 缺键） |

### HR（21 页签，App.tsx:938-992）
| 页签 | 状态 | 问题 |
|---|---|---|
| HR 看板/组织架构/考勤记录/请假/绩效/薪资/生命周期/考勤统计/替班/加班薪资/技能评分/合作能力灯/奖励机制 | 假空态或报错 | R1+R2：/hr/* 无 /api → HTML；/api/hr/* 全 500（FK） |
| 岗位责任与人事治理 | 报错 | /hr/governance/dashboard HTML（R1）；/api 版 500（R2）→ ui-eval/misc/hr-governance-500.png |
| 工资审批与发放 | 报错 | /hr/payroll/dashboard 同上 |
| 资料更新审批 | 报错 | /hr/profile-update-requests 同上 |
| Promotion Appraisals | 报错+裸英文 | /hr/performance/reviews；页签未翻译 |
| 培训计划 | 报错 | /hr/training/videos |
| 员工申诉 | 报错+裸键 | /hr/grievance-cases；标签 `hr.subnav.grievances` |
| PDA 管辖域 | 报错+裸键 | /api/hr/pda-domains 500（employee_name 列不存在）；标签 `hr.subnav.pdaDomains`；**页内 "Publish PDA domain" 按钮在审计点击页签时被误触发出 POST 400**（HrPdaDomains.tsx:14 create 绑定在 toolbar 按钮上，页签 sweep 点到它）→ 说明该按钮位于 .toolbar 内与页签混排 |

### Finance（6 页签，App.tsx:1002-1059）
全部假空态/静默失败：/finance/* 无 /api → HTML（R1）；/api/finance/* 存在但 admin 403（R3）；dashboard-summary 路由真缺（8080 HTML）。
FinanceDashboard.tsx:18 `.catch(()=>setLoading(false))` + :22 `if(!data) return null` → **看板整块消失无提示**。
死按钮：新建收付款（1041）。截图 ui-eval/misc/finance-empty-html.png。
DB：ar_invoices/ap_invoices=0；payments 表不存在。

### Procurement（5 页签，App.tsx:1067-1121）
requisitions/rfqs/contracts/pos 走 /api/procurement/* → 200 真 JSON（items 0）→ **正确空态**；dashboard 标签裸键 `procurement.dashboard`、contracts 裸键 `procurement.contracts`（i18n 缺）；requisitions/rfqs/pos 三键共用 procurement.purchaseOrders 文案靠 procurementTabLabel 硬编码三语覆盖（1081-1086）。

### Reports（22 页签，reports/index.ts:90-121）
全部报表页签 /reports/:key → dev HTML → **假空态"暂无数据"**（R1）；8080 直连 /reports/* 200 JSON（rows 0，真亦空）但 /api/reports/* 403（R3，双挂载鉴权不一致）。
导出 CSV 链接 /reports/:key/export 同样不代理。DashboardOverview 用 mesApi.getLines+pmcApi.getWorkOrders（R1）→ 0 卡。
记忆搜索/ICT Flint/Flint Demo/工站实时监控/工站图表：渲染正常（station 页走 /api/station/*、/api/pda/* 真数据）。
截图 ui-eval/misc/reports-empty-html.png。

### Admin（9 页签，App.tsx:2765-3013）
| 页签 | 状态 | 问题 |
|---|---|---|
| 角色与权限 | 正常(静态) | 前端 roleMatrix 静态展示，与后端权限种子不符（R3） |
| 用户授权 | 报错 | /admin/users、/admin/roles 无 /api → HTML（8080 有 JSON）→ ui-eval/misc/admin-authorization-html.png |
| PDA用户权限 | 报错 | /pda/app-catalog 无 /api → HTML |
| PDA应用目录 | 报错 | 同上 |
| 产线管理 | 报错 | /mes/lines 无 /api → HTML（8080 有 6 线） |
| 系统服务监控 | 正常 | 真数据：1/3 在线、5s 自刷新 |
| 工站数据库管理 | 正常 | /api/station/database-management：91 工站 |
| 外部数据源 | 正常 | rjms 源连接✓ 1320 表、同步 606,777 行 |
| 集成枢纽 | 正常(空) | /api/hub/apps 200「尚无接入应用」 |
大量硬编码中文串（2796-2804、2817-2825、2899-2919 等）。

### QMS（17 页签，qms/QmsApp.tsx:28-46）—— **整模块死**
R4 裸键 + R1：/qms/kpi/summary 等无 /api 且 8080 亦无路由 → QmsDashboard 显示 `qms.loadError`；andon/cockpit 永久加载；其余页签裸键+空。
截图 ui-eval/misc/qms-raw-keys-loaderror.png。
**重复质量 surface**：quality（MES 工站检验）vs qms（死）vs oa.quality（IQC/MRB/IPQC/FAI/OQC/模板）vs reports 质量域 vs mes 质量页签 —— 5 处入口、3 套数据源，qms 与 oa.quality 功能重叠且 qms 全坏。

### Quality（4 页签，App.tsx:2434-2678）
dashboard 假空态（/quality/records HTML，R1；quality_inspections=0 真亦空）；标签裸键 `quality.dashboard`。
**页签可达性缺陷**：dashboard 工具条只渲染 dashboard+aoi 两按钮（2583-2608），fct/autoLine 按钮只出现在 fct/autoLine 分支里 → 从 dashboard 永远到不了 fct/autoLine（死页签）。
AOI 页 /quality/aoi/records + /mes/stations HTML → 空+Partial data 警告。

### Trace（单页，App.tsx:2680-2763）
假空态：/traceability/events HTML（R1；8080 有 JSON，traceability_events=0 真亦空）。
查询框不过滤（2681-2698）、默认串硬编码、铃铛死按钮。截图 ui-eval/misc/trace-empty-html.png。

### Sales（5 页签，App.tsx:1172-1251）
dashboard/quotes/orders/conversion 走 /api/sales/* → 200 真 JSON（0）→ 正确空态；conversion 路由 /api/sales/conversion 不存在但组件静默。
campaigns = 占位文案（1560-1569）。死按钮新建报价单（1233,1269）。截图 ui-eval/misc/sales-campaigns-placeholder.png。

### Service（4 页签+2 注册页，App.tsx:1576-1661）
**全硬编码空数组**（R5）：dashboard 四卡恒 0、tickets/rma 恒空、qualityLinks 占位；SLA 基准日硬编码 2026-06-19。注册页存在但无后端路由可落。

### Einvoice（3 页签，App.tsx:1124-1166）
dashboard/invoices 走 /api/einvoice/* → invoices 200 空（正确空态）；**config 500：表 einvoice_config 不存在**；dashboard 标签裸键 `einvoice.dashboard` 等。

### Maintenance（导航"设备维护"）
**死模块**：内容映射直接 LazyFactory3D（App.tsx:3188），Maintenance 组件 25 页签（1758-1825）不可达；maintenance_work_orders=0、equipment_assets=60 无 UI 消费。

### Projects（应用注册，3 页签）
list 调 /api/projects → **真 404**；dashboard/register 表单渲染但无后端。

### ProjectMgmt（项目管理，3 页签）
**假数据模块**（R5）：内存 SEED_PROJECTS 5 条（PRJ-ENG-001…），CRUD 仅内存；列表/仪表盘以真实台账样式展示假项目。截图 ui-eval/misc/projectmgmt-seed-data.png。

### Workflow（工作流看板，单页）
渲染正常但数据病：/api/workflow/status 200；经理卡 "NaN天前"（last_patrol null 未守卫）、卡面"运行正常"与表格"离线"矛盾；bus-recent 空。截图 ui-eval/misc/workflow-nan-days.png。

### Employee（员工自助，5 页签）
**employeeId 由用户名数字猜测**（App.tsx:3199 `username.replace(/\D/g,"")||1` → admin→1，错人）；/hr/employees/1 等无 /api → HTML（R1）+ R2 → 个人信息 "—/—"、考勤/请假/申诉全空。截图 ui-eval/misc/employee-empty-profile.png。

---

## 3. DB 对账摘要（只读 SELECT）
oa schema 187 表。关键：flow_definition 33 / flow_instance 260(全 completed) / flow_task 972(全 approved) / flow_cc 0 / flow_log 1232 / notification 124 / announcement 0 / org_user 41 / org_department 10 / doc_system 260 / doc_issue_record 260 / doc_obsolete 0 / doc_external 0 / drive_folder 4 / drive_file 0 / knowledge_doc 1 / iqc_lot_mirror 288(pending 232+wms_closed 56) / iqc_record 0 / mrb_mirror 0 / ipqc·fai·iqc_template 0 / equipment* 0 / meeting 0 / meeting_series 7(活跃4) / attendance_rule 2 / work_calendar 4 / summary·schedule 0 / salary_structure 0 / salary_class 18 / performance 0 / training_plan 0 / exam 0 / handover 0 / template_custom_field 43 / flow_definition_version 42(24 defs) / sys_module 48 / sys_role 17 / sys_permission 34。
public：employees 39 / departments 11 / positions 26 / production_lines 6 / equipment_assets 60 / hr_employees 0 / work_orders 0 / quality_inspections 0 / traceability_events 0 / sales_* 0 / ar·ap_invoices 0 / customer_service_tickets 0 / rma_requests 0 / marketing_campaigns 0；payments、einvoice_*、procurement_requisitions/rfqs/pos 表不存在（路由却存在→空壳）。
UI 与 DB 一致处：OA 全部计数✓；不一致处：IQC stats0 vs mirror232、OA 设备0 vs public 资产60、salary_class18 未展示、training1 孤儿。

## 4. 结论计数
- OA 59 叶：正常 22 / 正确空态 30 / 报错 1(oqc) / 不可用表单 2(ipqcFill,faiFill) / 列坏 2(iqc 标签+分页, meetingSeries) / 重复入口 5→1(qcTemplates)。
- 管理模块：真后端缺路由 6 处（customer-pos、erp/customers、projects、qms/kpi、finance/reports/dashboard-summary、einvoice/config 表）；HR 全 API 500（FK）；admin 权限 403（finance/reports）；dev 代理缺口致假空态/报错 ≈40 页签；死模块 2（maintenance、qms）；假数据 1（projectMgmt）；硬编码空 1（service）；死页签 2（quality fct/autoLine）；裸键 ≈12 处。
- 审批写路径、全部 CRUD/导入/发布按钮：untested-write（只读审计约束）。
