import "dotenv/config";
import { buildDefaultToolRegistry } from "../../src/modules/agent-loop/tools/_shared/toolRegistry.js";
import { callTool } from "../../src/modules/agent-loop/tools/_shared/toolGateway.js";
import {
  defaultSkillManager,
  registerSkillTool,
} from "../../src/modules/agent-loop/skillManager.js";
import type {
  AgentLoopToolUseContext,
  ToolObservation,
} from "../../src/modules/agent-loop/tools/_shared/types.js";

const MOCK_TOOL_NAMES = [
  "OilSpillDetectMock",
  "WeatherFetchMock",
  "OilDriftTraceMock",
  "AisFetchMock",
  "AisMatchSuspectsMock",
  "AisSuspectRankingMock",
];

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function activeToolNames(toolUseContext: AgentLoopToolUseContext): string[] {
  const allowed = toolUseContext.skillAllowedToolNames;
  const tools = toolUseContext.options.refreshTools?.() ?? toolUseContext.options.tools;
  return tools
    .filter((tool) => !allowed || allowed.has(tool.name) || tool.aliases?.some((alias) => allowed.has(alias)))
    .map((tool) => tool.name)
    .sort();
}

async function main() {
  const registry = buildDefaultToolRegistry();
  registerSkillTool(registry, defaultSkillManager);

  const initiallyVisible = new Set(registry.list().map((tool) => tool.name));
  for (const toolName of MOCK_TOOL_NAMES) {
    assertCondition(!initiallyVisible.has(toolName), `${toolName} should be hidden before skill load`);
  }

  const observations: ToolObservation[] = [];
  const toolUseContext: AgentLoopToolUseContext = {
    taskId: "oil-spill-smoke",
    query: "查询东海漏油并匹配疑似肇事船",
    messages: [],
    observations,
    options: { tools: registry.list() },
    readFileState: new Map(),
    todoState: [],
    nestedMemoryAttachmentTriggers: new Set(),
    dynamicSkillDirTriggers: new Set(),
    discoveredSkillNames: new Set(),
    invokedSkillSections: [],
    skillManager: defaultSkillManager,
  };
  const context = {
    taskId: "oil-spill-smoke",
    query: "查询东海漏油并匹配疑似肇事船",
    observations,
    toolUseContext,
  };

  const skillObservation = await callTool(
    registry,
    {
      id: "skill-oil-spill",
      toolName: "Skill",
      input: { skill: "oil-spill-tracing", args: context.query },
    },
    context,
  );
  assertCondition(
    skillObservation.ok,
    `Skill(oil-spill-tracing) failed: ${skillObservation.error?.message ?? "unknown error"}`,
  );

  const expectedActiveNames = [...MOCK_TOOL_NAMES, "Skill"].sort();
  assertCondition(
    JSON.stringify(activeToolNames(toolUseContext)) === JSON.stringify(expectedActiveNames),
    "Oil-spill skill did not expose exactly Skill plus the six mock tools",
  );

  const fetchCalls: Array<{ url: string; body: string }> = [];
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), body: String(init?.body ?? "") });
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return { state: true, value: { records: [] } };
      },
    } as Response;
  };

  const calls = [
    { id: "detect", toolName: "OilSpillDetectMock", input: { region: "中国东海" } },
    { id: "weather", toolName: "WeatherFetchMock", input: { region: "东海油膜片区" } },
    { id: "drift", toolName: "OilDriftTraceMock", input: {} },
    { id: "ais", toolName: "AisFetchMock", input: { region: "中国东海" } },
    { id: "match", toolName: "AisMatchSuspectsMock", input: {} },
    { id: "ranking", toolName: "AisSuspectRankingMock", input: {} },
  ];

  for (const toolCall of calls) {
    const observation = await callTool(registry, toolCall, context);
    assertCondition(
      observation.ok,
      `${toolCall.toolName} failed: ${observation.error?.message ?? "unknown error"}`,
    );
    const output = observation.output as Record<string, unknown>;
    assertCondition(output.gisData, `${toolCall.toolName} did not return top-level gisData`);
    observations.push(observation);
  }

  const ranking = observations.at(-1)!.output as {
    primary: Array<{ mmsi: string; score: number }>;
  };
  assertCondition(
    ranking.primary[0]?.mmsi === "413567890" && ranking.primary[0]?.score === 86,
    "Unexpected primary suspect ranking",
  );
  assertCondition(
    fetchCalls.length === 1 && fetchCalls[0]!.url.includes("/agent/queryData"),
    "OilSpillDetectMock did not call queryData",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        queryDataCalls: fetchCalls.length,
        toolOrder: observations.map((observation) => observation.toolName),
        gisOutputs: observations.length,
        primarySuspect: ranking.primary[0],
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
