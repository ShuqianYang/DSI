/**
 * Tavily 搜索 API 封装
 * https://tavily.com
 */

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";
const TAVILY_API_URL = "https://api.tavily.com/search";

export interface TavilySearchOptions {
  query: string;
  searchDepth?: "basic" | "advanced";
  maxResults?: number;
  includeAnswer?: boolean;
  includeImages?: boolean;
  includeRawContent?: boolean;
  timeoutMs?: number;
}

export interface TavilySearchResult {
  query: string;
  answer?: string;
  results: Array<{
    title: string;
    url: string;
    content: string;
    raw_content?: string;
    score: number;
    published_date?: string;
  }>;
  images?: string[];
  response_time: number;
}

export async function tavilySearch(options: TavilySearchOptions): Promise<TavilySearchResult | null> {
  const {
    query,
    searchDepth = "advanced",
    maxResults = 10,
    includeAnswer = true,
    includeImages = false,
    includeRawContent = false,
    timeoutMs = 15000,
  } = options;

  if (!TAVILY_API_KEY) {
    throw new Error("TAVILY_API_KEY not configured");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(TAVILY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        search_depth: searchDepth,
        max_results: maxResults,
        include_answer: includeAnswer,
        include_images: includeImages,
        include_raw_content: includeRawContent,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Tavily API error: ${resp.status} ${body.slice(0, 200)}`);
    }

    const data = (await resp.json()) as TavilySearchResult;
    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Tavily API timeout after ${timeoutMs}ms`);
    }
    throw err;
  }
}
