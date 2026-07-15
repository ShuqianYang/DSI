---
name: border-defense-daily-report
description: Generate a single-date border-defense daily report from a selected date and one of three report types. Use for the dedicated border-defense daily-report entry or an explicit request to generate a border-defense daily report; do not use for ordinary data questions or detail lookup.
allowed-tools: DailyReport
---

# Border Defense Daily Report

Use this skill only when the user explicitly asks to generate a border-defense report, such as:

- 生成日报、边防日报、安防日报
- 今日/昨日/前日边防日报（先换算为具体日期）
- 生成设备监控报告、卡口/设备监控报告、预警事件报告

Do not use this skill for ordinary QA, detail lookup, event listing, device lookup, department lookup, checkpoint record lookup, or statistical question answering. Those requests belong to `border-defense-qa`.

## Tool Contract

This skill has exactly one execution tool: `DailyReport`.

`DailyReport` executes local SQL templates, builds report charts, and uses an LLM to generate report Markdown. It does not call the old external daily-report service.

Call `DailyReport` once with normalized input:

```json
{
  "date": "2026-07-11",
  "report_type": "all"
}
```

## Input Normalization

The dedicated frontend sends exactly two business inputs: `date` and `report_type`. The API forcibly routes that request to this skill. Do not reinterpret the selected values.

Normalize date/time intent:

- Pass the selected date to `date` in `YYYY-MM-DD` format.
- For a natural-language request using 今天/昨日/前日, first convert it to the corresponding local calendar date, then pass the ISO date.
- Never silently default an invalid or missing date. Ask the user to select a valid date.
- Do not accept future dates.
- This skill generates one calendar day at a time. A weekly report or date range is outside its current contract.

Normalize report type:

| User wording | `report_type` |
| --- | --- |
| 总体、综合、总览、日报 | `all` |
| 设备、设备监控、卡口、卡口/设备监控 | `buckle` |
| 预警、预警事件、告警、事件态势 | `event` |
| 未明确说明 | `all` |

## Boundary Rules

- If the user asks "某天有哪些预警/告警事件", "查询某事件明细", "某设备位置", "某卡口通行记录", or similar detail questions, do not use this skill. Use `border-defense-qa`.
- If the user asks for both a report and details, generate the report only when the report request is explicit. Mention that detail drill-down can be queried separately.
- Do not invent report content. Only summarize what `DailyReport` returns.
- If `DailyReport` fails or returns empty content, report the failure plainly and do not fabricate a report.
- Do not call `MysqlQuery`, `ChartRenderData`, or `GisEntityMark` directly in this skill.

## Bundled Resources

`DailyReport` must load these files from this skill at runtime; they are the only source of truth:

- `sql/{all,buckle,event}.sql`: read-only query templates with required `{start_time}` and `{end_time}` placeholders.
- `templates/_base.md`: shared report-generation constraints.
- `templates/{all,buckle,event}.md`: report-type output templates.
- `config/field-labels.json`: field-to-Chinese-label mappings for each report type.

If a required resource is missing, empty, or invalid, fail clearly. Do not fall back to a duplicated template embedded in API source code.

## Response Rules

After `DailyReport` returns:

1. Return the complete `report_content` directly as the final answer.
2. Preserve the Markdown headings, tables, lists, and `chart://` image references exactly as returned.
3. Do not prepend or append a summary, date/type recap, artifact notice, download hint, or completion message.
4. Do not wrap `report_content` in a code block.
5. Do not output the surrounding tool JSON.
6. If `report_content` is empty, report the failure plainly and do not fabricate content.
