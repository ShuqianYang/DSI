import type { ToolDefinition } from "./types.js";
import { registerClaudeCodeBaseSystemTools } from "./systemTools.js";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }
}

export function buildDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registerClaudeCodeBaseSystemTools(registry);
  return registry;
}
