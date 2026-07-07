# 模型适配层设计方案

> 目标：在当前项目（`D:/0 ysq文件/DSI-agent-loop`）中引入统一的模型适配层，支持多种模型接入方式（OpenAI-compatible、Ollama、SGLang、vLLM 等），并兼容不同模型的输出 JSON 格式差异。
> 更新时间：2026-07-06

---

## 1. 现状与问题

### 1.1 当前模型调用现状

当前项目中，模型调用呈散点分布：

| 文件 | 用途 | 接入方式 | 问题 |
|------|------|----------|------|
| `api/src/modules/agent-loop/modelClient.ts` | Agent Loop 主决策 | OpenAI-compatible API（Qwen/DeepSeek） | 硬编码，切换模型需改源码；只能接兼容 OpenAI 的模型 |
| `api/src/modules/agent-loop/tools/domain/dailyReport/dailyReport.ts` | 日报生成 | OpenAI-compatible API（Qwen） | 独立配置 API key/url/model，重复代码 |
| `api/src/modules/agent-loop/tools/domain/satellite/imageAnalysis.ts` | 卫星图像分析 | OpenAI-compatible API（Qwen-VL） | 独立配置，重复代码 |
| `api/tests/integration/test-qwen-only.mjs` | 测试 | OpenAI-compatible API | — |

### 1.2 主要问题

1. **多处重复配置**：API key、base URL、model name 分散在不同文件中。
2. **接入方式单一**：只支持 OpenAI-compatible HTTP API，无法直接接入本地 Ollama、SGLang、vLLM 服务。
3. **输出格式强耦合**：假设所有模型都返回 `choices[0].message.{content,tool_calls}`，无法兼容格式差异较大的模型。
4. **工具调用格式不统一**：不同模型/框架对 tool calling 的 JSON 字段命名、arguments 序列化方式可能不同。
5. **扩展困难**：新增一种模型需要多处修改，容易遗漏。

---

## 2. 设计目标

1. **统一入口**：所有模型调用通过 `ModelClient` 接口，隐藏底层接入差异。
2. **多 Provider 支持**：OpenAI-compatible（Qwen、DeepSeek、GPT 等）、Ollama、SGLang、vLLM 等可插拔。
3. **输出格式适配**：每个 Provider 负责将原始响应转换为统一的 `NormalizedModelResponse`。
4. **工具调用统一**：统一处理 tool calls 的字段名、arguments 解析、ID 生成等。
5. **配置驱动**：通过环境变量或配置文件选择模型，无需改源码即可切换。
6. **向后兼容**：现有 `modelClient.ts` 的接口保持不变，逐步迁移各工具。

---

## 3. 总体架构

```text
┌─────────────────────────────────────────────────────────────────┐
│                        业务层 (Callers)                          │
│  runAgentLoop │ DailyReport │ ImageAnalysis │ Other Tools       │
└────────────────────┬────────────────────────────────────────────┘
                     │ 统一调用 ModelClient.decide() / chat()
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                      ModelClient 接口层                          │
│  decide(messages, tools) -> NormalizedAgentDecision              │
│  chat(messages, options) -> NormalizedChatResponse               │
└────────────────────┬────────────────────────────────────────────┘
                     │ 根据 provider 路由
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Model Provider 实现层                        │
│  OpenAIProvider │ OllamaProvider │ SGLangProvider │ vLLMProvider │
│  ─────────────  │ ────────────  │ ─────────────  │ ───────────  │
│  封装 HTTP 请求  │ 封装 Ollama   │ 封装 SGLang    │ 封装 vLLM    │
│  适配响应格式    │ /api/generate │ /v1/chat/      │ /v1/chat/    │
│                 │ /api/chat     │ completions    │ completions  │
└────────────────────┬────────────────────────────────────────────┘
                     │ 原始 JSON
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Response Adapter 层                          │
│  将各 Provider 的原始 JSON 转为统一结构：                         │
│  NormalizedChatResponse { content, toolCalls, usage, finishReason }│
│  NormalizedAgentDecision { type: "final_answer" | "tool_calls" }  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. 核心接口设计

### 4.1 统一模型配置

```typescript
// api/src/modules/agent-loop/model/config.ts
export interface ModelConfig {
  provider: "openai" | "ollama" | "sglang" | "vllm" | "custom";
  apiKey?: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
  // provider 特定扩展配置
  options?: Record<string, unknown>;
}

export function loadModelConfig(prefix?: string): ModelConfig {
  const envPrefix = prefix ? `${prefix}_` : "";
  return {
    provider: readEnv(`${envPrefix}MODEL_PROVIDER`, "openai") as ModelConfig["provider"],
    apiKey: readEnv(`${envPrefix}MODEL_API_KEY`, ""),
    baseUrl: readEnv(`${envPrefix}MODEL_BASE_URL", getDefaultBaseUrl(provider)),
    model: readEnv(`${envPrefix}MODEL_NAME", "qwen-plus"),
    timeoutMs: parseIntEnv(`${envPrefix}MODEL_TIMEOUT_MS`, 120_000),
    temperature: parseFloatEnv(`${envPrefix}MODEL_TEMPERATURE`, 0.1),
    maxTokens: parseIntEnv(`${envPrefix}MODEL_MAX_TOKENS`, undefined),
  };
}
```

### 4.2 ModelClient 接口

```typescript
// api/src/modules/agent-loop/model/types.ts
export interface NormalizedChatResponse {
  content?: string;
  toolCalls?: NormalizedToolCall[];
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  finishReason?: string;
  rawResponse?: unknown; // 保留原始响应用于调试
}

export interface NormalizedToolCall {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface ModelChatOptions {
  tools?: ModelToolDefinition[];
  toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: "json_object" | "json_schema"; schema?: unknown };
  signal?: AbortSignal;
}

export interface ModelToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ModelClient {
  /**
   * 通用对话接口，返回统一结构。
   */
  chat(messages: AgentMessage[], options?: ModelChatOptions): Promise<NormalizedChatResponse>;

  /**
   * Agent Loop 决策专用接口。
   * 底层可复用 chat()，但语义更清晰。
   */
  decide(input: {
    messages: AgentMessage[];
    tools: ModelToolDefinition[];
    query: string;
    observations: ToolObservation[];
    callId: string;
  }): Promise<NormalizedAgentDecision>;
}
```

### 4.3 NormalizedAgentDecision（保持现有语义）

```typescript
// 已存在于 api/src/modules/agent-loop/tools/_shared/types.ts
export type NormalizedAgentDecision =
  | { type: "tool_calls"; toolCalls: GatewayToolCall[]; content?: string }
  | { type: "final_answer"; content: string };
```

---

## 5. Provider 实现方案

### 5.1 OpenAI-compatible Provider

覆盖：Qwen（DashScope）、DeepSeek、OpenAI、Azure OpenAI、智谱、Kimi 等。

```typescript
// api/src/modules/agent-loop/model/providers/openaiProvider.ts
export class OpenAIProvider implements ModelClient {
  constructor(private config: ModelConfig) {}

  async chat(messages: AgentMessage[], options?: ModelChatOptions): Promise<NormalizedChatResponse> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: messages.map(toOpenAIMessage),
      stream: false,
      temperature: options?.temperature ?? this.config.temperature,
    };
    if (options?.tools?.length) {
      body.tools = options.tools.map(toOpenAITool);
      body.tool_choice = options.toolChoice ?? "auto";
    }
    if (options?.responseFormat) {
      body.response_format = options.responseFormat;
    }

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    const json = await response.json();
    return normalizeOpenAIResponse(json);
  }

  async decide(input): Promise<NormalizedAgentDecision> {
    const response = await this.chat(input.messages, {
      tools: input.tools,
      toolChoice: "auto",
      temperature: this.config.temperature,
    });
    return toAgentDecision(response, input.callId);
  }
}
```

### 5.2 Ollama Provider

Ollama 提供 `/api/generate` 和 `/api/chat` 两种接口。推荐用 `/api/chat`（兼容 OpenAI 的 messages 格式）。

```typescript
// api/src/modules/agent-loop/model/providers/ollamaProvider.ts
export class OllamaProvider implements ModelClient {
  constructor(private config: ModelConfig) {}

  async chat(messages: AgentMessage[], options?: ModelChatOptions): Promise<NormalizedChatResponse> {
    const body = {
      model: this.config.model,
      messages: messages.map(toOllamaMessage),
      stream: false,
      options: {
        temperature: options?.temperature ?? this.config.temperature,
        num_predict: options?.maxTokens ?? this.config.maxTokens,
      },
    };

    const response = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    const json = await response.json();
    return normalizeOllamaResponse(json);
  }

  decide(input): Promise<NormalizedAgentDecision> {
    // Ollama 原生 tool calling 支持在 0.3.x 后增加，但稳定性不如 OpenAI 格式
    // 可采用 JSON mode + prompt 内嵌 tool schema 作为 fallback
    return this.chat(input.messages, { ... })
      .then(r => toAgentDecision(r, input.callId));
  }
}
```

**Ollama 输出格式示例**：

```json
{
  "model": "llama3.1",
  "created_at": "2024-07-22T20:00:00Z",
  "message": {
    "role": "assistant",
    "content": "",
    "tool_calls": [
      {
        "function": {
          "name": "MysqlQuery",
          "arguments": { "sql": "SELECT * FROM alarm_event" }
        }
      }
    ]
  },
  "done": true
}
```

### 5.3 SGLang Provider

SGLang 原生提供 OpenAI-compatible `/v1/chat/completions`，通常可直接复用 OpenAIProvider，只需修改 `baseUrl`。

特殊场景：

- SGLang 支持 `extra_body` 传 `regex` / `json_schema` 约束。
- 如需使用 SGLang 特有的结构化输出，可在 `ModelConfig.options` 中配置 `extraBody`。

```typescript
// api/src/modules/agent-loop/model/providers/sglangProvider.ts
export class SGLangProvider extends OpenAIProvider {
  // 复用 OpenAIProvider 的 chat/decide
  // 可在构造时注入 SGLang 特定的 baseUrl 和 options
}
```

### 5.4 vLLM Provider

vLLM 也提供 OpenAI-compatible `/v1/chat/completions`，通常直接复用 OpenAIProvider。

特殊场景：

- vLLM 支持 `guided_json`、`guided_regex`、`guided_choice` 等结构化输出参数。
- 可在 `ModelConfig.options.guidedJson` 中传入。

```typescript
// api/src/modules/agent-loop/model/providers/vllmProvider.ts
export class VLLMProvider extends OpenAIProvider {
  protected buildChatBody(messages, options) {
    const body = super.buildChatBody(messages, options);
    if (this.config.options?.guidedJson) {
      body.guided_json = this.config.options.guidedJson;
    }
    return body;
  }
}
```

### 5.5 Custom Provider（兜底扩展）

如果未来出现不兼容以上任何一种的模型，可新增 Provider 实现 `ModelClient` 接口，无需修改上层代码。

---

## 6. 输出格式适配策略

### 6.1 统一响应结构

所有 Provider 最终必须转换为：

```typescript
interface NormalizedChatResponse {
  content?: string;
  toolCalls?: NormalizedToolCall[];
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  finishReason?: string;
  rawResponse?: unknown;
}
```

### 6.2 不同 Provider 的关键差异

| Provider | 消息路径 | Tool Calls 路径 | Arguments 类型 | 备注 |
|----------|----------|-----------------|----------------|------|
| OpenAI-compatible | `choices[0].message.content` | `choices[0].message.tool_calls[].function` | JSON string | 标准格式 |
| Ollama | `message.content` | `message.tool_calls[].function` | 已解析对象 | 无 `choices` |
| SGLang | `choices[0].message.content` | `choices[0].message.tool_calls[].function` | JSON string | 与 OpenAI 一致 |
| vLLM | `choices[0].message.content` | `choices[0].message.tool_calls[].function` | JSON string | 与 OpenAI 一致 |

### 6.3 Tool Arguments 解析适配

不同模型可能返回字符串或已解析对象，统一处理：

```typescript
function parseToolArguments(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return {};
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Tool arguments must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
```

### 6.4 Tool Call ID 适配

部分本地模型（Ollama）可能不返回 tool call id，统一生成 fallback ID：

```typescript
function normalizeToolCallId(rawId: unknown, fallbackPrefix: string, index: number): string {
  if (typeof rawId === "string" && rawId.trim()) return rawId;
  return `${fallbackPrefix}-${index + 1}`;
}
```

---

## 7. 配置方案

### 7.1 环境变量（推荐）

```bash
# Agent Loop 主模型
AGENT_MODEL_PROVIDER=openai
AGENT_MODEL_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
AGENT_MODEL_API_KEY=sk-xxx
AGENT_MODEL_NAME=qwen-plus
AGENT_MODEL_TIMEOUT_MS=120000
AGENT_MODEL_TEMPERATURE=0.1

# 日报生成专用模型（可选，默认复用主模型配置）
DAILY_REPORT_MODEL_PROVIDER=openai
DAILY_REPORT_MODEL_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
DAILY_REPORT_MODEL_API_KEY=sk-xxx
DAILY_REPORT_MODEL_NAME=qwen-plus

# Ollama 本地模型示例
# AGENT_MODEL_PROVIDER=ollama
# AGENT_MODEL_BASE_URL=http://localhost:11434
# AGENT_MODEL_NAME=llama3.1
# AGENT_MODEL_API_KEY=  # Ollama 通常不需要

# SGLang 本地模型示例
# AGENT_MODEL_PROVIDER=sglang
# AGENT_MODEL_BASE_URL=http://localhost:30000/v1
# AGENT_MODEL_NAME=meta-llama/Meta-Llama-3.1-8B-Instruct
```

### 7.2 Provider 工厂

```typescript
// api/src/modules/agent-loop/model/modelClientFactory.ts
export function createModelClient(config?: ModelConfig): ModelClient {
  const cfg = config ?? loadModelConfig("AGENT");
  switch (cfg.provider) {
    case "openai":
      return new OpenAIProvider(cfg);
    case "ollama":
      return new OllamaProvider(cfg);
    case "sglang":
      return new SGLangProvider(cfg);
    case "vllm":
      return new VLLMProvider(cfg);
    case "custom":
      return createCustomProvider(cfg);
    default:
      throw new Error(`Unknown model provider: ${cfg.provider}`);
  }
}
```

---

## 8. 迁移方案

### 8.1 第一阶段：重构 modelClient.ts

1. 新建 `api/src/modules/agent-loop/model/` 目录。
2. 迁移现有 `modelClient.ts` 逻辑到 `OpenAIProvider`。
3. 保留 `createModelClient()` 导出，但内部改为 `modelClientFactory.createModelClient()`。
4. `runAgentLoop.ts` 中 `createModelClient()` 调用保持不变。

### 8.2 第二阶段：统一工具内模型调用

将以下文件中直接调用 fetch 的代码替换为 `createModelClient(config)`：

| 文件 | 用途 | 建议配置前缀 |
|------|------|--------------|
| `dailyReport.ts` | 日报生成 | `DAILY_REPORT` |
| `imageAnalysis.ts` | 图像分析 | `IMAGE_ANALYSIS` |

示例（DailyReport）：

```typescript
const modelClient = createModelClient(loadModelConfig("DAILY_REPORT"));
const response = await modelClient.chat(
  [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ],
  { temperature: 0.1 }
);
return response.content ?? fallback;
```

### 8.3 第三阶段：新增 Provider

依次实现：

1. `OllamaProvider`（本地 CPU/GPU 运行）
2. `SGLangProvider`（高性能本地推理）
3. `VLLMProvider`（大批量本地推理）

### 8.4 第四阶段：流式支持（可选增强）

当前 Agent Loop 使用 `stream: false`。如需支持流式输出到前端，可在 `ModelClient` 中增加：

```typescript
chatStream(messages: AgentMessage[], options: ModelChatOptions): AsyncGenerator<NormalizedChatStreamChunk>;
```

用于未来实现打字机效果或实时 tool call 思考过程。

---

## 9. 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `api/src/modules/agent-loop/model/types.ts` | 新增 | 统一接口和类型定义 |
| `api/src/modules/agent-loop/model/config.ts` | 新增 | 模型配置加载 |
| `api/src/modules/agent-loop/model/modelClientFactory.ts` | 新增 | Provider 工厂 |
| `api/src/modules/agent-loop/model/providers/baseProvider.ts` | 新增 | Provider 公共工具函数 |
| `api/src/modules/agent-loop/model/providers/openaiProvider.ts` | 新增 | OpenAI-compatible Provider |
| `api/src/modules/agent-loop/model/providers/ollamaProvider.ts` | 新增 | Ollama Provider |
| `api/src/modules/agent-loop/model/providers/sglangProvider.ts` | 新增 | SGLang Provider |
| `api/src/modules/agent-loop/model/providers/vllmProvider.ts` | 新增 | vLLM Provider |
| `api/src/modules/agent-loop/modelClient.ts` | 重写 | 委托给 modelClientFactory |
| `api/src/modules/agent-loop/tools/domain/dailyReport/dailyReport.ts` | 修改 | 使用统一模型客户端 |
| `api/src/modules/agent-loop/tools/domain/satellite/imageAnalysis.ts` | 修改 | 使用统一模型客户端 |
| `api/.env.example` | 修改 | 增加模型配置示例 |
| `api/tests/integration/model-adapter-smoke.mjs` | 新增 | 各 Provider smoke 测试 |

---

## 10. 需要确认的问题

1. **Provider 优先级**：是否优先实现 OpenAI + Ollama，SGLang/vLLM 作为第二阶段？
2. **工具调用方式**：Ollama 等本地模型如果原生 tool calling 不稳定，是否允许 fallback 到 JSON mode + prompt 内嵌工具？
3. **多模型并行**：是否需要同时支持“主模型用 Qwen，日报用本地 Ollama”这样的异构配置？
4. **流式支持**：当前 Agent Loop 为非流式，是否有必要在适配层预留流式接口？
5. **Vision 支持**：ImageAnalysis 当前使用 Qwen-VL，是否需要适配层同时支持本地 vision 模型（如 LLaVA via Ollama）？

---

## 11. 推荐实施顺序

```text
1. 设计评审（确认本方案）
2. 新建 model/ 目录，定义 types/config/factory
3. 迁移现有 OpenAI 逻辑到 OpenAIProvider
4. 重写 modelClient.ts 保持接口不变
5. 迁移 DailyReport / ImageAnalysis 使用统一客户端
6. 新增 OllamaProvider + smoke 测试
7. 新增 SGLangProvider / VLLMProvider
8. 更新 .env.example 和文档
```

---

*方案作者：Kimi Code CLI*
