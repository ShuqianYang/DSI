import type { Action } from "@datasourceintelligence/shared";

// DeepSeek API 配置
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-v4-flash";

// ============================================================
// 阻断分析提示词模板
// ============================================================
// 说明：指导 DeepSeek 分析 action 执行失败/阻断原因，并输出诊断报告。
// 模板变量由 analyzeBlockReason 函数在运行时填充。
// ============================================================

const PROMPT_TEMPLATE = `你是数智融合智能体应用平台的失败分析器。
你的输入来自 executor 的运行时上下文、失败的 action 信息和阻断原因代码。
你的任务是分析某个 action 为什么失败或被阻断，并说明项目后续需要补充哪些工具能力、数据能力、参数能力或工程配置。
你不调用工具，不重试 action，不编造已经不存在的执行结果。
你只根据输入变量和已有上下文进行诊断。
你必须返回 JSON，不要输出 JSON 以外的文字。

## 输入变量

用户原始提问：
{QUERY}

失败的 action 类型：
{ACTION_TYPE}

失败的 action 名称：
{ACTION_NAME}

失败的 action 描述：
{ACTION_DESC}

失败的 action 参数：
{ACTION_PARAMS}

已成功执行的步骤结果 key 列表：
{CONTEXT_KEYS}

阻断原因代码：
{BLOCK_REASON}

## 分析规则

1. 先判断失败属于哪一类：工具缺失、参数不支持、参数值超出枚举、必要参数缺失、依赖步骤失败、上下文数据缺失、场景不支持、需要用户补充信息、工具内部执行失败。
2. 如果 BLOCK_REASON 是 TOOL_NOT_AVAILABLE，说明当前 capability list 没有能承接该 action 的工具，并给出建议新增的工具名称、输入参数和输出结构。
3. 如果 BLOCK_REASON 是 PARAM_NOT_SUPPORTED，说明 action.params 中出现了工具 schema 未声明的参数，并指出哪些参数需要加入 schema，或者应该拆成新的工具。
4. 【预留】如果 BLOCK_REASON 是 SEMANTIC_PARAM_UNSUPPORTED，说明用户语义里提出了额外需求，但当前工具参数无法承接。需要说明可执行的部分、被忽略会造成什么偏差、需要补充什么参数或统计工具。（当前代码暂不触发此阻断原因，待 Planner 输出 unsupportedParamNeeds 后启用）
5. 如果 BLOCK_REASON 是 PARAM_OUT_OF_ENUM，说明参数值没有命中工具预设范围。需要判断是区域枚举太窄、别名归一化缺失，还是用户真的问了系统不支持的区域。
6. 如果 BLOCK_REASON 是 REQUIRED_PARAM_MISSING，说明缺少执行所需参数。需要列出缺失参数，并判断它应该由用户补充、由 Planner 推断，还是由前置 action 产生。
7. 如果 BLOCK_REASON 是 DEPENDENCY_BLOCKED，说明前置 action 没有成功执行。需要说明被哪个上下文结果卡住，并建议是否允许降级执行。
8. 如果 BLOCK_REASON 是 CONTEXT_DEP_MISSING，说明工具需要的上下文数据没有出现在 CONTEXT_KEYS 中。需要指出缺少哪个数据，并说明应该由哪个前置工具产生。
9. 如果 BLOCK_REASON 是 SCENARIO_NOT_SUPPORTED，说明用户问题超出了当前预设场景。需要拆出系统可以覆盖的部分和完全缺失的部分。
10. 如果 BLOCK_REASON 是 NEEDS_CLARIFICATION，说明当前无法安全推断参数。需要生成一句可以直接问用户的澄清问题。
11. 如果 BLOCK_REASON 是 TOOL_RUNTIME_ERROR，说明工具内部执行抛出异常（如网络超时、数据库错误、API 不可用）。需要判断是临时故障还是结构性缺失。
12. 不要把能力缺口描述成模型理解错误，除非输入本身存在明显矛盾。
12. 不要建议使用当前 capability list 中不存在的工具来继续执行，除非是在 requiredNewCapabilities 中作为后续建设建议。
13. 如果当前上下文里已经有可用结果，必须说明可以基于这些结果给用户什么降级反馈。
14. 如果失败来自写死参数或 mock 数据限制，需要直接指出这是工程能力边界。
15. 输出里要区分“当前可补救方案”和“后续项目建设建议”。

## 输出格式

{
  "status": "analyzed",
  "query": "{QUERY}",
  "failedAction": {
    "type": "{ACTION_TYPE}",
    "name": "{ACTION_NAME}",
    "description": "{ACTION_DESC}",
    "params": "{ACTION_PARAMS}",
    "blockReason": "{BLOCK_REASON}"
  },
  "failureCategory": "tool_missing | param_not_supported | semantic_param_unsupported | param_out_of_enum | required_param_missing | dependency_blocked | context_dep_missing | scenario_not_supported | needs_clarification | tool_runtime_error | unknown",
  "rootCause": "用一句话说明失败的直接原因",
  "detailedAnalysis": "说明用户原始需求、当前 action 想做什么、为什么现有工具无法完成，以及阻断发生在参数层、数据层、工具层还是流程层。",
  "impactOnUserGoal": {
    "canStillAnswerPartially": true,
    "coveredPart": "当前已经可以完成的部分",
    "blockedPart": "当前无法完成的部分",
    "userVisibleImpact": "用户最终会看到什么缺失或偏差"
  },
  "availableContextUsage": {
    "contextKeys": "{CONTEXT_KEYS}",
    "usableContext": ["可以继续用于降级反馈的上下文 key"],
    "missingContext": ["当前缺失但 action 需要的上下文 key"]
  },
  "fallbackResponse": {
    "canFallback": true,
    "fallbackPlan": "当前系统可以怎么降级处理",
    "userFacingMessage": "可以直接展示给用户的一句话说明"
  },
  "requiredNewCapabilities": [
    {
      "capabilityType": "建议新增的工具类型",
      "capabilityName": "建议新增的工具名称",
      "reason": "为什么需要这个能力",
      "suggestedParams": {},
      "suggestedOutput": {},
      "priority": "high | medium | low"
    }
  ],
  "requiredData": [
    {
      "dataName": "需要补充的数据",
      "reason": "为什么需要这类数据",
      "possibleSource": "可能的数据来源",
      "priority": "high | medium | low"
    }
  ],
  "schemaImprovementSuggestions": [
    {
      "targetCapability": "{ACTION_TYPE}",
      "suggestionType": "add_param | expand_enum | add_alias | split_tool | add_context_dep | change_default | add_output_field",
      "detail": "具体修改建议",
      "example": {}
    }
  ],
  "plannerImprovementSuggestions": [
    {
      "issue": "Planner 在这个问题上可以改进的地方",
      "suggestion": "建议 Planner 之后如何拆分或标记 supportStatus"
    }
  ],
  "routerImprovementSuggestions": [
    {
      "issue": "Router 在这个问题上可以改进的地方",
      "suggestion": "建议 Router 之后如何校验、归一化或阻断"
    }
  ],
  "clarificationQuestion": null,
  "severity": "high | medium | low",
  "debugSummary": "给开发者看的简短总结"
}`;

// ============================================================
// DeepSeek API 调用
// ============================================================

const DEEPSEEK_TIMEOUT_MS = 120_000;

async function callDeepSeekApi(
  messages: Array<{ role: string; content: string }>,
  options: Record<string, unknown> = {}
): Promise<string> {
  if (!DEEPSEEK_API_KEY) {
    throw new Error("DeepSeek API key not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEEPSEEK_TIMEOUT_MS);
  try {
    const resp = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages,
        stream: false,
        ...options,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`DeepSeek API error: ${resp.status} ${text}`);
    }

    const json = await resp.json();
    return json.choices?.[0]?.message?.content || "";
  } finally {
    clearTimeout(timeout);
  }
}

function extractJson(text: string): string {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (m) return m[1].trim();
  const o = text.match(/\{[\s\S]*\}/);
  if (o) return o[0];
  return text.trim();
}

// ============================================================
// 阻断分析主函数
// ============================================================

export interface BlockAnalysisResult {
  status: string;
  query: string;
  failedAction: {
    type: string;
    name: string;
    description: string;
    params: string;
    blockReason: string;
  };
  failureCategory: string;
  rootCause: string;
  detailedAnalysis: string;
  impactOnUserGoal: {
    canStillAnswerPartially: boolean;
    coveredPart: string;
    blockedPart: string;
    userVisibleImpact: string;
  };
  availableContextUsage: {
    contextKeys: string;
    usableContext: string[];
    missingContext: string[];
  };
  fallbackResponse: {
    canFallback: boolean;
    fallbackPlan: string;
    userFacingMessage: string;
  };
  requiredNewCapabilities: Array<{
    capabilityType: string;
    capabilityName: string;
    reason: string;
    suggestedParams: Record<string, unknown>;
    suggestedOutput: Record<string, unknown>;
    priority: string;
  }>;
  requiredData: Array<{
    dataName: string;
    reason: string;
    possibleSource: string;
    priority: string;
  }>;
  schemaImprovementSuggestions: Array<{
    targetCapability: string;
    suggestionType: string;
    detail: string;
    example: Record<string, unknown>;
  }>;
  plannerImprovementSuggestions: Array<{
    issue: string;
    suggestion: string;
  }>;
  routerImprovementSuggestions: Array<{
    issue: string;
    suggestion: string;
  }>;
  clarificationQuestion: string | null;
  severity: string;
  debugSummary: string;
}

/**
 * 分析 action 执行阻断原因，返回 requirement 提报所需信息。
 *
 * @param query        用户原始提问
 * @param failedAction 执行失败的 action
 * @param context      已执行成功的步骤结果上下文
 * @param blockReason  阻断原因代码（如 CONTEXT_DEP_MISSING）
 */
export async function analyzeBlockReason(
  query: string,
  failedAction: Action,
  context: Record<string, unknown>,
  blockReason: string
): Promise<BlockAnalysisResult> {
  // 构建上下文 key 摘要（避免传入过大 JSON）
  const contextKeys = Object.entries(context)
    .map(([k, v]) => {
      const keys = v !== null && typeof v === "object" ? Object.keys(v as object) : [String(v)];
      return `- ${k}: ${keys.slice(0, 5).join(", ")}${keys.length > 5 ? "..." : ""}`;
    })
    .join("\n");

  // 填充提示词模板
  const prompt = PROMPT_TEMPLATE
    .replace("{QUERY}", query)
    .replace("{ACTION_TYPE}", failedAction.type)
    .replace("{ACTION_NAME}", failedAction.name)
    .replace("{ACTION_DESC}", failedAction.description || "")
    .replace("{ACTION_PARAMS}", JSON.stringify(failedAction.params))
    .replace("{CONTEXT_KEYS}", contextKeys || "无")
    .replace("{BLOCK_REASON}", blockReason);

  try {
    const result = await callDeepSeekApi(
      [
        { role: "system", content: "你是一个系统阻断分析专家，只返回 JSON。" },
        { role: "user", content: prompt },
      ],
      { reasoning_effort: "high" }
    );

    const parsed = JSON.parse(extractJson(result));

    return {
      status: parsed.status || "analyzed",
      query: parsed.query || query,
      failedAction: parsed.failedAction || {
        type: failedAction.type,
        name: failedAction.name,
        description: failedAction.description || "",
        params: JSON.stringify(failedAction.params),
        blockReason,
      },
      failureCategory: parsed.failureCategory || "unknown",
      rootCause: parsed.rootCause || "未知原因",
      detailedAnalysis: parsed.detailedAnalysis || "",
      impactOnUserGoal: parsed.impactOnUserGoal || {
        canStillAnswerPartially: false,
        coveredPart: "",
        blockedPart: "",
        userVisibleImpact: "",
      },
      availableContextUsage: parsed.availableContextUsage || {
        contextKeys: "",
        usableContext: [],
        missingContext: [],
      },
      fallbackResponse: parsed.fallbackResponse || {
        canFallback: false,
        fallbackPlan: "",
        userFacingMessage: "当前场景暂不支持",
      },
      requiredNewCapabilities: parsed.requiredNewCapabilities || [],
      requiredData: parsed.requiredData || [],
      schemaImprovementSuggestions: parsed.schemaImprovementSuggestions || [],
      plannerImprovementSuggestions: parsed.plannerImprovementSuggestions || [],
      routerImprovementSuggestions: parsed.routerImprovementSuggestions || [],
      clarificationQuestion: parsed.clarificationQuestion || null,
      severity: parsed.severity || "medium",
      debugSummary: parsed.debugSummary || "",
    };
  } catch (err) {
    console.error(
      "[BlockageAnalyzer] analyzeBlockReason failed:",
      (err as Error).message
    );

    // 兜底：返回基础信息
    return {
      status: "analyzed",
      query,
      failedAction: {
        type: failedAction.type,
        name: failedAction.name,
        description: failedAction.description || "",
        params: JSON.stringify(failedAction.params),
        blockReason,
      },
      failureCategory: "unknown",
      rootCause: `执行 ${failedAction.type} 时缺少必要上下文依赖`,
      detailedAnalysis: "",
      impactOnUserGoal: {
        canStillAnswerPartially: false,
        coveredPart: "",
        blockedPart: "",
        userVisibleImpact: "",
      },
      availableContextUsage: {
        contextKeys: "",
        usableContext: [],
        missingContext: [],
      },
      fallbackResponse: {
        canFallback: false,
        fallbackPlan: "",
        userFacingMessage: "当前场景暂不支持，已为您转报定制需求",
      },
      requiredNewCapabilities: [],
      requiredData: [],
      schemaImprovementSuggestions: [],
      plannerImprovementSuggestions: [],
      routerImprovementSuggestions: [],
      clarificationQuestion: null,
      severity: "medium",
      debugSummary: "",
    };
  }
}
