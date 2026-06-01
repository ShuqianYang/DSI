# Phase 0: Claude Tool-Use Loop Spike

## 验证目标

本 spike 验证以下核心假设：

1. **模型根据用户问题选择工具**：通过 `mockAgentDecision` 模拟 Agent 根据 query 关键词选择 weather-fetch 或 news 工具的可行性。
2. **工具调用经过统一 Gateway**：`callTool` 统一处理白名单校验、canonical name 映射、capability 查找和执行。
3. **拿到 observation 后返回结果**：执行结果通过统一 `{ ok, result, error }` 结构返回，再组装为 final response。
4. **白名单机制生效**：未在白名单中的工具不会被调用，返回 `tool_not_allowed`。
5. **未知工具不会执行**：registry 中不存在的工具返回 `unknown_tool`。

## 本 Spike 不验证

- **真实 Claude API 调用**：Phase 0 使用 mock 决策规则（关键词匹配），不接入 Anthropic SDK。
- **多轮 tool-use loop**：Phase 0 只支持单轮 tool call → observation → final answer。
- **复杂参数解析**：不从 query 中做 LLM 级别的参数抽取，仅做简单关键词提取。
- **CapabilityContract 自动生成**：Phase 0 手写 tool schema，Phase 1 再接入。
- **替换旧 Planner/Router/Executor**：Phase 0 完全隔离，不影响现有主链路。
- **完整 Template-first Agent Harness**：Phase 0 只验证开放 loop 的可行性，不上线真实 Agent。

## 运行方式

### 方式 A：Express Debug Route（推荐）

启动 API 服务后，通过 curl 或任意 HTTP 客户端调用：

```bash
curl -X POST http://localhost:3001/agent/phase0/tool-loop \
  -H "Content-Type: application/json" \
  -d '{"query": "查询东京今天的天气"}'
```

### 方式 B：Dev Script（不启动服务）

```bash
pnpm tsx api/src/modules/harness/phase0/devPhase0Runner.ts
```

该脚本内置 5 条测试 query，直接输出每个 query 的决策结果和 observation。

## 测试用例与预期结果

### 1. 天气查询

**Query:** `查询东京今天的天气`

**预期:**
- `selectedTool`: `weather-fetch`
- `toolParams`: `{ region: "东京" }`（或 "东海油膜片区"）
- `observation.ok`: `true`
- 返回气象数据（风速、风向、洋流等）

### 2. 新闻查询

**Query:** `最近日本有没有地震相关报道`

**预期:**
- `selectedTool`: `news`
- `toolParams`: `{ query: "最近日本有没有地震相关报道", region: "", timeRange: "7d" }`
- `observation.ok`: `true`
- 返回新闻搜索结果（文章列表、趋势分析、关键实体）

### 3. 无支持工具

**Query:** `帮我分析一个当前没有工具支持的需求`

**预期:**
- `selectedTool`: `undefined`（未命中任何工具）
- `finalText`: 说明当前 Phase 0 无合适工具，不随意调用工具
- 不应返回 weather-fetch 或 news 的调用结果

## 文件位置

| 文件 | 说明 |
|------|------|
| `api/src/modules/harness/phase0/toolGateway.ts` | 统一工具调用入口（白名单 + capability 执行） |
| `api/src/modules/harness/phase0/toolCatalog.ts` | 白名单工具 catalog（手写 schema + 示例） |
| `api/src/modules/harness/phase0/runPhase0ToolLoop.ts` | Agent loop 主函数（mock 决策 + gateway 调用 + 结果组装） |
| `api/src/modules/harness/phase0/routes.ts` | Express debug route：POST /agent/phase0/tool-loop |
| `api/src/modules/harness/phase0/devPhase0Runner.ts` | 独立运行脚本（pnpm tsx 直接运行） |
| `api/src/index.ts` | 修改：注册 `/agent/phase0` route |

## Mock 点汇总

| 组件 | Mock 内容 | 替换时机 |
|------|-----------|---------|
| `mockAgentDecision` | 用关键词匹配代替真实 LLM tool-use 决策 | Phase 1+ 接入真实 Claude API |
| `toolCatalog.inputSchema` | 手写 JSON schema | Phase 1 接入 CapabilityContract 自动生成 |
| `weather-fetch` 区域 | 对于未在 WEATHER_REGIONS 中的城市，capability 内部会回退到默认坐标 | capability 本身支持扩展 |

## Phase 1 替换清单

接入真实 Agent 和 CapabilityContract 时，需要替换以下 Phase 0 临时代码：

1. **`toolCatalog.ts`**
   - 手写 `inputSchema` → 从 `CapabilityContract` 自动生成
   - `examples` → 从 capability 元数据生成

2. **`runPhase0ToolLoop.ts`**
   - `mockAgentDecision` → 真实 Claude API `tools` 参数调用
   - 单轮 loop → 支持多轮 tool-use（while loop 直到 model 返回 final answer）

3. **`toolGateway.ts`**
   - 扩展 `ALLOWED_TOOLS` 白名单 → 从 capability 注册表动态生成
   - `CANONICAL_TO_REGISTRY` → 从 capability 元数据中的 canonical name 自动生成

4. **新增**
   - 引入 `CapabilityContract` 类型定义
   - 引入 Anthropic SDK 和 prompt 管理
   - 引入真正的 Agent state / memory 管理

## 验收标准检查表

- [x] 可以通过一个 query 触发 weather 或 news 工具调用
- [x] 工具调用经过统一 gateway（`callTool`）
- [x] 工具白名单生效（非白名单工具返回 `tool_not_allowed`）
- [x] 未知工具不会被执行（返回 `unknown_tool`）
- [x] 未命中工具时不会乱调用（返回 `final_answer`）
- [x] 旧 Planner/Router/Executor 主链路不受影响
- [x] 项目可以正常 typecheck（Phase 0 代码使用现有类型系统）
