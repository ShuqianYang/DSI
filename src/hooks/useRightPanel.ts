'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Subscription,
  Insight,
  TaskEvent,
  Task,
  SubTask,
  GisData,
} from '@/types/prd';
import { useRightPanelData } from '@/hooks/useRightPanelData';
import { eventSourceUrl } from '@/lib/api';
import type { ApiRequirement } from '@/lib/api';
import { buildAgentLoopTaskView } from '@/lib/agentLoopTaskView';
import {
  createTaskStreamModeTracker,
  getTaskFinishFromStreamEvent,
  isNativeAgentLoopProgressEvent,
} from '@/lib/taskStreamLifecycle';
import { routeTaskStreamEvent } from '@/lib/taskStreamRouter';

export interface UseRightPanelOptions {
  propTasks?: Task[];
  propEvents?: TaskEvent[];
  onEventRead?: (eventId: string) => void;
}

export interface UseRightPanelReturn {
  tasks: Task[];
  events: TaskEvent[];
  subscriptions: Subscription[];
  insights: Insight[];
  requirements: ApiRequirement[];
  refresh: () => void;
  markEventRead: (id: string) => void;
  toggleSubStatus: (id: string) => void;
  expandedTasks: Set<string>;
  expandedEvents: Set<string>;
  expandedInsight: string | null;
  toggleTask: (id: string) => void;
  toggleEvent: (id: string) => void;
  toggleSubscription: (id: string) => void;
  setExpandedInsight: (id: string | null) => void;
}

export function useRightPanel({
  propTasks = [],
  propEvents = [],
  onEventRead,
}: UseRightPanelOptions): UseRightPanelReturn {
  const {
    tasks: apiTasks,
    events: apiEvents,
    subscriptions: apiSubs,
    insights: apiInsights,
    requirements: apiReqs,
    refresh,
    markEventRead,
    toggleSubStatus,
    toTimestamp,
  } = useRightPanelData();
  const taskStreamModeTrackerRef = useRef(createTaskStreamModeTracker());

  // SSE：监听任务完成事件，自动刷新
  useEffect(() => {
    const handleTaskCreated = (e: Event) => {
      const taskId = (e as CustomEvent).detail as string;
      refresh();
      taskStreamModeTrackerRef.current.preferNative(taskId);

      const evtSource = new EventSource(eventSourceUrl(`/tasks/${taskId}/stream`));
      console.log('[useRightPanel] SSE connected for task', taskId);
      evtSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[useRightPanel] SSE msg:', data);
          const routed = routeTaskStreamEvent({
            taskId,
            event: data,
            tracker: taskStreamModeTrackerRef.current,
          });

          if (routed.kind === 'agent-loop') {
            if (isNativeAgentLoopProgressEvent(routed.event)) {
              console.log('[useRightPanel] Native Agent Loop progress, refreshing...');
              refresh();
              return;
            }

            const finish = getTaskFinishFromStreamEvent(routed.event);
            if (finish) {
              console.log('[useRightPanel] Native Agent Loop task finished, refreshing...');
              refresh();
              evtSource.close();
              taskStreamModeTrackerRef.current.clear(taskId);
              return;
            }
          }

          if (routed.kind === 'ignored-legacy') {
            return;
          }

          if (data.type === 'subscription_completed' || data.type === 'subscription_failed') {
            console.log('[useRightPanel] Subscription update, refreshing...');
            refresh();
            return;
          }
        } catch (err) {
          console.warn('[useRightPanel] SSE parse error:', err);
        }
      };
      evtSource.onerror = () => {
        evtSource.close();
        taskStreamModeTrackerRef.current.clear(taskId);
      };
    };

    window.addEventListener('agent:task-created', handleTaskCreated);
    return () => window.removeEventListener('agent:task-created', handleTaskCreated);
  }, [refresh]);

  // 合并 props 任务和 API 任务（API 优先覆盖同 ID）
  const mergedTasks: Task[] = [...propTasks];
  for (const t of apiTasks) {
    const existingIndex = mergedTasks.findIndex((mt) => mt.id === t.id);
    const taskData: Task = {
      id: t.id,
      name: t.name,
      type: t.type as Task['type'],
      executeTime: toTimestamp(t.executeTime),
      status: t.status as Task['status'],
      dataCount: t.dataCount,
      agentLoop: buildAgentLoopTaskView(t.result) ?? undefined,
      subTasks: t.subTasks?.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        status: s.status as SubTask['status'],
        order: s.order,
      })),
    };
    if (existingIndex >= 0) {
      mergedTasks[existingIndex] = taskData;
    } else {
      mergedTasks.push(taskData);
    }
  }

  // 合并 props 事件和 API 事件
  const mergedEvents: TaskEvent[] = [...propEvents];
  for (const e of apiEvents) {
    if (!mergedEvents.some((me) => me.id === e.id)) {
      mergedEvents.push({
        id: e.id,
        taskId: e.taskId,
        taskName: e.taskName,
        title: e.title,
        content: e.content,
        status: e.status as TaskEvent['status'],
        timestamp: toTimestamp(e.timestamp),
        read: e.read,
        gisData: e.gisData as GisData | undefined,
      });
    }
  }

  // 订阅映射
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  useEffect(() => {
    if (apiSubs.length > 0) {
      setSubscriptions(
        apiSubs.map((s) => ({
          id: s.id,
          name: s.name,
          type: s.type,
          schedule: s.schedule,
          nextExecuteTime: s.nextExecuteTime
            ? new Date(s.nextExecuteTime).getTime()
            : Date.now(),
          status: s.status as Subscription['status'],
          entityId: s.entityId,
          regionId: s.regionId,
        }))
      );
    }
  }, [apiSubs]);

  // 洞察映射
  const [insights, setInsights] = useState<Insight[]>([]);
  useEffect(() => {
    if (apiInsights.length > 0) {
      setInsights(
        apiInsights.map((i) => ({
          id: i.id,
          category: i.category as Insight['category'],
          title: i.title,
          summary: i.summary,
          content: i.content,
          riskLevel: i.riskLevel as Insight['riskLevel'],
          timestamp: toTimestamp(i.createdAt || null),
          entityId: i.entityId,
          regionId: i.regionId,
          sources: i.sources,
        }))
      );
    }
  }, [apiInsights]);

  // 需求同步
  const [requirements, setRequirements] = useState(apiReqs);
  useEffect(() => {
    setRequirements(apiReqs);
  }, [apiReqs]);

  // 展开状态
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const [expandedInsight, setExpandedInsight] = useState<string | null>(null);

  const toggleTask = (id: string) => {
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 自动展开新出现且带有子任务的任务（每个任务只自动展开一次）
  const autoExpandedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    setExpandedTasks((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const task of mergedTasks) {
        if (task.subTasks && task.subTasks.length > 0 && !autoExpandedRef.current.has(task.id)) {
          next.add(task.id);
          autoExpandedRef.current.add(task.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [mergedTasks]);

  const toggleEvent = (id: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    markEventRead(id);
    onEventRead?.(id);
  };

  const toggleSubscription = (id: string) => {
    toggleSubStatus(id);
    setSubscriptions((prev) =>
      prev.map((s) =>
        s.id === id
          ? { ...s, status: s.status === 'running' ? 'paused' : 'running' }
          : s
      )
    );
  };

  return {
    tasks: mergedTasks,
    events: mergedEvents,
    subscriptions,
    insights,
    requirements,
    refresh,
    markEventRead,
    toggleSubStatus,
    expandedTasks,
    expandedEvents,
    expandedInsight,
    toggleTask,
    toggleEvent,
    toggleSubscription,
    setExpandedInsight,
  };
}
