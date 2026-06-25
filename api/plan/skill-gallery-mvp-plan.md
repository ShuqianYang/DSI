# Skill Gallery MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only "Skill 广场" page that shows project-local skills from the repository `skills/` directory.

**Architecture:** The frontend reads a new Next.js API route at `/api/skills`. The route scans only `<repo>/skills/*/SKILL.md`, parses safe metadata, and returns a catalog payload without exposing full skill prompt bodies. The page renders searchable, filterable skill cards and a detail drawer; the user menu links to the page.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind CSS 4, lucide-react, Node.js `fs/promises` and `path`.

## Global Constraints

- Only project-local skills under repository root `skills/` are shown.
- Do not scan or expose global user skills such as `C:\Users\24219\.agents\skills`.
- Do not return full `SKILL.md` content from the API.
- First version is display-only: no install, enable, disable, edit, delete, or scenario-loading management.
- Keep future scene binding as data-model headroom only; do not show "loaded by scenario" UI in this MVP.
- Keep visual style aligned with the existing dark technology theme: `#121212`, `#1E1E2E`, `#EAEAEA`, `#00E0FF`, `#3A3A4E`.
- Use App Router route files under `src/app`.

---

## File Structure

- Create `src/types/skillCatalog.ts`
  - Shared client-safe types for skill metadata, categories, and API response shape.
- Create `src/lib/skillCatalog.server.ts`
  - Server-only filesystem scanner and frontmatter parser for project-local `skills/*/SKILL.md`.
- Create `src/app/api/skills/route.ts`
  - Next.js read-only route that returns the skill catalog.
- Create `scripts/test-skills-catalog.ts`
  - Lightweight executable test for the server parser and safety constraints.
- Create `src/components/skills/SkillCard.tsx`
  - Reusable card for one skill.
- Create `src/components/skills/SkillDetailDrawer.tsx`
  - Side drawer for metadata details.
- Create `src/components/skills/SkillFilters.tsx`
  - Search and category filter controls.
- Create `src/app/skills/page.tsx`
  - Skill Gallery page.
- Modify `src/components/UserCenter.tsx`
  - Add "Skill 广场" menu item that opens `/skills`.

---

### Task 1: Shared Skill Catalog Types

**Files:**
- Create: `src/types/skillCatalog.ts`

**Interfaces:**
- Produces:
  - `SkillCategory`
  - `SkillCatalogItem`
  - `SkillCatalogResponse`
- Consumes: none

- [ ] **Step 1: Create shared type definitions**

Create `src/types/skillCatalog.ts`:

```typescript
export type SkillCategory =
  | 'situation'
  | 'disaster'
  | 'border'
  | 'data'
  | 'demo'
  | 'developer'
  | 'other';

export interface SkillCatalogItem {
  id: string;
  name: string;
  title: string;
  description: string;
  category: SkillCategory;
  categoryLabel: string;
  argumentHint?: string;
  allowedTools: string[];
  relativePath: string;
  sourceDir: string;
  status: 'available';
  loadedByScenarios: string[];
}

export interface SkillCatalogResponse {
  items: SkillCatalogItem[];
  total: number;
  generatedAt: string;
}
```

- [ ] **Step 2: Run type check**

Run: `pnpm ts-check`

Expected: TypeScript still passes, or existing unrelated errors are recorded before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/types/skillCatalog.ts
git commit -m "feat(skills): add catalog types"
```

---

### Task 2: Server-Side Skill Scanner

**Files:**
- Create: `src/lib/skillCatalog.server.ts`
- Test: `scripts/test-skills-catalog.ts`

**Interfaces:**
- Consumes:
  - `SkillCatalogItem` and `SkillCategory` from `src/types/skillCatalog.ts`
- Produces:
  - `loadProjectSkillCatalog(workspaceRoot?: string): Promise<SkillCatalogItem[]>`
  - `parseSkillFrontmatter(markdown: string): Record<string, unknown>`
  - `inferSkillCategory(name: string, description: string, allowedTools: string[]): SkillCategory`

- [ ] **Step 1: Write the parser test**

Create `scripts/test-skills-catalog.ts`:

```typescript
import { strict as assert } from 'node:assert';
import path from 'node:path';
import {
  inferSkillCategory,
  loadProjectSkillCatalog,
  parseSkillFrontmatter,
} from '../src/lib/skillCatalog.server';

async function main() {
  const frontmatter = parseSkillFrontmatter(`---
name: demo-skill
description: Demo description
argument-hint: "[query]"
allowed-tools: Read, SqlQuery
---

# Demo
`);

  assert.equal(frontmatter.name, 'demo-skill');
  assert.equal(frontmatter.description, 'Demo description');
  assert.equal(frontmatter['argument-hint'], '[query]');
  assert.deepEqual(frontmatter['allowed-tools'], ['Read', 'SqlQuery']);

  assert.equal(inferSkillCategory('flood-assessment', '洪水灾后评估', []), 'disaster');
  assert.equal(inferSkillCategory('border-defense-qa', '边防数据问答', ['MysqlQuery']), 'border');
  assert.equal(inferSkillCategory('csv-profile', 'Profiles CSV files', ['Bash']), 'data');

  const root = path.resolve(__dirname, '..');
  const items = await loadProjectSkillCatalog(root);

  assert.ok(items.length > 0, 'project skills should be discovered');
  assert.ok(items.some((item) => item.name === 'border-defense-qa'), 'border-defense-qa should be listed');
  assert.ok(items.every((item) => item.relativePath.startsWith('skills/')), 'only repo skills should be exposed');
  assert.ok(items.every((item) => !item.relativePath.includes('.agents')), 'global user skills must not be exposed');
  assert.ok(items.every((item) => item.loadedByScenarios.length === 0), 'scenario binding is reserved but empty in MVP');

  console.log(`PASS skill catalog parser: ${items.length} skills`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx scripts/test-skills-catalog.ts`

Expected: FAIL with module resolution error for `../src/lib/skillCatalog.server`.

- [ ] **Step 3: Implement server scanner**

Create `src/lib/skillCatalog.server.ts`:

```typescript
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { SkillCatalogItem, SkillCategory } from '@/types/skillCatalog';

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

export function inferSkillCategory(name: string, description: string, allowedTools: string[]): SkillCategory {
  const text = `${name} ${description} ${allowedTools.join(' ')}`.toLowerCase();

  if (text.includes('演示') || text.includes('/演示') || text.includes('mock replay')) return 'demo';
  if (text.includes('earthquake') || text.includes('flood') || text.includes('fire') || text.includes('disaster') || text.includes('灾')) return 'disaster';
  if (text.includes('border') || text.includes('alarm') || text.includes('边防') || text.includes('预警')) return 'border';
  if (text.includes('ais') || text.includes('aircraft') || text.includes('态势') || text.includes('region')) return 'situation';
  if (text.includes('csv') || text.includes('sql') || text.includes('mysql') || text.includes('report') || text.includes('数据')) return 'data';
  if (text.includes('commit') || text.includes('developer') || text.includes('git')) return 'developer';

  return 'other';
}

function buildCatalogItem(input: SkillFileInput): SkillCatalogItem {
  const frontmatter = parseSkillFrontmatter(input.markdown);
  const name = stringValue(frontmatter.name) || input.name;
  const description = stringValue(frontmatter.description) || extractFallbackDescription(input.markdown, name);
  const allowedTools = arrayValue(frontmatter['allowed-tools'] ?? frontmatter.allowed_tools);
  const category = inferSkillCategory(name, description, allowedTools);

  return {
    id: name,
    name,
    title: toSkillTitle(name),
    description,
    category,
    categoryLabel: CATEGORY_LABELS[category],
    argumentHint: stringValue(frontmatter['argument-hint'] ?? frontmatter.argument_hint),
    allowedTools,
    relativePath: input.relativePath,
    sourceDir: input.sourceDir,
    status: 'available',
    loadedByScenarios: [],
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx scripts/test-skills-catalog.ts`

Expected: PASS and prints `PASS skill catalog parser: <number> skills`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/skillCatalog.server.ts scripts/test-skills-catalog.ts
git commit -m "feat(skills): scan project skill catalog"
```

---

### Task 3: Read-Only Skills API Route

**Files:**
- Create: `src/app/api/skills/route.ts`
- Modify: `scripts/test-skills-catalog.ts`

**Interfaces:**
- Consumes:
  - `loadProjectSkillCatalog(workspaceRoot?: string)`
  - `SkillCatalogResponse`
- Produces:
  - `GET /api/skills`

- [ ] **Step 1: Extend the executable test with API response shape assertions**

Modify `scripts/test-skills-catalog.ts` by adding these assertions after `const items = await loadProjectSkillCatalog(root);`:

```typescript
  const responseShape = {
    items,
    total: items.length,
    generatedAt: new Date().toISOString(),
  };

  assert.equal(responseShape.total, responseShape.items.length);
  assert.ok(Date.parse(responseShape.generatedAt) > 0, 'generatedAt should be an ISO timestamp');
```

- [ ] **Step 2: Run test to verify parser still passes before route work**

Run: `pnpm exec tsx scripts/test-skills-catalog.ts`

Expected: PASS.

- [ ] **Step 3: Implement API route**

Create `src/app/api/skills/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { loadProjectSkillCatalog } from '@/lib/skillCatalog.server';
import type { SkillCatalogResponse } from '@/types/skillCatalog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const items = await loadProjectSkillCatalog();
    const response: SkillCatalogResponse = {
      items,
      total: items.length,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error loading skill catalog:', error);
    return NextResponse.json(
      { error: 'Failed to load skill catalog', details: String(error) },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Run type check**

Run: `pnpm ts-check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/skills/route.ts scripts/test-skills-catalog.ts
git commit -m "feat(skills): expose catalog api"
```

---

### Task 4: Skill Gallery UI Components

**Files:**
- Create: `src/components/skills/SkillCard.tsx`
- Create: `src/components/skills/SkillDetailDrawer.tsx`
- Create: `src/components/skills/SkillFilters.tsx`

**Interfaces:**
- Consumes:
  - `SkillCatalogItem`
  - `SkillCategory`
- Produces:
  - `SkillCard`
  - `SkillDetailDrawer`
  - `SkillFilters`

- [ ] **Step 1: Create `SkillCard`**

Create `src/components/skills/SkillCard.tsx`:

```tsx
'use client';

import { Database, FileText, ShieldCheck, Sparkles } from 'lucide-react';
import type { SkillCatalogItem } from '@/types/skillCatalog';

interface SkillCardProps {
  item: SkillCatalogItem;
  onSelect: (item: SkillCatalogItem) => void;
}

export default function SkillCard({ item, onSelect }: SkillCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className="h-full min-h-48 rounded-lg border border-[#3A3A4E] bg-[#1E1E2E] p-4 text-left transition-colors hover:border-[#00E0FF]/70 hover:bg-[#242438] focus:outline-none focus:ring-2 focus:ring-[#00E0FF]/60"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#00E0FF]/30 bg-[#00E0FF]/10">
            <Sparkles className="h-4 w-4 text-[#00E0FF]" />
          </div>
          <div>
            <div className="text-sm font-medium text-[#EAEAEA]">{item.title}</div>
            <div className="mt-0.5 font-mono text-xs text-[#8888AA]">{item.name}</div>
          </div>
        </div>
        <span className="shrink-0 rounded border border-[#00E0FF]/30 bg-[#00E0FF]/10 px-2 py-0.5 text-xs text-[#00E0FF]">
          {item.categoryLabel}
        </span>
      </div>

      <p className="mt-4 line-clamp-3 text-sm leading-6 text-[#B8B8D0]">{item.description}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {item.argumentHint && (
          <span className="inline-flex items-center gap-1 rounded border border-[#3A3A4E] px-2 py-1 text-xs text-[#8888AA]">
            <FileText className="h-3 w-3" />
            参数
          </span>
        )}
        <span className="inline-flex items-center gap-1 rounded border border-[#3A3A4E] px-2 py-1 text-xs text-[#8888AA]">
          <Database className="h-3 w-3" />
          {item.allowedTools.length} tools
        </span>
        <span className="inline-flex items-center gap-1 rounded border border-[#44FF44]/30 px-2 py-1 text-xs text-[#44FF44]">
          <ShieldCheck className="h-3 w-3" />
          可用
        </span>
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Create `SkillDetailDrawer`**

Create `src/components/skills/SkillDetailDrawer.tsx`:

```tsx
'use client';

import { X } from 'lucide-react';
import type { SkillCatalogItem } from '@/types/skillCatalog';

interface SkillDetailDrawerProps {
  item: SkillCatalogItem | null;
  onClose: () => void;
}

export default function SkillDetailDrawer({ item, onClose }: SkillDetailDrawerProps) {
  if (!item) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="关闭 Skill 详情"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <aside className="relative h-full w-full max-w-xl overflow-y-auto border-l border-[#3A3A4E] bg-[#121212] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs text-[#00E0FF]">{item.categoryLabel}</div>
            <h2 className="mt-2 text-xl font-semibold text-[#EAEAEA]">{item.title}</h2>
            <div className="mt-1 font-mono text-xs text-[#8888AA]">{item.name}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-[#8888AA] transition-colors hover:bg-[#2A2A3E] hover:text-[#EAEAEA]"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <section className="mt-6">
          <h3 className="text-sm font-medium text-[#EAEAEA]">能力说明</h3>
          <p className="mt-2 text-sm leading-6 text-[#B8B8D0]">{item.description}</p>
        </section>

        <section className="mt-6">
          <h3 className="text-sm font-medium text-[#EAEAEA]">触发参数</h3>
          <div className="mt-2 rounded-lg border border-[#3A3A4E] bg-[#1E1E2E] p-3 font-mono text-xs text-[#B8B8D0]">
            {item.argumentHint || '无显式参数提示'}
          </div>
        </section>

        <section className="mt-6">
          <h3 className="text-sm font-medium text-[#EAEAEA]">可用工具</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {item.allowedTools.length > 0 ? (
              item.allowedTools.map((tool) => (
                <span key={tool} className="rounded border border-[#3A3A4E] px-2 py-1 font-mono text-xs text-[#B8B8D0]">
                  {tool}
                </span>
              ))
            ) : (
              <span className="text-sm text-[#8888AA]">未声明工具</span>
            )}
          </div>
        </section>

        <section className="mt-6">
          <h3 className="text-sm font-medium text-[#EAEAEA]">来源</h3>
          <div className="mt-2 rounded-lg border border-[#3A3A4E] bg-[#1E1E2E] p-3 font-mono text-xs text-[#8888AA]">
            {item.relativePath}
          </div>
        </section>
      </aside>
    </div>
  );
}
```

- [ ] **Step 3: Create `SkillFilters`**

Create `src/components/skills/SkillFilters.tsx`:

```tsx
'use client';

import { Search } from 'lucide-react';
import type { SkillCategory } from '@/types/skillCatalog';

export type SkillCategoryFilter = SkillCategory | 'all';

interface SkillFiltersProps {
  search: string;
  category: SkillCategoryFilter;
  onSearchChange: (value: string) => void;
  onCategoryChange: (value: SkillCategoryFilter) => void;
}

const CATEGORIES: Array<{ value: SkillCategoryFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'situation', label: '态势感知' },
  { value: 'disaster', label: '灾害评估' },
  { value: 'border', label: '边防业务' },
  { value: 'data', label: '数据分析' },
  { value: 'demo', label: '演示技能' },
  { value: 'developer', label: '研发辅助' },
  { value: 'other', label: '其他能力' },
];

export default function SkillFilters({
  search,
  category,
  onSearchChange,
  onCategoryChange,
}: SkillFiltersProps) {
  return (
    <div className="flex flex-col gap-3 border-b border-[#3A3A4E] bg-[#121212] px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="relative w-full lg:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8888AA]" />
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="搜索 Skill 名称、描述或工具"
          className="h-10 w-full rounded-lg border border-[#3A3A4E] bg-[#1E1E2E] pl-9 pr-3 text-sm text-[#EAEAEA] outline-none transition-colors placeholder:text-[#666688] focus:border-[#00E0FF]"
        />
      </div>

      <div className="flex gap-2 overflow-x-auto">
        {CATEGORIES.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => onCategoryChange(item.value)}
            className={`h-9 shrink-0 rounded-lg border px-3 text-sm transition-colors ${
              category === item.value
                ? 'border-[#00E0FF] bg-[#00E0FF] text-[#121212]'
                : 'border-[#3A3A4E] bg-[#1E1E2E] text-[#B8B8D0] hover:border-[#00E0FF]/70 hover:text-[#EAEAEA]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run type check**

Run: `pnpm ts-check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/skills
git commit -m "feat(skills): add gallery components"
```

---

### Task 5: Skill Gallery Page

**Files:**
- Create: `src/app/skills/page.tsx`

**Interfaces:**
- Consumes:
  - `GET /api/skills`
  - `SkillCatalogResponse`
  - `SkillCard`
  - `SkillDetailDrawer`
  - `SkillFilters`
- Produces:
  - Route `/skills`

- [ ] **Step 1: Create the page**

Create `src/app/skills/page.tsx`:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, RefreshCw, Sparkles } from 'lucide-react';
import SkillCard from '@/components/skills/SkillCard';
import SkillDetailDrawer from '@/components/skills/SkillDetailDrawer';
import SkillFilters, { type SkillCategoryFilter } from '@/components/skills/SkillFilters';
import type { SkillCatalogItem, SkillCatalogResponse } from '@/types/skillCatalog';

export default function SkillGalleryPage() {
  const router = useRouter();
  const [items, setItems] = useState<SkillCatalogItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<SkillCatalogItem | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<SkillCategoryFilter>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/skills?_t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as SkillCatalogResponse;
      setItems(data.items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Skill 加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesCategory = category === 'all' || item.category === category;
      const matchesSearch =
        keyword.length === 0 ||
        item.name.toLowerCase().includes(keyword) ||
        item.title.toLowerCase().includes(keyword) ||
        item.description.toLowerCase().includes(keyword) ||
        item.allowedTools.some((tool) => tool.toLowerCase().includes(keyword));

      return matchesCategory && matchesSearch;
    });
  }, [items, search, category]);

  return (
    <div className="flex min-h-screen flex-col bg-[#121212] text-[#EAEAEA]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#3A3A4E] px-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-lg p-2 text-[#8888AA] transition-colors hover:bg-[#2A2A3E] hover:text-[#EAEAEA]"
            title="返回"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <Sparkles className="h-5 w-5 text-[#00E0FF]" />
          <h1 className="font-medium text-[#EAEAEA]">Skill 广场</h1>
          <span className="rounded-full border border-[#3A3A4E] bg-[#1E1E2E] px-2 py-0.5 text-xs text-[#8888AA]">
            共 {items.length} 个
          </span>
        </div>

        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-[#3A3A4E] bg-[#2A2A3E] px-3 py-1.5 text-xs text-[#8888AA] transition-colors hover:bg-[#3A3A4E] hover:text-[#EAEAEA] disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </header>

      <SkillFilters
        search={search}
        category={category}
        onSearchChange={setSearch}
        onCategoryChange={setCategory}
      />

      <main className="flex-1 overflow-auto p-6">
        {error ? (
          <div className="flex h-48 flex-col items-center justify-center text-[#FF4444]">
            <div className="text-sm">加载失败：{error}</div>
            <button
              type="button"
              onClick={load}
              className="mt-3 rounded-lg border border-[#3A3A4E] bg-[#2A2A3E] px-4 py-1.5 text-xs text-[#EAEAEA] hover:bg-[#3A3A4E]"
            >
              重试
            </button>
          </div>
        ) : loading && items.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-[#8888AA]">正在加载 Skill...</div>
        ) : filteredItems.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-[#8888AA]">没有匹配的 Skill</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filteredItems.map((item) => (
              <SkillCard key={item.id} item={item} onSelect={setSelectedItem} />
            ))}
          </div>
        )}
      </main>

      <SkillDetailDrawer item={selectedItem} onClose={() => setSelectedItem(null)} />
    </div>
  );
}
```

- [ ] **Step 2: Run type check**

Run: `pnpm ts-check`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/skills/page.tsx
git commit -m "feat(skills): add gallery page"
```

---

### Task 6: User Menu Entry

**Files:**
- Modify: `src/components/UserCenter.tsx`

**Interfaces:**
- Consumes:
  - Existing user menu state in `UserCenter`
- Produces:
  - Menu item labeled `Skill 广场`
  - Opens `/skills` and closes the menu

- [ ] **Step 1: Add icon import**

Modify the import from `lucide-react` in `src/components/UserCenter.tsx` to include `Sparkles`:

```typescript
import { User, Settings, Bell, Shield, LogOut, ChevronDown, Camera, MessageSquare, Sparkles } from 'lucide-react';
```

- [ ] **Step 2: Add menu item after 信息中心**

Add this button in the main menu section, after the existing `/info-center` button:

```tsx
                  <button
                    onClick={() => {
                      window.open('/skills', '_blank', 'noopener,noreferrer');
                      setIsOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#2A2A3E] transition-colors text-left"
                  >
                    <Sparkles className="w-4 h-4 text-[#8888AA]" />
                    <span className="text-sm text-[#EAEAEA]">Skill 广场</span>
                  </button>
```

- [ ] **Step 3: Run type check**

Run: `pnpm ts-check`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/UserCenter.tsx
git commit -m "feat(skills): link gallery from user menu"
```

---

### Task 7: End-to-End Verification

**Files:**
- No new files

**Interfaces:**
- Consumes:
  - `/api/skills`
  - `/skills`
  - `UserCenter`
- Produces:
  - Verified MVP behavior

- [ ] **Step 1: Run parser test**

Run: `pnpm exec tsx scripts/test-skills-catalog.ts`

Expected: PASS and prints discovered project skill count.

- [ ] **Step 2: Run lint**

Run: `pnpm lint`

Expected: PASS, or only pre-existing unrelated lint findings are recorded.

- [ ] **Step 3: Run type check**

Run: `pnpm ts-check`

Expected: PASS.

- [ ] **Step 4: Start dev server**

Run: `pnpm dev`

Expected: Next.js starts on `http://localhost:5000`.

- [ ] **Step 5: Verify API manually**

Open: `http://localhost:5000/api/skills`

Expected:

```json
{
  "items": [
    {
      "name": "border-defense-qa",
      "relativePath": "skills/border-defense-qa/SKILL.md",
      "status": "available",
      "loadedByScenarios": []
    }
  ],
  "total": 1,
  "generatedAt": "2026-06-25T00:00:00.000Z"
}
```

The exact `items` length and timestamp will differ. The response must not include full markdown body content.

- [ ] **Step 6: Verify page manually**

Open: `http://localhost:5000/skills`

Expected:
- Header shows `Skill 广场`.
- Total count matches `/api/skills`.
- Cards render for project-local skills.
- Search filters by name, description, and tool names.
- Category buttons filter without layout shift.
- Clicking a card opens the detail drawer.
- Drawer shows description, argument hint, allowed tools, and source path.
- Drawer source path starts with `skills/`.

- [ ] **Step 7: Verify menu entry manually**

Open the main app, click the top-right user block, then click `Skill 广场`.

Expected:
- `/skills` opens.
- The user menu closes.

- [ ] **Step 8: Final commit if verification required small fixes**

```bash
git add src scripts
git commit -m "fix(skills): polish gallery verification"
```

Only make this commit when verification changes files after Tasks 1-6.

---

## Out of Scope for MVP

- Showing global skills from user-level directories.
- Showing full skill instruction bodies.
- Installing, editing, deleting, enabling, or disabling skills.
- Binding skills to scenes.
- Showing which scene currently loads a skill.
- Invoking skills directly from the gallery.
- Role-based permission controls.

## Future Extension Points

- Populate `loadedByScenarios` from a future scene-skill registry.
- Add `enabled`, `riskLevel`, `owner`, `updatedAt`, and `examples` fields to `SkillCatalogItem`.
- Add a "试用" action that sends an example prompt into the chat panel.
- Add a backend registry that separates display metadata from agent execution prompts.

## Self-Review

- Spec coverage: The plan adds the user menu entry, `/skills` page, project-local scan, safe metadata API, search/filter/card/detail UI, and verification path.
- Placeholder scan: The plan contains no open implementation markers.
- Type consistency: `SkillCatalogItem`, `SkillCategory`, `SkillCatalogResponse`, `loadProjectSkillCatalog`, `parseSkillFrontmatter`, and `inferSkillCategory` are defined before use and reused consistently.
