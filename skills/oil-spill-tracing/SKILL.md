---
name: oil-spill-tracing
description: Use only when the user explicitly invokes the oil-spill mock demo via /demo:oil-spill-mock; deterministic East China Sea replay.
argument-hint: "[/demo:oil-spill-mock]"
allowed-tools: RegionResolve, RegionMark, OilSpillDetectMock, WeatherFetchMock, OilDriftTraceMock, AisFetchMock, AisMatchSuspectsMock, AisSuspectRankingMock
---

# Oil Spill Tracing

Use this skill **only** for the deterministic East China Sea oil-spill mock demo. The workflow is triggered by the explicit demo command `/demo:oil-spill-mock`; do not activate this skill for general oil-spill questions or live oil-spill alerts.

## Required Input

Use the user's original query as `$ARGUMENTS`.

The query must start with exactly:

```
/demo:oil-spill-mock
```

Optional trailing text is allowed and is ignored except for extracting a display region name (default `中国东海`).

## Workflow

Run the tools in this exact order for multi-step GIS replay:

1. Call `RegionResolve` with the display region name, defaulting to `{"regionName":"中国东海"}`.
2. If `RegionResolve` returns `resolved:true`, call `RegionMark` with `selected.geometryRef` and `selected.bbox`; if there is no `geometryRef`, pass `selected.bbox` as the fallback geometry.
3. `OilSpillDetectMock` with `{"region":"中国东海"}` unless the user gives another display name.
4. Inspect the detector output.
5. If `shouldContinue:false`, stop immediately and answer that `queryData` did not return a valid oil-spill image for that region. Do not call any later mock tools.
6. If `shouldContinue:true`, call `WeatherFetchMock` with `{"region":"东海油膜片区"}`.
7. Call `OilDriftTraceMock` with `{}`.
8. Call `AisFetchMock` with `{"region":"中国东海"}` unless the user gave a different region and the detector returned `shouldContinue:true`.
9. Call `AisMatchSuspectsMock` with `{}`.
10. Call `AisSuspectRankingMock` with `{}`.

Each tool returns top-level `gisData`. Preserve the sequence because the frontend uses tool observations for step-by-step map replay.

## Rules

- Do **not** call `SatelliteImageSearch` for this demo.
- Do **not** call real `WeatherFetch` for this demo.
- Do **not** call SQL AIS tools or `ais-region-query` for this demo.
- Use `RegionResolve`/`RegionMark` only for the initial map focus. Do not use their bbox to change the deterministic mock coordinates or oil-spill `queryData` payload.
- Do not fabricate extra vessels, weather values, images, or rankings.
- Keep the demo deterministic even when the user says "现在", "最新", or "实时".
- For non-East-China-Sea regions, if `OilSpillDetectMock` returns `shouldContinue:false`, treat that as the final answer and stop the workflow.
- If the user asks about oil spills, oil film, oil pollution, illegal discharge, pollution origin tracing, AIS suspect matching, or suspected responsible vessels without the `/demo:oil-spill-mock` prefix, do not use this skill or its mock tools; use the regular GIS, disaster, weather, or AIS tools instead.
- If the user explicitly asks for real live data, explain that this skill is the deterministic mock oil-spill demo and ask whether to switch to real tools.

## Response

Summarize:

- oil-film detection result and SAR overlay,
- wind/current mock input,
- pollution origin and drift path,
- AIS candidate count,
- matched suspects,
- final ranked suspect vessels.

Mention that the result is a deterministic mock replay, not live operational evidence.
