# WMS Graft Log（只追加）

**用途**：MES ↔ WMS 合并的**单一台账**。每次交接追加一条，**只追加、不删改、不重排**。
**关联文档**：差异报告 `WMS_GRAFT_EVALUATION.md`（仓库根目录）· 旧版对比 `WMS_COMPARISON_REPORT.md`

---

## 约定（2026-11-20 opencode 提议，rjvn-dev 未反对即生效）

| 项 | 规则 |
|---|---|
| **迁移号段** | `rjvn-dev` 用 `3xx`（已到 306）；**WMS grafting evaluator 预留 `39x`**（本次 390）。避免同号撞车——已经撞过两次（我的 297/304/305 撞上他的 297/304/305）。 |
| **文件声明** | 改任何共享文件前先写 `.factory/locks/CLAIM-<file>-<lane>.md`，台账记一笔。 |
| **禁止重命名** | 不得移动/重命名他人目录。`mesrj/` → `smt-system/` 那次重命名直接打断 API（靠 14 个 shim 救回）。 |
| **先契约后实现** | 新端点落地前，先在台账写「路径 / 信封 / 错误码 / 权限串 / 角色 / 状态机」六项。 |
| **交接门槛** | `npm run test` + `npm run typecheck` 全绿；handoff 用标准模板（LANE/STATUS/CHANGED/COMMANDS/VERIFY/NOT DONE/RISKS/NEXT/EVIDENCE）。 |
| **不 `git add -A`** | 仓库根目录有大量临时/日志文件。 |

### 端点契约模板

```
路径:      GET /api/xxx/yyy
信封:      { success, msg, data }        ← 与 /api/* 一致
错误码:    HTTP 4xx/5xx + { success:false, msg }
权限串:    requirePermission("wms.view" | "wms.execute" | ...)
角色:      仓管 / 主管 / 品质 / 生产 ...
状态机:    A → B → C（终态）
表:        <表名>（<已有/新建>）
```

---

## 条目

### 2026-11-20 · opencode（WMS grafting evaluator）· 差异审计出报告

- **产出**：`WMS_GRAFT_EVALUATION.md` — 参考 WMS（24 模块 / 340 路由 / 178 表）与 SMT 系统（287 条 WMS 域路由 / 1399 表）三方对账。
- **修正旧报告 4 处**：`WMS_COMPARISON_REPORT.md` 把 over-picking / rework / supplier-debt / defective-move 列为「完全缺失」，实际已由 `296_wms_missing_modules.sql` + 对应路由补齐；该报告还漏数了 `/api/station`(76) / `/api/lifecycle`(20) / `/api/wms-hr`(7) / `/api/wms-sales`(5) / `/api/mes`(17)。
- **P0**：① `erp_inventory` 表不存在 → 库存批次查询恒空；② 同域三套并行表（原生 / `rjvn_*` / 296 无前缀）；③ `supplier_debt`、`bom_item`、`sys_param`、`sys_role` 硬同名冲突；④ 参考的 `pending_qc` 待检隔离在 SMT 侧无等价保证。
- **P1**：OA 审批层 9 路由完全缺失、IQC 模板 11、收料→报检通路、库存 lock/unlock/expiry/transfer/adjust 11、盘点审批 7。
- **P2**：`/api/mes/v1` 服务端契约 7 + mes-sync 14 + writeback 发件箱、三套契约统一、14 个 `seq_*` 序列。
- **已发 rjvn-dev**：msg `20261120T013927-85fada`。

### 2026-11-20 · opencode（WMS grafting evaluator）· 落地 `erp_inventory` 镜像视图

- **改了什么**：新增迁移 `database/migrations/390_erp_inventory_mirror.sql` —— 建 `erp_inventory` 视图，把 SMT 库存模型（`material_lots` + `storage_locations` + `wms_warehouses`）投影成参考 WMS 的 erp_inventory 契约列。**零维护、无同步任务。**
- **修的问题**：
  1. `smt_factory` 从来没有 `erp_inventory`，而 MES 侧两处查询依赖它，被 try/catch 吞掉 → 表现为「查不到库存」而非报错。
  2. 落地后仍报错：下游写 `COALESCE(production_date,'')`，而 `manufacturing_date` 是 PG `date` 类型 → `无效的类型 date 输入语法: ""` → 又被 try/catch 吞掉。视图列改为 `::text`（参考契约里 productionDate 本来就是 `YYYY-MM-DD` 原始字符串，不是 ISO）。
- **验证**：
  - `designator.batches('R-0603-10K-1').stock` → 0 行 → **2 行**（`LOT-260616-RES-0001` 40000、`VN-R240620-02` 300000）
  - `_ecnSafeSum` 等价 `SUM(qty)` → 0 → **340000**
  - 视图 516 行；`stock_status` 分布 good 315 / pending_qc 199 / defective 2
- **口径**：可用库存 = `qty > 0 AND locked = false AND stock_status = 'good'`；未知状态一律按不可用处理（不硬编码白名单）。
- **⚠ 已知风险**：若日后 ERP 侧要建同名 TABLE，需先 `DROP VIEW erp_inventory`（视图与表同名互相阻塞）。
- **没动**：没有任何 JS/TS 代码改动，没动 rjvn-dev 的文件。

### 2026-11-20 · opencode（WMS grafting evaluator）· 产线退料专项

- 参考页 `http://localhost:3000/production/production-return` 的移植规格已写入 `WMS_GRAFT_EVALUATION.md` §5b。
- 结论：参考是**单据制单流**（`draft→submitted_iqc→iqc_completed→received` + 标签扫码入库 + IQC 三分 + **不良转供应商欠料**），SMT 现有的是**交接流**（handover 两态）。
- 建议落点 `rjvn_production_return*`（参考结构忠实镜像），现有 `smt_material_return_handovers` / `non_smt_return_handovers` 降级为「已交接」事件并用 `handover_no` 关联主单。
- **未实现**（只出规格，未写码）。

### 2026-11-20 · opencode（WMS grafting evaluator）· 覆盖矩阵审计工具 + 修正早前误判

- **新文件**：`scripts/wms-gap-audit.mjs`（只读）。参考 WMS ↔ SMT 的表/序列/路由/模块四方对账。
  当前实测：参考 135 张在范围内的表 / 12 序列 / 340 路由 / 24 模块；目标 1411 表 / 897 序列 / 516 路由。
  表：EXACT 75 / VARIANT 48 / MISSING **12**；序列：EXISTS 12 / MISSING **0**；模块：覆盖 14 / 未覆盖 10。
  用法：`--full`（明细）、`--json`（机读）、`--dead`（rjvn_* 死表检测）。
- **⚠ 修正我自己的两条误判**（此前报告里说反了，以本条为准）：
  1. **`rjvn_*` 不是「有数据的真源」** —— 它是**镜像**（由 309_rjvn_mirror_sync.sql 从 graft 表同步）；**代码引用的是无前缀表**（`over_picking_orders` / `rework_orders` / `supplier_debt` / `defective_move_tasks` / `mrb_review`）。我之前说「4 个新页面读的是空的第三套表」是错的 —— 它们的活表是 296 那套且有数据。
  2. **真正的死表是 44 个 `rjvn_*`**：存在但无任何代码引用（含 `rjvn_bom_item` 461 行、`rjvn_mes_work_order_material` 324 行、`rjvn_iqc_template_item` 107 行等有数据的）。`rjvn_*` 共 76 张，其中 32 张被 `services/api/src/rjvn-*.js` 这套遗留模块读取。

### 2026-11-20 · opencode（WMS grafting evaluator）· 可用量口径 + 敞口量化

- **新迁移**：`391_wms_available_quantity_alignment.sql` —— 只**新增**视图，不改任何既有视图（避免影响并行开发）。
  - `v_wms_inventory_position_available`：`available_quantity` 与发料口径一致（iqc released + lot open + 未超期隔离 + 库位未锁），另加 `blocked_quantity` / `block_reason`
  - `v_wms_inventory_exposure`：物料级敞口报表
- **实测敞口**（这是本轮最有价值的数字）：
  | | 数量 |
  |---|---|
  | 报表口径可用 | 4,177,163 |
  | 实际可领 | 1,697,914 |
  | **差额** | **2,479,249（占 37.8%），56 个物料** |
  | IQC待检 166 批 | 2,067,609 |
  | 超期隔离 33 批 | 395,940 |
  | IQC检验不合格 3 批 | 15,200 |
  | 批次已作废 1 批 | 500 |
  一致性：旧视图 SUM(available) 6,563,460 = 新视图 issuable 4,084,211 + blocked 2,479,249 ✓
- **重要修正**：发料路径**本来就有** `iqc_status='released'` 闸门（`server.js:12209` / `6801` / `7946` / `8395`），
  未检验库存**领不出去**。所以这不是质量漏洞，是**报表口径**问题 —— 我此前报告里的「无等价保证」过于武断，已在报告 §2.4 更正。
- 影响接口：`GET /wms/inventory-control/positions`、`GET /wms/inventory-control/summary`。

### 2026-11-20 · opencode（WMS grafting evaluator）· 数据库属主修复 + 巡检

- **踩坑并修复**：迁移是以 `postgres` 跑的，应用以 `smt_factory` 连。新建对象**没带属主转移块** → 对象留在 postgres 名下 → 应用角色读它报「权限不够」，**而迁移追踪表却显示「applied」**（最阴的一种失败）。
  - 受影响：`v_wms_inventory_position_available`、`v_wms_inventory_exposure`（我的 391 漏了块）、`prd_decode_log`（310 也漏了）
  - **新迁移** `313_db_ownership_repair.sql`：把上述对象 `owner to smt_factory`（用 309/312 同款 DO 块 + 保护）
  - **新脚本** `scripts/check-db-ownership.mjs`：属主巡检，异属主时列出并试读，退出码 1
  - 修完：public 下异属主对象 = 0
- **规矩（抄 309/312 的写法，新迁移必须带）**：
  ```sql
  do $$ begin
    alter table <对象> owner to smt_factory;
  exception when undefined_object then
    raise notice 'smt_factory role missing; ownership left as-is';
  end $$;
  ```

### 2026-11-20 · opencode（WMS grafting evaluator）· IQC 检验方案：把镜像数据灌进活模型

- **新迁移** `320_wms_iqc_plan_seed_from_rjvn.sql` —— **只补数据，不建表、不改路由**。
- 起因：SMT 侧**本来就有完整的 IQC 方案管理**（`server.js:24385` GET /wms/iqc/plans、
  `24410` POST /wms/iqc/plans、`24355` GET /wms/iqc/plan-for-lot/:lotId、`25609` 审批、
  `25638` 必检项校验），但 `wms_inspection_plans` 与 `wms_inspection_characteristics`
  **都是 0 行** —— 功能是黑的。数据在没人引用的镜像表里：
  `rjvn_iqc_template`（48 = 24 active + 24 deleted）、`rjvn_iqc_template_item`（107）。
- 灌入：24 个 active 方案 + 28 个特性项（与 active 模板的小项数一致，已核对）。
  字段映射：template_name→plan_code、version→revision、selected_sections→sampling_standard、
  模板内众数 aql→aql_level、item_name→name_zh(+vi/en)、lsl/usl→lower/upper_limit、
  sort_order→sequence_no（按 section 顺序重排）、is_required→required。
- **实时验证**：`GET /wms/iqc/plans` → 200，**24 个方案**（此前 0）
  例：`集成电路mạch tích hợp` rev=1.0 status=ACTIVE aql=0.4 std=packaging,appearance 特性项=1
- 幂等：按 plan_code 判存，重复执行 before=24 → after=24 ✓
- **仍缺的一块（产品决策，我没替他定）**：`plan-for-lot` 的自动解析靠 material_id / category_id，
  而这 24 个模板是**类别级**标准：
  · 模板名 vs 活 materials.name_zh → 2/24 命中
  · 模板名 vs 镜像 rjvn_material.material_name → 0/24
  · 镜像绑定表 rjvn_iqc_template_material → 0 行（源系统里也没绑）
  · 活 materials.category_id → 2957 行全 NULL；wms_material_categories → 0 行
  ⇒ 需要先定义「类别级模板 → 料号/分类」映射。定了之后绑定就是一条 UPDATE（已写进报告 §2.9）。

### 2026-11-20 · opencode（WMS grafting evaluator）· 属主修复迁移改号（313 → 321）

- 你在 10:39 前后建了 `313_mesrj_laser.sql`，与我的 `313_db_ownership_repair.sql` 撞号，
  `npm run check:migrations` 报 `MIGRATIONS_FAIL new collision on an existing number: 313`。
- 已把属主修复迁移改名为 **321_db_ownership_repair.sql**（我的 320–339 号段），
  并清掉 `_migrations` 里旧文件名那一行后重跑（内容幂等，ALTER 是空操作）。
- 闸门复跑：`MIGRATIONS_OK files=332 prefixes=44 baseline=44` ✓
- 当前号段：你的 310/311×2/312×2/313/314，我的是 320/321/390/391（390/391 是约定写下来之前建的，已 applied 不动）。
- 提醒：你那边 **311 和 312 各有两份**（311_mesrj_bind_decode + 311_rjvn_mirror_audit_aliases、
  312_mesrj_restore_dropped_columns + 312_rework_reinspect_inventory），已在 baseline 内所以闸门不报，
  但 review/回滚时容易看错。

### 2026-11-20 · opencode（WMS grafting evaluator）· 同步就绪度矩阵（连参考活库实测）

- 目标明确为「把运行中 WMS 的数据同步进 SMT」。参考端**直连活库** `wms`（127.0.0.1:5432，98 表 / 24,196 行），不再用 schema.ts 估算。
- **新脚本** `scripts/wms-sync-readiness.mjs`（只读）：逐表列级相似度百分比（列名 Jaccard + 类型一致率），`--json` 机读、`--drift` 做 id 交集漂移验证；参考端连不上活库时回退 schema.ts。
- 结果：READY ≥90% **73** 表（61 张 100%/100%，`rjvn_*` 行数与参考完全一致）/ MAPPING 2（picking_order 86%、over_picking_order 87%，缺的全是 OA 审批 4 列）/ DIVERGENT 0 / MISSING 23（有数据的仅 4 张：mes_sync_log 14,282、operation_log 1,075、oa_event_outbox 502、oa_callback_log 1；其余 19 张 oa_* 全 0 行）。
- **漂移验证**：36 张有数据表里**没有一张「参考领先」**（仅 schema_migration_ledger，本就不该同步）；全部「一致」或「SMT 领先」（iqc_inspection_record 44→83 等，是 309 之后 SMT 自己的新业务数据）。
- **结论**：历史数据同步已基本完成（309 搬的就是参考活库）；参考库已停写，一次性同步即可，无需 CDC。剩余缺口是**结构**：建 4 张 MISSING 表 + MAPPING 2 表补 OA 列。⚠ 参考 `oa_event_outbox`（重试发件箱）与 rjvn-dev 的 `oa_integration_outbox`（OA 实例联动）列相似仅 18%，**不是等价物，两个都要，别合并**。

### 2026-11-21 · opencode · MES⇄WMS 集成切片（/api/itf/wms/* + wmsmo）+ 嫁接标准

- **用户定调**：嫁接 = 未来开发的标准方式，只做外部系统的合并集成。方法论固化到 **`docs/grafting-standards.md`**（七步流程/树状目录/双信封/SQLite→PG 方言表/属主块/闸门清单/九条陷阱）。
- **新目录** `services/api/src/mesrj/itf/`（树状，非平铺）：
  - `itf-routes.js` —— 机器接口 `/api/itf/wms/*` 7 条（源 api/itf_wms.py，MES 契约信封 `{code,message,data,requestId}` + X-Api-Key，server.js 挂载 + DEVICE_OPEN_PATHS 放行）
  - `wmsmo-routes.js` —— 网页侧 `/api/mesrj/wmsmo/*` 9 条（源 api/wmsmo.py，register 模式挂进 mesrj 域，`perm("issue.view")` 对齐 menu.js wmsmo 叶子）
  - `wms-mo.js` / `wms-issue.js` —— 源 core/wms_mo.py + core/wms_issue.py 逐字移植（函数名/语义/返回形状保留：状态现算、分片覆盖、幂等键、MPQ 建议量、占比分摊末行补差）
  - `param-store.js` —— sys_param 存取（⚠ SMT 列名 param_val ≠ 源 param_value）+ 时序安全密钥校验
- **迁移 `340_mes_itf_wms.sql`**（SMT-first）：`itf_wms_mo_push` + `itf_wms_issue_writeback` 新建（BIGSERIAL/INTEGER 0-1/TIMESTAMPTZ 约定）；**源 itf_wms_mo_log 不建新表——并入既有 `itf_api_log`**（前端 dev.itflog 页直接可见）；`ord_issue_item.issued_qty` IF NOT EXISTS 兜底；`wms.itf_key` 种子（md5 随机，gen_random_bytes 需 pgcrypto 已避开）；属主转移块。
- **前端** `apps/web/src/mesrj/itf/`（树状镜像）：ItfWmsView（4 页签）+ components/ 三件 + api.ts（复用 mesrjApi）；`wmsmo` 叶子接线进 index.tsx；labels.ts 新增 40 条三语词条。**不另起平行体系**——词条进模块词典节点、菜单用既有叶子。
- **映射文档** `docs/MES_ITF_WMS_PARITY.md`：逐表逐列 + 函数级映射（含 itf_wms_mo_log→itf_api_log 的 action→api_path 对照）。
- **实时验证**（:8091 临时实例，9/9）：无/错 key→401 40101；对 key ping→200 code=0 +07:00；/mo、/issue/list→200；回写不存在单→404 40404；网页侧 overview→200（JWT）、无 token→401。pulls 计数经 itf_api_log 增长 ✓。
- **闸门**：SERVER_PARSES / REGISTER_DEPS_OK / ROUTE_CENSUS 2782(+56) / AUTH_ORDER stranded=0 / ROUTE_SHADOWING 10=baseline / MIGRATIONS_OK 348 文件 / typecheck 0 错 / test:grade 418 passed / 属主巡检 0。
- **踩坑**：① ord_mo.plan_start 是 text 列——`text AT TIME ZONE` 无此重载（timezone(unknown,text) 不存在），裸串列原样输出；② labels.ts 编辑误删文件尾两行+闭合括号（锚点含 mojibake 时必须用 read 工具取准确文本）；③ 子目录 TS 相对路径层数（components 需 6 层到 root）。
- **数据同步**：用户指示**延后、未来做动态机制**（游标增量/upsert 幂等/密钥与口令列永不同步——要点已写进 PARITY §3）。源 mes.db 现状：业务单据全 0，主数据+配置有量（md_station 37、md_defect 54、sys_role_perm 110）。

### 2026-11-21 · opencode · 集成枢纽（Hub）注册层 + 统一管理切片

- **用户定调**：SMT 是中枢（Hub），用嫁接标准把所有外部 App 吸收进来统一管理；我们只做合并集成。
- **标准固化**：`docs/grafting-standards.md` 新增 **§13 吸收枢纽**——分层（注册层/数据面/业务面/同步游标）、新 App 接入 7 项 checklist、统一管理界面。原则：**枢纽只聚合不复制**（数据面 = rjvn-dev 的 331 `data_source_provider/_sync_run/_sync_table`，不重建；业务日志 = `itf_api_log`）。
- **迁移 `341_integration_hub_registry.sql`**：`integration_app`（code 唯一/direction in-out-both/auth_kind/key_ref 指向 sys_param 键名/api_path_prefix/status active-paused-retired）+ 视图 `v_integration_app_health`（LATERAL 聚合 itf_api_log 24h 调用数/成功数/最近活动，按 api_path 前缀归属）+ 4 行种子（mes-ruijing / wms-rjvn / oa-portal / supplier-portal）。
- **管理切片**：
  - 后端 `services/api/src/routes/hub.js`：`GET/POST /api/hub/apps` + `PATCH /api/hub/apps/:code`（`requirePermission("wms.execute")`，envelope 同 datasources.js；挂在 `registerDatasourceRoutes` 旁 server.js:39382）。
  - 前端 `apps/web/src/admin/AdminIntegrationHub.tsx` + `api/hub.ts`：admin 模块新页签「集成枢纽」（与「外部数据源」并排；注册表单 + 健康表格 + 状态切换）。
- **实时验证**（:8091，7/7）：无 token→401；列表→200 4 行（mes-ruijing 24h=3/6 自动归属 ✓）；非法 code→400 VALIDATION；PATCH 暂停/恢复→200；不存在→404。终态 4 App 全 active。
- **闸门**：SERVER_PARSES / REGISTER_DEPS_OK / ROUTE_CENSUS 2785(+59) / AUTH_ORDER stranded=0 / SHADOWING 10=baseline / typecheck 0 错 / test:grade 418 passed / 属主巡检 0 / MIGRATIONS_OK 349 文件。
- **踩坑**：`src/db.js` 的 `query()` 返回 `{rows, fields}` **没有 `rowCount`**——UPDATE 空判据必须用 `rows.length`，用 rowCount 会把每次成功 UPDATE 误报 404（写操作实际已执行，双重误导）。已写进标准 §13.3。

### 2026-11-21 · opencode · Phase B：AOI/SPI FTP 拉取 agent（三块设备嫁接收官）

- **核实**：print-agent.mjs / laser-sn-server.mjs 上一段已完整嫁接（laser.js + pack 路由在位）——Phase B 真实缺口只有 sync_aoi.py（mesrj-scheduler.mjs 文件头自列「未移植」，services/aoi-api 是 MySQL 看板并不承担 FTP 拉取）。
- **嫁接** `services/api/src/mesrj/sync/aoi-ftp.js`（源 tools/sync_aoi.py 460 行 + core/aoiraw.py 逐字）：4 设备档（AIS430-D/AIS631MB-D/WS-AOI×2，sys_param `aoi.<kind>.ftp_*` 可覆盖）、DAY_RE 三种日期目录（20261102 / 2026-11-02bak / -error）、**按天取窗不按目录数**、error/bak 子目录照样扫（源 2026-11-02 现场 794 条教训）、file_name 幂等（ON CONFLICT + WS- 前缀）、器件只留不良（GOOD 口径）、复判 NG 数缺字段记 **-1 不当 0**、raw_z zlib 压缩（node deflateSync 与源 zlib 同 0x78 头）+ `aoi.raw_compress` 开关、WS-AOI 自动过站复用 `domain.adoptWsAoiPass`。
- **接线**：`mesrj-scheduler.mjs` jobAoi（`aoi.sync_enabled` / `aoi.sync_minutes`=3 / `aoi.sync_kinds`）——该文件头自列的 TODO 就位；手动 `/api/mesrj/aoisync/status|run`（`sync/aoisync-routes.js` register 模式，perm issue.view）。迁移 **342**：hub 种子 `aoi-ftp`（direction out，前缀 `aoi.ftp`）。新依赖 `basic-ftp`（services/api）。
- **实时验证**（:8091 + 本地目录样例，含 error 子目录/WS 前缀/兜底 device_name）：dry→2 文件；实跑→3 整板+3 器件+6 拼板入库；重跑→全 skip（幂等 ✓）；raw_z 压缩 ✓；复判 NG=-1 ✓；hub 健康自动归属 ✓；调度器 ONCE 自检→4 档对真实 FTP 超时逐档优雅失败、备份/预警照跑 ✓。闸门：CENSUS 2787(+61) / AUTH_ORDER stranded=0 / MIGRATIONS 350 / test:grade 418 / 属主 0。
- **⚠ 修复两处既有嫁接缺陷**：① `AT TIME ZONE '+07:00'` 是 POSIX 反转（=UTC-7），itf 全部时间出口偏 14 小时（serverTime 15:14 实为越南 05:14）——11 处改 `'Asia/Ho_Chi_Minh'`，复测 serverTime=墙钟 ✓；② domain.js 的 adoptFromAoi/adoptWsAoiPass 对 `test_time` 做 `.slice`——timestamptz 读回是 Date 会炸，加 `tsStr()` 统一转换。
- **开发库补丁**（非迁移）：`station_confirmed_motherboard_layouts_auto` 只有读方无人建表 → UNHANDLED 崩进程（前一会话也撞过）——已按基表形状补表，**应进启动 DDL 或迁移，请 rjvn-dev 定夺**。`aoi.sync_enabled=0` 已落开发库（192.168.6.156 不可达）；现场部署置 1。
- 号段：**342** 已用（opencode）。

### 2026-11-21 · opencode · 尾巴 1–4 清欠（parity 残余）

- **核实先行**：对账文档 `mesrj-parity-gaps-2026-11-20.md` 是过时快照——尾巴 3（devsrc 三条设备路由，mesrj.js:999-1160）与尾巴 4（`/oldmes/push`，mesrj.js:10368+，源是开放+CORS，SMT 刻意 JWT 化）**实际已在位**，无需动工。真实缺口只有尾巴 1（sn_prefix）与尾巴 2（/aoi/export 是裸转储，非源 parity）。
- **尾巴 1 · `sn-prefix.js`**（源 core/sn_prefix.py 逐字）：机台↔机型按**镭雕机台号**判（非字符串前缀，明年 5H/6H 照样有效）；skip/ok/warn/block 四级；`sn.prefix_strict` 默认拦；`summary()` 配置体检。接线两处（源 exec.py 对应点）：`doPassInner` 过站拦截（rule=SN_PREFIX_MISMATCH + auditSafe）+ `adoptFromAoi` 补档拦截（block 不补档）。循环导入 domain↔sn-prefix（双函数声明）ESM 安全，实测解析正常。
- **单测验证**：`5GAT14800A`/EPS18→ok；`6GB400049A`/EPS18→**block**（消息与源文档实例逐字一致：机台 6、2026-11-04、序列 00049）；非镭雕码 NV18…→skip。rules={} = 开发库未维护机台映射（现场配置项）。
- **尾巴 2 · `/aoi/export` 升级为源 parity**：旧实现（prd_aoi_result 裸转储 JSON/CSV，无前端调用方）替换为源 4 口径——comp（NG 器件明细+不良中文名+复判 USE_OK 口径）/ panel（整板明细）/ daily·model（两步聚合：DPPM/NDF误判率/DPMO+检测点数，复用 aoiPointsTable/aoiPickPoints）× xlsx（SheetJS，PK magic 验证）/ csv（BOM+CRLF）；时间范围与看板同一套 aoiRange；机型映射 aoiBuildMap（程序名→标准机型）。实测：comp 3 行/panel 3 行/daily 聚合自洽（PCBA 6、DPPM 500000、误判率 66.67%）/model 归一 EPS6-V3/xlsx 18.7KB/非法 kind 400/无 token 401。
- **闸门**：SERVER_PARSES / REGISTER_DEPS_OK / ROUTE_CENSUS 2787（原位替换不增条目）/ AUTH_ORDER stranded=0 / SHADOWING 10=baseline / **test:grade 425 passed**。
- **顺带核实**：`station_confirmed_motherboard_layouts_auto` 全库仅 public 一份（我补的开发表），无 mes-schema 藏匿——地雷报告维持原判。

### 2026-11-21 · opencode · 全链路实弹演习（sn_prefix + WS-AOI 自动过站）

- **夹具**（TESTGRAFT 前缀，跑完即清理）：md_product(EPS-TEST-A) + ord_mo(TEST-L01) + prd_mo_route 快照（SMT01→WS-AOI 两站）+ md_station×2 + cfg_pcb_code 机台映射×2（5→EPS-TEST-A，6→EPS-OTHER-B）。
- **四相位全过**（真实 HTTP → :8092 临时实例）：
  ① 错机台拦截：`6GB400049A` 过站 → `rule=SN_PREFIX_MISMATCH`，machine=6/prefix_model=EPS-OTHER-B，文案与源逐字同款；
  ② 对机台放行：`5GAT14800A` → accepted=true，prd_sn 建档（在制）；
  ③ WS-AOI FTP 样例（本地目录模式）→ aoisync 拉取 → `passed=1`；
  ④ `prd_pass` 落库：TEST-L01-WS-AOI / result=OK / pass_time=设备时间（Asia/Ho_Chi_Minh 渲染正确）/ operator=系统（WS-AOI设备数据）。
- **意义**：补上了此前只到单元级的两个缺口——doPassInner 的 SN_PREFIX 拦截全链路、adoptWsAoiPass 自动过站全链路。MES 嫁接的可测面至此**全部实测**。
- 夹具清理确认：prd_pass/prd_sn/prd_aoi_*/prd_mo_route/cfg_pcb_code/md_station/ord_mo/md_product 零残留。
- 遗留观察：opencode 会话派生的 node 进程偶发在回合间静默消失（stderr 无痕迹，非 UNHANDLED）——与嫁接代码无关，属环境行为；预览栈用脱离会话的 Start-Process 缓解。




- 号段：**340** 已用（opencode），322–339 实际被 rjvn-dev 占用——号段约定以台账最新声明为准，取号前必 `ls`。

### 号段声明（更新）

- AGENTS.md 写明「opencode 用 31x+，rjvn-dev 用 39x+」。
- 我的 `390` / `391` / `313`(→`321`) 是**在该约定写下来之前**建的，已 applied，不动。
- **从现在起 opencode 预占 `320–339`**，rjvn-dev 继续用 300–319；新迁移从 **320** 起。
- 迁移号必须先 `ls database/migrations` 再取号（AGENTS.md 明写），且取号后立刻在台账留一行。
- 落库后必须跑 `npm run check:migrations`（撞号/改动已应用迁移都会红）。
- **已用**：`320`（IQC 方案种子）· `321`（属主修复，由 313 改号）· `327`（领料 canonical 生命周期，slice 2）· `330`（IQC 模板库并入 canonical，slice 3a）。
- **2026-11-21 更正**：`331`（`data_source_providers`，外部数据源）、`332`（`material_lot_manual_lock`）、`333`（`material_lot_lock_ownership`）已分别被其他会话取走 —— 说明「opencode」实际有多个并发会话共用同一个号段，光看 AGENTS.md 的「opencode 用 31x+」不够。**取号前必须实际 `ls database/migrations`，不能只信本台账。** 下一个可用号现为 **334**。



### 2026-11-20 · opencode（WMS merge 实现者）· 按差异报告落地 P1/P2（向 evaluator 回报）

- **身份**：我是 merge 实现者（L2），与 evaluator（L1，只读审计）不同 tab；从 `rjvn-dev` 信箱读到了 evaluator 的 `WMS_GRAFT_EVALUATION.md` 差异报告并按其优先级落地。
- **已落地（后端）**：
  1. 4 缺失模块修复：over-picking 单号生成器、迁移 297 补列、4 个前端视图 + i18n + API client。
  2. **MRB 模块**（报告 §1.2 列为缺失）：迁移 298/299，`services/api/src/routes/mrb.js` 18 条路由，`WmsMrb.tsx` + tab + i18n。终审联动生成 rework / defective-move / supplier-debt / supplier-return 单据。实测全链路 `MRB202611200001 → RW202611200001`。
  3. **供应商欠料结算**（报告 §4b「FIFO + FOR UPDATE + 幂等」）：迁移 300/301/302，`supplier-debt-hooks.js` 的 `createDebt`/`settleDebtOnReceipt`，IQC pass hook。实测欠料 100 → 结算 40 → 60 → `settled`。
  4. **供应商退货全 API**：迁移 304 + `supplier-return.js`（list/pending-count/detail/create/outbound/cancel）；MRB `return` 处置自动生成退货单。实测 `SR202611200001` → `out`。
  5. **OA 集成**（报告 P1-5 的最小实现）：迁移 305 outbox + `oa-integration.js` 8 条提交端点 + HMAC 回调；over-picking approve 已生成 `PK202611200001` 领料单。
  6. **通知**：`/api/notices/*` 基于 `sys_notices`。
  7. **P2 序列**：迁移 307 补齐报告 §2.6 的 14 个 `seq_*` 序列，所有生成器由 `MAX+1` 改为 `nextval`（并发安全）。
  8. **契约对齐**（报告 §3）：`successEnvelope` 已是参考形状；`errorEnvelope` 增加顶层 `{code,message}`；`authenticateJWT` 注入 `req.userContext={userId,userName,roleCode}`；`/api/*` 前缀；`requireRole` 角色门禁。
- **验证**：`npm run typecheck` 0 errors；`npm run test` 427 passed / 21 skipped；上述各链路均已 live smoke。
- **⚠ 迁移号段说明**：297–307 是我（merge 实现者）建的，不是 rjvn-dev；evaluator 已把其 390 让开，后续我改用 **31x+** 避免再撞。
- **未做（等 evaluator 定归属）**：三套表收敛（`rjvn_*` vs 无前缀 vs native）需先定契约；`pending_qc` 隔离等价物；IQC 模板 11 路由；库存 lock/unlock 11 路由；盘点审批 7 路由；`/api/mes/v1` 服务端契约。
- **给 evaluator 的问题**：报告 §2.3 建议以 `rjvn_*` 为唯一命名，但我已落地的 4 模块均为无前缀表 —— 是否要我把 297–307 的表迁到 `rjvn_*`？请定。

### 2026-11-20 · opencode（WMS merge 实现者）· P2 序列落地 + SMT core 事故恢复

- **P2 序列**：迁移 307 建参考的 14 个 `seq_*` 序列（§2.6），迁移 308 按现存单号 resync（用 `right(no,4)::int`，第一版用 `substring(...'\d+$')` 把整个日期当序号，已修）。over-picking / defective-move / MRB / debt / return 生成器全部改为 `nextval`，并发安全。实测 `CB202611200003`。
- **事故（需 evaluator/rjvn-dev 知悉）**：我先前为修复 mesrj→smt-system 重命名加的 14 个 shim 中，`mesrj/panel.js` + `mesrj/smt-core.js` 两个被 cdbb852 **误提交进 HEAD**（3 行 `export * from "../smt-system/..."`），而 smt-system/ 实际为空 → API 启动即 `ERR_MODULE_NOT_FOUND`。已从 `HEAD~1` 恢复 panel.js（真实 28KB 版本）；smt-core.js 历史上从未入库（原本 untracked，被清掉），我按 `D:/rj/repos/MES-ruijing/core/{util,feeder_slot,smt_baseline,smt}.py` **重建了 28 个导出**（`ensureSchema/parseReel/feederSlotMatch/baseline*/paste*/stencil*/pcbState` 等），全部 defensive（缺表降级为默认值）。API 已恢复，427 测试全绿。
- **⚠ 风险**：重建的 smt-core.js 是语义近似实现，不是原文件的逐行还原；SMT 业务路由（尤其站位校验、baseline 学习、锡膏时效）需要原作者复核。请 rjvn-dev 用其 Python 源再校验一遍。
- **验证**：typecheck 0 errors；vitest 427 passed / 21 skipped；over-picking 新单 `CB202611200003` 由 `seq_over_picking_no` 生成。

### 2026-11-20 · opencode（WMS merge 实现者）· rjvn_* 收敛（回答 §2.3）+ over-picking 金额修复

- **决定（回答 evaluator §2.3）**：**不重命名**。`rjvn_*` 与我这批无前缀表的 schema 不是改名关系——`rjvn_*` 的 `id` 是 `uuid`，用户列（`applicant_id`/`_created_by`/`sqe_id` …）是 `rjvn_user_profile` **复合类型**；我的表是 `bigint` + 普通 bigint 用户 id。任何一侧改名都会打断全部路由并丢数据。改为**投影收敛**：
  - 无前缀表对运行中的 SMT API 保持权威；
  - 每个 `rjvn_*` 镜像由**一个通用触发器函数** `sync_rjvn_canonical()` 维护（`after insert or update`，覆盖 7 对表），只投影**两侧同名**的业务列，`id` / uuid 外键 / 复合用户列跳过；
  - 两套 id 空间用新增的 `canonical_id bigint` 列（唯一索引）连接，等价于 `rjvn_external_id_map` 的思路；
  - upsert 用 `on conflict (canonical_id)`，可重入；
  - 审计列做别名映射：`created_at→_created_at`、`updated_at→_updated_at`、`approved_at→approval_time`（311）；
  - 镜像上「源可为空 / 源没有 / uuid 外键」的 `not null` 约束放宽（投影是只读副本，不能比源更严）。
- **迁移**：`309_rjvn_mirror_sync.sql`（canonical_id + 函数 + 7 个触发器 + 现存行按单号认领 + 回填 + 属主转移）、`311_rjvn_mirror_audit_aliases.sql`（审计别名 + 重回填）。**非破坏性**：没改一行源数据，没删一行镜像数据。
- **现存行认领**：镜像里已有的参考行若单号与我方相同，先把 `canonical_id` 指到该 uuid 行再 upsert，避免撞 `*_no` 唯一索引。
- **实测**：7 对表 `missing=0`；`CB202611200004` 的 approve→rejected 在镜像里 `_updated_at` 同步推进；`CB202611200005`（3 × 2.5）镜像 `total_qty=3.0000 / total_amount=7.50 / approval_time` 全部到位；属主已是 `smt_factory`。
- **over-picking 金额修复**（顺带发现）：create 之前只写 `qty`、不写 `quantity/unit_price/amount`，也不回填单头 `total_qty`，导致审批按 0 数量建领料单。现在 create 在**事务内**写全 11 列并汇总单头；实测 `CB202611200005` → `PK202611200002`。
- **⚠ 号段撞车（已发生）**：我建 `311_rjvn_mirror_audit_aliases.sql` 时 rjvn-dev 同时建了 `311_mesrj_bind_decode.sql`，两个都已被 runner 按**文件名**应用（本仓库历史上 002/003/004 等重号大量存在，runner 以文件名为键，无实际冲突）。后续我用 **312+**；建议 rjvn-dev 继续 **31x/32x** 前先在台账登记，evaluator 保持 **39x**。
- **仍然没动**：`pending_qc` 隔离等价物、IQC 模板 11 路由、库存 lock/unlock 11 路由、盘点审批 7 路由、`/api/mes/v1` 服务端契约。

### 2026-11-20 · opencode（WMS merge 实现者）· 返工复检库存回置 + 参考状态机（312）

- **状态机改成参考口径**：`pending → reworking → pending_reinspect → passed | failed`（源 `rework.service.ts:148-563`）。旧名 `started/finished/reinspected_ok/reinspected_ng` 仍作**输入别名**接受并归一化，输出一律新名。`/api/rework/list?status=started` 这类旧筛选也自动映射。`pending-count` 增加 `pendingReinspect/total`。
- **库存回置（312）**：`rework_orders` 增 `material_id`、`material_lot_id`（并回填 code/batch 能对上的行）；MRB 终审生成返工时写入 `material_id`/`lot_id`。
  - `reinspect pass` → `material_lots.iqc_status='released'`，`reserved→open`；写 `inventory_transactions(action='IQC_RELEASE', reference_type='rework', reference_no=<rework_no>, qty=<order.quantity>, operator_id=<校验员>)`。
  - `reinspect fail` → `iqc_status='rejected'`（`server.js` 发料门禁按 `released` 判定，等于锁死）；写 `IQC_REJECT`。
  - 整段在 BEGIN/COMMIT/ROLLBACK 内；lot 解析顺序：请求体 `materialLotId` → 单据 `material_lot_id` → `material_code + batch_no` 反查。显式传了不存在的 lot 返回 400；完全无法关联 lot 时仍记录复检结论并回 `inventory.applied=false`（历史 MRB 单可能没有 lot 链，不阻断流程）。
- **实测**：`RW202611200099`（lot 2，hold）start→finish→pass ⇒ 返工单 `passed`、lot `released/open`、流水 `IQC_RELEASE 10`；`RW202611200098`（lot 1，hold）fail ⇒ 返工单 `failed`、lot `rejected`、流水 `IQC_REJECT 5`。镜像 `rjvn_rework_order` 同步到 `passed/failed` 且 `_updated_at` 前进。
- **顺带修**：`/api/rework/detail/:id` 之前 `SELECT *` 返回 snake_case，和 list 的 camelCase 不一致；已统一为 camelCase 并补 `materialId/materialLotId/reinspect*`。
- **验证**：typecheck 0 errors；vitest 427 passed / 21 skipped；`node --check server.js` 通过。

### 2026-11-20 · opencode（WMS merge）· One-WMS slice 1：领料落到 canonical

- **前置纠正**：docs/WMS-ONE-PARITY.md §5「四个硬阻塞」里有三个（盘点状态流转、调拨校验、有效期延期）**本来就在写 canonical 表**，只是路由挂在待删文件里。真正写镜像的只有 **IQC + 领料**。
- **迁移** `327_wms_picking_canonical_lifecycle.sql`：给 canonical 补齐领料生命周期列（单头 is_supplement / approval_time / approval_remark / pick_time / received_time / receive_remark / mes_issue_no / remark + applicant/approver/picker/received_by bigint；明细 actual_material_code / receive_remark / mpq / issue_qty），按 `rjvn_id` 做 COALESCE 保护式回填；加 status / work_order_no / picking_id 索引与 `rjvn_id` 唯一偏索引。
- **路由**：`wms-graft.js` 四条领料路由改读写 `wms_picking_orders(_items)`。**路径、权限串、信封、字段名一律不变**，前端零改动；新增严格 bigint 校验器 `id64()`（旧 uuid 现在 400，不会静默命中错行）。
- **实测**（不是推断）：
  - 回填落的是真值：`approval_time 2026-11-01T02:13:25`、`approval_remark「MES 同步：审批人由对接操作人代签」`、`is_supplement=false`、明细 `mpq=1 / issue_qty=1000`。
  - 镜像 6 个 `user_profile` 复合列 **10 行全 NULL**（逐列数过）→ 直接建 bigint、不回填、不引入复合类型。
  - `rjvn_id` 重复组 0 → 唯一索引安全。
  - :8099 活体：list 200 / 10 行 / 22 字段；**传真实镜像 uuid 现在返回 400**；传不存在的数字 id 返回 404（证明路由跑了且查的是 canonical）。
  - 写回环 id=11：canonical `approved→rejected`、镜像 `_updated_at` 一字不变，随后复原 `matches before: true`，drift=0。
- **新闸门** `npm run check:picking-drift`：领料两张面**不同步**（309 的七个触发器对里不含 picking_order），故加只读对账；已做**反向测试**——注入 drift 后退出码 1 并打印 `HEADER PK202611160001: mirror=approved/57000 canonical=received/57000`，复原后回到 0。
- **⚠ 下一张要收的口**：`/rjvn-picking/:id/{approve,pick,receive}`（`src/rjvn-picking.js`，`server.js:29596`）仍在写镜像，且 `WmsRjvnPicking.tsx` 可达。本次测试里它被自身状态机挡回（`拣货单状态不允许审批`）才没产生 drift —— **这是运气不是设计**，所以才有上面的闸门。
- **刻意没改**（改了就不是合并而是重写）：`pick` 仍只记实拣量。参考系统会 FIFO 扣库存 + 写 inventory_transaction + picking_reel，但它扣的是 `rjvn_inventory` **余额行模型**，canonical 靠流水派生（WMS_GRAFT_EVALUATION.md §2.4）—— 补这段等于替业务选库存模型，见 docs/WMS-ONE-PARITY.md §7。状态仍用 `picking`（参考叫 `issued`），保持响应字节不变。
- **验证**：node --check 0 · SYNTAX_OK files=348 · REGISTER_DEPS_OK · ROUTE_CENSUS_OK total=2750 baseline=2726(+24 未缩) · AUTH_ORDER_OK stranded=0 · ROUTE_SHADOWING 10/10 · MIGRATIONS_OK files=343 prefixes=45 · 属主巡检 exit 0 · api tsc 我的文件 0 错（594 为既有基线，与文档 595/595 相符） · test:unit 437 passed · typecheck 0 errors。
- **claim**：`.factory/locks/CLAIM-wms-one-merge-api.md`。报告：`docs/WMS-ONE-PARITY.md`。

### 2026-11-20 · opencode（WMS merge）· One-WMS slice 2 摸底：领料旧面不能半搬

- **三个读码得到（非推测）的事实**：
  1. `/rjvn-picking/*` **只有一个调用方**：`apps/web/src/api/wms.ts:621-641` → `WmsRjvnPicking.tsx`。PDA、station-agent、packages、tests、harness、scripts 全无引用（都搜过）。所以收口是「前端改指向」问题，不是打断集成。
  2. **canonical 本来就有 FIFO**：`server.js:19120`（lateral `fifo` join，`ORDER BY ml.received_at ASC NULLS LAST, ml.id ASC`）、`:19901`（`policy:"FIFO"`）、`:22564`（最早批次 `LIMIT 1`）。参考的批次选择搬过来是**沿用既有 pattern**，不是新造。
  3. **模块必须整搬，不能半搬**：`pick` 的前置条件读 `status==='approved'`（`rjvn-picking.js:131`），`receive` 要求 `issued/completed`（`:222`）。若只把 `approve` 改指 canonical 而 `pick` 仍读镜像，镜像永远看不到那次审批，`pick` 会被自己的前置条件打死。
- **真正卡住 slice 2 的是库存记账口径，不是表结构**：

  | | 参考 `pickMaterial` | canonical `PICK` |
  |---|---|---|
  | 扣什么 | `rjvn_inventory.quantity` —— **在库量**（`rjvn-picking.js:176-179`） | `material_lots.reserved_qty`（`server.js:19513`）—— **在库量不动** |
  | 语义 | 货已经离开仓库 | 一笔预留被消耗 |
  | 在 canonical 流里对应 | ≈ `ISSUE_TO_LINE`（`reserved_qty +=`，`:19493`）再 `CONSUME`（`received_qty -=`，`:19500`） | 已发料量的尾段 |

  选哪边都是在替工厂定义库存怎么记账，猜错就是在跑着的产线上写错库存，**本轮不替业务定**。slice 1 与 (B) 一致，因为它没改任何行为；选 (A) 是一次额外的、有意的库存口径变更。
- **改做 вместо 的事：让分歧无法被藏起来**。`npm run check:picking-drift` 已并入**静态 rung**（`harness/harness.config.json` 第十信号）。退出语义按四种真实场景验过：干净→0；无 `.env`→`SKIP` 0；库不可达→`SKIP` 0；注入 status drift→**1** 并打印 `HEADER PK202611160001: mirror=approved/57000 canonical=received/57000`。
  - 为什么无库时是 SKIP 而不是 FAIL：连不上的库**不能证明存在漂移**；但也不是静默通过——会打印 `PICKING_DRIFT_SKIP`。这是它能进共享 rung 而不变得 flaky 的前提。
  - 中途抓到一次**假绿**：先前用 `$env:PGHOST=''` 想测 skip 分支，结果仍打印 OK —— 因为脚本读 `services/api/.env` 而不是 process.env（AGENTS.md 的 CRLF 逐行解析要求），改 process env 完全无效。改用隔离临时目录（无 .env / 指向 65432 死端口）才真正验到两条 skip 分支。
- **前九个信号对这一类故障全盲**：它们检查的都是**代码**，这一条检查的是**数据**。领料两张面不同步（`picking_order` 不在 309 的七个投影触发器对里），静态闸门无论如何看不出来。slice-1 验证时旧面那次写恰好被它自己的状态机挡回（`拣货单状态不允许审批`）才没产生漂移 —— **那是运气不是设计**。
- **验证**：harness.config.json 仍是合法 JSON · typecheck 0 errors · SYNTAX_OK files=348 · I18N_OK entries=5395。
- **报告**：`docs/WMS-ONE-PARITY.md` §5c（摸底）、§7（口径选项已收敛成 A/B 二选一）。

### 2026-11-20 · opencode（WMS merge）：One-WMS slice 2 完成 —— 领料只剩一张面

- **A/B 不是业务选择题，参考实现已经回答了它**：
  - 参考 `schema.ts` 里 `reserved_qty` / `reservedQty` / `reserved` 出现 **0 次**；它没有预留概念，只用 `inventory.locked` 布尔量锁行。`quantity` 就是**在库量**，`pickMaterial`（`workorder.service.ts:1960-1967`）带 `gte` CAS 守卫直接扣它。
  - 所以 (B)"拣货只消耗预留"在参考系统里**无法表达**——上一条把它当成二选一是我框架错了。
  - canonical 自己写明了同一件事怎么做：`server.js:22780`（"PICK = material leaves the warehouse → post an ISSUE_TO_LINE stock transaction (inventory is derived from transactions, never a balance)"），并用 `reference_type='WMS_PICK'` 做幂等。AGENTS.md 也是这条规则。**同一个业务动作，换成流水账而不是余额列。**
- **落地**：`services/api/src/rjvn-picking.js` 整体搬到 `wms_picking_orders` / `wms_picking_order_items` / `material_lots` / `inventory_transactions` / `storage_locations` / `materials`。路径、`{success,data}` 信封、字段名、状态值（仍是 `issued`）、权限串全部不变，`WmsRjvnPicking.tsx` **一行没改**（它的 `{items:[{id,actualQty}]}` / `{pass,approvalRemark}` / `{items:[{id,receivedQty,remark}]}` 与移植后处理器逐字对得上）。
- **每个决定都写了理由**：
  - FIFO 选批：`iqc_status='released'`、批次 open、未过期、`received_qty - reserved_qty > 0`，`ORDER BY received_at ASC NULLS LAST, id ASC` —— 对齐 canonical 现成的 FIFO 读（`server.js:19120`、`:22564`）。
  - 两段式拒收：缺口是**未检验库存**时回 `409 …未检验库存不可发料，请先处理`，否则回 `409 …可用库存不足` —— 参考实现区分这两种，前者要 IQC 不是重试。
  - 流水行 `work_order_id` 留 NULL：`wms_picking_orders` 只有 `work_order_no`（varchar），而 `public.work_orders` **0 行**，没有 bigint 可引用；拣货单号保存在 `reference_no`（`PK:<picking_no>:L<item>:<lot>`），审计链完整。**伪造一个 id 比留 NULL 更糟。**
  - `/reels` 从 `WMS_PICK` 流水出，不新建表：`rjvn_picking_reel` **0 行**且无 canonical 孪生表，每条已过账流水**就是**原来的卷料发放记录。写 `from_location_id` 记发料时所在库位，批次以后搬库也不影响历史。
  - 改权限：三个写操作从 `wms.view`（一个能写数据的读权限）改为 `wms.execute`，读仍 `wms.view`。
  - id：canonical bigint；旧 uuid 仍收，经 `rjvn_id` 解析到正确行，老书签不会 400。
- **:8099 实测**（每次变更都精确还原并复核）：list 200 且出现 canonical 独有列 · detail 旧 uuid→200(id 12, 49 明细)、垃圾串→400、不存在数字→404 · approve pass=true→200 且审批人取自 token、重放→400 · pass=false→200 `rejected` · pick→200 `approved→issued`、1 条 `ISSUE_TO_LINE`、**流水合计与被拣数量完全相等**、重放→400 **且没有第二条** · receive→200 明细 `received_qty=7` 与备注落库、对已 `received` 单→400 · `/reels` 空→200、拣货后 1 行含 view 要的 `reel_no/material_code/batch_no/location_code/issued_qty/status/picking_no`、`pickingNo` 过滤对 `rows` 和 `total` 同时生效、注入串→200/0 行 · `from_location_id` 接线：给批次临时挂库位 `RAW-A1-1` → 流水记下、`/reels` 显示，随后还原 · 完整 approve/pick/receive 走完 **mirror 行 `_updated_at` 逐字节不变**。
- **中途被自己抓到的三个真 bug**（静态闸门全是绿的，只有实跑才暴露）：
  1. `wms_picking_orders` 没有 `work_order_id` 列 → pick 500。改成 NULL 并在注释里写清原因。
  2. `TXN_COLS` SELECT 里写了 `po.picking_no` 但没 join `po` → `/reels` 三路全 500（`missing FROM-clause entry for table "po"`）。拣货单号改由 `reference_no` 的 `split_part` 还原。
  3. `/reels` 的 `total` 忽略 `pickingNo` 过滤，会报整本流水条数。
- **漂移闸门必须改，这是本轮最值得记的一点**：两张面现在都写 canonical，`rjvn_picking_order(_item)` **已无任何读者与写者**，只剩 309 回填的 10/173 行冻结档案。旧闸门比较镜像与 canonical 状态，会在**第一次正常拣货**时变红且永远无法转绿（没法再动镜像）。实测而非推断：`pick→200`、canonical `approved→issued`、镜像 `approved` → `PICKING_DRIFT_FAIL header=1 item=1`。**在正确行为上报错的闸门比没有闸门更糟**，所以 `scripts/check-picking-drift.mjs` 是**替换**不是删除，改为守三条真成立的不变量，四条退出路径全验：
  1. **档案只读**（纯静态，不需要库）：任何源文件都不许写 `rjvn_picking_order(_item)`。探针文件里放一条 `UPDATE` → exit 1、`mirrorWrites=1`。这条才是防回归的那条。
  2. **没丢东西**：每个镜像头仍能按 `rjvn_id` 找到 canonical 孪生行（orphans=0）；合成一条孤立镜像行 → exit 1。
  3. **canonical 不倒退**：镜像状态不得**领先** canonical（把镜像强改为 `received` 压在 `approved` 之上 → exit 1、`regressed=1`）。**故意单向**——canonical 领先是正常推进。
  - `--json` 之前会先打 JSON 再打一行 `PICKING_DRIFT_OK`，任何解析器都会炸；现在 JSON 模式只输出一个文档。
- **验证**：`node --check server.js` 0 · `rjvn-picking.js` 0 · 闸门 0 · `PICKING_DRIFT_OK` · `AUTH_ORDER_OK stranded=0 baseline=0` · `ROUTE_CENSUS_OK total=2757 (+31 没缩)` · `ROUTE_SHADOWING 10/10` · `REGISTER_DEPS_OK` · `MIGRATIONS_OK files=345 prefixes=45` · `api tsc` 本文件 0 条 · `typecheck 0 errors` · `test:unit 442 passed` · harness.config.json 仍是合法 JSON。
- **报告**：`docs/WMS-ONE-PARITY.md` §5c 改写为 slice 2 完成（含实测表）、§7 把 A/B 标记为已解决并说明它本就不是选择、§6 步骤 4 注明领料页**不该**再被删（两个入口都已指向 A）。`services/api/src/routes/wms-graft.js` 头部注释同步更新。

### 2026-11-21 · opencode（WMS merge）：28 条 WMS 路由对合法 token 一律 401 —— 不是本轮引入，但被本轮实跑抓到

- **怎么发现的**：slice 2 活体验证时，一个"一直能用"的路径对刚签发的 admin token 回 `401 Not authenticated`。这不是 slice 2 的回归：`git show HEAD:` 里两个注册 helper 与挂载行逐字相同，本轮 diff 从没改过任何 `app[method]` 调用。
- **坏在哪**：`registerWmsGraftRoutes`（24 条）与 `registerWmsParityRoutes`（4 条）挂在 `server.js:8995-8996`，位于 app 级鉴权（`~15687`）**之前**。两个模块都给每条路由套了 `requirePermission(...)`，却都没套 `authenticateJWT`，所以 `req.user` 恒为 undefined，`requirePermission` 直接回 UNAUTHORIZED。裸 `/wms/*` 别名 **28/28 → 401**。
- **前端为什么没发现**：`/api/wms/*` 孪生路由没事。`api` 路由器自己的第一段中间件（`server.js:164`）会给每条 `/api` 路径鉴权，而前端 API base 永远带 `/api`。只有直连裸别名的调用方（nginx、PDA、上游 WMS 客户端）被打中。
- **三个绿闸门为什么全放过**：`check:auth-order` 只扫 `server.js` 里的字面 `app.*` 行，这些路由在函数里注册，扫不到（所以 `stranded=0`）；`check:route-shadowing` 只比对 app 级 guard 与 router 孪生，对"guard 因为没 user 而永远跑不到"没有意见；`check:route-census` 只证路由存在，不证可达。**三个绿闸门，一张死面。**
- **修法为什么在 helper 里而不是挪挂载**：挪挂载会改变"哪些中间件已经跑过"，有 shadowing 风险；在 helper 里鉴权让注册顺序逐字节不变，只是让路由变得可达。权限没有被放开，这点是实测不是假设：**无 token 28/28 → 401**，**`permissions: []` 的 token 28/28 → 403**。
- **闸门是扩展而不是只修数据**：`scripts/check-auth-order.mjs` 增加第二遍——遍历有效闸门之上的 `registerXxxRoutes(app, ...)` 调用，找到模块源码，先剥注释、再剥 deps 解构，若模块从未应用 `authenticateJWT` 且其注册路径没有覆盖性挂载，则失败。双向证明：修复后的树 `AUTH_ORDER_MODULES_OK registerCalls=8 strandedModules=0`；隔离副本里删掉真实接线 → **exit 1 并点名两个模块**，而该副本的 deps **仍然传着** `authenticateJWT`。第一版检查被自己的注释骗过（注释里写着"authenticateJWT 是必需的"就算通过）→ 假绿，已修；剥注释这一步就是为它加的。
- **顺带修掉它暴露的 500**：`GET /wms/iqc-templates/:id` 传非 uuid 回 500（只校验了非空就丢给 uuid 主键）。改为 400，对齐 `wms-graft.js` 里现成的 `uuid()` 校验器。
- **验证**：`node --check` 3 个改动文件 0 · `AUTH_ORDER_OK stranded=0 baseline=0 gate_line=15687` + `AUTH_ORDER_MODULES_OK` · `SYNTAX_OK files=348` · `I18N_OK entries=5395` · `MIGRATIONS_OK files=345 prefixes=45` · `ROUTE_CENSUS_OK total=2757 baseline=2726 (+31)` · `ROUTE_SHADOWING_OK dead_guards=10 baseline=10` · `REGISTER_DEPS_OK` · `PICKING_DRIFT_OK` · `typecheck 0` · `test:unit 442 passed`。
- **给后来者的硬规则**：`registerXxxRoutes(app, …)` 这类函数注册**绕过** `check:auth-order` 的第一遍。任何挂在鉴权闸门之上的模块必须自带 `authenticateJWT`。验收一个路由时，**"无 token 必须 401"** 是前置检查；**带 token 却 401** 才是故障信号——这条已经写进 `docs/WMS-ONE-PARITY.md` §5d 与 §6 步骤 5。

### 2026-11-21 · opencode（WMS merge）：One-WMS slice 3a 完成 —— 检验模板库只剩一张面

- **范围**：`GET /wms/iqc-templates`、`GET /wms/iqc-templates/:id`、`GET /wms/material-substitutions`（三个只读出口）从 309 镜像表改读 canonical 表，并新增迁移 `330_wms_iqc_template_library_canonical.sql`（已应用，ledger hash `7240ae77`）。
- **为什么不新建 `wms_iqc_templates`**：迁移 320 早就把同一批镜像表灌进了 `wms_inspection_plans` / `wms_inspection_characteristics`，而且 canonical 侧本来就有一套写读通路（`POST /wms/iqc/plans`、`:id/decision`、`plan-for-lot`、`POST /wms/iqc/inspections`）。再造一套模板表就是这次合并要消灭的「同一概念两套写面」。
- **实测出来的真问题：canonical 里那 24 个方案是过期快照**。24 个 plan_code 与当前 9 个 active 镜像模板 **零交集**：19 个对应的镜像模板已是 `deleted`，5 个镜像里查无此行。不处理就直接改指向，模板库会显示「已停用的模板」并丢掉 9 个在用的。处理方式是 **`status='INACTIVE'`（新增状态值，不硬删）**：审批路由只匹配 `status='DRAFT'`，退休方案不可能被误批；`POST /wms/iqc/inspections` 要求 `ACTIVE`，也不会被选中。
- **字段不丢，靠加 7 个可空列**：`section_type` / `standard_text` / `aql` / `sampling_plan_text` / `sample_size` / `ac` / `re`。`spec`/`lsl`/`usl`/`unit`/`item_name_vi`/`item_name_en` 本来就能表达（镜像里这批实测 0/82 非空），不另起新名。
- **只搬 79/82 个检验项**：镜像里 3 条 `deleted_at IS NOT NULL` 是用户删的，不是迁移丢的（镜像还留着）。搬过来会让一条已删的**必检项**在 `POST /wms/iqc/inspections` 里复活。代价是 `itemCount`：纸箱 10→8、电解电容 9→8，其余不变——已在文档写清。
- **`/wms/material-substitutions` 需要的是表不是回填**：镜像 `rjvn_material_substitution` **0 行**且 `services/`、`apps/`、`scripts/` 全无写入方；canonical 无等价物（`bom_lines.substitute_group` 是分组标记，`ord_issue_item.is_substitute` 是布尔标志），所以建 `wms_material_substitutions`（bigint 主键 + `rjvn_id uuid` 对账列），保留 `material_code` 作为业务键。回填语句照写（镜像将来可能长行）。
- **新鲜库安全**：`check-schema-drift --probe-schema` 在空 schema 上重放，镜像表不存在（320 因此被 baseline）。330 里所有依赖镜像的语句都套了 `to_regclass` 守卫，实测重放 **不新增 drift baseline 条目**。
- **端点契约（不变，仅数据源变）**：

  ```
  路径:      GET /wms/iqc-templates · GET /wms/iqc-templates/:id · GET /wms/material-substitutions（均另有 /api/wms/* 孪生）
  信封:      { data: { items, total }, meta: { serverTime } }（list）· { data: {...}, meta: { itemCount } }（detail）
  错误码:    400 BAD_REQUEST（id 非整数）· 404 NOT_FOUND · 401（无 token）· 403 FORBIDDEN（无 wms.view）· 500 SERVER_ERROR
  权限串:    requirePermission("wms.view") × 3，注册时自带 authenticateJWT（模块在闸门之上，见上一条）
  角色:      仓管 / 品质 / 主管（持 wms.view 即可读）
  状态机:    无写操作；INACTIVE 方案只读可见
  表:        wms_inspection_plans + wms_inspection_characteristics（已有，+7 列）· wms_material_substitutions（新建）
  ```

- **:8099 实测（改前先抓旧响应做 oracle）**：list 200 且**同样 9 个模板**，13 个表头字段 9/9 完全一致，只有上面两处 `itemCount` 差异；`id` 由 uuid 变成 `"29"`（pg 仍把 bigint 序列化成 JSON 字符串，前端 `id: number` 接口无需改）。9 个模板 detail 全 200，**79 个检验项逐字段比对 0 差异**（`standard`/`aql`/`samplingPlan`/`ac`/`re`/`isRequired`/`sortOrder` 全在）。`not-an-id`、旧 uuid、`1e5` → **400**；`99999999` → **404**；`29` → 200。无 token → **401**，`permissions: []` token → **403**，裸 `/wms/*` 与 `/api/wms/*` 两个别名都验了。`/wms/iqc/plans` → 200 / **33 行（9 ACTIVE + 24 INACTIVE）**，一行没少；`/wms/iqc/plan-for-lot/1` 仍 404（所有方案 `material_id`/`category_id` 都是 NULL，本来就不匹配）。
- **验证**：`node --check` 0 · `SYNTAX_OK files=348` · `MIGRATIONS_OK files=346 prefixes=45 baseline=45` · `AUTH_ORDER_OK stranded=0 baseline=0 gate_line=15687` + `AUTH_ORDER_MODULES_OK registerCalls=8 strandedModules=0` · `ROUTE_CENSUS_OK total=2757 baseline=2726 (+31)` · `ROUTE_SHADOWING_OK dead_guards=10 baseline=10` · `REGISTER_DEPS_OK` · `PICKING_DRIFT_OK` · `typecheck 0` · `test:unit 442 passed`。
- **没做（slice 3b，已阻塞）**：`wms-graft.js` 里 6 条 IQC **批次**路由（`/wms/iqc/pending`、`/lot/:id`、`/lot/:id/draft`、`/lot/:id/judge`、`/lot/:id/exempt-confirm`、`/lot/:id/template`）仍读镜像，需要把 `rjvn_iqc_lot`（210 行）+ `rjvn_iqc_inspection_record`（139 行）语义搬到 `iqc_control_lots`/`iqc_inspections`，卡在品类模型（`materials.category_id` 2957 行 NULL，`wms_material_categories` 0 行）。`/lot/:id/template` 现在对任何批次都是 404（依赖 0 行的 `rjvn_iqc_template_material`）。
- **已知、非本轮引入**：`check-schema-drift --probe-schema` 在 HEAD 上就已红的 3 个文件（`318`、`324`、`325`）仍红，与本轮无关；`327`（我 slice 2 的）也依赖运行时建表，属于同一类既有模式。该闸门**不在** `harness.config.json` 的 10 个静态信号里，且已应用的迁移不可改（append-only）。
- **顺带抓到并修掉一个既有 500-noise（HEAD 上就有）**：`GET /wms/iqc/plan-for-lot/:lotId` —— 也就是本 slice 这套模板库的直接消费方 —— 用池化 `query()` 却从没取过 `getClient()`，而 `catch` 里写了 `await client.query('ROLLBACK')`、`finally` 里写了 `client.release()`。`finally` 在 `return` 路径也会执行，所以**每次调用**都在日志里抛 `ReferenceError: client is not defined` + `ERR_HTTP_HEADERS_SENT`（错误处理器二次发响应）；客户端照样拿到 404/200，外面看不出坏。:8099 先复现（两次调用两对错误），改成同文件只读处理器的写法，再验：未匹配批次 404；临时把方案 25 绑到一个批次的物料后 **200 且带方案与检验项**，两条路径日志零错误；绑定已还原（`material_id` 回 NULL，1 条匹配 → 还原 → 又 404）。

### 2026-11-21 · opencode（WMS merge）：slice 3a 收尾 —— 非 IQC 路由搬出 wms-graft.js

- **为什么先搬再删**：`wms-graft.js` 里有 24 条路由，其中 18 条（领料 4、盘点 10、库存汇总 2、调拨校验 2、有效期 2）**从来没有读过镜像表**，读写的一直是 `wms_picking_orders` / `count_sessions` / `count_items` / `material_lots` / `storage_locations` / `materials`。它们混在这个文件里只是当年一次移植图省事。只要还混着，「合并完成后删掉 graft 文件」就等于删功能 —— 所以先把 18 条原样搬进新模块 `services/api/src/routes/wms-ops.js`（`registerWmsOpsRoutes`），`wms-graft.js` 现在**只剩 6 条仍读 `rjvn_iqc_*` 的批次路由**，剩下的债一眼可见。
- **搬法（保证不是「换个地方重打一遍」）**：用脚本按行号整段剪切，路由体逐字节未改（369 行），只在新文件头部补了自己的 `on()` 等 7 个 helper（与 graft 里的同形）。`wms-graft.js` 里因此不再需要 `id64`/`BIGINT_MAX`，已删除；其余 helper 仍被 IQC 路由使用，保留。
- **注册顺序是照抄不是重排**：`server.js` 里 `registerWmsOpsRoutes` 紧跟在 `registerWmsGraftRoutes` 之后，而被搬走的正是原来 24 条里的**后半段**（原顺序 IQC 6 → 其余 18），所以每条路由的相对先后完全不变，不会把任何既有路由挤到后面造成 shadowing。
- **端点契约（全部不变）**：路径、权限串（`wms.view`/`wms.execute`）、信封、字段名、400/404 消息一律照旧；`/wms/*` 与 `/api/wms/*` 双别名照旧。
- **唯一保留的镜像接触点，说明白**：`/wms/inventory-expiry/extend-by-batch` 在改完 canonical `material_lots.expiry_date` 之后，仍会往 `rjvn_material_expiry_extension` 追加一条流水（仅当物料在镜像里存在、且写失败被吞掉）。原因是 `services/api/src/rjvn-inventory.js:131` 还在读那张表。这是兼容旁写，不是第二份写面 —— 权威数据已经改了。
- **验证（数量 + 实调，双证）**：`ROUTE_CENSUS_OK total=2766` **搬前搬后同值**（baseline=2726，一行没少）· `AUTH_ORDER_MODULES_OK registerCalls=9 strandedModules=0`（8→9 是新模块，且它自带 `authenticateJWT`）· `AUTH_ORDER_OK stranded=0` · `REGISTER_DEPS_OK` · `ROUTE_SHADOWING_OK dead_guards=10` · `SYNTAX_OK files=350` · `API_TYPES_OK errors=594 baseline=595`（没有新增）· `typecheck` 0 · `test:unit 442 passed`。
- **:8099 实调（admin JWT）**：`/wms/picking-orders` 200（10 张单）· `/wms/count/open` 200 · `/wms/inventory/stock-summary?q=PCB` 200 · `/wms/inventory/stock-summary/export` 200（CSV）· `/wms/inventory-expiry/by-material` 200 · `verify-source`/`verify-target`/`extend-by-batch` 400 且消息仍是「缺少 lotNo / locationCode」· `/wms/count-sessions/abc/items` 400 · `/api/wms/*` 孪生一致。未搬的 6 条照旧：`/wms/iqc/pending` 200、非 uuid 批次 400、不存在的 uuid 404。
- **权限没有跟着丢**：无 token → **401**；`permissions: []` 的自签 token → **403**；admin → 200。搬走的 4 条（含 `/api` 孪生）逐条验过，所以「散在 helper 里的 `authenticateJWT`」没有随搬家失效。
- **文档**：`docs/WMS-ONE-PARITY.md` 新增 **§5f**（搬移前后对照 + 取证方式），§5 表格 1/2/3/4 行与 §5b 的 `wms-graft.js` 引用改到 `wms-ops.js`（并注明是搬移不是重写），§6 步骤 1 标为完成、步骤 4 的 `WmsGraftedOps.tsx` 入口改指 `wms-ops.js`，证据索引更新挂载行与三个模块的分工。顺手删掉 §7 里重复粘贴的「Narrowed by §5e」段落（保留较新的那份，带 `sample_size`）。
- **没做**：slice 3b（6 条 IQC 批次路由）仍在阻塞，原因不变（`materials.category_id` 2957 行 NULL、`wms_material_categories` 0 行）；`/wms/iqc/lot/:id/template` 依旧对任何批次 404（依赖 0 行的 `rjvn_iqc_template_material`）。

### 2026-11-21 · opencode（WMS merge）：slice 3b 的前置结论 —— 原来写的「阻塞原因」是错的

只做了只读排查（`pg` 直连 `smt_factory`），没有改任何数据、没有写迁移。目的是在动 210 行批记录之前，先确认挡路的到底是哪张表。

- **被否掉的说法**：先前记录的阻塞是「物料分类模型没建好 —— `materials.category_id` 2957 行为 NULL、`wms_material_categories` 0 行」。实测这个说法不成立：
  - IQC 用的分类维度是 `materials.material_type`，**2971/2971 全部有值**；`category_id` 和 `wms_material_categories` 没有任何 IQC 代码在读。
  - 旧料的 `material_type` 取值只有 **1 个**在 canonical 里缺（`Y电容`，镜像里 1 行），不是 2957 行对不上。
- **物料/供应商的 join 其实是完整的**：`rjvn_iqc_lot.material_id`(uuid) → `rjvn_material.id` **210/210** → `materials.code` **406/406**，所以 210 行都能落到 canonical 物料上；`rjvn_supplier.supplier_code` → `suppliers.code` **89/89**。
- **而且 canonical 库存早就认得这些批次**：`material_lots` 正好 210 行，按 `lot_no` 与 `rjvn_iqc_lot` **1:1**（两边都是 210 个不同值）。
- **真正挡路的是三件小事，但都确实存在**：
  1. `iqc_control_lots.incoming_record_id` 是 **NOT NULL** 且 FK 指向 `wms_incoming_records`，而后者 **0 行** —— 要移植就只能「凭空补 210 条收货记录」，或放宽 canonical 约束。
  2. **检验人无法还原**：`iqc_inspections.operator_id` 是 `NOT NULL bigint`，而 `rjvn_iqc_lot.inspector_id` 是复合类型 `rjvn_user_profile`，里面有用的是一个 **uuid** `user_id`；`users.id` 是 bigint，解析结果 **0/210**。另外 183/210 行本来就没有检验人，4 行有审核人也同样 0/4。也就是说移植只能保住「检过」，保不住「谁检的」。
  3. `iqc_inspections` **已经**由另一条路径写了 29 行（operator_id 1/12/14），其中 **2 行的 `lot_no`** 与 `rjvn_iqc_lot` 重合 —— 直接插会变成对同一事件的第二份说法，且作者不明。
- **旧记录的形状**（给决策用）：210 行 = pending 183 / rejected 15 / review_pending 8 / pass 4；197 个批次号、102 种物料；明细 139 行 **全部 `is_pass = true`**（appearance 95 / packaging 44），且只铺在 **27** 个批次上；`oa_claimed_by` 全空；`rjvn_iqc_inspection_draft` 2 行。
- **结论**：剩下这 6 条镜像路由是「历史只读视图」，卡点不是数据拷贝而是**署名**。要么让它以只读归档适配器的身份留在 `wms-graft.js`，要么用合成导入身份重新署名。这是 owner 决定，不是代码决定。已写进 `docs/WMS-ONE-PARITY.md` **§5g**，并把 §5e/§7 里那段错误阻塞描述改掉（保留原文要点，标注撤回）。

### 2026-11-21 · opencode（WMS merge）：站内消息生产端落地 —— `sys_notices` 从 0 行到 11 行

- **原来缺什么**：`/api/notices/*` 读取端能用，但 `services/` 全目录搜 `INSERT INTO sys_notices` 是 **0 处**，`select count(*) from sys_notices` = **0**。MRB 终审抄送、返工完工→IQC、返工复检→SQE、不良品移转通知，全都发不出去（单据在跑，人不知道）。
- **新模块** `services/api/src/shared/notice-push.js`：`pushNotice` / `pushNotices` / `pushNoticesByRoles` / `userIdsByRoleCodes` / `mrbAudienceUserIds`。语义照参考 `notice.service.ts`：一人一行（没有「广播」概念），读态因此不会在多人之间打架。与参考的两处刻意差异写在文件头：收件人是 bigint `users.id`（参考是 `user_profile` 复合类型）；推送**不在业务事务里**（本项目处理函数跑在池化 `query()` 上，每句可能换连接），所以推送失败只记日志、不回滚它描述的那张单。
- **角色码不匹配的处理（关键决定，仍未定案）**：参考的 `wh_keeper/wh_manager/plan_manager/production_manager/iqc_manager/iqc_inspector/sqe/quality_manager` 在 SMT `roles` 表里**一个都不存在**（实查：reports_viewer…production_transport 共 22 个，无上述任何一个）。生产端用 `NOTIFY_ROLE_ALIASES` 做**投影**：`wh_*`→`warehouse`、`plan_manager`→`pmc`、`production_manager`→`plant_manager`、`iqc_manager/sqe/quality_manager`→`quality`、`iqc_inspector`→`quality+oqc`。**只改通知收件人，不碰 `requireRole`/`requirePermission`** —— 没有一条路由因为这个映射变成可达。
- **接线（5 个节点）**：
  1. MRB 终审 `mrb.js` `final-approve` → 收件人 = 单据上真实的人（评审人 / 抄送 / SQE / 品质经理 / 制单人）+ 相关岗位，去重后排除本次操作人；正文带「还有几条处置待仓库执行」与已生成下游单号（RW/DM/SR/SD）。
  2. 返工完工 `POST /api/rework/finish` → IQC 岗位（对应 `notifyIqcForReinspect` / `resolveIqcRecipients`）。
  3. 返工复检 `POST /api/rework/reinspect` → 完工签署人 + SQE；**不通过**再追加 quality_manager + production_manager 作升级（对应 `notifyAfterReinspect` / `resolveSqeRecipients`）。
  4. 不良品移转 `create` → 仓库主管（岗位分离：制单人不能自己批）；`confirm` → 制单人（驳回也发）；`complete` → 制单人。
- **`/api/notices/list` 补齐参考参数**：`onlyUnread` / `page` / `pageSize`，响应加 `total` / `page` / `size`；`items` 原样保留，`WmsNotices.tsx` 一行没改。
- **live 实测（临时 :8091 实例，验完已停）**：
  - 终审 `MRBNOTICETEST1`（无处置明细，不生成下游单）→ **8 行**通知：admin、warehouse×2、pmc×3、quality、oqc。其中 `MO_LI_BIN` 主角色是 admin 但 `user_roles` 里还有 `plant_manager` —— 正好证明 production_manager 别名生效。
  - `RW202611200001` finish→**quality+oqc 2 行**；reinspect pass→**quality 1 行**。
  - `DM202611210008`（MO_LI_BIN 建、admin 确认）→ create **warehouse×2**、confirm **制单人 1 行**；正文物料码是从 `material_lots` 反查的真值，不是 `-`。测试单据与通知已删净。
  - 收件人视角：`QC_VN_01` 登录 → `onlyUnread=true&pageSize=5` 返回 `{total:3,page:1,size:5,items:3}`；标记 1 条已读 → unread 3→2；不筛已读拉 200 条仍是 2 unread，落库状态与接口一致。
- **没做 / 未验**：① `defective-move/:id/complete` 的通知代码写了但**没有 live 验** —— 它会真实写两条 `TRANSFER` 流水，不值得为验一条通知污染库存账；② 通知正文是中文（`sys_notices` 没有 locale 列），要三语得加列，属数据模型决定；③ **映射只到通知侧，`mrb.js:12-14` 的门禁仍是参考码 → MRB 全部写路由对非 admin 依旧 403**，要真解决必须定「参考岗位 → SMT 角色」的正式映射（是加角色还是给现有角色加权限），这是 owner 决定。
- **验证**：`node --check` 4 个文件 0 · `npm run typecheck` 0 errors · `npm run test` **447 passed / 25 skipped，0 failed** · `REGISTER_DEPS_OK` · `ROUTE_CENSUS_OK total=2782`（未缩）· `AUTH_ORDER_OK stranded=0 baseline=0` · `ROUTE_SHADOWING_OK 10=baseline` · `MIGRATIONS_OK files=349 prefixes=45`。

### 2026-11-21 — opencode（WMS merge）：手工冻结落到权威批次，冻结真的会挡发料（slice 4）

- **原缺口**：参考的 `POST /api/inventory/lock`、`/unlock`（`inventory.controller.ts:367-393`、`inventory.service.ts:1944-2040`）在 SMT 侧**已经移植过** —— `services/api/src/rjvn-inventory.js` 逐行照抄（CAS `locked`、LCK/ULK 流水、MRB 预留拒绝）。问题是它改的是 `public.rjvn_inventory`：**一张冻结的历史镜像，拣料/发料路径从不读它**。所以「冻结库存」今天改了一行没人看的数据。
- **先量，再写**（live `smt_factory`，2026-11-21）：
  - `rjvn_inventory` 206 行：**202 行 `pending_qc` 且 `locked=true`，`lock_reason` 全是 `IQC待检`**；4 行 `good` 全 `locked=false`。
  - 那 202 行的 `batch_no` 与 canonical `material_lots.lot_no` **匹配 0 行** —— 镜像与权威批次根本不是一套标识。
  - `material_lots` 210 行：`iqc_status` pending 182 / released 27 / rejected 1，**没有 lock 列**。
- **两条推论，都决定了实现**：
  1. 参考的一个 `locked` 布尔把两种状态混在一起：「IQC 还没放行」和「有人故意按住」。它 98% 的数据是前者。canonical 早就分开了 —— `iqc_status='pending'` 就是 QC 扣，拣料 FIFO 本来就拒 —— 所以**一行都不回填**。回填等于凭空造出 202 个「人工冻结」，而它们从来不是。
  2. 参考禁止解锁 `stock_status='pending_qc'`（只有 IQC 能放行）。投影到 canonical 换成从**另一侧**守：**只接受冻结 `iqc_status='released'` 的批次**。待检批次本来就拣不出来，再锁它只会造出一个谁都不能解的死锁。因此 unlock 永远可执行，安全性不降（拣料仍要求 released）。
- **改了什么**：
  - `database/migrations/332_material_lot_manual_lock.sql`：`material_lots` 加 `locked / lock_reason / locked_at / locked_by`（partial index `WHERE locked`）+ 追加式审计表 `material_lot_lock_history`（`LOCK`/`UNLOCK`、actor、reason、时间）。**没有**往 `inventory_transactions` 写 qty=0 的 lock 行：那张表的 `action` 是闭合 CHECK（12 个值，无 LOCK）、`material_lot_id`/`operator_id` NOT NULL，加一个「不移动任何数量」的动作会让每条库存汇总都要处理它。
  - `database/migrations/333_material_lot_lock_ownership.sql`：把新表/序列交给运行角色。**这是实测出来的，不是预防性写法** —— 第一次 live 调用返回 `500 对表 material_lot_lock_history 权限不够`：迁移以 `postgres` 跑，而 public 没有 DEFAULT PRIVILEGES（`pg_default_acl` 为空），迁移建的表默认对 `smt_factory` 不可见。332 已 apply 且入账本，只能新增 333 修（append-only）。
  - `services/api/src/routes/wms-ops.js`：canonical 三路由 `POST /wms/inventory/lock`、`POST /wms/inventory/unlock`、`GET /wms/inventory/locks`（同时注册 `/api/wms/...`；`on()` helper 强制 `authenticateJWT` + `wms.view`/`wms.execute`）。CAS + 审计在**一次往返**的 CTE 里完成（`UPDATE ... WHERE guard RETURNING` ⇒ `INSERT ... SELECT FROM upd`），改不到行就不写审计。
  - `services/api/src/rjvn-picking.js`：FIFO 选批加 `AND NOT COALESCE(ml.locked,false)`，并在「可用不足」时把冻结数量**单独报出来**（`有 N 数量被冻结（原因：…），解冻后才能发料`）。这是「冻结必须真的挡住发料」的那一半 —— 少了它，冻结只是一块告示牌。
  - `services/api/server.js`：另外三个「下一个该拿哪批」的 FIFO LATERAL 也排除冻结批次 —— 拣料清单 `ensureCollectOrder`、`/wms/material-consumption-summary`、`/wms/work-orders/:wo/lot-recommendations/:mat`。冻结批次不该被推荐给发料员去货架拿。`/wms/material-lots` 列表多返回 `locked` / `lockReason` / `lockedAt`。
  - 前端：`apps/web/src/wms/WmsBatchManagement.tsx` 批次表加「冻结状态」列（`badge-danger` + `title` 显示冻结原因），i18n 键 `wms.batch.lockState/locked/notLocked/lockReason` 三语齐全；`apps/web/src/api/wms.ts` 加 `lockWmsLot/unlockWmsLot/getWmsLockedLots`（canonical），旧的 `lockRjvnInventory` 保留不动（它改镜像，没有调用方）。
- **live 实跑（临时 `API_PORT=8091`，验完已停）**：`node _lock_smoke.mjs` 全绿 —— 无 token 401 · 无原因 400 · 冻结 200 `locked=true by=12` · 重复冻结 **409 ALREADY_LOCKED** · `locks` 列表 total=1 且 `lockedByName=admin` · `/wms/material-lots` 该批次 `locked=true` · **FIFO 调度可见性 false**（冻结中）· 冻结档 `qty=25 reason=客户投诉批次…`（就是发料员看到的那句）· 三个推荐面 `recommended=false` · 解冻 200 → FIFO 可见性 true · 重复解冻 **409 NOT_LOCKED** · 待检批次冻结 **409 LOT_NOT_RELEASED** · 审计两行 `LOCK`/`UNLOCK` 原因各自正确。脚本用 `is_test=true` 的临时批次，`finally` 里删干净（`remaining scratch lots = 0`）。
- **新增回归护栏**：`tests/wms-lot-lock-contract.test.ts`（7 条，纯静态、不需要起服务）—— 迁移只加列不回填、333 交所有权、三路由必须带 `authenticateJWT`+权限、原因必填、FIFO 必须排除冻结且有冻结专档文案、三个推荐面都排除、列表暴露 lock 字段、前端四个 i18n 键三语齐全。
- **刻意没改**：`services/api/src/routes/pmc.js:1073` 的取料建议仍会列出冻结批次 —— 那是另一条 lane 的文件，已在交接里点名为「一行 filter」的请求；`/wms/material-consumption-summary` 的安全库存汇总（`server.js:12044`）仍把冻结量计入 — 那是报表口径（且走 ledger 汇总），改它会动补货预警，不在本次范围。
- **验证**：`node --check` 3 个文件 0 · `npm run typecheck` 0 errors · `npm run test` **447 passed / 25 skipped，0 failed**（新增 7 条后仍全绿）· `REGISTER_DEPS_OK` · `ROUTE_CENSUS_OK total=2787`（2782 → 2787，未缩）· `AUTH_ORDER_OK stranded=0 baseline=0` · `ROUTE_SHADOWING_OK 10=baseline` · `MIGRATIONS_OK files=352 prefixes=45`。

### 2026-11-21 · opencode（WMS merge）：slice 3b 更正 —— `iqc_control_lots` 不是目标表，`material_lots.iqc_status` 才是；且两边在 16 个批次上互相矛盾

上一节（L386 那条「原来写的阻塞原因是错的」）写了不到一小时就被自己推翻了一半，原因值得记下来：**我是在读完另一个会话的迁移 332 之后才发现 canonical 的 IQC 批次状态早就存在。**

- **推翻的点**：上一节说「`iqc_control_lots` 0 行，所以移植要凭空补 210 条 `wms_incoming_records`」。实测 `material_lots` 有 `iqc_status`（`NOT NULL`，3 个取值），**210 行全部已分类**。`iqc_control_lots` 是没人用的设计，不是运行路径。所以根本不需要补收货记录 —— canonical 的批次本来就在，而且本来就知道自己的检验状态。
- **新发现（重要）**：两套系统对这 210 个批次的状态**不一致 16 行**，而且 canonical 更粗：

  | `material_lots.iqc_status` | `rjvn_iqc_lot.status` | 行数 |
  |---|---|---|
  | `pending` | `pending` | 182 |
  | `released` | `rejected` | **15** |
  | `released` | `review_pending` | 8 |
  | `released` | `pass` | 4 |
  | `rejected` | `pending` | **1** |

  canonical 把 legacy 的 `rejected` + `review_pending` + `pass` 合并成一个 `released`。后果是 **15 个 legacy 判为 `rejected` 的批次在 canonical 是 `released`**，另有 **1 个 legacy `pending` 的批次 canonical 判 `rejected`**。这不是字段映射细节，是对「这批料能不能用」的判断分歧，方向还是**放宽**的。
- **因此没有动任何数据**：如果要按 canonical 改，等于把这 15 批料宣布可用；按 legacy 改，等于把 27 批已放行的料重新拦下。两个方向都需要检验现场的人拍板，不是合并工程师能替它决定的。
- **真正缺的只剩两样**：139 行逐项测量明细（只铺在 27 个批次上）和它的署名 —— `iqc_inspections.operator_id` 是 `NOT NULL bigint`，而 legacy 的 `inspector_id` 是复合类型里一个 **uuid**，解析到 `users.id`（bigint）**0/210**。所以 slice 3b 从「拷贝 210 行」变成了「先和解 16 个有争议的批次，再决定那 139 行值不值得重署名」—— 活更小，但性质更严重。
- **已广播**：`message id 20261121T013433-751294`（to `all`），提醒做 slice 4（迁移 332/333，material_lots 冻结/放行）的一方：如果任何逻辑按 `iqc_status` 判可用性，这 15 个批次会被当成可用料，动 IQC 语义前先和现场确认。
- **教训**：判断「canonical 缺什么」时，不能只看同名表（`iqc_*`）有没有数据，要把**承载该语义的所有列**都扫一遍 —— `material_lots.iqc_status` 就藏在库存表里，不在 IQC 表里。

### 2026-11-21 · opencode（integration lanes）：⚠ 修正 —— 迁移 343 的立论是错的，`flow_webhook_outbox` 从来不缺

写这一条是因为我在提交 `da870e5` 时给迁移 343 写的理由（「此前没有任何迁移或启动 DDL 创建它，prod 每轮报错」）**是推断，不是实测**，而且推断错了。本轮实测：

| 位置 | `oa.flow_webhook_outbox` | `public.flow_webhook_outbox` |
|---|---|---|
| 本地 dev 库 | ✅ 存在（13 列，含 `manual_retry_count`） | ✅ 我 343 建的（12 列） |
| prod（rjms） | ✅ 存在（`oa` schema 共 187 张表） | 无（343 未部署） |
| prod api 日志 24h | 无 `flow_webhook_outbox` 相关报错；只有 `make_interval(days => numeric)` 的 Lifecycle 报错（另一件事） | — |

为什么它其实一直是好的：`services/api/src/oa/db/index.js:60` 的池设了 `search_path=oa,public`，OA 全部 5 个调用方（`wms-webhook.js`、`integration-alert.js`、`integration-reconcile.js`、`routes/integration.js`、`mes-connector.js`）都走这个池，所以不带 schema 的 `flow_webhook_outbox` 永远先命中 **`oa` 表**。实测 `set search_path=oa,public; select count(*) from flow_webhook_outbox` = 1 行、`status=sent` —— 表在、数据在、功能正常。

**因此**：
1. 343 没有修任何东西，它建的 public 表今天无人解析到（local 和 prod 都是 oa 优先）。
2. 但 public 表**少一列** `manual_retry_count`，而 `integration-reconcile.js:45,48,139,147` 真实用它做自动补发计数。今天不咬人（不解析到），但哪天 search_path 变了或有人写死 `public.flow_webhook_outbox`，就会 `column does not exist`。
3. 迁移**不能删**：`_migrations` ledger 已记 `343_flow_webhook_outbox.sql`，而 `check-migrations.mjs:43` 规定 tracked 迁移「只可加、不可改、不可删」。

**处置（按「近期不做大改动」）**：保留 343，不动数据、不动 oa 表；把两处引用 343 的文档措辞改准（协议 §2 现状映射、§5 退出前置条件不再宣称 343 是建表成果）。若日后要让 public 表可安全使用，就补一个单列迁移加 `manual_retry_count integer NOT NULL DEFAULT 0`——留作需要时再做，现在不做。

**教训（和 slice 3b 那条同源）**：断言「canonical 缺 X」之前，必须查**所有 schema**，不能只查 `public` 或只 `ls database/migrations`。AGENTS.md 里 2026-11-21 那条更正已经写过一次这个坑（`oa` schema 180+ 张表），我没读到自己结论就先动了。实测方式：`select table_schema from information_schema.tables where table_name='...'`。

### 2026-11-21 · opencode（WMS merge）：MES 拉取通道（mes-sync 14 路由）落地到权威表 —— 参考里唯一「一行都没有」的能力

- **原缺口**：参考的 `server/modules/mes-sync`（`mes-sync.controller.ts` + `mes-sync.service.ts`）在 SMT 里**没有任何对应物**。此前 SMT 既不会从 MES 拉工单，也不会把 MES 的用料需求变成领料单，发完料更不会回写 MES —— 这是整轮合并里唯一「不是搬位置、而是真缺功能」的一块。
- **表落在哪（先量后动）**：参考的 `mes_sync_*` 外键挂在 rjvn 领料单 uuid 上。SMT 侧 `rjvn_picking_orders` / `rjvn_mes_*` 自 slice 2 起**没有任何读写方**，而 `public.work_orders` 0 行且 `product_id`/`line_id`/`work_order_type` 全是 NOT NULL —— 两边都撑不起这个同步。所以 `database/migrations/344_mes_sync_canonical.sql` 建的是**无前缀权威表**：`mes_sync_state`、`mes_sync_log`、`mes_issue_writeback`、`mes_work_order_material`，外加一张**专用 `mes_work_orders`** 工单头。`ord_mo`（迁移 340）是 MES 模块自己的表，**刻意不复用**；`wms_picking_orders` 只用 `work_order_no varchar` 挂接，所以开单不需要工单外键。新模块对 `rjvn_mes_*` 零读写（契约测试里有这条）。
- **14 条路由一条不少**，每条同时注册 `/wms/...` 与 `/api/wms/...`，且显式 `authenticateJWT` + `requirePermission`。读（`status`、`config` GET、`pending`、`materials/:moNo`、`logs`、`writeback/list`）用 `wms.view`；`config` PUT、`test`、`sync`、`sync-pending`、`materials/:moNo/sync`、`writeback/run`、`writeback/:id/retry` 用 `wms.sync.manage`；`picking/:moNo/generate` 用 `wms.write`。**没有新造权限**，两个都是既有权限。
- **参考语义逐条保留**：进程级 `syncRunning`/`writebackRunning` 互斥（定时器与人工点击不叠跑）；游标**回退 60 秒**（`maxUpdated.getTime() - 60_000`，同秒多次修改不漏，重复由 upsert 吸收）；MES 墙钟按 **+07:00**（`MES_TZ_OFFSET_MIN = 420`，裸时间戳按 +07:00 解析）；`AbortSignal.timeout` + `MES_TIMEOUT_MS = 15_000`；**100 页 × 200 行**拉取上限；回写退避 `[1,2,5,15,30,60]` 分钟、第 8 次标 failed（`WB_MAX_ATTEMPTS = 8`，人工可重推）；幂等键 `wms:{pickingNo}:issued:v{updatedAtMs}`；60 秒回写轮询与 `mes.interval_min` 驱动的自动同步（都 `unref()`，不拦进程退出，间隔夹在 1–1440）。段位映射到 canonical 五个工段 `smt|dip|assembly|packing|aux`；状态映射里 `closed`/`cancelled` 永远不会被 MES 拉回别的状态，`released` 不会退回 `created`，`generate` 拒绝关闭的工单。
- **四处刻意差异（是决定，不是漏搬）**：① 响应用本仓信封（对象 `successEnvelope`、数组 `listEnvelope(rows,total)`），不是参考的裸对象；② 模块 deps 多要一个 `getClient` —— 开领料单要 `pg_advisory_xact_lock` + 取号 + 写明细同一个连接，池化 `query()` 保证不了；③ 密钥永不回显，`GET /config` 只给 `hasApiKey` + `apiKeyMasked`（`slice(0,6)****slice(-4)`），PUT 传**空串 = 不修改**，`mes.api_key` 未配时回落 `wms.itf_key`（自建 MES 只需一个密钥，不是两个）；④ 回写队列关键字**多搜 `p.work_order_no`** —— 那是页面上真正显示的那一列，参考只搜领料单号/MES 领料单号。
- **live 全链路实跑**（临时 API `:8095` + 桩 MES `:8096`，验完都已停，探针数据全删）：`test` 200 · `sync` 拉 1 建 1、游标推进到 `2026-11-20 07:59:00` · 再 sync `since` 生效（回退 60 秒）· `materials/MO/sync` → `materialCount=2 missingMaterialCount=1`（一条 `42` 解析到 `material_id=6`，一条 `NOPROBE-MAT` 未建档）· `pending` 板有行 `materialCount=2 openQty=100 unmatchedCount=1` · `picking/generate` 生成 `PK202611210001`（smt，MPQ 建议 1000）与 `PK202611210002`（aux，40），均 `approved`，申请人/批准人 `12` · 再生成 `created=0 refreshed=2`（不重复开单）· 工单 `created`→`released` · `writeback/run` 发 1 条且 `idempotencyKey=wms:PK202611210001:issued:v…` · 人工重推发 1 条 · 非 MES 来源 `skipped=1`（「非 MES 来源，已跳过（不会覆盖）」）· 关闭工单开单 **400** · `logs` 里 `work_order`/`picking`/`writeback` 全 `success`。清场后 `mes_work_orders`/`mes_work_order_material`/`wms_picking_orders`/`mes_issue_writeback`/`ord_mo`/`mes_sync_state` 对 `MOPROBE0001` 均 0 行；`mes.*` 8 项参数已还原。
- **修掉一个自己写出的 bug**：`generatePicking` 的 refresh 分支原来把条件 `SET` 片段拼进 SQL 却始终传 4 个参数 —— 占位符与参数数量错位；现在按 `$1 = cur.id` 拆成两条语句（批准 / 汇总数量）。
- **前端**：`apps/web/src/wms/WmsMesSync.tsx`（tab key `mesSync`，`wms.subnav.mesSync` 三语齐全）—— 状态条（地址/密钥掩码/游标/上次运行/7 个计数）、配置区（地址、只写不回显的密钥、1–1440 间隔、四个开关、`suggest|open` 口径、对接操作人）、待领料工单板 + 用料钻取（可用/缺口/MPQ/建议/建档状态）+ 一键开单、回写队列（可筛选/立即回写/重推）、同步日志。客户端助手在 `apps/web/src/api/wms.ts`；`tests/mes-sync-contract.test.ts`（11 条静态断言）钉住路由、权限、游标/退避常量、表所有权、「不碰 rjvn_mes_」、tab 接线与三语覆盖。
- **在隔壁 lane 发现、未在此修**：本仓自己的 `/api/itf/wms/*` 对手方在 `services/api/src/mesrj/itf/wms-mo.js:89` 查 `md_product.panel_count` —— 本库**没有这一列**（唯一的 `panel_count` 在 `cfg_stencil_param`），所以 `/mo` 直接 500。这也是上面 live 验证用桩 MES 而不用 `WMS_ITF_BASE_URL=http://127.0.0.1:8080` 的原因，已在交接里点名。
- **验证**：`node --check` 0 · `REGISTER_DEPS_OK` · `ROUTE_CENSUS_OK total=2852 baseline=2726 (+126) prefixes=176` · `AUTH_ORDER_OK stranded=0 baseline=0` + `AUTH_ORDER_MODULES_OK registerCalls=10 strandedModules=0` · `ROUTE_SHADOWING_OK dead_guards=10 baseline=10` · `MIGRATIONS_OK files=356 prefixes=45` · `check:i18n I18N_OK entries=5543` · `npm run typecheck` 0 errors。

### 2026-11-22 · opencode：缺口修复批次 + IQC 分歧闸门 + 侧边栏重组 + 全量页面审计归档

- **修复批次（均 live 实跑，临时 API :8097，探针数据全删）**：
  - OA 回调幂等：`oa-integration.js` callback 走 392 的 `oa_callback_log`（UNIQUE NULLS NOT DISTINCT），占位+生效同事务，失败回滚占位可重投；密钥失败关闭（无 secret→401 `OA_SECRET_UNCONFIGURED`，删硬编码兜底）。实测：无签名 401 `OA_SIGNATURE_INVALID`；带 HMAC 首投 200 `{ok:true}` 且 outbox `running→approved`；重投 200 `{skipped:true}`，log 仅 1 行。
  - MES v1 只读契约（`routes/mes-api.js`，7 路由 + 2 管理路由）：机器 X-Api-Key（`mes.api_key`，sha256+timingSafeEqual），ping/stock/stock-summary/picking-orders(+detail)/returns(+detail) 全 200 真实数据；无 key 401。
  - `wms-mo.js` panel_count 500：393 迁移补 `md_product.panel_count`；`/api/itf/wms/mo` 200 且 `panelCount:12` 真实回显。
  - `pmc.js` 拣料建议冻结批次过滤：bestLot 查询加 `lifecycle_status <> 'EXPIRED_ISOLATED'`（连同 released/open/unlocked）。实测注入 WO+BOM（11 位工单码触发器约束）+ 把 EXPIRED_ISOLATED 批 670 置 released → `bestLot:null`（过滤生效），清场还原。
  - 392 补 `public.flow_webhook_outbox.manual_retry_count`（与 oa 表对齐，防 search_path 漂移咬人）；394 supplier_debt 形状收敛：FK（supplier/material/source/mrb/iqc_inspection，可空+有值必真）+ id 索引，实测 `\d supplier_debt` 全在。
- **IQC 16 批分歧（slice 3b 收尾，不翻转判定）**：`wms-graft.js` 新增 `GET /wms/iqc/divergence`（报告，dangerous=镜像 blocked 而 canonical released；conservative 反向只报不红）+ `POST /wms/iqc/divergence/:lotId/quarantine`（只置 hold——391 视图与发料门禁本就按 released 判，hold 不可领；写 `wms_audit_events` 署名；释放/拒收仍走 IQC_RELEASE/IQC_REJECT）。`scripts/check-iqc-divergence.mjs` 挂 static 梯级第 11 信号（`check:iqc-divergence`，DB 缺席 SKIP）。双向反测：注入 lot 542 canonical=released/mirror=rejected → 闸门 exit 1 点名、quarantine 后 hold、审计行在、重投闸门 OK；还原后 `IQC_DIVERGENCE_OK`。
- **侧边栏重组（结构评估 P1 落地）**：`App.tsx` moduleGroups 改 7 业务域组（总览/计划与物料/生产执行/质量/协同办公/经营与系统/绩效大使），删死入口 `mesrj`（内容已在 MES 五分组 tab）、ModuleKey 去重（dashboard×2）、FULL_MODULES 去 mesrj 并显式注释 hash-only（mobile/manualLine3d）；quality 保留注册但不再做第二个侧边栏入口（QMS 主入口）；`resolveModuleAccess` 接上 Shell（兑现新角色不空导航）；Heartbeat 改 `${apiBase}/health`（client.ts 导出 apiBase），vite dev/preview 与 nginx `/health` 改代理真 API（原 nginx 静态 'ok' 会让灯永绿）。wmsTabKeys 去重 rework/supplierDebt/defectiveMove；mes 7 个硬编码中文标签→三语键、ngClosedLoop 独立键。浏览器实测：admin 6 组可见、无 quality 双入口、heartbeat「API OK」；vi-VN 下 MES 物料组 0 硬编码中文。
- **闸门**：typecheck 0 错（typecheck:tests 115 错全在我未触文件，基线既有）；test 470 过；syntax/i18n(5552)/auth-order(0)/migrations(361)/route-census(2868≥2726)/route-shadowing(10=10)/register-deps/picking-drift/iqc-divergence 全绿。
- **审计归档**：五份报告落 docs/（page-audit-wms/mes/oa-misc、ui-design-report、graft-parity-report，均 2026-11-21，含 wms-audit-raw 109 条原始证据）。合并修改计划见 `docs/ui-modification-plan-2026-11-22.md`。
- **审计发现但未修（进合并计划，红线：不动活体 WMS/OA）**：dev vite 代理缺口致 ~60 WMS 页/≥16 MES 页/≈40 管理页签假空态（生产 nginx 有裸路径正则，dev 没有）；admin 权限种子缺 wms.read/wms.iqc/finance.view/reports.view 等→菜单可见接口 403；HR 全 API 500（hr_employees FK 映射错）；ensureAuthenticated 把 async authenticateJWT 当同步→懒鉴权路由对有效 JWT 401；issue 页假闭环、cycleCount 盘亏 abs 变盘盈、repair 绕过复活审批、pdaScan 纯前端、ngClosedLoop 硬编码演示、projectMgmt 内存假数据、QMS react-i18next 未初始化整域裸键。

### 2026-11-22 · opencode（ruijing-mes → mesrj 残余缺口嫁接）：对账 + 补最后 10 条路由

- **源**：`github.com/tianjinwuyong/ruijing-mes` @ `b374884`（2026-11-21，已部署 rjms:8088 实跑，见本轮 deploy 记录）。这是「工作 MES」的独立 Python/Flask 版；mesrj 域就是它的 PG 化嫁接。
- **对账方法（datasync 教训：别信静态路径 diff，要读函数体 + 实跑）**：源 499 条 `@bp.route` 逐条比对目标全部 `router.<verb>`（含 `L_R("…")` 模板注册），再**折叠分隔符/参数归一/后缀匹配**去掉改名等价，最后对每条疑似缺口**读源函数体 + 读目标同名/近名 handler** 确认。结论落 `.factory/mes-graft-census.json`。
- **改名等价（已存在，不动，避免重复实现）**：`/oqc/po/<id>/gap`≙`/oqc/po_gap`、`/oqc/po/gap-list`≙`/oqc/po_gap_list`、`/oqc/po/ship-check`≙`/oqc/can_ship`、`/exec/panel_preview`≙`/exec/panel/preview`、`/exec/device_health`≙`/exec/device/health`、`/exec/repair/ai_stations`≙`/exec/ai/stations`、`/panel/layouts|layout`≙`/panel/layout/list|save`、`/smt/load_confirm`≙`/smt/load_check`（目标 load_check 已含校验+落库，非严格路径无 machine/slot 也记录，`prd_material_load.load_type` 列在）。
- **真实缺口 = 10 条**，全落 `services/api/src/mesrj/gap-routes.js`（新，两导出 `registerMesrjGapRoutes`/`registerDeviceGapRoutes`）：
  - JWT 侧（mesrj 域信封 `{success,msg,data}`）：`GET /smt/mo_variants`、`POST /smt/mo_variant`（写 `ord_mo.feeder_model`）、`POST /smt/load_recommend`（扫料盘→候选站位，机型非前置 + 替代料校准 + 基准兜底）、`GET /plan/kitting`（多阶 BOM 递归展开 + 替代组归并 + 需求/已领/库存三口径）、`GET /report/station-board`（多工位×日期→投入/产出/FPY/NDF）、`POST /md/machine-source/point-to-mo`（路线快照→批量刷 `cfg_machine_source.mo_hint`）、`POST /bind/teardown`（拆壳记 `action='拆壳'`，与「换标=作废」严格区分，否则新铭牌继承旧板 ATE1/超声履历跳过重测）。
  - 设备侧（X-Api-Key，注册在 JWT 之前）：`GET /DeviceConfig/OpenMo`（PascalCase 契约）、`POST /Device/UltraScan`（校验+写 `prd_ultra_scan`+入队，不写过站）、`GET /Device/UltraScan/recent`。
- **数据层：无迁移**。10 条端点读的表/列全部已在 live DB 核实存在（`ord_mo.feeder_model`、`md_feeder_slot(_alt)`、`prd_material_load(.load_type)`、`prd_smt_baseline`、`bom_item(.item_type)`、`ord_issue(_item)`、`erp_inventory`、`prd_mo_route(.snapshot)`、`cfg_machine_source(.mo_hint)`、`prd_ultra_scan`、`prd_sn(_rel)`、`mesrj_decode_log`、`prd_pass`、`md_station`）。台账教训复用：断言「缺表」前查 live DB 全部 schema，不能只 `ls migrations`（migration 文件里「缺」的 47 张表，实跑后 40 张在库里，其余是 merged/未引用）。
- **挂载（§4 硬规则 1/2）**：全挂 mesrj Router 不写 app 级；mesrj.js 仅追加（1 import + 2 register 调用，位置=原设备块尾/JWT 后 register 段）；server.js 仅追加 `DEVICE_OPEN_PATHS` 一个元素 `/mesrj/Device/UltraScan`（`/DeviceConfig/OpenMo` 由既有 `/mesrj/DeviceConfig` 前缀覆盖）——这是 device-key.js:13 文档化硬规则，非改鉴权逻辑。
- **权限键**：源 `smt.load`/`prod.teardown` 本仓 `sys_perm` 无对应键（实测查库），按 §4 不新造权限，映射到语义最近的既有写/绑权限（`md.edit`、`prod.bind`/`prod.decode`）。
- **验证（§8 全绿）**：`node --check` server.js/mesrj.js/gap-routes.js 0 错；`check:syntax` 390；`check:register-deps` OK；`check:route-census total=2878 (+152) prefixes=177`（+1 = 新 `/mesrj/Device` 前缀）；`check:auth-order stranded=0` + `registerCalls=12`（+2 = 本 lane 两调用）；`check:route-shadowing dead_guards=10=10`；`typecheck:api errors=561 ≤ baseline=595`（gap-routes.js 在 checkJs 程序内、自身 0 错）；`check:migrations 362`（未新增，符合预期）；`check-db-ownership` 全合规；`test:unit 470 过/2 跳`。
- **实时调用证据（临时 API :8093，验完已停；探针数据全删）**：JWT 侧 7 条 —— `station-board` 200 真跑窗口函数+`AT TIME ZONE 'Asia/Ho_Chi_Minh'`+`ANY($1)`（`errors:[]`）、`load_recommend` 200 解析出站位+历史推荐、`kitting` 200 递归展开 demand_total=600=3×2×100 且 SFG 段 excluded_cnt=1、`point-to-mo` 200 实改 `mo_hint` OLD→MO + 审计、`mo_variants`/`mo_variant`/`teardown` 到业务分支（工单/扫码校验）。设备侧 3 条 —— 无 key/错 key 401（fail-closed）、正确 key `UltraScan` 200 verdict=NO_SN、`OpenMo` 200 `{Success,Count,Rows}` PascalCase、`UltraScan/recent` 200。临时设备密钥 + 全部 ZZ-GAP scratch 行（product/mo/bom/slot/route/machine_source/ultra_scan）`finally` 删净，复查 left=0。
- **前端**：未接。源 PDA/pages.js 调这些路径，但本仓 mesrj 前端未引用（属后端补齐）；前端接线留作需要时另开 lane，不在本轮塞。
- **NOT DONE / RISKS**：`load_confirm` 判定为 load_check 等价未单独补——若现场 PDA 严格依赖 `load_confirm` 独立端点，需回源核对返回体差异（现 load_check 已覆盖记录语义）。`mo_variants` 的 `product_model` 空时 variants 为空（源同口径，需 md_product.product_model 建档）。

### 2026-11-22 · opencode（ruijing-mes → mesrj 前端嵌入 W17）：补上源里目标菜单缺失的 10 屏

- **缘起**：上一轮「残余缺口」只补了后端路由。用户追问「frontend embedding = 按 SMT 结构嵌进去、接口一个不少」，于是对账前端：源 `web/pages.js` 137 个 `A.register` 屏 vs 目标 `mesrj/menu.js` 叶子，**10 屏在目标菜单里没有落点**（截图红框标出锚点位置）：`exec.ultra` 超声工位看板、`exec.ultraparam` 超声参数维护、`exec.teardown` 拆壳返工、`exec.agingctl` 老化时效、`exec.lasercheck` 镭雕回读核对、`prod.shelflife` 成品库龄、`cfg.calib` 仪器校准台账、`md.fixture` 治具台账、`report.stboard` 工位质量看板、`sys.dept` 组织架构。
- **后端零新增**：10 屏的接口全部早已存在（ultra.js board/limit、aging.js list/in/out/rule、laser-readback.js batch/*、shelf-life.js board/rule、calib.js、fixture.js、gap-routes.js station-board、dept.js、bind-routes.js lookup/decode+teardown）。本轮是 §7 前端镜像，不是新接口。
- **菜单**：`menu.js` 10 叶子按源 `api/sys.py` MENU 的**逐字位置**插入（exec.ultra/ultraparam 在 exec.scan 后、teardown 在 exec.decode 后、agingctl/lasercheck/shelflife 在 exec.dwell 后、calib/fixture 在 md.equipment 后、stboard 在 report.output 后、dept 在 sys.user 后）；权限沿用既有键（源 `prod.teardown`/`smt.load` 本仓 sys_perm 无此码，teardown 用 `prod.bind`）。
- **权限码迁移 396**：`database/migrations/396_mesrj_w17_menu_perms.sql` 补 10 条 `menu.<code>` sys_perm 行（模式同 315，只补码不建角色不授权，ADMIN 直通；只 INSERT 不建新对象 → 无需属主块）。`node scripts/migrate.mjs` 已 applied。
- **视图**：`apps/web/src/mesrj/views-w17.tsx`（新，10 个导出）—— 校准/治具共用 `LedgerPage` 骨架（KPI+过滤+表格+编辑弹窗+Excel 导入/模板下载，导入走 `readUpload` 的 base64 分支 `{file_name,content_base64}`）；超声看板（KPI+各小时柱+按工单+队列过滤+CSV）、参数维护（cfg_ultra_limit 阈值）、拆壳（扫码→确认→action='拆壳'→履历表）、老化（进/出+要求时长规则）、镭雕核对（批次+batch/compare）、库龄（箱级+机型规则）、工位质量看板（工位开关×日期→投入/产出/FPY/NDF）、组织架构（dept/tree 缩进+编辑）。`index.tsx` renderView 加 10 分支（W16 之后）。
- **三语**：`labels.ts` 追加 206 条（菜单名/字段/KPI/状态/按钮，zh/en/vi 齐备）；`check:i18n` 5952 条 OK。
- **修一个自己写出的 bug**：共享 `Table` 原来对每格 `String(v)`，把 `__act`/`__level` 里的 React 元素渲染成 `[object Object]`（组织架构截图暴露）→ 加 `cellVal`：`isValidElement` 直接渲染，否则 String。typecheck 0 错。
- **验证（§8 全绿）**：node --check menu.js · check:syntax 393 · check:migrations 363(+396) · typecheck 0 错 · check:i18n 5952 · register-deps OK · route-census 2878(不变，前端无新路由) · auth-order stranded=0 · route-shadowing 10=10 · test:unit 470 过/2 跳。
- **实时证据（:5178 dev + :8080，headless Chromium 实跑）**：重启 API 后 `/menu` 叶子 166→176（10 个新码全在）；逐屏点开，10/10 渲染真实视图（`wip:false` 无「建设中」兜底、`objObj:false`）——超声看板 KPI/各小时/按工单齐、校准台账 已过期/30天内/60天内+导入/模板、老化 进/出+规则、库龄 已过期/临期/保质期+规则、stboard 汇总/按日明细/投入/产出/良率、组织架构 部门表带 ✎/✕ 按钮、拆壳 履历+警示、参数 阈值表。镭雕核对仅显「发码批次」（laser_batch 空表，数据依赖非缺陷）。截图落 `~/Desktop/.w17-*.png`（exec/qual/cfg/dept/ultra）。
- **NOT DONE / RISKS**：PDA 独立页（源 pda*.html 6 张）与 board.html 大屏未嵌——本仓已有 pda-* 页签但口径不同，属另一轮；源屏里部分下拉（校准部门来自组织架构）未接 opts 联动，用自由文本，行为一致。前端未提交（branch deploy/wms-oa-sync-20261120 仍脏）。

### 2026-11-23 · opencode（W18 前端嵌入 add-on）：54 个「建设中」叶子对账 + 42 个落地，剩 12 个如实分级

- **缘起**：用户追问「数据库对账 / 逻辑拷贝 / 前端嵌入做完了吗」。前两轮只补了后端路由，本轮把前端补齐。方法沿用 datasync 教训：**静态 diff 不可信，以浏览器实跑为准**。
- **真实基线（实跑枚举，非静态推断）**：点开 5 个桥接域全部叶子 → **105 已接线 / 54 显示 🚧 WipView**。此前我口头报过「137/137 = 100%」，**该结论错误并已作废**：静态按 code 对账会把 `exec.pass`≙`exec.passlist` 这类改名重复计，且菜单有叶子 ≠ 视图能解析（§9 WipView 掩盖缺失）。
- **42 个叶子本轮落地（三种机制，全部实跑验证 wip:false）**：
  1. **别名 6 个**（源 code → 本仓同一屏的既有视图，不新写组件）：`exec.pass`→`exec.passlist`、`exec.trace`→`exec.tracesn`、`exec.momaterial`→`exec.momaterials`、`report.yield`→`exec.yield`、`qlt.oqcreport`→`report.tpl`、`exec.empcert`→`emp.cert`。落点 `index.tsx` LEAF_ALIAS。
  2. **登记式通用列表屏 12 个**：新增 `GenericScreen.tsx`（引擎）+ `screens.ts`（登记表：endpoint + 列 + 过滤 + CSV + 行内动作）。覆盖 上岗登记 / 设备接入状态 / 操作日志 / 锡膏回温 / PCB拆封烘烤 / 钢网管控 / 设备上报数据 / AOI·SPI / 机型维护 / 物料消耗(pick=items) / OQC看板(pick=stations)。**信封形状运行时判别**（array / rows / list / items / data），列缺省按首行键自动出列——不猜列名。
  3. **ERP 叶子 24 个 → 决策 (b) 跳转，不复制 UI**：新增 `erpJump.ts` + `JumpCard`。理由（与用户共同判定）：SMT 已有 procurement/sales/finance/wms/maintenance 规范屏渲染**同一批 canonical 表**（实测有真实数据），再套一层 ERP 皮 = 两套界面同一数据迟早漂移，与协议禁止影子表同理。落地成本为零风险：模块选择本就是 hash 驱动（`App.tsx:3120` 读 `location.hash` + hashchange 监听），卡片只写 `<a href="#procurement">`，**未动共享 App.tsx 一行**。24 个 module key 全部核对为真实 ModuleKey。
- **三语**：`labels.ts` +55（w18.* 引擎 UI + 列标签）+24（w18j.* 跳转卡片/规范屏名），check:i18n 6082 条 OK。
- **闸门**：typecheck 0 错 · test:unit 490 过/2 跳 · check:i18n 6082 · node --check 全绿。（本轮无新路由，route-census/auth-order/shadowing 不变。）
- **修自己写出的两个 bug**：① `GenericScreen` 对可选 `def.columns` 直接 `.filter`（tsc 抓到）→ 与表格同一处解析列；② 曾把 `Promise.withResolvers` 写进来，本仓 tsconfig lib < ES2024 → 回 executor 形式并注明原因。
- **剩余 12 个叶子：如实分级（本轮明确不做，理由有据）**
  - **9 个是真·交互工作流，通用表格引擎套不上**（读源码统计得出，非感觉）：`exec.loading` 上料防错（扫料盘→load_recommend 出候选站位→人选机台/通道/飞达→load_confirm，多步有状态）、`exec.fa` 首件与点检、`exec.dippass` DIP 过站（扫码+提交+小时板）、`exec.tracebind` SN 绑定追溯（查链+导入）、`cfg.basic` 基础数据维护（14 个页签各自 CRUD）、`sys.param` 系统参数（`{group,items[]}` 分组编辑器，非平表）、`qlt.aqlstd` AQL 标准（对象映射）、`qlt.oqc` OQC 出货抽检、`qlt.oqccheck` OQC 逐项检验录入。→ 每个 100-250 行专用组件，且**会写库**（confirm/judge/scrap），必须按台账实跑纪律：造 scratch 行验证后删净。
  - **1 个 `exec.defect` 不良记录：此前被我错标成「专用组件」，读源码后更正**——它是 `listPage`（普通表格 + 两个行内动作 去维修/报废），通用引擎本来套得进；**唯一卡点是后端 `/exec/defect` 实测 404 不存在**。数据可派生已核实：`prd_pass WHERE result='NG'`（defect_time/sn/station_code/ng_code）+ `md_defect`（repair-core.js 已在读）+ 维修队列出 handle 状态。本仓 dev 库 NG=0 行、prd_repair=0 行，所以**不做**的理由不是「难」而是：① 对着不存在的端点渲染永远空的表 = 假界面；② 把它指到 `exec/repair/list` 是**语义错误**——那是「已被维修台接走的板」，不是「全部 NG 过站事件」，两个集合不同。**待办**：在 `gap-routes.js` 加一条 `GET /exec/defect`（约 40 行，无新表），再进通用引擎。
  - **2 个（机型维护 / 工单物料反追溯）在实跑枚举里未命中源菜单标题**，标题对账未匹配，需回源确认是重复屏还是真缺，不在本轮猜。
- **红线遵守**：未动活体 WMS/OA、未动 harness/END-TO-END.md、未 `git add -A`、server.js 只追加 1 个数组元素、mesrj.js 只追加 import+register。

### 2026-11-23 · opencode：⚠ 修正上一轮的「12 个剩余」分级 + 推送决定

- **修正**：上一条把剩余写成「9 工作流 + 1 defect + 2 未匹配」，两处错误，实测更正如下：
  - 「2 未匹配（机型维护 / 工单物料反追溯）」是**误判**——两者其实**已接线**：`md.model` 在 `screens.ts`、`exec.momaterial` 在别名表。撤销。
  - 真正剩余 = **12 个叶子**，重新分级为 **7 真工作流 + 4 便宜 + 1 缺后端**：
    - **7 真工作流**（需专用组件，且会写库，须 scratch 验证后删净）：`exec.loading` 上料防错、`exec.dippass` DIP 过站、`exec.fa` 首件与点检、`exec.tracebind` SN 绑定追溯、`qlt.oqc` OQC 出货抽检、`qlt.oqccheck` OQC 逐项检验录入、`cfg.basic` 基础数据维护（14 页签）。
    - **4 便宜**（后端已返回真实数据，只是我没登记）：`smt.baseline` 上料基准（`/smt/baseline/list`）、`qlt.oqclist` OQC 检验记录（`/oqc/list`）、`sys.param` 系统参数（`/sys/param/list`，`{group,items[]}` 需小定制视图）、`qlt.aqlstd` AQL 标准（`/oqc/aql/std`，对象映射需小定制视图）。前两个进 `screens.ts` 即可。
    - **1 缺后端**：`exec.defect` 不良记录——`/exec/defect` 实测 404，先在 `gap-routes.js` 补 `GET /exec/defect`（`prd_pass result='NG'` + `md_defect`，约 40 行），再进通用引擎。
- **闸门复跑（2026-11-23，对当前 worktree）**：typecheck 0 错 · test:unit **507 过/2 跳**（比上轮多 17，别的 lane 加了测试）· check:syntax 394 · route-census 2883(+157) · auth-order stranded=0 · shadowing 10=10 · migrations 366 · i18n 6082。`:8080` 正跑这棵 worktree，即运行时证据。
- **推送决定（用户令「push up to github」）**：实测依赖闭包——**我的这一片无法单独成可启动的提交**：`gap-routes.js` import `ultra.js`+`device-key.js`（未跟踪，任何分支都没提交）；W17 前端调 `/calib/list`、`/dept/tree`、`/aging/list` 等，其后端文件同样未跟踪。HEAD 自身自洽（其 mesrj.js 只 import 已提交文件），所以只提交我的行会让分支起不来、我的屏 404。
  - **做法**：推一个**独立 WIP 快照分支**（不碰共享 `deploy/wms-oa-sync-20261120`，对并行 agent 零影响），内容 = mesrj 嫁接闭包（`services/api/src/mesrj/` 全部未跟踪 + `routes/mesrj.js` + `apps/web/src/mesrj/` 全部未跟踪 + `index.tsx`/`labels.ts`/`menu.js` + 迁移 396 + 台账/claim/state/契约）。**不含 server.js**（避免把 hub/mes-sync/qms-phase3/wms-ops/notice-push 这些别的 lane 的未跟踪文件一起拽进来）——代价：`/mesrj/Device/UltraScan` 一条设备路由在该分支会 401（其余照常），已在分支说明里写明。
  - 提交信息**明说**这是多 lane 在途工作的保全快照、非单作者可评审提交；排除 582 个根目录 scratch 与 `.env`（已 gitignore）。

### 2026-11-23 · opencode：W20 —— 最后 8 个 🚧 叶子全部嫁接完成，前端 162/162 接线 + 视频证据 + 生产 MES 拉取通道打通

- **实扫起点**（不信 W18 文档的「~12 剩余」猜测，按脚本对 `/menu` 全量 diff）：剩余恰好 **8** 个：`exec.loading / exec.fa / exec.dippass / exec.tracebind / qlt.oqc / qlt.oqccheck / cfg.basic / sys.info`。
- **做法**：4 个并行 agent 各领 2 屏，从 `ruijing-mes-ref/web/pages.js` 对应 `A.register` 块逐屏移植（源行号：11817/12377/12440/15330/17025/20037/23076/9969），全部只读探测后端真实形状后接线。新文件 4 个：`views-w20-smt.tsx`（LoadingGuardView/FaCheckView，含 load_recommend/load_check/load_change/load_return、fa/confirm、equip/check 全写链路——后端路由都在，无禁用按钮）、`views-w20-dip.tsx`（DipPassView/TraceBindView，panel/view+pass_panel 整版过站、sn_trace 绑定树+sn_import 批量导入）、`views-w20-oqc.tsx`（OqcInspectView/OqcCheckEntryView，pending_queue→open_order→check_box→judge→review(返工/特采/报废)→stock_in 全工作流 + check/ctx→save 逐项录入）、`views-w20-sys.tsx`（BasicDataView 四页签 process/shift/cap/param 全 CRUD、SysInfoView 运行信息+itf 配置+设备健康+测试参数）。`index.tsx` 加 4 组 import+dispatch，`labels.ts` 追加 ~250 条三语（w20.loading/fa/dip/trace/oqc/chk/basic/sys + 4 个 menu.*）。
- **闸门（2026-11-23 18:0x，对当前 worktree）**：typecheck 0 错 · check:i18n **6102** OK · test:unit **535 过/2 跳** · 静态叶子 diff **unhandled=[]**（162 叶子全接线）· 4 个新文件 esbuild 0 诊断。
- **视频证据**：`docs/mes-frontend-embedding.mp4`（120.8s，4.5MB，1600×900）——Playwright 全量遍历 5 个 MES 分组 × 162 叶子，逐叶点击+截图取证，结果 **🚧=0、空屏=0**；抽帧核验 f04 为「MES 执行→品质与追溯→维修交接」真实渲染。复跑工具：`tmp-mes-embed-sweep.mjs`（本仓根）+ `C:/Users/tianj/mesrj-leaves.cjs`（静态 diff）。注意坑：`?view=mes&mesTab=mesrjXxx` 必须整页加载（hash 只在 init 读一次）；录屏需真 `ffmpeg-1013`（`npx playwright install ffmpeg`），且 `video.path()` 要在 `browser.close()` 之前取。
- **生产 MES 拉取通道（用户令「smt sync with working mes, pull」）**：`/api/wms/mes-sync/*` 在 rjms 生产镜像里已存在（文件+容器双确认）。经 rjms 跳板配置生产 SMT：`baseUrl=http://10.190.252.246:8080`、`apiKey=` 从 MES `/api/wmsmo/overview` 取的 `wms.itf_key`（36 位 `mes-a…`，未打印全文）、`autoSync=true, interval=5min`。实测：`/test` ok（service=ruijing-mes，16ms）；`/sync` **pulled=3 created=3**（MES itf 恰暴露 3 张 MO：261110006/005/002，1:1 对上）；`/materials/261110006` 返回 24 行用料；`/logs` success、游标 `2026-11-12 08:58:33`。数据落 `mes_work_orders`/`mes_work_order_material`，不碰 MES 侧（纯拉取）。
- **`exec.defect` 更正**：上一轮记「后端 404」已过时——实测 `GET /api/mesrj/exec/defect?size=2` 现返回 `{success:true,data:{total,page,size,rows}}` 真实分页信封（同前缀 `/exec/defectZZZ` 返回「未知资源」，证明它走的是 mesrj.js 的通用资源 dispatch，不是 SPA catch-all 兜底 HTML）。该叶子 `screens.ts` 已登记 `endpoint:"/exec/defect"`，视频里 `不良记录` 渲染正常、无 🚧。当前 `total:0`＝此刻无 NG 过站行，非缺路由。至此 162 叶子全部有后端 + 有前端。提交/推送沿用上一轮结论：不单独推前端（依赖闭包含其他 lane 未跟踪后端），待用户定夺。
