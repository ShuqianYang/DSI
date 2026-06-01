import { z } from "zod";
import type { CapabilityContract } from "./types.js";

// ============================================================
// news.search — 新闻/舆情搜索
// ============================================================

const inputSchema = z.object({
  query: z.string().describe("搜索关键词"),
  region: z.string().optional().describe("限定区域，如'日本'、'东海'"),
  timeRange: z.string().optional().default("7d").describe("时间范围：1d / 7d / 30d"),
  count: z.number().optional().default(10).describe("返回条数"),
});

const outputSchema = z.object({
  summary: z.object({
    overview: z.string(),
    totalFound: z.number(),
    totalReturned: z.number(),
  }),
  articles: z.array(z.object({
    title: z.string(),
    source: z.string(),
    url: z.string().optional(),
    summary: z.string(),
    publishedAt: z.string(),
    relevanceScore: z.number().optional(),
  })),
  trends: z.array(z.object({
    topic: z.string(),
    sentiment: z.string(),
    articleCount: z.number(),
  })).optional(),
  gisData: z.record(z.string(), z.any()).optional(),
});

export const newsSearchContract: CapabilityContract = {
  name: "news.search",
  displayName: "新闻/舆情搜索",
  description: "通过火山引擎搜索 API 获取新闻资讯，支持关键词、区域、时间范围筛选。",

  inputSchema,
  outputSchema,

  normalizeOutput: (raw: unknown) => {
    const data = raw as Record<string, unknown>;
    // 兼容火山 API / mock / Dify 分析结果的差异
    const articles = (data.articles as unknown[]) || [];
    return {
      summary: {
        overview: (data.summary as Record<string, unknown>)?.overview as string || "新闻搜索完成",
        totalFound: (data.summary as Record<string, unknown>)?.totalFound as number || articles.length,
        totalReturned: (data.summary as Record<string, unknown>)?.totalReturned as number || articles.length,
      },
      articles: articles.map((a: unknown) => {
        const article = a as Record<string, unknown>;
        return {
          title: article.title as string || "",
          source: article.source as string || article.SiteName as string || "",
          url: article.url as string || article.Url as string || "",
          summary: article.summary as string || article.Snippet as string || "",
          publishedAt: article.publishedAt as string || article.PublishTime as string || "",
          relevanceScore: article.relevanceScore as number || article.RankScore as number || 0,
        };
      }),
      trends: data.trends as unknown[] || [],
      gisData: data.gisData,
    };
  },

  dependencies: [],

  gates: [
    {
      type: "quality_warning",
      artifactKey: "articles",
      warning: "未返回有效新闻，可能关键词太窄或数据源受限",
    },
  ],

  llm: {
    whenToUse: "用户需要查询新闻、舆情、最新动态时使用。适合作为信息收集的第一步。",
    avoidWhen: "用户问题明显不需要新闻数据时（如纯技术配置、纯数学计算）。",
    examples: [
      {
        user: "最近日本有没有灾害事件",
        toolInput: { query: "日本 灾害 暴雨 地震", region: "日本", timeRange: "7d" },
      },
    ],
    exposedFields: ["articles", "trends", "summary"],
  },

  execution: {
    timeoutMs: 15000,
    retry: { maxAttempts: 1, backoffMs: 2000 },
    idempotent: true,
    sideEffect: "external_request",
    costLevel: "low",
  },
};
