# Docker TSX 启动失败问题分析

> 创建时间: 2026-04-27
> 相关文件:
> - `docker/Dockerfile`
> - `docker/docker-compose.yaml`
> - `docker/entrypoint.sh`
> - `api/package.json`
> - `api/tsconfig.json`
> - `packages/shared/package.json`
> - `packages/shared/tsconfig.json`

---

## 问题描述

API 服务在 Docker 容器中启动时，tsx 无法正确解析 TypeScript 配置，导致容器启动失败。

---

## 根因分析

### 1. tsx 版本不一致（最可能的主因）

| 位置 | tsx 版本 | 说明 |
|------|---------|------|
| `Dockerfile:26` | `tsx@4.21.0` | 全局安装 |
| `api/package.json:41` | `tsx@^4.19.2` | 项目 devDependency |
| 根 `package.json:92` | `tsx@^4.19.2` | 项目 devDependency |

全局 tsx 4.21.0 与项目内 4.19.x 行为可能有差异，特别是在 `"module": "NodeNext"` + `"type": "module"` 配置下解析 `.js` -> `.ts` 导入时。

### 2. `tsx watch` 在 Docker bind mount 下不可靠

`Dockerfile:51` 和 `Dockerfile:64` 使用 `tsx watch`：
```dockerfile
CMD ["tsx", "watch", "src/index.ts"]
CMD ["tsx", "watch", "src/worker.ts"]
```

`tsx watch` 依赖 Node.js `fs.watch()`。在 Docker Desktop for Windows 的 bind mount 下，文件系统事件**不可靠或完全丢失**，导致 tsx 崩溃或无法检测文件变化。

### 3. 全局安装的 tsx 与 pnpm workspace 兼容性存疑

全局 tsx 使用全局模块解析策略，但 `@datasourceintelligence/shared` 是 `workspace:*` 协议依赖。虽然 `node-linker=hoisted` 已将依赖提升到根 `node_modules`，全局 tsx 在解析 ESM 路径时仍可能与 pnpm 的 workspace 链接行为冲突。

### 4. `packages/shared` dist 目录与本地源码不同步

`Dockerfile:36` 构建时编译了共享包：
```dockerfile
RUN npx tsc -p packages/shared/tsconfig.json
```

但 `docker-compose.yaml:71-72` 只挂载了源码：
```yaml
volumes:
  - ../api/src:/app/api/src:ro
  - ../packages/shared/src:/app/packages/shared/src:ro
```

本地修改 `packages/shared/src/` 后，容器内的 `packages/shared/dist/` 不会自动更新，导致 `@datasourceintelligence/shared` 的导入指向旧代码。

### 5. ESM + NodeNext 模块解析的已知边界情况

- `api/package.json` 中 `"type": "module"`
- 源码中所有 import 使用 `.js` 扩展名
- tsx 在 ESM 模式下需要将这些 `.js` 解析为 `.ts`
- tsx 4.x 某些版本在此配置下存在解析失败的已知问题

---

## 相关代码位置

**版本冲突点：**
```dockerfile
# Dockerfile:26
RUN npm install -g tsx@4.21.0 drizzle-kit@0.31.8
```

```json
// api/package.json
"devDependencies": {
  "tsx": "^4.19.2",
  "drizzle-kit": "0.31.8"
}
```

**watch 模式问题点：**
```dockerfile
# Dockerfile:51
CMD ["tsx", "watch", "src/index.ts"]

# Dockerfile:64
CMD ["tsx", "watch", "src/worker.ts"]
```

**共享包编译与挂载不匹配：**
```dockerfile
# Dockerfile:36
RUN npx tsc -p packages/shared/tsconfig.json
```

```yaml
# docker-compose.yaml:70-72
volumes:
  - ../api/src:/app/api/src:ro
  - ../packages/shared/src:/app/packages/shared/src:ro
```

---

## 修复方案

### 方案 A：最小改动修复（推荐先验证）

1. **统一 tsx 版本**，移除全局安装，改用项目内 tsx：
   - 删除 Dockerfile 中的 `RUN npm install -g tsx@4.21.0`
   - tsx 和 drizzle-kit 已在 `api/package.json` 中声明

2. **将 tsx 和 drizzle-kit 移到 api/package.json 的 dependencies**：
   ```json
   "dependencies": {
     "tsx": "^4.19.2",
     "drizzle-kit": "^0.31.8"
   }
   ```

3. **使用 `node --import=tsx` 启动**（TSX 推荐的 ESM 方式）：
   ```dockerfile
   CMD ["node", "--import=tsx", "src/index.ts"]
   ```

4. **开发模式禁用 `tsx watch` 或加轮询**：
   - 在 docker-compose 中使用 `node --import=tsx --watch`
   - 或设置 `CHOKIDAR_USEPOLLING=true`

5. **docker-compose.yaml 补充挂载 tsconfig 和 package.json**：
   ```yaml
   volumes:
     - ../api/src:/app/api/src:ro
     - ../api/tsconfig.json:/app/api/tsconfig.json:ro
     - ../api/package.json:/app/api/package.json:ro
     - ../packages/shared/src:/app/packages/shared/src:ro
     - ../packages/shared/tsconfig.json:/app/packages/shared/tsconfig.json:ro
     - ../packages/shared/package.json:/app/packages/shared/package.json:ro
   ```

### 方案 B：彻底重构 Docker 启动方式

将开发模式与生产模式完全分离：

```
docker/
├── Dockerfile              # 生产镜像（编译后的 dist）
├── Dockerfile.dev          # 开发镜像（tsx 运行时）
├── docker-compose.yaml     # 生产编排
├── docker-compose.dev.yaml # 开发编排
└── entrypoint.sh
```

**生产 Dockerfile**（无 tsx，预编译）：
```dockerfile
FROM node:20-alpine AS builder
RUN npm install -g pnpm@9.0.0
WORKDIR /app
COPY . .
RUN pnpm install
RUN pnpm -r build           # 编译 api 和 shared
RUN pnpm --filter=api deploy --prod /prod/api

FROM node:20-alpine AS api
COPY --from=builder /prod/api /app
CMD ["node", "dist/index.js"]
```

**开发 Dockerfile**：
```dockerfile
FROM node:20-alpine
RUN npm install -g pnpm@9.0.0
WORKDIR /app
COPY . .
RUN pnpm install
WORKDIR /app/api
CMD ["pnpm", "dev"]         # 使用 api/package.json 中定义的脚本
```

---

## 实施优先级

| 优先级 | 操作 | 原因 |
|--------|------|------|
| P0 | 统一 tsx 版本（全局删除，改用项目内） | 消除版本不一致导致的解析差异 |
| P0 | 将 tsx/drizzle-kit 移到 api dependencies | 确保 Docker 构建时一定安装 |
| P1 | 改用 `node --import=tsx` 启动 | ESM 推荐的稳定启动方式 |
| P1 | 开发模式禁用 `tsx watch` 或加 `CHOKIDAR_USEPOLLING=true` | 解决 Docker bind mount 下文件系统事件不可靠 |
| P2 | docker-compose 补充挂载 tsconfig/package.json | 确保容器内配置与本地一致 |
| P2 | 分离生产/开发 Dockerfile | 长期维护性 |

---

## 验证步骤

1. 修改后运行 `docker-compose build --no-cache api`
2. 启动服务 `docker-compose up api`
3. 检查日志确认无 tsx 解析错误
4. 测试 API 健康检查端点 `curl http://localhost:3001/health`
5. 修改本地 `api/src/index.ts` 代码，确认热重载是否正常工作（如使用 watch 模式）
