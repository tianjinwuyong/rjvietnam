# OA 新前端「1:1 复刻」完成度审计报告

**日期**：2026-11-07
**场景**：设计审查 + 功能实测 + 代码覆盖度审计（三线并行）
**参与成员**：设计顾问（gstack-designer）+ QA与发布（gstack-qa-lead）+ 调查员（gstack-investigator）
**审计对象**：`app/web-next` 构建产物 `index-CQEDunXf.js` / `index-DyhrnyvR.css`（2026-11-07 22:40），已接管根路径 `http://127.0.0.1:8080/`
**基准真值**：`D:/_oatmp/oldsrc/*.html`（18 份老系统 DOM）+ `app/web/dist/oa-shell.css` + `app/web/dist/assets/index-pYhjZmIb.css`

---

## 📌 TL;DR（执行摘要）

- **整体结论：🟡 有条件通过（不是"完全复刻"）**
- 结构层（标题/页签/列/按钮/空态）约 **87%** 一致；像素度量层（字号/行高/内边距/宽度）约 **62%** 一致；**综合约 8 成**。
- 页面单元覆盖 **90/101 ≈ 89%**（91 条老 SPA 路由覆盖 90 条，51 个可见菜单项零丢失；10 个老独立管理页迁入 0 个）。
- **阻塞项 1 个（P0）**：首次登录改密流程断裂，重置密码后的账号登录即卡死。
- **功能面是好消息**：54/54 页巡检 0 异常，交互实测 40 项通过 38 项，文档/排班/组织/盘/流程/品质/会议核心链路都能用。
- **最大的视觉偏离是两个系统性错误**，不是零散页面问题：① 老系统两套度量口径被我压平成一套；② 一条 `body{display:flex}` 让全站宽度失控。

---

## 🎯 核心结论卡片

| 项目 | 内容 |
|------|------|
| 是否"完全复刻" | **否**，综合约 8 成 |
| Go / No-Go | 🟡 条件 Go（修完 P0 + 2 个 P1 可上线） |
| 严重度分布 | 🔴 P0 × 1 / 🟠 P1 × 6 / 🟡 P2 × 12 / 🟢 正面结论 × 4 |
| 页面覆盖 | 90/101 页面单元；51/51 菜单项有路由 |
| 功能实测 | 巡检 54/54；用例 30/32（另 2 项为脚本断言过时，剔除后 **30/30**）；交互 38/40 |
| 上线判断 | **不可直接上线，修 2 处（P0 首登改密 + P1 薪资页签）后可放行** |
| 关键行动项 | 7 条（3 条必须先做） |
| 建议负责人 | 前端（布局/薪资）+ 后端（统计口径）+ 产品（Hero 去留） |

---

## 1. 各成员核心结论

### 🎨 设计顾问（视觉/结构一致性）
- **核心判断**：不是"某些页面还差一点"，而是**两套度量体系被错误合并**。老系统 oa-shell 独立页（th 12.5/500、正文 13）与 Vue 主应用页（th 14/600、正文 14）本来并存，`ep-bridge.css` 全站按前者压平，导致 13 个 Vue 页字号整体小一档、每行高 6px。
- **关键建议**：G1（字号分档）+ G2（行内边距）+ G3（溢出）作为一批改，都在 `ep-bridge.css` 与布局容器层，改动集中收益覆盖全站。
- 16/18 页抽查，只有 `/exam` 可称完全一致。
- **两次自我更正**：撤回 `/drive` 伪复刻误报（整页计数未做区域限定）；撤回"`body{display:flex}` 是溢出唯一根因"（它只是"外泄"根因，内容过宽在页面级 grid）。

### ✅ QA与发布（功能可用性）
- **核心判断**：**有条件可用**。功能面比视觉面健康得多——54 页 0 异常，核心链路点下去都能用。
- **发现 1 个复刻引入的 P1 回归**：薪资页签切换时子组件 `ref` 尚未挂载，可选链静默跳过，数据永不加载。计薪方案页签完全不可用、休假字典显示"为空"但库里 14 条。
- **关键建议**：这是单点修复（`onTabChange` 补 `await nextTick()`），修完连带修好 4 个页签。
- 另外查清 12 张空表属**库内真无数据**，不是 bug；打印水印"只有 1 个元素"是 `position:fixed` 逐页重复的标准做法，也不是 bug。

### 🔧 调查员（代码覆盖度）
- **核心判断**：路由/菜单层几乎全对齐（99%），样式业务类 138/142；短板在 **10 个老独立管理页迁入 0 个**。
- **关键建议**：P0 首登改密必须先补；另发现 `.oa-page` 是"文档要求必用但新老 CSS 都没有定义"的空类。
- **自我更正一次**：撤回"103/133 类重复定义"，正确口径是 5 个真冲突 + 11 个跨文件覆盖。
- 正面结论：核心 5 个布局类（`.oa-layout/.oa-sidebar/.oa-main/.oa-header/.oa-content`）与老 Vue 主应用 **逐字一致，100% 搬迁**。

---

## 2. 综合审查发现（去重合并，按严重度排序）

### 🔴 P0 — 阻塞

| # | 位置 | 问题 | 证据 | 来源 |
|---|---|---|---|---|
| 1 | `views/Login.vue:70` → `/first-login` | **首登改密流程完全断裂**。登录后跳 `/first-login`，但该路由不在 `pages.js`（0 命中）也不在 `server.js` 白名单（0 命中），vue-router 无匹配 → 落 `NotFound`。`router/index.js` 守卫无 `must_change_pwd` 判断（0 命中）。重置密码后固定为 `oa@123456` 且带 `must_change_pwd=true` → **这类账号登录即卡死**。 | 代码注释自述"改密页还没重写，先把人送回老系统的 first-login"，但老 dist 已下线 | 调查员（team-lead 已复核） |

### 🟠 P1 — 全局/高影响

| # | 位置 | 问题 | 来源 |
|---|---|---|---|
| 2 | `styles/legacy-shell.css:145` `body{display:flex}` | **全站宽度失控的唯一外泄点**。老独立页 body 是 flex（DOM 为 `body > .oa-layout`），新 SPA 是 `body > #app > .oa-layout`，`#app` 变 `min-width:auto` 的 flex item：内容窄时收缩（首页右侧白 290px、六卡换行 5+1），宽时不收缩（`/org` 2077px vs 视口 1466，整页横滚 611px）。根因在生成器 `tools/build-legacy-shell.py:110` 的 `keep_only_oa` 对 oa-shell 未生效，漏剔 `body`。 | 设计顾问 + 调查员 |
| 3 | `styles/ep-bridge.css:55-83,134-143` | **口径混用（比"压平"更严重）**。老真值：`.el-table` 14px、th 600/14px/`8px 0`、td `8px 0`、small `4px 0`、`.el-tabs__item` 40px/14px/`0 20px`、header margin `0 0 15px`。新：字号 13、th 500/**12.5px**/`10px 0`、td `11px 0`、small `7px 0`、tabs 42px/13px/`0 14px`、margin 14px。**两条硬证据**：① `12.5px` 在老 Vue 主 CSS 里出现 **0 次**，在 `oa-shell.css` 里 6 次且全是 `.oa-page-sub`，属凭空取值；② tabs 那四个值与 `.oa-tab`（顶部二级导航 chip，`legacy-shell.css:188-201`）**连书写顺序都相同**，是把「导航 chip」度量套到了「内容页签」上。**修法不是调数字，是换口径源**——逐条调会调出第三套口径。 | 设计顾问 + 调查员（行号已对齐） |
| 4 | `views/salary/Index.vue` `onTabChange` | **复刻回归**：`tab.value = name` 后同步调 `schemesRef/profilesRef/classesRef/quotaRef.load()`，但四个子组件由 `v-else-if` 渲染、此刻未挂载，`ref.value === null`，可选链静默跳过。→ 计薪方案页签无任何数据入口（无「查询」按钮）、休假字典永远空表（库内 14 条）。同文件 `onNewStructureForClass()` 已正确 `await nextTick()`，反证是遗漏。 | QA |
| 5 | `views/salary/Index.vue` / `attendance/Calendar.vue` vs `.oa-page` | **内边距 20/40 两档随机**。`.oa-page` 在新老 CSS 里**都没有定义**（但 `PAGE-CONVENTIONS.md:63` 规定"必用"）。老 Vue 页根是 `main.oa-content` 嵌在 shell 的 `.oa-content` 里 = 双层 40px；老独立页（salary/calendar）单层 20px。现状：45 个用 `.oa-page` 的页面只有 20px（**少 20**）；salary/calendar 用 `.oa-content` 作根变 40px（**多 20**）。 | 设计顾问 + 调查员 |
| 6 | `views/Home.vue:192 行内` | **「各流程单量」整块缺失**。老首页底部 33 个流程条目、5 列网格、按单量降序（体系文件受控发行 229 单、报销单 1 单…）。`.oa-flow-entry` 样式类已在 `legacy-shell.css` 就绪，纯粹没渲染。 | 设计顾问 |
| 7 | `ipqc/components/TemplateEditor.vue:10-11` | **误改控件类型**。老页面 `el-tabs`/`oa-seg` 均 0 次，实际是 `.qm-head` 里「检验建模」标题 + `el-radio-button` 三个分段；新前端改成 `el-tabs` 四页签，还丢了标题。**一处错三个路由**（ipqc/fai/inspect）。文件注释"老界面四个页签"是错的。 | 设计顾问 + 调查员 |
| 8 | 35 个 `.vue` 文件的 `<style scoped>` | **G11：31 页标题字重 700，老真值 500**。全局值（`legacy-shell.css:482-483` 的 18px/500）本来是对的，是页面自己抄了一份 `.oa-page-title{font-size:18px;font-weight:700}`（`doc/List.vue:344`、`flowcfg/FlowList.vue:239`、`drive/Index.vue:809` 等几乎同一行复制粘贴）改坏的。同类还有 37 个文件重定义 `.oa-page-head`（4 种变体：center/12px、center/14px、baseline/6px、baseline/12px）、14 个重定义 `.oa-empty`（3 种变体：24/32/40px）。**后果：同屏字号与间距随机漂移，且改一处全局 CSS 修不好。** | 设计顾问 |

### 🟡 P2 — 页面级偏差

| # | 页面 | 问题 | 来源 |
|---|---|---|---|
| 8 | `/` | 「办理完成」229→0：`Home.vue:170` 的 `?tab=done` 口径比老系统窄（老=我经手且办结），需后端对齐 | 设计顾问 |
| 9 | `/` | 发行动态写死 5 条（`Home.vue:181` `slice(0,5)`），老 6 条 | 设计顾问 |
| 10 | `/` | 时间丢时分：`shortDate` 只取前 10 位（`Home.vue:155`），老显示 `2026-08-13 01:46` | 设计顾问 |
| 11 | `/` | Hero 渐变横幅是**新增设计**，老首页是三行纯文本无色块 → 待用户拍板 | 设计顾问 |
| 12 | `/org` | 行操作缺「删除」（老有；新改为弹窗内「停用」，**若属有意的软删除设计变更则可降级**）；表格多斑马纹（老 org 无 striped） | 设计顾问 + QA |
| 13 | `/training` | 多「刷新」按钮（老无） | 设计顾问 |
| 14 | `/handover` | 列名「类型」→「交接类型」；多「关联单号」列（老 8 列→新 9 列，**待确认**：QA 核到该列取 `h.instance_no` 真实后端字段，疑非假列，未点开验证有值）；多「刷新」 | 设计顾问 + QA |
| 15 | `/drive` | 「查询」→「搜索」；缺「导出」；「预览窗格/排序方式/查看」退化成图标下拉；多「上传文件」 | 设计顾问 |
| 16 | `/meeting/create` | 丢 2 个 `oa-card-head`（老「会议信息」「参会人」两个卡片头 44px + 底边线） | 设计顾问 + 调查员 |
| 17 | OQC/IQC/MRB/Library | `oa-tip-line` 同名类三套语义：老系统仅朴素灰字 `12px + var(--oa-text-light)`；OQC 无定义（真缺口）、IQC/MRB/Library 是淡蓝条（**新增偏离**）。修法方向别写反：是让 OQC 补回老值，同时把三处蓝条当待回退项 | 调查员 |
| 18 | `config/pages.js:44-53,110,118` | 12 处页面标题与菜单名不一致（面包屑/顶栏与侧栏 chips 文案打架）；2 处硬编码中文当 i18n key，切 EN/VI 会露中文 | 调查员 |
| 19 | `config/nav.js:363-447` | 6 个手加分组渲染出"与分组同名、同地址"的重复二级 chip；且这 6 个分组在老菜单里**不存在** | 调查员 |
| 20 | `server.js:241-267` | `/next/*` 前缀已废弃（vite base=`/`）但服务端仍挂着 → 6 个 QA 脚本假失败（`qa-next-edit` 4/9 假失败，改根路径后 9/9） | 调查员 + QA |
| 21 | `styles/legacy-shell.css` | 拼接重复：L478–EOF 的 99 条与 `legacy-ui.css` 逐条相同。5 个真冲突（`.oa-page-title` 17→18、`.oa-page-head` 等）+ 11 个跨文件覆盖 → **"改了样式不生效"的根源** | 调查员 |
| 22 | `server.js:278-281` | 10 个老独立管理页迁入 0 个。6 个有 nav 入口（整页跳回老外壳，视觉断层）；**tax-console / payroll-trial / integration-setup 连入口都没有** | 调查员 |
| 23 | 多处 | 死代码：`salary/Template.vue`（无 import 但渲染完整 UI）、`router/index.js:26-32` building 路由永不命中、`NotFound.vue:34` "回老系统"按钮是自指死循环 | 调查员 |

### 🟢 正面结论（避免全盘否定）

| # | 结论 | 证据 |
|---|---|---|
| 1 | 核心 5 个布局类 100% 逐字搬迁 | `.oa-layout/.oa-sidebar/.oa-main/.oa-header/.oa-content` 与老 `index-pYhjZmIb.css` 一致 |
| 2 | 菜单/路由覆盖 99% | 51/51 可见菜单项有路由，91 条老路由覆盖 90 条（仅缺 `/first-login`） |
| 3 | 业务样式类 138/142 | 26 个缺失里 22 个是有意剔除的外壳类，真缺口只有 `oa-tip-line` 1 个 |
| 4 | 功能面扎实 | 文档 A4 分页 22 页/42377 字/目录页码/打印水印/编辑锁全通过；排班月历 1140 格、切月、批量刷班；组织树+调动记录；公共盘进出+剪切粘贴；品质四页签路由正确；会议筛选带 `overdue=true` |
| 5 | 无占位代码 | 全 src 无 TODO/FIXME/"暂未实现"/空 `@click`/写死 disabled |
| 6 | i18n 覆盖 96/98 | 仅 2 处硬编码中文 |
| 7 | `/drive` 文件列表是**高保真** | 老系统本来就是自绘 `div.dl-*` 网格，新前端同源（`dl-hcell`→`dl-th` 改名） |

---

## ✅ 行动清单

| # | 行动 | 负责方 | 紧急度 | 验收标准 |
|---|------|--------|--------|---------|
| 1 | 补 `/first-login` 页面（或改为弹窗改密）+ `router/index.js` 守卫加 `must_change_pwd` 拦截 + 删 `NotFound.vue` 自指按钮 | 前端 | **P0** | 用 `must_change_pwd=true` 的账号登录，能完成改密并进入系统 |
| 2 | `build-legacy-shell.py` 的 DROP 加 `body/html/a/::selection/*`（保留 `:root` 与 `[data-theme]`），重跑生成；同时改 `org/Index.vue:537` 为 `320px minmax(0,1fr)` | 前端 | **P1** | 首页六卡回一行、右侧留白消失；`/org` docW ≤ 视口宽 |
| 3 | `salary/Index.vue` `onTabChange` 改 `async` + `await nextTick()` 再取 ref | 前端 | **P1** | 计薪方案页签出现方案选项；休假字典显示 14 条 |
| 4 | `ep-bridge.css` **换口径源重写**（不是调数字）。唯一合法基准 = `app/web/dist/assets/index-pYhjZmIb.css` + `legacy-ui.css`；`oa-shell.css` 不适用（老独立页由 server 白名单直发老 HTML，根本不加载 ep-bridge）。table 恢复 14px/600/`8px 0`/small `4px 0`；tabs 恢复 40px/14px/`0 20px`/header margin 15px | 前端 | **P1** | 13 个 Vue 页字号与老系统逐项对齐；行高不再高 6px；`12.5px` 不再出现在 el-table 规则里 |
| 5 | 给 `.oa-page` 补 `padding:20px`，salary/calendar 改单层 | 前端 | **P1** | 45 个页面左边距 248；salary/calendar 228 |
| 6 | 首页补「各流程单量」33 条 5 列网格；`slice(0,5)`→`(0,6)`；时间格式带时分；后端对齐「办理完成」口径 | 前端+后端 | P1/P2 | 首页与 `old_home.html` 逐项一致 |
| 7 | 品质模板改回「检验建模」+ `el-radio-button` 三分段，删第 4 个页签 | 前端 | P1 | 与 `quality_tpl_ipqc.html` 结构一致 |
| 8 | `legacy-shell.css` 去重（删 L478–EOF + 5 条死声明），验证残余差异 0 | 前端 | P2 | `css-zero-change.mjs` 输出差异 0 |
| 9 | 摘除 `/next/*` 服务端路由，6 个 QA 脚本改根路径 | 前端+QA | P2 | `qa-next-edit` 直接 9/9 |
| 10 | 补 tax-console / payroll-trial / integration-setup 三个 nav 入口 | 前端 | P2 | 侧栏点得到 |
| 11 | 清理 35 个 `.vue` 里的 `.oa-page-title` 覆写（全局已有 18px/500）；37 个 `.oa-page-head` 只保留合法的 `justify-content` 差异；14 个 `.oa-empty` 统一回 `20px 0` | 前端 | **P1** | 40 条路由实测：标题 700→500 归零；head 只剩 1 种取值；empty 只剩 `20px 0` |

---

## ⚠️ 待完善 / 已知局限

1. **10 个老独立管理页未迁入**（salary-console 141KB 最大）。它们由 `server.js` 白名单直供，点进去会**瞬间掉回老外壳**——视觉/交互断层，是"复刻感"的重灾区。这是结构性边界，非缺陷。
2. **首页 Hero 横幅去留待用户决策**：1:1 就拆，想要改版就保留并记为"有意设计"。
3. **`/org` 右侧列被裁不是我们引入的**：老系统 `.el-table__body-wrapper` 本身 `overflow-x:hidden`，老页面同样裁列。我们真正的回归是"整页横向滚动"，别误修成"让表格能横滚"。
4. **`/salary` 与 `/attendance/calendar` 的体系归属已裁定**：老 DOM 里 `el-table`/`el-tabs` 均为 0、页签是手写 `<button data-tab>` → **属 oa-shell 独立静态页体系**，应按 17px/600 + 卡片头 32px 无底边线复刻。调查员依据 `docs/frontend-contract.json` 判为 Vue 页的说法不成立（该文件是迁移表，与 8090 实际服务行为不符）。
5. **真值覆盖面有限**：18 份老 DOM 快照，非全站 54 页。未抽查页面只能按共同模式推断。
6. **8090 登录态不稳定**：任何依赖老站实时渲染的对比都可能拍到登录页（`pairs/salary.old.png`、`pairs/org.old.png` 已证实）。本轮改为"老 DOM + 老 CSS 本地渲染"双轨取证，结论不依赖老站在线。
7. **QA 两项失败属脚本问题非产品问题**：`qa-next-edit` 5 项因 `/next/` 前缀失效、`qa-admin-tools` 2 项因断言过时（找「权限管理台」与实际「权限管理」不符）。QA 已确认全部用例跑在根路径，未受前缀干扰。
8. **QA 明确标注未验证（不凑数）**：`/handover` 关联单号列是否有值未点开确认；3 个孤儿老页（tax-console / payroll-trial / integration-setup）无菜单入口，归入覆盖度问题。
9. **溢出判据已更正**：调查员先前"同类溢出嫌疑 10 页"属未验证推断，已被实测部分证伪（`org/Import`、`exam/List` 不溢出；`meeting/Actions` 用 `.oa-page` 作根反而 +270px）。**判据统一为 `scrollWidth vs clientWidth` 实测，不再按根类名推断**，因此报告只收录已实测的 6 页。
10. **⚠️ 修复陷阱（务必先读）**：`.el-tabs__item` 的间隔老值是 **40px**（相邻两项 右20+左20），新值 28px，**是变窄 12px 不是变宽**。EP 有边界归零规则（`.el-tabs__item:nth-child(2){padding-left:0}`、`:last-child{padding-right:0}`），首项量到的是归零后的非对称值 `0 20px 0 0`。**若照"应恢复成 20"去改，会把 28 改成 20，比现在更歪。** 同理，后续取证一律取中间项、并输出四值全量 padding，2 值简写会被误读成对称。

---

## 📚 成员产出索引

- **gstack-designer（设计顾问）**：逐页判定表 16/18 页 + 全局 G1–G10 + 首页专项审计；本地渲染真值脚本 `oldrender/*.html` + `measure-local.mjs`、`probe-measure.mjs`、`probe-clean.mjs`；产物 `old-fp.json` / `new-clean.json` / `meas1.log` / `meas2.log`，截图 `shots2/`
- **gstack-qa-lead（QA与发布）**：54 页巡检 + 32 项用例 + 40 项交互；可复跑 `qa-interact.mjs`、`qa-salary-tabs.mjs`、`qa-dict-repro.mjs`、`qa-edit-root.mjs`、`dbq.mjs`；截图 `shots/interact/`
- **gstack-investigator（调查员）**：路由/菜单差集、样式类集合对比、伪复刻鉴定、`/next/` 死链、CSS 冲突明细 208 行（`D:/_oatmp/audit/css-conflicts.md`）；脚本 `route-coverage.mjs`、`cssdiff-all.mjs`、`css-conflicts.mjs`、`css-zero-change.mjs`、`title-mismatch.mjs`、`i18n-check.mjs`
- **team-lead（主理人）**：基准裁决（`/salary` 体系归属）、`/first-login` P0 复核、内部基准补充（`old_home.html`）、跨成员结论冲突仲裁

---

> 本报告由软件工坊 AI 协作生成，关键决策请由工程负责人复核。
> 全部结论可复现：脚本与 JSON 产物位于 `D:/_oatmp/`，未修改任何生产文件。
