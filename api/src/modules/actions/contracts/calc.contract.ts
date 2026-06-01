import { z } from "zod";
import type { CapabilityContract } from "./types.js";

// ============================================================
// calc.evaluate — 数学表达式计算
// ============================================================

const inputSchema = z.object({
  expression: z.string().describe("数学表达式，如 '2 + 2 * 3' 或 'sqrt(16)'"),
});

const outputSchema = z.object({
  expression: z.string(),
  result: z.number(),
  formatted: z.string(),
});

export const calcContract: CapabilityContract = {
  name: "calc.evaluate",
  displayName: "数学计算器",
  description: "计算数学表达式的值。支持加减乘除、幂运算、平方根、三角函数等。",

  inputSchema,
  outputSchema,

  llm: {
    whenToUse: "用户需要计算数值、求解数学表达式、做单位换算或数据估算、等于多少、换算成、转换成、速度、距离、面积、重量单位转换时使用。",
    avoidWhen: "用户问题不涉及数值计算时。",
    examples: [
      {
        user: "3.5 的平方是多少",
        toolInput: { expression: "3.5 ** 2" },
      },
      {
        user: "100 公里每小时等于多少米每秒",
        toolInput: { expression: "100 * 1000 / 3600" },
      },
    ],
  },

  execution: {
    timeoutMs: 2000,
    retry: { maxAttempts: 1 },
    idempotent: true,
    sideEffect: "none",
    costLevel: "low",
  },
};
