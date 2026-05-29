#!/usr/bin/env node
/**
 * Planner + Router DeepSeek API 测试脚本（演示版提示词）
 * 用法: node test-planner-router.mjs
 * 流程: 输入 API Key → 输入用户提问 → 调用 Planner → 调用 Router → 输出结果
 */

import readline from "readline";

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-v4-flash"; // 使用 v4 flash 模型

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function callDeepSeek(apiKey, messages, options = {}) {
  const resp = await fetch(DEEPSEEK_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: false,
      ...options,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`DeepSeek API error: ${resp.status} ${text}`);
  }

  const json = await resp.json();
  return json.choices?.[0]?.message?.content || "";
}

// ==================== 工具清单 ====================
const CAPABILITY_LIST_JSON = JSON.stringify(
  {
    capabilities: [
      {
        type: "region-mark",
        name: "区域标记",
        description: "在 Cesium 地图上框选目标范围，返回边界框、中心坐标、cameraView",
        params: {
          region: { type: "string", required: false, default: "中国东海", enum: ["中国东海", "东海", "柳州", "柳州市", "柳南区", "广西柳州市柳南区", "石门", "石门县", "湖南石门", "湖南石门县"] },
        },
      },
      {
        type: "satellite",
        name: "天基遥感",
        description: "获取卫星遥感影像。火灾=火情监测；漏油=SAR油膜检测；地震/洪涝=phase=pre/post获取灾前灾后影像",
        params: {
          query: { type: "string", required: false, default: "未指定查询" },
          fireScenario: { type: "boolean", required: false },
          earthquakeScenario: { type: "boolean", required: false },
          floodScenario: { type: "boolean", required: false },
          detectOilSpill: { type: "boolean", required: false },
          phase: { type: "string", required: false, enum: ["pre", "post"] },
          region: { type: "string", required: false },
          bbox: { type: "array", required: false },
        },
      },
      {
        type: "fire-detector",
        name: "火情识别",
        description: "识别火灾中心点、烧毁区域多边形，生成火情 overlay、mask 图层",
        params: {
          region: { type: "string", required: false, default: "Kensai" },
          query: { type: "string", required: false },
          bbox: { type: "array", required: false },
          fromScenario: { type: "boolean", required: false },
        },
      },
      {
        type: "oil-drift",
        name: "油污漂移反推",
        description: "结合油膜中心与气象参数，反推排污原点，生成漂移路径",
        params: {},
        contextDeps: ["satellite.oilFilmGeom", "weather-fetch.output"],
      },
      {
        type: "ais-fetch",
        name: "AIS 轨迹获取",
        description: "拉取近72小时船舶 AIS 轨迹",
        params: {
          region: { type: "string", required: false, default: "中国东海" },
        },
      },
      {
        type: "ais-match-suspects",
        name: "嫌疑船匹配",
        description: "将嫌疑船名单与 AIS 轨迹进行时空双重匹配",
        params: {},
        contextDeps: ["oil-drift.originPoint", "oil-drift.timeWindow", "ais-fetch.output"],
      },
      {
        type: "ais-suspect-ranking",
        name: "嫌疑船排序",
        description: "按排污概率对候选船舶排序",
        params: {},
        contextDeps: ["ais-match-suspects.matchedShips"],
      },
      {
        type: "maritime",
        name: "海域态势分析",
        description: "拉取 AIS 船舶 + ADS 飞机数据，识别异常航行、风险等级",
        params: {
          region: { type: "string", required: false, default: "南海" },
          query: { type: "string", required: false },
        },
      },
      {
        type: "weather-fetch",
        name: "气象风场获取",
        description: "获取 10×10 网格风场数据（u/v 分量），驱动前端粒子层",
        params: {
          region: { type: "string", required: false, default: "东海油膜片区" },
        },
      },
      {
        type: "earthquake-evaluation",
        name: "地震灾后评估",
        description: "加载 earthquake.geojson，震前震后影像对比，输出损毁多边形",
        params: {
          region: { type: "string", required: false, default: "广西柳州市柳南区" },
          query: { type: "string", required: false },
        },
        contextDeps: ["satellite.pre_earthquake.imageOverlays", "satellite.post_earthquake.imageOverlays"],
      },
      {
        type: "flood-evaluation",
        name: "洪涝灾后评估",
        description: "加载 flood.geojson，洪水前后影像对比，输出淹没区域",
        params: {
          region: { type: "string", required: false, default: "湖南石门县" },
          query: { type: "string", required: false },
        },
        contextDeps: ["satellite.pre_flood.imageOverlays", "satellite.post_flood.imageOverlays"],
      },
      {
        type: "news",
        name: "新闻查询",
        description: "获取权威通报或新闻摘要",
        params: {
          query: { type: "string", required: false, default: "未指定查询" },
          region: { type: "string", required: false },
          timeRange: { type: "string", required: false, default: "7d" },
          fireScenario: { type: "boolean", required: false },
          earthquakeScenario: { type: "boolean", required: false },
          floodScenario: { type: "boolean", required: false },
        },
      },
    ],
  },
  null,
  2
);

// ==================== Planner Prompt（演示版）====================
function buildPlannerPrompt(userQuery) {
  return `你是数智融合智能体应用平台的 Planner。
你的输入包含 userQuery 和 capabilities。
你的任务是把用户提问拆成可执行计划，并明确指出哪些部分当前工具可以完成，哪些部分当前工具无法完成。
你只负责规划，不调用工具，不编造工具，不输出 JSON 以外的文字。

## 可用工具

${CAPABILITY_LIST_JSON}

## 规划原则

1. 先理解用户真正想完成什么，再拆成若干子任务。
2. 子任务可以来自预设场景，也可以来自用户提出的开放问题。
3. capability 必须严格使用 capabilities[].type 中存在的工具类型。
4. 如果某个子任务没有合适工具，不要强行匹配到相似工具，使用 capability=null，并标记 supportStatus="unsupported"。
5. 如果某个子任务只有一部分能完成，标记 supportStatus="partial"，并说明能完成什么、缺什么。
6. 如果参数不完整但可以使用默认值，直接使用默认值。
7. 如果参数缺失且无法安全推断，标记 supportStatus="needs_clarification"。
8. 如果区域不在 region-mark 的 enum 范围内，但 news 可以接收自由 region，可以只规划 news，并把地图标记或遥感查询标记为 unsupported。
9. 如果用户问数量、分布、轨迹，优先寻找数据获取类工具。
10. 如果用户问风险、异常、态势，优先寻找分析类工具。
11. 用户提到海域时，不要自动进入漏油流程；只有出现油污、油膜、排污、SAR 油膜检测、疑似排污船时才进入漏油流程。
12. 用户提到灾害时，不要自动规划所有灾害工具，只规划用户问题真正需要的步骤。
13. 地震/洪涝影像对比任务需要 satellite 的 pre/post 两步。
14. 漏油追责任务需要 region-mark、satellite(detectOilSpill=true)、weather-fetch、oil-drift、ais-fetch、ais-match-suspects、ais-suspect-ranking。
15. 火灾监测任务通常需要 region-mark、satellite(fireScenario=true)、fire-detector、weather-fetch、news。
16. 单纯新闻、通报、报道查询只规划 news。
17. 单纯地图定位只规划 region-mark。
18. 单纯船舶数量、船舶分布、AIS 轨迹查询，优先规划 region-mark 和 ais-fetch。
19. 如果用户要求预测、因果判断、历史数据库检索、跨区域实时监控、下载视频、生成报告等当前工具没有覆盖的任务，把这些步骤列入 unsupportedSubtasks。
20. Planner 可以输出 partial_planned，让演示展示系统能做一部分，并清楚说明做不了哪部分。

## 参数解析规则

1. 每个 subtask 必须输出 semanticParams 和 params。
2. semanticParams 记录从用户提问中解析出的全部语义参数，包括区域、时间、对象类型、筛选条件、统计维度、预测目标、输出格式等。
3. params 只填写当前 capability.params 中声明过的字段。
4. 如果 semanticParams 中存在当前工具无法承接的字段，不要硬塞进 params。
5. 如果这些字段影响用户最终目标，supportStatus 标记为 "partial"，并在 unsupportedParamNeeds 中列出。
6. 如果整个子任务都无法找到工具承接，capability=null，supportStatus="unsupported"。
7. 如果用户说"现在""实时""今天"等时间词，而工具只支持固定时间窗口，需要把原始时间写入 semanticParams，并在 unsupportedParamNeeds 中说明工具时间参数不支持。
8. 如果用户要求"按类型筛选""按国籍统计""按风险排序""导出报告"等功能，而当前工具没有对应参数或聚合工具，需要写入 unsupportedParamNeeds 或 unsupportedSubtasks。

## 支持状态

supportStatus 只能使用："supported" | "partial" | "unsupported" | "needs_clarification"
status 只能使用："planned" | "partial_planned" | "needs_clarification" | "unsupported"

当所有子任务都 supported，status="planned"。
当至少一个子任务 supported，且至少一个子任务 unsupported 或 partial，status="partial_planned"。
当没有任何可执行工具，但能说明缺什么工具，status="unsupported"。
当用户缺少必须确认的信息，且无法使用默认值，status="needs_clarification"。

## 场景识别规则

用户提到火灾、山火、火点、火情、烟羽、烧毁范围，scenarioType 使用 "fire"。
用户提到漏油、油污、油膜、排污、SAR 油膜检测、疑似排污船，scenarioType 使用 "oil_spill"。
用户提到地震、震后、震损、建筑损毁、震前震后对比，scenarioType 使用 "earthquake"。
用户提到洪水、洪涝、淹没、暴雨后、桥梁损毁、道路中断，scenarioType 使用 "flood"。
用户提到船舶、AIS、暗船、异常航行、海域风险，scenarioType 使用 "maritime"。
用户提到新闻、通报、报道、舆情，scenarioType 使用 "news"。
用户提到开放查询、统计、预测、报告，但没有落入预设灾种，scenarioType 使用 "general_query"。
无法判断时，scenarioType 使用 "unknown"。

## 输出格式

必须返回 JSON，不要其他内容：

{
  "status": "planned | partial_planned | needs_clarification | unsupported",
  "taskId": "TASK-YYYYMMDD-001",
  "scenarioType": "fire | oil_spill | earthquake | flood | maritime | news | general_query | unknown",
  "goal": "用一句话描述用户要完成的任务",
  "entities": {
    "region": "区域名称或 null",
    "timeRange": "时间范围或 null",
    "eventType": "事件类型或 null",
    "keywords": ["关键词"],
    "missingFields": []
  },
  "executionMode": "dag",
  "subtasks": [
    {
      "id": "subtask-1",
      "name": "步骤名称",
      "capability": "工具类型或 null",
      "supportStatus": "supported | partial | unsupported | needs_clarification",
      "semanticParams": {
        "region": "用户语义区域或 null",
        "timeRange": "用户语义时间或 null",
        "objectType": "用户关心的对象类型或 null",
        "filters": {},
        "groupBy": [],
        "predictionTarget": null,
        "outputFormat": null
      },
      "params": {},
      "unsupportedParamNeeds": [
        {
          "param": "参数名",
          "value": "用户请求的值",
          "reason": "当前工具为什么无法承接该参数"
        }
      ],
      "dependsOn": [],
      "expectedResult": "这个步骤完成后应该产出什么",
      "gisInteraction": "地图上会发生什么；如果无地图交互则写 null",
      "objectType": "region | imagery | overlay | mask | trajectory | windField | article | ranking | evaluation | statistic | null",
      "failureReason": null,
      "requiredMissingCapability": null
    }
  ],
  "unsupportedSubtasks": [
    {
      "id": "unsupported-1",
      "name": "无法执行的任务",
      "reason": "为什么当前工具无法完成",
      "requiredCapability": "需要什么工具或数据",
      "suggestedFallback": "可以用当前工具完成的替代信息"
    }
  ],
  "decisionSummary": {
    "intent": "识别到的用户意图",
    "plan": "说明哪些步骤可执行，哪些步骤缺工具或缺参数",
    "riskLevelHint": "高危 | 中危 | 低危 | 未知"
  },
  "finalEvent": {
    "type": "事件类型",
    "title": "给前端或任务面板展示的任务标题",
    "gisReplayObjectTypes": ["region", "imagery", "trajectory"]
  }
}

## 用户提问

${userQuery}`;
}

// ==================== Router Prompt（演示版）====================
function buildRouterPrompt(planJson, userQuery) {
  return `你是数智融合智能体应用平台的 Router。
你的输入包含 Planner 输出和 capability list。
你的任务是把 Planner 中 supportStatus="supported" 或 "partial" 且 capability 不为空的 subtasks 转换成可执行 actions。
你只负责路由、参数校验、依赖映射、失败归因。
你不重新规划任务，不新增 Planner 没有安排的步骤，不把 unsupported 子任务强行映射到其他工具，不输出 JSON 以外的文字。

## 可用工具

${CAPABILITY_LIST_JSON}

## Planner 输出

${planJson}

## 路由规则

1. 只读取 Planner 输出中的 subtasks。
2. supportStatus="supported" 且 capability 不为空的 subtask 必须转换成 action。
3. supportStatus="partial" 且 capability 不为空的 subtask 可以转换成 action，同时在 warnings 中说明只能完成部分能力。
4. supportStatus="unsupported" 或 capability=null 的 subtask 不生成 action，进入 blockedActions。
5. supportStatus="needs_clarification" 的 subtask 不生成 action，进入 blockedActions。
6. action.type 必须严格等于 subtask.capability。
7. action.type 必须存在于 capability list 的 capabilities[].type 中。
8. action.params 只能包含对应 capability.params 中声明过的字段。
9. 如果 subtask.params 已经给出合法参数，优先原样使用。
10. 如果 subtask.params 缺少可选参数，可以使用 capability list 中的 default。
11. 如果参数值不在 enum 范围内，先尝试别名归一化。
12. 如果参数无法归一化，该 action 不执行，进入 blockedActions。
13. dependsOn 必须把 subtask id 映射成对应 action id。
14. 如果某个 action 依赖的 subtask 被 blocked，该 action 也要 blocked，blockedReason 使用 "DEPENDENCY_BLOCKED"。
15. action id 按可执行 action 顺序生成，格式为 action-1、action-2、action-3。
16. action.sourceSubtaskId 必须记录原 subtask id。
17. 如果 subtask.params 中引用 "\${subtask-1.output.bbox}"，router 需要转换成对应 "\${action-1.output.bbox}"。
18. 如果引用的 subtask 没有生成 action，该 action 进入 blockedActions。
19. 带 contextDeps 的工具不需要手动塞入上下文参数，只需要正确设置 dependsOn。
20. 地震或洪涝场景中，satellite action 必须带 phase="pre" 或 phase="post"。
21. 火灾场景中，satellite action 必须带 fireScenario=true。
22. 漏油场景中，satellite action 必须带 detectOilSpill=true。
23. news 工具如果没有 timeRange，默认使用 "7d"。
24. 如果没有任何 action 可执行，status="no_routable_action"。
25. 如果有 action 可执行，同时存在 blockedActions，status="partial_routed"。
26. 如果所有 supported subtasks 都成功路由，status="routed"。

## 语义参数校验规则

1. Router 必须同时读取 subtask.semanticParams 和 subtask.params。
2. params 中的字段必须存在于 capability.params。
3. semanticParams 中如果出现 capability.params 不支持的字段，Router 不得把它塞进 params。
4. 如果 unsupportedParamNeeds 不为空，并且该 subtask 仍有可执行 params，则生成 action，同时把无法承接的语义参数写入 blockedActions 或 warnings。
5. 如果 unsupportedParamNeeds 中的字段会改变工具结果的含义，例如 shipType、timeRange、groupBy、predictionTarget，则整体路由状态标记为 partial_routed。
6. 如果 params 中出现 capability.params 未声明字段，直接阻塞该 action，blockedReason="PARAM_NOT_SUPPORTED"。
7. 如果 semanticParams 中出现当前工具无法承接的字段，但 Planner 没有写 unsupportedParamNeeds，Router 需要补充 warning。
8. 如果用户语义要求实时数据，但工具描述只支持固定窗口，例如近72小时，Router 需要保留可执行 action，并把实时语义需求写入 blockedActions。

## 参数归一化规则

区域别名：
"东海" -> "中国东海"
"中国东海" -> "中国东海"
"柳州" -> "柳州"
"柳州市" -> "柳州市"
"柳南区" -> "广西柳州市柳南区"
"广西柳州市柳南区" -> "广西柳州市柳南区"
"石门" -> "湖南石门县"
"石门县" -> "湖南石门县"
"湖南石门" -> "湖南石门县"
"湖南石门县" -> "湖南石门县"
"Kensai" -> "Kensai"

phase 只能是："pre" | "post"
布尔参数只能是：true | false

## blockedReason 类型

"TOOL_NOT_AVAILABLE"
"PARAM_OUT_OF_ENUM"
"PARAM_NOT_SUPPORTED"
"SEMANTIC_PARAM_UNSUPPORTED"
"REQUIRED_PARAM_MISSING"
"DEPENDENCY_BLOCKED"
"CONTEXT_DEP_MISSING"
"SCENARIO_NOT_SUPPORTED"
"NEEDS_CLARIFICATION"

## 输出格式

必须返回 JSON，不要其他内容：

{
  "status": "routed | partial_routed | no_routable_action | invalid_plan",
  "taskId": "来自 Planner 的 taskId",
  "scenarioType": "来自 Planner 的 scenarioType",
  "actions": [
    {
      "id": "action-1",
      "sourceSubtaskId": "subtask-1",
      "type": "region-mark",
      "name": "步骤名称",
      "description": "步骤描述",
      "params": {
        "region": "中国东海"
      },
      "semanticParams": {
        "region": "东海"
      },
      "dependsOn": [],
      "expectedOutput": "期望产出",
      "gisInteraction": "GIS 交互说明",
      "objectType": "region"
    }
  ],
  "blockedActions": [
    {
      "sourceSubtaskId": "subtask-3",
      "name": "无法执行的步骤",
      "requestedCapability": null,
      "blockedReason": "TOOL_NOT_AVAILABLE",
      "message": "当前 capability list 中没有对应工具或参数。",
      "requiredCapability": "需要的工具或数据",
      "suggestedFallback": "可替代方案"
    }
  ],
  "dependencyMap": {
    "subtask-1": "action-1"
  },
  "errors": [],
  "warnings": []
}`;
}

// ==================== 提取 JSON ====================
function extractJson(text) {
  // 1. 先尝试提取 markdown 代码块
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  // 2. 尝试直接找 JSON 对象/数组
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) return objMatch[0];
  return text.trim();
}

// ==================== 主流程 ====================
async function main() {
  console.log("=== Planner + Router DeepSeek 测试（演示版提示词）===\n");

  const apiKey = await ask("请输入 DeepSeek API Key: ");
  if (!apiKey.trim()) {
    console.log("API Key 不能为空");
    rl.close();
    return;
  }

  const userQuery = await ask("请输入用户提问（或按回车使用默认）: ");
  const query = userQuery.trim() || "查询一下东海现在有多少货船，按国籍统计一下";

  console.log("\n--- Step 1: 调用 Planner ---");
  console.log(`用户提问: ${query}`);

  const plannerMessages = [
    { role: "system", content: "你是一个任务规划专家，只返回 JSON。" },
    { role: "user", content: buildPlannerPrompt(query) },
  ];

  let planRaw;
  try {
    planRaw = await callDeepSeek(apiKey, plannerMessages, {
      reasoning_effort: "high",
    });
    console.log("\nPlanner raw output:\n", planRaw.slice(0, 1200), "...\n");
  } catch (err) {
    console.error("Planner 调用失败:", err.message);
    rl.close();
    return;
  }

  // 提取 JSON
  const planJsonStr = extractJson(planRaw);
  let plan;
  try {
    plan = JSON.parse(planJsonStr);
    console.log("Planner parsed successfully.");
    console.log("  status:", plan.status);
    console.log("  scenarioType:", plan.scenarioType);
    console.log("  goal:", plan.goal);
    console.log("  subtasks:", plan.subtasks?.length || 0);
    console.log("  unsupportedSubtasks:", plan.unsupportedSubtasks?.length || 0);
  } catch (err) {
    console.error("Planner 输出解析失败:", err.message);
    console.log("原始输出:\n", planRaw);
    rl.close();
    return;
  }

  console.log("\n--- Step 2: 调用 Router ---");

  const routerMessages = [
    { role: "system", content: "你是一个工具路由专家，只返回 JSON。" },
    { role: "user", content: buildRouterPrompt(JSON.stringify(plan, null, 2), query) },
  ];

  let routerRaw;
  try {
    routerRaw = await callDeepSeek(apiKey, routerMessages, {
      reasoning_effort: "high",
    });
    console.log("\nRouter raw output:\n", routerRaw.slice(0, 1200), "...\n");
  } catch (err) {
    console.error("Router 调用失败:", err.message);
    rl.close();
    return;
  }

  // 提取 JSON
  const routerJsonStr = extractJson(routerRaw);
  let routerResult;
  try {
    routerResult = JSON.parse(routerJsonStr);
    console.log("Router parsed successfully.");
    console.log("  status:", routerResult.status);
    console.log("  actions:", routerResult.actions?.length || 0);
    console.log("  blockedActions:", routerResult.blockedActions?.length || 0);
  } catch (err) {
    console.error("Router 输出解析失败:", err.message);
    console.log("原始输出:\n", routerRaw);
    rl.close();
    return;
  }

  console.log("\n=== 最终 Router Actions ===");
  for (const action of routerResult.actions || []) {
    console.log(`  [${action.type}] ${action.name}`);
    console.log(`      params:`, JSON.stringify(action.params));
    console.log(`      dependsOn:`, action.dependsOn || []);
  }

  if (routerResult.blockedActions?.length > 0) {
    console.log("\n=== Blocked Actions ===");
    for (const blocked of routerResult.blockedActions) {
      console.log(`  [BLOCKED] ${blocked.name} → ${blocked.blockedReason}: ${blocked.message}`);
    }
  }

  if (routerResult.warnings?.length > 0) {
    console.log("\n=== Warnings ===");
    for (const w of routerResult.warnings) {
      console.log(`  [WARN]`, w);
    }
  }

  console.log("\n=== 完整结果 ===");
  console.log(JSON.stringify(routerResult, null, 2));

  rl.close();
}

main().catch((err) => {
  console.error(err);
  rl.close();
  process.exit(1);
});
