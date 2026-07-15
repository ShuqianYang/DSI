import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

{
  const domainIndex = await readFile(new URL("../../src/modules/agent-loop/tools/domain/index.ts", import.meta.url), "utf8");
  assert.match(domainIndex, /buildMysqlQuerySchemaTool/, "MysqlQuerySchema should be wired in domain tools");
  assert.match(domainIndex, /buildMysqlQueryTool/, "MysqlQuery should be wired in domain tools");
  assert.match(domainIndex, /buildChartRenderDataTool/, "ChartRenderData should be wired in domain tools");
}

{
  const skill = await readFile(new URL("../../../skills/border-defense-qa/SKILL.md", import.meta.url), "utf8");

  for (const expected of [
    "device_shape_type = '0'",
    "person_action IN ('2', '3')",
    "permit_stay_duration",
    "YEARWEEK(handle_time, 1)",
    "DATE_SUB(CURDATE(), INTERVAL 7 DAY)",
    "默认需要展示图表",
    "数据为空时不要画图",
  ]) {
    assert.match(skill, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `Skill should retain legacy QA rule/example: ${expected}`);
  }

  assert.doesNotMatch(skill, /GisEntityMark/, "QA Skill should not expose GIS linkage while disabled");
  assert.doesNotMatch(skill, /data_detail_type|Required detail fields for auto-linking/, "QA Skill should not expose detail-query linkage rules while disabled");
}

console.log("border-defense-qa regression tests passed");
