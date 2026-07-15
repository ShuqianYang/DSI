import { ToolRegistry } from "./_shared/toolRegistry.js";
import { registerSystemTools } from "./system/index.js";
import { registerDomainTools } from "./domain/index.js";

export function buildDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registerSystemTools(registry);
  registerDomainTools(registry);
  return registry;
}
