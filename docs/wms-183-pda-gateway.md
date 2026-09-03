# PDA 通过 183 访问 WMS

## 路线

`统一 PDA -> Tailscale -> ruijing-wms-gateway(183) -> Tailscale -> ruijing-management-122:8080`

- PDA 每 15 秒最多探测一次厂内最终系统 `192.168.6.122:8080/health`。
- 厂内不可达时，改用 MagicDNS `ruijing-wms-gateway:8084/wms-api/health`。
- 业务请求发送后不跨线路自动重放，避免重复收料、发料或审批。
- 非只读请求附带 `X-Request-ID`；服务端仍是权限与库存事务的唯一权威。
- 183 仅通过 Tailnet 连接 122 的 API，不连接 PostgreSQL。

## Tailnet 节点

- 122：最终 MES/WMS 管理系统，MagicDNS 名称为 `ruijing-management-122`。
- 155：开发系统，不再作为 PDA 的生产权威地址。
- 183：安装后执行 `sudo tailscale set --hostname=ruijing-wms-gateway`。
- PDA：安装 Tailscale Android，使用同一企业 Tailnet 登录并允许 VPN。

## 183 nginx

将 `scripts/deploy/wms-183-nginx.conf` 放入 183 的现有 nginx server block，执行：

```bash
sudo nginx -t
sudo systemctl reload nginx
curl -fsS http://ruijing-management-122:8080/health
curl -fsS http://127.0.0.1/wms-api/health
```

该 HTTP 地址只能在 Tailnet 内使用，不开放公网；链路由 Tailscale WireGuard 加密。

## 183 安装

在 183 上执行：

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
sudo tailscale set --hostname=ruijing-wms-gateway
tailscale status
```

然后在 Tailscale 管理后台批准该设备，并禁用该网关节点的密钥过期。

## 最小权限 Grants

在 Tailscale 管理后台启用 MagicDNS，并按现有策略合并以下规则：

```json
{
  "groups": {
    "group:factory-pda": ["工厂 PDA 登录使用的企业账号"]
  },
  "tagOwners": {
    "tag:wms-gateway": ["autogroup:admin"],
    "tag:management-122": ["autogroup:admin"]
  },
  "grants": [
    { "src": ["group:factory-pda"], "dst": ["tag:wms-gateway"], "ip": ["tcp:8084"] },
    { "src": ["tag:wms-gateway"], "dst": ["tag:management-122"], "ip": ["tcp:8080"] }
  ]
}
```

在设备管理页给 183 设置 `tag:wms-gateway`，给 122 设置 `tag:management-122`。不要授权 PDA 或 183 访问 PostgreSQL `5432`。
