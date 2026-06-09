import { Client } from "pg";
import type { ToolDefinition } from "../../_shared/types.js";
import {
  DEFAULT_SQL_DATABASE,
  DEFAULT_SQL_TIMEOUT_MS,
  MAX_SQL_SCHEMA_RESULT_CHARS,
  assertKnownSqlDatabase,
  assertAllowedSqlSchema,
  assertUnqualifiedSqlTableName,
  getSqlDatabaseConnectionString,
} from "./_shared.js";

export function buildSqlQuerySchemaTool(): ToolDefinition {
  return {
    name: "SqlQuerySchema",
    description:
      'List base tables, columns, and same-schema foreign-key relationships for an allowlisted database schema. Input: {"database":"default","schema":"agent_smoke","table":"incidents"}. The optional table filters to one unqualified table name. Configure allowlisted schemas with AGENT_SQL_ALLOWED_SCHEMAS or AGENT_SQL_ALLOWED_SCHEMAS_<ALIAS>. Returns only table names, column names, data types, nullable flags, and join relationships.',
    kind: "domain",
    inputSchema: z.strictObject({
      database: z
        .string()
        .min(1)
        .default(DEFAULT_SQL_DATABASE)
        .describe("Configured database alias, not a connection string. Use default unless a skill or user names another alias."),
      schema: z
        .string()
        .trim()
        .min(1)
        .describe("Allowlisted PostgreSQL schema name to inspect, for example agent_smoke."),
      table: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Optional unqualified base table name to inspect within schema, for example incidents."),
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
      if (parsed.table) assertUnqualifiedSqlTableName(parsed.table);
    },
    async execute(input, context) {
      const parsed = input as SqlQuerySchemaInput;
      const database = parsed.database || DEFAULT_SQL_DATABASE;
      const schema = parsed.schema;
      const table = parsed.table;
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
        message: table
          ? `Inspecting allowlisted SQL table ${schema}.${table} on ${database}`
          : `Inspecting allowlisted SQL schema ${schema} on ${database}`,
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
                AND ($2::text IS NULL OR c.table_name = $2)
              ORDER BY c.table_name, c.ordinal_position
            `,
            [schema, table ?? null]
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
                AND ($2::text IS NULL OR kcu.table_name = $2 OR ccu.table_name = $2)
              ORDER BY kcu.table_name, kcu.column_name
            `,
            [schema, table ?? null]
          ),
        ]);

        const output = buildSqlSchemaOutput(
          database,
          schema,
          table,
          columnsResult.rows as SqlSchemaColumnRow[],
          foreignKeysResult.rows as SqlSchemaForeignKeyRow[]
        );

        context.onProgress?.({
          stage: "complete",
          message: table
            ? `Table ${schema}.${table} returned ${output.columnCount} column(s) and ${output.foreignKeyCount} related foreign key(s)`
            : `Schema ${schema} returned ${output.tableCount} table(s), ${output.columnCount} column(s), and ${output.foreignKeyCount} foreign key(s)`,
        });

        return fitSqlSchemaResultToBudget(output);
      } finally {
        await client.end().catch(() => undefined);
      }
    },
  };
}

// Need z import for the schema above
import { z } from "zod";

interface SqlQuerySchemaInput {
  database: string;
  schema: string;
  table?: string;
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
  table?: string;
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

function buildSqlSchemaOutput(
  database: string,
  schema: string,
  table: string | undefined,
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
    ...(table ? { table } : {}),
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

import { safeJsonStringify, sanitizeForJson } from "../../_shared/serialization.js";

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
    ...(output.table ? { table: output.table } : {}),
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
