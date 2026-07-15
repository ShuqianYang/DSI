# 数智融合智能体平台

基于 AI Agent 编排 + 多元数据融合的一站式信息服务应用，提供开源情报获取、智能问答、态势洞察、GIS 可视化联动等功能。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | Next.js 16 + React 19 + Tailwind CSS 4 |
| UI 组件 | shadcn/ui (基于 Radix UI) |
| 3D 可视化 | CesiumJS |
| 后端框架 | Express 5 + TypeScript |
| 数据库 | PostgreSQL 16 + Drizzle ORM |
| 缓存/队列 | Redis 7 + BullMQ |
| AI 服务 | Dify API + DeepSeek API + Qwen API + 火山引擎搜索 |
| 包管理 | pnpm 9 workspace (monorepo) |

## 项目结构

```
S:/Projects/projects_new/
├── src/                          # 前端源码 (Next.js App Router)
│   ├── app/                      # 页面路由
│   │   ├── page.tsx              # 首页 - 三栏布局主页面
│   │   ├── layout.tsx            # 根布局
│   │   ├── info-center/          # 信息中心页面
│   │   ├── skills/               # 技能广场页面
│   │   └── api/                  # Next.js API Routes
│   │       ├── chat/             # 聊天接口代理
│   │       ├── prd/              # PRD 相关接口
│   │       ├── proxy/image/      # 图片代理
│   │       └── skills/           # 技能列表接口
│   ├── components/               # React 组件
│   │   ├── ui/                   # shadcn/ui 基础组件
│   │   ├── ChatPanel.tsx         # 左侧问答面板主组件
│   │   ├── chat/                 # 问答面板子组件
│   │   │   ├── ChatHeader.tsx    # 面板头部
│   │   │   ├── ChatHistory.tsx   # 历史对话侧边栏
│   │   │   ├── ChatMessage.tsx   # 单条消息气泡
│   │   │   ├── ChatMessageList.tsx # 消息列表
│   │   │   ├── ChatInput.tsx     # 输入框
│   │   │   ├── MarkdownContent.tsx # Markdown 渲染
│   │   │   ├── ThinkingProcess.tsx # 思考过程折叠面板
│   │   │   ├── ScenarioTabs.tsx  # 场景标签
│   │   │   └── ScenarioSkillButton.tsx # 场景技能按钮
│   │   ├── RightPanel.tsx        # 右侧信息面板主组件
│   │   ├── right-panel/          # 右侧面板子组件
│   │   │   ├── TaskSection.tsx   # 可执行任务列表
│   │   │   ├── SubscriptionSection.tsx # 订阅任务列表
│   │   │   ├── RequirementSection.tsx  # 定制需求列表
│   │   │   ├── EventList.tsx     # 事件卡片列表
│   │   │   ├── InsightList.tsx   # AI 洞察卡片列表
│   │   │   └── StatusIcons.tsx   # 状态图标组件
│   │   ├── info-center/          # 信息中心组件
│   │   │   ├── InfoTable.tsx
│   │   │   ├── InfoDetail.tsx
│   │   │   ├── InfoFilters.tsx
│   │   │   ├── InfoPagination.tsx
│   │   │   ├── TaskTrace.tsx
│   │   │   └── useInfoCenterStream.ts
│   │   ├── skills/               # 技能广场组件
│   │   │   ├── SkillCard.tsx
│   │   │   ├── SkillFilters.tsx
│   │   │   └── SkillDetailDrawer.tsx
│   │   ├── GisViewer.tsx         # 中间 3D 地球/GIS 可视化
│   │   ├── UserCenter.tsx        # 用户中心
│   │   ├── LoginPage.tsx         # 登录页
│   │   ├── LiveClock.tsx         # 实时时钟
│   │   ├── LogoIcon.tsx
│   │   └── cesium/               # Cesium 地图组件
│   │       ├── CesiumMap.tsx     # 地图渲染核心
│   │       ├── CesiumInitializer.tsx # 初始化
│   │       ├── ImageryManager.ts # 底图图层管理
│   │       ├── mapDrawTool.ts    # 地图绘制工具
│   │       ├── mapDrawPersisted.ts
│   │       └── ...               # 效果组件（光墙、脉冲环、流动材质、油污扩散等）
│   ├── features/                 # 功能模块
│   │   └── gis-custom/           # GIS 自定义功能
│   │       └── multi-layer-points/ # 多层点位/风场示例
│   ├── hooks/                    # 自定义 Hooks
│   │   ├── useRightPanelData.ts  # 右侧面板数据获取
│   │   └── use-mobile.ts         # 移动端检测
│   ├── lib/                      # 工具库
│   │   ├── utils.ts              # 通用工具函数
│   │   ├── taskMock.ts           # Mock 响应数据
│   │   ├── eventGrouping.ts      # 事件分组
│   │   ├── styleMaps.ts          # 样式映射
│   │   └── mapDrawCollectEntities.ts
│   └── data/                     # 静态数据
│       ├── mockData.ts
│       ├── aisMockData.ts
│       └── adsMockData.ts
│
├── api/src/                      # 后端 API 服务 (Express)
│   ├── index.ts                  # API 服务器入口
│   ├── worker.ts                 # BullMQ Worker 进程入口
│   ├── config/                   # 数据库/Redis 配置
│   ├── db/schema.ts              # Drizzle ORM 数据库 Schema
│   ├── lib/                      # 工具库
│   │   ├── dify.ts               # Dify API 统一客户端
│   │   ├── prompts/              # Prompt 配置
│   │   └── requirementEvaluator.ts # 需求评估器
│   ├── queue/taskQueue.ts        # BullMQ 任务队列
│   ├── sse/sseManager.ts         # SSE 实时推送管理
│   ├── middleware/               # Express 中间件
│   └── modules/                  # 业务模块
│       ├── tasks/                # Agent 编排任务管理
│       │   ├── controller.ts     # 任务创建/查询/流式接口
│       │   ├── service.ts
│       │   ├── schema.ts
│       │   ├── pipeline.ts       # Agent Loop 编排入口（兼容层包装）
│       │   ├── agentLoopResultProjection.ts
│       │   └── agentLoopSseMode.ts
│       ├── agent-loop/           # Agent 运行时核心 (Claude Code 风格，已替代旧 Planner / Router / Executor)
│       │   ├── runAgentLoop.ts       # 主循环：turn 驱动、事件流、工具调度
│       │   ├── runAgentLoopEvents()  # 事件流主循环
│       │   ├── contextProvider.ts    # 上下文加载：项目文件 / git / task 状态
│       │   ├── promptManager.ts      # 提示词渲染：system prompt + 工具目录 + sections
│       │   ├── contextWindowManager.ts # 窗口治理：字符预算 / tool 截断 / 邻接保护
│       │   ├── modelClient.ts        # 模型客户端：DeepSeek API 调用
│       │   ├── tools/_shared/        # 工具注册中心、网关、策略、类型
│       │   │   ├── toolRegistry.ts
│       │   │   ├── toolGateway.ts
│       │   │   ├── toolPolicy.ts
│       │   │   └── types.ts
│       │   ├── tools/system/         # 系统内置工具
│       │   ├── tools/domain/         # 业务域工具
│       │   ├── memoryManager.ts      # Memory 接口
│       │   ├── sessionSummaryMemoryManager.ts # 会话摘要记忆实现
│       │   ├── skillManager.ts       # Skill 管理（listing / discovery / prompt 注入）
│       │   ├── transcriptStore.ts    # 转录存储（DB 持久化实现）
│       │   ├── fileLogger.ts         # turn 级文件日志
│       │   └── types.ts              # 核心类型
│       ├── dashboard/            # Dashboard 聚合查询（事件 / 洞察 / 订阅 / 任务等）
│       ├── info-center/          # 信息中心查询与导出
│       ├── ais/                  # AIS 船舶数据（aisstream.io WebSocket → DB replaceAll）
│       │   ├── client.ts         # WebSocket 连接 + 60s 全球数据累积
│       │   ├── ingestion.ts      # 原始 PositionReport → DB schema 归一化
│       │   ├── repository.ts     # replaceAll: DELETE + batch INSERT（事务）
│       │   ├── queue.ts          # BullMQ hourly cron 队列
│       │   └── worker.ts         # BullMQ worker
│       └── opensky/              # ADS-B 航空器数据（OpenSky API → DB replaceAll）
│           ├── client.ts         # REST API 拉取
│           ├── ingestion.ts      # 状态归一化
│           ├── repository.ts     # replaceAll 事务
│           ├── queue.ts          # BullMQ hourly cron
│           └── worker.ts         # BullMQ worker
│
├── packages/shared/              # 共享类型包 (pnpm workspace)
│   └── src/types/                # task / plan / action / maritime 类型
│
├── skills/                       # Agent-loop 技能目录
│   ├── ais-region-query/
│   ├── aircraft-region-query/
│   ├── daily-report/
│   ├── fire-investigation/
│   ├── flood-assessment/
│   ├── earthquake-assessment/
│   ├── oil-spill-tracing/
│   ├── disaster-satellite-query/
│   ├── border-defense-qa/
│   ├── alarm-disposal-orchestrator/
│   ├── csv-profile/
│   └── conventional-commit-helper/
│
├── api/scripts/                  # 后端脚本
│   └── agent-loop/               # Agent Loop smoke / 测试脚本
│
├── docker/                       # Docker 编排配置
│   ├── docker-compose.yaml       # 完整服务编排
│   ├── docker-compose.infra.yaml # 仅基础设施 (DB + Redis + PostGIS)
│   ├── Dockerfile                # 多阶段构建
│   └── entrypoint.sh             # 容器入口脚本
│
├── scripts/                      # 构建/工具脚本
│   ├── copy-cesium.mjs           # 复制 Cesium 静态资源
│   └── analyze-trace.mjs         # 性能分析工具
│
├── logs/                         # 日志输出目录
├── public/                       # 静态资源
│   ├── cesium/                   # Cesium 运行时资源
│   ├── geo/                      # GeoJSON 地图数据
│   ├── local-tiles/              # 本地瓦片影像
│   ├── satellite/                # 卫星影像
│   └── textures/                 # 纹理资源
│
├── docs/                         # 文档
│   ├── adr/                      # 架构决策记录
│   ├── agents/                   # Agent 规范
│   ├── plan/                     # 实施计划
│   └── templates/                # 模板
│
├── api/issues/                   # 问题追踪
│   └── frontend-performance-trace-*.md
├── start-local.sh                # 本地一键启动脚本
└── start-local-api.sh            # 本地 API 启动脚本
```

## Agent 编排架构

### 旧 Pipeline（已迁移）

原 **Planner → Router → Executor → Insights** 编排流程已下线，相关模块（`planner/` / `router/` / `executor/` / `insights/` 等）已移除。  
入口文件 `api/src/modules/tasks/pipeline.ts` 保留为兼容层，内部已替换为全新的 Agent Loop 架构。

### 新 Agent Loop（Claude Code 风格，逐 turn 执行）

`api/src/modules/agent-loop/` 实现了完整的 Agent 运行时：

```
ContextProvider ──→ PromptManager ──→ ContextWindowManager ──→ ModelClient
       ↑                                        │                  │
       │                                        │                  │
   AGENTS.md                              字符预算/截断      DeepSeek API
   CLAUDE.md                              邻接保护             (工具调用决策)
   git status                             diagnostics          │
   task status                                                  │
       │                                                        │
       └────────────────────────────────────────────────────────┘
                           model 返回决策
                                 │
                    ┌────────────┼────────────┐
                    │            │            │
                final      tool_calls   model_error
                answer          │            │
                    │            │            │
             直接回答     ToolRegistry   报错/停止
                         ToolGateway
                         (权限/执行)   
                              │
                    ┌─────────┴─────────┐
                    │                   │
               readOnly(去重)        destructive
                    │                   │
               并发批处理            串行执行
                    │                   │
               ToolObservation ──→ 回填 conversation
                         │
                    runAgentLoop 下一轮
```

**核心设计**：
- **逐 turn 执行**：每轮模型请求 → 模型决策（回答或工具调用）→ 执行工具 → 回填结果 → 下一轮
- **三层分离**：`ContextProvider` 加载上下文 → `PromptManager` 渲染提示词 → `ContextWindowManager` 治理窗口
- **工具网关**：`ToolRegistry` 注册 → `ToolGateway` 执行（权限检查 → schema 校验 → 执行 → 结果截断）
- **并发安全**：`isConcurrencySafe` 标注的工具可并行执行，destructive 工具串行执行
- **去重优化**：readOnly 工具相同输入自动复用已有结果

**已实现的 Agent Loop 组件**：

| 组件 | 状态 | 说明 |
|------|------|------|
| `ContextProvider` | ✅ Phase 1 完成 | 加载项目文件（AGENTS.md/CLAUDE.md/CONTEXT.md）、git 状态、task 状态 |
| `PromptManager` | ✅ Phase 1 完成 | 结构化 system prompt（6 个 block）+ 工具元数据渲染 |
| `ContextWindowManager` | ✅ Phase 2 完成 | 字符预算、per-tool 截断、优先级删除、orphan 清理、diagnostics |
| `ToolRegistry` | ✅ 已完成 | 工具注册 + alias 解析 |
| `ToolGateway` | ✅ 已完成 | 权限策略、并发调度、结果截断、readOnly 去重 |
| `ModelClient` | ✅ 已完成 | DeepSeek API 调用 + 工具调用解析 |
| `MemoryManager` | ✅ 已实现 | `SessionSummaryMemoryManager`：基于 `agent_transcript_entries` 召回近期同用户任务摘要；`pipelineMemory.ts` 组装生产环境默认实现 |
| `SkillManager` | ✅ 已完成 | `LocalSkillManager`：frontmatter 解析、条件激活、discovery、prompt 注入 |
| `TranscriptStore` | ✅ 已实现 | `createDbTranscriptStore`：Drizzle ORM 持久化到 `agent_transcript_entries`；`pipeline.ts` 默认启用并包装为 best-effort store |

**已实现的 Agent Loop 业务 Skills**（`skills/` 目录，由 `SkillManager` 动态加载）：

| Skill | 说明 |
|-------|------|
| `ais-region-query` | 区域船舶/AIS 查询（结合 `RegionResolve`/`RegionMark`/`SqlQuery`） |
| `aircraft-region-query` | 区域航空器/ADS-B 查询（结合 `RegionResolve`/`RegionMark`/`SqlQuery`） |
| `daily-report` | 边防日报生成（调用 `DailyReport` 域工具） |
| `fire-investigation` | Kensai 火情研判演示（mock 工具链） |
| `flood-assessment` | 洪涝灾害评估演示 |
| `earthquake-assessment` | 地震灾情评估演示 |
| `oil-spill-tracing` | 油污漂移溯源演示 |
| `disaster-satellite-query` | 灾害卫星数据查询 |
| `border-defense-qa` | 边防问答（MySQL 知识库查询） |
| `alarm-disposal-orchestrator` | 告警处置编排（外部 Python 脚本） |
| `csv-profile` | CSV 数据画像 |
| `conventional-commit-helper` | Commit message 辅助 |

**已实现的 Agent Loop 工具**（系统工具 + 域工具）：

系统工具：`Bash`、`Glob`、`Grep`、`Read`、`Write`、`Edit`、`TodoWrite`、`Sleep`、`WebSearch`、`WebFetch`。

域工具：

| 工具 | 说明 |
|------|------|
| `SqlQuerySchema` / `SqlQuery` | PostgreSQL 数据库 schema 查询与 SQL 执行 |
| `MysqlQuerySchema` / `MysqlQuery` | 边防 QA MySQL 知识库查询 |
| `WeatherFetch` | 天气数据获取 |
| `DisasterQuery` | 灾害查询 |
| `SatelliteImageSearch` | 卫星影像查询 |
| `ImageAnalysis` | 影像分析 |
| `RegionResolve` / `RegionMark` | 区域解析与地图标记 |
| `DailyReport` | 日报生成 |
| 火情研判 mock 工具链 | `FireDetectMock`、`FireSatelliteMock`、`FireAssessmentMock`、`FireReportMock`、`BorderPushMock` |

## 前后端数据流

| 方式 | 用途 |
|------|------|
| REST API | 前端 ↔ 后端常规请求 (任务、事件、订阅等 CRUD) |
| SSE | 任务状态实时推送到前端 |
| Redis Pub/Sub | 后端内部状态广播 (Worker → API → 前端) |
| BullMQ | 定时任务队列（OpenSky/AIS 每小时注入） |
| WebSocket | AISStream 实时船舶数据流（→ DB replaceAll） |

## 核心 API 路由

### 任务编排
| 方法 | 路由 | 用途 |
|------|------|------|
| POST | `/tasks` | 创建 Agent 编排任务 |
| GET | `/tasks` | 查询任务列表 |
| GET | `/tasks/:taskId` | 查询任务详情 |
| GET | `/tasks/:taskId/stream` | SSE 实时流 |

### 资源管理 (Dashboard 路由，挂载在 `/`)
| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/jobs` | 可执行任务列表 |
| GET | `/events` | 事件列表 |
| GET | `/events/:id` | 事件详情 |
| PATCH | `/events/:id` | 标记事件已读/未读 |
| GET | `/subscriptions` | 订阅任务管理 |
| PATCH | `/subscriptions/:id` | 更新订阅状态（running/paused） |
| GET | `/requirements` | 定制需求管理 |
| GET | `/insights` | AI 洞察列表 |
| GET | `/insights/:id` | AI 洞察详情 |

### 信息中心
| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/info-center` | 信息列表 |
| GET | `/info-center/export` | 导出 |

### 实时数据
| 路由 | 说明 |
|------|------|
| `/ais/data` | AIS 船舶实时数据（读取 `ais_current_states`） |
| `/ads/data` | ADS-B 航空器实时数据（读取 `aircraft_current_states`） |
| `/sse/global` | 全局 SSE 实时推送 |
| `/health` | 健康检查 |
| `/agent/callback/slice` | 卫星切片回调 |

## 快速开始

### 环境要求

- Node.js 20+
- pnpm 9+
- PostgreSQL 16
- Redis 7

### 安装依赖

```bash
pnpm install
```

### 启动基础设施

```bash
# 方式1: Docker 启动 DB + Redis + PostGIS
docker compose -f docker/docker-compose.infra.yaml up -d

# 方式2: 使用本地启动脚本（检查本地服务）
./start-local-api.sh
```

### 地理数据库（PostGIS）导入

如需使用地理信息数据（全球国家/地区边界、中国省市区县等），需将 PostGIS dump 恢复到 `ds_postgis` 容器：

```bash
# 1. 确保 postgis 容器已启动
docker ps | findstr ds_postgis

# 2. 创建缺失的 schema 和 sequence（dump 依赖 analysis schema 下的 sequence）
docker exec ds_postgis psql -U postgres -d show_room -c "CREATE SCHEMA IF NOT EXISTS analysis; CREATE SEQUENCE IF NOT EXISTS analysis.region_geom_id_seq START 1; CREATE SEQUENCE IF NOT EXISTS analysis.region_geom_1_id_seq START 1; CREATE SEQUENCE IF NOT EXISTS analysis.taiwan_gid_seq START 1;"

# 3. 复制 dump 文件到容器内（替换为实际路径）
docker cp "path/to/dump-show_room-*.sql" ds_postgis:/tmp/dump.sql

# 4. 恢复 dump
docker exec ds_postgis bash -c "pg_restore -U postgres -d show_room --no-owner --no-privileges /tmp/dump.sql" 

# 5. 验证表数量和记录数
docker exec ds_postgis psql -U postgres -d show_room -c "SELECT tablename FROM pg_tables WHERE schemaname = 'region_geom' ORDER BY tablename;"
docker exec ds_postgis psql -U postgres -d show_room -c "SELECT 'international' as t, COUNT(*) FROM region_geom.international UNION ALL SELECT 'china_province', COUNT(*) FROM region_geom.china_province UNION ALL SELECT 'china_city', COUNT(*) FROM region_geom.china_city;"
```

> **注意**：dump 文件为 PostgreSQL custom format（PGDMP），必须用 `pg_restore` 恢复，不能用 `psql -f`。如果报错 `unsupported version`，需确保 PostGIS 容器镜像版本（`postgis/postgis:17-x.x`）不低于 dump 创建时的 pg_dump 版本。

### 配置环境变量

复制 `api/.env.example` 为 `api/.env`，配置数据库连接和 API 密钥：

```bash
# API 服务配置
API_PORT=3001
NODE_ENV=development
CALLBACK_HOST=192.168.0.193       # 外部系统回调地址，公网/局域网部署时改为可访问 IP

# 数据库 & 缓存
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/datasource
REDIS_URL=redis://localhost:6379

# Dify API 配置（旧 Planner / Router / Insight / Maritime / News）
DIFY_PLANNER_API_KEY=your_key
DIFY_PLANNER_API_URL=https://api.dify.ai/v1
DIFY_ROUTER_API_KEY=your_key
DIFY_ROUTER_API_URL=https://api.dify.ai/v1
DIFY_INSIGHT_API_KEY=your_key
DIFY_INSIGHT_API_URL=https://api.dify.ai/v1
DIFY_MARITIME_API_KEY=your_key
DIFY_MARITIME_API_URL=https://api.dify.ai/v1
DIFY_NEWS_API_KEY=your_key
DIFY_NEWS_API_URL=https://api.dify.ai/v1

# AI 模型
DEEPSEEK_API_KEY=your_key
DEEPSEEK_API_URL=https://api.deepseek.com/chat/completions
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_API_TIMEOUT_MS=120000

QWEN_API_KEY=your_key
QWEN_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
QWEN_MODEL=qwen3.5-27b

# 搜索增强
VOLCANO_SEARCH_API_KEY=your_key
VOLCANO_SEARCH_URL=https://open.feedcoopapi.com/search_api/web_search
WEBSEARCH_TIMEOUT_MS=30000

# Agent Loop / 系统工具配置
AGENT_WORKSPACE_ROOT=/absolute/path/to/workspace
AGENT_TIMEZONE=Asia/Shanghai
WEBFETCH_TIMEOUT_MS=30000
WEBFETCH_MAX_CHARS=20000
WEBFETCH_USER_AGENT=DSI-AgentLoop/0.1

# Agent Loop 上下文窗口（可选，有代码内默认值）
AGENT_CONTEXT_WINDOW_CHARS=120000
AGENT_CONTEXT_SUMMARY_RESERVE_CHARS=12000
AGENT_TOOL_MESSAGE_MAX_CHARS=16000
AGENT_TOOL_READ_MAX_CHARS=18000
AGENT_TOOL_BASH_MAX_CHARS=12000

# Agent Harness 开关（已弃用，保留兼容）
# 当前 pipeline.ts 已固定走 Agent Loop，该变量不再生效
AGENT_HARNESS_ENABLED=false

# 数据源
AISSTREAM_API_KEY=your_key       # AIS 实时流
OPENSKY_CLIENT_ID=your_id        # OpenSky ADS-B
OPENSKY_CLIENT_SECRET=your_secret

# 需求管理平台网关
GATEWAY_BASE_URL=http://192.168.0.136
GATEWAY_ACCESS_KEY=

# Mock 模式
MOCK_PLANNER=false
MOCK_ROUTER=false
```

### 启动开发环境

```bash
# 终端1: 前端 (端口 5000)
pnpm dev

# 终端2: 后端 API (端口 3001)
cd api && pnpm dev

# 终端3: Worker 进程
cd api && pnpm exec tsx src/worker.ts
```

### 生产部署

```bash
# 构建
pnpm build

# 生产模式启动（自动设置 COZE_PROJECT_ENV=PROD）
pnpm start:prod
```

或使用本地启动脚本：

```bash
# 一键检查环境并启动
./start-local.sh
```

## 开发规范

- **包管理器**：必须使用 pnpm
- **UI 组件**：优先使用 `src/components/ui/` 中的 shadcn/ui 基础组件
- **路径别名**：使用 `@/` 导入模块
- **类型安全**：全项目使用 TypeScript

## 外部依赖

| 服务 | 用途 | 状态 |
|------|------|------|
| PostgreSQL | 数据持久化 | 必需 |
| Redis | 缓存 + 队列 + Pub/Sub | 必需 |
| DeepSeek API | Agent Loop LLM 推理 | 推荐 |
| Dify | LLM Agent 服务 (旧 Planner/Router/Insight/Maritime/News) | 未配置时降级为 Mock |
| Qwen API | 阿里百练模型 | 可选 |
| 火山引擎搜索 | 搜索增强 | 可选 |
| AISStream | AIS 实时船舶数据 (WebSocket → 每小时 DB 注入) | 可选 |
| OpenSky | ADS-B 航空器数据 | 可选 |
| AWS S3 | 对象存储 | 可选 |

## 路线图与计划

### Agent Loop 运行时

| 阶段 | 状态 | 文档 |
|------|------|------|
| Phase 0.5: 基础框架 | ✅ 已完成 | — |
| Phase 1: Context Provider + Prompt Manager + Window Manager | ✅ 已完成 | [plan](api/plan/context-provider-window-manager-plan.md) |
| Phase 2: Window Manager 增强（token 估算、优先级、per-tool 预算） | ✅ 已完成 | [plan](api/plan/context-window-phase2-plan.md) |
| Phase 1: System Prompt 结构化 | ✅ 已完成 | [plan](api/plan/prompt-system-prompt-phase1-plan.md) |
| Phase 2: Context Provider 增强 | ✅ 已完成 | [plan](api/plan/context-provider-phase2-plan.md) |
| Phase 3: Context Provider + Transcript 持久化 | ✅ 已完成 | [closeout](api/plan/context-provider-phase3-closeout.md) |
| Memory MVP | ✅ 已实现 | [plan](api/plan/memory-mvp-plan.md) |
| Prompt Versioning | 🔄 进行中 | [plan](api/plan/prompt-versioning-plan.md) |

### 数据注入（已完成）

| 数据源 | 状态 | 说明 |
|--------|------|------|
| OpenSky ADS-B 每小时注入 | ✅ 已完成 | `api/src/modules/opensky/` — REST API → DB replaceAll |
| AISStream 每小时注入 | ✅ 已完成 | `api/src/modules/ais/` — WebSocket 60s → DB replaceAll |
| Dashboard ADS 查询 | ✅ 已完成 | `getAdsData()` 查询 `aircraft_current_states` |
| Dashboard AIS 查询 | ✅ 已完成 | `getAisData()` 查询 `ais_current_states` |
| Agent-loop AIS skill 查询 | ✅ 已完成 | `skills/ais-region-query/` — SqlQuery bbox 查询 |
| Agent-loop Aircraft skill 查询 | ✅ 已完成 | `skills/aircraft-region-query/` — SqlQuery bbox 查询 |

### 前端性能（P0）

- [P0 主线程阻塞修复](api/plan/p0-main-thread-blocking.md) — Cesium 掉帧率 46.8%

### 其他 Capability 计划

- [火灾检测器集成](api/plan/fire-detector-integration.md)
- [油污检测器](api/plan/oil-detector.md)
- [风粒子图层](api/plan/wind-particle-layer.md)

## 注意事项

1. **AI 服务降级**：当 Dify / DeepSeek API Key 未配置时，相关调用自动降级为 Mock 模式
2. **AIS/ADS-B 数据**：已接入真实数据源 — OpenSky（ADS-B 航空器）+ AISStream（船舶实时流）→ 每小时注入 DB；未配置时 Dashboard 返回空数据，Agent-loop 通过 skill 查询 DB
3. **用户认证**：当前仅使用 localStorage 简单登录状态，无真实认证系统
4. **性能**：Cesium 3D 地图在大量实体（1000+）时需注意性能；ADS 已放开到 20000 条，AIS 保持 1000 条。参考 `api/issues/frontend-performance-trace-*.md`
5. **日志**：各服务日志统一输出到 `logs/` 目录；Agent Loop 同时生成 turn 级 JSONL 文件日志
6. **Agent Loop**：`api/src/modules/tasks/pipeline.ts` 已替换为 Agent Loop 编排入口，是当前唯一的 Agent 任务执行路径；`AGENT_HARNESS_ENABLED` 环境变量已弃用，保留在 `.env.example` 仅作兼容
