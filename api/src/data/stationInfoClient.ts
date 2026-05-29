import type { ShipState } from "./aisDataStore.js";
import { computeZoneIndex, deriveVesselStatus } from "./aisDataStore.js";

const BASE_URL = "http://218.249.73.159:60000/GetStationInfo.aspx";
const PARAMETER = "GMG80leXIjuFq2BifGIVQP7oTq7NI065QmVjbUpRl+Mnro5l2ot5EsadmvqB3a/U";
const POLL_INTERVAL_MS = 60_000;

interface StationInfoRaw {
  SiteID?: string;
  OriginalID?: string;
  SitName?: string;
  SiteType?: string;
  Site_Latitude?: string;
  Site_Longitude?: string;
  Site_Direction?: string;
  Site_Speed?: string;
  Site_State?: string;
  Site_Alarm?: string;
  LastOnlineTime?: string;
  UpdateTime?: string;
  GPS_CollectorTime?: string;
}

interface StationInfoResponse {
  StationInfo?: StationInfoRaw[];
}

let timer: NodeJS.Timeout | null = null;
let isRunning = false;

function parseNumber(v: string | undefined): number | null {
  if (v == null || v.trim() === "") return null;
  const n = parseFloat(v.trim());
  return isFinite(n) ? n : null;
}

function toShipState(raw: StationInfoRaw): ShipState | null {
  const lat = parseNumber(raw.Site_Latitude);
  const lng = parseNumber(raw.Site_Longitude);
  if (lat == null || lng == null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  const siteType = raw.SiteType?.trim();
  if (siteType !== "2" && siteType !== "3") return null;

  const id = raw.OriginalID?.trim() || raw.SiteID?.trim() || "";
  if (!id) return null;

  const heading = parseNumber(raw.Site_Direction) ?? 0;
  const speedKmh = parseNumber(raw.Site_Speed) ?? 0;
  const speed = speedKmh / 1.852; // km/h → 节

  const name = raw.SitName?.trim() || `站点-${id}`;
  const type = siteType === "2" ? "渔船" : "商船";

  const state = parseNumber(raw.Site_State);
  const status: "normal" | "warning" | "danger" =
    state === 2 || state === 3 ? "danger" : state === 1 ? "warning" : "normal";

  const ship: ShipState = {
    id,
    name,
    type,
    lat: parseFloat(lat.toFixed(6)),
    lng: parseFloat(lng.toFixed(6)),
    heading: heading < 0 ? heading + 360 : heading % 360,
    speed: parseFloat(speed.toFixed(1)),
    status,
    riskLevel: status === "danger" ? "high" : status === "warning" ? "medium" : "low",
    importance: "low",
    trajectory: [[lng, lat]],
    zoneIndex: computeZoneIndex(lat, lng),
    lastUpdated: Date.now(),
    dataSource: "station" as const,
  };

  deriveVesselStatus(ship);
  return ship;
}

export async function fetchStationInfo(): Promise<ShipState[]> {
  const rand = Math.floor(Math.random() * 10000);
  const url = `${BASE_URL}?Parameter=${encodeURIComponent(PARAMETER)}&Rand=${rand}`;

  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) {
      console.error(`[StationInfo] HTTP ${resp.status}`);
      return [];
    }
    const json = (await resp.json()) as StationInfoResponse;
    const arr = json.StationInfo || [];
    const ships: ShipState[] = [];
    for (const raw of arr) {
      const s = toShipState(raw);
      if (s) ships.push(s);
    }
    console.log(`[StationInfo] Fetched ${arr.length} records, valid ships: ${ships.length}`);
    return ships;
  } catch (err) {
    console.error("[StationInfo] Fetch failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

export function startStationInfoPolling(onUpdate: (ships: ShipState[]) => void): void {
  if (isRunning) return;
  isRunning = true;

  const tick = async () => {
    const ships = await fetchStationInfo();
    if (ships.length > 0) onUpdate(ships);
  };

  tick(); // 立即执行一次
  timer = setInterval(tick, POLL_INTERVAL_MS);
  console.log("[StationInfo] Polling started (60s interval)");
}

export function stopStationInfoPolling(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  isRunning = false;
  console.log("[StationInfo] Polling stopped");
}
