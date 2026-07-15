import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

{
  const domainIndex = await readFile(new URL("../../src/modules/agent-loop/tools/domain/index.ts", import.meta.url), "utf8");
  assert.match(domainIndex, /buildMysqlQuerySchemaTool/, "MysqlQuerySchema should be wired in domain tools");
  assert.match(domainIndex, /buildMysqlQueryTool/, "MysqlQuery should be wired in domain tools");
  assert.match(domainIndex, /buildChartRenderDataTool/, "ChartRenderData should be wired in domain tools");
}

{
  const maxTurnsFallback = await readFile(new URL("../../src/modules/agent-loop/runAgentLoop.ts", import.meta.url), "utf8");
  assert.match(
    maxTurnsFallback,
    /For business\/data QA, do not expose table names, column names, SQL aliases, SQL fragments, or encoded filter expressions/,
    "Max-turns fallback answers should preserve the user-facing schema boundary",
  );
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

  assert.match(
    skill,
    /Calendar month number \(without `个`\).*"N月以来" \/ "N月至今" \/ "最近N月以来" means from the first day of calendar month N in the current year to now/,
    "Calendar-month-since wording should resolve from that month in the current year",
  );
  assert.match(
    skill,
    /Rolling duration \(with `个`\).*"N个月以来" \/ "近N个月以来" \/ "最近N个月" \/ "过去N个月" means from the current timestamp backward by N months to now/,
    "Month expressions with the classifier should remain rolling durations",
  );
  assert.match(
    skill,
    /"3月以来"、"3月至今" and "最近3月以来" all mean 2026-03-01 00:00:00 through now/,
    "Calendar-month-since SQL should have an explicit now upper bound",
  );
  assert.match(
    skill,
    /"3个月以来" and "近三个月以来" mean `DATE_SUB\(NOW\(\), INTERVAL 3 MONTH\)` through `NOW\(\)`/,
    "Three-month duration wording should use a rolling subtraction",
  );
  assert.match(skill, /The decisive marker is the classifier `个`/);
  assert.match(
    skill,
    /预警事件等级是特例：查询、过滤、分组和排序时只使用 `event_level`/,
    "Alarm level queries should use only event_level",
  );
  assert.match(skill, /GROUP BY event_level\s+ORDER BY CAST\(event_level AS UNSIGNED\) ASC;/);
  assert.match(skill, /event_time >= '2026-03-01 00:00:00' AND event_time <= NOW\(\)/);
  assert.match(skill, /预警等级默认按 `1, 2, 3, 4` 排列/);
  assert.match(skill, /仅当用户明确要求“降序\/从高到低\/DESC”时才使用 `DESC`/);
  assert.match(skill, /饼图不展示空数据或 0 值分类/);
  assert.match(skill, /Zero-count categories may appear in tables but must be omitted from pie-chart data/);
  assert.doesNotMatch(skill, /SELECT\s+event_level\s*,\s*event_level_name/i);
  assert.doesNotMatch(skill, /GROUP BY\s+event_level\s*,\s*event_level_name/i);
  assert.doesNotMatch(skill, /event_level_name\s+AS\s+`/i);

  assert.match(
    skill,
    /Database table names, column names, SQL aliases, SQL fragments, and encoded filter expressions are internal implementation details/,
    "Formal answers should hide database implementation details",
  );
  for (const leakedIdentifier of ["device_shape_type", "event_level", "event_id", "total_count"]) {
    assert.match(
      skill,
      new RegExp(`Do not expose identifiers such as[\\s\\S]*?${leakedIdentifier.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}`),
      `Skill should explicitly prohibit leaking ${leakedIdentifier} in formal answers`,
    );
  }
  assert.match(
    skill,
    /经查询，本月所有枪机设备共产生 5 条一级预警。/,
    "Skill should include a schema-free answer example for the reported query",
  );
  assert.match(skill, /Before sending the final answer, scan it for raw schema identifiers/);
}

console.log("border-defense-qa regression tests passed");
