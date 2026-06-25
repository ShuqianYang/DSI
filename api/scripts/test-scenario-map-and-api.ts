import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { getScenarioProfile } from "@datasourceintelligence/shared";

function visibleEntityTypesForScenario(scenarioId: string) {
  const scenario = getScenarioProfile(scenarioId);
  return {
    showShips: scenario.mapLayers.includes("ais"),
    showAircraft: scenario.mapLayers.includes("ads"),
  };
}

assert.deepEqual(visibleEntityTypesForScenario("osint"), {
  showShips: true,
  showAircraft: true,
});
assert.deepEqual(visibleEntityTypesForScenario("marine"), {
  showShips: false,
  showAircraft: false,
});
assert.deepEqual(visibleEntityTypesForScenario("emergency"), {
  showShips: false,
  showAircraft: false,
});
assert.deepEqual(visibleEntityTypesForScenario("border"), {
  showShips: false,
  showAircraft: false,
});

const homePageSource = await readFile("src/app/page.tsx", "utf8");

assert.ok(
  homePageSource.includes("activeScenarioId"),
  "HomePage should own activeScenarioId",
);
assert.ok(
  homePageSource.includes("handleScenarioChange"),
  "HomePage should reset map state when scenario changes",
);
assert.ok(
  homePageSource.includes("scenario={activeScenario}"),
  "HomePage should pass active scenario into ChatPanel",
);
assert.ok(
  homePageSource.includes("onScenarioChange={handleScenarioChange}"),
  "HomePage should pass scenario change handler into ChatPanel",
);
assert.ok(
  homePageSource.includes("entities={visibleEntities}"),
  "GisViewer should receive scenario-filtered entities",
);
assert.ok(
  homePageSource.includes("trajectories={visibleTrajectories}"),
  "GisViewer should receive scenario-filtered trajectories",
);

console.log("PASS scenario map and api smoke test");
