export interface RawAircraftUpdate {
  icao24: string;
  callsign: string;
  originCountry: string;
  lat: number;
  lng: number;
  altitude: number;
  speed: number;
  heading: number;
}

let token: string | null = null;
let tokenExpiresAt = 0;
let pollTimer: NodeJS.Timeout | null = null;
let isPolling = false;

const POLL_INTERVAL_MS = 600_000; // 10 分钟
const TOKEN_REFRESH_MARGIN_MS = 60_000;

const listeners: Set<(update: RawAircraftUpdate) => void> = new Set();

async function fetchToken(): Promise<string> {
  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET must be set");
  }

  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("client_id", clientId);
  params.append("client_secret", clientSecret);

  const res = await fetch(
    "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    }
  );

  if (!res.ok) {
    throw new Error(`Token request failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const accessToken = data.access_token;
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;

  if (typeof accessToken !== "string") {
    throw new Error("No access_token in response: " + JSON.stringify(data));
  }

  token = accessToken;
  tokenExpiresAt = Date.now() + expiresIn * 1000;
  return accessToken;
}

async function getValidToken(): Promise<string> {
  if (token && Date.now() < tokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) {
    return token;
  }
  return fetchToken();
}

async function fetchStates(): Promise<unknown> {
  const t = await getValidToken();
  const res = await fetch("https://opensky-network.org/api/states/all", {
    headers: { Authorization: `Bearer ${t}` },
  });

  if (!res.ok) {
    throw new Error(`States request failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

function parseStates(data: Record<string, unknown>): RawAircraftUpdate[] {
  const states = data.states as unknown[][] | undefined;
  if (!states || !Array.isArray(states)) return [];

  const updates: RawAircraftUpdate[] = [];

  for (const s of states) {
    if (!Array.isArray(s)) continue;

    const icao24 = String(s[0] || "").trim().toUpperCase();
    const callsignRaw = s[1];
    const callsign = typeof callsignRaw === "string" ? callsignRaw.trim() : "";
    const originCountry = String(s[2] || "");

    // OpenSky: s[5]=longitude, s[6]=latitude
    const rawLng = s[5];
    const rawLat = s[6];
    if (rawLat == null || rawLng == null) continue;

    const lat = Number(rawLat);
    const lng = Number(rawLng);
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    if (lat === 0 && lng === 0) continue;

    const rawAlt = s[7];
    const altitude = rawAlt != null && isFinite(Number(rawAlt)) ? Number(rawAlt) : 0;

    // OpenSky velocity is m/s, convert to km/h
    const rawSpeed = s[9];
    const speedMs = rawSpeed != null && isFinite(Number(rawSpeed)) ? Number(rawSpeed) : 0;
    const speed = speedMs * 3.6;

    const rawHeading = s[10];
    const heading = rawHeading != null && isFinite(Number(rawHeading)) ? Number(rawHeading) : 0;

    updates.push({
      icao24,
      callsign: callsign || `ICAO-${icao24}`,
      originCountry,
      lat,
      lng,
      altitude,
      speed,
      heading,
    });
  }

  return updates;
}

async function pollOnce(): Promise<void> {
  try {
    const data = (await fetchStates()) as Record<string, unknown>;
    const updates = parseStates(data);

    if (updates.length > 0) {
      console.log(`[OpenSky] Fetched ${updates.length} aircraft states`);
      for (const u of updates) {
        for (const cb of listeners) {
          try {
            cb(u);
          } catch (err) {
            console.error("[OpenSky] Listener error:", err);
          }
        }
      }
    }
  } catch (err) {
    console.error("[OpenSky] Poll failed:", err instanceof Error ? err.message : String(err));
  }
}

export function startOpenSkyPolling(): void {
  if (isPolling) {
    console.log("[OpenSky] Polling already active");
    return;
  }

  stopOpenSkyPolling();
  isPolling = true;

  // Immediate first poll
  pollOnce();

  pollTimer = setInterval(() => {
    pollOnce();
  }, POLL_INTERVAL_MS);

  console.log(`[OpenSky] Polling started (every ${POLL_INTERVAL_MS / 1000}s)`);
}

export function stopOpenSkyPolling(): void {
  isPolling = false;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function onAircraftUpdate(callback: (update: RawAircraftUpdate) => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}
