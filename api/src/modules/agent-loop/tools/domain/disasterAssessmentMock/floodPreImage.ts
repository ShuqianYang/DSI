import { z } from "zod";
import type { ToolDefinition } from "../../_shared/types.js";
import {
  FLOOD_DEFAULT_REGION,
  FLOOD_PRE_QUERY_DATA_PAYLOAD,
} from "./floodMockData.js";
import {
  buildFloodImageOverlayGisData,
  extractPreviewUrl,
  FLOOD_QUERY_DATA_URL,
  type FloodImageResult,
  formatErrorMessage,
  localFloodPreFallback,
  readJsonResponse,
} from "./floodShared.js";

const InputSchema = z.strictObject({
  region: z.string().trim().min(1).default(FLOOD_DEFAULT_REGION),
  queryDataUrl: z.string().trim().url().default(FLOOD_QUERY_DATA_URL),
});

type FloodPreImageInput = z.infer<typeof InputSchema>;

export function buildFloodPreImageMockTool(): ToolDefinition {
  return {
    name: "FloodPreImageMock",
    aliases: ["flood-pre-image"],
    description:
      "Deterministic mock pre-flood imagery lookup. Calls the legacy queryData flood payload first and falls back to the local pre-flood image when no preview is returned.",
    kind: "domain",
    inputSchema: InputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    async execute(input, context) {
      const parsed = InputSchema.parse(input) as FloodPreImageInput;
      let image: FloodImageResult = localFloodPreFallback("queryData was not called");

      try {
        context.onProgress?.({
          stage: "queryData",
          message: "Calling legacy queryData for pre-flood imagery",
        });
        const response = await fetch(parsed.queryDataUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(FLOOD_PRE_QUERY_DATA_PAYLOAD),
          signal: context.signal,
        });
        if (!response.ok) {
          image = localFloodPreFallback(`queryData HTTP ${response.status}`);
        } else {
          const body = await readJsonResponse(response);
          const previewUrl = extractPreviewUrl(body);
          image = previewUrl
            ? { imageSource: "queryData", imageUrl: previewUrl }
            : localFloodPreFallback("queryData returned no previewUrl");
        }
      } catch (error) {
        image = localFloodPreFallback(`queryData request failed: ${formatErrorMessage(error)}`);
      }

      return {
        summary:
          image.imageSource === "queryData"
            ? `已通过 queryData 获取 ${parsed.region} 洪水前历史影像。`
            : `queryData 未返回可用影像，已使用 ${parsed.region} 洪水前本地确定性影像。`,
        region: parsed.region,
        phase: "pre",
        imageCount: 1,
        imageSource: image.imageSource,
        imageUrl: image.imageUrl,
        fallbackReason: image.fallbackReason,
        responseType: "pre_flood",
        gisData: buildFloodImageOverlayGisData({
          id: "pre-flood-imagery",
          url: image.imageUrl,
          phase: "pre",
        }),
        metadata: {
          capability: "flood-assessment",
          responseType: "pre_flood",
          mock: true,
          queryDataPayload: FLOOD_PRE_QUERY_DATA_PAYLOAD,
        },
      };
    },
  };
}
