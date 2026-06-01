import type { CapabilityContract } from "./types.js";
import { zodToJsonSchema } from "./jsonSchema.js";

// ============================================================
// Tool Catalog — 从 CapabilityContract registry 生成 Agent 可用 catalog
// ============================================================

export interface ToolCatalogEntry {
  /** canonical 工具名 */
  name: string;
  /** 人类可读名称 */
  displayName: string;
  /** 工具功能描述 */
  description: string;
  /** 何时使用该工具（给 LLM 的提示） */
  whenToUse: string;
  /** 何时避免使用该工具 */
  avoidWhen?: string;
  /** 参数 JSON Schema */
  inputSchema: Record<string, unknown>;
  /** 使用示例 */
  examples?: Array<{
    user: string;
    toolInput: Record<string, unknown>;
  }>;
  /** 执行元数据 */
  execution: {
    costLevel: "low" | "medium" | "high";
    sideEffect: "none" | "read" | "write" | "external_request";
    idempotent: boolean;
    timeoutMs: number;
  };
  /** 暴露给 Agent 的输出字段 */
  exposedFields?: string[];
}

export interface ToolCatalog {
  /** catalog 格式版本 */
  version: string;
  /** 工具条目列表 */
  tools: ToolCatalogEntry[];
  /** 当前格式标识 */
  format: "anthropic-tools-v1" | "openai-functions-v1";
}

// ============================================================
// 构建 Catalog
// ============================================================

/**
 * 从 CapabilityContract registry 生成完整的 tool catalog。
 */
export function buildToolCatalog(
  registry: Map<string, CapabilityContract>
): ToolCatalog {
  const tools: ToolCatalogEntry[] = [];

  for (const contract of registry.values()) {
    tools.push(convertContractToCatalogEntry(contract));
  }

  return {
    version: "1.0.0",
    tools,
    format: "anthropic-tools-v1",
  };
}

/**
 * 为 Agent 决策生成精简 catalog（只包含必要字段，减少 prompt 长度）。
 */
export function buildCompactCatalog(
  registry: Map<string, CapabilityContract>
): ToolCatalog {
  const full = buildToolCatalog(registry);

  return {
    version: full.version,
    format: full.format,
    tools: full.tools.map((t) => ({
      name: t.name,
      displayName: t.displayName,
      description: t.description,
      whenToUse: t.whenToUse,
      avoidWhen: t.avoidWhen,
      inputSchema: t.inputSchema,
      examples: t.examples,
      execution: {
        costLevel: t.execution.costLevel,
        sideEffect: t.execution.sideEffect,
        idempotent: t.execution.idempotent,
        timeoutMs: t.execution.timeoutMs,
      },
      exposedFields: t.exposedFields,
    })),
  };
}

/**
 * 根据工具名列表过滤 catalog，用于 retrieveCandidateTools 后只暴露 top-k。
 */
export function filterCatalogByNames(
  catalog: ToolCatalog,
  names: string[]
): ToolCatalog {
  const nameSet = new Set(names);
  return {
    ...catalog,
    tools: catalog.tools.filter((t) => nameSet.has(t.name)),
  };
}

/**
 * 从单个 CapabilityContract 生成 catalog entry。
 */
function convertContractToCatalogEntry(
  contract: CapabilityContract
): ToolCatalogEntry {
  return {
    name: contract.name,
    displayName: contract.displayName,
    description: contract.description,
    whenToUse: contract.llm.whenToUse,
    avoidWhen: contract.llm.avoidWhen,
    inputSchema: zodToJsonSchema(contract.inputSchema),
    examples: contract.llm.examples,
    execution: {
      costLevel: contract.execution.costLevel,
      sideEffect: contract.execution.sideEffect,
      idempotent: contract.execution.idempotent,
      timeoutMs: contract.execution.timeoutMs,
    },
    exposedFields: contract.llm.exposedFields,
  };
}

// ============================================================
// Anthropic / OpenAI 格式转换
// ============================================================

/**
 * 将 catalog entry 转换为 Anthropic tool_use 格式。
 */
export function toAnthropicTool(entry: ToolCatalogEntry): Record<string, unknown> {
  return {
    name: entry.name,
    description: buildToolDescription(entry),
    input_schema: entry.inputSchema,
  };
}

/**
 * 将 catalog entry 转换为 OpenAI function calling 格式。
 */
export function toOpenAIFunction(entry: ToolCatalogEntry): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: entry.name,
      description: buildToolDescription(entry),
      parameters: entry.inputSchema,
    },
  };
}

/**
 * 构建工具描述（合并 description + whenToUse + avoidWhen）。
 */
function buildToolDescription(entry: ToolCatalogEntry): string {
  const parts: string[] = [entry.description];

  if (entry.whenToUse) {
    parts.push(`\n何时使用：${entry.whenToUse}`);
  }

  if (entry.avoidWhen) {
    parts.push(`\n何时避免：${entry.avoidWhen}`);
  }

  if (entry.execution.sideEffect === "write") {
    parts.push("\n⚠️ 该工具会产生写操作，请谨慎使用。");
  }

  return parts.join("");
}

// ============================================================
// 为 Agent Loop 生成系统提示
// ============================================================

/**
 * 生成 Agent system prompt 中的 tool catalog 部分。
 */
export function buildAgentToolPrompt(
  catalog: ToolCatalog
): string {
  const lines: string[] = [
    "# 可用工具列表",
    "",
    `共 ${catalog.tools.length} 个工具：`,
    "",
  ];

  for (const tool of catalog.tools) {
    lines.push(`## ${tool.name}`);
    lines.push(`- 描述：${tool.description}`);
    lines.push(`- 何时使用：${tool.whenToUse}`);
    if (tool.avoidWhen) {
      lines.push(`- 何时避免：${tool.avoidWhen}`);
    }
    lines.push(`- 参数结构：\`\`\`json\n${JSON.stringify(tool.inputSchema, null, 2)}\n\`\`\``);
    if (tool.examples && tool.examples.length > 0) {
      lines.push(`- 示例：`);
      for (const ex of tool.examples) {
        lines.push(`  - 用户："${ex.user}"`);
        lines.push(`    参数：${JSON.stringify(ex.toolInput)}`);
      }
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("请根据用户请求和已有观察结果，选择一个工具调用，或直接给出最终答案。");

  return lines.join("\n");
}
