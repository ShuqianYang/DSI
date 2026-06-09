import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { buildDefaultToolRegistry } from "../src/modules/agent-loop/tools/_shared/toolRegistry.js";
import { callTool } from "../src/modules/agent-loop/tools/_shared/toolGateway.js";

const DEFAULT_LOCAL_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/datasource";

interface TestResult {
  name: string;
  passed: boolean;
  detail?: string;
  error?: string;
}

async function main() {
  const connectionString = process.env.SQLQUERY_TEST_DATABASE_URL
    || process.env.DATABASE_URL
    || DEFAULT_LOCAL_DATABASE_URL;

  const alias = "security_audit";
  const schemaName = `security_audit_${Date.now().toString(36)}`;

  process.env.AGENT_SQL_DATABASE_URLS = JSON.stringify({
    [alias]: connectionString,
  });
  process.env.AGENT_SQL_ALLOWED_SCHEMAS = JSON.stringify({
    [alias]: [schemaName],
  });

  const client = new Client({ connectionString });
  await client.connect();
  const results: TestResult[] = [];

  try {
    // Setup: create schema with test tables
    await client.query(`CREATE SCHEMA ${qi(schemaName)}`);
    await client.query(`
      CREATE TABLE ${qi(schemaName)}.test_data (
        id serial primary key,
        name text,
        value int,
        tags text[]
      )
    `);
    await client.query(`
      INSERT INTO ${qi(schemaName)}.test_data (name, value, tags)
      SELECT 'item_' || i, i, ARRAY['tag_' || (i % 10)]
      FROM generate_series(1, 50) AS i
    `);
    await client.query(`
      CREATE TABLE ${qi(schemaName)}.secrets (
        id serial primary key,
        key text,
        secret text
      )
    `);
    await client.query(`
      INSERT INTO ${qi(schemaName)}.secrets (key, secret) VALUES
      ('api_key', 'sk-live-abc123'),
      ('password', 'hunter2'),
      ('token', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')
    `);
    await client.query(`
      CREATE TABLE ${qi(schemaName)}.secret_access (
        id serial primary key,
        secret_id int references ${qi(schemaName)}.secrets(id),
        actor text
      )
    `);

    const registry = buildDefaultToolRegistry();

    // ============ TEST 0: SqlQuerySchema allowlisted schema ============
    results.push(await runTest("SqlQuerySchema allowlisted schema", async () => {
      const obs = await callSqlQuerySchema(registry, alias, schemaName);
      assertOk(obs, "SqlQuerySchema should inspect an allowlisted schema");
      const out = obs.output as any;
      assert(out.database === alias, `Expected database ${alias}, got ${out.database}`);
      assert(out.schema === schemaName, `Expected schema ${schemaName}, got ${out.schema}`);
      assert(out.tableCount === 3, `Expected 3 base tables, got ${out.tableCount}`);
      assert(out.columnCount >= 10, `Expected at least 10 columns, got ${out.columnCount}`);
      assert(out.tables?.some((table: any) => table.name === "test_data"), "Expected test_data table");
      assert(out.tables?.some((table: any) => table.name === "secrets"), "Expected secrets table");
      assert(out.tables?.some((table: any) => table.name === "secret_access"), "Expected secret_access table");
      assert(out.foreignKeyCount === 1, `Expected 1 foreign key, got ${out.foreignKeyCount}`);
      assert(
        out.foreignKeys?.some((foreignKey: any) =>
          foreignKey.table === "secret_access"
          && foreignKey.column === "secret_id"
          && foreignKey.foreignTable === "secrets"
          && foreignKey.foreignColumn === "id"
        ),
        `Expected secret_access.secret_id -> secrets.id foreign key, got ${JSON.stringify(out.foreignKeys)}`,
      );

      const firstColumn = out.tables?.[0]?.columns?.[0];
      assert(firstColumn && typeof firstColumn.name === "string", "Column should include name");
      assert(typeof firstColumn.dataType === "string", "Column should include dataType");
      assert(typeof firstColumn.nullable === "boolean", "Column should include nullable boolean");

      const serialized = JSON.stringify(out);
      assert(!serialized.includes("column_default"), "SqlQuerySchema must not expose column defaults");
      assert(!serialized.includes("constraint"), "SqlQuerySchema must not expose constraints");
      assert(!serialized.includes("index"), "SqlQuerySchema must not expose indexes");
      assert(!serialized.includes("view_definition"), "SqlQuerySchema must not expose view definitions");
    }));

    // ============ TEST 0a: SqlQuerySchema can filter to one table ============
    results.push(await runTest("SqlQuerySchema single table filter", async () => {
      const obs = await callSqlQuerySchema(registry, alias, schemaName, "secret_access");
      assertOk(obs, "SqlQuerySchema should inspect one allowlisted table");
      const out = obs.output as any;
      assert(out.database === alias, `Expected database ${alias}, got ${out.database}`);
      assert(out.schema === schemaName, `Expected schema ${schemaName}, got ${out.schema}`);
      assert(out.table === "secret_access", `Expected table secret_access, got ${out.table}`);
      assert(out.tableCount === 1, `Expected 1 base table, got ${out.tableCount}`);
      assert(out.tables?.length === 1, `Expected one inline table, got ${out.tables?.length}`);
      assert(out.tables?.[0]?.name === "secret_access", `Expected secret_access table, got ${out.tables?.[0]?.name}`);
      assert(!out.tables?.some((table: any) => table.name === "secrets"), "Single-table filter must not include other tables");
      assert(out.foreignKeyCount === 1, `Expected 1 related foreign key, got ${out.foreignKeyCount}`);
      assert(
        out.foreignKeys?.some((foreignKey: any) =>
          foreignKey.table === "secret_access"
          && foreignKey.column === "secret_id"
          && foreignKey.foreignTable === "secrets"
          && foreignKey.foreignColumn === "id"
        ),
        `Expected secret_access.secret_id -> secrets.id foreign key, got ${JSON.stringify(out.foreignKeys)}`,
      );
    }));

    // ============ TEST 0aa: SqlQuerySchema rejects qualified table filter ============
    results.push(await runTest("REJECT SqlQuerySchema qualified table filter", async () => {
      const obs = await callSqlQuerySchema(registry, alias, schemaName, `${schemaName}.secret_access`);
      assertNotOk(obs, "SqlQuerySchema table filter should reject qualified table names");
      assert(obs.error?.message?.includes("unqualified table name"),
        `Expected unqualified table error, got: ${obs.error?.message}`);
    }));

    // ============ TEST 0b: SqlQuerySchema rejects non-allowlisted schema ============
    results.push(await runTest("REJECT SqlQuerySchema non-allowlisted schema", async () => {
      const obs = await callSqlQuerySchema(registry, alias, "public");
      assertNotOk(obs, "SqlQuerySchema should reject non-allowlisted schemas");
      assert(obs.error?.message?.includes("not allowlisted"),
        `Expected allowlist error, got: ${obs.error?.message}`);
    }));

    // ============ TEST 0c: SqlQuerySchema rejects restricted system schema ============
    results.push(await runTest("REJECT SqlQuerySchema restricted system schema", async () => {
      const obs = await callSqlQuerySchema(registry, alias, "information_schema");
      assertNotOk(obs, "SqlQuerySchema should reject restricted system schemas");
      assert(obs.error?.message?.includes("restricted SQL schema"),
        `Expected restricted schema error, got: ${obs.error?.message}`);
    }));

    // ============ TEST 1: Basic SELECT works ============
    results.push(await runTest("Basic SELECT", async () => {
      const obs = await callSqlQuery(registry, alias, `SELECT * FROM ${qi(schemaName)}.test_data ORDER BY id LIMIT 5`);
      assertOk(obs, "SELECT should succeed");
      const out = obs.output as any;
      assert(out.rows?.length === 5, `Expected 5 rows, got ${out.rows?.length}`);
      assert(out.columns?.length === 4, `Expected 4 columns, got ${out.columns?.length}`);
    }));

    // ============ TEST 2: ORDER BY preserved ============
    results.push(await runTest("ORDER BY preserved after LIMIT wrapper", async () => {
      const obs = await callSqlQuery(registry, alias, `SELECT id, name FROM ${qi(schemaName)}.test_data ORDER BY id DESC`);
      assertOk(obs, "SELECT with ORDER BY should succeed");
      const out = obs.output as any;
      // Check if first row has highest id
      const firstId = out.rows?.[0]?.id;
      const lastId = out.rows?.[out.rows.length - 1]?.id;
      assert(firstId > lastId, `ORDER BY DESC failed: first=${firstId}, last=${lastId}. The LIMIT wrapper may have dropped ordering.`);
    }));

    // ============ TEST 3: CTE (WITH) works ============
    results.push(await runTest("CTE (WITH) query", async () => {
      const obs = await callSqlQuery(registry, alias, `
        WITH high_values AS (
          SELECT * FROM ${qi(schemaName)}.test_data WHERE value > 40
        )
        SELECT * FROM high_values ORDER BY value
      `);
      assertOk(obs, "CTE query should succeed");
      const out = obs.output as any;
      assert(out.rows?.length === 10, `Expected 10 rows (values 41-50), got ${out.rows?.length}`);
    }));

    // ============ TEST 4: REJECTED - INSERT ============
    results.push(await runTest("REJECT INSERT", async () => {
      const obs = await callSqlQuery(registry, alias, `INSERT INTO ${qi(schemaName)}.test_data (name) VALUES ('hacked')`);
      assertNotOk(obs, "INSERT should be rejected");
      assert(obs.error?.code === "tool_input_validation_error", `Expected validation error, got ${obs.error?.code}`);
    }));

    // ============ TEST 5: REJECTED - UPDATE ============
    results.push(await runTest("REJECT UPDATE", async () => {
      const obs = await callSqlQuery(registry, alias, `UPDATE ${qi(schemaName)}.test_data SET name = 'hacked'`);
      assertNotOk(obs, "UPDATE should be rejected");
    }));

    // ============ TEST 6: REJECTED - DELETE ============
    results.push(await runTest("REJECT DELETE", async () => {
      const obs = await callSqlQuery(registry, alias, `DELETE FROM ${qi(schemaName)}.test_data`);
      assertNotOk(obs, "DELETE should be rejected");
    }));

    // ============ TEST 7: REJECTED - DROP TABLE ============
    results.push(await runTest("REJECT DROP TABLE", async () => {
      const obs = await callSqlQuery(registry, alias, `DROP TABLE ${qi(schemaName)}.test_data`);
      assertNotOk(obs, "DROP TABLE should be rejected");
    }));

    // ============ TEST 8: REJECTED - multi-statement ============
    results.push(await runTest("REJECT multi-statement", async () => {
      const obs = await callSqlQuery(registry, alias,
        `SELECT 1; DROP TABLE ${qi(schemaName)}.test_data;`
      );
      assertNotOk(obs, "Multi-statement should be rejected");
      assert(obs.error?.message?.includes("exactly one"), `Expected 'exactly one' error, got: ${obs.error?.message}`);
    }));

    // ============ TEST 9: REJECTED - comment-hidden keyword ============
    results.push(await runTest("REJECT comment-hidden DROP", async () => {
      const obs = await callSqlQuery(registry, alias,
        `SELECT /* DROP TABLE */ 1 FROM ${qi(schemaName)}.test_data`
      );
      // Comments are stripped during normalization, so this should be allowed
      // The DROP is inside a comment, not an actual command
      assertOk(obs, "Comment-hidden keyword should be allowed (it's just a comment)");
    }));

    // ============ TEST 10: REJECTED - string-hidden keyword ============
    results.push(await runTest("ALLOW string literal with keyword", async () => {
      // 'DROP TABLE' in a string literal should be allowed - it's data, not SQL
      const obs = await callSqlQuery(registry, alias,
        `SELECT 'DROP TABLE users' as msg FROM ${qi(schemaName)}.test_data LIMIT 1`
      );
      assertOk(obs, "String literal containing keyword should be allowed");
    }));

    // ============ TEST 11: REJECTED - SELECT INTO ============
    results.push(await runTest("REJECT SELECT INTO", async () => {
      const obs = await callSqlQuery(registry, alias,
        `SELECT * INTO ${qi(schemaName)}.backup FROM ${qi(schemaName)}.test_data`
      );
      assertNotOk(obs, "SELECT INTO should be rejected");
    }));

    // ============ TEST 12: REJECTED - FOR UPDATE ============
    results.push(await runTest("REJECT FOR UPDATE", async () => {
      const obs = await callSqlQuery(registry, alias,
        `SELECT * FROM ${qi(schemaName)}.test_data FOR UPDATE`
      );
      assertNotOk(obs, "FOR UPDATE should be rejected");
    }));

    // ============ TEST 13: REJECTED - semicolon bypass attempt ============
    results.push(await runTest("ALLOW semicolon in string (not a bypass)", async () => {
      // A semicolon inside a string literal is data, not SQL syntax
      const obs = await callSqlQuery(registry, alias,
        `SELECT '; DROP TABLE ${qi(schemaName)}.test_data;' as harmless FROM ${qi(schemaName)}.test_data LIMIT 1`
      );
      assertOk(obs, "Semicolon inside string literal should be allowed");
      const out = obs.output as any;
      const expected = `; DROP TABLE "${schemaName}".test_data;`;
      assert(out.rows?.[0]?.harmless === expected,
        `String content should be preserved. Expected "${expected}", got "${out.rows?.[0]?.harmless}"`);
    }));

    // ============ TEST 14: Test default_transaction_read_only protection ============
    results.push(await runTest("READ ONLY transaction blocks INSERT", async () => {
      // Direct test: does default_transaction_read_only actually block writes?
      const testClient = new Client({ connectionString });
      await testClient.connect();
      try {
        await testClient.query("SET default_transaction_read_only = on");
        try {
          await testClient.query(`INSERT INTO ${qi(schemaName)}.test_data (name) VALUES ('should_fail')`);
          throw new Error("INSERT should have been blocked by read_only");
        } catch (e: any) {
          assert(e.message.includes("cannot execute INSERT in a read-only transaction") || e.message.includes("read-only"),
            `Expected read-only error, got: ${e.message}`);
        }
      } finally {
        await testClient.end().catch(() => undefined);
      }
    }));

    // ============ TEST 15: Test LIMIT wrapper effect on row count ============
    results.push(await runTest("LIMIT wrapper caps results", async () => {
      const obs = await callSqlQuery(registry, alias,
        `SELECT * FROM ${qi(schemaName)}.test_data`, { limit: 10 }
      );
      assertOk(obs, "SELECT should succeed");
      const out = obs.output as any;
      assert(out.returnedRows === 10, `Expected 10 rows, got ${out.returnedRows}`);
      assert(out.truncated === true, "Should be marked truncated when limit hit");
    }));

    // ============ TEST 16: Test offset pagination ============
    results.push(await runTest("OFFSET paginates results", async () => {
      const obs = await callSqlQuery(registry, alias,
        `SELECT id, name FROM ${qi(schemaName)}.test_data ORDER BY id`, { limit: 3, offset: 5 }
      );
      assertOk(obs, "SELECT with offset should succeed");
      const out = obs.output as any;
      assert(out.returnedRows === 3, `Expected 3 rows, got ${out.returnedRows}`);
      assert(out.offset === 5, `Expected offset 5, got ${out.offset}`);
      assert(out.rows?.[0]?.id === 6, `Expected first paginated id 6, got ${out.rows?.[0]?.id}`);
    }));

    // ============ TEST 16b: Large SqlQuery result writes full rows to artifact ============
    results.push(await runTest("Large result writes JSONL artifact", async () => {
      const obs = await callSqlQuery(registry, alias,
        `SELECT i, repeat('x', 500) AS payload FROM generate_series(1, 75) AS i ORDER BY i`,
        { limit: 75 }
      );
      assertOk(obs, "Large SELECT should succeed");
      const out = obs.output as any;
      assert(out.returnedRows === 75, `Expected 75 returned rows, got ${out.returnedRows}`);
      assert(out.previewRows === 50, `Expected 50 preview rows, got ${out.previewRows}`);
      assert(out.rows?.length === 50, `Expected 50 inline rows, got ${out.rows?.length}`);
      assert(out.artifact?.kind === "jsonl", `Expected JSONL artifact, got ${JSON.stringify(out.artifact)}`);
      assert(typeof out.artifact.path === "string" && out.artifact.path.includes("api/tmp/agent-loop/sqlquery/security-audit/"),
        `Unexpected artifact path: ${out.artifact?.path}`);

      const artifactPath = path.join(process.cwd(), "..", out.artifact.path);
      const content = await readFile(artifactPath, "utf8");
      const lines = content.trimEnd().split("\n");
      assert(lines.length === 75, `Expected 75 artifact lines, got ${lines.length}`);
      assert(JSON.parse(lines[0]!).i === 1, "Expected first artifact row i=1");
      assert(JSON.parse(lines[74]!).i === 75, "Expected last artifact row i=75");
    }));

    // ============ TEST 17: Test limit=0 or negative rejected by schema ============
    results.push(await runTest("LIMIT=0 rejected by schema", async () => {
      const obs = await callSqlQuery(registry, alias,
        `SELECT * FROM ${qi(schemaName)}.test_data`, { limit: 0 }
      );
      assertNotOk(obs, "limit=0 should be rejected by zod schema");
    }));

    // ============ TEST 18: Test timeout_ms ============
    results.push(await runTest("Timeout aborts slow query", async () => {
      const obs = await callSqlQuery(registry, alias,
        `SELECT pg_sleep(2)`, { timeout_ms: 500 }
      );
      assertNotOk(obs, "Slow query should timeout");
      assert(obs.error?.message?.includes("timeout") || obs.error?.message?.includes("canceling statement"),
        `Expected timeout error, got: ${obs.error?.message}`);
    }));

    // ============ TEST 19: Test unknown database alias ============
    results.push(await runTest("Unknown database alias rejected", async () => {
      const obs = await callSqlQuery(registry, "nonexistent_db", `SELECT 1`);
      assertNotOk(obs, "Unknown alias should be rejected");
      assert(obs.error?.code === "tool_input_validation_error",
        `Expected validation error, got ${obs.error?.code}`);
    }));

    // ============ TEST 20: Test aggregate queries ============
    results.push(await runTest("Aggregate queries work", async () => {
      const obs = await callSqlQuery(registry, alias, `
        SELECT
          COUNT(*) as total,
          AVG(value) as avg_val,
          MAX(value) as max_val,
          MIN(value) as min_val
        FROM ${qi(schemaName)}.test_data
      `);
      assertOk(obs, "Aggregate query should succeed");
      const out = obs.output as any;
      assert(out.rows?.[0]?.total === "50" || out.rows?.[0]?.total === 50,
        `Expected count 50, got ${out.rows?.[0]?.total}`);
    }));

    // ============ TEST 20: Test subquery works ============
    results.push(await runTest("Subquery works", async () => {
      const obs = await callSqlQuery(registry, alias, `
        SELECT * FROM ${qi(schemaName)}.test_data
        WHERE value > (SELECT AVG(value) FROM ${qi(schemaName)}.test_data)
      `);
      assertOk(obs, "Subquery should succeed");
      const out = obs.output as any;
      assert(out.rows?.length === 25, `Expected 25 rows (above median), got ${out.rows?.length}`);
    }));

    // ============ TEST 21: Test UNION works ============
    results.push(await runTest("UNION works", async () => {
      const obs = await callSqlQuery(registry, alias, `
        SELECT name, value FROM ${qi(schemaName)}.test_data WHERE value <= 5
        UNION
        SELECT name, value FROM ${qi(schemaName)}.test_data WHERE value > 45
      `);
      assertOk(obs, "UNION should succeed");
      const out = obs.output as any;
      assert(out.rows?.length === 10, `Expected 10 rows, got ${out.rows?.length}`);
    }));

    // ============ TEST 22: Test window functions ============
    results.push(await runTest("Window functions work", async () => {
      const obs = await callSqlQuery(registry, alias, `
        SELECT name, value,
          ROW_NUMBER() OVER (ORDER BY value DESC) as rn,
          RANK() OVER (ORDER BY value DESC) as rnk
        FROM ${qi(schemaName)}.test_data
        LIMIT 5
      `);
      assertOk(obs, "Window function query should succeed");
      const out = obs.output as any;
      // ROW_NUMBER() returns PostgreSQL bigint which node-pg serializes as string
      assert(out.rows?.[0]?.rn === "1" || out.rows?.[0]?.rn === 1,
        `First row should have row_number 1, got ${out.rows?.[0]?.rn} (type: ${typeof out.rows?.[0]?.rn})`);
    }));

    // ============ TEST 23: REJECTED - pg_terminate_backend (destructive function via SELECT) ============
    results.push(await runTest("REJECT pg_terminate_backend via SELECT", async () => {
      const obs = await callSqlQuery(registry, alias,
        `SELECT pg_terminate_backend(0) as result`
      );
      assertNotOk(obs, "pg_terminate_backend should be rejected before execution");
      assert(obs.error?.message?.includes("forbidden SQL function"),
        `Expected forbidden function error, got: ${obs.error?.message}`);
    }));

    // ============ TEST 23b: REJECTED - dblink side-effect tunneling ============
    results.push(await runTest("REJECT dblink side-effect tunneling", async () => {
      const obs = await callSqlQuery(registry, alias,
        `SELECT * FROM dblink('dbname=postgres', 'DROP TABLE ${qi(schemaName)}.test_data') AS t(id int)`
      );
      assertNotOk(obs, "dblink should be rejected before execution");
      assert(obs.error?.message?.includes("forbidden SQL function"),
        `Expected forbidden function error, got: ${obs.error?.message}`);
    }));

    // ============ TEST 24: Test TRUNCATE disguised as SELECT ============
    results.push(await runTest("REJECT TRUNCATE", async () => {
      const obs = await callSqlQuery(registry, alias,
        `TRUNCATE TABLE ${qi(schemaName)}.test_data`
      );
      assertNotOk(obs, "TRUNCATE should be rejected");
    }));

    // ============ TEST 25: Test COPY rejected ============
    results.push(await runTest("REJECT COPY", async () => {
      const obs = await callSqlQuery(registry, alias,
        `COPY ${qi(schemaName)}.test_data TO '/tmp/test.csv'`
      );
      assertNotOk(obs, "COPY should be rejected");
    }));

    // ============ TEST 26: Test dollar-quoted strings handled ============
    results.push(await runTest("Dollar-quoted strings work", async () => {
      const obs = await callSqlQuery(registry, alias,
        `SELECT $$hello; world$$ as msg`
      );
      assertOk(obs, "Dollar-quoted string should work");
      const out = obs.output as any;
      assert(out.rows?.[0]?.msg === "hello; world", `Expected "hello; world", got ${out.rows?.[0]?.msg}`);
    }));

    // ============ TEST 27: REJECTED - information_schema access ============
    results.push(await runTest("REJECT information_schema access", async () => {
      const obs = await callSqlQuery(registry, alias,
        `SELECT table_name FROM information_schema.tables WHERE table_schema = ${sqlStringLiteral(schemaName)} LIMIT 5`
      );
      assertNotOk(obs, "information_schema query should be rejected");
      assert(obs.error?.message?.includes("restricted SQL schema"),
        `Expected restricted schema error, got: ${obs.error?.message}`);
    }));

    // ============ TEST 28: Test dollar quote with tag ============
    results.push(await runTest("Dollar-quoted with tag", async () => {
      const obs = await callSqlQuery(registry, alias,
        `SELECT $func$ SELECT 1; DROP TABLE x; $func$ as code`
      );
      assertOk(obs, "Dollar-quoted with tag should work");
    }));

    // ============ TEST 29: Test semicolon-only (empty) statement ============
    results.push(await runTest("Empty/whitespace-only statement rejected", async () => {
      const obs = await callSqlQuery(registry, alias, `   ;   `);
      assertNotOk(obs, "Empty statement should be rejected");
    }));

    // ============ TEST 30: Test VACUUM rejected ============
    results.push(await runTest("REJECT VACUUM", async () => {
      const obs = await callSqlQuery(registry, alias, `VACUUM`);
      assertNotOk(obs, "VACUUM should be rejected");
    }));

    // Print results
    console.log("\n" + "=".repeat(70));
    console.log("SqlQuery Security Audit Results");
    console.log("=".repeat(70));

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;

    for (const r of results) {
      const status = r.passed ? "✅ PASS" : "❌ FAIL";
      console.log(`\n${status}: ${r.name}`);
      if (r.detail) console.log(`   Detail: ${r.detail}`);
      if (r.error) console.log(`   Error: ${r.error}`);
    }

    console.log("\n" + "=".repeat(70));
    console.log(`Summary: ${passed} passed, ${failed} failed, ${results.length} total`);
    console.log("=".repeat(70));

  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${qi(schemaName)} CASCADE`).catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

// Helper: call SqlQuery through the tool gateway
async function callSqlQuery(
  registry: ReturnType<typeof buildDefaultToolRegistry>,
  database: string,
  sql: string,
  opts: { limit?: number; offset?: number; timeout_ms?: number } = {}
) {
  return callTool(
    registry,
    {
      id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      toolName: "SqlQuery",
      input: {
        database,
        sql,
        limit: opts.limit ?? 100,
        offset: opts.offset ?? 0,
        timeout_ms: opts.timeout_ms ?? 5000,
      },
    },
    {
      taskId: "security-audit",
      query: "security audit",
      observations: [],
    }
  );
}

// Helper: call SqlQuerySchema through the tool gateway
async function callSqlQuerySchema(
  registry: ReturnType<typeof buildDefaultToolRegistry>,
  database: string,
  schema: string,
  table?: string
) {
  return callTool(
    registry,
    {
      id: `schema-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      toolName: "SqlQuerySchema",
      input: {
        database,
        schema,
        ...(table ? { table } : {}),
      },
    },
    {
      taskId: "security-audit",
      query: "schema security audit",
      observations: [],
    }
  );
}

// Helper: quote identifier
function qi(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

function sqlStringLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

// Test runner
async function runTest(
  name: string,
  fn: () => Promise<void>,
  expectPotentialFailure = false
): Promise<TestResult> {
  try {
    await fn();
    return { name, passed: true };
  } catch (e: any) {
    return {
      name,
      passed: expectPotentialFailure ? false : false,
      detail: e.message,
      error: e.stack?.split("\n")?.[1]?.trim(),
    };
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertOk(obs: any, message: string) {
  if (!obs.ok) throw new Error(`${message}: ${obs.error?.message}`);
}

function assertNotOk(obs: any, message: string) {
  if (obs.ok) throw new Error(`${message}: but it succeeded unexpectedly`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
