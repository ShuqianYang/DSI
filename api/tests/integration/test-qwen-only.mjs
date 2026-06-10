import "dotenv/config";
import { callQwen } from "../../src/lib/qwen.js";

const start = Date.now();
try {
  const result = await callQwen({ prompt: "提取新闻搜索关键词：南海仁爱礁最新消息", temperature: 0.1, timeoutMs: 60000 });
  console.log("qwen 成功", Date.now() - start, "ms");
  console.log("回答:", result.answer.slice(0, 200));
} catch (e) {
  console.log("qwen 失败", Date.now() - start, "ms:", e.message);
}
