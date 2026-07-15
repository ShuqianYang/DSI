#!/usr/bin/env node
import { callDeepSeek, buildPlannerPrompt, buildRouterPrompt, extractJson } from './run-test.mjs';

const API_KEY = process.env.DEEPSEEK_API_KEY || '';

const EDGE_CASES = [
  '帮我查查火星上有没有海盗船',
  '预测一下明天彩票中奖号码',
  '给我画一只粉红色的独角兽在太平洋上跳舞',
  '查查我家楼下奶茶店今天卖了多少杯珍珠奶茶',
  '帮我找一下海底两万里处的潜艇',
  '查询一下太平洋上有没有外星人飞船',
  '帮我统计一下月球背面有多少个陨石坑',
  '预测一下下周三纽约股市会不会崩盘',
];

for (let i = 0; i < EDGE_CASES.length; i++) {
  const q = EDGE_CASES[i];
  console.log(`\n========================================`);
  console.log(`[${i + 1}/${EDGE_CASES.length}] ${q}`);
  console.log(`========================================`);

  try {
    // Planner
    console.log('\n--- Planner ---');
    const planRaw = await callDeepSeek(API_KEY, [
      { role: 'system', content: '你是一个任务规划专家，只返回 JSON。' },
      { role: 'user', content: buildPlannerPrompt(q) },
    ], { reasoning_effort: 'high' });

    let plan;
    try {
      plan = JSON.parse(extractJson(planRaw));
    } catch {
      console.log('Planner 解析失败，原始输出:', planRaw.slice(0, 500));
      continue;
    }

    console.log('status:', plan.status);
    console.log('scenarioType:', plan.scenarioType);
    console.log('goal:', plan.goal);
    console.log('subtasks:', plan.subtasks?.length || 0);
    console.log('unsupportedSubtasks:', plan.unsupportedSubtasks?.length || 0);

    // Router
    console.log('\n--- Router ---');
    const routerRaw = await callDeepSeek(API_KEY, [
      { role: 'system', content: '你是一个工具路由专家，只返回 JSON。' },
      { role: 'user', content: buildRouterPrompt(JSON.stringify(plan, null, 2)) },
    ], { reasoning_effort: 'high' });

    let router;
    try {
      router = JSON.parse(extractJson(routerRaw));
    } catch {
      console.log('Router 解析失败，原始输出:', routerRaw.slice(0, 500));
      continue;
    }

    console.log('status:', router.status);
    console.log('actions:', router.actions?.length || 0);
    console.log('blockedActions:', router.blockedActions?.length || 0);

    if (router.actions?.length > 0) {
      console.log('\nActions:');
      for (const a of router.actions) {
        console.log(`  [${a.type}] ${a.name} params=${JSON.stringify(a.params)}`);
      }
    }
    if (router.blockedActions?.length > 0) {
      console.log('\nBlocked:');
      for (const b of router.blockedActions) {
        console.log(`  [${b.blockedReason}] ${b.name}: ${b.message}`);
      }
    }
  } catch (err) {
    console.log('Error:', err.message);
  }
}

console.log('\n========================================');
console.log('所有边缘用例测试完成');
