import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { getSkillScenarioUsage } from '@datasourceintelligence/shared';
import type { SkillCatalogItem, SkillCategory } from '../types/skillCatalog';

interface SkillFileInput {
  name: string;
  markdown: string;
  relativePath: string;
  sourceDir: string;
}

const CATEGORY_LABELS: Record<SkillCategory, string> = {
  situation: '态势感知',
  disaster: '灾害评估',
  border: '边防业务',
  data: '数据分析',
  demo: '演示技能',
  developer: '研发辅助',
  other: '其他能力',
};

export async function loadProjectSkillCatalog(workspaceRoot = process.cwd()): Promise<SkillCatalogItem[]> {
  const skillsRoot = path.join(workspaceRoot, 'skills');
  const entries = await readdir(skillsRoot, { withFileTypes: true }).catch(() => []);
  const items: SkillCatalogItem[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillDir = path.join(skillsRoot, entry.name);
    const skillPath = path.join(skillDir, 'SKILL.md');
    const skillStat = await stat(skillPath).catch(() => undefined);
    if (!skillStat?.isFile()) continue;

    const markdown = await readFile(skillPath, 'utf8');
    items.push(
      buildCatalogItem({
        name: entry.name,
        markdown,
        relativePath: normalizeRelativePath(path.relative(workspaceRoot, skillPath)),
        sourceDir: normalizeRelativePath(path.relative(workspaceRoot, skillDir)),
      }),
    );
  }

  return items.sort((left, right) => left.name.localeCompare(right.name));
}

export function parseSkillFrontmatter(markdown: string): Record<string, unknown> {
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const result: Record<string, unknown> = {};
  let currentListKey: string | undefined;

  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim() || line.trimStart().startsWith('#')) continue;

    const listMatch = line.match(/^\s*-\s+(.+)$/);
    if (listMatch && currentListKey) {
      const currentValue = result[currentListKey];
      const list = Array.isArray(currentValue) ? currentValue : [];
      list.push(cleanYamlValue(listMatch[1]));
      result[currentListKey] = list;
      continue;
    }

    currentListKey = undefined;
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!keyMatch) continue;

    const key = keyMatch[1];
    const value = keyMatch[2] ?? '';
    if (!value.trim()) {
      result[key] = [];
      currentListKey = key;
    } else if (key === 'allowed-tools' || key === 'allowed_tools') {
      result[key] = parseAllowedTools(value);
    } else {
      result[key] = cleanYamlValue(value);
    }
  }

  return result;
}

export function normalizeSkillCategory(value: unknown): SkillCategory | undefined {
  const text = String(value ?? '').trim();
  return isSkillCategory(text) ? text : undefined;
}

export function inferSkillCategory(name: string, description: string, allowedTools: string[]): SkillCategory {
  const text = `${name} ${description} ${allowedTools.join(' ')}`.toLowerCase();

  if (text.includes('演示') || text.includes('/演示') || text.includes('mock replay') || text.includes('demo')) {
    return 'demo';
  }
  if (
    text.includes('earthquake') ||
    text.includes('flood') ||
    text.includes('fire') ||
    text.includes('disaster') ||
    text.includes('灾') ||
    text.includes('遥感')
  ) {
    return 'disaster';
  }
  if (text.includes('border') || text.includes('alarm') || text.includes('边防') || text.includes('预警')) {
    return 'border';
  }
  if (text.includes('ais') || text.includes('aircraft') || text.includes('态势') || text.includes('region')) {
    return 'situation';
  }
  if (text.includes('csv') || text.includes('sql') || text.includes('mysql') || text.includes('report') || text.includes('数据')) {
    return 'data';
  }
  if (text.includes('commit') || text.includes('developer') || text.includes('git')) {
    return 'developer';
  }

  return 'other';
}

function buildCatalogItem(input: SkillFileInput): SkillCatalogItem {
  const frontmatter = parseSkillFrontmatter(input.markdown);
  const name = stringValue(frontmatter.name) || input.name;
  const description = stringValue(frontmatter.description) || extractFallbackDescription(input.markdown, name);
  const allowedTools = arrayValue(frontmatter['allowed-tools'] ?? frontmatter.allowed_tools);
  const explicitCategory = normalizeSkillCategory(frontmatter.category);
  const category = explicitCategory ?? inferSkillCategory(name, description, allowedTools);

  return {
    id: name,
    name,
    title: toSkillTitle(name),
    description,
    category,
    categoryLabel: CATEGORY_LABELS[category],
    categorySource: explicitCategory ? 'frontmatter' : 'inferred',
    argumentHint: stringValue(frontmatter['argument-hint'] ?? frontmatter.argument_hint),
    allowedTools,
    relativePath: input.relativePath,
    sourceDir: input.sourceDir,
    status: 'available',
    loadedByScenarios: getSkillScenarioUsage(name),
  };
}

function parseAllowedTools(value: string): string[] {
  return value
    .split(',')
    .flatMap((part) => part.trim().split(/\s+/))
    .map(cleanYamlValue)
    .filter(Boolean);
}

function arrayValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === 'string') return parseAllowedTools(value);
  return [];
}

function stringValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function cleanYamlValue(value: unknown): string {
  const text = String(value ?? '').trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function extractFallbackDescription(markdown: string, name: string): string {
  const firstContentLine = markdown
    .replace(/^---\s*\r?\n[\s\S]*?\r?\n---/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return firstContentLine?.replace(/^#{1,6}\s+/, '') || `Project skill ${name}`;
}

function toSkillTitle(name: string): string {
  return name
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function isSkillCategory(value: string): value is SkillCategory {
  return (
    value === 'situation' ||
    value === 'disaster' ||
    value === 'border' ||
    value === 'data' ||
    value === 'demo' ||
    value === 'developer' ||
    value === 'other'
  );
}
