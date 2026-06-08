---
name: aircraft-region-query
description: Guides aircraft information queries for a named region by resolving the region's approximate coordinates with WebSearch, then querying aircraft state data through read-only database tools. Use when the user asks about aircraft, flights, planes, ADS-B, OpenSky, air traffic, or aviation situation in a specific region or place.
argument-hint: "[user aircraft query with region]"
allowed-tools: Read, WebSearch, SqlQuerySchema, SqlQuery
---

# Aircraft Region Query

Use this skill when the user asks for aircraft information in a named region, for example:

- "Query aircraft near Taiwan Strait"
- "Show current planes around Japan"
- "Check OpenSky aircraft in the South China Sea"
- "Find flights over Beijing"

This skill is a workflow guide. It must not invent coordinates, aircraft counts, or business conclusions.

## Required Input

Use the user's original query as `$ARGUMENTS`.

The query must contain both:

1. An aircraft intent: aircraft, flight, plane, ADS-B, OpenSky, aviation, air traffic, or equivalent wording.
2. A region/place intent: country, city, sea area, strait, airport vicinity, province, bbox-like area, or named region.

If the aircraft intent is present but the region is missing, ask the user to choose or provide a region before querying the database.

## Workflow

1. Extract the region phrase and aircraft question from `$ARGUMENTS`.
2. Use `WebSearch` to resolve the approximate region coordinates.
3. Convert the location evidence into a conservative bounding box.
4. Query aircraft data through an available read-only database tool.
5. Summarize the returned records without making unsupported business conclusions.

## Step 1: Extract Intent

Identify:

- `regionName`: the user's named region.
- `aircraftQuestion`: what the user wants to know.
- `timeScope`: default to current/latest database state unless the user asks for history.
- `limit`: default to 100 rows, never request more than 300 rows unless the user explicitly asks and policy allows it.

If the region is ambiguous, do not guess. Ask the user to pick from likely region names.

## Step 2: Resolve Region Coordinates

Call `WebSearch` before querying aircraft data.

Search query pattern:

```text
<regionName> latitude longitude bounding box
```

Prefer sources that provide coordinates, administrative boundaries, airport coordinates, or geographic descriptions. Use multiple search results when the region is broad or ambiguous.

Produce an internal coordinate summary:

```json
{
  "regionName": "...",
  "center": { "lat": 0, "lon": 0 },
  "bbox": {
    "minLat": 0,
    "maxLat": 0,
    "minLon": 0,
    "maxLon": 0
  },
  "confidence": "high|medium|low",
  "sourcesUsed": ["..."]
}
```

Bounding box guidance:

- City or airport vicinity: use a small bbox around the resolved coordinate.
- Strait, sea, province, or country: use a conservative bbox based on search evidence.
- If only a center point is found, create a small bbox and state that it is approximate.
- If confidence is low, ask for clarification instead of querying too broadly.

## Step 3: Query Database

Use the dedicated database tool if available.

Preferred structured tool intent:

```json
{
  "dataset": "aircraft_current_states",
  "filters": {
    "bbox": {
      "minLat": 0,
      "maxLat": 0,
      "minLon": 0,
      "maxLon": 0
    },
    "latestOnly": true
  },
  "limit": 100,
  "orderBy": [
    { "field": "updated_at", "direction": "desc" }
  ]
}
```

If only `RunSqlReadOnly` is available, first inspect or use the known aircraft read model schema. Keep SQL read-only and bounded.

Expected table shape, if present:

```sql
aircraft_current_states(
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
  source_time,
  updated_at,
  region,
  status
)
```

SQL pattern:

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
  source_time,
  updated_at,
  region,
  status
FROM aircraft_current_states
WHERE latitude BETWEEN :minLat AND :maxLat
  AND longitude BETWEEN :minLon AND :maxLon
ORDER BY updated_at DESC
LIMIT :limit;
```

Rules:

- Never use write SQL.
- Never expose connection strings.
- Never query unbounded aircraft rows.
- Prefer parameterized inputs if the DB tool supports them.
- If the aircraft table or DB tool is unavailable, say that the data query capability is not available yet and report the resolved region coordinates separately.

## Step 4: Respond

Use the database observation as the source of aircraft facts.

Include:

- The region/bbox used, marked as approximate when applicable.
- Number of records returned and result limit.
- A compact aircraft summary: callsign/icao24, country, position, altitude, speed, heading, updated time.
- Any obvious data caveats from the tool result, such as stale records or missing coordinates.

Do not:

- Treat WebSearch as aircraft data.
- Infer military, threat, risk, or abnormal behavior unless a dedicated analysis tool or explicit data field supports it.
- Hide uncertainty about approximate coordinates.
- Claim full regional coverage if the bbox was approximate or the database result was limited.
