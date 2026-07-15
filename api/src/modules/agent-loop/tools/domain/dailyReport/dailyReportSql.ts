import { getDailyReportSqlTemplate } from "./dailyReportResources.js";
import type { DailyReportType } from "./dailyReportTypes.js";

export function buildDailyReportSql(
  reportType: DailyReportType,
  startTime: string,
  endTime: string
): string {
  const template = getDailyReportSqlTemplate(reportType);
  if (!template.includes("{start_time}") || !template.includes("{end_time}")) {
    throw new Error(`Daily report SQL template '${reportType}.sql' must contain {start_time} and {end_time}.`);
  }

  const sql = template
    .replace(/\{start_time\}/g, startTime)
    .replace(/\{end_time\}/g, endTime);
  if (/\{(?:start_time|end_time)\}/.test(sql)) {
    throw new Error(`Daily report SQL template '${reportType}.sql' contains unresolved placeholders.`);
  }
  return sql;
}
