import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
  doublePrecision,
  index,
  customType,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ============================================
// pgvector 自定义类型（drizzle-orm 无原生支持）
// ============================================
const vector1024 = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return "vector(1024)";
  },
});

// ============================================
// Agent 编排任务表（核心工作流）
// ============================================
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id"),
    clientRequestId: text("client_request_id"),
    query: text("query").notNull(),
    status: text("status", { enum: ["pending", "running", "completed", "failed"] })
      .notNull()
      .default("pending"),
    plan: jsonb("plan"),
    actions: jsonb("actions"),
    result: jsonb("result"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("tasks_user_id_idx").on(table.userId),
    uniqueIndex("tasks_client_request_id_unique").on(table.clientRequestId),
    index("tasks_status_idx").on(table.status),
    index("tasks_created_at_idx").on(table.createdAt),
  ]
);

export const taskSteps = pgTable(
  "task_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    actionType: text("action_type").notNull(),
    actionConfig: jsonb("action_config").notNull().default({}),
    status: text("status", { enum: ["pending", "running", "completed", "failed"] })
      .notNull()
      .default("pending"),
    result: jsonb("result"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("task_steps_task_id_idx").on(table.taskId),
    index("task_steps_status_idx").on(table.status),
  ]
);

export const agentTranscriptEntries = pgTable(
  "agent_transcript_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    turn: integer("turn").notNull(),
    sequence: integer("sequence").notNull(),
    kind: text("kind", {
      enum: ["model_request", "assistant_message", "tool_message", "memory_recall", "loop_stop"],
    }).notNull(),
    message: jsonb("message"),
    messages: jsonb("messages"),
    finalAnswer: text("final_answer"),
    error: text("error"),
    stoppedBy: text("stopped_by"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("agent_transcript_entries_task_seq_idx").on(table.taskId, table.sequence),
    index("agent_transcript_entries_task_kind_idx").on(table.taskId, table.kind),
    index("agent_transcript_entries_created_at_idx").on(table.createdAt),
  ]
);

export const agentLoopLogFiles = pgTable(
  "agent_loop_log_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    sessionId: text("session_id"),
    requestId: text("request_id"),
    userId: text("user_id"),
    filePath: text("file_path").notNull(),
    mode: text("mode", { enum: ["debug", "operational"] }).notNull(),
    status: text("status", { enum: ["running", "completed", "failed"] })
      .notNull()
      .default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("agent_loop_log_files_task_id_idx").on(table.taskId),
    index("agent_loop_log_files_file_path_idx").on(table.filePath),
    index("agent_loop_log_files_status_idx").on(table.status),
    index("agent_loop_log_files_created_at_idx").on(table.createdAt),
  ]
);

// ============================================
// 记忆系统表 (P0+P1)
// ============================================

// 任务对话快照（P0-3: O(1) 查询替代 transcript 重建；Part C: 中途检查点）
export const taskConversationSnapshot = pgTable(
  "task_conversation_snapshot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    query: text("query").notNull(),
    finalAnswer: text("final_answer").notNull(),
    messages: jsonb("messages").notNull(),
    toolSummary: jsonb("tool_summary").default([]),
    summary: text("summary"),
    turns: integer("turns").notNull(),
    stoppedBy: text("stopped_by").notNull(),
    scenario: text("scenario"),
    entities: text("entities").array().default([]),
    embedding: vector1024("embedding"),
    isCheckpoint: boolean("is_checkpoint").notNull().default(false),
    checkpointTurn: integer("checkpoint_turn"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("task_conv_snapshot_task_id_idx").on(table.taskId),
    index("task_conv_snapshot_user_id_idx").on(table.userId),
    index("task_conv_snapshot_checkpoint_idx").on(table.taskId, table.isCheckpoint),
  ]
);

// 情节记忆 (P1-2: 结构化情节 + 向量语义召回)
export const episodicMemories = pgTable(
  "episodic_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    scene: text("scene"),
    userQuery: text("user_query").notNull(),
    toolSequence: jsonb("tool_sequence").default([]),
    finalResult: text("final_result"),
    importance: doublePrecision("importance").default(0.5),
    tags: text("tags").array().default([]),
    relatedEntities: text("related_entities").array().default([]),
    embedding: vector1024("embedding"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("episodic_memories_user_id_idx").on(table.userId),
    index("episodic_memories_scene_idx").on(table.scene),
  ]
);

// ============================================
// OpenSky 飞机当前状态（外部数据源读模型）
// ============================================

export const aircraftCurrentStates = pgTable(
  "aircraft_current_states",
  {
    icao24: text("icao24").primaryKey(),
    callsign: text("callsign"),
    originCountry: text("origin_country"),
    longitude: doublePrecision("longitude"),
    latitude: doublePrecision("latitude"),
    baroAltitude: doublePrecision("baro_altitude"),
    velocity: doublePrecision("velocity"),
    trueTrack: doublePrecision("true_track"),
    verticalRate: doublePrecision("vertical_rate"),
    onGround: boolean("on_ground").notNull().default(false),
    squawk: text("squawk"),
    spi: boolean("spi").notNull().default(false),
    positionSource: integer("position_source"),
    category: integer("category"),
    sourceTime: timestamp("source_time", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    region: text("region").default(""),
    status: text("status").default(""),
  },
  (table) => [
    index("acs_lat_idx").on(table.latitude),
    index("acs_lon_idx").on(table.longitude),
    index("acs_updated_at_idx").on(table.updatedAt),
  ]
);

// ============================================
// 展示数据表（前端 RightPanel 用）
// ============================================

// 可执行任务列表（日报/周报/实时监测）
export const jobTasks = pgTable(
  "job_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id"),
    name: text("name").notNull(),
    type: text("type", { enum: ["daily", "weekly", "realtime"] }).notNull(),
    executeTime: timestamp("execute_time", { withTimezone: true }),
    status: text("status", { enum: ["running", "completed", "partial", "failed"] })
      .notNull()
      .default("running"),
    dataCount: integer("data_count").default(0),
    subTasks: jsonb("sub_tasks"),
    agentTaskId: uuid("agent_task_id").references(() => tasks.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("job_tasks_user_id_idx").on(table.userId),
    index("job_tasks_status_idx").on(table.status),
    index("job_tasks_agent_task_id_idx").on(table.agentTaskId),
  ]
);

// 事件列表
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id"),
    taskId: uuid("task_id").references(() => jobTasks.id, { onDelete: "set null" }),
    taskName: text("task_name"),
    title: text("title").notNull(),
    content: text("content").notNull(),
    status: text("status", { enum: ["success", "partial", "failed"] })
      .notNull()
      .default("success"),
    timestamp: timestamp("timestamp", { withTimezone: true })
      .notNull()
      .defaultNow(),
    read: boolean("read").notNull().default(false),
    gisData: jsonb("gis_data"),
    agentTaskId: uuid("agent_task_id").references(() => tasks.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("events_user_id_idx").on(table.userId),
    index("events_status_idx").on(table.status),
    index("events_read_idx").on(table.read),
    index("events_timestamp_idx").on(table.timestamp),
  ]
);

// 订阅任务
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id"),
    name: text("name").notNull(),
    type: text("type").notNull(),
    schedule: text("schedule").notNull(),
    nextExecuteTime: timestamp("next_execute_time", { withTimezone: true }),
    status: text("status", { enum: ["running", "paused"] })
      .notNull()
      .default("running"),
    entityId: text("entity_id"),
    regionId: text("region_id"),
    toolType: text("tool_type"),
    queryParams: jsonb("query_params").default({}),
    lastExecuteTime: timestamp("last_execute_time", { withTimezone: true }),
    lastResult: jsonb("last_result"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("subscriptions_user_id_idx").on(table.userId),
    index("subscriptions_status_idx").on(table.status),
    index("subscriptions_tool_type_idx").on(table.toolType),
  ]
);

// 定制需求（未完成需求）
export const requirements = pgTable(
  "requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id"),
    description: text("description").notNull(),
    chatId: text("chat_id").notNull(),
    status: text("status", { enum: ["pending", "processing", "rejected"] })
      .notNull()
      .default("pending"),
    requirementId: text("requirement_id"),
    timestamp: timestamp("timestamp", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("requirements_user_id_idx").on(table.userId),
    index("requirements_status_idx").on(table.status),
  ]
);

// AI 洞察
export const insights = pgTable(
  "insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id"),
    category: text("category", { enum: ["geopolitics", "military", "industry"] })
      .notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    content: text("content").notNull(),
    riskLevel: text("risk_level", { enum: ["high", "medium", "low", "safe"] })
      .notNull(),
    entityId: text("entity_id"),
    regionId: text("region_id"),
    sources: jsonb("sources"),
    agentTaskId: uuid("agent_task_id").references(() => tasks.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("insights_user_id_idx").on(table.userId),
    index("insights_category_idx").on(table.category),
    index("insights_risk_level_idx").on(table.riskLevel),
  ]
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskStep = typeof taskSteps.$inferSelect;
export type NewTaskStep = typeof taskSteps.$inferInsert;
export type AgentTranscriptEntry = typeof agentTranscriptEntries.$inferSelect;
export type NewAgentTranscriptEntry = typeof agentTranscriptEntries.$inferInsert;
export type AgentLoopLogFile = typeof agentLoopLogFiles.$inferSelect;
export type NewAgentLoopLogFile = typeof agentLoopLogFiles.$inferInsert;
export type JobTask = typeof jobTasks.$inferSelect;
export type NewJobTask = typeof jobTasks.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type Requirement = typeof requirements.$inferSelect;
export type NewRequirement = typeof requirements.$inferInsert;
export type Insight = typeof insights.$inferSelect;
export type NewInsight = typeof insights.$inferInsert;
export type TaskConversationSnapshot = typeof taskConversationSnapshot.$inferSelect;
export type NewTaskConversationSnapshot = typeof taskConversationSnapshot.$inferInsert;
export type EpisodicMemory = typeof episodicMemories.$inferSelect;
export type NewEpisodicMemory = typeof episodicMemories.$inferInsert;
// ============================================
// AIS 船舶当前状态（外部数据源读模型）
// ============================================

export const aisCurrentStates = pgTable(
  "ais_current_states",
  {
    mmsi: text("mmsi").primaryKey(),
    shipName: text("ship_name"),
    callSign: text("call_sign"),
    shipType: integer("ship_type"),
    longitude: doublePrecision("longitude"),
    latitude: doublePrecision("latitude"),
    sog: doublePrecision("sog"),
    cog: doublePrecision("cog"),
    heading: doublePrecision("heading"),
    navigationalStatus: integer("navigational_status"),
    destination: text("destination"),
    sourceTime: timestamp("source_time", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("ais_lat_idx").on(table.latitude),
    index("ais_lon_idx").on(table.longitude),
    index("ais_updated_at_idx").on(table.updatedAt),
  ]
);

export type AircraftCurrentState = typeof aircraftCurrentStates.$inferSelect;
export type NewAircraftCurrentState = typeof aircraftCurrentStates.$inferInsert;
export type AisCurrentState = typeof aisCurrentStates.$inferSelect;
export type NewAisCurrentState = typeof aisCurrentStates.$inferInsert;
