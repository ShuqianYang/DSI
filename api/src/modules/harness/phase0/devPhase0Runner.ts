/**
 * Phase 0 Dev Runner
 *
 * 不启动整个 Express 服务，直接运行 runPhase0ToolLoop 的测试脚本。
 * 用法：pnpm tsx api/src/modules/harness/phase0/devPhase0Runner.ts
 */

import { runPhase0ToolLoop } from "./runPhase0ToolLoop.js";

const TEST_QUERIES = [
  "查询东京今天的天气",
  "最近日本有没有地震相关报道",
  "帮我分析一个当前没有工具支持的需求",
  "北京今天气温多少度",
  "南海最新局势怎么样",
];

async function main() {
  console.log("=== Phase 0 Agent Harness Dev Runner ===\n");

  for (const query of TEST_QUERIES) {
    console.log(`\n----------------------------------------`);
    console.log(`Query: ${query}`);
    console.log(`----------------------------------------`);

    try {
      const result = await runPhase0ToolLoop(query);
      console.log(`Mode: ${result.mode}`);
      console.log(`SelectedTool: ${result.selectedTool || "(none)"}`);
      if (result.toolParams) {
        console.log(`ToolParams: ${JSON.stringify(result.toolParams)}`);
      }
      console.log(`\nFinalText:\n${result.finalText}`);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log("\n=== Done ===");
}

main();
