import { Client } from "pg";
import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import type { ToolRegistry } from "./toolRegistry.js";

const DEFAULT_SQL_DATABASE = "default";
const DEFAULT_SQL_LIMIT = 100;
const MAX_SQL_LIMIT = 500;
const DEFAULT_SQL_TIMEOUT_MS = 5_000;
const MAX_SQL_TIMEOUT_MS = 30_000;
const MAX_SQL_RESULT_CHARS = 80_000;

export function registerDomainTools(registry: ToolRegistry): void {
  for (const tool of buildDomainTools()) {
    registry.register(tool);
  }
}

export function buildDomainTools(): ToolDefinition[] {
  return [
    buildSqlQueryTool(),
  ];
}

function buildSqlQueryTool(): ToolDefinition {
  return {
    name: "SqlQuery",
    description:
      'Execute one read-only SQL query against a configured database alias. Input: {"database":"default","sql":"select ...","limit":100}. Only SELECT/WITH queries are allowed; results are capped and returned as JSON.',
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
      const timeoutMs = Math.min(parsed.timeout_ms || DEFAULT_SQL_TIMEOUT_MS, MAX_SQL_TIMEOUT_MS);
      const sql = buildLimitedSql(parsed.sql, limit);
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
        await client.query(`SET statement_timeout = ${timeoutMs}`);
        await client.query("SET default_transaction_read_only = on");
        const result = await client.query(sql);
        const durationMs = Date.now() - startedAt;

        context.onProgress?.({
          stage: "complete",
          message: `SQL returned ${result.rowCount ?? result.rows.length} row(s) from ${database}`,
        });

        return {
          database,
          rowCount: result.rowCount ?? result.rows.length,
          returnedRows: result.rows.length,
          columns: result.fields.map((field) => ({
            name: field.name,
            dataTypeId: field.dataTypeID,
          })),
          rows: result.rows,
          limit,
          truncated: result.rows.length >= limit,
          durationMs,
        };
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
  timeout_ms: number;
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
}

function buildLimitedSql(sql: string, limit: number): string {
  const statements = splitSqlStatements(sql);
  const statement = stripTrailingSemicolon(statements[0] ?? sql);
  return `SELECT * FROM (${statement}) AS dsi_sqlquery_result LIMIT ${limit}`;
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

    result += char;
  }

  return result.replace(/\s+/g, " ").trim();
}

function stripTrailingSemicolon(sql: string): string {
  return sql.replace(/;\s*$/, "");
}

// Add first-party data-access tools here, for example:
// buildGisEntityQueryTool(), buildKnowledgeBaseSearchTool(), etc.
// Keep skill scripts for workflow-specific helpers; production database access
// should go through registered domain tools so schemas, permissions, auditing,
// and result normalization remain centralized.
