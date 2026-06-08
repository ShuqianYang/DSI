---
name: aircraft-region-query
description: Use when the user asks about aircraft, flights, planes, ADS-B, OpenSky, air traffic, or aviation situation in a named region or bounding box that should be answered from the hourly OpenSky aircraft_current_states database table.
argument-hint: "[user aircraft query with region or bbox]"
allowed-tools: Read, SqlQuerySchema, SqlQuery
---

# Aircraft Region Query

Use this skill to answer aircraft situation questions from the hourly OpenSky current-state read model. The data source is the database table `public.aircraft_current_states`; do not fetch live OpenSky data from a skill.

The table is refreshed by the backend OpenSky queue/worker. Treat results as a current snapshot with possible hourly staleness, not as live radar coverage.

## Required Input

Use the user's original query as `$ARGUMENTS`.

The query must contain:

1. Aircraft intent: aircraft, flight, plane, ADS-B, OpenSky, aviation, air traffic, 飞机, 航班, 航空器, 空域, or equivalent wording.
2. Region intent: one supported region below, or an explicit bbox with latitude/longitude bounds.

If the aircraft intent is present but the region is missing, ask the user to choose a supported region or provide a bbox.

## Supported Approximate Regions

Use these conservative bboxes when the user names a supported region. If the user asks for another place, do not invent coordinates; ask for a bbox or one of these regions.

| Region | minLat | maxLat | minLon | maxLon |
|---|---:|---:|---:|---:|
| 东海 | 24.0 | 33.5 | 119.0 | 128.5 |
| 南海 | 3.0 | 23.5 | 105.0 | 122.0 |
| 渤海 | 37.0 | 41.2 | 117.0 | 122.5 |
| 黄海 | 31.0 | 39.5 | 119.0 | 126.5 |
| 中国东部 | 20.0 | 42.0 | 110.0 | 124.0 |
| 台湾海峡 | 22.0 | 26.5 | 117.0 | 122.5 |

## Workflow

1. Extract the user's aircraft question, region, time expectation, and detail level.
2. Map the region to a supported bbox, or parse the user-provided bbox.
3. Call `SqlQuerySchema` before querying:

```json
{"database":"default","schema":"public","table":"aircraft_current_states"}
```

If `SqlQuerySchema` says schema `public` is not allowlisted, report that the aircraft schema needs to be added to `AGENT_SQL_ALLOWED_SCHEMAS` for alias `default`; do not switch to an unverified table.

4. Use `SqlQuery` with bounded read-only SQL against database alias `default`.
5. Summarize only facts returned by the database. Mention the bbox and data freshness.

## Current Table Shape

Expected columns:

```sql
icao24,
callsign,
origin_country,
longitude,
latitude,
baro_altitude,
velocity,
true_track,
vertical_rate,
on_ground,
squawk,
spi,
position_source,
category,
source_time,
updated_at,
region,
status
```

Current ingestion pulls global OpenSky states and replaces the table hourly. `region` and `status` may be empty strings in the current implementation, so bbox filtering is the reliable regional query method. Do not treat blank `status` as risk classification.

## Query Patterns

Summary query:

```sql
SELECT
  count(*)::int AS aircraft_count,
  count(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL)::int AS positioned_count,
  max(source_time) AS latest_source_time,
  max(updated_at) AS latest_updated_at
FROM aircraft_current_states
WHERE latitude BETWEEN :minLat AND :maxLat
  AND longitude BETWEEN :minLon AND :maxLon;
```

Detail query:

```sql
SELECT
  icao24,
  callsign,
  origin_country,
  longitude,
  latitude,
  baro_altitude,
  velocity,
  true_track,
  vertical_rate,
  on_ground,
  squawk,
  spi,
  position_source,
  category,
  source_time,
  updated_at,
  COALESCE(NULLIF(region, ''), 'unassigned') AS region,
  COALESCE(NULLIF(status, ''), 'unclassified') AS status
FROM aircraft_current_states
WHERE latitude BETWEEN :minLat AND :maxLat
  AND longitude BETWEEN :minLon AND :maxLon
ORDER BY source_time DESC, updated_at DESC
LIMIT 100;
```

Emergency-signal query, only when the user asks for unusual, emergency, or notable aircraft:

```sql
SELECT
  icao24,
  callsign,
  origin_country,
  longitude,
  latitude,
  baro_altitude,
  velocity,
  true_track,
  vertical_rate,
  squawk,
  spi,
  source_time,
  updated_at
FROM aircraft_current_states
WHERE latitude BETWEEN :minLat AND :maxLat
  AND longitude BETWEEN :minLon AND :maxLon
  AND (squawk IN ('7500', '7600', '7700') OR spi = true)
ORDER BY source_time DESC, updated_at DESC
LIMIT 20;
```

Replace `:minLat`, `:maxLat`, `:minLon`, `:maxLon` with numeric literals before calling `SqlQuery`; the current tool accepts SQL text, not a separate parameter object.

## Rules

- Use only `SELECT` or `WITH` SQL.
- Always include bbox filters for aircraft detail queries.
- Keep detail output bounded with `LIMIT 100` or less unless the user explicitly asks for more and the tool limit allows it.
- Use `SqlQuerySchema` when uncertain about columns.
- If the table or SQL alias is unavailable, say the aircraft database query capability is unavailable and do not invent counts.
- Do not expose connection strings or environment variables.

## Response

Include:

- Region name and bbox used.
- Number of rows returned and any limit.
- Latest `source_time`/`updated_at` visible in the result.
- Compact aircraft rows: callsign or icao24, country, lat/lon, altitude `baro_altitude`, speed `velocity`, heading `true_track`, vertical rate, squawk/SPI when relevant.

Do not:

- Claim complete airspace coverage.
- Infer military activity, hijacking, emergency, threat, mechanical failure, or regulatory violation from position alone.
- Treat empty `region` or `status` fields as meaningful classification.
- Hide stale or missing coordinates.
