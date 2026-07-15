import "dotenv/config";
import assert from "node:assert/strict";
import { z } from "zod";
import { eq } from "drizzle-orm";

const { runAgentLoop } = await import("../../src/modules/agent-loop/runAgentLoop.ts");
const { ToolRegistry } = await import("../../src/modules/agent-loop/tools/_shared/toolRegistry.ts");
const { db } = await import("../../src/config/database.ts");
const { tasks, taskSteps } = await import("../../src/db/schema.ts");

const taskId = crypto.randomUUID();
const query = "查询中国最近一个月的重大自然灾害并汇总结果";
const longAnswer = [
  "## 查询结果：中国最近一个月自然灾害情况",
  "",
  "这里是完整 Markdown 结果，包含数据来源、事件表格、总体评估和局限说明。",
  "",
  "| 日期 | 地点 | 类型 | 级别 |",
  "| --- | --- | --- | --- |",
  "| 2026-05-18 | 广西柳州 | 地震 | M5.1 |",
  "| 2026-05-29 | 新疆吐鲁番 | 地震 | M5.2 |",
  "",
  "总体评估：过去一个月中国境内未发现特大自然灾害，主要事件为中等震级地震。",
  "这个回答故意保持较长，用来模拟模型在伴随 TodoWrite 的 assistant_message 中已经给出完整报告。",
].join("\n");
const shortClosing = "以上就是完整的查询结果。如果您希望进一步了解某次事件，可以告诉我。";

const registry = new ToolRegistry();
registry.register({
  name: "TodoWrite",
  description: "Fake TodoWrite for final-answer selection regression test.",
  kind: "system",
  inputSchema: z.object({ todos: z.array(z.object({ content: z.string(), status: z.string(), activeForm: z.string() })) }),
  isConcurrencySafe: () => false,
  async execute(input, context) {
    context.toolUseContext.todoState = [];
    return { storedTodos: [], newTodos: input.todos, message: "todos updated" };
  },
});

const decisions = [
  {
    type: "tool_calls",
    content: longAnswer,
    toolCalls: [
      {
        id: "todo-complete",
        toolName: "TodoWrite",
        input: {
          todos: [
            {
              content: "汇总结果",
              status: "completed",
              activeForm: "汇总结果",
            },
          ],
        },
      },
    ],
  },
  {
    type: "final_answer",
    content: shortClosing,
  },
];

const modelClient = {
  async decide() {
    const next = decisions.shift();
    if (!next) throw new Error("unexpected extra model call");
    return next;
  },
};

const contextProvider = {
  async getUserContext() {
    return {};
  },
  async getSystemContext() {
    return {};
  },
  async getContextSections() {
    return [];
  },
};

await db.insert(tasks).values({ id: taskId, query, status: "running" });

try {
  const result = await runAgentLoop({
    taskId,
    query,
    registry,
    modelClient,
    contextProvider,
    fileLogger: false,
    maxTurns: 3,
  });

  assert.equal(result.stoppedBy, "final_answer");
  assert.equal(result.finalAnswer, longAnswer);
  assert(!result.finalAnswer.includes("如果您希望进一步了解"), "short closing should not replace the complete answer");
} finally {
  await db.delete(taskSteps).where(eq(taskSteps.taskId, taskId));
  await db.delete(tasks).where(eq(tasks.id, taskId));
}

console.log("agent loop final answer selection test passed");
process.exit(0);
