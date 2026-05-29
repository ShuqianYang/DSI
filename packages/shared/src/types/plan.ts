import { z } from "zod";

// Simple-mode step (backward compatible, used by 轻量 planner)
export const PlanStep = z.object({
  id: z.string(),
  description: z.string(),
  purpose: z.string(),
  expectedOutput: z.string(),
});
export type PlanStep = z.infer<typeof PlanStep>;

// Scenario-mode subtask (rich metadata for GIS联动 + capability routing)
export const PlanSubtask = z.object({
  id: z.string(),
  name: z.string(),
  capability: z.string(),
  description: z.string(),
  executionDetail: z.string(),
  expectedResult: z.string(),
  gisInteraction: z.string(),
  objectType: z.string(),
  dependsOn: z.array(z.string()),
});
export type PlanSubtask = z.infer<typeof PlanSubtask>;

// Scenario metadata
export const ScenarioInfo = z.object({
  name: z.string(),
  platform: z.string(),
  involvedSystems: z.array(z.string()),
  userRoles: z.array(z.string()),
  coreFlow: z.string(),
  coreLogic: z.string(),
});
export type ScenarioInfo = z.infer<typeof ScenarioInfo>;

// Thinking chain (left-panel real-time display)
export const ThinkingChain = z.object({
  intentRecognition: z.string(),
  entityExtraction: z.string(),
  taskPlanning: z.string(),
  subtaskCount: z.number(),
  executionScheduling: z.string(),
});
export type ThinkingChain = z.infer<typeof ThinkingChain>;

// Main task header
export const MainTask = z.object({
  name: z.string(),
  id: z.string(),
  status: z.string(),
  progress: z.number(),
});
export type MainTask = z.infer<typeof MainTask>;

// Final event skeleton (for event replay classification)
export const FinalEvent = z.object({
  type: z.string(),
  riskLevelHint: z.string(),
  gisReplayObjectTypes: z.array(z.string()),
});
export type FinalEvent = z.infer<typeof FinalEvent>;

// Unified Plan: simple mode uses goal + steps + reasoning;
// scenario mode additionally populates scenario + thinkingChain + subtasks + mainTask + finalEvent.
export const Plan = z.object({
  goal: z.string(),
  steps: z.array(PlanStep),
  reasoning: z.string(),
  scenario: ScenarioInfo.optional(),
  thinkingChain: ThinkingChain.optional(),
  subtasks: z.array(PlanSubtask).optional(),
  mainTask: MainTask.optional(),
  finalEvent: FinalEvent.optional(),
});
export type Plan = z.infer<typeof Plan>;
