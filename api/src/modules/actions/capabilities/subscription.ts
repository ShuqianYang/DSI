import { v4 as uuidv4 } from "uuid";
import type { Action, ActionResult } from "@datasourceintelligence/shared";
import type { Capability } from "../types.js";

export const subscriptionCapability: Capability = {
  name: "subscription",
  description: "创建订阅任务：根据用户需求创建定时订阅",

  execute: async (action: Action, _context?: Record<string, unknown>): Promise<ActionResult> => {
    const params = action.params as {
      query?: string;
      subscriptionType?: string;
      schedule?: string;
      toolType?: string;
      toolParams?: Record<string, unknown>;
    };

    const subType = params.subscriptionType || "daily";
    const schedule = params.schedule || "0 9 * * *";

    const mockData = {
      id: uuidv4(),
      name: action.description || params.query || "定时订阅任务",
      type: subType,
      schedule,
      nextExecuteTime: new Date(Date.now() + 86400000).toISOString(),
      status: "running",
      toolType: params.toolType || "daily_report",
      toolParams: params.toolParams || {},
    };

    return {
      success: true,
      data: mockData,
      metadata: {
        capability: "subscription",
        executionTime: 300,
        mock: true,
      },
    };
  },
};
