#!/bin/bash
set -e

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  本地开发启动 (PostgreSQL + Redis in Docker)${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""

# 1. 启动基础设施
echo -e "${YELLOW}[1/4] 启动 PostgreSQL + Redis (Docker)...${NC}"
docker compose -f docker/docker-compose.infra.yaml up -d

# 等待服务就绪
echo "  等待数据库就绪..."
sleep 3

# 2. 检查连接
echo -e "${YELLOW}[2/4] 检查服务连接...${NC}"
if docker exec ds_postgres pg_isready -U postgres > /dev/null 2>&1; then
  echo -e "  ${GREEN}✅ PostgreSQL 已就绪${NC}"
else
  echo -e "  ${RED}❌ PostgreSQL 未就绪，重试中...${NC}"
  sleep 3
fi

if docker exec ds_redis redis-cli ping | grep -q PONG; then
  echo -e "  ${GREEN}✅ Redis 已就绪${NC}"
else
  echo -e "  ${RED}❌ Redis 未就绪${NC}"
fi

# 3. 推送数据库 schema
echo -e "${YELLOW}[3/4] 推送数据库表结构...${NC}"
cd api
cp .env.local .env
npx drizzle-kit push --force
cd ..

# 4. 启动提示
echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  ✅ 基础设施已启动${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "  PostgreSQL: ${YELLOW}localhost:5432${NC} (user=postgres, pass=postgres, db=datasource)"
echo -e "  Redis:      ${YELLOW}localhost:6379${NC}"
echo ""
echo -e "${GREEN}启动服务:${NC}"
echo ""
echo "  终端1 (API):     cd api && pnpm dev"
echo "  终端2 (Worker):  cd api && pnpm worker"
echo ""
echo -e "${GREEN}测试接口:${NC}"
echo ""
echo "  node api/test-api.mjs"
echo ""
echo -e "${YELLOW}停止基础设施:${NC}"
echo ""
echo "  docker compose -f docker/docker-compose.infra.yaml down"
echo ""
