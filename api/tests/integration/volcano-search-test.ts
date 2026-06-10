/**
 * 火山引擎 Web Search API 返回格式测试
 * 用于验证返回结构，为替换 news capability 中的博查搜索做准备
 *
 * 运行方式: npx tsx api/tests/volcano-search-test.ts
 */

const API_URL = "https://open.feedcoopapi.com/search_api/web_search";
const API_KEY = "veIwR91qBIrPSwmDwoPTfmMP1QsISPn8";

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
      console.log("\n--- 原始返回 ---");
      console.log(JSON.stringify(result, null, 2));
      console.log("\n--- 结构解析 ---");
      printResponseStructure(result, "root");
    } catch (err) {
      console.error(`查询 "${queryParams.Query}" 失败:`, err instanceof Error ? err.message : err);
    }
  }

  // 对比博查搜索的结构（用于适配参考）
  console.log("\n\n========================================");
  console.log("博查搜索（当前使用）的典型返回结构参考:");
  console.log("");
  console.log("{");
  console.log("  data: {");
  console.log("    webPages: {");
  console.log("      value: [");
  console.log("        {");
  console.log("          id: string,");
  console.log("          name: string,        // 标题");
  console.log("          url: string,");
  console.log("          displayUrl: string,");
  console.log("          snippet: string,     // 摘要");
  console.log("          siteName: string,");
  console.log("          datePublished: string,");
  console.log("          thumbnail: object,");
  console.log("        }, ...");
  console.log("      ]");
  console.log("    },");
  console.log("    _type: string");
  console.log("  },");
  console.log("  code: number,");
  console.log("  log_id: string,");
  console.log("  msg: string");
  console.log("}");
}

main();
