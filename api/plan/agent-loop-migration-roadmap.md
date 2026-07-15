# Agent Loop Migration Roadmap

> Long-term status record for moving from the old Planner / Router / Executor / Capability stack to the native Agent Loop stack.

## Current Conclusion

Agent Loop is now the main runtime path for frontend questions and backend tool execution.

The migration is no longer about "making Agent Loop run". The current work is structural cleanup and next-layer capability:

```text
native Agent Loop stability
-> observability and transcript persistence
-> prompt versioning
-> context recovery and memory
-> deeper E2E smoke coverage and next-layer memory
```

Legacy SSE adapter and frontend legacy fallback have been removed. The old-shaped surfaces that remain are compatibility projections for dashboard/display APIs, such as `/jobs`, `/events`, and `task.result[toolCallId]`. These should be treated as projection contracts, not old runtime fallback.

## Completed

### 1. Dashboard Compatibility Routes

Retained routes:

- `/jobs`
- `/events`
- `/events/:id`
- `/subscriptions`
- `/requirements`
- `/insights`
- `/ais/data`
- `/ads/data`

Current meaning:

- `/jobs` projects `tasks` / `task_steps`.
- `/events` projects completed or failed tool observations.
- `/ads/data` reads `aircraft_current_states`.
- `/ais/data` remains an empty compatibility endpoint until a real AIS source is confirmed.

Core files:

- `api/src/modules/dashboard/projection.ts`
- `api/src/modules/dashboard/service.ts`
- `api/src/modules/dashboard/controller.ts`
- `api/src/modules/dashboard/routes.ts`
- `api/src/index.ts`

### 2. Native Agent Loop SSE

Completed and now the only primary stream path.

Native events:

- `agent_turn`
- `assistant_message`
- `tool_call`
- `tool_progress`
- `tool_observation`
- `loop_stop`

Notes:

- `runAgentLoop` publishes native events through `notifyTaskUpdate`.
- `/tasks/:taskId/stream` can replay `loop_stop` for completed tasks.
- `model_request` and `tool_message` may still be logged to transcript / JSONL, but they are not primary frontend display events.

Core files:

- `api/src/modules/agent-loop/runAgentLoop.ts`
- `api/src/modules/tasks/routes.ts`
- `api/src/modules/tasks/agentLoopSseMode.ts`

### 3. Legacy Runtime Fallback Removal

Removed:

- `api/src/modules/tasks/agentLoopEventAdapter.ts`
- `src/lib/legacyTaskStreamFallback.ts`
- legacy SSE adapter tests
- frontend legacy fallback handling branch

Still retained intentionally:

- `src/lib/agentLoopEvents.ts` still recognizes old event types and classifies them as legacy.
- `src/lib/taskStreamRouter.ts` returns `ignored-legacy` for old event types.

This retained recognition is defensive: if the backend accidentally emits an old event, the frontend ignores it instead of driving UI from it.

### 4. Frontend Native Agent Loop Support

Completed for the main interaction path.

Capabilities:

- ChatPanel displays native tool steps.
- RightPanel reads native Agent Loop task results.
- Map links from `tool_observation.output.gisData` and `loop_stop.result.observations`.
- Frontend in-memory trace and Copy Trace are available.
- Each Agent Loop run writes a JSONL file under `projects_new/logs`.

Core files:

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

### 5. Task Result Projection

Completed and retained as a display / dashboard projection contract.

Current shape:

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

Current meaning:

- `observations` is the native result structure.
- `[toolCallId]` is the dashboard / RightPanel recovery projection for GIS outputs.
- The projection should stay for now, but internal code now names it as a dashboard projection rather than legacy runtime fallback.

Core files:

- `api/src/modules/tasks/agentLoopResultProjection.ts`
- `api/src/modules/tasks/pipeline.ts`
- `src/lib/agentLoopGisBridge.ts`

### 6. OpenSky Real Data Path

Completed for the main loop:

- OpenSky fetch.
- current snapshot persistence.
- scheduled worker write.
- empty `states` does not replace current table.
- invalid `icao24` / `last_contact` counting.
- worker shutdown timeout protection.
- smoke command can refresh OpenSky and then query aircraft data.

Reference plans:

- `api/plan/opensky-hourly-ingestion-plan.md`
- `api/plan/opensky-agent-tool-plan.md`
- `api/plan/ais-hourly-ingestion-and-query-plan.md`

### 7. GIS Toolchain

Completed first stable real / semi-real vertical slice:

```text
RegionResolve -> RegionMark -> WeatherFetch
```

Current routing rule:

- Named regions go through `RegionResolve`.
- `RegionMark` accepts explicit `geometryRef`, `bbox`, or `polygon`; it does not resolve names.
- Downstream weather / aircraft / maritime / disaster tools reuse `RegionResolve.selected.bbox`.
- If `RegionResolve` fails, the model must not invent a bbox.

Core files:

- `api/src/modules/agent-loop/tools/domain/gis/regionResolve.ts`
- `api/src/modules/agent-loop/tools/domain/gis/regionMark.ts`
- `api/src/modules/agent-loop/tools/domain/weather/weather.ts`
- `api/scripts/agent-loop/agent-loop-smoke-gis.ts`
- `api/tests/agent-loop/test-agent-loop-smoke-gis-helpers.mjs`

### 8. RegionResolve PostGIS

Completed to usable MVP.

Current PostGIS tables include:

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

Curated region added:

- `region_cn='台湾海峡'`
- `region_en='Taiwan Strait'`
- `level='strait'`

Reference plan:

- `api/plan/region-resolve-global-geojson.md`

### 9. Disaster / Satellite Tools

First tool and prompt-rule version is implemented.

Current behavior:

- Disaster, earthquake, flood, typhoon, fire, satellite imagery, and remote-sensing questions start with `RegionResolve`.
- The same bbox is reused for `DisasterQuery` / `SatelliteImageSearch`.
- `ImageAnalysis` is called only when image URLs exist and the user asks for assessment / interpretation.
- If there are no events or images, the model should say so and not fabricate facts.

Core files:

- `api/src/modules/agent-loop/tools/domain/disaster/disaster.ts`
- `api/src/modules/agent-loop/tools/domain/satellite/satellite.ts`
- `api/src/modules/agent-loop/tools/domain/satellite/imageAnalysis.ts`
- `api/src/modules/agent-loop/promptManager.ts`
- `api/tests/gis/test-disaster-query-tool.mjs`
- `api/tests/gis/test-satellite-image-search-tool.mjs`
- `api/tests/gis/test-image-analysis-tool.mjs`
- `api/tests/agent-loop/test-prompt-manager-disaster-satellite-routing.mjs`

### 10. Transcript Persistence / Resume Context

Completed MVP and verified against Postgres.

Capabilities:

- `agent_transcript_entries` stores `model_request`, `assistant_message`, `tool_message`, and `loop_stop`.
- `runAgentPipeline` injects a DB-backed transcript store through a best-effort wrapper.
- `summarizeTranscriptForContext` generates bounded, JSON-safe `transcript.resume_context`.
- ContextProvider reads the current task transcript summary and diagnostics distinguish `loaded` / `empty` / `failed`.

Core files:

- `api/src/db/schema.ts`
- `api/src/modules/agent-loop/transcriptStore.ts`
- `api/src/modules/tasks/pipeline.ts`
- `api/src/modules/agent-loop/contextProvider.ts`
- `api/tests/agent-loop/test-agent-loop-transcript-integration.mjs`
- `api/tests/agent-loop/test-transcript-store.mjs`
- `api/tests/agent-loop/test-transcript-read-model.mjs`
- `api/tests/agent-loop/test-context-provider-transcript-context.mjs`

### 11. Prompt Versioning

Completed MVP.

Capabilities:

- PromptManager exposes stable prompt/component version metadata.
- `DEFAULT_PROMPT_COMPONENT_VERSIONS` documents the bump requirement.
- Each `model_request` transcript entry records `metadata.prompt`.
- Metadata includes prompt version, component versions, tool catalog hash, context/runtime/memory/skill section hashes, and raw/prepared message hashes.
- DB transcript store can persist and reload `metadata.prompt`.
- Stable JSON canonicalization is shared.

Core files:

- `api/src/modules/agent-loop/promptManager.ts`
- `api/src/modules/agent-loop/promptVersioning.ts`
- `api/src/modules/agent-loop/runAgentLoop.ts`
- `api/tests/agent-loop/test-prompt-versioning.mjs`
- `api/tests/agent-loop/test-agent-loop-prompt-versioning.mjs`

### 12. ContextProvider Phase 3 MVP

Completed for current scope.

Capabilities:

- `transcript.resume_context` is injected by `defaultContextProvider.getContextSections()`.
- Only the current `taskId` transcript is read.
- The injected summary is bounded and does not replay full `model_request.messages`.
- Missing transcript table or DB failure fails closed and is visible in diagnostics.

Closeout:

- `api/plan/context-provider-phase3-closeout.md`

### 13. Memory MVP

Completed and verified with a DB-backed end-to-end smoke.

Capabilities:

- Read-only session summary memory is gated by `AGENT_MEMORY_SESSION_SUMMARY=1`.
- It recalls bounded summaries from recent completed tasks with the same `userId`.
- It excludes the current task.
- It does not duplicate `transcript.resume_context`.
- It does not write long-term memory.

Core files:

- `api/src/modules/agent-loop/memoryManager.ts`
- `api/src/modules/agent-loop/sessionSummaryMemoryManager.ts`
- `api/src/modules/tasks/pipelineMemory.ts`
- `api/src/modules/tasks/pipeline.ts`
- `api/tests/agent-loop/test-session-summary-memory-manager.mjs`
- `api/tests/agent-loop/test-agent-loop-session-memory.mjs`
- `api/tests/agent-loop/test-pipeline-memory-manager.mjs`

Reference plan:

- `api/plan/memory-mvp-plan.md`

### 14. Projection Naming Cleanup

Completed for the current scope.

Renamed:

- backend projection helpers now use dashboard projection naming
- frontend GIS task-result source now uses `dashboard-result`
- `ThinkingStep.category` no longer includes an unused `legacy` category

Intentionally kept:

- `ParsedTaskStreamEvent.kind: 'legacy'`
- `RoutedTaskStreamEvent.kind: 'ignored-legacy'`

Those retained names describe defensive old SSE recognition only. They are not task result projection names.

Reference plan:

- `api/plan/projection-naming-cleanup-plan.md`

## Retained Boundaries

### 1. Dashboard Projection Contract

`/jobs`, `/events`, and `task.result[toolCallId]` remain old-shaped display contracts. They are not Planner / Router runtime fallback.

Current cleanup status:

- Legacy-flavored projection symbols have been renamed to dashboard projection names.
- The external JSON shape is preserved.

### 2. Defensive Legacy Event Recognition

`agentLoopEvents.ts` still recognizes old event types only so the frontend can ignore them deterministically.

This may stay until logs confirm no old events are emitted.

### 3. `/ais/data` Empty Implementation

AIS remains a compatibility endpoint. Do not migrate MaritimeSituation until a real AIS source is available.

## Next Priorities

### P0. Disaster / Satellite E2E Smoke

Add a smoke comparable to GIS toolchain:

```text
RegionResolve -> RegionMark -> DisasterQuery -> SatelliteImageSearch -> ImageAnalysis
```

Goals:

- fake model with fixed tool order
- mock or real CDSE/satellite API path
- validate `gisData`, image overlays, final answer, and `task.result.observations`

### P1. File-Based Project/User Memory

Next after read-only session memory.

Principles:

- explicit human-maintained or reviewed content
- no automatic write pollution
- small model-visible sections
- clear user/project scope

### P2. Query-Relevant Memory Recall

After file-based memory exists, add relevant recall over small sections.

Do not start with vector search unless the data model and inspection UX are clear.

### P3. Write-Capable Memory

Defer until confirmation / review UX is designed.

Open questions:

- What is the durable user identity source?
- Should project memory be file-based, DB-backed, or both?
- Who can inspect/delete memories?
- What confirmation flow is required before writes?

## Verification Commands

Common regression:

```powershell
cd api
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-task-stream-router.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-task-stream-lifecycle.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-agent-loop-sse-mode.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-agent-loop-smoke-gis-helpers.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-prompt-manager-gis-routing.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-prompt-manager-disaster-satellite-routing.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-session-summary-memory-manager.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-agent-loop-session-memory.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-pipeline-memory-manager.mjs
..\node_modules\.bin\tsc.CMD -p tsconfig.json --noEmit --pretty false
```

GIS smoke:

```powershell
cd api
pnpm agent:smoke -- --scenario gis-toolchain
```

Real OpenSky smoke:

```powershell
cd api
pnpm agent:smoke -- --refresh-opensky --query "查询台湾海峡附近当前有哪些飞机，列出 callsign、国家、经纬度和高度。" --max-turns 10
```

Frontend trace:

- add `?agentLoopTrace=1`
- or set `localStorage["agent-loop-trace"]="true"`
