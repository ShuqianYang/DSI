import "dotenv/config";
import type { ScenarioId } from "@datasourceintelligence/shared";
import type { ModelClient } from "../../src/modules/agent-loop/modelClient.js";
import type {
  AgentLoopEvent,
  NormalizedAgentDecision,
  ToolObservation,
} from "../../src/modules/agent-loop/tools/_shared/types.js";
import type { AgentLoopTaskResult } from "../../src/modules/tasks/agentLoopResultProjection.js";

export const SCENARIO_SKILL_FILTER_SCENARIO = "scenario-skill-filter";
export const SCENARIO_SKILL_FILTER_SCENARIO_ID: ScenarioId = "marine";
export const SCENARIO_SKILL_FILTER_TOOLS = [] as const;
export const SCENARIO_SKILL_FILTER_QUERY = "check marine scenario skill listing";

export interface ScenarioSkillFilterValidationInput {
  rawEvents: AgentLoopEvent[];
  projectedResult: AgentLoopTaskResult;
}

export interface ScenarioSkillFilterValidationReport {
  skillListingFiltered: boolean;
  disallowedSkillRejected: boolean;
  toolOrder: string[];
}

export function createScenarioSkillFilterSmokeModelClient(): ModelClient {
  return {
    async decide(input): Promise<NormalizedAgentDecision> {
      const skillObservation = findObservation(input.observations, "Skill");
      if (!skillObservation) {
        return {
          type: "tool_calls",
          content: "Testing scenario skill filtering by invoking a disallowed skill.",
          toolCalls: [
            {
              id: "scenario-skill-filter-1",
              toolName: "Skill",
              input: { skill: "daily-report", args: "today" },
              reason: "daily-report is not in the marine scenario skill list and should be rejected.",
            },
          ],
        };
      }

      return {
        type: "final_answer",
        content: "Scenario skill filter smoke completed.",
      };
    },
  };
}

export function installMockScenarioSkillFilterFetch(): () => void {
  return () => undefined;
}

export function validateScenarioSkillFilterSmoke(
  input: ScenarioSkillFilterValidationInput,
): ScenarioSkillFilterValidationReport {
  const observations = input.rawEvents.filter(
    (event): event is Extract<AgentLoopEvent, { type: "tool_observation" }> =>
      event.type === "tool_observation",
  );
  const toolOrder = observations.map((event) => event.toolName);

  const systemText = input.rawEvents
    .filter((event): event is Extract<AgentLoopEvent, { type: "model_request" }> => event.type === "model_request")
    .flatMap((event) => event.messages.filter((message) => message.role === "system").map((message) => message.content))
    .join("\n");

  const listingMatch = systemText.match(/Available local skills from the repository root skills directory:\n((?:- .*\n?)*)/);
  const listingText = listingMatch?.[1] ?? "";
  assertCondition(listingText.length > 0, "skill listing bullets not found in system prompt");

  assertCondition(listingText.includes("oil-spill-tracing"), "marine listing should include oil-spill-tracing");
  const unexpectedMarineSkills = [
    "ais-region-query",
    "aircraft-region-query",
    "daily-report",
    "border-defense-qa",
    "alarm-disposal-orchestrator",
    "earthquake-assessment",
    "flood-assessment",
    "fire-investigation",
    "disaster-satellite-query",
  ];
  for (const skillName of unexpectedMarineSkills) {
    assertCondition(
      !listingText.includes(skillName),
      `marine listing should not include ${skillName}`,
    );
  }

  const skillObservation = observations.find((event) => event.toolName === "Skill");
  assertCondition(skillObservation !== undefined, "Skill tool was not called.");
  assertCondition(!skillObservation.ok, "Skill(daily-report) should have been rejected.");
  const errorText = JSON.stringify(skillObservation.observation);
  assertCondition(
    errorText.includes("daily-report") && errorText.includes("marine"),
    `Skill rejection should mention daily-report and marine: ${errorText}`,
  );

  assertCondition(
    input.projectedResult.stoppedBy === "final_answer" || input.projectedResult.stoppedBy === "max_turns",
    `Agent loop did not stop with final_answer/max_turns: ${input.projectedResult.stoppedBy}`,
  );

  return {
    skillListingFiltered: true,
    disallowedSkillRejected: true,
    toolOrder,
  };
}

function findObservation(observations: ToolObservation[], toolName: string): ToolObservation | undefined {
  return observations.find((observation) => observation.toolName === toolName);
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
