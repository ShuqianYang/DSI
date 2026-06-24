import {
  cleanupSatelliteSliceCallback,
  registerSatelliteSliceCallback,
} from "../satellite/satelliteCallbackStore.js";
import {
  EARTHQUAKE_ASSESSMENT,
  EARTHQUAKE_BOUNDS,
  EARTHQUAKE_CENTER_LAT,
  EARTHQUAKE_CENTER_LNG,
  EARTHQUAKE_DEFAULT_REGION,
  EARTHQUAKE_MAGNITUDE,
  EARTHQUAKE_POST_LOCAL_IMAGE_URL,
  EARTHQUAKE_PRE_LOCAL_IMAGE_URL,
  EARTHQUAKE_RECT,
} from "./earthquakeMockData.js";

export const EARTHQUAKE_QUERY_DATA_URL =
  process.env.EARTHQUAKE_QUERY_DATA_URL || "http://192.168.0.129:5000/agent/queryData";
export const EARTHQUAKE_DEMAND_URL =
  process.env.EARTHQUAKE_DEMAND_URL || "http://192.168.0.129:5000/agent/zh/demand";
export const EARTHQUAKE_DEMAND_CALLBACK_TIMEOUT_MS = Number.parseInt(
  process.env.EARTHQUAKE_DEMAND_CALLBACK_TIMEOUT_MS ?? "300000",
  10,
);

export type EarthquakeImageSource = "queryData" | "callback" | "local-fallback";

export interface EarthquakeImageResult {
  imageSource: EarthquakeImageSource;
  imageUrl: string;
  fallbackReason?: string;
}

export function buildImageOverlayGisData(input: {
  id: string;
  url: string;
  phase: "pre" | "post";
  alpha?: number;
}) {
  return {
    type: "image-overlay" as const,
    regions: [
      {
        id: `earthquake-${input.phase}-extent`,
        name: `${EARTHQUAKE_DEFAULT_REGION}地震${input.phase === "pre" ? "前" : "后"}影像范围`,
        type: "earthquake-imagery",
        coordinates: EARTHQUAKE_BOUNDS,
      },
    ],
    imageOverlays: [
      {
        id: input.id,
        url: input.url,
        rectangle: { ...EARTHQUAKE_RECT },
        alpha: input.alpha ?? 0.9,
        tileWidth: 691,
        tileHeight: 502,
        outlineColor: input.phase === "pre" ? "#00E0FF" : "#FFAA00",
      },
    ],
    cameraView: buildEarthquakeCameraView(),
  };
}

export function buildEarthquakeCameraView() {
  return {
    type: "point" as const,
    lng: EARTHQUAKE_CENTER_LNG,
    lat: EARTHQUAKE_CENTER_LAT,
    altitude: 378,
  };
}

export function buildEarthquakeAssessmentGisData(region: string) {
  return {
    type: "entity" as const,
    imageOverlays: [
      {
        id: "earthquake-pre-image",
        url: EARTHQUAKE_PRE_LOCAL_IMAGE_URL,
        rectangle: { ...EARTHQUAKE_RECT },
        alpha: 1,
        tileWidth: 691,
        tileHeight: 502,
        outlineColor: "#00E0FF",
        label: "Pre-earthquake image",
      },
      {
        id: "earthquake-post-image",
        url: EARTHQUAKE_POST_LOCAL_IMAGE_URL,
        rectangle: { ...EARTHQUAKE_RECT },
        alpha: 1,
        tileWidth: 691,
        tileHeight: 502,
        outlineColor: "#FFAA00",
        label: "Post-earthquake image",
      },
    ],
    entities: [
      {
        id: "earthquake-epicenter-001",
        name: `${region} ${EARTHQUAKE_MAGNITUDE}级地震震中`,
        type: "earthquake",
        coordinates: [EARTHQUAKE_CENTER_LNG, EARTHQUAKE_CENTER_LAT] as [number, number],
        importance: "high",
        status: "warning",
        description: `确定性演示震中 | 震级: ${EARTHQUAKE_MAGNITUDE} | 风险等级: ${EARTHQUAKE_ASSESSMENT.riskLevel}`,
      },
    ],
    regions: [
      {
        id: "earthquake-assessment-zone",
        name: `${region}震后重点核查区`,
        type: "earthquake-assessment",
        coordinates: EARTHQUAKE_BOUNDS,
      },
    ],
    cameraView: buildEarthquakeCameraView(),
  };
}

export function buildLegacyEarthquakeDemandPayload(region: string, requirementId = `REQ-EQ${Date.now()}`) {
  const now = Date.now();
  return {
    requirementId,
    requirementName: `${region} ${EARTHQUAKE_MAGNITUDE}级地震震后应急成像需求`,
    requirementSource: "天基信息服务系统",
    startTime: now,
    endTime: now + 24 * 60 * 60 * 1000,
    areaBounds: {
      type: "Point",
      coordinates: [EARTHQUAKE_CENTER_LNG, EARTHQUAKE_CENTER_LAT],
    },
    targetType: "地震后",
    targetName: "地震后",
    algorithm: "灾后评估",
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
    callBackUrl: process.env.SATELLITE_CALLBACK_URL || "/agent/callback/slice",
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

export async function waitForSatelliteCallback(
  requirementId: string,
  timeoutMs: number,
): Promise<{ url?: string; fallbackReason?: string }> {
  const safeTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : EARTHQUAKE_DEMAND_CALLBACK_TIMEOUT_MS;
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

export function localPreFallback(reason: string): EarthquakeImageResult {
  return {
    imageSource: "local-fallback" as const,
    imageUrl: EARTHQUAKE_PRE_LOCAL_IMAGE_URL,
    fallbackReason: reason,
  };
}

export function localPostFallback(reason: string): EarthquakeImageResult {
  return {
    imageSource: "local-fallback" as const,
    imageUrl: EARTHQUAKE_POST_LOCAL_IMAGE_URL,
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
