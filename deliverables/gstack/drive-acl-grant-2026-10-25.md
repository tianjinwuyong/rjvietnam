# 公共盘权限「可授权」变更说明

**日期**：2026-10-25
**场景**：功能开发（公共盘文件/文件夹权限 · 委派授权）
**参与**：主理人（单工程师执行）

---

## 📌 TL;DR
- 已实现「**可授权**」能力：对某文件夹拥有全部权限的普通用户，可在该文件夹及其子树内把权限授予他人。
- 数据库已迁移、后端逻辑已改并**通过 7 项隔离测试**（含防提权、级联撤销）。
- ⚠️ **后端需管理员重启服务才生效**（当前进程无管理员权限，无法自动重启）。
- ⚠️ 该 UI 落在**新前端**（路径 D）；老 `dist` 无此选项，需新前端上线或临时补丁。

---

## 1. 设计决策（团队专业口径）
| 问题 | 决定 |
|---|---|
| 「全部权限」判定 | 5 项全勾（只读/编辑更新/上传/删除/新建子文件夹） |
| 「可授权」字段 | 独立 `can_grant`；5 项全勾时默认自动可授权，可手动取消 |
| 向后兼容 | 旧前端不传 `canGrant` 时，若 5 项全勾则自动置 true |
| 授权范围 | 当前文件夹 + 其整棵子树（含文件，文件继承文件夹 ACL） |
| 级联撤销 | 撤销 B 时，B 在子树内转授给 C 的权限一并失效（递归追溯 `granted_by`） |
| 防提权 | 非所有者只能授出自己拥有的能力；只能改/撤自己授予的记录 |
| 授权对象 | 仅个人用户；排除 owner、admin、自己 |
| 审计 | `acl_grant` / `acl_update` / `acl_remove` 写入公共盘审计日志 |

## 2. 变更清单
### 2.1 数据库
- 新增 `app/server/sql/85_drive_acl_grant.sql`
  - `drive_acl` 增加 `can_grant BOOLEAN DEFAULT FALSE`
  - 存量回填：5 项全为 true 的行 → `can_grant = TRUE`
  - 新增索引 `idx_drive_acl_granted_by`（级联撤销用）
- 已执行（事务内），当前 `drive_acl` 无存量数据。

### 2.2 后端（`app/server/src/services/drive-service.js`）
- `effectiveAcl`：返回 `canGrant`（admin/owner=true；ACL 行取 `can_grant`；继承传递）。
- `listFolder`：`perm` 增加 `canGrant`，供前端判断是否显示「权限管理」。
- `listAcl`：准入从「owner/admin」扩展为「owner/admin 或 canGrant」；返回 `isOwner/canGrant/manageable`。
- `setAcl`：支持 `canGrant`；全 5 项自动可授权；防提权校验；只能改自己授予的记录；审计。
- `removeAcl`：支持委派者撤销自己授予的记录；触发级联撤销；审计。
- 新增 `cascadeRevoke`：递归删除子树内 `granted_by` 命中的授权行。
- 已备份：`drive-service.js.bak-2026-10-25`

### 2.3 前端（`oa-web`，路径 D）
- `src/api/drive.js`：公共盘接口封装。
- `src/views/drive/DriveView.vue`：文件夹浏览 + 权限管理对话框（第 6 个选项「可授权」+ 表格列 + 授权人列）。
- `src/i18n/{zh,vi,en}.js`：新增 `drive.*` 三语词条。
- `src/router/index.js`：`/drive` 指向真实页面（其余仍占位）。

## 3. 测试结果（隔离测试，直接调用 service 层）
```
✓ 全部 5 项 → 自动 can_grant=true
✓ B 的有效 canGrant=true
✓ B 成功给 C 授权（只读）
✓ 防提权：D 不能授出自己不拥有的上传权限
✓ 撤销 B 后 B 权限消失
✓ 级联撤销：C 的权限随之消失
✓ B 被撤销后失去权限管理权（403）
结果: 7/7 通过
```
前端 `npm run build` 通过（1692 modules）。

## 4. 生效步骤（**需管理员**）
后端代码改动需重启服务加载：
```bat
net stop "OA"
net start "OA"
```
或双击 `安装目录\tools\04-重启服务.bat`（以管理员身份）。
重启后验证：`curl http://127.0.0.1:8080/api/health` 返回 `{"status":"ok"}`。

## 5. 回滚
- 后端：用 `drive-service.js.bak-2026-10-25` 覆盖回 `drive-service.js`，重启服务。
- 数据库：`can_grant` 列保留无害；如需回滚 `ALTER TABLE drive_acl DROP COLUMN can_grant;`。

## 6. 已知限制 / 下一步
- **老前端 dist 不会出现「可授权」选项**（压缩产物，无源码）。要上线有两个选择：
  1. 随新前端（路径 D）该模块上线（推荐，长期正解）；
  2. 立即在线上可见：对老 dist 做运行时补丁（注入勾选框 + 拦截 ACL 请求），可行但脆弱、不建议长期。
- 文件级独立 ACL 未实现：现阶段「给文件授权」= 给其所在文件夹授权。
- 按部门/角色的 ACL 仍保留在后端，但本次 UI 仅提供按用户授权。

---

> 本变更由 AI 工程协作生成；生产重启请在业务低峰进行。
