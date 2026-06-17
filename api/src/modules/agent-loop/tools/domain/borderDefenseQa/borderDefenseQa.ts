import { z } from "zod";
import { createConnection } from "mysql2/promise";
import type { Connection, FieldPacket, RowDataPacket } from "mysql2/promise";
import type { ToolDefinition } from "../../_shared/types.js";
import { safeJsonStringify, sanitizeForJson } from "../../_shared/serialization.js";

let createConnectionOverride: ((() => Promise<Connection>) | undefined);

export function setCreateConnectionOverride(override?: (() => Promise<Connection>) | undefined): void {
  createConnectionOverride = override;
}

const DEFAULT_MYSQL_DATABASE = "border-defense";
const DEFAULT_MYSQL_LIMIT = 100;
const MAX_MYSQL_LIMIT = 1000;
const DEFAULT_MYSQL_OFFSET = 0;
const MAX_MYSQL_OFFSET = 10_000;
const DEFAULT_MYSQL_TIMEOUT_MS = 30_000;
const MAX_MYSQL_TIMEOUT_MS = 120_000;
const MAX_MYSQL_RESULT_CHARS = 80_000;
const MAX_MYSQL_INLINE_RESULT_CHARS = 20_000;
const MAX_MYSQL_PREVIEW_ROWS = 50;

const FORBIDDEN_MYSQL_KEYWORDS = [
  "insert",
  "update",
  "delete",
  "drop",
  "alter",
  "create",
  "truncate",
  "replace",
  "merge",
  "grant",
  "revoke",
  "lock",
  "unlock",
  "exec",
  "execute",
  "call",
  "load",
];

const FORBIDDEN_MYSQL_SCHEMAS = new Set([
  "information_schema",
  "mysql",
  "performance_schema",
  "sys",
]);

const MYSQL_DATABASE_ALIASES = new Set(["border-defense"]);

function getMysqlDatabaseConfig(
  alias: string
): { host: string; port: number; user: string; password: string; database: string } | undefined {
  if (alias === "border-defense") {
    return {
      host: process.env.BORDER_DEFENSE_DB_HOST || "127.0.0.1",
      port: Number(process.env.BORDER_DEFENSE_DB_PORT || "3306"),
      user: process.env.BORDER_DEFENSE_DB_USER || "",
      password: process.env.BORDER_DEFENSE_DB_PASSWORD || "",
      database: process.env.BORDER_DEFENSE_DB_NAME || "xjzhdd_bj",
    };
  }
  return undefined;
}

function assertKnownMysqlDatabase(alias: string): void {
  if (!MYSQL_DATABASE_ALIASES.has(alias)) {
    throw new Error(
      `Unknown MySQL database alias: ${alias}. Configured aliases: ${Array.from(MYSQL_DATABASE_ALIASES).join(", ")}.`
    );
  }
}

function normalizeSqlForPolicy(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function stripTrailingSemicolon(sql: string): string {
  return sql.replace(/\s*;\s*$/, "");
}

function splitSqlStatements(sql: string): string[] {
  const cleaned = sql.replace(/'[^']*'/g, "''").replace(/`[^`]*`/g, "``");
  return cleaned
    .split(/;/g)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function validateReadOnlySql(sql: string): void {
  const normalized = normalizeSqlForPolicy(sql).toLowerCase();
  const statements = splitSqlStatements(normalized);

  if (statements.length === 0) {
    throw new Error("SQL query is empty.");
  }
  if (statements.length > 1) {
    throw new Error("Only a single SQL statement is allowed.");
  }

  const single = statements[0]!;
  const trimmed = single.trim();

  if (!trimmed.startsWith("select") && !trimmed.startsWith("with")) {
    throw new Error("Only SELECT or WITH statements are allowed.");
  }

  for (const keyword of FORBIDDEN_MYSQL_KEYWORDS) {
    const pattern = new RegExp(`\\b${keyword}\\b`, "i");
    if (pattern.test(single)) {
      throw new Error(`Forbidden SQL keyword detected: ${keyword}`);
    }
  }

  if (/\binto\s+(outfile|dumpfile)\b/i.test(single)) {
    throw new Error("INTO OUTFILE/DUMPFILE is not allowed.");
  }
}

function buildLimitedSql(sql: string, limit: number, offset: number): string {
  const stripped = stripTrailingSemicolon(sql.trim());

  const hasLimit = /\blimit\s+\d+\b/i.test(stripped);
  const hasOffset = /\boffset\s+\d+\b/i.test(stripped);

  if (hasLimit && hasOffset) {
    return `${stripped};`;
  }

  if (/^\s*with\s+/i.test(stripped)) {
    return `SELECT * FROM (${stripped}) AS _agent_wrapped LIMIT ${limit} OFFSET ${offset};`;
  }

  if (hasLimit) {
    return `${stripped} OFFSET ${offset};`;
  }

  return `${stripped} LIMIT ${limit} OFFSET ${offset};`;
}

async function createMysqlConnection(
  alias: string,
  timeoutMs: number
): Promise<Connection> {
  if (createConnectionOverride) {
    return createConnectionOverride();
  }

  const config = getMysqlDatabaseConfig(alias);
  if (!config) {
    throw new Error(`Unknown MySQL database alias: ${alias}`);
  }
  if (!config.user || !config.database) {
    throw new Error(
      `MySQL database alias ${alias} is missing required configuration (user/database).`
    );
  }

  return createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectTimeout: timeoutMs,
    multipleStatements: false,
    rowsAsArray: false,
  });
}

interface MysqlQuerySchemaInput {
  database: string;
  schema?: string;
  table?: string;
}

interface MysqlQuerySchemaOutput {
  database: string;
  schema?: string;
  table?: string;
  tableCount: number;
  columnCount: number;
  tables: Array<{
    name: string;
    columns: Array<{
      name: string;
      dataType: string;
      nullable: boolean;
      comment?: string;
    }>;
  }>;
}

export function buildMysqlQuerySchemaTool(): ToolDefinition {
  return {
    name: "MysqlQuerySchema",
    description:
      'List base tables and columns for a configured MySQL database alias. Input: {"database":"border-defense","table":"alarm_event"}. The optional table filters to one unqualified table name. Returns table names, column names, data types, nullable flags, and column comments.',
    kind: "domain",
    inputSchema: z.strictObject({
      database: z
        .string()
        .min(1)
        .default(DEFAULT_MYSQL_DATABASE)
        .describe("Configured MySQL database alias. Use border-defense unless a skill names another alias."),
      schema: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Optional MySQL schema/database name. Defaults to the alias configured database."),
      table: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Optional unqualified base table name to inspect, for example alarm_event."),
    }),
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    maxResultSizeChars: MAX_MYSQL_RESULT_CHARS,
    validateInput(input) {
      const parsed = input as MysqlQuerySchemaInput;
      assertKnownMysqlDatabase(parsed.database);
      if (parsed.schema && FORBIDDEN_MYSQL_SCHEMAS.has(parsed.schema.toLowerCase())) {
        throw new Error(`MySQL schema ${parsed.schema} is not allowed.`);
      }
    },
    async execute(input, context) {
      const parsed = input as MysqlQuerySchemaInput;
      const database = parsed.database || DEFAULT_MYSQL_DATABASE;
      const config = getMysqlDatabaseConfig(database)!;
      const schema = parsed.schema || config.database;
      const table = parsed.table;

      context.onProgress?.({
        stage: "start",
        message: table
          ? `Inspecting MySQL table ${schema}.${table}`
          : `Inspecting MySQL schema ${schema}`,
      });

      const connection = await createMysqlConnection(database, DEFAULT_MYSQL_TIMEOUT_MS);
      try {
        const [columnRows] = await connection.execute<RowDataPacket[]>(
          `
            SELECT
              c.table_name AS table_name,
              c.column_name AS column_name,
              c.data_type AS data_type,
              c.is_nullable AS is_nullable,
              c.column_comment AS column_comment,
              c.ordinal_position AS ordinal_position
            FROM information_schema.columns c
            JOIN information_schema.tables t
              ON t.table_schema = c.table_schema
             AND t.table_name = c.table_name
            WHERE c.table_schema = ?
              AND t.table_type = 'BASE TABLE'
              AND (? IS NULL OR c.table_name = ?)
            ORDER BY c.table_name, c.ordinal_position
          `,
          [schema, table ?? null, table ?? null]
        );

        const tables = new Map<string, MysqlQuerySchemaOutput["tables"][number]>();
        for (const row of columnRows) {
          const tableName = String(row.table_name);
          let tableEntry = tables.get(tableName);
          if (!tableEntry) {
            tableEntry = { name: tableName, columns: [] };
            tables.set(tableName, tableEntry);
          }
          tableEntry.columns.push({
            name: String(row.column_name),
            dataType: String(row.data_type),
            nullable: String(row.is_nullable).toUpperCase() === "YES",
            comment: row.column_comment ? String(row.column_comment) : undefined,
          });
        }

        const output: MysqlQuerySchemaOutput = {
          database,
          schema,
          ...(table ? { table } : {}),
          tableCount: tables.size,
          columnCount: columnRows.length,
          tables: Array.from(tables.values()),
        };

        context.onProgress?.({
          stage: "complete",
          message: table
            ? `Table ${schema}.${table} returned ${output.tables[0]?.columns.length ?? 0} column(s)`
            : `Schema ${schema} returned ${output.tableCount} table(s), ${output.columnCount} column(s)`,
        });

        return sanitizeForJson(output) as MysqlQuerySchemaOutput;
      } finally {
        await connection.end().catch(() => undefined);
      }
    },
  };
}

interface MysqlQueryInput {
  database: string;
  sql: string;
  limit?: number;
  offset?: number;
  timeout_ms?: number;
}

interface MysqlQueryOutput {
  database: string;
  rowCount: number;
  columns: string[];
  rows: Record<string, unknown>[];
  durationMs: number;
  resultBudget?: {
    truncated: boolean;
    note?: string;
  };
}

export function buildMysqlQueryTool(): ToolDefinition {
  return {
    name: "MysqlQuery",
    aliases: ["mysql-query"],
    description:
      'Execute one read-only MySQL query against a configured database alias. Input: {"database":"border-defense","sql":"select alarm_level, count(*) from alarm_event where alarm_time >= ... group by alarm_level","limit":100,"offset":0}. Only SELECT/WITH queries are allowed.',
    kind: "domain",
    inputSchema: z.strictObject({
      database: z
        .string()
        .min(1)
        .default(DEFAULT_MYSQL_DATABASE)
        .describe("Configured MySQL database alias. Use border-defense unless a skill names another alias."),
      sql: z
        .string()
        .min(1)
        .describe("A single read-only SELECT or WITH SQL statement."),
      limit: z
        .number()
        .int()
        .positive()
        .max(MAX_MYSQL_LIMIT)
        .default(DEFAULT_MYSQL_LIMIT)
        .describe(`Maximum rows to return. Max ${MAX_MYSQL_LIMIT}.`),
      offset: z
        .number()
        .int()
        .min(0)
        .max(MAX_MYSQL_OFFSET)
        .default(DEFAULT_MYSQL_OFFSET)
        .describe("Skip first N rows. Use with limit for pagination."),
      timeout_ms: z
        .number()
        .int()
        .positive()
        .max(MAX_MYSQL_TIMEOUT_MS)
        .default(DEFAULT_MYSQL_TIMEOUT_MS)
        .describe(`Query timeout in milliseconds. Max ${MAX_MYSQL_TIMEOUT_MS}.`),
    }),
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "medium",
    maxResultSizeChars: MAX_MYSQL_RESULT_CHARS,
    validateInput(input) {
      const parsed = input as MysqlQueryInput;
      assertKnownMysqlDatabase(parsed.database);
      validateReadOnlySql(parsed.sql);
    },
    async execute(input, context) {
      const parsed = input as MysqlQueryInput;
      const database = parsed.database || DEFAULT_MYSQL_DATABASE;
      const limit = Math.min(parsed.limit || DEFAULT_MYSQL_LIMIT, MAX_MYSQL_LIMIT);
      const offset = Math.min(parsed.offset ?? DEFAULT_MYSQL_OFFSET, MAX_MYSQL_OFFSET);
      const timeoutMs = Math.min(parsed.timeout_ms || DEFAULT_MYSQL_TIMEOUT_MS, MAX_MYSQL_TIMEOUT_MS);
      const sql = buildLimitedSql(parsed.sql, limit, offset);

      console.log(`[MysqlQuery][${database}] original SQL:\n${parsed.sql}`);
      console.log(`[MysqlQuery][${database}] executed SQL:\n${sql}`);

      context.onProgress?.({
        stage: "start",
        message: `Executing read-only MySQL query on ${database}`,
      });

      const startedAt = Date.now();
      const connection = await createMysqlConnection(database, timeoutMs);
      try {
        const [rows, fields] = await connection.execute<RowDataPacket[]>(sql);
        const durationMs = Date.now() - startedAt;
        const columns = Array.isArray(fields)
          ? fields.map((field) => (field as FieldPacket).name || "unknown")
          : [];

        const typedRows = Array.isArray(rows)
          ? rows.map((row) => {
              const record: Record<string, unknown> = {};
              for (const key of Object.keys(row as Record<string, unknown>)) {
                record[key] = (row as Record<string, unknown>)[key];
              }
              return record;
            })
          : [];

        context.onProgress?.({
          stage: "complete",
          message: `MySQL query returned ${typedRows.length} row(s) from ${database}`,
        });

        const output: MysqlQueryOutput = {
          database,
          rowCount: typedRows.length,
          columns,
          rows: typedRows.slice(0, MAX_MYSQL_PREVIEW_ROWS),
          durationMs,
        };

        const serialized = safeJsonStringify(output);
        if (serialized.length > MAX_MYSQL_INLINE_RESULT_CHARS) {
          output.resultBudget = {
            truncated: true,
            note: `Result exceeds ${MAX_MYSQL_INLINE_RESULT_CHARS} characters. Only the first ${MAX_MYSQL_PREVIEW_ROWS} rows are shown inline.`,
          };
        }

        return sanitizeForJson(output) as MysqlQueryOutput;
      } finally {
        await connection.end().catch(() => undefined);
      }
    },
  };
}
