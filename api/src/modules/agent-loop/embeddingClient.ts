/**
 * Embedding Client for qwen3-embedding:0.6b (OpenAI-compatible API).
 *
 * Generates 1024-dim vectors via a local Ollama deployment of qwen3-embedding:0.6b.
 * Gracefully degrades to `undefined` when GTE_API_BASE is not configured.
 */

export interface EmbeddingClient {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export interface CreateEmbeddingClientInput {
  apiBase?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

const DEFAULT_MODEL = "qwen3-embedding:0.6b";
const DEFAULT_TIMEOUT_MS = 30_000;
export const EXPECTED_EMBEDDING_DIMENSIONS = 1024;

export function createEmbeddingClient(
  input?: CreateEmbeddingClientInput
): EmbeddingClient | undefined {
  const apiBase = input?.apiBase ?? process.env.GTE_API_BASE;
  if (!apiBase || apiBase.trim() === "") return undefined;

  const apiKey = input?.apiKey ?? process.env.GTE_API_KEY ?? "";
  const model = input?.model ?? process.env.GTE_MODEL ?? DEFAULT_MODEL;
  const timeoutMs = parsePositiveInt(
    input?.timeoutMs ?? process.env.GTE_API_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS
  );

  const embeddingsUrl = joinUrl(apiBase, "/embeddings");

  return new GteEmbeddingClient(embeddingsUrl, apiKey, model, timeoutMs);
}

class GteEmbeddingClient implements EmbeddingClient {
  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly timeoutMs: number
  ) {}

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }

      response = await fetch(this.url, {
        method: "POST",
        signal: controller.signal,
        headers,
        body: JSON.stringify({ model: this.model, input: texts }),
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Embedding API request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Embedding API error: ${response.status} ${text}`);
    }

    const json = (await response.json()) as EmbeddingResponse;
    if (!json.data || !Array.isArray(json.data)) {
      throw new Error("Embedding API response missing data array");
    }

    return json.data
      .sort((a, b) => a.index - b.index)
      .map((item) => {
        if (!Array.isArray(item.embedding)) {
          throw new Error("Embedding API response contains non-array embedding");
        }
        if (item.embedding.length !== EXPECTED_EMBEDDING_DIMENSIONS) {
          throw new Error(
            `Embedding API response has ${item.embedding.length} dimensions; expected ${EXPECTED_EMBEDDING_DIMENSIONS}`
          );
        }
        return item.embedding as number[];
      });
  }
}

interface EmbeddingResponse {
  data?: Array<{ index: number; embedding: number[] }>;
}

function joinUrl(base: string, path: string): string {
  const trimmedBase = base.replace(/\/+$/, "");
  const trimmedPath = path.replace(/^\/+/, "");
  return `${trimmedBase}/${trimmedPath}`;
}

function parsePositiveInt(value: string | number | undefined, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
