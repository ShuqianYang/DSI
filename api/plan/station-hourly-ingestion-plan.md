# Station Hourly Ingestion & Query Plan

## Goal

接入 GetStationInfo.aspx VSAT 卫星通信终端数据，建立与 AIS/OpenSky 同构的 hourly injection pipeline，并在 Dashboard 和 Agent skill 中支持查询。

## Architecture

```
GetStationInfo.aspx HTTP GET (hourly cron)
  └─→ station/client.ts ──→ station/ingestion.ts ──→ station/repository.ts
                                              └─→ DB station_current_states
                                                     ├─→ agent skill query
                                                     └─→ dashboard API → frontend
```

## Files & Order

### Phase 1: Schema & Description

| # | File | Action | Note |
|---|------|--------|------|
| 1 | `src/db/schema.ts` | Add `stationCurrentStates` table | `station_id` PK (映射 OriginalID), fields: site_name, site_type, longitude, latitude, direction, speed, snr_hub, snr_rem, rx_rate, tx_rate, state, alarm, source_time, updated_at. Indexes on lat/lon/updated_at. |
| 2 | `src/instructions/database-description.md` | Add `station_current_states` description | Under `default / public`, separate block. Include table purpose (VSAT terminal snapshot), key columns, bbox filter note. |
| 3 | `drizzle.config.ts` | Verify schema export | Should auto-include via `schema.ts` barrel. |
| 4 | `drizzle-kit push` | Run migration | Creates `station_current_states` table in DB. |

### Phase 2: Ingestion Pipeline

| # | File | Action | Note |
|---|------|--------|------|
| 5 | `src/modules/station/client.ts` | New | `fetchStationSnapshot(): Promise<StationSnapshotResponse>`. HTTP GET to `http://218.249.73.159:60000/GetStationInfo.aspx` with Parameter + Rand. Parses JSON response. Returns `{ time, stations: StationRaw[] }`. |
| 6 | `src/modules/station/ingestion.ts` | New | `ingestStationSnapshotOnce()`. Calls client, normalizes raw VSAT JSON → `NewStationCurrentState[]`, calls `replaceAll`. Handles empty response skip. |
| 7 | `src/modules/station/repository.ts` | New | `replaceAll(states: NewStationCurrentState[]): Promise<ReplaceResult>`. Transaction: DELETE FROM station_current_states then batch INSERT. Batch size 1000. |
| 8 | `src/modules/station/queue.ts` | New | BullMQ Queue + repeatable job. Hourly cron pattern. Queue name: `"station"`. Job name: `"fetch-and-store"`. |
| 9 | `src/modules/station/worker.ts` | New | BullMQ Worker. `lockDuration: 120000`. Queue name: `"station"`. |
| 10 | `src/index.ts` | Modify | Register station queue + worker on API startup. Check `process.env.STATION_COLLECTOR_ENABLED === "1"`. |

### Phase 3: Dashboard Query Integration

| # | File | Action | Note |
|---|------|--------|------|
| 11 | `src/db/schema.ts` | Export station types | Add `export type StationCurrentState = ...` and `export type NewStationCurrentState = ...`. |
| 12 | `src/modules/dashboard/projection.ts` | Add `projectStationStatesToStationData()` | Maps `StationCurrentState[]` → `ApiStationData`. Fields: `id` = `station-${station_id}`, `name` = `site_name || station_id`, `type` = `"station"`, `coordinates` = `[lon, lat]`, `importance` = `"low"`, `status` = normalize from `state`/`alarm`, `description` = build from snr_hub/rx_rate/tx_rate/alarm. Trajectories: empty array. |
| 13 | `src/modules/dashboard/service.ts` | Add `getStationData()` | Query `db.select().from(stationCurrentStates).limit(1000)`, call projection, return. |
| 14 | `src/modules/dashboard/routes.ts` | Add `GET /station/data` | Route → `controller.getStationData`. |
| 15 | `src/modules/dashboard/controller.ts` | Add `getStationData` | Wrap service call with `asyncHandler`. |

### Phase 4: Frontend Integration

| # | File | Action | Note |
|---|------|--------|------|
| 16 | `src/lib/api.ts` | Add `getStationData()` | `fetchJson("/station/data")`. Return `Promise<ApiStationData>`. |
| 17 | `packages/shared/src/types/maritime.ts` | Extend `EntityType` | Add `"station"` to enum. |
| 18 | `src/app/page.tsx` | Add station state | `stationEntities` + `stationTrajectories` state. `getStationData()` on mount + 10s interval. Merge into `allEntities`. |
| 19 | `src/components/cesium/CesiumMap.tsx` | Add station rendering | `getStatusColor`: `entityType === 'station' && status === 'normal'` → `'#00FF88'` (green, distinct from ship blue). `getEntitySize`: station → 8 (slightly larger than aircraft). `isEntityLayerActive`: add `station` layer check. |

### Phase 5: Skill & Database Description

| # | File | Action | Note |
|---|------|--------|------|
| 20 | `skills/station-region-query/SKILL.md` | New | Standalone skill. Do not mix with `ais-region-query`. Defines: table name (`station_current_states`), schema alias (`default`/`public`), bbox query patterns. VSAT-specific columns: `snr_hub`, `snr_rem`, `rx_rate`, `tx_rate`, `alarm`. Query patterns include communication health summary. |
| 21 | `skills/ais-region-query/SKILL.md` | Update | Add note: "This skill queries **AIS vessel data only**. For VSAT satellite terminal queries, use `station-region-query`." Prevents model confusion. |
| 22 | `src/instructions/database-description.md` | Update | Add `station_current_states` block (see Phase 1 #2). Add cross-reference note: "For vessel queries use `ais_current_states`; for VSAT terminal queries use `station_current_states`." |

## Schema

```typescript
export const stationCurrentStates = pgTable(
  "station_current_states",
  {
    stationId: text("station_id").primaryKey(),
    siteName: text("site_name"),
    siteType: integer("site_type"),
    longitude: doublePrecision("longitude"),
    latitude: doublePrecision("latitude"),
    direction: doublePrecision("direction"),
    speed: doublePrecision("speed"),
    snrHub: doublePrecision("snr_hub"),
    snrRem: doublePrecision("snr_rem"),
    rxRate: doublePrecision("rx_rate"),
    txRate: doublePrecision("tx_rate"),
    state: integer("state"),
    alarm: text("alarm"),
    sourceTime: timestamp("source_time", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("station_lat_idx").on(table.latitude),
    index("station_lon_idx").on(table.longitude),
    index("station_updated_at_idx").on(table.updatedAt),
  ]
);
```

## Skill Design

### `station-region-query` (New)

**Purpose**: Answer VSAT satellite terminal questions from the hourly `station_current_states` database table.

**Key differences from `ais-region-query`**:

| Aspect | AIS | Station |
|--------|-----|---------|
| Primary ID | `mmsi` | `station_id` |
| Name field | `ship_name` | `site_name` |
| Speed field | `sog` (knots) | `speed` (unit TBD) |
| Unique fields | `ship_type`, `navigational_status`, `destination` | `snr_hub`, `snr_rem`, `rx_rate`, `tx_rate`, `alarm` |
| Health indicator | `navigational_status` | `state` + `alarm` |

**Query patterns**:

Summary query:
```sql
SELECT
  count(*)::int AS station_count,
  count(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL)::int AS positioned_count,
  max(source_time) AS latest_source_time
FROM station_current_states
WHERE latitude BETWEEN :minLat AND :maxLat
  AND longitude BETWEEN :minLon AND :maxLon;
```

Detail query with communication health:
```sql
SELECT
  station_id, site_name, site_type,
  longitude, latitude, direction, speed,
  snr_hub, snr_rem, rx_rate, tx_rate,
  state, alarm, source_time, updated_at
FROM station_current_states
WHERE latitude BETWEEN :minLat AND :maxLat
  AND longitude BETWEEN :minLon AND :maxLon
ORDER BY source_time DESC
LIMIT 100;
```

### `ais-region-query` (Update)

Add explicit scope boundary:
- "This skill queries **AIS vessel data only** from `ais_current_states`."
- "For VSAT satellite terminal queries, the `station-region-query` skill is available."
- "Do not query `station_current_states` from this skill."

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `STATION_API_PARAMETER` | Yes | GetStationInfo.aspx Parameter (encrypted) |
| `STATION_API_BASE_URL` | No | Default: `http://218.249.73.159:60000/GetStationInfo.aspx` |
| `STATION_COLLECTOR_ENABLED` | No | Set to `"1"` to enable hourly ingestion |

## Risks

| Risk | Mitigation |
|------|------------|
| HTTP endpoint (not HTTPS) | Internal network only; monitor for MITM if exposed |
| Parameter may expire/rotate | Store in env var, update via config change without code deploy |
| Data includes sensitive site names (X'd out in current response) | If real names appear in production, consider PII handling |
| Site speed unit unknown | Monitor first run, confirm unit (likely km/h or m/s, not knots) |
| Station count growth | Current ~80; if >1000, consider limit or aggregation |

## Not in Scope

- Real-time VSAT streaming to frontend (hourly snapshot only)
- Station alarm/subscription system
- Historical trend analysis (only current state)
