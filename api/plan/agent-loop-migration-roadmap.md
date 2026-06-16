# Agent Loop Migration Roadmap

> 目标：长期记录从旧 Planner/Router/Executor/Capability 体系迁移到 Agent Loop 体系的真实进度、保留边界和下一步优先级。

## 当前结论

Agent Loop 已经成为前端提问和后端工具执行的主路径。当前阶段不再是“让 Agent Loop 能跑起来”，而是进入：

```text
native Agent Loop 稳定化
-> 结构化可观测性
-> transcript persistence
-> prompt versioning
-> resume / context recovery / memory
```

Legacy SSE adapter 和前端 legacy fallback 已删除。仍然保留的旧形状主要是 Dashboard 展示 API 的兼容投影，例如 `/jobs`、`/events` 和 `task.result[toolCallId]`，这些不再视为运行时 legacy fallback，而是前端展示层的 projection contract。

## 已完成

### 1. Dashboard 兼容路由

已保留旧前端依赖的展示路由：

- `/jobs`
- `/events`
- `/events/:id`
- `/subscriptions`
- `/requirements`
- `/insights`
- `/ais/data`
- `/ads/data`

核心文件：

- `api/src/modules/dashboard/projection.ts`
- `api/src/modules/dashboard/service.ts`
- `api/src/modules/dashboard/controller.ts`
- `api/src/modules/dashboard/routes.ts`
- `api/src/index.ts`

当前定位：

- `/jobs` 动态投影 `tasks` / `task_steps`。
- `/events` 动态投影已完成或失败的 tool observations。
- `/ads/data` 读取 `aircraft_current_states`。
- `/ais/data` 暂时保留为空结果兼容接口。

### 2. Native Agent Loop SSE

已完成，且已经成为唯一主路径。

核心文件：

- `api/src/modules/agent-loop/runAgentLoop.ts`
- `api/src/modules/tasks/routes.ts`
- `api/src/modules/tasks/agentLoopSseMode.ts`

原生事件：

- `agent_turn`
- `assistant_message`
- `tool_call`
- `tool_progress`
- `tool_observation`
- `loop_stop`

说明：

- `runAgentLoop` 直接通过 `notifyTaskUpdate` 推送 native events。
- `/tasks/:taskId/stream` 对已结束任务只 replay `loop_stop`。
- `model_request` 和 `tool_message` 仍可进入 transcript/log，但不作为前端主 SSE 展示事件。

### 3. Legacy SSE Adapter 和前端 fallback 删除

已完成删除。

删除内容：

- `api/src/modules/tasks/agentLoopEventAdapter.ts`
- `src/lib/legacyTaskStreamFallback.ts`
- legacy SSE adapter 相关测试
- 前端 `legacy-fallback` 处理分支

保留内容：

- `src/lib/agentLoopEvents.ts` 仍能识别旧事件类型，但只用于分类后忽略。
- `src/lib/taskStreamRouter.ts` 对旧事件统一返回 `ignored-legacy`。

设计含义：

- 前端不再从 `planning` / `routing_done` / `step_update` 推导 UI。
- 若后端误发旧事件，前端不会被它驱动。

### 4. 前端原生 Agent Loop 支持

已完成主链路。

核心文件：

- `src/lib/agentLoopEvents.ts`
- `src/lib/taskStreamRouter.ts`
- `src/lib/taskStreamLifecycle.ts`
- `src/lib/agentLoopStepFormatter.ts`
- `src/lib/agentLoopGisBridge.ts`
- `src/hooks/useTaskChat.ts`
- `src/hooks/useRightPanel.ts`
- `src/app/page.tsx`
- `src/components/right-panel/TaskSection.tsx`
- `src/components/info-center/TaskTrace.tsx`

能力：

- ChatPanel 展示 native tool step。
- RightPanel 从 native task result 提取 Agent Loop GIS outputs。
- 地图从 `tool_observation.output.gisData` 和 `loop_stop.result.observations` 联动。
- 前端内存 trace 和 Copy Trace 已支持排查。
- 每次 Agent Loop 运行会写入 `projects_new/logs` 的 JSONL 文件。

### 5. task.result projection

已完成，并暂时保留。

核心文件：

- `api/src/modules/tasks/agentLoopResultProjection.ts`
- `api/src/modules/tasks/pipeline.ts`

当前结构：

```ts
{
  message,
  mode: "agent_loop",
  turns,
  stoppedBy,
  logFilePath,
  observations,
  [toolCallId]: {
    success,
    message,
    gisData,
    metadata
  }
}
```

当前定位：

- `observations` 是 native 结果主结构。
- `[toolCallId]` 是 Dashboard / RightPanel 恢复 GIS 输出的展示投影。
- 后续可以把内部函数名从 `LegacyActionResult` 改成 `DashboardActionProjection`，但不急于删除该投影。

### 6. OpenSky 真实数据链路

已完成主要闭环。

能力：

- OpenSky fetch。
- 当前快照落库。
- worker 定时写入。
- 空 states 不替换当前表。
- 无效 `icao24` / `last_contact` 计数。
- worker shutdown 超时保护。
- `agent:smoke -- --refresh-opensky --query ...` 可触发真实写入后测试。

核心计划参考：

- `api/plan/opensky-hourly-ingestion-plan.md`
- `api/plan/opensky-agent-tool-plan.md`
- `api/plan/ais-hourly-ingestion-and-query-plan.md`

### 7. GIS 工具链

已完成第一条稳定真实/半真实纵切：

```text
RegionResolve -> RegionMark -> WeatherFetch
```

核心文件：

- `api/src/modules/agent-loop/tools/domain/gis/regionResolve.ts`
- `api/src/modules/agent-loop/tools/domain/gis/regionMark.ts`
- `api/src/modules/agent-loop/tools/domain/weather/weather.ts`
- `api/scripts/agent-loop/agent-loop-smoke-gis.ts`
- `api/tests/agent-loop/test-agent-loop-smoke-gis-helpers.mjs`

当前策略：

- 命名区域先 `RegionResolve`。
- `RegionMark` 只接受明确 geometryRef / bbox / polygon，不负责地名解析。
- 下游 weather / aircraft / maritime / disaster 复用 `RegionResolve.selected.bbox`。
- 不能解析时不猜 bbox。

### 8. RegionResolve PostGIS 化

已完成到可用阶段。

当前 PostGIS 表：

```text
amazon
china_board
china_city
china_province
china_town
chinabasin
custom_region
custom_region_copy1
hexicorridor
international
international_copt
rivers
sea_geom
taiwan
```

已补 curated region：

- `region_cn='台湾海峡'`
- `region_en='Taiwan Strait'`
- `level='strait'`

参考计划：

- `api/plan/region-resolve-global-geojson.md`

### 9. Disaster / Satellite 工具链

已不再只是计划，已有第一版工具和 prompt 规则。

核心文件：

- `api/src/modules/agent-loop/tools/domain/disaster/disaster.ts`
- `api/src/modules/agent-loop/tools/domain/satellite/satellite.ts`
- `api/src/modules/agent-loop/tools/domain/satellite/imageAnalysis.ts`
- `api/src/modules/agent-loop/promptManager.ts`
- `api/tests/gis/test-disaster-query-tool.mjs`
- `api/tests/gis/test-satellite-image-search-tool.mjs`
- `api/tests/gis/test-image-analysis-tool.mjs`
- `api/tests/agent-loop/test-prompt-manager-disaster-satellite-routing.mjs`

当前策略：

- 灾害、遥感、卫星影像、震洪台火等问题先 `RegionResolve`。
- 复用同一个 bbox 调用 `DisasterQuery` / `SatelliteImageSearch`。
- 有影像 URL 且用户要求评估时再调用 `ImageAnalysis`。
- 无事件或无影像时明确说明，不编造灾情、损失、伤亡或来源链接。

### 10. Transcript Persistence / Resume Context

已完成 MVP，并通过 Postgres 运行时验收。

核心文件：

- `api/src/db/schema.ts`
- `api/src/modules/agent-loop/transcriptStore.ts`
- `api/src/modules/tasks/pipeline.ts`
- `api/src/modules/agent-loop/contextProvider.ts`
- `api/tests/agent-loop/test-agent-loop-transcript-integration.mjs`
- `api/tests/agent-loop/test-transcript-store.mjs`
- `api/tests/agent-loop/test-transcript-read-model.mjs`
- `api/tests/agent-loop/test-context-provider-transcript-context.mjs`

能力：

- `agent_transcript_entries` append-only 存储 `model_request`、`assistant_message`、`tool_message`、`loop_stop`。
- `runAgentPipeline` 默认注入 DB-backed transcript store，并用 best-effort wrapper 防止审计写入影响用户任务。
- `summarizeTranscriptForContext` 生成 bounded、JSON-safe 的 `transcript.resume_context`。
- `ContextProvider` 已读取当前 `taskId` 的 transcript summary，并在 diagnostics 中区分 `loaded` / `empty` / `failed`。
- `drizzle-kit.CMD push --force` 已在 Postgres 启动后通过，`agent_transcript_entries` 表可见且已有运行时 rows。
- GIS smoke 已验证 JSONL 日志和 Agent Loop 工具链仍正常。

## 当前保留边界

### 1. Dashboard projection 保留

`/jobs`、`/events`、`task.result[toolCallId]` 仍保留旧前端展示形状。它们现在的定位是 projection contract，不是旧 Planner/Router 运行时。

下一步可做轻量命名清理：

- `projectObservationsToLegacyActionResults` -> `projectObservationsToDashboardActionResults`
- `legacy-result` -> `dashboard-result`

### 2. `agentLoopEvents.ts` 仍识别 legacy event type

这是为了防御后端误发旧事件，前端统一 ignored。该识别逻辑可以保留一段时间，等日志确认不会再出现旧事件后再删除。

### 3. `/ais/data` 仍为空实现

AIS 真实数据源还未确认，不建议迁移 MaritimeSituation 直到数据源真实可用。

### 4. ContextProvider Phase 2 已完成

参考：

- `api/plan/context-provider-phase2-plan.md`
- `api/src/modules/agent-loop/contextProvider.ts`
- `api/tests/agent-loop/test-context-provider.mjs`

Phase 2 已完成：

- 项目 instruction 默认关闭，环境变量开启。
- `CONTEXT.md` 作为 `project.domain`。
- `docs/adr` 作为 `project.adr_index`。
- task requirements / progress sections。
- diagnostics section。

## 下一阶段优先级

### 已完成前置. Transcript Persistence

已完成并通过运行时验收。

完成内容：

- `agent_transcript_entries` 已加入 `api/src/db/schema.ts`。
- `createDbTranscriptStore` / `createBestEffortTranscriptStore` 已实现。
- `runAgentPipeline` 默认使用 DB-backed transcript store，同时保留 JSONL file logger。
- `runAgentLoop` 已持久化 `model_request`、`assistant_message`、`tool_message`、`loop_stop`。
- `entriesToConversationMessages` 和 `summarizeTranscriptForContext` 已提供 bounded read helper。
- `ContextProvider` 已接入 fail-closed 的 `transcript.resume_context`。
- `drizzle-kit.CMD push --force` 在 Postgres 可用后返回 `No changes detected`。
- `agent_transcript_entries` 在 Postgres 中可见，并已有运行时 transcript rows。

参考：

- `api/plan/transcript-persistence-plan.md`
- `api/src/modules/agent-loop/transcriptStore.ts`
- `api/src/modules/agent-loop/contextProvider.ts`
- `api/tests/agent-loop/test-agent-loop-transcript-integration.mjs`
- `api/tests/agent-loop/test-context-provider-transcript-context.mjs`

### P0. Prompt Versioning

已完成 MVP。

完成内容：

- `PromptManager` 暴露稳定的 prompt/component version metadata。
- `DEFAULT_PROMPT_COMPONENT_VERSIONS` 增加维护注释：编辑对应 prompt 规则后必须同步 bump 版本号。
- 每个 `model_request` transcript entry 记录 `metadata.prompt`。
- metadata 包含 prompt version、component versions、tool catalog hash、context/runtime/memory/skill section hash、raw/prepared message hash。
- DB transcript store 已验证能持久化并 reload `metadata.prompt`，不需要新增 schema。
- 复用了共享 stable JSON canonicalization，避免 run loop 和 prompt versioning 各自维护一份。

下一阶段：

- Prompt Versioning 已具备 memory 前的审计基础。
- 可以进入 Memory MVP，但仍建议先从只读 session summary memory 开始，避免直接做自动写入型长期记忆。

### P1. ContextProvider Phase 3

Transcript resume context 的第一版已完成。

收口文档：

- `api/plan/context-provider-phase3-closeout.md`

已完成：

- `transcript.resume_context` section 已接入 `defaultContextProvider.getContextSections()`。
- 只读取当前 `taskId` 的 transcript entries。
- 只注入 bounded summary，不回放完整 `model_request.messages`。
- 表缺失或 DB 失败时 fail-closed，并在 diagnostics 中区分 `loaded` / `empty` / `failed`。

仍暂缓：

- 完整 runtime resume。
- user preference loading。
- include expansion。
- project-context caching。
- 大 transcript 的模型摘要压缩策略。

### P2. Disaster / Satellite E2E Smoke

类似 GIS toolchain smoke，补一条：

```text
RegionResolve -> RegionMark -> DisasterQuery -> SatelliteImageSearch -> ImageAnalysis
```

目标：

- fake model 固定工具顺序。
- mock 或真实 CDSE/satellite API。
- 校验 `gisData`、image overlays、final answer 和 `task.result.observations`。

### P3. Projection 命名清理

将仍带 legacy 命名但实际承担 dashboard projection 的代码重命名，降低后续理解成本。

候选：

- `api/src/modules/tasks/agentLoopResultProjection.ts`
- `src/lib/agentLoopGisBridge.ts`
- `src/types/prd.ts`

### P4. Memory

MVP in progress / completed:

- Read-only session summary memory is env-gated by `AGENT_MEMORY_SESSION_SUMMARY=1`.
- It recalls bounded summaries from recent completed tasks with the same `userId`.
- It excludes the current task and does not duplicate `transcript.resume_context`; current-task transcript resume remains owned by ContextProvider.
- It does not write long-term memory.

MVP reference:

- `api/plan/memory-mvp-plan.md`

Implemented surface:

- `api/src/modules/agent-loop/memoryManager.ts`
- `api/src/modules/agent-loop/sessionSummaryMemoryManager.ts`
- `api/src/modules/tasks/pipelineMemory.ts`
- `api/src/modules/tasks/pipeline.ts`
- `api/tests/agent-loop/test-session-summary-memory-manager.mjs`
- `api/tests/agent-loop/test-agent-loop-session-memory.mjs`
- `api/tests/agent-loop/test-pipeline-memory-manager.mjs`

Next memory steps:

1. File-based project/user memory with explicit human-maintained or reviewed content.
2. Query-relevant recall over small memory sections.
3. Write-capable memory only after confirmation/review UX is designed.

## 验证命令

常用回归：

```powershell
cd api
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-task-stream-router.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-task-stream-lifecycle.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-agent-loop-sse-mode.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-agent-loop-smoke-gis-helpers.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-prompt-manager-gis-routing.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-prompt-manager-disaster-satellite-routing.mjs
..\node_modules\.bin\tsc.CMD -p tsconfig.json --noEmit --pretty false
```

GIS smoke：

```powershell
cd api
pnpm agent:smoke -- --scenario gis-toolchain
```

真实 OpenSky smoke：

```powershell
cd api
pnpm agent:smoke -- --refresh-opensky --query "查询台湾海峡附近当前有哪些飞机，列出 callsign、国家、经纬度和高度。" --max-turns 10
```

前端 trace：

- URL 加 `?agentLoopTrace=1`
- 或设置 `localStorage["agent-loop-trace"]="true"`

## 当前判断

下一刀应做：

```text
File-based project/user memory design, then query-relevant recall
```

当前判断：

- Transcript Persistence 已完成。
- `transcript.resume_context` 已接入 ContextProvider。
- Prompt Versioning MVP 已完成，`model_request.metadata.prompt` 可审计 prompt/context/tool surface。
- Read-only session summary Memory MVP 已完成，并通过 `AGENT_MEMORY_SESSION_SUMMARY=1` env flag 接入 pipeline。
- 当前 memory 只读取同 userId 的 recent completed task transcript summaries，不写入长期记忆。

建议 Memory 后续顺序：

```text
file-based project/user memory -> query-relevant recall -> write-capable memory
```
