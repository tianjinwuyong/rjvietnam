# SMT 前端结构评估与修改建议(2026-11-21)

范围:`apps/web/src` 的导航骨架 + 移植三域(WMS/MES/OA)。所有结论带 file:line 证据;已按「**便于从运行中的 WMS/OA/MES 持续同步**」这一约束给建议。

---

## 一、总体结论

骨架是好的:**一级侧边栏(App.tsx)→ 域内二级菜单(wmsMenuGroups / mesGroups / OA_MENU)→ tab 渲染** 三层清晰,且三个移植域都已建立「源菜单 → 本地落点」的对照机制(WMS 62 项全量对照表、OA 菜单逐项对齐原版 BasicLayout、MES 按业务域拆组)。**问题不在分层,在一致性:三个域用了三种不同的移植保真策略,一级侧边栏有死入口和重复入口,同步成本没有被结构固化。**

## 二、逐项发现(证据)

### A. 一级侧边栏(App.tsx)

| # | 发现 | 证据 | 影响 |
|---|---|---|---|
| A1 | **`mesrj` 是死入口**:在 FULL_MODULES(admin/plant_manager 白名单)里,但 `modules` 数组和 `moduleGroups` 都没有它 → 侧边栏永远不显示;内容已拆成 mesrjHome/Material/Exec/Quality/Cfg 五个 tab 挂进 MES 分组 | App.tsx:432 vs 159-204;mes/index.ts:191-197 | 白名单与渲染脱节;`mesrj:` 渲染分支(App.tsx:3203)成死代码 |
| A2 | **`mobile`/`team`/`mobileleave`/`manualLine3d` 同样只在角色白名单、不在侧边栏**,靠 hash 直达 | App.tsx:430-453, 3139-3141 | 不是 bug(移动端/PDA 有意不进桌面侧边栏),但应注释声明,否则每次审计都当死代码 |
| A3 | **quality 与 qms 双入口并存**,图标相同(ClipboardCheck),渲染两个不同组件 | App.tsx:169-170, 3179/3183 | 用户不知道进哪个;质量域还有第三处(WMS 内 quality 组、MES 内 mesrjQuality) |
| A4 | **运营组 13 项里 5 个是「大使」页**(ambassadorDashboard + 4 个大使),且都不在 FULL_MODULES → admin 侧边栏看不到,只有特定角色可见 | App.tsx:199, 428-433 | 分组语义混乱:「计划与仓储」里塞了 5 个绩效页;可见性靠白名单隐式控制,无声明 |
| A5 | **`resolveModuleAccess` 是死代码**:定义了按权限推导侧边栏的兜底(App.tsx:488-499),但 Shell 实际用的是 `roleModuleAccess[roleKey] ?? ["dashboard"]`(App.tsx:552) | grep 全文件仅 488 一处定义、零调用 | 注释承诺「新角色不会渲染空导航」(App.tsx:462-466)实际不成立:未登记角色只剩 dashboard |
| A6 | **Heartbeat 硬编码 `http://127.0.0.1:8080/health`**,不走 client.ts 的 VITE_API_BASE/同源逻辑 | App.tsx:509 | 生产/nginx 部署下健康灯永远红 |
| A7 | ModuleKey 联合类型有重复成员(`"dashboard"` 出现两次)与大量仅 hash 可达的 3D agent 键 | App.tsx:157 | 类型不收紧,死键无法被编译器发现 |

### B. WMS 域(移植保真度:★★★ 最好)

- **62 项源菜单全量对照表已存在**:`docs/wms-menu-map-2026-11-20.md`,数据来自运行中 WMS 的 `GET /api/system/login` 返回的 menuPermissions(实测,不是猜)。
- 菜单按「货往哪走」重排成 12 组(wms/index.ts:97-144),工程/测试页(shelfApi、shelfSim、sqlConsole)有意不进运营菜单但可 URL 直达 —— 这是对的。
- **问题 B1:同一 tab 重复注册**:`rework`、`supplierDebt`、`defectiveMove` 在 wmsTabKeys 里各出现两次(wms/index.ts:64 与 70-72)。渲染不炸(map 覆盖),但菜单计数/测试断言会重复。
- **问题 B2:rjvn 镜像页与 canonical 页并排挂在运营菜单**(rjvnClassic/rjvnData/rjvnCanonical 在 overview 组,rjvnIqc/rjvnInventory/rjvnPicking/rjvnDocFlow 分散在各组,wms/index.ts:99/108/111/118)。后端正在做 one-WMS 收敛(slice 3a 已把部分出口改读 canonical),**前端把两套数据源同时暴露给操作员,口径分歧(16 批 IQC)会被肉眼看到却无从解释**。
- **问题 B3:同步没有机器可校验的锚**:对照表是 markdown,源系统菜单变更后没有任何检查会报警。

### C. MES 域(移植保真度:★★ 中)

- 原 mesrj 独立模块已按业务域拆进 mesGroups 的 7+3 组(mes/index.ts:190-201),组内保留原菜单层级 —— 方向对。
- **问题 C1:5 个 mesrj tab 的标签是「瑞晶 · 物料域」这类移植视角命名**(i18n.ts:5579-5583),操作员看到的是「哪个系统搬来的」而不是「干什么的」。同步期可接受,收敛后应改成业务名。
- **问题 C2:mesTabTranslationKeys 有 7 个硬编码中文值**(pdaDevice/pdaScan/pdaOnline/materialRollQr/smtMaterialBindings/smtLoading3d/smtLoader,mes/index.ts:159-165),绕过 t() 三语机制,vi/en 用户看到中文。
- **问题 C3:ngClosedLoop 与 ngManagement 共用同一个翻译键**(mes/index.ts:153-154),两个 tab 显示同名。
- **问题 C4:MES 源菜单没有对照表**(WMS 有 62 项表,OA 有逐项对齐注释,MES 只有拆组注释)。上游 MES-ruijing 已在持续同步(迁移 345 一次追了 77 提交),**前端侧没有等量的菜单漂移检测**。

### D. OA 域(移植保真度:★★★ 策略最省同步成本)

- OA 原生模块**菜单结构/文案逐项对齐原版 BasicLayout**,连词典键都复用原版 menu.*(oa/menu.ts 头注),未实现叶子显示「建设中」而不是隐藏 —— **这是三个域里最利于持续同步的做法:源菜单变了,diff 一眼可见**。
- 后端用 Fastify→Express shim 让 24 个路由文件原样注册(src/oa/shim.js),前后端同一策略:**适配层吸收差异,移植体不动**。
- **问题 D1:oa-web/oa-web-next 静态站(281+41 文件)与原生 OA 模块并存**,部分页面(integration-console、my-payslip 等)只有静态站有。两套 OA 前端没有「哪页走哪边」的清单,同步时要人工判断。

## 三、修改建议(按「利于持续同步」排序)

### P0 — 把同步锚从文档变成代码(直接服务「easy sync」)

1. **每个移植域建一份机器可读的菜单映射清单** `apps/web/src/<域>/source-menu-map.json`:
   `{ sourceKey(源菜单权限键/路由), targetTab, status: "ported"|"reused"|"wip"|"dropped", note }`。
   WMS 直接把 docs/wms-menu-map-2026-11-20.md 的 62 行转成 JSON;OA 把 menu.ts 的对齐关系导出;MES 补建(源 = MES-ruijing 的菜单定义)。
2. **加一个闸门脚本 `scripts/check-menu-parity.mjs`**:断言 ① 清单里每个 sourceKey 都有 targetTab 或显式 dropped;② 每个 targetTab 真实存在于该域 tabKeys;③ 域内运营菜单组覆盖所有 ported 项。挂进 harness.config.json。
   **效果:运行中的源系统菜单一变(登录接口/源菜单文件),拉下来 diff 清单即知缺什么 —— 同步从「人肉对照」变成「跑一个脚本」。**
3. **rjvn 镜像页收进一个「原系统对照」开发者组**(或加 adminOnly 标记),运营菜单只留 canonical 页。与后端 one-WMS slice 链同步收敛,避免操作员在两套口径间迷路。

### P1 — 侧边栏重组(一级)

4. **按业务域重排 moduleGroups**,建议 6 组:
   - 总览:dashboard、managerDashboard、reports
   - 计划与物料:pmc、wms、bom、procurement
   - 生产执行:mes(含 mesrj 拆组)、smtReelConsumption、andonBoard、maintenance
   - 质量:quality、qms、trace(见第 5 条合并)
   - 协同办公:oa、workflow、hr、employee
   - 经营与系统:finance、sales、service、einvoice、projects、projectMgmt、admin、ai、agents
   - 大使 5 页单独成「绩效大使」组,并显式声明角色可见性(而不是靠不在 FULL_MODULES 里隐式隐藏)。
5. **quality/qms 二选一做质量主入口**,另一个降级为其中一个的 tab;WMS/MES 内的质量页保持域内视角不动(那是操作流,不是管理视角)。
6. **删除死入口**:FULL_MODULES 里的 `mesrj`(内容已在 MES 分组);`mesrj:` 渲染分支与 MesrjModule 全量挂载改由五个分组 tab 复用。给 mobile/team/mobileleave/manualLine3d 加「hash-only,有意不进侧边栏」注释。
7. **接上 resolveModuleAccess**(App.tsx:552 改用它),兑现「新角色不空导航」的承诺;或删掉死函数并改注释 —— 二选一,不要留两套。
8. **Heartbeat 改用 client.ts 的 API base**(同源/VITE_API_BASE),修生产健康灯。

### P2 — 一致性修复(小改)

9. wmsTabKeys 去重(rework/supplierDebt/defectiveMove 各删一处)。
10. mesTabTranslationKeys 7 个硬编码中文 → i18n 三语键;ngClosedLoop 换独立键。
11. ModuleKey 联合去重;把 hash-only 键与侧边栏键拆成两个类型,让「死入口」变成编译期可查。
12. mesrj 五个 tab 标签在收敛完成后改业务名(「物料主数据」「生产执行」…),保留 sourceKey 映射供同步。

### 同步策略总原则(三域统一)

**OA 模式是标杆:适配层(shim/菜单词典复用)吸收框架差异,移植体保持与源逐项可 diff;WMS 模式是补充:全量对照表 + 按业务流重排。MES 目前两者都缺一半。** 统一成「源菜单清单(JSON)+  parity 闸门 + 适配层」三件套后,从运行中系统同步 = 拉源菜单 → diff 清单 → 补缺口,每一步都有机器检查兜底。

---

## 四、不建议做的

- 不要把三个移植域合并成一个大模块 —— 域内二级菜单是操作员的心智模型,也是同步的边界。
- 不要现在删除 rjvn 镜像页/表 —— 后端收敛未完成(slice 3b 的 16 批分歧待现场拍板),前端先隔离可见性即可。
- 不要动「建设中」占位策略 —— 它是 OA 同步可见性的关键。

---

## 五、实施状态（2026-11-22 回填）

- **已落地**：P1-4 侧边栏 7 业务域组（App.tsx moduleGroups）、P1-6 删 mesrj 死入口+hash-only 注释、P1-7 resolveModuleAccess 接线、P1-8 heartbeat 同源 /health（含 vite/nginx 代理修复）、P2-9 wmsTabKeys 去重、P2-10 mes 硬编码标签三语化+ngClosedLoop 独立键、P2-11 ModuleKey 去重。quality/qms 双入口：QMS 为侧边栏主入口，quality 保留注册供角色白名单/深链（P1-5 的「降为 tab」待 QMS 翻译修复后做，见合并计划 R6）。浏览器+闸门验证见 WMS_GRAFT_LOG 2026-11-22。
- **未落地（进合并计划）**：P0-1/2 source-menu-map.json + check-menu-parity（§3）、P0-3 rjvn 镜像收开发者组（§3.3）、P2-12 mesrj 业务名（§3.4）。
- **全量页面审计与视觉评估**：docs/page-audit-{wms,mes,oa-misc}-2026-11-21.md、docs/ui-design-report-2026-11-21.md、docs/graft-parity-report-2026-11-21.md。
- **合并修改计划（唯一执行清单）**：`docs/ui-modification-plan-2026-11-22.md` —— 根因 R1-R7、假闭环 D1-D15、同步锚、视觉容器统一，三波独立可停。