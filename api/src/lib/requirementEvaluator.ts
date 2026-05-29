import {
  REQUIREMENT_EVAL_SYSTEM_PROMPT,
  buildRequirementEvalPrompt,
} from "./prompts/requirement-eval.js";

// DeepSeek API 配置
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-v4-flash";

export interface BlockedItem {
  source: "plan" | "executor";
  actionType: string;
  actionName: string;
  reason: string;
}

export interface RequirementItem {
  type: number;
  name: string;
  description: string;
  applicationScenario: string;
}

export interface RequirementEvaluation {
  shouldCreate: boolean;
  reason: string;
  requirements: RequirementItem[];
}

/**
 * 调用 DeepSeek 统一评估是否需要生成 requirement
 */
export async function evaluateRequirementNeed(
  query: string,
  blockedItems: BlockedItem[]
): Promise<RequirementEvaluation> {
  if (!DEEPSEEK_API_KEY) {
    console.log("[RequirementEval] DeepSeek API key not configured, fallback to always create");
    return {
      shouldCreate: true,
      reason: "系统配置缺失，默认创建需求单",
      requirements: [{
        type: 1,
        name: query.substring(0, 20),
        description: `用户请求：${query}\n\n系统暂不支持以下能力：${blockedItems.map((b) => b.actionType).join(", ")}`,
        applicationScenario: "智能体能力扩展",
      }],
    };
  }

  const hasBlocked = blockedItems.length > 0;
  const blockedSummary = hasBlocked
    ? blockedItems
        .map((b, i) => {
          return `${i + 1}. [${b.source}] ${b.actionType} — ${b.actionName}\n   原因：${b.reason}`;
        })
        .join("\n\n")
    : "系统当前无任何可用工具可以处理该请求。";

  const contextHint = hasBlocked
    ? "当前系统有部分能力，但缺少特定工具或数据源"
    : "当前系统完全无法处理该请求";

  const prompt = buildRequirementEvalPrompt({
    query,
    blockedSummary,
    contextHint,
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    let resp: Response;
    try {
      resp = await fetch(DEEPSEEK_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages: [
            { role: "system", content: REQUIREMENT_EVAL_SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          stream: false,
          temperature: 0.3,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`DeepSeek API error: ${resp.status} ${text}`);
    }

    const json = await resp.json();
    const answer = json.choices?.[0]?.message?.content || "";

    const trimmed = answer.trim();
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    let candidate = codeBlockMatch ? codeBlockMatch[1].trim() : trimmed;
    candidate = candidate.replace(/^json\s*/i, "");

    const parsed = JSON.parse(candidate);

    const rawRequirements = Array.isArray(parsed.requirements)
      ? parsed.requirements
      : parsed.requirement
        ? [parsed.requirement]
        : [];

    const requirements = rawRequirements
      .filter((r: any) => r && (r.name || r.description))
      .map((r: any) => ({
        type: Number(r.type) || 1,
        name: String(r.name || query.substring(0, 20)).slice(0, 20),
        description: String(r.description || `用户请求：${query}，系统暂不支持`).slice(0, 200),
        applicationScenario: String(r.applicationScenario || "智能体能力扩展"),
      }));

    return {
      shouldCreate: !!parsed.shouldCreate && requirements.length > 0,
      reason: parsed.reason || "已评估",
      requirements,
    };
  } catch (err) {
    console.error("[RequirementEval] DeepSeek evaluation failed:", err);
    return {
      shouldCreate: true,
      reason: "自动评估失败，默认创建需求单",
      requirements: [{
        type: 1,
        name: query.substring(0, 20),
        description: `用户请求：${query}\n\n系统暂不支持以下能力：${blockedItems.map((b) => b.actionType).join(", ")}`,
        applicationScenario: "智能体能力扩展",
      }],
    };
  }
}
