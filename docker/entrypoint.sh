#!/bin/sh
# API / Worker 启动脚本

set -e

DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"
DB_NAME="${DB_NAME:-datasource}"

# 拼接 DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
  export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
  echo "[entrypoint] DATABASE_URL auto-set: ${DATABASE_URL}"
fi

if [ -z "$REDIS_URL" ]; then
  export REDIS_URL="redis://redis:6379"
  echo "[entrypoint] REDIS_URL auto-set: ${REDIS_URL}"
fi

# 等待 PostgreSQL 就绪
echo "[entrypoint] Waiting for PostgreSQL at ${DB_HOST}:${DB_PORT}..."
for i in $(seq 1 30); do
  if nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null; then
    echo "[entrypoint] PostgreSQL is ready!"
    break
  fi
  echo "[entrypoint] PostgreSQL not ready yet, retrying... ($i/30)"
  sleep 1
done

# 推送数据库 schema（全局安装的 drizzle-kit）
echo "[entrypoint] Pushing database schema..."
cd /app/api
drizzle-kit push --force

echo "[entrypoint] Database schema ready. Starting service..."

# 执行传入的 CMD
exec "$@"
