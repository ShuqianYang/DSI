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
  categorySource: 'frontmatter' | 'inferred';
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
