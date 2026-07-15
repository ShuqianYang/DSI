"use client";

import { useState } from "react";
import { CalendarDays, FileText, Square } from "lucide-react";
import type { ReportType } from "./types";
import { REPORT_TYPE_LABELS } from "./types";

function today() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }

export function DailyReportForm({ loading, onSubmit, onCancel }: { loading: boolean; onSubmit: (date: string, type: ReportType) => void; onCancel?: () => void }) {
  const [date, setDate] = useState(today);
  const [type, setType] = useState<ReportType>("all");
  return (
    <div className="p-3">
      <div className="mx-auto flex max-w-4xl flex-col gap-3 rounded-xl border border-[#31506A] bg-[#172B3A] p-3 sm:flex-row sm:items-end">
        <label className="flex-1 text-xs text-[#8FA8BB]">
          <span className="mb-1 flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />日报日期</span>
          <span className="relative block">
            <input
              aria-label="日报日期"
              type="date"
              value={date}
              max={today()}
              onInput={(event) => setDate(event.currentTarget.value)}
              onChange={(event) => setDate(event.target.value)}
              className="h-10 w-full rounded-md border border-[#31506A] bg-[#0D1B27] px-3 pr-10 text-sm text-[#EAEAEA] [color-scheme:dark] [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-y-0 [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-10 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0"
            />
            <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#C7D9E6]" />
          </span>
        </label>
        <div className="flex-[2]">
          <div className="mb-1 text-xs text-[#8FA8BB]">日报类型</div>
          <div className="grid grid-cols-3 gap-1">
            {(Object.keys(REPORT_TYPE_LABELS) as ReportType[]).map((item) => (
              <button type="button" key={item} aria-pressed={type === item} onClick={() => setType(item)} className={`h-10 rounded-md border px-2 text-xs ${type === item ? "border-[#00E0FF] bg-[#00E0FF]/15 text-[#00E0FF]" : "border-[#31506A] text-[#AFC1CF]"}`}>
                {REPORT_TYPE_LABELS[item]}
              </button>
            ))}
          </div>
        </div>
        <button type="button" disabled={loading || !date} onClick={() => onSubmit(date, type)} className="flex h-10 items-center justify-center gap-2 rounded-md bg-[#00AFC8] px-5 text-sm font-medium text-white disabled:opacity-50">
          <FileText className="h-4 w-4" />{loading ? "生成中…" : "生成日报"}
        </button>
        {loading && onCancel && (
          <button type="button" onClick={onCancel} title="停止生成" className="flex h-10 items-center justify-center gap-2 rounded-md border border-[#D94A4A]/50 bg-[#D94A4A]/15 px-4 text-sm font-medium text-[#FF8080] hover:bg-[#D94A4A]/25">
            <Square className="h-4 w-4" />停止
          </button>
        )}
      </div>
    </div>
  );
}
