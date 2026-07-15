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
          <div className="min-w-0">
            <div className="text-xs text-[#00E0FF]">{item.categoryLabel}</div>
            <h2 className="mt-2 break-words text-xl font-semibold text-[#EAEAEA]">{item.title}</h2>
            <div className="mt-1 break-all font-mono text-xs text-[#8888AA]">{item.name}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-[#8888AA] transition-colors hover:bg-[#2A2A3E] hover:text-[#EAEAEA]"
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
          <div className="mt-2 break-words rounded-lg border border-[#3A3A4E] bg-[#1E1E2E] p-3 font-mono text-xs text-[#B8B8D0]">
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
          <div className="mt-2 break-all rounded-lg border border-[#3A3A4E] bg-[#1E1E2E] p-3 font-mono text-xs text-[#8888AA]">
            {item.relativePath}
          </div>
        </section>

        <section className="mt-6">
          <h3 className="mb-2 text-sm font-medium text-[#EAEAEA]">加载场景</h3>
          {item.loadedByScenarios.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {item.loadedByScenarios.map((scenario) => (
                <span
                  key={scenario.id}
                  className="rounded border border-[#00E0FF]/30 bg-[#00E0FF]/10 px-2.5 py-1 text-xs text-[#00E0FF]"
                >
                  {scenario.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#8888AA]">暂未被任何场景加载</p>
          )}
        </section>
      </aside>
    </div>
  );
}
