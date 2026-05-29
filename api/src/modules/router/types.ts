import type { Plan, Action } from "@datasourceintelligence/shared";

export interface RouterService {
  decideActions(plan: Plan, originalQuery?: string, context?: Record<string, unknown>): Promise<Action[]>;
}
