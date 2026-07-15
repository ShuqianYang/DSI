import {
  ModelCapabilityError,
  ModelConfigError,
  ModelError,
  ModelTimeoutError,
  ModelTransportError,
} from "./errors.js";
import { normalizeModelResponse } from "./normalizers/responsePipeline.js";
import { OpenAICompatibleProvider } from "./providers/openaiCompatible.js";
import type {
  ModelCallOptions,
  ModelConfig,
  ModelFetch,
  ModelProviderAdapter,
  ModelRequest,
  NormalizedModelResponse,
} from "./types.js";

export interface ModelGatewayLike {
  generate(request: ModelRequest, options?: ModelCallOptions): Promise<NormalizedModelResponse>;
}

export interface ModelGatewayDependencies {
  fetchImpl?: ModelFetch;
  provider?: ModelProviderAdapter;
}

export class DefaultModelGateway implements ModelGatewayLike {
  private readonly provider: ModelProviderAdapter;

  constructor(
    private readonly config: ModelConfig,
    dependencies: ModelGatewayDependencies = {}
  ) {
    this.provider = dependencies.provider ?? createProvider(config, dependencies.fetchImpl);
  }

  async generate(request: ModelRequest, options: ModelCallOptions = {}): Promise<NormalizedModelResponse> {
    validateCapabilities(request, this.config);
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.config.retryCount; attempt += 1) {
      if (options.signal?.aborted) throw createAbortError(options.signal.reason, this.config);
      const attemptSignal = createAttemptSignal(options.signal, this.config.timeoutMs);
      try {
        const raw = await this.provider.generate(request, { signal: attemptSignal.signal });
        return normalizeModelResponse(raw, this.config, options.callId);
      } catch (error) {
        lastError = normalizeCallError(error, attemptSignal.timedOut(), options.signal, this.config);
      } finally {
        attemptSignal.dispose();
      }

      const normalized = lastError as ModelError;
      if (!normalized.retryable || attempt >= this.config.retryCount) throw normalized;
      const delayMs = this.config.retryBaseDelayMs * (2 ** attempt);
      options.onRetry?.({
        attempt: attempt + 1,
        nextAttempt: attempt + 2,
        maxAttempts: this.config.retryCount + 1,
        delayMs,
        error: normalized,
      });
      await waitForRetry(delayMs, options.signal, this.config);
    }

    throw lastError;
  }
}

export function createModelGateway(
  config: ModelConfig,
  dependencies: ModelGatewayDependencies = {}
): ModelGatewayLike {
  return new DefaultModelGateway(config, dependencies);
}

function createProvider(config: ModelConfig, fetchImpl?: ModelFetch): ModelProviderAdapter {
  if (config.provider === "openai-compatible") {
    return new OpenAICompatibleProvider(config, fetchImpl);
  }
  throw new ModelConfigError(`Provider is not implemented in phase one: ${config.provider}`, {
    provider: config.provider,
    model: config.model,
  });
}
function validateCapabilities(request: ModelRequest, config: ModelConfig): void {
  const hasImages = request.messages.some((message) => Array.isArray(message.content)
    && message.content.some((part) => part.type === "image_url"));
  if (hasImages && !config.capabilities.vision) {
    throw new ModelCapabilityError(`Model ${config.model} is not configured for vision requests`, {
      provider: config.provider,
      model: config.model,
    });
  }
  if (request.tools?.length) {
    if (config.toolCallMode === "none") {
      throw new ModelCapabilityError(`Model ${config.model} has tool calling disabled`, {
        provider: config.provider,
        model: config.model,
      });
    }
    if (config.toolCallMode === "native" && !config.capabilities.toolCalling) {
      throw new ModelCapabilityError(`Model ${config.model} is not configured for native tool calling`, {
        provider: config.provider,
        model: config.model,
      });
    }
    if (config.toolCallMode === "json" && !config.capabilities.jsonMode) {
      throw new ModelCapabilityError(`Model ${config.model} is not configured for JSON tool decisions`, {
        provider: config.provider,
        model: config.model,
      });
    }
  }
}

function createAttemptSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let didTimeout = false;
  const onParentAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) onParentAbort();
  else parent?.addEventListener("abort", onParentAbort, { once: true });
  const timeout = setTimeout(() => {
    didTimeout = true;
    controller.abort(new Error(`Model request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    dispose: () => {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", onParentAbort);
    },
  };
}

function normalizeCallError(
  error: unknown,
  timedOut: boolean,
  parentSignal: AbortSignal | undefined,
  config: ModelConfig
): ModelError {
  if (timedOut) {
    return new ModelTimeoutError(`Model request timed out after ${config.timeoutMs}ms`, {
      cause: error,
      retryable: true,
      provider: config.provider,
      model: config.model,
    });
  }
  if (parentSignal?.aborted) return createAbortError(parentSignal.reason, config);
  if (error instanceof ModelError) return error;
  return new ModelTransportError(error instanceof Error ? error.message : String(error), {
    cause: error,
    retryable: true,
    provider: config.provider,
    model: config.model,
  });
}

function createAbortError(reason: unknown, config: ModelConfig): ModelTransportError {
  return new ModelTransportError("Model request was aborted", {
    cause: reason,
    retryable: false,
    provider: config.provider,
    model: config.model,
  });
}

async function waitForRetry(delayMs: number, signal: AbortSignal | undefined, config: ModelConfig): Promise<void> {
  if (signal?.aborted) throw createAbortError(signal.reason, config);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(createAbortError(signal?.reason, config));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
