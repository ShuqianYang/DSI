import { z } from "zod";
import type { ToolDefinition } from "../_shared/types.js";
import { truncate } from "./file.js";

const MAX_TOOL_OUTPUT_CHARS = 60_000;
const WEBFETCH_TIMEOUT_MS = parsePositiveIntegerEnv(process.env.WEBFETCH_TIMEOUT_MS, 30_000);
const WEBFETCH_DEFAULT_MAX_CHARS = parsePositiveIntegerEnv(
  process.env.WEBFETCH_MAX_CHARS,
  20_000,
);
const WEBFETCH_USER_AGENT = process.env.WEBFETCH_USER_AGENT || "DSI-AgentLoop/0.1";
const WEBSEARCH_TIMEOUT_MS = parsePositiveIntegerEnv(process.env.WEBSEARCH_TIMEOUT_MS, 30_000);
const VOLCANO_SEARCH_URL =
  process.env.VOLCANO_SEARCH_URL || "https://open.feedcoopapi.com/search_api/web_search";

export function buildWebSearchTool(): ToolDefinition {
  return {
    name: "WebSearch",
    description:
      'Search the web for current or unknown information. Input: {"query":"北京今天的天气","max_results":5,"time_range":"day|week|month|year"}. Use WebFetch only after WebSearch returns a URL worth reading.',
    kind: "system",
    inputSchema: z.strictObject({
      query: z.string().min(1),
      max_results: z.number().int().positive().max(10).optional(),
      time_range: z.enum(["day", "week", "month", "year"]).optional(),
      include_domains: z.array(z.string().min(1)).max(10).optional(),
      exclude_domains: z.array(z.string().min(1)).max(10).optional(),
    }),
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "medium",
    maxResultSizeChars: MAX_TOOL_OUTPUT_CHARS,
    async execute(input, context) {
      const parsed = input as {
        query: string;
        max_results?: number;
        time_range?: "day" | "week" | "month" | "year";
        include_domains?: string[];
        exclude_domains?: string[];
      };

      const apiKey = process.env.VOLCANO_SEARCH_API_KEY;
      if (!apiKey) {
        throw new Error("VOLCANO_SEARCH_API_KEY is required for WebSearch.");
      }

      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), WEBSEARCH_TIMEOUT_MS);
      if (context.signal) {
        if (context.signal.aborted) abortController.abort(context.signal.reason);
        context.signal.addEventListener("abort", () => abortController.abort(context.signal?.reason), {
          once: true,
        });
      }

      const body = {
        Query: parsed.query,
        SearchType: "web",
        Count: parsed.max_results ?? 5,
        Filter: {
          NeedContent: true,
          NeedUrl: true,
          Sites: parsed.include_domains?.join(",") ?? "",
          BlockHosts: parsed.exclude_domains?.join(",") ?? "",
          AuthInfoLevel: 0,
        },
        NeedSummary: true,
        TimeRange: parsed.time_range ?? "",
        QueryControl: {
          QueryRewrite: false,
        },
      };

      const response = await fetch(VOLCANO_SEARCH_URL, {
        method: "POST",
        signal: abortController.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      }).finally(() => clearTimeout(timeout));

      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Volcano search failed: ${response.status} ${truncate(text, 2_000)}`);
      }

      const json = parseJsonObject(text, "Volcano search response");
      const result = json.Result && typeof json.Result === "object" ? (json.Result as Record<string, unknown>) : {};
      const rawResults = Array.isArray(result.WebResults) ? result.WebResults : [];
      const results = rawResults.slice(0, parsed.max_results ?? 5).map(normalizeVolcanoResult);

      return {
        provider: "volcano",
        query: parsed.query,
        answer: buildVolcanoAnswer(results),
        results,
        responseTime: undefined,
      };
    },
  };
}

export function buildWebFetchTool(): ToolDefinition {
  return {
    name: "WebFetch",
    description:
      'Fetch text from a URL. Input: {"url":"https://example.com","max_chars":20000}. Returns truncated response text.',
    kind: "system",
    inputSchema: z.strictObject({
      url: z.string().url(),
      max_chars: z.number().int().positive().max(MAX_TOOL_OUTPUT_CHARS).optional(),
    }),
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "medium",
    maxResultSizeChars: MAX_TOOL_OUTPUT_CHARS,
    async execute(input, context) {
      const parsed = input as { url: string; max_chars?: number };
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), WEBFETCH_TIMEOUT_MS);
      if (context.signal) {
        if (context.signal.aborted) abortController.abort(context.signal.reason);
        context.signal.addEventListener("abort", () => abortController.abort(context.signal?.reason), {
          once: true,
        });
      }
      const response = await fetch(parsed.url, {
        signal: abortController.signal,
        headers: {
          "user-agent": WEBFETCH_USER_AGENT,
        },
      }).finally(() => clearTimeout(timeout));
      const text = await response.text();
      const maxChars = parsed.max_chars ?? WEBFETCH_DEFAULT_MAX_CHARS;

      return {
        url: parsed.url,
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get("content-type"),
        truncated: text.length > maxChars,
        text: truncate(text, maxChars),
      };
    },
  };
}

function dropUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function normalizeVolcanoResult(value: unknown): Record<string, unknown> {
  const result = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return dropUndefined({
    title: typeof result.Title === "string" ? result.Title : undefined,
    url: typeof result.Url === "string" ? result.Url : undefined,
    content: typeof result.Snippet === "string" ? result.Snippet : undefined,
    rawContent: typeof result.Content === "string" ? result.Content : undefined,
    summary: typeof result.Summary === "string" ? result.Summary : undefined,
    siteName: typeof result.SiteName === "string" ? result.SiteName : undefined,
    publishedDate: typeof result.PublishTime === "string" ? result.PublishTime : undefined,
  });
}

function buildVolcanoAnswer(results: Record<string, unknown>[]): string | undefined {
  if (results.length === 0) return undefined;
  // Prefer the first result's Summary if available.
  const first = results[0];
  const summary = first?.summary;
  if (typeof summary === "string" && summary.trim()) {
    return summary.trim();
  }
  return undefined;
}

function parsePositiveIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
