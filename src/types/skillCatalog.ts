import type { ScenarioId } from '@datasourceintelligence/shared';

export type SkillCategory =
  | 'situation'
  | 'disaster'
  | 'border'
  | 'data'
  | 'demo'
  | 'developer'
  | 'other';

export interface SkillCatalogScenarioUsage {
  id: ScenarioId;
  name: string;
}

export interface SkillCatalogItem {
  id: string;
  name: string;
  title: string;
  description: string;
  category: SkillCategory;
  categoryLabel: string;
  categorySource: 'frontmatter' | 'inferred';
  argumentHint?: string;
  allowedTools: string[];
  relativePath: string;
  sourceDir: string;
  status: 'available';
  loadedByScenarios: SkillCatalogScenarioUsage[];
}

export interface SkillCatalogResponse {
  items: SkillCatalogItem[];
  total: number;
  generatedAt: string;
}
