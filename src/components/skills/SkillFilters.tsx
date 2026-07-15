'use client';

import { Search } from 'lucide-react';
import type { SkillCategory } from '@/types/skillCatalog';

export type SkillCategoryFilter = SkillCategory | 'all' | 'my';

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
