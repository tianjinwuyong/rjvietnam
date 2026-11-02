#!/bin/bash
# WMS 仓库管理系统 - Linux 启动脚本

set -e

echo "========================================"
echo "  WMS 仓库管理系统 - 启动"
echo "========================================"
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "[错误] 未检测到 Node.js，请先安装 Node.js 22+"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
    echo "[错误] Node.js 版本过低，需要 22+，当前: $(node -v)"
    exit 1
fi

cd "$(dirname "$0")"

# 安装依赖
if [ ! -d "node_modules" ]; then
    echo "[1/4] 安装依赖..."
    npm install
else
    echo "[1/4] 依赖已安装，跳过"
fi

# 配置文件
if [ ! -f ".env" ]; then
    echo "[2/4] 创建配置文件..."
    cp .env.example .env
    echo "请编辑 .env 文件配置数据库连接后重新运行"
    exit 0
else
    echo "[2/4] 配置文件已存在"
fi

# 数据库结构检查 / 自愈（幂等，【每次启动都执行】；失败不阻断启动，避免 set -e 直接中断）
#   init-db 内部：仅当库为空时才执行 drizzle-kit push 建表（重步骤）；每次都会执行幂等补充 SQL。
#   历史上用 node_modules/.db-initialized 跳过【整个】初始化，会导致：存量库漂移无法自愈、
#   整包（含该标记）拷到新机器时跳过建表直接不可用；现改为每次都跑。
echo "[3/4] 检查并自愈数据库结构..."
if npx ts-node server/scripts/init-db.ts; then
    touch "node_modules/.db-initialized"
    echo "    数据库结构检查/初始化完成。"
else
    echo "[警告] 数据库初始化/自检未完全成功，将继续尝试启动（请检查 .env 中的数据库配置）。"
fi

# 构建
echo "[4/4] 构建项目..."
npm run build

echo ""
echo "========================================"
echo "  启动 WMS 系统..."
echo "  访问地址: http://0.0.0.0:${SERVER_PORT:-3000}"
echo "  默认账号: admin / admin"
echo "========================================"
echo ""

node dist/main.js
