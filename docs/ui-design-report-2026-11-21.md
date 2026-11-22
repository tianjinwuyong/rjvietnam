# SMT 工厂控制台 UI/视觉设计评估与重设计提案(2026-11-21)

范围:运行中控制台 http://127.0.0.1:5178/(admin 登录)的**视觉/UX 层**:一级侧边栏、域内二级导航、顶栏、状态色、空态/加载态、三语布局、1366×768 适配、悬浮虚拟员工组件。
方法:真实浏览器截图(1600×900 与 1366×768 两种视口,zh-CN/vi-VN/en-US 三语)+ 代码 file:line 佐证。结构层结论沿用 `docs/frontend-structure-evaluation-2026-11-21.md`(下称「结构评估」),本文不重复其发现,只补视觉/交互证据并给出**落地重设计**。
截图均存于 `ui-eval/`,前缀 `uivis-`。

---

## 一、现状速写(带证据)

### 1. 一级侧边栏:27 项、5 组、无内部滚动、无折叠、无搜索

- 实测 admin 可见 **27 个按钮、5 个组**(计划与仓储 6 / 产线与质量 8 / 分析与管理 11 / 项目 1 / 员工 1;结构评估里「运营组 13 项」含 5 个大使页,admin 白名单过滤后剩 6,App.tsx:552-558)。
- `.sidebar` 固定 **300px**(styles.css:74,95-96),`overflow-y: visible`;`.nav-groups` 无滚动(styles.css:150-162,186-189)。实测侧边栏总高 **1956px**,把整个文档撑到 1956px —— **侧边栏随整页滚动,不是独立滚动区**。1600×900 首屏只能看到 27 项中的前 ~10 项;要进「分析与管理」组必须整页下滚(uivis-02-sidebar-bottom.webp)。
- **1366×768**(工厂常见 PC)首屏侧边栏只露出 **7 项**(到「工作流看板」为止,uivis-15-dashboard-1366.webp)。`.module-nav button` min-height 42px + gap 6px(styles.css:206-216),27 项 ≈ 1300px+ 组标签,768px 视口必然裁掉 2/3。
- **active 与 hover 同色**:`.module-nav button:hover, .module-nav button.active { background: var(--nav-2) }`(styles.css:218-221)——鼠标掠过的项与当前模块视觉完全相同,截图里曾出现「BOM 与 MES 同时高亮」的误读(uivis-07-mes-overview.webp)。
- **图标重复**:Activity 用于 smtReelConsumption/andonBoard/workflow/pdaCommMonitor 4 项;ClipboardCheck 用于 quality/qms/oa 3 项;LayoutDashboard 用于 pdaUiDesigner/ambassadorDashboard(App.tsx:165-195)。侧边栏里「SMT 料卷消耗 / 工作流看板 / 安灯监控」三个图标一模一样(uivis-01、uivis-15)。
- **组语义错位**:「计划与仓储」里塞总控台/工作流看板(协同类);「分析与管理」11 项大杂烩(报表+市场+客服+财务+采购+发票+管理+人事+维护+应用注册+AI+虚拟员工+OA);「项目」「员工」两个**单项组**白占两行组标签(App.tsx:198-204;组标签文案 i18n.ts:305-307,4180-4181)。
- **无搜索/跳转**:27 个一级入口 + WMS 105 个二级 tab,全系统没有任何搜索框或 command palette(截图全量确认;WmsMenuPage/App.tsx 均无 input[type=search])。
- 侧边栏状态卡(工厂/班次/同步 06:14)是**硬编码静态值**(App.tsx:591-604),与顶栏「API OK」健康灯语义重复且不同步。

### 2. 顶栏:模块名出现 3 次,且不吸顶

- 同一模块名同时出现在:侧边栏 active 项、顶栏 h1、顶栏右侧 Badge(App.tsx:616-625,654,659-662)。uivis-06 里「WMS 物料」×3。
- `.topbar` **position: static**(styles.css:262-265,实测 computed static)——下滚后语言切换/退出/健康灯全部消失;而侧边栏又随整页滚,于是**滚到页面下半段时既无顶栏也无导航**,只剩内容和悬浮组件。
- 域内还有第 4 次重复:WMS tab 页顶部 `SectionHeader title=nav.wms subtitle=page.wms`(App.tsx:1990)与外层顶栏 h1+subtitle 逐字相同(uivis-05/06 上下两个「WMS 物料 / 收料、IQC、库存…」)。

### 3. 二级导航:四个域四种模式,且都「吃」首屏

| 域 | 模式 | 首屏导航开销(1600×900 实测) | 证据 |
|---|---|---|---|
| WMS 菜单页 | 独立深色门户:11 个渐变大按钮组 + 组内 tile 网格 + 硬编码中文流程图 | 整屏都是导航,无业务内容 | WmsMenuPage.tsx:81-159;uivis-03 |
| WMS tab 页 | 两行按钮工具栏:12 组按钮( wrap 2 行,86px)+ 组内 tab 按钮(13 个 wrap 2 行,57px),外加重复 SectionHeader(174px 面板) | **内容起点 y≈370px**,900px 视口 41% 是导航 chrome;1366×768 时 chrome 占 48% | App.tsx:1989-2029;实测 panels y=106/296/369;uivis-05/06/16 |
| MES | 第三套:主题 tab(产品/NG)+ 组 tab + 页 tab,每页带 `P5·NG3` 贡献度徽章 | 导航面板 ~200px;徽章是研发视角噪音 | App.tsx:2210-2257;mes/index.ts:190-206;uivis-07/08 |
| OA | 第四套:域内**第二条竖直侧边栏**(216px,分组对齐原版 BasicLayout)+ 内容区 | 双竖栏合计 516px,1366 下内容剩 850px | oa/menu.ts 头注;uivis-10-loaded;实测 aside w=216 |

- **WMS 组按钮点击 = 跳该组第一个 tab**(App.tsx:2008 `navigateWms(group.tabs[0])`),不是展开组。操作员想进「仓库管理」组会被先扔进「库存」,再在第二行找目标。
- **找「盘点」/「有效期管控」的点击路径**(无搜索):侧边栏 WMS(1)→ 菜单页组按钮「仓库管理」(2)→ tile「盘点」(3);若已在某 tab 页:组按钮(1,且先跳错页)→ tab「盘点」(2)。**目标在 105 个 tab 里,组名不提示内容**(「仓库管理」组里同时有 盘点/超期管控/有效期管控/FIFO/批次/库位 13 项,wms/index.ts:110-114),只能靠记忆或逐组试。
- **近义标签并排**:「超期管控」(expiryControl,i18n.ts:2159)与「有效期管控」(lifecycle,i18n.ts:2624)在菜单页 tile 和 tab 栏里都相邻出现(uivis-04/05),语义差异无任何视觉/tooltip 区分;菜单页 tile 用 `wms.subnav.*` 短名、源对照用长名,两套文案并存。
- **rjvn 镜像页与 canonical 页并排**:菜单页「首页」组里「仓库看板/收料结算看板/物料主数据(rjvn)/仓库档案(canonical)」并列(uivis-03),tab 栏里「库存查询」实为 rjvn 镜像(en 标签自曝 "Inventory Query (rjvn port)",uivis-14)——操作员无法分辨口径(结构评估 B2 的视觉实证)。
- **WMS 菜单页硬编码中文**:「采购与供应商管理闭环」标题、流程节点、副标题全部 zh 写死(WmsMenuPage.tsx:153-157),vi/en locale 下该区块不变;菜单页大标题也用内联三语三元而非词典(WmsMenuPage.tsx:96)。
- **视觉语言断裂**:外壳浅色(styles.css --panel 白底),WMS 菜单页深蓝渐变+橙激活+emoji 组图标(WmsMenuPage.tsx:11-25,49-58,83),MES 概览深色渐变 hero 且灰字压灰底不可读(uivis-07 hero 副文案),QMS 整域深色(uivis-11)。同一会话四种配色。

### 4. 三语与 i18n 破窗(视觉可见)

- **QMS 整域翻译失效**:QmsApp 用 react-i18next `useTranslation()`(QmsApp.tsx:2,22),外壳用自研 `t()`(i18n.ts:5997),资源未互通 → tab 条全部裸键 `qms.dashboard / qms.oqc / qms.eightD …`,内容区裸键 `qms.loadError`(QmsDashboard.tsx:27,31);且**不跟随全局语言切换**(ui.md 规则 7 违反)。uivis-11-qms.webp。
- **三语堆叠**:QMS tab「AI Visual / AI 视觉 / AI Ngoại quan」硬编码三语同屏(QmsApp.tsx:34),违反 ui.md 规则 8。uivis-11。
- **MES 裸键**:`mes.subnav.stationOperator` 在 mes/index.ts:138 注册但 i18n.ts 无此条目(仅有 pmc.stationOperator,i18n.ts:1149)→ tab 显示裸键(uivis-08/09)。`t()` 缺键回退为键本身(i18n.ts:6000),无编译期/运行期报警。
- **WMS 库存页硬编码英文**:zh/vi locale 下仍显示 "Material roll validation / Scan or enter a roll QR/SN… / Validate roll / Roll QR / SN / Available"(WmsInventory.tsx:88,100-105,140,143)。uivis-06(zh)、uivis-13(vi)。
- **报表页**:zh locale 下卡片标题为英文 slug `overall_balance / wo_progress / line_output…`,tab 条 12 项溢出换行(uivis-12-reports.webp)。
- vi/en 侧边栏本身翻译完整、300px 内不折行破版(uivis-13/14 实测);**破版点在二级导航**:en 组按钮文案长(「Material Receiving Management」),组栏 wrap 2 行 86px、tab 栏 2 行 56px,chrome 底边 y≈370(uivis-14 实测)。

### 5. 空态/加载态/错误态

- **WMS 库存双表 0 行无任何空态文案**(uivis-06/13/14/16):表头下直接空白,操作员分不清「没数据」还是「坏了」。
- **MES 产线监控空列表无空态**(uivis-08 左侧大空白);同文件其他视图有「暂无事件」三语空态(ProductionLineDashboard.tsx:456)——空态覆盖不一致。
- **MES 工位操作员死胡同**:`fetch("/api/stations")` 裸 fetch 不带 Bearer(StationOperator.tsx:41;api/client.ts:96-104 才有 token 注入)→ 401(实测网络记录)→ 工位下拉只有「— 选择工位 —」一个占位项,**无错误提示**,页面却显示「请选择工位后报到」(uivis-09)。
- **OA 首屏挂「加载中…」约 3 分钟**:实测 `/api/auth/profile` 耗时 **171184ms**,overview 依赖它,期间整页只有一个居中「加载中…」(oa/index.tsx:303),无超时/重试/骨架屏(uivis-10-oa.webp 与 uivis-10-oa-loaded.webp 对比)。
- 正面例子:工位页「尚未报到」卡、OA 统计卡空值 0、dashboard「紧急动作」入口——说明团队会做空态,只是没成体系。

### 6. 悬浮虚拟员工组件遮挡内容(P0)

- 固定右下,**z-index 240**;折叠态 290×64 已压住 dashboard「事件链」卡右下角(uivis-01/15)与 WMS 菜单页流程图「IQC/财务」节点(uivis-04)。
- **展开态 390×307**(1366×768 实测 x=958,y=443),覆盖库存表右半:**Available/库位/质量状态/动作 四列被挡**(uivis-17-widget-expanded-1366.webp)。无「避开内容/停靠」机制,操作员读表必须先手动收起。
- 组件每页换身份(OPS-SUPERVISOR / WMS-INVENTORY-VIRTUAL-01),文案「人工输入已满足」对操作员无行动含义(ui.md 警告规则 2:原因要_plain language_)。

### 7. 状态色语义

- 外壳语义基本正确:待判定=amber、NG/Blocked=red、Pass=green(uivis-01 物料状态/质量待处理),符合 ui.md「warning=pending, danger=blocked」。
- 但**导航态借用语义色**:WMS 组激活用 `var(--info)` 蓝、菜单页激活用橙渐变(App.tsx:2007;WmsMenuPage.tsx:50),与「warning=橙」语义冲突;MES 主题/组/页三层激活色各异(uivis-07/08)。
- QMS 深色域里 `#f87171` 红字裸键(qms.loadError)把「加载失败」渲染成疑似严重告警(QmsDashboard.tsx:27)。

---

## 二、问题分级

### P0 — 可用性阻断
1. **侧边栏无独立滚动/折叠/搜索**:1366×768 首屏仅 7/27 项;进「分析与管理」需整页滚;active=hover 同色(styles.css:218-221)。→ 找不到入口=「easy to find」直接不成立。
2. **WMS 二级导航无搜索、组点击跳错页、105 tab 靠记忆**:盘点/有效期管控 3 击且无提示;chrome 吃掉 41-48% 首屏(App.tsx:2001-2029)。
3. **悬浮组件遮表**(展开 390×307 盖住库存表 4 列,z240)。
4. **QMS 全裸键+三语堆叠+不跟随语言切换**(QmsApp.tsx:22,34;QmsDashboard.tsx:27)。
5. **工位操作员 401 死胡同**(StationOperator.tsx:41 裸 fetch;下拉空、无错误态)。
6. **OA 首屏 171s「加载中…」无超时无重试**(oa/index.tsx:303;实测 profile 171184ms)。

### P1 — 严重体验损伤
7. 顶栏不吸顶+模块名 4 次重复(App.tsx:654/659/1990;styles.css:262)。
8. 四域四种二级导航模式+四种配色(WMS 门户/MES 三层 tab/OA 双竖栏/QMS 深色)。
9. 空态缺失不一致:WMS 库存双表、MES 产线监控空白无文案。
10. 三语破窗点:WmsInventory 硬编码英文、MES 裸键、报表英文 slug、WMS 菜单页硬编码中文流程图。
11. 图标重复(Activity×4、ClipboardCheck×3)与组语义错位(「分析与管理」11 项杂烩、单项组×2)。
12. 近义标签并排无区分(超期管控 vs 有效期管控);rjvn 镜像与 canonical 并排无标记。

### P2 — 打磨
13. MES `P5·NG3` 贡献度徽章是研发噪音(App.tsx:2254)。
14. 侧边栏状态卡硬编码 06:14/Day-A 与顶栏健康灯重复(App.tsx:591-604)。
15. 菜单页 emoji 组图标与外壳 lucide 线性图标两套语言(WmsMenuPage.tsx:11-25)。
16. 报表 tab 条 12 项溢出;en 组栏 2 行高度不可预测。

---

## 三、重设计提案(结构草图,非代码)

原则:**域边界不动**(WMS/MES/OA 各自二级菜单=同步边界,结构评估已论证);只统一「导航容器」与「视觉语言」,把「找页」从记忆变成搜索+固定路径。所有组/标签仍走现有词典键与 source-menu-map,graft 同步不受影响。

### 3.1 一级侧边栏:可折叠组 + 全局跳转搜索 + 独立滚动

Before(admin 实测 27 项平铺):
```
计划与仓储(6,平铺)  产线与质量(8,平铺)  分析与管理(11,平铺)  项目(1)  员工(1)
→ 1956px 高,随整页滚,无搜索,active=hover
```
After(6 组,沿用结构评估 P1-4 的业务域分组;默认只展开当前域):
```
[🔍 跳转… Ctrl+K]  ← 搜索一级+三个域的二级 tab(数据源=现有 menuGroups/mesGroups/OA_MENU,零新增契约)
总览            ▸ 总览 / 总控台 / 报表
计划与物料      ▾ WMS 物料(当前) / PMC 工单 / BOM 清单 / 采购
生产执行        ▸ MES 执行 / SMT 料卷消耗 / 安灯监控 / 设备维护
质量与追溯      ▸ 质量(主入口,QMS 降为其 tab) / 追溯
协同办公        ▸ OA 审批 / 工作流看板 / 人事 / 员工
经营与系统      ▸ 财务 / 市场 / 客服 / 电子发票 / 管理 / AI 助手 / 虚拟员工 / 项目管理
[底部固定] 工厂 VN-01 · 班次 · API 灯(合并现状态卡与顶栏健康灯)
```
- 容器:`.sidebar` 改 `height:100vh; position:sticky; top:0`,`.nav-groups` `overflow-y:auto` —— 导航滚动与内容滚动解耦(修 styles.css:88-99,150-162)。
- 组头可折叠(chevron),记住展开态(localStorage);**当前域自动展开**,其余收起 → 首屏 ≤12 行,1366×768 全组可见。
- active 与 hover 分色:active=左 3px 语义蓝条+底纹,hover=仅底纹(修 styles.css:218-221)。
- 搜索命中二级 tab 时直接 `factory:navigate`/URL 参数直达(机制已存在:App.tsx:1835-1852),**盘点=Ctrl+K→「盘点」→1 击**。
- 图标去重建议:workflow=GitBranch/Workflow、andonBoard=Siren/Lightbulb、pdaCommMonitor=Radio、smtReelConsumption=Disc/Reel、oa=Stamp/Inbox、qms 并入 quality 后 ClipboardCheck 只留 quality、pdaUiDesigner=SlidersHorizontal。

### 3.2 二级导航:三域统一「左组右页」单容器

Before:WMS 两行按钮墙 / MES 三层 tab+徽章 / OA 第二竖栏 / QMS 裸键横 tab。
After(统一一个 `DomainNav` 容器,各域只供数据):
```
┌ 域头(单行,吸顶): [← 域首页] WMS 物料 · 仓库管理 / 盘点   [🔍 域内搜索] ┐
├ 左列 200px:组列表(11 组,竖直,可滚,当前组高亮+计数)                      ┤
│   首页 6 · 收料管理 11 · IQC检验 15 · 仓库管理 13 · 领料与发料 20 …        │
├ 右区:当前组 tab 以「列表行」呈现(名称+一句用途 tooltip,非按钮墙)         ┤
│   盘点 — 周期/动态盘点任务与差异                                          │
│   有效期管控 —  shelf-life 开桶/复验/报废(与「超期管控」tooltip 互释)     │
└ 内容区:tab 页本体,首屏 chrome ≤110px(现 370px)                          ┘
```
- **组点击=展开组(不跳页)**;页点击才导航(修 App.tsx:2008 语义)。
- WMS 菜单页保留为「域首页」但降级:去掉独立深色门户与硬编码流程图,流程图节点文案进词典;首页=各组概览卡+最近使用(最近使用存 localStorage,操作员高频页 1 击)。
- MES:主题(产品/NG)变成左列顶部的两个分段开关;组→页两级与 WMS 同构;**删除 P/NG 徽章**(研发信息移入 tooltip,App.tsx:2254)。
- OA:**保留 OA_MENU 数据与「建设中」策略**(同步标杆),但渲染改用同一 DomainNav 左列(分组/小节照搬 oa/menu.ts),消灭第二竖栏;内容区宽度 +216px。
- QMS:并入 quality 主入口做 tab(结构评估 P1-5),翻译接回自研 `t()`(删 react-i18next 依赖或注入资源),裸键与三语堆叠随容器统一消失。
- 域内搜索与全局 Ctrl+K 共用同一索引;近义页(超期/有效期)在搜索结果里带用途副标题消歧。
- rjvn 镜像页:左列底部「原系统对照(开发者)」折叠组,默认收起、adminOnly 标记(结构评估 P0-3 的视觉落地)。

### 3.3 顶栏简化

Before:h1+subtitle+Badge(模块名)+实时数据+API 灯+语言+退出,static,模块名×4。
After(吸顶单行 48px):
```
[sidebar 开关] 面包屑:WMS 物料 / 仓库管理 / 盘点   …   [API 灯] [语言] [退出]
```
- 删 Badge 模块名与域内重复 SectionHeader(App.tsx:659-662,1990);subtitle 降为面包屑末级 tooltip。
- `position:sticky; top:0`(修 styles.css:262),滚动中语言/退出/健康灯常驻。
- 「实时数据」Badge 与 API 灯合并为一个带 tooltip 的健康指示(语义:ok=绿/warning=琥珀/danger=红,全系统唯一)。

### 3.4 悬浮组件停靠化

- 默认**停靠右下角为 48px 圆形按钮**(不遮内容);展开改为**右侧抽屉推挤布局**(workspace 让出 390px)或覆盖但带「遮罩内容时自动半透明+可拖拽」;z 降到顶栏之下。
- 文案改行动化:「本页还差 2 项必填 → 查看」(ui.md 警告规则 2),身份码移入 tooltip。

### 3.5 状态/空态/三语基线

- 空态三件套统一组件:图标+一句原因+一个行动(「无库存批次 → 去收料」),覆盖 WMS 双表/MES 监控/工位下拉(401 时显示「工位列表加载失败:登录态失效 → 重试」,修 StationOperator.tsx:41 走 apiClient)。
- 加载态:骨架屏+**10s 超时→错误态+重试**(OA overview 不再无限「加载中…」)。
- 三语闸门:把「裸键回退」(i18n.ts:6000)在 dev 模式 console.error;硬编码串(WmsInventory.tsx:88-143、WmsMenuPage.tsx:96,153-157、QmsApp.tsx:34、报表 slug)进词典;CI 加「zh/vi/en 截图 diff」抽查侧边栏+一个 WMS 页(本次 uivis-13/14 即基线)。
- 导航激活色统一语义蓝(info),橙/红只留给 warning/danger(修 App.tsx:2007、WmsMenuPage.tsx:50)。

### 3.6 同步边界守护(不做的事)

- 不合并三域菜单数据源;DomainNav 只是渲染器,组/tab 仍来自 wmsMenuGroups/mesGroups/OA_MENU 与 source-menu-map.json(结构评估 P0)。
- 不删 rjvn 页、不动「建设中」占位;只改可见性容器。
- 搜索索引由现有菜单数组派生,**源菜单新增项自动进搜索**,不新增人工维护面。

---

## 四、验收对照(用户四规则)

| 规则 | 现状差距 | 提案落点 |
|---|---|---|
| easy to find | 27 项平铺无搜索;105 tab 靠记忆 | Ctrl+K 全局+域内搜索;折叠组;最近使用 |
| easy to use | 组点击跳错页;chrome 41-48%;组件遮表;401 死胡同 | 组=展开;chrome≤110px;抽屉化;错误态+重试 |
| good to see | 四配色四模式;active=hover;裸键;空表无文案 | 单容器单配色;语义色唯一;空态三件套 |
| make sense + easy sync | 组语义杂烩;近义页并排;镜像混排 | 6 业务域组;tooltip 消歧;镜像入开发者组;菜单数据源不动 |

截图索引:uivis-01 dashboard / 02 侧边栏底 / 03 WMS 菜单页 / 04 仓库组+组件遮流程图 / 05 盘点双工具栏 / 06 库存 zh / 07 MES 概览 / 08 MES 执行组(裸键) / 09 工位死胡同 / 10 OA 加载中 / 10-loaded OA 双竖栏 / 11 QMS 裸键 / 12 报表 / 13 库存 vi / 14 库存 en / 15 dashboard@1366 / 16 WMS@1366 / 17 组件展开遮表@1366。
