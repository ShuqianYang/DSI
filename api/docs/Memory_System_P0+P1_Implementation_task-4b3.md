# Memory System P0+P1 Implementation Plan

## 20260714更新
B. Episode 抽取解耦到 DeepSeek
episodeExtractor.ts：工厂改读 DEEPSEEK_API_URL/API_KEY/MODEL/API_TIMEOUT_MS，直接用完整 URL（不再 joinUrl 拼路径）；启用开关从 GTE_API_BASE 改为 DEEPSEEK_API_KEY；默认模型 deepseek-v4-flash、超时 120s；删除已无用的 joinUrl；更新文件头注释
A. Embedding 切到 qwen3-embedding:0.6b（1024 维）
schema.ts：vector1536→vector1024（vector(1024)），两处 embedding 列同步
embeddingClient.ts：默认模型改为 qwen3-embedding:0.6b，注释更新为 1024 维（走 /v1/embeddings，逻辑不变）
三处 env 的 GTE_MODEL → qwen3-embedding:0.6b（api/.env、api/.env.example、docker/.env.example，并给 docker 示例补上 DEEPSEEK_API_KEY）
docker-compose.yaml：ollama-init 改为 ollama pull qwen3-embedding:0.6b，移除 gte-dsi 别名

## 概述

在现有 Agent Loop 的 MemoryManager 架构基础上，分层实现 P0（remember 持久化）、P1（向量召回 + 治理）和 Part C（超长任务可选中途提取）功能。所有新代码遵循现有模块化模式（工厂函数 + 依赖注入 + .mjs 测试）。

- **Part A (P0)**: remember() 持久化钩子 + 对话快照 + 转录摘要预计算
- **Part B (P1)**: pgvector 向量召回 + 情节提取 + 混合评分 + 记忆去重 + 治理规则
- **Part C (v2.0 补充)**: 超长任务（>30K tokens）中途检查点机制，三阈值触发 + 轻量快照

---

## Part A: P0 - remember() 持久化钩子 (P0-1, P0-2, P0-3)

### Task 1: Schema 变更 - task_conversation_snapshot 表

**文件**: `api/src/db/schema.ts`

新增 `taskConversationSnapshot` 表，使用 `customType` 定义 pgvector 列：

```typescript
import { customType } from "drizzle-orm/pg-core";

const vector1536 = customType<{ data: string; driverData: string }>({
  dataType() { return "vector(1536)"; },
});

export const taskConversationSnapshot = pgTable("task_conversation_snapshot", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  query: text("query").notNull(),
  finalAnswer: text("final_answer").notNull(),
  messages: jsonb("messages").notNull(),
  toolSummary: jsonb("tool_summary").default([]),
  summary: text("summary"),
  turns: integer("turns").notNull(),
  stoppedBy: text("stopped_by").notNull(),
  scenario: text("scenario"),
  entities: text("entities").array().default([]),
  embedding: vector1536("embedding"),
  isCheckpoint: boolean("is_checkpoint").notNull().default(false),
  checkpointTurn: integer("checkpoint_turn"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("task_conv_snapshot_task_id_idx").on(table.taskId),
  index("task_conv_snapshot_user_id_idx").on(table.userId),
  index("task_conv_snapshot_checkpoint_idx").on(table.taskId, table.isCheckpoint),
]);
```

同时导出类型：`TaskConversationSnapshot`, `NewTaskConversationSnapshot`

**Migration**: 手动创建 `api/src/db/migrations/0004_memory_p0_p1.sql`，包含建表 SQL + ivfflat 索引：

```sql
CREATE TABLE "task_conversation_snapshot" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL,
  "query" text NOT NULL,
  "final_answer" text NOT NULL,
  "messages" jsonb NOT NULL,
  "tool_summary" jsonb DEFAULT '[]',
  "summary" text,
  "turns" integer NOT NULL,
  "stopped_by" text NOT NULL,
  "scenario" text,
  "entities" text[] DEFAULT '{}',
  "embedding" vector(1536),
  "is_checkpoint" boolean NOT NULL DEFAULT false,
  "checkpoint_turn" integer,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "task_conv_snapshot_task_id_idx" ON "task_conversation_snapshot" USING btree ("task_id");
CREATE INDEX "task_conv_snapshot_user_id_idx" ON "task_conversation_snapshot" USING btree ("user_id");
CREATE INDEX "task_conv_snapshot_checkpoint_idx" ON "task_conversation_snapshot" USING btree ("task_id", "is_checkpoint");
CREATE INDEX "task_conv_snapshot_embedding_idx" ON "task_conversation_snapshot" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

CREATE TABLE "episodic_memories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid REFERENCES "tasks"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL,
  "scene" text,
  "user_query" text NOT NULL,
  "tool_sequence" jsonb DEFAULT '[]',
  "final_result" text,
  "importance" double precision DEFAULT 0.5,
  "tags" text[] DEFAULT '{}',
  "related_entities" text[] DEFAULT '{}',
  "embedding" vector(1536),
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "episodic_memories_user_id_idx" ON "episodic_memories" USING btree ("user_id");
CREATE INDEX "episodic_memories_scene_idx" ON "episodic_memories" USING btree ("scene");
CREATE INDEX "episodic_memories_embedding_idx" ON "episodic_memories" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
```

### Task 2: 实现 rememberManager.ts (P0-1, P0-2, P0-3)

**新文件**: `api/src/modules/agent-loop/rememberManager.ts`

工厂函数 `createRememberManager(input)` 返回 `{ remember(input: RememberInput): Promise<void> }`。

remember() 执行流程：
1. **P0-2 转录摘要写入**: 调用现有 `summarizeTranscriptForContext()` 计算 pre-computed summary，写入 `agent_transcript_entries` 表的一条 `loop_stop` 类型 entry，`metadata.preComputedSummary = true`
2. **P0-3 对话快照写入**: 构建 snapshot row（messages, finalAnswer, toolSummary 从 observations 提取, summary, turns, stoppedBy），写入 `task_conversation_snapshot` 表
3. **P1-4 情节提取（可选）**: 如果 embeddingClient + episodeExtractor 可用，异步提取 episode 并写入 `episodic_memories`（P1 阶段实现，P0 阶段预留接口）

```typescript
export interface CreateRememberManagerInput {
  db: DrizzleDb;
  currentTaskId: string;
  currentUserId: string | null;
  transcriptStore: AgentTranscriptStore;
  embeddingClient?: EmbeddingClient;     // P1 可选
  episodeExtractor?: EpisodeExtractor;   // P1 可选
  logger?: Pick<Console, "warn" | "log">;
}

export function createRememberManager(input: CreateRememberManagerInput) {
  return {
    async remember(rememberInput: RememberInput): Promise<void> {
      // 1. 计算 summary
      // 2. 写 transcript entry (P0-2)
      // 3. 写 conversation snapshot (P0-3)
      // 4. 异步 episode 提取 (P1-4, 可选)
    }
  };
}
```

toolSummary 从 observations 提取：`[{ toolName, ok, inputParams, outputPreview }]`

### Task 3: 集成到 pipeline (P0-1)

**文件**: `api/src/modules/tasks/pipelineMemory.ts`

修改 `createPipelineMemoryManager`：
- 接收 `db` 参数
- 创建 `rememberManager` 并将其 `remember()` 方法合并到返回的 MemoryManager 中

**文件**: `api/src/modules/tasks/pipeline.ts`

修改 `createDefaultRunAgentPipelineDependencies()`：
- 将 `db` 传入 `createPipelineMemoryManager`

**文件**: `api/src/modules/agent-loop/runAgentLoop.ts`

在 `max_turns` 路径（约 line 558）也调用 `memoryManager.remember()`，确保超长任务也能写入记忆。

### Task 4: SessionSummaryMemoryManager 使用 snapshot 优化召回 (P0-3 O(1) 查询)

**文件**: `api/src/modules/agent-loop/sessionSummaryMemoryManager.ts`

修改召回流程：
1. 先查 `task_conversation_snapshot` 表（1 条/任务，O(1)）
2. 如果 snapshot.summary 存在，直接使用，跳过 transcript 加载
3. 如果 snapshot 不存在，fallback 到现有 transcript 加载逻辑

修改 `listRecentCompletedTasks` 或新增 `listRecentSnapshots` 函数，查 snapshot 表替代查 tasks 表。

### Task 5: P0 测试

**新文件**: `api/tests/agent-loop/test-remember-manager.mjs`

测试用例：
- remember() 正确写入 conversation snapshot（验证字段完整性）
- remember() 正确写入 transcript summary entry
- toolSummary 从 observations 正确提取
- remember() 在 DB 错误时不阻塞（best-effort）
- 无 userId 时安全跳过

---

## Part B: P1 - 向量召回 + 治理 (P1-1 ~ P1-9)

### Task 6: Schema 变更 - episodic_memories 表 (P1-2)

**文件**: `api/src/db/schema.ts`

```typescript
export const episodicMemories = pgTable("episodic_memories", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  scene: text("scene"),
  userQuery: text("user_query").notNull(),
  toolSequence: jsonb("tool_sequence").default([]),
  finalResult: text("final_result"),
  importance: doublePrecision("importance").default(0.5),
  tags: text("tags").array().default([]),
  relatedEntities: text("related_entities").array().default([]),
  embedding: vector1536("embedding"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("episodic_memories_user_id_idx").on(table.userId),
  index("episodic_memories_scene_idx").on(table.scene),
]);
```

ivfflat 索引在 migration SQL 中手动添加。

### Task 7: Embedding 客户端 (P1-3)

**新文件**: `api/src/modules/agent-loop/embeddingClient.ts`

OpenAI 兼容 API 客户端，调用 gte-Qwen2-1.5B 生成 1536 维向量。

```typescript
export interface EmbeddingClient {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export function createEmbeddingClient(input?: {
  apiBase?: string;    // GTE_API_BASE, e.g. http://localhost:8000/v1
  apiKey?: string;     // GTE_API_KEY
  model?: string;      // GTE_MODEL, default gte-Qwen2-1.5B
  timeoutMs?: number;  // GTE_API_TIMEOUT_MS, default 30000
}): EmbeddingClient | undefined;
```

- 当 `GTE_API_BASE` 未设置时返回 `undefined`（降级模式）
- POST `${apiBase}/embeddings`，body: `{ model, input: text }`
- 解析 `data[0].embedding` 返回 number[]

**文件**: `api/.env.example` 新增：
```
# GTE Embedding & Episode Extraction (gte-Qwen2-1.5B)
GTE_API_BASE=
GTE_API_KEY=
GTE_MODEL=gte-Qwen2-1.5B
GTE_API_TIMEOUT_MS=30000
# Memory decay lambda (higher = faster forgetting)
AGENT_MEMORY_DECAY_LAMBDA=0.1
# Hybrid recall weights
AGENT_MEMORY_VECTOR_WEIGHT=0.6
AGENT_MEMORY_KEYWORD_WEIGHT=0.3
AGENT_MEMORY_ENTITY_WEIGHT=0.1
# Session Memory Trigger (超长任务中途提取)
AGENT_MEMORY_CHECKPOINT_ENABLED=0
AGENT_MEMORY_CHECKPOINT_MIN_TOKENS=30000
AGENT_MEMORY_CHECKPOINT_MIN_TOKENS_BETWEEN=5000
AGENT_MEMORY_CHECKPOINT_MIN_TOOL_CALLS_BETWEEN=3
```

### Task 8: 情节提取器 (P1-4)

**新文件**: `api/src/modules/agent-loop/episodeExtractor.ts`

使用 gte-Qwen2-1.5B 的指令跟随能力提取结构化情节，规则兜底。

```typescript
export interface ExtractedEpisode {
  scene: string;           // 地震评估/溢油溯源/船舶追踪/日常监测
  userQuery: string;
  toolSequence: Array<{
    toolName: string;
    inputParams: Record<string, unknown>;
    outputSummary: string;
    success: boolean;
  }>;
  finalResult: string;
  importance: number;      // 0-1
  tags: string[];
  relatedEntities: string[];
}

export interface EpisodeExtractor {
  extract(input: RememberInput): Promise<ExtractedEpisode>;
}

export function createEpisodeExtractor(input: {
  apiBase?: string;
  apiKey?: string;
  model?: string;
  logger?: Pick<Console, "warn">;
}): EpisodeExtractor;
```

提取流程：
1. 将对话格式化为 `{{task_messages}}` 文本
2. 使用用户提供的 Prompt（含 JSON Schema + 2 个 DSI 场景示例）
3. POST `${apiBase}/chat/completions`，temperature=0.1
4. 解析返回的 JSON，校验 Schema
5. 如果 JSON 解析失败，重试一次（追加 "请只输出JSON" 指令）
6. 如果仍失败，规则兜底：`{ scene: "日常监测", userQuery: input.query, toolSequence: [...从observations提取], finalResult: input.finalAnswer.slice(0,300), importance: 0.5, tags: [], relatedEntities: [] }`

### Task 9: 混合召回管理器 (P1-5, P1-6, P1-7)

**新文件**: `api/src/modules/agent-loop/hybridMemoryManager.ts`

包装 SessionSummaryMemoryManager，增加向量召回能力。

```typescript
export function createHybridMemoryManager(input: {
  sessionMemoryManager: MemoryManager;
  db: DrizzleDb;
  embeddingClient: EmbeddingClient;
  decayLambda: number;          // e^(-lambda * ageInDays)
  vectorWeight: number;         // 0.6
  keywordWeight: number;        // 0.3
  entityWeight: number;         // 0.1
  logger?: Pick<Console, "warn">;
}): MemoryManager
```

召回流程 (`startRelevantMemoryPrefetch`)：
1. 启动 session summary 召回（现有逻辑）
2. 并行：生成 query embedding → 向量搜索 `episodic_memories` + `task_conversation_snapshot`
3. 向量搜索 SQL: `SELECT *, 1 - (embedding <=> $queryVector) AS similarity FROM episodic_memories WHERE user_id = $userId ORDER BY embedding <=> $queryVector LIMIT 10`
4. 合并结果，应用记忆衰减：`finalScore = (vectorSim * vectorWeight + keywordScore * keywordWeight + entityScore * entityWeight) * decayFactor`
5. 衰减公式：`decayFactor = Math.exp(-decayLambda * ageInDays)`
6. 按 finalScore 降序排列，取 Top-N
7. 转换为 PromptSection[] 返回

### Task 10: 升级 memoryRecallDecision 评分 (P1-6)

**文件**: `api/src/modules/agent-loop/memoryRecallDecision.ts`

修改 `buildMemoryRecallDecision` 和 `scoreMemorySections`：
- 接收可选的 `vectorScores: Map<string, number>`（sectionId → 向量相似度）
- 接收可选的 `queryEntities: string[]`（从 query 中提取的实体）
- 综合评分：`score = vectorScore * 0.6 + keywordScore * 0.3 + entityMatchScore * 0.1`
- 向下兼容：无 vectorScores 时退化为纯关键词评分

### Task 11: MemoryRecallContext 去重 (P1-8)

**新文件**: `api/src/modules/agent-loop/memoryRecallContext.ts`

```typescript
export class MemoryRecallContext {
  private alreadySurfacedIds = new Set<string>();
  private recentTools: string[] = [];
  private readonly maxSurfaced = 50;
  private readonly keepRecentN = 30;

  markSurfaced(sectionIds: string[]): void;
  isAlreadySurfaced(sectionId: string): boolean;
  addRecentTool(toolName: string): void;
  getRecentTools(): string[];
  filterCandidates(sections: PromptSection[]): PromptSection[];
}
```

集成到 `filterDuplicateMemorySections`：除了按 ID 去重，还排除 alreadySurfaced 中的记忆。
在 `runAgentLoop.ts` 中，每次工具调用后调用 `addRecentTool`。

### Task 12: 记忆治理规则注入 Prompt (P1-9)

**新文件**: `api/src/modules/agent-loop/memoryGovernance.ts`

```typescript
export function buildMemoryGovernanceSection(): PromptSection {
  return {
    id: "memory.governance",
    content: [
      "# 记忆系统使用规则",
      "## 应该保存为记忆的内容",
      "- 用户角色、偏好、技能背景（user 类型）",
      "- 用户纠正和确认的行为指引（feedback 类型）",
      "- 任务结果中的重要发现和决策依据（episodic 类型）",
      "- 领域实体的新增信息和关系变更（semantic 类型）",
      "- 被验证有效的工具组合模式（procedural 类型）",
      "",
      "## 不应该保存为记忆的内容",
      "- 可从工具调用结果直接获取的实时数据",
      "- 临时调试信息、中间状态",
      "- 单次任务的常规执行细节（除非有特殊发现）",
      "- 任何包含敏感凭证的信息",
      "",
      "## 使用记忆时的规则",
      "1. 记忆是历史快照，可能已过时",
      "2. 在依赖记忆做判断前，用工具验证当前状态",
      "3. 如果记忆与当前观察矛盾，信任当前观察，并更新记忆",
      "4. 如果用户要求\"忽略记忆\"或\"不要用记忆\"：当做没有任何记忆来处理",
    ].join("\n"),
  };
}
```

**文件**: `api/src/modules/agent-loop/runAgentLoop.ts`

在 prompt 组装时（约 line 292-296），追加 `memoryGovernanceSection` 到 `promptMemorySections`。

### Task 13: P1 测试

**新文件** (6 个测试文件):

1. `api/tests/agent-loop/test-embedding-client.mjs`
   - 正常调用返回 1536 维向量
   - GTE_API_BASE 未设置时返回 undefined
   - API 超时/错误时抛异常

2. `api/tests/agent-loop/test-episode-extractor.mjs`
   - LLM 返回合规 JSON 时正确解析
   - LLM 返回非法 JSON 时重试
   - 重试仍失败时规则兜底
   - 兜底结果包含正确的 userQuery 和 finalResult

3. `api/tests/agent-loop/test-hybrid-memory-recall.mjs`
   - 向量召回 + 关键词召回合并
   - 记忆衰减：旧记忆分数低于新记忆
   - 混合评分权重正确（vector x0.6 + keyword x0.3 + entity x0.1）
   - embeddingClient 不可用时降级为纯关键词

4. `api/tests/agent-loop/test-memory-recall-context.mjs`
   - alreadySurfaced 去重：已展示的记忆不再注入
   - recentTools 追踪：工具调用后正确记录
   - 上限保护：超过 50 条时保留最近 30 条

5. `api/tests/agent-loop/test-memory-governance.mjs`
   - buildMemoryGovernanceSection 返回正确的 PromptSection
   - 包含 WHAT_TO_SAVE / WHAT_NOT_TO_SAVE / USAGE_RULES 三部分

6. `api/tests/agent-loop/test-memory-recall-decision-upgraded.mjs`
   - 向量 + 关键词混合评分
   - 无向量分数时退化为纯关键词
   - 实体匹配加分

---

## Part C: 超长任务可选中途提取 (v2.0 补充机制)

### 设计背景

设计文档 5.3.2 指出：DSI 的交互模式是任务驱动型，每个任务通常 3~5 轮 Turn，总 token 量通常 10K~30K。但当任务超长（>30K tokens）时，ContextWindowManager 会裁剪早期对话，可能导致关键信息丢失。

中途提取机制在自然断点处异步写入轻量快照（仅存 messages，不计算 summary 和 embedding），防止上下文裁剪丢失关键信息。与 remember() 的区别：

| 维度 | remember() | 中途提取 |
|------|-----------|----------|
| 触发时机 | 任务结束后 (final_answer) | 任务进行中 (自然断点) |
| 触发频率 | 每任务 1 次 | 超长任务多次，受三阈值控制 |
| 写入内容 | 完整快照 + summary + embedding | 仅 messages + toolSummary |
| 写入目标 | task_conversation_snapshot (isCheckpoint=false) | task_conversation_snapshot (isCheckpoint=true) |
| 主要目的 | 跨任务持久化 | 防止当前会话上下文裁剪丢信息 |

### Task 14: isCheckpoint 列已包含在 Task 1 建表 SQL 中

`task_conversation_snapshot` 表的 `is_checkpoint` 和 `checkpoint_turn` 列已在 Task 1 的 schema 定义和 migration SQL 中包含。无需额外 ALTER TABLE。

召回逻辑（Task 4 / Task 9）过滤 `WHERE is_checkpoint = false`，确保中途快照不干扰正常召回。

### Task 15: SessionMemoryTrigger - 三阈值触发逻辑

**新文件**: `api/src/modules/agent-loop/sessionMemoryTrigger.ts`

借鉴文档 5.3.3 的三阈值策略，适配 DSI 的更高阈值（DSI 任务较短，避免频繁触发）。

```typescript
export interface SessionMemoryTriggerConfig {
  /** 会话 token 总量达到此值才启用中途提取。DSI 默认 30000（文档 2.3），Claude Code 原值 10000 */
  minTokensToInit: number;
  /** 增量 token 达到此值才再次提取。默认 5000 */
  minTokensBetweenUpdate: number;
  /** 增量工具调用达到此值才再次提取。默认 3 */
  minToolCallsBetweenUpdate: number;
}

export interface SessionMemoryTriggerState {
  initialized: boolean;                    // 是否已越过初始化阈值
  estimatedTotalTokens: number;           // 当前会话估算总 token
  tokensSinceLastCheckpoint: number;      // 自上次检查点以来的增量 token
  toolCallsSinceLastCheckpoint: number;   // 自上次检查点以来的工具调用数
  lastCheckpointTurn: number;             // 上次检查点发生的轮次
  checkpointCount: number;                // 已写入的检查点总数
}

export interface CheckTriggerInput {
  estimatedTotalTokens: number;
  toolCallsSinceLastCheckpoint: number;
  tokensSinceLastCheckpoint: number;
  currentTurn: number;
  isNaturalBreakpoint: boolean;  // 工具批次执行完成 = true
}

export interface SessionMemoryTrigger {
  /** 检查是否应该触发中途提取。返回 true 时调用方应执行快照写入 */
  shouldTrigger(input: CheckTriggerInput): boolean;
  /** 标记已写入检查点，重置增量计数器 */
  markCheckpoint(turn: number): void;
  /** 获取当前状态（用于诊断） */
  getState(): SessionMemoryTriggerState;
  /** 更新 token 估算（每轮调用） */
  updateTokenEstimate(totalTokens: number): void;
}

export function createSessionMemoryTrigger(
  config?: Partial<SessionMemoryTriggerConfig>
): SessionMemoryTrigger;
```

触发逻辑（shouldTrigger）：
```
1. 如果 estimatedTotalTokens < minTokensToInit → return false（未达到启用阈值）
2. 如果 !initialized → initialized = true（首次越过阈值，标记初始化）
3. 触发条件 = (tokensSinceLastCheckpoint >= minTokensBetweenUpdate)
             AND (toolCallsSinceLastCheckpoint >= minToolCallsBetweenUpdate OR isNaturalBreakpoint)
4. return 触发条件
```

**环境变量**：已在 Task 7 的 `.env.example` 中定义（`AGENT_MEMORY_CHECKPOINT_*` 系列）。

### Task 16: Token 估算工具

**新文件**: `api/src/modules/agent-loop/tokenEstimator.ts`

复用 ContextWindowManager 的估算思路，提供轻量级 token 计数。

```typescript
export interface TokenEstimate {
  totalTokens: number;
  messageCount: number;
  charCount: number;
}

/** 估算 AgentMessage[] 的 token 数。规则：JSON 字符数 / 4（近似） */
export function estimateMessagesTokens(messages: AgentMessage[]): TokenEstimate;
```

与 ContextWindowManager 的 `approxTokens` 保持一致（json-chars / 4），确保阈值判断准确。

### Task 17: MidTaskCheckpointWriter - 轻量快照写入

**新文件**: `api/src/modules/agent-loop/midTaskCheckpoint.ts`

在自然断点处异步写入轻量快照，不阻塞 Agent Loop 主流程。

```typescript
export interface MidTaskCheckpointWriter {
  /** 在自然断点处写入检查点快照。仅存 messages + toolSummary，不计算 summary 和 embedding */
  writeCheckpoint(input: {
    taskId: string;
    userId: string | null;
    query: string;
    messages: AgentMessage[];
    observations: ToolObservation[];
    turn: number;
  }): Promise<void>;
}

export function createMidTaskCheckpointWriter(input: {
  db: DrizzleDb;
  trigger: SessionMemoryTrigger;
  logger?: Pick<Console, "warn" | "log">;
}): MidTaskCheckpointWriter;
```

writeCheckpoint 流程：
1. 从 observations 提取 toolSummary（同 RememberManager 逻辑）
2. 构建 snapshot row：
   - `messages`: 当前完整对话 JSONB
   - `toolSummary`: 工具调用摘要
   - `summary`: null（不计算）
   - `embedding`: null（不计算）
   - `isCheckpoint`: true
   - `checkpointTurn`: 当前轮次
   - `stoppedBy`: "checkpoint"
   - `finalAnswer`: ""（占位，非 final_answer）
   - `turns`: 当前轮次
3. INSERT 到 `task_conversation_snapshot` 表
4. 调用 `trigger.markCheckpoint(turn)` 重置增量计数
5. 异步执行，异常仅 warn 不 throw（best-effort）

### Task 18: 集成到 runAgentLoop - 自然断点检测

**文件**: `api/src/modules/agent-loop/runAgentLoop.ts`

在 Turn 循环中，工具批次执行完成后的位置（约 line 519-530，`nextMemorySections` 之后）插入中途提取检查：

```typescript
// 在 runAgentLoopEvents 函数内，工具批次执行完成后：

// --- Mid-task checkpoint (超长任务中途提取) ---
if (midTaskCheckpointWriter) {
  const tokenEstimate = estimateMessagesTokens([
    ...initialMessages, ...conversationMessages
  ]);
  midTaskCheckpointWriter.trigger.updateTokenEstimate(tokenEstimate.totalTokens);

  const shouldCheckpoint = midTaskCheckpointWriter.trigger.shouldTrigger({
    estimatedTotalTokens: tokenEstimate.totalTokens,
    toolCallsSinceLastCheckpoint: batchObservations.length,
    tokensSinceLastCheckpoint: tokenEstimate.totalTokens,
    currentTurn: turn,
    isNaturalBreakpoint: true, // 工具批次完成 = 自然断点
  });

  if (shouldCheckpoint) {
    // 异步写入，不阻塞主循环
    midTaskCheckpointWriter
      .writeCheckpoint({
        taskId: options.taskId,
        userId: midTaskCheckpointWriter.userId,
        query: options.query,
        messages: [...initialMessages, ...conversationMessages],
        observations,
        turn,
      })
      .catch((error) => {
        // best-effort: 仅日志，不中断
      });
  }
}
```

**RunAgentLoopOptions 新增**：
```typescript
midTaskCheckpointWriter?: MidTaskCheckpointWriter;
```

**Pipeline 集成** (`pipeline.ts`)：
- 当 `AGENT_MEMORY_CHECKPOINT_ENABLED=1` 时创建 MidTaskCheckpointWriter
- 传入 runAgentLoop options

### Task 19: 中途提取测试

**新文件**: `api/tests/agent-loop/test-session-memory-trigger.mjs`

测试用例：
- 未达到 minTokensToInit 时不触发（< 30000 tokens）
- 达到 minTokensToInit 但增量不足时不触发
- 达到 minTokensToInit + 增量 token 足够 + 工具调用足够时触发
- 达到 minTokensToInit + 增量 token 足够 + 自然断点时触发（工具调用不足也触发）
- markCheckpoint 后增量计数器重置
- 多次检查点之间的增量计数正确累加

**新文件**: `api/tests/agent-loop/test-mid-task-checkpoint.mjs`

测试用例：
- writeCheckpoint 写入 isCheckpoint=true 的快照
- 快照不含 summary 和 embedding（均为 null）
- 快照包含正确的 messages 和 toolSummary
- checkpointTurn 字段正确记录轮次
- DB 异常时仅 warn 不 throw

**新文件**: `api/tests/agent-loop/test-token-estimator.mjs`

测试用例：
- 空消息列表返回 0 tokens
- 已知消息列表返回合理的 token 估算
- token 估算 = ceil(charCount / 4)

---

## 实现顺序

1. **Schema + Migration** (Task 1, 6, 14) - 先建表（含 isCheckpoint 列）
2. **Embedding Client** (Task 7) - 基础设施
3. **RememberManager** (Task 2) - P0 核心
4. **Pipeline 集成** (Task 3) - P0 接线
5. **Snapshot 召回优化** (Task 4) - P0 优化
6. **P0 测试** (Task 5) - P0 验证
7. **Episode Extractor** (Task 8) - P1 基础
8. **HybridMemoryManager** (Task 9) - P1 核心
9. **RecallDecision 升级** (Task 10) - P1 评分
10. **MemoryRecallContext** (Task 11) - P1 去重
11. **MemoryGovernance** (Task 12) - P1 治理
12. **P1 测试** (Task 13) - P1 验证
13. **TokenEstimator** (Task 16) - Part C 基础设施
14. **SessionMemoryTrigger** (Task 15) - Part C 触发逻辑
15. **MidTaskCheckpointWriter** (Task 17) - Part C 快照写入
16. **runAgentLoop 集成** (Task 18) - Part C 接线
17. **Part C 测试** (Task 19) - Part C 验证

## 注意事项

- pgvector 扩展已在 Docker 中启用（`pgvector/pgvector:pg16` + `001-enable-vector.sql`），P1-1 无需额外操作
- 所有新模块遵循依赖注入模式，可通过 env 开关降级
- embeddingClient/episodeExtractor 不可用时，系统降级为纯 P0 + 关键词召回，不影响现有功能
- 测试使用 .mjs + tsx 模式，与现有测试一致
- 迁移 SQL 手动编写，包含 ivfflat 索引（drizzle-kit generate 无法生成向量索引）
- **Part C 中途提取默认关闭**（`AGENT_MEMORY_CHECKPOINT_ENABLED=0`），需显式开启，避免对短任务产生额外开销
- **Part C 中途快照与 P0 remember() 共享同一张表**（task_conversation_snapshot），通过 `is_checkpoint` 列区分，召回时过滤掉 checkpoint 行
- **Part C 与 ContextWindowManager 配合**：ContextWindowManager 裁剪对话时，中途快照已保存了被裁剪的内容，可用于后续恢复或审计
