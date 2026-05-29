# ============================================
# 数智融合智能体 - API 服务 Docker 镜像
# ============================================

ARG NODE_IMAGE=node:20-alpine
FROM ${NODE_IMAGE} AS base

# 安装 pnpm（项目要求 9.0.0+）
RUN npm install -g pnpm@9.0.0

WORKDIR /app

# 1. 先复制 workspace 配置和 lock 文件（利用 Docker layer cache）
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared/package.json packages/shared/
COPY api/package.json api/

# 2. 安装依赖
# node-linker=hoisted: 扁平化 node_modules，解决 Docker overlayfs 下的 symlink 问题
RUN printf 'node-linker=hoisted\n' > .npmrc && \
    if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile; else pnpm install; fi

# 3. 全局安装 tsx 和 drizzle-kit
# 原因：pnpm 的 .bin wrapper 在 hoisted 模式下使用 `../tsx` 相对路径，
# 指向的是子目录 node_modules，但我们删除了它。全局安装绕过这个问题。
RUN npm install -g tsx@4.21.0 drizzle-kit@0.31.8

# 4. 删除子目录 node_modules，避免 COPY 源码时与已存在的目录冲突
RUN rm -rf api/node_modules packages/shared/node_modules

# 5. 复制源码
COPY packages/shared/ packages/shared/
COPY api/ api/

# 6. 编译共享类型包
RUN npx tsc -p packages/shared/tsconfig.json

# ============================================
# API 服务阶段
# ============================================
FROM base AS api

WORKDIR /app/api

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3001

ENTRYPOINT ["/entrypoint.sh"]
CMD ["tsx", "watch", "src/index.ts"]

# ============================================
# Worker 阶段
# ============================================
FROM base AS worker

WORKDIR /app/api

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["tsx", "watch", "src/worker.ts"]
