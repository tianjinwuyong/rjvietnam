#!/usr/bin/env bash
# ==================================================================
# WMS 仓库管理系统 - Linux 一键安装（Docker Compose）
#
#   用法：  sudo ./install.sh
#
#   做的事：检查 Docker → 生成 .env（随机密钥）→ 生成 HTTPS 自签证书
#          → 构建镜像 → 起数据库 → 初始化库表/账号 → 起应用 → 等页面可访问
#
#   前置：已安装 Docker 24+（含 compose v2）。未安装时脚本会提示命令。
# ==================================================================
set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PKG_DIR"

if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_STEP=$'\033[36m'; C_OFF=$'\033[0m'
else
  C_OK=''; C_WARN=''; C_ERR=''; C_STEP=''; C_OFF=''
fi

step() { echo "${C_STEP}  > $*${C_OFF}"; }
ok()   { echo "${C_OK}  [OK] $*${C_OFF}"; }
warn() { echo "${C_WARN}  [!!] $*${C_OFF}"; }
die()  { echo "${C_ERR}  [XX] $*${C_OFF}" >&2; exit 1; }

echo
echo "  ============================================================"
echo "    WMS 仓库管理系统  安装程序（Linux / Docker）"
echo "  ============================================================"
echo

# ------------------------------------------------------------------ 权限
if [ "$(id -u)" -ne 0 ]; then
  if ! docker info >/dev/null 2>&1; then
    warn "当前用户无法访问 Docker，正在用 sudo 重新执行..."
    exec sudo -E bash "$0" "$@"
  fi
fi

# ------------------------------------------------------------------ Docker
step "检查 Docker"
command -v docker >/dev/null 2>&1 || die "未安装 Docker。请先执行：curl -fsSL https://get.docker.com | sh"
docker info >/dev/null 2>&1 || die "Docker 未运行（或当前用户不在 docker 组）。请执行：systemctl enable --now docker"

if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
  warn "检测到旧版 docker-compose，建议升级到 compose v2"
else
  die "缺少 Docker Compose v2。请参考：https://docs.docker.com/compose/install/"
fi
ok "Docker $(docker --version | awk '{print $3}' | tr -d ',') / $DC"

# ------------------------------------------------------------------ .env
RANDOM_HEX() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
  else
    tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32
  fi
}

if [ -f .env ]; then
  step "检测到已有 .env，沿用现有配置（含数据库密码与 JWT 密钥）"
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
else
  step "生成 .env（随机数据库密码与 JWT 密钥）"
  DB_PASSWORD="$(RANDOM_HEX)"
  JWT_SECRET="$(RANDOM_HEX)$(RANDOM_HEX)"
  cat > .env <<ENVEOF
# WMS 运行配置（由 install.sh 生成于 $(date '+%Y-%m-%d %H:%M:%S')）
# 数据库密码与 JWT 密钥是随机生成的，请妥善保存本文件

# 对外端口（宿主机）
HTTP_PORT=3000
HTTPS_PORT=3443

# 数据库
DB_USER=postgres
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=factory

# 登录令牌密钥（改动后所有人需要重新登录）
JWT_SECRET=${JWT_SECRET}

# HTTPS 证书口令（与 ssl/wms-cert.pfx 一致）
SSL_PFX_PASSPHRASE=wms2024

# 时区
TZ=Asia/Shanghai

# MES 开放接口（填了才启用；改完 docker compose up -d 生效）
# MES_API_KEYS=Key:调用方名称
ENVEOF
  chmod 600 .env
  ok ".env 已生成"
fi

HTTP_PORT="${HTTP_PORT:-3000}"
HTTPS_PORT="${HTTPS_PORT:-3443}"
DB_NAME="${DB_NAME:-factory}"
DB_USER="${DB_USER:-postgres}"

# ------------------------------------------------------------------ 端口
step "检查宿主机端口"
for p in "$HTTP_PORT" "$HTTPS_PORT"; do
  if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${p}$"; then
    die "端口 ${p} 已被占用，请修改 .env 里的 HTTP_PORT / HTTPS_PORT 后重试"
  fi
done
ok "端口 ${HTTP_PORT} / ${HTTPS_PORT} 可用"

# ------------------------------------------------------------------ 证书
mkdir -p ssl logs
if [ -f ssl/wms-cert.pfx ] && [ "${REGEN_CERT:-0}" != "1" ]; then
  ok "沿用已有 HTTPS 证书（如需重签：REGEN_CERT=1 ./install.sh）"
elif command -v openssl >/dev/null 2>&1; then
  step "生成 HTTPS 自签证书"
  SRV_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [ -z "${SRV_IP:-}" ] && SRV_IP="127.0.0.1"
  # 优先带 SAN（浏览器对 IP 访问要求 SAN）；老版本 openssl 不支持 -addext 时降级
  if ! openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
        -keyout ssl/wms-key.pem -out ssl/wms-cert.crt -subj "/CN=WMS" \
        -addext "subjectAltName=IP:${SRV_IP},DNS:localhost" >/dev/null 2>&1; then
    openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
      -keyout ssl/wms-key.pem -out ssl/wms-cert.crt -subj "/CN=WMS" >/dev/null 2>&1
    warn "当前 openssl 版本较旧，证书未包含 IP SAN（手机访问提示会更多）"
  fi
  openssl pkcs12 -export -out ssl/wms-cert.pfx \
    -inkey ssl/wms-key.pem -in ssl/wms-cert.crt \
    -passout "pass:${SSL_PFX_PASSPHRASE:-wms2024}" >/dev/null 2>&1
  chmod 600 ssl/wms-key.pem ssl/wms-cert.pfx 2>/dev/null || true
  ok "证书已生成（适用地址 ${SRV_IP}）"
else
  warn "未安装 openssl，跳过证书生成——手机扫码将不可用（仅 HTTP 可用）"
fi

# ------------------------------------------------------------------ 构建
step "构建应用镜像（首次约 2-4 分钟，需要联网拉取 node:22 与 postgres:18）"
$DC build
ok "镜像构建完成"

step "启动数据库"
$DC up -d db

step "等待数据库就绪..."
DB_READY=0
for i in $(seq 1 60); do
  if $DC exec -T db pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
    DB_READY=1; break
  fi
  sleep 2
done
[ "$DB_READY" = "1" ] || { $DC logs --tail=30 db; die "数据库未能启动，见上方日志"; }
ok "数据库已就绪"

# ------------------------------------------------------------------ 初始化
step "初始化库表与账号（已有数据会自动跳过）"
$DC run --rm --entrypoint node wms tools/db.js init /app/assets /app/dist
ok "数据库初始化完成"

# ------------------------------------------------------------------ 启动
step "启动应用"
$DC up -d wms

step "等待页面可访问..."

# 精简系统可能没有 curl/wget，逐级降级：curl → wget → 容器健康状态
probe_http() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS "http://127.0.0.1:${HTTP_PORT}/" >/dev/null 2>&1
  elif command -v wget >/dev/null 2>&1; then
    wget -q -T 3 -O /dev/null "http://127.0.0.1:${HTTP_PORT}/" 2>/dev/null
  else
    local cid
    cid="$($DC ps -q wms 2>/dev/null || true)"
    [ -n "$cid" ] && [ "$(docker inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null)" = "healthy" ]
  fi
}

APP_READY=0
for i in $(seq 1 60); do
  if probe_http; then APP_READY=1; break; fi
  sleep 2
done
if [ "$APP_READY" != "1" ]; then
  $DC logs --tail=40 wms
  die "应用未能启动，见上方日志（或 docker compose logs -f wms）"
fi
ok "应用已启动"

# ------------------------------------------------------------------ 汇总
SRV_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -z "${SRV_IP:-}" ] && SRV_IP="<服务器IP>"

echo
echo "  ============================================================"
echo "    安装完成"
echo "  ============================================================"
echo
echo "    电脑端登录   http://${SRV_IP}:${HTTP_PORT}"
echo "    本机登录     http://localhost:${HTTP_PORT}"
echo "    手机/PDA     https://${SRV_IP}:${HTTPS_PORT}   （首次先装证书：http://${SRV_IP}:${HTTP_PORT}/cert）"
echo
echo "    默认账号     admin / admin   （首次登录后请立即改密码）"
echo "    安装目录     ${PKG_DIR}"
echo "    配置文件     ${PKG_DIR}/.env       （数据库密码与 JWT 密钥都在这里，注意备份）"
echo "    数据卷       wms_dbdata          （docker volume，删除即丢数据）"
echo
echo "    常用命令："
echo "      docker compose ps                 查看状态"
echo "      docker compose logs -f wms        看应用日志"
echo "      ./backup.sh                       备份数据库"
echo "      docker compose down               停止"
echo "      ./uninstall.sh                    卸载"
echo
