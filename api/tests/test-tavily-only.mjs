import "dotenv/config";
import { tavilySearch } from "../src/lib/tavily.js";

const start = Date.now();
try {
  const result = await tavilySearch({ query: "南海 仁爱礁 最新", searchDepth: "advanced", maxResults: 5, includeAnswer: true, timeoutMs: 30000 });
  console.log("tavily 成功", Date.now() - start, "ms");
  console.log("结果数:", result?.results?.length);
  console.log("answer:", result?.answer?.slice(0, 150));
} catch (e) {
  console.log("tavily 失败", Date.now() - start, "ms:", e.message);
}
