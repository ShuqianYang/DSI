import "dotenv/config";
import { buildDefaultToolRegistry } from "../src/modules/agent-loop/toolRegistry.js";
import { callTool } from "../src/modules/agent-loop/toolGateway.js";

async function main() {
  process.env.AGENT_SQL_DATABASE_URLS = JSON.stringify({
    test: "postgres://user:pass@127.0.0.1:1/db",
  });

  const registry = buildDefaultToolRegistry();
  const sqlQuery = registry.get("SqlQuery");
  assert(sqlQuery, "SqlQuery should be registered by default");
  assert(sqlQuery.kind === "domain", "SqlQuery should be a domain tool");

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

  console.log(
    JSON.stringify(
      {
        ok: true,
        registered: sqlQuery.name,
        kind: sqlQuery.kind,
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
