import { z } from "zod";
import type { ToolDefinition } from "../../_shared/types.js";
import {
  cleanupSatelliteSliceCallback,
  registerSatelliteSliceCallback,
  type SatelliteSliceCallbackPayload,
} from "../satellite/satelliteCallbackStore.js";
import { FIRE_CENTER_LAT, FIRE_CENTER_LNG, FIRE_RECT, OVERLAY_META } from "./mockData.js";

const InputSchema = z.strictObject({
  region: z.string().trim().min(1).default("Kensai"),
  demandUrl: z.string().trim().url().default("http://192.168.0.129:5000/agent/zh/demand"),
  callbackTimeoutMs: z.number().int().min(0).default(1_800_000),
});

type FireSatelliteInput = z.infer<typeof InputSchema>;

function buildCallbackUrl(): string {
  if (process.env.SATELLITE_CALLBACK_URL) return process.env.SATELLITE_CALLBACK_URL;
  const callbackHost = process.env.CALLBACK_HOST || "localhost";
  const callbackPort = process.env.API_PORT || "3001";
  return `http://${callbackHost}:${callbackPort}/agent/callback/slice`;
}

function buildFireDemandPayload(region: string, requirementId: string) {
  const now = Date.now();
  return {
    requirementId,
    requirementName: `${region} 火情监测需求`,
    requirementSource: "天基信息服务系统",
    startTime: now,
    endTime: now + 24 * 60 * 60 * 1000,
    areaBounds: {
      type: "Point",
      coordinates: [FIRE_CENTER_LNG, FIRE_CENTER_LAT],
    },
    targetType: "火情",
    targetName: region,
    algorithm: "火情识别",
    payloadMode: "可见光",
    productType: "目标切片",
    priority: "high",
    resolution: "10",
    trackType: "低",
    timeConstraints: JSON.stringify({ latestStartTime: now }),
    duration: null,
    timeLimitRequirement: "24小时内",
    rawPayload: { mode: 2 },
    submitTime: now,
    callBackUrl: buildCallbackUrl(),
  };
}

function extractDemandRequirementId(body: unknown): string | undefined {
  const record = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
  const value = record.value && typeof record.value === "object" && !Array.isArray(record.value)
    ? (record.value as Record<string, unknown>)
    : {};
  const readString = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : undefined;
  return (
    readString(record.requirementId) ??
    readString(record.id) ??
    readString(record.value) ??
    readString(value.requirementId) ??
    readString(value.id)
  );
}

async function waitForFireCallback(
  requirementId: string,
  timeoutMs: number,
): Promise<{ url?: string; fallbackReason?: string }> {
  try {
    const callbackPromise = registerSatelliteSliceCallback(requirementId);
    const timeoutPromise = new Promise<undefined>((resolve) => {
      setTimeout(() => resolve(undefined), timeoutMs);
    });
    const callback = (await Promise.race([callbackPromise, timeoutPromise])) as
      | SatelliteSliceCallbackPayload
      | undefined;
    if (!callback) {
      return { fallbackReason: `legacy demand callback timeout after ${timeoutMs}ms` };
    }
    const url =
      typeof callback.url === "string" && callback.url.trim()
        ? callback.url.trim()
        : typeof callback.path === "string" && callback.path.trim()
          ? callback.path.trim()
          : undefined;
    return url ? { url } : { fallbackReason: "legacy demand callback returned no image url" };
  } catch (error) {
    return { fallbackReason: `legacy demand callback failed: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    cleanupSatelliteSliceCallback(requirementId);
  }
}

export function buildFireSatelliteMockTool(): ToolDefinition {
  return {
    name: "FireSatelliteMock",
    displayName: "卫星影像叠加",
    aliases: ["fire-satellite"],
    description:
      "Deterministic mock satellite overlay fetch for the Kensai fire demo. Submits a legacy fire imaging demand, waits for the /agent/callback/slice callback, and falls back to the local post-fire image if demand or callback fails.",
    kind: "domain",
    inputSchema: InputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    async execute(input, context) {
      const parsed = input as FireSatelliteInput;
      let imageUrl = OVERLAY_META.postFireImageUrl;
      let imageSource: "callback" | "local-fallback" = "local-fallback";
      let fallbackReason = "demand was not called";
      let requirementId: string | undefined;

      try {
        context.onProgress?.({
          stage: "demand",
          message: "Submitting legacy fire imaging demand and waiting for callback",
        });

        requirementId = `REQ-FIRE${Date.now()}`;
        const demandPayload = buildFireDemandPayload(parsed.region, requirementId);
        const response = await fetch(parsed.demandUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(demandPayload),
          signal: context.signal,
        });
        const body = (await response.text().then((text) => {
          try {
            return JSON.parse(text);
          } catch {
            return { raw: text };
          }
        })) as Record<string, unknown>;

        if (!response.ok) {
          fallbackReason = `legacy demand HTTP ${response.status}`;
        } else {
          const returnedRequirementId = extractDemandRequirementId(body);
          if (returnedRequirementId) {
            requirementId = returnedRequirementId;
          }
          const callback = await waitForFireCallback(requirementId, parsed.callbackTimeoutMs);
          if (callback.url) {
            imageUrl = callback.url;
            imageSource = "callback";
            fallbackReason = "";
          } else {
            fallbackReason = callback.fallbackReason ?? "legacy demand callback returned no image";
          }
        }
      } catch (error) {
        fallbackReason = `legacy demand request failed: ${error instanceof Error ? error.message : String(error)}`;
      }

      return {
        summary:
          imageSource === "callback"
            ? `已通过需求提报回调获取 ${parsed.region} 火情影像。`
            : `火情监测需求提报未返回可用影像，已使用 ${parsed.region} 本地确定性影像。`,
        region: parsed.region,
        imageCount: 1,
        imageSource,
        imageUrl,
        fallbackReason: fallbackReason || undefined,
        requirementId,
        gisData: {
          type: "image-overlay" as const,
          imageOverlays: [
            {
              id: "fire-post-image",
              url: imageUrl,
              rectangle: { ...FIRE_RECT },
              alpha: 1,
              tileWidth: 660,
              tileHeight: 590,
              outlineColor: "#FF6600",
            },
          ],
          cameraView: {
            type: "point" as const,
            lng: (FIRE_RECT.west + FIRE_RECT.east) / 2,
            lat: (FIRE_RECT.south + FIRE_RECT.north) / 2,
            altitude: 30_000,
          },
        },
        metadata: {
          capability: "satellite",
          mock: true,
          responseType: "fire_imaging",
          imageSource,
          fallback: imageSource === "local-fallback",
          requirementId,
        },
      };
    },
  };
}
