/**
 * Agent Harness 保护机制测试
 *
 * 测试项：
 * 1. 重复调用拦截（runtimeState.hasUsedTool）
 * 2. maxSteps 强制结束（runOpenAgentLoop）
 * 3. outputSchema 校验失败（validateToolOutput）
 */

import { z } from "zod";
import { createRuntimeState, hasUsedTool, markToolUsed, isMaxStepsReached } from "../src/modules/harness/runtimeState.js";
import { validateToolOutput } from "../src/modules/actions/contracts/toolValidator.js";

console.log("=== Agent Harness Protection Tests ===\n");

// ========== Test 1: 重复调用拦截 ==========
console.log("TEST 1: Duplicate tool call detection");
{
  const state = createRuntimeState("task-1", "test query");

  const params1 = { region: "东京", date: "today" };
  const params2 = { region: "东京", date: "today" }; // same params
  const params3 = { region: "北京", date: "today" }; // different params

  // 第一次使用
  markToolUsed(state, "weather.fetch", params1);

  // 相同工具 + 相同参数 → 应被检测为重复
  const isDup = hasUsedTool(state, "weather.fetch", params2);
  console.assert(isDup === true, "Expected duplicate detection for same params");
  console.log(`  Same params: ${isDup ? "BLOCKED ✓" : "ALLOWED ✗"}`);

  // 相同工具 + 不同参数 → 不应被检测为重复
  const isNotDup = hasUsedTool(state, "weather.fetch", params3);
  console.assert(isNotDup === false, "Expected no duplicate for different params");
  console.log(`  Different params: ${isNotDup ? "BLOCKED ✗" : "ALLOWED ✓"}`);

  // 不同工具 → 不应被检测为重复
  const isDifferentTool = hasUsedTool(state, "news.search", params2);
  console.assert(isDifferentTool === false, "Expected no duplicate for different tool");
  console.log(`  Different tool: ${isDifferentTool ? "BLOCKED ✗" : "ALLOWED ✓"}`);
}

// ========== Test 2: maxSteps 强制结束 ==========
console.log("\nTEST 2: maxSteps enforcement");
{
  const state = createRuntimeState("task-2", "test query", { maxSteps: 2 });

  console.assert(!isMaxStepsReached(state), "Step 0 should not reach max");
  console.log(`  Step 0 / max 2: ${!isMaxStepsReached(state) ? "CONTINUE ✓" : "STOP ✗"}`);

  // 模拟执行一步
  state.stepCount = 1;
  console.assert(!isMaxStepsReached(state), "Step 1 should not reach max");
  console.log(`  Step 1 / max 2: ${!isMaxStepsReached(state) ? "CONTINUE ✓" : "STOP ✗"}`);

  // 再执行一步
  state.stepCount = 2;
  console.assert(isMaxStepsReached(state), "Step 2 should reach max");
  console.log(`  Step 2 / max 2: ${isMaxStepsReached(state) ? "STOP ✓" : "CONTINUE ✗"}`);
}

// ========== Test 3: outputSchema 校验失败 ==========
console.log("\nTEST 3: Output schema validation failure");
{
  const contract = {
    name: "weather.fetch",
    displayName: "气象数据",
    description: "获取气象数据",
    inputSchema: z.object({}),
    outputSchema: z.object({
      message: z.string(),
      temperature: z.number(),
    }),
    normalizeOutput: (raw) => {
      const data = raw;
      return {
        message: data.message || "",
        temperature: data.temperature,
      };
    },
    llm: { whenToUse: "获取气象数据" },
    execution: {
      timeoutMs: 5000,
      retry: { maxAttempts: 1 },
      idempotent: true,
      sideEffect: "external_request",
      costLevel: "low",
    },
  };

  // 合法输出 → 通过
  const validResult = validateToolOutput(contract, {
    message: "东京天气晴朗",
    temperature: 25,
  });
  console.assert(validResult.ok === true, "Valid output should pass");
  console.log(`  Valid output: ${validResult.ok ? "PASS ✓" : "FAIL ✗"}`);

  // 非法输出（缺少 temperature）→ 失败
  const invalidResult = validateToolOutput(contract, {
    message: "东京天气晴朗",
    // missing temperature
  });
  console.assert(invalidResult.ok === false, "Invalid output should fail");
  console.assert(invalidResult.reason === "invalid_output", "Should return invalid_output reason");
  console.log(`  Invalid output (missing field): ${!invalidResult.ok ? "FAIL ✓" : "PASS ✗"} | reason: ${invalidResult.reason}`);

  // 非法输出（类型错误）→ 失败
  const wrongTypeResult = validateToolOutput(contract, {
    message: "东京天气晴朗",
    temperature: "25度", // should be number
  });
  console.assert(wrongTypeResult.ok === false, "Wrong type output should fail");
  console.log(`  Wrong type (string vs number): ${!wrongTypeResult.ok ? "FAIL ✓" : "PASS ✗"} | reason: ${wrongTypeResult.reason}`);

  // normalizeOutput 后非法 → 失败
  const rawInvalid = { msg: "wrong field name" }; // no 'message' or 'temperature'
  const normalizedInvalid = contract.normalizeOutput(rawInvalid);
  const normalizedResult = validateToolOutput(contract, normalizedInvalid);
  console.assert(normalizedResult.ok === false, "Normalized invalid output should fail");
  console.log(`  Normalized invalid: ${!normalizedResult.ok ? "FAIL ✓" : "PASS ✗"} | reason: ${normalizedResult.reason}`);
}

console.log("\n=== All protection tests completed ===");
