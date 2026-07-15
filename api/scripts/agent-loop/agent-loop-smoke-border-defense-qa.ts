import type { Connection } from "mysql2/promise";
import { setCreateConnectionOverride } from "../../src/modules/agent-loop/tools/domain/borderDefenseQa/borderDefenseQa.js";
import type { ModelClient } from "../../src/modules/agent-loop/modelClient.js";
import type {
  AgentLoopEvent,
  NormalizedAgentDecision,
  ToolObservation,
} from "../../src/modules/agent-loop/tools/_shared/types.js";
import type { AgentLoopTaskResult } from "../../src/modules/tasks/agentLoopResultProjection.js";

export const BORDER_DEFENSE_QA_SCENARIO = "border-defense-qa";
export const BORDER_DEFENSE_QA_TOOLS = ["MysqlQuerySchema", "MysqlQuery"] as const;
export const BORDER_DEFENSE_QA_QUERY = "统计本月各级预警数量";

export interface BorderDefenseQaValidationInput {
  rawEvents: AgentLoopEvent[];
  projectedResult: AgentLoopTaskResult;
}

export interface BorderDefenseQaValidationReport {
  toolOrder: string[];
  schemaCalled: boolean;
  queryCalled: boolean;
  finalAnswerReceived: boolean;
}

export function createBorderDefenseQaSmokeModelClient(): ModelClient {
  return {
    async decide(input): Promise<NormalizedAgentDecision> {
      const schemaObservation = findObservation(input.observations, "MysqlQuerySchema");
      if (!schemaObservation) {
        return {
          type: "tool_calls",
          content: "Confirming the alarm_event table structure before writing the query.",
          toolCalls: [
            {
              id: "bdqa-schema-1",
              toolName: "MysqlQuerySchema",
              input: { database: "border-defense", table: "alarm_event" },
              reason: "Inspect alarm_event columns to build the correct GROUP BY query.",
            },
          ],
        };
      }

      const queryObservation = findObservation(input.observations, "MysqlQuery");
      if (!queryObservation) {
        return {
          type: "tool_calls",
          content: "Querying alarm event counts grouped by level for the current month.",
          toolCalls: [
            {
              id: "bdqa-query-1",
              toolName: "MysqlQuery",
              input: {
                database: "border-defense",
                sql: "SELECT event_level_name, COUNT(*) AS cnt FROM alarm_event WHERE event_time >= '2026-06-01' AND is_deleted = 0 GROUP BY event_level_name",
                limit: 100,
              },
              reason: "Aggregate alarm events by level for the current month.",
            },
          ],
        };
      }

      return {
        type: "final_answer",
        content: "本月各级预警数量统计完成：一级预警 12 条，二级预警 8 条，三级预警 5 条。",
      };
    },
  };
}

function createMockConnection(): Connection {
  return {
    execute: async (sql: string, _values: unknown[]) => {
      const normalizedSql = String(sql).toLowerCase();
      if (normalizedSql.includes("information_schema.columns")) {
        return [
          [
            {
              table_name: "alarm_event",
              column_name: "event_id",
              data_type: "varchar",
              is_nullable: "NO",
              column_comment: "",
              ordinal_position: 1,
            },
            {
              table_name: "alarm_event",
              column_name: "event_level_name",
              data_type: "varchar",
              is_nullable: "YES",
              column_comment: "",
              ordinal_position: 2,
            },
            {
              table_name: "alarm_event",
              column_name: "event_time",
              data_type: "datetime",
              is_nullable: "YES",
              column_comment: "",
              ordinal_position: 3,
            },
            {
              table_name: "alarm_event",
              column_name: "is_deleted",
              data_type: "tinyint",
              is_nullable: "YES",
              column_comment: "",
              ordinal_position: 4,
            },
          ],
          [],
        ];
      }
      return [
        [
          { event_level_name: "一级预警", cnt: 12 },
          { event_level_name: "二级预警", cnt: 8 },
          { event_level_name: "三级预警", cnt: 5 },
        ],
        [{ name: "event_level_name" }, { name: "cnt" }],
      ];
    },
    end: async () => undefined,
  } as unknown as Connection;
}

export function installMockBorderDefenseQaFetch(): () => void {
  setCreateConnectionOverride(async () => createMockConnection());
  return () => setCreateConnectionOverride(undefined);
}

export function validateBorderDefenseQaSmoke(
  input: BorderDefenseQaValidationInput
): BorderDefenseQaValidationReport {
  const observations = input.rawEvents.filter(
    (event): event is Extract<AgentLoopEvent, { type: "tool_observation" }> =>
      event.type === "tool_observation"
  );

  const toolOrder = observations.map((event) => event.toolName);
  const schemaCalled = observations.some((event) => event.toolName === "MysqlQuerySchema" && event.ok);
  const queryCalled = observations.some((event) => event.toolName === "MysqlQuery" && event.ok);

  assertCondition(schemaCalled, "MysqlQuerySchema was not called successfully.");
  assertCondition(queryCalled, "MysqlQuery was not called successfully.");

  const schemaIndex = toolOrder.indexOf("MysqlQuerySchema");
  const queryIndex = toolOrder.indexOf("MysqlQuery");
  assertCondition(schemaIndex >= 0 && queryIndex > schemaIndex, "Expected MysqlQuerySchema before MysqlQuery.");

  const finalAnswer = input.rawEvents.find((event) => event.type === "loop_stop");
  const finalAnswerReceived =
    finalAnswer?.type === "loop_stop" &&
    (finalAnswer.result.stoppedBy === "final_answer" || finalAnswer.result.stoppedBy === "max_turns");
  assertCondition(finalAnswerReceived, "Agent did not produce a final answer.");

  return {
    toolOrder,
    schemaCalled,
    queryCalled,
    finalAnswerReceived,
  };
}

function findObservation(observations: ToolObservation[], toolName: string): ToolObservation | undefined {
  return observations.find((observation) => observation.toolName === toolName);
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
