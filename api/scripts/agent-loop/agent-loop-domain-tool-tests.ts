import "dotenv/config";
import { buildDefaultToolRegistry } from "../../src/modules/agent-loop/tools/_shared/toolRegistry.js";
import { callTool } from "../../src/modules/agent-loop/tools/_shared/toolGateway.js";

async function main() {
  process.env.AGENT_SQL_DATABASE_URLS = JSON.stringify({
    test: "postgres://user:pass@127.0.0.1:1/db",
  });
  process.env.AGENT_SQL_ALLOWED_SCHEMAS = JSON.stringify({
    test: ["agent_smoke"],
  });

  const registry = buildDefaultToolRegistry();
  const sqlQuery = registry.get("SqlQuery");
  assert(sqlQuery, "SqlQuery should be registered by default");
  assert(sqlQuery.kind === "domain", "SqlQuery should be a domain tool");
  const sqlQuerySchema = registry.get("SqlQuerySchema");
  assert(sqlQuerySchema, "SqlQuerySchema should be registered by default");
  assert(sqlQuerySchema.kind === "domain", "SqlQuerySchema should be a domain tool");

  const writeAttempt = await callTool(
    registry,
    {
      id: "sql-write",
      toolName: "SqlQuery",
      input: {
        database: "test",
        sql: "delete from events where true",
      },
    },
    {
      taskId: "domain-tool-test",
      query: "test sql validation",
      observations: [],
    },
  );
  assert(!writeAttempt.ok, "SqlQuery should reject DML before execution");
  assert(
    writeAttempt.error?.code === "tool_input_validation_error",
    "DML rejection should happen in validateInput",
  );

  const multiStatementAttempt = await callTool(
    registry,
    {
      id: "sql-multi",
      toolName: "SqlQuery",
      input: {
        database: "test",
        sql: "select 1; select 2",
      },
    },
    {
      taskId: "domain-tool-test",
      query: "test sql validation",
      observations: [],
    },
  );
  assert(!multiStatementAttempt.ok, "SqlQuery should reject multiple statements");
  assert(
    multiStatementAttempt.error?.message.includes("exactly one"),
    "Multiple statement rejection should explain the single-statement rule",
  );

  const invalidOffsetAttempt = await callTool(
    registry,
    {
      id: "sql-invalid-offset",
      toolName: "SqlQuery",
      input: {
        database: "test",
        sql: "select 1",
        offset: 10001,
      },
    },
    {
      taskId: "domain-tool-test",
      query: "test sql pagination validation",
      observations: [],
    },
  );
  assert(!invalidOffsetAttempt.ok, "SqlQuery should reject offset above the pagination cap");
  assert(
    invalidOffsetAttempt.error?.code === "invalid_tool_input",
    "Offset cap rejection should happen in zod schema validation",
  );

  const forbiddenSelectAttempts = [
    {
      id: "sql-forbidden-pg-terminate",
      sql: "select pg_terminate_backend(0)",
      expectedMessage: "forbidden SQL function",
    },
    {
      id: "sql-forbidden-lo-unlink",
      sql: "select lo_unlink(123)",
      expectedMessage: "forbidden SQL function",
    },
    {
      id: "sql-forbidden-nextval",
      sql: "select nextval('events_id_seq')",
      expectedMessage: "forbidden SQL function",
    },
    {
      id: "sql-forbidden-dblink",
      sql: "select * from dblink('dbname=postgres', 'drop table events') as t(id int)",
      expectedMessage: "forbidden SQL function",
    },
    {
      id: "sql-forbidden-information-schema",
      sql: "select table_name from information_schema.tables",
      expectedMessage: "restricted SQL schema",
    },
    {
      id: "sql-forbidden-pg-catalog",
      sql: "select rolname from pg_catalog.pg_authid",
      expectedMessage: "restricted SQL schema",
    },
    {
      id: "sql-forbidden-unqualified-catalog",
      sql: "select rolname from pg_authid",
      expectedMessage: "restricted PostgreSQL catalog object",
    },
  ];

  for (const attempt of forbiddenSelectAttempts) {
    const observation = await callTool(
      registry,
      {
        id: attempt.id,
        toolName: "SqlQuery",
        input: {
          database: "test",
          sql: attempt.sql,
        },
      },
      {
        taskId: "domain-tool-test",
        query: "test sql security validation",
        observations: [],
      },
    );
    assert(!observation.ok, `${attempt.id} should be rejected before execution`);
    assert(
      observation.error?.code === "tool_input_validation_error",
      `${attempt.id} should be rejected in validateInput`,
    );
    assert(
      observation.error?.message.includes(attempt.expectedMessage),
      `${attempt.id} should mention ${attempt.expectedMessage}; got ${observation.error?.message}`,
    );
  }

  const schemaDeniedAttempt = await callTool(
    registry,
    {
      id: "schema-denied",
      toolName: "SqlQuerySchema",
      input: {
        database: "test",
        schema: "public",
      },
    },
    {
      taskId: "domain-tool-test",
      query: "test schema whitelist validation",
      observations: [],
    },
  );
  assert(!schemaDeniedAttempt.ok, "SqlQuerySchema should reject non-allowlisted schemas before execution");
  assert(
    schemaDeniedAttempt.error?.code === "tool_input_validation_error",
    "SqlQuerySchema whitelist rejection should happen in validateInput",
  );
  assert(
    schemaDeniedAttempt.error?.message.includes("not allowlisted"),
    `SqlQuerySchema whitelist rejection should explain allowlist; got ${schemaDeniedAttempt.error?.message}`,
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        registered: [sqlQuery.name, sqlQuerySchema.name],
        kind: [sqlQuery.kind, sqlQuerySchema.kind],
      },
      null,
      2,
    ),
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
