---
name: earthquake-assessment
description: Use only when the user explicitly invokes the earthquake assessment demo via /演示:地震灾后评估; deterministic mock replay for Guangxi Liuzhou Liunan earthquake assessment.
argument-hint: "[/演示:地震灾后评估]"
allowed-tools: RegionResolve, RegionMark, EarthquakePreImageMock, EarthquakePostImageMock, EarthquakeAssessmentMock
---

# Earthquake Assessment Demo

Use this skill **only** for the deterministic earthquake assessment demo. The workflow is triggered by the explicit demo command `/演示:地震灾后评估`; do not activate this skill for general earthquake questions or live earthquake alerts.

## Required trigger

The user input must start with:

```text
/演示:地震灾后评估
```

If the user asks an ordinary earthquake or disaster satellite question without this prefix, do not use this skill or its mock tools. Use the regular disaster-satellite-query path and live/available tools instead.

## Deterministic region

Default region:

```text
广西柳州市柳南区
```

## Workflow

1. Call `RegionResolve` for the requested region. If no region is provided, use `广西柳州市柳南区`.
2. Call `RegionMark` with `selected.geometryRef`; pass `selected.bbox` as fallback when available. If `RegionResolve` returns `resolved:false`, continue this demo only by calling `RegionMark` with the deterministic bbox `{west:109.25894741025947,south:24.36555725731195,east:109.26069621053718,north:24.366585886456956}`.
3. Call `EarthquakePreImageMock` with the same display region. This tool calls the old `queryData` historical image API first and falls back to `/local-tiles/pre_earthquake.png` when no preview image is returned.
4. Call `EarthquakePostImageMock` with the same display region. This tool submits the old satellite demand payload first; if the demand succeeds, wait for the callback, and if the demand fails or returns no image, fall back to `/local-tiles/post_earthquake.png`.
5. Call `EarthquakeAssessmentMock` to produce the deterministic damage assessment and GIS focus metadata.
6. Final answer: summarize the pre/post image source, demand fallback if any, earthquake magnitude, suspected building/road damage, and next response actions.

## Constraints

- Keep this as a multi-step replay. Do not collapse the flow into one final answer before all tools have run.
- Do not call `DisasterQuery`, `SatelliteImageSearch`, `ImageAnalysis`, web search, or real disaster services inside this demo unless the user explicitly asks to leave the mock replay.
- Do not change the deterministic mock coordinates, legacy `queryData` payload, or old demand payload based on the RegionResolve bbox. RegionResolve and RegionMark are only for map focus; the deterministic bbox above is the fallback when the region catalog lacks this demo geometry.
