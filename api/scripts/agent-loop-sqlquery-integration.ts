import "dotenv/config";
import { Client } from "pg";
import { buildDefaultToolRegistry } from "../src/modules/agent-loop/toolRegistry.js";
import { callTool } from "../src/modules/agent-loop/toolGateway.js";

const DEFAULT_LOCAL_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/datasource";

async function main() {
  const connectionString = process.env.SQLQUERY_TEST_DATABASE_URL
    || process.env.DATABASE_URL
    || DEFAULT_LOCAL_DATABASE_URL;
  const alias = "sqlquery_test";
  const schemaName = `sqlquery_test_${Date.now().toString(36)}`;
  const tableName = "incidents";
  const qualifiedTable = `${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`;

  process.env.AGENT_SQL_DATABASE_URLS = JSON.stringify({
    [alias]: connectionString,
  });

  const setupClient = new Client({ connectionString });
  await setupClient.connect();

  try {
    await setupClient.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
    await setupClient.query(`
      CREATE TABLE ${qualifiedTable} (
        id integer primary key,
        type text not null,
        severity text not null,
        owner text
      )
    `);
    await setupClient.query(
      `INSERT INTO ${qualifiedTable} (id, type, severity, owner) VALUES
       (1, 'intrusion', 'high', 'alpha'),
       (2, 'weather', 'medium', null),
       (3, 'network', 'low', 'beta')`,
    );

    const registry = buildDefaultToolRegistry();
    const sqlQuery = registry.get("SqlQuery");
    assert(sqlQuery, "SqlQuery should be registered");
    assert(sqlQuery.kind === "domain", "SqlQuery should be kind=domain");

    const selectObservation = await callTool(
      registry,
      {
        id: "sql-select",
        toolName: "SqlQuery",
        input: {
          database: alias,
          sql: `
            select id, type, severity, owner
            from ${qualifiedTable}
            order by id
          `,
          limit: 2,
        },
      },
      {
        taskId: "sqlquery-integration",
        query: "test SqlQuery with a real database",
        observations: [],
      },
    );

    assert(selectObservation.ok, `SqlQuery SELECT failed: ${selectObservation.error?.message}`);
    const output = selectObservation.output as {
      database?: string;
      returnedRows?: number;
      rows?: Array<Record<string, unknown>>;
      columns?: Array<{ name: string }>;
      truncated?: boolean;
    };
    assert(output.database === alias, "SqlQuery should report the configured database alias");
    assert(output.returnedRows === 2, "SqlQuery should enforce the requested limit");
    assert(output.truncated === true, "SqlQuery should mark results truncated when returned rows reach limit");
    assert(output.columns?.map((column) => column.name).join(",") === "id,type,severity,owner", "SqlQuery should return column metadata");
    assert(output.rows?.[0]?.type === "intrusion", "SqlQuery should return ordered row data");
    assert(output.rows?.[1]?.owner === null, "SqlQuery should preserve null values");

    const writeObservation = await callTool(
      registry,
      {
        id: "sql-write-reject",
        toolName: "SqlQuery",
        input: {
          database: alias,
          sql: `update ${qualifiedTable} set severity = 'low' where id = 1`,
        },
      },
      {
        taskId: "sqlquery-integration",
        query: "test SqlQuery rejects writes",
        observations: [],
      },
    );
    assert(!writeObservation.ok, "SqlQuery should reject UPDATE before execution");
    assert(
      writeObservation.error?.code === "tool_input_validation_error",
      "SqlQuery should reject UPDATE in validateInput",
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          database: alias,
          schemaName,
          select: {
            returnedRows: output.returnedRows,
            columns: output.columns?.map((column) => column.name),
            rows: output.rows,
            truncated: output.truncated,
          },
          rejectedWrite: writeObservation.error?.message,
        },
        null,
        2,
      ),
    );
  } finally {
    await setupClient.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`).catch(() => undefined);
    await setupClient.end().catch(() => undefined);
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
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
