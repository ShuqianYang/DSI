import { z } from "zod";
import type { ToolDefinition } from "../../_shared/types.js";
import { FLOOD_DEFAULT_REGION } from "./floodMockData.js";
import {
  buildFloodImageOverlayGisData,
  buildLegacyFloodDemandPayload,
  FLOOD_DEMAND_CALLBACK_TIMEOUT_MS,
  FLOOD_DEMAND_URL,
  type FloodImageResult,
  extractDemandRequirementId,
  formatErrorMessage,
  localFloodPostFallback,
  readJsonResponse,
  waitForFloodCallback,
} from "./floodShared.js";

const InputSchema = z.strictObject({
  region: z.string().trim().min(1).default(FLOOD_DEFAULT_REGION),
  demandUrl: z.string().trim().url().default(FLOOD_DEMAND_URL),
  callbackTimeoutMs: z.number().int().min(0).default(FLOOD_DEMAND_CALLBACK_TIMEOUT_MS),
});

type FloodPostImageInput = z.infer<typeof InputSchema>;

export function buildFloodPostImageMockTool(): ToolDefinition {
  return {
    name: "FloodPostImageMock",
    aliases: ["flood-post-image"],
    description:
      "Deterministic mock post-flood imagery request. Submits the legacy flood demand payload, waits for callback only after successful submission, and falls back to the local post-flood image when demand is unavailable.",
    kind: "domain",
    inputSchema: InputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    async execute(input, context) {
      const parsed = InputSchema.parse(input) as FloodPostImageInput;
      const demandPayload = buildLegacyFloodDemandPayload(parsed.region);
      let image: FloodImageResult = localFloodPostFallback("demand was not called");
      let requirementId = demandPayload.requirementId;

      try {
        context.onProgress?.({
          stage: "demand",
          message: "Submitting legacy post-flood satellite demand",
        });
        const response = await fetch(parsed.demandUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(demandPayload),
          signal: context.signal,
        });
        const body = await readJsonResponse(response);
        if (!response.ok) {
          image = localFloodPostFallback(`legacy demand HTTP ${response.status}`);
        } else {
          requirementId = extractDemandRequirementId(body) ?? requirementId;
          const callback = await waitForFloodCallback(requirementId, parsed.callbackTimeoutMs);
          image = callback.url
            ? { imageSource: "callback", imageUrl: callback.url }
            : localFloodPostFallback(callback.fallbackReason ?? "legacy demand callback returned no image");
        }
      } catch (error) {
        image = localFloodPostFallback(`legacy demand request failed: ${formatErrorMessage(error)}`);
      }

      return {
        summary:
          image.imageSource === "callback"
            ? `已通过需求提报回调获取 ${parsed.region} 暴雨后应急影像。`
            : `洪水后需求提报未返回可用影像，已使用 ${parsed.region} 暴雨后本地确定性影像。`,
        region: parsed.region,
        phase: "post",
        imageCount: 1,
        imageSource: image.imageSource,
        imageUrl: image.imageUrl,
        fallbackReason: image.fallbackReason,
        requirementId,
        responseType: "post_flood",
        gisData: buildFloodImageOverlayGisData({
          id: "post-flood-imagery",
          url: image.imageUrl,
          phase: "post",
          alpha: 1,
        }),
        metadata: {
          capability: "flood-assessment",
          responseType: "post_flood",
          mock: true,
          demandPayload,
        },
      };
    },
  };
}
