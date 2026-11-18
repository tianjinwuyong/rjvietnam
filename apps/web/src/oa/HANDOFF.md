# OA 原生重写 — 交接文档（2026-11-18）

分支：`feat/material-fetching-consumption-flow`（全部已推送）

## 已完成（全部 E2E 验证通过）

| 阶段 | 内容 | Commit |
|---|---|---|
| Phase 1 | DB 合并（oa schema 174 表）、API 同源、单 JWT、去 iframe | `468af04` `2483e92` |
| Phase 2 | FlowForm（form_schema 渲染）+ InstanceDetail（审批/抄送/附件/撤回催办终止） | `79e81ba` |
| Phase 3 | 通知通告（全量 CRUD+已读回执）+ 组织架构只读 + 二级侧边栏全量菜单 | `9fd7f45` `1beebb0` |
| Phase 4 | 体系文件 7 页：文档库/详情/新建（7 类分类+自动取号）/台账 7 类/发放回收/作废/外来 | `522e2b8` |
| Phase 5 | 公共盘：文件浏览/上传下载/ACL 权限面板/搜索/回收站/审计日志 | `526ad1c` |
| Phase 6 | 知识共享：列表/上传审批/版本链/历史 | `3d80959` |
| Wave A | 流程台账（34 流程）/流程版本（发布回滚）/自定义字段 + 设备 5 页 | `48d8e90` |
| Wave B | 人事 14 页：考勤/卡规则/工作日历/排班/薪资/模板/绩效/培训/考试/交接/会议×4 | `7fca6f1` |
| Wave C | 品质 7 页：IQC/MRB/巡线记录/首件记录/点检记录/出货检验/检验模板库 | `6a78492` |
| 收尾 | 系统设置（改密码/语言偏好） | `2bbb380` |

侧边栏建设中项从 50+ 降到 **6 个**（见下）。

## 剩余 6 个建设中项（均为复杂表单/设计器，建议按此顺序做）

1. **流程设计**（menu.flowDesign，adminOnly）— 可视化流程设计器，词典 `designExtra` 109 键。后端 `PUT /api/flows/:id/config`、`POST /api/flows`（flow.js）。工作量最大。
2. **巡线提报**（ipqcMod.fillTitle）— IPQC 填写：选产线/班次/日期 + 模板逐项 OK/NG。`POST /api/ipqc/records`，模板 `GET /api/ipqc/templates`。参考 `ipqc-service.js`。
3. **首件提报**（faiMod.fillTitle）— 同构 IPQC。`POST /api/fai/records`。
4. **点检填写**（inspectRt.fillTitle）— 设备点检任务执行。`GET /api/equipment/tasks`（type=inspect）+ 模板，见 `equipTask.*` 词典（execute/pickTemplate/useTpl 等键已备）。
5. **会议发起**（menu.meetingCreate）— 会议表单（基本信息/参会人/议程）。`POST /api/meeting`，`meeting.*` 词典 252 键已备。
6. **组织导入**（menu.orgImport）— Excel 导入向导。`org-import-service.js`，`orgImport.*` 63 键已备。

## 关键模式（新页面照抄即可）

- 通用列表：`apps/web/src/oa/OaGeneric.tsx` → `GenericListPage`（url+columns，容错数组/{list}）
- 视图注册：`menu.ts`（OaViewId + OA_MENU 挂 view）→ `index.tsx`（路由三元链）
- API 客户端：`oaApi.ts`（apiClient.get/post/put/delete + envelope 已剥）
- i18n：`t(key, locale, params)`，词典 `i18n/{zh,en,vi}.json` 单行 JSON（字符串手术追加，勿整写）
- 台账双语列：后端返回 {columns[label,label_vi], rows}，前端按 locale 选表头（见 DocLedger.tsx / SysView.tsx）

## 环境坑（本轮实测）

- **8080/5178 曾被其他 agent 弄挂**：12:30 有 agent 从仓库根目录起了 Vite（`/` 404）+ 多个 server.js 互抢后全灭。修复：杀僵尸 PID，`node services/api/server.js`（后台）+ 从 `apps/web` 目录起 Vite（vite.js 必须用仓库根 node_modules 的绝对路径）。当前两个服务以后台 shell 运行。
- Playwright 选择器必须 scope 到 `.oa-module`（SMT 顶栏语言 select 干扰）。
- `page.on('dialog')` 对 prompt 要 `d.accept(text)` 注入文本，空串会触发前端"请输入"校验。
- `GET /api/drive/audit` 返回 `{list,total,page,pageSize}` 分页对象不是数组。
- 其他 agent 正在改 `wms/`、`App.tsx`、`i18n.ts`（typecheck 目前因他们的 WIP 报错，oa/ 文件全净）；单写者规则，勿动他们的文件。
