import { strict as assert } from 'node:assert';
import path from 'node:path';
import skillCatalog from '../../src/lib/skillCatalog.server.ts';

const {
  inferSkillCategory,
  loadProjectSkillCatalog,
  normalizeSkillCategory,
  parseSkillFrontmatter,
} = skillCatalog;

async function main() {
  const frontmatter = parseSkillFrontmatter(`---
name: demo-skill
description: Demo description
category: data
argument-hint: "[query]"
allowed-tools: Read, SqlQuery
---

# Demo
`);

  assert.equal(frontmatter.name, 'demo-skill');
  assert.equal(frontmatter.description, 'Demo description');
  assert.equal(frontmatter.category, 'data');
  assert.equal(frontmatter['argument-hint'], '[query]');
  assert.deepEqual(frontmatter['allowed-tools'], ['Read', 'SqlQuery']);

  assert.equal(normalizeSkillCategory('data'), 'data');
  assert.equal(normalizeSkillCategory('unknown'), undefined);

  assert.equal(inferSkillCategory('flood-assessment', 'flood disaster assessment', []), 'disaster');
  assert.equal(inferSkillCategory('border-defense-qa', 'border defense data QA', ['MysqlQuery']), 'border');
  assert.equal(inferSkillCategory('csv-profile', 'Profiles CSV files', ['Bash']), 'data');

  const root = path.resolve(process.cwd());
  const items = await loadProjectSkillCatalog(root);
  const responseShape = {
    items,
    total: items.length,
    generatedAt: new Date().toISOString(),
  };

  assert.ok(items.length > 0, 'project skills should be discovered');
  assert.ok(items.some((item) => item.name === 'border-defense-qa'), 'border-defense-qa should be listed');
  assert.ok(items.every((item) => item.relativePath.startsWith('skills/')), 'only repo skills should be exposed');
  assert.ok(items.every((item) => !item.relativePath.includes('.agents')), 'global user skills must not be exposed');
  assert.ok(items.every((item) => item.categorySource === 'frontmatter' || item.categorySource === 'inferred'));

  const oilSpill = items.find((item) => item.name === 'oil-spill-tracing');
  assert.ok(oilSpill, 'oil-spill-tracing should be discovered');
  assert.deepEqual(
    oilSpill.loadedByScenarios.map((scenario) => scenario.id),
    ['marine'],
  );

  const fire = items.find((item) => item.name === 'fire-investigation');
  assert.ok(fire, 'fire-investigation should be discovered');
  assert.deepEqual(
    fire.loadedByScenarios.map((scenario) => scenario.id),
    ['emergency', 'border'],
  );

  const csv = items.find((item) => item.name === 'csv-profile');
  assert.ok(csv, 'csv-profile should be discovered');
  assert.deepEqual(csv.loadedByScenarios, []);

  assert.equal(responseShape.total, responseShape.items.length);
  assert.ok(Date.parse(responseShape.generatedAt) > 0, 'generatedAt should be an ISO timestamp');

  const skillsRoute = await import('../../src/app/api/skills/route.ts');
  const routeResponse = await skillsRoute.GET();
  const routeBody = await routeResponse.json();

  assert.equal(routeResponse.status, 200);
  assert.equal(routeBody.total, routeBody.items.length);
  assert.ok(Date.parse(routeBody.generatedAt) > 0, 'route generatedAt should be an ISO timestamp');
  assert.ok(routeBody.items.some((item: { name: string }) => item.name === 'border-defense-qa'));

  console.log(`PASS skill catalog parser: ${items.length} skills`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
