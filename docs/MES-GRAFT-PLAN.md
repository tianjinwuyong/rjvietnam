# MES-ruijing 移植方案（graft plan）

日期：2026-11-18 · 来源：`D:\rj\repos\MES-ruijing`（Python/Flask + SQLite + 原生 JS）
目标：以 OA 移植同款模式原生并入 SMT 系统 —— React 页面 + Express API + PostgreSQL，无 iframe。

## 1. 源系统盘点

| 维度 | 数量 | 说明 |
|---|---|---|
| 数据表 | 66 | `sql/schema.sql`（SQLite DDL，9 个域） |
| API 蓝本 | 33 个 / 421 路由 | `api/*.py`（exec.py 256KB/44 路由为最大） |
| 前端页面 | 127 | `web/pages.js`（1.3MB，hash 路由 + `App.register(code,{render})`） |
| 设备接口 | 4 前缀 | `/DeviceConfig` `/StationPass` `/MachineData` `/Packing` |
| 种子数据 | tools/seed.py | 产线/工位/缺陷/根因/设备/阈值/打印模板/包装规则/PCB 码/字典 |

### 域划分（schema.sql 9 域）
1. **sys** 系统管理：user/role/perm/user_role/user_line/audit_log/param/api_key
2. **md** 主数据：customer/product/material/line/track/station/equipment/defect/rootcause/shift/calendar
3. **bom**：header/item（工段/替代料/工单类型映射）
4. **ord** 订单工单：po/mo_seq/mo/issue/issue_item/replenish
5. **pln** 计划：capacity/schedule
6. **proc** 工艺：route/step/station_rule
7. **prd** 执行：sn/sn_rel/pass/test/defect_rec/repair/scrap/decode/box/pallet/pass_check/machine_data/print_job/mo_route/route_change/pass_release/skip_log
8. **cfg** 配置中心：sn_rule/threshold/pokayoke/code_dict/print_tpl/pack_rule/pcb_code/bind_station/bind_rule
9. **itf** 接口：api_config/api_log + AOI 三表（aoi_result/aoi_comp/aoi_board）+ aoi 字典/映射

### 前端页面域（127 页）
home · md×10 · bom×4 · ord×3 · plan×3 · route×3 · **exec×31** · cfg×19 · sys×5 · report×8 · aoi×3

## 2. 目标架构决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 表命名 | **保持原名**（sys_/md_/bom_/ord_/pln_/proc_/prd_/cfg_/itf_） | 与 SMT public 现有 992 表零冲突（已验证），代码可直译 |
| 时间列 | `TEXT ... datetime('now')` → `timestamptz DEFAULT now()` | PG 惯例；API 层输出 ISO 字符串兼容原前端 |
| 主键 | `INTEGER AUTOINCREMENT` → `bigserial` | 仓库约定 |
| 后端 | `services/api/src/mesrj/`（每蓝本一个 service 文件） | 复制 OA 模块结构；路由挂 `/api/mesrj/*` |
| 前端 | `apps/web/src/mesrj/`（menu.ts + index.tsx 路由 + i18n/{zh,en,vi}.json） | 复制 OA 模块结构；词典取自原 `web/i18n.js` |
| 认证 | 复用 SMT JWT（`/api/auth/*`），mesrj sys_user 仅作数据行 | 单一登录，不建第二套 token |
| 设备接口 | 原样移植到 `/api/mesrj/DeviceConfig` 等前缀 | 设备侧只改 base URL；X-Api-Key 机制保留 |

## 3. 与 SMT 现有模块的关系（防重复建设）

SMT 现有 `apps/web/src/mes/`（Product Gate 架构）与 `services/api` station-pass 引擎是**并行重构线**，与 MES-ruijing 不共享表。移植期间两套并存、互不写对方表；后续由人工决策收敛方向。

## 4. 波次计划

| 波 | 内容 | 规模 | 状态 |
|---|---|---|---|
| W1 | 迁移 272（66 表 PG DDL）+ 种子（字典/产线/工位/缺陷/根因/设备/阈值/角色权限/管理员） | 2 文件 | ✅ 本次 |
| W2 | 后端基座：mesrj 模块骨架 + sys（登录会话桥接/user/role/param/audit）+ md 全 CRUD | ~15 路由 | ✅ 本次 |
| W3 | 前端基座：mesrj 菜单/路由/i18n + home + md 10 页（GenericList 模式） | ~12 页 | ✅ 本次 |
| W4 | bom（4 页）+ ord（po/mo/issue）+ pln（3 页） | ~10 页 | ⬜ |
| W5 | proc 工艺 + cfg 配置中心 19 页 | ~22 页 | ⬜ |
| W6 | exec 执行域（scan/pass/bind/pack/pallet/trace/defect/repair/release） | ~31 页 | ⬜ |
| W7 | 设备接口（DeviceConfig/StationPass/MachineData/Packing）+ itf 日志 | ~60 路由 | ⬜ |
| W8 | AOI 集成 + 报表 8 页 + 看板 board.html | ~12 页 | ⬜ |

## 5. 环境坑位备忘

- 原系统 `web/pages.js` 用 hash 路由 + keep-alive 多标签；SMT 侧用子视图路由（同 OA）
- `exec.py` 44 路由含 Check/Submit 两段式过站（prd_pass_check Mark 一次性防重放）——移植时保序
- 原登录 `rjmes_user` cookie + 12h token；SMT 侧改挂 JWT 后 `sys_user` 保留做产线数据权限（sys_user_line）
- SQLite `datetime('now','localtime')` 语义 = 服务器本地时区；PG 统一 timestamptz，展示层转 Asia/Ho_Chi_Manh
