# Projection Naming Cleanup Plan

## Goal

Rename legacy-flavored internal names that now represent dashboard / display projections.

This is a naming cleanup only. It should not change the external API shape unless a later frontend/backend contract migration explicitly does so.

## Why

The runtime legacy SSE adapter and frontend fallback were removed. The remaining old-shaped data is a projection contract for dashboards, RightPanel recovery, and GIS display.

Current names like `LegacyActionResult` and `legacy-result` make the code look like old Planner / Router fallback still exists. That slows future maintenance and increases the chance that new Agent Loop work is routed through the wrong mental model.

## Current Findings

### Rename Candidates

Backend:

- `api/src/modules/tasks/agentLoopResultProjection.ts`
  - `projectObservationsToLegacyActionResults`
  - `projectObservationToLegacyActionResult`
  - implicit result entries keyed by `toolCallId`

Frontend:

- `src/lib/agentLoopGisBridge.ts`
  - `AgentLoopGisPushSource` member `'legacy-result'`
  - extraction path for `[toolCallId]` entries in `task.result`

Potential shared/frontend type surface:

- `src/types/prd.ts`
  - event `category?: 'agent' | 'tool' | 'gis' | 'result' | 'legacy'`
  - keep or rename only after checking current UI consumers; this may describe old event display categories rather than task result projection.

### Intentionally Keep For Now

These names still describe defensive legacy event handling and are not part of projection cleanup:

- `src/lib/agentLoopEvents.ts`
  - `kind: 'legacy'`
  - `legacyEventTypes`
- `src/lib/taskStreamRouter.ts`
  - `kind: 'ignored-legacy'`
- tests that assert old SSE events are ignored:
  - `api/tests/agent-loop/test-task-stream-router.mjs`
  - `api/tests/agent-loop/test-task-stream-lifecycle.mjs`
  - `api/tests/agent-loop/test-agent-loop-sse-mode.mjs`

Do not remove these until logs show old events are never emitted and the frontend no longer needs deterministic ignore behavior.

## Proposed Naming

Backend:

```ts
projectObservationsToLegacyActionResults
-> projectObservationsToDashboardActionResults

projectObservationToLegacyActionResult
-> projectObservationToDashboardActionResult
```

If a named type is introduced:

```ts
LegacyActionResult
-> DashboardActionProjection
```

Frontend:

```ts
'legacy-result'
-> 'dashboard-result'
```

Optionally rename helper concepts:

```ts
nativeSource
-> observationSource
```

Only do this if it makes the edited code clearer; avoid broad churn.

## Non-Goals

- Do not delete `task.result[toolCallId]`.
- Do not remove `/jobs` or `/events`.
- Do not remove old SSE event ignore handling.
- Do not change the external JSON result shape in this pass.
- Do not migrate AIS / MaritimeSituation.

## Implementation Plan

### Task 1: Backend Projection Names

Files:

- `api/src/modules/tasks/agentLoopResultProjection.ts`
- `api/tests/agent-loop/test-agent-loop-result-projection.mjs`
- `api/tests/gis/test-region-mark-tool.mjs`

Status: completed.

Steps:

1. [x] Rename internal functions to dashboard projection names.
2. [x] Add or update tests to assert the result shape remains unchanged.
3. [x] Keep `buildAgentLoopTaskResult()` and `AgentLoopTaskResult` stable.

Expected behavior:

- `result.observations` still exists.
- `result[toolCallId]` still exists.
- GIS `gisData` projection still exists under the tool call id.

### Task 2: Frontend GIS Bridge Source Name

Files:

- `src/lib/agentLoopGisBridge.ts`
- relevant tests if present; otherwise add a focused frontend/lib test if the project test harness supports it

Status: completed.

Steps:

1. [x] Rename source member `'legacy-result'` to `'dashboard-result'`.
2. [x] Keep extraction from `[toolCallId]` task result entries unchanged.
3. [x] Confirm map linkage still dedupes native observations and projected entries by key.

Expected behavior:

- Agent Loop event GIS pushes still use `'agent-loop-event'`.
- Loop stop observations still use `'agent-loop-result'`.
- Dashboard projection fallback entries use `'dashboard-result'`.

### Task 3: Type Surface Review

Files:

- `src/types/prd.ts`
- any consumer returned by `rg "category.*legacy|legacy'" src`

Status: completed.

Steps:

1. [x] Determine whether `category: 'legacy'` is event categorization or projection categorization.
2. [x] If it only represents stale projection naming, remove it or rename it to `dashboard`.
3. [x] If it represents old event categorization, keep it and document why.

Finding:

- `ThinkingStep.category: 'legacy'` had no producer or UI-specific consumer, so it was removed from the type union.
- Defensive old SSE handling still uses `ParsedTaskStreamEvent.kind: 'legacy'` and `RoutedTaskStreamEvent.kind: 'ignored-legacy'`; those names are intentionally kept until old stream compatibility can be deleted safely.

### Task 4: Roadmap And Regression

Update:

- `api/plan/agent-loop-migration-roadmap.md`

Status: completed.

Run:

```powershell
cd api
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-agent-loop-result-projection.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-task-stream-router.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-task-stream-lifecycle.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-agent-loop-sse-mode.mjs
..\node_modules\.bin\tsx.CMD tests\gis\test-region-mark-tool.mjs
..\node_modules\.bin\tsc.CMD -p tsconfig.json --noEmit --pretty false
```

If frontend typecheck is available, also run the repo-level TypeScript check used for the frontend.

Verification result:

- Projection / SSE / GIS bridge regression tests passed.
- API TypeScript check passed with `api/tsconfig.json`.
- Repo-level TypeScript check is currently blocked by pre-existing `docs/reference/claude-code-tools` missing-module/type errors, unrelated to projection naming cleanup.

## Acceptance Checklist

- [x] No `LegacyActionResult` / `projectObservationToLegacyActionResult` naming remains in projection code.
- [x] No `'legacy-result'` source remains for task result projection.
- [x] Defensive old SSE event ignore logic remains intact.
- [x] `task.result[toolCallId]` shape remains unchanged.
- [x] GIS outputs still extract from native observations and dashboard projection entries.
- [x] Backend projection tests pass.
- [x] API TypeScript check passes.
