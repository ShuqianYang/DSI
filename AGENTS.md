# 数智融合智能体应用 - 开发文档

## 项目概述

基于 PRD 文档构建的数智融合智能体应用，核心功能包括 GIS 地球引擎、智能问答、态势洞察、告警管理等。

## 技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4
- **3D 渲染**: CesiumJS

## 新技术栈

- **Framework** : Next.js 16 (App Router)
- **Core** : React 19
- **Language** : TypeScript 5
- **UI** : shadcn/ui + Tailwind CSS 4
- **3D 核心** : CesiumJS
- **地球渲染** : CesiumJS (ImageryProvider + Entity API)
- **动画** : framer-motion
- **状态管理** : Zustand / Jotai（做联动非常舒服）

## 目录结构

```
src/
├── app/                      # 页面路由
│   ├── api/
│   │   ├── chat/            # LLM智能问答API
│   │   └── prd/             # PRD文档获取API
│   ├── globals.css          # 全局样式
│   ├── layout.tsx           # 根布局
│   └── page.tsx             # 主页面
├── components/              # 组件
│   ├── cesium/              # CesiumJS 地图子组件
│   │   ├── CesiumMap.tsx   # 核心地图渲染
│   │   ├── ImageryManager.ts # 底图样式管理
│   │   └── CesiumInitializer.tsx # Cesium 全局初始化
│   ├── ChatPanel.tsx        # 智能问答面板
│   ├── GisViewer.tsx       # 3D地球引擎（UI层 + CesiumMap封装）
│   ├── LoginPage.tsx        # 登录页面
│   ├── RightPanel.tsx       # 右侧Tab模块
│   └── UserCenter.tsx       # 用户中心
├── types/                   # 类型定义
│   └── prd.ts              # PRD相关类型
├── data/                   # 模拟数据
│   └── mockData.ts        # 模拟数据
└── lib/                    # 工具库
    └── utils.ts            # 通用工具函数
```

## 核心功能模块

### 1. 登录模块

- 用户名+密码登录
- 手机号+验证码登录
- 深色科技风界面

### 2. GIS 地球引擎

- 3D 地球可视化展示
- 实体点标记（船舶、飞机、基站）
- 轨迹线可视化
- 区域面展示
- 状态颜色区分（危险/警告/正常）

### 3. 智能问答模块

- 自然语言交互
- 历史对话管理
- 订阅定时任务
- GIS 数据联动

### 4. 右侧 Tab 模块

- **信息服务列表**: 消息提醒、已完成任务、未完成需求
- **订阅任务列表**: 定时任务管理
- **AI 洞察模块**: 态势评估、风险分析

### 5. 用户中心

- 个人资料管理
- 设置中心
- 退出登录

## API 接口

### GET /api/chat

返回 API 信息

### POST /api/chat

发送消息获取 AI 回复（流式）

### GET /api/prd

获取 PRD 文档内容

## 色彩规范

| 用途      | 颜色值  |
| --------- | ------- |
| 主背景    | #121212 |
| 面板背景  | #1E1E2E |
| 主文本    | #EAEAEA |
| 高亮文本  | #00E0FF |
| 高危告警  | #FF4444 |
| 中危提示  | #FFAA00 |
| 低危提醒  | #FFFF44 |
| 安全/正常 | #44FF44 |

## 开发命令

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

## 测试账号

- 用户名：admin
- 密码：admin123
- 手机号：13800000000
- 验证码：123456

## 注意事项

1. 3D 地球引擎基于 CesiumJS，支持真正的 GIS 能力（瓦片服务、地形、GeoJSON 等）
2. 所有 API 调用均通过 coze-coding-dev-sdk
3. 深色科技风为默认主题

## Agent skills

### Issue tracker

Issue 跟踪在 jihulab.com 的 GitLab Issues（`foreverbb-group/datasourceintelligence`），通过 `glab` CLI 操作。详见 `docs/agents/issue-tracker.md`。

### Triage labels

五个 triage 角色采用默认标签名（needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix）。详见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文布局 —— 仓库根的 `CONTEXT.md` 和 `docs/adr/` 覆盖整个项目。详见 `docs/agents/domain.md`。

### Tool registration

`api/src/modules/agent-loop` 的 system / skill / MCP 工具注册模式详见 `docs/agents/tool-registration.md`。
