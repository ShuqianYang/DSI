import { z } from "zod";
import type { CapabilityContract } from "./types.js";

// ============================================================
// web.fetch — 网页内容抓取
// ============================================================

const inputSchema = z.object({
  url: z.string().describe("目标网页 URL，必须包含 http:// 或 https://"),
  maxLength: z.number().optional().default(3000).describe("返回内容最大字符数"),
});

const outputSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  content: z.string(),
  status: z.number(),
  contentType: z.string().optional(),
});

export const webFetchContract: CapabilityContract = {
  name: "web.fetch",
  displayName: "网页内容抓取",
  description: "抓取指定 URL 的网页内容，提取标题和正文文本。支持 HTML 页面和纯文本内容。",

  inputSchema,
  outputSchema,

  llm: {
    whenToUse: "用户提供了具体 URL，需要抓取网页内容进行分析、总结或验证时使用。",
    avoidWhen: "用户没有提供 URL，或只需要搜索新闻信息时（应使用 news.search）。",
    examples: [
      {
        user: "帮我看看 https://example.com/article 说了什么",
        toolInput: { url: "https://example.com/article", maxLength: 3000 },
      },
    ],
  },

  execution: {
    timeoutMs: 10000,
    retry: { maxAttempts: 1 },
    idempotent: true,
    sideEffect: "external_request",
    costLevel: "low",
  },
};
