import { eq, desc, and, gte, lte, ilike, or } from "drizzle-orm";
import { db } from "../../config/database.js";
import { events, insights, jobTasks } from "../../db/schema.js";

export interface InfoCenterQuery {
  page: number;
  pageSize: number;
  type: string[];
  status?: string[];
  source?: ("instant" | "subscription")[];
  startTime?: string;
  endTime?: string;
  taskId?: string;
  search?: string;
}

export interface InfoItem {
  id: string;
  itemType: "event" | "insight";
  title: string;
  summary: string;
  status: string;
  category?: string;
  sourceTaskId?: string;
  sourceTaskName?: string;
  sourceTaskType?: "instant" | "subscription";
  agentTaskId?: string;
  timestamp: string;
  meta?: {
    gisEnabled?: boolean;
  };
}

export interface InfoCenterResult {
  items: InfoItem[];
  total: number;
  page: number;
  pageSize: number;
}

const EVENT_STATUSES = new Set(["success", "partial", "failed"]);
const INSIGHT_STATUS_MAP: Record<string, string> = {
  high_risk: "high",
  medium_risk: "medium",
  low_risk: "low",
  safe: "safe",
};

function buildEventWhere(
  statusFilter: string[] | undefined,
  startTime: Date | undefined,
  endTime: Date | undefined,
  taskId: string | undefined,
  search: string | undefined
) {
  const conditions = [];

  if (statusFilter && statusFilter.length > 0) {
    const raw = statusFilter.filter((s) => EVENT_STATUSES.has(s));
    if (raw.length === 1) {
      conditions.push(eq(events.status, raw[0] as "success" | "partial" | "failed"));
    } else if (raw.length > 1) {
      conditions.push(or(...raw.map((s) => eq(events.status, s as "success" | "partial" | "failed")))!);
    }
  }
  if (startTime) conditions.push(gte(events.timestamp, startTime));
  if (endTime) conditions.push(lte(events.timestamp, endTime));
  if (taskId) conditions.push(eq(events.taskId, taskId));
  if (search) {
    const p = `%${search}%`;
    conditions.push(or(ilike(events.title, p), ilike(events.content, p))!);
  }

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return and(...conditions);
}

function buildInsightWhere(
  statusFilter: string[] | undefined,
  startTime: Date | undefined,
  endTime: Date | undefined,
  search: string | undefined
) {
  const conditions = [];

  if (statusFilter && statusFilter.length > 0) {
    const raw = statusFilter
      .map((s) => INSIGHT_STATUS_MAP[s])
      .filter(Boolean) as ("high" | "medium" | "low" | "safe")[];
    if (raw.length === 1) {
      conditions.push(eq(insights.riskLevel, raw[0]));
    } else if (raw.length > 1) {
      conditions.push(or(...raw.map((l) => eq(insights.riskLevel, l)))!);
    }
  }
  if (startTime) conditions.push(gte(insights.createdAt, startTime));
  if (endTime) conditions.push(lte(insights.createdAt, endTime));
  if (search) {
    const p = `%${search}%`;
    conditions.push(or(ilike(insights.title, p), ilike(insights.summary, p))!);
  }

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return and(...conditions);
}

export async function getInfoCenterItems(params: InfoCenterQuery): Promise<InfoCenterResult> {
  const {
    page,
    pageSize,
    type,
    status: statusFilter,
    startTime: startTimeStr,
    endTime: endTimeStr,
    taskId,
    search,
  } = params;

  const startTime = startTimeStr ? new Date(startTimeStr) : undefined;
  const endTime = endTimeStr ? new Date(endTimeStr) : undefined;

  // 预加载 job_tasks，建立 id→{name,type,agentTaskId} 和 agentTaskId→{id,name,type} 映射
  const allJobTasks = await db.select({ id: jobTasks.id, name: jobTasks.name, type: jobTasks.type, agentTaskId: jobTasks.agentTaskId }).from(jobTasks);
  const jobTaskById = new Map<string, { name: string; type: string | null; agentTaskId: string | null }>();
  const jobTaskByAgentId = new Map<string, { id: string; name: string; type: string | null }>();
  for (const jt of allJobTasks) {
    jobTaskById.set(jt.id, { name: jt.name ?? "", type: jt.type, agentTaskId: jt.agentTaskId });
    if (jt.agentTaskId) {
      jobTaskByAgentId.set(jt.agentTaskId, { id: jt.id, name: jt.name ?? "", type: jt.type });
    }
  }

  function inferSourceType(taskType: string | null): "instant" | "subscription" | undefined {
    if (!taskType) return undefined;
    return taskType === "realtime" ? "instant" : "subscription";
  }

  // taskId 过滤 insights 时：获取该 jobTask 对应的 agentTaskId
  let targetAgentTaskId: string | undefined;
  if (taskId) {
    const jt = jobTaskById.get(taskId);
    if (jt?.agentTaskId) targetAgentTaskId = jt.agentTaskId;
  }

  const items: InfoItem[] = [];

  if (type.includes("event")) {
    const where = buildEventWhere(statusFilter, startTime, endTime, taskId, search);
    const query = where
      ? db.select().from(events).where(where).orderBy(desc(events.timestamp))
      : db.select().from(events).orderBy(desc(events.timestamp));
    const rows = await query;

    for (const row of rows) {
      const jt = row.taskId ? jobTaskById.get(row.taskId) : undefined;
      const sourceTaskType = inferSourceType(jt?.type ?? null);
      // source 筛选
      if (params.source && params.source.length > 0 && sourceTaskType && !params.source.includes(sourceTaskType)) {
        continue;
      }
      items.push({
        id: row.id,
        itemType: "event",
        title: row.title,
        summary: row.content.length > 120 ? row.content.slice(0, 120) + "..." : row.content,
        status: row.status,
        sourceTaskId: row.taskId ?? undefined,
        sourceTaskName: jt?.name || undefined,
        sourceTaskType,
        agentTaskId: row.agentTaskId ?? undefined,
        timestamp: row.timestamp.toISOString(),
        meta: { gisEnabled: !!row.gisData },
      });
    }
  }

  if (type.includes("insight")) {
    const where = buildInsightWhere(statusFilter, startTime, endTime, search);
    const query = where
      ? db.select().from(insights).where(where).orderBy(desc(insights.createdAt))
      : db.select().from(insights).orderBy(desc(insights.createdAt));
    const rows = await query;

    for (const row of rows) {
      // taskId 精确过滤
      if (taskId) {
        if (!targetAgentTaskId || row.agentTaskId !== targetAgentTaskId) continue;
      }

      const jt = row.agentTaskId ? jobTaskByAgentId.get(row.agentTaskId) : undefined;
      const sourceTaskType = inferSourceType(jt?.type ?? null);
      // source 筛选
      if (params.source && params.source.length > 0 && sourceTaskType && !params.source.includes(sourceTaskType)) {
        continue;
      }
      items.push({
        id: row.id,
        itemType: "insight",
        title: row.title,
        summary: row.summary,
        status: row.riskLevel,
        category: row.category,
        sourceTaskId: jt?.id,
        sourceTaskName: jt?.name || undefined,
        sourceTaskType,
        agentTaskId: row.agentTaskId ?? undefined,
        timestamp: row.createdAt.toISOString(),
        meta: {},
      });
    }
  }

  // 统一按时间倒序
  items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const total = items.length;
  const offset = (page - 1) * pageSize;
  const paginated = items.slice(offset, offset + pageSize);

  return { items: paginated, total, page, pageSize };
}

// ========== CSV 导出（不分页，限制 5000 条） ==========

export async function exportInfoCenterToCSV(
  params: Omit<InfoCenterQuery, "page" | "pageSize">
): Promise<string> {
  const {
    type,
    status: statusFilter,
    startTime: startTimeStr,
    endTime: endTimeStr,
    taskId,
    search,
  } = params;

  const startTime = startTimeStr ? new Date(startTimeStr) : undefined;
  const endTime = endTimeStr ? new Date(endTimeStr) : undefined;

  const allJobTasks = await db.select({ id: jobTasks.id, name: jobTasks.name, type: jobTasks.type, agentTaskId: jobTasks.agentTaskId }).from(jobTasks);
  const jobTaskById = new Map<string, { name: string; type: string | null; agentTaskId: string | null }>();
  const jobTaskByAgentId = new Map<string, { id: string; name: string; type: string | null }>();
  for (const jt of allJobTasks) {
    jobTaskById.set(jt.id, { name: jt.name ?? "", type: jt.type, agentTaskId: jt.agentTaskId });
    if (jt.agentTaskId) {
      jobTaskByAgentId.set(jt.agentTaskId, { id: jt.id, name: jt.name ?? "", type: jt.type });
    }
  }

  let targetAgentTaskId: string | undefined;
  if (taskId) {
    const jt = jobTaskById.get(taskId);
    if (jt?.agentTaskId) targetAgentTaskId = jt.agentTaskId;
  }

  const items: InfoItem[] = [];

  if (type.includes("event")) {
    const where = buildEventWhere(statusFilter, startTime, endTime, taskId, search);
    const query = where
      ? db.select().from(events).where(where).orderBy(desc(events.timestamp)).limit(5000)
      : db.select().from(events).orderBy(desc(events.timestamp)).limit(5000);
    const rows = await query;
    for (const row of rows) {
      const jt = row.taskId ? jobTaskById.get(row.taskId) : undefined;
      const sourceTaskType = jt?.type === "realtime" ? "instant" : jt?.type ? "subscription" : undefined;
      if (params.source && params.source.length > 0 && sourceTaskType && !params.source.includes(sourceTaskType)) {
        continue;
      }
      items.push({
        id: row.id,
        itemType: "event",
        title: row.title,
        summary: row.content,
        status: row.status,
        sourceTaskId: row.taskId ?? undefined,
        sourceTaskName: jt?.name || undefined,
        sourceTaskType,
        agentTaskId: row.agentTaskId ?? undefined,
        timestamp: row.timestamp.toISOString(),
        meta: { gisEnabled: !!row.gisData },
      });
    }
  }

  if (type.includes("insight")) {
    const where = buildInsightWhere(statusFilter, startTime, endTime, search);
    const query = where
      ? db.select().from(insights).where(where).orderBy(desc(insights.createdAt)).limit(5000)
      : db.select().from(insights).orderBy(desc(insights.createdAt)).limit(5000);
    const rows = await query;
    for (const row of rows) {
      if (taskId) {
        if (!targetAgentTaskId || row.agentTaskId !== targetAgentTaskId) continue;
      }
      const jt = row.agentTaskId ? jobTaskByAgentId.get(row.agentTaskId) : undefined;
      const sourceTaskType = jt?.type === "realtime" ? "instant" : jt?.type ? "subscription" : undefined;
      if (params.source && params.source.length > 0 && sourceTaskType && !params.source.includes(sourceTaskType)) {
        continue;
      }
      items.push({
        id: row.id,
        itemType: "insight",
        title: row.title,
        summary: row.summary,
        status: row.riskLevel,
        category: row.category,
        sourceTaskId: jt?.id,
        sourceTaskName: jt?.name || undefined,
        sourceTaskType,
        agentTaskId: row.agentTaskId ?? undefined,
        timestamp: row.createdAt.toISOString(),
        meta: {},
      });
    }
  }

  items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  // 最终截断 5000 条
  const finalItems = items.slice(0, 5000);

  // 生成 CSV
  const headers = ["类型", "标题", "关联任务", "来源", "状态", "分类", "时间", "摘要"];
  const rows = finalItems.map((item) => [
    item.itemType === "event" ? "事件" : "洞察",
    escapeCsv(item.title),
    escapeCsv(item.sourceTaskName || ""),
    item.sourceTaskType === "instant" ? "即时" : item.sourceTaskType === "subscription" ? "订阅" : "",
    item.status,
    item.category === "geopolitics" ? "地缘" : item.category === "military" ? "军事" : item.category === "industry" ? "产业" : "",
    item.timestamp,
    escapeCsv(item.summary),
  ]);

  const lines = [headers.join(","), ...rows.map((r) => r.join(","))];
  return "\uFEFF" + lines.join("\n"); // UTF-8 BOM
}

function escapeCsv(value: string): string {
  if (!value) return "";
  const needsEscape = /[",\n\r]/.test(value);
  if (!needsEscape) return value;
  return '"' + value.replace(/"/g, '""') + '"';
}
