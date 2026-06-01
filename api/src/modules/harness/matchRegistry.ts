import type { HarnessRuntimeState } from "../actions/contracts/types.js";

// ============================================================
// Routable 基础类型 — skill 和 template 的公共属性
// ============================================================

export interface BaseRoutable {
  id: string;
  kind: "skill" | "template";
  displayName: string;
  keywords: string[];
  whenToUse: string[];
  avoidWhen?: string[];
  examples?: string[];
  priority?: number;
}

// ============================================================
// Skill 定义 — 单步确定性能力
// ============================================================

export interface SkillDefinition extends BaseRoutable {
  kind: "skill";
  tool: string;
  buildParams: (
    query: string,
    context: HarnessRuntimeState
  ) => Record<string, unknown>;
}

// ============================================================
// Template 定义 — 多步确定性流程
// ============================================================

export interface TemplateStep {
  stepKey: string;
  tool: string;
  buildParams: (state: HarnessRuntimeState) => Record<string, unknown>;
  saveAs?: string;
}

export interface TemplateDefinition extends BaseRoutable {
  kind: "template";
  steps: TemplateStep[];
}

export type RoutableDefinition = SkillDefinition | TemplateDefinition;

// ============================================================
// Runnable — 统一执行层（skill 和 template 统一表达）
// ============================================================

export interface RunnableStep {
  stepKey: string;
  tool: string;
  buildParams: (state: HarnessRuntimeState) => Record<string, unknown>;
  saveAs?: string;
}

export interface RunnableDefinition {
  id: string;
  kind: "skill" | "template";
  source: "skill" | "template";
  steps: RunnableStep[];
}

// ============================================================
// 转换：Skill/Template → Runnable
// ============================================================

export function convertSkillToRunnable(skill: SkillDefinition): RunnableDefinition {
  return {
    id: skill.id,
    kind: "skill",
    source: "skill",
    steps: [
      {
        stepKey: `${skill.id}.execute`,
        tool: skill.tool,
        // 适配签名：RunnableStep 接收 state，skill.buildParams 接收 (query, context)
        buildParams: (state: HarnessRuntimeState) =>
          skill.buildParams(state.userQuery, state),
      },
    ],
  };
}

export function convertTemplateToRunnable(template: TemplateDefinition): RunnableDefinition {
  return {
    id: template.id,
    kind: "template",
    source: "template",
    steps: template.steps.map((s) => ({
      stepKey: s.stepKey,
      tool: s.tool,
      buildParams: s.buildParams,
      saveAs: s.saveAs,
    })),
  };
}

export function convertToRunnable(def: RoutableDefinition): RunnableDefinition {
  if (def.kind === "skill") {
    return convertSkillToRunnable(def);
  }
  return convertTemplateToRunnable(def);
}

// ============================================================
// 注册表
// ============================================================

const matchRegistry = new Map<string, RoutableDefinition>();

export function registerRoutable(def: RoutableDefinition): void {
  matchRegistry.set(def.id, def);
}

export function getRoutable(id: string): RoutableDefinition | undefined {
  return matchRegistry.get(id);
}

export function listRunnables(): RunnableDefinition[] {
  return Array.from(matchRegistry.values()).map(convertToRunnable);
}

export function listRoutables(): RoutableDefinition[] {
  return Array.from(matchRegistry.values());
}

export function getMatchRegistry(): Map<string, RoutableDefinition> {
  return matchRegistry;
}
