import type {
  AgentDecision,
  CapabilityContract,
  Observation,
} from "../actions/contracts/types.js";
import { callDeepSeek } from "./llmClient.js";
import { buildAgentMessages } from "./agentPrompt.js";

// ============================================================
// Agent 决策 — DeepSeek LLM 驱动
// ============================================================

export interface AgentDecisionContext {
  query: string;
  observations: Observation[];
  candidates: CapabilityContract[];
  allContracts: Map<string, CapabilityContract>;
}

/**
 * 基于 DeepSeek LLM 的 Agent 决策。
 *
 * 流程：
 * 1. 构建 system + user prompt（含 query、observations、候选工具）
 * 2. 调用 DeepSeek API（JSON 模式）
 * 3. 解析返回的 JSON 为 AgentDecision
 * 4. 校验决策合法性（tool 是否在候选中、params 是否合规）
 * 5. 异常时 fallback 到 safe final_answer
 */
export async function makeAgentDecision(
  query: string,
  observations: Observation[],
  candidates: CapabilityContract[],
  allContracts?: Map<string, CapabilityContract>
): Promise<AgentDecision> {
  // 1. 复杂查询快速拦截（不经过 LLM，节省 token）
  const complexCheck = checkComplexQuery(query, observations);
  if (complexCheck) return complexCheck;

  // 2. 没有 LLM key 时 fallback 到规则决策
  if (!process.env.DEEPSEEK_API_KEY) {
    console.warn("[AgentDecision] DEEPSEEK_API_KEY not set, using rule-based fallback");
    return ruleBasedDecision(query, observations, candidates);
  }

  // 3. 调用 LLM
  try {
    const messages = buildAgentMessages(
      query,
      observations,
      candidates,
      allContracts ?? new Map()
    );

    console.log(
      `[AgentDecision] Calling DeepSeek with ${observations.length} observations, ${candidates.length} candidates`
    );

    const llmResponse = await callDeepSeek(messages, {
      temperature: 0.3,
      maxTokens: 2048,
    });

    console.log(
      `[AgentDecision] DeepSeek response (${llmResponse.usage?.total_tokens ?? "?"} tokens)`
    );

    // 4. 解析 JSON 决策
    const decision = parseLLMDecision(llmResponse.content);

    // 5. 校验决策合法性
    const validated = validateDecision(decision, candidates, observations);

    console.log(`[AgentDecision] Decision: ${validated.decision}, reason: ${validated.reason.slice(0, 80)}`);

    return validated;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[AgentDecision] LLM call failed: ${errorMsg}`);

    // LLM 失败时 fallback 到规则决策
    return ruleBasedDecision(query, observations, candidates);
  }
}

// ============================================================
// 复杂查询拦截（节省 LLM token）
// ============================================================

function checkComplexQuery(
  query: string,
  observations: Observation[]
): AgentDecision | null {
  if (observations.length > 0) return null; // 只拦截第一步

  const lowerQuery = query.toLowerCase();
  const complexKeywords = [
    "东海海域态势",
    "综合态势",
    "多源研判",
    "船舶异常",
    "油污溯源",
    "火情研判",
    "洪涝评估",
    "地震评估",
    "卫星影像",
    "ais追踪",
  ];

  const matched = complexKeywords.find((kw) => lowerQuery.includes(kw));
  if (matched) {
    return {
      decision: "legacy_fallback",
      reason: `用户请求涉及复杂场景分析（${matched}），当前 Agent Loop 工具集不足以处理，回退旧 pipeline`,
    };
  }

  return null;
}

// ============================================================
// 解析 LLM 返回的 JSON
// ============================================================

function parseLLMDecision(rawContent: string): Record<string, unknown> {
  // 清理可能的 markdown 代码块
  let content = rawContent.trim();
  if (content.startsWith("```json")) {
    content = content.replace(/```json\s*/, "").replace(/\s*```$/, "");
  } else if (content.startsWith("```")) {
    content = content.replace(/```\s*/, "").replace(/\s*```$/, "");
  }

  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    console.error("[AgentDecision] Failed to parse LLM response:", rawContent.slice(0, 500));
    return { decision: "final_answer", reason: "LLM 返回格式错误", finalText: "抱歉，我暂时无法处理这个请求。" };
  }
}

// ============================================================
// 校验决策合法性
// ============================================================

function validateDecision(
  raw: Record<string, unknown>,
  candidates: CapabilityContract[],
  observations: Observation[]
): AgentDecision {
  const decisionType = raw.decision as string;

  // tool_call 校验
  if (decisionType === "tool_call") {
    const toolName = raw.tool as string;
    const params = (raw.params as Record<string, unknown>) || {};

    // 检查工具是否在候选中
    const isValidTool = candidates.some((c) => c.name === toolName);
    if (!isValidTool) {
      console.warn(`[AgentDecision] LLM chose invalid tool: ${toolName}, candidates: ${candidates.map(c => c.name).join(", ")}`);
      return {
        decision: "final_answer",
        reason: `LLM 选择了不在候选列表中的工具 ${toolName}，改为直接回答`,
        finalText: "基于当前信息，我无法进一步处理。",
      };
    }

    // 检查是否重复调用
    const isDuplicate = observations.some(
      (o) => o.toolName === toolName && JSON.stringify(o.params) === JSON.stringify(params)
    );
    if (isDuplicate) {
      return {
        decision: "final_answer",
        reason: "LLM 尝试重复调用同一工具，改为直接回答",
        finalText: "已获取足够信息，无需重复查询。",
      };
    }

    return {
      decision: "tool_call",
      reason: (raw.reason as string) || "LLM 决策调用工具",
      tool: toolName,
      params,
    };
  }

  // final_answer 校验
  if (decisionType === "final_answer") {
    return {
      decision: "final_answer",
      reason: (raw.reason as string) || "LLM 判断可直接回答",
      finalText: (raw.finalText as string) || "处理完成。",
    };
  }

  // legacy_fallback 校验
  if (decisionType === "legacy_fallback") {
    return {
      decision: "legacy_fallback",
      reason: (raw.reason as string) || "LLM 判断需要回退旧 pipeline",
    };
  }

  // 未知决策类型
  console.warn(`[AgentDecision] Unknown decision type: ${decisionType}`);
  return {
    decision: "final_answer",
    reason: `LLM 返回了未知的决策类型: ${decisionType}，改为直接回答`,
    finalText: "抱歉，我暂时无法处理这个请求。",
  };
}

// ============================================================
// 规则决策 Fallback（LLM 不可用时）
// ============================================================

function ruleBasedDecision(
  query: string,
  observations: Observation[],
  _candidates: CapabilityContract[]
): AgentDecision {
  const lastObservation = observations[observations.length - 1];

  // Step 1: 没有任何 observation
  if (observations.length === 0) {
    const lowerQuery = query.toLowerCase();

    if (
      lowerQuery.includes("新闻") ||
      lowerQuery.includes("灾害") ||
      lowerQuery.includes("事件") ||
      lowerQuery.includes("报道") ||
      lowerQuery.includes("动态")
    ) {
      return {
        decision: "tool_call",
        reason: "用户查询新闻/灾害/事件相关信息（规则 fallback）",
        tool: "news.search",
        params: { query: extractKeywords(query), timeRange: "7d" },
      };
    }

    if (
      lowerQuery.includes("天气") ||
      lowerQuery.includes("气象") ||
      lowerQuery.includes("风") ||
      lowerQuery.includes("雨")
    ) {
      return {
        decision: "tool_call",
        reason: "用户查询天气/气象信息（规则 fallback）",
        tool: "weather.fetch",
        params: { region: extractRegion(query) || "北京" },
      };
    }

    return {
      decision: "tool_call",
      reason: "默认信息收集策略：先搜索公开新闻（规则 fallback）",
      tool: "news.search",
      params: { query: extractKeywords(query), timeRange: "7d" },
    };
  }

  // Step 2+: 已有 observation，尝试综合回答
  const newsObs = observations.find((o) => o.toolName === "news.search");
  const weatherObs = observations.find((o) => o.toolName === "weather.fetch");

  if (newsObs && weatherObs) {
    return {
      decision: "final_answer",
      reason: "已获取新闻和天气信息，综合回答（规则 fallback）",
      finalText: buildFallbackAnswer(newsObs, weatherObs, query),
    };
  }

  if (lastObservation?.toolName === "news.search") {
    const result = lastObservation.result as Record<string, unknown> | null;
    const articles = (result?.articles as unknown[]) || [];
    const hasDisaster = articles.some((a: unknown) => {
      const article = a as Record<string, unknown>;
      const text = `${article.title || ""} ${article.summary || ""}`.toLowerCase();
      return /(暴雨|地震|台风|洪水|灾害)/.test(text);
    });

    if (hasDisaster && !weatherObs) {
      return {
        decision: "tool_call",
        reason: "新闻发现灾害报道，补充天气实况数据（规则 fallback）",
        tool: "weather.fetch",
        params: { region: extractRegion(query) || "日本" },
      };
    }

    return {
      decision: "final_answer",
      reason: "新闻结果已足够回答（规则 fallback）",
      finalText: (result?.summary as Record<string, unknown>)?.overview as string || "根据搜索结果，暂未发现相关灾害报道。",
    };
  }

  if (lastObservation?.toolName === "weather.fetch") {
    return {
      decision: "final_answer",
      reason: "已获取天气信息（规则 fallback）",
      finalText: "气象数据已获取。",
    };
  }

  // 兜底
  return {
    decision: "final_answer",
    reason: "无法根据当前信息进一步决策（规则 fallback）",
    finalText: "当前信息有限，建议关注官方渠道获取最新动态。",
  };
}

// ============================================================
// 辅助函数
// ============================================================

function extractKeywords(query: string): string {
  const stopWords = new Set([
    "最近", "有没有", "会不会", "影响", "出行", "查询", "一下",
    "什么", "怎么", "如何", "呢", "吗", "的", "了",
  ]);

  return query
    .split(/\s+|，|。|\?|？/)
    .filter((w) => w.length > 1 && !stopWords.has(w))
    .slice(0, 3)
    .join(" ");
}

function extractRegion(query: string): string | undefined {
  const regionKeywords = ["日本", "中国", "东海", "南海", "北京", "上海", "东京"];
  for (const region of regionKeywords) {
    if (query.includes(region)) return region;
  }
  return undefined;
}

function buildFallbackAnswer(
  newsObs: Observation,
  weatherObs: Observation,
  query: string
): string {
  const newsResult = newsObs.result as Record<string, unknown> | null;
  const weatherResult = weatherObs.result as Record<string, unknown> | null;

  const parts: string[] = [];

  if (newsResult) {
    const overview = (newsResult.summary as Record<string, unknown>)?.overview as string;
    if (overview) parts.push(`📰 新闻情报：${overview}`);
  }

  if (weatherResult) {
    const desc = weatherResult.description as string || "气象数据已获取";
    parts.push(`🌤️ 气象状况：${desc}`);
  }

  if (query.includes("出行")) {
    parts.push("\n💡 出行建议：建议关注目的地最新天气和交通状况，必要时调整行程。");
  }

  return parts.join("\n") || "处理完成。";
}
