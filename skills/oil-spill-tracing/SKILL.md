---
name: oil-spill-tracing
description: Use when the user asks about oil spills, oil film, oil pollution, illegal discharge, pollution origin tracing, AIS suspect matching, or suspected responsible vessels; East China Sea has deterministic local fallback, other regions stop if queryData has no valid result.
argument-hint: "[user oil-spill tracing query]"
allowed-tools: OilSpillDetectMock, WeatherFetchMock, OilDriftTraceMock, AisFetchMock, AisMatchSuspectsMock, AisSuspectRankingMock
---

# Oil Spill Tracing

Use this skill for oil-spill tracing requests. East China Sea is the deterministic replay path. Other regions are allowed to enter the detector, but the workflow stops when `queryData` has no valid oil-spill image. This skill uses mock tools under `oilSpillMock`. The first detector keeps the old oil-spill behavior by calling `queryData`; weather, drift, AIS, matching, and ranking remain deterministic mock steps.

## Trigger

Use this skill when the user's query contains oil-spill intent such as 漏油, 油污, 油膜, 排污, 偷排, 疑似肇事船, pollution origin, or illegal discharge. The default demo region is 中国东海.

## Workflow

Run the tools in this exact order for multi-step GIS replay:

1. `OilSpillDetectMock` with `{"region":"中国东海"}` unless the user gives another display name.
2. Inspect the detector output.
3. If `shouldContinue:false`, stop immediately and answer that `queryData` did not return a valid oil-spill image for that region. Do not call any later mock tools.
4. If `shouldContinue:true`, call `WeatherFetchMock` with `{"region":"东海油膜片区"}`.
5. Call `OilDriftTraceMock` with `{}`.
6. Call `AisFetchMock` with `{"region":"中国东海"}` unless the user gave a different region and the detector returned `shouldContinue:true`.
7. Call `AisMatchSuspectsMock` with `{}`.
8. Call `AisSuspectRankingMock` with `{}`.

Each tool returns top-level `gisData`. Preserve the sequence because the frontend uses tool observations for step-by-step map replay.

## Rules

- Do not call `SatelliteImageSearch` for this demo.
- Do not call real `WeatherFetch` for this demo.
- Do not call SQL AIS tools or `ais-region-query` for this demo.
- Do not fabricate extra vessels, weather values, images, or rankings.
- Keep the demo deterministic even when the user says "现在", "最新", or "实时".
- For non-East-China-Sea regions, if `OilSpillDetectMock` returns `shouldContinue:false`, treat that as the final answer and stop the workflow.
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
