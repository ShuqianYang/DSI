import assert from "node:assert/strict";

const { chooseAgentLoopDisplayContent } = await import("../../../src/lib/agentLoopContent.ts");

const existing = [
  "## 查询结果",
  "",
  "这是一段已经流式展示出来的完整 Markdown 答案，包含表格、数据分析、局限说明和总结。",
  "| 项目 | 结果 |",
  "| --- | --- |",
  "| 数据源 | USGS |",
].join("\n");
const shortClosing = "以上就是完整的查询结果。如果您希望进一步了解，可以告诉我。";

assert.equal(chooseAgentLoopDisplayContent(existing, shortClosing), existing);
assert.equal(chooseAgentLoopDisplayContent("正在查询...", "查询完成。"), "查询完成。");
assert.equal(chooseAgentLoopDisplayContent(existing, ""), existing);

console.log("agent loop content guard test passed");
