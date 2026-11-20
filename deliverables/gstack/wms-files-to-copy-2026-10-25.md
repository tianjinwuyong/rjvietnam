# WMS 服务器需要拷贝的文件清单

> 目标：让 OA 与 WMS 的电子流对接跑通，并恢复 OA 缺失的流程定义 30/31/34–40。
> 来源：`192.168.6.160` 的 `D:\WMS-20261019\`
> 目的地：这台 OA 机器 `D:\wms-src\`（按原结构放，或压成 zip）

---

## 一、必拷（最小集）
| 路径 | 用途 |
|---|---|
| `.env` | OA 对接完整参数（OA_BASE_URL / OA_API_KEY / OA_WEBHOOK_SECRET / 各 DEF_ID） |
| `server\`（排除 `node_modules`） | WMS 后端源码：OA 回调路由、oa_event_outbox、状态机 |
| `db_migration_oa_event_outbox.sql` | OA 事件 outbox 表结构 |
| `db_migration_oa_iqc.sql` | IQC 集成表结构 |
| `deliverables\` | 交付物，可能含流程定义/接口文档 |
| `docs\` + 根目录 `*.md` | 部署方案、修复报告、取数说明 |

## 二、关键：旧 OA 的流程定义（决定能否精确还原 30–40）
- 先检查 `backups\`、`db-backup\`：找文件名含 `oa` / `flow` / 日期的 dump。
- 若旧 OA 仍可连，导出这一张表：
  ```sql
  \copy (SELECT * FROM flow_definition WHERE id IN (30,31,34,35,36,37,38,39,40)) TO 'flow_defs.csv' CSV HEADER
  ```
- 有 CSV/dump → 精确恢复，不猜业务。

## 三、可拷可不拷
- `drizzle\`、`drizzle.config.ts`、`package.json`
- `patch\`、`scripts\`

## 四、不要拷
- `node_modules\`、`dist\`、`client\`、`logs\`

## 五、拷到哪
```
D:\wms-src\
├─ .env
├─ server\
├─ drizzle\
├─ deliverables\
├─ backups\        ← 若有
├─ db-backup\      ← 若有
├─ docs\
├─ patch\
├─ scripts\
├─ db_migration_oa_event_outbox.sql
├─ db_migration_oa_iqc.sql
├─ package.json
├─ drizzle.config.ts
└─ *.md
```
或：整包压缩为 `wms-20261019.zip` 放到 `D:\wms-src\`。

## 六、拿到后我会做
1. 核对 `.env` 与 OA 的 API Key / Secret；
2. 从 `deliverables\` 或旧 OA 导出中恢复流程定义 30/31/34–40；
3. 登记 API Key 到 `sys_api_key`，建专用非管理员服务账号；
4. 用真实请求跑通「WMS 提交 → OA 审批 → 回调」闭环；
5. 按之前方案补对账任务（防回调丢失）。
