# 边防智能体前后端启动、打包与部署指南

> 适用仓库：`DSI-agent-loop`（数智融合智能体应用）
> 适用分支：`border` / `main`
> 最后更新：2026-07-16

---

## 1. 项目组成

| 模块 | 目录/文件 | 说明 |
|------|-----------|------|
| 前端（Next.js） | `src/`、`package.json` | 提供 `/border-defense/qa/h5`、`/border-defense/daily/h5` 等 H5 页面 |
| 后端（Express） | `api/src/`、`api/package.json` | Agent Loop、任务路由、SSE、记忆、日报生成 |
| 共享类型 | `packages/shared/` | 前后端共享的 TypeScript 类型 |
| Skill | `skills/border-defense-qa/`、`skills/border-defense-daily-report/` | 边防问数、边防日报的业务规则、SQL 和模板 |
| 基础设施 | `docker/docker-compose.infra.yaml` | PostgreSQL（pgvector）、Redis、Ollama、PostGIS |
| 全量容器 | `docker/docker-compose.yaml` | PostgreSQL、Redis、Ollama、PostGIS + API + Worker + Web + Nginx + Autoheal |
| 镜像构建 | `docker/Dockerfile` | 多阶段构建，产出 web / api / worker 三个 target |

---

## 2. 环境准备

### 2.1 依赖服务

| 服务 | 用途 | 默认连接 |
|------|------|----------|
| PostgreSQL 16 + pgvector | 任务、记忆、transcript、向量检索 | `postgresql://postgres:postgres@localhost:5432/datasource` |
| Redis 7 | 任务队列 | `redis://localhost:6379` |
| Ollama | Embedding 模型（qwen3-embedding:0.6b） | `http://localhost:11434/v1` |
| 大模型 API | Agent 推理、日报生成、视觉理解 | 通义千问 / DeepSeek / 自定义 OpenAI-compatible |
| 边防 MySQL | 边防业务数据查询；当前 Compose 不创建该业务库 | `BORDER_DEFENSE_DB_*` |
| PostGIS（可选） | GIS 区域解析 | `postgresql://postgres:postgres@localhost:5433/show_room` |

### 2.2 模型配置

当前使用统一模型适配层，推荐通过环境变量配置：

```bash
MODEL_PROVIDER=openai-compatible
MODEL_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
MODEL_API_KEY=sk-...
MODEL_NAME=qwen3.5-27b
MODEL_TIMEOUT_MS=120000
```

Agent 主循环、上下文指代消解和日报文本生成默认共用上述 `MODEL_*` 配置。代码仍支持 `AGENT_MODEL_*`、`DAILY_REPORT_MODEL_*` 作为可选的角色级覆盖，但常规单模型部署无需配置。旧版 `QWEN_*`、`DEEPSEEK_*` 仅用于向后兼容，不建议新部署继续使用。

视觉模型独立配置，不复用文本模型：

```bash
VISION_MODEL_NAME=qwen2.5-vl-72b-instruct
VISION_MODEL_API_URL=...
VISION_MODEL_API_KEY=...
```

上下文指代消解发生在记忆召回之前：边防 QA 的连续追问会使用它；边防日报虽然关闭记忆读写，但任务仍可能使用近期上下文做指代消解。模型调用失败时保留原问题继续执行，不阻断主流程。

Embedding（Ollama）：

```bash
GTE_API_BASE=http://127.0.0.1:11434/v1
GTE_MODEL=qwen3-embedding:0.6b
GTE_API_TIMEOUT_MS=40000
```

本地启动 API 时使用 `127.0.0.1:11434`；API 在 Compose 网络中运行时必须使用服务名 `ollama:11434`。文本大模型和视觉模型是外部推理 API，Ollama 仅承载 Embedding，三者不要混用配置。

---

## 3. 本地开发启动

### 3.1 启动基础设施

```powershell
cd "D:\0 ysq文件\DSI-agent-loop"
docker compose -f docker/docker-compose.infra.yaml up -d
docker compose -f docker/docker-compose.infra.yaml exec ollama ollama pull qwen3-embedding:0.6b
```

这会启动：PostgreSQL（5432）、Redis（6379）、Ollama（11434）、PostGIS（5433）。

### 3.2 安装依赖

```bash
pnpm install
```

### 3.3 启动后端

首次运行先复制 `api/.env.example` 为 `api/.env`，并填写数据库、文本模型、视觉模型和边防 MySQL 配置。

```bash
cd api
pnpm dev
```

默认监听 `http://localhost:3001`。

### 3.4 启动前端

```bash
cd "D:\0 ysq文件\DSI-agent-loop"
pnpm dev
```

默认监听 `http://localhost:5000`。

### 3.5 访问地址

| 页面 | URL |
|------|-----|
| 问数 H5 | `http://localhost:5000/border-defense/qa/h5` |
| 日报 H5 | `http://localhost:5000/border-defense/daily/h5` |
| 后端健康 | `http://localhost:3001/health` |

---

## 4. 数据库迁移

### 4.1 本地开发

```bash
cd api
pnpm db:migrate
```

### 4.2 Docker 首次启动

`docker-compose.yaml` 中 API 容器默认配置 `DB_PUSH_ON_START=true`，容器启动时会自动执行 `drizzle-kit push --force`。该方式适合本地初始化。生产环境建议在 `docker/.env` 设置 `DB_PUSH_ON_START=false`，启动数据库后显式执行版本化迁移：

```bash
# 1. 先只启动数据库和缓存
docker compose --env-file docker/.env -f docker/docker-compose.yaml up -d postgres redis
# 2. 单独跑一个一次性迁移容器
docker compose --env-file docker/.env -f docker/docker-compose.yaml run --rm --no-deps api drizzle-kit migrate
# 3. 数据库迁好后再启动全部服务
docker compose --env-file docker/.env -f docker/docker-compose.yaml up -d
```

容器运行镜像没有全局安装 `pnpm`，因此容器内直接调用 PATH 中的 `drizzle-kit`。已有 API 容器正常运行时也可执行 `docker compose --env-file docker/.env -f docker/docker-compose.yaml exec api drizzle-kit migrate`。

### 4.3 常用迁移文件

| 迁移 | 说明 |
|------|------|
| `0004_memory_p0_p1.sql` | 记忆表（task_conversation_snapshot、episodic_memories） |
| `0005_memory_vector_1024.sql` | 向量维度 1024，适配 qwen3-embedding:0.6b |
| `0006_agent_transcript_memory_recall.sql` | transcript kind 支持 `memory_recall` |

### 4.4 边防 MySQL 初始化

边防问数和日报读取独立的 MySQL 业务库，它不是 PostgreSQL/pgvector。部署时二选一：连接已有 MySQL，或先把交付的 SQL dump 导入新 MySQL，再填写 `BORDER_DEFENSE_DB_*`。

---

## 5. Docker 打包

### 5.1 构建镜像

```bash
cd "D:\0 ysq文件\DSI-agent-loop"

# 全部构建
docker compose --env-file docker/.env -f docker/docker-compose.yaml build

# 仅构建 API
docker build -f docker/Dockerfile --target api -t datasourceintelligence-api:local .

# 仅构建 Web
docker build -f docker/Dockerfile --target web -t datasourceintelligence-web:local .

# 仅构建 Worker
docker build -f docker/Dockerfile --target worker -t datasourceintelligence-worker:local .
```

### 5.2 关键构建参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `NPM_REGISTRY` | `https://registry.npmmirror.com` | npm 镜像 |
| `PNPM_VERSION` | `9.0.0` | pnpm 版本 |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | 前端构建时的 API 地址 |

> `NEXT_PUBLIC_API_URL` 只在构建时注入；若使用 Nginx 反向代理，可留空或设为相对路径。

### 5.3 离线交付镜像

联网构建机可把业务镜像导出后传到部署机；基础镜像也必须在部署机可获取，或一并导出：

```bash
docker save -o datasourceintelligence-images.tar \
  datasourceintelligence-api:local \
  datasourceintelligence-worker:local \
  datasourceintelligence-web:local
docker load -i datasourceintelligence-images.tar
```

**如果部署机只有镜像和 Compose 文件、没有完整仓库，请同时交付 `docker/`、`skills/`，并创建日志/report 目录**；当前 Compose 的 Skill 只读映射依赖宿主机存在完整 `skills/`。

---

## 6. Docker 部署

### 6.1 准备环境文件

复制示例文件并按实际环境修改：

```bash
cp docker/.env.example docker/.env
mkdir -p logs report
```

PowerShell 对应命令为 `Copy-Item docker/.env.example docker/.env`、`New-Item -ItemType Directory -Force logs, report`。不要提交包含密钥的 `docker/.env`。示例文件中的 `ENV_FILE=.env` 不应改回 `.env.example`，否则服务不会读取你刚填写的部署配置。

必须修改的关键项：

```bash
# 大模型
MODEL_API_URL=xxx
MODEL_API_KEY=xxx
MODEL_NAME=xxx

# Embedding（若使用 docker-compose 自带 Ollama，可保持默认）
GTE_API_BASE=
GTE_MODEL=qwen3-embedding:0.6b

# 边防 MySQL
BORDER_DEFENSE_DB_HOST=xxx
BORDER_DEFENSE_DB_PORT=xxx
BORDER_DEFENSE_DB_USER=xxx
BORDER_DEFENSE_DB_PASSWORD=xxx
BORDER_DEFENSE_DB_NAME=xxx

# 可选：PostGIS
GEO_DATABASE_URL=postgresql://postgres:postgres@postgis:5432/show_room
```

生产环境还必须修改 `POSTGRES_PASSWORD`、`DATABASE_URL`、`POSTGIS_PASSWORD` 和 `GEO_DATABASE_URL`，两组 URL 中的账号密码要与数据库变量一致；密码含 `@`、`:`、`/` 等字符时需进行 URL 编码。

### 6.2 启动全量服务

```bash
cd docker
docker compose up -d
```

默认暴露端口：

| 服务 | 容器端口 | 宿主机端口 |
|------|----------|------------|
| Nginx | 80 | `${NGINX_HTTP_PORT:-80}` |
| PostgreSQL | 5432 | `${POSTGRES_PORT:-5432}` |
| Redis | 6379 | `${REDIS_PORT:-6379}` |
| Ollama | 11434 | `${OLLAMA_PORT:-11434}` |
| PostGIS | 5432 | `${POSTGIS_PORT:-5433}` |

API、Worker 和 Web 默认不直接发布宿主机端口，由 Nginx 统一入口。首次启动会由 `ollama-init` 拉取 `qwen3-embedding:0.6b`，API/Worker 会等待拉取成功；可用 `docker compose exec ollama ollama list` 检查模型。

### 6.3 Nginx 入口

- Web：`http://<host>/`
- Web 服务健康：`http://<host>/api/health`
- API 健康：`http://<host>/health`
- SSE 流：`http://<host>/sse/`
- 任务接口：`http://<host>/tasks/`

### 6.4 查看日志

```bash
# 全部服务
docker compose logs -f

# API
docker compose logs -f api

# Worker
docker compose logs -f worker

# Web
docker compose logs -f web
```

---

## 7. 持久化目录映射

为了在容器重建后保留 Agent 文件日志、日报文件，并支持宿主机直接查看，已配置以下卷映射。默认路径相对于仓库根目录，可在 `docker/.env` 改为绝对路径：

| 容器路径 | 宿主机路径 | 说明 |
|----------|------------|------|
| `/app/logs` | `${HOST_LOG_DIR:-../logs}` | Agent Loop JSONL 文件日志 |
| `/app/report` | `${HOST_REPORT_DIR:-../report}` | 日报生成的 docx / md / png |
| `/app/skills` | `${HOST_SKILLS_DIR:-../skills}` | Skill 规则、SQL、模板（只读） |

已在以下文件中配置：

- `docker/docker-compose.yaml`：api / worker 添加日志、report 和 Skill 映射
- `docker/Dockerfile`：web / api-base stage 中 `mkdir -p /app/logs /app/report`
- `docker/.env.example`：默认 `AGENT_WORKSPACE_ROOT=/app`、`AGENT_LOOP_LOG_DIR=/app/logs`、`DAILY_REPORT_OUTPUT_DIR=/app/report`

> `docker compose logs` 展示的是容器 stdout/stderr，不写入 `/app/logs`。Compose 已为这类日志配置 `json-file` 轮转，默认单文件 20 MB、保留 5 个，可通过 `DOCKER_LOG_MAX_SIZE` / `DOCKER_LOG_MAX_FILE` 调整。

PostgreSQL、Redis、Ollama 和 PostGIS 使用 Docker named volume（`postgres_data`、`redis_data`、`ollama_data`、`postgis_data`），同样会跨容器重建保留。`docker compose down` 不删除它们，`docker compose down -v` 会永久删除数据库和本地模型，生产环境禁止随意执行后者。

---

## 8. 关键配置说明

### 8.1 记忆系统

```bash
# 启用会话摘要记忆
AGENT_MEMORY_SESSION_SUMMARY=1

# 向量记忆权重
AGENT_MEMORY_DECAY_LAMBDA=0.1
AGENT_MEMORY_VECTOR_WEIGHT=0.6
AGENT_MEMORY_KEYWORD_WEIGHT=0.3
AGENT_MEMORY_ENTITY_WEIGHT=0.1
```

### 8.2 Agent Loop 日志

```bash
# 日志目录（容器内）
AGENT_LOOP_LOG_DIR=/app/logs

# debug = 完整 JSONL；operational = 安全摘要
AGENT_LOOP_LOG_MODE=debug

# 本地 JSONL 保留天数
AGENT_LOOP_LOG_RETENTION_DAYS=14
```

### 8.3 日报输出

日报生成器会把 `.docx`、`.md` 和图表 `.png` 写到 `DAILY_REPORT_OUTPUT_DIR` 目录。前端通过 `/tasks/:taskId/daily-report/download` 下载 docx。

API 启动时及每天会清理过期报告，默认保留 30 天：

```bash
DAILY_REPORT_CLEANUP_ENABLED=1
DAILY_REPORT_RETAIN_DAYS=30
```

如果 report 另有归档/审计要求，应调大保留期或关闭清理任务，并在宿主机配置独立备份。

### 8.4 数据与模型备份

建议使用逻辑备份，不要仅复制正在运行的数据库卷：

```bash
mkdir -p backups
docker compose --env-file docker/.env -f docker/docker-compose.yaml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backups/datasource.dump
docker compose --env-file docker/.env -f docker/docker-compose.yaml exec -T postgis \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backups/show_room.dump

# 恢复到已创建的空库
docker compose --env-file docker/.env -f docker/docker-compose.yaml exec -T postgres \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' \
  < backups/datasource.dump
```

另行备份边防 MySQL（`mysqldump --single-transaction`）、`HOST_REPORT_DIR` 以及必要的 `HOST_LOG_DIR`。Ollama 模型保存在 `ollama_data`，通常可重新拉取；内网环境则应提前备份该卷或准备离线模型分发方案。

---

## 9. 常见问题

### 9.1 前端页面 404

- 检查 `NEXT_PUBLIC_API_URL` 是否指向正确后端。
- 确认前端页面路由存在：`src/app/border-defense/qa/h5/page.tsx`、`src/app/border-defense/daily/h5/page.tsx`。
- 若通过 Nginx 访问，检查 `nginx.conf` 的 `/` location 是否正确代理到 web 服务。

### 9.2 后端 `/api/agent/daily-report` 404

- 确认 API 容器内的 `qaRoutes` 已挂载到 `/api/agent`。
- 检查是否存在 `BORDER_DEFENSE_DB_*` 配置导致路由未注册。

### 9.3 模型调用失败

- 检查 `MODEL_API_URL`、`MODEL_API_KEY`、`MODEL_NAME` 是否正确。
- 查看 API 日志中的 `[ModelAdapter]` 或 `[AgentLoop]` 错误。

### 9.4 Embedding 失败

- 确认 Ollama 已启动且模型已拉取：`docker compose exec ollama ollama pull qwen3-embedding:0.6b`。
- 检查 `GTE_API_BASE` 是否可达。

### 9.5 数据库迁移失败

- 确认 PostgreSQL 已启用 vector 扩展。
- 手动进入容器执行：`docker compose exec api drizzle-kit migrate`。

### 9.6 日志/日报文件未持久化

- 检查 `HOST_LOG_DIR`、`HOST_REPORT_DIR` 指向的宿主机目录权限。
- 检查容器内环境变量 `AGENT_LOOP_LOG_DIR`、`DAILY_REPORT_OUTPUT_DIR` 是否指向 `/app/logs`、`/app/report`。
- 检查映射是否生效：`docker inspect ds_api --format '{{json .Mounts}}'`。

### 9.7 边防 MySQL 连接失败

- 在 API 容器内检查 DNS/端口：`docker compose exec api nc -vz <mysql-host> 3306`。
- MySQL 在宿主机时使用 `host.docker.internal`，不要在容器中使用 `127.0.0.1`。
- 确认 MySQL 账号允许来自 Docker 网段的连接，并仅授予所需库的只读权限。
- 检查库名和字符集，确认只导入了目标版本的 dump。

---

## 10. 更新 Skill

边防业务规则、SQL 和模板位于：

- `skills/border-defense-qa/SKILL.md`
- `skills/border-defense-daily-report/sql/*.sql`
- `skills/border-defense-daily-report/templates/*.md`
- `skills/border-defense-daily-report/config/field-labels.json`

Docker 部署时，`/app/skills` 默认映射为宿主机 `HOST_SKILLS_DIR` 的只读卷。修改 Skill 文件后，**重启 API / Worker 容器即可生效**，无需重新构建镜像：

```bash
docker compose restart api worker
```

---

## 11. 生产部署 checklist

- [ ] 修改 `docker/.env`，填入真实的大模型 KEY、MySQL 连接、PostGIS 连接
- [ ] 修改 PostgreSQL/PostGIS 默认密码，并同步更新连接 URL
- [ ] 关闭 `DB_PUSH_ON_START`，改为容器内手动执行 `drizzle-kit migrate`
- [ ] 验证边防 MySQL dump 版本、字符集、只读账号及网络连通性
- [ ] 配置 Nginx 域名、HTTPS、客户端真实 IP 透传
- [ ] 确保 `HOST_LOG_DIR`、`HOST_REPORT_DIR`、`HOST_SKILLS_DIR` 存在且权限正确
- [ ] 确认 Docker 日志轮转、Agent JSONL 保留期、日报清理和备份策略
- [ ] 配置 Ollama 模型持久化卷 `ollama_data`
- [ ] 验证 PostgreSQL/PostGIS/MySQL 备份和恢复流程
- [ ] 生产防火墙不要向公网开放 5432、5433、6379、11434
- [ ] 根据 GPU/内存调整 Ollama 的 `deploy.resources.limits`
- [ ] 测试 `/health`、`/api/health`、问数页面、日报页面是否正常

---

## 12. 参考命令速查

```bash
# 本地开发
pnpm install
pnpm dev                          # 前端
pnpm --filter api dev             # 后端
pnpm --filter api db:migrate      # 数据库迁移
pnpm ts-check                     # TypeScript 检查
pnpm build                        # 生产构建

# Docker
docker compose -f docker/docker-compose.infra.yaml up -d
docker compose --env-file docker/.env -f docker/docker-compose.yaml up -d --build
docker compose --env-file docker/.env -f docker/docker-compose.yaml build --no-cache
docker compose --env-file docker/.env -f docker/docker-compose.yaml config --quiet
docker compose --env-file docker/.env -f docker/docker-compose.yaml logs -f api
docker compose --env-file docker/.env -f docker/docker-compose.yaml restart api worker web
```
