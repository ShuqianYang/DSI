export interface ModelErrorOptions {
  cause?: unknown;
  status?: number;
  retryable?: boolean;
  provider?: string;
  model?: string;
}

export class ModelError extends Error {
  readonly status?: number;
  readonly retryable: boolean;
  readonly provider?: string;
  readonly model?: string;

  constructor(message: string, options: ModelErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.provider = options.provider;
    this.model = options.model;
  }
}

export class ModelConfigError extends ModelError {}
export class ModelCapabilityError extends ModelError {}
export class ModelAuthenticationError extends ModelError {}
export class ModelRateLimitError extends ModelError {}
export class ModelTimeoutError extends ModelError {}
export class ModelTransportError extends ModelError {}
export class ModelResponseParseError extends ModelError {}

export function toModelHttpError(options: {
  status: number;
  statusText: string;
  bodyPreview: string;
  provider: string;
  model: string;
}): ModelError {
  const { status, statusText, bodyPreview, provider, model } = options;
  const suffix = bodyPreview ? `: ${bodyPreview}` : "";
  const common = { status, provider, model };

  if (status === 401 || status === 403) {
    return new ModelAuthenticationError(`Model API authentication failed (${status} ${statusText})${suffix}`, common);
  }
  if (status === 429) {
    return new ModelRateLimitError(`Model API rate limited the request (${status})${suffix}`, {
      ...common,
      retryable: true,
    });
  }
  return new ModelTransportError(`Model API request failed (${status} ${statusText})${suffix}`, {
    ...common,
    retryable: [502, 503, 504].includes(status),
  });
}
