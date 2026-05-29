'use client';

import { Search, Filter } from 'lucide-react';

export type FilterType = 'all' | 'event' | 'insight';
export type TimeRange = 'all' | '1h' | '24h' | '7d';

export type SourceType = 'all' | 'instant' | 'subscription';

export interface FilterState {
  type: FilterType;
  status: string;
  source: SourceType;
  timeRange: TimeRange;
  search: string;
}

interface InfoFiltersProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
}

const SOURCE_OPTIONS = [
  { value: '', label: '全部来源' },
  { value: 'instant', label: '即时' },
  { value: 'subscription', label: '订阅' },
];

const STATUS_OPTIONS: Record<FilterType, { value: string; label: string }[]> = {
  all: [
    { value: '', label: '全部状态' },
    { value: 'success', label: '成功' },
    { value: 'partial', label: '部分成功' },
    { value: 'failed', label: '失败' },
    { value: 'high_risk', label: '高危' },
    { value: 'medium_risk', label: '中危' },
    { value: 'low_risk', label: '低危' },
    { value: 'safe', label: '安全' },
  ],
  event: [
    { value: '', label: '全部状态' },
    { value: 'success', label: '成功' },
    { value: 'partial', label: '部分成功' },
    { value: 'failed', label: '失败' },
  ],
  insight: [
    { value: '', label: '全部状态' },
    { value: 'high_risk', label: '高危' },
    { value: 'medium_risk', label: '中危' },
    { value: 'low_risk', label: '低危' },
    { value: 'safe', label: '安全' },
  ],
};

export default function InfoFilters({ filters, onChange }: InfoFiltersProps) {
  const update = (patch: Partial<FilterState>) => {
    onChange({ ...filters, ...patch });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 border-b border-[#3A3A4E] bg-[#1E1E2E]/50">
      <Filter className="w-4 h-4 text-[#8888AA] shrink-0" />

      {/* 类型 */}
      <select
        value={filters.type}
        onChange={(e) => update({ type: e.target.value as FilterType, status: '' })}
        className="px-3 py-1.5 rounded-lg bg-[#2A2A3E] border border-[#3A3A4E] text-sm text-[#EAEAEA] focus:outline-none focus:border-[#00E0FF] cursor-pointer"
      >
        <option value="all">全部类型</option>
        <option value="event">事件</option>
        <option value="insight">洞察</option>
      </select>

      {/* 状态 */}
      <select
        value={filters.status}
        onChange={(e) => update({ status: e.target.value })}
        className="px-3 py-1.5 rounded-lg bg-[#2A2A3E] border border-[#3A3A4E] text-sm text-[#EAEAEA] focus:outline-none focus:border-[#00E0FF] cursor-pointer"
      >
        {STATUS_OPTIONS[filters.type].map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>

      {/* 来源 */}
      <select
        value={filters.source}
        onChange={(e) => update({ source: e.target.value as SourceType })}
        className="px-3 py-1.5 rounded-lg bg-[#2A2A3E] border border-[#3A3A4E] text-sm text-[#EAEAEA] focus:outline-none focus:border-[#00E0FF] cursor-pointer"
      >
        {SOURCE_OPTIONS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>

      {/* 时间范围 */}
      <select
        value={filters.timeRange}
        onChange={(e) => update({ timeRange: e.target.value as TimeRange })}
        className="px-3 py-1.5 rounded-lg bg-[#2A2A3E] border border-[#3A3A4E] text-sm text-[#EAEAEA] focus:outline-none focus:border-[#00E0FF] cursor-pointer"
      >
        <option value="all">全部时间</option>
        <option value="1h">近1小时</option>
        <option value="24h">近24小时</option>
        <option value="7d">近7天</option>
      </select>

      {/* 搜索 */}
      <div className="relative flex-1 min-w-[160px] max-w-xs ml-auto">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8888AA]" />
        <input
          type="text"
          placeholder="搜索标题或内容..."
          value={filters.search}
          onChange={(e) => update({ search: e.target.value })}
          className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-[#2A2A3E] border border-[#3A3A4E] text-sm text-[#EAEAEA] placeholder:text-[#8888AA] focus:outline-none focus:border-[#00E0FF]"
        />
      </div>
    </div>
  );
}
