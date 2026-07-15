import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../../config/database.js";
import {
  aircraftCurrentStates,
  aisCurrentStates,
  events,
  insights,
  jobTasks,
  requirements,
  subscriptions,
  tasks,
  taskSteps,
} from "../../db/schema.js";
import {
  emptyAisData,
  projectAgentTaskToApiTask,
  projectAircraftStatesToAdsData,
  projectAisStatesToAisData,
  projectTaskStepToSyntheticEvent,
  type ApiEvent,
  type ApiTask,
} from "./projection.js";

const DEFAULT_LIST_LIMIT = 100;

export async function listJobs(): Promise<{ tasks: ApiTask[] }> {
  const [jobRows, agentTasks] = await Promise.all([
    db.select().from(jobTasks).orderBy(desc(jobTasks.createdAt)).limit(DEFAULT_LIST_LIMIT),
    db.select().from(tasks).orderBy(desc(tasks.createdAt)).limit(DEFAULT_LIST_LIMIT),
  ]);

  const agentTaskIds = agentTasks.map((task) => task.id);
  const stepRows = agentTaskIds.length
    ? await db.select().from(taskSteps).where(inArray(taskSteps.taskId, agentTaskIds))
    : [];
  const stepsByTaskId = groupBy(stepRows, (step) => step.taskId);
  const jobAgentIds = new Set(jobRows.map((job) => job.agentTaskId).filter(Boolean));
  const agentTaskById = new Map(agentTasks.map((task) => [task.id, task]));

  const projectedJobs: ApiTask[] = jobRows.map((job) => ({
    id: job.id,
    name: job.name,
    type: job.type,
    executeTime: job.executeTime ? job.executeTime.toISOString() : null,
    status: job.status,
    dataCount: job.dataCount ?? 0,
    agentTaskId: job.agentTaskId ?? undefined,
    result: job.agentTaskId ? agentTaskById.get(job.agentTaskId)?.result ?? undefined : undefined,
    subTasks: Array.isArray(job.subTasks) ? (job.subTasks as ApiTask["subTasks"]) : undefined,
  }));

  const projectedAgentTasks = agentTasks
    .filter((task) => !jobAgentIds.has(task.id))
    .map((task) => projectAgentTaskToApiTask(task, stepsByTaskId.get(task.id) ?? []));

  return { tasks: [...projectedJobs, ...projectedAgentTasks] };
}

export async function listEvents(): Promise<{ events: ApiEvent[] }> {
  const eventRows = await db.select().from(events).orderBy(desc(events.timestamp)).limit(DEFAULT_LIST_LIMIT);
  const realEvents = eventRows.map(projectEventRow);
  const realEventKeys = new Set(
    eventRows
      .map((event) => event.agentTaskId ? `${event.agentTaskId}:${event.title}` : "")
      .filter(Boolean),
  );

  const recentTasks = await db.select().from(tasks).orderBy(desc(tasks.createdAt)).limit(DEFAULT_LIST_LIMIT);
  const taskIds = recentTasks.map((task) => task.id);
  const taskById = new Map(recentTasks.map((task) => [task.id, task]));
  const stepRows = taskIds.length
    ? await db.select().from(taskSteps).where(inArray(taskSteps.taskId, taskIds))
    : [];

  const syntheticEvents = stepRows
    .filter((step) => step.status === "completed" || step.status === "failed")
    .filter((step) => !realEventKeys.has(`${step.taskId}:${step.actionType}`))
    .map((step) => {
      const task = taskById.get(step.taskId);
      return task ? projectTaskStepToSyntheticEvent(task, step) : undefined;
    })
    .filter((event): event is ApiEvent => Boolean(event));

  return {
    events: [...realEvents, ...syntheticEvents].sort((left, right) =>
      Date.parse(right.timestamp) - Date.parse(left.timestamp)
    ),
  };
}

export async function getEventById(id: string): Promise<ApiEvent | null> {
  const [event] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  if (event) return projectEventRow(event);

  const [step] = await db.select().from(taskSteps).where(eq(taskSteps.id, id)).limit(1);
  if (!step) return null;
  const [task] = await db.select().from(tasks).where(eq(tasks.id, step.taskId)).limit(1);
  if (!task) return null;
  return projectTaskStepToSyntheticEvent(task, step);
}

export async function updateEventRead(id: string, read: boolean): Promise<void> {
  await db.update(events).set({ read }).where(eq(events.id, id));
}

export async function listSubscriptions() {
  const rows = await db.select().from(subscriptions).orderBy(desc(subscriptions.createdAt)).limit(DEFAULT_LIST_LIMIT);
  return {
    subscriptions: rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      schedule: row.schedule,
      nextExecuteTime: row.nextExecuteTime ? row.nextExecuteTime.toISOString() : null,
      status: row.status,
      entityId: row.entityId ?? undefined,
      regionId: row.regionId ?? undefined,
    })),
  };
}

export async function updateSubscriptionStatus(id: string, status: "running" | "paused"): Promise<void> {
  await db.update(subscriptions).set({ status, updatedAt: new Date() }).where(eq(subscriptions.id, id));
}

export async function listRequirements() {
  const rows = await db.select().from(requirements).orderBy(desc(requirements.timestamp)).limit(DEFAULT_LIST_LIMIT);
  return {
    requirements: rows.map((row) => ({
      id: row.id,
      description: row.description,
      chatId: row.chatId,
      status: row.status,
      requirementId: row.requirementId ?? undefined,
      timestamp: row.timestamp.toISOString(),
    })),
  };
}

export async function listInsights() {
  const rows = await db.select().from(insights).orderBy(desc(insights.createdAt)).limit(DEFAULT_LIST_LIMIT);
  return {
    insights: rows.map(projectInsightRow),
  };
}

export async function getInsightById(id: string) {
  const [insight] = await db.select().from(insights).where(eq(insights.id, id)).limit(1);
  return insight ? projectInsightRow(insight) : null;
}

export async function getAdsData() {
  const states = await db
    .select()
    .from(aircraftCurrentStates)
    .orderBy(desc(aircraftCurrentStates.updatedAt))
    .limit(20000);
  return projectAircraftStatesToAdsData(states);
}

export async function getAisData() {
  const states = await db.select().from(aisCurrentStates).limit(1000);
  return projectAisStatesToAisData(states);
}

function projectEventRow(row: typeof events.$inferSelect): ApiEvent {
  return {
    id: row.id,
    taskId: row.taskId ?? undefined,
    taskName: row.taskName ?? undefined,
    title: row.title,
    content: row.content,
    status: row.status,
    timestamp: row.timestamp.toISOString(),
    read: row.read,
    gisData: row.gisData ?? undefined,
    agentTaskId: row.agentTaskId ?? undefined,
  };
}

function projectInsightRow(row: typeof insights.$inferSelect) {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    summary: row.summary,
    content: row.content,
    riskLevel: row.riskLevel,
    entityId: row.entityId ?? undefined,
    regionId: row.regionId ?? undefined,
    sources: Array.isArray(row.sources) ? row.sources : undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

function groupBy<T, K>(items: T[], keyOf: (item: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      grouped.set(key, [item]);
    }
  }
  return grouped;
}
