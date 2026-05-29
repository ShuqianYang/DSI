# Agent 编排系统后端 API

## 架构概览

```
用户 → POST /tasks
    │
    ├──► Planner (Dify LLM) → 生成 Plan
    ├──► Router (Dify LLM) → 决策 Actions
    ├──► 数据库 INSERT task
    ├──► 投递 BullMQ 队列
    └──► 返回 { taskId, plan, actions }

Worker 消费队列 → Executor → Actions (C/D/E) → 写结果到数据库

用户 → GET /tasks/:id → 查询结果
```

## 模块说明

| 模块 | 路径 | 职责 |
|------|------|------|
| tasks | `modules/tasks/` | 对外 API：创建任务、查询任务 |
| planner | `modules/planner/` | A：调用 Dify API 生成执行计划 |
| router | `modules/router/` | B：调用 Dify API 决策动作列表 |
| executor | `modules/executor/` | 编排执行 steps，处理依赖关系 |
| actions | `modules/actions/` | 🔵 能力注册中心 + C/D/E mock |
| queue | `queue/` | BullMQ 队列和 Worker |

## 能力 (Capabilities)

| 类型 | 名称 | 状态 |
|------|------|------|
| maritime | 海域态势分析 | mock |
| intelligence | 情报问答分析 | mock |
| gis | GIS 联动展示 | mock |

## 启动

```bash
# 1. 安装依赖 (在根目录)
pnpm install

# 2. 配置环境变量
cp api/.env.example api/.env
# 编辑 api/.env，填写 DATABASE_URL、REDIS_URL 等

# 3. 推送数据库表
cd api
pnpm db:push

# 4. 启动 API 服务器
cd api
pnpm dev

# 5. 启动 Worker (另一个终端)
cd api
pnpm worker
```

## API 接口

### POST /tasks
创建任务
```json
{
  "query": "分析东海海域当前态势"
}
```

### GET /tasks/:taskId
查询任务状态和结果
