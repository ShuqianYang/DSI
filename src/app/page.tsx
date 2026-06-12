'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Menu, X, ChevronLeft, ChevronRight } from 'lucide-react';
import LogoIcon from '@/components/LogoIcon';
import ChatPanel from '@/components/ChatPanel';
import RightPanel from '@/components/RightPanel';
import UserCenter from '@/components/UserCenter';
import LoginPage from '@/components/LoginPage';
import { Entity, Insight, GisData, Task, TaskEvent, ThinkingStep, SubTask, Trajectory, Region } from '@/types/prd';
import { mockUser } from '@/data/mockData';

const EMPTY_REGIONS: Region[] = [];
import { getAisData, getAdsData } from '@/lib/api';
import type { ApiAisData, ApiAdsData } from '@/lib/api';
import type { GisOperation, CesiumMapRef } from '@/components/cesium/CesiumMap';
import { useRightPanelData } from '@/hooks/useRightPanelData';
import {
  extractGisPushesFromAgentLoopEvent,
} from '@/lib/agentLoopGisBridge';
import {
  createTaskStreamModeTracker,
  getTaskFinishFromStreamEvent,
  isNativeAgentLoopProgressEvent,
} from '@/lib/taskStreamLifecycle';
import { routeTaskStreamEvent } from '@/lib/taskStreamRouter';
import LiveClock from '@/components/LiveClock';
import WindParticleCanvasOverlay from '@/features/gis-custom/multi-layer-points/WindParticleCanvasOverlay';

// 动态导入GIS组件，避免SSR问题
const GisViewer = dynamic(() => import('@/components/GisViewer'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#121212]">
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 relative text-[#00E0FF]">
          <LogoIcon size={80} className="animate-pulse" />
        </div>
        <div className="text-[#EAEAEA] font-medium">加载地球引擎中...</div>
        {/* <div className="text-sm text-[#8888AA] mt-1">基于WebGL渲染</div> */}
      </div>
    </div>
  ),
});

export default function HomePage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isAuthChecked, setIsAuthChecked] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [showChat, setShowChat] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [activeGisIds, setActiveGisIds] = useState<Set<string>>(new Set());
  const [activeGisDataList, setActiveGisDataList] = useState<GisData[]>([]);
  // 真实 jobTask（含 agentTaskId）从 useRightPanelData 拿，供 swap effect 把 placeholder selectedTask 替换为真实版本
  const { tasks: apiTasks, refresh } = useRightPanelData();
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [pendingOperations, setPendingOperations] = useState<GisOperation[]>([]);
  const gisDataCounterRef = useRef(0);
  const highlightTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const cesiumMapRef = useRef<CesiumMapRef>(null);
  const taskStreamModeTrackerRef = useRef(createTaskStreamModeTracker());

  const pushActiveGisData = useCallback((incoming: GisData, eventId: string) => {
    setActiveGisDataList((prev) => {
      if (prev.some((g) => g.eventId === eventId)) return prev;
      return [...prev, { ...incoming, eventId }];
    });
    const durationMs = incoming.highlightDurationMs;
    const transientRegionIds = incoming.transientRegionIds ?? [];
    const transientEntityIds = incoming.transientEntityIds ?? [];
    const hasTransientHighlight =
      durationMs &&
      durationMs > 0 &&
      (transientRegionIds.length > 0 || transientEntityIds.length > 0);

    if (hasTransientHighlight) {
      const regionIdSet = new Set(transientRegionIds);
      const entityIdSet = new Set(transientEntityIds);
      const existing = highlightTimersRef.current.get(eventId);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        highlightTimersRef.current.delete(eventId);
        setActiveGisDataList((prev) =>
          prev.map((g) => {
            if (g.eventId !== eventId) return g;
            return {
              ...g,
              regions: g.regions?.filter((r) => !regionIdSet.has(r.id)),
              entities: g.entities?.filter((e) => !entityIdSet.has(e.id)),
              highlightDurationMs: undefined,
              transientRegionIds: undefined,
              transientEntityIds: undefined,
            };
          })
        );
      }, durationMs);
      highlightTimersRef.current.set(eventId, timer);
    }
  }, []);

  useEffect(() => {
    return () => {
      highlightTimersRef.current.forEach((t) => clearTimeout(t));
      highlightTimersRef.current.clear();
    };
  }, []);

  // 从 activeGisDataList 中提取风场数据，驱动粒子层
  const windFieldGisData = useMemo(() => {
    return activeGisDataList.find((g) => g.windField && g.type === 'wind-field');
  }, [activeGisDataList]);

  const mapCanvasOverlay = useMemo(() => {
    if (!windFieldGisData?.windField) return null;
    return (
      <WindParticleCanvasOverlay
        enabled
        getViewer={() => cesiumMapRef.current?.getViewer() ?? null}
        windField={windFieldGisData.windField}
      />
    );
  }, [windFieldGisData]);

  // AIS 船舶实时数据状态
  const [aisEntities, setAisEntities] = useState<Entity[]>([]);
  const [aisTrajectories, setAisTrajectories] = useState<Trajectory[]>([]);

  // ADS 飞机实时数据状态
  const [adsEntities, setAdsEntities] = useState<Entity[]>([]);
  const [adsTrajectories, setAdsTrajectories] = useState<Trajectory[]>([]);

  // 稳定引用：避免每次渲染展开新数组导致 CesiumMap 内部 sync 频繁触发闪烁
  const allEntities = useMemo(() => [
    ...aisEntities,
    ...adsEntities,
  ], [aisEntities, adsEntities]);

  const allTrajectories = useMemo(() => [...aisTrajectories, ...adsTrajectories], [aisTrajectories, adsTrajectories]);

  // 客户端挂载后检查登录状态，避免 SSR 与客户端状态不一致导致闪现
  useEffect(() => {
    const stored = localStorage.getItem('isLoggedIn') === 'true';
    setIsLoggedIn(stored);
    setIsAuthChecked(true);
  }, []);

  // AIS 船舶数据：从后端 API 获取，确保前后端数据一致
  useEffect(() => {
    if (!isLoggedIn) return;

    let cancelled = false;

    // 将后端 ApiAisData 转换为前端 Entity/Trajectory 格式
    const transformAisData = (data: ApiAisData): { entities: Entity[]; trajectories: Trajectory[] } => {
      const entities: Entity[] = data.entities.map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type as Entity['type'],
        coordinates: e.coordinates,
        importance: e.importance as Entity['importance'],
        status: e.status as Entity['status'],
        description: e.description,
        speed: e.speed,
        heading: e.heading,
        dataSource: 'aisstream',
      }));
      const trajectories: Trajectory[] = data.trajectories.map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type as Trajectory['type'],
        coordinates: t.coordinates,
        status: t.status as Trajectory['status'],
      }));
      return { entities, trajectories };
    };

    // 初始加载
    getAisData()
      .then((data) => {
        if (cancelled) return;
        const { entities, trajectories } = transformAisData(data);
        setAisEntities(entities);
        setAisTrajectories(trajectories);
      })
      .catch((err) => {
        console.error('[AIS] Failed to load initial data:', err);
      });

    // 每 10 秒轮询一次，同步后端实时位置
    const interval = setInterval(() => {
      getAisData()
        .then((data) => {
          if (cancelled) return;
          const { entities, trajectories } = transformAisData(data);
          setAisEntities(entities);
          setAisTrajectories(trajectories);
        })
        .catch((err) => {
          console.error('[AIS] Failed to poll data:', err);
        });
    }, 10000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isLoggedIn]);

  // URL 参数自动连接 SSE（用于测试脚本调试）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const sseTaskId = params.get('sseTaskId');
    if (!sseTaskId) return;

    console.log('[page] Auto-connecting SSE for task:', sseTaskId);
    const evtSource = new EventSource(`http://localhost:3001/tasks/${sseTaskId}/stream`);

    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[page] SSE auto-connect msg:', data.type, data);
        const routed = routeTaskStreamEvent({
          taskId: sseTaskId,
          event: data,
          tracker: taskStreamModeTrackerRef.current,
        });
        if (routed.kind === 'agent-loop') {
          const pushes = extractGisPushesFromAgentLoopEvent(sseTaskId, routed.event);
          for (const push of pushes) {
            console.log('[page] Auto-received gisData (agent-loop):', push.source, push.key, push.gisData.type);
            pushActiveGisData(push.gisData, push.key);
          }
          const finish = getTaskFinishFromStreamEvent(routed.event);
          if (finish) {
            console.log('[page] Native task finished, closing auto SSE');
            evtSource.close();
            taskStreamModeTrackerRef.current.clear(sseTaskId);
            return;
          }
        }

        // GIS 数据：步骤完成时**直接 push** activeGisDataList（按 stepId 去重），
      } catch (err) {
        console.warn('[page] SSE auto-connect parse error:', err);
      }
    };

    evtSource.onerror = (err) => {
      console.error('[page] SSE auto-connect error:', err);
    };

    return () => {
      evtSource.close();
      taskStreamModeTrackerRef.current.clear(sseTaskId);
    };
  }, []);

  // ADS-B 飞机数据：从后端 API 获取，确保前后端数据一致
  useEffect(() => {
    if (!isLoggedIn) return;

    let cancelled = false;

    const transformAdsData = (data: ApiAdsData): {
      entities: Entity[];
      trajectories: Trajectory[];
    } => {
      const entities: Entity[] = data.entities.map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type as Entity['type'],
        coordinates: e.coordinates,
        importance: e.importance as Entity['importance'],
        status: e.status as Entity['status'],
        description: e.description,
        speed: e.speed,
        heading: e.heading,
        altitude: e.altitude,
      }));
      const trajectories: Trajectory[] = data.trajectories.map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type as Trajectory['type'],
        coordinates: t.coordinates,
        status: t.status as Trajectory['status'],
      }));
      return { entities, trajectories };
    };

    getAdsData()
      .then((data) => {
        if (cancelled) return;
        const { entities, trajectories } = transformAdsData(data);
        setAdsEntities(entities);
        setAdsTrajectories(trajectories);
      })
      .catch((err) => {
        console.error('[ADS-B] Failed to load initial data:', err);
      });

    const interval = setInterval(() => {
      getAdsData()
        .then((data) => {
          if (cancelled) return;
          const { entities, trajectories } = transformAdsData(data);
          setAdsEntities(entities);
          setAdsTrajectories(trajectories);
        })
        .catch((err) => {
          console.error('[ADS-B] Failed to poll data:', err);
        });
    }, 10_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isLoggedIn]);

  // 登录处理
  const handleLogin = useCallback(() => {
    setIsLoggedIn(true);
    localStorage.setItem('isLoggedIn', 'true');
  }, []);

  // 登出处理
  const handleLogout = useCallback(() => {
    setIsLoggedIn(false);
    setSelectedEntity(null);
    localStorage.removeItem('isLoggedIn');
  }, []);

  // 实体点击处理（点击同一实体时关闭弹窗）
  const handleEntityClick = useCallback((entity: Entity) => {
    setSelectedEntity((prev: Entity | null) => (prev?.id === entity.id ? null : entity));
  }, []);

  // 实体ID点击处理
  const handleEntityIdClick = useCallback((entityId: string) => {
    // mockData 已清空，暂不支持从静态数据查找实体
    console.log('[Entity] 实体点击:', entityId);
  }, []);

  // 洞察点击处理
  const handleInsightClick = useCallback((insight: Insight) => {
    if (insight.regionId) {
      console.log('[Insight] 区域点击:', insight.regionId);
      // mockData 已清空，暂不支持静态区域查找
    }
  }, []);

  // 发送消息处理
  const handleSendMessage = useCallback((message: string) => {
    console.log('发送消息:', message);
    // 这里可以调用API发送消息到后端
  }, []);

  // 任务创建处理（由 ChatPanel 触发）
  const handleTaskCreate = useCallback((task: Task, steps: ThinkingStep[], gisData?: GisData) => {
    const subTasks: SubTask[] = steps.map((step, index) => ({
      id: step.id,
      name: step.name,
      status: step.status === 'completed' ? ('completed' as const) : ('pending' as const),
      order: index + 1,
    }));

    const fullTask: Task = { ...task, subTasks };
    // 注意：不把 placeholder Task push 进 tasks state——避免和后端真实 jobTask（useRightPanelData 拉的 7 step 版）双重显示
    // placeholder 只用于本地 selectedTask（进度窗占位），等真实 task 数据到 → useEffect 自动 swap
    setShowChat(false);
    setSelectedTask(fullTask);
  }, []);

  // 真实 task 数据到来后自动把 selectedTask 从 placeholder swap 到真实版本
  // 兼容两条匹配路径：(a) 用户手动点击 task 卡片 → selectedTask.id = jobTask.id（直接 id 命中）
  //                  (b) handleTaskCreate placeholder → selectedTask.id = agent task id，需要走 jobTask.agentTaskId 命中
  // 详见 api/plan/auto-toggle-chat-and-task-panel.md Risk #4
  useEffect(() => {
    if (!selectedTask) return;
    console.log('[page] swap effect: selectedTask.id=', selectedTask.id, 'agentTaskId=', (selectedTask as Task & { agentTaskId?: string }).agentTaskId, 'apiTasks.length=', apiTasks.length);
    const realApi = apiTasks.find(
      (t) =>
        t.id === selectedTask.id ||
        (t as { agentTaskId?: string }).agentTaskId === selectedTask.id
    );
    console.log('[page] swap effect: realApi=', realApi ? `id=${realApi.id} agentTaskId=${(realApi as { agentTaskId?: string }).agentTaskId}` : 'NONE');
    if (!realApi) return;

    // 把 ApiTask 映射成 Task（含 agentTaskId 留存，方便 handleTaskFinished 兜底匹配）
    const mapped: Task & { agentTaskId?: string } = {
      id: realApi.id,
      name: realApi.name,
      type: realApi.type as Task['type'],
      executeTime: realApi.executeTime ? new Date(realApi.executeTime).getTime() : Date.now(),
      status: realApi.status as Task['status'],
      dataCount: realApi.dataCount,
      subTasks: realApi.subTasks?.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        status: s.status as SubTask['status'],
        order: s.order,
      })),
      agentTaskId: (realApi as { agentTaskId?: string }).agentTaskId,
    };

    // 避免无变化时反复 setState（按 status + subTasks 状态序列 hash 比较）
    const hashOf = (t: Task) =>
      `${t.status}|${t.subTasks?.map((s) => `${s.id}:${s.status}`).join(',') ?? ''}`;
    if (hashOf(mapped) === hashOf(selectedTask)) return;

    console.log('[page] swap effect: swapping selectedTask → real (status/subTasks changed)');
    setSelectedTask(mapped);
  }, [apiTasks, selectedTask]);

  // SSE: refresh apiTasks from native Agent Loop events so selectedTask stays in sync.
  useEffect(() => {
    const handleTaskCreated = (e: Event) => {
      const taskId = (e as CustomEvent).detail as string;
      refresh();
      taskStreamModeTrackerRef.current.preferNative(taskId);

      const evtSource = new EventSource(`http://localhost:3001/tasks/${taskId}/stream`);
      console.log('[page] SSE connected for task', taskId);

      evtSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[page] SSE msg:', data);
          const routed = routeTaskStreamEvent({
            taskId,
            event: data,
            tracker: taskStreamModeTrackerRef.current,
          });

          if (routed.kind === 'agent-loop') {
            if (isNativeAgentLoopProgressEvent(routed.event)) {
              console.log('[page] Native Agent Loop progress, refreshing...');
              refresh();
              return;
            }

            const finish = getTaskFinishFromStreamEvent(routed.event);
            if (finish) {
              console.log('[page] Native Agent Loop task finished, refreshing...');
              refresh();
              evtSource.close();
              taskStreamModeTrackerRef.current.clear(taskId);
              return;
            }
          }

          if (routed.kind === 'ignored-legacy') {
            return;
          }

        } catch (err) {
          console.warn('[page] SSE parse error:', err);
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

  // 任务整体结束（成功 / 失败）的联动
  // 详见 api/plan/auto-toggle-chat-and-task-panel.md
  const handleTaskFinished = useCallback(
    (taskId: string, status: 'completed' | 'failed') => {
      // 不论成功失败，都展开 ChatPanel 让用户看到结果消息 / 错误消息
      setShowChat(true);
      // 成功时关闭进度窗（仅当显示的就是这个 task；避免清掉用户中途切换看的其他 task）
      // 失败时进度窗保留，让用户看 failed subtask 细节
      // 兼容两路 id 匹配：placeholder selectedTask.id = agentTaskId；swap 后 selectedTask.id = jobTask.id 但 (selectedTask.agentTaskId) = agentTaskId
      if (status === 'completed') {
        setSelectedTask((prev) => {
          if (!prev) return prev;
          const matched =
            prev.id === taskId ||
            (prev as Task & { agentTaskId?: string }).agentTaskId === taskId;
          return matched ? null : prev;
        });
      }
    },
    []
  );

  // 事件标记已读
  const handleEventRead = useCallback((eventId: string) => {
    setEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, read: true } : e)));
  }, []);

  // 任务点击处理
  const handleTaskClick = useCallback((task: Task) => {
    setSelectedTask((prev) => (prev?.id === task.id ? null : task));
  }, []);

  // 关闭任务详情
  const handleCloseTaskDetail = useCallback(() => {
    setSelectedTask(null);
  }, []);

  // 事件地图联动点击处理（支持多事件同时展示）
  const handleEventGisClick = useCallback((eventId: string, data: GisData) => {
    console.log('[page] EventGisClick:', eventId, {
      type: data?.type,
      hasCameraView: !!data?.cameraView,
      cameraView: data?.cameraView,
      regionsCount: data?.regions?.length,
      entitiesCount: data?.entities?.length,
      imageOverlaysCount: data?.imageOverlays?.length,
    });
    setActiveGisIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
    setActiveGisDataList((prev) => {
      const exists = prev.some((g) => g.eventId === eventId);
      if (exists) {
        return prev.filter((g) => g.eventId !== eventId);
      }
      const event = events.find((e) => e.id === eventId);
      const eventName =
        event?.title ||
        event?.taskName ||
        data.entities?.[0]?.name ||
        data.trajectories?.[0]?.name ||
        'GIS数据';
      return [...prev, { ...data, eventId, eventName }];
    });
    // 关闭实体选中，避免弹窗重叠
    setSelectedEntity(null);
    // 关闭任务弹窗
    setSelectedTask(null);
  }, [events]);

  // 关闭指定事件的地图联动
  const handleCloseEventGis = useCallback((eventId: string) => {
    setActiveGisIds((prev) => {
      const next = new Set(prev);
      next.delete(eventId);
      return next;
    });
    setActiveGisDataList((prev) => prev.filter((g) => g.eventId !== eventId));
  }, []);

  // 关闭所有事件地图联动
  const handleCloseAllEventGis = useCallback(() => {
    setActiveGisIds(new Set());
    setActiveGisDataList([]);
  }, []);

  // GIS 操作指令：后端 capability 返回的 operations 自动触发
  const handleGisOperation = useCallback((operations: Array<Record<string, unknown>>) => {
    console.log('[page] Received GIS operations:', operations);
    setPendingOperations(operations as unknown as GisOperation[]);
  }, []);

  // 状态校验中：显示 loading，避免登录页闪现
  if (!isAuthChecked) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#121212]">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 relative text-[#00E0FF]">
            <LogoIcon size={80} className="animate-pulse" />
          </div>
          <div className="text-[#EAEAEA] font-medium">加载中...</div>
        </div>
      </div>
    );
  }

  // 渲染登录页面
  if (!isLoggedIn) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#121212] flex flex-col">
      {/* 顶部导航栏 - 简化版 */}
      <header className="h-12 bg-[#1E1E2E] border-b border-[#3A3A4E] flex items-center px-4 relative z-50">
        <div className="flex items-center gap-4 flex-shrink-0">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#00E0FF]/20 flex items-center justify-center text-[#00E0FF]">
              <LogoIcon size={36} />
            </div>
            <div>
              <div className="text-sm font-medium text-[#EAEAEA]">天元·认知计算</div>
            </div>
          </div>
        </div>

        {/* 中间：当前时间 */}
        <div className="flex-1 flex justify-center">
          <LiveClock />
        </div>

        {/* 右侧操作 */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* 移动端菜单按钮 */}
          <button
            onClick={() => setShowChat(!showChat)}
            className="md:hidden p-2 rounded-lg hover:bg-[#2A2A3E] text-[#8888AA] hover:text-[#EAEAEA] transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowRightPanel(!showRightPanel)}
            className="md:hidden p-2 rounded-lg hover:bg-[#2A2A3E] text-[#8888AA] hover:text-[#EAEAEA] transition-colors"
          >
            {showRightPanel ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          {/* 用户中心 */}
          <UserCenter user={mockUser} onLogout={handleLogout} />
        </div>
      </header>

      {/* 主内容区 */}
      <main className="flex-1 flex overflow-hidden relative">
        {/* 左侧问答模块 - 悬浮在地图之上 */}
        <aside
          className={`
            ${showChat ? 'w-full md:w-96' : 'w-0'}
            transition-all duration-300 overflow-hidden
            absolute left-0 top-0 h-full z-30
          `}
        >
          {/* ChatPanel 总是挂载——避免 showChat=false 时卸载，导致 useTaskChat SSE 连接断开 */}
          <div className="h-full p-2 md:p-3">
            <ChatPanel
              onSendMessage={handleSendMessage}
              onGisDataRequest={(gisData) => {
                const eventId = `auto-gis-${gisDataCounterRef.current++}`;
                pushActiveGisData(gisData, eventId);
              }}
              onTaskCreate={handleTaskCreate}
              onTaskFinished={handleTaskFinished}
              onGisOperation={handleGisOperation}
            />
          </div>
        </aside>

        {/* PC端左侧栏收起/展开按钮 */}
        <button
          onClick={() => setShowChat(!showChat)}
          className={`hidden md:flex absolute top-1/2 -translate-y-1/2 z-40 w-5 h-16 items-center justify-center bg-[#1E1E2E] border-y border-r border-[#3A3A4E] rounded-r-lg text-[#8888AA] hover:text-[#00E0FF] transition-all duration-300 cursor-pointer ${showChat ? 'left-96' : 'left-0'}`}
          title={showChat ? '收起左侧面板' : '展开左侧面板'}
        >
          {showChat ? (
            <ChevronLeft className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </button>

        {/* 中间地球引擎 */}
        <section className="flex-1 relative overflow-hidden min-w-0">
          <GisViewer
            cesiumMapRef={cesiumMapRef}
            mapCanvasOverlay={mapCanvasOverlay}
            entities={allEntities}
            trajectories={allTrajectories}
            regions={EMPTY_REGIONS}
            selectedEntity={selectedEntity}
            onEntityClick={handleEntityClick}
            selectedTask={selectedTask}
            onCloseTaskDetail={handleCloseTaskDetail}
            eventGisDataList={activeGisDataList}
            onCloseEventGis={handleCloseEventGis}
            onCloseAllEventGis={handleCloseAllEventGis}
            rightPanelOpen={showRightPanel}
            pendingOperations={pendingOperations}
          />

          {/* 移动端关闭按钮 */}
          {showChat && (
            <button
              onClick={() => setShowChat(false)}
              className="md:hidden absolute top-4 left-4 z-30 p-2 rounded-lg bg-[#1E1E2E] border border-[#3A3A4E] text-[#EAEAEA] hover:bg-[#2A2A3E] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </section>

        {/* PC端右侧栏收起/展开按钮 */}
        <button
          onClick={() => setShowRightPanel(!showRightPanel)}
          className={`hidden md:flex absolute top-1/2 -translate-y-1/2 z-40 w-5 h-16 items-center justify-center bg-[#1E1E2E] border-y border-l border-[#3A3A4E] rounded-l-lg text-[#8888AA] hover:text-[#00E0FF] transition-all duration-300 cursor-pointer ${showRightPanel ? 'right-96' : 'right-0'}`}
          title={showRightPanel ? '收起右侧面板' : '展开右侧面板'}
        >
          {showRightPanel ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </button>

        {/* 右侧Tab模块 - 悬浮在地图之上 */}
        <aside
          className={`
            ${showRightPanel ? 'w-full md:w-96' : 'w-0'}
            transition-all duration-300 overflow-hidden
            absolute right-0 top-0 h-full z-30
          `}
        >
          {showRightPanel && (
            <div className="h-full p-2 md:p-3">
              <RightPanel
                events={events}
                onInsightClick={handleInsightClick}
                onEntityClick={handleEntityIdClick}
                onTaskClick={handleTaskClick}
                onEventGisClick={handleEventGisClick}
                onAgentLoopGisClick={handleEventGisClick}
                onEventRead={handleEventRead}
                activeGisIds={activeGisIds}
              />
            </div>
          )}
        </aside>
      </main>

      {/* 底部状态栏 */}
      <footer className="h-8 bg-[#1E1E2E] border-t border-[#3A3A4E] flex items-center justify-between px-4 text-xs text-[#8888AA]">
        <div className="flex items-center gap-4">
          <span>在线</span>
          <span className="hidden sm:inline">|</span>
          <span className="hidden sm:inline">数据更新: 实时</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden sm:inline">当前用户: {mockUser.name}</span>
          <span>Intelligence Fusion Agent Platform v1.0</span>
        </div>
      </footer>
    </div>
  );
}
