# WMS 自启动与值守部署说明

针对「断电重启后系统不会自动恢复」以及「服务异常终止后无人拉起」两类问题。

---

## 一、两套方案，按权限选择

| | 登录自启 + 进程守护 | Windows 服务 |
|---|---|---|
| 入口 | `installer\service\startup-deploy.cjs install` | `installer\service\install-autostart.cmd` |
| 权限 | 普通用户即可 | **需要管理员** |
| 触发时机 | 用户登录后 | 开机即启动，无需登录 |
| 守护粒度 | 进程退出 → 6 秒内重建 | 进程退出 → 5 秒内重建 |
| 适用 | 机器会自动登录桌面 | 无人值守、要求开机即用 |

**当前机器已部署：登录自启 + 进程守护**（见第五节）。

---

## 二、登录自启 + 进程守护（免管理员）

### 组成

```
启动文件夹\WMS-Guardian.vbs        登录时由 wscript 静默运行，循环拉起守护器
  └─ wms-guardian.cjs              守护 PostgreSQL 与 WMS 应用
       ├─ pg_ctl start -D ...      数据库（5433）
       └─ node dist/main.js        应用（3000 / 3443）
```

三层兜底：VBS 盯着守护器 → 守护器盯着两个进程 → 进程退出 6 秒内重建。

### 关键设计

- **不重复启动**：端口已在监听就视为健康，可安全接管手工启动的实例；
- **断电残留处理**：自动检测 `postmaster.pid` 里记录的 PID 是否存活，不存在则清理后再启动；
- **单实例锁**：守护器占用本地端口 38017，重复启动会自动退出；
- **崩溃退避**：连续失败时按 3→6→12→24 秒退避，不会打满 CPU；
- **路径编码**：VBS 本体为纯 ASCII，中文路径从 `%LOCALAPPDATA%\WMS\guardian.txt`（UTF-16LE）读取，规避 VBScript 按 ANSI 解析导致的中文乱码。

### 命令

```cmd
cd installer\service
..\..\runtime\node\node.exe startup-deploy.cjs install     部署并立即启动
..\..\runtime\node\node.exe startup-deploy.cjs status      查看部署状态
..\..\runtime\node\node.exe startup-deploy.cjs uninstall   移除
```

或直接双击项目根目录：`启动值守.cmd`、`服务状态.cmd`

---

## 三、Windows 服务（需管理员）

```cmd
installer\service\install-autostart.cmd
```

注册三个服务：

| 服务名 | 账户 | 说明 |
|---|---|---|
| `WMS-PostgreSQL` | `NT AUTHORITY\NetworkService` | `pg_ctl register` 注册 |
| `WMS-App` | `LocalSystem` | NSSM 托管 `node dist/main.js` |
| `WMS-Health` | `LocalSystem` | NSSM 托管健康探针，20 秒一轮 |

配置要点：

- **PostgreSQL 必须以非管理员账户运行**（PG 硬性限制，用 SYSTEM 会拒绝启动），故沿用本机 5432 实例的 `NetworkService` 账户；
- **NSSM 部署到 `C:\ProgramData\WMS\bin`**（无空格路径），避免服务 `binPath` 的引号转义问题；
- 双层重启：NSSM 的 `AppExit Restart`（5 秒）+ SCM 失败恢复（5s→15s→60s）；
- 依赖顺序：应用等数据库就绪，健康值守最后启动；
- 安装成功后会删除登录自启文件并写入 `runtime/service-mode.flag`，防止两套守护抢同一端口；
- 卸载：`installer\service\uninstall-autostart.cmd`（加 `--keep-running` 可在卸载后保持业务运行）。

---

## 四、运维命令

```cmd
installer\service\wmsctl.cmd status          服务/端口/守护状态总览
installer\service\wmsctl.cmd doctor          深度自检（含数据库真实查询）
installer\service\wmsctl.cmd test            自愈实测：强制杀进程，计量恢复耗时
installer\service\wmsctl.cmd logs guardian   守护器日志
installer\service\wmsctl.cmd logs error      应用错误日志
installer\service\wmsctl.cmd start|stop|restart
```

日志目录：`runtime\logs\`

| 文件 | 内容 |
|---|---|
| `guardian.log` | 守护器启停与自愈记录 |
| `health.log` | 服务模式健康探针记录 |
| `app.log` / `app-error.log` | 应用标准输出与错误（服务模式） |
| `app-console.log` | 应用控制台输出（守护器模式） |
| `pg-server.log` | 数据库启动日志 |

---

## 五、当前机器的实际状态

已完成（2026-11-14）：

- 独立 Node 运行时 `runtime\node\node.exe`（v22.22.2，与验证版本一致，不依赖 WorkBuddy 目录）
- 登录自启：`启动` 文件夹已放入 `WMS-Guardian.vbs`
- 路径配置：`%LOCALAPPDATA%\WMS\guardian.txt`
- 守护器运行中，占用锁端口 38017

实测结果：

| 场景 | 结果 |
|---|---|
| 强制结束应用进程 | 3 秒内自动拉起，HTTP/HTTPS 均恢复 200 |
| 强制结束数据库进程（模拟断电崩溃） | 4 秒检测到，自动清理残留 `postmaster.pid`，7 秒完成崩溃恢复并就绪 |
| 数据完整性 | 78 张表 / 1541 条库存流水 / 14 个账号完好 |

---

## 六、断电重启为什么还不能"全自动"

软件层能做的到此为止，剩下两项在系统与硬件层面，需人工确认一次：

1. **BIOS 断电恢复策略**
   进 BIOS → Power Management → `Restore on AC Power Loss` 设为 `Power On`。
   否则停电后机器根本不会自己通电开机，任何软件方案都无从生效。

2. **自动登录（仅登录自启方案需要）**
   `netplwiz` 取消「要使用本计算机，用户必须输入用户名和密码」。
   若不便开启自动登录，请改用第三节的 Windows 服务方案——服务不依赖登录。

---

## 七、常见问题

**Q：重启后 `服务状态.cmd` 显示守护器未运行？**
A：说明本次登录的 VBS 没有触发。检查 `启动` 文件夹里 `WMS-Guardian.vbs` 是否还在；被杀毒软件隔离也会导致此现象。

**Q：数据库起不来，日志报 `lock file "postmaster.pid" already exists`？**
A：守护器会自动清理失效的 pid 文件。若仍失败，说明该 PID 被其他进程占用，需手工核对后删除 `D:\WMS-PG18-DATA\postmaster.pid`。

**Q：两套方案会不会冲突？**
A：不会。服务安装成功后会删除登录自启文件并写入 `runtime/service-mode.flag`，守护器检测到该标记会立即退出，VBS 连续 3 次秒退后也会放弃。

**Q：如何临时停止守护？**
A：结束占用 38017 端口的 node 进程即可；数据库与应用不会随之停止。下次登录 VBS 会重新拉起守护器。
