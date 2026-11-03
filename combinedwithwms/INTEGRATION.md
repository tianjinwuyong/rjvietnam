# combinedwithwms 集成方案（INTEGRATION）

> 目标：把 WMS 执行层 + OA 协同层统一到一个前端工作台上。
> 本方案基于对 `wms/server`、`wms/client` 真实源码的研读，以及对远端生产部署（`D:\WMS-20261019`，NSSM 服务 `WMS`，PostgreSQL 18）的核实。

## 一、已核实的架构事实（真实代码，非假设）

- **后端是单体 NestJS**，在 `:3000` 同时提供 `/api`（前缀已确认：`/api/system/login`、`/api/receipt/*` 等）并用 Express 静态托管 React 构建物 `dist/client`。
- **默认关闭跨域**：CORS 白名单为空时一律不发跨域头，只认同源；`@Public()` 仅放行登录/运行时配置/SPA 兜底。
- **全局 JWT 守卫**：除 `@Public()` 外所有接口需登录；响应统一包装 `{ code, message, data }`，校验失败返回中文提示。
- **前端（React）**：`localStorage('wms-user')` 存 JWT Bearer；**18 个角色**（zh/vi/en 三语）；`/api/system/me` 启动校正登录态。
- 后端已含 `oa-integration` 模块（审批已迁 OA），并有 `WMS_APPROVAL_DISABLED` 开关；另有 `mes-api` / `mes-sync` 对接 MES。
- **可直接复用的 API 契约**：system（login/me/logout/param/account/role/operation-log）、receipt、iqc、inventory、mrb、workorder、warehouse、material、bom、stock-take、over-picking、supplier-return、rework、defective-move、mes-sync、notice、dashboard、oa-integration、mes-api。

## 二、集成模型（核心结论）

`combinedwithwms` = 一个新的 **Vue3 前端**，**复用现有 WMS 后端**，**不新建后端、不新建数据库**。
它与现有 React 客户端是「同一套 `/api` 的两个前端」。

```
combinedwithwms (Vue3)  ─┐
                         ├─►  WMS 后端 (:3000, /api, 全局 JWT)  ─►  PostgreSQL 18 (wms)
React 客户端 (现有)    ─┘                              └─►  oa-integration 模块
```

## 三、对齐远端项目的两个决定（用户拍板：用远端实际用的）

1. **托管方式 = 同远端**：WMS 后端在 `:3000` 同源托管 `dist/client`。
   - 开发期：Vite `/api` 代理 → `localhost:3000`。
   - 生产期：combinedwithwms 的 `dist` 由后端同源托管（替换或并列 React 客户端），**免跨域**。
2. **UI 组件库 = 对齐远端风格**：远端用 shadcn/ui（Radix 系自研组件）+ antd-table 兼容层。
   - combinedwithwms（Vue）用 **shadcn-vue（Reka UI）+ TanStack Table** 作为等效实现，保持视觉/交互一致。
   - 早期草稿里的 Element Plus 方案废弃（风格不符）。

## 四、要复用的东西（不要重造）

- **API 契约**：把 `wms/client/src/api/*.ts` 的接口定义 port 成 `combinedwithwms/src/api/*.ts`（或合并为 `wms.ts` + `oa.ts`）。
- **鉴权**：同一套 JWT 流程（login → 存 token → Bearer → 401 跳 /login → 启动 getMe）。
- **角色/权限**：复用 18 角色 + `menuPermissions`（`wms/client/src/auth/AuthContext.tsx` 的 `ROLE_MAP`）。
- **三语**：zh/vi/en（越南厂必须），把 `wms/client/src/i18n/locales/*` 搬过来。

## 五、建设路线

- **Phase 0 外壳**：Vue3 + Vite + vue-router + Pinia + vue-i18n(zh/vi/en) + shadcn-vue(Reka UI) + BasicLayout（侧边菜单 + 顶栏 + 语言切换）+ auth store + 路由守卫。
- **Phase 1 接真接口**：登录 + Dashboard（执行指标卡）+ 1~2 个真实业务页（收料 / 质检）。
- **Phase 2 搬领域页**：MRB / 工单 / 库存 / 仓库 / 物料 / BOM / 盘点 / 超领 / 退料 / 返工 / 不良移库 / MES 同步 / 通知。
- **Phase 3 OA 协同**：把 `oa-integration` 的审批 / 待办接进统一仪表盘。
- **Phase 4 上线托管**：决定 combinedwithwms 是「替换」还是「并列」为独立入口（默认同后端同源托管）。

## 六、运维 / 安全提醒（来自远端生产诊断，集成后同机运行会碰到）

- **启动竞态**：`WMS` 服务与 PostgreSQL 同时开机，WMS 抢连库报 `57P03`（数据库正在启动）。建议给 `WMS` 服务加 PostgreSQL 依赖延迟或启动重试。
- **防火墙**：3000 仅靠 `node.exe` 的 Private-profile 程序级规则；网络一旦被识别成 Public 就断。建议加显式 3000 入站规则。
- **凭据**：远端 `.env` 的 `DB_PASSWORD=123456`、`SSL_PFX_PASSPHRASE=wms2024` 偏弱；远端 Windows 管理员密码 `rj`、SSH 已在会话中暴露——建议轮换。

## 七、待办 / 下一步

- [ ] 用 shadcn-vue(Reka UI) + TanStack Table 重写 Phase 0 外壳（替换早期 Element Plus 草稿）。
- [ ] port `wms/client/src/api/*` → `combinedwithwms/src/api/*`。
- [ ] 接入登录 + Dashboard + 收料/质检真实页（Phase 1）。
- [ ] 与 `oa-web`（OA 分支）合并菜单，纳入 OA 协同域（Phase 3）。
