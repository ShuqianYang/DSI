'use client';

import { Search, Filter } from 'lucide-react';

export type TimeRange = 'all' | '1h' | '24h' | '7d';

export interface FilterState {
  status: string;
  timeRange: TimeRange;
  search: string;
}

interface InfoFiltersProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
}

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'completed', label: '成功' },
  { value: 'failed', label: '失败' },
];

export default function InfoFilters({ filters, onChange }: InfoFiltersProps) {
  const update = (patch: Partial<FilterState>) => {
    onChange({ ...filters, ...patch });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 border-b border-[#3A3A4E] bg-[#1E1E2E]/50">
      <Filter className="w-4 h-4 text-[#8888AA] shrink-0" />

      <select
        value={filters.status}
        onChange={(e) => update({ status: e.target.value })}
        className="px-3 py-1.5 rounded-lg bg-[#2A2A3E] border border-[#3A3A4E] text-sm text-[#EAEAEA] focus:outline-none focus:border-[#00E0FF] cursor-pointer"
      >
        {STATUS_OPTIONS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>

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

      <div className="relative flex-1 min-w-[160px] max-w-xs ml-auto">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8888AA]" />
        <input
          type="text"
          placeholder="搜索问题或结果..."
          value={filters.search}
          onChange={(e) => update({ search: e.target.value })}
          className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-[#2A2A3E] border border-[#3A3A4E] text-sm text-[#EAEAEA] placeholder:text-[#8888AA] focus:outline-none focus:border-[#00E0FF]"
        />
      </div>
    </div>
  );
}
