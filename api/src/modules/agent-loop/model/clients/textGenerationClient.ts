import { loadModelConfig, type ModelConfigPrefix } from "../config.js";
import { createModelGateway, type ModelGatewayDependencies, type ModelGatewayLike } from "../modelGateway.js";
import type { ModelCallOptions, ModelMessage } from "../types.js";

export interface TextGenerationOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onRetry?: ModelCallOptions["onRetry"];
}

export class TextGenerationClient {
  constructor(private readonly gateway: ModelGatewayLike) {}

  async generateText(messages: ModelMessage[], options: TextGenerationOptions = {}): Promise<string> {
    const response = await this.gateway.generate({
      messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      purpose: "text-generation",
    }, { signal: options.signal, onRetry: options.onRetry });
    return response.content;
  }
}

export function createTextGenerationClient(
  prefix: ModelConfigPrefix = "DAILY_REPORT",
  dependencies: ModelGatewayDependencies = {}
): TextGenerationClient {
  return new TextGenerationClient(createModelGateway(loadModelConfig(prefix), dependencies));
}
