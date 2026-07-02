#!/bin/sh
# API / worker startup script.

set -e

DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"
DB_NAME="${DB_NAME:-datasource}"
REDIS_HOST="${REDIS_HOST:-redis}"
REDIS_PORT="${REDIS_PORT:-6379}"

if [ -z "$DATABASE_URL" ]; then
  export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
  echo "[entrypoint] DATABASE_URL auto-set: ${DATABASE_URL}"
fi

if [ -z "$REDIS_URL" ]; then
  export REDIS_URL="redis://${REDIS_HOST}:${REDIS_PORT}"
  echo "[entrypoint] REDIS_URL auto-set: ${REDIS_URL}"
fi

echo "[entrypoint] Waiting for PostgreSQL at ${DB_HOST}:${DB_PORT}..."
for i in $(seq 1 30); do
  if nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null; then
    echo "[entrypoint] PostgreSQL is ready!"
    break
  fi
  echo "[entrypoint] PostgreSQL not ready yet, retrying... ($i/30)"
  sleep 1
done

echo "[entrypoint] Waiting for Redis at ${REDIS_HOST}:${REDIS_PORT}..."
for i in $(seq 1 30); do
  if nc -z "$REDIS_HOST" "$REDIS_PORT" 2>/dev/null; then
    echo "[entrypoint] Redis is ready!"
    break
  fi
  echo "[entrypoint] Redis not ready yet, retrying... ($i/30)"
  sleep 1
done

cd /app/api

if [ "${DB_PUSH_ON_START:-true}" = "true" ]; then
  echo "[entrypoint] Pushing database schema..."
  drizzle-kit push --force
  echo "[entrypoint] Database schema ready."
else
  echo "[entrypoint] Skipping database schema push."
fi

echo "[entrypoint] Starting service..."
exec "$@"
