import "dotenv/config";
import assert from "node:assert/strict";
import path from "node:path";
import { db } from "../../src/config/database.js";
import { tasks } from "../../src/db/schema.js";
import { ingestOpenSkySnapshotOnce } from "../../src/modules/opensky/ingestion.js";
import { runAgentLoopEvents } from "../../src/modules/agent-loop/runAgentLoop.js";
import { defaultSkillManager, registerSkillTool } from "../../src/modules/agent-loop/skillManager.js";
import { buildDefaultToolRegistry } from "../../src/modules/agent-loop/tools/_shared/toolRegistry.js";

const repoRoot = path.resolve("..");
process.env.AGENT_WORKSPACE_ROOT = repoRoot;
process.env.AGENT_SQL_ALLOWED_SCHEMAS = JSON.stringify({ default: ["public"] });

const DEFAULT_QUERY =
  "请查询全球范围内当前 OpenSky 飞机数据，bbox: 纬度 -90 到 90，经度 -180 到 180，给我几条真实飞机记录。";

const REGION_BBOXES = [
  { name: "东海", minLat: 24.0, maxLat: 33.5, minLon: 119.0, maxLon: 128.5 },
  { name: "南海", minLat: 3.0, maxLat: 23.5, minLon: 105.0, maxLon: 122.0 },
  { name: "渤海", minLat: 37.0, maxLat: 41.2, minLon: 117.0, maxLon: 122.5 },
  { name: "黄海", minLat: 31.0, maxLat: 39.5, minLon: 119.0, maxLon: 126.5 },
  { name: "中国东部", minLat: 20.0, maxLat: 42.0, minLon: 110.0, maxLon: 124.0 },
  { name: "台湾海峡", minLat: 22.0, maxLat: 26.5, minLon: 117.0, maxLon: 122.5 },
  { name: "全球", minLat: -90.0, maxLat: 90.0, minLon: -180.0, maxLon: 180.0 },
];

const EXAMPLE_QUERIES = [
  "请查询东海当前 OpenSky 飞机数据，给我 10 条真实记录。",
  "帮我看一下台湾海峡附近当前有哪些飞机，列出 callsign、国家、经纬度和高度。",
  "查询南海空域当前 ADS-B 飞机数据，最多返回 20 条。",
  "请查询 bbox: 纬度 22 到 26.5，经度 117 到 122.5 的 OpenSky 飞机记录。",
  "查询全球范围当前飞机数据，给我几条真实样例。",
];

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  assert(process.env.DATABASE_URL, "DATABASE_URL must be set for the real aircraft agent test");
  assert(process.env.OPENSKY_CLIENT_ID, "OPENSKY_CLIENT_ID must be set for the real aircraft agent test");
  assert(process.env.OPENSKY_CLIENT_SECRET, "OPENSKY_CLIENT_SECRET must be set for the real aircraft agent test");

  const query = options.query || DEFAULT_QUERY;
  const plan = buildAircraftQueryPlan(query, options.limit);
  const detailSql = buildAircraftDetailSql(plan);

  const ingestion = options.skipIngest
    ? { fetchedCount: 0, insertedCount: 0, skipped: true }
    : await ingestOpenSkySnapshotOnce();
  if (!options.skipIngest) {
    assert(ingestion.fetchedCount > 0, "OpenSky should return at least one state");
    assert(ingestion.insertedCount > 0, "OpenSky ingestion should insert aircraft_current_states rows");
  }

  const registry = buildDefaultToolRegistry();
  registerSkillTool(registry, defaultSkillManager);

  const [task] = await db
    .insert(tasks)
    .values({ query: `[real-aircraft-agent] ${query}`, status: "running" })
    .returning({ id: tasks.id });
  assert(task?.id, "test task should be created");

  const events = [];
  let loopStop;
  for await (const event of runAgentLoopEvents({
    taskId: task.id,
    query,
    registry,
    maxTurns: 5,
    modelClient: new ScriptedAircraftModelClient({ query, detailSql, plan }),
  })) {
    events.push(event);
    if (event.type === "loop_stop") loopStop = event;
  }

  assert(loopStop, "agent loop should stop");
  assert.equal(loopStop.result.stoppedBy, "final_answer");

  const observations = loopStop.result.observations;
  const skillObservation = observations.find((item) => item.toolName === "Skill");
  const schemaObservation = observations.find((item) => item.toolName === "SqlQuerySchema");
  const sqlObservation = observations.find((item) => item.toolName === "SqlQuery");

  assert(skillObservation?.ok, "agent should load aircraft-region-query skill");
  assert(schemaObservation?.ok, "agent should inspect public.aircraft_current_states schema");
  assert(sqlObservation?.ok, "agent should query aircraft_current_states through SqlQuery");

  const schemaInput = findToolInput(events, "SqlQuerySchema");
  assert.deepEqual(schemaInput, {
    database: "default",
    schema: "public",
    table: "aircraft_current_states",
  });

  const sqlInput = findToolInput(events, "SqlQuery");
  assert.equal(sqlInput.database, "default");
  assert.match(String(sqlInput.sql), /FROM aircraft_current_states/i);
  assertSqlIncludesBbox(String(sqlInput.sql), plan);
  assert.match(String(sqlInput.sql), new RegExp(`LIMIT\\s+${plan.limit}`, "i"));

  const sqlOutput = sqlObservation.output;
  assert(sqlOutput && typeof sqlOutput === "object", "SqlQuery output should be an object");
  assert(Number(sqlOutput.returnedRows) > 0, "SqlQuery should return real aircraft rows after ingestion");
  const firstRow = Array.isArray(sqlOutput.rows) ? sqlOutput.rows[0] : undefined;
  assert(firstRow?.icao24, "first returned aircraft row should include icao24");

  assert.match(loopStop.result.finalAnswer, /OpenSky|aircraft_current_states|飞机/);
  assert(loopStop.result.finalAnswer.includes(String(firstRow.icao24)));

  console.log(
    JSON.stringify(
      {
        ok: true,
        query,
        resolvedRegion: plan.regionName,
        bbox: {
          minLat: plan.minLat,
          maxLat: plan.maxLat,
          minLon: plan.minLon,
          maxLon: plan.maxLon,
        },
        limit: plan.limit,
        fetchedCount: ingestion.fetchedCount,
        insertedCount: ingestion.insertedCount,
        skipIngest: Boolean(options.skipIngest),
        returnedRows: sqlOutput.returnedRows,
        firstIcao24: firstRow.icao24,
        tools: observations.map((item) => item.toolName),
      },
      null,
      2
    )
  );
}

class ScriptedAircraftModelClient {
  constructor(options) {
    this.query = options.query;
    this.detailSql = options.detailSql;
    this.plan = options.plan;
  }

  async decide(input) {
    const hasSkill = input.observations.some((item) => item.toolName === "Skill" && item.ok);
    const hasSchema = input.observations.some((item) => item.toolName === "SqlQuerySchema" && item.ok);
    const sqlObservation = input.observations.find((item) => item.toolName === "SqlQuery" && item.ok);

    if (!hasSkill) {
      return {
        type: "tool_calls",
        toolCalls: [
          {
            id: `${input.callId}-skill`,
            toolName: "Skill",
            input: { skill: "aircraft-region-query", args: this.query },
          },
        ],
      };
    }

    if (!hasSchema) {
      return {
        type: "tool_calls",
        toolCalls: [
          {
            id: `${input.callId}-schema`,
            toolName: "SqlQuerySchema",
            input: { database: "default", schema: "public", table: "aircraft_current_states" },
          },
        ],
      };
    }

    if (!sqlObservation) {
      return {
        type: "tool_calls",
        toolCalls: [
          {
            id: `${input.callId}-sql`,
            toolName: "SqlQuery",
            input: { database: "default", sql: this.detailSql, limit: this.plan.limit, offset: 0 },
          },
        ],
      };
    }

    const output = sqlObservation.output;
    const rows = Array.isArray(output?.rows) ? output.rows : [];
    const first = rows[0] ?? {};
    return {
      type: "final_answer",
      content: [
        `已按你的提问查询：${this.query}`,
        `数据来自 public.aircraft_current_states，区域 ${this.plan.regionName}，SqlQuery 返回 ${output?.returnedRows ?? rows.length} 条预览记录。`,
        `示例飞机：${first.callsign || first.icao24} / ${first.icao24}，位置 ${first.latitude}, ${first.longitude}。`,
      ].join("\n"),
    };
  }
}

function parseOptions(argv) {
  const options = { query: "", limit: undefined, skipIngest: false, help: false };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--query" || arg === "-q") {
      options.query = requireNextArg(argv, index, arg);
      index += 1;
    } else if (arg === "--limit" || arg === "-l") {
      options.limit = parseLimit(requireNextArg(argv, index, arg));
      index += 1;
    } else if (arg === "--skip-ingest") {
      options.skipIngest = true;
    } else {
      positional.push(arg);
    }
  }
  if (!options.query && positional.length > 0) {
    options.query = positional.join(" ");
  }
  return options;
}

function buildAircraftQueryPlan(query, requestedLimit) {
  const bboxFromQuery = parseBbox(query);
  const region = bboxFromQuery ?? findRegion(query) ?? REGION_BBOXES.find((item) => item.name === "全球");
  assert(region, "global region fallback should exist");
  return {
    ...region,
    limit: requestedLimit ?? parseLimitFromQuery(query) ?? 10,
    regionName: bboxFromQuery ? "自定义 bbox" : region.name,
  };
}

function buildAircraftDetailSql(plan) {
  return `
SELECT
  icao24,
  callsign,
  origin_country,
  longitude,
  latitude,
  baro_altitude,
  velocity,
  true_track,
  vertical_rate,
  source_time,
  updated_at
FROM aircraft_current_states
WHERE latitude BETWEEN ${formatNumber(plan.minLat)} AND ${formatNumber(plan.maxLat)}
  AND longitude BETWEEN ${formatNumber(plan.minLon)} AND ${formatNumber(plan.maxLon)}
ORDER BY source_time DESC, updated_at DESC
LIMIT ${plan.limit}
`;
}

function parseBbox(query) {
  const normalized = query.replace(/[，。；;]/g, " ");
  const latMatch = normalized.match(/纬度\s*(-?\d+(?:\.\d+)?)\s*(?:到|至|-)\s*(-?\d+(?:\.\d+)?)/);
  const lonMatch = normalized.match(/经度\s*(-?\d+(?:\.\d+)?)\s*(?:到|至|-)\s*(-?\d+(?:\.\d+)?)/);
  if (!latMatch || !lonMatch) return undefined;
  const minLat = Number(latMatch[1]);
  const maxLat = Number(latMatch[2]);
  const minLon = Number(lonMatch[1]);
  const maxLon = Number(lonMatch[2]);
  assertValidBbox({ minLat, maxLat, minLon, maxLon });
  return { name: "自定义 bbox", minLat, maxLat, minLon, maxLon };
}

function findRegion(query) {
  return REGION_BBOXES.find((region) => query.includes(region.name));
}

function parseLimitFromQuery(query) {
  const match = query.match(/(?:最多|返回|给我|列出)?\s*(\d{1,3})\s*(?:条|架|个)/);
  return match ? parseLimit(match[1]) : undefined;
}

function parseLimit(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --limit value: ${value}`);
  }
  return Math.min(parsed, 100);
}

function assertValidBbox(bbox) {
  assert(bbox.minLat >= -90 && bbox.maxLat <= 90, "bbox latitude must be within -90..90");
  assert(bbox.minLon >= -180 && bbox.maxLon <= 180, "bbox longitude must be within -180..180");
  assert(bbox.minLat < bbox.maxLat, "bbox minLat must be less than maxLat");
  assert(bbox.minLon < bbox.maxLon, "bbox minLon must be less than maxLon");
}

function assertSqlIncludesBbox(sql, plan) {
  assert(sql.includes(`latitude BETWEEN ${formatNumber(plan.minLat)} AND ${formatNumber(plan.maxLat)}`));
  assert(sql.includes(`longitude BETWEEN ${formatNumber(plan.minLon)} AND ${formatNumber(plan.maxLon)}`));
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(value);
}

function requireNextArg(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function findToolInput(events, toolName) {
  for (const event of events) {
    if (event.type !== "assistant_message") continue;
    const toolCall = event.message.toolCalls?.find((item) => item.toolName === toolName);
    if (toolCall) return toolCall.input;
  }
  assert.fail(`${toolName} tool call should exist`);
}

function printHelp() {
  console.log(`Usage:
  tsx tests/test-aircraft-agent-real.mjs --query "请查询东海当前 OpenSky 飞机数据，给我 10 条真实记录。"
  tsx tests/test-aircraft-agent-real.mjs "查询台湾海峡附近当前有哪些飞机"

Options:
  -q, --query <text>     用户自由提问
  -l, --limit <number>   返回记录上限，最大 100
  --skip-ingest          跳过本次 OpenSky 刷新，直接查现有数据库快照
  -h, --help             显示帮助

Example queries:
${EXAMPLE_QUERIES.map((item) => `  - ${item}`).join("\n")}
`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
