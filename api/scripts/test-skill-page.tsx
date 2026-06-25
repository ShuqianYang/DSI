import { strict as assert } from 'node:assert';

type PageModule = {
  default: unknown | { default: unknown };
};

function unwrapDefault(module: PageModule): unknown {
  const exported = module.default;
  return typeof exported === 'object' && exported !== null && 'default' in exported
    ? exported.default
    : exported;
}

const SkillGalleryPage = unwrapDefault(await import('../../src/app/skills/page.tsx'));

assert.equal(typeof SkillGalleryPage, 'function', 'Skill Gallery page should default export a component');

console.log('PASS skill page smoke test');
