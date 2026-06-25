import { strict as assert } from 'node:assert';
import { isValidElement } from 'react';
import type { SkillCatalogItem } from '../../src/types/skillCatalog';

type ComponentModule<T> = {
  default: T | { default: T };
};

function unwrapDefault<T>(module: ComponentModule<T>): T {
  const exported = module.default;
  return typeof exported === 'object' && exported !== null && 'default' in exported
    ? exported.default
    : exported;
}

const SkillCard = unwrapDefault(await import('../../src/components/skills/SkillCard.tsx'));
const SkillDetailDrawer = unwrapDefault(await import('../../src/components/skills/SkillDetailDrawer.tsx'));
const SkillFilters = unwrapDefault(await import('../../src/components/skills/SkillFilters.tsx'));

const item: SkillCatalogItem = {
  id: 'border-defense-qa',
  name: 'border-defense-qa',
  title: 'Border Defense Qa',
  description: 'Use when the user asks about border defense data.',
  category: 'border',
  categoryLabel: '边防业务',
  categorySource: 'inferred',
  argumentHint: '[user border defense query in Chinese]',
  allowedTools: ['Read', 'MysqlQuerySchema', 'MysqlQuery'],
  relativePath: 'skills/border-defense-qa/SKILL.md',
  sourceDir: 'skills/border-defense-qa',
  status: 'available',
  loadedByScenarios: [],
};

const card = SkillCard({ item, onSelect: () => undefined });
const drawer = SkillDetailDrawer({ item, onClose: () => undefined });
const filters = SkillFilters({
  search: '',
  category: 'all',
  onSearchChange: () => undefined,
  onCategoryChange: () => undefined,
});

assert.ok(isValidElement(card), 'SkillCard should return a React element');
assert.ok(isValidElement(drawer), 'SkillDetailDrawer should return a React element when item is selected');
assert.ok(isValidElement(filters), 'SkillFilters should return a React element');

console.log('PASS skill component smoke test');
