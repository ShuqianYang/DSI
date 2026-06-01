import type { z } from "zod";
import type { CapabilityContract, HarnessRuntimeState } from "./types.js";

export interface ValidationResult {
  ok: boolean;
  reason?: string;
  issues?: Array<{ path: string; message: string }>;
  input?: unknown;
}

/**
 * 基于 CapabilityContract 校验 tool call。
 *
 * 校验顺序：
 * 1. 工具是否存在于 registry
 * 2. inputSchema.safeParse
 * 3. dependencies（基本检查，Phase 0.5 可先放宽）
 * 4. gates（基本检查，Phase 0.5 可先放宽）
 */
export function validateToolCall(
  toolName: string,
  rawInput: unknown,
  _context: HarnessRuntimeState,
  registry: Map<string, CapabilityContract>
): ValidationResult {
  // 1. 工具存在性
  const contract = registry.get(toolName);
  if (!contract) {
    return {
      ok: false,
      reason: `unknown_tool: ${toolName}`,
    };
  }

  // 2. 输入参数校验
  const parsed = contract.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_params",
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    };
  }

  // 3. Dependencies（Phase 0.5 简化：只记录，不强阻断）
  if (contract.dependencies) {
    for (const dep of contract.dependencies) {
      if (dep.type === "requires_artifact" && dep.required) {
        // TODO: 检查 context.observations 中是否有该 artifact
        // Phase 0.5 先放行，等 context 传递验证后再收紧
      }
    }
  }

  // 4. Gates（Phase 0.5 简化：只记录 warning，不强阻断）
  if (contract.gates) {
    for (const gate of contract.gates) {
      if (gate.type === "quality_warning") {
        // TODO: 记录 warning，不影响执行
      }
    }
  }

  return {
    ok: true,
    input: parsed.data,
  };
}

/**
 * 校验 tool 输出是否符合 outputSchema。
 * 先执行 normalizeOutput（如果存在），再 safeParse。
 */
export function validateToolOutput(
  contract: CapabilityContract,
  rawOutput: unknown
): ValidationResult {
  const normalized = contract.normalizeOutput
    ? contract.normalizeOutput(rawOutput)
    : rawOutput;

  const parsed = contract.outputSchema.safeParse(normalized);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_output",
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    };
  }

  return {
    ok: true,
    input: parsed.data,
  };
}
