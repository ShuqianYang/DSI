import { getToken, fetchStates, type OpenSkyStatesResponse } from "./client.js";
import type { NewAircraftCurrentState } from "../../db/schema.js";

export interface ReplaceResult {
  deleted: number;
  inserted: number;
}

export interface OpenSkyIngestionResult extends ReplaceResult {
  fetchedCount: number;
  insertedCount: number;
  normalizedCount: number;
  skipped?: boolean;
  skippedReason?: string;
}

export interface OpenSkyIngestionDeps {
  getToken?: typeof getToken;
  fetchStates?: typeof fetchStates;
  replaceAll?: (states: NewAircraftCurrentState[]) => Promise<ReplaceResult>;
}

export async function ingestOpenSkySnapshotOnce(
  deps: OpenSkyIngestionDeps = {}
): Promise<OpenSkyIngestionResult> {
  const getTokenFn = deps.getToken ?? getToken;
  const fetchStatesFn = deps.fetchStates ?? fetchStates;
  const replaceAllFn = deps.replaceAll ?? (await getDefaultReplaceAll());

  const token = await getTokenFn();
  const data = await fetchStatesFn(token);
  if (data.states.length === 0) {
    console.warn("[OpenSkyIngestion] Empty OpenSky states response; keeping existing aircraft_current_states.");
    return {
      deleted: 0,
      inserted: 0,
      fetchedCount: 0,
      insertedCount: 0,
      normalizedCount: 0,
      skipped: true,
      skippedReason: "empty_states",
    };
  }
  const normalized = normalizeOpenSkyStatesWithStats(data);
  logOpenSkyNormalizationSkips(normalized.stats);
  const states = normalized.states;
  if (states.length === 0) {
    throw new Error("Refusing to replace aircraft_current_states because no valid OpenSky states were normalized.");
  }
  const result = await replaceAllFn(states);

  return {
    ...result,
    fetchedCount: data.states.length,
    insertedCount: result.inserted,
    normalizedCount: states.length,
  };
}

async function getDefaultReplaceAll(): Promise<(states: NewAircraftCurrentState[]) => Promise<ReplaceResult>> {
  const module = await import("./repository.js");
  return module.replaceAll;
}

export function normalizeOpenSkyStates(data: OpenSkyStatesResponse): NewAircraftCurrentState[] {
  return normalizeOpenSkyStatesWithStats(data).states;
}

export interface OpenSkyNormalizeStats {
  total: number;
  normalized: number;
  skippedMalformed: number;
  skippedInvalidIcao24: number;
  skippedInvalidLastContact: number;
  skippedOther: number;
}

export function normalizeOpenSkyStatesWithStats(data: OpenSkyStatesResponse): {
  states: NewAircraftCurrentState[];
  stats: OpenSkyNormalizeStats;
} {
  const states: NewAircraftCurrentState[] = [];
  const stats: OpenSkyNormalizeStats = {
    total: data.states.length,
    normalized: 0,
    skippedMalformed: 0,
    skippedInvalidIcao24: 0,
    skippedInvalidLastContact: 0,
    skippedOther: 0,
  };

  for (const row of data.states) {
    if (!Array.isArray(row) || row.length < 17) {
      stats.skippedMalformed += 1;
      continue;
    }
    const icao24 = typeof row[0] === "string" ? row[0].trim() : "";
    if (!icao24) {
      stats.skippedInvalidIcao24 += 1;
      continue;
    }
    const hasValidLastContact = typeof row[4] === "number" && Number.isFinite(row[4]);
    if (!hasValidLastContact) {
      stats.skippedInvalidLastContact += 1;
      continue;
    }
    try {
      states.push(mapStateVector(row));
      stats.normalized += 1;
    } catch {
      stats.skippedOther += 1;
    }
  }
  return { states, stats };
}

function logOpenSkyNormalizationSkips(stats: OpenSkyNormalizeStats): void {
  const skipped =
    stats.skippedMalformed +
    stats.skippedInvalidIcao24 +
    stats.skippedInvalidLastContact +
    stats.skippedOther;
  if (skipped === 0) return;

  console.warn(
    "[OpenSkyIngestion] Skipped invalid state vectors:",
    JSON.stringify({
      total: stats.total,
      normalized: stats.normalized,
      skippedMalformed: stats.skippedMalformed,
      skippedInvalidIcao24: stats.skippedInvalidIcao24,
      skippedInvalidLastContact: stats.skippedInvalidLastContact,
      skippedOther: stats.skippedOther,
    })
  );
}

export function mapStateVector(row: unknown[]): NewAircraftCurrentState {
  const icao24 = typeof row[0] === "string" ? row[0].trim().toLowerCase() : "";
  if (!icao24) {
    throw new Error("Invalid OpenSky state vector: icao24 is required.");
  }
  const lastContact = typeof row[4] === "number" && Number.isFinite(row[4])
    ? new Date(row[4] * 1000)
    : undefined;
  if (!lastContact || Number.isNaN(lastContact.getTime())) {
    throw new Error("Invalid OpenSky state vector: last_contact is required.");
  }
  return {
    icao24,
    callsign: row[1] ? String(row[1]).trim() || null : null,
    originCountry: row[2] ? String(row[2]) : null,
    longitude: typeof row[5] === "number" ? row[5] : null,
    latitude: typeof row[6] === "number" ? row[6] : null,
    baroAltitude: typeof row[7] === "number" ? row[7] : null,
    onGround: Boolean(row[8]),
    velocity: typeof row[9] === "number" ? row[9] : null,
    trueTrack: typeof row[10] === "number" ? row[10] : null,
    verticalRate: typeof row[11] === "number" ? row[11] : null,
    squawk: row[14] ? String(row[14]) : null,
    spi: Boolean(row[15]),
    positionSource: typeof row[16] === "number" ? row[16] : null,
    category: typeof row[17] === "number" ? row[17] : null,
    sourceTime: lastContact,
    updatedAt: new Date(),
    region: "",
    status: "",
  };
}
