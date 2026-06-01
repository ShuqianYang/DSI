import type { Action } from "@datasourceintelligence/shared";
import { getCapability } from "../../actions/registry.js";
import { actionsService } from "../../actions/service.js";

// ========== Canonical name → registry key 映射 ==========
const CANONICAL_TO_REGISTRY: Record<string, string> = {
  "weather-fetch": "weather-fetch",
  "weather.fetch": "weather-fetch",
  weather: "weather-fetch",
  news: "news",
  "news.search": "news",
};

/** Phase 0 允许被 Agent 调用的工具白名单（canonical name） */
const ALLOWED_TOOLS = new Set([
  "weather-fetch",
  "weather.fetch",
  "weather",
  "news",
  "news.search",
]);

export interface ToolCallInput {
  tool: string;
  params: Record<string, unknown>;
}

export interface ToolCallOutput {
  ok: boolean;
  tool: string;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    detail?: unknown;
  };
}

/**
 * Phase 0 Tool Gateway
 *
 * - 统一入口：输入 { tool, params } → 输出 { ok, result/error }
 * - 白名单校验：只允许 weather/news 相关工具
 * - 映射 canonical name → registry key
 * - 复用现有 actionsService.execute（最小可复用执行入口）
 */
export async function callTool(input: ToolCallInput): Promise<ToolCallOutput> {
  const { tool: canonicalName, params } = input;
  const normalized = canonicalName.toLowerCase().trim();

  // 1. 白名单校验
  if (!ALLOWED_TOOLS.has(normalized)) {
    return {
      ok: false,
      tool: canonicalName,
      error: {
        code: "tool_not_allowed",
        message: `工具 "${canonicalName}" 不在 Phase 0 白名单中。当前可用：weather-fetch, news`,
      },
    };
  }

  // 2. 映射 canonical name → registry key
  const registryKey = CANONICAL_TO_REGISTRY[normalized];
  if (!registryKey) {
    return {
      ok: false,
      tool: canonicalName,
      error: {
        code: "unknown_tool",
        message: `无法将工具名 "${canonicalName}" 映射到已注册的 capability`,
      },
    };
  }

  // 3. 查找 registry 中的 capability
  const capability = getCapability(registryKey);
  if (!capability) {
    return {
      ok: false,
      tool: canonicalName,
      error: {
        code: "unknown_tool",
        message: `Registry 中未找到 capability: ${registryKey}`,
      },
    };
  }

  // 4. 构造 Action 并调用 actionsService.execute
  const action: Action = {
    id: `phase0-${Date.now()}`,
    type: registryKey as Action["type"],
    name: capability.name,
    description: capability.description,
    params,
  };

  try {
    const result = await actionsService.execute(action, {});
    if (result.success) {
      return {
        ok: true,
        tool: canonicalName,
        result: result.data,
      };
    }
    return {
      ok: false,
      tool: canonicalName,
      error: {
        code: "execution_failed",
        message: result.error || "工具执行返回失败",
        detail: result.metadata,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      tool: canonicalName,
      error: {
        code: "execution_error",
        message,
        detail: err,
      },
    };
  }
}
