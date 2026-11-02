#!/usr/bin/env bash
# ==================================================================
# 备份数据库（自定义格式，可用 restore.sh 还原）
#   ./backup.sh                备份到 ./backup/
#   ./backup.sh /mnt/nas        备份到指定目录
# 建议加进 crontab：  30 2 * * * /opt/wms/backup.sh /mnt/nas >/dev/null 2>&1
# ==================================================================
set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PKG_DIR"

[ -f .env ] || { echo "缺少 .env，请先安装"; exit 1; }
set -a; . ./.env; set +a

BACKUP_DIR="${1:-$PKG_DIR/backup}"
mkdir -p "$BACKUP_DIR"

TS="$(date +%F-%H%M%S)"
OUT="$BACKUP_DIR/wms-${TS}.dump"

if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi

echo "  正在备份数据库 ${DB_NAME} ..."
$DC exec -T db pg_dump -U "${DB_USER:-postgres}" -d "${DB_NAME:-wms}" -Fc > "$OUT"

SIZE="$(du -h "$OUT" | awk '{print $1}')"
echo "  完成：$OUT （$SIZE）"

# 保留最近 30 份
ls -1t "$BACKUP_DIR"/wms-*.dump 2>/dev/null | tail -n +31 | xargs -r rm -f
echo "  已保留最近 30 份备份"
