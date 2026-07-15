---
name: disaster-satellite-query
description: Use when the user asks about disasters, earthquakes, floods, typhoons, fires, disaster situation, affected areas, satellite imagery, remote sensing imagery, disaster assessment, image analysis, or pre/post-disaster image search for a named region or bounding box using Agent Loop domain tools.
argument-hint: "[user disaster or satellite query with region, bbox, disaster type, and optional date/time range]"
allowed-tools: RegionResolve, RegionMark, DisasterQuery, SatelliteImageSearch, ImageAnalysis
---

# Disaster Satellite Query

Use this skill to answer disaster and satellite-image questions with the Agent Loop domain tools. It supports disaster event facts, satellite image metadata/browser links, and vision-based image analysis when satellite image URLs are available.

## Required Input

Use the user's original query as `$ARGUMENTS`.

The query must contain at least one of these intents:

1. Disaster intent: disaster, earthquake, flood, typhoon, fire, affected area, damage, 灾情, 地震, 洪水, 台风, 火灾, 受灾, or equivalent wording.
2. Satellite intent: satellite image, remote sensing image, pre-disaster image, post-disaster image, 卫星图, 遥感影像, 灾前, 灾后, or equivalent wording.
3. Region intent: a named region resolvable by `RegionResolve`, or an explicit bbox with latitude/longitude bounds.

If the user names a region, call `RegionResolve` first. If `RegionResolve` returns `resolved:false`, do not invent a bbox. Ask for a bbox/polygon or say that the region is not available.

## Region Source

For named regions, reuse `RegionResolve.selected.bbox` exactly for `DisasterQuery` and as the clipping boundary for event-focused satellite search:

- `west = selected.bbox.west`
- `east = selected.bbox.east`
- `south = selected.bbox.south`
- `north = selected.bbox.north`

Use `RegionResolve.selected.geometryRef` for `RegionMark`. Pass `selected.bbox` to `RegionMark` only as a fallback.

Do not widen, shrink, round, or replace the region bbox for wording such as "nearby", "around", or "附近" unless the user gives an explicit alternative bbox. For satellite imagery after a disaster event is found, use the Event-Focused Satellite Search rules below.

## Event-Focused Satellite Search

1. Call `DisasterQuery` with `RegionResolve.selected.bbox`.
2. If the user asks for satellite imagery, remote-sensing imagery, or disaster assessment and `DisasterQuery` returns events:
   - Prefer `event.affectedArea` as the satellite `bbox`.
   - Otherwise use `event.location` as `targetPoint` and pass `searchRadiusKm` based on the disaster type.
   - Always pass `RegionResolve.selected.bbox` too, so `SatelliteImageSearch` clips the focused search to the user-requested region.
3. Use these default radii when only `event.location` is available:
   - earthquake: `searchRadiusKm: 30`
   - flood: `searchRadiusKm: 20`
   - fire: `searchRadiusKm: 10`
   - typhoon: use `RegionResolve.selected.bbox`; do not use a single point unless `event.affectedArea` is returned.
4. If no disaster event is returned, do not invent a point or bbox. Use the user's explicit satellite bbox/date request, or report that no event-focused imagery can be requested.

## Workflow

1. Extract the region, disaster type, time range, satellite date range, cloud limit, and requested output detail.
2. For a named region, call `RegionResolve` first.
3. If map display, region focus, affected-area display, or satellite context is useful, call `RegionMark` with `RegionResolve.selected.geometryRef`.
4. For disaster facts, call `DisasterQuery` with the exact bbox:

```json
{
  "regionName": "Taiwan Strait",
  "bbox": { "west": 117, "east": 122.5, "south": 22, "north": 26.5 },
  "disasterType": "earthquake",
  "timeRange": "7d",
  "minMagnitude": 4
}
```

5. For satellite imagery, call `SatelliteImageSearch` with an event-focused bbox or point and an explicit date range:

```json
{
  "regionName": "Taiwan Strait",
  "bbox": { "west": 117, "east": 122.5, "south": 22, "north": 26.5 },
  "targetPoint": { "lon": 120.8, "lat": 23.6 },
  "searchRadiusKm": 30,
  "startDate": "2024-05-01",
  "endDate": "2024-05-10",
  "maxCloudCoverage": 30,
  "source": "any",
  "maxResults": 10
}
```

6. If `ImageAnalysis` is available and the satellite tool returns usable image URLs, call it for assessment. If `ImageAnalysis` is not available or the satellite tool only returns metadata and browser links, explain that limitation and do not claim visual damage detection.
7. Summarize only facts returned by tools.

## Parameter Mapping

Map disaster wording conservatively:

- Earthquake, 地震 -> `disasterType: "earthquake"`
- Flood, 洪水, 内涝 -> `disasterType: "flood"`
- Typhoon, cyclone, 台风, 热带气旋 -> `disasterType: "typhoon"`
- Fire, wildfire, 火灾, 山火 -> `disasterType: "fire"`
- General disaster query -> `disasterType: "all"`

Map time ranges:

- Today, last 24 hours, 过去24小时 -> `timeRange: "24h"`
- Last week, 最近一周, 7 days -> `timeRange: "7d"`
- Recent, lately, 最近 -> `timeRange: "30d"`
- Last year, 近一年 -> `timeRange: "1y"`

For earthquakes, use `minMagnitude: 4` unless the user asks for a different threshold.

For satellite search:

- Use the user's explicit dates if provided.
- If a disaster event is found and the user asks for post-disaster imagery, set `startDate` to the event date and `endDate` to today or the user's requested end date.
- If a disaster event has `event.affectedArea`, use that as the satellite bbox.
- If a disaster event only has `event.location`, pass it as `targetPoint` with the default `searchRadiusKm` for its disaster type and pass `RegionResolve.selected.bbox` for clipping.
- If the user asks for satellite imagery without a disaster event, use the user date range or the last 30 days.
- Use `maxCloudCoverage: 30` by default. Tighten it only if the user asks for clearer imagery.

## Rules

- Do not invent a bbox, disaster event, casualty count, damage estimate, source link, or satellite acquisition.
- If no disaster events are returned, say so directly and do not fabricate incidents.
- `SatelliteImageSearch` returns metadata and browser links. Treat `browserUrl` as an inspection link; downloads and thumbnails may require separate authentication.
- Do not call `SatelliteImageSearch` repeatedly with the same bbox/date/source only to be exhaustive.
- If `DisasterQuery` fails but `SatelliteImageSearch` succeeds, report partial results and the failed source.
- If `SatelliteImageSearch` fails but `DisasterQuery` succeeds, report disaster facts and say imagery search is unavailable.

## Response

Include:

- Region name, original region bbox, and focused satellite bbox or targetPoint/searchRadiusKm used.
- Disaster data source, event count, time window, and latest or most relevant events.
- Satellite image count, acquisition dates, source, cloud coverage when available, and browser links.
- Whether the result is event-based, metadata-based, or image-analysis-based.
- Limitations, especially missing image analysis, authentication requirements, stale data, or empty results.

Do not:

- Claim visual damage, flooded area, burn scar, or building loss from satellite metadata alone.
- Treat browser links as direct downloadable images.
- Infer causality, threat level, or emergency response status without tool evidence.
