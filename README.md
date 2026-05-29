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
| AI 服务 | Dify API + DeepSeek API + Qwen API + Tavily 搜索 |
| 包管理 | pnpm 9 workspace (monorepo) |

## 项目结构

```
S:/Projects/projects_new/
├── src/                          # 前端源码 (Next.js App Router)
│   ├── app/                      # 页面路由
│   │   ├── page.tsx              # 首页 - 三栏布局主页面
│   │   ├── layout.tsx            # 根布局
│   │   ├── info-center/          # 信息中心页面
│   │   └── api/                  # Next.js API Routes
│   │       ├── chat/             # 聊天接口代理
│   │       └── prd/              # PRD 相关接口
│   ├── components/               # React 组件
│   │   ├── ui/                   # shadcn/ui 基础组件
│   │   ├── chat/                 # 左侧问答面板
│   │   │   ├── ChatPanel.tsx     # 主组件
│   │   │   ├── ChatHeader.tsx    # 面板头部
│   │   │   ├── ChatHistory.tsx   # 历史对话侧边栏
│   │   │   ├── ChatMessage.tsx   # 单条消息气泡
│   │   │   ├── ChatMessageList.tsx # 消息列表（含 Suggestion 按钮）
│   │   │   ├── ChatInput.tsx     # 输入框
│   │   │   ├── MarkdownContent.tsx # Markdown 渲染
│   │   │   └── ThinkingProcess.tsx # 思考过程折叠面板
│   │   ├── right-panel/          # 右侧信息面板
│   │   │   ├── RightPanel.tsx    # 主组件
│   │   │   ├── TaskSection.tsx   # 可执行任务列表
│   │   │   ├── SubscriptionSection.tsx # 订阅任务列表
│   │   │   ├── RequirementSection.tsx  # 定制需求列表
│   │   │   ├── EventList.tsx     # 事件卡片列表
│   │   │   ├── InsightList.tsx   # AI 洞察卡片列表
│   │   │   └── StatusIcons.tsx   # 状态图标组件
│   │   ├── info-center/          # 信息中心组件
│   │   ├── GisViewer.tsx         # 中间 3D 地球/GIS 可视化
│   │   └── cesium/               # Cesium 地图组件
│   │       ├── CesiumMap.tsx     # 地图渲染核心
│   │       ├── CesiumInitializer.tsx # 初始化
│   │       ├── ImageryManager.ts # 底图图层管理
│   │       ├── FireOverlay.ts    # 火灾 overlay
│   │       ├── mapDrawTool.ts    # 地图绘制工具
│   │       └── ...               # 效果组件（光墙、脉冲环、流动材质等）
│   ├── features/                 # 功能模块
│   │   └── gis-custom/           # GIS 自定义功能
│   │       └── multi-layer-points/ # 多层点位/风场示例
│   ├── hooks/                    # 自定义 Hooks
│   │   ├── useTaskChat.ts        # 问答面板业务逻辑
│   │   ├── useRightPanel.ts      # 右侧面板业务逻辑
│   │   └── useRightPanelData.ts  # 右侧面板数据获取
│   ├── lib/                      # 工具库
│   │   ├── api.ts                # 前端 API 客户端
│   │   ├── taskResultFormatter.ts # 任务结果格式化
│   │   ├── taskMock.ts           # Mock 响应数据
│   │   └── utils.ts              # 通用工具函数
│   ├── data/                     # 静态数据
│   └── types/                    # 前端类型定义
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
│       ├── planner/              # 任务规划器 (Planner) — DeepSeek
│       ├── router/               # 路由决策器 (Router) — DeepSeek
│       ├── executor/             # 任务执行器（含阻断校验）
│       ├── blockage-analyzer/    # 执行阻断分析器
│       ├── actions/              # 能力执行层
│       │   ├── registry.ts       # 能力注册中心
│       │   ├── capabilities/     # 具体能力实现
│       │   │   ├── maritime.ts       # 海域态势分析
│       │   │   ├── intelligence.ts   # 情报分析
│       │   │   ├── intelligent_qa.ts # 智能问答
│       │   │   ├── daily_report.ts   # 日报生成
│       │   │   ├── satellite.ts      # 天基数据查询
│       │   │   ├── satelliteCallbackStore.ts # 卫星回调存储
│       │   │   ├── news.ts           # 新闻/舆情分析
│       │   │   ├── weather-fetch.ts  # 气象数据获取
│       │   │   ├── ais-fetch.ts      # AIS 船舶数据获取
│       │   │   ├── ais-match-suspects.ts # AIS 嫌疑船匹配
│       │   │   ├── ais-suspect-ranking.ts # AIS 嫌疑船排序
│       │   │   ├── oil-drift.ts      # 油污漂移溯源
│       │   │   ├── earthquake-evaluation.ts # 地震灾后评估
│       │   │   ├── flood-evaluation.ts # 洪水灾后评估
│       │   │   ├── fire.ts           # 火情分析
│       │   │   ├── region-mark.ts    # 区域标记
│       │   │   ├── border-push.ts    # 边境推送
│       │   │   ├── gis.ts            # GIS 操作
│       │   │   └── requirement.ts    # 需求收集
│       │   └── _mock/              # Mock 数据
│       ├── insights/             # AI 洞察生成
│       ├── scheduler/            # 订阅调度器
│       ├── events/               # 事件管理
│       ├── jobs/                 # 可执行任务
│       ├── subscriptions/        # 订阅管理
│       ├── requirements/         # 需求管理
│       ├── info-center/          # 信息中心
│       ├── ais/                  # AIS 数据接口
│       ├── ads/                  # ADS-B 数据接口
│       └── router_legacy/        # 遗留 Router（Dify 版）
│
├── packages/shared/              # 共享类型包 (pnpm workspace)
│   └── src/types/                # task / plan / action / maritime 类型
│
├── docker/                       # Docker 编排配置
│   ├── docker-compose.yaml       # 完整服务编排
│   ├── docker-compose.infra.yaml # 仅基础设施 (DB + Redis)
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
│   └── agents/                   # Agent 规范
│
└── api/issues/                   # 问题追踪
    └── frontend-performance-trace-*.md
```

## Agent 编排 Pipeline

用户输入 → **Planner** (生成执行计划) → **Router** (决策工具调用) → **Executor** (按依赖执行 Action，含阻断校验) → **Insights** (生成综合洞察) → SSE 推送前端

```
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│ Planner │ → │ Router  │ → │ Executor│ → │ Actions │ → │Insights │
│(生成Plan)│    │(决策工具)│    │(执行步骤)│    │(具体能力)│    │(综合洞察)│
└─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘
    ↑                                              ↓
   DeepSeek API                               maritime / satellite
   (LLM Agent)                                / ais / news / weather
                                              / earthquake / flood / fire
                                              / oil-drift / ...
```

## 前后端数据流

| 方式 | 用途 |
|------|------|
| REST API | 前端 ↔ 后端常规请求 (任务、事件、订阅等 CRUD) |
| SSE | 任务状态实时推送到前端 |
| Redis Pub/Sub | 后端内部状态广播 (Worker → API → 前端) |
| WebSocket | AISStream 实时船舶数据流 |

## 核心 API 路由

### 任务编排
| 方法 | 路由 | 用途 |
|------|------|------|
| POST | `/tasks` | 创建 Agent 编排任务 |
| GET | `/tasks` | 查询任务列表 |
| GET | `/tasks/:taskId` | 查询任务详情 |
| GET | `/tasks/:taskId/stream` | SSE 实时流 |

### 资源管理 (CRUD)
| 路由 | 说明 |
|------|------|
| `/jobs` | 可执行任务列表 |
| `/events` | 事件列表 |
| `/subscriptions` | 订阅任务管理 |
| `/requirements` | 定制需求管理 |
| `/insights` | AI 洞察列表 |
| `/info-center` | 信息中心 (list + export) |

### 实时数据
| 路由 | 说明 |
|------|------|
| `/ais/data` | AIS 船舶实时数据 |
| `/ais/geojson` | AIS 船舶 GeoJSON |
| `/ais/shipdt-area` | ShipDT 区域船舶查询 |
| `/ads/data` | ADS-B 航空器实时数据 |
| `/ads/geojson` | ADS-B 航空器 GeoJSON |
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
# 方式1: Docker 启动 DB + Redis
docker compose -f docker/docker-compose.infra.yaml up -d

# 方式2: 使用本地启动脚本（检查本地服务）
./start-local-api.sh
```

### 配置环境变量

复制 `api/.env.example` 为 `api/.env`，配置数据库连接和 API 密钥：

```bash
# 数据库 & 缓存
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/datasource
REDIS_URL=redis://localhost:6379

# AI 服务 (至少配置一个)
DEEPSEEK_API_KEY=your_key        # Planner / Router
DIFY_PLANNER_API_KEY=your_key    # 遗留 Planner
DIFY_ROUTER_API_KEY=your_key     # 遗留 Router
DIFY_INSIGHT_API_KEY=your_key    # Insight 生成
DIFY_MARITIME_API_KEY=your_key   # 海域态势
DIFY_NEWS_API_KEY=your_key       # 新闻分析
QWEN_API_KEY=your_key            # Qwen 模型
TAVILY_API_KEY=your_key          # 搜索增强

# 数据源
AISSTREAM_API_KEY=your_key       # AIS 实时流
SHIPDT_API_KEY=your_key          # ShipDT 船舶数据
OPENSKY_CLIENT_ID=your_id      # OpenSky ADS-B
OPENSKY_CLIENT_SECRET=your_secret
```

### 启动开发环境

```bash
# 终端1: 前端 (端口 5000)
pnpm dev

# 终端2: 后端 API (端口 3001)
cd api && pnpm dev

# 终端3: Worker 进程
cd api && pnpm worker
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
| DeepSeek API | Planner / Router LLM 推理 | 推荐 |
| Dify | LLM Agent 服务 (Planner/Router/Insight/Maritime/News) | 未配置时降级为 Mock |
| Qwen API | 阿里百练模型 | 可选 |
| Tavily | 搜索增强 | 可选 |
| AISStream | AIS 实时船舶数据 (WebSocket) | 可选，留空用 Mock |
| ShipDT | AIS 船舶数据补充 | 可选 |
| OpenSky | ADS-B 航空器数据 | 可选 |
| AWS S3 | 对象存储 | 可选 |

## 注意事项

1. **AI 服务降级**：当 Dify / DeepSeek API Key 未配置时，Planner/Router 自动降级为 Mock 模式
2. **AIS/ADS-B 数据**：已接入真实数据源 — OpenSky（ADS-B 航空器）+ ShipDT（AIS 船舶）+ AISStream（实时流），未配置时使用 Mock 数据
3. **用户认证**：当前仅使用 localStorage 简单登录状态，无真实认证系统
4. **性能**：Cesium 3D 地图在大量实体（300+）时需注意性能，参考 `api/issues/frontend-performance-trace-*.md`
5. **日志**：各服务日志统一输出到 `logs/` 目录
