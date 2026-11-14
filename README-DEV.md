# WMS 开发包说明（2026-11-12）

本包是 `D:\WMS-20261019` 的**完整开发副本**，拿到另一台 Windows 电脑后可直接作为 WorkBuddy 工作目录打开继续开发。

---

## 1. 环境要求

| 组件 | 版本 | 说明 |
|---|---|---|
| Node.js | **v22.22.2**（建议同版本） | 包内已带 `node_modules/`，可直接跑；换大版本可能需要重装依赖 |
| npm | 10.x | 与 Node 22 自带一致 |
| PostgreSQL | **18**（本机为 18 端口 5432） | 数据库结构见 `drizzle/` 与 `db_migration_*.sql` |
| 操作系统 | Windows 10/11 | 生产环境用 NSSM 托管为服务 |

---

## 2. 目录结构

```
WMS-20261019/
├── server/              NestJS 后端源码（23 个业务模块）
├── client/              React + Vite + shadcn/ui 前端源码（109 个页面）
├── shared/              前后端共享类型 api.interface.ts
├── scripts/             初始化、工具脚本
├── drizzle/             ORM schema 与迁移
├── db_migration_*.sql   增量迁移脚本（按日期执行）
├── dist/                已构建产物（server 为 dist/*.js，前端为 dist/client）
├── node_modules/        依赖（已安装，697 MB，离线可跑）
├── ssl/                 HTTPS 证书（wms-cert.pfx / .crt）
├── db-backup/           数据库备份（.dump / .sql）
├── backups/             历史备份
├── docs/  deliverables/ 设计与交付文档
├── .git/                Git 仓库（含提交历史，但本机未配置远程）
└── .env                 环境变量（数据库、JWT、MES 等，含明文口令，注意保管）
```

---

## 3. 首次启动

```powershell
# 1) 依赖（包内已带 node_modules，可跳过；换机器后如有异常再执行）
npm install

# 2) 数据库：新建空库后还原（二选一）
#    a. 自定义格式（推荐）
& "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" -h localhost -U postgres -d wms --no-owner --no-privileges db-backup\wms-20261111.dump
#    b. 纯 SQL
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h localhost -U postgres -d wms -f db-backup\wms_full_20261111.sql

# 3) 改 .env 里的 DB_PASSWORD / DB_HOST 指向本机数据库

# 4) 开发模式（前后端一起，热更新）
npm run dev

# 5) 生产模式（先构建，再用 dist 启动）
npm run build
npm start
```

默认端口：HTTP `3000`，HTTPS `3443`（`HTTPS_PORT` 环境变量可覆盖）。

---

## 4. 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 前后端并行开发（Nest watch + Vite） |
| `npm run build` | 构建 server（SWC）+ client（Vite） |
| `npm run type:check` | 前后端类型检查（注：`schema-append.ts`、`hr/sales.service.ts` 存在历史类型告警，不影响构建） |
| `npm run init-db` | 初始化数据库结构 |
| `npm start` | 以 `dist/main.js` 启动生产服务 |

> 构建用的是 SWC（`nest build`），不阻塞于上述历史类型告警。

---

## 5. 本次改动要点（重要）

**IQC 检验报告模板「保存失败」修复 + 版本化**（2026-11-12）

- 根因：`saveItems()` 原为「全删再重建」，而 `iqc_inspection_record.template_item_id` 外键引用模板项目行，
  删除触发 PostgreSQL 23503，接口 500。
- 方案：`iqc_template_item` 增加 `deleted_at`，保存改为 diff（update / insert / 归档），模板 `version` 递增。
- 涉及文件：
  - `db_migration_iqc_template_item_version_20261112.sql`（新增列 + 部分索引）
  - `server/database/schema.ts`（新增 `deletedAt`）
  - `server/modules/iqc/iqc-template.service.ts`（`saveItems` / 查询过滤 / `importSectionFromStandard`）
  - `server/modules/iqc/iqc.controller.ts`（返回 `{version, updated, created, archived}`）
  - `client/src/api/iqc.ts`、`client/src/pages/iqc/IqcTemplateItemsDialog.tsx`、`client/src/pages/iqc/IqcTemplate.tsx`

新环境部署时，**必须先执行该 SQL 迁移**，否则保存模板仍会失败。

---

## 6. 注意事项

1. **`.env` 含明文数据库口令与 JWT 密钥**，不要提交到公共仓库、不要随手外发。
2. **`.git` 没有远程仓库**，历史只在本包内；建议到达新机器后先 `git log` 确认，并尽快推送内网 Git。
3. 包内 `node_modules/` 是针对 Windows + Node 22 安装的；若目标机架构/版本不同，执行 `npm install` 重建。
4. `logs/`、`installer/`、`.tmp-edge-profile/` 未打进包：日志无迁移价值，installer 是 271 MB 的打包产物，浏览器缓存目录为临时数据。
5. 若目标机也要跑生产服务，参照 `DEPLOY-README.md` 用 NSSM 注册服务，并放行 3000 / 3443 端口。
