"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentLoopEvent } from "@datasourceintelligence/shared";
import { REPORT_TYPE_LABELS, type BorderDefenseMode, type BorderMessage, type BorderTaskItem, type ReportType } from "@/components/border-defense/types";
import { createDailyReportTask, createQaTask, createTaskEventSource, getBorderTask } from "@/lib/borderDefenseApi";
import { chartsFromResult, consumeAgentEvent, mergeSteps, outcomeFromTaskResult, reportContentFromTaskResult, stepsFromTaskResult } from "@/lib/borderDefenseRun";
import { parseTaskStreamEvent } from "@/lib/agentLoopEvents";
import { useTaskHistory } from "@/hooks/useTaskHistory";

function assistantMessage(taskId: string): BorderMessage {
  return { id: `assistant-${taskId}`, role: "assistant", content: "", timestamp: Date.now(), taskId, steps: [], charts: [], expanded: true };
}

function runningAssistantMessage(taskId: string): BorderMessage {
  return {
    ...assistantMessage(taskId),
    steps: [{
      id: `agent-loop-start-${taskId}`,
      name: "Agent Loop",
      status: "running",
      detail: "任务已创建，正在连接实时执行流",
      category: "agent",
    }],
  };
}

export function useBorderDefenseChat(mode: BorderDefenseMode) {
  const history = useTaskHistory(mode);
  const [messages, setMessages] = useState<BorderMessage[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [connectionError, setConnectionError] = useState<string>();
  const sourceRef = useRef<EventSource | undefined>(undefined);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const activeTaskRef = useRef<string | undefined>(undefined);
  const submittingRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = undefined;
  }, []);

  const closeStream = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = undefined;
    stopPolling();
    submittingRef.current = false;
    setLoading(false);
  }, [stopPolling]);

  useEffect(() => closeStream, [closeStream]);

  const updateHistoryStatus = history.updateStatus;
  const reconcileHistory = history.reconcile;
  const markHistoryViewed = history.markViewed;

  useEffect(() => {
    let disposed = false;
    let syncing = false;

    const syncBackgroundTasks = async () => {
      if (syncing) return;
      syncing = true;
      try {
        const backgroundTasks = history.tasks.filter(
          (task) =>
            task.id !== activeTaskRef.current &&
            (task.status === "pending" || task.status === "running")
        );
        await Promise.all(backgroundTasks.map(async (task) => {
          try {
            const detail = await getBorderTask(task.id);
            if (disposed || activeTaskRef.current === task.id) return;
            if (detail.status !== "completed" && detail.status !== "failed") return;
            reconcileHistory(task.id, {
              status: detail.status,
              createdAt: new Date(detail.createdAt).getTime(),
              updatedAt: new Date(detail.updatedAt).getTime(),
              ...(detail.completedAt ? { completedAt: new Date(detail.completedAt).getTime() } : {}),
              unread: true,
            });
          } catch {
            // Background status synchronization is best-effort.
          }
        }));
      } finally {
        syncing = false;
      }
    };

    void syncBackgroundTasks();
    const timer = window.setInterval(() => void syncBackgroundTasks(), 5_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [history.tasks, reconcileHistory]);

  const refreshTask = useCallback(async (taskId: string) => {
    const detail = await getBorderTask(taskId);
    if (activeTaskRef.current !== taskId) return detail.status;

    const result = detail.result || {};
    const reportContent = reportContentFromTaskResult(detail.result);
    const fallbackContent = typeof result.message === "string" ? result.message : detail.error || "";
    const charts = chartsFromResult(detail.result);
    const outcome = outcomeFromTaskResult(detail.result);
    const replayedSteps = stepsFromTaskResult(detail.result);
    const completedStepStatus = detail.status === "failed"
      ? "failed"
      : detail.status === "completed"
        ? "completed"
        : undefined;
    setMessages((current) => current.map((item) => item.id === `assistant-${taskId}` ? {
      ...item,
      content: reportContent || fallbackContent || item.content,
      charts: charts.length > 0 ? charts : item.charts,
      steps: mergeSteps(item.steps || [], replayedSteps, completedStepStatus),
      outcome: outcome || item.outcome,
    } : item));
    reconcileHistory(taskId, {
      status: detail.status === "failed" ? "failed" : detail.status === "completed" ? "completed" : detail.status === "running" ? "running" : "pending",
      createdAt: new Date(detail.createdAt).getTime(),
      updatedAt: new Date(detail.updatedAt).getTime(),
      ...(detail.completedAt ? { completedAt: new Date(detail.completedAt).getTime() } : {}),
      ...(detail.status === "completed" || detail.status === "failed" ? { unread: false } : {}),
    });

    if (detail.status === "completed" || detail.status === "failed") {
      sourceRef.current?.close();
      sourceRef.current = undefined;
      stopPolling();
      setLoading(false);
      submittingRef.current = false;
      setConnectionError(undefined);
      updateHistoryStatus(taskId, detail.status === "failed" ? "failed" : "completed");
    }
    return detail.status;
  }, [reconcileHistory, stopPolling, updateHistoryStatus]);

  const reconcileCompletedTask = useCallback(async (taskId: string) => {
    const delays = [0, 150, 400, 800];
    for (const delay of delays) {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const status = await refreshTask(taskId);
        if (status === "completed" || status === "failed") return;
      } catch {
        // loop_stop can arrive just before the final task result is committed.
      }
    }
  }, [refreshTask]);

  const connect = useCallback((taskId: string) => {
    sourceRef.current?.close();
    stopPolling();
    setLoading(true);
    setConnectionError(undefined);
    const source = createTaskEventSource(taskId);
    sourceRef.current = source;
    source.onmessage = (message) => {
      let raw: unknown;
      try { raw = JSON.parse(message.data); } catch { return; }
      const parsed = parseTaskStreamEvent(raw);
      if (parsed.kind !== "agent-loop") return;
      const event = parsed.event as AgentLoopEvent;
      setMessages((current) => current.map((item) => {
        if (item.id !== `assistant-${taskId}`) return item;
        const next = consumeAgentEvent(event, { steps: item.steps || [], content: item.content, charts: item.charts || [] });
        return {
          ...item,
          ...next,
          // DailyReport's tool observation already contains the complete report body.
          // Preserve it when loop_stop repeats that body as the final answer.
          content: mode === "daily" && event.type === "loop_stop" && item.content
            ? item.content
            : next.content,
        };
      }));
      if (event.type === "loop_stop") {
        source.close();
        sourceRef.current = undefined;
        stopPolling();
        setLoading(false);
        submittingRef.current = false;
        updateHistoryStatus(taskId, event.result.stoppedBy === "model_error" || event.result.stoppedBy === "aborted" ? "failed" : "completed");
        void reconcileCompletedTask(taskId);
      } else {
        updateHistoryStatus(taskId, "running");
      }
    };
    source.onerror = () => {
      setConnectionError("实时连接暂时中断，正在通过任务状态接口继续检查执行结果。");
      void refreshTask(taskId).catch(() => undefined);
    };
    pollRef.current = setInterval(() => {
      void refreshTask(taskId).catch(() => undefined);
    }, 2_000);
  }, [mode, reconcileCompletedTask, refreshTask, stopPolling, updateHistoryStatus]);

  const submit = useCallback(async (input: { query?: string; date?: string; reportType?: ReportType }) => {
    const title = mode === "qa" ? input.query!.trim() : `生成 ${input.date} ${REPORT_TYPE_LABELS[input.reportType || "all"]}日报`;
    if (!title || loading || submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setConnectionError(undefined);
    try {
      const clientRequestId = crypto.randomUUID();
      const created = mode === "qa"
        ? await createQaTask(input.query!.trim(), clientRequestId)
        : await createDailyReportTask(input.date!, input.reportType || "all", clientRequestId);
      const now = Date.now();
      const task: BorderTaskItem = { id: created.taskId, title, type: mode, date: input.date, reportType: input.reportType, status: "pending", createdAt: now, updatedAt: now, unread: false };
      history.upsert(task);
      activeTaskRef.current = created.taskId;
      setActiveTaskId(created.taskId);
      setMessages([
        { id: `user-${created.taskId}`, role: "user", content: title, timestamp: now, taskId: created.taskId },
        runningAssistantMessage(created.taskId),
      ]);
      connect(created.taskId);
    } catch (error) {
      submittingRef.current = false;
      setLoading(false);
      setConnectionError(error instanceof Error ? error.message : String(error));
    }
  }, [connect, history, loading, mode]);

  const openTask = useCallback(async (task: BorderTaskItem) => {
    closeStream();
    markHistoryViewed(task.id);
    activeTaskRef.current = task.id;
    setActiveTaskId(task.id);
    setConnectionError(undefined);
    setMessages([{ id: `user-${task.id}`, role: "user", content: task.title, timestamp: task.createdAt, taskId: task.id }, assistantMessage(task.id)]);
    try {
      const detail = await getBorderTask(task.id);
      await refreshTask(task.id);
      if (detail.status === "pending" || detail.status === "running") connect(task.id);
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : String(error));
    }
  }, [closeStream, connect, markHistoryViewed, refreshTask]);

  const newTask = useCallback(() => { closeStream(); activeTaskRef.current = undefined; setActiveTaskId(undefined); setMessages([]); setConnectionError(undefined); }, [closeStream]);
  const removeTask = useCallback((taskId: string) => {
    history.remove(taskId);
    if (activeTaskRef.current === taskId) newTask();
  }, [history, newTask]);
  const toggleExpanded = useCallback((id: string) => setMessages((current) => current.map((item) => item.id === id ? { ...item, expanded: !item.expanded } : item)), []);
  const retry = useCallback((taskId?: string) => {
    if (loading) return;
    const task = history.tasks.find((item) => item.id === (taskId || activeTaskId));
    if (!task) {
      setConnectionError("未找到原任务，无法重新回答。");
      return;
    }
    if (mode === "qa") {
      void submit({ query: task.title });
      return;
    }
    const date = task.date || task.title.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (!date) {
      setConnectionError("原日报任务缺少日期，无法重新生成。");
      return;
    }
    void submit({ date, reportType: task.reportType || "all" });
  }, [activeTaskId, history.tasks, loading, mode, submit]);

  return { ...history, remove: removeTask, messages, activeTaskId, loading, connectionError, submit, retry, openTask, newTask, closeStream, toggleExpanded };
}
