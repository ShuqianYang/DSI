/**
 * Backward-compatible Agent Loop model client facade.
 *
 * Provider selection, configuration, transport, and response normalization now
 * live under ./model. Keep this module stable because runAgentLoop and scripted
 * test clients import ModelClient/createModelClient from here.
 */
export type { ModelClient } from "./model/clients/agentModelClient.js";
export { createAgentModelClient as createModelClient } from "./model/clients/agentModelClient.js";
