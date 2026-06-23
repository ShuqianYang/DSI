---
name: fire-investigation
description: Use only when the user explicitly invokes the fire investigation demo via /demo:fire-investigation; deterministic mock replay for the Kensai fire scenario.
argument-hint: "[/demo:fire-investigation]"
allowed-tools: RegionResolve, RegionMark, FireDetectMock, FireSatelliteMock, FireAssessmentMock, FireReportMock
---

# Fire Investigation

Use this skill **only** for the deterministic Kensai fire investigation demo. The workflow is triggered by the explicit demo command `/demo:fire-investigation`; do not activate this skill for general fire-related questions or live fire alerts.

## Required Input

Use the user's original query as `$ARGUMENTS`.

The query must start with exactly:

```
/demo:fire-investigation
```

Optional trailing text is allowed and is ignored except for extracting a display region name (default `Kensai`).

## Workflow

Run the tools in this exact order for multi-step GIS replay:

1. Call `RegionResolve` with the display region name, defaulting to `{"regionName":"Kensai"}`.
2. If `RegionResolve` returns `resolved:true`, call `RegionMark` with `selected.geometryRef` and `selected.bbox`; if there is no `geometryRef`, pass `selected.bbox` as the fallback geometry.
3. `FireDetectMock` with `{"region":"Kensai"}` unless the user gives another display name.
4. `FireSatelliteMock` with `{"region":"Kensai"}` to overlay post-fire imagery and burn mask.
5. `FireAssessmentMock` with `{"region":"Kensai"}` for fire intensity, spread direction, and wind field.
6. `FireReportMock` with `{"region":"Kensai"}` to produce the final structured investigation report.

Each tool returns top-level `gisData`. Preserve the sequence because the frontend uses tool observations for step-by-step map replay.

## Rules

- Do **not** call real `SatelliteImageSearch`, `DisasterQuery`, weather services, or live remote-sensing APIs for this demo.
- Do **not** use this skill for general fire queries such as "哪里着火了" or "火灾新闻"; those should use the regular disaster-satellite-query skill or live tools.
- Use `RegionResolve`/`RegionMark` only for the initial map focus. Do not use their bbox to change the deterministic Kensai coordinates or overlay rectangle.
- Do not fabricate extra fire points, burned areas, or assessment values.
- Keep the demo deterministic even when the user says "现在", "最新", or "实时".
- If the user explicitly asks for real live data, explain that this skill is the deterministic mock fire demo and ask whether to switch to real tools.

## Response

Summarize:

- fire detection result and center coordinates,
- post-fire satellite overlay and burn mask,
- fire intensity, spread direction, and wind field,
- final assessment and recommendations.

Mention that the result is a deterministic mock replay, not live operational evidence.
