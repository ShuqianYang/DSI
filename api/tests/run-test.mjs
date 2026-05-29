#!/usr/bin/env node
import readline from "readline";

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-v4-flash";
const API_KEY = process.env.DEEPSEEK_API_KEY || "";
const QUERY = "查询一下东海现在有多少货船，按国籍统计一下";

export async function callDeepSeek(apiKey, messages, options = {}) {
  const resp = await fetch(DEEPSEEK_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: MODEL, messages, stream: false, ...options }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`DeepSeek API error: ${resp.status} ${text}`);
  }
  const json = await resp.json();
  return json.choices?.[0]?.message?.content || "";
}

const CAP = JSON.stringify({
  capabilities: [
    { type: "region-mark", name: "区域标记", description: "在 Cesium 地图上框选目标范围", params: { region: { type: "string", required: false, default: "中国东海", enum: ["中国东海","东海","柳州","柳州市","柳南区","广西柳州市柳南区","石门","石门县","湖南石门","湖南石门县"] } } },
    { type: "satellite", name: "天基遥感", description: "获取卫星遥感影像", params: { query: { type: "string", required: false, default: "未指定查询" }, fireScenario: { type: "boolean", required: false }, earthquakeScenario: { type: "boolean", required: false }, floodScenario: { type: "boolean", required: false }, detectOilSpill: { type: "boolean", required: false }, phase: { type: "string", required: false, enum: ["pre","post"] }, region: { type: "string", required: false }, bbox: { type: "array", required: false } } },
    { type: "fire-detector", name: "火情识别", description: "识别火灾中心点、烧毁区域", params: { region: { type: "string", required: false, default: "Kensai" }, query: { type: "string", required: false }, bbox: { type: "array", required: false }, fromScenario: { type: "boolean", required: false } } },
    { type: "oil-drift", name: "油污漂移反推", description: "反推排污原点和漂移路径", params: {}, contextDeps: ["satellite.oilFilmGeom","weather-fetch.output"] },
    { type: "ais-fetch", name: "AIS 轨迹获取", description: "拉取近72小时船舶 AIS 轨迹", params: { region: { type: "string", required: false, default: "中国东海" } } },
    { type: "ais-match-suspects", name: "嫌疑船匹配", description: "嫌疑船名单与 AIS 轨迹匹配", params: {}, contextDeps: ["oil-drift.originPoint","oil-drift.timeWindow","ais-fetch.output"] },
    { type: "ais-suspect-ranking", name: "嫌疑船排序", description: "按排污概率排序", params: {}, contextDeps: ["ais-match-suspects.matchedShips"] },
    { type: "maritime", name: "海域态势分析", description: "AIS + ADS 数据，识别异常航行", params: { region: { type: "string", required: false, default: "南海" }, query: { type: "string", required: false } } },
    { type: "weather-fetch", name: "气象风场获取", description: "10×10 网格风场数据", params: { region: { type: "string", required: false, default: "东海油膜片区" } } },
    { type: "earthquake-evaluation", name: "地震灾后评估", description: "震前震后影像对比", params: { region: { type: "string", required: false, default: "广西柳州市柳南区" }, query: { type: "string", required: false } }, contextDeps: ["satellite.pre_earthquake.imageOverlays","satellite.post_earthquake.imageOverlays"] },
    { type: "flood-evaluation", name: "洪涝灾后评估", description: "洪水前后影像对比", params: { region: { type: "string", required: false, default: "湖南石门县" }, query: { type: "string", required: false } }, contextDeps: ["satellite.pre_flood.imageOverlays","satellite.post_flood.imageOverlays"] },
    { type: "news", name: "新闻查询", description: "获取权威通报或新闻摘要", params: { query: { type: "string", required: false, default: "未指定查询" }, region: { type: "string", required: false }, timeRange: { type: "string", required: false, default: "7d" }, fireScenario: { type: "boolean", required: false }, earthquakeScenario: { type: "boolean", required: false }, floodScenario: { type: "boolean", required: false } } },
  ]
}, null, 2);

export function buildPlannerPrompt(q) {
  return `你是数智融合智能体应用平台的 Planner...

## 可用工具

${CAP}

## 规划原则

1. 先理解用户真正想完成什么，再拆成若干子任务。
2. capability 必须严格使用 capabilities[].type 中存在的工具类型。
3. 如果某个子任务没有合适工具，capability=null，supportStatus="unsupported"。
4. 如果某个子任务只有一部分能完成，标记 supportStatus="partial"。
5. 如果参数缺失且无法安全推断，标记 supportStatus="needs_clarification"。
6. 用户提到海域时，不要自动进入漏油流程；只有出现油污、油膜、排污时才进入漏油流程。
7. 地震/洪涝影像对比任务需要 satellite 的 pre/post 两步。
8. 单纯新闻查询只规划 news。
9. 如果用户要求预测、按国籍统计、导出报告等当前工具没有覆盖的任务，列入 unsupportedSubtasks。

## 输出格式

必须返回 JSON，不要其他内容：

{
  "status": "planned | partial_planned | needs_clarification | unsupported",
  "taskId": "TASK-YYYYMMDD-001",
  "scenarioType": "fire | oil_spill | earthquake | flood | maritime | news | general_query | unknown",
  "goal": "string",
  "entities": { "region": "...", "timeRange": "...", "eventType": "...", "keywords": [], "missingFields": [] },
  "executionMode": "dag",
  "subtasks": [
    {
      "id": "subtask-1",
      "name": "步骤名称",
      "capability": "工具类型或 null",
      "supportStatus": "supported | partial | unsupported | needs_clarification",
      "semanticParams": { "region": "...", "timeRange": "...", "objectType": "...", "filters": {}, "groupBy": [], "predictionTarget": null, "outputFormat": null },
      "params": {},
      "unsupportedParamNeeds": [],
      "dependsOn": [],
      "expectedResult": "...",
      "gisInteraction": "...",
      "objectType": "region | imagery | article | ranking | evaluation | statistic | null",
      "failureReason": null,
      "requiredMissingCapability": null
    }
  ],
  "unsupportedSubtasks": [
    { "id": "unsupported-1", "name": "无法执行的任务", "reason": "...", "requiredCapability": "...", "suggestedFallback": "..." }
  ],
  "decisionSummary": { "intent": "...", "plan": "...", "riskLevelHint": "..." },
  "finalEvent": { "type": "...", "title": "...", "gisReplayObjectTypes": [] }
}

## 用户提问

${q}`;
}

export function buildRouterPrompt(planJson) {
  return `你是数智融合智能体应用平台的 Router。
你的任务是把 Planner 中 supportStatus="supported" 或 "partial" 且 capability 不为空的 subtasks 转换成可执行 actions。

## 可用工具

${CAP}

## Planner 输出

${planJson}

## 路由规则

1. supportStatus="supported" 且 capability 不为空 → 必须生成 action
2. supportStatus="partial" 且 capability 不为空 → 可以生成 action，在 warnings 中说明
3. supportStatus="unsupported" / "needs_clarification" / capability=null → 不生成 action，进入 blockedActions
4. action.type 必须严格等于 subtask.capability
5. action.params 只能包含 capability.params 中声明过的字段
6. dependsOn 把 subtask id 映射成对应 action id
7. 地震/洪涝 satellite 必须带 phase="pre" 或 "post"
8. 火灾 satellite 必须带 fireScenario=true
9. 漏油 satellite 必须带 detectOilSpill=true
10. news 无 timeRange 默认 "7d"
11. 区域别名归一化：东海→中国东海，石门→湖南石门县

## 输出格式

必须返回 JSON：

{
  "status": "routed | partial_routed | no_routable_action | invalid_plan",
  "taskId": "...",
  "scenarioType": "...",
  "actions": [
    {
      "id": "action-1",
      "sourceSubtaskId": "subtask-1",
      "type": "region-mark",
      "name": "...",
      "description": "...",
      "params": {},
      "semanticParams": {},
      "dependsOn": [],
      "expectedOutput": "...",
      "gisInteraction": "...",
      "objectType": "..."
    }
  ],
  "blockedActions": [
    {
      "sourceSubtaskId": "...",
      "name": "...",
      "requestedCapability": null,
      "blockedReason": "TOOL_NOT_AVAILABLE | PARAM_OUT_OF_ENUM | DEPENDENCY_BLOCKED | ...",
      "message": "...",
      "requiredCapability": "...",
      "suggestedFallback": "..."
    }
  ],
  "dependencyMap": {},
  "errors": [],
  "warnings": []
}`;
}

export function extractJson(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (m) return m[1].trim();
  const o = text.match(/\{[\s\S]*\}/);
  if (o) return o[0];
  return text.trim();
}

console.log('=== Planner + Router DeepSeek 测试 ===');
console.log('提问:', QUERY);

// Step 1: Planner
console.log('\n--- Step 1: Planner ---');
const planRaw = await callDeepSeek(API_KEY, [
  { role: 'system', content: '你是一个任务规划专家，只返回 JSON。' },
  { role: 'user', content: buildPlannerPrompt(QUERY) },
], { reasoning_effort: 'high' });
console.log('\nPlanner raw:\n', planRaw.slice(0, 2000), '\n...');

const plan = JSON.parse(extractJson(planRaw));
console.log('\nPlanner parsed:');
console.log('  status:', plan.status);
console.log('  scenarioType:', plan.scenarioType);
console.log('  goal:', plan.goal);
console.log('  subtasks:', plan.subtasks?.length || 0);
console.log('  unsupportedSubtasks:', plan.unsupportedSubtasks?.length || 0);

// Step 2: Router
console.log('\n--- Step 2: Router ---');
const routerRaw = await callDeepSeek(API_KEY, [
  { role: 'system', content: '你是一个工具路由专家，只返回 JSON。' },
  { role: 'user', content: buildRouterPrompt(JSON.stringify(plan, null, 2)) },
], { reasoning_effort: 'high' });
console.log('\nRouter raw:\n', routerRaw.slice(0, 2000), '\n...');

const router = JSON.parse(extractJson(routerRaw));
console.log('\nRouter parsed:');
console.log('  status:', router.status);
console.log('  actions:', router.actions?.length || 0);
console.log('  blockedActions:', router.blockedActions?.length || 0);

console.log('\n=== Actions ===');
for (const a of router.actions || []) {
  console.log(`  [${a.type}] ${a.name}`);
  console.log(`      params:`, JSON.stringify(a.params));
  console.log(`      dependsOn:`, a.dependsOn || []);
}

if (router.blockedActions?.length > 0) {
  console.log('\n=== Blocked ===');
  for (const b of router.blockedActions) {
    console.log(`  [${b.blockedReason}] ${b.name}: ${b.message}`);
  }
}

if (router.warnings?.length > 0) {
  console.log('\n=== Warnings ===');
  for (const w of router.warnings) console.log('  [WARN]', w);
}

console.log('\n=== 完整结果 ===');
console.log(JSON.stringify(router, null, 2));
