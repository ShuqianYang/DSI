type TaskStatus = "pending" | "running" | "completed" | "failed";
type StepStatus = "pending" | "running" | "completed" | "failed";

interface AgentTaskLike {
  id: string;
  query: string;
  status: TaskStatus;
  createdAt: Date | string;
  updatedAt?: Date | string;
  completedAt?: Date | string | null;
}

interface TaskStepLike {
  id: string;
  taskId: string;
  actionType: string;
  actionConfig: unknown;
  status: StepStatus;
  result: unknown;
  error?: string | null;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
}

export interface ApiSubTask {
  id: string;
  name: string;
  description?: string;
  status: StepStatus;
  order: number;
}

export interface ApiTask {
  id: string;
  name: string;
  type: "daily" | "weekly" | "realtime";
  executeTime: string | null;
  status: "running" | "completed" | "partial" | "failed";
  dataCount: number;
  agentTaskId?: string;
  subTasks?: ApiSubTask[];
}

export interface ApiEvent {
  id: string;
  taskId?: string;
  taskName?: string;
  title: string;
  content: string;
  status: "success" | "partial" | "failed";
  timestamp: string;
  read: boolean;
  gisData?: unknown;
  agentTaskId?: string;
}

export interface AircraftStateLike {
  icao24: string;
  callsign?: string | null;
  originCountry?: string | null;
  longitude?: number | null;
  latitude?: number | null;
  baroAltitude?: number | null;
  velocity?: number | null;
  trueTrack?: number | null;
  status?: string | null;
  updatedAt?: Date | string | null;
  sourceTime?: Date | string | null;
}

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

export function projectAgentTaskToApiTask(task: AgentTaskLike, steps: TaskStepLike[]): ApiTask {
  const orderedSteps = [...steps].sort((left, right) => stepOrder(left) - stepOrder(right));
  return {
    id: task.id,
    name: truncate(task.query, 32),
    type: "realtime",
    executeTime: null,
    status: projectTaskStatus(task.status),
    dataCount: orderedSteps.filter((step) => step.status === "completed").length,
    agentTaskId: task.id,
    subTasks: orderedSteps.map((step, index) => ({
      id: step.id,
      name: stepName(step),
      description: stepDescription(step),
      status: step.status,
      order: stepOrder(step, index + 1),
    })),
  };
}

export function projectTaskStepToSyntheticEvent(
  task: AgentTaskLike,
  step: TaskStepLike,
): ApiEvent {
  return {
    id: step.id,
    taskId: task.id,
    taskName: truncate(task.query, 32),
    title: stepName(step),
    content: summarizeStepContent(step),
    status: projectEventStatus(step.status),
    timestamp: toIso(step.completedAt || step.startedAt || task.createdAt),
    read: false,
    gisData: extractGisData(step.result),
    agentTaskId: task.id,
  };
}

export function projectAircraftStatesToAdsData(states: AircraftStateLike[]): ApiAdsData {
  const validStates = states.filter((state) => isFiniteNumber(state.longitude) && isFiniteNumber(state.latitude));
  const timestamp = latestTimestamp(validStates.map((state) => state.updatedAt || state.sourceTime));
  const entities = validStates.map((state) => {
    const name = state.callsign?.trim() || state.icao24;
    const altitude = isFiniteNumber(state.baroAltitude) ? state.baroAltitude : 0;
    const speed = isFiniteNumber(state.velocity) ? Math.round(state.velocity * 3.6) : 0;
    const heading = isFiniteNumber(state.trueTrack) ? state.trueTrack : 0;
    const country = state.originCountry?.trim() || "Unknown";
    return {
      id: `opensky-${state.icao24}`,
      name,
      type: "aircraft",
      coordinates: [state.longitude as number, state.latitude as number] as [number, number],
      importance: "low",
      status: normalizeEntityStatus(state.status),
      description: `OpenSky | country:${country} | altitude:${Math.round(altitude)}m | speed:${speed}km/h | heading:${Math.round(heading)}deg`,
      speed,
      heading,
      altitude,
    };
  });

  return {
    entities,
    trajectories: [],
    timestamp,
    count: entities.length,
  };
}

export function emptyAisData(): ApiAisData {
  return {
    entities: [],
    trajectories: [],
    timestamp: new Date().toISOString(),
    count: 0,
  };
}

function projectTaskStatus(status: TaskStatus): ApiTask["status"] {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "running";
}

function projectEventStatus(status: StepStatus): ApiEvent["status"] {
  if (status === "completed") return "success";
  if (status === "failed") return "failed";
  return "partial";
}

function stepName(step: TaskStepLike): string {
  const config = objectRecord(step.actionConfig);
  return stringValue(config.name) || step.actionType;
}

function stepDescription(step: TaskStepLike): string | undefined {
  const config = objectRecord(step.actionConfig);
  return stringValue(config.reason) || stringValue(config.description);
}

function stepOrder(step: TaskStepLike, fallback = 0): number {
  const config = objectRecord(step.actionConfig);
  const order = config._order;
  return typeof order === "number" && Number.isFinite(order) ? order : fallback;
}

function summarizeStepContent(step: TaskStepLike): string {
  if (step.error) return step.error;
  const result = objectRecord(step.result);
  const observation = objectRecord(result.observation);
  const error = objectRecord(observation.error);
  const errorMessage = stringValue(error.message);
  if (errorMessage) return errorMessage;

  const output = observation.output ?? result.output ?? step.result;
  if (typeof output === "string") return truncate(output, 500);
  if (output && typeof output === "object") {
    const outputRecord = output as Record<string, unknown>;
    const summary =
      stringValue(outputRecord.summary) ||
      stringValue(outputRecord.message) ||
      stringValue(outputRecord.finalAnswer) ||
      stringValue(outputRecord.content);
    if (summary) return truncate(summary, 500);
    return truncate(JSON.stringify(output), 500);
  }

  return `${step.actionType} ${step.status}`;
}

function extractGisData(result: unknown): unknown {
  const root = objectRecord(result);
  if (root.gisData) return root.gisData;
  const observation = objectRecord(root.observation);
  const output = objectRecord(observation.output);
  if (output.gisData) return output.gisData;
  const data = objectRecord(output.data);
  return data.gisData;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function truncate(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 3)}...`;
}

function toIso(value: Date | string | null | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  return new Date().toISOString();
}

function latestTimestamp(values: Array<Date | string | null | undefined>): string {
  let latest = 0;
  for (const value of values) {
    if (!value) continue;
    const millis = value instanceof Date ? value.getTime() : new Date(value).getTime();
    if (Number.isFinite(millis) && millis > latest) latest = millis;
  }
  return new Date(latest || Date.now()).toISOString();
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeEntityStatus(status: string | null | undefined): string {
  if (status === "danger" || status === "warning" || status === "normal") return status;
  return "normal";
}
