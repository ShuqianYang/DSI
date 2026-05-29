import "dotenv/config";

const CLIENT_ID = "biasbaltimore-api-client";
const CLIENT_SECRET = "1A4SX7DGqTqPw9ltqLWd6KVS8zKrOTxk";

async function getToken(): Promise<string> {
  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("client_id", CLIENT_ID);
  params.append("client_secret", CLIENT_SECRET);

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
  const token = data.access_token;
  if (typeof token !== "string") {
    throw new Error("No access_token in response: " + JSON.stringify(data));
  }
  return token;
}

async function getStates(token: string): Promise<unknown> {
  const res = await fetch("https://opensky-network.org/api/states/all", {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`States request failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

function printStatesPreview(data: Record<string, unknown>): void {
  const states = data.states as unknown[][] | undefined;
  console.log("Time:", data.time);
  console.log("Total aircrafts:", states?.length ?? 0);

  if (states && states.length > 0) {
    console.log("\nPreview (first 5):");
    console.log(
      "ICAO24   | Callsign   | Country        | [Lat, Lng]        | Alt(m) | Speed(m/s) | Heading"
    );
    console.log(
      "---------+------------+----------------+-------------------+--------+------------+--------"
    );
    for (const s of states.slice(0, 5)) {
      const icao24 = s[0] || "N/A";
      const callsign = (s[1] || "").toString().trim() || "N/A";
      const country = s[2] || "N/A";
      const lat = s[6] != null ? Number(s[6]).toFixed(4) : "N/A";
      const lng = s[5] != null ? Number(s[5]).toFixed(4) : "N/A";
      const alt = s[7] != null ? Number(s[7]).toFixed(0) : "N/A";
      const speed = s[9] != null ? Number(s[9]).toFixed(1) : "N/A";
      const heading = s[10] != null ? Number(s[10]).toFixed(0) : "N/A";
      console.log(
        `${icao24.toString().padEnd(8)} | ${callsign.padEnd(10)} | ${country.toString().padEnd(14)} | [${lat}, ${lng}] | ${alt.padEnd(6)} | ${speed.padEnd(10)} | ${heading}`
      );
    }
  }
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("Error: OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET must be set in .env");
    process.exit(1);
  }

  console.log("[OpenSky] Fetching access token...");
  const token = await getToken();
  console.log("[OpenSky] Token obtained");

  console.log("[OpenSky] Fetching aircraft states...");
  const data = (await getStates(token)) as Record<string, unknown>;
  printStatesPreview(data);
}

main().catch((e) => {
  console.error("[OpenSky] Error:", e);
  process.exit(1);
});
