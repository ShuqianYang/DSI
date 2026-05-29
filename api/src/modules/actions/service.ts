import type { Action, ActionResult } from "@datasourceintelligence/shared";
import { getCapability, listCapabilities } from "./registry.js";
import type { ActionsService } from "./types.js";

export const actionsService: ActionsService = {
  execute: async (action: Action, context?: Record<string, unknown>): Promise<ActionResult> => {
    const capability = getCapability(action.type);

    if (!capability) {
      return {
        success: false,
        error: `Unknown action type: ${action.type}. Available: ${listAvailableTypes().join(", ")}`,
      };
    }

    console.log(`[Actions] Executing ${action.type} - ${capability.name}`);
    const result = await capability.execute(action, context);
    console.log(`[Actions] ${action.type} completed: ${result.success ? "success" : "failed"}`);
    return result;
  },

  register: (_type: string, _capability: unknown) => {
    // 通过 registry.ts 注册
  },
};

function listAvailableTypes(): string[] {
  return listCapabilities().map((c) => c.type);
}
