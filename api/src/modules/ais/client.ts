import WebSocket from "ws";

const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";
const DEFAULT_DURATION_MS = 60_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 30_000;

export interface ShipState {
  mmsi: string;
  shipName?: string;
  callSign?: string;
  shipType?: number;
  longitude?: number;
  latitude?: number;
  sog?: number;
  cog?: number;
  heading?: number;
  navigationalStatus?: number;
  destination?: string;
  sourceTime: Date;
}

export interface AisStreamResponse {
  time: number;
  ships: ShipState[];
}

function getApiKey(): string {
  const key = process.env.AISSTREAM_API_KEY;
  if (!key) {
    throw new Error("AISSTREAM_API_KEY must be set in environment");
  }
  return key;
}

export async function connectAisStream(
  durationMs: number = DEFAULT_DURATION_MS
): Promise<AisStreamResponse> {
  const apiKey = getApiKey();
  const ships = new Map<string, ShipState>();
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    console.log("[AISClient] Connecting to", AISSTREAM_URL);
    const ws = new WebSocket(AISSTREAM_URL);
    let closed = false;

    const connectionTimeout = setTimeout(() => {
      if (!closed) {
        closed = true;
        ws.terminate();
        reject(new Error("AIS stream connection timeout"));
      }
    }, DEFAULT_CONNECTION_TIMEOUT_MS);

    const durationTimeout = setTimeout(() => {
      if (!closed) {
        closed = true;
        ws.close();
        resolve({ time: Math.floor(Date.now() / 1000), ships: Array.from(ships.values()) });
      }
    }, durationMs);

    ws.on("open", () => {
      const subscriptionMessage = {
        APIKey: apiKey,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FilterMessageTypes: ["PositionReport"],
      };
      ws.send(JSON.stringify(subscriptionMessage));
    });

    ws.on("message", (data: WebSocket.RawData) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.MessageType === "PositionReport" && message.Message?.PositionReport) {
          const report = message.Message.PositionReport;
          const meta = message.MetaData || {};
          const mmsi = String(meta.MMSI || report.UserID || "");
          if (!mmsi) return;

          const ship: ShipState = {
            mmsi,
            shipName: meta.ShipName || undefined,
            callSign: meta.callsign || undefined,
            shipType: meta.shipType || undefined,
            longitude: typeof report.Longitude === "number" ? report.Longitude : undefined,
            latitude: typeof report.Latitude === "number" ? report.Latitude : undefined,
            sog: typeof report.Sog === "number" ? report.Sog : undefined,
            cog: typeof report.Cog === "number" ? report.Cog : undefined,
            heading: typeof report.TrueHeading === "number" ? report.TrueHeading : undefined,
            navigationalStatus: typeof report.NavigationalStatus === "number" ? report.NavigationalStatus : undefined,
            destination: meta.destination || undefined,
            sourceTime: new Date(),
          };
          ships.set(mmsi, ship);
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("error", (err) => {
      if (!closed) {
        clearTimeout(connectionTimeout);
        clearTimeout(durationTimeout);
        closed = true;
        reject(err);
      }
    });

    ws.on("close", () => {
      if (!closed) {
        clearTimeout(connectionTimeout);
        clearTimeout(durationTimeout);
        closed = true;
        resolve({ time: Math.floor(Date.now() / 1000), ships: Array.from(ships.values()) });
      }
    });
  });
}
