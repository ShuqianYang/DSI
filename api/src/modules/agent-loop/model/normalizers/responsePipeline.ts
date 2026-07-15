import { ModelConfigError } from "../errors.js";
import type { ModelConfig, NormalizedModelResponse } from "../types.js";
import { normalizeOpenAIResponse } from "./openai.js";

export function normalizeModelResponse(
  value: unknown,
  config: ModelConfig,
  fallbackCallId?: string
): NormalizedModelResponse {
  if (config.provider === "openai-compatible") {
    return normalizeOpenAIResponse(value, config, fallbackCallId);
  }
  throw new ModelConfigError(`Provider is not implemented in phase one: ${config.provider}`);
}
