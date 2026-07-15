"use client";

import { MessageSquarePlus, Trash2, X } from "lucide-react";
import type { BorderTaskItem } from "./types";

function dateKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateLabel(timestamp: number): string {
  const target = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dateKey(target.getTime()) === dateKey(today.getTime())) return "今天";
  if (dateKey(target.getTime()) === dateKey(yesterday.getTime())) return "昨天";
  return `${target.getFullYear()}年${String(target.getMonth() + 1).padStart(2, "0")}月${String(target.getDate()).padStart(2, "0")}日`;
}

function groupTasks(tasks: BorderTaskItem[]) {
  const sorted = [...tasks].sort((left, right) => right.createdAt - left.createdAt);
  return sorted.reduce<Array<{ key: string; label: string; tasks: BorderTaskItem[] }>>((groups, task) => {
    const key = dateKey(task.createdAt);
    const current = groups[groups.length - 1];
    if (current?.key === key) current.tasks.push(task);
    else groups.push({ key, label: dateLabel(task.createdAt), tasks: [task] });
    return groups;
  }, []);
}

export function TaskSidebar({ tasks, activeId, onSelect, onRemove, onNew, mobile, onClose }: { tasks: BorderTaskItem[]; activeId?: string; onSelect: (task: BorderTaskItem) => void; onRemove: (id: string) => void; onNew: () => void; mobile?: boolean; onClose?: () => void }) {
  const groups = groupTasks(tasks);
  return <aside aria-label="历史任务" className={`${mobile ? "fixed inset-y-0 left-0 z-50 w-[82vw] max-w-[320px] shadow-2xl" : "relative w-[280px]"} flex h-full shrink-0 flex-col border-r border-[#263849] bg-[#101D2A]`}>
    <div className="flex items-center justify-between border-b border-[#263849] p-4"><div><div className="text-sm font-semibold text-[#EAEAEA]">历史任务</div><div className="mt-0.5 text-[11px] text-[#71869A]">按创建时间排列</div></div>{mobile && <button type="button" aria-label="关闭历史任务" onClick={onClose} className="rounded-md border border-[#31506A] p-1.5 text-[#AFC1CF] hover:text-white"><X className="h-4 w-4" /></button>}</div>
    <button onClick={onNew} className="m-3 flex items-center justify-center gap-2 rounded-md border border-[#00E0FF]/40 bg-[#00E0FF]/10 px-3 py-2 text-sm text-[#00E0FF]"><MessageSquarePlus className="h-4 w-4" />新建任务</button>
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">{tasks.length === 0 && <div className="p-6 text-center text-xs text-[#71869A]">暂无历史任务</div>}{groups.map((group) => <section key={group.key} className="mb-3"><div className="sticky top-0 z-10 bg-[#101D2A]/95 px-2 py-1.5 text-[11px] font-medium text-[#6F8CA2] backdrop-blur">{group.label}</div><div className="space-y-1">{group.tasks.map((task) => {
            const isUnread = task.unread === true && (task.status === "completed" || task.status === "failed");
            return <button key={task.id} onClick={() => { onSelect(task); onClose?.(); }} className={`group relative flex w-full items-start gap-2 rounded-md p-2.5 text-left ${activeId === task.id ? "bg-[#083D52]" : isUnread ? "bg-[#1A2F3F] hover:bg-[#1E3547]" : "hover:bg-[#172A3A]"}`}>
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${task.status === "failed" ? "bg-[#FF4444]" : task.status === "completed" ? "bg-[#44FF44]" : "animate-pulse bg-[#00E0FF]"}`} />
              <span className="min-w-0 flex-1 pr-4">
                <span className={`line-clamp-2 text-xs leading-4 ${isUnread ? "font-medium text-white" : "text-[#EAEAEA]"}`}>{task.title}</span>
                <span className="mt-1 block text-[10px] text-[#71869A]">创建 {new Date(task.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })} · #{task.id.slice(0, 8)} · {task.status === "failed" ? "失败" : task.status === "completed" ? "已完成" : "执行中"}</span>
                {task.completedAt && <span className="mt-0.5 block text-[10px] text-[#60788B]">完成 {new Date(task.completedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}</span>}
              </span>
              <span onClick={(event) => { event.stopPropagation(); onRemove(task.id); }} className="hidden p-1 text-[#71869A] hover:text-[#FF6666] group-hover:block"><Trash2 className="h-3.5 w-3.5" /></span>
            </button>;
          })}</div></section>)}</div>
    <div className="border-t border-[#263849] px-4 py-3 text-center text-[10px] text-[#60788B]">历史仅保存在当前浏览器</div>
  </aside>;
}
