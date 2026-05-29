import { callDeepSeek, buildPlannerPrompt, buildRouterPrompt, extractJson } from './test-planner-router.mjs';

const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const QUERY = '查询一下东海现在有多少货船，按国籍统计一下';

console.log('=== Planner + Router DeepSeek 测试（演示版提示词）===');
console.log('用户提问:', QUERY);

// Step 1: Planner
console.log('\n--- Step 1: 调用 Planner ---');
const plannerMessages = [
  { role: 'system', content: '你是一个任务规划专家，只返回 JSON。' },
  { role: 'user', content: buildPlannerPrompt(QUERY) },
];

const planRaw = await callDeepSeek(API_KEY, plannerMessages, { reasoning_effort: 'high' });
console.log('\nPlanner raw output:\n', planRaw.slice(0, 2000), '\n...');

const plan = JSON.parse(extractJson(planRaw));
console.log('\nPlanner parsed:');
console.log('  status:', plan.status);
console.log('  scenarioType:', plan.scenarioType);
console.log('  goal:', plan.goal);
console.log('  subtasks:', plan.subtasks?.length || 0);
console.log('  unsupportedSubtasks:', plan.unsupportedSubtasks?.length || 0);

// Step 2: Router
console.log('\n--- Step 2: 调用 Router ---');
const routerMessages = [
  { role: 'system', content: '你是一个工具路由专家，只返回 JSON。' },
  { role: 'user', content: buildRouterPrompt(JSON.stringify(plan, null, 2), QUERY) },
];

const routerRaw = await callDeepSeek(API_KEY, routerMessages, { reasoning_effort: 'high' });
console.log('\nRouter raw output:\n', routerRaw.slice(0, 2000), '\n...');

const routerResult = JSON.parse(extractJson(routerRaw));
console.log('\nRouter parsed:');
console.log('  status:', routerResult.status);
console.log('  actions:', routerResult.actions?.length || 0);
console.log('  blockedActions:', routerResult.blockedActions?.length || 0);

console.log('\n=== 最终 Actions ===');
for (const action of routerResult.actions || []) {
  console.log(`  [${action.type}] ${action.name}`);
  console.log(`      params:`, JSON.stringify(action.params));
}

if (routerResult.blockedActions?.length > 0) {
  console.log('\n=== Blocked ===');
  for (const b of routerResult.blockedActions) {
    console.log(`  [${b.blockedReason}] ${b.name}: ${b.message}`);
  }
}

console.log('\n=== 完整 Router 结果 ===');
console.log(JSON.stringify(routerResult, null, 2));
