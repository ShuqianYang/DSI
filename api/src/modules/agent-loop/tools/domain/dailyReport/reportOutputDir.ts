import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../.."
);

export function resolveDailyReportOutputDir(): string {
  const configured = process.env.DAILY_REPORT_OUTPUT_DIR?.trim();
  if (!configured) return path.join(repositoryRoot, "report");
  return path.isAbsolute(configured)
    ? path.normalize(configured)
    : path.resolve(repositoryRoot, configured);
}
