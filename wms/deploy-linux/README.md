# WMS 仓库管理系统 · Linux 部署包（Docker Compose）

一条命令装好：数据库、程序、HTTPS 证书、开机自启，全部在容器里跑。

## 一、目标机要求

| 项      | 要求                                                       |
| ------ | -------------------------------------------------------- |
| 系统     | 任意 x64 Linux（Ubuntu 20.04+/Debian 11+/CentOS 8+/国产发行版均可） |
| Docker | 24+，且含 compose v2（`docker compose version` 能输出版本）        |
| 内存     | ≥ 4 GB（数据库 + 应用）                                         |
| 磁盘     | ≥ 10 GB（镜像约 400 MB，数据另计）                                 |
| 网络     | 首次安装需联网（拉取 `node:22-bookworm-slim` 和 `postgres:18` 镜像）   |
| 端口     | 3000（HTTP）、3443（HTTPS），可在 `.env` 改                       |

没装 Docker 的话（CentOS 用 `yum` 或国内镜像源）：

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
```

## 二、安装

把压缩包传到服务器，解压后执行：

```bash
tar -xzf WMS-Docker-2.0.0.tar.gz
cd wms-docker
sudo bash install.sh
```

脚本会自动完成：

1. 校验 Docker 与 compose
2. 生成 `.env`（**随机**数据库密码、JWT 密钥，权限 600）
3. 生成 HTTPS 自签证书（含服务器 IP 的 SAN，手机可安装信任）
4. 构建应用镜像
5. 起数据库并等待就绪
6. 初始化：建库 → 59 张表 → 16 个补充脚本 → 16 个角色 + `admin` 账号 + 系统参数
7. 起应用并等到首页返回 200
8. 打印访问地址

装完会看到：

```
电脑端登录   http://<服务器IP>:3000
手机/PDA     https://<服务器IP>:3443   （首次先装证书：http://<服务器IP>:3000/cert）
默认账号     admin / admin
```

**首次登录后请立即改密码。**

## 三、日常运维

```bash
docker compose ps                 # 状态（wms、db 两个容器）
docker compose logs -f wms        # 应用日志
docker compose logs -f db         # 数据库日志
docker compose restart wms        # 重启应用
./backup.sh                       # 备份数据库到 ./backup/
./backup.sh /mnt/nas              # 备份到指定目录
```

**定时备份**（每天凌晨 2:30）：

```bash
crontab -e
30 2 * * * cd /opt/wms && ./backup.sh /mnt/nas >/dev/null 2>&1
```

## 四、升级

把新版本的包解压到一个新目录，**只覆盖 `app/`**，然后重建镜像：

```bash
# 假设旧的在 /opt/wms，新的解压在 /opt/wms-new
cp -r /opt/wms-new/app/* /opt/wms/app/
cd /opt/wms
docker compose up -d --build      # 重新构建并滚动重启
docker compose run --rm --entrypoint node wms tools/db.js init /app/assets /app/dist
```

第二条命令是**补齐数据库结构**（幂等，不动已有数据）。如果新版本带新的补充脚本，必须执行它。

> 升级前先 `./backup.sh` 备份，这是唯一能回退的手段。

## 五、卸载

```bash
./uninstall.sh              # 删容器，保留数据卷与 .env
./uninstall.sh --purge      # 连数据一起删（不可恢复）
```

## 六、目录说明

```
wms-docker/
  docker-compose.yml    编排：wms + db 两个服务
  Dockerfile            应用镜像（容器内 npm ci 装依赖）
  install.sh            一键安装
  uninstall.sh          卸载
  backup.sh / restore.sh 备份与还原
  .env                  安装时生成（数据库密码、JWT 密钥）★ 注意备份
  app/                  程序与建库脚本（dist、tools、assets）
  ssl/                  安装时生成的证书（pfx 给 Node，crt 给手机安装）
  logs/                 应用日志（挂载到容器）
  backup/               备份文件
```

数据在 Docker 卷 `wms_dbdata` 里，**不在**安装目录。`docker compose down -v` 会删除它。

## 七、常见问题

**Q：`permission denied while trying to connect to the Docker daemon`**  
当前用户不在 docker 组：`sudo usermod -aG docker $USER` 后重新登录，或直接用 `sudo bash install.sh`。

**Q：拉镜像很慢/超时**  
配置镜像加速（`/etc/docker/daemon.json` 加 `registry-mirrors`）后 `systemctl restart docker`。  
完全离线环境需要先在有网机器上 `docker save node:22-bookworm-slim postgres:18 | gzip > images.tar.gz`，目标机 `docker load -i` 后再安装。

**Q：端口被占用**  
改 `.env` 里的 `HTTP_PORT` / `HTTPS_PORT`，然后 `docker compose up -d`。

**Q：手机扫码用不了**  
手机必须走 `https://IP:3443`，且先访问 `http://IP:3000/cert` 安装证书。详见系统内「帮助 → 系统概览 → 四种登录方式」。

**Q：怎么用图形工具连数据库？**  
默认数据库不暴露到宿主机。把 `docker-compose.yml` 里 db 的 `expose` 改成  
`ports: ["127.0.0.1:5433:5432"]`（只监听本机，安全），然后 `docker compose up -d db`。  
用户名/密码/库名见 `.env`。

**Q：换服务器或换 IP 后证书报错**  
证书是按安装时的 IP 签的。重新签：`REGEN_CERT=1 bash install.sh`（会重新生成证书并重启）。

## 八、和 Windows 安装包的区别

|       | Windows 版 exe             | Linux 版（本包）                        |
| ----- | ------------------------- | ---------------------------------- |
| 依赖    | 内置 Node + PostgreSQL，无需预装 | 需 Docker；镜像内含 Node 与 PostgreSQL    |
| 数据库位置 | 安装目录下 `pgdata\`           | Docker 卷 `wms_dbdata`              |
| 服务管理  | Windows 服务（WMS / WMS-DB）  | Docker 容器（restart: unless-stopped） |
| 升级    | 再跑一次 exe                  | 覆盖 app/ 后 `up -d --build`          |
| 数据备份  | 拷 `pgdata` 目录             | `./backup.sh`（pg_dump）             |
