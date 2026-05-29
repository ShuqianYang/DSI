import type { Plan, Action, ActionType } from "@datasourceintelligence/shared";
import type { RouterService } from "./types.js";
import { callDifyChat } from "../../lib/dify.js";
import { evaluateRequirementNeed } from "../../lib/requirementEvaluator.js";

// Dify API 配置（已废弃，改用 DeepSeek）
// const DIFY_API_KEY = process.env.DIFY_ROUTER_API_KEY || "";
// const DIFY_API_URL = process.env.DIFY_ROUTER_API_URL || "";

// DeepSeek API 配置
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-v4-flash";

// DeepSeek API 调用
const DEEPSEEK_TIMEOUT_MS = 120_000;

async function callDeepSeekApi(
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  options: Record<string, unknown> = {}
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEEPSEEK_TIMEOUT_MS);
  try {
    const resp = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: DEEPSEEK_MODEL, messages, stream: false, ...options }),
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

function buildDeepSeekRouterPrompt(plan: Plan, originalQuery?: string): string {
  const capabilities = [
    { type: "region-mark", description: "在 Cesium 地图上框选目标范围" },
    { type: "satellite", description: "获取卫星遥感影像（火灾/漏油/地震/洪涝）" },
    { type: "fire-detector", description: "识别火灾中心点、烧毁区域" },
    { type: "oil-drift", description: "反推排污原点和漂移路径" },
    { type: "ais-fetch", description: "拉取近72小时船舶 AIS 轨迹" },
    { type: "ais-match-suspects", description: "嫌疑船名单与 AIS 轨迹匹配" },
    { type: "ais-suspect-ranking", description: "按排污概率排序" },
    { type: "maritime", description: "海域态势分析" },
    { type: "weather-fetch", description: "气象风场获取" },
    { type: "earthquake-evaluation", description: "地震灾后评估" },
    { type: "flood-evaluation", description: "洪涝灾后评估" },
    { type: "news", description: "新闻查询" },
  ];

  return `你是数智融合智能体应用平台的 Router。
将以下 Planner 计划转换为可执行 actions 数组。

## 可用工具

${capabilities.map((c) => `- ${c.type}: ${c.description}`).join("\n")}

## 用户提问

${originalQuery || plan.goal}

## Planner 计划

${JSON.stringify(plan, null, 2)}

## 输出要求

返回 JSON 数组，每个 action 包含以下字段：
- id: 唯一标识（如 action-1）
- type: 工具类型（必须从可用工具中选择）
- name: 动作名称
- description: 动作描述
- params: 参数对象
- dependsOn: 依赖的 action id 数组（可选）

**重要规则：**
- 如果 Planner 计划中的步骤没有任何可用工具能完成，请直接返回空数组 []，不要虚构工具或返回不存在的类型。
- 不要返回 type 为 "intelligence"、"intelligent_qa" 或 "requirement" 的兜底 action。

只返回 JSON 数组，不要其他内容。`;
}

function extractJsonFromText(text: string): string {
  const m = text.match(/\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`/);
  if (m) return m[1].trim();
  const o = text.match(/\[[\s\S]*\]/);
  if (o) return o[0];
  return text.trim();
}

async function callDeepSeekRouter(plan: Plan, originalQuery?: string): Promise<Action[]> {
  if (!DEEPSEEK_API_KEY) {
    throw new Error("DeepSeek API key not configured");
  }

  console.log("[Router] Sending to DeepSeek. plan.goal:", plan.goal);

  const prompt = buildDeepSeekRouterPrompt(plan, originalQuery);
  const result = await callDeepSeekApi(
    DEEPSEEK_API_KEY,
    [
      { role: "system", content: "你是一个工具路由专家，只返回 JSON 数组格式的 actions。" },
      { role: "user", content: prompt },
    ],
    { reasoning_effort: "high" }
  );

  const answerPreview = result.slice(0, 300).replace(/\s+/g, " ");
  console.log("[Router] DeepSeek raw answer preview:", answerPreview);

  try {
    const json = extractJsonFromText(result);
    const parsed = JSON.parse(json);
    let rawActions: unknown[] = [];
    if (Array.isArray(parsed)) {
      rawActions = parsed;
    } else if (parsed.actions && Array.isArray(parsed.actions)) {
      rawActions = parsed.actions;
    }

    const actions = rawActions.map((a: Record<string, unknown>, i: number) => ({
      id: (a.id as string) || `action-${i + 1}`,
      type: (a.type as ActionType) || "intelligence",
      name: (a.name as string) || "未命名动作",
      description: (a.description as string) || "",
      params: (a.params as Record<string, unknown>) || {},
      dependsOn: Array.isArray(a.dependsOn) ? (a.dependsOn as string[]) : undefined,
    }));

    // Router 层参数校验：记录非法 action 但不过滤（由 Executor 执行时阻断）
    const { validActions, blockedActions } = validateAndFilterActions(actions);
    if (blockedActions.length > 0) {
      console.log(
        `[Router] Noted ${blockedActions.length} potentially invalid actions (will be blocked at execution):`
      );
      for (const b of blockedActions) {
        console.log(`  [WARN] ${b.action.type}: ${b.reason} (${b.blockedReason})`);
      }
    }

    console.log(
      "[Router] Parsed actions count:",
      actions.length,
      "types:",
      actions.map((a) => a.type)
    );
    // 返回全部 actions，让 Executor 在执行阶段做阻断
    return actions;
  } catch (err) {
    console.error("[Router] DeepSeek response parse failed:", (err as Error).message);
    console.log("[Router] Raw response:", result.slice(0, 500));
    return [];
  }
}

// ========== Router 层参数校验 ==========

// 区域别名归一化
const REGION_ALIASES: Record<string, string> = {
  "东海": "中国东海",
  "柳南区": "广西柳州市柳南区",
  "石门": "湖南石门县",
  "湖南石门": "湖南石门县",
  "石门县": "湖南石门县",
};

// 已知海域列表（24 个）
const KNOWN_SEAS = [
  "渤海", "黄海", "东海", "台湾海峡", "南海", "北部湾",
  "日本海", "菲律宾海", "鄂霍次克海", "西太平洋",
  "马六甲海峡", "印度洋北部", "印度洋中部", "孟加拉湾", "阿拉伯海",
  "波斯湾", "红海", "亚丁湾", "地中海东部", "地中海西部", "苏伊士运河",
  "中国东海",
];

// region-mark 预设区域
const REGION_MARK_PRESETS = [
  "中国东海", "东海", "柳州", "柳州市", "柳南区",
  "广西柳州市柳南区", "石门", "石门县", "湖南石门", "湖南石门县",
];

// weather-fetch 已知区域
const WEATHER_REGIONS = [
  "东海油膜片区", "石门县", "柳州", "广西柳州市柳南区", "湖南石门县",
];

export interface BlockedAction {
  action: Action;
  reason: string;
  blockedReason: string;
}

function normalizeRegion(region: string): string {
  return REGION_ALIASES[region] || region;
}

export function validateActionParams(action: Action): { valid: boolean; reason?: string; blockedReason?: string } {
  const params = action.params || {};

  switch (action.type) {
    case "region-mark": {
      const region = params.region as string | undefined;
      if (region && !REGION_MARK_PRESETS.includes(region)) {
        const normalized = normalizeRegion(region);
        if (REGION_MARK_PRESETS.includes(normalized)) {
          action.params = { ...params, region: normalized };
          return { valid: true };
        }
        return {
          valid: false,
          reason: `region "${region}" 不在预设列表中`,
          blockedReason: "PARAM_OUT_OF_ENUM",
        };
      }
      return { valid: true };
    }

    case "satellite": {
      const hasFlag =
        params.fireScenario === true ||
        params.earthquakeScenario === true ||
        params.floodScenario === true ||
        params.detectOilSpill === true;
      if (!hasFlag) {
        return {
          valid: false,
          reason: "satellite 必须指定 fireScenario/earthquakeScenario/floodScenario/detectOilSpill 之一",
          blockedReason: "PARAM_NOT_SUPPORTED",
        };
      }
      return { valid: true };
    }

    case "fire-detector": {
      const region = params.region as string | undefined;
      const fromScenario = params.fromScenario as boolean | undefined;
      if (region !== "Kensai" && !fromScenario) {
        return {
          valid: false,
          reason: "fire-detector 需要 region=Kensai 或 fromScenario=true",
          blockedReason: "PARAM_OUT_OF_ENUM",
        };
      }
      return { valid: true };
    }

    case "ais-fetch":
    case "maritime": {
      const region = params.region as string | undefined;
      if (region && !KNOWN_SEAS.includes(region) && !KNOWN_SEAS.includes(normalizeRegion(region))) {
        return {
          valid: false,
          reason: `region "${region}" 不在已知海域列表中`,
          blockedReason: "PARAM_OUT_OF_ENUM",
        };
      }
      return { valid: true };
    }

    case "weather-fetch": {
      const region = params.region as string | undefined;
      if (region && !WEATHER_REGIONS.includes(region) && !WEATHER_REGIONS.includes(normalizeRegion(region))) {
        return {
          valid: false,
          reason: `region "${region}" 不在已知气象区域列表中`,
          blockedReason: "PARAM_OUT_OF_ENUM",
        };
      }
      return { valid: true };
    }

    case "earthquake-evaluation": {
      const region = params.region as string | undefined;
      if (region && region !== "柳州" && region !== "广西柳州市柳南区") {
        return {
          valid: false,
          reason: `region "${region}" 必须为柳州或广西柳州市柳南区`,
          blockedReason: "PARAM_OUT_OF_ENUM",
        };
      }
      return { valid: true };
    }

    case "flood-evaluation": {
      const region = params.region as string | undefined;
      if (region && region !== "石门县" && region !== "湖南石门县") {
        return {
          valid: false,
          reason: `region "${region}" 必须为石门县或湖南石门县`,
          blockedReason: "PARAM_OUT_OF_ENUM",
        };
      }
      return { valid: true };
    }

    default:
      return { valid: true };
  }
}

export function validateAndFilterActions(actions: Action[]): { validActions: Action[]; blockedActions: BlockedAction[] } {
  const validActions: Action[] = [];
  const blockedActions: BlockedAction[] = [];

  for (const action of actions) {
    const result = validateActionParams(action);
    if (result.valid) {
      validActions.push(action);
    } else {
      blockedActions.push({
        action,
        reason: result.reason || "参数校验失败",
        blockedReason: result.blockedReason || "PARAM_NOT_SUPPORTED",
      });
    }
  }

  return { validActions, blockedActions };
}

// 当 Dify Router 误判用户意图时进行强制修正
// function correctMisroutedActions(actions: Action[], query: string): Action[] {
//   const lowerQuery = query.toLowerCase();

//   // 判断用户意图（支持中英文海事关键词）
//   const hasMaritime =
//     lowerQuery.includes("海域") ||
//     lowerQuery.includes("船舶") ||
//     lowerQuery.includes("态势") ||
//     lowerQuery.includes("航线") ||
//     lowerQuery.includes("港口") ||
//     lowerQuery.includes("海军") ||
//     lowerQuery.includes("海") ||
//     lowerQuery.includes("ocean") ||
//     lowerQuery.includes("sea") ||
//     lowerQuery.includes("strait") ||
//     lowerQuery.includes("gulf") ||
//     lowerQuery.includes("maritime") ||
//     lowerQuery.includes("vessel") ||
//     lowerQuery.includes("shipping") ||
//     lowerQuery.includes("ship") ||
//     lowerQuery.includes("naval");

//   const hasNews =
//     lowerQuery.includes("新闻") ||
//     lowerQuery.includes("报道") ||
//     lowerQuery.includes("舆情") ||
//     lowerQuery.includes("媒体") ||
//     lowerQuery.includes("最新") ||
//     lowerQuery.includes("动态");

//   // GIS 模块已注释，maritime 自带地图展示能力
//   // const hasGis =
//   //   lowerQuery.includes("地图") ||
//   //   lowerQuery.includes("gis") ||
//   //   lowerQuery.includes("展示") ||
//   //   lowerQuery.includes("可视化");

//   const needsQa =
//     lowerQuery.includes("查询") ||
//     lowerQuery.includes("统计") ||
//     lowerQuery.includes("有多少") ||
//     lowerQuery.includes("多少起") ||
//     lowerQuery.includes("排名") ||
//     lowerQuery.includes("平均") ||
//     lowerQuery.includes("时长") ||
//     lowerQuery.includes("趋势") ||
//     lowerQuery.includes("频次") ||
//     lowerQuery.includes("占比") ||
//     lowerQuery.includes("总数");

//   const allTypes = new Set(actions.map((a) => a.type));

//   console.log("[Router] correctMisroutedActions input:", {
//     query,
//     hasMaritime,
//     hasNews,
//     needsQa,
//     actionTypes: Array.from(allTypes),
//     actionCount: actions.length,
//     actions: actions.map((a) => ({ id: a.id, type: a.type, name: a.name })),
//   });

//   // 如果 Dify 只返回了通用类型（intelligent_qa / intelligence），但用户 query 明显指向具体工具，强制修正
//   if (
//     (allTypes.has("intelligent_qa") || allTypes.has("intelligence")) &&
//     actions.length === 1
//   ) {
//     if (hasMaritime) {
//       console.log("[Router] Correcting misrouted action to maritime");
//       const corrected = [
//         {
//           id: "action-1",
//           type: "maritime",
//           name: "海域态势分析",
//           description: "分析海域实体数据和态势",
//           params: { region: "东海", query },
//           dependsOn: [],
//         },
//       ];
//       console.log("[Router] correctMisroutedActions output (maritime):", corrected);
//       return corrected;
//     }
//     if (hasNews) {
//       console.log("[Router] Correcting misrouted action to news");
//       const corrected = [
//         {
//           id: "action-1",
//           type: "news",
//           name: "实时新闻查询",
//           description: "检索最新新闻资讯并进行态势关联分析",
//           params: { query, region: "", timeRange: "7d" },
//           dependsOn: [],
//         },
//       ];
//       console.log("[Router] correctMisroutedActions output (news):", corrected);
//       return corrected;
//     }
//     if (needsQa) {
//       console.log("[Router] Correcting misrouted action to intelligent_qa");
//       const corrected = [
//         {
//           id: "action-1",
//           type: "intelligent_qa",
//           name: "智能问答查询",
//           description: "回答用户的统计查询问题",
//           params: { query },
//           dependsOn: [],
//         },
//       ];
//       console.log("[Router] correctMisroutedActions output (qa):", corrected);
//       return corrected;
//     }
//   }

//   // 如果 Dify 把明确的新闻请求误判为 maritime（或只返回了 maritime），强制修正为 news
//   if (hasNews && allTypes.has("maritime") && !allTypes.has("news")) {
//     console.log("[Router] Correcting misrouted maritime to news");
//     const corrected = [
//       {
//         id: "action-1",
//         type: "news",
//         name: "实时新闻查询",
//         description: "检索最新新闻资讯并进行态势关联分析",
//         params: { query, region: "", timeRange: "7d" },
//         dependsOn: [],
//       },
//     ];
//     console.log("[Router] correctMisroutedActions output (maritime->news):", corrected);
//     return corrected;
//   }

//   // 如果用户有 maritime 意图但 Dify 没返回 maritime，补充一个
//   if (hasMaritime && !allTypes.has("maritime")) {
//     console.log("[Router] Adding missing maritime action");
//     actions.push({
//       id: `action-${actions.length + 1}`,
//       type: "maritime",
//       name: "海域态势分析",
//       description: "分析海域实体数据和态势",
//       params: { region: "东海", query },
//       dependsOn: [],
//     });
//   }

//   // 如果用户有 news 意图但 Dify 没返回 news，补充一个
//   if (hasNews && !allTypes.has("news")) {
//     console.log("[Router] Adding missing news action");
//     actions.push({
//       id: `action-${actions.length + 1}`,
//       type: "news",
//       name: "实时新闻查询",
//       description: "检索最新新闻资讯并进行态势关联分析",
//       params: { query, region: "", timeRange: "7d" },
//       dependsOn: [],
//     });
//   }

//   // 抑制逻辑：maritime 查询时，移除并行的 intelligent_qa（maritime 自身已包含风险评估）
//   if (hasMaritime && allTypes.has("maritime")) {
//     const removedIds = new Set<string>();
//     const filtered = actions.filter((a) => {
//       if (a.type === "intelligent_qa") {
//         removedIds.add(a.id);
//         console.log(`[Router] Suppressing intelligent_qa (${a.id}) in favor of maritime`);
//         return false;
//       }
//       return true;
//     });
//     // 清理被移除 action 的 dependsOn 引用
//     actions = filtered.map((a) => ({
//       ...a,
//       dependsOn: a.dependsOn?.filter((id) => !removedIds.has(id)),
//     }));
//   }

  // GIS 模块已注释，maritime 自带地图展示能力
  // if (hasGis && !allTypes.has("gis")) {
  //   console.log("[Router] Adding missing gis action");
  //   actions.push({
  //     id: `action-${actions.length + 1}`,
  //     type: "gis",
  //     name: "GIS 联动展示",
  //     description: "在GIS地球引擎上展示分析结果",
  //     params: { query, layerType: "heatmap" },
  //     dependsOn: [],
  //   });
  // }

  // console.log("[Router] correctMisroutedActions final output:", actions.map((a) => ({ id: a.id, type: a.type, name: a.name, params: a.params })));
  // return actions;
// }

// 从文本中提取 scenario router 的 { actions: [...] } 格式
function extractScenarioActions(text: string): unknown[] | null {
  const trimmed = text.trim();
  // 1. 去除 markdown 代码块
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  let candidate = codeBlockMatch ? codeBlockMatch[1].trim() : trimmed;
  // 2. 去除开头的 "json" 标记
  candidate = candidate.replace(/^json\s*/i, "");
  // 3. 尝试解析并取 actions 数组
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.actions)) {
      return parsed.actions;
    }
  } catch {
    // continue
  }
  // 4. 尝试从文本中提取 {...} 块再取 actions
  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.actions)) {
        return parsed.actions;
      }
    } catch {
      // continue
    }
  }
  return null;
}

// 从文本中提取 JSON 数组（处理 markdown 代码块、混合文本、截断等）
function extractJsonArray(text: string): unknown[] | null {
  const trimmed = text.trim();

  // 1. 去除 markdown 代码块
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  let candidate = codeBlockMatch ? codeBlockMatch[1].trim() : trimmed;

  // 2. 去除开头的 "json" 标记（Dify 有时返回 "json\n[...]"）
  candidate = candidate.replace(/^json\s*/i, "");

  // 3. 尝试直接解析
  try {
    const parsed = JSON.parse(candidate);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // continue
  }

  // 4. 尝试修复后解析（缺少外层括号等）
  let wrapped = candidate;
  if (!candidate.startsWith("[")) {
    wrapped = candidate.endsWith("]") ? `[${candidate}` : `[${candidate}]`;
  }
  try {
    const parsed = JSON.parse(wrapped);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // continue
  }

  // 5. 从文本中提取 [...] 块
  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // continue
    }
  }

  // 6. 尝试提取单个 {...} 对象并包装成数组
  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return [parsed];
      }
    } catch {
      // continue
    }
  }

  return null;
}

function parseActionsFromText(text: string, plan: Plan): Action[] {
  // 1. 先尝试提取 scenario router 的 { actions: [...] } 格式
  const scenarioActions = extractScenarioActions(text);
  if (scenarioActions && scenarioActions.length > 0) {
    console.log("[Router] Extracted scenario actions, count:", scenarioActions.length);
    return scenarioActions.map((a: Record<string, unknown>, i: number) => {
      const params = (a.params as Record<string, unknown>) || {};
      if (a.type === "subscription") {
        if (!params.toolType) {
          params.toolType = inferSubscribedToolType(plan.goal);
        }
        if (!params.toolParams) {
          params.toolParams = inferSubscribedToolParams(plan.goal, params.toolType as string);
        }
      }
      return {
        id: (a.id as string) || `action-${i + 1}`,
        type: (a.type as ActionType) || "intelligence",
        name: (a.name as string) || "未命名动作",
        description: (a.description as string) || "",
        params,
        dependsOn: Array.isArray(a.dependsOn) ? (a.dependsOn as string[]) : undefined,
      };
    });
  }

  // 2. 回退：尝试提取旧格式 JSON 数组
  const extracted = extractJsonArray(text);
  if (extracted && extracted.length > 0) {
    console.log("[Router] Extracted JSON array, actions count:", extracted.length);
    return extracted.map((a: Record<string, unknown>, i: number) => {
      const params = (a.params as Record<string, unknown>) || {};
      if (a.type === "subscription") {
        if (!params.toolType) {
          params.toolType = inferSubscribedToolType(plan.goal);
        }
        if (!params.toolParams) {
          params.toolParams = inferSubscribedToolParams(plan.goal, params.toolType as string);
        }
      }
      return {
        id: (a.id as string) || `action-${i + 1}`,
        type: (a.type as ActionType) || "intelligence",
        name: (a.name as string) || "未命名动作",
        description: (a.description as string) || "",
        params,
        dependsOn: Array.isArray(a.dependsOn) ? (a.dependsOn as string[]) : undefined,
      };
    });
  }

  console.log("[Router] JSON extraction failed, falling back to heuristic parsing");

  // 启发式：根据 plan 步骤数量和描述映射到能力
  const actions: Action[] = [];
  const lowerText = text.toLowerCase();
  const lowerGoal = plan.goal.toLowerCase();

  // ========== 1. 订阅意图检测（最高优先级）==========
  const hasSubscription =
    lowerGoal.includes("订阅") ||
    lowerGoal.includes("定时") ||
    lowerGoal.includes("自动推送") ||
    lowerGoal.includes("持续监测") ||
    lowerGoal.includes("有异常通知我") ||
    lowerGoal.includes("每天早上") ||
    lowerGoal.includes("每天") ||
    lowerGoal.includes("每周");

  // 记录已被订阅覆盖的工具类型，避免即时执行重复生成
  const subscribedToolTypes = new Set<string>();

  if (hasSubscription) {
    const subInfo = inferSubscriptionType(plan.goal);
    const subToolType = inferSubscribedToolType(plan.goal);
    const subToolParams = inferSubscribedToolParams(plan.goal, subToolType);

    subscribedToolTypes.add(subToolType);

    actions.push({
      id: `action-${actions.length + 1}`,
      type: "subscription",
      name: "创建订阅任务",
      description: `用户请求订阅相关数据，类型：${subInfo.type}`,
      params: {
        query: plan.goal,
        subscriptionType: subInfo.type,
        schedule: subInfo.schedule,
        toolType: subToolType,
        toolParams: subToolParams,
      },
    });
  }

  // ========== 2. 即时执行工具检测 ==========
  const needsQa =
    lowerGoal.includes("查询") ||
    lowerGoal.includes("统计") ||
    lowerGoal.includes("有多少") ||
    lowerGoal.includes("多少起") ||
    lowerGoal.includes("排名") ||
    lowerGoal.includes("平均") ||
    lowerGoal.includes("时长") ||
    lowerGoal.includes("趋势") ||
    lowerGoal.includes("频次") ||
    lowerGoal.includes("占比") ||
    lowerGoal.includes("总数");

  if (needsQa && !subscribedToolTypes.has("intelligent_qa")) {
    actions.push({
      id: `action-${actions.length + 1}`,
      type: "intelligent_qa",
      name: "智能问答查询",
      description: "回答用户的统计查询问题",
      params: { query: plan.goal },
    });
  }

  const needsReport =
    lowerGoal.includes("日报") ||
    lowerGoal.includes("周报") ||
    lowerGoal.includes("报告") ||
    lowerGoal.includes("总结") ||
    lowerGoal.includes("态势报告") ||
    lowerGoal.includes("生成报告");

  if (needsReport && !actions.some((a) => a.type === "daily_report") && !subscribedToolTypes.has("daily_report")) {
    actions.push({
      id: `action-${actions.length + 1}`,
      type: "daily_report",
      name: "生成安防日报",
      description: "生成指定日期和类型的安防日报",
      params: { query: plan.goal, report_type: "all" },
    });
  }

  const needsSatellite =
    lowerGoal.includes("卫星") ||
    lowerGoal.includes("遥感") ||
    lowerGoal.includes("影像") ||
    lowerGoal.includes("切片") ||
    lowerGoal.includes("天基") ||
    lowerGoal.includes("高分") ||
    lowerGoal.includes("观测") ||
    lowerGoal.includes("监测数据");

  if (needsSatellite && !subscribedToolTypes.has("satellite")) {
    actions.push({
      id: `action-${actions.length + 1}`,
      type: "satellite",
      name: "天基数据查询",
      description: "查询卫星遥感数据和目标切片",
      params: { query: plan.goal },
    });
  }

  const needsMaritime =
    lowerGoal.includes("海域") ||
    lowerGoal.includes("船舶") ||
    lowerGoal.includes("态势") ||
    lowerGoal.includes("航线") ||
    lowerGoal.includes("港口") ||
    lowerGoal.includes("海军") ||
    lowerGoal.includes("ocean") ||
    lowerGoal.includes("sea") ||
    lowerGoal.includes("strait") ||
    lowerGoal.includes("gulf") ||
    lowerGoal.includes("maritime") ||
    lowerGoal.includes("vessel") ||
    lowerGoal.includes("shipping") ||
    lowerGoal.includes("ship") ||
    lowerGoal.includes("naval");

  if (needsMaritime && !subscribedToolTypes.has("maritime")) {
    actions.push({
      id: `action-${actions.length + 1}`,
      type: "maritime",
      name: "海域态势分析",
      description: "分析海域实体数据和态势",
      params: { region: "东海", query: plan.goal },
    });
  }

  // GIS 模块已注释，maritime 自带地图展示能力
  // const needsGis =
  //   lowerGoal.includes("地图") ||
  //   lowerGoal.includes("gis") ||
  //   lowerGoal.includes("展示") ||
  //   lowerGoal.includes("可视化");

  // if (needsGis && !subscribedToolTypes.has("gis")) {
  //   actions.push({
  //     id: `action-${actions.length + 1}`,
  //     type: "gis",
  //     name: "GIS 联动展示",
  //     description: "在GIS地球引擎上展示分析结果",
  //     params: { query: plan.goal, layerType: "heatmap" },
  //   });
  // }

  const needsNews =
    lowerGoal.includes("新闻") ||
    lowerGoal.includes("报道") ||
    lowerGoal.includes("舆情") ||
    lowerGoal.includes("媒体") ||
    lowerGoal.includes("最新") ||
    lowerGoal.includes("动态");

  if (needsNews && !subscribedToolTypes.has("news")) {
    actions.push({
      id: `action-${actions.length + 1}`,
      type: "news",
      name: "实时新闻查询",
      description: "检索最新新闻资讯并进行态势关联分析",
      params: { query: plan.goal, region: "", timeRange: "7d" },
    });
  }

  const needsFire =
    lowerGoal.includes("火灾") ||
    lowerGoal.includes("火情") ||
    lowerGoal.includes("着火") ||
    lowerGoal.includes("燃烧") ||
    lowerGoal.includes("烧毁") ||
    lowerGoal.includes("火灾检测");

  if (needsFire && !subscribedToolTypes.has("fire-detector")) {
    actions.push({
      id: `action-${actions.length + 1}`,
      type: "fire-detector",
      name: "火灾检测",
      description: "基于卫星遥感数据检测火灾位置和烧毁范围",
      params: { query: plan.goal },
    });
  }

  const needsIntelligence =
    lowerGoal.includes("情报") ||
    lowerGoal.includes("深度分析") ||
    lowerGoal.includes("研判");

  if (needsIntelligence && !subscribedToolTypes.has("intelligence")) {
    actions.push({
      id: `action-${actions.length + 1}`,
      type: "intelligence",
      name: "情报分析",
      description: "基于开源情报进行深度分析",
      params: { query: plan.goal, depth: "standard" },
    });
  }

  // ========== 3. 兜底逻辑（已注释，始终信任 Dify Router 结果）=========
  // if (actions.length === 0) {
  //   const isGreeting = /^(你好|在吗|您好|hi|hello|help|介绍一下)$/i.test(plan.goal.trim()) ||
  //                      plan.goal.trim().length <= 6;
  //   const isClearRequirement = plan.goal.length >= 8 && !isGreeting;
  //
  //   if (isClearRequirement) {
  //     actions.push({
  //       id: "action-1",
  //       type: "requirement",
  //       name: "记录定制需求",
  //       description: `当前系统暂无匹配工具，已记录需求：${plan.goal.substring(0, 30)}`,
  //       params: {
  //         description: plan.goal,
  //         reason: "用户需求超出当前可用工具能力范围",
  //         suggestedTool: inferSuggestedTool(plan.goal),
  //       },
  //     });
  //   } else {
  //     actions.push({
  //       id: "action-1",
  //       type: "intelligence",
  //       name: "通用分析",
  //       description: "对请求进行通用情报分析",
  //       params: { query: plan.goal },
  //     });
  //   }
  // }

  return actions;
}

// 推断订阅类型和调度规则
function inferSubscriptionType(goal: string): { type: "daily" | "weekly" | "realtime"; schedule: string } {
  const g = goal.toLowerCase();
  if (g.includes("周报") || g.includes("每周") || g.includes("weekly")) {
    return { type: "weekly", schedule: "0 9 * * 1" };
  }
  if (g.includes("日报") || g.includes("每日") || g.includes("每天") || g.includes("daily")) {
    return { type: "daily", schedule: "0 9 * * *" };
  }
  if (g.includes("实时") || g.includes("监测") || g.includes("追踪")) {
    return { type: "realtime", schedule: "*/30 * * * *" };
  }
  // 默认日报
  return { type: "daily", schedule: "0 9 * * *" };
}

// Mock 版本
async function mockDecideActions(plan: Plan): Promise<Action[]> {
  const actions: Action[] = [];
  let idx = 1;
  const goal = plan.goal.toLowerCase();

  // ========== 1. 订阅意图检测（最高优先级）==========
  const hasSubscription =
    goal.includes("订阅") ||
    goal.includes("定时") ||
    goal.includes("自动推送") ||
    goal.includes("持续监测") ||
    goal.includes("有异常通知我") ||
    goal.includes("每天早上") ||
    goal.includes("每天早上") ||
    goal.includes("每天早上") ||
    goal.includes("每天早上") ||
    goal.includes("每天早上");

  if (hasSubscription) {
    const subInfo = inferSubscriptionType(goal);
    // 判断订阅的是哪个工具
    const subToolType = inferSubscribedToolType(goal);
    const subToolParams = inferSubscribedToolParams(goal, subToolType);

    actions.push({
      id: `action-${idx++}`,
      type: "subscription",
      name: "创建订阅任务",
      description: `用户请求订阅相关数据，类型：${subInfo.type}`,
      params: {
        query: plan.goal,
        subscriptionType: subInfo.type,
        schedule: subInfo.schedule,
        toolType: subToolType,
        toolParams: subToolParams,
      },
    });
  }

  // ========== 2. 即时执行工具检测 ==========

  // 智能问答：统计/查询类
  // const needsQa =
  //   goal.includes("查询") ||
  //   goal.includes("统计") ||
  //   goal.includes("有多少") ||
  //   goal.includes("多少起") ||
  //   goal.includes("排名") ||
  //   goal.includes("平均") ||
  //   goal.includes("时长") ||
  //   goal.includes("趋势") ||
  //   goal.includes("频次") ||
  //   goal.includes("占比") ||
  //   goal.includes("总数");

  // if (needsQa) {
  //   actions.push({
  //     id: `action-${idx++}`,
  //     type: "intelligent_qa",
  //     name: "智能问答查询",
  //     description: "回答用户的统计查询问题",
  //     params: { query: plan.goal },
  //   });
  // }

  // // 日报生成
  // const needsReport =
  //   goal.includes("日报") ||
  //   goal.includes("周报") ||
  //   goal.includes("报告") ||
  //   goal.includes("总结") ||
  //   goal.includes("态势报告") ||
  //   goal.includes("生成报告");

  // if (needsReport) {
  //   actions.push({
  //     id: `action-${idx++}`,
  //     type: "daily_report",
  //     name: "生成安防日报",
  //     description: "生成指定日期和类型的安防日报",
  //     params: { query: plan.goal, report_type: "all" },
  //   });
  // }

  // // 天基查询
  // const needsSatellite =
  //   goal.includes("卫星") ||
  //   goal.includes("遥感") ||
  //   goal.includes("影像") ||
  //   goal.includes("切片") ||
  //   goal.includes("天基") ||
  //   goal.includes("高分") ||
  //   goal.includes("观测") ||
  //   goal.includes("监测数据");

  // if (needsSatellite) {
  //   actions.push({
  //     id: `action-${idx++}`,
  //     type: "satellite",
  //     name: "天基数据查询",
  //     description: "查询卫星遥感数据和目标切片",
  //     params: { query: plan.goal },
  //   });
  // }

  // // 海域态势（支持中英文关键词）
  // const needsMaritime =
  //   goal.includes("海域") ||
  //   goal.includes("船舶") ||
  //   goal.includes("态势") ||
  //   goal.includes("航线") ||
  //   goal.includes("港口") ||
  //   goal.includes("海军") ||
  //   goal.includes("海") ||
  //   goal.includes("ocean") ||
  //   goal.includes("sea") ||
  //   goal.includes("strait") ||
  //   goal.includes("gulf") ||
  //   goal.includes("maritime") ||
  //   goal.includes("vessel") ||
  //   goal.includes("shipping") ||
  //   goal.includes("ship") ||
  //   goal.includes("naval");

  // if (needsMaritime) {
  //   actions.push({
  //     id: `action-${idx++}`,
  //     type: "maritime",
  //     name: "海域态势分析",
  //     description: "分析海域实体数据和态势",
  //     params: { region: "东海", query: plan.goal },
  //   });
  // }

  // GIS 模块已注释，maritime 自带地图展示能力
  // const needsGis =
  //   goal.includes("地图") ||
  //   goal.includes("gis") ||
  //   goal.includes("展示") ||
  //   goal.includes("可视化");

  // if (needsGis) {
  //   actions.push({
  //     id: `action-${idx++}`,
  //     type: "gis",
  //     name: "GIS 联动展示",
  //     description: "在GIS地球引擎上展示分析结果",
  //     params: { query: plan.goal, layerType: "heatmap" },
  //   });
  // }

  // 实时新闻查询
  // const needsNews =
  //   goal.includes("新闻") ||
  //   goal.includes("报道") ||
  //   goal.includes("舆情") ||
  //   goal.includes("媒体") ||
  //   goal.includes("最新") ||
  //   goal.includes("动态");

  // if (needsNews) {
  //   actions.push({
  //     id: `action-${idx++}`,
  //     type: "news",
  //     name: "实时新闻查询",
  //     description: "检索最新新闻资讯并进行态势关联分析",
  //     params: { query: plan.goal, region: "", timeRange: "7d" },
  //   });
  // }

  // 情报分析（保留原有，但优先级降低）
  // const needsIntelligence =
  //   goal.includes("情报") ||
  //   goal.includes("深度分析") ||
  //   goal.includes("研判");

  // if (needsIntelligence) {
  //   actions.push({
  //     id: `action-${idx++}`,
  //     type: "intelligence",
  //     name: "情报分析",
  //     description: "基于开源情报进行深度分析",
  //     params: { query: plan.goal, depth: "standard" },
  //   });
  // }

  // ========== 3. 兜底逻辑 ==========
  if (actions.length === 0) {
    // 走 DeepSeek 需求评估
    console.log("[Router] mockDecideActions no match, evaluating requirement need...");
    try {
      const evaluation = await evaluateRequirementNeed(plan.goal, []);
      if (evaluation.shouldCreate && evaluation.requirements.length > 0) {
        evaluation.requirements.forEach((req, i) => {
          actions.push({
            id: `action-${i + 1}`,
            type: "requirement" as ActionType,
            name: req.name,
            description: i === 0 ? evaluation.reason : req.description,
            params: {
              description: req.description,
              reason: evaluation.reason,
              applicationScenario: req.applicationScenario,
              type: req.type,
            },
          });
        });
      } else {
        actions.push({
          id: "action-1",
          type: "intelligence" as ActionType,
          name: "通用分析",
          description: evaluation.reason,
          params: { query: plan.goal },
        });
      }
    } catch (err) {
      console.error("[Router] Requirement evaluation failed:", err);
      actions.push({
        id: "action-1",
        type: "requirement" as ActionType,
        name: "记录定制需求",
        description: `当前系统暂无匹配工具，已记录需求：${plan.goal.substring(0, 30)}`,
        params: {
          description: plan.goal,
          reason: "用户需求超出当前可用工具能力范围",
          type: 1,
        },
      });
    }
  }

  return Promise.resolve(actions);
}

// 火情研判 scenario 的区域 preset 字典
// goal 命中 match → 返回固定的 regionId / regionName / bbox（WGS84: [west, south, east, north]）
const FIRE_REGION_PRESETS: Array<{
  match: (g: string) => boolean;
  preset: { regionId: string; regionName: string; bbox: [number, number, number, number] };
}> = [
  {
    match: (g) => g.includes("新疆") && (g.includes("哈萨克") || g.includes("接壤")),
    preset: {
      regionId: "xj-kz-border",
      regionName: "新疆-哈萨克斯坦接壤段",
      bbox: [79.5, 42.5, 88.0, 49.0],
    },
  },
  // 后续可扩展：中俄边境、中朝边境、台海等
];

const DEFAULT_FIRE_REGION = {
  regionId: "unspecified-border",
  regionName: "未指定边境管段",
  bbox: [79.5, 42.5, 88.0, 49.0] as [number, number, number, number],
};

// 推断订阅关联的工具类型
// fire-investigation-scenario 优先级高于 fire-detector：命中"火情/火灾 + 研判/边境/管段/接壤/智能"
// 走订阅触发的完整研判 scenario（scheduler 创新 task → Planner/Router 写死 plan/actions）
function inferSubscribedToolType(goal: string): string {
  const g = goal.toLowerCase();
  const hasFire = g.includes("火灾") || g.includes("火情") || g.includes("燃烧");
  const hasInvestigation =
    g.includes("研判") ||
    g.includes("边境") ||
    g.includes("管段") ||
    g.includes("接壤") ||
    g.includes("智能");
  if (hasFire && hasInvestigation) return "fire-investigation-scenario";
  if (hasFire) return "fire-detector";
  if (g.includes("日报") || g.includes("周报") || g.includes("报告")) return "daily_report";
  if (g.includes("卫星") || g.includes("遥感") || g.includes("影像")) return "satellite";
  if (g.includes("海域") || g.includes("船舶")) return "maritime";
  if (g.includes("新闻") || g.includes("报道") || g.includes("舆情") || g.includes("动态")) return "news";
  if (g.includes("监测") || g.includes("预警")) return "intelligent_qa";
  return "daily_report";
}

// 推断订阅工具的执行参数
function inferSubscribedToolParams(goal: string, toolType: string): Record<string, unknown> {
  const g = goal.toLowerCase();
  switch (toolType) {
    case "fire-investigation-scenario": {
      const matched = FIRE_REGION_PRESETS.find((p) => p.match(g));
      const preset = matched?.preset || DEFAULT_FIRE_REGION;
      return {
        scenario: "fire-investigation",
        regionId: preset.regionId,
        regionName: preset.regionName,
        bbox: preset.bbox,
        query: goal,
      };
    }
    case "daily_report":
      return {
        report_type: g.includes("设备") ? "buckle" : g.includes("预警") ? "event" : "all",
      };
    case "satellite":
      return {
        query: goal,
        location: g.includes("东海") ? "东海" : g.includes("南海") ? "南海" : "",
      };
    case "maritime": {
      const knownSeas = [
        "渤海", "黄海", "东海", "台湾海峡", "南海", "北部湾",
        "日本海", "菲律宾海", "鄂霍次克海", "西太平洋",
        "马六甲海峡", "印度洋北部", "印度洋中部", "孟加拉湾", "阿拉伯海",
        "波斯湾", "红海", "亚丁湾", "地中海东部", "地中海西部", "苏伊士运河",
      ];
      for (const sea of knownSeas) {
        if (g.includes(sea)) return { region: sea };
      }
      return { region: "南海" };
    }
    case "news":
      return {
        query: goal,
        region: g.includes("东海") ? "东海" : g.includes("南海") ? "南海" : g.includes("台海") ? "台海" : "",
        timeRange: g.includes("今日") || g.includes("今天") ? "1d" : "7d",
      };
    default:
      return { query: goal };
  }
}

// 推断用户可能想要什么工具（用于 requirement 记录）
function inferSuggestedTool(goal: string): string {
  const g = goal.toLowerCase();
  if (g.includes("预测") || g.includes("模型")) return "predictive_analytics";
  if (g.includes("接入") || g.includes("集成") || g.includes("平台")) return "external_integration";
  if (g.includes("可视化") || g.includes("图表")) return "advanced_visualization";
  if (g.includes("导出") || g.includes("下载") || g.includes("报表")) return "data_export";
  return "unknown";
}

// 东海油污溯源测试场景：写死返回，便于联调
function isOilSpillTracingQuery(query: string): boolean {
  return query.includes("海面疑似油污痕迹") && query.includes("AIS轨迹");
}

function buildOilSpillTracingActions(): Action[] {
  const actions = [
    {
      id: "action-1",
      subtaskId: "subtask-1",
      type: "region-mark",
      name: "标记中国东海区域",
      description: "按东海标准海域边界框选区域，建立空间基准",
      params: {
        regionName: "东海",
        bbox: [117.0, 23.0, 131.0, 33.5],
      },
      gisHints: {
        objectType: "region",
        layerOps: [
          {
            op: "add",
            geomType: "polygon",
            style: {
              fill: "rgba(0,80,200,0.18)",
              stroke: "#1d4ed8",
              strokeWidth: 2,
            },
            label: "中国东海",
          },
        ],
        popups: [],
      },
      dependsOn: [],
      notes: "",
    },
    {
      id: "action-2",
      subtaskId: "subtask-2",
      type: "satellite",
      name: "天基影像与油膜识别",
      description: "由天基系统检索 SAR 影像并完成油膜 AI 识别后推送结果",
      params: {
        query: "东海区域 SAR 影像油膜 AI 识别",
        detectOilSpill: true,
        bbox: "REF:action-1.params.bbox",
        timeRange: {
          from: "2026-05-08T10:53:42Z",
          to: "2026-05-11T10:53:42Z",
        },
        productHints: ["SAR", "oilFilmAI"],
      },
      gisHints: {
        objectType: "oilFilm",
        layerOps: [
          {
            op: "add",
            geomType: "raster",
            style: { tint: "rgba(173,216,230,0.5)" },
            label: "SAR 影像",
          },
          {
            op: "add",
            geomType: "polygon",
            style: { fill: "rgba(255,200,0,0.45)", stroke: "#f59e0b" },
            label: "疑似油膜区域",
          },
        ],
        popups: [
          {
            trigger: "onComplete",
            title: "疑似油膜",
            content: "油膜面积/中心点坐标待回填",
          },
        ],
      },
      dependsOn: ["action-1"],
      notes: "天基系统独立完成识别后推送结果，智能体不参与影像处理",
    },
    {
      id: "action-3",
      subtaskId: "subtask-3",
      type: "weather-fetch",
      name: "获取气象数据",
      description: "拉取油膜形成时段风/流参数",
      params: {
        region: "东海油膜片区",
        timeRange: {
          from: "2026-05-08T10:53:42Z",
          to: "2026-05-11T10:53:42Z",
        },
        vars: ["wind", "current"],
      },
      gisHints: {
        objectType: "weather",
        layerOps: [
          {
            op: "add",
            geomType: "vector-field",
            style: { color: "#06b6d4" },
            label: "风/流矢量",
          },
        ],
        popups: [
          {
            trigger: "onComplete",
            title: "气象参数",
            content: "风速/风向/洋流流向/流速",
          },
        ],
      },
      dependsOn: ["action-2"],
      notes: "",
    },
    {
      id: "action-4",
      subtaskId: "subtask-4",
      type: "oil-drift",
      name: "油污漂移反推",
      description: "结合油膜与气象反推漂移路径与排污时间",
      params: {
        oilFilmGeom: "REF:action-2.output.oilFilmGeom",
        weather: "REF:action-3.output",
        imageCapturedAt: "REF:action-2.output.capturedAt",
      },
      gisHints: {
        objectType: "discharge",
        layerOps: [
          {
            op: "add",
            geomType: "polyline",
            style: { stroke: "#f97316", strokeWidth: 2, dash: "6 4" },
            label: "油污漂移路径",
          },
          {
            op: "add",
            geomType: "point",
            style: { fill: "#dc2626", radius: 6 },
            label: "排污原点",
          },
        ],
        popups: [
          {
            trigger: "onComplete",
            title: "排污原点",
            content: "排污原点坐标 / 排污时间区间",
          },
        ],
      },
      dependsOn: ["action-2", "action-3"],
      notes: "",
    },
    {
      id: "action-5",
      subtaskId: "subtask-5",
      type: "ais-fetch",
      name: "拉取 AIS 轨迹",
      description: "获取近 72 小时东海全域船舶 AIS 轨迹",
      params: {
        bbox: "REF:action-1.params.bbox",
        timeRange: {
          from: "2026-05-08T10:53:42Z",
          to: "2026-05-11T10:53:42Z",
        },
      },
      gisHints: {
        objectType: "ship",
        layerOps: [
          {
            op: "add",
            geomType: "polyline",
            style: { stroke: "#9ca3af", dash: "2 4" },
            label: "AIS 历史轨迹",
          },
          {
            op: "add",
            geomType: "point",
            style: { fill: "#60a5fa", radius: 3 },
            label: "在航船舶",
          },
        ],
        popups: [],
      },
      dependsOn: ["action-1"],
      notes: "依赖关系上可与 action-2/3/4 并行执行以缩短整体耗时",
    },
    {
      id: "action-6",
      subtaskId: "subtask-6",
      type: "ais-match-suspects",
      name: "匹配途经船舶",
      description: "排污原点±1km × 排污时间区间双重匹配",
      params: {
        originPoint: "REF:action-4.output.originPoint",
        timeWindow: "REF:action-4.output.timeWindow",
        buffer: { kmX: 1, kmY: 1 },
        aisSource: "REF:action-5.output",
      },
      gisHints: {
        objectType: "ship",
        layerOps: [
          {
            op: "update",
            target: "AIS 历史轨迹",
            style: { opacity: 0.25 },
          },
          {
            op: "add",
            geomType: "polyline",
            style: { stroke: "#1e40af", strokeWidth: 2 },
            label: "匹配船舶轨迹",
          },
          {
            op: "add",
            geomType: "point",
            style: { fill: "#3b82f6", radius: 5, blink: true },
            label: "匹配船舶",
          },
        ],
        popups: [
          {
            trigger: "onSelect",
            title: "船舶详情",
            content: "MMSI/船型/停留时长",
          },
        ],
      },
      dependsOn: ["action-4", "action-5"],
      notes: "",
    },
    {
      id: "action-7",
      subtaskId: "subtask-7",
      type: "ais-suspect-ranking",
      name: "嫌疑船舶排序",
      description: "异常筛选 + 加权打分 + 分级",
      params: {
        candidates: "REF:action-6.output.matchedShips",
        originPoint: "REF:action-4.output.originPoint",
        scoreWeights: { distance: 40, dwellTime: 30, anomaly: 30 },
      },
      gisHints: {
        objectType: "ship",
        layerOps: [
          {
            op: "update",
            target: "匹配船舶轨迹",
            styleByTier: {
              primary: { stroke: "#dc2626" },
              secondary: { stroke: "#f97316" },
              general: { stroke: "#facc15" },
            },
          },
          {
            op: "update",
            target: "匹配船舶",
            styleByTier: {
              primary: { fill: "#dc2626", label: "首要嫌疑" },
              secondary: { fill: "#f97316" },
              general: { fill: "#facc15" },
            },
          },
        ],
        popups: [
          {
            trigger: "onComplete",
            title: "嫌疑排序",
            content: "排序清单 / 得分 / 判定依据",
          },
        ],
      },
      dependsOn: ["action-6"],
      notes: "",
    },
  ];
  return actions as unknown as Action[];
}

// ========== 订阅触发的火情研判 scenario：写死 actions ==========

function isScheduledFireInvestigation(query: string): boolean {
  return query.startsWith("[订阅触发] 火情研判");
}

function resolveFireRegionFromQuery(query: string): {
  regionId: string;
  regionName: string;
  bbox: [number, number, number, number];
} {
  const g = query.toLowerCase();
  if (g.includes("新疆") && (g.includes("哈萨克") || g.includes("接壤"))) {
    return {
      regionId: "xj-kz-border",
      regionName: "新疆-哈萨克斯坦接壤段",
      bbox: [79.5, 42.5, 88.0, 49.0],
    };
  }
  return {
    regionId: "unspecified-border",
    regionName: "未知区域",
    bbox: [79.5, 42.5, 88.0, 49.0],
  };
}

function buildFireInvestigationActions(queryText?: string): Action[] {
  const region = resolveFireRegionFromQuery(queryText || "");

  const actions = [
    {
      id: "action-1",
      subtaskId: "subtask-1",
      type: "news",
      name: "互联网火情线索核查",
      description: "检索目标区域近期公开新闻源中的火情相关报道",
      params: {
        query: `${region.regionName} 火情`,
        fireScenario: true,
        region: region.regionName,
        timeRange: "7d",
      },
      gisHints: { objectType: "info", layerOps: [], popups: [] },
      dependsOn: [],
      notes: "",
    },
    {
      id: "action-2",
      subtaskId: "subtask-2",
      type: "satellite",
      name: "天基遥感影像获取与火情解译",
      description: "调用天基信息服务系统获取遥感影像并完成火点 AI 识别",
      params: {
        query: `${region.regionName} 火情遥感影像`,
        fireScenario: true,
        region: region.regionName,
        bbox: region.bbox,
      },
      gisHints: {
        objectType: "imagery",
        layerOps: [
          {
            op: "add",
            geomType: "raster",
            style: { tint: "rgba(255,100,0,0.4)" },
            label: "火情遥感影像",
          },
          {
            op: "add",
            geomType: "polygon",
            style: { fill: "rgba(255,0,0,0.3)", stroke: "#ff0000" },
            label: "烧毁区域",
          },
        ],
        popups: [
          {
            trigger: "onComplete",
            title: "火情解译",
            content: "火点坐标 / 烧毁面积 / 置信度",
          },
        ],
      },
      dependsOn: ["action-1"],
      notes: "",
    },
    {
      id: "action-3",
      subtaskId: "subtask-3",
      type: "fire-detector",
      name: "地图展示火情研判结果",
      description: "在 3D 地球引擎上展示火情点位、影响范围、风险等级",
      params: {
        region: region.regionName,
        bbox: region.bbox,
        fromScenario: true,
      },
      gisHints: {
        objectType: "fire",
        layerOps: [
          {
            op: "add",
            geomType: "point",
            style: { fill: "#ff0000", radius: 8, pulse: true },
            label: "火情中心",
          },
          {
            op: "add",
            geomType: "polygon",
            style: {
              fill: "rgba(255,0,0,0.25)",
              stroke: "#ff4444",
              strokeWidth: 2,
            },
            label: "影响范围",
          },
        ],
        popups: [
          {
            trigger: "onComplete",
            title: "火情研判",
            content: "风险等级 / 烧毁面积 / 蔓延方向",
          },
        ],
      },
      dependsOn: ["action-2"],
      notes: "",
    },
    {
      id: "action-4",
      subtaskId: "subtask-4",
      type: "border-push",
      name: "标准化封装推送边防平台",
      description: "将火情研判事件标准化封装并推送至边防应用平台",
      params: {
        targetPlatform: "border-defense",
        scenario: "fire-investigation",
        region: region.regionName,
        regionId: region.regionId,
      },
      gisHints: { objectType: "push", layerOps: [], popups: [] },
      dependsOn: ["action-3"],
      notes: "",
    },
  ];

  return actions as unknown as Action[];
}

// ========== 洪涝灾后评估 scenario：写死 actions ==========

function isFloodQuery(query: string): boolean {
  const q = query.toLowerCase();
  return q.includes("暴雨") || q.includes("洪涝") || q.includes("洪水") || q.includes("淹没") || q.includes("石门县") || q.includes("张家渡");
}

function buildFloodActions(queryText?: string): Action[] {
  const regionName = "石门县";
  const fullRegionName = "湖南石门县";

  const actions = [
    {
      id: "action-1",
      subtaskId: "subtask-1",
      type: "news",
      name: "查询官网暴雨权威信息",
      description: "访问国家气象信息中心、湖南省气象局、水利部水文信息官网获取权威暴雨参数",
      params: {
        query: `${fullRegionName} 暴雨洪涝`,
        floodScenario: true,
        region: fullRegionName,
        timeRange: "7d",
      },
      gisHints: { objectType: "info", layerOps: [], popups: [] },
      dependsOn: [],
      notes: "",
    },
    {
      id: "action-2",
      subtaskId: "subtask-2",
      type: "region-mark",
      name: "定位石门县洪涝评估区域",
      description: "依据暴雨信息在GIS上锁定石门县澧水/渫水流域评估范围",
      params: {
        region: regionName,
        query: `${fullRegionName} 洪涝评估`,
      },
      gisHints: {
        objectType: "region",
        layerOps: [
          {
            op: "add",
            geomType: "polygon",
            style: {
              fill: "rgba(37, 99, 235, 0.12)",
              stroke: "#2563EB",
              strokeWidth: 3,
            },
            label: `${fullRegionName} 评估区域`,
          },
        ],
        popups: [
          {
            trigger: "onComplete",
            title: "评估区域",
            content: "石门县澧水/渫水流域 | 张家渡大桥 110.89°E, 29.88°N",
          },
        ],
      },
      dependsOn: ["action-1"],
      notes: "",
    },
    {
      id: "action-3",
      subtaskId: "subtask-3",
      type: "satellite",
      name: "获取天基暴雨前最新历史影像",
      description: "检索石门县暴雨前最新存档遥感影像",
      params: {
        query: `${fullRegionName} 暴雨前历史影像`,
        floodScenario: true,
        phase: "pre",
        region: fullRegionName,
      },
      gisHints: {
        objectType: "imagery",
        layerOps: [
          {
            op: "add",
            geomType: "raster",
            style: { tint: "rgba(59, 130, 246, 0.3)" },
            label: "暴雨前影像",
          },
        ],
        popups: [
          {
            trigger: "onComplete",
            title: "暴雨前影像",
            content: "高分六号 | 分辨率 1m | 采集时间 2026-05-16",
          },
        ],
      },
      dependsOn: ["action-2"],
      notes: "",
    },
    {
      id: "action-4",
      subtaskId: "subtask-4",
      type: "satellite",
      name: "获取天基暴雨后最新影像",
      description: "提交洪涝应急成像需求并获取暴雨后最新影像",
      params: {
        query: `${fullRegionName} 暴雨后应急影像`,
        floodScenario: true,
        phase: "post",
        region: fullRegionName,
      },
      gisHints: {
        objectType: "imagery",
        layerOps: [
          {
            op: "add",
            geomType: "raster",
            style: { tint: "rgba(239, 68, 68, 0.3)" },
            label: "暴雨后影像",
          },
        ],
        popups: [
          {
            trigger: "onComplete",
            title: "暴雨后影像",
            content: "高分六号 | 分辨率 1m | 应急成像",
          },
        ],
      },
      dependsOn: ["action-2"],
      notes: "依赖关系上可与 action-3 并行执行，但 demo 保持串行以控制节奏",
    },
    {
      id: "action-5",
      subtaskId: "subtask-5",
      type: "flood-evaluation",
      name: "洪涝灾后评估与GIS回显",
      description: "暴雨前后影像AI对比解译，淹没识别与灾后灾情统计评估",
      params: {
        region: fullRegionName,
        query: queryText || `${fullRegionName} 洪涝灾后评估`,
      },
      gisHints: {
        objectType: "damage",
        layerOps: [
          {
            op: "add",
            geomType: "polygon",
            style: { fill: "rgba(220, 38, 38, 0.35)", stroke: "#DC2626" },
            label: "重度淹没区",
          },
          {
            op: "add",
            geomType: "polygon",
            style: { fill: "rgba(245, 158, 11, 0.35)", stroke: "#F59E0B" },
            label: "中度淹没区",
          },
          {
            op: "add",
            geomType: "polygon",
            style: { fill: "rgba(250, 204, 21, 0.35)", stroke: "#FACC15" },
            label: "轻度淹没区",
          },
        ],
        popups: [
          {
            trigger: "onComplete",
            title: "灾后评估",
            content: "淹没面积 7.5 km² | 桥梁损毁 1 座 | 道路中断 4 条 | 房屋受淹 12 栋",
          },
        ],
      },
      dependsOn: ["action-3", "action-4"],
      notes: "",
    },
  ];

  return actions as unknown as Action[];
}

// ========== 地震灾后评估 scenario：写死 actions ==========

function isEarthquakeQuery(query: string): boolean {
  const q = query.toLowerCase();
  return q.includes("地震") || q.includes("震后") || q.includes("震中") || q.includes("灾后评估");
}

function buildEarthquakeActions(queryText?: string): Action[] {
  const regionName = "柳州";
  const fullRegionName = "广西柳州市柳南区";

  const actions = [
    {
      id: "action-1",
      subtaskId: "subtask-1",
      type: "news",
      name: "查询官网地震基础信息",
      description: "访问中国地震台网中心、广西地震局官网获取权威地震参数",
      params: {
        query: `${fullRegionName} 5.2 级地震`,
        earthquakeScenario: true,
        region: fullRegionName,
        timeRange: "7d",
      },
      gisHints: { objectType: "info", layerOps: [], popups: [] },
      dependsOn: [],
      notes: "",
    },
    {
      id: "action-2",
      subtaskId: "subtask-2",
      type: "region-mark",
      name: "定位柳州柳南区评估区域",
      description: "依据震中参数在GIS上锁定评估范围，红色五角星标记震中",
      params: {
        region: regionName,
        query: `${fullRegionName} 地震评估`,
      },
      gisHints: {
        objectType: "region",
        layerOps: [
          {
            op: "add",
            geomType: "polygon",
            style: {
              fill: "rgba(220, 38, 38, 0.12)",
              stroke: "#DC2626",
              strokeWidth: 3,
            },
            label: `${fullRegionName} 评估区域`,
          },
          {
            op: "add",
            geomType: "point",
            style: { fill: "#DC2626", radius: 10, pulse: true },
            label: "震中",
          },
        ],
        popups: [
          {
            trigger: "onComplete",
            title: "震中位置",
            content: "109.26°E, 24.38°N | 震级 5.2 | 深度 8km",
          },
        ],
      },
      dependsOn: ["action-1"],
      notes: "",
    },
    {
      id: "action-3",
      subtaskId: "subtask-3",
      type: "satellite",
      name: "获取天基震前最新历史影像",
      description: "检索柳南区震前最新存档遥感影像",
      params: {
        query: `${fullRegionName} 震前历史影像`,
        earthquakeScenario: true,
        phase: "pre",
        region: fullRegionName,
      },
      gisHints: {
        objectType: "imagery",
        layerOps: [
          {
            op: "add",
            geomType: "raster",
            style: { tint: "rgba(59, 130, 246, 0.3)" },
            label: "震前影像",
          },
        ],
        popups: [
          {
            trigger: "onComplete",
            title: "震前影像",
            content: "高分六号 | 分辨率 1m | 采集时间 2026-05-17",
          },
        ],
      },
      dependsOn: ["action-2"],
      notes: "",
    },
    {
      id: "action-4",
      subtaskId: "subtask-4",
      type: "satellite",
      name: "获取天基震后最新影像",
      description: "提交震后应急成像需求并获取震后最新影像",
      params: {
        query: `${fullRegionName} 震后应急影像`,
        earthquakeScenario: true,
        phase: "post",
        region: fullRegionName,
      },
      gisHints: {
        objectType: "imagery",
        layerOps: [
          {
            op: "add",
            geomType: "raster",
            style: { tint: "rgba(239, 68, 68, 0.3)" },
            label: "震后影像",
          },
        ],
        popups: [
          {
            trigger: "onComplete",
            title: "震后影像",
            content: "高分六号 | 分辨率 1m | 应急成像",
          },
        ],
      },
      dependsOn: ["action-2"],
      notes: "依赖关系上可与 action-3 并行执行，但 demo 保持串行以控制节奏",
    },
    {
      id: "action-5",
      subtaskId: "subtask-5",
      type: "earthquake-evaluation",
      name: "震后损毁评估与GIS回显",
      description: "震前震后影像AI对比解译，损毁识别与灾后灾情统计评估",
      params: {
        region: fullRegionName,
        query: queryText || `${fullRegionName} 地震灾后评估`,
      },
      gisHints: {
        objectType: "damage",
        layerOps: [
          {
            op: "add",
            geomType: "polygon",
            style: { fill: "rgba(220, 38, 38, 0.35)", stroke: "#DC2626" },
            label: "重度损毁区",
          },
          {
            op: "add",
            geomType: "polygon",
            style: { fill: "rgba(245, 158, 11, 0.35)", stroke: "#F59E0B" },
            label: "中度损毁区",
          },
          {
            op: "add",
            geomType: "polygon",
            style: { fill: "rgba(250, 204, 21, 0.35)", stroke: "#FACC15" },
            label: "轻度损毁区",
          },
        ],
        popups: [
          {
            trigger: "onComplete",
            title: "灾后评估",
            content: "房屋损毁 127 栋 | 道路中断 8 条 | 滑坡 3 处 | 受灾面积 12.5 km²",
          },
        ],
      },
      dependsOn: ["action-3", "action-4"],
      notes: "",
    },
  ];

  return actions as unknown as Action[];
}

// ========== 硬编码 Action Plans ==========
// 对应 planner classifyIntent 返回 hardcoded=true 的 4 个场景
const HARDCODE_PLANS: Record<string, (query?: string) => Action[]> = {
  fire: buildFireInvestigationActions,
  oil_spill: buildOilSpillTracingActions,
  earthquake: buildEarthquakeActions,
  flood: buildFloodActions,
};

export const routerService: RouterService = {
  decideActions: async (plan, originalQuery, context) => {
    const queryText = originalQuery || plan.goal;

    // 1. 硬编码命中（来自 classifyIntent 的精确匹配）→ 直接返回，跳过 DeepSeek
    const intent = context?.intent as string;
    const isHardcoded = context?.hardcoded === true;
    if (isHardcoded && intent && HARDCODE_PLANS[intent]) {
      console.log(`[Router] Hardcoded plan for intent=${intent}, skipping DeepSeek`);
      return HARDCODE_PLANS[intent](queryText);
    }

    // 2. 订阅意图：快速路径，避免 AI 调用超时阻塞订阅创建
    const hasSubscription =
      queryText.toLowerCase().includes("订阅") ||
      queryText.toLowerCase().includes("定时") ||
      queryText.toLowerCase().includes("自动推送") ||
      queryText.toLowerCase().includes("持续监测") ||
      queryText.toLowerCase().includes("每天早上") ||
      queryText.toLowerCase().includes("每天") ||
      queryText.toLowerCase().includes("每周") ||
      queryText.toLowerCase().includes("日报") ||
      queryText.toLowerCase().includes("周报");

    if (hasSubscription) {
      console.log("[Router] Subscription intent detected, bypassing DeepSeek");
      return mockDecideActions(plan);
    }

    // 3. 其他场景：走 DeepSeek AI Router
    const actions = await callDeepSeekRouter(plan, originalQuery);
    if (actions.length === 0) {
      // DeepSeek 无可用工具 → 复用需求评估提示词判断是否需要提报
      console.log("[Router] DeepSeek returned no actions, evaluating requirement need...");
      try {
        const evaluation = await evaluateRequirementNeed(plan.goal, []);
        if (evaluation.shouldCreate && evaluation.requirements.length > 0) {
          return evaluation.requirements.map((req, i) => ({
            id: `action-${i + 1}`,
            type: "requirement" as ActionType,
            name: req.name,
            description: i === 0 ? evaluation.reason : req.description,
            params: {
              description: req.description,
              reason: evaluation.reason,
              applicationScenario: req.applicationScenario,
              type: req.type,
            },
          }));
        } else {
          return [{
            id: "action-1",
            type: "intelligence" as ActionType,
            name: "通用分析",
            description: evaluation.reason,
            params: { query: plan.goal },
          }];
        }
      } catch (err) {
        console.error("[Router] Requirement evaluation failed:", err);
        return [{
          id: "action-1",
          type: "requirement" as ActionType,
          name: "记录定制需求",
          description: `当前系统暂无匹配工具，已记录需求：${plan.goal.substring(0, 30)}`,
          params: {
            description: plan.goal,
            reason: "用户需求超出当前可用工具能力范围",
            type: 1,
          },
        }];
      }
    }
    return actions;
  },
};
