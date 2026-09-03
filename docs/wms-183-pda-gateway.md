# PDA 通过 183 访问 WMS

## 路线

`统一 PDA -> 1.13.164.183/wms-api -> 183 本机 18080 -> 反向 SSH 隧道 -> 155:8080`

- PDA 每 15 秒最多探测一次厂内 `155 /health`。
- 厂内不可达时，改用 `183 /wms-api/health`。
- 业务请求发送后不跨线路自动重放，避免重复收料、发料或审批。
- 非只读请求附带 `X-Request-ID`；服务端仍是权限与库存事务的唯一权威。
- 183 只连接反向隧道的 loopback 端口，不直接连接 PostgreSQL。

## 183 nginx

将 `scripts/deploy/wms-183-nginx.conf` 放入 183 的现有 nginx server block，执行：

```bash
sudo nginx -t
sudo systemctl reload nginx
curl -fsS http://127.0.0.1:18080/health
curl -fsS http://127.0.0.1/wms-api/health
```

公网正式使用前必须为入口启用 HTTPS；不得通过明文 HTTP 传输员工密码或 JWT。

## 155 反向隧道

使用只允许端口转发的独立 SSH key，禁止把密码写入脚本或 Git。管理员 PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy/Start-Wms183ReverseTunnel.ps1
```

生产部署时将脚本注册为 Windows 启动任务，并使用专用低权限账户运行。
