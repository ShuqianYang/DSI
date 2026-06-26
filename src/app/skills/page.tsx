'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, RefreshCw, Sparkles } from 'lucide-react';
import { SCENARIOS } from '@datasourceintelligence/shared';
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
      const matchesSearch = matchesSkillSearch(item, keyword);
      return matchesCategory && matchesSearch;
    });
  }, [items, search, category]);

  const myViewSections = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return SCENARIOS.map((scenario) => {
      const scenarioSkills = items.filter(
        (item) =>
          scenario.skillIds.includes(item.name) &&
          (keyword.length === 0 || matchesSkillSearch(item, keyword)),
      );
      return { scenario, scenarioSkills };
    });
  }, [items, search]);

  const renderSkillGrid = (skillItems: SkillCatalogItem[]) => (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {skillItems.map((item) => (
        <SkillCard key={item.id} item={item} onSelect={setSelectedItem} />
      ))}
    </div>
  );

  const renderMyView = () => (
    <div className="space-y-8">
      {myViewSections.map(({ scenario, scenarioSkills }) => (
        <section key={scenario.id}>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-base font-medium text-[#EAEAEA]">{scenario.name}</h2>
              <p className="mt-0.5 text-xs text-[#8888AA]">{scenario.description}</p>
            </div>
            <span className="rounded-full border border-[#3A3A4E] bg-[#1E1E2E] px-2 py-0.5 text-xs text-[#8888AA]">
              {scenarioSkills.length} 个 Skill
            </span>
          </div>
          {scenarioSkills.length > 0 ? (
            renderSkillGrid(scenarioSkills)
          ) : (
            <div className="rounded-lg border border-[#3A3A4E] bg-[#1E1E2E] p-4 text-sm text-[#8888AA]">
              该场景尚未加载任何 Skill
            </div>
          )}
        </section>
      ))}
      <div className="rounded-lg border border-dashed border-[#3A3A4E] bg-[#1E1E2E] p-4 text-center text-sm text-[#8888AA]">
        未来可以为更多场景扩展 Skill，打造属于你自己的能力组合。
      </div>
    </div>
  );

  const renderMainGrid = () => {
    if (error) {
      return (
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
      );
    }
    if (loading && items.length === 0) {
      return <div className="flex h-48 items-center justify-center text-sm text-[#8888AA]">正在加载 Skill...</div>;
    }
    if (filteredItems.length === 0) {
      return <div className="flex h-48 items-center justify-center text-sm text-[#8888AA]">没有匹配的 Skill</div>;
    }
    return renderSkillGrid(filteredItems);
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#121212] text-[#EAEAEA]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#3A3A4E] px-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => router.push('/')}
            className="rounded-lg p-2 text-[#8888AA] transition-colors hover:bg-[#2A2A3E] hover:text-[#EAEAEA]"
            title="返回"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <Sparkles className="h-5 w-5 shrink-0 text-[#00E0FF]" />
          <h1 className="shrink-0 font-medium text-[#EAEAEA]">Skill 广场</h1>
          <span className="rounded-full border border-[#3A3A4E] bg-[#1E1E2E] px-2 py-0.5 text-xs text-[#8888AA]">
            共 {items.length} 个
          </span>
          <button
            type="button"
            onClick={() => setCategory('my')}
            className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
              category === 'my'
                ? 'border-[#00E0FF] bg-[#00E0FF] text-[#121212]'
                : 'border-[#3A3A4E] bg-[#1E1E2E] text-[#B8B8D0] hover:border-[#00E0FF]/70 hover:text-[#EAEAEA]'
            }`}
          >
            我的
          </button>
        </div>

        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[#3A3A4E] bg-[#2A2A3E] px-3 py-1.5 text-xs text-[#8888AA] transition-colors hover:bg-[#3A3A4E] hover:text-[#EAEAEA] disabled:opacity-50"
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
        {category === 'my' ? renderMyView() : renderMainGrid()}
      </main>

      <SkillDetailDrawer item={selectedItem} onClose={() => setSelectedItem(null)} />
    </div>
  );
}

function matchesSkillSearch(item: SkillCatalogItem, keyword: string): boolean {
  if (keyword.length === 0) return true;
  return (
    item.name.toLowerCase().includes(keyword) ||
    item.title.toLowerCase().includes(keyword) ||
    item.description.toLowerCase().includes(keyword) ||
    item.allowedTools.some((tool) => tool.toLowerCase().includes(keyword))
  );
}
