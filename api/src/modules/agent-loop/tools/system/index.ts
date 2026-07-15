import type { ToolRegistry } from "../_shared/toolRegistry.js";
import { buildBashTool } from "./shell.js";
import { buildGlobTool, buildGrepTool, buildReadTool, buildWriteTool, buildEditTool } from "./file.js";
import { buildWebSearchTool, buildWebFetchTool } from "./web.js";
import { buildTodoWriteTool } from "./task.js";
import { buildSleepTool } from "./automation.js";

export function registerSystemTools(registry: ToolRegistry): void {
  for (const tool of buildSystemTools()) {
    registry.register(tool);
  }
}

export function buildSystemTools(): ReturnType<typeof buildBashTool>[] {
  return [
    buildBashTool(),
    buildGlobTool(),
    buildGrepTool(),
    buildReadTool(),
    buildWriteTool(),
    buildEditTool(),
    buildTodoWriteTool(),
    buildSleepTool(),
    buildWebSearchTool(),
    buildWebFetchTool(),
  ];
}
