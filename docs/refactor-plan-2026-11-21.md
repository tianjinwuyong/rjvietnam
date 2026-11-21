# 重构计划 2026-11-21（核实修正版）

原稿按"每一步都能独立停机"设计,方向保留。本版把原稿中与仓库实测冲突的前提逐条修正;
所有"实测"数据均来自 2026-11-21 本机只读核查(node + pg 直连、git 只读命令),核查脚本已删除。

## 红线(用户指令,2026-11-21,高于本计划一切条目)

**在运行的 WMS 与 OA 不可改动;SMT 只能从它们同步,方向单向。**

- 活体上游:WMS `http://100.107.212.49:18080`(NestJS)、OA `http://100.107.212.49:8090`,
  均在 tailnet 上持续运行。本仓任何重构、迁移、守卫、CI 都不得改它们的代码、schema、配置或数据。
- SMT 侧同步通道是**冻结契约**,重构只许搬迁不许改语义:
  `src/routes/live-sync.js`(拉取适配器,落 `sync_stage.live_<app>__<task>`,永不直写业务表)、
  `src/routes/mes-sync.js` + `src/mesrj/itf/`(MES⇄WMS 两端,字段对齐见 MES_ITF_WMS_PARITY.md)、
  `src/oa/` 与 `oa-integration.js`、`mes_issue_writeback` 出站队列。
- 对上游的唯一写回走既有出站队列/机器接口,不新增直连写路径。
- 本计划阶段 3 轮次 2 的 "WMS" 指 **SMT 仓内的 wms-* 路由模块**,不是活体 WMS;
  搬迁时上述同步适配器整段冻结,不进任何一轮的搬迁清单。
- 已执行的阶段 0 动作复核:防错库守卫只读本机 information_schema;venv/scratch/gitignore/push
  均不触及同步面。`oa.flow_webhook_outbox` 守卫检查的是本机 smt_factory 库里的 oa schema 副本,
  不是在运行的 OA。

## 0. 实测结论(先于一切动作)

**数据库真源与原稿相反。** 两个库都在 127.0.0.1:5432:

| 库 | 表数 | 关键内容 | 判定 |
|---|---|---|---|
| `smt_factory` | 1812(public=1472, oa=187, sync_stage=112, mes=31, …) | `_migrations`=361 条;`employees`=39 行;`inventory_transactions`=774 行;`wms_picking_orders`、`ve_reporting_lines`、`sys_user`、`oa.flow_webhook_outbox`、78 张 `public.rjvn_*` 镜像表齐全 | **唯一活库,当前代码就是为它写的** |
| `factory` | 605(rjvn=313, public=263, mesapp=29) | 无 employees / inventory_transactions / wms_picking_orders / ve_reporting_lines / oa schema(0 表);rjvn 只有旧 mesapp 形状(sys_user、agv_*、bom) | 参考库(rjvn 参考系统导入),**不可作为运行库** |

原稿"rjvn=313 验收"数的是 `factory` 参考库。把 `services/api/.env`(现指 smt_factory)改到
factory、REVOKE smt_factory、或加"rjvn<300 拒启"守卫,任何一条都会让全系统起不来:
server.js 经 `src/db.js` 连库(search_path=rjvn,public),但全部业务表在 smt_factory 的 public/oa。
**阶段 0 的改库三动作全部取消**;防错库守卫按修正版做(见下)。

其他实测与原稿的出入:

- 当前检出分支是 `deploy/wms-oa-sync-20261120`,**领先 origin 38 个提交未推**;
  `feat/material-fetching-consumption-flow` 领先 origin 7 个未推。只推 feat 会漏掉大头。
- `services/api` 共 26268 个文件:`.venv-ocr` 占 ~25.5k(825 MB),其余 **684**。
  venv 与 node_modules 均已被 `.gitignore` 覆盖(`**/.venv-*/`),对 git 零影响;移走只省磁盘。
- OCR 引用仅一处:`integrations/llm/index.js:145-146`,且已有 `WMS_OCR_PYTHON` 环境变量覆盖;
  Paddle 路径 opt-in(`WMS_OCR_USE_PADDLE=1`),默认 RapidOCR/Tesseract 走 PATH `python`,不依赖 venv。
- `.github/workflows/ci.yml` 已存在(static: typecheck+syntax+typecheck:api;test: test:unit;secrets),
  但只在 main/master/dev 触发——deploy/feat 分支推送**根本不跑 CI**。
- `harness/harness.config.json` static 梯级已有 10 道检查(含 check:migrations、check:route-census、
  check:route-shadowing、check:auth-order、check:register-deps、check:picking-drift)。
  ci.yml 头注释明确:两边必须同步改,否则"绿 CI 配红 gate"。
- `check:route-census` 语义是**总数只许升不许降**(丢失注册即红;新增打印 +N)。原稿阶段 2
  "只许降不许升"方向写反;阶段 3 "端点总数不变"才是对的。
- 原稿点名的 `_head_server.mjs`、`_server_check.mjs`、`server.js.backup` 已不存在(含明文密码的
  备份此前已删);仅剩 `services/api/_head_check.mjs`(未跟踪)。migrations 295 已提交,296 未跟踪。
- 体积实测:server.js 2614 KB、mesrj.js 617 KB、App.tsx 188 KB、i18n.ts 658 KB、pmc.js 77 KB——与原稿相符。
- `smoke-w12.mjs` 在 `services/api/smoke-w12.mjs`;`humanGates` 真源在
  `services/api/src/virtual-employees/registry.js`,消费方 `agent/runner.js:97`、
  `routes/virtual-employees.js:163`、`capabilities.js`、`service-identity.js:88`;
  `report:ve --report=integrity` 查 `ve_v_line_integrity` 视图(37/37 判据未在本轮复核)。
- 工作区 186 项未提交,且 `codex/receiving-workflow`、`t3/9d9c388c` 两个 worktree 挂在本仓——
  切分支、动共享文件都会波及别的 agent。

## 阶段 0 — 止血(修正版,半天)

| 动作 | 具体做法 | 验收 |
|---|---|---|
| 防错库守卫(替代原改库三动作) | `services/api/src/db.js` 启动自检:连上后查 `current_database()` + 关键表存在性(`public.employees`、`public.inventory_transactions`、`oa.flow_webhook_outbox`),缺任一 → 打出实际库名并 `process.exit(1)`。留 `DB_GUARD_SKIP=1` 逃生口给 harness 空库场景 | 故意把 PGDATABASE 指向 `factory` 能拒绝启动;指向 `smt_factory` 正常起 |
| 推送工作(不切分支) | `git push origin deploy/wms-oa-sync-20261120 feat/material-fetching-consumption-flow`;在两个分支头各打 tag `pre-refactor-20261121-deploy` / `pre-refactor-20261121-feat` 并推送 | 远端两分支 ahead=0,tag 可见 |
| ~~改 .env 到 factory~~ | **取消**——factory 是参考库,改了全系统瘫痪 | — |
| ~~REVOKE smt_factory~~ | **取消**——它是活库;参考库 factory 保持只读用途即可 | — |

回滚:守卫是纯启动检查,删掉即回滚;push/tag 不改工作区。

## 阶段 1 — 仓库减负(1 天)

| 动作 | 细节 | 验收 |
|---|---|---|
| 移出大件 | `services/api/.venv-ocr`(825 MB)移到 `C:\rjvenv\`;`.env` 加 `WMS_OCR_PYTHON=C:\rjvenv\Scripts\python.exe`(现成覆盖点,不改代码);`WMS_OCR_USE_PADDLE=1` 时冒烟一次 OCR | `services/api` 文件数 26268 → ~700;OCR 冒烟通过 |
| scratch 归档 | 仅 `_head_check.mjs` 尚存,移 `scratch/`;`.gitignore` 补 `scratch/`、`*.backup`、根目录 `*.png`、`*.log`、`dist*.tgz`(venv/node_modules 已有规则,勿重复) | `git status --porcelain` 计数下降 |
| 拆分未提交项 | 186 项按归属分提交:① 业务代码 ② migrations 296(295 已提交)③ docs/测试;别的 agent 的改动**不碰**(用 locks/CLAIM 与 mailbox 对账) | 每个提交单独 `npm run typecheck` 通过 |

禁止:`git add -A`、`git clean`、`git reset --hard`、切分支(worktree 里有并行 agent)。

## 阶段 2 — 可信度检查(1 天,做完再动代码)

**不新建 verify.yml**——扩展现有 `ci.yml`,并同步 `harness/harness.config.json` static 梯级(其头注释的约定):

1. 触发分支加 `deploy/**`、`feat/**`(至少当前两条工作分支),否则推了也不跑。
2. static  jobs 补齐 gate 已有而 CI 缺的:`check:migrations`、`check:route-census`、
   `check:route-shadowing`、`check:auth-order`、`check:register-deps`、`check:i18n`、`check:picking-drift`
   (全部 db-free 或 db-absent 时自跳过,可在 ubuntu runner 跑)。
3. 方向修正:route-census **总数不许降**;route-shadowing / auth-order / migrations 沿用既有基线语义。
   原稿"i18n/shadowing 先 warn 30 天"不采纳——它们在本地 gate 已是硬检查,CI 降级会造成本地红 CI 绿。
4. 本地 `.git/hooks/pre-push` 跑同一组(hook 不进版本库,另存 `scripts/hooks/pre-push` + 安装说明)。

验收:故意改坏一个类型,CI 红;恢复后绿。在本工作分支上验证触发,不只在 main。

**执行状态(2026-11-21 晚,已完成)**:上述 1–4 全部落地并推送(提交 41db6bc)。
首次远端运行即红——红的不是新检查,而是**仓库本来就不能从干净克隆通过 typecheck**:
`**/reports/` 忽略规则把被已提交代码 import 的源码目录挡在 git 外;8320645 等提交只交了
消费端(App.tsx / wms/index.ts 的 export),生产端(mesrj groups、6 张 WMS  graft 页、
reports/ 目录)留在工作区未提交;bwip-js 锁 4.6.0 缺 `padding` 类型。已按归属分 5 个提交
补齐(f1023b1、f71eff7、43b72ca、2db4df3、b1d6677),本地全组绿后**经 pre-push 钩子全量
验证推送**(不再 SKIP)。这证明 CI 扩展第一天就抓住了它该抓的东西。
遗留:`typecheck:api` 基线 595 → 实测 590(live-sync  lane 修掉了自己的 6 个错),
降基线是人工决定,未动。

## 阶段 3 — server.js 拆分(6 轮,每轮半天)

方法"搬迁而非复制"保留;每轮固定四步保留;独立提交保留。修正:

- **分支策略**:原稿"每轮独立分支"与现状冲突(本检出 186 项脏 + 两个挂靠 worktree,切分支即事故)。
  改为:在 `deploy/wms-oa-sync-20261120` 上每轮单独提交;需要隔离时用 `git worktree add` 新目录,不动本检出。
- 轮次表照旧(mesrj → WMS(SMT 仓内 wms-* 模块) → station → PMC/BOM → QMS/MRB → finance/auth/admin),
  完成判据"端点总数不变、server.js 体积下降"与 census 语义一致。
  **冻结区(红线)**:`live-sync.js`、`mes-sync.js`、`src/mesrj/itf/`、`src/oa/`、
  `oa-integration.js` 不进搬迁清单;每轮冒烟须含一次同步通道健康检查
  (`v_integration_app_health` / itf ping),证明拉取与回写队列未受影响。
- 冒烟底版用 `services/api/smoke-w12.mjs`(路径修正),扩成表驱动;认证态判定遵守
  AGENTS.md:200=执行、403=守卫、404 不证明注册(SPA catch-all 对未知路径回 200)。
- 每轮跑 gate static 全组(阶段 2 后 CI 同组),基线只降不升的对象是 **server.js 体积**;
  census 总数是**只升不降**,两个方向别混。
- 挂载位置是 auth 语义的一部分:搬动 `authenticateJWT` 相关代码前先枚举其内部公开路径清单。

## 阶段 4 — 前端解单文件(3 轮,各半天)

照原稿:registry 抽取 → 模块懒加载 → i18n 按域切 namespace。React 18.3.1 / Vite 5.4.21 不动。
验收 `npm run build` + Playwright 既有基线(注意 e2e 需 5178 活站 + 种子库;24 页扫描以现有
tests/e2e 与 procurement-ui-smoke 为准,不新造基线)。

## 阶段 5 — 人工门分级(1 天)

三档(可批量/逐条必看/双人复核)照原稿。落点修正:`humanGates` 定义在
`src/virtual-employees/registry.js`,服务端拒绝点在 `routes/virtual-employees.js`(现有
gate 校验 L163 旁)与 `agent/runner.js:97`;审计 `bulk_size` 字段需新迁移(取下一空号,
当前最高 391,勿用已碰撞的 31x)。验收命令 `approve:ve` / `report:ve` 均存在,照用。

## 阶段 6 — 三真源合一(2 天,最后做)

照原稿:registry.js 唯一输入,生成迁移种子(324 已存在,增量用新号)、ORGANIZATION.md 逐岗表、
能力契约校验输入。判据 `report:ve -- --report=integrity` 恒绿(37/37 以当轮实测为准,不写死)。

## 总投入与取舍

原稿工时表保留。"只有一天"路径修正为:**推两分支 + 打 tag + db.js 防错库守卫 + 移 venv**。
不做:一次性重构 server.js、给虚拟员工开写权限、升级 React/Vite、扩编 44 岗以上、
**以及任何把运行库从 smt_factory 挪走的动作**。