'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ChatMessage, ThinkingStep, GisData, Task, SubTask } from '@/types/prd';
import { createAgentTask, getTask } from '@/lib/api';
import { chooseAgentLoopDisplayContent } from '@/lib/agentLoopContent';
import { formatTaskResult } from '@/lib/taskResultFormatter';
import { getMockResponse } from '@/lib/taskMock';
import {
  extractOperationsFromAgentLoopEvent,
  logAgentLoopEvent,
  type AgentLoopEvent,
} from '@/lib/agentLoopEvents';
import {
  extractGisPushesFromAgentLoopEvent,
  extractGisPushesFromTaskResult,
  type AgentLoopGisPush,
} from '@/lib/agentLoopGisBridge';
import { formatAgentLoopThinkingUpdate } from '@/lib/agentLoopStepFormatter';
import {
  buildAgentLoopTaskResultFromStop,
  createTaskStreamModeTracker,
  getTaskFinishFromAgentLoopEvent,
} from '@/lib/taskStreamLifecycle';
import { routeTaskStreamEvent } from '@/lib/taskStreamRouter';
import {
  recordAgentLoopUpdate,
  recordGisPush,
  recordTaskFinished,
  recordTaskStreamEvent,
} from '@/lib/agentLoopFrontendTrace';

export interface UseTaskChatOptions {
  onGisDataRequest?: (gisData: GisData) => void;
  onGisOperation?: (operations: Array<Record<string, unknown>>) => void;
  /** 任务创建成功后立即触发（拿到 taskId、构造 placeholder Task）；用于上层联动 UI（收起 chat / 弹进度窗）。详见 api/plan/auto-toggle-chat-and-task-panel.md */
  onTaskCreate?: (task: Task, steps: ThinkingStep[], gisData?: GisData) => void;
  /** 任务整体完成或失败时触发；用于上层联动 UI（展开 chat / 关进度窗）。详见 api/plan/auto-toggle-chat-and-task-panel.md */
  onTaskFinished?: (taskId: string, status: 'completed' | 'failed') => void;
}

export interface UseTaskChatReturn {
  messages: ChatMessage[];
  inputValue: string;
  isLoading: boolean;
  setInputValue: (v: string) => void;
  sendMessage: (content: string) => Promise<void>;
  addSystemMessage: (content: string) => void;
  deleteMessage: (id: string) => void;
  clearAll: () => void;
  toggleThinkingExpanded: (msgId: string) => void;
}

export function useTaskChat({ onGisDataRequest, onGisOperation, onTaskCreate, onTaskFinished }: UseTaskChatOptions = {}): UseTaskChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const sseConnections = useRef<Map<string, EventSource>>(new Map());
  // GIS 数据去重：记录已推送过 gisData 的 actionId，避免 step_update 和 task completed 重复推送
  const gisDataPushedRef = useRef<Set<string>>(new Set());
  const finishedTaskIdsRef = useRef<Set<string>>(new Set());
  const taskStreamModeTrackerRef = useRef(createTaskStreamModeTracker());
  const globalSseRef = useRef<EventSource | null>(null);

  // 清理 SSE 连接和动画定时器
  useEffect(() => {
    return () => {
      sseConnections.current.forEach((es) => es.close());
      sseConnections.current.clear();
      finishedTaskIdsRef.current.clear();
      taskStreamModeTrackerRef.current = createTaskStreamModeTracker();
      globalSseRef.current?.close();
    };
  }, []);

  // 全局 SSE：监听 subscription_triggered_task 等跨任务事件
  useEffect(() => {
    const es = new EventSource('http://localhost:3001/sse/global');
    globalSseRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[useTaskChat] Global SSE:', data);

        if (data.type === 'subscription_triggered_task' && data.taskId) {
          const taskId = data.taskId;
          const name = data.name || '订阅任务';
          const query = data.query || '';

          // 避免重复创建同 taskId 的占位消息
          setMessages((prev) => {
            if (prev.some((m) => m.taskId === taskId)) return prev;

            const placeholderMsg: ChatMessage = {
              id: `ai-sub-${Date.now()}`,
              role: 'assistant',
              taskId,
              content: `🔔 订阅「${name}」已自动触发，正在执行火情研判...\n\n**任务编号**：${taskId}`,
              timestamp: Date.now(),
              thinking: `订阅自动触发：${query}`,
              thinkingSteps: [
                { id: 'planner', name: '任务规划', status: 'pending', detail: '等待开始...' },
                { id: 'router', name: '工具决策', status: 'pending', detail: '等待规划完成...' },
              ],
              isThinkingExpanded: true,
            };
            return [...prev, placeholderMsg];
          });

          // 启动该 task 的 SSE 监听
          startTaskSse(taskId);

          // 通知上层（如 page.tsx）任务已创建，可展开右侧面板等
          onTaskCreate?.({
            id: taskId,
            name: query.length > 30 ? `${query.slice(0, 30)}...` : query,
            type: 'realtime',
            status: 'running',
            executeTime: Date.now(),
            dataCount: 0,
            subTasks: [
              { id: 'planner', name: '任务规划', description: '等待开始...', status: 'pending', order: 1 },
              { id: 'router', name: '工具决策', description: '等待规划完成...', status: 'pending', order: 2 },
            ],
          }, [
            { id: 'planner', name: '任务规划', status: 'pending', detail: '等待开始...' },
            { id: 'router', name: '工具决策', status: 'pending', detail: '等待规划完成...' },
          ]);
        }
      } catch (err) {
        console.warn('[useTaskChat] Global SSE parse error:', err);
      }
    };

    es.onerror = () => {
      // 静默处理，浏览器会自动重连
    };

    return () => {
      es.close();
    };
  }, []);

  // 建立 SSE 连接并监听步骤级实时更新
  const startTaskSse = (taskId: string) => {
    if (sseConnections.current.has(taskId)) return;
    taskStreamModeTrackerRef.current.preferNative(taskId);

    const evtSource = new EventSource(`http://localhost:3001/tasks/${taskId}/stream`);
    sseConnections.current.set(taskId, evtSource);

    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[useTaskChat] SSE msg:', data);
        const routed = routeTaskStreamEvent({
          taskId,
          event: data,
          tracker: taskStreamModeTrackerRef.current,
        });
        recordTaskStreamEvent(taskId, data, routed.parsed);
        if (routed.kind === 'agent-loop') {
          logAgentLoopEvent(taskId, routed.event);
          handleAgentLoopUpdate(taskId, routed.event);
          return;
        }
        if (routed.kind === 'ignored-legacy') {
          return;
        }
      } catch (err) {
        console.warn('[useTaskChat] SSE parse error:', err);
      }
    };

    evtSource.onerror = () => {
      evtSource.close();
      sseConnections.current.delete(taskId);
      taskStreamModeTrackerRef.current.clear(taskId);
    };
  };

  // 处理 SSE 消息，更新对应消息的 thinkingSteps
  const upsertThinkingStep = (
    taskId: string,
    step: ThinkingStep,
    options: { append?: boolean } = {}
  ) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.taskId === taskId && m.role === 'assistant');
      if (idx === -1) return prev;

      const msg = prev[idx];
      const existing = msg.thinkingSteps || [];
      const stepIdx = existing.findIndex((s) => s.id === step.id);
      const thinkingSteps =
        stepIdx >= 0
          ? existing.map((s) => (s.id === step.id ? { ...s, ...step } : s))
          : options.append === false
            ? existing
            : [...existing, step];

      const next = [...prev];
      next[idx] = { ...msg, thinkingSteps };
      return next;
    });
  };

  const pushGisPushes = (taskId: string, pushes: AgentLoopGisPush[]) => {
    for (const push of pushes) {
      if (gisDataPushedRef.current.has(push.key)) continue;
      gisDataPushedRef.current.add(push.key);
      console.log('[useTaskChat] Received GIS data:', {
        source: push.source,
        key: push.key,
        toolName: push.toolName,
        type: push.gisData.type,
        hasCameraView: !!push.gisData.cameraView,
        cameraView: push.gisData.cameraView,
        regionsCount: push.gisData.regions?.length,
        entitiesCount: push.gisData.entities?.length,
        imageOverlaysCount: push.gisData.imageOverlays?.length,
      });
      const traceSource = push.toolName
        ? `${push.source}:${push.toolName}`
        : `${push.source}:${push.toolCallId || 'gis'}`;
      recordGisPush(taskId, push.gisData, traceSource);
      onGisDataRequest?.(push.gisData);
    }
  };

  const closeTaskSse = (taskId: string) => {
    const es = sseConnections.current.get(taskId);
    if (!es) return;
    es.close();
    sseConnections.current.delete(taskId);
    taskStreamModeTrackerRef.current.clear(taskId);
  };

  const applyTaskResultToMessage = (taskId: string, result: Record<string, unknown>) => {
    pushGisPushes(taskId, extractGisPushesFromTaskResult(taskId, result));

    for (const [actionId, stepResult] of Object.entries(result)) {
      if (actionId === 'logFilePath') continue;
      const gisKey = `${taskId}:${actionId}`;
      if (gisDataPushedRef.current.has(gisKey)) continue;
      const sr = stepResult as Record<string, unknown> | undefined;
      console.log(`[useTaskChat] Step ${actionId} keys:`, Object.keys(sr || {}));
      const nestedGis = (sr?.data as Record<string, unknown> | undefined)?.gisData as GisData | undefined;
      const topGis = sr?.gisData as GisData | undefined;
      const gisData = nestedGis || topGis;
      console.log(`[useTaskChat] Step ${actionId} gisData (fallback):`, gisData ? `YES type=${gisData.type} overlays=${gisData.imageOverlays?.length || 0}` : 'NO');
      if (gisData && onGisDataRequest) {
        gisDataPushedRef.current.add(gisKey);
        recordGisPush(taskId, gisData, `task-result:${actionId}`);
        onGisDataRequest(gisData);
      }
    }

    const resultMarkdown = formatTaskResult(result);
    const resultLogFilePath =
      typeof result.logFilePath === 'string' ? result.logFilePath : undefined;
    if (resultLogFilePath) {
      recordTaskFinished(taskId, 'completed', resultLogFilePath);
    }
    setMessages((prev) => {
      const idx = prev.findIndex(
        (m) => m.taskId === taskId && m.role === 'assistant'
      );
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = {
        ...prev[idx],
        content:
          result.mode === 'agent_loop'
            ? chooseAgentLoopDisplayContent(prev[idx].content, resultMarkdown)
            : resultMarkdown,
        agentLoopLogFilePath: resultLogFilePath || prev[idx].agentLoopLogFilePath,
      };
      return next;
    });
  };

  const fetchAndApplyTaskResult = (taskId: string) => {
    console.log('[useTaskChat] Fetching task result...');
    getTask(taskId)
      .then((task) => {
        console.log('[useTaskChat] Got task result:', task.result ? 'yes' : 'no');
        if (task.result) {
          applyTaskResultToMessage(taskId, task.result);
        }
      })
      .catch((err) => {
        console.warn('[useTaskChat] getTask failed:', err);
      });
  };

  const finishTaskFromStream = (
    taskId: string,
    finalStatus: 'completed' | 'failed',
    options: {
      logFilePath?: string;
      result?: Record<string, unknown>;
      fetchResult?: boolean;
    } = {}
  ) => {
    closeTaskSse(taskId);

    if (!finishedTaskIdsRef.current.has(taskId)) {
      finishedTaskIdsRef.current.add(taskId);
      recordTaskFinished(taskId, finalStatus, options.logFilePath);
      onTaskFinished?.(taskId, finalStatus);
    }

    setMessages((prev) => {
      const idx = prev.findIndex(
        (m) => m.taskId === taskId && m.role === 'assistant'
      );
      if (idx === -1) return prev;

      const msg = prev[idx];
      const updatedSteps = (msg.thinkingSteps || []).map((s) =>
        s.status === 'pending' || s.status === 'running'
          ? { ...s, status: finalStatus === 'completed' ? ('completed' as const) : ('failed' as const) }
          : s
      );

      const next = [...prev];
      next[idx] = {
        ...msg,
        thinkingSteps: updatedSteps,
        agentLoopLogFilePath: options.logFilePath || msg.agentLoopLogFilePath,
      };
      return next;
    });

    if (options.result) {
      applyTaskResultToMessage(taskId, options.result);
    }

    if (finalStatus === 'completed' && options.fetchResult) {
      window.setTimeout(() => fetchAndApplyTaskResult(taskId), 250);
    }
  };

  const handleAgentLoopUpdate = (taskId: string, event: AgentLoopEvent) => {
    const update = formatAgentLoopThinkingUpdate(event);
    recordAgentLoopUpdate(taskId, event, update);
    update.steps.forEach((step) => upsertThinkingStep(taskId, step));
    pushGisPushes(taskId, extractGisPushesFromAgentLoopEvent(taskId, event));

    if (update.content || update.completeOpenStepsAs) {
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.taskId === taskId && m.role === 'assistant');
        if (idx === -1) return prev;

        const msg = prev[idx];
        const updatedSteps = update.completeOpenStepsAs
          ? (msg.thinkingSteps || []).map((s) =>
              s.status === 'pending' || s.status === 'running'
                ? { ...s, status: update.completeOpenStepsAs as ThinkingStep['status'] }
                : s
            )
          : msg.thinkingSteps;

        const next = [...prev];
        next[idx] = {
          ...msg,
          content: update.content ? chooseAgentLoopDisplayContent(msg.content, update.content) : msg.content,
          agentLoopLogFilePath: update.logFilePath || msg.agentLoopLogFilePath,
          thinkingSteps: updatedSteps,
        };
        return next;
      });
    }

    if (event.type === 'tool_observation') {
      const operations = extractOperationsFromAgentLoopEvent(event);
      if (operations?.length) {
        console.log('[useTaskChat] Received GIS operations (agent-loop):', operations);
        onGisOperation?.(operations);
      }

      return;
    }

    if (event.type === 'loop_stop') {
      const finish = getTaskFinishFromAgentLoopEvent(event);
      if (finish) {
        finishTaskFromStream(taskId, finish.status, {
          logFilePath: finish.logFilePath,
          result: buildAgentLoopTaskResultFromStop(event),
          fetchResult: finish.status === 'completed',
        });
      }
    }
  };

  const sendMessage = async (content: string) => {
    if (!content.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      const placeholderId = `ai-${Date.now()}`;
      const placeholderMsg: ChatMessage = {
        id: placeholderId,
        role: 'assistant',
        content: '正在为您规划任务...',
        timestamp: Date.now(),
        thinking: '等待规划结果...',
        thinkingSteps: [
          { id: 'planner', name: '任务规划', status: 'pending', detail: '等待开始...' },
          { id: 'router', name: '工具决策', status: 'pending', detail: '等待规划完成...' },
        ],
        isThinkingExpanded: true,
      };
      setMessages((prev) => [...prev, placeholderMsg]);

      const result = await createAgentTask(userMessage.content);

      // 构造 placeholder Task 立刻通知上层（subTasks 用 placeholder thinkingSteps 兜底；
      // 等真实 task 数据从 useRightPanelData 周期性拉到后，page.tsx 可按 id 比对刷新）
      const placeholderSubTasks: SubTask[] = (placeholderMsg.thinkingSteps ?? []).map((s, i) => ({
        id: s.id,
        name: s.name,
        description: s.detail,
        status: (s.status as SubTask['status']) ?? 'pending',
        order: i + 1,
      }));
      const placeholderTask: Task = {
        id: result.taskId,
        name:
          userMessage.content.length > 30
            ? `${userMessage.content.slice(0, 30)}...`
            : userMessage.content,
        type: 'realtime',
        status: 'running',
        executeTime: Date.now(),
        dataCount: 0,
        subTasks: placeholderSubTasks,
      };
      onTaskCreate?.(placeholderTask, placeholderMsg.thinkingSteps ?? [], undefined);

      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === placeholderId);
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], taskId: result.taskId };
        return next;
      });

      if (result.status !== 'completed') {
        startTaskSse(result.taskId);
      }

      window.dispatchEvent(new CustomEvent('agent:task-created', { detail: result.taskId }));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '任务创建失败';
      console.warn('[useTaskChat] API failed, fallback to mock:', errorMsg);

      const mockResp = getMockResponse(userMessage.content);
      setMessages((prev) => {
        const filtered = prev.filter((m) => m.role !== 'assistant' || m.content !== '正在为您规划任务...');
        return [
          ...filtered,
          {
            id: `ai-${Date.now()}`,
            role: 'assistant',
            content: mockResp.content + '\n\n（后端服务暂不可用，以上内容为模拟回复）',
            timestamp: Date.now(),
            hasGisData: !!mockResp.gisData,
            gisData: mockResp.gisData,
            thinking: mockResp.thinking,
            thinkingSteps: mockResp.thinkingSteps,
            isThinkingExpanded: false,
          },
        ];
      });

      if (onGisDataRequest && mockResp.gisData) {
        onGisDataRequest(mockResp.gisData);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const addSystemMessage = useCallback((content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    setMessages((prev) => [
      ...prev,
      {
        id: `system-${Date.now()}`,
        role: 'system',
        content: trimmed,
        timestamp: Date.now(),
      },
    ]);
  }, []);

  const deleteMessage = (id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  };

  const clearAll = () => {
    setMessages([]);
  };

  const toggleThinkingExpanded = (msgId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId ? { ...m, isThinkingExpanded: !m.isThinkingExpanded } : m
      )
    );
  };

  return {
    messages,
    inputValue,
    isLoading,
    setInputValue,
    sendMessage,
    addSystemMessage,
    deleteMessage,
    clearAll,
    toggleThinkingExpanded,
  };
}
