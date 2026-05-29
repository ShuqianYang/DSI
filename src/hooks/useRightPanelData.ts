"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getTasks,
  getEvents,
  getSubscriptions,
  getInsights,
  getRequirements,
  updateEventRead,
  updateSubscriptionStatus,
  type ApiTask,
  type ApiEvent,
  type ApiSubscription,
  type ApiInsight,
  type ApiRequirement,
} from "@/lib/api";

// 把 API 的 ISO 时间字符串转为前端用的毫秒时间戳
function toTimestamp(iso: string | null): number {
  return iso ? new Date(iso).getTime() : Date.now();
}

export function useRightPanelData() {
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [subscriptions, setSubscriptions] = useState<ApiSubscription[]>([]);
  const [insights, setInsights] = useState<ApiInsight[]>([]);
  const [requirements, setRequirements] = useState<ApiRequirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.allSettled([
        getTasks(),
        getEvents(),
        getSubscriptions(),
        getInsights(),
        getRequirements(),
      ]);

      const [tasksRes, eventsRes, subsRes, insightsRes, reqsRes] = results;

      if (tasksRes.status === "fulfilled") {
        const tasks = tasksRes.value.tasks || [];
        console.log('[useRightPanelData] refresh got', tasks.length, 'tasks');
        for (const t of tasks) {
          console.log('[useRightPanelData]   task', t.id, 'agentTaskId=', (t as { agentTaskId?: string }).agentTaskId, t.status, 'subTasks=', t.subTasks?.map((s: any) => `${s.name}:${s.status}`).join(', ') || 'none');
        }
        setTasks(tasks);
      } else {
        console.error("[useRightPanelData] tasks load failed:", tasksRes.reason);
      }

      if (eventsRes.status === "fulfilled") {
        setEvents(eventsRes.value.events || []);
      } else {
        console.error("[useRightPanelData] events load failed:", eventsRes.reason);
      }

      if (subsRes.status === "fulfilled") {
        setSubscriptions(subsRes.value.subscriptions || []);
      } else {
        console.error("[useRightPanelData] subscriptions load failed:", subsRes.reason);
      }

      if (insightsRes.status === "fulfilled") {
        setInsights(insightsRes.value.insights || []);
      } else {
        console.error("[useRightPanelData] insights load failed:", insightsRes.reason);
      }

      if (reqsRes.status === "fulfilled") {
        setRequirements(reqsRes.value.requirements || []);
      } else {
        console.error("[useRightPanelData] requirements load failed:", reqsRes.reason);
      }

      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length > 0) {
        setError(`${failed.length} 个接口加载失败`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
      console.error("[useRightPanelData] load error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
    // 周期轮询：让进度窗能从 placeholder 自动 swap 到真实 jobTask，并随 subtask 状态推进实时刷新
    // 详见 api/plan/auto-toggle-chat-and-task-panel.md Risk #4
    const interval = setInterval(() => {
      console.log('[useRightPanelData] polling tick (10s)');
      loadAll();
    }, 10000);
    return () => clearInterval(interval);
  }, [loadAll]);

  const markEventRead = useCallback(async (id: string) => {
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, read: true } : e)));
    try {
      await updateEventRead(id, true);
    } catch {
      // 回滚
      setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, read: false } : e)));
    }
  }, []);

  const toggleSubStatus = useCallback(async (id: string) => {
    const sub = subscriptions.find((s) => s.id === id);
    if (!sub) return;
    const next = sub.status === "running" ? "paused" : "running";
    setSubscriptions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: next } : s))
    );
    try {
      await updateSubscriptionStatus(id, next);
    } catch {
      setSubscriptions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: sub.status } : s))
      );
    }
  }, [subscriptions]);

  return {
    tasks,
    events,
    subscriptions,
    insights,
    requirements,
    loading,
    error,
    refresh: loadAll,
    markEventRead,
    toggleSubStatus,
    toTimestamp,
  };
}
