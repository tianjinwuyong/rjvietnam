#!/usr/bin/env bash
# ==================================================================
# WMS 卸载（Docker Compose）
#   ./uninstall.sh            停止并删除容器，保留数据卷与配置
#   ./uninstall.sh --purge    连数据卷、证书、日志、.env 一起删除（不可恢复）
#   ./uninstall.sh --yes      不询问
# ==================================================================
set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PKG_DIR"

PURGE=0
ASSUME_YES=0
for a in "$@"; do
  case "$a" in
    --purge) PURGE=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    *) echo "未知参数：$a"; exit 1 ;;
  esac
done

if [ "$(id -u)" -ne 0 ] && ! docker info >/dev/null 2>&1; then
  exec sudo -E bash "$0" "$@"
fi

echo
echo "  WMS 卸载"
echo "  安装目录：$PKG_DIR"
if [ "$PURGE" = "1" ]; then
  echo "  模式：彻底删除（含数据库数据）"
else
  echo "  模式：只删容器，保留数据卷与配置"
fi
echo

if [ "$ASSUME_YES" != "1" ]; then
  read -r -p "  确认继续？(y/N) " ans
  case "$ans" in [Yy]*) ;; *) echo "已取消"; exit 0 ;; esac
fi

if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
else
  DC="docker-compose"
fi

if [ "$PURGE" = "1" ]; then
  $DC down -v || true
  rm -rf ssl logs backup .env 2>/dev/null || true
  echo "  已删除：容器、数据卷、证书、日志、备份、.env"
else
  $DC down || true
  echo "  已停止并删除容器；数据卷 wms_dbdata 与 .env 保留"
  echo "  如需彻底清理，执行：./uninstall.sh --purge"
fi

echo
echo "  卸载完成"
echo
