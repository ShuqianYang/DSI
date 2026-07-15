import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { DailyReportType } from "./dailyReportTypes.js";

const SKILL_NAME = "border-defense-daily-report";

export function getDailyReportSqlTemplate(reportType: DailyReportType): string {
  return readRequiredResource(path.join("sql", `${reportType}.sql`));
}

export function getDailyReportSystemPrompt(reportType: DailyReportType): string {
  const base = readRequiredResource(path.join("templates", "_base.md"));
  const template = readRequiredResource(path.join("templates", `${reportType}.md`));
  return `${base.trim()}\n\n## 最终输出格式示例\n${template.trim()}\n`;
}

export function getDailyReportFieldLabels(): Record<DailyReportType, Record<string, string>> {
  const raw = readRequiredResource(path.join("config", "field-labels.json"));
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid ${SKILL_NAME} field-labels.json: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`Invalid ${SKILL_NAME} field-labels.json: expected an object.`);
  }

  const labels = {} as Record<DailyReportType, Record<string, string>>;
  for (const reportType of ["all", "buckle", "event"] as const) {
    const section = parsed[reportType];
    if (!isRecord(section) || Object.values(section).some((value) => typeof value !== "string")) {
      throw new Error(`Invalid ${SKILL_NAME} field-labels.json: '${reportType}' must map field names to labels.`);
    }
    labels[reportType] = section as Record<string, string>;
  }

  return labels;
}

export function resolveDailyReportSkillDir(cwd = process.cwd()): string {
  const candidates = [
    process.env.AGENT_WORKSPACE_ROOT
      ? path.resolve(process.env.AGENT_WORKSPACE_ROOT, "skills", SKILL_NAME)
      : undefined,
    path.resolve(cwd, "skills", SKILL_NAME),
    path.resolve(cwd, "..", "skills", SKILL_NAME),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const skillDir = candidates.find((candidate) => existsSync(path.join(candidate, "SKILL.md")));
  if (skillDir) return skillDir;

  throw new Error(
    `Required skill '${SKILL_NAME}' was not found. Checked: ${candidates.join(", ")}. `
    + "Set AGENT_WORKSPACE_ROOT to the repository root or include skills/ in the runtime image."
  );
}

function readRequiredResource(relativePath: string): string {
  const skillDir = resolveDailyReportSkillDir();
  const filePath = path.join(skillDir, relativePath);

  try {
    const content = readFileSync(filePath, "utf8");
    if (!content.trim()) throw new Error("file is empty");
    return content;
  } catch (error) {
    throw new Error(
      `Failed to load required ${SKILL_NAME} resource '${relativePath}' from '${filePath}': `
      + (error instanceof Error ? error.message : String(error))
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
