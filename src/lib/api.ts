// API 客户端 - 对接后端展示数据接口
import type { ScenarioId } from "@datasourceintelligence/shared";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
export const AGENT_LOOP_FIXED_USER_ID = "agent-loop-local-user";

async function fetchJson<T>(path: string, options?: RequestInit, retries = 1): Promise<T> {
  const separator = path.includes("?") ? "&" : "?";
  const url = `${API_BASE}${path}${separator}_t=${Date.now()}`;
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      ...options,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  } catch (err) {
    const isNetworkError = err instanceof TypeError || (err instanceof Error && err.message.includes("fetch"));
    if (isNetworkError && retries > 0) {
      await new Promise((r) => setTimeout(r, 500));
      return fetchJson(path, options, retries - 1);
    }
    throw err;
  }
}

// ========== 可执行任务 ==========
export interface ApiTask {
  id: string;
  name: string;
  type: "daily" | "weekly" | "realtime";
  executeTime: string | null;
  status: "running" | "completed" | "partial" | "failed";
  dataCount: number;
  agentTaskId?: string;
  result?: Record<string, unknown> | null;
  subTasks?: ApiSubTask[];
}

export interface ApiSubTask {
  id: string;
  name: string;
  description?: string;
  status: "pending" | "running" | "completed" | "failed";
  order: number;
}

export async function getTasks(): Promise<{ tasks: ApiTask[] }> {
  return fetchJson("/jobs");
}

// ========== 事件 ==========
export interface ApiEvent {
  id: string;
  taskId?: string;
  taskName?: string;
  title: string;
  content: string;
  status: "success" | "partial" | "failed";
  timestamp: string;
  read: boolean;
  gisData?: {
    type: string;
    entities?: Array<{
      id: string;
      name: string;
      type: string;
      coordinates: [number, number];
      importance: string;
      status: string;
      description?: string;
    }>;
    trajectories?: Array<{
      id: string;
      name: string;
      type: string;
      coordinates: [number, number][];
      status: string;
    }>;
    regions?: Array<{
      id: string;
      name: string;
      type: string;
      coordinates: [number, number][];
    }>;
  };
}

export async function getEvents(): Promise<{ events: ApiEvent[] }> {
  return fetchJson("/events");
}

export async function getEventById(id: string): Promise<ApiEvent> {
  return fetchJson(`/events/${id}`);
}

export async function updateEventRead(id: string, read: boolean): Promise<void> {
  await fetchJson(`/events/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ read }),
  });
}

// ========== 订阅任务 ==========
export interface ApiSubscription {
  id: string;
  name: string;
  type: string;
  schedule: string;
  nextExecuteTime: string | null;
  status: "running" | "paused";
  entityId?: string;
  regionId?: string;
}

export async function getSubscriptions(): Promise<{ subscriptions: ApiSubscription[] }> {
  return fetchJson("/subscriptions");
}

export async function updateSubscriptionStatus(id: string, status: "running" | "paused"): Promise<void> {
  await fetchJson(`/subscriptions/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

// ========== AI 洞察 ==========
export interface ApiInsight {
  id: string;
  category: "geopolitics" | "military" | "industry";
  title: string;
  summary: string;
  content: string;
  riskLevel: "high" | "medium" | "low" | "safe";
  entityId?: string;
  regionId?: string;
  sources?: string[];
  createdAt?: string;
}

export async function getInsights(): Promise<{ insights: ApiInsight[] }> {
  return fetchJson("/insights");
}

export async function getInsightById(id: string): Promise<ApiInsight> {
  return fetchJson(`/insights/${id}`);
}

// ========== 定制需求 ==========
export interface ApiRequirement {
  id: string;
  description: string;
  chatId: string;
  status: "pending" | "processing" | "rejected";
  requirementId?: string;
  timestamp: string;
}

export async function getRequirements(): Promise<{ requirements: ApiRequirement[] }> {
  return fetchJson("/requirements");
}

// ========== Agent 编排任务（创建新任务入口） ==========
export async function createAgentTask(
  query: string,
  options: { scenarioId?: ScenarioId } = {},
): Promise<{
  taskId: string;
  status: string;
}> {
  return fetchJson("/tasks", {
    method: "POST",
    body: JSON.stringify({ query, userId: AGENT_LOOP_FIXED_USER_ID, scenarioId: options.scenarioId }),
  });
}

// ========== AIS 实时数据 ==========
export interface ApiAisData {
  entities: Array<{
    id: string;
    name: string;
    type: string;
    coordinates: [number, number];
    importance: string;
    status: string;
    description: string;
    speed: number;
    heading: number;
  }>;
  trajectories: Array<{
    id: string;
    name: string;
    type: string;
    coordinates: [number, number][];
    status: string;
  }>;
  timestamp: string;
  count: number;
}

export async function getAisData(): Promise<ApiAisData> {
  return fetchJson("/ais/data");
}

// ========== ADS-B 实时数据 ==========
export interface ApiAdsData {
  entities: Array<{
    id: string;
    name: string;
    type: string;
    coordinates: [number, number];
    importance: string;
    status: string;
    description: string;
    speed: number;
    heading: number;
    altitude: number;
  }>;
  trajectories: Array<{
    id: string;
    name: string;
    type: string;
    coordinates: [number, number][];
    status: string;
  }>;
  timestamp: string;
  count: number;
}

export async function getAdsData(): Promise<ApiAdsData> {
  return fetchJson("/ads/data");
}

// ========== 信息中心（聚合查询） ==========
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

export async function getInfoCenterItems(params: {
  page?: number;
  pageSize?: number;
  type?: string;
  status?: string;
  source?: string;
  startTime?: string;
  endTime?: string;
  taskId?: string;
  search?: string;
}): Promise<InfoCenterResult> {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  if (params.type) qs.set("type", params.type);
  if (params.status) qs.set("status", params.status);
  if (params.source) qs.set("source", params.source);
  if (params.startTime) qs.set("startTime", params.startTime);
  if (params.endTime) qs.set("endTime", params.endTime);
  if (params.taskId) qs.set("taskId", params.taskId);
  if (params.search) qs.set("search", params.search);
  return fetchJson(`/info-center?${qs.toString()}`);
}

// ========== Agent 任务详情 ==========
export async function exportInfoCenter(params: {
  type?: string;
  status?: string;
  source?: string;
  startTime?: string;
  endTime?: string;
  taskId?: string;
  search?: string;
}): Promise<Blob> {
  const qs = new URLSearchParams();
  if (params.type) qs.set("type", params.type);
  if (params.status) qs.set("status", params.status);
  if (params.source) qs.set("source", params.source);
  if (params.startTime) qs.set("startTime", params.startTime);
  if (params.endTime) qs.set("endTime", params.endTime);
  if (params.taskId) qs.set("taskId", params.taskId);
  if (params.search) qs.set("search", params.search);
  const res = await fetch(`${API_BASE}/info-center/export?${qs.toString()}`, {
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.blob();
}

// ========== Agent 任务详情 ==========
export async function getTask(taskId: string): Promise<{
  taskId: string;
  status: string;
  query: string;
  plan: unknown;
  actions: unknown[];
  result: Record<string, unknown> | null;
  error: string | null;
  steps: Array<{
    id: string;
    actionType: string;
    status: string;
    result: Record<string, unknown> | null;
    error: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}> {
  return fetchJson(`/tasks/${taskId}`);
}
