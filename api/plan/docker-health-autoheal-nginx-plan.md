# Docker 健康检查、Autoheal 与 Nginx 反向代理实施计划

> **给执行 Agent 的要求：**按任务执行时使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`。每一步使用复选框跟踪进度。

**目标：**将现有 Docker 部署升级为“Compose 编排 + 前后端健康检查 + unhealthy 自动重启 + Nginx 单入口反向代理”的服务器部署形态。

**架构：**继续复用 `docker/Dockerfile` 的多阶段 target：`web` 运行 Next.js 自定义 server，`api` 运行 Express API，`worker` 运行后台任务。服务器只对外暴露 Nginx，Nginx 在 Docker network 内反代到 `web:5000` 与 `api:3001`。Compose healthcheck 负责标记服务健康状态，`autoheal` 监听 Docker health status 并重启带标签的 unhealthy 容器。

**技术栈：**Docker Compose、Dockerfile multi-stage build、Node 20 Alpine、Next.js 16、Express 5、Nginx Alpine、`willfarrell/autoheal`。

## 全局约束

- 保留现有 `docker/Dockerfile` build targets：`web`、`api`、`worker`。
- 保留 API 容器内端口 `3001`，Web 容器内端口 `5000`。
- 服务器公网入口只暴露 Nginx 的 `${NGINX_HTTP_PORT:-80}`，默认不再直接暴露 `web` 与 `api` 端口。
- Compose healthcheck 只负责标记 `healthy/unhealthy`；自动重启由 `autoheal` 完成。
- Nginx 需要支持 SSE 长连接：`/sse/` 与 `/tasks/*/stream` 不做 buffering。
- 前端浏览器请求后端时使用同源路径，避免公网环境继续访问 `http://localhost:3001`。
- `autoheal=true` label 只加到有 Compose healthcheck 的服务。`worker` 当前没有 HTTP health endpoint，因此保留 `restart: unless-stopped`，本计划不为它添加 autoheal label。
- Web 镜像构建时必须显式传入 `NEXT_PUBLIC_API_URL: "${NEXT_PUBLIC_API_URL:-}"`。否则 Dockerfile 默认值 `http://localhost:3001` 可能被打包进前端产物。
- Nginx 必须转发 API 静态资源路径。`api/src/index.ts` 通过 `express.static(...)` 暴露 `api/public`，当前目录包含 `/local-tiles/` 与 `/satellite/`，并预留 `/uploads/`。

## 评审意见处理结论

- 采纳：`worker` 没有 healthcheck 时不加 `autoheal=true`。
- 采纳：Nginx 补充 API 静态资源路由 `/local-tiles/`、`/satellite/` 和未来 `/uploads/`。
- 采纳：`autoheal` 不使用 `latest`，计划使用 `willfarrell/autoheal:1.2.0`，执行时先验证镜像 tag 可拉取。
- 采纳：`web.build.args.NEXT_PUBLIC_API_URL` 使用空默认值，避免生产构建嵌入 `localhost:3001`。
- 采纳并调整：保留 `rg` 作为首选搜索命令，同时给出 PowerShell 与 POSIX fallback。
- 采纳并调整：真实部署 `.env` 只同步说明，不提交含密钥的真实 env 文件。
- 采纳：Task 1 明确覆盖 `exportInfoCenter()`，该函数当前直接使用旧 `API_BASE`，不走 `fetchJson()`。
- 采纳：Task 2 明确覆盖 `CesiumMap.tsx` 的实体图片 URL 与 overlay base URL。
- 采纳并调整：`docker/.env.example` 保留本地开发默认 `NEXT_PUBLIC_API_URL=http://localhost:3001`，新增 `docker/.env.production.example` 给生产 Nginx 同源部署使用。
- 无需变更：`/agent/` 已在 Nginx 计划中转发到 API。

## 文件职责

- 修改 `src/lib/api.ts`：新增统一 API URL helper，修复 `fetchJson()` 与 `exportInfoCenter()`。
- 修改 `src/hooks/useTaskChat.ts`：将 SSE 地址从硬编码 `localhost:3001` 改为统一 helper。
- 修改 `src/hooks/useRightPanel.ts`：将 SSE 地址从硬编码 `localhost:3001` 改为统一 helper。
- 修改 `src/app/page.tsx`：将页面内 SSE 地址从硬编码 `localhost:3001` 改为统一 helper。
- 修改 `src/components/info-center/useInfoCenterStream.ts`：移除 SSE fallback 中的 `localhost:3001`。
- 修改 `src/components/info-center/InfoTable.tsx`：移除后端 API 地址 fallback 中的 `localhost:3001`。
- 修改 `src/components/cesium/CesiumMap.tsx`：统一图片、任务请求和 overlay 后端地址。
- 新增 `src/app/api/health/route.ts`：Web/Next.js 健康检查接口。
- 新增 `docker/nginx.conf`：Nginx 单入口反向代理配置。
- 修改 `docker/docker-compose.yaml`：新增 `nginx` 与 `autoheal`，将 `web` 和 `api` 默认改为内部暴露。
- 修改 `docker/.env.example`：保留本地开发默认值，并补充 Nginx/autoheal 配置说明。
- 新增 `docker/.env.production.example`：生产 Nginx 同源部署示例。
- 修改 `docker/README.md`：记录生产部署、健康检查、自动恢复与排障命令。

---

## Task 1: 增加统一前端 API URL Helper

**文件：**

- 修改 `src/lib/api.ts`

**接口：**

- 产出 `getApiBase(): string`
- 产出 `apiUrl(path: string): string`
- 产出 `eventSourceUrl(path: string): string`
- 使用 `process.env.NEXT_PUBLIC_API_URL`

- [x] **Step 1: 修改 `src/lib/api.ts` URL helper**

将当前顶层声明：

```ts
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
```

替换为：

```ts
export function getApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  if (typeof window !== "undefined") {
    return "";
  }

  return "http://api:3001";
}

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getApiBase()}${normalizedPath}`;
}

export function eventSourceUrl(path: string): string {
  return apiUrl(path);
}
```

将 `fetchJson()` 中的 URL 构造：

```ts
const url = `${API_BASE}${path}${separator}_t=${Date.now()}`;
```

替换为：

```ts
const url = `${apiUrl(path)}${separator}_t=${Date.now()}`;
```

同时修改 `exportInfoCenter()`。将：

```ts
const res = await fetch(`${API_BASE}/info-center/export?${qs.toString()}`, {
```

替换为：

```ts
const query = qs.toString();
const exportUrl = query ? `${apiUrl("/info-center/export")}?${query}` : apiUrl("/info-center/export");
const res = await fetch(exportUrl, {
```

这一步必须覆盖 `exportInfoCenter()`，因为它不使用 `fetchJson()`，否则仍会保留旧的 `localhost:3001` fallback。

- [x] **Step 2: 运行类型检查**

```bash
pnpm ts-check
```

预期：TypeScript 不出现由 `src/lib/api.ts` 引入的新错误。

- [ ] **Step 3: 提交**

```bash
git add src/lib/api.ts
git commit -m "refactor: centralize frontend api urls"
```

---

## Task 2: 移除前端硬编码 localhost API URL

**文件：**

- 修改 `src/hooks/useTaskChat.ts`
- 修改 `src/hooks/useRightPanel.ts`
- 修改 `src/app/page.tsx`
- 修改 `src/components/info-center/useInfoCenterStream.ts`
- 修改 `src/components/info-center/InfoTable.tsx`
- 修改 `src/components/cesium/CesiumMap.tsx`

**接口：**

- 使用 `eventSourceUrl(path: string): string`
- 使用 `apiUrl(path: string): string`
- 使用 `getApiBase(): string`

- [x] **Step 1: 引入 URL helper**

在创建 `EventSource` 的文件中加入：

```ts
import { eventSourceUrl } from "@/lib/api";
```

在手动拼接 fetch 或图片 API URL 的文件中加入：

```ts
import { apiUrl } from "@/lib/api";
```

`CesiumMap.tsx` 需要：

```ts
import { apiUrl, getApiBase } from "@/lib/api";
```

- [x] **Step 2: 替换 SSE 硬编码 URL**

将：

```ts
new EventSource('http://localhost:3001/sse/global')
```

替换为：

```ts
new EventSource(eventSourceUrl("/sse/global"))
```

将：

```ts
new EventSource(`http://localhost:3001/tasks/${taskId}/stream`)
```

替换为：

```ts
new EventSource(eventSourceUrl(`/tasks/${taskId}/stream`))
```

将：

```ts
new EventSource(`http://localhost:3001/tasks/${sseTaskId}/stream`)
```

替换为：

```ts
new EventSource(eventSourceUrl(`/tasks/${sseTaskId}/stream`))
```

将：

```ts
new EventSource(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/tasks/${agentTaskId}/stream`)
```

替换为：

```ts
new EventSource(eventSourceUrl(`/tasks/${agentTaskId}/stream`))
```

- [x] **Step 3: 替换手动 API base 使用**

在 `src/components/info-center/InfoTable.tsx` 中，将：

```ts
const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const detailUrl = `${apiBase}/tasks/${item.id}`;
const listUrl = `${apiBase}/info-center`;
```

替换为：

```ts
const detailUrl = apiUrl(`/tasks/${item.id}`);
const listUrl = apiUrl("/info-center");
```

在 `src/components/cesium/CesiumMap.tsx` 中，新增本地 helper：

```ts
function resolveBackendImageUrl(rawImg: string | undefined): string | undefined {
  if (!rawImg) return undefined;
  if (rawImg.startsWith("http")) return rawImg;
  return apiUrl(rawImg);
}
```

将基础实体图片 URL：

```ts
const resolvedImageUrl = rawImg
  ? (rawImg.startsWith('http') || rawImg.startsWith('/') ? rawImg : `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}${rawImg}`)
  : undefined;
```

替换为：

```ts
const resolvedImageUrl = resolveBackendImageUrl(rawImg);
```

将事件实体图片 URL：

```ts
const resolvedImageUrl = rawImg
  ? (rawImg.startsWith('http') ? rawImg : `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}${rawImg}`)
  : undefined;
```

替换为：

```ts
const resolvedImageUrl = resolveBackendImageUrl(rawImg);
```

将 overlay base URL：

```ts
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
```

替换为：

```ts
const API_BASE = getApiBase();
```

- [x] **Step 4: 搜索剩余硬编码后端 URL**

首选：

```bash
rg -n "localhost:3001|NEXT_PUBLIC_API_URL \\|\\|" src
```

PowerShell fallback：

```powershell
Get-ChildItem -Path src -Recurse -File | Select-String -Pattern 'localhost:3001|NEXT_PUBLIC_API_URL \|\|'
```

POSIX fallback：

```bash
grep -RInE "localhost:3001|NEXT_PUBLIC_API_URL \\|\\|" src
```

预期：前端运行时代码不再保留 `http://localhost:3001` fallback。

- [x] **Step 5: 运行类型检查**

```bash
pnpm ts-check
```

预期：TypeScript 不出现由本任务修改文件引入的新错误。

- [ ] **Step 6: 提交**

```bash
git add src/lib/api.ts src/hooks/useTaskChat.ts src/hooks/useRightPanel.ts src/app/page.tsx src/components/info-center/useInfoCenterStream.ts src/components/info-center/InfoTable.tsx src/components/cesium/CesiumMap.tsx
git commit -m "fix: use same-origin api urls for docker deployment"
```

---

## Task 3: 新增 Web 健康检查接口

**文件：**

- 新增 `src/app/api/health/route.ts`

**接口：**

- 产出 `GET /api/health`

- [x] **Step 1: 创建 `src/app/api/health/route.ts`**

```ts
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    status: "ok",
    service: "datasourceintelligence-web",
    timestamp: new Date().toISOString(),
  });
}
```

- [x] **Step 2: 运行类型检查**

```bash
pnpm ts-check
```

- [ ] **Step 3: 提交**

```bash
git add src/app/api/health/route.ts
git commit -m "feat: add web health endpoint"
```

---

## Task 4: 新增 Nginx 反向代理

**文件：**

- 新增 `docker/nginx.conf`

**接口：**

- `GET /api/health` 转发到 `web:5000/api/health`
- `GET /health` 转发到 `api:3001/health`
- 前端页面路由转发到 `web:5000`
- 后端路由 `/tasks/`、`/info-center`、`/sse/`、`/agent/`、`/dashboard` 转发到 `api:3001`
- API 静态资源 `/local-tiles/`、`/satellite/`、`/uploads/` 转发到 `api:3001`

- [x] **Step 1: 创建 `docker/nginx.conf`**

```nginx
events {}

http {
  upstream datasource_web {
    server web:5000;
  }

  upstream datasource_api {
    server api:3001;
  }

  map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
  }

  server {
    listen 80;
    server_name _;

    client_max_body_size 20m;

    location = /nginx-health {
      access_log off;
      return 204;
    }

    location = /api/health {
      proxy_pass http://datasource_web/api/health;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

    location = /health {
      proxy_pass http://datasource_api/health;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /sse/ {
      proxy_pass http://datasource_api;
      proxy_http_version 1.1;
      proxy_buffering off;
      proxy_cache off;
      proxy_read_timeout 1h;
      proxy_send_timeout 1h;
      proxy_set_header Connection '';
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /tasks/ {
      proxy_pass http://datasource_api;
      proxy_http_version 1.1;
      proxy_buffering off;
      proxy_cache off;
      proxy_read_timeout 1h;
      proxy_send_timeout 1h;
      proxy_set_header Connection '';
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /info-center {
      proxy_pass http://datasource_api;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /agent/ {
      proxy_pass http://datasource_api;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /dashboard {
      proxy_pass http://datasource_api;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /local-tiles/ {
      proxy_pass http://datasource_api;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /satellite/ {
      proxy_pass http://datasource_api;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /uploads/ {
      proxy_pass http://datasource_api;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
      proxy_pass http://datasource_web;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }
  }
}
```

- [x] **Step 2: 校验 Nginx 配置**

从仓库根目录执行。

Linux/macOS/Git Bash：

```bash
docker run --rm --add-host web:127.0.0.1 --add-host api:127.0.0.1 -v "$(pwd)/docker/nginx.conf:/etc/nginx/nginx.conf:ro" nginx:1.27-alpine nginx -t
```

Windows PowerShell：

```powershell
docker run --rm --add-host web:127.0.0.1 --add-host api:127.0.0.1 -v "${PWD}\docker\nginx.conf:/etc/nginx/nginx.conf:ro" nginx:1.27-alpine nginx -t
```

预期输出包含：

```text
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

- [ ] **Step 3: 提交**

```bash
git add docker/nginx.conf
git commit -m "feat: add nginx reverse proxy config"
```

---

## Task 5: 更新 Compose，加入 Nginx 与 Autoheal

**文件：**

- 修改 `docker/docker-compose.yaml`

**接口：**

- 产出 `nginx` 服务作为公网入口
- 产出 `autoheal` 服务重启 unhealthy 且带 label 的容器
- 使用 `docker/nginx.conf`
- 使用 Task 3 的 Web `/api/health` 与现有 API `/health`

- [x] **Step 1: 移除 `api` 与 `web` 的默认宿主机暴露**

将 `api`：

```yaml
    ports:
      - "${API_PORT:-3001}:3001"
```

替换为：

```yaml
    expose:
      - "3001"
```

将 `web`：

```yaml
    ports:
      - "${WEB_PORT:-5000}:5000"
```

替换为：

```yaml
    expose:
      - "5000"
```

- [x] **Step 2: 清空 Web 构建期公开 API URL**

将 `web.build.args` 中的：

```yaml
        NEXT_PUBLIC_API_URL: "${NEXT_PUBLIC_API_URL:-http://localhost:3001}"
```

替换为：

```yaml
        NEXT_PUBLIC_API_URL: "${NEXT_PUBLIC_API_URL:-}"
```

将 `web.environment` 中的：

```yaml
      NEXT_PUBLIC_API_URL: "${NEXT_PUBLIC_API_URL:-http://localhost:3001}"
```

替换为：

```yaml
      NEXT_PUBLIC_API_URL: "${NEXT_PUBLIC_API_URL:-}"
```

- [x] **Step 3: 只给有 healthcheck 的应用服务加 autoheal label**

给 `api` 和 `web` 添加：

```yaml
    labels:
      autoheal: "true"
```

不要给 `worker` 添加该 label。`worker` 当前没有 healthcheck，autoheal 无法观察到 `unhealthy` 状态。

- [x] **Step 4: 将 Web healthcheck 改为 `/api/health`**

将：

```yaml
          "node -e \"fetch('http://127.0.0.1:5000').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"",
```

替换为：

```yaml
          "node -e \"fetch('http://127.0.0.1:5000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"",
```

- [x] **Step 5: 在 `web` 后添加 `nginx` 服务**

```yaml
  nginx:
    image: nginx:1.27-alpine
    container_name: ds_nginx
    restart: unless-stopped
    ports:
      - "${NGINX_HTTP_PORT:-80}:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      api:
        condition: service_healthy
      web:
        condition: service_healthy
    healthcheck:
      test:
        [
          "CMD-SHELL",
          "wget -qO- http://127.0.0.1/api/health >/dev/null && wget -qO- http://127.0.0.1/health >/dev/null",
        ]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 20s
    labels:
      autoheal: "true"
    networks:
      - ds_network
```

- [x] **Step 6: 在 `nginx` 后添加 `autoheal` 服务**

```yaml
  autoheal:
    image: willfarrell/autoheal:1.2.0
    container_name: ds_autoheal
    restart: unless-stopped
    environment:
      AUTOHEAL_CONTAINER_LABEL: autoheal
      AUTOHEAL_INTERVAL: "${AUTOHEAL_INTERVAL:-10}"
      AUTOHEAL_START_PERIOD: "${AUTOHEAL_START_PERIOD:-60}"
      AUTOHEAL_DEFAULT_STOP_TIMEOUT: "${AUTOHEAL_DEFAULT_STOP_TIMEOUT:-10}"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    networks:
      - ds_network
```

- [x] **Step 7: 校验 Compose 配置**

先验证固定的 autoheal 镜像 tag 可用：

```bash
docker pull willfarrell/autoheal:1.2.0
```

再执行：

```bash
docker compose --env-file docker/.env.production.example -f docker/docker-compose.yaml config
```

- [ ] **Step 8: 提交**

```bash
git add docker/docker-compose.yaml
git commit -m "feat: add nginx and autoheal to compose"
```

---

## Task 6: 拆分本地与生产 Docker 环境示例

**文件：**

- 修改 `docker/.env.example`
- 新增 `docker/.env.production.example`

**接口：**

- 本地/开发默认保留 `NEXT_PUBLIC_API_URL=http://localhost:3001`
- 生产 Nginx 默认设置 `NEXT_PUBLIC_API_URL=`
- 记录 Nginx 与 autoheal 环境变量

- [x] **Step 1: 保留 `docker/.env.example` 的本地 API 默认值**

不要清空：

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:3001
```

将注释改为：

```dotenv
# Public browser-facing API URL.
# Local/dev default keeps direct API access. Production Nginx deployment should
# use docker/.env.production.example, where this value is intentionally empty.
NEXT_PUBLIC_API_URL=http://localhost:3001
```

补充：

```dotenv
ENV_FILE=.env.example

# Nginx entrypoint. For local use, 8080 avoids common host port 80 conflicts.
NGINX_HTTP_PORT=8080

# Autoheal settings
AUTOHEAL_INTERVAL=10
AUTOHEAL_START_PERIOD=60
AUTOHEAL_DEFAULT_STOP_TIMEOUT=10
```

- [x] **Step 2: 创建 `docker/.env.production.example`**

复制 `docker/.env.example` 后修改：

```dotenv
ENV_FILE=.env.production.example

# Production public entrypoint.
NGINX_HTTP_PORT=80

# Production browser-facing API URL.
# Empty means same-origin requests through Nginx.
NEXT_PUBLIC_API_URL=
```

从 `docker/.env.production.example` 移除 `WEB_PORT` 和 `API_PORT`。生产 Compose 应只发布 Nginx 作为应用入口。只有服务器运维确实需要宿主机访问数据库时，才保留 `POSTGRES_PORT` 和 `REDIS_PORT`。

- [x] **Step 3: 记录真实部署 env 同步说明**

在两个 env 示例中加入：

```dotenv
# Deployment note:
# Apply the same NGINX_HTTP_PORT, NEXT_PUBLIC_API_URL, and AUTOHEAL_* changes
# to the real server env file before rebuilding. Do not commit secrets-bearing
# .env files.
```

- [ ] **Step 4: 提交**

```bash
git add docker/.env.example docker/.env.production.example
git commit -m "docs: split local and production docker env examples"
```

---

## Task 7: 更新 Docker 部署文档

**文件：**

- 修改 `docker/README.md`

**接口：**

- 记录部署、健康检查与自动恢复排障命令

- [ ] **Step 1: 添加生产部署说明**

在 `docker/README.md` 顶部附近添加：

```md
## 生产部署：Nginx + Healthcheck + Autoheal

推荐在服务器上通过根目录入口启动：

```bash
cp docker/.env.production.example docker/.env.production
# 填写 docker/.env.production 中的密钥后启动：
docker compose --env-file docker/.env.production -f docker/docker-compose.yaml up -d --build
```

生产入口为 Nginx：

- Web: `http://服务器地址/`
- Web 健康检查: `http://服务器地址/api/health`
- API 健康检查: `http://服务器地址/health`
- API 任务接口: `http://服务器地址/tasks/...`
- API 信息中心: `http://服务器地址/info-center`
- SSE: `http://服务器地址/sse/global` 与 `http://服务器地址/tasks/<taskId>/stream`

`web` 和 `api` 默认只在 Docker network 内暴露，不直接发布宿主机端口。容器变为 `unhealthy` 后，`autoheal` 会自动重启带有 `autoheal=true` label 的容器。

`worker` 暂不添加 `autoheal=true` label，因为它当前没有 healthcheck。进程退出时仍由 `restart: unless-stopped` 拉起。

API 静态资源 `/local-tiles/`、`/satellite/` 和未来 `/uploads/` 会通过 Nginx 转发到 API 容器。
```

- [ ] **Step 2: 添加健康检查与排障命令**

```md
## 健康检查与自动恢复排障

查看所有容器健康状态：

```bash
docker compose ps
```

查看某个容器的 healthcheck 细节：

```bash
docker inspect --format='{{json .State.Health}}' ds_web
docker inspect --format='{{json .State.Health}}' ds_api
docker inspect --format='{{json .State.Health}}' ds_nginx
```

查看 autoheal 日志：

```bash
docker compose logs -f autoheal
```

手动模拟 API 进程退出后的恢复流程：

```bash
docker compose exec api sh -lc "kill 1"
docker compose ps
docker compose logs -f autoheal
```

`restart: unless-stopped` 会在进程退出后重启容器；`autoheal` 负责在 healthcheck 失败但进程仍存在时重启容器。
```

- [ ] **Step 3: 提交**

```bash
git add docker/README.md
git commit -m "docs: add docker health deployment guide"
```

---

## Task 8: 全栈验证

**文件：**

- 仅测试

- [ ] **Step 1: 构建并启动服务**

```bash
docker compose --env-file docker/.env.production.example -f docker/docker-compose.yaml up -d --build
```

预期：`postgres`、`redis`、`api`、`worker`、`web`、`nginx`、`autoheal` 启动成功。

- [ ] **Step 2: 检查 Compose 服务健康状态**

```bash
docker compose ps
```

预期：`ds_api`、`ds_web`、`ds_nginx` 显示 healthy。

- [ ] **Step 3: 检查公网健康接口**

```bash
curl -fsS http://127.0.0.1:${NGINX_HTTP_PORT:-80}/api/health
curl -fsS http://127.0.0.1:${NGINX_HTTP_PORT:-80}/health
```

预期分别返回 Web 与 API 健康 JSON。

- [ ] **Step 4: 验证不需要直接暴露 API/Web 端口**

首选：

```bash
docker compose -f docker/docker-compose.yaml config | rg "3001:3001|5000:5000"
```

POSIX fallback：

```bash
docker compose -f docker/docker-compose.yaml config > /tmp/dsi-compose-rendered.yaml
grep -nE "3001:3001|5000:5000" /tmp/dsi-compose-rendered.yaml
```

Windows PowerShell：

```powershell
docker compose -f docker/docker-compose.yaml config | Select-String -Pattern '3001:3001|5000:5000'
```

预期：无输出。

- [ ] **Step 5: 验证 autoheal 行为**

临时将 `web.healthcheck.test` 改为访问不存在的路径：

```yaml
healthcheck:
  test:
    [
      "CMD-SHELL",
      "node -e \"fetch('http://127.0.0.1:5000/__force-health-fail').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"",
    ]
```

应用并观察：

```bash
docker compose up -d web
docker compose logs -f autoheal
```

预期：autoheal 日志显示 `ds_web` unhealthy 并重启。

测试后立即恢复为 `/api/health`：

```yaml
healthcheck:
  test:
    [
      "CMD-SHELL",
      "node -e \"fetch('http://127.0.0.1:5000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"",
    ]
```

再执行：

```bash
docker compose up -d web
docker compose ps
```

预期：`ds_web` 回到 healthy。

---

## 自检

- Compose：Task 5 更新 `docker/docker-compose.yaml`。
- 健康检查：Task 3 新增 Web `/api/health`，现有 API `/health` 保持不变。
- Autoheal：Task 5 使用固定 `willfarrell/autoheal:1.2.0`，并只给有 healthcheck 的服务加 label。
- Nginx：Task 4 新增 `docker/nginx.conf`，Task 5 接入 Compose。
- API 静态资源：Task 4 将 `/local-tiles/`、`/satellite/`、`/uploads/` 转发到 API。
- Dockerfile：计划保留现有 `web`、`api`、`worker` target。
- 构建期 API URL：Task 5 清空 `web.build.args.NEXT_PUBLIC_API_URL` 默认值，避免嵌入 `localhost:3001`。
- 导出接口 URL：Task 1 明确将 `exportInfoCenter()` 改为使用 `apiUrl("/info-center/export")`。
- Cesium API URL：Task 2 明确替换 `CesiumMap.tsx` 的实体图片 URL fallback 与 overlay `API_BASE`。
- 环境示例：Task 6 保留 `docker/.env.example` 的本地友好默认值，并新增 `docker/.env.production.example`。
