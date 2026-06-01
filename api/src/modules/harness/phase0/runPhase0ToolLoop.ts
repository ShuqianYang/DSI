import { buildToolCatalog, type ToolCatalogItem } from "./toolCatalog.js";
import { callTool, type ToolCallOutput } from "./toolGateway.js";

export interface Phase0Result {
  mode: "phase0_tool_loop";
  query: string;
  selectedTool?: string;
  toolParams?: Record<string, unknown>;
  observation?: ToolCallOutput;
  finalText: string;
}

interface ToolCallDecision {
  type: "tool_call";
  tool: string;
  params: Record<string, unknown>;
}

interface FinalAnswerDecision {
  type: "final_answer";
  text: string;
}

type MockDecision = ToolCallDecision | FinalAnswerDecision;

// ========== Mock Agent 决策规则 ==========
// Phase 0 不调用真实 Claude API，用关键词匹配模拟 Agent 的工具选择。

const WEATHER_KEYWORDS = ["天气", "weather", "气温", "温度", "下雨", "降雪", "风向", "风速", "洋流", "台风", "气象"];
const WEATHER_CITIES = ["东京", "北京", "上海", "广州", "深圳", "杭州", "南京", "成都", "武汉", "西安", "香港", "台北"];

const NEWS_KEYWORDS = ["新闻", "报道", "舆情", "最近", "发生", "事件", "地震", "洪水", "火灾", "事故", "冲突", "局势", "最新"];

function extractWeatherRegion(query: string): string {
  for (const city of WEATHER_CITIES) {
    if (query.includes(city)) return city;
  }
  return "东海油膜片区";
}

function mockAgentDecision(query: string, _catalog: ToolCatalogItem[]): MockDecision {
  const q = query.toLowerCase();

  // 1. weather 匹配
  const hasWeatherKeyword = WEATHER_KEYWORDS.some((kw) => q.includes(kw));
  const hasWeatherCity = WEATHER_CITIES.some((city) => q.includes(city));

  if (hasWeatherKeyword || hasWeatherCity) {
    const region = extractWeatherRegion(query);
    return {
      type: "tool_call",
      tool: "weather-fetch",
      params: { region },
    };
  }

  // 2. news 匹配
  const hasNewsKeyword = NEWS_KEYWORDS.some((kw) => q.includes(kw));

  if (hasNewsKeyword) {
    return {
      type: "tool_call",
      tool: "news",
      params: {
        query,
        region: "",
        timeRange: "7d",
      },
    };
  }

  // 3. 无匹配 → final_answer
  return {
    type: "final_answer",
    text:
      "当前 Phase 0 暂无合适工具可处理该请求。Phase 0 仅支持以下两类工具：\n" +
      "- weather-fetch：天气/气象查询\n" +
      "- news：新闻/舆情搜索\n" +
      "如需支持更多场景，请等待后续 Phase 扩展，或通过现有 Planner → Router → Executor 主链路处理。",
  };
}

/**
 * Phase 0 Agent Tool-Use Loop
 *
 * 流程：query → buildToolCatalog → mockAgentDecision → callTool → observation → final response
 */
export async function runPhase0ToolLoop(query: string): Promise<Phase0Result> {
  const catalog = buildToolCatalog();

  // Step 1: Agent 决策（mock）
  const decision = mockAgentDecision(query, catalog);

  if (decision.type === "final_answer") {
    return {
      mode: "phase0_tool_loop",
      query,
      finalText: decision.text,
    };
  }

  // Step 2: 通过 Gateway 调用工具
  const observation = await callTool({
    tool: decision.tool,
    params: decision.params,
  });

  // Step 3: 组装最终响应
  let finalText: string;
  if (observation.ok) {
    finalText = `已调用工具 \`${decision.tool}\`，获取到以下结果：\n\n\`\`\`json\n${JSON.stringify(observation.result, null, 2)}\n\`\`\``;
  } else {
    finalText = `工具 \`${decision.tool}\` 调用失败：${observation.error?.message || "未知错误"}（code: ${observation.error?.code}）`;
  }

  return {
    mode: "phase0_tool_loop",
    query,
    selectedTool: decision.tool,
    toolParams: decision.params,
    observation,
    finalText,
  };
}
