"use client";

import { useEffect, useState } from "react";
import { History, RotateCcw, Send, Shield, Square } from "lucide-react";
import MarkdownContent from "@/components/chat/MarkdownContent";
import { useBorderDefenseChat } from "@/hooks/useBorderDefenseChat";
import { dailyReportDownloadUrl } from "@/lib/borderDefenseApi";
import { AgentRunTimeline } from "./AgentRunTimeline";
import { DailyReportForm } from "./DailyReportForm";
import { TaskSidebar } from "./TaskSidebar";
import type { BorderDefenseMode } from "./types";

export function BorderDefenseWorkspace({ mode, variant = "desktop", embedded = false }: { mode: BorderDefenseMode; variant?: "desktop" | "mobile"; embedded?: boolean }) {
  const chat = useBorderDefenseChat(mode);
  const [query, setQuery] = useState("");
  const [drawer, setDrawer] = useState(false);
  const mobile = variant === "mobile";
  const activeTask = chat.tasks.find((task) => task.id === chat.activeTaskId);
  const attentionCount = chat.tasks.filter(
    (task) => task.unread === true && (task.status === "completed" || task.status === "failed")
  ).length;
  const send = () => { const value = query.trim(); if (!value) return; chat.submit({ query: value }); setQuery(""); };

  useEffect(() => {
    if (!drawer) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setDrawer(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [drawer]);

  const sidebar = <TaskSidebar tasks={chat.tasks} activeId={chat.activeTaskId} onSelect={chat.openTask} onRemove={chat.remove} onNew={() => { chat.newTask(); setDrawer(false); }} mobile={mobile} onClose={() => setDrawer(false)} />;
  return <main className="flex h-[100dvh] w-full overflow-hidden bg-[#0B1620] text-[#EAEAEA]">
    {!mobile && sidebar}{mobile && drawer && <><button type="button" aria-label="关闭历史任务遮罩" className="fixed inset-0 z-40 bg-[#000A18]/65 backdrop-blur-[2px]" onClick={() => setDrawer(false)} />{sidebar}</>}
    <section className="flex min-w-0 flex-1 flex-col">
      <header className={`flex shrink-0 items-center justify-between border-b border-[#263849] bg-[#101D2A]/95 ${embedded ? "h-11 px-2.5" : "h-16 px-4 sm:px-6"}`}><div className="flex min-w-0 items-center gap-2.5">{mobile && <button type="button" aria-label="打开历史任务" aria-expanded={drawer} onClick={() => setDrawer(true)} className={`relative flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs ${attentionCount > 0 ? "border-[#00E0FF]/70 bg-[#00E0FF]/15 text-[#00E0FF]" : "border-[#31506A] bg-[#142839] text-[#BFD7E8] hover:border-[#00E0FF]/60 hover:text-[#00E0FF]"}`}><History className="h-3.5 w-3.5" /><span>{attentionCount > 0 ? `历史 · ${attentionCount} 未读` : "历史"}</span></button>}{!embedded && <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#00E0FF]/10"><Shield className="h-5 w-5 text-[#00E0FF]" /></span>}<div className="min-w-0"><h1 className="truncate text-sm font-semibold sm:text-base">{embedded ? (activeTask?.title || (mode === "qa" ? "边防问数" : "边防日报")) : (mode === "qa" ? "边防态势分析助手" : "边防日报生成")}</h1>{!embedded && <p className="text-[10px] text-[#71869A]">Agent Loop · 数据驱动决策</p>}</div></div><div className="flex shrink-0 items-center gap-1.5 text-[11px] text-[#8FA8BB]"><span className={`h-2 w-2 rounded-full ${chat.loading ? "animate-pulse bg-[#00E0FF]" : chat.messages.some((message) => message.outcome?.outcome === "failed") ? "bg-[#FF4444]" : "bg-[#44FF44]"}`} />{chat.loading ? "执行中" : "就绪"}</div></header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6"><div className="mx-auto max-w-4xl space-y-5">
        {chat.messages.length === 0 && <div className="flex min-h-[55vh] flex-col items-center justify-center text-center"><Shield className="mb-4 h-12 w-12 text-[#00E0FF]/60" /><h2 className="text-xl font-semibold">{mode === "qa" ? "边防数据智能问答" : "生成边防日报"}</h2><p className="mt-2 max-w-md text-sm leading-6 text-[#71869A]">{mode === "qa" ? "输入自然语言问题，智能体将调用边防数据工具并展示完整运行轨迹。" : "选择日期和日报类型，智能体将汇总数据、生成图表与可下载文档。"}</p></div>}
        {chat.messages.map((message) => <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}><div className={`${message.role === "user" ? "max-w-[85%] bg-[#087E91]/35" : "w-full bg-[#142635]"} rounded-xl border border-[#294255] p-3 sm:p-4`}>
          {message.role === "assistant" && ((message.steps?.length || 0) > 0 || message.outcome) && <AgentRunTimeline steps={message.steps || []} outcome={message.outcome} expanded={message.expanded ?? true} onToggle={() => chat.toggleExpanded(message.id)} />}
          {message.role === "assistant" ? <MarkdownContent content={message.content || (chat.loading ? "正在执行，请稍候…" : "暂无结果")} charts={message.charts} /> : <div className="whitespace-pre-wrap text-sm">{message.content}</div>}
          {message.role === "assistant" && message.taskId && !chat.loading && <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#294255] pt-3">
            <button type="button" onClick={() => chat.retry(message.taskId)} className="inline-flex items-center gap-1.5 rounded-md border border-[#4A6073] px-3 py-2 text-xs text-[#BFD7E8] hover:border-[#00E0FF]/60 hover:bg-[#00E0FF]/10 hover:text-[#00E0FF]" title={mode === "qa" ? "使用原问题重新回答" : "使用原日期和类型重新生成日报"}><RotateCcw className="h-3.5 w-3.5" />重新回答</button>
            {mode === "daily" && message.outcome?.outcome === "success" && <a href={dailyReportDownloadUrl(message.taskId)} className="inline-flex rounded-md border border-[#00E0FF]/50 px-3 py-2 text-xs text-[#00E0FF] hover:bg-[#00E0FF]/10">下载 DOCX</a>}
          </div>}
        </div></div>)}
        {chat.connectionError && <div className="rounded-md border border-[#FFAA00]/40 bg-[#FFAA00]/10 p-3 text-xs text-[#FFD080]">{chat.connectionError}</div>}
      </div></div>
      {mode === "daily" ? <DailyReportForm key={chat.activeTaskId ?? "new-task"} loading={chat.loading} onSubmit={(date, reportType) => chat.submit({ date, reportType })} /> : <div className="p-3"><div className="mx-auto flex max-w-4xl items-end gap-2 rounded-xl border border-[#31506A] bg-[#172B3A] p-2"><textarea value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder="请输入边防数据问题…" rows={2} className="max-h-36 min-h-12 flex-1 resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-[#617A8D]" />{chat.loading ? <button onClick={chat.closeStream} title="停止接收" className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#A94141]"><Square className="h-4 w-4" /></button> : <button onClick={send} disabled={!query.trim()} className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#00AFC8] disabled:opacity-40"><Send className="h-4 w-4" /></button>}</div></div>}
    </section>
  </main>;
}
