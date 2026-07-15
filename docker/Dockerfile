# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:20-alpine
ARG PNPM_VERSION=9.0.0
ARG NPM_REGISTRY=https://registry.npmmirror.com

FROM ${NODE_IMAGE} AS deps

RUN apk add --no-cache libc6-compat netcat-openbsd

ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm config set registry ${NPM_REGISTRY} \
  && npm install -g pnpm@${PNPM_VERSION}

WORKDIR /app

COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches/ patches/
COPY api/package.json api/package.json
COPY packages/shared/package.json packages/shared/package.json

# Hoisting avoids pnpm symlink/bin-wrapper edge cases in Docker images.
RUN --mount=type=cache,id=datasourceintelligence-pnpm-store,target=/pnpm/store \
  printf '\nnode-linker=hoisted\nstore-dir=/pnpm/store\nfetch-retries=5\nfetch-retry-factor=2\nfetch-retry-mintimeout=10000\nfetch-retry-maxtimeout=120000\nfetch-timeout=120000\nnetwork-concurrency=8\n' >> .npmrc \
  && pnpm install --frozen-lockfile --prefer-offline

FROM deps AS source

COPY babel.config.js components.json eslint.config.mjs next.config.ts postcss.config.mjs tsconfig.json ./
COPY shims/ shims/
COPY scripts/ scripts/
COPY public/ public/
COPY src/ src/
COPY packages/ packages/
COPY api/ api/
COPY skills/ skills/

RUN pnpm --filter @datasourceintelligence/shared build

FROM source AS api-build

RUN pnpm --filter @datasourceintelligence/api build

FROM source AS web-build

ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN pnpm copy-cesium \
  && pnpm copy-fallback-images \
  && pnpm exec next build --webpack \
  && pnpm exec tsup src/server.ts --format cjs --platform node --target node20 --outDir dist --no-splitting --no-minify

FROM ${NODE_IMAGE} AS runtime

RUN apk add --no-cache libc6-compat netcat-openbsd

ENV PATH="/app/node_modules/.bin:/app/api/node_modules/.bin:${PATH}"
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

COPY --from=source /app/node_modules ./node_modules
COPY --from=source /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=source /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=source /app/packages/shared/dist ./packages/shared/dist

FROM runtime AS web

ENV COZE_PROJECT_ENV=PROD
ENV HOSTNAME=0.0.0.0
ENV PORT=5000

COPY --from=web-build /app/.next ./.next
COPY --from=web-build /app/dist ./dist
COPY --from=web-build /app/public ./public
COPY --from=web-build /app/next.config.ts ./next.config.ts
COPY --from=web-build /app/shims ./shims

EXPOSE 5000

CMD ["node", "dist/server.js"]

FROM runtime AS api-base

COPY --from=api-build /app/api/package.json ./api/package.json
COPY --from=api-build /app/api/dist ./api/dist
COPY --from=api-build /app/api/public ./api/public
COPY --from=api-build /app/api/drizzle.config.ts ./api/drizzle.config.ts
COPY --from=api-build /app/api/src/db ./api/src/db
COPY --from=api-build /app/skills ./skills
COPY docker/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh

WORKDIR /app/api

ENTRYPOINT ["/entrypoint.sh"]

FROM api-base AS api

EXPOSE 3001

CMD ["node", "dist/index.js"]

FROM api-base AS worker

CMD ["node", "dist/worker.js"]
