import fs from "node:fs/promises";
import path from "node:path";
import cron from "node-cron";
import { resolveDailyReportOutputDir } from "./reportOutputDir.js";

export interface ReportCleanupOptions {
  outputDir: string;
  retainDays?: number;
  cronExpression?: string;
  enabled?: boolean;
}

function parseRetainDays(): number {
  const value = process.env.DAILY_REPORT_RETAIN_DAYS;
  if (!value) return 30;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

export async function cleanOldReports(outputDir: string, retainDays: number): Promise<void> {
  const cutoffTime = Date.now() - retainDays * 24 * 60 * 60 * 1000;

  try {
    await fs.mkdir(outputDir, { recursive: true });
    const entries = await fs.readdir(outputDir, { withFileTypes: true });
    let deletedCount = 0;

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = path.join(outputDir, entry.name);
      try {
        const stats = await fs.stat(filePath);
        if (stats.mtimeMs < cutoffTime) {
          await fs.unlink(filePath);
          deletedCount += 1;
        }
      } catch (err) {
        console.error(`[ReportCleanup] failed to process ${filePath}:`, (err as Error).message);
      }
    }

    console.log(`[ReportCleanup] deleted ${deletedCount} old report file(s) in ${outputDir}`);
  } catch (err) {
    console.error("[ReportCleanup] failed to clean old reports:", (err as Error).message);
  }
}

export function startReportCleanupJob(options?: ReportCleanupOptions): void {
  const outputDir = options?.outputDir || resolveDailyReportOutputDir();
  const retainDays = options?.retainDays ?? parseRetainDays();
  const cronExpression = options?.cronExpression || "0 0 * * *";
  const enabled = options?.enabled ?? process.env.DAILY_REPORT_CLEANUP_ENABLED !== "0";

  if (!enabled) {
    console.log("[ReportCleanup] disabled.");
    return;
  }

  if (!cron.validate(cronExpression)) {
    console.error(`[ReportCleanup] invalid cron expression: ${cronExpression}`);
    return;
  }

  // Run once on startup, then schedule daily
  void cleanOldReports(outputDir, retainDays);

  cron.schedule(cronExpression, () => {
    void cleanOldReports(outputDir, retainDays);
  });

  console.log(`[ReportCleanup] scheduled at "${cronExpression}", retain ${retainDays} days.`);
}
