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
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
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
