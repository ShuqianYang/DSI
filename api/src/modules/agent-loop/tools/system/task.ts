import { z } from "zod";
import type { AgentTodoItem, ToolDefinition } from "../_shared/types.js";

const MAX_TOOL_OUTPUT_CHARS = 60_000;

export function buildTodoWriteTool(): ToolDefinition {
  return {
    name: "TodoWrite",
    displayName: "待办记录",
    description:
      'Update the session todo list. Each todo must have: content (short description of the task), status (pending|in_progress|completed), and activeForm (a present-continuous phrase like "Reading file" or "Analyzing data" that describes what is currently being done). Input: {"todos":[{"content":"Read package.json","status":"in_progress","activeForm":"Reading package.json"}]}.',
    kind: "system",
    inputSchema: z.strictObject({
      todos: z.array(
        z.strictObject({
          content: z.string().min(1, "Content cannot be empty").describe("Short description of the task, e.g. 'Read package.json'"),
          status: z.enum(["pending", "in_progress", "completed"]).describe("Current status of the task"),
          activeForm: z.string().min(1, "Active form cannot be empty").describe("Present-continuous phrase describing current work, e.g. 'Reading package.json' or 'Counting dependencies'. Must not be empty."),
        }),
      ).describe("Replace the entire todo list with this array. All existing todos are overwritten."),
    }),
    isReadOnly: () => false,
    isDestructive: () => false,
    isConcurrencySafe: () => false,
    riskLevel: "low",
    maxResultSizeChars: MAX_TOOL_OUTPUT_CHARS,
    checkPermissions(input) {
      return { behavior: "allow", updatedInput: input };
    },
    async execute(input, context) {
      const parsed = input as { todos: AgentTodoItem[] };
      const oldTodos = [...(context.toolUseContext?.todoState ?? [])];

      // Fallback: if activeForm is empty, derive it from content
      const normalizedTodos = parsed.todos.map((todo) => ({
        ...todo,
        activeForm: todo.activeForm?.trim() || todo.content,
      }));

      const allDone = normalizedTodos.every((todo) => todo.status === "completed");
      const newTodos = allDone ? [] : normalizedTodos;
      if (context.toolUseContext) {
        context.toolUseContext.todoState = newTodos;
      }

      return {
        oldTodos,
        newTodos: normalizedTodos,
        storedTodos: newTodos,
        message:
          "Todos have been modified successfully. Continue to use the todo list to track current progress.",
      };
    },
  };
}
