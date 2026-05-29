#!/usr/bin/env node
/**
 * Router 参数校验阻断测试
 *
 * 直接测试 validateActionParams 和 validateAndFilterActions，
 * 验证各种非法参数场景是否正确被过滤/阻断。
 */

import { validateActionParams, validateAndFilterActions } from "../dist/modules/router/service.js";

const TEST_CASES = [
  {
    name: "region-mark 区域不在预设列表（太平洋）",
    action: {
      id: "action-1",
      type: "region-mark",
      name: "标记太平洋",
      description: "在地图上框选太平洋区域",
      params: { region: "太平洋" },
    },
    expectValid: false,
    expectBlockedReason: "PARAM_OUT_OF_ENUM",
  },
  {
    name: "region-mark 合法区域（中国东海）",
    action: {
      id: "action-1",
      type: "region-mark",
      name: "标记东海",
      description: "在地图上框选东海区域",
      params: { region: "中国东海" },
    },
    expectValid: true,
  },
  {
    name: "region-mark 别名归一化（东海→中国东海）",
    action: {
      id: "action-1",
      type: "region-mark",
      name: "标记东海",
      description: "在地图上框选东海区域",
      params: { region: "东海" },
    },
    expectValid: true,
  },
  {
    name: "satellite 无场景 flag",
    action: {
      id: "action-1",
      type: "satellite",
      name: "获取卫星影像",
      description: "获取卫星遥感影像",
      params: { query: "东海影像", region: "中国东海" },
    },
    expectValid: false,
    expectBlockedReason: "PARAM_NOT_SUPPORTED",
  },
  {
    name: "satellite 有 detectOilSpill flag",
    action: {
      id: "action-1",
      type: "satellite",
      name: "获取卫星影像",
      description: "获取卫星遥感影像",
      params: { query: "东海影像", detectOilSpill: true, region: "中国东海" },
    },
    expectValid: true,
  },
  {
    name: "fire-detector 非法区域（北京）",
    action: {
      id: "action-1",
      type: "fire-detector",
      name: "火灾检测",
      description: "检测北京火灾",
      params: { region: "北京", fromScenario: false },
    },
    expectValid: false,
    expectBlockedReason: "PARAM_OUT_OF_ENUM",
  },
  {
    name: "fire-detector fromScenario=true",
    action: {
      id: "action-1",
      type: "fire-detector",
      name: "火灾检测",
      description: "检测火灾",
      params: { region: "北京", fromScenario: true },
    },
    expectValid: true,
  },
  {
    name: "maritime 非法海域（地中海）",
    action: {
      id: "action-1",
      type: "maritime",
      name: "海域态势分析",
      description: "分析地中海态势",
      params: { region: "地中海", query: "地中海态势" },
    },
    expectValid: false,
    expectBlockedReason: "PARAM_OUT_OF_ENUM",
  },
  {
    name: "maritime 合法海域（南海）",
    action: {
      id: "action-1",
      type: "maritime",
      name: "海域态势分析",
      description: "分析南海态势",
      params: { region: "南海", query: "南海态势" },
    },
    expectValid: true,
  },
  {
    name: "earthquake-evaluation 非法区域（四川）",
    action: {
      id: "action-1",
      type: "earthquake-evaluation",
      name: "地震灾后评估",
      description: "评估四川地震",
      params: { region: "四川", query: "四川地震评估" },
    },
    expectValid: false,
    expectBlockedReason: "PARAM_OUT_OF_ENUM",
  },
  {
    name: "earthquake-evaluation 合法区域（柳州）",
    action: {
      id: "action-1",
      type: "earthquake-evaluation",
      name: "地震灾后评估",
      description: "评估柳州地震",
      params: { region: "柳州", query: "柳州地震评估" },
    },
    expectValid: true,
  },
  {
    name: "flood-evaluation 非法区域（湖北）",
    action: {
      id: "action-1",
      type: "flood-evaluation",
      name: "洪涝灾后评估",
      description: "评估湖北洪涝",
      params: { region: "湖北", query: "湖北洪涝评估" },
    },
    expectValid: false,
    expectBlockedReason: "PARAM_OUT_OF_ENUM",
  },
  {
    name: "news 无场景 flag",
    action: {
      id: "action-1",
      type: "news",
      name: "新闻查询",
      description: "查询新闻",
      params: { query: "东海新闻", region: "东海", timeRange: "7d" },
    },
    expectValid: false,
    expectBlockedReason: "PARAM_NOT_SUPPORTED",
  },
  {
    name: "news 有 earthquakeScenario flag",
    action: {
      id: "action-1",
      type: "news",
      name: "新闻查询",
      description: "查询地震新闻",
      params: { query: "地震新闻", region: "柳州", earthquakeScenario: true, timeRange: "7d" },
    },
    expectValid: true,
  },
  {
    name: "validateAndFilterActions 混合场景",
    actions: [
      {
        id: "action-1",
        type: "region-mark",
        name: "标记东海",
        params: { region: "中国东海" },
      },
      {
        id: "action-2",
        type: "satellite",
        name: "获取影像",
        params: { detectOilSpill: true },
      },
      {
        id: "action-3",
        type: "maritime",
        name: "态势分析",
        params: { region: "地中海" },
      },
    ],
    isBatch: true,
    expectValidCount: 2,
    expectBlockedCount: 1,
  },
];

function runTestCase(testCase, index) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[${index + 1}/${TEST_CASES.length}] ${testCase.name}`);
  console.log("-".repeat(60));

  try {
    if (testCase.isBatch) {
      const { validActions, blockedActions } = validateAndFilterActions(testCase.actions);
      const pass =
        validActions.length === testCase.expectValidCount &&
        blockedActions.length === testCase.expectBlockedCount;

      console.log(`validActions: ${validActions.length} (预期 ${testCase.expectValidCount})`);
      for (const a of validActions) {
        console.log(`  ✓ [${a.type}] ${a.name}`);
      }
      console.log(`blockedActions: ${blockedActions.length} (预期 ${testCase.expectBlockedCount})`);
      for (const b of blockedActions) {
        console.log(`  ✗ [${b.action.type}] ${b.reason} (${b.blockedReason})`);
      }
      console.log(`\n结果: ${pass ? "通过 ✓" : "失败 ✗"}`);
      return { pass, validCount: validActions.length, blockedCount: blockedActions.length };
    } else {
      const result = validateActionParams(testCase.action);
      const pass = result.valid === testCase.expectValid;
      const reasonMatch =
        !testCase.expectBlockedReason || result.blockedReason === testCase.expectBlockedReason;

      console.log(`valid: ${result.valid} (预期 ${testCase.expectValid})`);
      if (result.reason) console.log(`reason: ${result.reason}`);
      if (result.blockedReason) console.log(`blockedReason: ${result.blockedReason}`);
      console.log(`\n结果: ${pass && reasonMatch ? "通过 ✓" : "失败 ✗"}`);
      return { pass: pass && reasonMatch, valid: result.valid, blockedReason: result.blockedReason };
    }
  } catch (err) {
    console.error(`\n错误: ${err.message}`);
    return { pass: false, error: err.message };
  }
}

function main() {
  console.log("========================================");
  console.log("Router 参数校验阻断测试");
  console.log("========================================");

  const results = [];
  for (let i = 0; i < TEST_CASES.length; i++) {
    const result = runTestCase(TEST_CASES[i], i);
    results.push({ ...TEST_CASES[i], actual: result });
  }

  console.log("\n" + "=".repeat(60));
  console.log("测试汇总");
  console.log("=".repeat(60));

  let passCount = 0;
  let failCount = 0;
  for (const r of results) {
    const status = r.actual.pass ? "通过 ✓" : "失败 ✗";
    if (r.actual.pass) passCount++; else failCount++;
    console.log(`[${status}] ${r.name}`);
  }

  console.log(`\n总计: ${results.length} 个用例`);
  console.log(`  通过: ${passCount}`);
  console.log(`  失败: ${failCount}`);
}

main();
