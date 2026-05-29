'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

interface InfoPaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number, pageSize: number) => void;
}

export default function InfoPagination({ page, pageSize, total, onChange }: InfoPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  const go = (p: number) => {
    if (p < 1 || p > totalPages) return;
    onChange(p, pageSize);
  };

  // 生成页码按钮
  const pages: (number | string)[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push('...');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pages.push(i);
    }
    if (page < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-[#3A3A4E]">
      <div className="text-xs text-[#8888AA]">
        共 <span className="text-[#EAEAEA]">{total}</span> 条，显示 {total > 0 ? start : 0}-{end}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => go(page - 1)}
          disabled={page <= 1}
          className="p-1.5 rounded-md hover:bg-[#2A2A3E] disabled:opacity-30 disabled:cursor-not-allowed text-[#8888AA] hover:text-[#EAEAEA] transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`dot-${i}`} className="px-2 text-xs text-[#8888AA]">...</span>
          ) : (
            <button
              key={p}
              onClick={() => go(p as number)}
              className={`min-w-[28px] h-7 px-1.5 rounded-md text-xs font-medium transition-colors ${
                page === p
                  ? 'bg-[#00E0FF]/15 text-[#00E0FF] border border-[#00E0FF]/30'
                  : 'text-[#8888AA] hover:bg-[#2A2A3E] hover:text-[#EAEAEA]'
              }`}
            >
              {p}
            </button>
          )
        )}

        <button
          onClick={() => go(page + 1)}
          disabled={page >= totalPages}
          className="p-1.5 rounded-md hover:bg-[#2A2A3E] disabled:opacity-30 disabled:cursor-not-allowed text-[#8888AA] hover:text-[#EAEAEA] transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <select
        value={pageSize}
        onChange={(e) => onChange(1, Number(e.target.value))}
        className="px-2 py-1 rounded-md bg-[#2A2A3E] border border-[#3A3A4E] text-xs text-[#EAEAEA] focus:outline-none cursor-pointer"
      >
        <option value={10}>10条/页</option>
        <option value={20}>20条/页</option>
        <option value={50}>50条/页</option>
      </select>
    </div>
  );
}
