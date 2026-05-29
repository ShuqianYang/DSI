import type { Plan, PlanStep } from "@datasourceintelligence/shared";
import type { PlannerService } from "./types.js";
// import { callQwen, parseIntentClassification } from "../../lib/qwen.js";

// Dify API 配置（已废弃，改用 DeepSeek）
// const DIFY_API_KEY = process.env.DIFY_PLANNER_API_KEY || "";
// const DIFY_API_URL = process.env.DIFY_PLANNER_API_URL || "";

// DeepSeek API 配置
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-v4-flash";

// 通用 DeepSeek API 调用
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

// 构建 DeepSeek Planner prompt
function buildDeepSeekPlannerPrompt(query: string, _context?: Record<string, unknown>): string {
  return `你是数智融合智能体应用平台的 Planner。
你的任务是把用户提问拆成可执行计划。

## 可用工具

- region-mark: 在 Cesium 地图上框选目标范围
- satellite: 获取卫星遥感影像（火灾/漏油/地震/洪涝）
- fire-detector: 识别火灾中心点、烧毁区域
- oil-drift: 反推排污原点和漂移路径
- ais-fetch: 拉取近72小时船舶 AIS 轨迹
- ais-match-suspects: 嫌疑船名单与 AIS 轨迹匹配
- ais-suspect-ranking: 按排污概率排序
- maritime: 海域态势分析
- weather-fetch: 气象风场获取
- earthquake-evaluation: 地震灾后评估
- flood-evaluation: 洪涝灾后评估
- news: 新闻查询

## 规划原则

1. 先理解用户真正想完成什么，再拆成若干子任务。
2. capability 必须严格使用可用工具类型。
3. 如果某个子任务没有合适工具，capability=null，supportStatus="unsupported"。
4. 如果某个子任务只有一部分能完成，标记 supportStatus="partial"。
5. 如果参数缺失且无法安全推断，标记 supportStatus="needs_clarification"。
6. 用户提到海域时，不要自动进入漏油流程；只有出现油污、油膜、排污时才进入漏油流程。
7. 地震/洪涝影像对比任务需要 satellite 的 pre/post 两步。
8. 单纯新闻查询只规划 news。

## 输出格式

必须返回 JSON，不要其他内容：

{
  "goal": "用一句话描述用户要完成的任务",
  "steps": [
    {
      "id": "step-1",
      "description": "步骤描述",
      "purpose": "步骤目的",
      "expectedOutput": "期望产出",
      "capability": "工具类型或 null（无合适工具时填 null）",
      "supportStatus": "supported | unsupported | partial | needs_clarification"
    }
  ],
  "reasoning": "规划思路说明"
}

## 用户提问

${query}`;
}

// 调用 DeepSeek 生成计划
async function callDeepSeekPlanner(
  query: string,
  context?: Record<string, unknown>
): Promise<Plan> {
  if (!DEEPSEEK_API_KEY) {
    throw new Error("DeepSeek API key not configured");
  }

  const prompt = buildDeepSeekPlannerPrompt(query, context);
  const result = await callDeepSeekApi(
    [
      { role: "system", content: "你是一个任务规划专家，只返回 JSON。" },
      { role: "user", content: prompt },
    ],
    { reasoning_effort: "high" }
  );

  console.log("[Planner] DeepSeek raw answer:\n", result.slice(0, 2000), "\n...");
  return parsePlanFromText(result, query);
}

// 统一校验并归一化 Planner 输出（支持 simple mode 与 scenario mode）
function normalizePlan(raw: unknown): Plan | null {
  if (!raw || typeof raw !== "object") {
    console.log("[Planner] normalizePlan failed: raw is not an object");
    return null;
  }
  const parsed = raw as Record<string, unknown>;

  // Scenario JSON 可能没有顶层 goal，从 mainTask.name / scenario.name 推导
  if (!parsed.goal || typeof parsed.goal !== "string") {
    const mainTask = parsed.mainTask as Record<string, unknown> | undefined;
    const scenario = parsed.scenario as Record<string, unknown> | undefined;
    const derivedGoal = (mainTask?.name as string) || (scenario?.name as string);
    if (derivedGoal) {
      parsed.goal = derivedGoal;
      console.log("[Planner] normalizePlan: derived goal from mainTask/scenario:", derivedGoal);
    } else {
      console.log("[Planner] normalizePlan failed: missing or invalid goal", parsed.goal);
      return null;
    }
  }

  const hasSteps = Array.isArray(parsed.steps);
  const hasSubtasks = Array.isArray(parsed.subtasks);
  console.log(`[Planner] normalizePlan check: hasSteps=${hasSteps}, hasSubtasks=${hasSubtasks}`);

  if (!hasSteps && !hasSubtasks) {
    console.log("[Planner] normalizePlan failed: neither steps nor subtasks found. Keys:", Object.keys(parsed));
    return null;
  }

  // Scenario mode：若 steps 缺失或为空，从 subtasks 自动合成，保证旧代码兼容
  if (!hasSteps || (parsed.steps as unknown[]).length === 0) {
    if (hasSubtasks) {
      parsed.steps = (parsed.subtasks as Array<Record<string, unknown>>).map((s, i) => ({
        id: (s.id as string) || `step-${i + 1}`,
        description: (s.name as string) || (s.description as string) || `步骤 ${i + 1}`,
        purpose: (s.description as string) || (s.name as string) || `步骤 ${i + 1}`,
        expectedOutput: (s.expectedResult as string) || "执行结果",
        capability: s.capability,
        supportStatus: s.supportStatus,
      }));
      console.log(`[Planner] normalizePlan: synthesized ${(parsed.steps as unknown[]).length} steps from subtasks`);
    } else {
      parsed.steps = [];
    }
  }

  // 确保 reasoning 有默认值
  if (!parsed.reasoning || typeof parsed.reasoning !== "string") {
    parsed.reasoning = "";
  }

  console.log("[Planner] normalizePlan success. scenario?", !!parsed.scenario, "subtasks?", !!parsed.subtasks);
  return parsed as Plan;
}

// 解析 Dify 返回的文本为 Plan 结构
function parsePlanFromText(text: string, query: string): Plan {
  const trimmed = text.trim().replace(/^﻿/, "");
  const preview = trimmed.slice(0, 200).replace(/\s+/g, " ");
  console.log("[Planner] parsePlanFromText input preview:", preview);

  // 1. 尝试去除 markdown 代码块后解析 JSON
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const jsonCandidate = codeBlockMatch ? codeBlockMatch[1].trim() : trimmed;
  console.log("[Planner] codeBlock found?", !!codeBlockMatch);

  try {
    const parsed = JSON.parse(jsonCandidate);
    const normalized = normalizePlan(parsed);
    if (normalized) return normalized;
    console.log("[Planner] normalizePlan returned null for codeBlock JSON");
  } catch (err) {
    console.log("[Planner] JSON.parse(codeBlock) failed:", (err as Error).message);
  }

  // 1a. Dify 可能返回不带外层花括号的 JSON body（如 "goal": ...）
  let wrapped = jsonCandidate;
  if (!jsonCandidate.startsWith("{")) {
    wrapped = jsonCandidate.endsWith("}")
      ? `{${jsonCandidate}`
      : `{${jsonCandidate}}`;
  }
  try {
    const parsed = JSON.parse(wrapped);
    const normalized = normalizePlan(parsed);
    if (normalized) return normalized;
    console.log("[Planner] normalizePlan returned null for wrapped JSON");
  } catch (err) {
    console.log("[Planner] JSON.parse(wrapped) failed:", (err as Error).message);
  }

  // 1c. 修复属性键缺少双引号的常见错误（如 description: → "description":）
  // 先修复 "description": → "description":（开头引号缺失但中间有引号）
  let fixedQuotes = wrapped.replace(/([{\[,]\s*)([a-zA-Z_]\w*)\s*"\s*:/g, '$1"$2":');
  // 再修复完全无引号的属性键（如 description: → "description":）
  fixedQuotes = fixedQuotes.replace(/([{\[,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":');
  try {
    const parsed = JSON.parse(fixedQuotes);
    const normalized = normalizePlan(parsed);
    if (normalized) return normalized;
    console.log("[Planner] normalizePlan returned null for fixedQuotes JSON");
  } catch (err) {
    console.log("[Planner] JSON.parse(fixedQuotes) failed:", (err as Error).message);
  }

  // 1b. 兜底：尝试从文本中提取 {...} 块
  const jsonBlockMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[0]);
      const normalized = normalizePlan(parsed);
      if (normalized) return normalized;
      console.log("[Planner] normalizePlan returned null for jsonBlockMatch");
    } catch (err) {
      console.log("[Planner] JSON.parse(jsonBlockMatch) failed:", (err as Error).message);
    }
  }

  console.log("[Planner] All JSON parsing failed, falling back to heuristic");

  // 2. 启发式解析：按行提取步骤
  const lines = trimmed.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

  const steps: PlanStep[] = [];
  let currentGoal = query;

  for (const line of lines) {
    // 匹配 "1. 步骤描述" 或 "- 步骤描述" 格式
    const match = line.match(/^(?:\d+[.\)]\s*[-–]?\s*|[-•]\s+)(.+)/);
    if (match) {
      const desc = match[1].trim();
      steps.push({
        id: `step-${steps.length + 1}`,
        description: desc,
        purpose: desc,
        expectedOutput: "执行结果",
      });
    }
    // 匹配 "目标: xxx" 或 "Goal: xxx"
    const goalMatch = line.match(/^(?:目标|Goal)[:：]\s*(.+)/i);
    if (goalMatch) {
      currentGoal = goalMatch[1].trim();
    }
  }

  if (steps.length === 0) {
    // 兜底：整个文本作为一个步骤
    steps.push({
      id: "step-1",
      description: trimmed,
      purpose: trimmed,
      expectedOutput: "执行结果",
    });
  }

  return {
    goal: currentGoal,
    steps,
    reasoning: trimmed,
  };
}

// 火灾监控类请求关键词
const FIRE_QUERY_KEYWORDS = [
  "火灾",
  "火情",
  "着火",
  "燃烧",
  "烧毁",
  "火灾检测",
  "火灾监控",
];

function isFireQuery(query: string): boolean {
  const q = query.toLowerCase();
  return FIRE_QUERY_KEYWORDS.some((keyword) => q.includes(keyword));
}

// 订阅触发的火情研判 scenario：仅匹配 scheduler 触发的标准化 query（"[订阅触发] 火情研判·..."）
// 用户直接提问"订阅..."走正常的 hasSubscription 路径，由 Router 创建 subscription action
function isScheduledFireInvestigation(query: string): boolean {
  return query.startsWith("[订阅触发] 火情研判");
}

// 东海油污溯源测试场景：写死返回，便于联调
function isOilSpillTracingQuery(query: string): boolean {
  return query.includes("海面疑似油污痕迹") && query.includes("AIS轨迹");
}

function buildOilSpillTracingPlan(query: string): Plan {
  const subtasks = [
    {
      id: "subtask-1",
      name: "标记中国东海区域",
      capability: "region-mark",
      description: "依据东海标准海域边界框选区域，建立后续溯源的空间基准",
      executionDetail: "调用 GIS 3D 地球引擎，加载近海底图，按东海标准边界自动框选，完成 WGS84 坐标匹配，生成标准化东海区域标记图层",
      expectedResult: "成功标记东海全域并生成专属图层，附边界经纬度范围",
      gisInteraction: "3D 地球定位至东海全域，蓝色粗实线闭合框选，标注'中国东海'与经纬度范围，底图显示近海矢量地形",
      objectType: "region",
      dependsOn: [],
    },
    {
      id: "subtask-2",
      name: "天基获取影像并识别油膜",
      capability: "satellite",
      description: "调用天基信息服务系统获取 72 小时内东海含疑似油膜区域的 SAR 影像与油膜 AI 解译结果",
      executionDetail: "传入区域边界与时间范围，由天基系统检索 SAR 影像（优先分辨率≤1m，云量＜10%），完成油膜 AI 解译，将油膜区域/面积/中心点坐标等核心信息推送回智能体",
      expectedResult: "获得 SAR 影像、油膜区域、油膜面积、油膜中心点坐标等核心信息",
      gisInteraction: "加载 SAR 影像浅蓝叠加，黄色半透明面标注油膜区域并绘制轮廓，弹出'疑似油膜'提示框，标注油膜面积与中心点",
      objectType: "oilFilm",
      dependsOn: ["subtask-1"],
    },
    {
      id: "subtask-3",
      name: "获取东海气象数据",
      capability: "weather-fetch",
      description: "拉取近 72 小时油膜片区的风速/风向/洋流流向/流速",
      executionDetail: "按区域 + 时间范围调用气象接口，去重标准化后提取油膜形成时段的核心气象参数",
      expectedResult: "获取风/流时序数据，匹配漂移反推所需输入",
      gisInteraction: "侧边栏弹出气象参数面板，油膜区域周边叠加风/流矢量图标",
      objectType: "weather",
      dependsOn: ["subtask-2"],
    },
    {
      id: "subtask-4",
      name: "反推油污漂移路径",
      capability: "oil-drift",
      description: "结合油膜形状与气象数据，反推油污漂移路径与排污时间区间",
      executionDetail: "提取油膜扩散方向/速度，代入扩散模型校准扩散系数，以油膜为终点反向推演到排污原点，倒推排污时间区间（目标误差≤2 小时）",
      expectedResult: "得到漂移路径、排污原点坐标、排污时间区间",
      gisInteraction: "绘制橙色虚线溯源路径并标注漂移方向，红色圆点高亮排污原点，弹出排污时间区间提示框",
      objectType: "discharge",
      dependsOn: ["subtask-3"],
    },
    {
      id: "subtask-5",
      name: "获取 AIS 轨迹",
      capability: "ais-fetch",
      description: "拉取近 72 小时东海全域船舶 AIS 实时与历史轨迹",
      executionDetail: "按区域 + 时间范围拉取 AIS 原始报文，清洗去重，提取 MMSI/船型/轨迹/航速/停泊时间，建立 AIS 轨迹库",
      expectedResult: "建立覆盖区域内所有船舶的 AIS 轨迹库",
      gisInteraction: "加载全部 AIS 历史轨迹（淡灰虚线），在航船舶标记淡蓝圆点",
      objectType: "ship",
      dependsOn: ["subtask-1"],
    },
    {
      id: "subtask-6",
      name: "匹配途经船舶",
      capability: "ais-match-suspects",
      description: "以排污原点为中心划定时空匹配区域，筛选排污时段途经船舶",
      executionDetail: "排污原点±1km×1km 范围 × 排污时间区间，对 AIS 轨迹库做时间 + 空间双重匹配，剔除不符合的船舶",
      expectedResult: "得到匹配船舶清单（MMSI/船型/轨迹/停留时长）",
      gisInteraction: "非匹配轨迹置灰，匹配船舶以深蓝实线高亮 + 蓝色闪烁点+MMSI 标注",
      objectType: "ship",
      dependsOn: ["subtask-4", "subtask-5"],
    },
    {
      id: "subtask-7",
      name: "嫌疑船舶排序",
      capability: "ais-suspect-ranking",
      description: "异常筛选 + 加权打分 + 优先级分级",
      executionDetail: "筛选低速航行/抛锚/久留/航线偏离的船舶，按距离 40+ 停留时长 30+ 航行异动 30 三项加权打分（满分 100），分级首要/次要/一般嫌疑",
      expectedResult: "得到嫌疑船舶清单与判定依据",
      gisInteraction: "首要嫌疑红色实线 + 红闪点+'首要嫌疑'标签，次要橙色，一般黄色，弹出排序清单弹窗",
      objectType: "ship",
      dependsOn: ["subtask-6"],
    },
  ];

  const steps: PlanStep[] = subtasks.map((s) => ({
    id: s.id.replace("subtask-", "step-"),
    description: s.name,
    purpose: s.description,
    expectedOutput: s.expectedResult,
  }));

  return {
    goal: query,
    steps,
    reasoning:
      "用户请求属于多源协同溯源类场景，按'建立空间基准→拉天基识别油膜→拉气象支撑→油污反推锁定原点→AIS 拉取→时空匹配→嫌疑排序'拆解。subtask-5（AIS 拉取）仅依赖区域标记，技术上可与天基/气象/反推并行；为思维链可读性保持顺序展示，是否并行由 Router/Runtime 决定。日期更新为当前时间 20260511。",
    scenario: {
      name: "东海区域船舶非法排污/偷排油污智能溯源",
      platform: "数智融合智能体应用平台",
      involvedSystems: [
        "数智融合智能体应用平台",
        "天基信息服务平台",
        "船舶 AIS 数据接口",
        "气象数据接口",
        "GIS 3D 地球引擎",
      ],
      userRoles: ["海事情报分析员", "东海海域生态巡查员", "海事执法人员"],
      coreFlow: "用户提问→智能体思维链→主任务/子任务→子任务执行→GIS 实时联动→任务完成生成事件→事件结果 GIS 回显",
      coreLogic: "天基识别油膜并推送核心信息→结合气象反推排污时间与路径→AIS 匹配途经船舶→生成疑似肇事船排序",
    },
    thinkingChain: {
      intentRecognition: "用户需求为东海油污监测、天基影像/油膜识别、气象辅助排污时间推演、AIS 轨迹匹配、嫌疑船排序一体化溯源服务",
      entityExtraction: "区域=中国东海全域；时间=近 72 小时；核心需求=天基油膜识别 + 油污漂移反推 + 排污时间估算+AIS 匹配 + 嫌疑排序",
      taskPlanning: "①标记东海→②天基获取影像与油膜→③获取气象→④油污漂移反推→⑤AIS 拉取→⑥船舶匹配→⑦嫌疑排序",
      subtaskCount: 7,
      executionScheduling: "串行展示，AIS 拉取允许与天基/气象/反推并行执行以缩短耗时",
    },
    mainTask: {
      name: "东海区域船舶非法排污/偷排油污智能溯源研判",
      id: "TASK-DH-OIL-20260511-001",
      status: "执行中",
      progress: 0,
    },
    subtasks,
    finalEvent: {
      type: "船舶非法排污/偷排油污溯源",
      riskLevelHint: "高危",
      gisReplayObjectTypes: ["region", "imagery", "oilFilm", "discharge", "weather", "ship", "popup"],
    },
  };
}

// 火灾监控固定计划：互联网搜索火情信息 → 获取卫星遥感影像 → 生成火情影像图 → 生成报告
function buildFireMonitoringPlan(query: string): Plan {
  return {
    goal: query,
    steps: [
      {
        id: "step-1",
        description: "互联网搜索火情信息",
        purpose: "通过公开新闻源检索火情背景与最新报道",
        expectedOutput: "火情相关新闻摘要、报道时间线",
      },
      {
        id: "step-2",
        description: "获取卫星遥感影像",
        purpose: "调用卫星遥感数据源获取目标区域真彩色影像",
        expectedOutput: "Sentinel-2 遥感影像切片与覆盖范围",
      },
      {
        id: "step-3",
        description: "生成火情影像图",
        purpose: "在遥感影像上叠加火点与烧毁区域，输出可视化图层",
        expectedOutput: "火情影像图（含火点掩膜与烧毁边界）",
      },
      {
        id: "step-4",
        description: "生成报告",
        purpose: "汇总检索结果、影像与识别信息，形成火情分析报告",
        expectedOutput: "包含火情研判与 GIS 叠加的火情分析报告",
      },
    ],
    reasoning: `用户请求${query}，按互联网情报检索 → 卫星影像获取 → 火情影像生成 → 报告生成 的固定流程执行。`,
  };
}

// 订阅触发的火情研判 scenario：互联网线索核查 → 天基遥感解译 → 地图研判展示 → 标准化推送
function buildFireInvestigationPlan(
  query: string,
  context?: Record<string, unknown>
): Plan {
  const inputs = context || {};
  const regionName = (inputs.regionName as string) || "未知区域";

  const subtasks = [
    {
      id: "subtask-1",
      name: "互联网火情线索核查",
      capability: "news",
      description: "检索目标区域近期公开新闻源中的火情相关报道与社交媒体线索",
      executionDetail: "按 region + timeRange 检索公开新闻源，提取标题/摘要/时间线，形成火情背景情报",
      expectedResult: "火情相关新闻摘要、报道时间线、舆情趋势",
      gisInteraction: "无",
      objectType: "info",
      dependsOn: [],
    },
    {
      id: "subtask-2",
      name: "天基遥感影像获取与火情解译",
      capability: "satellite",
      description: "调用天基信息服务系统获取目标区域遥感影像，并完成火点 AI 识别与烧毁范围提取",
      executionDetail: "检索历史遥感数据，若无有效数据则模拟调度卫星成像，影像回传后开展智能火情解译",
      expectedResult: "遥感影像切片、火点坐标、烧毁区域轮廓",
      gisInteraction: "加载遥感影像叠加层，标注火点坐标与烧毁区域",
      objectType: "fire",
      dependsOn: ["subtask-1"],
    },
    {
      id: "subtask-3",
      name: "地图展示火情研判结果",
      capability: "fire-detector",
      description: "在 3D 地球引擎上展示火情点位、影响范围、风险等级等研判结果",
      executionDetail: "接收卫星解译的火点坐标与烧毁区域，生成 GIS 实体与区域面，叠加灾后影像与烧毁遮罩",
      expectedResult: "地图高亮显示火情中心、烧毁边界、风险等级",
      gisInteraction: "flyTo 火情区域，叠加火点脉冲标记 + 烧毁区 polygon + 风险等级标签",
      objectType: "fire",
      dependsOn: ["subtask-2"],
    },
    {
      id: "subtask-4",
      name: "标准化封装推送边防平台",
      capability: "border-push",
      description: "将火情研判事件完成标准化封装，推送至边防应用平台供下一步联动演示",
      executionDetail: "汇总火点坐标、烧毁面积、风险等级、新闻线索、卫星影像元数据，生成标准化 JSON payload",
      expectedResult: "推送成功，返回事件 ID",
      gisInteraction: "无",
      objectType: "push",
      dependsOn: ["subtask-3"],
    },
  ];

  const steps: PlanStep[] = subtasks.map((s) => ({
    id: s.id.replace("subtask-", "step-"),
    description: s.name,
    purpose: s.description,
    expectedOutput: s.expectedResult,
  }));

  return {
    goal: query,
    steps,
    reasoning: `订阅自动触发，对${regionName}执行火情智能研判：按互联网线索核查 → 天基遥感解译 → 地图研判展示 → 标准化推送 四步流程执行。`,
    scenario: {
      name: "边境管段火情智能研判",
      platform: "数智融合智能体应用平台",
      involvedSystems: [
        "数智融合智能体应用平台",
        "天基信息服务平台",
        "互联网舆情监测系统",
        "GIS 3D 地球引擎",
        "边防应用平台",
      ],
      userRoles: ["情报分析员", "边防指挥员", "态势研判员"],
      coreFlow: "用户订阅 → 智能体自动值守 → 天基遥感解译 → GIS 实时联动 → 研判结果推送",
      coreLogic: "舆情线索核查 → 遥感影像获取与火情解译 → 地图可视化研判 → 标准化封装推送",
    },
    thinkingChain: {
      intentRecognition: "用户已订阅边境管段火情智能研判服务，当前为订阅自动触发值守阶段",
      entityExtraction: `区域=${regionName}`,
      taskPlanning: "①互联网线索核查 → ②天基遥感解译 → ③地图研判展示 → ④标准化推送",
      subtaskCount: 4,
      executionScheduling: "串行执行，天基解译依赖线索核查，地图展示依赖解译结果，推送依赖最终研判",
    },
    mainTask: {
      name: `${regionName}火情智能研判`,
      id: "TASK-FIRE-DEMO-001",
      status: "执行中",
      progress: 0,
    },
    subtasks,
    finalEvent: {
      type: "火情研判",
      riskLevelHint: "高危",
      gisReplayObjectTypes: ["region", "imagery", "fire", "push"],
    },
  };
}

// 洪涝灾后评估关键词
const FLOOD_KEYWORDS = ["暴雨", "洪涝", "洪水", "淹没", "石门县", "张家渡"];

function isFloodQuery(query: string): boolean {
  const q = query.toLowerCase();
  return FLOOD_KEYWORDS.some((keyword) => q.includes(keyword));
}

// 地震灾后评估关键词
const EARTHQUAKE_KEYWORDS = ["地震", "震后", "震中", "灾后评估"];

function isEarthquakeQuery(query: string): boolean {
  const q = query.toLowerCase();
  return EARTHQUAKE_KEYWORDS.some((keyword) => q.includes(keyword));
}

// 洪涝灾后评估写死 plan：5 步 scenario
function buildFloodPlan(query: string): Plan {
  const regionName = "湖南石门县";

  const subtasks = [
    {
      id: "subtask-1",
      name: "查询官网暴雨权威信息",
      capability: "news",
      description: "访问国家气象信息中心、湖南省气象局、水利部水文信息官网，获取权威暴雨参数",
      executionDetail: "抓取暴雨速报数据并交叉核验，生成标准化暴雨参数（降雨时间、强降雨云团位置、渫水超警信息）",
      expectedResult: "权威暴雨基础信息：2026-05-17~05-18 强降雨 / 渫水超警 / 张家渡大桥损毁",
      gisInteraction: "弹出官方暴雨信息面板，展示来源、降雨时段、云团位置、水文预警",
      objectType: "info",
      dependsOn: [],
    },
    {
      id: "subtask-2",
      name: "定位石门县洪涝评估区域",
      capability: "region-mark",
      description: "依据暴雨信息，在GIS上锁定石门县澧水/渫水流域为评估范围",
      executionDetail: "按张家渡大桥坐标（110.89°E, 29.88°N）自动定位，框选石门县流域评估区域",
      expectedResult: "评估区域精准锁定，GIS居中显示",
      gisInteraction: "3D 地球居中石门县，蓝色粗实线闭合框选澧水/渫水流域",
      objectType: "region",
      dependsOn: ["subtask-1"],
    },
    {
      id: "subtask-3",
      name: "获取天基暴雨前最新历史影像",
      capability: "satellite",
      description: "调用天基信息服务平台，检索石门县暴雨前最新存档影像",
      executionDetail: "按区域+时间范围检索历史遥感数据，优先高分辨率、低云量影像",
      expectedResult: "成功获取暴雨前最新历史影像，全域覆盖、质量合格",
      gisInteraction: "加载暴雨前影像底图，清晰呈现洪涝前建筑、路网、地形原貌",
      objectType: "imagery",
      dependsOn: ["subtask-2"],
    },
    {
      id: "subtask-4",
      name: "获取天基暴雨后最新影像",
      capability: "satellite",
      description: "向天基信息服务平台提交洪涝应急成像需求，获取暴雨后最新影像",
      executionDetail: "自动生成应急成像需求单并提交，卫星成像完成后推送暴雨后影像",
      expectedResult: "成功获取暴雨后最新影像，可用于解译评估",
      gisInteraction: "加载暴雨后影像，支持与暴雨前影像一键切换",
      objectType: "imagery",
      dependsOn: ["subtask-2"],
    },
    {
      id: "subtask-5",
      name: "洪涝灾后评估与GIS回显",
      capability: "flood-evaluation",
      description: "暴雨前后影像自动配准与 AI 对比解译，淹没识别与灾后灾情统计评估",
      executionDetail: "高精度配准后 AI 变化检测提取淹没图斑，分类统计淹没面积、桥梁损毁、道路中断、房屋受淹",
      expectedResult: "完成洪涝灾后评估与分级统计，生成一张图评估结果",
      gisInteraction: "分屏左右对比暴雨前/暴雨后，淹没区域红色高亮，按重度/中度/轻度分级渲染",
      objectType: "damage",
      dependsOn: ["subtask-3", "subtask-4"],
    },
  ];

  const steps: PlanStep[] = subtasks.map((s) => ({
    id: s.id.replace("subtask-", "step-"),
    description: s.name,
    purpose: s.description,
    expectedOutput: s.expectedResult,
  }));

  return {
    goal: query,
    steps,
    reasoning: `用户请求${query}，按"查询官网暴雨信息→定位评估区域→获取暴雨前影像→获取暴雨后影像→AI对比评估"五步流程执行。`,
    scenario: {
      name: "湖南石门县暴雨洪涝灾后智能评估",
      platform: "数智融合智能体应用平台",
      involvedSystems: [
        "数智融合智能体应用平台",
        "天基信息服务平台",
        "国家气象信息中心",
        "湖南省气象局",
        "水利部水文信息官网",
      ],
      userRoles: ["灾情评估员", "应急情报分析员", "灾后核查人员"],
      coreFlow: "用户提问→查询官网暴雨基础信息→获取暴雨前最新历史影像→提交天基需求→获取暴雨后最新影像→AI对比解译→灾后评估→GIS回显",
      coreLogic: "权威信息查询→先取暴雨前影像→再提天基需求→获取暴雨后影像→自动对比完成洪涝评估",
    },
    thinkingChain: {
      intentRecognition: "用户需求为湖南石门县暴雨洪涝灾后即时评估，需先查询权威基础信息，先获取暴雨前影像，再获取暴雨后影像，完成影像对比与灾后评估",
      entityExtraction: `事件=${regionName} 暴雨洪涝; 时间=2026-05-17~05-18; 区域=${regionName}; 张家渡大桥=110.89°E, 29.88°N`,
      taskPlanning: "①查询官网暴雨信息→②定位评估区域→③获取暴雨前影像→④获取暴雨后影像→⑤AI对比评估",
      subtaskCount: 5,
      executionScheduling: "subtask-3(暴雨前) 和 subtask-4(暴雨后) 技术上可并行，但串行展示更利于理解；评估步骤依赖两者结果",
    },
    mainTask: {
      name: `${regionName} 暴雨洪涝灾后智能评估`,
      id: "TASK-SM-FLOOD-ASSESS-20260517-001",
      status: "执行中",
      progress: 0,
    },
    subtasks,
    finalEvent: {
      type: "洪涝灾后评估",
      riskLevelHint: "高危",
      gisReplayObjectTypes: ["region", "imagery", "damage", "info"],
    },
  };
}

// 地震灾后评估写死 plan：5 步 scenario
function buildEarthquakePlan(query: string): Plan {
  const regionName = "广西柳州市柳南区";

  const subtasks = [
    {
      id: "subtask-1",
      name: "查询官网地震基础信息",
      capability: "news",
      description: "访问中国地震台网中心、广西地震局官网，获取权威地震参数",
      executionDetail: "抓取速报数据并交叉核验，生成标准化地震参数（发震时刻、震中位置、震级、深度）",
      expectedResult: "权威地震基础信息：2026-05-18 00:21:04 / 109.26°E, 24.38°N / 5.2级 / 8km",
      gisInteraction: "弹出官方地震信息面板，展示来源、时刻、经纬度、震级、深度",
      objectType: "info",
      dependsOn: [],
    },
    {
      id: "subtask-2",
      name: "定位柳州柳南区评估区域",
      capability: "region-mark",
      description: "依据官方震中参数，在GIS上锁定柳州市柳南区为评估范围",
      executionDetail: "按震中坐标（109.26°E, 24.38°N）自动定位，红色五角星标记震中，框选评估区域",
      expectedResult: "评估区域精准锁定，GIS居中显示",
      gisInteraction: "3D 地球居中柳州柳南区，红色五角星标记震中，蓝色粗实线闭合框选区域",
      objectType: "region",
      dependsOn: ["subtask-1"],
    },
    {
      id: "subtask-3",
      name: "获取天基震前最新历史影像",
      capability: "satellite",
      description: "调用天基信息服务平台，检索柳南区震前最新存档影像",
      executionDetail: "按区域+时间范围检索历史遥感数据，优先高分辨率、低云量影像",
      expectedResult: "成功获取震前最新历史影像，全域覆盖、质量合格",
      gisInteraction: "加载震前影像底图，清晰呈现震前建筑、路网、地形原貌",
      objectType: "imagery",
      dependsOn: ["subtask-2"],
    },
    {
      id: "subtask-4",
      name: "获取天基震后最新影像",
      capability: "satellite",
      description: "向天基信息服务平台提交震后应急成像需求，获取震后最新影像",
      executionDetail: "自动生成应急成像需求单并提交，卫星成像完成后推送震后影像",
      expectedResult: "成功获取震后最新影像，可用于解译评估",
      gisInteraction: "加载震后影像，支持与震前影像一键切换",
      objectType: "imagery",
      dependsOn: ["subtask-2"],
    },
    {
      id: "subtask-5",
      name: "震后损毁评估与GIS回显",
      capability: "earthquake-evaluation",
      description: "震前震后影像自动配准与 AI 对比解译，损毁识别与灾后灾情统计评估",
      executionDetail: "高精度配准后 AI 变化检测提取损毁图斑，分类统计房屋损毁、道路中断、地表变形",
      expectedResult: "完成灾后损毁评估与分级统计，生成一张图评估结果",
      gisInteraction: "分屏左右对比震前/震后，变化区域红色高亮，按重度/中度/轻度分级渲染",
      objectType: "damage",
      dependsOn: ["subtask-3", "subtask-4"],
    },
  ];

  const steps: PlanStep[] = subtasks.map((s) => ({
    id: s.id.replace("subtask-", "step-"),
    description: s.name,
    purpose: s.description,
    expectedOutput: s.expectedResult,
  }));

  return {
    goal: query,
    steps,
    reasoning: `用户请求${query}，按"查询官网地震信息→定位评估区域→获取震前影像→获取震后影像→AI对比评估"五步流程执行。`,
    scenario: {
      name: "柳州柳南区 5.2 级地震灾后智能评估",
      platform: "数智融合智能体应用平台",
      involvedSystems: [
        "数智融合智能体应用平台",
        "天基信息服务平台",
        "中国地震台网中心官网",
        "广西壮族自治区地震局官网",
      ],
      userRoles: ["灾情评估员", "应急情报分析员", "灾后核查人员"],
      coreFlow: "用户提问→查询官网地震基础信息→获取震前最新历史影像→提交天基需求→获取震后最新影像→AI对比解译→灾后评估→GIS回显",
      coreLogic: "权威信息查询→先取震前影像→再提天基需求→获取震后影像→自动对比完成灾后评估",
    },
    thinkingChain: {
      intentRecognition: "用户需求为柳州柳南区 5.2 级地震灾后即时评估，需先查询权威基础信息，先获取震前影像，再获取震后影像，完成影像对比与灾后评估",
      entityExtraction: `事件=${regionName} 5.2级地震; 时间=2026-05-18 00:21:04; 区域=${regionName}; 震中=109.26°E, 24.38°N; 深度=8km`,
      taskPlanning: "①查询官网地震信息→②定位评估区域→③获取震前影像→④获取震后影像→⑤AI对比评估",
      subtaskCount: 5,
      executionScheduling: "subtask-3(震前) 和 subtask-4(震后) 技术上可并行，但串行展示更利于理解；评估步骤依赖两者结果",
    },
    mainTask: {
      name: `${regionName} 5.2 级地震灾后智能评估`,
      id: "TASK-LZ-EQ-ASSESS-20260518-001",
      status: "执行中",
      progress: 0,
    },
    subtasks,
    finalEvent: {
      type: "地震灾后评估",
      riskLevelHint: "高危",
      gisReplayObjectTypes: ["region", "imagery", "damage", "info"],
    },
  };
}

// Mock 版本：不调用真实 API，返回固定计划（用于快速验证）
function mockGeneratePlan(
  query: string,
  _context?: Record<string, unknown>
): Promise<Plan> {
  const q = query.toLowerCase();

  // 火灾检测类（与入口处的写死保持一致，作为双保险）
  if (isFireQuery(query)) {
    return Promise.resolve(buildFireMonitoringPlan(query));
  }

  // 新闻查询类
  const isNewsQuery =
    q.includes("新闻") ||
    q.includes("报道") ||
    q.includes("舆情") ||
    q.includes("媒体") ||
    q.includes("最新") ||
    q.includes("动态");

  if (isNewsQuery) {
    return Promise.resolve({
      goal: query,
      steps: [
        {
          id: "step-1",
          description: "提取查询关键词",
          purpose: "识别用户关注的核心主题和区域范围",
          expectedOutput: "关键词：南海、局势；区域：南海；时间范围：近期",
        },
        {
          id: "step-2",
          description: "设定检索条件",
          purpose: "将自然语言转化为结构化新闻检索参数",
          expectedOutput: "检索条件：query=南海+局势, region=南海, timeRange=7d",
        },
        {
          id: "step-3",
          description: "获取新闻数据",
          purpose: "从新闻数据源中检索符合条件的最新报道",
          expectedOutput: "新闻列表：标题、来源、发布时间、摘要",
        },
        {
          id: "step-4",
          description: "汇总分析摘要",
          purpose: "对新闻内容进行聚类和关键信息提取",
          expectedOutput: "按主题分类的新闻摘要和趋势判断",
        },
      ],
      reasoning: `用户请求获取${query}的最新资讯，属于实时新闻查询场景，需提取关键词后检索外部新闻数据并生成摘要。`,
    });
  }

  return Promise.resolve({
    goal: query,
    steps: [
      {
        id: "step-1",
        description: "分析用户请求意图",
        purpose: "理解用户需求，确定任务类型",
        expectedOutput: "意图分类结果",
      },
      {
        id: "step-2",
        description: "检索目标区域实时船舶数据",
        purpose: "获取所需的船舶、飞机等实体信息和态势数据",
        expectedOutput: "目标区域实体数据集",
      },
      {
        id: "step-3",
        description: "执行态势分析",
        purpose: "基于数据评估当前海域态势和风险等级",
        expectedOutput: "态势评估报告",
      },
      {
        id: "step-4",
        description: "生成可视化结果",
        purpose: "将分析结果转为GIS可展示格式",
        expectedOutput: "GIS图层数据",
      },
    ],
    reasoning: `基于查询"${query}"，需要依次完成意图分析、数据检索、态势分析和结果可视化。`,
  });
}

// ==================== 意图分类 ====================

export interface IntentClassification {
  intent: "earthquake" | "flood" | "fire" | "oil_spill" | "dynamic";
  params: Record<string, unknown>;
  missingParams: string[];
  confidence: number;
  hardcoded?: boolean;
}

// ========== 硬编码意图匹配表（基于关键词片段的近似匹配）==========

interface KeywordIntent {
  intent: IntentClassification["intent"];
  params: Record<string, unknown>;
  required: string[];      // 必须全部命中
  optional: string[];      // 命中越多 confidence 越高
  minOptional: number;     // 至少命中多少个 optional
}

const KEYWORD_INTENTS: KeywordIntent[] = [
  {
    intent: "fire",
    params: { regionName: "新疆-哈萨克斯坦接壤段", region: "新疆-哈萨克斯坦接壤段", fireScenario: true },
    required: ["火情", "火灾"],
    optional: ["新疆", "哈萨克斯坦", "接壤", "边境", "研判", "卫星", "遥感", "火点"],
    minOptional: 3,
  },
  {
    intent: "oil_spill",
    params: { regionName: "中国东海", region: "中国东海", detectOilSpill: true },
    required: ["油污", "油膜", "溢油", "漏油"],
    optional: ["东海", "天基", "影像", "气象", "反推", "漂移", "AIS", "轨迹", "船舶", "肇事", "嫌疑", "排序", "研判", "排污", "溯源"],
    minOptional: 9,
  },
  {
    intent: "earthquake",
    params: { regionName: "柳州柳南区", region: "广西柳州市柳南区", earthquakeScenario: true },
    required: ["地震", "震后", "震中", "震前"],
    optional: ["柳州", "柳南区", "灾后评估", "影像", "天基", "损毁", "对比", "应急", "成像"],
    minOptional: 5,
  },
  {
    intent: "flood",
    params: { regionName: "石门县", region: "湖南石门县", floodScenario: true },
    required: ["洪涝", "洪水", "暴雨", "淹没"],
    optional: ["石门", "湖南", "灾后评估", "影像", "天基", "对比", "气象", "水利", "应急"],
    minOptional: 6,
  },
];

function matchKeywordIntent(query: string): KeywordIntent | null {
  const q = query.toLowerCase();
  for (const ki of KEYWORD_INTENTS) {
    // required 是同义词列表，命中任意一个即可判定属于该意图
    const hasRequired = ki.required.some((word) => q.includes(word.toLowerCase()));
    if (!hasRequired) continue;

    const matchedOptional = ki.optional.filter((word) => q.includes(word.toLowerCase()));
    if (matchedOptional.length >= ki.minOptional) {
      console.log(`[Intent] Keyword match: intent=${ki.intent}, required=hit, optional=${matchedOptional.length}/${ki.optional.length} (min=${ki.minOptional})`);
      return ki;
    }
  }
  return null;
}

export async function classifyIntent(query: string): Promise<IntentClassification> {
  const trimmed = query.trim();

  // 1. 关键词片段近似匹配
  const keywordMatch = matchKeywordIntent(trimmed);
  if (keywordMatch) {
    return {
      intent: keywordMatch.intent,
      params: { ...keywordMatch.params, query: trimmed },
      missingParams: [],
      confidence: 1.0,
      hardcoded: true,
    };
  }

  // 2. 订阅触发的火情研判（scheduler 标准化 query）
  if (isScheduledFireInvestigation(trimmed)) {
    console.log(`[Intent] Scheduled fire investigation detected`);
    return {
      intent: "fire",
      params: { query: trimmed, fireScenario: true },
      missingParams: [],
      confidence: 1.0,
      hardcoded: true,
    };
  }

  // 未命中 → 走 DeepSeek Planner 自主解析
  console.log(`[Intent] No hardcoded match, delegating to DeepSeek planner...`);
  return {
    intent: "dynamic",
    params: { query: trimmed },
    missingParams: [],
    confidence: 0.0,
    hardcoded: false,
  };
}

export const plannerService: PlannerService = {
  generatePlan: async (query, context) => {
    const classification = context?._classification as IntentClassification | undefined;

    // 硬编码场景：统一通过 classifyIntent 的结果判断，不再做关键词匹配
    if (classification?.hardcoded) {
      switch (classification.intent) {
        case "fire":
          console.log("[Planner] Hardcoded fire scenario, returning investigation plan");
          return buildFireInvestigationPlan(query, context);
        case "flood":
          console.log("[Planner] Hardcoded flood scenario, returning plan");
          return buildFloodPlan(query);
        case "earthquake":
          console.log("[Planner] Hardcoded earthquake scenario, returning plan");
          return buildEarthquakePlan(query);
        case "oil_spill":
          console.log("[Planner] Hardcoded oil spill scenario, returning plan");
          return buildOilSpillTracingPlan(query);
      }
    }

    const useMock = process.env.MOCK_PLANNER === "true" || !DEEPSEEK_API_KEY;
    console.log(`[Planner] MOCK_PLANNER=${process.env.MOCK_PLANNER}, DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY ? "set" : "empty"}, useMock=${useMock}`);
    if (useMock) {
      return mockGeneratePlan(query, context);
    }
    return callDeepSeekPlanner(query, context);
  },

  classifyIntent,
};
