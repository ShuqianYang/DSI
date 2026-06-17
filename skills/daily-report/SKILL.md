---
name: daily-report
description: 生成边防日报：生成安防日报、周报、专项报告，支持总体、设备监控、预警事态等报告类型。
argument-hint: "[user daily report query with date and optional report type]"
allowed-tools: DailyReport
---

# Daily Report

Use this skill when the user asks for a border-defense daily report, security report, weekly report, or special-topic report. The skill calls the `DailyReport` domain tool, which forwards the request to the daily-report service and returns generated report content.

## Required Input

Use the user's original query as `$ARGUMENTS`.

The query should contain:

1. Date intent: today, yesterday, the day before yesterday, a specific date such as `2025-11-10` or `2025年11月10日`, or equivalent wording like 今天, 昨天, 前天, 今日, 昨日.
2. Optional report type: 总体, 设备监控, 预警事态. If omitted, use `all`.

If the user only mentions "日报" or "daily report" without a date, default to today.

## Workflow

1. Extract the date from the user's query.
2. Determine the report type:
   - 总体, 综合, overview, general -> `"report_type": "总体"`
   - 设备监控, 设备, 监控 -> `"report_type": "设备监控"`
   - 预警事态, 预警, 事态, alerts, warnings -> `"report_type": "预警事态"`
   - unspecified -> `"report_type": "all"`
3. Call `DailyReport` with the normalized input:

```json
{
  "query": "2025-11-10",
  "report_type": "all"
}
```

```json
{
  "query": "昨天",
  "report_type": "预警事态"
}
```

4. The tool returns `report_content`. Summarize the key points in Chinese for the user; do not paste the full raw content unless explicitly requested.
5. Include the resolved `date` and `report_type` in the response.

## Rules

- Do not invent report content. Only summarize what the `DailyReport` tool returns.
- If the daily-report service fails, report the failure and do not fabricate a report.
- If the user's query contains no usable date, default to today.
- Keep the summary concise. Mention the number of sections or key highlights if the report is long.

## Response

Include:

- The resolved date and report type.
- A concise Chinese summary of the report content.
- Any service-side limitations or errors.

Do not:

- Output the entire raw `report_content` unless the user asks for it.
- Add information not present in the tool result.
