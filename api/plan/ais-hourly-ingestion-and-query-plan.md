# AIS Hourly Ingestion & Query Plan

## Goal

Replicate the OpenSky ingestion pattern for AIS (vessel) data:
- WebSocket pull → normalize → DB replaceAll → skill query + dashboard API.
- Separate from aircraft data. No ShipDT integration.

## Architecture

```
aisstream.io WebSocket (global bbox, 60s)
  └─→ ais/client.ts ──→ ais/ingestion.ts ──→ ais/repository.ts
         (connect + subscribe + accumulate + disconnect)
                                            └─→ DB ais_current_states
                                                   (DELETE + INSERT)
                                                   ├─→ agent skill query
                                                   └─→ dashboard API → frontend
```

## Files & Order

### Phase 1: Schema & Description

| # | File | Action | Note |
|---|------|--------|------|
| 1 | `src/db/schema.ts` | Add `aisCurrentStates` table | `mmsi` PK, fields: shipName, callSign, shipType, longitude, latitude, sog, cog, heading, navigationalStatus, destination, sourceTime, updatedAt. Indexes on lat/lon/updatedAt. |
| 2 | `src/instructions/database-description.md` | Add `ais_current_states` description | Under `default / public`, separate table block from `aircraft_current_states`. Include table purpose, key columns, bbox filter note. |
| 3 | `drizzle.config.ts` | Verify schema export | Should auto-include new table via `schema.ts` barrel. |
| 4 | `drizzle-kit push` | Run migration | Creates `ais_current_states` table in DB. |

### Phase 2: Ingestion Pipeline

| # | File | Action | Note |
|---|------|--------|------|
| 5 | `src/modules/ais/client.ts` | New | `connectAisStream(durationMs: number): Promise<AisStreamResponse>`. Opens WebSocket to `wss://stream.aisstream.io/v0/stream`, subscribes global bbox `[[[-90,-180],[90,180]]]`, accumulates PositionReport messages for 60s, then closes. Returns `{ time, ships: ShipState[] }`. |
| 6 | `src/modules/ais/ingestion.ts` | New | `ingestAisSnapshotOnce()` similar to `opensky/ingestion.ts`. Calls client, normalizes raw PositionReport → `NewAisCurrentState[]`, calls `replaceAll`. Handles empty response skip. |
| 7 | `src/modules/ais/repository.ts` | New | `replaceAll(states: NewAisCurrentState[]): Promise<ReplaceResult>`. Transaction: `DELETE FROM ais_current_states` then batch `INSERT`. Batch size 1000. |
| 8 | `src/modules/ais/queue.ts` | New | BullMQ Queue + repeatable job. Hourly cron pattern. Same pattern as `opensky/queue.ts`. Queue name: `"ais"`. Job name: `"fetch-and-store"`. |
| 9 | `src/modules/ais/worker.ts` | New | BullMQ Worker. `lockDuration: 120000`. Same pattern as `opensky/worker.ts`. Queue name: `"ais"`. |
| 10 | `src/index.ts` | Modify | Register AIS queue + worker on API startup (same place as OpenSky). Check `process.env.AIS_STREAM_COLLECTOR_ENABLED === "1"` for idempotent registration. |

### Phase 3: Skill

| # | File | Action | Note |
|---|------|--------|------|
| 11 | `skills/ais-region-query/SKILL.md` | New | Standalone skill. Do not mix with `aircraft-region-query`. Defines: table name (`ais_current_states`), schema alias (`default`/`public`), bbox query patterns, supported maritime regions, SQL templates. References `database-description.md` for column catalog. |

### Phase 4: Dashboard Query Integration

| # | File | Action | Note |
|---|------|--------|------|
| 12 | `src/db/schema.ts` | Export AIS types | Add `export type AisCurrentState = typeof aisCurrentStates.$inferSelect` and `export type NewAisCurrentState = typeof aisCurrentStates.$inferInsert`. |
| 13 | `src/modules/dashboard/projection.ts` | Add `projectAisStatesToAisData()` | Maps `AisCurrentState[]` → `ApiAisData`. Fields: `id` = `ais-${mmsi}`, `name` = `shipName || mmsi`, `type` = `"ship"`, `coordinates` = `[lon, lat]`, `importance` = hardcode `"low"`, `status` = hardcode `"normal"`, `description` = build from sog/cog/heading/shipType, `speed` = sog(knots) or 0, `heading` = heading or 0. Trajectories: empty array. |
| 14 | `src/modules/dashboard/service.ts` | Modify `getAisData()` | Replace `return emptyAisData()` with: (1) import `aisCurrentStates` from schema, (2) query `db.select().from(aisCurrentStates).limit(1000)`, (3) call `projectAisStatesToAisData()` and return. |
| 15 | `src/modules/dashboard/service.ts` | Import projection | Add `projectAisStatesToAisData` to the import from `./projection.js`. |

## Schema

```typescript
export const aisCurrentStates = pgTable(
  "ais_current_states",
  {
    mmsi: text("mmsi").primaryKey(),
    shipName: text("ship_name"),
    callSign: text("call_sign"),
    shipType: integer("ship_type"),
    longitude: doublePrecision("longitude"),
    latitude: doublePrecision("latitude"),
    sog: doublePrecision("sog"),
    cog: doublePrecision("cog"),
    heading: doublePrecision("heading"),
    navigationalStatus: integer("navigational_status"),
    destination: text("destination"),
    sourceTime: timestamp("source_time", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("ais_lat_idx").on(table.latitude),
    index("ais_lon_idx").on(table.longitude),
    index("ais_updated_at_idx").on(table.updatedAt),
  ]
);
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AISSTREAM_API_KEY` | Yes | aisstream.io API key |
| `AIS_STREAM_COLLECTOR_ENABLED` | No | Set to `"1"` to enable hourly ingestion |

## Risks

| Risk | Mitigation |
|------|------------|
| WebSocket 60s global accumulation may produce large dataset (memory) | Monitor first run. If >100k vessels, consider batching or region splitting. |
| aisstream.io free tier rate limit | Monitor worker logs. If throttled, implement backoff or upgrade tier. |
| Duplicate table name prefix | Use `ais_` prefix consistently to avoid collision with `aircraft_current_states`. |

## Not in Scope

- ShipDT integration (static vessel info query)
- AIS real-time streaming to frontend
- AIS alert/subscription system
