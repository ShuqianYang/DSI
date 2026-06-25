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

  assert.ok(items.length > 0, 'project skills should be discovered');
  assert.ok(items.some((item) => item.name === 'border-defense-qa'), 'border-defense-qa should be listed');
  assert.ok(items.every((item) => item.relativePath.startsWith('skills/')), 'only repo skills should be exposed');
  assert.ok(items.every((item) => !item.relativePath.includes('.agents')), 'global user skills must not be exposed');
  assert.ok(items.every((item) => item.categorySource === 'frontmatter' || item.categorySource === 'inferred'));
  assert.ok(items.every((item) => item.loadedByScenarios.length === 0), 'scenario binding is reserved but empty in MVP');

  console.log(`PASS skill catalog parser: ${items.length} skills`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
