import { v4 as uuidv4 } from "uuid";
import type { Action, ActionResult } from "@datasourceintelligence/shared";
import type { Capability } from "../types.js";

export const requirementCapability: Capability = {
  name: "requirement",
  description: "记录定制需求：当用户需求超出当前工具能力时记录需求单",

  execute: async (action: Action, _context?: Record<string, unknown>): Promise<ActionResult> => {
    const params = action.params as {
      description?: string;
      reason?: string;
      suggestedTool?: string;
    };

    const mockData = {
      id: uuidv4(),
      description: params.description || "未指定需求描述",
      status: "pending",
      requirementId: `REQ-${Date.now().toString(36).toUpperCase()}`,
      timestamp: new Date().toISOString(),
      suggestedTool: params.suggestedTool || "unknown",
    };

    return {
      success: true,
      data: mockData,
      metadata: {
        capability: "requirement",
        executionTime: 200,
        mock: true,
      },
    };
  },
};
