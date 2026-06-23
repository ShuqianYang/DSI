---
name: flood-assessment
description: Use only when the user explicitly invokes the flood assessment demo via /演示:洪水灾后评估; deterministic mock replay for Hunan Shimen flood assessment.
argument-hint: "[/演示:洪水灾后评估]"
allowed-tools: RegionResolve, RegionMark, FloodPreImageMock, FloodPostImageMock, FloodAssessmentMock
---

# Flood Assessment Demo

Use this skill **only** for the deterministic Hunan Shimen flood assessment demo. The workflow is triggered by the explicit demo command `/演示:洪水灾后评估`; do not activate this skill for general flood questions or live flood alerts.

## Required Trigger

The user input must start with:

```text
/演示:洪水灾后评估
```

If the user asks an ordinary flood, rainfall, waterlogging, or disaster satellite question without this prefix, do not use this skill or its mock tools. Use the regular disaster-satellite-query path and live/available tools instead.

## Deterministic Region

Default region:

```text
湖南石门县
```

Fallback bbox for this demo:

```json
{"west":110.89344101467812,"south":29.880513149375275,"east":110.89603739300453,"north":29.88216900048024}
```

## Workflow

1. Call `RegionResolve` for the requested region. If no region is provided, use `湖南石门县`.
2. Call `RegionMark` with `selected.geometryRef`; pass `selected.bbox` as fallback when available. If `RegionResolve` returns `resolved:false`, continue this demo only by calling `RegionMark` with the deterministic bbox above.
3. Call `FloodPreImageMock` with the same display region. This tool calls the old `queryData` historical image API first and falls back to `/local-tiles/pre_flood.png` when no preview image is returned.
4. Call `FloodPostImageMock` with the same display region. This tool submits the old satellite demand payload first; if the demand succeeds, wait for the callback, and if the demand fails or returns no image, fall back to `/local-tiles/post_flood.png`.
5. Call `FloodAssessmentMock` to load `api/flood.geojson`, produce the deterministic flood damage assessment, and return pre/post image overlays on the same bounds so the post-flood image covers the pre-flood image.
6. Final answer: summarize the pre/post image source, demand fallback if any, flooded area, bridge damage, road interruption, house flood risk, and next response actions.

## Constraints

- Keep this as a multi-step replay. Do not collapse the flow into one final answer before all tools have run.
- Do not call `DisasterQuery`, `SatelliteImageSearch`, `ImageAnalysis`, web search, or real disaster services inside this demo unless the user explicitly asks to leave the mock replay.
- Do not change the deterministic mock coordinates, legacy `queryData` payload, old demand payload, or `flood.geojson` damage zones based on the RegionResolve bbox.
