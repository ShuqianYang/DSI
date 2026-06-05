# Agent Loop 分支合并阻塞项

> **状态**: 追踪中  
> **目标**: agent-loop 分支合并到 main 前必须解决的所有阻塞问题  
> **关联**: [后端路由缺失](agent-loop-backend-routes-missing.md) | [前端事件适配](agent-loop-frontend-event-adaptation.md) | [旧 Capability 迁移](agent-loop-legacy-capability-migration.md)

---

## 阻塞项清单

### 🔴 P0 — 合并前必须解决

| # | 阻塞项 | 影响 | 解决方式 | 状态 |
|---|---|---|---|---|
| 1 | 后端路由缺失 | 前端除聊天外全面 404 | 恢复或重写各模块路由注册 | 🔴 |
| 2 | 前端事件适配 | Agent Loop 执行过程完全不可见 | 适配层或前端重写 | 🔴 |
| 3 | 旧 Capability 调用中断 | 火情/油污/海域等核心业务无法触发 | 包装为 Agent Loop 工具或分流 | 🔴 |
| 4 | 数据库 schema 差异 | 若 agent-loop 改了 schema，需迁移脚本 | 检查差异，提供迁移 | 🟡 |

### 🟡 P1 — 合并后尽快解决

| # | 阻塞项 | 影响 | 解决方式 | 状态 |
|---|---|---|---|---|
| 5 | 旧 Pipeline 代码清理 | 死代码增加维护负担 | 确认无引用后删除 | 🟡 |
| 6 | 环境变量配置 | AGENT_WORKSPACE_ROOT 等新增 env | 补充 .env.example 和文档 | 🟡 |
| 7 | 端到端测试 | Agent Loop 无集成测试 | 补充 smoke test | 🟡 |

---

## 详细说明

### 1. 后端路由缺失

agent-loop 分支的 `api/src/index.ts` 只保留了：
- `/health`
- `/tasks`（含 stream SSE）
- `/sse/global`

前端依赖的以下路由全部 404：
- `/jobs`, `/events`, `/subscriptions`, `/requirements`, `/insights`
- `/ais/data`, `/ais/geojson`, `/ais/shipdt-area`
- `/ads/data`, `/ads/geojson`
- `/info-center`, `/info-center/export`
- `/agent/callback/slice`

**解决方式**：
- 方案 A：从 main 恢复所有路由注册（最简单，但保留大量旧代码）
- 方案 B：逐个模块重写，只保留前端需要的接口（推荐，但工作量大）

### 2. 前端事件适配

agent-loop 的 `runAgentLoop` 产生的事件类型：
`agent_turn`, `model_request`, `assistant_message`, `tool_calls`, `tool_batch`, `tool_call`, `tool_progress`, `tool_observation`, `tool_message`, `loop_stop`

前端 `useTaskChat.ts` 只处理旧 Pipeline 事件：
`planning`, `planning_done`, `routing`, `routing_done`, `step_update`, `completed`, `failed`

**解决方式**：
- 方案 A：在 `pipeline.ts` 中加适配层，翻译事件（推荐短期方案）
- 方案 B：重写 `useTaskChat.ts` 直接处理 Agent Loop 事件（长期方案）

### 3. 旧 Capability 调用中断

旧 Pipeline 路径（已断）：
```
Planner → Router → Executor → actions/capabilities/fire.ts
```

Agent Loop 路径（不识旧 capability）：
```
runAgentLoop → modelClient → toolGateway → systemTools.ts (Read/Grep/Bash)
```

**解决方式**：
- 方案 A：把旧 capability 包装为 Agent Loop 工具（推荐）
- 方案 B：`pipeline.ts` 中按意图分流（旧 query 走旧 Pipeline，新 query 走 Agent Loop）

---

## 验收标准

agent-loop 分支可合并到 main 的最低要求：

- [ ] 前端所有列表页（任务/事件/订阅/洞察/需求/AIS/ADS）能正常加载数据
- [ ] 聊天功能完整：创建任务 → Agent Loop 执行 → SSE 实时回显 → 最终回答展示
- [ ] 火情研判、油污溯源等核心 capability 可正常触发
- [ ] 现有数据（tasks/events/jobs 表）不因合并丢失
- [ ] `pnpm tsc` 无 TypeScript 错误
- [ ] 至少有一个端到端 smoke test 通过

---

## 相关文档

- [ADR-0003: Agent Loop 运行时架构评审](../docs/adr/0003-agent-loop-architecture.md)
- [Context Provider & Window Manager Phase 1 Plan](../plan/context-provider-window-manager-plan.md)
- [Context Window Phase 2 Plan](../plan/context-window-phase2-plan.md)
- [Prompt / System Prompt Phase 1 Plan](../plan/prompt-system-prompt-phase1-plan.md)
