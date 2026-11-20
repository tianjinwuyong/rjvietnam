# OA 前端重建路线图（路径 D）

**日期**：2026-10-24  
**场景**：前端重建（自主可控重写，基于现有 `/api` 后端）  
**参与**：主理人（单工程师执行，未建团队）

---

## 📌 TL;DR

- 已用 **Vue 3 + Vite 5 + Element Plus** 重建前端基座：登录、鉴权、布局、三语、工作台全部跑通，已对接真实后端（8080）。
- 后端 **465 个接口** 已自动提取成契约文档，作为逐模块迁移的对接基准。
- 下一步按「高频核心 → 业务纵深 → 支撑模块」分阶段迁移；**不直接覆盖生产 dist**，走 staging + 备份 + 回滚。

---

## 1. 背景与约束

| 项    | 现状                                               |
| ---- | ------------------------------------------------ |
| 前端源码 | ❌ 已丢失（无 `.vue`、无 sourcemap、无 vite 配置）            |
| 现有前端 | `app/web/dist`：Vue3 压缩产物，171 个路由 chunk，不可维护      |
| 后端源码 | ✅ 完整（Fastify 5 + 原生 pg，19 路由 / 51 service）       |
| 后端接口 | ✅ 465 个，契约已提取（见 `api-contract-oa-2026-10-24.md`） |
| 运行环境 | 后端 8080 正常（production），DB connected              |
| 约束   | 三语（zh/vi/en）、权限码 31+、`X-OA-Lang` 错误三语化、同源部署      |

## 2. 技术选型

| 层    | 选择                         | 理由                           |
| ---- | -------------------------- | ---------------------------- |
| 框架   | Vue 3.5 + Vite 5           | 与原系统同栈，团队认知成本最低              |
| UI   | Element Plus 2.9           | 原系统即 Element Plus，组件语义一致     |
| 状态   | Pinia                      | 轻量，替代 Vuex                   |
| 路由   | vue-router 4（history）      | 与后端 SPA fallback 兼容          |
| 三语   | vue-i18n 10                | 结构化词库；业务枚举走 `/api/i18n/dict` |
| HTTP | axios                      | 统一信封解包 / 401 处理 / 语言头注入      |
| 部署   | 同源 `/api`；dev 走 Vite proxy | 复用后端静态托管，零 CORS、零 token 差异   |

## 3. 里程碑 M1（已完成）

- [x] API 契约提取：17 文件 / 465 端点 → `src/api/catalog.json` + 契约 md
- [x] 工程脚手架：`package.json` / `vite.config.js` / `index.html`
- [x] API 客户端：token 注入（Bearer）、`X-OA-Lang`、统一信封 `{code,msg,data}` 解包、401 自动登出
- [x] 鉴权：Pinia `auth` store（login / profile / changePassword / logout / 权限判断）
- [x] 路由与守卫：未登录跳登录、已登录访问 /login 回首页
- [x] 三语：zh/vi/en 词库 + Element Plus 语言包联动 + 账号级语言同步
- [x] 布局：侧边栏（14 个业务域）+ 顶栏（折叠/语言/用户菜单）
- [x] 页面：登录页、工作台（待办/草稿/抄送/通知 + 快捷入口 + 系统信息）、改密、404、模块占位
- [x] 构建：`npm run build` 通过（1689 modules，8.17s）
- [x] 联调：登录接口实测 `code=0`，token 64 位，`isAdmin=true`，31 权限；`/api` 代理通

## 4. 工程结构

```
oa-web/
├─ vite.config.js          # /api → 127.0.0.1:8080 代理；build → dist
├─ index.html
└─ src/
   ├─ api/client.js        # axios 实例：token / 语言头 / 信封解包 / 401
   ├─ api/catalog.json     # 465 端点目录（契约基准）
   ├─ stores/auth.js       # 登录态、用户、权限、计数
   ├─ stores/app.js        # 语言 / 主题 / 侧边栏
   ├─ router/index.js      # 路由 + 守卫（由 menu 配置生成）
   ├─ config/menu.js       # 顶层导航单一数据源
   ├─ i18n/{index,zh,vi,en}.js
   ├─ layouts/BasicLayout.vue
   └─ views/{Login,Dashboard,ChangePassword,ModulePlaceholder,NotFound}.vue
```

## 5. 部署切换方案（安全第一）

> 现有 `app/web/dist` 是**线上可用**前端，严禁直接覆盖。

1. 备份：`cp -r app/web/dist app/web/dist.bak.<日期>`
2. 构建到 staging：`oa-web/dist` 先产出到 `app/web/dist.new`
3. 验证：用独立端口（如 8081 或临时目录）跑一遍登录/核心页
4. 原子切换：`mv dist dist.old && mv dist.new dist`，保留 `dist.old` 可秒回滚
5. 回滚：`rm -rf dist && mv dist.old dist`（无需改后端）
6. 注意：`NODE_ENV=production` 才托管 `web/dist`；构建产物文件名带 hash，浏览器缓存天然失效

## 6. 分阶段迁移路线

| 阶段     | 业务域      | 页面                                       | 后端文件                       | 优先级 |
| ------ | -------- | ---------------------------------------- | -------------------------- | --- |
| **P1** | 工作台      | 首页、待办、抄送、通知中心                            | auth/notify/flow           | 高   |
| **P1** | 流程审批     | 发起、待办、已办、抄送、流程设计、版本、台账、交接                | `flow.js`(34)              | 高   |
| **P1** | 体系文件     | 列表、详情、新建、草稿、签审、发布、借阅、印章                  | `doc.js`(49)               | 高   |
| **P1** | 考勤       | 打卡、汇总、异常、补卡、排班、班次、日历                     | `attendance.js`(58)        | 高   |
| **P2** | 设备       | 台账、点检、校准、保养、盘点、统计、移动扫码                   | modules/stocktake          | 中   |
| **P2** | 质量       | IPQC / FAI / IQC / OQC / MRB / 模板库 / 标准项 | oa-iqc/qc-library/... (46) | 中   |
| **P2** | 公共盘      | 文件夹、文件、权限、分享、回收站、审计                      | `drive.js`(26)             | 中   |
| **P2** | 会议       | 会议、纪要、决议、行动项、跟进                          | `meeting.js`(52)           | 中   |
| **P3** | 组织/系统    | 部门、岗位、工段、入职、用户、角色、权限、配置、审计               | `system.js`(45)            | 中   |
| **P3** | 培训考试     | 培训计划/记录、题库、在线考试、上岗证                      | training(17)/exam(17)      | 低   |
| **P3** | 薪资       | 薪资结构、薪级、绩效、生成、导出                         | attendance(薪资部分)           | 低   |
| **P3** | 知识库      | 文档、收藏、喜欢、检索                              | `modules.js`               | 低   |
| **P3** | 统计/日历/公告 | 概览、高级统计、工作日历、公告                          | flow/modules               | 低   |

## 7. 风险与对策

| # | 风险                                                | 对策                                                           |
| - | ------------------------------------------------- | ------------------------------------------------------------ |
| 1 | 误覆盖生产 dist 导致线上不可用                                | staging + 备份 + 原子切换 + 保留 dist.old                            |
| 2 | 业务枚举靠后端字典，缺 `en` 时回落口径                            | 统一 `utils/label.js`：zh 兜底，en 为 null 时回落 zh                   |
| 3 | drawio 流程图 / 富文本编辑器 / xlsx 导入导出 / 扫码 原为 dist 内置能力 | 逐项评估：引入 drawio iframe 或替换；xlsx 用 SheetJS；扫码用 qr-scanner      |
| 4 | 31+ 权限码，按钮级权限易漏                                   | 封装 `v-perm` 指令 + `auth.has(code)`，逐页对齐后端 `requirePermission` |
| 5 | 文件下载需 token（新窗口）                                  | 下载统一走 `?token=` 拼 URL，或 blob + header                        |
| 6 | 移动端扫码需 HTTPS 安全上下文                                | 沿用后端 8443 或 Nginx TLS                                        |

## 8. 下一步（需确认）

1. **迁移顺序**：默认按上表 P1 起，是否调整？
2. **首个落地模块**：建议「流程审批 → 待办/发起」或「体系文件 → 列表/详情」，二选一先做深。
3. **是否允许**：先在 staging 目录并行构建，验证 OK 后再原子切换生产。
4. **富文本/流程图**：是否复用现有 drawio（iframe）还是替换为轻量编辑器？

---

> 本路线图由 AI 工程协作生成；部署切换前请人工复核并在业务低峰执行。
