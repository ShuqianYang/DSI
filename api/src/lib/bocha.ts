/**
 * 博查搜索 API 封装
 * https://bocha.cn
 */

const BOCHA_API_KEY = process.env.BOCHA_API_KEY || "";
const BOCHA_API_URL = "https://api.bocha.cn/v1/web-search";

export interface BochaSearchOptions {
  query: string;
  count?: number;
  freshness?: "oneDay" | "oneWeek" | "oneMonth" | "noLimit";
  summary?: boolean;
  timeoutMs?: number;
}

export interface BochaWebPage {
  id: string;
  name: string;
  url: string;
  displayUrl: string;
  snippet: string;
  siteName?: string;
  datePublished?: string;
}

export interface BochaSearchResult {
  code: number;
  logId: string;
  msg: string | null;
  data?: {
    _type: string;
    queryContext?: { originalQuery: string };
    webPages?: {
      totalEstimatedMatches?: number;
      value: BochaWebPage[];
    };
  };
}

export async function bochaSearch(options: BochaSearchOptions): Promise<BochaSearchResult | null> {
  const {
    query,
    count = 10,
    freshness = "noLimit",
    summary = true,
    timeoutMs = 60000,
  } = options;

  if (!BOCHA_API_KEY) {
    console.warn("[Bocha] BOCHA_API_KEY not configured, returning null");
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(BOCHA_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BOCHA_API_KEY}`,
      },
      body: JSON.stringify({
        query,
        count,
        freshness,
        summary,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Bocha API error: ${resp.status} ${body.slice(0, 200)}`);
    }

    const data = (await resp.json()) as BochaSearchResult;

    if (data.code !== 200) {
      throw new Error(`Bocha API business error: ${data.code} ${data.msg || ""}`);
    }

    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Bocha API timeout after ${timeoutMs}ms`);
    }
    throw err;
  }
}
