import { z } from "zod";
import type { CapabilityContract } from "./types.js";

// ============================================================
// weather.fetch — 气象数据获取
// ============================================================

const inputSchema = z.object({
  region: z.string().optional().describe("目标区域名称，如'东海油膜片区'"),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional()
    .describe("边界框 [west, south, east, north]"),
});

const outputSchema = z.object({
  message: z.string(),
  windField: z.object({
    grid: z.array(z.array(z.object({
      u: z.number(),
      v: z.number(),
      speed: z.number(),
      direction: z.string(),
    }))),
    center: z.object({ lat: z.number(), lng: z.number() }),
    spanKm: z.number(),
  }).optional(),
  currentData: z.object({
    speed: z.number(),
    direction: z.string(),
    u: z.number(),
    v: z.number(),
  }).optional(),
  gisData: z.record(z.string(), z.any()).optional(),
});

export const weatherFetchContract: CapabilityContract = {
  name: "weather.fetch",
  displayName: "气象数据获取",
  description: "获取目标区域的风场和洋流数据，支持 10×10 网格风场和单点洋流查询。",

  inputSchema,
  outputSchema,

  normalizeOutput: (raw: unknown) => {
    const data = raw as Record<string, unknown>;
    // 兼容真实 API / mock / 旧格式的差异
    return {
      message: (data.message as string) || "气象数据获取完成",
      windField: data.windField,
      currentData: data.currentData,
      gisData: data.gisData,
    };
  },

  dependencies: [
    {
      type: "prefers_tool_output",
      tool: "satellite.query",
      fields: ["oilSpill.centerLat", "oilSpill.centerLng"],
    },
  ],

  gates: [
    {
      type: "quality_warning",
      artifactKey: "windField",
      warning: "缺少风场网格数据，漂移反推置信度会降低",
    },
  ],

  llm: {
    whenToUse: "用户需要查询某区域的风速、风向、洋流等气象参数时使用。常用于油污漂移反推、海上态势分析等场景。",
    avoidWhen: "没有明确区域或 bbox 时，先让用户补充位置信息。",
    exposedFields: ["windField", "currentData"],
  },

  execution: {
    timeoutMs: 8000,
    retry: { maxAttempts: 1, backoffMs: 1000 },
    idempotent: true,
    sideEffect: "external_request",
    costLevel: "low",
  },
};
