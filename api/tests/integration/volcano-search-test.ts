import "dotenv/config";

/**
 * 火山引擎 Web Search API 返回格式测试
 * 用于验证返回结构，确保与 api/src/modules/agent-loop/tools/system/web.ts 的 normalize 逻辑一致。
 *
 * 运行方式: npx tsx api/tests/integration/volcano-search-test.ts
 */

const API_URL = process.env.VOLCANO_SEARCH_URL || "https://open.feedcoopapi.com/search_api/web_search";
const API_KEY = process.env.VOLCANO_SEARCH_API_KEY;

interface VolcanoSearchRequest {
  Query: string;
  SearchType: string;
  Count: number;
  Filter: {
    NeedContent: boolean;
    NeedUrl: boolean;
    Sites: string;
    BlockHosts: string;
    AuthInfoLevel: number;
  };
  NeedSummary: boolean;
  TimeRange: string;
  QueryControl: {
    QueryRewrite: boolean;
  };
}

async function volcanoSearch(params: Partial<VolcanoSearchRequest> = {}) {
  if (!API_KEY) {
    throw new Error("VOLCANO_SEARCH_API_KEY is required. Set it in your environment or .env file.");
  }

  const body: VolcanoSearchRequest = {
    Query: params.Query || "南海新闻",
    SearchType: params.SearchType || "web",
    Count: params.Count ?? 10,
    Filter: {
      NeedContent: params.Filter?.NeedContent ?? true,
      NeedUrl: params.Filter?.NeedUrl ?? true,
      Sites: params.Filter?.Sites ?? "",
      BlockHosts: params.Filter?.BlockHosts ?? "",
      AuthInfoLevel: params.Filter?.AuthInfoLevel ?? 0,
    },
    NeedSummary: params.NeedSummary ?? true,
    TimeRange: params.TimeRange ?? "",
    QueryControl: {
      QueryRewrite: params.QueryControl?.QueryRewrite ?? false,
    },
  };

  console.log("\n========================================");
  console.log("请求参数:");
  console.log(JSON.stringify(body, null, 2));

  const resp = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  console.log(`\nHTTP Status: ${resp.status} ${resp.statusText}`);

  const text = await resp.text();

  if (!resp.ok) {
    console.error("请求失败:", text);
    throw new Error(`API error: ${resp.status} ${text}`);
  }

  try {
    const json = JSON.parse(text);
    return json;
  } catch {
    console.error("返回不是有效 JSON:", text);
    throw new Error("Invalid JSON response");
  }
}

function printResponseStructure(data: unknown, path = "") {
  if (data === null) {
    console.log(`${path}: null`);
    return;
  }
  if (typeof data !== "object") {
    console.log(`${path}: ${typeof data} (${String(data).slice(0, 80)})`);
    return;
  }

  if (Array.isArray(data)) {
    console.log(`${path}: Array[${data.length}]`);
    if (data.length > 0) {
      printResponseStructure(data[0], `${path}[0]`);
    }
    return;
  }

  const obj = data as Record<string, unknown>;
  console.log(`${path}: Object {${Object.keys(obj).join(", ")}}`);
  for (const [key, value] of Object.entries(obj)) {
    printResponseStructure(value, `${path}.${key}`);
  }
}

function assertVolcanoWebResult(result: unknown, query: string) {
  if (!result || typeof result !== "object") {
    throw new Error(`[${query}] WebResult is not an object`);
  }
  const r = result as Record<string, unknown>;
  const requiredStringFields = ["Title", "Url", "Snippet", "Summary", "Content", "PublishTime"];
  for (const field of requiredStringFields) {
    if (typeof r[field] !== "string" || !r[field]) {
      throw new Error(`[${query}] WebResult.${field} is missing or not a non-empty string`);
    }
  }
  if (typeof r.SiteName !== "string" || !r.SiteName) {
    throw new Error(`[${query}] WebResult.SiteName is missing or empty`);
  }
}

function assertVolcanoResponse(data: unknown, query: string) {
  if (!data || typeof data !== "object") {
    throw new Error(`[${query}] Response is not an object`);
  }
  const response = data as Record<string, unknown>;
  const resultValue = response.Result;
  if (resultValue === null) {
    console.log(`[${query}] Result is null (empty result from provider)`);
    return;
  }
  if (typeof resultValue !== "object") {
    throw new Error(
      `[${query}] Response.Result is invalid. Top-level keys: ${Object.keys(response).join(", ")}; Result type: ${typeof resultValue}; Result preview: ${String(resultValue).slice(0, 200)}`,
    );
  }
  const result = resultValue as Record<string, unknown>;
  if (!Array.isArray(result.WebResults) || result.WebResults.length === 0) {
    throw new Error(`[${query}] Result.WebResults is empty or missing`);
  }
  result.WebResults.forEach((item) => assertVolcanoWebResult(item, query));
}

async function main() {
  const testQueries = [
    { Query: "南海新闻", Count: 5 },
    { Query: "广西地震", Count: 5 },
    { Query: "湖南暴雨洪涝", Count: 5 },
    { Query: "新疆边境火情", Count: 5 },
  ];

  for (const queryParams of testQueries) {
    try {
      const result = await volcanoSearch(queryParams);
      assertVolcanoResponse(result, queryParams.Query);
      console.log("\n--- 原始返回 ---");
      console.log(JSON.stringify(result, null, 2));
      console.log("\n--- 结构解析 ---");
      printResponseStructure(result, "root");
      console.log(`\n[✓] "${queryParams.Query}" 结构校验通过`);
    } catch (err) {
      console.error(`查询 "${queryParams.Query}" 失败:`, err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
  }
}

main();
