'use client';

import { useEffect, useRef, useCallback } from 'react';
import { eventSourceUrl, getTasks } from '@/lib/api';
import {
  shouldCloseInfoCenterStreamForEvent,
  shouldRefreshInfoCenterForStreamEvent,
} from '@/lib/infoCenterAgentLoop';

interface UseInfoCenterStreamOptions {
  refresh: () => void;
  enabled?: boolean;
}

export function useInfoCenterStream({ refresh, enabled = true }: UseInfoCenterStreamOptions) {
  const connectionsRef = useRef<Map<string, EventSource>>(new Map());

  const closeAll = useCallback(() => {
    for (const [id, es] of connectionsRef.current) {
      console.log('[InfoCenterStream] Closing SSE for task', id);
      es.close();
    }
    connectionsRef.current.clear();
  }, []);

  const connect = useCallback(
    (agentTaskId: string) => {
      if (connectionsRef.current.has(agentTaskId)) return;

      const evtSource = new EventSource(eventSourceUrl(`/tasks/${agentTaskId}/stream`));
      connectionsRef.current.set(agentTaskId, evtSource);
      console.log('[InfoCenterStream] SSE connected for task', agentTaskId);

      evtSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[InfoCenterStream] SSE msg:', data.type, 'task:', agentTaskId);

          if (shouldRefreshInfoCenterForStreamEvent(data)) {
            refresh();
          }

          if (shouldCloseInfoCenterStreamForEvent(data)) {
            evtSource.close();
            connectionsRef.current.delete(agentTaskId);
            return;
          }
        } catch (err) {
          console.warn('[InfoCenterStream] SSE parse error:', err);
        }
      };

      evtSource.onerror = () => {
        console.warn('[InfoCenterStream] SSE error for task', agentTaskId);
        evtSource.close();
        connectionsRef.current.delete(agentTaskId);
      };
    },
    [refresh]
  );

  // 定期扫描 running 任务，建立 SSE 连接
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    async function scanAndConnect() {
      try {
        const res = await getTasks();
        const tasks = res.tasks || [];
        const runningAgentIds = tasks
          .filter((t) => t.status === 'running')
          .map((t) => t.agentTaskId)
          .filter((id): id is string => !!id);

        // 关闭已不在 running 列表中的连接
        for (const [id, es] of connectionsRef.current) {
          if (!runningAgentIds.includes(id)) {
            console.log('[InfoCenterStream] Task no longer running, closing SSE', id);
            es.close();
            connectionsRef.current.delete(id);
          }
        }

        // 为新的 running 任务建立连接
        for (const agentTaskId of runningAgentIds) {
          if (!cancelled) {
            connect(agentTaskId);
          }
        }
      } catch (err) {
        console.warn('[InfoCenterStream] Failed to scan running tasks:', err);
      }
    }

    // 立即执行一次
    scanAndConnect();

    // 每 10 秒扫描一次 running 任务列表
    const interval = setInterval(scanAndConnect, 10000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      closeAll();
    };
  }, [enabled, connect, closeAll]);

  // 兜底：每 5 秒轮询一次
  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(() => {
      console.log('[InfoCenterStream] Polling tick (5s)');
      refresh();
    }, 5000);

    return () => clearInterval(interval);
  }, [enabled, refresh]);
}
