'use client';

import { useState, useRef, useEffect } from 'react';
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
  /** 浠诲姟鍒涘缓鎴愬姛鍚庣珛鍗宠Е鍙戯紙鎷垮埌 taskId銆佹瀯閫?placeholder Task锛夛紱鐢ㄤ簬涓婂眰鑱斿姩 UI锛堟敹璧?chat / 寮硅繘搴︾獥锛夈€傝瑙?api/plan/auto-toggle-chat-and-task-panel.md */
  onTaskCreate?: (task: Task, steps: ThinkingStep[], gisData?: GisData) => void;
  /** 浠诲姟鏁翠綋瀹屾垚鎴栧け璐ユ椂瑙﹀彂锛涚敤浜庝笂灞傝仈鍔?UI锛堝睍寮€ chat / 鍏宠繘搴︾獥锛夈€傝瑙?api/plan/auto-toggle-chat-and-task-panel.md */
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

export function useTaskChat({ onGisDataRequest, onGisOperation, onTaskCreate, onTaskFinished }: UseTaskChatOptions = {}): UseTaskChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const sseConnections = useRef<Map<string, EventSource>>(new Map());
  // GIS 鏁版嵁鍘婚噸锛氳褰曞凡鎺ㄩ€佽繃 gisData 鐨?actionId锛岄伩鍏?step_update 鍜?task completed 閲嶅鎺ㄩ€?
  const gisDataPushedRef = useRef<Set<string>>(new Set());
  const finishedTaskIdsRef = useRef<Set<string>>(new Set());
  const taskStreamModeTrackerRef = useRef(createTaskStreamModeTracker());
  const globalSseRef = useRef<EventSource | null>(null);

  // 娓呯悊 SSE 杩炴帴鍜屽姩鐢诲畾鏃跺櫒
  useEffect(() => {
    return () => {
      sseConnections.current.forEach((es) => es.close());
      sseConnections.current.clear();
      finishedTaskIdsRef.current.clear();
      taskStreamModeTrackerRef.current = createTaskStreamModeTracker();
      globalSseRef.current?.close();
    };
  }, []);

  // 鍏ㄥ眬 SSE锛氱洃鍚?subscription_triggered_task 绛夎法浠诲姟浜嬩欢
  useEffect(() => {
    const es = new EventSource('http://localhost:3001/sse/global');
    globalSseRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[useTaskChat] Global SSE:', data);

        if (data.type === 'subscription_triggered_task' && data.taskId) {
          const taskId = data.taskId;
          const name = data.name || '璁㈤槄浠诲姟';
          const query = data.query || '';

          // 閬垮厤閲嶅鍒涘缓鍚?taskId 鐨勫崰浣嶆秷鎭?
          setMessages((prev) => {
            if (prev.some((m) => m.taskId === taskId)) return prev;

            const placeholderMsg: ChatMessage = {
              id: `ai-sub-${Date.now()}`,
              role: 'assistant',
              taskId,
              content: `馃敂 璁㈤槄銆?{name}銆嶅凡鑷姩瑙﹀彂锛屾鍦ㄦ墽琛岀伀鎯呯爺鍒?..\n\n**浠诲姟缂栧彿**锛?{taskId}`,
              timestamp: Date.now(),
              thinking: `璁㈤槄鑷姩瑙﹀彂锛?{query}`,
              thinkingSteps: [
                { id: 'planner', name: '浠诲姟瑙勫垝', status: 'pending', detail: '绛夊緟寮€濮?..' },
                { id: 'router', name: '宸ュ叿鍐崇瓥', status: 'pending', detail: '绛夊緟瑙勫垝瀹屾垚...' },
              ],
              isThinkingExpanded: true,
            };
            return [...prev, placeholderMsg];
          });

          // 鍚姩璇?task 鐨?SSE 鐩戝惉
          startTaskSse(taskId);

          // 閫氱煡涓婂眰锛堝 page.tsx锛変换鍔″凡鍒涘缓锛屽彲灞曞紑鍙充晶闈㈡澘绛?
          onTaskCreate?.({
            id: taskId,
            name: query.length > 30 ? `${query.slice(0, 30)}...` : query,
            type: 'realtime',
            status: 'running',
            executeTime: Date.now(),
            dataCount: 0,
            subTasks: [
              { id: 'planner', name: '浠诲姟瑙勫垝', description: '绛夊緟寮€濮?..', status: 'pending', order: 1 },
              { id: 'router', name: '宸ュ叿鍐崇瓥', description: '绛夊緟瑙勫垝瀹屾垚...', status: 'pending', order: 2 },
            ],
          }, [
            { id: 'planner', name: '浠诲姟瑙勫垝', status: 'pending', detail: '绛夊緟寮€濮?..' },
            { id: 'router', name: '宸ュ叿鍐崇瓥', status: 'pending', detail: '绛夊緟瑙勫垝瀹屾垚...' },
          ]);
        }
      } catch (err) {
        console.warn('[useTaskChat] Global SSE parse error:', err);
      }
    };

    es.onerror = () => {
      // 闈欓粯澶勭悊锛屾祻瑙堝櫒浼氳嚜鍔ㄩ噸杩?
    };

    return () => {
      es.close();
    };
  }, []);

  // 寤虹珛 SSE 杩炴帴骞剁洃鍚楠ょ骇瀹炴椂鏇存柊
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

  // 澶勭悊 SSE 娑堟伅锛屾洿鏂板搴旀秷鎭殑 thinkingSteps
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
        content: '姝ｅ湪涓烘偍瑙勫垝浠诲姟...',
        timestamp: Date.now(),
        thinking: '绛夊緟瑙勫垝缁撴灉...',
        thinkingSteps: [
          { id: 'planner', name: '浠诲姟瑙勫垝', status: 'pending', detail: '绛夊緟寮€濮?..' },
          { id: 'router', name: '宸ュ叿鍐崇瓥', status: 'pending', detail: '绛夊緟瑙勫垝瀹屾垚...' },
        ],
        isThinkingExpanded: true,
      };
      setMessages((prev) => [...prev, placeholderMsg]);

      const result = await createAgentTask(userMessage.content);

      // 鏋勯€?placeholder Task 绔嬪埢閫氱煡涓婂眰锛坰ubTasks 鐢?placeholder thinkingSteps 鍏滃簳锛?
      // 绛夌湡瀹?task 鏁版嵁浠?useRightPanelData 鍛ㄦ湡鎬ф媺鍒板悗锛宲age.tsx 鍙寜 id 姣斿鍒锋柊锛?
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
      const errorMsg = err instanceof Error ? err.message : '浠诲姟鍒涘缓澶辫触';
      console.warn('[useTaskChat] API failed, fallback to mock:', errorMsg);

      const mockResp = getMockResponse(userMessage.content);
      setMessages((prev) => {
        const filtered = prev.filter((m) => m.role !== 'assistant' || m.content !== '姝ｅ湪涓烘偍瑙勫垝浠诲姟...');
        return [
          ...filtered,
          {
            id: `ai-${Date.now()}`,
            role: 'assistant',
            content: mockResp.content + '\n\n锛堝悗绔湇鍔℃殏涓嶅彲鐢紝浠ヤ笂鍐呭涓烘ā鎷熷洖澶嶏級',
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
