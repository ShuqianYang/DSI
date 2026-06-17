# 一、项目整体架构

## 1.1 项目概述

这是一个 **Next.js 16 + React 19 + TypeScript 5** 的“数智融合智能体应用”。核心功能包括：

- GIS 地球引擎（CesiumJS）
- 智能问答（LLM 流式对话）
- 态势洞察
- 告警管理
- 任务驱动的 Agent Loop

## 1.2 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | Next.js 16 (App Router) |
| 前端核心 | React 19 |
| 语言 | TypeScript 5 |
| UI 组件 | shadcn/ui（基于 Radix UI） |
| 样式 | Tailwind CSS 4 |
| 3D 渲染 | CesiumJS |
| 后端框架 | Hono |
| ORM | Drizzle |
| 数据库 | 关系型数据库（通过 Drizzle 操作） |
| 动画 | framer-motion |
| LLM | DeepSeek |

## 1.3 目录结构

```
D:/0 ysq文件/DSI-agent-loop/
├── src/                          # 前端源码
│   ├── app/                      # 页面路由
│   ├── components/               # React 组件
│   ├── features/                 # 业务功能模块
│   ├── hooks/                    # 自定义 Hooks
│   ├── lib/                      # 工具函数
│   ├── types/                    # 类型定义
│   └── data/                     # 模拟数据
├── api/                          # 后端 API 子包
│   ├── src/
│   │   ├── modules/
│   │   │   ├── agent-loop/       # Agent Loop 核心
│   │   │   ├── tasks/            # 任务管理
│   │   │   └── ...               # 其他模块
│   │   ├── db/                   # 数据库 schema
│   │   ├── config/               # 配置
│   │   └── index.ts              # API 入口
│   ├── tests/                    # 测试脚本
│   └── docs/                     # 后端文档
├── packages/shared/              # 前后端共享类型
├── skills/                       # 可复用 Skill 包
├── scripts/                      # 根目录验证脚本
├── docs/                         # 项目文档
└── docker/                       # Docker 配置
```

## 1.4 核心入口

| 入口 | 文件路径 | 说明 |
|------|----------|------|
| 前端主页面 | `src/app/page.tsx` | 主界面入口 |
| 前端布局 | `src/app/layout.tsx` | 根布局 |
| API 服务入口 | `api/src/index.ts` | Hono 服务启动 |
| 任务接口 | `api/src/modules/tasks/routes.ts` | `/tasks` REST + SSE 路由 |
| 任务控制器 | `api/src/modules/tasks/controller.ts` | 任务创建与控制逻辑 |
| Agent Loop 运行 | `api/src/modules/agent-loop/runAgentLoop.ts` | 智能体主循环 |
| 任务 Pipeline | `api/src/modules/tasks/pipeline.ts` | 任务执行入口 |

## 1.5 色彩规范

| 用途 | 颜色值 |
|------|--------|
| 主背景 | `#121212` |
| 面板背景 | `#1E1E2E` |
| 主文本 | `#EAEAEA` |
| 高亮文本 | `#00E0FF` |
| 高危告警 | `#FF4444` |
| 中危提示 | `#FFAA00` |
| 低危提醒 | `#FFFF44` |
| 安全/正常 | `#44FF44` |

## 1.6 开发命令

```bash
# 安装依赖
pnpm install

# 开发环境
pnpm dev

# 构建生产版本
pnpm build

# 代码检查
pnpm lint
pnpm ts-check
```
