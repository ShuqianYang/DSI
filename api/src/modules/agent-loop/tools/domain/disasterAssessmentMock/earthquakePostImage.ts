import { z } from "zod";
import type { ToolDefinition } from "../../_shared/types.js";
import { EARTHQUAKE_DEFAULT_REGION } from "./earthquakeMockData.js";
import {
  buildImageOverlayGisData,
  buildLegacyEarthquakeDemandPayload,
  EARTHQUAKE_DEMAND_CALLBACK_TIMEOUT_MS,
  EARTHQUAKE_DEMAND_URL,
  type EarthquakeImageResult,
  extractDemandRequirementId,
  formatErrorMessage,
  localPostFallback,
  readJsonResponse,
  waitForSatelliteCallback,
} from "./earthquakeShared.js";

const InputSchema = z.strictObject({
  region: z.string().trim().min(1).default(EARTHQUAKE_DEFAULT_REGION),
  demandUrl: z.string().trim().url().default(EARTHQUAKE_DEMAND_URL),
  callbackTimeoutMs: z.number().int().min(0).default(EARTHQUAKE_DEMAND_CALLBACK_TIMEOUT_MS),
});

type EarthquakePostImageInput = z.infer<typeof InputSchema>;

export function buildEarthquakePostImageMockTool(): ToolDefinition {
  return {
    name: "EarthquakePostImageMock",
    aliases: ["earthquake-post-image"],
    description:
      "Deterministic mock post-earthquake imagery request. Submits the legacy demand payload, waits for callback only after successful submission, and falls back to the local post-earthquake image when demand is unavailable.",
    kind: "domain",
    inputSchema: InputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    async execute(input, context) {
      const parsed = InputSchema.parse(input) as EarthquakePostImageInput;
      const demandPayload = buildLegacyEarthquakeDemandPayload(parsed.region);
      let image: EarthquakeImageResult = localPostFallback("demand was not called");
      let requirementId: string | undefined;

      try {
        context.onProgress?.({
          stage: "demand",
          message: "Submitting legacy post-earthquake satellite demand",
        });
        const response = await fetch(parsed.demandUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(demandPayload),
          signal: context.signal,
        });
        const body = await readJsonResponse(response);
        if (!response.ok) {
          image = localPostFallback(`legacy demand HTTP ${response.status}`);
        } else {
          requirementId = extractDemandRequirementId(body);
          if (!requirementId) {
            image = localPostFallback("legacy demand returned no requirementId/value");
          } else {
            const callback = await waitForSatelliteCallback(requirementId, parsed.callbackTimeoutMs);
            image = callback.url
              ? { imageSource: "callback", imageUrl: callback.url }
              : localPostFallback(callback.fallbackReason ?? "legacy demand callback returned no image");
          }
        }
      } catch (error) {
        image = localPostFallback(`legacy demand request failed: ${formatErrorMessage(error)}`);
      }

      return {
        summary:
          image.imageSource === "callback"
            ? `已通过需求提报回调获取 ${parsed.region} 地震后应急影像。`
            : `震后需求提报未返回可用影像，已使用 ${parsed.region} 地震后本地确定性影像。`,
        region: parsed.region,
        phase: "post",
        imageCount: 1,
        imageSource: image.imageSource,
        imageUrl: image.imageUrl,
        fallbackReason: image.fallbackReason,
        requirementId,
        gisData: buildImageOverlayGisData({
          id: "earthquake-post-image",
          url: image.imageUrl,
          phase: "post",
          alpha: 1,
        }),
        metadata: {
          capability: "earthquake-assessment",
          responseType: "post_earthquake",
          mock: true,
          demandPayload,
        },
      };
    },
  };
}
