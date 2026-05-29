import type { Plan } from "@datasourceintelligence/shared";

export interface IntentClassification {
  intent: "earthquake" | "flood" | "fire" | "oil_spill" | "dynamic";
  params: Record<string, unknown>;
  missingParams: string[];
  confidence: number;
  hardcoded?: boolean;
}

export interface PlannerService {
  generatePlan(query: string, context?: Record<string, unknown>): Promise<Plan>;
  classifyIntent(query: string): Promise<IntentClassification>;
}
