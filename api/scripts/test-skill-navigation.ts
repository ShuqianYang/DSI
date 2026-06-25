import { readFile } from 'node:fs/promises';
import { strict as assert } from 'node:assert';

async function main() {
  const pageSource = await readFile('src/app/skills/page.tsx', 'utf8');
  const userCenterSource = await readFile('src/components/UserCenter.tsx', 'utf8');

  assert.ok(pageSource.includes("router.push('/')"), 'Skill page back button should navigate to the app home');
  assert.ok(!pageSource.includes('router.back()'), 'Skill page should not rely on browser history for back navigation');
  assert.ok(userCenterSource.includes('Sparkles'), 'UserCenter should import and render Sparkles for Skill Gallery');
  assert.ok(userCenterSource.includes("router.push('/skills')"), 'UserCenter should navigate to the Skill Gallery route');
  assert.ok(userCenterSource.includes('Skill 广场'), 'UserCenter should label the menu item Skill 广场');

  console.log('PASS skill navigation smoke test');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
