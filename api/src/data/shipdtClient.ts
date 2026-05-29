import "dotenv/config";

// ShipDT HTTP 客户端 — GetAreaShip 接口封装 + 令牌桶限流

const API_KEY = process.env.SHIPDT_API_KEY;
const BASE_URL = "http://api.shipdt.com/DataApiServer/apicall/GetAreaShip";

// 启动时打印一次配置状态
console.log(`[ShipDT] Client initialized, API_KEY present: ${!!API_KEY}`);

// 限流器配置：最多 5 个并发，整体受 100 req/min 限制
const MAX_CONCURRENT = 5;
const MAX_PER_MINUTE = 100;
const MIN_INTERVAL_MS = (60_000 / MAX_PER_MINUTE) * MAX_CONCURRENT; // ~3000ms

let activeRequests = 0;
let lastRequestTime = 0;
const requestQueue: Array<() => void> = [];

/** 等待限流器放行 */
async function acquireSlot(): Promise<void> {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      const now = Date.now();
      const timeSinceLast = now - lastRequestTime;

      if (activeRequests < MAX_CONCURRENT && timeSinceLast >= MIN_INTERVAL_MS) {
        activeRequests++;
        lastRequestTime = now;
        resolve();
      } else {
        // 排队等待（由 processQueue 统一执行 activeRequests++）
        requestQueue.push(() => {
          resolve();
        });
        // 设置定时重试
        const delay = Math.max(MIN_INTERVAL_MS - timeSinceLast, 100);
        setTimeout(processQueue, delay);
      }
    };
    tryAcquire();
  });
}

function releaseSlot() {
  activeRequests = Math.max(0, activeRequests - 1);
  setTimeout(processQueue, 0);
}

function processQueue() {
  if (requestQueue.length === 0) return;
  const now = Date.now();
  const timeSinceLast = now - lastRequestTime;
  if (activeRequests < MAX_CONCURRENT && timeSinceLast >= MIN_INTERVAL_MS) {
    const next = requestQueue.shift();
    if (next) {
      activeRequests++;
      lastRequestTime = now;
      next();
    }
    // 继续尝试处理下一个（如果条件允许）
    if (requestQueue.length > 0) {
      processQueue();
    }
  } else if (requestQueue.length > 0) {
    // 条件不满足，安排重试
    const delay = Math.max(MIN_INTERVAL_MS - timeSinceLast, 50);
    setTimeout(processQueue, delay);
  }
}

// ==================== ShipDT 响应类型 ====================

export interface ShipDTAreaShip {
  ShipID: number;
  mmsi: number;
  imo: number;
  nationality?: string;
  name?: string;
  ais_name?: string;
  callsign?: string;
  shiptype?: number;
  length?: number;
  width?: number;
  left?: number;
  trail?: number;
  draught?: number;
  dest?: string;
  dest_std?: string;
  destcode?: string;
  eta?: string;
  eta_std?: string;
  navistat?: number;
  lon: number;
  lat: number;
  hdg?: number;
  cog?: number;
  sog?: number;
  rot?: number;
  lasttime?: number;
  shipStatus?: number | null;
  classType?: string | null;
  shipTypeName?: string | null;
  shipStatusName?: string | null;
}

export interface ShipDTAreaResult {
  status: number;
  shipcount?: number;
  data?: ShipDTAreaShip[];
}

export interface ShipDTTileResult {
  ships: ShipDTAreaShip[] | null;
  count: number;
  isDense: boolean;
}

// ==================== 客户端 ====================

export async function queryAreaShip(params: {
  minlon: number;
  maxlon: number;
  minlat: number;
  maxlat: number;
}): Promise<ShipDTTileResult> {
  if (!API_KEY) {
    throw new Error("SHIPDT_API_KEY not configured");
  }

  const slotWaitStart = Date.now();
  await acquireSlot();
  const slotWaitMs = Date.now() - slotWaitStart;

  try {
    const url = new URL(BASE_URL);
    url.searchParams.append("k", API_KEY);
    url.searchParams.append("minlon", String(params.minlon));
    url.searchParams.append("maxlon", String(params.maxlon));
    url.searchParams.append("minlat", String(params.minlat));
    url.searchParams.append("maxlat", String(params.maxlat));

    console.log(`[ShipDT] Request URL: ${url.toString()} | queue=${requestQueue.length} active=${activeRequests} slotWait=${slotWaitMs}ms`);

    // 双层超时：fetch 自身 15s + Promise.race 兜底 20s，防止 fetch 卡死导致 slot 不释放
    const fetchPromise = fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
    const hardTimeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("ShipDT fetch hard timeout")), 20_000)
    );
    const res = await Promise.race([fetchPromise, hardTimeoutPromise]);

    console.log(`[ShipDT] Response status: ${res.status}`);

    if (!res.ok) {
      if (res.status === 429) {
        // 被限流，增加间隔并重试一次
        lastRequestTime += 5000;
        return queryAreaShip(params);
      }
      throw new Error(`ShipDT API error: ${res.status} ${res.statusText}`);
    }

    const raw = (await res.json()) as Record<string, unknown>;
    const reqMs = Date.now() - slotWaitStart;
    console.log(`[ShipDT] Response body keys:`, Object.keys(raw), `| elapsed=${reqMs}ms`);

    // 防御性解析
    const status = typeof raw.status === "number" ? raw.status : 0;
    const shipcount =
      typeof raw.shipcount === "number"
        ? raw.shipcount
        : typeof raw.count === "number"
          ? raw.count
          : 0;
    const data = Array.isArray(raw.data) ? (raw.data as ShipDTAreaShip[]) : undefined;

    if (status !== 0) {
      console.warn(`[ShipDT] API error status=${status}, full body:`, JSON.stringify(raw).slice(0, 500));
      // status=29 表示该区域内无数据，按空结果返回，不抛错也不重试
      if (status === 29) {
        return {
          ships: null,
          count: 0,
          isDense: false,
        };
      }
      throw new Error(`ShipDT API returned status=${status}`);
    }

    // >2800 艘不返回 data，只返回 shipcount
    if (data == null || data.length === 0) {
      return {
        ships: null,
        count: shipcount,
        isDense: shipcount > 0,
      };
    }

    // 防御性清洗：过滤无效坐标（ShipDT 返回的是 micro-degree，范围 ×1,000,000）
    const validShips = data.filter((s) => {
      const lat = s.lat;
      const lon = s.lon;
      return (
        lat != null &&
        lon != null &&
        lat !== 0 &&
        lon !== 0 &&
        lat >= -90_000_000 &&
        lat <= 90_000_000 &&
        lon >= -180_000_000 &&
        lon <= 180_000_000
      );
    });

    return {
      ships: validShips,
      count: validShips.length,
      isDense: false,
    };
  } finally {
    releaseSlot();
  }
}

/** 获取当前限流器状态（用于监控） */
export function getRateLimitStatus(): {
  activeRequests: number;
  queuedRequests: number;
} {
  return {
    activeRequests,
    queuedRequests: requestQueue.length,
  };
}
