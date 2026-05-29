#!/usr/bin/env node
import { plannerService } from '../src/modules/planner/service.js';
import { routerService } from '../src/modules/router/service.js';

const EDGE_CASES = [
  '帮我查查火星上有没有海盗船',
  '预测一下明天彩票中奖号码',
  '给我画一只粉红色的独角兽在太平洋上跳舞',
  '查查我家楼下奶茶店今天卖了多少杯珍珠奶茶',
  '帮我找一下海底两万里处的潜艇',
  '查询一下太平洋上有没有外星人飞船',
  '帮我统计一下月球背面有多少个陨石坑',
  '预测一下下周三纽约股市会不会崩盘',
  // 混合 case：部分支持 + 部分不支持
  '查询东海货船数量并按国籍统计',
  '火灾检测并预测未来火势蔓延方向',
];

for (let i = 0; i < EDGE_CASES.length; i++) {
  const q = EDGE_CASES[i];
  console.log(`\n========================================`);
  console.log(`[${i + 1}/${EDGE_CASES.length}] ${q}`);
  console.log(`========================================`);

  try {
    // Step 1: classifyIntent
    console.log('\n--- classifyIntent ---');
    const classification = await plannerService.classifyIntent(q);
    console.log('intent:', classification.intent);
    console.log('hardcoded:', classification.hardcoded);

    // Step 2: generatePlan
    console.log('\n--- Planner ---');
    const plan = await plannerService.generatePlan(q, { _classification: classification });
    console.log('goal:', plan.goal);
    console.log('steps:', plan.steps?.length || 0);
    console.log('reasoning:', plan.reasoning?.slice(0, 100) + '...');

    // 显示每个 step 的 supportStatus
    if (plan.steps && plan.steps.length > 0) {
      console.log('\nSteps:');
      for (const step of plan.steps) {
        const status = step.supportStatus || 'supported';
        const cap = step.capability || 'null';
        console.log(`  [${status}] ${step.id}: ${step.description?.slice(0, 40)}... (cap=${cap})`);
      }
    }

    // Step 3: decideActions
    console.log('\n--- Router ---');
    const actions = await routerService.decideActions(plan, q, classification);
    console.log('actions count:', actions.length);

    // 显示 supported actions
    if (actions.length > 0) {
      console.log('\nSupported Actions:');
      for (const a of actions) {
        console.log(`  [${a.type}] ${a.name} params=${JSON.stringify(a.params || {})}`);
      }
    }

    // 模拟 pipeline 中合并 unsupported steps
    const unsupportedSteps = (plan.steps || []).filter(s => s.supportStatus === 'unsupported');
    if (unsupportedSteps.length > 0) {
      console.log('\nUnsupported Steps (will be added as failed actions):');
      for (const s of unsupportedSteps) {
        console.log(`  [${s.capability || 'unsupported'}] ${s.description?.slice(0, 50)}`);
      }
    }

    const totalSteps = actions.length + unsupportedSteps.length;
    console.log(`\nTotal executables: ${totalSteps} (${actions.length} supported + ${unsupportedSteps.length} unsupported)`);

  } catch (err) {
    console.log('Error:', err.message);
    console.log(err.stack);
  }
}

console.log('\n========================================');
console.log('所有真实代码测试完成');
