import { v4 as uuidv4 } from "uuid";
import type { Action, ActionResult } from "@datasourceintelligence/shared";
import { actionsService } from "../actions/service.js";
import type {
  CapabilityContract,
  HarnessRuntimeState,
  Observation,
} from "../actions/contracts/types.js";
import { validateToolOutput } from "../actions/contracts/toolValidator.js";
import { generateTemplateSummary } from "./finalizers/templateSummaryFinalizer.js";

// Canonical name → legacy registry key 映射
// TODO: 后续统一为 contract.legacyType
const CANONICAL_TO_LEGACY: Record<string, string> = {
  "weather.fetch": "weather-fetch",
  "news.search": "news",
  "oil_drift.traceback": "oil-drift",
  "ais.fetch": "ais-fetch",
  "ais.match_suspects": "ais-match-suspects",
  "ais.rank_suspects": "ais-suspect-ranking",
  "satellite.query": "satellite",
  "fire.detect": "fire-detector",
  "gis.mark_region": "region-mark",
  "requirement.evaluate": "requirement",
  "maritime.analysis": "maritime",
  "intelligence.analysis": "intelligence",
  "intelligent_qa.query": "intelligent_qa",
  "daily_report.generate": "daily_report",
  "subscription.create": "subscription",
  "border_push.push": "border-push",
  "earthquake.evaluate": "earthquake-evaluation",
  "flood.evaluate": "flood-evaluation",
};

export interface ToolExecutionResult {
  success: boolean;
  observation: Observation;
}

/**
 * 统一执行工具：
 * 1. canonical name → legacy type 转换
 * 2. 构造 Action 对象
 * 3. 调用 actionsService.execute
 * 4. normalizeOutput + 包装成 Observation
 */
export async function executeTool(
  toolName: string,
  params: Record<string, unknown>,
  context: HarnessRuntimeState,
  registry: Map<string, CapabilityContract>
): Promise<ToolExecutionResult> {
  const start = Date.now();
  const contract = registry.get(toolName);
  if (!contract) {
    return {
      success: false,
      observation: buildObservation(
        toolName,
        params,
        null,
        false,
        `unknown_tool: ${toolName}`,
        start
      ),
    };
  }

  // System Tool 分支：不调用外部 API，直接本地执行
  if (toolName.startsWith("finalizer.") || toolName === "calc.evaluate" || toolName === "time.now" || toolName === "web.fetch") {
    return executeSystemTool(toolName, params, contract, start);
  }

  const legacyType = CANONICAL_TO_LEGACY[toolName] ?? toolName.replace(/\./g, "-");

  const action: Action = {
    id: `agent-step-${Date.now()}-${uuidv4().slice(0, 4)}`,
    type: legacyType as Action["type"],
    name: contract.displayName,
    description: contract.description,
    params,
  };

  let result: ActionResult;

  try {
    result = await actionsService.execute(action, buildExecutionContext(context));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      observation: buildObservation(
        toolName,
        params,
        null,
        false,
        error,
        start
      ),
    };
  }

  // normalizeOutput（如果 contract 声明了）
  const normalizedData =
    result.success && contract.normalizeOutput
      ? contract.normalizeOutput(result.data)
      : result.data;

  // outputSchema 校验（执行成功后）
  if (result.success) {
    const outputValidation = validateToolOutput(contract, normalizedData);
    if (!outputValidation.ok) {
      const errorMsg = `invalid_tool_output: ${outputValidation.reason}`;
      console.error(`[toolGateway] ${toolName} output validation failed:`, outputValidation.issues);
      return {
        success: false,
        observation: buildObservation(
          toolName,
          params,
          normalizedData,
          false,
          errorMsg,
          start
        ),
      };
    }
  }

  return {
    success: result.success,
    observation: buildObservation(
      toolName,
      params,
      normalizedData,
      result.success,
      result.error,
      start
    ),
  };
}

/**
 * 执行 System Tool（不调用外部 API，本地执行）。
 */
async function executeSystemTool(
  toolName: string,
  params: Record<string, unknown>,
  contract: CapabilityContract,
  startTime: number
): Promise<ToolExecutionResult> {
  try {
    let result: unknown;

    switch (toolName) {
      case "finalizer.template_summary": {
        result = generateTemplateSummary({
          sourceTool: params.sourceTool as string,
          query: params.query as string,
          items: params.items as Array<Record<string, unknown>> | undefined,
          missingData: params.missingData as string[] | undefined,
        });
        break;
      }

      case "web.fetch": {
        result = await executeWebFetch(params.url as string, params.maxLength as number | undefined);
        break;
      }

      case "calc.evaluate": {
        result = executeCalc(params.expression as string);
        break;
      }

      case "time.now": {
        result = executeTimeNow(params.timezone as string | undefined, params.format as string | undefined);
        break;
      }

      default: {
        return {
          success: false,
          observation: buildObservation(
            toolName,
            params,
            null,
            false,
            `unknown_system_tool: ${toolName}`,
            startTime
          ),
        };
      }
    }

    // outputSchema 校验
    const outputValidation = validateToolOutput(contract, result);
    if (!outputValidation.ok) {
      const errorMsg = `invalid_tool_output: ${outputValidation.reason}`;
      return {
        success: false,
        observation: buildObservation(
          toolName,
          params,
          result,
          false,
          errorMsg,
          startTime
        ),
      };
    }

    return {
      success: true,
      observation: buildObservation(toolName, params, result, true, undefined, startTime),
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      observation: buildObservation(toolName, params, null, false, error, startTime),
    };
  }
}

// ============================================================
// System Tool: web.fetch
// ============================================================

async function executeWebFetch(
  url: string,
  maxLength?: number
): Promise<Record<string, unknown>> {
  const limit = maxLength ?? 3000;

  if (!url || !/^https?:\/\//i.test(url)) {
    return {
      url: url || "",
      status: 400,
      content: "无效的 URL，必须以 http:// 或 https:// 开头",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DatasourceIntelligence/1.0)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const contentType = resp.headers.get("content-type") || "";

    if (!resp.ok) {
      return {
        url,
        status: resp.status,
        content: `HTTP 错误: ${resp.status} ${resp.statusText}`,
        contentType,
      };
    }

    const rawText = await resp.text();

    // 简单 HTML → 文本提取
    let text = rawText
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();

    // 截断
    if (text.length > limit) {
      text = text.slice(0, limit) + "\n...（内容已截断）";
    }

    // 提取 title
    const titleMatch = rawText.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : undefined;

    return {
      url,
      title,
      status: resp.status,
      content: text,
      contentType,
    };
  } catch (err) {
    clearTimeout(timeout);
    const error = err instanceof Error ? err.message : String(err);
    return {
      url,
      status: 0,
      content: `抓取失败: ${error}`,
    };
  }
}

// ============================================================
// System Tool: calc.evaluate
// ============================================================

function executeCalc(expression: string): Record<string, unknown> {
  if (!expression || typeof expression !== "string") {
    return {
      expression: String(expression),
      result: 0,
      formatted: "0",
    };
  }

  // 白名单：只允许数字、运算符、括号、空格、小数点、逗号
  const sanitized = expression
    .replace(/,/g, "") // 去掉千分位逗号
    .replace(/[^0-9+\-*/().\s^%]/g, "");

  if (!sanitized.trim()) {
    return {
      expression,
      result: 0,
      formatted: "0",
    };
  }

  // 替换常用函数和常量
  let expr = sanitized
    .replace(/\^/g, "**")
    .replace(/\bpi\b/gi, String(Math.PI))
    .replace(/\be\b/gi, String(Math.E));

  // 简单的 sqrt/sin/cos/tan/log/abs 支持
  expr = expr
    .replace(/\bsqrt\s*\(/gi, "Math.sqrt(")
    .replace(/\bsin\s*\(/gi, "Math.sin(")
    .replace(/\bcos\s*\(/gi, "Math.cos(")
    .replace(/\btan\s*\(/gi, "Math.tan(")
    .replace(/\blog\s*\(/gi, "Math.log(")
    .replace(/\babs\s*\(/gi, "Math.abs(")
    .replace(/\bfloor\s*\(/gi, "Math.floor(")
    .replace(/\bceil\s*\(/gi, "Math.ceil(")
    .replace(/\bround\s*\(/gi, "Math.round(")
    .replace(/\bmax\s*\(/gi, "Math.max(")
    .replace(/\bmin\s*\(/gi, "Math.min(")
    .replace(/\bexp\s*\(/gi, "Math.exp(")
    .replace(/\bpow\s*\(/gi, "Math.pow(");

  try {
    // 使用 Function 构造器安全求值（只允许数学运算）
    const fn = new Function(`return (${expr})`);
    const result = fn();

    if (typeof result === "number" && !Number.isFinite(result)) {
      return {
        expression,
        result: 0,
        formatted: "计算结果无效（Infinity 或 NaN）",
      };
    }

    return {
      expression,
      result: Number(result),
      formatted: String(result),
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      expression,
      result: 0,
      formatted: `计算错误: ${error}`,
    };
  }
}

// ============================================================
// System Tool: time.now
// ============================================================

function executeTimeNow(
  timezone?: string,
  format?: string
): Record<string, unknown> {
  const tz = timezone || "Asia/Shanghai";
  const now = new Date();

  const iso = now.toISOString();
  const local = now.toLocaleString("zh-CN", { timeZone: tz });
  const date = now.toLocaleDateString("zh-CN", { timeZone: tz });
  const time = now.toLocaleTimeString("zh-CN", { timeZone: tz });

  const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  const weekday = weekdays[now.getDay()];

  return {
    iso,
    local,
    date,
    time,
    timezone: tz,
    weekday,
    timestamp: now.getTime(),
  };
}

function buildObservation(
  toolName: string,
  params: Record<string, unknown>,
  result: unknown,
  success: boolean,
  error?: string,
  startTime?: number
): Observation {
  return {
    stepId: `obs_${Date.now()}`,
    sequence: 0, // 由 caller（runOpenAgentLoop）回填
    toolName,
    params,
    result,
    success,
    error,
    timestamp: startTime ?? Date.now(),
  };
}

/**
 * 将 HarnessRuntimeState 转换为 Action execute 需要的 context。
 * 提取 observations 中的结果作为上下文。
 */
function buildExecutionContext(
  state: HarnessRuntimeState
): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};

  for (const obs of state.observations) {
    if (obs.success && obs.result) {
      ctx[obs.toolName] = obs.result;
    }
  }

  return ctx;
}
