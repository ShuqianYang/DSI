import type { TaskEvent, Task } from "@/types/prd";

// 把扁平 events 按 taskId 聚合成"信息包"分组。
// 一个 query → 后端 executor 跑 N 个 capability → N 条 events 共享同一个 taskId (= jobTaskId)。
// 前端 group by taskId 把同一查询下的所有 subtask 事件聚合到一张"信息包卡片"展示。
// 详见 api/plan/events-group-by-jobtask.md

export interface EventGroup {
  /** taskId 为 null = 没有关联 jobTask（兜底分组） */
  taskId: string | null;
  /** 对应的 jobTask 数据；null = events.taskId 未匹配到任何 task（兜底） */
  task: Task | null;
  /** 该 group 下所有 events，按 timestamp asc 排（先完成的 subtask 在上） */
  events: TaskEvent[];
  /** 该 group 内最新一条 event 的时间戳（ms），用于外层 group 间排序 */
  latestTimestamp: number;
}

/**
 * 把扁平 events 列表按 taskId 聚合成信息包分组。
 *
 * 行为：
 * - 按 events.taskId 分组；taskId 为 undefined/null 的归入 "_unattached" 兜底组
 * - 每个 group 通过 taskMap 找到对应的 jobTask
 * - group 内 events 按 timestamp asc 排（先完成的 subtask 在上）
 * - group 之间按 latestTimestamp desc 排（最新活跃的信息包在最上）
 *
 * Pure function：不修改输入，输出新数组。
 */
export function groupEventsByTask(
  events: TaskEvent[],
  tasks: Task[]
): EventGroup[] {
  const taskMap = new Map<string, Task>(tasks.map((t) => [t.id, t]));
  const groupMap = new Map<string, EventGroup>();

  for (const e of events) {
    const key = e.taskId ?? "_unattached";
    let group = groupMap.get(key);
    if (!group) {
      group = {
        taskId: e.taskId ?? null,
        task: e.taskId ? taskMap.get(e.taskId) ?? null : null,
        events: [],
        latestTimestamp: 0,
      };
      groupMap.set(key, group);
    }
    group.events.push(e);
    const t = Number.isFinite(e.timestamp) ? e.timestamp : 0;
    if (t > group.latestTimestamp) group.latestTimestamp = t;
  }

  // group 内 events 按 timestamp asc 排
  for (const g of groupMap.values()) {
    g.events.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  }

  // group 之间按 latestTimestamp desc 排
  return Array.from(groupMap.values()).sort(
    (a, b) => b.latestTimestamp - a.latestTimestamp
  );
}

