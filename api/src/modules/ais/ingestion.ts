import { connectAisStream, type AisStreamResponse } from "./client.js";
import type { NewAisCurrentState } from "../../db/schema.js";

export interface ReplaceResult {
  deleted: number;
  inserted: number;
}

export interface AisIngestionResult extends ReplaceResult {
  fetchedCount: number;
  insertedCount: number;
  normalizedCount: number;
  skipped?: boolean;
  skippedReason?: string;
}

export interface AisIngestionDeps {
  connectAisStream?: typeof connectAisStream;
  replaceAll?: (states: NewAisCurrentState[]) => Promise<ReplaceResult>;
}

export async function ingestAisSnapshotOnce(
  deps: AisIngestionDeps = {}
): Promise<AisIngestionResult> {
  const connectFn = deps.connectAisStream ?? connectAisStream;
  const replaceAllFn = deps.replaceAll ?? (await getDefaultReplaceAll());

  console.log("[AisIngestion] Starting snapshot ingestion...");
  const t0 = Date.now();
  const data = await connectFn();
  const connectMs = Date.now() - t0;
  console.log(`[AisIngestion] connectAisStream completed in ${connectMs}ms, ships=${data.ships.length}`);

  if (data.ships.length === 0) {
    console.warn("[AisIngestion] Empty AIS stream response; keeping existing ais_current_states.");
    return {
      deleted: 0,
      inserted: 0,
      fetchedCount: 0,
      insertedCount: 0,
      normalizedCount: 0,
      skipped: true,
      skippedReason: "empty_ships",
    };
  }

  const t1 = Date.now();
  const normalized = normalizeAisShips(data);
  const normalizeMs = Date.now() - t1;
  console.log(`[AisIngestion] normalizeAisShips completed in ${normalizeMs}ms, normalized=${normalized.states.length}`);

  const states = normalized.states;
  if (states.length === 0) {
    throw new Error("Refusing to replace ais_current_states because no valid AIS ships were normalized.");
  }

  const t2 = Date.now();
  const result = await replaceAllFn(states);
  const replaceMs = Date.now() - t2;
  console.log(`[AisIngestion] replaceAll completed in ${replaceMs}ms, deleted=${result.deleted}, inserted=${result.inserted}`);

  const totalMs = Date.now() - t0;
  console.log(`[AisIngestion] Snapshot ingestion finished in ${totalMs}ms`);

  return {
    ...result,
    fetchedCount: data.ships.length,
    insertedCount: result.inserted,
    normalizedCount: states.length,
  };
}

async function getDefaultReplaceAll(): Promise<(states: NewAisCurrentState[]) => Promise<ReplaceResult>> {
  const repositoryModule = await import("./repository.js");
  return repositoryModule.replaceAll;
}

export interface AisNormalizeStats {
  total: number;
  normalized: number;
  skippedNoMmsi: number;
}

export function normalizeAisShips(data: AisStreamResponse): {
  states: NewAisCurrentState[];
  stats: AisNormalizeStats;
} {
  const states: NewAisCurrentState[] = [];
  const stats: AisNormalizeStats = {
    total: data.ships.length,
    normalized: 0,
    skippedNoMmsi: 0,
  };

  for (const ship of data.ships) {
    if (!ship.mmsi) {
      stats.skippedNoMmsi += 1;
      continue;
    }
    states.push({
      mmsi: ship.mmsi,
      shipName: ship.shipName || null,
      callSign: ship.callSign || null,
      shipType: ship.shipType ?? null,
      longitude: ship.longitude ?? null,
      latitude: ship.latitude ?? null,
      sog: ship.sog ?? null,
      cog: ship.cog ?? null,
      heading: ship.heading ?? null,
      navigationalStatus: ship.navigationalStatus ?? null,
      destination: ship.destination || null,
      sourceTime: ship.sourceTime,
      updatedAt: new Date(),
    });
    stats.normalized += 1;
  }

  return { states, stats };
}
