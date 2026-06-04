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

## Agent Loop System Tools

Agent loop 的工具注册入口在 `src/modules/agent-loop/toolRegistry.ts`：

```ts
const registry = buildDefaultToolRegistry();
```

`buildDefaultToolRegistry()` 会调用 `registerClaudeCodeBaseSystemTools()`，实际可执行工具定义在 `src/modules/agent-loop/systemTools.ts`。Claude Code 系统工具的对照清单在 `src/modules/agent-loop/systemToolCatalog.ts`，这里保留了工具名、类别、Claude Code 来源文件和当前实现状态。

### 当前默认注册

| Tool | 类别 | 状态 | 权限策略 |
|------|------|------|----------|
| Bash | shell | portable sandbox MVP | 默认 `sandbox`；危险命令 `deny` |
| Glob | file | 已实现 | `allow` |
| Grep | file | 已实现 | `allow` |
| Read | file | 已实现 | `allow` |
| Write | file | 已实现 | `ask` |
| Edit | file | 已实现 | `ask` |
| TodoWrite | task | session 内 MVP | `allow` |
| Sleep | automation | MVP 已实现 | `allow` |
| WebSearch | web | Tavily provider | `allow` |
| WebFetch | web | native fetch | `allow` |

### Claude Code 对照清单

Claude Code 的系统工具大体分为这些组：

- 基础执行：`Bash`、`PowerShell`、`REPL`
- 文件：`Glob`、`Grep`、`Read`、`Edit`、`Write`
- Web：`WebSearch`、`WebFetch`、`WebBrowser`
- 任务/子智能体：`Agent`/`Task`、`TaskOutput`、`TaskStop`、`TodoWrite`、`TaskCreate`、`TaskGet`、`TaskUpdate`、`TaskList`
- 规划与交互：`EnterPlanMode`、`ExitPlanMode`、`AskUserQuestion`
- Skills/MCP：`Skill`、`ToolSearch`、`ListMcpResourcesTool`、`ReadMcpResourceTool`、`MCPTool`
- 工作树/团队/自动化/内部工具：`EnterWorktree`、`ExitWorktree`、`TeamCreate`、`TeamDelete`、`CronCreate`、`CronDelete`、`CronList`、`RemoteTrigger`、`Monitor`、`Workflow`、`Config` 等

当前只默认注册已经有真实执行边界且项目需要的工具。`NotebookEdit`、`Agent`、`Task*`、`MCP*`、`Skill`、`Worktree`、`Cron`、`Team`、`LSP`、`Browser` 等仍是 catalog-only，需要接入对应后端能力或确认业务需要后再注册，避免模型误以为这些能力已经可用。

### 新增工具步骤

1. 在 `src/modules/agent-loop/systemToolCatalog.ts` 增加或更新 catalog entry，标明 Claude Code 来源、类别、读写风险和 `implementation`。
2. 在 `src/modules/agent-loop/systemTools.ts` 新增 `buildXxxTool()`，实现：
   - `name`：模型调用名，必须稳定。
   - `description`：写清输入参数和使用边界。
   - `inputSchema`：用 `z.strictObject()` 定义参数，尽量仿 Claude Code 的字段名。
   - `isReadOnly` / `isDestructive` / `isConcurrencySafe` / `riskLevel`。
   - `validateInput`：只做参数、路径、格式校验。
   - `checkPermissions`：返回 `allow` / `deny` / `sandbox` / `ask`。
   - `execute`：实际执行，所有文件路径必须限制在 workspace 内。
3. 把 `buildXxxTool()` 加入 `buildClaudeCodeBaseSystemTools()`，默认 registry 才会注册。
4. 如需 smoke 脚本默认开放，同步更新 `scripts/agent-loop-smoke.ts` 的 `DEFAULT_TOOLS`。
5. 为新工具补 edge case，优先覆盖权限分支、路径逃逸、失败恢复、输出截断和并发安全。

### 权限语义

- `allow`：直接执行。
- `deny`：直接拒绝，返回 `permission_denied`。
- `sandbox`：带 `context.sandbox.enabled = true` 执行；当前是跨 macOS/Linux/Windows 的 portable MVP，不是 OS 级隔离。
- `ask`：交给 `permissionHandler`；CLI smoke runner 会询问 `[y/N]`。

默认策略在 `src/modules/agent-loop/toolPolicy.ts`，统一执行入口在 `src/modules/agent-loop/toolGateway.ts`。工具自己的 `checkPermissions()` 优先于默认策略。
