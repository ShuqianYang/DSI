import { Client } from "pg";
import path from "node:path";

export const DEFAULT_SQL_DATABASE = "default";
export const DEFAULT_SQL_LIMIT = 100;
export const MAX_SQL_LIMIT = 500;
export const DEFAULT_SQL_OFFSET = 0;
export const MAX_SQL_OFFSET = 10_000;
export const DEFAULT_SQL_TIMEOUT_MS = 5_000;
export const MAX_SQL_TIMEOUT_MS = 30_000;
export const MAX_SQL_RESULT_CHARS = 80_000;
export const MAX_SQL_SCHEMA_RESULT_CHARS = 40_000;
export const DEFAULT_SQL_INLINE_RESULT_CHARS = 20_000;
export const DEFAULT_SQL_PREVIEW_ROWS = 50;
export const SQL_ARTIFACT_BASE_DIR = "api/tmp/agent-loop/sqlquery";

export const FORBIDDEN_SQL_FUNCTIONS = new Set([
  "dblink", "dblink_cancel_query", "dblink_close", "dblink_connect", "dblink_connect_u",
  "dblink_disconnect", "dblink_error_message", "dblink_exec", "dblink_fetch",
  "dblink_get_connections", "dblink_get_notify", "dblink_get_pkey", "dblink_get_result",
  "dblink_is_busy", "dblink_open", "dblink_send_query", "lo_close", "lo_creat", "lo_create",
  "lo_export", "lo_from_bytea", "lo_import", "lo_lseek", "lo_lseek64", "lo_open", "lo_put",
  "lo_tell", "lo_tell64", "lo_truncate", "lo_truncate64", "lo_unlink", "lowrite", "nextval",
  "pg_advisory_lock", "pg_advisory_lock_shared", "pg_advisory_unlock", "pg_advisory_unlock_all",
  "pg_advisory_unlock_shared", "pg_backup_start", "pg_backup_stop", "pg_cancel_backend",
  "pg_create_restore_point", "pg_export_snapshot", "pg_import_system_collations",
  "pg_log_backend_memory_contexts", "pg_notify", "pg_promote", "pg_reload_conf",
  "pg_rotate_logfile", "pg_start_backup", "pg_stat_reset", "pg_stat_reset_replication_slot",
  "pg_stat_reset_shared", "pg_stat_reset_single_function_counters",
  "pg_stat_reset_single_table_counters", "pg_stop_backup", "pg_switch_wal",
  "pg_terminate_backend", "postgres_fdw_disconnect", "postgres_fdw_disconnect_all", "setval",
]);

export const FORBIDDEN_SQL_SCHEMAS = new Set(["information_schema", "pg_catalog"]);

export const FORBIDDEN_SQL_CATALOG_RELATIONS = new Set([
  "pg_auth_members", "pg_authid", "pg_available_extension_versions", "pg_available_extensions",
  "pg_config", "pg_db_role_setting", "pg_file_settings", "pg_foreign_data_wrapper",
  "pg_foreign_server", "pg_foreign_table", "pg_group", "pg_hba_file_rules", "pg_indexes",
  "pg_locks", "pg_matviews", "pg_policies", "pg_policy", "pg_prepared_statements",
  "pg_publication", "pg_publication_tables", "pg_replication_origin", "pg_replication_slots",
  "pg_roles", "pg_rules", "pg_seclabel", "pg_seclabels", "pg_shadow", "pg_shdescription",
  "pg_stat_activity", "pg_stat_replication", "pg_stat_subscription", "pg_stats",
  "pg_subscription", "pg_tables", "pg_user", "pg_user_mapping", "pg_user_mappings", "pg_views",
]);

// ─── Database connection ───

export function getSqlDatabaseConnectionString(database: string): string | undefined {
  const normalized = normalizeDatabaseAlias(database);
  const configured = parseConfiguredSqlDatabases();
  if (configured[normalized]) return configured[normalized];

  const envName = `AGENT_SQL_DATABASE_URL_${normalized.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  return process.env[envName] ?? (normalized === DEFAULT_SQL_DATABASE ? process.env.DATABASE_URL : undefined);
}

export function assertKnownSqlDatabase(database: string): void {
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

// ─── Schema allowlisting ───

export function assertAllowedSqlSchema(database: string, schema: string): void {
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

export function assertUnqualifiedSqlTableName(table: string): void {
  if (table.includes(".")) {
    throw new Error(`SqlQuerySchema table must be an unqualified table name, for example "incidents", not "${table}".`);
  }
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

// ─── SQL statement parsing (shared by schema and query validation) ───

export function splitSqlStatements(sql: string): string[] {
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

export function normalizeSqlForPolicy(sql: string): string {
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

export function stripTrailingSemicolon(sql: string): string {
  return sql.replace(/;\s*$/, "");
}

// ─── SQL identifier tokenization ───

export interface SqlIdentifierToken {
  value: string;
  start: number;
  end: number;
}

export function collectSqlIdentifierTokens(sql: string): SqlIdentifierToken[] {
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

export function previousNonWhitespaceChar(sql: string, position: number): string | undefined {
  for (let index = position - 1; index >= 0; index -= 1) {
    const char = sql[index]!;
    if (!/\s/.test(char)) return char;
  }
  return undefined;
}

export function nextNonWhitespaceChar(sql: string, position: number): string | undefined {
  for (let index = position; index < sql.length; index += 1) {
    const char = sql[index]!;
    if (!/\s/.test(char)) return char;
  }
  return undefined;
}

// ─── Workspace root (simpler variant for SQL artifact paths) ───

export function getSqlWorkspaceRoot(): string {
  return path.resolve(process.env.AGENT_WORKSPACE_ROOT || path.join(process.cwd(), ".."));
}
