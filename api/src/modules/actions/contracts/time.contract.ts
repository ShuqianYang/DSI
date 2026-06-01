import { z } from "zod";
import type { CapabilityContract } from "./types.js";

// ============================================================
// time.now — 获取当前时间
// ============================================================

const inputSchema = z.object({
  timezone: z.string().optional().default("Asia/Shanghai").describe("时区，如 'Asia/Shanghai', 'UTC', 'America/New_York'"),
  format: z.enum(["iso", "local", "date", "time"]).optional().default("local").describe("输出格式"),
});

const outputSchema = z.object({
  iso: z.string(),
  local: z.string(),
  date: z.string(),
  time: z.string(),
  timezone: z.string(),
  weekday: z.string(),
  timestamp: z.number(),
});

export const timeContract: CapabilityContract = {
  name: "time.now",
  displayName: "当前时间查询",
  description: "获取当前日期和时间，支持指定时区和多种输出格式。",

  inputSchema,
  outputSchema,

  llm: {
    whenToUse: "用户询问当前时间、日期、星期几、现在几点、当前时刻、什么时间，或需要时间参考信息时使用。",
    avoidWhen: "用户问题不涉及时间信息时。",
    examples: [
      {
        user: "现在几点了",
        toolInput: { timezone: "Asia/Shanghai", format: "local" },
      },
      {
        user: "纽约现在什么时间",
        toolInput: { timezone: "America/New_York", format: "local" },
      },
    ],
  },

  execution: {
    timeoutMs: 1000,
    retry: { maxAttempts: 1 },
    idempotent: true,
    sideEffect: "none",
    costLevel: "low",
  },
};
