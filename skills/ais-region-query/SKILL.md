---
name: ais-region-query
description: Use when the user asks about vessels, ships, maritime traffic, AIS data, aisstream, or naval/marine situation in a named region or bounding box that should be answered from the hourly aisstream.io ais_current_states database table.
argument-hint: "[user vessel query with region or bbox]"
allowed-tools: Read, SqlQuerySchema, SqlQuery
---

# AIS Region Query

Use this skill to answer maritime vessel situation questions from the hourly aisstream.io current-state read model. The data source is the database table `public.ais_current_states`; do not fetch live AIS data from a skill.

The table is refreshed by the backend AIS queue/worker. Treat results as a current snapshot with possible hourly staleness, not as live radar coverage.

## Required Input

Use the user's original query as `$ARGUMENTS`.

The query must contain:

1. Vessel intent: vessel, ship, maritime, AIS, aisstream, naval, marine, 船舶, 船只,  vessel traffic, or equivalent wording.
2. Region intent: a `RegionResolve.selected.bbox` already present in the current agent context, or an explicit bbox with latitude/longitude bounds.

If the vessel intent is present but the region is missing, ask the user to provide a bbox or resolve the named region first with RegionResolve. Do not map named regions to coordinates inside this skill.

## Region Bbox Source

For named regions, the agent must call RegionResolve before using this skill. Reuse `RegionResolve.selected.bbox` exactly:

- `minLat = selected.bbox.south`
- `maxLat = selected.bbox.north`
- `minLon = selected.bbox.west`
- `maxLon = selected.bbox.east`

Do not widen, shrink, round, or replace that bbox for "附近/nearby" wording. If the user provides an explicit bbox, use the user's bbox exactly after validating latitude/longitude order.

## Workflow

1. Extract the user's vessel question, region, time expectation, and detail level.
2. Reuse `RegionResolve.selected.bbox` from the current context, or parse the user-provided bbox.
3. Call `SqlQuerySchema` before querying:

```json
{"database":"default","schema":"public","table":"ais_current_states"}
```

If `SqlQuerySchema` says schema `public` is not allowlisted, report that the AIS schema needs to be added to `AGENT_SQL_ALLOWED_SCHEMAS` for alias `default`; do not switch to an unverified table.

4. Use `SqlQuery` with bounded read-only SQL against database alias `default`.
5. Summarize only facts returned by the database. Mention the bbox and data freshness.

## Current Table Shape

Expected columns:

```sql
mmsi,
ship_name,
call_sign,
ship_type,
longitude,
latitude,
sog,
cog,
heading,
navigational_status,
destination,
source_time,
updated_at
```

Current ingestion pulls global AIS states from aisstream.io and replaces the table hourly. `ship_type` may contain nulls for vessels without static data.

## Query Patterns

Summary query:

```sql
SELECT
  count(*)::int AS vessel_count,
  count(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL)::int AS positioned_count,
  max(source_time) AS latest_source_time,
  max(updated_at) AS latest_updated_at
FROM ais_current_states
WHERE latitude BETWEEN :minLat AND :maxLat
  AND longitude BETWEEN :minLon AND :maxLon;
```

Detail query:

```sql
SELECT
  mmsi,
  ship_name,
  call_sign,
  ship_type,
  longitude,
  latitude,
  sog,
  cog,
  heading,
  navigational_status,
  destination,
  source_time,
  updated_at
FROM ais_current_states
WHERE latitude BETWEEN :minLat AND :maxLat
  AND longitude BETWEEN :minLon AND :maxLon
ORDER BY source_time DESC, updated_at DESC
LIMIT 100;
```

Replace `:minLat`, `:maxLat`, `:minLon`, `:maxLon` with numeric literals before calling `SqlQuery`; the current tool accepts SQL text, not a separate parameter object.

## Rules

- Use only `SELECT` or `WITH` SQL.
- Always include bbox filters for vessel detail queries.
- For named regions, use the exact `RegionResolve.selected.bbox`; do not use hard-coded region coordinates.
- Keep detail output bounded with `LIMIT 100` or less unless the user explicitly asks for more and the tool limit allows it.
- Use `SqlQuerySchema` when uncertain about columns.
- If the table or SQL alias is unavailable, say the AIS database query capability is unavailable and do not invent counts.
- Do not expose connection strings or environment variables.

## Response

Include:

- Region name and bbox used.
- Number of rows returned and any limit.
- Latest `source_time`/`updated_at` visible in the result.
- Compact vessel rows: mmsi, ship_name or call_sign, lat/lon, speed `sog` (knots), heading, course over ground `cog`.

Do not:

- Claim complete maritime coverage.
- Infer naval activity, threat, or collision risk from position alone.
- Hide stale or missing coordinates.
