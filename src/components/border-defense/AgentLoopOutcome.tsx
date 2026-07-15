"use client";

import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import type { LoopOutcome } from "./types";

export function AgentLoopOutcome({ value }: { value: LoopOutcome }) {
  const failed = value.outcome === "failed";
  const warning = value.outcome === "warning";
  const Icon = failed ? XCircle : warning ? AlertTriangle : CheckCircle2;
  const title = failed ? "执行失败" : warning ? "已结束，未完全完成" : "执行成功";
  const color = failed ? "border-[#FF4444]/40 bg-[#FF4444]/10 text-[#FF8888]" : warning ? "border-[#FFAA00]/40 bg-[#FFAA00]/10 text-[#FFD080]" : "border-[#44FF44]/40 bg-[#44FF44]/10 text-[#8AFF8A]";
  return (
    <div className={`rounded-md border p-3 ${color}`}>
      <div className="flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4" />{title}</div>
      <p className="mt-1 text-xs leading-5 text-[#D8D8E8]">{value.reason}</p>
      <details className="mt-2 text-[11px] text-[#8888AA]">
        <summary className="cursor-pointer">技术详情</summary>
        <div className="mt-1 font-mono">stoppedBy={value.stoppedBy} · turns={value.turns} · failedTools={value.failedToolCount}</div>
        {value.logFilePath && <div className="mt-1 break-all font-mono">{value.logFilePath}</div>}
      </details>
    </div>
  );
}
