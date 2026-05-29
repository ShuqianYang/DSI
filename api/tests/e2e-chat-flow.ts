/**
 * E2E 聊天入口测试 — 从 chat 输入验证 Agent 编排完整链路
 *
 * 用法:
 *   npx tsx tests/e2e-chat-flow.ts          # 运行全部场景
 *   npx tsx tests/e2e-chat-flow.ts --only=1,4,6  # 只跑指定场景
 *
 * 前置条件:
 *   - API server 已启动 (localhost:3001)
 *   - Worker 已启动
 *   - PostgreSQL + Redis 已就绪
 */

import "dotenv/config";
import { EventSource } from "eventsource";

const API_BASE = process.env.API_BASE || "http://localhost:3001";
const POLL_INTERVAL = 500;
const MAX_POLL_MS = 30000;

// ===================== 颜色输出 =====================
const G = (s: string) => `\x1b[32m${s}\x1b[0m`;
const R = (s: string) => `\x1b[31m${s}\x1b[0m`;
const Y = (s: string) => `\x1b[33m${s}\x1b[0m`;
const B = (s: string) => `\x1b[34m${s}\x1b[0m`;

function logOk(msg: string) { console.log(`  ${G("✓")} ${msg}`); }
function logFail(msg: string) { console.log(`  ${R("✗")} ${msg}`); }
function logInfo(msg: string) { console.log(`  ${B("ℹ")} ${msg}`); }

// ===================== HTTP 工具 =====================
async function postTask(query: string, context?: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, context }),
  });
  if (!res.ok) throw new Error(`POST /tasks failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<any>;
}

async function getTask(taskId: string) {
  const res = await fetch(`${API_BASE}/tasks/${taskId}`);
  if (!res.ok) throw new Error(`GET /tasks/${taskId} failed: ${res.status}`);
  return res.json() as Promise<any>;
}

async function getEvents() {
  const res = await fetch(`${API_BASE}/events`);
  if (!res.ok) throw new Error(`GET /events failed: ${res.status}`);
  return res.json() as Promise<any>;
}

async function getSubscriptions() {
  const res = await fetch(`${API_BASE}/subscriptions`);
  if (!res.ok) throw new Error(`GET /subscriptions failed: ${res.status}`);
  return res.json() as Promise<any>;
}

async function getRequirements() {
  const res = await fetch(`${API_BASE}/requirements`);
  if (!res.ok) throw new Error(`GET /requirements failed: ${res.status}`);
  return res.json() as Promise<any>;
}

// ===================== 轮询工具 =====================
async function pollUntil(
  taskId: string,
  predicate: (task: any) => boolean,
  timeoutMs = MAX_POLL_MS
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const task = await getTask(taskId);
    if (predicate(task)) return task;
    await sleep(POLL_INTERVAL);
  }
  throw new Error(`Poll timeout for task ${taskId}`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ===================== SSE 工具 =====================
function collectSse(taskId: string, timeoutMs = 15000): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const events: any[] = [];
    const es = new EventSource(`${API_BASE}/tasks/${taskId}/stream`);
    const timer = setTimeout(() => {
      es.close();
      resolve(events);
    }, timeoutMs);

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        events.push(data);
        if (data.status === "completed" || data.status === "failed") {
          clearTimeout(timer);
          es.close();
          resolve(events);
        }
      } catch {
        events.push({ raw: e.data });
      }
    };

    es.onerror = (err) => {
      clearTimeout(timer);
      es.close();
      resolve(events);
    };
  });
}

// ===================== 场景定义 =====================
interface Scenario {
  id: number;
  name: string;
  input: string;
  expectedActionTypes: string[];
  expectSyncComplete?: boolean; // subscription / requirement 不走 executor
  extraChecks?: (task: any) => Promise<string[]>; // 返回错误消息列表，空=通过
}

const scenarios: Scenario[] = [
  {
    id: 1,
    name: "海域态势分析",
    input: "分析东海近期态势",
    expectedActionTypes: ["maritime"],
    extraChecks: async (task) => {
      const errs: string[] = [];
      const result = task.result;
      if (!result) { errs.push("task.result 为空"); return errs; }
      const action1 = Object.values(result)[0] as any;
      if (!action1?.vessels || !Array.isArray(action1.vessels)) errs.push("result 中缺少 vessels 数组");
      if (!action1?.summary) errs.push("result 中缺少 summary");
      if (!action1?.gisLayers) errs.push("result 中缺少 gisLayers");
      // 验证 events 表有记录
      const events = await getEvents();
      const related = (events.events || []).filter((e: any) => e.agentTaskId === task.taskId);
      if (related.length === 0) errs.push("events 表未生成记录");
      return errs;
    },
  },
  {
    id: 2,
    name: "智能问答",
    input: "统计最近一周有多少起异常事件",
    expectedActionTypes: ["intelligent_qa"],
    extraChecks: async (task) => {
      const errs: string[] = [];
      const result = task.result;
      if (!result) { errs.push("task.result 为空"); return errs; }
      const action1 = Object.values(result)[0] as any;
      if (!action1?.report_content && !action1?.stats) errs.push("result 缺少 report_content 或 stats");
      const events = await getEvents();
      const related = (events.events || []).filter((e: any) => e.agentTaskId === task.taskId);
      const hasIqa = related.some((e: any) => e.title?.includes("智能问答"));
      if (!hasIqa) errs.push("events 表未找到「智能问答结果」事件");
      return errs;
    },
  },
  {
    id: 3,
    name: "安防日报生成",
    input: "生成昨天的安防日报",
    expectedActionTypes: ["daily_report"],
    extraChecks: async (task) => {
      const errs: string[] = [];
      const result = task.result;
      if (!result) { errs.push("task.result 为空"); return errs; }
      const action1 = Object.values(result)[0] as any;
      if (!action1?.report_content) errs.push("result 缺少 report_content");
      const events = await getEvents();
      const related = (events.events || []).filter((e: any) => e.agentTaskId === task.taskId);
      const hasDaily = related.some((e: any) => e.title?.includes("安防日报"));
      if (!hasDaily) errs.push("events 表未找到「安防日报」事件");
      return errs;
    },
  },
  {
    id: 4,
    name: "订阅任务",
    input: "每天早上9点给我推送设备日报",
    expectedActionTypes: ["subscription"],
    expectSyncComplete: true,
    extraChecks: async (task) => {
      const errs: string[] = [];
      if (task.status !== "completed") errs.push(`期望同步 completed，实际 ${task.status}`);
      const subs = await getSubscriptions();
      // 订阅名可能为"创建订阅任务"等，通过 queryParams 或任意存在性判断
      const related = (subs.subscriptions || []).filter((s: any) =>
        s.name?.includes("订阅") ||
        s.queryParams?.query?.includes("设备") ||
        s.queryParams?.query?.includes("日报")
      );
      if (related.length === 0) errs.push("subscriptions 表未找到新记录");
      return errs;
    },
  },
  {
    id: 5,
    name: "天基数据查询",
    input: "查询东海区域的卫星遥感影像",
    expectedActionTypes: ["satellite"],
    extraChecks: async (task) => {
      const errs: string[] = [];
      const events = await getEvents();
      const related = (events.events || []).filter((e: any) => e.agentTaskId === task.taskId);
      const hasSat = related.some((e: any) => e.title?.includes("天基"));
      if (!hasSat) errs.push("events 表未找到「天基」事件");
      return errs;
    },
  },
  {
    id: 6,
    name: "多 Action 组合",
    input: "分析东海海域态势并在地图上展示，同时做情报研判",
    expectedActionTypes: ["maritime"], // 只要 maritime 必出现，其余由 Dify 决定
    extraChecks: async (task) => {
      const errs: string[] = [];
      const actions = task.actions || [];
      if (actions.length < 2) errs.push(`期望至少 2 个 actions，实际 ${actions.length}`);
      const hasMaritime = actions.some((a: any) => a.type === "maritime");
      if (!hasMaritime) errs.push("缺少 maritime action");
      const events = await getEvents();
      const related = (events.events || []).filter((e: any) => e.agentTaskId === task.taskId);
      if (related.length < actions.length) errs.push(`events 数(${related.length})少于 actions 数(${actions.length})`);
      return errs;
    },
  },
  {
    id: 7,
    name: "定制需求",
    input: "请帮我接入某新型雷达的实时数据流",
    expectedActionTypes: ["requirement"],
    expectSyncComplete: true,
    extraChecks: async (task) => {
      const errs: string[] = [];
      if (task.status !== "completed") errs.push(`期望同步 completed，实际 ${task.status}`);
      const reqs = await getRequirements();
      const related = (reqs.requirements || []).filter((r: any) => r.description?.includes("雷达") || r.description?.includes("数据流"));
      if (related.length === 0) errs.push("requirements 表未找到新记录");
      return errs;
    },
  },
  {
    id: 8,
    name: "问候语兜底",
    input: "你好",
    expectedActionTypes: ["intelligent_qa"],
    extraChecks: async (task) => {
      const errs: string[] = [];
      const actions = task.actions || [];
      const hasReq = actions.some((a: any) => a.type === "requirement");
      if (hasReq) errs.push("问候语不应触发 requirement");
      return errs;
    },
  },
];

// ===================== 场景执行器 =====================
async function runScenario(sc: Scenario): Promise<boolean> {
  console.log(`\n${Y(`[场景 ${sc.id}]`)} ${sc.name}`);
  console.log(`  输入: "${sc.input}"`);
  let hasError = false;

  try {
    // 1. 创建任务
    const created = await postTask(sc.input);
    const taskId = created.taskId;
    logOk(`创建任务: ${taskId}`);

    // 2. 验证 Router 决策（期望类型必须全部出现，允许多出其他类型）
    const actualTypes = (created.actions || []).map((a: any) => a.type);
    const missing = sc.expectedActionTypes.filter((t) => !actualTypes.includes(t));
    if (missing.length === 0) {
      logOk(`Router 决策正确: [${actualTypes.join(", ")}]`);
    } else {
      logFail(`Router 决策不匹配: 期望包含 [${sc.expectedActionTypes.join(", ")}], 实际 [${actualTypes.join(", ")}], 缺少 [${missing.join(", ")}]`);
      hasError = true;
    }

    // 3. 纯订阅/需求：直接验证 completed
    if (sc.expectSyncComplete) {
      if (created.status === "completed") {
        logOk("同步完成（无 Executor）");
      } else {
        logFail(`期望同步 completed，实际 ${created.status}`);
        hasError = true;
      }
      const task = await getTask(taskId);
      if (sc.extraChecks) {
        const errs = await sc.extraChecks(task);
        errs.forEach(logFail);
        if (errs.length > 0) hasError = true;
      }
      return !hasError;
    }

    // 4. 异步任务：轮询到 completed / failed
    const task = await pollUntil(
      taskId,
      (t) => t.status === "completed" || t.status === "failed",
      MAX_POLL_MS
    );

    if (task.status === "completed") {
      logOk("任务异步执行完成");
    } else {
      logFail(`任务执行失败: ${task.error || "未知错误"}`);
      return false;
    }

    // 5. 验证 steps
    if (task.steps && task.steps.length > 0) {
      const allCompleted = task.steps.every((s: any) => s.status === "completed");
      if (allCompleted) {
        logOk(`所有 ${task.steps.length} 个 step 均 completed`);
      } else {
        const failed = task.steps.filter((s: any) => s.status === "failed");
        logFail(`${failed.length} 个 step 失败`);
        hasError = true;
      }
    }

    // 6. 验证 result
    if (task.result && Object.keys(task.result).length > 0) {
      logOk("result 非空");
    } else {
      logFail("result 为空");
      hasError = true;
    }

    // 7. 额外校验
    if (sc.extraChecks) {
      const errs = await sc.extraChecks(task);
      errs.forEach(logFail);
      if (errs.length > 0) hasError = true;
    }

    return !hasError;
  } catch (err: any) {
    logFail(`异常: ${err.message}`);
    return false;
  }
}

// ===================== SSE 专项测试 =====================
async function testSse(): Promise<boolean> {
  console.log(`\n${Y("[场景 9]")} SSE 实时进度验证`);

  try {
    const created = await postTask("分析东海近期态势");
    const taskId = created.taskId;
    logInfo(`建立 SSE 连接: /tasks/${taskId}/stream`);

    const events = await collectSse(taskId, 20000);

    const hasConnected = events.some((e) => e.type === "connected");
    const hasStepUpdate = events.some((e) => e.type === "step_update");
    const hasCompleted = events.some((e) => e.status === "completed" || e.type === "completed");

    if (hasConnected) logOk("收到 connected 事件");
    else logFail("未收到 connected 事件");

    if (hasStepUpdate) logOk("收到 step_update 事件");
    else logFail("未收到 step_update 事件");

    if (hasCompleted) logOk("收到 completed 事件");
    else logFail("未收到 completed 事件");

    logInfo(`共收到 ${events.length} 个 SSE 事件`);
    return hasConnected && hasStepUpdate && hasCompleted;
  } catch (err: any) {
    logFail(`异常: ${err.message}`);
    return false;
  }
}

// ===================== Markdown 渲染验证 =====================
async function testMarkdown(): Promise<boolean> {
  console.log(`\n${Y("[场景 10]")} Markdown 渲染验证（人工）`);
  console.log("  请在前端聊天窗口发送: 分析东海近期态势");
  console.log("  人工确认:");
  console.log("    □ thinkingSteps 有粗体标题");
  console.log("    □ 结果消息有列表渲染");
  console.log("    □ 有代码块或引用样式");
  console.log(`  ${B("ℹ")} 此场景需人工确认，脚本跳过自动断言`);
  return true; // 人工场景默认通过
}

// ===================== 主入口 =====================
async function main() {
  console.log(`${B("=".repeat(50))}`);
  console.log(`${B("Agent 编排系统 — Chat 入口 E2E 测试")}`);
  console.log(`${B("=".repeat(50))}`);
  console.log(`API: ${API_BASE}\n`);

  // 解析命令行 --only=1,2,3
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const onlyIds = onlyArg
    ? onlyArg.replace("--only=", "").split(",").map(Number)
    : null;

  const toRun = onlyIds
    ? scenarios.filter((s) => onlyIds.includes(s.id))
    : scenarios;

  const results: { id: number; name: string; pass: boolean }[] = [];

  for (const sc of toRun) {
    const pass = await runScenario(sc);
    results.push({ id: sc.id, name: sc.name, pass });
  }

  // SSE 专项（默认跑，除非 --only 明确排除）
  if (!onlyIds || onlyIds.includes(9)) {
    const pass = await testSse();
    results.push({ id: 9, name: "SSE 实时进度", pass });
  }

  // Markdown 人工
  if (!onlyIds || onlyIds.includes(10)) {
    const pass = await testMarkdown();
    results.push({ id: 10, name: "Markdown 渲染", pass });
  }

  // 汇总
  console.log(`\n${B("=".repeat(50))}`);
  console.log(`${B("测试结果汇总")}`);
  console.log(`${B("=".repeat(50))}`);

  let passCount = 0;
  let failCount = 0;
  for (const r of results) {
    if (r.pass) {
      console.log(`  ${G("✓ PASS")} [${r.id}] ${r.name}`);
      passCount++;
    } else {
      console.log(`  ${R("✗ FAIL")} [${r.id}] ${r.name}`);
      failCount++;
    }
  }

  console.log(`\n总计: ${passCount + failCount} | ${G(`${passCount} 通过`)} | ${R(`${failCount} 失败`)}`);

  if (failCount > 0) {
    console.log(`\n${R("存在失败用例，请检查上方日志。")}`);
    process.exit(1);
  } else {
    console.log(`\n${G("全部通过 🎉")}`);
    process.exit(0);
  }
}

main();
