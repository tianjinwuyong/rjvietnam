# 近10天工作成绩总结（2026-09-01 – 2026-09-10）

- 分支：`feat/material-fetching-consumption-flow`
- 范围：25+ commits，两个大功能提交 + 一批中小提交 + PDA 联调（进行中）

## 1. 供应商协同门户（9/1）

- 供应商门户 PO 与交货协同（`911c11f`）、远程 HTTP 部署支持（`98d23d1`）
- 供应商 PO 调整采购审批（`5d924bc`）
- 外箱/子箱层级 QR 打印（`4fb371c`）+ 收货层级管理（`31dc859`）
- 打印标签同步为未确认预收货（`dd20d61`）、箱标签绑定隐藏预收托盘（`5166035`）
- 供应商执行看板 + MES QR 集成（`5a81357`）

## 2. 采购 / OA / 虚拟员工 / 网关（9/3，约15 commits）

- 采购门户 PO 虚拟员工（`d42008f`）、采购工作流（portal + 微信消息，`c9ba117`）
- Hermes 督导 + 安全库存报表（`eb0d3d2`）、安全上架库位推荐（`5093f8c`）
- 仓库物理层级建模（`6d2cd31`）、兼容老 storage location schema（`e2274e0`）
- IQC 虚拟员工 runtime（`9be322b`）、文档路由（`5703d5a`）、供应商快捷登录代理（`27178fc`）
- 年度供应商 workbook 导入（`14aa921`）+ 可编辑查看器（`722343a`）
- auth 路由挂载修复（`014f350`）、OA 虚拟员工审批管控（`153c1d8`）
- WMS 183 网关故障转移部署（`210afc0`）、PDA 网关切到管理 122（Tailscale，`fab6b46`）

## 3. 领料-消耗闭环 + 库存台账化（9/7，`4411c74`，96 文件 +17117/−1717）

- 可点击领料流程图 `WmsMaterialFetchFlow`，节点跳转各 WMS 页面；Picking/Issue 嵌入并透传工单号
- `/wms/stock` 改从 `inventory_transactions` 台账推导 qty/availableQty，发料/领料扣减实时反映
- `WmsLocationManagement` 大改（约 5857 行）、IQC/MSD/PDA 系列页面同步
- 收料/IQC-MRB/OA/MSD 等流程的 archify + visual-check 产物

## 4. 低库存预警 + 看板权威同步（9/10，`55414c7`，29 文件 +4778/−225，已 push）

- `material_lots.low_stock_level`（migration 268）+ PATCH `/wms/material-lots/:id/low-stock-level`
- 物料主数据：点击库存数设预警线、低库存红闪、发料列；库存全部走台账
- Canvas 保存改为权威同步：画布删掉的对象/position QR/楼层区同步硬删除；删掉 FL-* 种子防复活
- 新增 `WmsSlips`（821 行）、`WmsWoHandover`、PDA 应用目录管理、management 角色补考勤/请假/部门权限

## 5. 进行中（未提交，`server.js` + `WmsIqcFlowPages.tsx`，+179/−37）

- PDA 只解析 QR 片段、传裸码；WMS 侧做供应商代码→`suppliers` 表、瑞晶↔越南料号映射
- IQC FAIL → NG 位顺序重绑（`NG P01-01` 起逐箱递增）
- pre-IQC 单删 + 全部删接口，前端 删除/全部删除按钮
- PDA 相机冷却重写中：修 bind 期间见到的箱码被毒化 10s 不触发；dup 改纯警告（无锁、3s 自动继续+大绿按钮）

## 待收尾

1. BarcodeScanner 新冷却逻辑装机验证（PDA + MuMu + 手机）
2. pre-IQC“彻底删除”补 `wms_receiving_qr_registrations` 清理
3. 把 server.js / IqcFlowPages 改动 commit + push（自 `55414c7` 后未提交）
4. 收→IQC→NG→collect→pick 全链路重测一遍
