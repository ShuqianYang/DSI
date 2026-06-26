'use client';

import { Sparkles } from 'lucide-react';
import type { ScenarioProfile } from '@datasourceintelligence/shared';
import type { SkillCatalogItem } from '@/types/skillCatalog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface ScenarioSkillButtonProps {
  scenario: ScenarioProfile;
  skills: SkillCatalogItem[];
  loading?: boolean;
  error?: string | null;
}

export default function ScenarioSkillButton({ scenario, skills, loading, error }: ScenarioSkillButtonProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={loading || skills.length === 0}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#3A3A4E] bg-[#2A2A3E] px-2.5 py-2 text-xs text-[#B8B8D0] transition-colors hover:border-[#00E0FF]/70 hover:text-[#EAEAEA] disabled:cursor-not-allowed disabled:opacity-50"
          title="当前场景加载的 Skill"
        >
          <Sparkles className="h-3.5 w-3.5 text-[#00E0FF]" />
          <span>技能</span>
          <span className="rounded bg-[#00E0FF]/10 px-1.5 py-0.5 text-[10px] text-[#00E0FF]">
            {loading ? '...' : skills.length}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-72 border-[#3A3A4E] bg-[#1E1E2E] p-3 text-[#EAEAEA]"
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">{scenario.name} 已加载 Skill</span>
          <span className="rounded bg-[#00E0FF]/10 px-1.5 py-0.5 text-[10px] text-[#00E0FF]">
            {skills.length}
          </span>
        </div>
        {error ? (
          <div className="text-xs text-[#FF4444]">加载失败：{error}</div>
        ) : (
          <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
            {skills.map((item) => (
              <div
                key={item.id}
                className="rounded-md border border-[#3A3A4E] bg-[#2A2A3E] p-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-[#EAEAEA]">{item.title}</span>
                  <span className="shrink-0 rounded border border-[#00E0FF]/30 bg-[#00E0FF]/10 px-1.5 py-0.5 text-[10px] text-[#00E0FF]">
                    {item.categoryLabel}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[#8888AA]">
                  {item.description}
                </p>
                <div className="mt-1.5 text-[10px] text-[#666688]">
                  {item.allowedTools.length} 个可用工具
                </div>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
