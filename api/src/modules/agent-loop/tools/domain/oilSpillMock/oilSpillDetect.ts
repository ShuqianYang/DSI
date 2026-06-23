import { z } from "zod";
import type { ToolDefinition, ToolExecutionContext } from "../../_shared/types.js";
import { OIL_FILM_CENTER, OIL_FILM_OUTLINE, OIL_SPILL_BOUNDS } from "./mockData.js";

const DEFAULT_QUERY_DATA_URL = "http://192.168.0.129:5000/agent/queryData";
const REQUEST_TIMEOUT_MS = 5_000;

const InputSchema = z.strictObject({
  region: z.string().trim().min(1).default("中国东海"),
  queryDataUrl: z.string().url().default(DEFAULT_QUERY_DATA_URL),
});

type OilSpillDetectInput = z.infer<typeof InputSchema>;

interface QueryDataResponse {
  state?: boolean;
  value?: {
    records?: Array<{
      previewUrl?: string;
    }>;
  };
}

function isEastChinaSea(region: string): boolean {
  return ["东海", "中国东海", "East China Sea", "Eastern China Sea"].includes(region.trim());
}

async function fetchOilSpillImageUrl(
  input: OilSpillDetectInput,
  context: ToolExecutionContext,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("queryData_timeout"), REQUEST_TIMEOUT_MS);
  const abortFromParent = () => controller.abort(context.signal?.reason ?? "aborted");
  if (context.signal?.aborted) abortFromParent();
  context.signal?.addEventListener("abort", abortFromParent, { once: true });

  try {
    const response = await fetch(input.queryDataUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        pageNo: 1,
        pageSize: 10,
        satelliteName: "高分五号A星",
        payloadType: ["红外"],
        productType: "目标切片",
        dataType: "漏油",
        targetType: "漏油",
        targetName: input.region,
        reqObj: "天元认知计算",
        reqContent: `接收到天元认知计算系统的历史影像查询(油膜)需求，区域=${input.region}，完成影像检索并反馈`,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const json = (await response.json()) as QueryDataResponse;
    if (!json.state) return null;
    return json.value?.records?.find((record) => record.previewUrl)?.previewUrl ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    context.signal?.removeEventListener("abort", abortFromParent);
  }
}

function buildOilSpillDetectionOutput(
  input: OilSpillDetectInput,
  imageUrl: string,
  imageSource: "queryData" | "local-fallback",
) {
  return {
    summary: `天基遥感影像AI识别完成。在 ${input.region} 区域发现疑似油膜区域。`,
    region: input.region,
    shouldContinue: true,
    imageSource,
    imageCount: 32,
    resolution: "0.8-1m",
    cloudCover: "<8%",
    satelliteType: "SAR",
    oilSpill: {
      areaKm2: 0.3,
      centerLng: OIL_FILM_CENTER.lng,
      centerLat: OIL_FILM_CENTER.lat,
      outline: OIL_FILM_OUTLINE,
    },
    gisData: {
      type: "region" as const,
      regions: [
        {
          id: "oil-spill-area",
          name: "疑似油膜区域",
          type: "monitor" as const,
          coordinates: OIL_FILM_OUTLINE,
          style: { fill: false, outlineColor: "#FFAA00", outlineWidth: 2 },
          label: {
            text: "疑似油膜区域\n面积: 0.3km²",
            position: [OIL_FILM_CENTER.lng, OIL_FILM_CENTER.lat] as [number, number],
          },
        },
        {
          id: "sar-image-bounds",
          name: "SAR影像范围",
          type: "monitor" as const,
          coordinates: [
            [OIL_SPILL_BOUNDS.west, OIL_SPILL_BOUNDS.south],
            [OIL_SPILL_BOUNDS.east, OIL_SPILL_BOUNDS.south],
            [OIL_SPILL_BOUNDS.east, OIL_SPILL_BOUNDS.north],
            [OIL_SPILL_BOUNDS.west, OIL_SPILL_BOUNDS.north],
            [OIL_SPILL_BOUNDS.west, OIL_SPILL_BOUNDS.south],
          ] as [number, number][],
          style: { fill: false, outlineColor: "#FF0000", outlineWidth: 4 },
          label: {
            text: "SAR影像范围",
            position: [OIL_SPILL_BOUNDS.east, OIL_SPILL_BOUNDS.north] as [number, number],
          },
        },
      ],
      imageOverlays: [
        {
          id: "oil-spill-sar-1",
          url: imageUrl,
          rectangle: OIL_SPILL_BOUNDS,
          alpha: 0.85,
          tileWidth: 1402,
          tileHeight: 1122,
        },
      ],
      cameraView: { type: "point" as const, lng: 123.014109, lat: 30.258168, altitude: 11967 },
    },
    metadata: {
      capability: "satellite",
      mock: true,
      responseType: "oil_spill_detection",
      imageSource,
    },
  };
}

export function buildOilSpillDetectMockTool(): ToolDefinition {
  return {
    name: "OilSpillDetectMock",
    aliases: ["satellite"],
    description:
      "Oil-spill detector for the mock replay. It calls the old queryData oil-spill lookup first; East China Sea may fall back to a local demo SAR image, other regions stop when queryData has no valid result.",
    kind: "domain",
    inputSchema: InputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    async execute(input, context) {
      const parsed = input as OilSpillDetectInput;
      const queryDataImageUrl = await fetchOilSpillImageUrl(parsed, context);
      if (queryDataImageUrl) {
        return buildOilSpillDetectionOutput(parsed, queryDataImageUrl, "queryData");
      }
      if (isEastChinaSea(parsed.region)) {
        return buildOilSpillDetectionOutput(parsed, "/satellite/oil-spill-1.png", "local-fallback");
      }
      return {
        summary: `${parsed.region} 未从 queryData 获取到有效漏油/油膜影像，停止油污溯源流程。`,
        region: parsed.region,
        shouldContinue: false,
        reason: "queryData_no_valid_oil_spill_result",
        metadata: {
          capability: "satellite",
          mock: true,
          responseType: "oil_spill_detection_empty",
          imageSource: "queryData",
        },
      };
    },
  };
}
