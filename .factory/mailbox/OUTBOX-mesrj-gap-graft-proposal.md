---
from: opencode (ruijing-mes → mesrj gap graft)
to: *
type: proposal
correlation_id: mesrj-gap-graft-2026-11-22
protocol_version: "1.2"
timestamp: 2026-11-22T00:00:00Z
requires_ack: false
---

## 契约提案：ruijing-mes（工作 MES）→ mesrj 残余路由嫁接

### 背景 / 源
- 源：`github.com/tianjinwuyong/ruijing-mes` @ `b374884`（2026-11-21），已部署在 rjms:8088 实跑。
- 目标：本仓 `services/api/src/mesrj/`（前几轮 lane 已嫁接 ~489/499 路由）。
- 对账方法：源 499 条 `@bp.route` 逐条按「折叠分隔符 + 参数归一 + 后缀匹配」比对目标全部
  `router.<verb>`（含 `L_R("…")` 模板注册），再对每条疑似缺口**读源函数体 + 读目标同名/近名 handler**
  确认是否只是改名等价。结论落 `.factory/mes-graft-census.json`。

### 裁决（grafting-protocol §1）
ruijing-mes 与 mesrj 是**同一 MES 的两个版本**（mesrj 就是它的 PG 化嫁接）。不存在跨系统原子事务问题——
这是「把源里目标还没落地的端点补齐」，属嫁接范畴（§3 现状映射：MES 核心 = 嫁接不迁）。

### 真实缺口 = 10 条（其余候选均为改名等价，已存在）
改名等价（**不动**，避免重复实现）：
- `/oqc/po/<id>/gap`≙`/oqc/po_gap`、`/oqc/po/gap-list`≙`/oqc/po_gap_list`、`/oqc/po/ship-check`≙`/oqc/can_ship`
- `/exec/panel_preview`≙`/exec/panel/preview`、`/exec/device_health`≙`/exec/device/health`、`/exec/repair/ai_stations`≙`/exec/ai/stations`
- `/panel/layouts`≙`/panel/layout/list`、`/panel/layout`≙`/panel/layout/save`
- `/smt/load_confirm`≙`/smt/load_check`（目标 load_check 已含「校验+落库」，非严格路径无 machine/slot 也记录，`prd_material_load.load_type` 列在）

新增（路径逐字照抄源，信封按 §4 分层）：

| 路径 | 方法 | 源 | 鉴权 | 落点 |
|---|---|---|---|---|
| `/smt/mo_variants` | GET | smt.py | `requireMesrjPerm(null)` | mesrj 域信封 `{success,msg,data}` |
| `/smt/mo_variant` | POST | smt.py | `requireMesrjPerm("md.edit")`（源 smt.load，本仓无此键→用等价写权限） | 同上 |
| `/smt/load_recommend` | POST | smt.py | `requireMesrjPerm("md.edit")` | 同上 |
| `/plan/kitting` | GET | plan.py | `requireMesrjPerm(null)` | 同上 |
| `/report/station-board` | GET | analyze.py | `requireMesrjPerm(null)` | 同上 |
| `/md/machine-source/point-to-mo` | POST | md.py | `requireMesrjPerm("md.edit")` | 同上 |
| `/bind/teardown` | POST | bind.py | `requireAnyPerm("prod.bind","prod.decode")`（源含 prod.teardown，本仓无该键） | 同上 |
| `/Device/UltraScan` | POST | devcfg_fix.py | X-Api-Key（`keyOk`），**JWT 之前** | 源逐字 `{success,msg,data:{sn,verdict,ok,reason,queued}}` |
| `/Device/UltraScan/recent` | GET | devcfg_fix.py | X-Api-Key | 同上 |
| `/DeviceConfig/OpenMo` | GET | devsrc.py | X-Api-Key（`requireDeviceKey`） | 源逐字 PascalCase `{Success,Count,Rows:[{MoNumber,Model,ProductCode,LineSn,PlanQty,Status}]}` |

### 数据层：**无迁移**
10 条端点读的表/列全部已在 live DB 核实存在：`ord_mo.feeder_model`、`md_feeder_slot(.model)`、
`md_feeder_slot_alt`、`prd_material_load(.load_type,.active,.lot_no,.dc_code,.qty,.channel)`、
`prd_smt_baseline`、`bom_item(.item_type,.is_alt,.alt_group,.pos_ref,.segment)`、`ord_issue`/`ord_issue_item(.issued_qty)`、
`erp_inventory(.stock_status,.qty)`、`prd_mo_route(.snapshot)`/`prd_mo_group_route`、`cfg_machine_source(.mo_hint,.track,.enabled)`、
`prd_ultra_scan`、`prd_sn(.box_no,.pallet_no,.cur_station,.cur_seq,.status)`、`prd_sn_rel(.is_active,.reason,.void_at,.void_by)`、
`mesrj_decode_log`/`prd_decode_log(.action)`、`prd_pass(.pass_time,.result,.ng_code,.station_code)`、`md_station(.short_name,.station_name)`。
（台账教训：断言「缺表」前先查 live DB 全部 schema，不能只 `ls migrations`。）

### 挂载（§4 硬规则 1/2）
- 全部新路由挂 `api`/mesrj Router，不写 app 级；server.js **不动**。
- `gap-routes.js` 两个导出：`registerMesrjGapRoutes(router,deps)`（JWT 后，与其余 register* 同段）
  + `registerDeviceGapRoutes(router,deps)`（X-Api-Key，紧挨 `registerUltraDeviceRoutes` 之前注册）。
- mesrj.js 仅**追加**：1 行 import + 2 行 register 调用（位置见 §1 七步第 6 步注释）。

### 权限键
沿用既有 `md.edit / prod.bind / prod.decode / prod.pass / prod.trace`。源 `smt.load`、`prod.teardown`
本仓 `sys_perm` 无对应键（实测查库），按 §4 不新造权限，映射到语义最近的既有写/绑权限。

### 验证（§8）
node --check server.js · check:register-deps · check:route-census(total 增) · check:auth-order(stranded=0)
· check:route-shadowing(dead_guards 不增) · tsc --checkJs mesrj 段 · boot API + JWT 实调每条新路径
（200/403=已注册；设备路径：正确 key 200、错 key 401，404 规则无效）。

### 不做
- 不改前端（源 PDA/pages.js 调这些路径，但本仓 mesrj 前端未引用，属后端补齐；前端接线留作需要时另开）。
- 不碰 server.js / 活体 WMS/OA / harness。

无异议即按此动工。认领锁：`.factory/locks/CLAIM-mesrj-ruijing-mes-gap-api.md`。
