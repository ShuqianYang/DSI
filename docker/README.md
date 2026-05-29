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
| postgres | 5432 | PostgreSQL 16 数据库 |
| redis | 6379 | Redis 7 队列/缓存 |
| api | 3001 | Express API 服务器 |
| worker | - | BullMQ 任务执行 Worker |

## 开发模式特性

- **代码热重载**：api/worker 服务挂载了本地源码，修改后自动生效
- **自动迁移**：启动时自动执行 `drizzle-kit push` 推送数据库表
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
```

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
