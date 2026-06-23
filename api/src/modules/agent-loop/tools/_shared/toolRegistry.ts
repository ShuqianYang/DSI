import type { ToolDefinition } from "./types.js";
import { registerSystemTools } from "../system/index.js";
import { registerDomainTools } from "../domain/index.js";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly aliases = new Map<string, string>();
  private readonly hiddenTools = new Set<string>();

  register(tool: ToolDefinition, options: { override?: boolean; visible?: boolean } = {}): void {
    if (!options.override && this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    if (options.override) {
      for (const [alias, targetName] of this.aliases) {
        if (targetName === tool.name) {
          this.aliases.delete(alias);
        }
      }
    }
    this.tools.set(tool.name, tool);
    for (const alias of tool.aliases ?? []) {
      const existing = this.aliases.get(alias);
      if (existing && existing !== tool.name && !options.override) {
        throw new Error(`Tool alias already registered: ${alias}`);
      }
      this.aliases.set(alias, tool.name);
    }
    if (options.visible === false) {
      this.hiddenTools.add(tool.name);
    } else {
      this.hiddenTools.delete(tool.name);
    }
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name) ?? this.tools.get(this.aliases.get(name) ?? "");
  }

  list(options: { includeHidden?: boolean } = {}): ToolDefinition[] {
    const tools = Array.from(this.tools.values());
    if (options.includeHidden) return tools;
    return tools.filter((tool) => !this.hiddenTools.has(tool.name));
  }
}

export function buildDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registerSystemTools(registry);
  registerDomainTools(registry);
  return registry;
}
