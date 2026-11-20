# MES 开放接口 - 一键开启补丁

给**已装好**的 WMS 补上 MES 查询接口，不用重装、不用重新打包。

## 怎么用

1. 把整个 `patch` 文件夹拷到服务器上（可以放在 WMS 安装目录里，也可以放桌面）。
2. 双击 **`enable-mes-api.bat`**，UAC 提示点「是」。
3. 看到 `完成` 和一行 **API Key** 就好了。

脚本会自动：
- 补入 MES 模块（4 个文件，不覆盖其它代码）
- 在 `dist\app.module.js` 里注册模块（**只注入一行 require + 一行 imports**，改前自动备份）
- 在 `.env` 里生成一个随机 Key（已有则沿用，不覆盖）
- 重启 WMS 服务并验证接口返回 `code=0`

## 常用参数

```bat
:: 装在别的目录 / 服务名不是 WMS
enable-mes-api.bat -InstallDir D:\WMS -ServiceName WMS2

:: 自己指定 Key
enable-mes-api.bat -ApiKey 7f3c9a1e5b2d4c6f

:: 只打补丁，不重启服务（夜里维护时段更合适）
enable-mes-api.bat -NoRestart
```

参数可以组合，直接跟在 `.bat` 后面即可。

## 装完要做什么

把终端里打印的 **API Key** 和 `docs\MES对接WMS接口文档-v1.md` 发给 MES 厂商。

自检：

```bash
curl -H "X-Api-Key: <你的Key>" http://<服务器IP>:3000/api/mes/v1/ping
```

返回 `{"code":0,...}` 即通。

## 出问题怎么办

| 现象 | 原因 / 处理 |
|---|---|
| 提示「找不到安装目录」 | 服务名不是 WMS，或不是用服务方式部署的。加 `-InstallDir` 指定 |
| 提示「程序结构与预期不一致」 | 说明这个安装的 `app.module.js` 被改过结构，补丁锚点找不到。改为重新部署新版本程序 |
| 验证失败，但服务在 Running | 看 `<安装目录>\logs\service-out.log` 最后 20 行 |
| 接口返回 503 | `.env` 里 `MES_API_KEYS` 没生效，确认改的是安装目录下的 `.env` 且已重启 |
| 想撤销 | 把 `dist\app.module.js.bak-*` 和 `.env.bak-*` 覆盖回去，重启服务 |

备份文件都带时间戳，就在原目录下。

## 这个补丁改了什么

| 文件 | 动作 |
|---|---|
| `dist\modules\mes-api\*.js` | 新增 4 个文件 |
| `dist\app.module.js` | 注入 2 行（require + imports 数组项），改前备份 |
| `.env` | 追加 `MES_API_KEYS=...`，改前备份 |

**不动**：数据库、业务代码、前端资源、其它任何模块。
