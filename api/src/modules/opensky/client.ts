export interface OpenSkyStatesResponse {
  time: number;
  states: unknown[];
}

const OPENSKY_AUTH_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const OPENSKY_STATES_URL = "https://opensky-network.org/api/states/all";
const DEFAULT_OPENSKY_REQUEST_TIMEOUT_MS = 30_000;

export function getOpenSkyRequestTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.OPENSKY_REQUEST_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_OPENSKY_REQUEST_TIMEOUT_MS;
}

export async function getToken(): Promise<string> {
  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET must be set in environment"
    );
  }

  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("client_id", clientId);
  params.append("client_secret", clientSecret);

  const res = await fetch(OPENSKY_AUTH_URL, {
    method: "POST",
    signal: createTimeoutSignal(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    throw new Error(`Token request failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const token = data.access_token;
  if (typeof token !== "string") {
    throw new Error("No access_token in response: " + JSON.stringify(data));
  }
  return token;
}

export async function fetchStates(token: string): Promise<OpenSkyStatesResponse> {
  const res = await fetch(OPENSKY_STATES_URL, {
    signal: createTimeoutSignal(),
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`States request failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as Partial<OpenSkyStatesResponse>;

  if (typeof data.time !== "number" || !Array.isArray(data.states)) {
    throw new Error(
      "Invalid OpenSky response shape: " + JSON.stringify(data).slice(0, 200)
    );
  }

  return { time: data.time, states: data.states };
}

function createTimeoutSignal(): AbortSignal {
  return AbortSignal.timeout(getOpenSkyRequestTimeoutMs());
}
