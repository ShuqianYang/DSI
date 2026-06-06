import { Client } from "pg";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { safeJsonStringify, sanitizeForJson } from "./serialization.js";
import type { ToolDefinition } from "./types.js";
import type { ToolRegistry } from "./toolRegistry.js";

const DEFAULT_SQL_DATABASE = "default";
const DEFAULT_SQL_LIMIT = 100;
const MAX_SQL_LIMIT = 500;
const DEFAULT_SQL_OFFSET = 0;
const MAX_SQL_OFFSET = 10_000;
const DEFAULT_SQL_TIMEOUT_MS = 5_000;
const MAX_SQL_TIMEOUT_MS = 30_000;
const MAX_SQL_RESULT_CHARS = 80_000;
const MAX_SQL_SCHEMA_RESULT_CHARS = 40_000;
const DEFAULT_SQL_INLINE_RESULT_CHARS = 20_000;
const DEFAULT_SQL_PREVIEW_ROWS = 50;
const SQL_ARTIFACT_BASE_DIR = "api/tmp/agent-loop/sqlquery";

const FORBIDDEN_SQL_FUNCTIONS = new Set([
  "dblink",
  "dblink_cancel_query",
  "dblink_close",
  "dblink_connect",
  "dblink_connect_u",
  "dblink_disconnect",
  "dblink_error_message",
  "dblink_exec",
  "dblink_fetch",
  "dblink_get_connections",
  "dblink_get_notify",
  "dblink_get_pkey",
  "dblink_get_result",
  "dblink_is_busy",
  "dblink_open",
  "dblink_send_query",
  "lo_close",
  "lo_creat",
  "lo_create",
  "lo_export",
  "lo_from_bytea",
  "lo_import",
  "lo_lseek",
  "lo_lseek64",
  "lo_open",
  "lo_put",
  "lo_tell",
  "lo_tell64",
  "lo_truncate",
  "lo_truncate64",
  "lo_unlink",
  "lowrite",
  "nextval",
  "pg_advisory_lock",
  "pg_advisory_lock_shared",
  "pg_advisory_unlock",
  "pg_advisory_unlock_all",
  "pg_advisory_unlock_shared",
  "pg_backup_start",
  "pg_backup_stop",
  "pg_cancel_backend",
  "pg_create_restore_point",
  "pg_export_snapshot",
  "pg_import_system_collations",
  "pg_log_backend_memory_contexts",
  "pg_notify",
  "pg_promote",
  "pg_reload_conf",
  "pg_rotate_logfile",
  "pg_start_backup",
  "pg_stat_reset",
  "pg_stat_reset_replication_slot",
  "pg_stat_reset_shared",
  "pg_stat_reset_single_function_counters",
  "pg_stat_reset_single_table_counters",
  "pg_stop_backup",
  "pg_switch_wal",
  "pg_terminate_backend",
  "postgres_fdw_disconnect",
  "postgres_fdw_disconnect_all",
  "setval",
]);

const FORBIDDEN_SQL_SCHEMAS = new Set([
  "information_schema",
  "pg_catalog",
]);

const FORBIDDEN_SQL_CATALOG_RELATIONS = new Set([
  "pg_auth_members",
  "pg_authid",
  "pg_available_extension_versions",
  "pg_available_extensions",
  "pg_config",
  "pg_db_role_setting",
  "pg_file_settings",
  "pg_foreign_data_wrapper",
  "pg_foreign_server",
  "pg_foreign_table",
  "pg_group",
  "pg_hba_file_rules",
  "pg_indexes",
  "pg_locks",
  "pg_matviews",
  "pg_policies",
  "pg_policy",
  "pg_prepared_statements",
  "pg_publication",
  "pg_publication_tables",
  "pg_replication_origin",
  "pg_replication_slots",
  "pg_roles",
  "pg_rules",
  "pg_seclabel",
  "pg_seclabels",
  "pg_shadow",
  "pg_shdescription",
  "pg_stat_activity",
  "pg_stat_replication",
  "pg_stat_subscription",
  "pg_stats",
  "pg_subscription",
  "pg_tables",
  "pg_user",
  "pg_user_mapping",
  "pg_user_mappings",
  "pg_views",
]);

export function registerDomainTools(registry: ToolRegistry): void {
  for (const tool of buildDomainTools()) {
    registry.register(tool);
  }
}

export function buildDomainTools(): ToolDefinition[] {
  return [
    buildSqlQuerySchemaTool(),
    buildSqlQueryTool(),
  ];
}

function buildSqlQuerySchemaTool(): ToolDefinition {
  return {
    name: "SqlQuerySchema",
    description:
      'List base tables, columns, and same-schema foreign-key relationships for an allowlisted database schema. Input: {"database":"default","schema":"agent_smoke"}. Configure allowlisted schemas with AGENT_SQL_ALLOWED_SCHEMAS or AGENT_SQL_ALLOWED_SCHEMAS_<ALIAS>. Returns only table names, column names, data types, nullable flags, and join relationships.',
    kind: "domain",
    inputSchema: z.strictObject({
      database: z
        .string()
        .min(1)
        .default(DEFAULT_SQL_DATABASE)
        .describe("Configured database alias, not a connection string. Use default unless a skill or user names another alias."),
      schema: z
        .string()
        .min(1)
        .describe("Allowlisted PostgreSQL schema name to inspect, for example agent_smoke."),
    }),
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    maxResultSizeChars: MAX_SQL_SCHEMA_RESULT_CHARS,
    validateInput(input) {
      const parsed = input as SqlQuerySchemaInput;
      assertKnownSqlDatabase(parsed.database);
      assertAllowedSqlSchema(parsed.database, parsed.schema);
    },
    async execute(input, context) {
      const parsed = input as SqlQuerySchemaInput;
      const database = parsed.database || DEFAULT_SQL_DATABASE;
      const schema = parsed.schema;
      const connectionString = getSqlDatabaseConnectionString(database);
      if (!connectionString) {
        throw new Error(`Unknown SQL database alias: ${database}`);
      }

      const client = new Client({
        connectionString,
        query_timeout: DEFAULT_SQL_TIMEOUT_MS,
        statement_timeout: DEFAULT_SQL_TIMEOUT_MS,
      });

      context.onProgress?.({
        stage: "start",
        message: `Inspecting allowlisted SQL schema ${schema} on ${database}`,
      });

      try {
        await client.connect();
        await client.query("SELECT set_config('statement_timeout', $1, false)", [`${DEFAULT_SQL_TIMEOUT_MS}ms`]);
        await client.query("SET default_transaction_read_only = on");

        const [columnsResult, foreignKeysResult] = await Promise.all([
          client.query(
            `
              SELECT
                c.table_name,
                c.column_name,
                c.data_type,
                c.is_nullable,
                c.ordinal_position
              FROM information_schema.columns c
              JOIN information_schema.tables t
                ON t.table_schema = c.table_schema
               AND t.table_name = c.table_name
              WHERE c.table_schema = $1
                AND t.table_type = 'BASE TABLE'
              ORDER BY c.table_name, c.ordinal_position
            `,
            [schema]
          ),
          client.query(
            `
              SELECT
                kcu.table_name,
                kcu.column_name,
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name
              FROM information_schema.table_constraints tc
              JOIN information_schema.key_column_usage kcu
                ON kcu.constraint_schema = tc.constraint_schema
               AND kcu.constraint_name = tc.constraint_name
               AND kcu.table_schema = tc.table_schema
               AND kcu.table_name = tc.table_name
              JOIN information_schema.constraint_column_usage ccu
                ON ccu.constraint_schema = tc.constraint_schema
               AND ccu.constraint_name = tc.constraint_name
              WHERE tc.constraint_type = 'FOREIGN KEY'
                AND tc.table_schema = $1
                AND ccu.table_schema = $1
              ORDER BY kcu.table_name, kcu.column_name
            `,
            [schema]
          ),
        ]);

        const output = buildSqlSchemaOutput(
          database,
          schema,
          columnsResult.rows as SqlSchemaColumnRow[],
          foreignKeysResult.rows as SqlSchemaForeignKeyRow[]
        );

        context.onProgress?.({
          stage: "complete",
          message: `Schema ${schema} returned ${output.tableCount} table(s), ${output.columnCount} column(s), and ${output.foreignKeyCount} foreign key(s)`,
        });

        return fitSqlSchemaResultToBudget(output);
      } finally {
        await client.end().catch(() => undefined);
      }
    },
  };
}

function buildSqlQueryTool(): ToolDefinition {
  return {
    name: "SqlQuery",
    description:
      'Execute one read-only SQL query against a configured database alias. Input: {"database":"default","sql":"select ...","limit":100,"offset":0}. Only SELECT/WITH queries are allowed. Large result sets return a preview plus a JSONL artifact path for the full rows.',
    kind: "domain",
    inputSchema: z.strictObject({
      database: z
        .string()
        .min(1)
        .default(DEFAULT_SQL_DATABASE)
        .describe("Configured database alias, not a connection string. Use default unless a skill or user names another alias."),
      sql: z
        .string()
        .min(1)
        .describe("A single read-only SELECT or WITH SQL statement."),
      limit: z
        .number()
        .int()
        .positive()
        .max(MAX_SQL_LIMIT)
        .default(DEFAULT_SQL_LIMIT)
        .describe(`Maximum rows to return. Max ${MAX_SQL_LIMIT}.`),
      offset: z
        .number()
        .int()
        .min(0)
        .max(MAX_SQL_OFFSET)
        .default(DEFAULT_SQL_OFFSET)
        .describe("Skip first N rows. Use with limit for pagination."),
      timeout_ms: z
        .number()
        .int()
        .positive()
        .max(MAX_SQL_TIMEOUT_MS)
        .default(DEFAULT_SQL_TIMEOUT_MS)
        .describe(`Query timeout in milliseconds. Max ${MAX_SQL_TIMEOUT_MS}.`),
    }),
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "medium",
    maxResultSizeChars: MAX_SQL_RESULT_CHARS,
    validateInput(input) {
      const parsed = input as SqlQueryInput;
      assertKnownSqlDatabase(parsed.database);
      validateReadOnlySql(parsed.sql);
    },
    async execute(input, context) {
      const parsed = input as SqlQueryInput;
      const database = parsed.database || DEFAULT_SQL_DATABASE;
      const limit = Math.min(parsed.limit || DEFAULT_SQL_LIMIT, MAX_SQL_LIMIT);
      const offset = Math.min(parsed.offset ?? DEFAULT_SQL_OFFSET, MAX_SQL_OFFSET);
      const timeoutMs = Math.min(parsed.timeout_ms || DEFAULT_SQL_TIMEOUT_MS, MAX_SQL_TIMEOUT_MS);
      const sql = buildLimitedSql(parsed.sql, limit, offset);
      const connectionString = getSqlDatabaseConnectionString(database);
      if (!connectionString) {
        throw new Error(`Unknown SQL database alias: ${database}`);
      }

      const startedAt = Date.now();
      const client = new Client({
        connectionString,
        query_timeout: timeoutMs,
        statement_timeout: timeoutMs,
      });

      context.onProgress?.({
        stage: "start",
        message: `Executing read-only SQL on ${database}`,
      });

      try {
        await client.connect();
        await client.query("SELECT set_config('statement_timeout', $1, false)", [`${timeoutMs}ms`]);
        await client.query("SET default_transaction_read_only = on");
        await assertNoForeignSqlPlan(client, sql);
        const result = await client.query(sql);
        const durationMs = Date.now() - startedAt;

        context.onProgress?.({
          stage: "complete",
          message: `SQL returned ${result.rowCount ?? result.rows.length} row(s) from ${database}`,
        });

        return await buildSqlQueryOutput({
          taskId: context.taskId,
          database,
          rowCount: result.rowCount ?? result.rows.length,
          rows: result.rows,
          columns: result.fields.map((field) => ({
            name: field.name,
            dataTypeId: field.dataTypeID,
          })),
          limit,
          offset,
          durationMs,
        });
      } finally {
        await client.end().catch(() => undefined);
      }
    },
  };
}

interface SqlQueryInput {
  database: string;
  sql: string;
  limit: number;
  offset: number;
  timeout_ms: number;
}

interface SqlQuerySchemaInput {
  database: string;
  schema: string;
}

interface SqlQueryOutput {
  database: string;
  rowCount: number;
  returnedRows: number;
  previewRows?: number;
  columns: Array<{
    name: string;
    dataTypeId: number;
  }>;
  rows: Array<Record<string, unknown>>;
  limit: number;
  offset: number;
  truncated: boolean;
  durationMs: number;
  artifact?: {
    kind: "jsonl";
    path: string;
    rowCount: number;
    bytes: number;
    readHint: string;
  };
  resultBudget?: {
    truncated: boolean;
    originalChars?: number;
    maxChars?: number;
    originalReturnedRows?: number;
    omittedRows?: number;
    note?: string;
  };
}

interface BuildSqlQueryOutputInput {
  taskId: string;
  database: string;
  rowCount: number;
  returnedRows?: number;
  columns: SqlQueryOutput["columns"];
  rows: Array<Record<string, unknown>>;
  limit: number;
  offset: number;
  durationMs: number;
}

interface SqlIdentifierToken {
  value: string;
  start: number;
  end: number;
}

interface SqlSchemaColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: "YES" | "NO" | string;
  ordinal_position: number;
}

interface SqlSchemaForeignKeyRow {
  table_name: string;
  column_name: string;
  foreign_table_name: string;
  foreign_column_name: string;
}

interface SqlSchemaOutput {
  database: string;
  schema: string;
  tableCount: number;
  columnCount: number;
  foreignKeyCount: number;
  tables: Array<{
    name: string;
    columns: Array<{
      name: string;
      dataType: string;
      nullable: boolean;
    }>;
  }>;
  foreignKeys: Array<{
    table: string;
    column: string;
    foreignTable: string;
    foreignColumn: string;
  }>;
  resultBudget?: {
    truncated: boolean;
    originalChars?: number;
    maxChars?: number;
    omittedTables?: number;
    omittedForeignKeys?: number;
    note?: string;
  };
}

function getSqlDatabaseConnectionString(database: string): string | undefined {
  const normalized = normalizeDatabaseAlias(database);
  const configured = parseConfiguredSqlDatabases();
  if (configured[normalized]) return configured[normalized];

  const envName = `AGENT_SQL_DATABASE_URL_${normalized.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  return process.env[envName] ?? (normalized === DEFAULT_SQL_DATABASE ? process.env.DATABASE_URL : undefined);
}

function assertKnownSqlDatabase(database: string): void {
  if (getSqlDatabaseConnectionString(database)) return;
  throw new Error(
    `Unknown SQL database alias: ${database}. Configure DATABASE_URL for default, AGENT_SQL_DATABASE_URLS as JSON, or AGENT_SQL_DATABASE_URL_<ALIAS>.`
  );
}

function assertAllowedSqlSchema(database: string, schema: string): void {
  const normalizedSchema = normalizeSchemaName(schema);
  if (FORBIDDEN_SQL_SCHEMAS.has(normalizedSchema) || normalizedSchema.startsWith("pg_")) {
    throw new Error(`SqlQuerySchema rejected access to restricted SQL schema: ${schema}.`);
  }

  const allowedSchemas = getAllowedSqlSchemas(database);
  if (allowedSchemas.has(schema)) return;

  if (allowedSchemas.has(normalizedSchema)) return;

  const databaseAlias = normalizeDatabaseAlias(database);
  throw new Error(
    `SQL schema is not allowlisted for database alias ${databaseAlias}: ${schema}. Configure AGENT_SQL_ALLOWED_SCHEMAS or AGENT_SQL_ALLOWED_SCHEMAS_${formatEnvAlias(databaseAlias)}.`
  );
}

function parseConfiguredSqlDatabases(): Record<string, string> {
  const raw = process.env.AGENT_SQL_DATABASE_URLS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== "")
        .map(([alias, connectionString]) => [normalizeDatabaseAlias(alias), connectionString])
    );
  } catch {
    return {};
  }
}

function normalizeDatabaseAlias(database: string): string {
  return database.trim().toLowerCase();
}

function getAllowedSqlSchemas(database: string): Set<string> {
  const normalizedDatabase = normalizeDatabaseAlias(database);
  const envName = `AGENT_SQL_ALLOWED_SCHEMAS_${formatEnvAlias(normalizedDatabase)}`;
  const envSpecificSchemas = parseSchemaList(process.env[envName]);
  if (envSpecificSchemas.length > 0) {
    return new Set(envSpecificSchemas);
  }

  const configured = parseConfiguredSqlSchemas();
  return new Set(configured[normalizedDatabase] ?? configured[DEFAULT_SQL_DATABASE] ?? []);
}

function parseConfiguredSqlSchemas(): Record<string, string[]> {
  const raw = process.env.AGENT_SQL_ALLOWED_SCHEMAS;
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return {
        [DEFAULT_SQL_DATABASE]: normalizeSchemaList(parsed),
      };
    }
    if (parsed && typeof parsed === "object") {
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>)
          .map(([database, value]) => [normalizeDatabaseAlias(database), normalizeSchemaList(value)] as const)
          .filter((entry) => entry[1].length > 0)
      );
    }
  } catch {
    const schemas = parseSchemaList(raw);
    if (schemas.length > 0) {
      return {
        [DEFAULT_SQL_DATABASE]: schemas,
      };
    }
  }

  return {};
}

function parseSchemaList(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    return normalizeSchemaList(JSON.parse(raw) as unknown);
  } catch {
    return normalizeSchemaList(raw);
  }
}

function normalizeSchemaList(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  return Array.from(
    new Set(
      values
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

function normalizeSchemaName(schema: string): string {
  return schema.trim().toLowerCase();
}

function formatEnvAlias(database: string): string {
  return database.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

function validateReadOnlySql(sql: string): void {
  const statements = splitSqlStatements(sql);
  if (statements.length !== 1) {
    throw new Error("SqlQuery accepts exactly one SQL statement.");
  }

  const statement = statements[0]!;
  const normalized = normalizeSqlForPolicy(statement);
  if (!/^(select|with)\b/i.test(normalized)) {
    throw new Error("SqlQuery only allows SELECT or WITH statements.");
  }

  const forbiddenPatterns = [
    /\b(insert|update|delete|merge|upsert|drop|alter|create|truncate|grant|revoke|copy|call|do|execute|prepare|deallocate|vacuum|analyze|refresh|listen|notify)\b/i,
    /\bselect\s+into\b/i,
    /\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b/i,
  ];

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(normalized)) {
      throw new Error("SqlQuery rejected a statement containing a forbidden write, DDL, lock, or administrative operation.");
    }
  }

  rejectForbiddenSqlFunctions(statement);
  rejectForbiddenSqlCatalogReferences(statement);
}

function buildLimitedSql(sql: string, limit: number, offset: number): string {
  const statements = splitSqlStatements(sql);
  const statement = stripTrailingSemicolon(statements[0] ?? sql);

  // If the user already provided LIMIT (with optional OFFSET), don't wrap again.
  // Instead, cap their limit to our maximum to enforce the safety bound.
  const endsWithLimit = /\bLIMIT\s+\d+(\s+OFFSET\s+\d+)?\s*$/i.test(statement);
  if (endsWithLimit) {
    return statement.replace(/\bLIMIT\s+(\d+)/i, (_, userLimit) => `LIMIT ${Math.min(parseInt(userLimit, 10), limit)}`);
  }

  return `SELECT * FROM (${statement}) AS dsi_sqlquery_result LIMIT ${limit} OFFSET ${offset}`;
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: "'" | "\"" | "`" | undefined;
  let dollarQuoteTag: string | undefined;
  let lineComment = false;
  let blockCommentDepth = 0;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]!;
    const next = sql[index + 1];
    current += char;

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }

    if (blockCommentDepth > 0) {
      if (char === "/" && next === "*") {
        blockCommentDepth += 1;
        current += next;
        index += 1;
      } else if (char === "*" && next === "/") {
        blockCommentDepth -= 1;
        current += next;
        index += 1;
      }
      continue;
    }

    if (dollarQuoteTag) {
      if (sql.startsWith(dollarQuoteTag, index)) {
        current += sql.slice(index + 1, index + dollarQuoteTag.length);
        index += dollarQuoteTag.length - 1;
        dollarQuoteTag = undefined;
      }
      continue;
    }

    if (quote) {
      if (char === quote) {
        if (next === quote) {
          current += next;
          index += 1;
        } else {
          quote = undefined;
        }
      }
      continue;
    }

    if (char === "-" && next === "-") {
      lineComment = true;
      current += next;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockCommentDepth = 1;
      current += next;
      index += 1;
      continue;
    }
    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "$") {
      const match = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) {
        dollarQuoteTag = match[0];
        current += dollarQuoteTag.slice(1);
        index += dollarQuoteTag.length - 1;
        continue;
      }
    }

    if (char === ";") {
      const statement = stripTrailingSemicolon(current).trim();
      if (statement) statements.push(statement);
      current = "";
    }
  }

  const tail = current.trim();
  if (tail) statements.push(stripTrailingSemicolon(tail).trim());
  return statements.filter(Boolean);
}

function normalizeSqlForPolicy(sql: string): string {
  let result = "";
  let quote: "'" | "\"" | "`" | undefined;
  let dollarQuoteTag: string | undefined;
  let lineComment = false;
  let blockCommentDepth = 0;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]!;
    const next = sql[index + 1];

    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
        result += " ";
      }
      continue;
    }

    if (blockCommentDepth > 0) {
      if (char === "/" && next === "*") {
        blockCommentDepth += 1;
        index += 1;
      } else if (char === "*" && next === "/") {
        blockCommentDepth -= 1;
        index += 1;
      }
      continue;
    }

    if (dollarQuoteTag) {
      if (sql.startsWith(dollarQuoteTag, index)) {
        index += dollarQuoteTag.length - 1;
        dollarQuoteTag = undefined;
      }
      continue;
    }

    if (quote) {
      if (char === quote) {
        if (next === quote) {
          index += 1;
        } else {
          quote = undefined;
        }
      }
      continue;
    }

    if (char === "-" && next === "-") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockCommentDepth = 1;
      index += 1;
      continue;
    }
    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      result += " ";
      continue;
    }
    if (char === "$") {
      const match = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) {
        dollarQuoteTag = match[0];
        index += dollarQuoteTag.length - 1;
        result += " ";
        continue;
      }
    }

    result += char;
  }

  return result.replace(/\s+/g, " ").trim();
}

function stripTrailingSemicolon(sql: string): string {
  return sql.replace(/;\s*$/, "");
}

function rejectForbiddenSqlFunctions(sql: string): void {
  for (const token of collectSqlIdentifierTokens(sql)) {
    if (!FORBIDDEN_SQL_FUNCTIONS.has(token.value)) continue;
    const next = nextNonWhitespaceChar(sql, token.end);
    if (next === "(") {
      throw new Error(`SqlQuery rejected forbidden SQL function call: ${token.value}.`);
    }
  }
}

function rejectForbiddenSqlCatalogReferences(sql: string): void {
  for (const token of collectSqlIdentifierTokens(sql)) {
    const previous = previousNonWhitespaceChar(sql, token.start);
    const next = nextNonWhitespaceChar(sql, token.end);

    if (FORBIDDEN_SQL_SCHEMAS.has(token.value) && next === ".") {
      throw new Error(`SqlQuery rejected access to restricted SQL schema: ${token.value}.`);
    }

    if (FORBIDDEN_SQL_CATALOG_RELATIONS.has(token.value) && previous !== ".") {
      throw new Error(`SqlQuery rejected access to restricted PostgreSQL catalog object: ${token.value}.`);
    }
  }
}

function collectSqlIdentifierTokens(sql: string): SqlIdentifierToken[] {
  const tokens: SqlIdentifierToken[] = [];
  let index = 0;
  let lineComment = false;
  let blockCommentDepth = 0;
  let dollarQuoteTag: string | undefined;

  while (index < sql.length) {
    const char = sql[index]!;
    const next = sql[index + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      index += 1;
      continue;
    }

    if (blockCommentDepth > 0) {
      if (char === "/" && next === "*") {
        blockCommentDepth += 1;
        index += 2;
      } else if (char === "*" && next === "/") {
        blockCommentDepth -= 1;
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }

    if (dollarQuoteTag) {
      if (sql.startsWith(dollarQuoteTag, index)) {
        index += dollarQuoteTag.length;
        dollarQuoteTag = undefined;
      } else {
        index += 1;
      }
      continue;
    }

    if (char === "-" && next === "-") {
      lineComment = true;
      index += 2;
      continue;
    }
    if (char === "/" && next === "*") {
      blockCommentDepth = 1;
      index += 2;
      continue;
    }
    if (char === "'") {
      index = skipSingleQuotedString(sql, index);
      continue;
    }
    if (char === "`") {
      index = skipDelimitedIdentifier(sql, index, "`");
      continue;
    }
    if (char === "$") {
      const match = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) {
        dollarQuoteTag = match[0];
        index += dollarQuoteTag.length;
        continue;
      }
    }
    if (char === "\"") {
      const token = readQuotedIdentifier(sql, index);
      tokens.push(token);
      index = token.end;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      index += 1;
      while (index < sql.length && /[A-Za-z0-9_$]/.test(sql[index]!)) {
        index += 1;
      }
      tokens.push({
        value: sql.slice(start, index).toLowerCase(),
        start,
        end: index,
      });
      continue;
    }

    index += 1;
  }

  return tokens;
}

function skipSingleQuotedString(sql: string, start: number): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === "'") {
      if (sql[index + 1] === "'") {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return index;
}

function skipDelimitedIdentifier(sql: string, start: number, delimiter: "`"): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === delimiter) {
      if (sql[index + 1] === delimiter) {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return index;
}

function readQuotedIdentifier(sql: string, start: number): SqlIdentifierToken {
  let index = start + 1;
  let value = "";
  while (index < sql.length) {
    const char = sql[index]!;
    if (char === "\"") {
      if (sql[index + 1] === "\"") {
        value += "\"";
        index += 2;
        continue;
      }
      return {
        value: value.toLowerCase(),
        start,
        end: index + 1,
      };
    }
    value += char;
    index += 1;
  }
  return {
    value: value.toLowerCase(),
    start,
    end: index,
  };
}

function previousNonWhitespaceChar(sql: string, position: number): string | undefined {
  for (let index = position - 1; index >= 0; index -= 1) {
    const char = sql[index]!;
    if (!/\s/.test(char)) return char;
  }
  return undefined;
}

function nextNonWhitespaceChar(sql: string, position: number): string | undefined {
  for (let index = position; index < sql.length; index += 1) {
    const char = sql[index]!;
    if (!/\s/.test(char)) return char;
  }
  return undefined;
}

async function assertNoForeignSqlPlan(client: Client, sql: string): Promise<void> {
  const result = await client.query(`EXPLAIN (FORMAT JSON) ${sql}`);
  const plan = result.rows[0]?.["QUERY PLAN"];
  if (containsForeignPlanNode(plan)) {
    throw new Error("SqlQuery rejected a query plan that accesses a foreign data wrapper.");
  }
}

function containsForeignPlanNode(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => containsForeignPlanNode(entry));
  }
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  const nodeType = record["Node Type"];
  if (typeof nodeType === "string" && /\bforeign\b/i.test(nodeType)) {
    return true;
  }

  return Object.values(record).some((entry) => containsForeignPlanNode(entry));
}

function buildSqlSchemaOutput(
  database: string,
  schema: string,
  columnRows: SqlSchemaColumnRow[],
  foreignKeyRows: SqlSchemaForeignKeyRow[]
): SqlSchemaOutput {
  const tables = new Map<string, SqlSchemaOutput["tables"][number]>();

  for (const row of columnRows) {
    const tableName = row.table_name;
    let table = tables.get(tableName);
    if (!table) {
      table = {
        name: tableName,
        columns: [],
      };
      tables.set(tableName, table);
    }

    table.columns.push({
      name: row.column_name,
      dataType: row.data_type,
      nullable: row.is_nullable === "YES",
    });
  }

  return {
    database,
    schema,
    tableCount: tables.size,
    columnCount: columnRows.length,
    tables: Array.from(tables.values()),
    foreignKeyCount: foreignKeyRows.length,
    foreignKeys: foreignKeyRows.map((row) => ({
      table: row.table_name,
      column: row.column_name,
      foreignTable: row.foreign_table_name,
      foreignColumn: row.foreign_column_name,
    })),
  };
}

function fitSqlSchemaResultToBudget(output: SqlSchemaOutput): SqlSchemaOutput {
  const originalChars = safeJsonStringify(output).length;
  const untruncatedOutput = {
    ...output,
    resultBudget: {
      truncated: false,
    },
  };
  if (safeJsonStringify(untruncatedOutput).length <= MAX_SQL_SCHEMA_RESULT_CHARS) {
    return sanitizeForJson(untruncatedOutput) as SqlSchemaOutput;
  }

  let keptTables = output.tables;
  let keptForeignKeys = output.foreignKeys;
  while (keptTables.length > 0) {
    keptTables = keptTables.slice(0, Math.floor(keptTables.length / 2));
    keptForeignKeys = filterForeignKeysForTables(output.foreignKeys, keptTables);
    const candidate = buildBudgetedSqlSchemaOutput(output, keptTables, keptForeignKeys, originalChars);
    if (safeJsonStringify(candidate).length <= MAX_SQL_SCHEMA_RESULT_CHARS) {
      return sanitizeForJson(candidate) as SqlSchemaOutput;
    }
  }

  const noTablesCandidate = buildBudgetedSqlSchemaOutput(output, [], [], originalChars);
  if (safeJsonStringify(noTablesCandidate).length <= MAX_SQL_SCHEMA_RESULT_CHARS) {
    return sanitizeForJson(noTablesCandidate) as SqlSchemaOutput;
  }

  return sanitizeForJson({
    database: output.database,
    schema: output.schema,
    tableCount: output.tableCount,
    columnCount: output.columnCount,
    foreignKeyCount: output.foreignKeyCount,
    tables: [],
    foreignKeys: [],
    resultBudget: {
      truncated: true,
      originalChars,
      maxChars: MAX_SQL_SCHEMA_RESULT_CHARS,
      omittedTables: output.tables.length,
      omittedForeignKeys: output.foreignKeys.length,
      note: "SqlQuerySchema output exceeded the result budget. Tables were omitted; request a smaller allowlisted schema.",
    },
  }) as SqlSchemaOutput;
}

function buildBudgetedSqlSchemaOutput(
  output: SqlSchemaOutput,
  tables: SqlSchemaOutput["tables"],
  foreignKeys: SqlSchemaOutput["foreignKeys"],
  originalChars: number
): SqlSchemaOutput {
  return {
    ...output,
    tables,
    foreignKeys,
    resultBudget: {
      truncated: true,
      originalChars,
      maxChars: MAX_SQL_SCHEMA_RESULT_CHARS,
      omittedTables: output.tables.length - tables.length,
      omittedForeignKeys: output.foreignKeys.length - foreignKeys.length,
      note: "SqlQuerySchema output exceeded the result budget. Kept a table prefix and omitted the remainder.",
    },
  };
}

function filterForeignKeysForTables(
  foreignKeys: SqlSchemaOutput["foreignKeys"],
  tables: SqlSchemaOutput["tables"]
): SqlSchemaOutput["foreignKeys"] {
  const tableNames = new Set(tables.map((table) => table.name));
  return foreignKeys.filter((foreignKey) =>
    tableNames.has(foreignKey.table) && tableNames.has(foreignKey.foreignTable)
  );
}

async function buildSqlQueryOutput(input: BuildSqlQueryOutputInput): Promise<SqlQueryOutput> {
  const returnedRows = input.returnedRows ?? input.rows.length;
  const rowsChars = safeJsonStringify(input.rows).length;
  const shouldWriteArtifact =
    input.rows.length > DEFAULT_SQL_PREVIEW_ROWS || rowsChars > DEFAULT_SQL_INLINE_RESULT_CHARS;
  const previewRows = shouldWriteArtifact ? input.rows.slice(0, DEFAULT_SQL_PREVIEW_ROWS) : input.rows;
  const artifact = shouldWriteArtifact
    ? await writeSqlQueryArtifact({
        taskId: input.taskId,
        rows: input.rows,
      })
    : undefined;

  return fitSqlResultToBudget({
    database: input.database,
    rowCount: input.rowCount,
    returnedRows,
    previewRows: previewRows.length,
    columns: input.columns,
    rows: previewRows,
    limit: input.limit,
    offset: input.offset,
    truncated: returnedRows >= input.limit,
    durationMs: input.durationMs,
    ...(artifact ? { artifact } : {}),
  });
}

async function writeSqlQueryArtifact(input: {
  taskId: string;
  rows: Array<Record<string, unknown>>;
}): Promise<NonNullable<SqlQueryOutput["artifact"]>> {
  const relativeDir = path.join(SQL_ARTIFACT_BASE_DIR, safePathSegment(input.taskId)).replace(/\\/g, "/");
  const relativePath = path.join(
    relativeDir,
    `sqlquery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`
  ).replace(/\\/g, "/");
  const workspaceRoot = getWorkspaceRoot();
  const absolutePath = path.join(workspaceRoot, relativePath);
  const content = input.rows.map((row) => safeJsonStringify(row)).join("\n");

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content ? `${content}\n` : "", "utf8");

  return {
    kind: "jsonl",
    path: relativePath,
    rowCount: input.rows.length,
    bytes: Buffer.byteLength(content ? `${content}\n` : "", "utf8"),
    readHint: `Use Read with {"file_path":"${relativePath}"} if the full SqlQuery result is needed.`,
  };
}

function safePathSegment(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9_.-]/g, "_").replace(/_+/g, "_");
  return normalized || "unknown-task";
}

function getWorkspaceRoot(): string {
  return path.resolve(process.env.AGENT_WORKSPACE_ROOT || path.join(process.cwd(), ".."));
}

function fitSqlResultToBudget(output: SqlQueryOutput): SqlQueryOutput {
  const originalChars = safeJsonStringify(output).length;
  const untruncatedOutput = {
    ...output,
    resultBudget: {
      truncated: false,
    },
  };
  if (safeJsonStringify(untruncatedOutput).length <= MAX_SQL_RESULT_CHARS) {
    return sanitizeForJson(untruncatedOutput) as SqlQueryOutput;
  }

  let keptRows = output.rows;
  while (keptRows.length > 0) {
    keptRows = keptRows.slice(0, Math.floor(keptRows.length / 2));
    const candidate = buildBudgetedSqlOutput(output, keptRows, originalChars);
    if (safeJsonStringify(candidate).length <= MAX_SQL_RESULT_CHARS) {
      return sanitizeForJson(candidate) as SqlQueryOutput;
    }
  }

  const candidate = buildBudgetedSqlOutput(output, [], originalChars);
  if (safeJsonStringify(candidate).length <= MAX_SQL_RESULT_CHARS) {
    return sanitizeForJson(candidate) as SqlQueryOutput;
  }

  return sanitizeForJson({
    database: output.database,
    rowCount: output.rowCount,
    returnedRows: output.returnedRows,
    previewRows: 0,
    columns: output.columns,
    rows: [],
    limit: output.limit,
    offset: output.offset,
    truncated: true,
    durationMs: output.durationMs,
    ...(output.artifact ? { artifact: output.artifact } : {}),
    resultBudget: {
      truncated: true,
      originalChars,
      maxChars: MAX_SQL_RESULT_CHARS,
      originalReturnedRows: output.returnedRows,
      omittedRows: output.rows.length,
      note: output.artifact
        ? "SqlQuery output exceeded the result budget. Inline preview rows were omitted; use the artifact path for the full row set."
        : "SqlQuery output exceeded the result budget. Rows were omitted; rerun with a narrower SELECT list, WHERE clause, or lower limit.",
    },
  }) as SqlQueryOutput;
}

function buildBudgetedSqlOutput(
  output: SqlQueryOutput,
  rows: Array<Record<string, unknown>>,
  originalChars: number
): SqlQueryOutput {
  return {
    ...output,
    previewRows: rows.length,
    rows,
    truncated: true,
    resultBudget: {
      truncated: true,
      originalChars,
      maxChars: MAX_SQL_RESULT_CHARS,
      originalReturnedRows: output.returnedRows,
      omittedRows: output.rows.length - rows.length,
      note: output.artifact
        ? "SqlQuery output exceeded the result budget. Kept a preview prefix; use the artifact path for the full row set."
        : "SqlQuery output exceeded the result budget. Kept a row prefix and omitted the remainder; use a narrower query if more detail is needed.",
    },
  };
}

// Add first-party data-access tools here, for example:
// buildGisEntityQueryTool(), buildKnowledgeBaseSearchTool(), etc.
// Keep skill scripts for workflow-specific helpers; production database access
// should go through registered domain tools so schemas, permissions, auditing,
// and result normalization remain centralized.
