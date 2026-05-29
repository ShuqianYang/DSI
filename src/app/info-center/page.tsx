'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, MessageSquare, RefreshCw, Download } from 'lucide-react';
import { getInfoCenterItems, exportInfoCenter, type InfoItem, type InfoCenterResult } from '@/lib/api';
import InfoFilters, { type FilterState, type TimeRange, type SourceType } from '@/components/info-center/InfoFilters';
import InfoTable from '@/components/info-center/InfoTable';
import InfoPagination from '@/components/info-center/InfoPagination';
import InfoDetail from '@/components/info-center/InfoDetail';
import { useInfoCenterStream } from '@/components/info-center/useInfoCenterStream';

function getTimeRangeBounds(range: TimeRange): { startTime?: string; endTime?: string } {
  const now = new Date();
  const endTime = now.toISOString();
  if (range === 'all') return {};
  const map: Record<string, number> = { '1h': 1, '24h': 24, '7d': 24 * 7 };
  const hours = map[range] || 0;
  const start = new Date(now.getTime() - hours * 60 * 60 * 1000);
  return { startTime: start.toISOString(), endTime };
}

export default function InfoCenterPage() {
  const router = useRouter();

  const [filters, setFilters] = useState<FilterState>({
    type: 'all',
    status: '',
    source: 'all',
    timeRange: 'all',
    search: '',
  });

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<InfoCenterResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<InfoItem | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const timeBounds = getTimeRangeBounds(filters.timeRange);
      const typeMap: Record<string, string> = {
        all: 'event,insight',
        event: 'event',
        insight: 'insight',
      };
      const res = await getInfoCenterItems({
        page,
        pageSize,
        type: typeMap[filters.type],
        status: filters.status || undefined,
        source: filters.source === 'all' ? undefined : filters.source,
        search: filters.search || undefined,
        ...timeBounds,
      });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filters]);

  useEffect(() => {
    load();
  }, [load]);

  // 实时推送：SSE + 轮询兜底
  useInfoCenterStream({ refresh: load });

  // 筛选变化时重置到第一页
  useEffect(() => {
    setPage(1);
  }, [filters]);

  const handleViewDetail = (item: InfoItem) => {
    setSelectedItem(item);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const timeBounds = getTimeRangeBounds(filters.timeRange);
      const typeMap: Record<string, string> = {
        all: 'event,insight',
        event: 'event',
        insight: 'insight',
      };
      const blob = await exportInfoCenter({
        type: typeMap[filters.type],
        status: filters.status || undefined,
        source: filters.source === 'all' ? undefined : filters.source,
        search: filters.search || undefined,
        ...timeBounds,
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `info-center-export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#121212] text-[#EAEAEA] flex flex-col">
      {/* Header */}
      <header className="h-14 border-b border-[#3A3A4E] flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-2 rounded-lg hover:bg-[#2A2A3E] transition-colors text-[#8888AA] hover:text-[#EAEAEA]"
            title="返回"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <MessageSquare className="w-5 h-5 text-[#00E0FF]" />
          <h1 className="font-medium text-[#EAEAEA]">信息中心</h1>
          {data && (
            <span className="text-xs text-[#8888AA] bg-[#1E1E2E] px-2 py-0.5 rounded-full border border-[#3A3A4E]">
              共 {data.total} 条
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2A2A3E] border border-[#3A3A4E] text-xs text-[#8888AA] hover:text-[#EAEAEA] hover:bg-[#3A3A4E] transition-colors disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            {exporting ? '导出中...' : '导出'}
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2A2A3E] border border-[#3A3A4E] text-xs text-[#8888AA] hover:text-[#EAEAEA] hover:bg-[#3A3A4E] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </header>

      {/* 筛选栏 */}
      <InfoFilters filters={filters} onChange={setFilters} />

      {/* 表格区 */}
      <div className="flex-1 overflow-auto">
        {error ? (
          <div className="flex flex-col items-center justify-center h-48 text-[#FF4444]">
            <div className="text-sm">加载失败: {error}</div>
            <button
              onClick={load}
              className="mt-3 px-4 py-1.5 rounded-lg bg-[#2A2A3E] border border-[#3A3A4E] text-xs text-[#EAEAEA] hover:bg-[#3A3A4E]"
            >
              重试
            </button>
          </div>
        ) : (
          <InfoTable
            items={data?.items || []}
            loading={loading}
            onViewDetail={handleViewDetail}
          />
        )}
      </div>

      {/* 分页 */}
      {data && data.total > 0 && (
        <InfoPagination
          page={page}
          pageSize={pageSize}
          total={data.total}
          onChange={(p, ps) => {
            setPage(p);
            setPageSize(ps);
          }}
        />
      )}

      {/* 详情 Drawer */}
      <InfoDetail item={selectedItem} onClose={() => setSelectedItem(null)} />
    </div>
  );
}
