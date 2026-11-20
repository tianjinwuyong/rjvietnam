#!/usr/bin/env bash
# ==================================================================
# 还原数据库
#   ./restore.sh backup/wms-2026-10-23-020000.dump
#
#   ⚠ 会覆盖现有数据。脚本会先停应用、清空目标库再还原，完成后重启应用。
#   ⚠ .env 里的 DB_PASSWORD 必须与备份来源一致（否则应用连不上）。
# ==================================================================
set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PKG_DIR"

FILE="${1:-}"
[ -n "$FILE" ] || { echo "用法：./restore.sh <备份文件.dump>"; exit 1; }
[ -f "$FILE" ] || { echo "找不到文件：$FILE"; exit 1; }
[ -f .env ] || { echo "缺少 .env"; exit 1; }

set -a; . ./.env; set +a

if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi

echo "  即将用 $FILE 覆盖数据库 ${DB_NAME}，现有数据将丢失。"
read -r -p "  确认继续？(y/N) " ans
case "$ans" in [Yy]*) ;; *) echo "已取消"; exit 0 ;; esac

echo "  停止应用..."
$DC stop wms || true

echo "  还原中..."
$DC exec -T db pg_restore -U "${DB_USER:-postgres}" -d "${DB_NAME:-factory}" \
  --clean --if-exists --no-owner --no-privileges < "$FILE" || true

# 补充脚本是幂等的，重跑一遍把还原时缺失的对象补齐
echo "  校验并补齐结构..."
$DC run --rm --entrypoint node wms tools/db.js init /app/assets /app/dist

echo "  启动应用..."
$DC up -d wms
echo "  还原完成"
