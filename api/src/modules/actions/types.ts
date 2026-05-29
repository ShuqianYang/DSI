import type { Action, ActionResult } from "@datasourceintelligence/shared";

export interface Capability {
  name: string;
  description: string;
  execute(action: Action, context?: Record<string, unknown>): Promise<ActionResult>;
}

export interface ActionsService {
  execute(action: Action, context?: Record<string, unknown>): Promise<ActionResult>;
  register(type: string, capability: Capability): void;
}
