#!/bin/bash
# 本地启动脚本（不依赖 Docker）
# 需要本地已安装 PostgreSQL 和 Redis

set -e

API_PORT="${API_PORT:-3001}"
export API_PORT
export NODE_ENV=development

# 检查 PostgreSQL
if ! command -v psql &> /dev/null; then
  echo "❌ PostgreSQL 未安装，请先安装: https://www.postgresql.org/download/"
  echo "   或者使用 Docker: docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16-alpine"
  exit 1
fi

# 检查 Redis
if ! command -v redis-cli &> /dev/null; then
  echo "❌ Redis 未安装，请先安装: https://redis.io/docs/latest/operate/oss_and_stack/install/install-redis/"
  echo "   或者使用 Docker: docker run -d -p 6379:6379 redis:7-alpine"
  exit 1
fi

# 默认连接本地服务
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/datasource}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"

# 检查 PostgreSQL 是否可连接
echo "🔍 检查 PostgreSQL..."
if ! psql "$DATABASE_URL" -c "SELECT 1" > /dev/null 2>&1; then
  echo "❌ 无法连接 PostgreSQL，请确认服务已启动"
  echo "   当前 DATABASE_URL: $DATABASE_URL"
  exit 1
fi

# 检查 Redis
echo "🔍 检查 Redis..."
if ! redis-cli ping > /dev/null 2>&1; then
  echo "❌ 无法连接 Redis，请确认服务已启动"
  echo "   当前 REDIS_URL: $REDIS_URL"
  exit 1
fi

# 推送数据库 schema
echo "📦 推送数据库表结构..."
cd api
npx drizzle-kit push --force

echo ""
echo "============================================"
echo "✅ 环境检查通过"
echo "============================================"
echo ""
echo "启动命令:"
echo "  终端1: cd api && pnpm dev      (API 服务器)"
echo "  终端2: cd api && pnpm worker   (Worker)"
echo ""
echo "测试命令:"
echo "  node api/test-api.mjs"
echo ""
