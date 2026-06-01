import type { z } from "zod";

// ============================================================
// CapabilityContract — 工具统一契约
// ============================================================

export interface DependencyRule {
  type: "requires_artifact" | "prefers_tool_output";
  artifact?: string;
  tool?: string;
  fields?: string[];
  required?: boolean;
}

export interface GateRule {
  type: "required_artifact" | "quality_warning";
  artifactKey: string;
  failReason?: string;
  warning?: string;
}

export interface ToolExample {
  user: string;
  toolInput: Record<string, unknown>;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs?: number;
}

export interface CapabilityContract {
  name: string;
  displayName: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  normalizeOutput?: (raw: unknown) => unknown;
  dependencies?: DependencyRule[];
  gates?: GateRule[];
  llm: {
    whenToUse: string;
    avoidWhen?: string;
    examples?: ToolExample[];
    exposedFields?: string[];
  };
  execution: {
    timeoutMs: number;
    retry: RetryPolicy;
    idempotent: boolean;
    sideEffect: "none" | "read" | "write" | "external_request";
    costLevel: "low" | "medium" | "high";
  };
}

// ============================================================
// Agent 决策类型
// ============================================================

export interface RequirementDraft {
  title: string;
  missingCapability: string;
  userNeed: string;
}

export type AgentDecision =
  | {
      decision: "tool_call";
      reason: string;
      tool: string;
      params: Record<string, unknown>;
    }
  | {
      decision: "final_answer";
      reason: string;
      finalText: string;
    }
  | {
      decision: "create_requirement";
      reason: string;
      requirementDraft: RequirementDraft;
    }
  | {
      decision: "legacy_fallback";
      reason: string;
    };

// ============================================================
// Observation — 单步工具执行结果
// ============================================================

export interface Observation {
  stepId: string;
  sequence: number;
  toolName: string;
  params: Record<string, unknown>;
  result: unknown;
  success: boolean;
  error?: string;
  timestamp: number;
}

// ============================================================
// Harness Runtime State
// ============================================================

export interface UsedToolSignature {
  toolName: string;
  paramHash: string;
}

export interface HarnessRuntimeState {
  taskId: string;
  runId: string;
  userQuery: string;
  observations: Observation[];
  missingData: string[];
  usedTools: UsedToolSignature[];
  stepCount: number;
  maxSteps: number;
  status: "running" | "completed" | "failed";
  currentPhase: string;
  blockedReasons: string[];
  /** 步骤间传递的 artifacts（template 多步场景） */
  artifacts: Record<string, unknown>;
}

// ============================================================
// TaskStep Snapshot 类型（写入 taskSteps.actionConfig）
// ============================================================

export interface TaskStepSnapshot {
  source: "skill" | "template" | "agent" | "system" | "recovery";
  kind: "tool_call" | "decision" | "checkpoint" | "finalizer";
  runId: string;
  sequence: number;
  stepKey: string;
  attempt: number;

  // Phase 1：统一为 runnable 概念
  // skill 是单步 runnable，template 是多步 runnable
  runnableId?: string;
  runnableKind?: "skill" | "template";

  // 兼容旧格式（Phase 0 的 snapshot 可能只有 templateId）
  templateId?: string;

  agentDecision?: AgentDecision;
  action: {
    type: string;
    name: string;
    params: Record<string, unknown>;
    dependsOn?: string[];
  };
}
