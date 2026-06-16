# ContextProvider Phase 3 Closeout

> This document closes the ContextProvider Phase 3 boundary after transcript persistence and prompt versioning landed. It is a status and boundary record, not a new implementation plan.

## Status

Phase 3 is complete for the current MVP scope.

The important change since Phase 2 is that ContextProvider now loads a bounded transcript resume section for the current task and exposes diagnostics for whether transcript context was loaded, empty, or failed.

## Completed Scope

- `defaultContextProvider.getContextSections()` includes `transcript.resume_context` when transcript entries exist for the current `taskId`.
- Transcript loading is fail-closed: unavailable database/table/store returns no transcript section instead of failing the user task.
- `loadTranscriptContextSections()` returns `{ sections, status, error? }`, where status is `loaded`, `empty`, or `failed`.
- `buildContextProviderDiagnostics()` includes `transcriptContextStatus`.
- Diagnostics add `transcript.resume_context.empty` or `transcript.resume_context.failed` to `skippedSources` when appropriate.
- `summarizeTranscriptForContext()` produces bounded, JSON-safe summary content and does not replay full `model_request.messages`.
- Transcript context reads only the current task id. It does not cross task, user, project, or session boundaries.

## Ownership Boundary

ContextProvider owns deterministic, task-scoped context material:

- `user_context.currentDate`
- optional project instruction text when explicitly enabled
- `system_context.workspaceRoot`
- bounded git/task status
- `project.domain`
- `project.database_description`
- `project.adr_index`
- `task.requirements`
- `task.progress`
- `transcript.resume_context`
- `context_provider.diagnostics`

ContextProvider does not own:

- final prompt assembly or ordering beyond returning `PromptSection[]`
- memory retrieval or long-term memory writes
- skill listing or skill discovery
- runtime TodoWrite / plan-mode state
- context-window compaction
- model calls
- tool calls
- cross-task recall

## Relationship To Memory

`transcript.resume_context` is resume context, not memory.

It answers: "What happened in this task if the same task resumes?"

Memory should answer: "What prior useful context from this user/project/session should be recalled for a new task?"

That means Memory MVP should not move `transcript.resume_context` out of ContextProvider and should not duplicate it as `memory.*` for the current task. Memory should start as a separate read-only recall path that injects `memorySections`.

## Deferred Beyond Phase 3

These remain intentionally out of scope:

- full runtime resume
- replaying or reconstructing tool state
- user preference loading from durable settings
- include expansion for project instruction files
- project-context caching and invalidation
- model-generated compression for very large transcripts
- cross-task/session/user recall
- write-capable long-term memory

## Verification

Existing checks:

```powershell
cd api
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-context-provider-transcript-context.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-transcript-read-model.mjs
..\node_modules\.bin\tsx.CMD tests\agent-loop\test-transcript-store.mjs
..\node_modules\.bin\tsc.CMD
```

Expected:

```text
context provider transcript context test passed
transcript read model test passed
transcript store test passed
```

## Closeout Decision

Do not add more behavior to ContextProvider before Memory MVP unless it is clearly task-scoped deterministic context.

The next stage is Memory MVP, starting with read-only recall from recent completed tasks for the same user id.
