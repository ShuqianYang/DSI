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
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#00E0FF]/30 bg-[#00E0FF]/10">
            <Sparkles className="h-4 w-4 text-[#00E0FF]" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-[#EAEAEA]">{item.title}</div>
            <div className="mt-0.5 truncate font-mono text-xs text-[#8888AA]">{item.name}</div>
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
