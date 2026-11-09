# 受控文件评审：流程详情页看不到正文 —— 根因与修复（2026-11-04）

实例：`DOC_CONTROLLED_ISSUE-20261104-000013`（id 14857）· DT-MM-001 V1.0 · 当前节点「体系工程师核格式并确定会签人」· 审批人 RJCN004 孙杨明

## 1. 结论（先说）

**不是权限问题，也不是接口没做，而是入口按钮渲染出来等于不存在。**

`app/web/dist/oa-doc-review-drawer.js` 的 `mountFlowFab()` 创建浮动按钮时**漏调 `ensureStyle()`**，
按钮以浏览器默认样式（白底、`position:static`、25px 高）被 `appendChild` 到 `body` 末尾 ——
在 900px 视口下它的坐标是 `y=900`，也就是**正好在可视区外**。用户截图最底下露出的那半个
「待评审文件」就是它。点不到，自然"看不到正文"。

实测（修复前，CDP 探针）：

```
hasFab: true
fab.text   : 受审文件
fab.rect   : { x: 0, y: 900, w: 69, h: 25 }      ← 视口高 900，整块在屏幕外
fab.pos    : static                              ← 本该是 fixed
fab.bg     : rgb(240,240,240)                    ← 本该是 #2563eb
styleBlock : false                               ← 样式表根本没注入
```

同一时刻后端是正常的：RJCN004 调 `GET /api/instances/14857/doc-review` 返回 **200**，
`doc-content?lang=zh` 返回 717KB 正文。

## 2. 改了什么（只改前端一个文件）

| # | 改动 | 说明 |
|---|------|------|
| 1 | `mountFlowFab()` 补 `ensureStyle()` | **根因修复**。样式表注入后按钮才是右下角蓝色/橙色胶囊 |
| 2 | 新增**表单卡片正上方横幅** | 「受审文件：DT-MM-001 质量·环境·职业健康安全·有害物质管理手册 / 评审版本 V1.0 · 一级（管理手册）」+ 蓝色「阅读文件正文」。当前用户有待办时整条变橙并加一行「本单待您处理，请先阅读文件正文再决定是否通过」 |
| 3 | 抽屉打开即自动加载正文 | 原来还要在抽屉里再点一次「阅读全文」，等于二次隐藏 |
| 4 | 正文 iframe 高度封顶 `视口高-300` 内滚 | 整本手册 10 万 px，撑开会把「评审过程」推到很远 |
| 5 | `placeFab()` 按 `.oa-action-bar` 实际位置避让 | 原来固定 `bottom:96px`，矮窗口会压住「通过」 |
| 6 | `humanizeAssign()` | 评审过程里 `dept_leader:QA` 这类引擎表达式翻成「部门负责人（QA）」 |

入口逻辑不变：横幅/FAB 都先探测 `/api/instances/:id/doc-review`，非受控文件单据、非参与人一律不挂。

## 3. 验证（真浏览器 + 真实身份）

用 CDP 起了 headless Edge，以 **RJCN004 本人**（临时 session，验完即删）打开 `/flow/detail/14857`：

| 验收项 | 结果 |
|---|---|
| 横幅 | 出现，`pending` 态（橙色），文案含「本单待您处理…」 |
| FAB | 右下角橙色「待评审文件」，`position:fixed`，与「通过」按钮无重叠（900 / 700 两种视口都测） |
| 点「阅读文件正文」 | 抽屉打开，标题 `DT-MM-001 质量·环境·职业健康安全·有害物质管理手册`，副标题「评审版本 V1.0 · 受控文件评审」 |
| 抽屉正文 | iframe 文本 **162,380 字符**，首句「受控文件 CONTROLLED COPY DT-MM-001 Rev. 1.0…」— 与库里 `doc_version_lang.content` 完全一致 |
| 评审过程 | 5 个节点全部渲染，第 1 节点显示「孙杨明（工程师 · 质量管理部）待处理」 |
| 元信息 | 文件编号 / 评审版本 / 级别 / 密级 / 编制 Lý Trung Thuận 李忠顺 / 责任部门 质量管理部 / 状态 评审中 |
| 越权 | 非参与人（RJCN001）调 doc-review 与 doc-content 均 **403** |
| 回归 | 非文档流程（near_miss id 14656）**无横幅、无 FAB**；控制台无异常 |

## 4. 部署与回滚

- 改动文件：`app/web/dist/oa-doc-review-drawer.js`（`index.html` 引用升到 `?v=6`）
- **刷新即生效，不需要重启服务**
- 回滚：`app/web/dist/oa-doc-review-drawer.js.bak-entry-20261104`

## 5. 复现脚手架

`app/server/scripts/_qa_tmp/`
- `qa-doc-review-entry2.mjs <token> [instanceId] [--no-click]` —— 横幅/FAB 尺寸、点开抽屉、量正文长度、出截图
- `qa-doc-review-entry.mjs <token> [instanceId]` —— 只看入口存在性与计算样式（定位本次根因用的就是它）
- `qa-bar-probe.mjs <token>` —— 量 `.oa-action-bar` 与 FAB 是否重叠
- `qa-mk-session.mjs <uid> create|cleanup` —— 临时会话，不给真实用户改密码；**用完必须 cleanup**

## 6. 遗留

- 审批时没有"未读即拦"的硬约束：现在只是横幅提示 + 橙色高亮，仍可直接点「通过」。要真正卡住 ISO 7.5.2，可在点「通过」时判断本实例是否已打开过正文，未读则弹确认框（需后端记录阅读痕迹，例如写 `doc_issue_read`）。
- 中文/越文双语文件目前默认中文，可在抽屉里切换；若评审人只懂越语，可考虑按 `X-OA-Lang` 默认语言。
