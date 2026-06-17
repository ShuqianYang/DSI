import assert from "node:assert/strict";

const {
  buildMysqlQuerySchemaTool,
  buildMysqlQueryTool,
} = await import("../../src/modules/agent-loop/tools/domain/borderDefenseQa/borderDefenseQa.ts");
const {
  createBorderDefenseQaSmokeModelClient,
  installMockBorderDefenseQaFetch,
  validateBorderDefenseQaSmoke,
} = await import("../../scripts/agent-loop/agent-loop-smoke-border-defense-qa.ts");

function createContext() {
  return {
    taskId: "border-defense-qa-test-task",
    query: "统计本月各级预警数量",
    observations: [],
    onProgress: () => undefined,
  };
}

// Tool registration
{
  const schemaTool = buildMysqlQuerySchemaTool();
  assert.equal(schemaTool.name, "MysqlQuerySchema");
  assert.equal(schemaTool.kind, "domain");
  assert.equal(schemaTool.isReadOnly?.({ database: "border-defense", table: "alarm_event" }), true);
  assert.equal(schemaTool.isDestructive?.({ database: "border-defense", table: "alarm_event" }), false);

  const queryTool = buildMysqlQueryTool();
  assert.equal(queryTool.name, "MysqlQuery");
  assert.ok(queryTool.aliases?.includes("mysql-query"));
  assert.equal(queryTool.kind, "domain");
  assert.equal(queryTool.isReadOnly?.({ database: "border-defense", sql: "select 1" }), true);
  assert.equal(queryTool.isDestructive?.({ database: "border-defense", sql: "select 1" }), false);
}

// Input schema validation
{
  const tool = buildMysqlQueryTool();

  const valid = tool.inputSchema.safeParse({
    database: "border-defense",
    sql: "SELECT event_level_name, COUNT(*) AS cnt FROM alarm_event GROUP BY event_level_name",
  });
  assert.equal(valid.success, true, "MysqlQuery should accept valid SELECT input");

  const defaulted = tool.inputSchema.safeParse({ sql: "SELECT 1" });
  assert.equal(defaulted.success, true);
  assert.equal(defaulted.data.database, "border-defense");
  assert.equal(defaulted.data.limit, 100);
  assert.equal(defaulted.data.offset, 0);

  const missingSql = tool.inputSchema.safeParse({ database: "border-defense" });
  assert.equal(missingSql.success, false, "MysqlQuery requires sql");

  const invalidLimit = tool.inputSchema.safeParse({ sql: "SELECT 1", limit: 9999 });
  assert.equal(invalidLimit.success, false, "MysqlQuery should reject limit above max");
}

// validateInput blocks destructive SQL and unknown aliases
{
  const tool = buildMysqlQueryTool();

  assert.throws(
    () => tool.validateInput?.({ database: "border-defense", sql: "DELETE FROM alarm_event WHERE id = 1" }, createContext()),
    /Only SELECT or WITH statements are allowed/,
    "MysqlQuery should reject DELETE statements"
  );

  assert.throws(
    () => tool.validateInput?.({ database: "border-defense", sql: "INSERT INTO alarm_event (id) VALUES (1)" }, createContext()),
    /Only SELECT or WITH statements are allowed/,
    "MysqlQuery should reject INSERT statements"
  );

  assert.throws(
    () => tool.validateInput?.({ database: "border-defense", sql: "DROP TABLE alarm_event" }, createContext()),
    /Only SELECT or WITH statements are allowed/,
    "MysqlQuery should reject DROP statements"
  );

  assert.throws(
    () => tool.validateInput?.({ database: "border-defense", sql: "UPDATE alarm_event SET id = 2" }, createContext()),
    /Only SELECT or WITH statements are allowed/,
    "MysqlQuery should reject UPDATE statements"
  );

  assert.throws(
    () => tool.validateInput?.({ database: "border-defense", sql: "SELECT * FROM alarm_event INTO OUTFILE '/tmp/result.csv'" }, createContext()),
    /INTO OUTFILE\/DUMPFILE is not allowed/,
    "MysqlQuery should reject INTO OUTFILE"
  );

  assert.throws(
    () => tool.validateInput?.({ database: "border-defense", sql: "SELECT 1; SELECT 2" }, createContext()),
    /Only a single SQL statement is allowed/,
    "MysqlQuery should reject multiple statements"
  );

  assert.throws(
    () => tool.validateInput?.({ database: "unknown-db", sql: "SELECT 1" }, createContext()),
    /Unknown MySQL database alias: unknown-db/,
    "MysqlQuery should reject unknown database alias"
  );
}

// Successful tool execution with mocked MySQL connection
{
  const schemaTool = buildMysqlQuerySchemaTool();
  const queryTool = buildMysqlQueryTool();
  const restore = installMockBorderDefenseQaFetch();

  try {
    const schemaOutput = await schemaTool.execute(
      { database: "border-defense", table: "alarm_event" },
      createContext()
    );

    assert.equal(schemaOutput.database, "border-defense");
    assert.equal(schemaOutput.table, "alarm_event");
    assert.equal(schemaOutput.tableCount, 1);
    assert.equal(schemaOutput.columnCount, 4);
    assert.equal(schemaOutput.tables.length, 1);
    assert.equal(schemaOutput.tables[0].name, "alarm_event");
    assert.deepEqual(
      schemaOutput.tables[0].columns.map((column) => column.name),
      ["event_id", "event_level_name", "event_time", "is_deleted"]
    );

    const queryOutput = await queryTool.execute(
      {
        database: "border-defense",
        sql: "SELECT event_level_name, COUNT(*) AS cnt FROM alarm_event WHERE event_time >= '2026-06-01' AND is_deleted = 0 GROUP BY event_level_name",
        limit: 100,
      },
      createContext()
    );

    assert.equal(queryOutput.database, "border-defense");
    assert.equal(queryOutput.rowCount, 3);
    assert.deepEqual(queryOutput.columns, ["event_level_name", "cnt"]);
    assert.equal(queryOutput.rows[0].event_level_name, "一级预警");
    assert.equal(queryOutput.rows[0].cnt, 12);
    assert.ok(queryOutput.durationMs >= 0);
  } finally {
    restore();
  }
}

// Fake model client: first decision calls MysqlQuerySchema
{
  const client = createBorderDefenseQaSmokeModelClient();
  const firstDecision = await client.decide({
    messages: [],
    tools: [],
    query: "统计本月各级预警数量",
    observations: [],
    callId: "call-1",
  });

  assert.equal(firstDecision.type, "tool_calls");
  assert.equal(firstDecision.toolCalls.length, 1);
  assert.equal(firstDecision.toolCalls[0].toolName, "MysqlQuerySchema");
  assert.equal(firstDecision.toolCalls[0].input.database, "border-defense");
  assert.equal(firstDecision.toolCalls[0].input.table, "alarm_event");
}

// Fake model client: second decision calls MysqlQuery after schema observation
{
  const client = createBorderDefenseQaSmokeModelClient();
  const secondDecision = await client.decide({
    messages: [],
    tools: [],
    query: "统计本月各级预警数量",
    observations: [
      {
        toolCallId: "bdqa-schema-1",
        toolName: "MysqlQuerySchema",
        ok: true,
        output: {
          database: "border-defense",
          table: "alarm_event",
          tables: [
            {
              name: "alarm_event",
              columns: [
                { name: "event_id", dataType: "varchar", nullable: false },
                { name: "event_level_name", dataType: "varchar", nullable: true },
                { name: "event_time", dataType: "datetime", nullable: true },
                { name: "is_deleted", dataType: "tinyint", nullable: true },
              ],
            },
          ],
        },
      },
    ],
    callId: "call-2",
  });

  assert.equal(secondDecision.type, "tool_calls");
  assert.equal(secondDecision.toolCalls.length, 1);
  assert.equal(secondDecision.toolCalls[0].toolName, "MysqlQuery");
  assert.match(secondDecision.toolCalls[0].input.sql, /event_level_name/i);
}

// Fake model client: third decision produces final answer after query observation
{
  const client = createBorderDefenseQaSmokeModelClient();
  const finalDecision = await client.decide({
    messages: [],
    tools: [],
    query: "统计本月各级预警数量",
    observations: [
      {
        toolCallId: "bdqa-schema-1",
        toolName: "MysqlQuerySchema",
        ok: true,
        output: { database: "border-defense", table: "alarm_event", tables: [] },
      },
      {
        toolCallId: "bdqa-query-1",
        toolName: "MysqlQuery",
        ok: true,
        output: {
          database: "border-defense",
          rowCount: 3,
          columns: ["event_level_name", "cnt"],
          rows: [
            { event_level_name: "一级预警", cnt: 12 },
            { event_level_name: "二级预警", cnt: 8 },
            { event_level_name: "三级预警", cnt: 5 },
          ],
          durationMs: 10,
        },
      },
    ],
    callId: "call-3",
  });

  assert.equal(finalDecision.type, "final_answer");
  assert.match(finalDecision.content, /一级预警\s*12/);
  assert.match(finalDecision.content, /二级预警\s*8/);
  assert.match(finalDecision.content, /三级预警\s*5/);
}

// Smoke validation: accepts valid observation sequence
{
  const report = validateBorderDefenseQaSmoke({
    rawEvents: [
      {
        type: "tool_observation",
        taskId: "task",
        turn: 1,
        toolCallId: "bdqa-schema-1",
        toolName: "MysqlQuerySchema",
        ok: true,
        observation: {
          toolCallId: "bdqa-schema-1",
          toolName: "MysqlQuerySchema",
          ok: true,
          output: { database: "border-defense", table: "alarm_event", tables: [] },
        },
      },
      {
        type: "tool_observation",
        taskId: "task",
        turn: 2,
        toolCallId: "bdqa-query-1",
        toolName: "MysqlQuery",
        ok: true,
        observation: {
          toolCallId: "bdqa-query-1",
          toolName: "MysqlQuery",
          ok: true,
          output: {
            database: "border-defense",
            rowCount: 3,
            columns: ["event_level_name", "cnt"],
            rows: [],
            durationMs: 10,
          },
        },
      },
      {
        type: "loop_stop",
        taskId: "task",
        turn: 3,
        result: {
          stoppedBy: "final_answer",
          turns: 3,
          finalAnswer: "本月各级预警数量统计完成。",
          observations: [],
        },
      },
    ],
    projectedResult: {
      message: "ok",
      mode: "agent_loop",
      turns: 3,
      stoppedBy: "final_answer",
      observations: [],
    },
  });

  assert.deepEqual(report.toolOrder, ["MysqlQuerySchema", "MysqlQuery"]);
  assert.equal(report.schemaCalled, true);
  assert.equal(report.queryCalled, true);
  assert.equal(report.finalAnswerReceived, true);
}

// Smoke validation: rejects when schema is missing
{
  assert.throws(
    () =>
      validateBorderDefenseQaSmoke({
        rawEvents: [
          {
            type: "tool_observation",
            taskId: "task",
            turn: 1,
            toolCallId: "bdqa-query-1",
            toolName: "MysqlQuery",
            ok: true,
            observation: {
              toolCallId: "bdqa-query-1",
              toolName: "MysqlQuery",
              ok: true,
              output: { database: "border-defense", rowCount: 0, columns: [], rows: [], durationMs: 0 },
            },
          },
        ],
        projectedResult: {
          message: "ok",
          mode: "agent_loop",
          turns: 2,
          stoppedBy: "final_answer",
          observations: [],
        },
      }),
    /MysqlQuerySchema was not called successfully/
  );
}

// Smoke validation: rejects wrong tool order
{
  assert.throws(
    () =>
      validateBorderDefenseQaSmoke({
        rawEvents: [
          {
            type: "tool_observation",
            taskId: "task",
            turn: 1,
            toolCallId: "bdqa-query-1",
            toolName: "MysqlQuery",
            ok: true,
            observation: {
              toolCallId: "bdqa-query-1",
              toolName: "MysqlQuery",
              ok: true,
              output: { database: "border-defense", rowCount: 0, columns: [], rows: [], durationMs: 0 },
            },
          },
          {
            type: "tool_observation",
            taskId: "task",
            turn: 2,
            toolCallId: "bdqa-schema-1",
            toolName: "MysqlQuerySchema",
            ok: true,
            observation: {
              toolCallId: "bdqa-schema-1",
              toolName: "MysqlQuerySchema",
              ok: true,
              output: { database: "border-defense", tables: [] },
            },
          },
        ],
        projectedResult: {
          message: "ok",
          mode: "agent_loop",
          turns: 3,
          stoppedBy: "final_answer",
          observations: [],
        },
      }),
    /Expected MysqlQuerySchema before MysqlQuery/
  );
}

console.log("border-defense-qa tool and smoke model client tests passed");
