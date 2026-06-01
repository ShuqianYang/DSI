import { z } from "zod";
import type { CapabilityContract } from "./types.js";

// ============================================================
// finalizer.template_summary — Template 总结生成器（System Tool）
// ============================================================

const inputSchema = z.object({
  sourceTool: z.string().describe("数据来源工具名，如 news.search"),
  query: z.string().describe("用户原始查询"),
  items: z.array(z.record(z.string(), z.any())).optional().describe("数据项列表"),
  missingData: z.array(z.string()).optional().describe("缺失数据列表"),
});

const outputSchema = z.object({
  summary: z.string().describe("综合摘要"),
  keyFindings: z.array(z.string()).describe("关键发现列表"),
  missingData: z.array(z.string()).describe("仍然缺失的数据"),
  suggestedNextAction: z.enum(["final_answer", "need_more_info", "continue_search"]).describe("建议的下一步动作"),
});

export const finalizerTemplateSummaryContract: CapabilityContract = {
  name: "finalizer.template_summary",
  displayName: "模板总结生成器",
  description: "基于前序步骤的 observations 和 artifacts，生成结构化总结。不调用外部 LLM，使用规则模板。",

  inputSchema,
  outputSchema,

  llm: {
    whenToUse: "Template 执行的最后一步，用于汇总前面所有步骤的结果。",
    avoidWhen: "不需要汇总结果的场景。",
  },

  execution: {
    timeoutMs: 3000,
    retry: { maxAttempts: 1, backoffMs: 500 },
    idempotent: true,
    sideEffect: "none",
    costLevel: "low",
  },
};
