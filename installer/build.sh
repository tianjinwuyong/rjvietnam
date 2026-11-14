#!/usr/bin/env bash
# ------------------------------------------------------------
# 组装 WMS 安装包载荷并编译安装程序
#   bash installer/build.sh            # 只组装载荷
#   bash installer/build.sh --compile  # 组装 + 编译 exe
#
# 环境变量：
#   WMS_NODE_EXE  node.exe 路径（默认取 PATH 里的 node）
#   WMS_PG_DIR    PostgreSQL 安装目录（默认 C:\Program Files\PostgreSQL\18）
#   WMS_ISCC      ISCC.exe 路径
# ------------------------------------------------------------
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$REPO/installer"
PAYLOAD="$REPO/build/payload"

NODE_SRC="${WMS_NODE_EXE:-$(command -v node)}"
PG_DIR="${WMS_PG_DIR:-/c/Program Files/PostgreSQL/18}"
ISCC="${WMS_ISCC:-/c/Program Files (x86)/Inno Setup 6/ISCC.exe}"

log() { echo "[build] $*"; }
die() { echo "[build][错误] $*" >&2; exit 1; }

[ -f "$REPO/dist/main.js" ]              || die "缺少 dist/main.js，请先 npm run build"
[ -f "$REPO/dist/client/index.html" ]    || die "缺少 dist/client/index.html"
[ -f "$REPO/dist/scripts/init-db.js" ]   || die "缺少 dist/scripts/init-db.js"
[ -f "$REPO/dist/database/baseline-schema.sql" ] || die "缺少结构基线 baseline-schema.sql"
[ -n "$NODE_SRC" ] && [ -f "$NODE_SRC" ] || die "找不到 node.exe（可设置 WMS_NODE_EXE）"
[ -d "$PG_DIR/bin" ]                     || die "找不到 PostgreSQL 目录 $PG_DIR（可设置 WMS_PG_DIR）"
[ -f "$INSTALLER/vendor/nssm.exe" ]      || die "缺少 installer/vendor/nssm.exe"

# WMS_KEEP_PAYLOAD=1 时保留已有载荷目录，做增量覆盖（清理被安全策略拦截时使用）
if [ "${WMS_KEEP_PAYLOAD:-0}" = "1" ] && [ -d "$PAYLOAD" ]; then
  log "保留已有载荷目录（WMS_KEEP_PAYLOAD=1），改为增量覆盖"
  mkdir -p "$PAYLOAD/scripts" "$PAYLOAD/node"
else
  log "清理 $PAYLOAD"
  rm -rf "$PAYLOAD"
  mkdir -p "$PAYLOAD/scripts" "$PAYLOAD/node"
fi

log "复制 dist / 文档"
mkdir -p "$PAYLOAD/dist"
cp -r "$REPO/dist/." "$PAYLOAD/dist/"
cp "$REPO/package.json" "$PAYLOAD/package.json"
cp "$INSTALLER/README-DEPLOY.txt" "$PAYLOAD/README-DEPLOY.txt"

log "复制 Node 运行时：$NODE_SRC"
cp "$NODE_SRC" "$PAYLOAD/node/node.exe"

log "复制便携 PostgreSQL：$PG_DIR"
mkdir -p "$PAYLOAD/pgsql"
for sub in bin lib share; do
  [ -d "$PG_DIR/$sub" ] || die "PostgreSQL 缺少 $sub 目录"
  log "  pgsql/$sub"
  mkdir -p "$PAYLOAD/pgsql/$sub"
  cp -r "$PG_DIR/$sub/." "$PAYLOAD/pgsql/$sub/"
done

log "复制生产依赖"
cd "$REPO"
# npm ls 在有 extraneous / peer 警告时会返回非 0，这里不让它中断构建
npm ls --omit=dev --all --parseable 2>/dev/null | tail -n +2 | sort -u > /tmp/wms_prod_deps.txt || true
WIN_REPO="$(cygpath -w "$REPO" | sed 's|\\|/|g')"
sed 's|\\|/|g' /tmp/wms_prod_deps.txt | sed "s|^${WIN_REPO}/node_modules/||" | grep -v '^[A-Za-z]:' > /tmp/wms_prod_rel.txt
mkdir -p "$PAYLOAD/node_modules"
n=0
while IFS= read -r rel; do
  [ -z "$rel" ] && continue
  [ -e "node_modules/$rel" ] || continue
  mkdir -p "$PAYLOAD/node_modules/$(dirname "$rel")"
  mkdir -p "$PAYLOAD/node_modules/$rel"
  cp -r "node_modules/$rel/." "$PAYLOAD/node_modules/$rel/" || die "复制依赖失败：$rel"
  n=$((n + 1))
done < /tmp/wms_prod_rel.txt
log "  共 $n 个包"

log "复制部署脚本"
cp "$REPO/scripts/gen-ssl-cert.ps1" "$PAYLOAD/scripts/"
cp "$INSTALLER/setup.cjs" "$PAYLOAD/scripts/"
cp "$INSTALLER/uninstall.cjs" "$PAYLOAD/scripts/"
cp "$INSTALLER/start-wms.cmd" "$INSTALLER/stop-wms.cmd" "$INSTALLER/status-wms.cmd" "$PAYLOAD/scripts/"
cp "$INSTALLER/vendor/nssm.exe" "$PAYLOAD/scripts/"

# 预置数据：系统用户 / 角色 / 参数 / IQC 检验模板（pg_dump -Fc 自定义格式）
if [ -f "$INSTALLER/seed-data.dump" ]; then
  cp "$INSTALLER/seed-data.dump" "$PAYLOAD/scripts/seed-data.dump"
  log "  已包含预置数据 seed-data.dump（$(du -h "$INSTALLER/seed-data.dump" | cut -f1)）"
else
  log "  ! 未找到 seed-data.dump，将按空库部署"
fi

log "载荷体积：$(du -sh "$PAYLOAD" | cut -f1)"
for sub in dist node node_modules pgsql scripts; do
  log "  $sub: $(du -sh "$PAYLOAD/$sub" | cut -f1)"
done

if [ "${1:-}" = "--compile" ]; then
  [ -f "$ISCC" ] || die "找不到 ISCC.exe：$ISCC（可设置 WMS_ISCC）"
  log "编译安装包"
  mkdir -p "$REPO/build/out"
  "$ISCC" "$INSTALLER/wms-setup.iss" | tail -20
  [ -f "$REPO/build/out/WMS-Setup-1.0.exe" ] || die "未生成安装包"
  log "完成：$REPO/build/out/WMS-Setup-1.0.exe（$(du -h "$REPO/build/out/WMS-Setup-1.0.exe" | cut -f1)）"
fi
