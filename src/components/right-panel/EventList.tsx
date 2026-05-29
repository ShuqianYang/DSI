'use client';

import { useMemo, useState, useEffect } from 'react';
import { ChevronRight, Check, MapPin, ChevronDown } from 'lucide-react';
import { TaskEvent, Task, GisData } from '@/types/prd';
import { formatFullTime, getEventStatusStyle } from '@/lib/styleMaps';
import { EventStatusIcon } from './StatusIcons';
import { groupEventsByTask, type EventGroup } from '@/lib/eventGrouping';

interface EventListProps {
  events: TaskEvent[];
  tasks: Task[];
  expandedEvents: Set<string>;
  toggleEvent: (id: string) => void;
  onEventGisClick?: (eventId: string, gisData: GisData) => void;
  activeEventIds?: Set<string>;
}

export default function EventList(props: EventListProps) {
  const { events, tasks } = props;
  const groups = useMemo(() => groupEventsByTask(events, tasks), [events, tasks]);

  // 默认按 task.status === 'running' 自动展开；用户 toggle 后状态保留
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const g of groups) {
      if (g.task?.status === 'running' || g.taskId === null) {
        initial.add(g.taskId ?? '_unattached');
      }
    }
    return initial;
  });

  // groups 变化时新出现的 running group 自动加入展开集合（不强制收起已展开的组）
  useEffect(() => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      for (const g of groups) {
        if (g.task?.status === 'running') {
          next.add(g.taskId ?? '_unattached');
        }
      }
      return next;
    });
  }, [groups]);

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <>
      {groups.map((group) => {
        const groupKey = group.taskId ?? '_unattached';
        const isOpen = expandedGroups.has(groupKey);
        return (
          <InfoPackCard
            key={groupKey}
            group={group}
            isOpen={isOpen}
            onToggle={() => toggleGroup(groupKey)}
            expandedEvents={props.expandedEvents}
            toggleEvent={props.toggleEvent}
            onEventGisClick={props.onEventGisClick}
            activeEventIds={props.activeEventIds}
          />
        );
      })}
      {groups.length === 0 && (
        <div className="text-center py-4 text-[#8888AA] text-xs">暂无事件</div>
      )}
    </>
  );
}

// ============================================================
// 信息包卡片：一个 jobTask 的所有 events 聚合到一张卡片下展示
// ============================================================
interface InfoPackCardProps {
  group: EventGroup;
  isOpen: boolean;
  onToggle: () => void;
  expandedEvents: Set<string>;
  toggleEvent: (id: string) => void;
  onEventGisClick?: (eventId: string, gisData: GisData) => void;
  activeEventIds?: Set<string>;
}

function InfoPackCard({
  group,
  isOpen,
  onToggle,
  expandedEvents,
  toggleEvent,
  onEventGisClick,
  activeEventIds,
}: InfoPackCardProps) {
  const { task, events, latestTimestamp } = group;
  const title =
    task?.name ||
    events[0]?.taskName ||
    (group.taskId ? `任务 ${group.taskId.slice(0, 8)}` : '未归属事件');
  const status = task?.status || (events.some((e) => e.status === 'failed') ? 'failed' : 'completed');
  const subTasks = task?.subTasks;
  const completedCount =
    subTasks?.filter((s) => s.status === 'completed').length ?? events.length;
  const totalCount = subTasks?.length ?? events.length;
  const unreadCount = events.filter((e) => !e.read).length;

  return (
    <div className={`rounded-lg border ${statusBorderClass(status)} bg-[#1E1E2E]/60 overflow-hidden`}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full p-3 flex items-start gap-2 hover:bg-[#2A2A3E]/50 transition-colors text-left"
      >
        <ChevronDown
          className={`w-4 h-4 mt-0.5 text-[#8888AA] transition-transform flex-shrink-0 ${isOpen ? '' : '-rotate-90'}`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm text-[#EAEAEA] font-medium truncate">{title}</div>
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 ${statusBadgeClass(status)}`}
            >
              {statusLabel(status)}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[11px] text-[#8888AA] flex-shrink-0">
              {completedCount}/{totalCount}
            </span>
            <span className="flex-1 h-1 bg-[#2A2A3E] rounded-full overflow-hidden">
              <span
                className={`block h-full ${progressBarColorClass(status)} transition-all`}
                style={{
                  width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%`,
                }}
              />
            </span>
            {unreadCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#FF4444]/20 text-[#FF4444] flex-shrink-0">
                {unreadCount} 未读
              </span>
            )}
          </div>
          <div className="text-[10px] font-mono text-[#8888AA] mt-1">{formatFullTime(latestTimestamp)}</div>
        </div>
      </button>
      {isOpen && (
        <div className="px-3 pb-3 pt-1 space-y-2">
          {events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              expandedEvents={expandedEvents}
              toggleEvent={toggleEvent}
              onEventGisClick={onEventGisClick}
              activeEventIds={activeEventIds}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function statusBorderClass(status: string): string {
  if (status === 'running') return 'border-[#00E0FF]/40';
  if (status === 'completed' || status === 'success') return 'border-[#44FF44]/30';
  if (status === 'partial') return 'border-[#FFAA00]/40';
  return 'border-[#FF4444]/40';
}

function statusBadgeClass(status: string): string {
  if (status === 'running') return 'bg-[#00E0FF]/20 text-[#00E0FF]';
  if (status === 'completed' || status === 'success') return 'bg-[#44FF44]/20 text-[#44FF44]';
  if (status === 'partial') return 'bg-[#FFAA00]/20 text-[#FFAA00]';
  return 'bg-[#FF4444]/20 text-[#FF4444]';
}

function statusLabel(status: string): string {
  if (status === 'running') return '进行中';
  if (status === 'completed' || status === 'success') return '已完成';
  if (status === 'partial') return '部分完成';
  if (status === 'failed') return '失败';
  return status;
}

function progressBarColorClass(status: string): string {
  if (status === 'running') return 'bg-[#00E0FF]';
  if (status === 'completed' || status === 'success') return 'bg-[#44FF44]';
  if (status === 'partial') return 'bg-[#FFAA00]';
  return 'bg-[#FF4444]';
}

// ============================================================
// 单条事件卡片：抽自原 EventList 内的 events.map 内容
// 信息包卡片头部已显示 taskName，子条移除重复的 taskName 行
// ============================================================
interface EventCardProps {
  event: TaskEvent;
  expandedEvents: Set<string>;
  toggleEvent: (id: string) => void;
  onEventGisClick?: (eventId: string, gisData: GisData) => void;
  activeEventIds?: Set<string>;
}

function EventCard({
  event,
  expandedEvents,
  toggleEvent,
  onEventGisClick,
  activeEventIds,
}: EventCardProps) {
  const isExpanded = expandedEvents.has(event.id);
  return (
    <div
      className={`p-2.5 rounded-lg border-l-3 ${getEventStatusStyle(event.status)} tech-border transition-all relative ${!event.read ? 'bg-[#00E0FF]/5' : ''}`}
    >
      <div
        className="flex items-start gap-2 cursor-pointer"
        onClick={() => toggleEvent(event.id)}
      >
        <EventStatusIcon status={event.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <div className="text-xs text-[#EAEAEA] font-medium truncate pr-2">
              {event.title}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {!event.read ? (
                <span className="flex items-center gap-1 text-[10px] text-[#8888AA] font-medium">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FF4444] opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#FF4444]" />
                  </span>
                  未读
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] text-[#8888AA] font-medium">
                  <Check className="w-2.5 h-2.5" />
                  已读
                </span>
              )}
              <ChevronRight
                className={`w-4 h-4 text-[#8888AA] transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              />
            </div>
          </div>
          <div className="text-[10px] font-mono text-[#8888AA] mt-1">{formatFullTime(event.timestamp)}</div>
        </div>
      </div>
      {isExpanded && (
        <div className="mt-2 pt-2 border-t border-[#3A3A4E]/50">
          <div className="text-xs text-[#8888AA]">{event.content}</div>
          {event.gisData && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEventGisClick?.(event.id, event.gisData!);
              }}
              className={`mt-2 flex items-center gap-1.5 text-[10px] px-2 py-1 rounded transition-colors ${
                activeEventIds?.has(event.id)
                  ? 'bg-[#FF44FF]/20 text-[#FF44FF] border border-[#FF44FF]/30'
                  : 'bg-[#00E0FF]/10 text-[#00E0FF] hover:bg-[#00E0FF]/20'
              }`}
            >
              <MapPin className="w-3 h-3" />
              <span>{activeEventIds?.has(event.id) ? '取消联动' : '地图联动'}</span>
              {event.gisData.entities && (
                <span className="text-[#8888AA]">
                  ({event.gisData.entities.length}实体
                  {event.gisData.trajectories ? ` / ${event.gisData.trajectories.length}轨迹` : ''})
                </span>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
