import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanupSatelliteSliceCallback,
  registerSatelliteSliceCallback,
} from "../satellite/satelliteCallbackStore.js";
import {
  FLOOD_BOUNDS,
  FLOOD_BRIDGE_LAT,
  FLOOD_BRIDGE_LNG,
  FLOOD_CENTER_LAT,
  FLOOD_CENTER_LNG,
  FLOOD_DEFAULT_REGION,
  FLOOD_LABEL_NAME_MAP,
  FLOOD_POST_LOCAL_IMAGE_URL,
  FLOOD_PRE_LOCAL_IMAGE_URL,
  FLOOD_RECT,
  FLOOD_SEVERITY_MAP,
} from "./floodMockData.js";

export const FLOOD_QUERY_DATA_URL =
  process.env.FLOOD_QUERY_DATA_URL || "http://192.168.0.129:5000/agent/queryData";
export const FLOOD_DEMAND_URL =
  process.env.FLOOD_DEMAND_URL || "http://192.168.0.129:5000/agent/zh/demand";
export const FLOOD_DEMAND_CALLBACK_TIMEOUT_MS = Number.parseInt(
  process.env.FLOOD_DEMAND_CALLBACK_TIMEOUT_MS ?? "300000",
  10,
);

export type FloodImageSource = "queryData" | "callback" | "local-fallback";

export interface FloodImageResult {
  imageSource: FloodImageSource;
  imageUrl: string;
  fallbackReason?: string;
}

export interface FloodDamageZone {
  id: string;
  level: string;
  name: string;
  areaKm2: number;
  color: string;
  description: string;
  coordinates: [number, number][];
  labelPosition: [number, number];
}

export function buildFloodImageOverlayGisData(input: {
  id: string;
  url: string;
  phase: "pre" | "post";
  alpha?: number;
}) {
  return {
    type: "region" as const,
    regions: [
      {
        id: `${input.phase}-flood-imagery-bounds`,
        name: `${FLOOD_DEFAULT_REGION} ${input.phase === "pre" ? "洪水前" : "暴雨后"}影像覆盖范围`,
        type: "monitor",
        coordinates: FLOOD_BOUNDS,
        style: {
          fill: false,
          outlineColor: input.phase === "pre" ? "#3B82F6" : "#EF4444",
          outlineWidth: 2,
        },
        label: {
          text: input.phase === "pre" ? "洪水前影像范围" : "暴雨后影像范围",
          position: [FLOOD_CENTER_LNG, FLOOD_CENTER_LAT] as [number, number],
        },
      },
    ],
    imageOverlays: [
      {
        id: input.id,
        url: input.url,
        rectangle: { ...FLOOD_RECT },
        alpha: input.alpha ?? 0.9,
        tileWidth: 691,
        tileHeight: 502,
      },
    ],
    cameraView: buildFloodCameraView(),
  };
}

export function buildFloodCameraView() {
  return {
    type: "point" as const,
    lng: FLOOD_CENTER_LNG,
    lat: FLOOD_CENTER_LAT,
    altitude: 666,
  };
}

export function buildLegacyFloodDemandPayload(region: string, requirementId = `REQ-FL${Date.now()}`) {
  const now = Date.now();
  return {
    requirementId,
    requirementName: `${region} 暴雨洪涝灾后应急成像需求`,
    requirementSource: "天基信息服务系统",
    startTime: now,
    endTime: now + 24 * 60 * 60 * 1000,
    areaBounds: {
      type: "Point",
      coordinates: [FLOOD_CENTER_LNG, FLOOD_CENTER_LAT],
    },
    targetType: "洪水后",
    targetName: "洪水后",
    algorithm: "洪涝评估",
    payloadMode: "可见光",
    productType: "目标切片",
    priority: "high",
    resolution: "1",
    trackType: "低",
    timeConstraints: JSON.stringify({ latestStartTime: now }),
    duration: null,
    timeLimitRequirement: "24小时内",
    rawPayload: { mode: 2 },
    submitTime: now,
    callBackUrl: buildCallbackUrl(),
  };
}

export async function loadFloodDamageZones(): Promise<FloodDamageZone[]> {
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const geojsonPath = path.resolve(currentDir, "../../../../../../flood.geojson");
    const raw = JSON.parse(await readFile(geojsonPath, "utf8")) as {
      features?: Array<{
        properties?: { id?: string; label?: string; severity?: string; description?: string };
        geometry?: { coordinates?: [number, number][][] };
      }>;
    };
    return (raw.features ?? []).map((feature, index) => {
      const props = feature.properties ?? {};
      const mapped = FLOOD_SEVERITY_MAP[props.severity ?? "medium"] ?? FLOOD_SEVERITY_MAP.medium!;
      const coords = feature.geometry?.coordinates?.[0] ?? [];
      const label = props.label ?? "";
      return {
        id: props.id ?? `flood-zone-${index + 1}`,
        level: mapped.level,
        name: FLOOD_LABEL_NAME_MAP[label] ?? label,
        areaKm2: estimateAreaKm2(coords),
        color: mapped.color,
        description: props.description ?? "",
        coordinates: coords,
        labelPosition: getPolygonCenter(coords),
      };
    });
  } catch {
    return [];
  }
}

export function buildFloodAssessmentGisData(
  region: string,
  damageZones: FloodDamageZone[],
  preImageUrl = FLOOD_PRE_LOCAL_IMAGE_URL,
  postImageUrl = FLOOD_POST_LOCAL_IMAGE_URL,
) {
  return {
    type: "flood" as const,
    imageOverlays: [
      {
        id: "pre-flood-imagery",
        url: preImageUrl,
        rectangle: { ...FLOOD_RECT },
        alpha: 1,
        tileWidth: 691,
        tileHeight: 502,
        label: "暴雨前影像",
      },
      {
        id: "post-flood-imagery",
        url: postImageUrl,
        rectangle: { ...FLOOD_RECT },
        alpha: 1,
        tileWidth: 691,
        tileHeight: 502,
        label: "暴雨后影像",
      },
    ],
    regions: damageZones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      type: "damage" as const,
      coordinates: zone.coordinates,
      style: {
        fill: false,
        fillOpacity: 0,
        outlineColor: zone.color,
        outlineWidth: zone.level === "severe" ? 3 : 2,
      },
      label: {
        text: zone.name,
        position: zone.labelPosition,
      },
    })),
    entities: [
      {
        id: "zhangjiadu-bridge",
        name: "张家渡大桥",
        type: "damage",
        coordinates: [FLOOD_BRIDGE_LNG, FLOOD_BRIDGE_LAT] as [number, number],
        importance: "high",
        status: "danger",
        description: `${region}张家渡大桥因洪水冲击发生结构性坍塌`,
      },
    ],
    cameraView: buildFloodCameraView(),
  };
}

export async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export function extractPreviewUrl(body: unknown): string | undefined {
  const record = objectRecord(body);
  const value = objectRecord(record.value);
  const records = Array.isArray(value.records) ? value.records : [];
  for (const item of records) {
    const previewUrl = readString(objectRecord(item).previewUrl);
    if (previewUrl) return previewUrl;
  }
  return undefined;
}

export function extractDemandRequirementId(body: unknown): string | undefined {
  const record = objectRecord(body);
  return (
    readString(record.requirementId) ??
    readString(record.id) ??
    readString(record.value) ??
    readString(objectRecord(record.value).requirementId) ??
    readString(objectRecord(record.value).id) ??
    readString(objectRecord(record.data).requirementId) ??
    readString(objectRecord(record.data).id)
  );
}

export function extractCallbackImageUrl(body: unknown): string | undefined {
  const record = objectRecord(body);
  return readString(record.url) ?? readString(record.path);
}

export async function waitForFloodCallback(
  requirementId: string,
  timeoutMs: number,
): Promise<{ url?: string; fallbackReason?: string }> {
  const safeTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : FLOOD_DEMAND_CALLBACK_TIMEOUT_MS;
  try {
    const callbackPromise = registerSatelliteSliceCallback(requirementId);
    const timeoutPromise = new Promise<undefined>((resolve) => {
      setTimeout(() => resolve(undefined), safeTimeoutMs);
    });
    const callback = await Promise.race([callbackPromise, timeoutPromise]);
    if (!callback) {
      return { fallbackReason: `legacy demand callback timeout after ${safeTimeoutMs}ms` };
    }
    const url = extractCallbackImageUrl(callback);
    return url
      ? { url }
      : { fallbackReason: "legacy demand callback returned no image url" };
  } catch (error) {
    return { fallbackReason: `legacy demand callback failed: ${formatErrorMessage(error)}` };
  } finally {
    cleanupSatelliteSliceCallback(requirementId);
  }
}

export function localFloodPreFallback(reason: string): FloodImageResult {
  return {
    imageSource: "local-fallback",
    imageUrl: FLOOD_PRE_LOCAL_IMAGE_URL,
    fallbackReason: reason,
  };
}

export function localFloodPostFallback(reason: string): FloodImageResult {
  return {
    imageSource: "local-fallback",
    imageUrl: FLOOD_POST_LOCAL_IMAGE_URL,
    fallbackReason: reason,
  };
}

export function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildCallbackUrl(): string {
  if (process.env.SATELLITE_DEMAND_CALLBACK_URL) return process.env.SATELLITE_DEMAND_CALLBACK_URL;
  const callbackHost = process.env.CALLBACK_HOST || "localhost";
  const callbackPort = process.env.API_PORT || "3001";
  return `http://${callbackHost}:${callbackPort}/agent/callback/slice`;
}

function getPolygonCenter(coords: [number, number][]): [number, number] {
  if (coords.length === 0) return [FLOOD_CENTER_LNG, FLOOD_CENTER_LAT];
  const lngs = coords.map((coord) => coord[0]);
  const lats = coords.map((coord) => coord[1]);
  return [
    (Math.min(...lngs) + Math.max(...lngs)) / 2,
    (Math.min(...lats) + Math.max(...lats)) / 2,
  ];
}

function estimateAreaKm2(coords: [number, number][]): number {
  if (coords.length === 0) return 0;
  const lngs = coords.map((coord) => coord[0]);
  const lats = coords.map((coord) => coord[1]);
  const dLng = Math.max(...lngs) - Math.min(...lngs);
  const dLat = Math.max(...lats) - Math.min(...lats);
  const latAvg = (Math.max(...lats) + Math.min(...lats)) / 2;
  const kmPerLng = 111 * Math.cos((latAvg * Math.PI) / 180);
  return Math.round(dLng * kmPerLng * dLat * 111 * 1000) / 1000;
}
