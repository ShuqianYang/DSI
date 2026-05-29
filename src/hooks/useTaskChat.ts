'use client';

import { useState, useRef, useEffect } from 'react';
import { ChatMessage, ThinkingStep, GisData, Task, SubTask } from '@/types/prd';
import { createAgentTask, getTask } from '@/lib/api';
import { formatTaskResult } from '@/lib/taskResultFormatter';
import { getMockResponse } from '@/lib/taskMock';

export interface UseTaskChatOptions {
  onGisDataRequest?: (gisData: GisData) => void;
  onFireDetected?: () => void;
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
  deleteMessage: (id: string) => void;
  clearAll: () => void;
  toggleThinkingExpanded: (msgId: string) => void;
}

export function useTaskChat({ onGisDataRequest, onFireDetected, onGisOperation, onTaskCreate, onTaskFinished }: UseTaskChatOptions = {}): UseTaskChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const sseConnections = useRef<Map<string, EventSource>>(new Map());
  const stepAnimationTimers = useRef<Map<string, NodeJS.Timeout[]>>(new Map());
  const planAnimationState = useRef<Map<string, { total: number; completed: number; done: boolean }>>(new Map());
  const delayedEvents = useRef<Map<string, Array<{ type: string; data: any }>>>(new Map());
  // 火灾跳转去重：每个 taskId 只触发一次（先到的事件触发，后到的兜底跳过）
  const fireTriggeredRef = useRef<Set<string>>(new Set());
  // GIS 数据去重：记录已推送过 gisData 的 actionId，避免 step_update 和 task completed 重复推送
  const gisDataPushedRef = useRef<Set<string>>(new Set());
  const globalSseRef = useRef<EventSource | null>(null);

  // 清理 SSE 连接和动画定时器
  useEffect(() => {
    return () => {
      sseConnections.current.forEach((es) => es.close());
      sseConnections.current.clear();
      stepAnimationTimers.current.forEach((timers) => timers.forEach(clearTimeout));
      stepAnimationTimers.current.clear();
      planAnimationState.current.clear();
      delayedEvents.current.clear();
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

  // 清除指定任务的 plan step 动画定时器
  const clearPlanAnimation = (taskId: string) => {
    const timers = stepAnimationTimers.current.get(taskId);
    if (timers) {
      timers.forEach(clearTimeout);
      stepAnimationTimers.current.delete(taskId);
    }
  };

  // 缓存延迟事件（等 plan steps 动画完成后再处理）
  const cacheEvent = (taskId: string, event: { type: string; data: any }) => {
    if (!delayedEvents.current.has(taskId)) {
      delayedEvents.current.set(taskId, []);
    }
    delayedEvents.current.get(taskId)!.push(event);
  };

  // 处理缓存的延迟事件
  const flushDelayedEvents = (taskId: string) => {
    const events = delayedEvents.current.get(taskId);
    if (events) {
      events.forEach((e) => handleSseUpdate(taskId, e.data));
      delayedEvents.current.delete(taskId);
    }
  };

  // 启动 plan steps 渐进动画
  const animatePlanSteps = (taskId: string, steps: Array<{ id: string; name: string; detail: string }>) => {
    clearPlanAnimation(taskId);
    planAnimationState.current.set(taskId, { total: steps.length, completed: 0, done: false });

    if (steps.length === 0) {
      finishPlannerAnimation(taskId);
      return;
    }

    const timers: NodeJS.Timeout[] = [];

    steps.forEach((step, i) => {
      const timer = setTimeout(() => {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.taskId === taskId && m.role === 'assistant');
          if (idx === -1) return prev;
          const msg = prev[idx];
          const updatedSteps = msg.thinkingSteps?.map((s) =>
            s.id === step.id ? { ...s, status: 'completed' as const } : s
          );
          const next = [...prev];
          next[idx] = { ...msg, thinkingSteps: updatedSteps };
          return next;
        });

        const state = planAnimationState.current.get(taskId);
        if (state) {
          state.completed++;
          if (state.completed >= state.total) {
            state.done = true;
            finishPlannerAnimation(taskId);
          }
        }
      }, (i + 1) * 350);
      timers.push(timer);
    });

    stepAnimationTimers.current.set(taskId, timers);
  };

  // plan steps 全部完成后，planner → completed，然后处理缓存的 routing 事件
  const finishPlannerAnimation = (taskId: string) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.taskId === taskId && m.role === 'assistant');
      if (idx === -1) return prev;
      const msg = prev[idx];
      const updatedSteps = msg.thinkingSteps?.map((s) =>
        s.id === 'planner' ? { ...s, status: 'completed' as const, detail: '规划完成' } : s
      );
      const next = [...prev];
      next[idx] = {
        ...msg,
        thinkingSteps: updatedSteps,
        content: `任务已创建：${taskId}\n\n**执行目标：**${msg.thinking?.split('\n')[0]?.replace('目标：', '') || '分析用户请求'}\n\n正在决策执行工具...`,
      };
      return next;
    });

    setTimeout(() => {
      flushDelayedEvents(taskId);
    }, 200);
  };

  // 建立 SSE 连接并监听步骤级实时更新
  const startTaskSse = (taskId: string) => {
    if (sseConnections.current.has(taskId)) return;

    const evtSource = new EventSource(`http://localhost:3001/tasks/${taskId}/stream`);
    sseConnections.current.set(taskId, evtSource);

    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[useTaskChat] SSE msg:', data);
        handleSseUpdate(taskId, data);
      } catch (err) {
        console.warn('[useTaskChat] SSE parse error:', err);
      }
    };

    evtSource.onerror = () => {
      evtSource.close();
      sseConnections.current.delete(taskId);
    };
  };

  // 处理 SSE 消息，更新对应消息的 thinkingSteps
  const handleSseUpdate = (taskId: string, data: {
    type: string;
    stepIndex?: number;
    actionId?: string;
    status?: string;
    name?: string;
    detail?: string;
    error?: string;
    plan?: {
      goal?: string;
      reasoning?: string;
      steps?: Array<{ id: string; description: string; purpose: string }>;
    };
    actions?: Array<{
      id: string;
      type: string;
      name: string;
      description: string;
      params?: Record<string, unknown>;
      dependsOn?: string[];
    }>;
  }) => {
    // --- planning 阶段开始 ---
    if (data.type === 'planning') {
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.taskId === taskId && m.role === 'assistant');
        if (idx === -1) return prev;
        const msg = prev[idx];
        const updatedSteps = (msg.thinkingSteps || []).map((s) =>
          s.id === 'planner' ? { ...s, status: 'running' as const, detail: data.detail || s.detail || '正在分析用户意图...' } : s
        );
        const next = [...prev];
        next[idx] = { ...msg, thinkingSteps: updatedSteps };
        return next;
      });
      return;
    }

    // --- planning 阶段完成 ---
    if (data.type === 'planning_done') {
      const plan = data.plan;
      const planSteps = (plan?.steps || []).map((s, i) => ({
        id: s.id || `plan-step-${i + 1}`,
        name: s.description || `计划步骤 ${i + 1}`,
        status: 'pending' as const,
        detail: s.purpose || '',
      }));

      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.taskId === taskId && m.role === 'assistant');
        if (idx === -1) return prev;
        const msg = prev[idx];

        const remainingSteps = (msg.thinkingSteps || [])
          .filter((s) => s.id !== 'planner' && !planSteps.find((p) => p.id === s.id));
        const updatedSteps = [
          { id: 'planner', name: '任务规划', status: 'running' as const, detail: plan?.goal || '规划进行中...' },
          ...planSteps,
          ...remainingSteps,
        ];

        const next = [...prev];
        next[idx] = {
          ...msg,
          thinking: plan?.reasoning || msg.thinking,
          thinkingSteps: updatedSteps,
          content: `任务已创建：${taskId}\n\n**执行目标：**${plan?.goal || '分析用户请求'}\n\n正在细化执行计划...`,
        };
        return next;
      });

      animatePlanSteps(taskId, planSteps);
      return;
    }

    // --- routing 阶段开始 ---
    if (data.type === 'routing') {
      const state = planAnimationState.current.get(taskId);
      if (state && !state.done) {
        cacheEvent(taskId, { type: 'routing', data });
        return;
      }

      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.taskId === taskId && m.role === 'assistant');
        if (idx === -1) return prev;
        const msg = prev[idx];
        const updatedSteps = (msg.thinkingSteps || []).map((s) =>
          s.id === 'router'
            ? { ...s, status: 'running' as const, detail: data.detail || s.detail || '正在决策执行工具...' }
            : s
        );
        const next = [...prev];
        next[idx] = { ...msg, thinkingSteps: updatedSteps };
        return next;
      });
      return;
    }

    // --- routing 阶段完成 ---
    if (data.type === 'routing_done') {
      const state = planAnimationState.current.get(taskId);
      if (state && !state.done) {
        cacheEvent(taskId, { type: 'routing_done', data });
        return;
      }

      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.taskId === taskId && m.role === 'assistant');
        if (idx === -1) return prev;
        const msg = prev[idx];
        const actions = data.actions || [];
        const actionSteps = actions.map((a) => ({
          id: a.id,
          name: a.name || a.type,
          status: 'pending' as const,
          detail: a.description || '',
        }));

        const actionNames = actions.map((a) => a.name || a.type).filter(Boolean).join('、');

        const existingSteps = (msg.thinkingSteps || []).filter(
          (s) => !actionSteps.find((a) => a.id === s.id)
        );
        const routerStep = existingSteps.find((s) => s.id === 'router');
        const otherSteps = existingSteps.filter((s) => s.id !== 'router');

        const updatedSteps = [
          ...otherSteps,
          routerStep ? { ...routerStep, status: 'completed' as const, detail: '工具决策完成' } : { id: 'router', name: '工具决策', status: 'completed' as const, detail: '工具决策完成' },
          ...actionSteps,
        ];

        const next = [...prev];
        next[idx] = {
          ...msg,
          thinkingSteps: updatedSteps,
          content: `任务已创建：${taskId}\n\n**决策动作：**${actionNames || '通用分析'}\n\n正在异步执行中，步骤进度将实时更新...`,
        };
        return next;
      });
      return;
    }

    // 步骤级更新
    if (data.type === 'step_update' && data.actionId) {
      // fire-detector 工具完成时立即触发跳转（早于综合洞察生成）
      if (
        data.status === 'completed' &&
        data.actionType === 'fire-detector' &&
        !fireTriggeredRef.current.has(taskId)
      ) {
        fireTriggeredRef.current.add(taskId);
        onFireDetected?.();
      }

      // GIS 操作指令：步骤完成时自动触发
      if (data.status === 'completed' && (data as any).operations && Array.isArray((data as any).operations)) {
        console.log('[useTaskChat] Received GIS operations:', (data as any).operations);
        onGisOperation?.((data as any).operations);
      }

      // GIS 区域 / 实体 / 影像数据：步骤完成时实时推送（让 region-mark / satellite 等步骤的 flyTo + 划线即时触发）
      if (data.status === 'completed' && (data as any).gisData) {
        const actionId = data.actionId as string | undefined;
        const gisKey = actionId ? `${taskId}:${actionId}` : undefined;
        if (gisKey && !gisDataPushedRef.current.has(gisKey)) {
          gisDataPushedRef.current.add(gisKey);
          const gis = (data as any).gisData;
          console.log('[useTaskChat] Received GIS data (step_update):', {
            type: gis?.type,
            hasCameraView: !!gis?.cameraView,
            cameraView: gis?.cameraView,
            regionsCount: gis?.regions?.length,
            entitiesCount: gis?.entities?.length,
            imageOverlaysCount: gis?.imageOverlays?.length,
          });
          onGisDataRequest?.(gis);
        }
      }

      setMessages((prev) => {
        const idx = prev.findIndex(
          (m) => m.taskId === taskId && m.role === 'assistant'
        );
        if (idx === -1) return prev;

        const msg = prev[idx];
        const updatedSteps = (msg.thinkingSteps || []).map((s) =>
          s.id === data.actionId
            ? { ...s, status: data.status as ThinkingStep['status'], detail: data.detail || s.detail }
            : s
        );

        const next = [...prev];
        next[idx] = { ...msg, thinkingSteps: updatedSteps };
        return next;
      });
      return;
    }

    // 任务整体完成/失败
    const isFinished = data.type === 'completed' || data.type === 'failed';
    if (isFinished) {
      console.log('[useTaskChat] Task finished event:', data);
      clearPlanAnimation(taskId);
      const es = sseConnections.current.get(taskId);
      if (es) {
        es.close();
        sseConnections.current.delete(taskId);
      }

      const finalStatus = data.type === 'completed' ? 'completed' : 'failed';

      // 通知上层任务结束，让 page.tsx 联动 chat / 进度弹窗的开合
      onTaskFinished?.(taskId, finalStatus);

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
        };
        return next;
      });

      if (finalStatus === 'completed') {
        console.log('[useTaskChat] Fetching task result...');
        getTask(taskId)
          .then((task) => {
            console.log('[useTaskChat] Got task result:', task.result ? 'yes' : 'no');
            if (task.result) {
              // 火灾兜底：若 step_update 阶段未触发过，再次检测 result 后触发
              const hasFireResult = Object.values(task.result).some(
                (r: any) => r?.summary?.fireDetected === true
              );
              if (hasFireResult && onFireDetected && !fireTriggeredRef.current.has(taskId)) {
                fireTriggeredRef.current.add(taskId);
                setTimeout(() => onFireDetected(), 500);
              }

              // 自动提取各 step 的 gisData 并推送给地图（仅兜底：step_update 未推送过的才补推）
              for (const [actionId, stepResult] of Object.entries(task.result)) {
                const gisKey = `${taskId}:${actionId}`;
                if (gisDataPushedRef.current.has(gisKey)) continue; // step_update 已推送，跳过
                const sr = stepResult as Record<string, unknown> | undefined;
                console.log(`[useTaskChat] Step ${actionId} keys:`, Object.keys(sr || {}));
                // satellite 的 gisData 在 data.gisData（嵌套），region-mark 的在 gisData（顶层）
                const nestedGis = (sr?.data as Record<string, unknown> | undefined)?.gisData as GisData | undefined;
                const topGis = sr?.gisData as GisData | undefined;
                const gisData = nestedGis || topGis;
                console.log(`[useTaskChat] Step ${actionId} gisData (fallback):`, gisData ? `YES type=${gisData.type} overlays=${gisData.imageOverlays?.length || 0}` : 'NO');
                if (gisData && onGisDataRequest) {
                  gisDataPushedRef.current.add(gisKey);
                  onGisDataRequest(gisData);
                }
              }

              const resultMarkdown = formatTaskResult(task.result);
              setMessages((prev) => {
                const idx = prev.findIndex(
                  (m) => m.taskId === taskId && m.role === 'assistant'
                );
                if (idx === -1) return prev;
                const next = [...prev];
                next[idx] = { ...prev[idx], content: resultMarkdown };
                return next;
              });
            }
          })
          .catch((err) => {
            console.warn('[useTaskChat] getTask failed:', err);
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
    deleteMessage,
    clearAll,
    toggleThinkingExpanded,
  };
}
