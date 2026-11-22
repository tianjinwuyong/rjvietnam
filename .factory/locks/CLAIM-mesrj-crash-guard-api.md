# CLAIM: mesrj 泛型路由 bigint 崩溃止血 + station_types status 列

- Agent: omp (this session, Main)
- Date: 2026-11-23
- Lane: api

## 背景
运行中的 API 日志（api-8080 死前最后 1h21m）反复出现：
- `Unhandled error: 无效的类型 bigint 输入语法: "list"/"stats"/"summary"/"items"/"board"/"pending"` @ `src/routes/mesrj.js:387`（GET /:name/:rid 把字面量后缀当 id 塞进 `WHERE id=$1`）
- `Unhandled error: ... "NaN"` @ `src/mesrj/report-tpl.js:249`（getTpl(Number(...)) 非数字时 NaN 直进 bigint 参数）
- `GET /mes/station-types: 字段 "status" 不存在`（server.js SELECT/RETURNING 用了表里没有的列）

## 范围（只此三处，均为纯增量守卫/补列）
- services/api/src/routes/mesrj.js — registerCrud 的 GET/PUT /:name/:rid 加数字校验（非数字 → 404，不再 500）
- services/api/src/mesrj/report-tpl.js — getTpl 非数字 id 直接返回 null
- database/migrations/398_station_types_status.sql — 新建：station_types 补 status 列（默认 'active'，DELETE 软删本就用它）

## 不碰
- mesrj.js 的其余路由/域文件（opencode 的 CLAIM-mesrj-delta-sync-api 仍在进行，mesrj/domain.js、sn-prefix.js 有未提交改动）
- apps/web/**、server.js 其它段落

## 协调
mailbox redis 不可用（10061），无法直接通知 opencode；改动为向后兼容的守卫，与其增量（新端点/新域）无重叠。
