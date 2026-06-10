import { Client } from "pg";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { GisData } from "@datasourceintelligence/shared";
import type { ToolDefinition } from "../../_shared/types.js";
import { safeJsonStringify, sanitizeForJson } from "../../_shared/serialization.js";
import {
  DEFAULT_SQL_DATABASE,
  DEFAULT_SQL_LIMIT,
  MAX_SQL_LIMIT,
  DEFAULT_SQL_OFFSET,
  MAX_SQL_OFFSET,
  DEFAULT_SQL_TIMEOUT_MS,
  MAX_SQL_TIMEOUT_MS,
  MAX_SQL_RESULT_CHARS,
  DEFAULT_SQL_INLINE_RESULT_CHARS,
  DEFAULT_SQL_PREVIEW_ROWS,
  SQL_ARTIFACT_BASE_DIR,
  assertKnownSqlDatabase,
  getSqlDatabaseConnectionString,
  splitSqlStatements,
  normalizeSqlForPolicy,
  stripTrailingSemicolon,
  collectSqlIdentifierTokens,
  previousNonWhitespaceChar,
  nextNonWhitespaceChar,
  FORBIDDEN_SQL_FUNCTIONS,
  FORBIDDEN_SQL_SCHEMAS,
  FORBIDDEN_SQL_CATALOG_RELATIONS,
  getSqlWorkspaceRoot,
} from "./_shared.js";

export function buildSqlQueryTool(): ToolDefinition {
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

// ─── Types ───

interface SqlQueryInput {
  database: string;
  sql: string;
  limit: number;
  offset: number;
  timeout_ms: number;
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
  gisData?: GisData;
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

// ─── SQL validation ───

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

// ─── Result output building ───

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

  const gisData = tryBuildGisDataFromRows(input.rows);

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
    ...(gisData ? { gisData } : {}),
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
  const workspaceRoot = getSqlWorkspaceRoot();
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

// ─── Result budget ───

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

// ─── SQL rows → GIS entity 自动转换 ───

function tryBuildGisDataFromRows(rows: Array<Record<string, unknown>>): GisData | undefined {
  if (!rows?.length) return;

  const sample = rows[0];
  const hasLat = 'latitude' in sample || 'lat' in sample;
  const hasLng = 'longitude' in sample || 'lng' in sample || 'lon' in sample;
  if (!hasLat || !hasLng) return;

  // 必须有标识字段，排除纯聚合查询（count/avg/sum）
  const hasIdentity = 'mmsi' in sample || 'icao24' in sample ||
                      'ship_name' in sample || 'callsign' in sample ||
                      'name' in sample || 'id' in sample;
  if (!hasIdentity) return;

  const isAis = 'mmsi' in sample || 'ship_name' in sample;
  const isAds = 'icao24' in sample || 'callsign' in sample;
  const entityType = isAis ? 'ship' : isAds ? 'aircraft' : 'base';

  const entities = rows
    .filter((r) => r.latitude != null || r.lat != null)
    .filter((r) => r.longitude != null || r.lng != null || r.lon != null)
    .map((r) => ({
      id: `${entityType}-${String(r.mmsi ?? r.icao24 ?? r.id ?? Math.random().toString(36).slice(2, 8))}`,
      name: String(r.ship_name ?? r.callsign ?? r.name ?? 'Unknown'),
      type: entityType as 'ship' | 'aircraft' | 'base' | 'fire' | 'earthquake',
      coordinates: [
        Number(r.longitude ?? r.lng ?? r.lon),
        Number(r.latitude ?? r.lat),
      ] as [number, number],
      importance: 'medium' as 'high' | 'medium' | 'low',
      status: 'normal' as 'normal' | 'warning' | 'danger',
      speed: r.sog != null ? Number(r.sog) : r.velocity != null ? Number(r.velocity) : undefined,
      heading: r.heading != null ? Number(r.heading) : r.true_track != null ? Number(r.true_track) : undefined,
      altitude: r.baro_altitude != null ? Number(r.baro_altitude) : undefined,
      dataSource: isAis ? 'aisstream' : isAds ? 'opensky' : undefined,
    }));

  if (!entities.length) return;

  return {
    type: 'entity',
    entities,
    // 故意不输出 cameraView：RegionMark 或其他显式 GIS 工具负责控制视角
  };
}
