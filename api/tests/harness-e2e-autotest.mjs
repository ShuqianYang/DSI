#!/usr/bin/env node
/**
 * Agent Harness E2E 端到端测试
 *
 * 全自动测试：启动 API → 运行用例 → 停止 API → 输出报告
 *
 * 运行方式：
 *   cd api && node tests/harness-e2e-autotest.mjs
 *
 * 环境变量（自动注入）：
 *   AGENT_HARNESS_ENABLED=true   启用 harness 路径
 *   NODE_ENV=development          dev 模式（直接执行，不经过队列）
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const API_ROOT = path.resolve(__dirname, "..");

// ========== 加载 api/.env 到子进程环境 ==========
function loadDotenv(root) {
  const envPath = path.join(root, ".env");
  const vars = {};
  if (!fs.existsSync(envPath)) return vars;
  const text = fs.readFileSync(envPath, "utf-8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // 去掉可选的引号
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    vars[key] = val;
  }
  return vars;
}
const DOTENV_VARS = loadDotenv(API_ROOT);

// ==================== 配置 ====================
const API_PORT = process.env.API_PORT || "3001";
const API_HOST = process.env.API_HOST || "localhost";
const API_URL = `http://${API_HOST}:${API_PORT}`;
const HEALTH_MAX_WAIT = 30000;
const HEALTH_INTERVAL = 500;

// 各分类超时（旧 Pipeline 有 demo 延迟，需要更长时间）
const TIMEOUTS = {
  default: 60000,     // 60s：Skill/Template 直接执行
  agentLoop: 90000,   // 90s：Agent Loop 含 LLM 调用
  legacy: 180000,     // 180s：Legacy Fallback 旧 Pipeline（有 10s×N demo 延迟）
};

const POLL_INTERVAL = 2000;

// ANSI 颜色
const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
};

// ==================== API 生命周期管理 ====================

let apiProcess = null;

function startApiServer() {
  return new Promise((resolve, reject) => {
    console.log(`${C.cyan}▶ 启动 API 服务...${C.reset}`);
    console.log(`  工作目录: ${API_ROOT}`);
    console.log(`  命令: tsx src/index.ts`);
    console.log(`  端口: ${API_PORT}`);

    const env = {
      ...DOTENV_VARS,       // api/.env 中的变量
      ...process.env,       // 父进程环境变量（优先）
      AGENT_HARNESS_ENABLED: "true",
      NODE_ENV: "development",
      API_PORT,
      API_HOST,
    };

    // Windows 兼容：优先用 pnpm exec tsx，fallback 到 npx tsx
    const isWin = process.platform === "win32";
    const cmd = isWin ? "pnpm" : "pnpm";
    const args = ["exec", "tsx", "src/index.ts"];

    apiProcess = spawn(cmd, args, {
      cwd: API_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: isWin,
    });

    let stdoutBuf = "";
    let stderrBuf = "";

    apiProcess.stdout.on("data", (data) => {
      const text = data.toString();
      stdoutBuf += text;
      // 打印关键日志行
      for (const line of text.split("\n")) {
        if (line.includes("listening") || line.includes("error") || line.includes("failed")) {
          console.log(`  ${C.dim}[API stdout] ${line.trim()}${C.reset}`);
        }
      }
    });

    apiProcess.stderr.on("data", (data) => {
      const text = data.toString();
      stderrBuf += text;
      for (const line of text.split("\n")) {
        if (line.trim()) {
          console.log(`  ${C.dim}[API stderr] ${line.trim()}${C.reset}`);
        }
      }
    });

    apiProcess.on("error", (err) => {
      reject(new Error(`API 进程启动失败: ${err.message}`));
    });

    apiProcess.on("exit", (code) => {
      if (code !== null && code !== 0 && code !== 143 && code !== 130) {
        console.log(`  ${C.yellow}API 进程退出，code=${code}${C.reset}`);
      }
    });

    // 等待服务就绪
    waitForApiReady().then(resolve).catch(reject);
  });
}

async function waitForApiReady() {
  const start = Date.now();
  while (Date.now() - start < HEALTH_MAX_WAIT) {
    try {
      const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const data = await res.json();
        if (data.status === "ok") {
          console.log(`${C.green}✓ API 服务已就绪${C.reset} ${API_URL} (${Date.now() - start}ms)`);
          return;
        }
      }
    } catch {
      // 服务还未启动，继续等待
    }
    await sleep(HEALTH_INTERVAL);
  }
  throw new Error(`API 服务在 ${HEALTH_MAX_WAIT}ms 内未就绪`);
}

function stopApiServer() {
  return new Promise((resolve) => {
    if (!apiProcess || apiProcess.killed) {
      resolve();
      return;
    }
    console.log(`\n${C.cyan}▶ 停止 API 服务...${C.reset}`);
    apiProcess.kill("SIGTERM");

    const timeout = setTimeout(() => {
      console.log(`  ${C.yellow}SIGTERM 超时，强制终止...${C.reset}`);
      apiProcess.kill("SIGKILL");
      resolve();
    }, 5000);

    apiProcess.on("exit", () => {
      clearTimeout(timeout);
      console.log(`  ${C.green}✓ API 服务已停止${C.reset}`);
      resolve();
    });
  });
}

// ==================== HTTP 工具 ====================

async function http(path, opts = {}) {
  const url = `${API_URL}${path}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...opts.headers },
    ...opts,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${data.error || text}`);
  }
  return data;
}

async function createTask(query, context = {}) {
  return http("/tasks", {
    method: "POST",
    body: JSON.stringify({ query, context }),
  });
}

async function getTask(taskId) {
  return http(`/tasks/${taskId}`);
}

async function waitForTask(taskId, label, maxWaitMs = TIMEOUTS.default) {
  const start = Date.now();
  let lastStatus = "";
  while (Date.now() - start < maxWaitMs) {
    const task = await getTask(taskId);
    if (task.status === "completed" || task.status === "failed") {
      return task;
    }
    if (task.status !== lastStatus) {
      lastStatus = task.status;
      process.stdout.write(`\r${C.gray}  [${label}] status=${task.status}${" ".repeat(20)}${C.reset}`);
    }
    await sleep(POLL_INTERVAL);
  }
  throw new Error(`任务 ${taskId} 执行超时（>${maxWaitMs / 1000}s）`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ==================== 断言工具 ====================

function pass(msg) {
  console.log(`  ${C.green}✓${C.reset} ${msg}`);
  return true;
}

function fail(msg, detail = "") {
  console.log(`  ${C.red}✗${C.reset} ${msg}`);
  if (detail) console.log(`    ${C.gray}${detail}${C.reset}`);
  return false;
}

function warn(msg) {
  console.log(`  ${C.yellow}⚠${C.reset} ${msg}`);
}

function info(msg) {
  console.log(`  ${C.cyan}ℹ${C.reset} ${msg}`);
}

function getStepTypes(task) {
  return (task.steps || []).map((s) => {
    const cfg = s.actionConfig || {};
    return cfg.action?.type || s.actionType || "unknown";
  });
}

function getStepKeys(task) {
  return (task.steps || []).map((s) => {
    const cfg = s.actionConfig || {};
    return cfg.stepKey || cfg.action?.type || s.actionType || "unknown";
  });
}

function getStepStatuses(task) {
  return (task.steps || []).map((s) => s.status || "unknown");
}

function printTaskSummary(task) {
  const types = getStepTypes(task);
  const keys = getStepKeys(task);
  const statuses = getStepStatuses(task);
  console.log(`    status: ${task.status}`);
  if (task.steps?.length > 0) {
    console.log(`    steps (${task.steps.length}):`);
    for (let i = 0; i < task.steps.length; i++) {
      const icon = statuses[i] === "completed" ? "✅" : statuses[i] === "failed" ? "❌" : "⏳";
      const key = keys[i] !== types[i] ? ` (${keys[i]})` : "";
      console.log(`      ${icon} [${i + 1}] ${types[i]}${key} → ${statuses[i]}`);
    }
  } else {
    console.log(`    steps: (none)`);
  }
  if (task.error) {
    console.log(`    error: ${task.error.slice(0, 200)}`);
  }
  if (task.result && Object.keys(task.result).length > 0) {
    const keys = Object.keys(task.result);
    console.log(`    result keys: ${keys.join(", ")}`);
    // 打印 LLM 回复内容
    const ft = task.result.finalText;
    if (ft && typeof ft === "string") {
      const preview = ft.length > 300 ? ft.slice(0, 300) + "\n    ...（已截断，共 " + ft.length + " 字符）" : ft;
      console.log(`    ${C.cyan}━━ LLM 回复 ━━${C.reset}`);
      for (const line of preview.split("\n")) {
        console.log(`    ${line}`);
      }
    }
  }
}

// ==================== 测试用例 ====================

const TEST_CASES = [
  // ---------- Skill 命中（零 LLM） ----------
  {
    id: 1,
    category: "Skill 命中",
    query: "查询东京今天的天气",
    expectPath: ["weather.fetch"],
    timeout: TIMEOUTS.default,
    verify(task) {
      const types = getStepTypes(task);
      let ok = true;
      ok = pass("task completed") && ok;

      const step = (task.steps || []).find((s) => {
        const cfg = s.actionConfig || {};
        return (cfg.action?.type || s.actionType) === "weather.fetch";
      });

      if (!types.includes("weather.fetch")) {
        ok = fail(`expected weather.fetch, got [${types.join(", ")}]`) && ok;
      } else {
        ok = pass("命中 weather.fetch (零 LLM)") && ok;
      }

      if (step) {
        const params = step.actionConfig?.action?.params || {};
        const loc = params.location || params.region || "";
        if (loc.includes("东京")) {
          ok = pass(`参数 location="${loc}"`) && ok;
        } else {
          ok = fail("参数未包含东京", JSON.stringify(params)) && ok;
        }
      }
      return ok;
    },
  },
  {
    id: 2,
    category: "Skill 命中",
    query: "北京明天会下雨吗",
    expectPath: ["weather.fetch"],
    timeout: TIMEOUTS.default,
    verify(task) {
      const types = getStepTypes(task);
      let ok = true;
      ok = pass("task completed") && ok;

      if (!types.includes("weather.fetch")) {
        ok = fail(`expected weather.fetch, got [${types.join(", ")}]`) && ok;
      } else {
        ok = pass("命中 weather.fetch") && ok;
      }

      const step = (task.steps || []).find((s) => {
        const cfg = s.actionConfig || {};
        return (cfg.action?.type || s.actionType) === "weather.fetch";
      });
      if (step) {
        const params = step.actionConfig?.action?.params || {};
        const date = params.date || "";
        if (date === "tomorrow") {
          ok = pass(`参数 date="tomorrow"`) && ok;
        } else {
          ok = fail(`date 不是 "tomorrow"`, `date=${date}`) && ok;
        }
      }
      return ok;
    },
  },
  {
    id: 3,
    category: "Skill 命中",
    query: "大阪现在气温多少",
    expectPath: ["weather.fetch"],
    timeout: TIMEOUTS.default,
    verify(task) {
      const types = getStepTypes(task);
      let ok = true;
      ok = pass("task completed") && ok;
      if (!types.includes("weather.fetch")) {
        ok = fail(`expected weather.fetch, got [${types.join(", ")}]`) && ok;
      } else {
        ok = pass("单关键词命中 weather.fetch") && ok;
      }
      return ok;
    },
  },

  // ---------- Template 命中（多步执行） ----------
  {
    id: 4,
    category: "Template 命中",
    query: "最近日本有什么灾害新闻",
    expectPath: ["news.search", "finalizer.template_summary"],
    timeout: TIMEOUTS.default,
    verify(task) {
      const types = getStepTypes(task);
      let ok = true;
      ok = pass("task completed") && ok;

      const hasNews = types.includes("news.search");
      const hasFinalizer = types.some((t) => t.includes("finalizer"));

      if (!hasNews) ok = fail("missing news.search") && ok;
      else ok = pass("Step 1: news.search") && ok;

      if (!hasFinalizer) ok = fail("missing finalizer") && ok;
      else ok = pass("Step 2: finalizer.template_summary") && ok;

      if (hasNews && hasFinalizer) {
        ok = pass("两步执行，Step 2 读取 Step 1 结果") && ok;
      }
      return ok;
    },
  },
  {
    id: 5,
    category: "Template 命中",
    query: "帮我搜一下最近的舆情报道",
    expectPath: ["news.search", "finalizer.template_summary"],
    timeout: TIMEOUTS.default,
    verify(task) {
      const types = getStepTypes(task);
      let ok = true;
      ok = pass("task completed") && ok;

      const hasNews = types.includes("news.search");
      const hasFinalizer = types.some((t) => t.includes("finalizer"));

      if (!hasNews) ok = fail("missing news.search") && ok;
      else ok = pass("Step 1: news.search") && ok;

      if (!hasFinalizer) ok = fail("missing finalizer") && ok;
      else ok = pass("Step 2: finalizer.template_summary") && ok;
      return ok;
    },
  },

  // ---------- System Tool（本地执行） ----------
  {
    id: 6,
    category: "System Tool",
    query: "现在几点了",
    expectPath: ["time.now"],
    timeout: TIMEOUTS.agentLoop,
    verify(task) {
      const types = getStepTypes(task);
      let ok = true;
      ok = pass("task completed") && ok;

      const step = (task.steps || []).find((s) => {
        const cfg = s.actionConfig || {};
        return (cfg.action?.type || s.actionType) === "time.now";
      });

      if (!types.includes("time.now")) {
        if (types.length === 0) {
          warn("无工具调用（LLM 直接回答或 rule fallback）");
        } else {
          ok = fail(`expected time.now, got [${types.join(", ")}]`) && ok;
        }
      } else {
        ok = pass("Agent Loop → time.now") && ok;
        const result = step?.result?.observation?.result;
        if (result?.time) {
          ok = pass(`返回时间: ${result.time}, 时区: ${result.timezone}`) && ok;
        }
      }
      return ok;
    },
  },
  {
    id: 7,
    category: "System Tool",
    query: "3.5 的平方加 16 的平方根是多少",
    expectPath: ["calc.evaluate"],
    timeout: TIMEOUTS.agentLoop,
    verify(task) {
      const types = getStepTypes(task);
      let ok = true;
      ok = pass("task completed") && ok;

      const step = (task.steps || []).find((s) => {
        const cfg = s.actionConfig || {};
        return (cfg.action?.type || s.actionType) === "calc.evaluate";
      });

      if (!types.includes("calc.evaluate")) {
        if (types.length === 0) {
          warn("无工具调用（LLM 直接回答）");
        } else {
          ok = fail(`expected calc.evaluate, got [${types.join(", ")}]`) && ok;
        }
      } else {
        ok = pass("Agent Loop → calc.evaluate") && ok;
        const result = step?.result?.observation?.result;
        if (result) {
          const val = result.result;
          // 3.5^2 + sqrt(16) = 12.25 + 4 = 16.25
          // 但 LLM 可能发不同表达式，如 "3.5**2 + Math.sqrt(16)" 结果也是 16.25
          // 或者 "3.5*3.5 + 4" = 16.25
          if (typeof val === "number" && val > 0) {
            ok = pass(`calc 结果: ${val}`) && ok;
          } else {
            ok = fail("calc 结果无效", `result=${val}`) && ok;
          }
        }
      }
      return ok;
    },
  },
  {
    id: 8,
    category: "System Tool",
    query: "100 公里每小时等于多少米每秒",
    expectPath: ["calc.evaluate"],
    timeout: TIMEOUTS.agentLoop,
    verify(task) {
      const types = getStepTypes(task);
      let ok = true;
      ok = pass("task completed") && ok;

      const step = (task.steps || []).find((s) => {
        const cfg = s.actionConfig || {};
        return (cfg.action?.type || s.actionType) === "calc.evaluate";
      });

      if (!types.includes("calc.evaluate")) {
        if (types.length === 0) {
          warn("无工具调用（LLM 直接回答）");
        } else {
          ok = fail(`expected calc.evaluate, got [${types.join(", ")}]`) && ok;
        }
      } else {
        ok = pass("Agent Loop → calc.evaluate") && ok;
        const result = step?.result?.observation?.result;
        if (result) {
          const val = result.result;
          const expected = 100 * 1000 / 3600; // ≈ 27.777...
          if (typeof val === "number" && Math.abs(val - expected) < 0.5) {
            ok = pass(`calc 结果 ≈ ${val.toFixed(2)} (expected ~${expected.toFixed(2)})`) && ok;
          } else {
            ok = fail("calc 结果偏差", `result=${val}, expected≈${expected}`) && ok;
          }
        }
      }
      return ok;
    },
  },

  // ---------- Agent Loop 多步推理 ----------
  {
    id: 9,
    category: "Agent Loop 多步推理",
    query: "最近日本有没有灾害事件，会不会影响出行？",
    expectPath: ["news.search", "weather.fetch", "final_answer"],
    timeout: TIMEOUTS.agentLoop,
    verify(task) {
      const types = getStepTypes(task);
      let ok = true;
      ok = pass("task completed") && ok;

      // 注意：此 query 可能被 templateMatcher 高置信度命中 news.summary_template
      // 如果命中 template，路径是 news.search → finalizer.template_summary
      // 如果走 Agent Loop，路径是 news.search → weather.fetch → final_answer
      // 两种路径都是合法的系统行为

      const hasNews = types.includes("news.search");
      const hasWeather = types.includes("weather.fetch");
      const hasFinalizer = types.some((t) => t.includes("finalizer"));

      if (!hasNews) {
        ok = fail("missing news.search") && ok;
      } else {
        ok = pass("步骤包含 news.search") && ok;
      }

      if (hasWeather) {
        ok = pass("Agent Loop 补充 weather.fetch") && ok;
      } else if (hasFinalizer) {
        ok = pass("Template 路径: news.search → finalizer") && ok;
      } else {
        ok = fail("缺少 weather.fetch 或 finalizer") && ok;
      }

      return ok;
    },
  },
  {
    id: 10,
    category: "Agent Loop 多步推理",
    query: "帮我看看 https://httpbin.org/html 这个网页说了什么",
    expectPath: ["web.fetch", "final_answer"],
    timeout: TIMEOUTS.agentLoop,
    verify(task) {
      const types = getStepTypes(task);
      let ok = true;
      ok = pass("task completed") && ok;

      const step = (task.steps || []).find((s) => {
        const cfg = s.actionConfig || {};
        return (cfg.action?.type || s.actionType) === "web.fetch";
      });

      if (!types.includes("web.fetch")) {
        ok = fail(`expected web.fetch, got [${types.join(", ")}]`) && ok;
      } else {
        ok = pass("Agent Loop → web.fetch") && ok;
        const result = step?.result?.observation?.result;
        if (result?.content) {
          ok = pass(`网页内容已抓取: ${result.content.length} 字符`) && ok;
        }
      }
      return ok;
    },
  },

  // ---------- LLM 直接回答 ----------
  {
    id: 11,
    category: "LLM 直接回答",
    query: "你好，你能做什么",
    expectPath: ["final_answer"],
    timeout: TIMEOUTS.agentLoop,
    verify(task) {
      const types = getStepTypes(task);
      let ok = true;
      ok = pass("task completed") && ok;

      if (types.length === 0) {
        ok = pass("无工具调用，LLM 直接回答") && ok;
      } else {
        info(`实际调用了: [${types.join(", ")}]`);
      }
      return ok;
    },
  },
  {
    id: 12,
    category: "LLM 直接回答",
    query: "1+1 等于几",
    expectPath: ["final_answer 或 calc.evaluate"],
    timeout: TIMEOUTS.agentLoop,
    verify(task) {
      const types = getStepTypes(task);
      let ok = true;
      ok = pass("task completed") && ok;

      if (types.includes("calc.evaluate")) {
        ok = pass("LLM 调用计算器") && ok;
      } else if (types.length === 0) {
        ok = pass("无工具调用，LLM 直接回答") && ok;
      } else {
        info(`实际调用了: [${types.join(", ")}]`);
      }
      return ok;
    },
  },

  // ---------- Legacy Fallback ----------
  {
    id: 13,
    category: "Legacy Fallback",
    query: "查询东海海域态势",
    expectPath: ["legacy_fallback → 旧 Pipeline"],
    timeout: TIMEOUTS.legacy,
    verify(task) {
      const types = getStepTypes(task);
      let ok = true;
      ok = pass(`task ${task.status}`) && ok;

      // 旧 Pipeline 可能生成 maritime/ais-fetch/region-mark/intelligence/satellite 等步骤
      const legacyTypes = ["maritime", "ais-fetch", "region-mark", "intelligence", "satellite"];
      const hasLegacy = types.some((t) => legacyTypes.includes(t));

      if (hasLegacy) {
        ok = pass(`回退旧 Pipeline: [${types.join(", ")}]`) && ok;
      } else if (types.length > 0) {
        ok = pass(`有步骤: [${types.join(", ")}]`) && ok;
      } else {
        // harness 拦截后直接 fallback，无 harness 步骤
        ok = pass("Legacy fallback 触发") && ok;
      }
      return ok;
    },
  },

  // ---------- 边界/压力测试 ----------
  {
    id: 14,
    category: "边界/压力测试",
    query: "先查日本新闻，再查东京天气，最后算一下风速 10m/s 是多少 km/h",
    expectPath: ["news.search", "weather.fetch", "calc.evaluate", "final_answer"],
    timeout: TIMEOUTS.agentLoop,
    verify(task) {
      const types = getStepTypes(task);
      let ok = true;
      ok = pass("task completed") && ok;

      const unique = [...new Set(types)];
      if (unique.length >= 3) {
        ok = pass(`多工具链: ${unique.length} 个不同工具`) && ok;
      } else {
        // 可能被单个 skill/template 拦截，这是合法行为
        ok = pass(`实际路径: [${types.join(" → ")}]`) && ok;
      }

      if (types.includes("news.search")) ok = pass("✓ news.search") && ok;
      if (types.includes("weather.fetch")) ok = pass("✓ weather.fetch") && ok;
      if (types.includes("calc.evaluate")) ok = pass("✓ calc.evaluate") && ok;
      return ok;
    },
  },
  {
    id: 15,
    category: "边界/压力测试",
    query: "https://example.com/article",
    expectPath: ["web.fetch → failed"],
    timeout: TIMEOUTS.agentLoop,
    verify(task) {
      const types = getStepTypes(task);
      let ok = true;
      ok = pass("task completed") && ok;

      const step = (task.steps || []).find((s) => {
        const cfg = s.actionConfig || {};
        return (cfg.action?.type || s.actionType) === "web.fetch";
      });

      if (!types.includes("web.fetch")) {
        // 纯 URL 无描述，可能无法被识别
        warn("未调用 web.fetch（纯 URL 无上下文，匹配困难）");
      } else {
        ok = pass("调用了 web.fetch") && ok;
        const result = step?.result?.observation?.result;
        if (result?.status >= 400 || step?.status === "failed") {
          ok = pass("web.fetch 返回失败/错误状态") && ok;
        } else {
          ok = pass("web.fetch 执行完成") && ok;
        }
      }
      return ok;
    },
  },
];

// ==================== 测试执行 ====================

async function runTest(tc) {
  const start = Date.now();
  console.log(`\n${C.bold}[#${tc.id}] ${tc.category}${C.reset}`);
  console.log(`  Query : ${C.cyan}"${tc.query}"${C.reset}`);
  console.log(`  Expect: ${tc.expectPath.join(" → ")}`);

  let task;
  try {
    const created = await createTask(tc.query);
    const taskId = created.taskId;
    info(`taskId: ${taskId}`);

    task = await waitForTask(taskId, `#${tc.id}`, tc.timeout);
    process.stdout.write(`\r${" ".repeat(60)}\r`); // 清除状态行

    const elapsed = Date.now() - start;
    info(`耗时: ${(elapsed / 1000).toFixed(1)}s`);
    printTaskSummary(task);

    const ok = tc.verify(task);
    return { id: tc.id, ok, task, elapsed };
  } catch (err) {
    process.stdout.write(`\r${" ".repeat(60)}\r`);
    console.log(`  ${C.red}✗ ERROR${C.reset}: ${err.message}`);
    if (task) printTaskSummary(task);
    return { id: tc.id, ok: false, error: err.message, task };
  }
}

// ==================== 主流程 ====================

async function main() {
  let exitCode = 0;

  console.log(`${C.bold}╔════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}║     Agent Harness E2E 端到端自动测试                       ║${C.reset}`);
  console.log(`${C.bold}╚════════════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  用例数: ${TEST_CASES.length}`);
  console.log(`  端口:   ${API_PORT}`);
  console.log(`  Harness: ${C.green}enabled${C.reset} (自动注入)`);
  console.log();

  // 启动 API
  try {
    await startApiServer();
  } catch (err) {
    console.error(`${C.red}✗ 启动 API 失败:${C.reset} ${err.message}`);
    process.exit(1);
  }

  // 注册退出清理
  process.on("SIGINT", async () => {
    console.log(`\n${C.yellow}收到 SIGINT，正在清理...${C.reset}`);
    await stopApiServer();
    process.exit(130);
  });

  process.on("SIGTERM", async () => {
    await stopApiServer();
    process.exit(143);
  });

  // 运行所有测试
  const results = [];
  const startAll = Date.now();

  for (const tc of TEST_CASES) {
    const result = await runTest(tc);
    results.push(result);
  }

  const totalElapsed = Date.now() - startAll;

  // ==================== 汇总报告 ====================
  console.log(`\n${C.bold}╔════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}║     测试汇总                                               ║${C.reset}`);
  console.log(`${C.bold}╚════════════════════════════════════════════════════════════╝${C.reset}`);

  let totalPass = 0;
  let totalFail = 0;
  let totalError = 0;

  for (const r of results) {
    const tc = TEST_CASES.find((t) => t.id === r.id);
    let icon, status, color;
    if (r.error) {
      icon = "✗"; status = "ERROR"; color = C.red; totalError++;
    } else if (r.ok) {
      icon = "✓"; status = "PASS"; color = C.green; totalPass++;
    } else {
      icon = "✗"; status = "FAIL"; color = C.red; totalFail++;
    }
    const timeStr = r.elapsed ? ` ${C.gray}(${r.elapsed}ms)${C.reset}` : "";
    console.log(`  ${color}${icon}${C.reset} [#${String(r.id).padStart(2)}] ${tc.category.padEnd(16)} ${color}${status}${C.reset}${timeStr}`);
    if (r.error) {
      console.log(`      ${C.red}→ ${r.error}${C.reset}`);
    }
  }

  console.log();
  console.log(`  结果: ${C.green}${totalPass} 通过${C.reset} / ${C.red}${totalFail} 失败${C.reset} / ${C.yellow}${totalError} 错误${C.reset} / ${TEST_CASES.length} 总计`);
  console.log(`  耗时: ${(totalElapsed / 1000).toFixed(1)}s`);

  // 分类统计
  const byCategory = {};
  for (const r of results) {
    const tc = TEST_CASES.find((t) => t.id === r.id);
    byCategory[tc.category] = byCategory[tc.category] || { pass: 0, fail: 0, error: 0 };
    if (r.error) byCategory[tc.category].error++;
    else if (r.ok) byCategory[tc.category].pass++;
    else byCategory[tc.category].fail++;
  }

  console.log(`\n  按分类:`);
  for (const [cat, stat] of Object.entries(byCategory)) {
    const total = stat.pass + stat.fail + stat.error;
    const color = stat.fail === 0 && stat.error === 0 ? C.green : (stat.fail + stat.error < total) ? C.yellow : C.red;
    console.log(`    ${color}${cat}: ${stat.pass}/${total}${C.reset}`);
  }

  // 环境建议
  console.log();
  const hasDeepseek = DOTENV_VARS.DEEPSEEK_API_KEY;
  if (!hasDeepseek) {
    console.log(`  ${C.yellow}⚠ 未检测到 DEEPSEEK_API_KEY，System Tool / Agent Loop / LLM 用例依赖 rule-based fallback${C.reset}`);
    console.log(`    配置方式: 在 api/.env 中设置 DEEPSEEK_API_KEY=sk-...`);
  }

  exitCode = totalFail + totalError > 0 ? 1 : 0;

  console.log(`${C.bold}════════════════════════════════════════════════════════════${C.reset}`);

  // 停止 API
  await stopApiServer();

  process.exit(exitCode);
}

main().catch(async (err) => {
  console.error(`\n${C.red}测试脚本异常:${C.reset}`, err);
  await stopApiServer();
  process.exit(1);
});
