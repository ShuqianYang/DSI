import { z } from "zod";
import type { ToolDefinition } from "../../_shared/types.js";
import {
  EARTHQUAKE_DEFAULT_REGION,
  EARTHQUAKE_PRE_QUERY_DATA_PAYLOAD,
} from "./earthquakeMockData.js";
import {
  buildImageOverlayGisData,
  EARTHQUAKE_QUERY_DATA_URL,
  type EarthquakeImageResult,
  extractPreviewUrl,
  formatErrorMessage,
  localPreFallback,
  readJsonResponse,
} from "./earthquakeShared.js";

const InputSchema = z.strictObject({
  region: z.string().trim().min(1).default(EARTHQUAKE_DEFAULT_REGION),
  queryDataUrl: z.string().trim().url().default(EARTHQUAKE_QUERY_DATA_URL),
});

type EarthquakePreImageInput = z.infer<typeof InputSchema>;

export function buildEarthquakePreImageMockTool(): ToolDefinition {
  return {
    name: "EarthquakePreImageMock",
    aliases: ["earthquake-pre-image"],
    description:
      "Deterministic mock pre-earthquake imagery lookup. Calls the legacy queryData payload first and falls back to the local pre-earthquake image when no preview is returned.",
    kind: "domain",
    inputSchema: InputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    async execute(input, context) {
      const parsed = InputSchema.parse(input) as EarthquakePreImageInput;
      let image: EarthquakeImageResult = localPreFallback("queryData was not called");

      try {
        context.onProgress?.({
          stage: "queryData",
          message: "Calling legacy queryData for pre-earthquake imagery",
        });
        const response = await fetch(parsed.queryDataUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(EARTHQUAKE_PRE_QUERY_DATA_PAYLOAD),
          signal: context.signal,
        });
        if (!response.ok) {
          image = localPreFallback(`queryData HTTP ${response.status}`);
        } else {
          const body = await readJsonResponse(response);
          const previewUrl = extractPreviewUrl(body);
          image = previewUrl
            ? { imageSource: "queryData", imageUrl: previewUrl }
            : localPreFallback("queryData returned no previewUrl");
        }
      } catch (error) {
        image = localPreFallback(`queryData request failed: ${formatErrorMessage(error)}`);
      }

      return {
        summary:
          image.imageSource === "queryData"
            ? `已通过 queryData 获取 ${parsed.region} 地震前历史影像。`
            : `queryData 未返回可用影像，已使用 ${parsed.region} 地震前本地确定性影像。`,
        region: parsed.region,
        phase: "pre",
        imageCount: 1,
        imageSource: image.imageSource,
        imageUrl: image.imageUrl,
        fallbackReason: image.fallbackReason,
        gisData: buildImageOverlayGisData({
          id: "earthquake-pre-image",
          url: image.imageUrl,
          phase: "pre",
        }),
        metadata: {
          capability: "earthquake-assessment",
          responseType: "pre_earthquake",
          mock: true,
          queryDataPayload: EARTHQUAKE_PRE_QUERY_DATA_PAYLOAD,
        },
      };
    },
  };
}
