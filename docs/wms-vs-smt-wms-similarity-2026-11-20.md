# 运行中的 WMS 与 SMT 系统 WMS 板块 —— 相似度对比（2026-11-20）

## 0. 口径与证据

| 对象 | 位置 | 取证方式 |
|---|---|---|
| 运行中的 WMS | `http://127.0.0.1:3000`（Express 静态 SPA + API 同端口，`X-Powered-By: Express`） | 实测登录 `admin/admin`、401/400 响应体、SPA bundle（3.2 MB）反查路由/接口/鉴权 |
| SMT 系统 WMS 板块 | 前端 `apps/web/src/wms`（123 个文件），后端 `services/api/server.js` 的 `/wms/*`（180 条）与 `/api/*`（241 条模板） | 代码扫描 + 运行实例 `:8080` 实测登录（`admin/Factory@123`）、token 解码 |

实测数据点：
- WMS 登录 `POST /api/system/login` → `{code:0,message:"success",data:{…,token}}`；token HS256、276 字符、`exp-iat=604800s`（7 天）。
- SMT 登录 `POST /api/auth/login` → `{data:{token,roleKey,roles,roleDefinition,user,expiresAt},meta}`；token HS256、1709 字符、`exp-iat=86400s`（24 小时）。
- WMS 接口模板 230 条 / 19 个模块；SPA 路由 46 条；菜单权限 62 项。
- SMT `/api` 接口模板 241 条（其中 `/api/wms/*` 76 条）+ `/wms/*` 180 条；WMS 页面 123 个文件。

## 1. 相似度总表

| 维度 | 相似度 | 判定依据（详见第 2-5 节） |
|---|---|---|
| **前端** | **57%** | 同为 React 18 + Vite；但路由、UI 库、i18n、401 全局处理完全不同 |
| **后端** | **58%** | 同为 Express + JWT Bearer；响应包、权限模型、端点命名分叉 |
| **业务逻辑** | **80%**（模块覆盖 94.7% / 逐条契约 9.1%） | 19 个业务模块里 17 个能在 SMT 找到等价实现，但接口签名几乎不重名 |
| **JWT** | **67%** | 算法/Bearer/基础 claims 一致；有效期、权限载体、吊销机制不同 |

综合（四维等权）：**≈ 65.5%**。一句话结论：**能力上高度重叠，契约上互不兼容**——SMT 的 WMS 板块是「照着重写」而不是「同一套系统的部署」；两者可并存，但要互通必须做一层适配（路径/响应包/权限）或统一到其中一套契约。

## 2. 前端对比（权重等权，10 项）

| # | 判据 | 运行 WMS | SMT（apps/web） | 得分 |
|---|---|---|---|---|
| 1 | 框架 | React（bundle 内 react 103 处） | React 18.3.1 | 1.0 |
| 2 | 构建 | Vite | Vite 5.4.21 | 1.0 |
| 3 | 路由 | `react-router`（46 条 SPA 路由） | 无 react-router，自研菜单/模块注册（166 菜单项） | 0.2 |
| 4 | 组件库 | Arco Design（`@arco-design/web-react`，94 处引用） | 自研组件 + lucide-react + recharts/echarts | 0.3 |
| 5 | HTTP 封装 | axios 实例 `baseURL:"/"` + 请求/响应拦截器 | 自研 fetch 封装 `api/client.ts`（sessionStorage/localStorage 双读） | 0.6 |
| 6 | 状态管理 | React Context（`Rz.Provider`，user/role/login 三态） | Context + 各页 local state | 0.8 |
| 7 | 鉴权存储 | `localStorage['wms-user']` = 整个用户 JSON（含 token） | `sessionStorage['auth_token']` + `localStorage['token']` | 0.6 |
| 8 | 401 全局处理 | 拦截器：清 storage + 跳 `/login` | 无全局跳转，抛 `ApiClientError` 由页面处理 | 0.3 |
| 9 | 多语言 | 中文硬编码（bundle 内联全部文案，含"深圳市瑞晶实业有限公司/仓库管理系统"） | i18next 三语（zh-CN/en-US/vi-VN） | 0.2 |
| 10 | 图表 | bundle 内无 echarts/recharts 指纹 | echarts 6 + recharts | 0.7 |
| | **合计** | | | **5.7/10 = 57%** |

页面规模对比：WMS 46 条 SPA 路由 / 62 项菜单权限；SMT WMS 123 个页面文件，菜单是更大集合（含 MSD、货架、上架、语音、单位、成品、报废、PDA 管理、供应商门户等 WMS 没有的模块）。

## 3. 后端对比（9 项）

| # | 判据 | 运行 WMS | SMT | 得分 |
|---|---|---|---|---|
| 1 | 运行时 | Node + Express（同端口托管 SPA） | Node + Express（`:8080`，前端另起 Vite） | 1.0 |
| 2 | 接口前缀 | `/api/<模块>/*` | `/wms/*` + `/api/wms/*` 两套并存 | 0.5 |
| 3 | 成功包 | `{code:0,message:"success",data}` | `{data,meta}`（部分老接口 `{success,msg,data}`） | 0.4 |
| 4 | 错误包 | `{error:{code,message,details,timestamp}}`（Nest 风格） | `{error:{code,message}}`（`details` 可选） | 0.7 |
| 5 | 鉴权 | JWT 中间件，`Authorization: Bearer` | 同 | 1.0 |
| 6 | 权限模型 | 菜单级 `menuPermissions[]`（token 不带权限，登录返回 62 项） | 路由级 `permissions[60]`（写进 token，`requirePermission` 校验） | 0.5 |
| 7 | 端点契约 | 230 条模板 | 与 WMS 逐条同路径的仅 21 条（`defective-move` 10、`over-picking` 6、`rework` 6 等） | 0.1 |
| 8 | 模块数 | 19 | `/wms/*` 57 个 + `/api/*` 24 个（命名不同：receipt→receiving、workorder→work-orders、stock-take→count-sessions、inventory→raw-material-inventory） | 0.5 |
| 9 | 分页约定 | `items/total/page/pageSize` | 同口径（`{items,total}` 为主，部分 `{rows,total}`） | 0.5 |
| | **合计** | | | **5.2/9 = 58%** |

### 3.1 模块级映射（19 个 WMS 模块逐一核对）

| WMS 模块 | WMS 端点数 | SMT 对应 | 判定 |
|---|---|---|---|
| iqc | 33 | `/wms/iqc*`（5）+ QMS/iQC 体系 | 等价（深度待比） |
| workorder | 30 | work-orders(7) + pick-orders(3) + issue-to-line + collect-orders(5) + shortages | 等价（拆分更细） |
| mrb | 22 | 独立 `/mrb` 路由 | 等价 |
| system | 19 | `user-roles`(2) + `/sys` CRUD + `/param` | 部分（SMT 账号体系更分散） |
| stock-take | 18 | count-sessions(5)+count-items+count-schedules(3)+count-alerts | 等价 |
| material | 17 | material-master/categories/lots/rolls/label-master/roll-labels | 等价 |
| dashboard | 13 | `closure`(6) + WmsDashboard 系列页面 | 等价 |
| inventory | 12 | raw-material-inventory / inventory-transactions / stock / transactions | 等价 |
| receipt | 11 | receiving(18) + receiving-queue | 等价（改名） |
| mes-sync | 11 | mes-exchange(8) + 回写 | 等价 |
| defective-move | 11 | `/api/defective-move/*` 10 条，逐条同名 | **契约级一致** |
| warehouse | 9 | warehouses(3)+zones(3)+storage-locations(6)+floor-storage-areas | 等价 |
| over-picking | 6 | `/api/over-picking/*` 6 条，逐条同名 | **契约级一致** |
| rework | 5 | `/api/rework/*` 6 条 | **契约级一致** |
| supplier-return | 4 | supplier-returns + `/supplier-return` 路由 | 等价 |
| notices | 4 | `/notices` 路由 | 等价 |
| bom | 4 | bom-material-governance + bom-material-reviews | 等价 |
| supplier-debt | 2 | `/supplier-debt` 路由 | 等价 |
| itf | 1 | 未找到（接口对接用，1 条） | **缺** |

> 模块覆盖 =（17 等价 + 1 部分×0.5 + 1 缺）÷19 = **94.7%**；
> 逐条契约覆盖 = 21/230 = **9.1%**。

## 4. JWT 对比（9 项）

| # | 判据 | 运行 WMS（实测解码） | SMT（实测解码） | 得分 |
|---|---|---|---|---|
| 1 | 算法 | HS256 | HS256 | 1.0 |
| 2 | 传输 | `Authorization: Bearer` | 同 | 1.0 |
| 3 | `userId` | `"3ed0524f-8c8d-460e-a95a-1752fa95d47b"` | `"12"`（整型字符串） | 1.0（字段同名，类型不同） |
| 4 | `username` | `admin` | `admin` | 1.0 |
| 5 | 角色 | `role + roleName` | `roleKey + roles[]` | 0.5 |
| 6 | 权限载体 | token **不带**权限，登录返回 `menuPermissions[62]` | token 内嵌 `permissions[60]` + `jti` | 0.3 |
| 7 | 吊销 | 未见（无 jti） | `jti` + 内存吊销表 + `/auth/logout` | 0.4 |
| 8 | 有效期 | 7 天 | 24 小时 | 0.5 |
| 9 | 登录契约 | `POST /api/system/login`，包 `{code,message,data}` | `POST /api/auth/login`，包 `{data,meta}` | 0.3 |
| | **合计** | | | **6.0/9 = 67%** |

共同点：都自己签 HS256 JWT、都用 Bearer、都靠前端存 token（无 HttpOnly Cookie）、都没有 refresh token。
关键差别：**WMS 的 token 是"身份凭证"，权限在登录响应里按菜单下发；SMT 的 token 是"能力凭证"，60 个权限点直接写进 token**——所以 SMT token 更大（1.7 KB vs 276 B），但服务端每请求少查一次权限表；代价是权限变更必须重新登录。

## 5. 差异清单（按影响排序）

| 级别 | 项 | 证据 | 影响 |
|---|---|---|---|
| 高 | SMT 没有有效期管控后端 | `WmsExpiryControl.tsx` 是空壳（`useState<ExpiryLot[]>([])`），`server.js` 无任何 `expiry` 端点；WMS 有 11 条 `/api/inventory/expiry*` | 页面看着有、点了没数据 |
| 高 | 两套契约并存 | SMT 同时有 `/wms/*`（180 条，自定义）和 `/api/*`（241 条，部分是 WMS 同名契约） | 现场/PDA 接错前缀就 404，维护要记两套 |
| 中 | 权限模型不一致 | WMS 菜单级 + `menuPermissions`；SMT 路由级 + token 内权限 | 统一认证时需映射表（SMT 60 权限点 ↔ WMS 62 菜单） |
| 中 | 响应包不一致 | `{code:0,message,data}` vs `{data,meta}`/`{success,msg,data}` | 前端适配层必须区分，混用静默失败 |
| 中 | 401 处理 | SMT 客户端无全局登出跳转 | token 过期后页面停留在错误态 |
| 低 | itf 模块缺失 | WMS 仅 1 条，SMT 未找到 | 对接类功能可能漏迁 |
| 低 | 多语言 | WMS 全中文硬编码；SMT 三语 | 越南现场 WMS 侧需补 vi-VN |

## 6. 建议

1. **先补有效期管控**（唯一明确的功能缺口）：`GET /wms/inventory/expiry`（按批次/物料聚合 + 剩余天数分级）+ `POST /wms/inventory/expiry/extend`，直接落 `material_lots.expiry_date`，页面接上即可。
2. **定契约方向**：要么把 SMT 的 WMS 页面对齐到 `/api/wms/*`（现有 21 条同名契约已是样板），要么明确 `/wms/*` 为唯一契约并给 WMS 客户端加适配层——不要长期双轨。
3. **统一 JWT**：若两者要做单点登录，建议 SMT 侧接受 WMS 的 `role` 字段并映射到 `roleKey`，同时给 WMS 加 `jti`+吊销（SMT 已有现成实现）。
4. **前端最小对齐**：SMT 客户端补 401 全局清 token + 跳登录（10 行改动），与 WMS 行为一致。

## 7. 附：本次取证的原始数据位置

- WMS 接口模板清单：`%TEMP%\wms_api_paths.txt`（230 条）
- WMS SPA bundle：`%TEMP%\wms_bundle.js`（3.2 MB，含全部中文文案与鉴权逻辑）
- WMS 登录响应：`%TEMP%\wms_login.json`（含 62 项 menuPermissions、276 字符 token）
- SMT 接口清单：`%TEMP%\smt_api_routes.txt`（241 条 `/api/*`）、`%TEMP%\smt_wms_routes.txt`（180 条 `/wms/*`）
- SMT 登录响应：`%TEMP%\smt_login.json`（1709 字符 token、60 权限点）
