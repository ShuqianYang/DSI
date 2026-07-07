# Docker 部署指南

## 快速启动（一键启动所有服务）

```bash
# 方式1：在根目录直接启动
docker compose up

# 方式2：在 docker/ 目录启动
cd docker
docker compose up

# 后台运行
docker compose up -d

# 查看日志
docker compose logs -f api
docker compose logs -f worker
```

## 服务清单

| 服务 | 端口 | 说明 |
|------|------|------|
| postgres | 5432 | PostgreSQL 16 + pgvector 向量数据库 |
| redis | 6379 | Redis 7 队列/缓存 |
| api | 3001 | Express API 服务器 |
| worker | - | BullMQ 任务执行 Worker |

## 开发模式特性

- **代码热重载**：api/worker 服务挂载了本地源码，修改后自动生效
- **自动迁移**：启动时自动执行 `drizzle-kit push` 推送数据库表
- **向量扩展**：postgres 服务使用 `pgvector/pgvector:pg16`，首次初始化数据库时自动执行 `docker/postgres-init/001-enable-vector.sql`
- **健康检查**：postgres/redis 就绪后才启动 api/worker

## 常用命令

```bash
# 停止所有服务
docker compose down

# 停止并删除数据卷（清空数据库）
docker compose down -v

# 只重启 API
docker compose restart api

# 进入 API 容器执行命令
docker compose exec api sh

# 查看数据库
docker compose exec postgres psql -U postgres -d datasource

# 验证 pgvector 扩展
docker compose exec postgres psql -U postgres -d datasource -c "SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';"
```

## pgvector 数据库说明

主业务库 `DATABASE_URL` 仍然指向 `postgres` 服务：

```text
postgresql://postgres:postgres@postgres:5432/datasource
```

因此 API、worker 和 Drizzle 配置不需要调整环境变量。向量能力来自数据库镜像和初始化 SQL：

- `docker/docker-compose.yaml` 和 `docker/docker-compose.infra.yaml` 的 `postgres` 服务使用 `pgvector/pgvector:pg16`
- `docker/postgres-init/001-enable-vector.sql` 执行 `CREATE EXTENSION IF NOT EXISTS vector;`
- 初始化 SQL 只会在新的 `postgres_data` 数据卷第一次创建数据库时自动执行

如果已有 `postgres_data` 数据卷，不想清空数据，可以手动开启扩展：

```bash
docker compose exec postgres psql -U postgres -d datasource -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

如果可以清空本地数据库，则删除数据卷后重新启动：

```bash
docker compose down -v
docker compose up -d
```

`GEO_DATABASE_URL` 仍然只用于可选的 PostGIS 地理库，不需要为 pgvector 修改。

## 连接本地数据库（不用 Docker）

如果不想用 Docker 的数据库，修改 `docker-compose.yaml` 中的环境变量：

```yaml
api:
  environment:
    DATABASE_URL: postgresql://你的用户:密码@host.docker.internal:5432/数据库名
    REDIS_URL: redis://host.docker.internal:6379
```

然后移除 `depends_on` 中的 postgres/redis，或单独启动 api/worker：

```bash
docker compose up api worker
```
