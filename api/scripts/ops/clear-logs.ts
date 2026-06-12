import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

const LOGS_DIR = path.resolve(process.cwd(), "..", "logs");
const KEEP_FILES = new Set([".gitkeep"]);

interface ClearOptions {
  dryRun: boolean;
  days?: number;
}

function parseArgs(): ClearOptions {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run") || args.includes("-n");
  const daysArg = args.find((a) => a.startsWith("--days="));
  const days = daysArg ? parseInt(daysArg.split("=")[1], 10) : undefined;
  return { dryRun, days };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(2)} ${units[i]}`;
}

async function clearLogs(options: ClearOptions) {
  const entries = await readdir(LOGS_DIR);
  const cutoff = options.days ? Date.now() - options.days * 24 * 60 * 60 * 1000 : 0;

  const toDelete: { name: string; size: number; mtime: Date }[] = [];

  for (const name of entries) {
    if (KEEP_FILES.has(name)) continue;

    const filePath = path.join(LOGS_DIR, name);
    const info = await stat(filePath);
    if (!info.isFile()) continue;

    if (options.days && info.mtime.getTime() > cutoff) continue;

    toDelete.push({ name, size: info.size, mtime: info.mtime });
  }

  if (toDelete.length === 0) {
    console.log(`[clear-logs] Nothing to clean in ${LOGS_DIR}`);
    return;
  }

  const totalSize = toDelete.reduce((sum, f) => sum + f.size, 0);

  console.log(`[clear-logs] ${options.dryRun ? "[DRY-RUN] Would delete" : "Deleting"} ${toDelete.length} file(s):`);
  for (const f of toDelete) {
    console.log(`  - ${f.name} (${formatBytes(f.size)}, ${f.mtime.toISOString()})`);
  }
  console.log(`[clear-logs] Total: ${formatBytes(totalSize)}`);

  if (options.dryRun) {
    console.log("[clear-logs] Dry run complete. Use without --dry-run to actually delete.");
    return;
  }

  let deleted = 0;
  for (const f of toDelete) {
    const filePath = path.join(LOGS_DIR, f.name);
    await unlink(filePath);
    deleted++;
  }

  console.log(`[clear-logs] Deleted ${deleted} file(s), freed ${formatBytes(totalSize)}`);
}

const options = parseArgs();
clearLogs(options).catch((e) => {
  console.error("[clear-logs] Error:", e);
  process.exit(1);
});
