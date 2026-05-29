import WebSocket from "ws";
import https from "https";

export interface RawVesselUpdate {
  mmsi: string;
  shipName: string;
  lat: number;
  lng: number;
  sog: number;
  cog: number;
}

type ConnectionStatus = "disconnected" | "connecting" | "connected";

let ws: WebSocket | null = null;
let status: ConnectionStatus = "disconnected";
let reconnectAttempts = 0;
let reconnectTimer: NodeJS.Timeout | null = null;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 3000;

const listeners: Set<(update: RawVesselUpdate) => void> = new Set();

// 全球范围（AISStream 格式：[[minLat, minLng], [maxLat, maxLng]]）
const BOUNDING_BOXES: number[][][] = [
  [[-90, -180], [90, 180]],
];

export function startAISStream(apiKey: string): void {
  if (ws && (status === "connected" || status === "connecting")) {
    console.log("[AISStream] Already connected or connecting");
    return;
  }

  stopAISStream();
  status = "connecting";
  reconnectAttempts = 0;

  connect(apiKey);
}

function connect(apiKey: string): void {
  try {
    // 临时跳过证书验证（AISStream 服务端证书过期）
    // TODO: 证书恢复后移除 rejectUnauthorized: false
    const agent = new https.Agent({ rejectUnauthorized: false });
    ws = new WebSocket("wss://stream.aisstream.io/v0/stream", { agent });

    ws.on("open", () => {
      status = "connected";
      reconnectAttempts = 0;
      console.log("[AISStream] WebSocket connected");

      const subscription = {
        Apikey: apiKey,
        BoundingBoxes: BOUNDING_BOXES,
        FiltersShipMMSI: [],
        FilterMessageTypes: ["PositionReport"],
      };

      ws!.send(JSON.stringify(subscription));
      console.log(`[AISStream] Subscribed to ${BOUNDING_BOXES.length} sea zones`);
    });

    ws.on("message", (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleMessage(msg);
      } catch (err) {
        console.error("[AISStream] Failed to parse message:", err);
      }
    });

    ws.on("error", (err) => {
      console.error("[AISStream] WebSocket error:", err.message);
    });

    ws.on("close", () => {
      const wasConnected = status === "connected";
      status = "disconnected";
      ws = null;

      if (wasConnected) {
        console.log("[AISStream] Connection closed, will attempt reconnect");
      }

      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts);
        reconnectAttempts++;
        console.log(`[AISStream] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
        reconnectTimer = setTimeout(() => connect(apiKey), delay);
      } else {
        console.error("[AISStream] Max reconnect attempts reached, giving up");
      }
    });
  } catch (err) {
    console.error("[AISStream] Failed to create WebSocket:", err);
    status = "disconnected";
  }
}

function handleMessage(msg: unknown): void {
  const m = msg as Record<string, unknown>;
  if (!m.Message || typeof m.Message !== "object") return;

  const message = m.Message as Record<string, unknown>;
  if (!message.PositionReport || typeof message.PositionReport !== "object") return;

  const report = message.PositionReport as Record<string, unknown>;
  const meta = (m.MetaData as Record<string, unknown>) || {};

  const mmsi = String(meta.MMSI || "");
  if (!mmsi) return;

  // 严格过滤无效坐标：null/undefined 会被 Number() 转成 0，需显式排除
  const rawLat = report.Latitude;
  const rawLng = report.Longitude;
  if (rawLat == null || rawLng == null) return;

  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
  // 排除缺失坐标的默认值 [0, 0]（几内亚湾，极少有真实船舶恰好在此）
  if (lat === 0 && lng === 0) return;

  const rawSog = report.Sog;
  const rawCog = report.Cog;
  const sog = rawSog != null && isFinite(Number(rawSog)) ? Number(rawSog) : 0;
  const cog = rawCog != null && isFinite(Number(rawCog)) ? Number(rawCog) : 0;

  // AISStream 返回 [lat, lng]，转换为内部 [lng, lat]
  const update: RawVesselUpdate = {
    mmsi,
    shipName: String(meta.ShipName || "").trim() || `MMSI-${mmsi}`,
    lat,
    lng,
    sog,
    cog,
  };

  for (const cb of listeners) {
    try {
      cb(update);
    } catch (err) {
      console.error("[AISStream] Listener error:", err);
    }
  }
}

export function stopAISStream(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  // 先标记断开+阻止重连，再关闭 ws，避免 close 事件同步触发时误重连
  status = "disconnected";
  reconnectAttempts = MAX_RECONNECT_ATTEMPTS;
  if (ws) {
    const w = ws;
    ws = null;
    try {
      w.close();
    } catch {
      // ignore
    }
  }
}

export function getConnectionStatus(): ConnectionStatus {
  return status;
}

export function onVesselUpdate(callback: (update: RawVesselUpdate) => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}
