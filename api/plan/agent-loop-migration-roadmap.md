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

### P0. Transcript Persistence

这是当前最高优先级。

原因：

- Agent Loop native SSE、日志文件、前端 trace 都已经有了。
- `runAgentLoop` 已经有 `transcriptStore` 注入点和 append 调用。
- 当前默认 `disabledTranscriptStore`，所以 transcript 还没有结构化持久化。
- 没有 transcript，就很难可靠做 resume、context recovery、长期审计和 prompt versioning。

建议实现顺序见：

- `api/plan/transcript-persistence-plan.md`

### P1. Prompt Versioning

Transcript persistence 完成后做。

目标：

- 给 base system prompt、GIS routing rules、disaster satellite rules、tool policy prompt 加版本号。
- 每次 agent run 记录 prompt version。
- transcript 中记录每轮 model_request 使用的 prompt/context 版本摘要。

### P2. ContextProvider Phase 3

Transcript persistence 完成后，可以启动 Phase 3 的 transcript-resume context 部分。

注意：

- 可以做 `transcript-resume context`。
- 不建议立即做完整 runtime resume。
- user preference loading、include expansion、DB-backed integration tests、project-context caching 可以并行或后置。

### P3. Disaster / Satellite E2E Smoke

类似 GIS toolchain smoke，补一条：

```text
RegionResolve -> RegionMark -> DisasterQuery -> SatelliteImageSearch -> ImageAnalysis
```

目标：

- fake model 固定工具顺序。
- mock 或真实 CDSE/satellite API。
- 校验 `gisData`、image overlays、final answer 和 `task.result.observations`。

### P4. Projection 命名清理

将仍带 legacy 命名但实际承担 dashboard projection 的代码重命名，降低后续理解成本。

候选：

- `api/src/modules/tasks/agentLoopResultProjection.ts`
- `src/lib/agentLoopGisBridge.ts`
- `src/types/prd.ts`

### P5. Memory

最后再做 Memory。

建议顺序：

1. 只读 session summary memory。
2. project/user scoped file-based memory。
3. relevant recall。
4. 写入型 memory。

不要一开始就做自动写入长期记忆，容易污染后续 agent 行为。

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
Transcript Persistence MVP
```

完成后，可以进入 `context-provider-phase2-plan.md` 的 Phase 3 中和 transcript resume 相关的部分。
